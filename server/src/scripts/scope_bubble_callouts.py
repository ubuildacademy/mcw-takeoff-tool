#!/usr/bin/env python3
"""
SCOPING SCRIPT — NOT wired into the app. One-off measurement tool for the
Workstream F scoping pass (docs/IMPLEMENTATION_PLAN.md). Read-only: opens a
PDF, measures candidate detail/section/elevation callout bubbles, and reports
how many have parseable text-layer content vs. none at all.

Reuses the exact shape-candidate geometry from vector_callout_pass.py
(size/aspect band, circle/hexagon path-kind heuristic, stroke+fill dedupe) so
the "candidate" counts here are apples-to-apples with what that production
script already detects. This script does NOT re-run OCR — the raster fallback
(bubble_ocr_pass.py) was instead invoked directly against a single-page PDF
extract during scoping and its real output is quoted in the plan doc; no
raster/Tesseract logic is duplicated here.

--- F2-SCOPE addendum (Workstream F, task F2-SCOPE) ---

Adds a *triangle-proximity* signal, scoped as measurement only: F1 found that
a naive doc-wide triangle-shape scan is useless on its own (~4,623 loose
triangle candidates vs ~582 loosely-classified circle candidates, ~13x
noise-to-signal). Rather than qualify triangles independently, this treats
the already-qualified circle/hexagon candidates from shape_candidates() as
the precise anchor and only asks: is there a closed 3-4-segment path whose
bbox sits within ~N circle-radii of that anchor's bbox edge? That "N" is
TRIANGLE_RADIUS_MULTIPLIER below — a module constant so it's cheap to retune
without touching call sites.

This is NOT a detector and is not called from any production path. It exists
to produce a candidate count, a ground-truth cross-check against the 62 hand
labeled genuine callouts in fixtures/f1_bubble_ground_truth.json, and sampled
crops for a human to eyeball — so a person can decide whether building real
F2 triangle detection is worth it. See docs/IMPLEMENTATION_PLAN.md F2-SCOPE.

Usage:
    python3 scope_bubble_callouts.py <pdf_path> [page,page,...] [crop_dir]

Output: human-readable report to stdout. Optional second arg restricts to a
comma-separated 1-indexed page list (for fast iteration on a known range);
omit it (or pass "-") to scan every page. Optional third arg is a directory
to write sampled circle+triangle crop PNGs + index.txt into; omit to skip
crop rendering.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import fitz  # PyMuPDF

from callout_geometry import rotated_clip

MIN_DIAMETER_PT = 8.0
MAX_DIAMETER_PT = 90.0
MIN_ASPECT = 0.68
MAX_ASPECT = 1.47

# Same acceptance pattern as vector_callout_pass.SHEET_REF_RE.
SHEET_REF_RE = re.compile(r"^[A-Za-z]{1,3}-?\d{1,3}(\.\d{1,2})?[A-Za-z]?$")

# --- F2-SCOPE: triangle-proximity constants -------------------------------

# Triangle marker flags are smaller/thinner than the callout size band above
# (they're a pointer, not the bubble itself) and legitimately non-square, so
# they get their own looser size band with NO aspect filter. Upper bound
# still shares the doc-scale ceiling so we don't pick up plan-scale geometry.
TRIANGLE_MIN_DIAMETER_PT = 3.0
TRIANGLE_MAX_DIAMETER_PT = MAX_DIAMETER_PT
TRIANGLE_LINE_COUNTS = (3, 4)  # 3 = implicit close, 4 = explicit close segment

# A pair counts when a triangle's bbox touches or sits within this many
# circle-radii of a qualified circle's bbox edge. Retune here; main() reruns
# the sensitivity sweep across SENSITIVITY_MULTIPLIERS regardless of this
# value so a single constant edit doesn't hide the tradeoff.
TRIANGLE_RADIUS_MULTIPLIER = 1.0
SENSITIVITY_MULTIPLIERS = (0.5, 1.0, 1.5)

GT_PAGE_RANGES = ((31, 38), (55, 68))
GT_FIXTURE_PATH = Path(__file__).parent / "fixtures" / "f1_bubble_ground_truth.json"

MAX_CROPS = 200
CROP_SCALE = 4.0
CROP_MARGIN_PT = 6.0


def shape_candidates(page: "fitz.Page") -> list[dict]:
    """Verbatim port of vector_callout_pass._shape_candidates (geometry only)."""
    out: list[dict] = []
    try:
        drawings = page.get_drawings()
    except Exception:  # noqa: BLE001
        return out

    for path in drawings:
        items = path.get("items") or []
        if not items:
            continue
        rect = path.get("rect")
        if rect is None:
            continue
        w, h = float(rect.width), float(rect.height)
        if w < MIN_DIAMETER_PT or h < MIN_DIAMETER_PT:
            continue
        if w > MAX_DIAMETER_PT or h > MAX_DIAMETER_PT:
            continue
        aspect = w / h if h else 0
        if aspect < MIN_ASPECT or aspect > MAX_ASPECT:
            continue

        kinds = [it[0] for it in items]
        curve_count = sum(1 for k in kinds if k == "c")
        line_count = sum(1 for k in kinds if k == "l")

        shape = None
        if curve_count >= 2 and line_count <= 1 and len(kinds) <= 10:
            shape = "circle"
        elif line_count in (5, 6, 7) and curve_count == 0:
            shape = "hexagon"
        if shape is None:
            continue

        out.append(
            {
                "shape": shape,
                "x0": float(rect.x0),
                "y0": float(rect.y0),
                "x1": float(rect.x1),
                "y1": float(rect.y1),
            }
        )

    return _dedupe(out)


def _dedupe(cands: list[dict]) -> list[dict]:
    deduped: list[dict] = []
    for cand in cands:
        cx = (cand["x0"] + cand["x1"]) / 2
        cy = (cand["y0"] + cand["y1"]) / 2
        cw = cand["x1"] - cand["x0"]
        dup = False
        for kept in deduped:
            kx = (kept["x0"] + kept["x1"]) / 2
            ky = (kept["y0"] + kept["y1"]) / 2
            kw = kept["x1"] - kept["x0"]
            if abs(cx - kx) <= 3 and abs(cy - ky) <= 3 and abs(cw - kw) <= 6:
                dup = True
                break
        if not dup:
            deduped.append(cand)
    return deduped


def triangle_candidates(page: "fitz.Page") -> list[dict]:
    """Closed 3-4 line-segment paths in the triangle size band, deduped.

    Deliberately NOT qualified by shape beyond segment count + size — the
    proximity check against an already-qualified circle is what's supposed
    to do the noise rejection here (see module docstring). Coordinates are
    UNROTATED page space, matching shape_candidates().
    """
    out: list[dict] = []
    try:
        drawings = page.get_drawings()
    except Exception:  # noqa: BLE001
        return out

    for path in drawings:
        items = path.get("items") or []
        if not items:
            continue
        rect = path.get("rect")
        if rect is None:
            continue
        w, h = float(rect.width), float(rect.height)
        if w < TRIANGLE_MIN_DIAMETER_PT or h < TRIANGLE_MIN_DIAMETER_PT:
            continue
        if w > TRIANGLE_MAX_DIAMETER_PT or h > TRIANGLE_MAX_DIAMETER_PT:
            continue

        kinds = [it[0] for it in items]
        curve_count = sum(1 for k in kinds if k == "c")
        line_count = sum(1 for k in kinds if k == "l")
        if curve_count != 0 or line_count not in TRIANGLE_LINE_COUNTS:
            continue

        out.append(
            {
                "shape": "triangle",
                "x0": float(rect.x0),
                "y0": float(rect.y0),
                "x1": float(rect.x1),
                "y1": float(rect.y1),
            }
        )

    return _dedupe(out)


def _radius(shape: dict) -> float:
    return ((shape["x1"] - shape["x0"]) + (shape["y1"] - shape["y0"])) / 4.0


def _bbox_gap(a: dict, b: dict) -> float:
    """Euclidean gap between two bboxes' edges; 0 if they touch/overlap."""
    hgap = max(0.0, a["x0"] - b["x1"], b["x0"] - a["x1"])
    vgap = max(0.0, a["y0"] - b["y1"], b["y0"] - a["y1"])
    return (hgap * hgap + vgap * vgap) ** 0.5


def find_pairs(circles: list[dict], triangles: list[dict], multiplier: float) -> list[dict]:
    """One pair per circle that has >=1 triangle within multiplier*radius of
    its bbox edge (closest triangle wins). Returns dicts with indices into
    the input lists plus the measured gap, for crop rendering / cross-check.
    """
    pairs: list[dict] = []
    for ci, c in enumerate(circles):
        threshold = multiplier * _radius(c)
        best_ti = None
        best_gap = None
        for ti, t in enumerate(triangles):
            gap = _bbox_gap(c, t)
            if gap <= threshold and (best_gap is None or gap < best_gap):
                best_gap = gap
                best_ti = ti
        if best_ti is not None:
            pairs.append({"circle_idx": ci, "triangle_idx": best_ti, "gap_pt": best_gap})
    return pairs


def _match_ground_truth_circle(gt_bbox: list[float], circles: list[dict]) -> int | None:
    """Match a ground-truth bbox to a live shape_candidates() circle on the
    same page by center+size tolerance (same tolerance _dedupe uses), NOT by
    candidateIndex — the fixture explicitly documents that index is unstable.
    """
    gx0, gy0, gx1, gy1 = gt_bbox
    gcx, gcy = (gx0 + gx1) / 2, (gy0 + gy1) / 2
    gw = gx1 - gx0
    for idx, c in enumerate(circles):
        ccx, ccy = (c["x0"] + c["x1"]) / 2, (c["y0"] + c["y1"]) / 2
        cw = c["x1"] - c["x0"]
        if abs(ccx - gcx) <= 3 and abs(ccy - gcy) <= 3 and abs(cw - gw) <= 6:
            return idx
    return None


def words_inside(shape: dict, words: list[tuple]) -> list[str]:
    cx = (shape["x0"] + shape["x1"]) / 2
    cy = (shape["y0"] + shape["y1"]) / 2
    rx = (shape["x1"] - shape["x0"]) / 2
    ry = (shape["y1"] - shape["y0"]) / 2
    if rx <= 0 or ry <= 0:
        return []
    inside = []
    for wd in words:
        wx = (float(wd[0]) + float(wd[2])) / 2
        wy = (float(wd[1]) + float(wd[3])) / 2
        nx = (wx - cx) / rx
        ny = (wy - cy) / ry
        if nx * nx + ny * ny <= 1.2:
            inside.append(str(wd[4]).strip())
    return inside


def _render_pair_crop(page: "fitz.Page", circle: dict, triangle: dict, out_path: Path) -> None:
    x0 = min(circle["x0"], triangle["x0"]) - CROP_MARGIN_PT
    y0 = min(circle["y0"], triangle["y0"]) - CROP_MARGIN_PT
    x1 = max(circle["x1"], triangle["x1"]) + CROP_MARGIN_PT
    y1 = max(circle["y1"], triangle["y1"]) + CROP_MARGIN_PT
    clip = rotated_clip(page, x0, y0, x1, y1)
    mat = fitz.Matrix(CROP_SCALE, CROP_SCALE)
    pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
    if pix.width == 0 or pix.height == 0:
        return
    pix.save(str(out_path))


def _in_gt_range(page_num: int) -> bool:
    return any(lo <= page_num <= hi for lo, hi in GT_PAGE_RANGES)


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: scope_bubble_callouts.py <pdf_path> [page,page,...] [crop_dir]")
        sys.exit(1)

    pdf_path = sys.argv[1]
    page_filter = None
    if len(sys.argv) > 2 and sys.argv[2] != "-":
        page_filter = {int(p) for p in sys.argv[2].split(",")}
    crop_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else None

    doc = fitz.open(pdf_path)

    total_candidates = 0
    no_text = 0
    has_text = 0
    parseable_sheetref = 0
    single_letter_tag = 0
    per_page_rows = []

    # F2-SCOPE state, keyed by page_num -> data needed for later passes.
    page_shapes: dict[int, tuple[list[dict], list[dict]]] = {}  # (circles, triangles)

    for page_index in range(len(doc)):
        page_num = page_index + 1
        if page_filter is not None and page_num not in page_filter:
            continue
        page = doc[page_index]
        words = page.get_text("words") or []
        cands = shape_candidates(page)
        triangles = triangle_candidates(page)
        page_shapes[page_num] = (cands, triangles)

        page_no_text = 0
        page_has_text = 0
        for c in cands:
            inside = words_inside(c, words)
            total_candidates += 1
            if not inside:
                no_text += 1
                page_no_text += 1
            else:
                has_text += 1
                page_has_text += 1
                joined = "".join(inside)
                if len(inside) == 1 and len(inside[0]) <= 3 and inside[0].isalpha():
                    single_letter_tag += 1
                if SHEET_REF_RE.match(joined.replace(" ", "")) and any(
                    ch.isdigit() for ch in joined
                ):
                    parseable_sheetref += 1

        per_page_rows.append((page_num, len(cands), page_no_text, page_has_text))

    print(f"PDF: {pdf_path}")
    print(f"Pages scanned: {len(per_page_rows)}")
    print()
    print("Per-page candidate counts (page, candidates, no_text, has_text):")
    for row in per_page_rows:
        if row[1] > 0:
            print(f"  {row}")
    print()
    print("=== Headline numbers ===")
    print(f"Total geometry-qualified circle/hexagon candidates: {total_candidates}")
    if total_candidates:
        print(
            f"  No text-layer words inside (outlined/vector-glyph): {no_text} "
            f"({100 * no_text / total_candidates:.1f}%)"
        )
        print(
            f"  Has >=1 text-layer word inside: {has_text} "
            f"({100 * has_text / total_candidates:.1f}%)"
        )
        print(f"    of which single-letter/abbrev tag (likely non-callout symbol): {single_letter_tag}")
        print(
            f"    of which cleanly parses as a sheet-ref pattern: {parseable_sheetref} "
            f"({100 * parseable_sheetref / total_candidates:.1f}% of all candidates)"
        )

    # --- F2-SCOPE: triangle-proximity report --------------------------
    print()
    print("=== F2-SCOPE: circle+triangle proximity ===")
    print(f"Radius multiplier used for per-page rows below: {TRIANGLE_RADIUS_MULTIPLIER}")
    print()
    print("Per-page (page, circles, triangles, pairs):")

    all_pairs_by_page: dict[int, list[dict]] = {}
    doc_circles = 0
    doc_triangles = 0
    doc_pairs = 0
    gt_circles = 0
    gt_triangles = 0
    gt_pairs = 0

    for page_num, (circles, triangles) in sorted(page_shapes.items()):
        pairs = find_pairs(circles, triangles, TRIANGLE_RADIUS_MULTIPLIER)
        all_pairs_by_page[page_num] = pairs
        doc_circles += len(circles)
        doc_triangles += len(triangles)
        doc_pairs += len(pairs)
        if _in_gt_range(page_num):
            gt_circles += len(circles)
            gt_triangles += len(triangles)
            gt_pairs += len(pairs)
        if circles or triangles:
            print(f"  ({page_num}, {len(circles)}, {len(triangles)}, {len(pairs)})")

    print()
    print("Doc-wide totals (radius multiplier = {:.1f}):".format(TRIANGLE_RADIUS_MULTIPLIER))
    print(f"  Qualified circles/hexagons: {doc_circles}")
    print(f"  Triangle-shaped paths (size-band only, unfiltered by circle proximity): {doc_triangles}")
    print(f"  Circle+triangle pairs: {doc_pairs}")
    print()
    print(f"Ground-truth range totals (pages {GT_PAGE_RANGES}, radius multiplier = {TRIANGLE_RADIUS_MULTIPLIER}):")
    print(f"  Qualified circles/hexagons: {gt_circles}")
    print(f"  Triangle-shaped paths: {gt_triangles}")
    print(f"  Circle+triangle pairs: {gt_pairs}")

    # --- F2-SCOPE: ground-truth cross-check ----------------------------
    print()
    print("=== F2-SCOPE: ground-truth cross-check (fixtures/f1_bubble_ground_truth.json) ===")
    if not GT_FIXTURE_PATH.exists():
        print(f"  Fixture not found at {GT_FIXTURE_PATH}, skipping cross-check.")
    else:
        gt_data = json.loads(GT_FIXTURE_PATH.read_text())
        gt_candidates = gt_data.get("candidates", [])
        print(f"  Ground-truth genuine circle callouts: {len(gt_candidates)}")
        # Sub-ranges are semantically different: 31-38 is elevations (section/
        # elevation markers would plausibly carry a triangle flag), 55-68 is
        # details (plain circle callouts, no triangle expected). If the
        # triangle-proximity signal is discriminating rather than noise, hit
        # rate should be high in the first range and low in the second.
        elev_lo, elev_hi = GT_PAGE_RANGES[0]
        det_lo, det_hi = GT_PAGE_RANGES[1]

        for multiplier in SENSITIVITY_MULTIPLIERS:
            unmatched = 0
            hits = 0
            elev_hits = elev_total = 0
            det_hits = det_total = 0
            for entry in gt_candidates:
                page_num = entry["page"]
                circles, triangles = page_shapes.get(page_num, ([], []))
                idx = _match_ground_truth_circle(entry["bbox_pt"], circles)
                if idx is None:
                    unmatched += 1
                    continue
                pairs = find_pairs(circles, triangles, multiplier)
                hit = any(p["circle_idx"] == idx for p in pairs)
                if hit:
                    hits += 1
                if elev_lo <= page_num <= elev_hi:
                    elev_total += 1
                    elev_hits += hit
                elif det_lo <= page_num <= det_hi:
                    det_total += 1
                    det_hits += hit
            print(
                f"  radius x{multiplier}: {hits}/{len(gt_candidates)} genuine callouts have an "
                f"adjacent triangle"
                + (f"  ({unmatched} could not be matched to a live candidate)" if unmatched else "")
            )
            print(
                f"      elevations (pp {elev_lo}-{elev_hi}): {elev_hits}/{elev_total}   "
                f"details (pp {det_lo}-{det_hi}): {det_hits}/{det_total}"
            )

    # --- F2-SCOPE: sensitivity sweep, doc-wide + GT-range ---------------
    print()
    print("=== F2-SCOPE: radius-multiplier sensitivity (doc-wide pairs / GT-range pairs) ===")
    for multiplier in SENSITIVITY_MULTIPLIERS:
        sweep_doc_pairs = 0
        sweep_gt_pairs = 0
        for page_num, (circles, triangles) in page_shapes.items():
            pairs = find_pairs(circles, triangles, multiplier)
            sweep_doc_pairs += len(pairs)
            if _in_gt_range(page_num):
                sweep_gt_pairs += len(pairs)
        print(f"  radius x{multiplier}: {sweep_doc_pairs} doc-wide pairs, {sweep_gt_pairs} in GT-range pages")

    # --- F2-SCOPE: sampled crops for human labeling ---------------------
    if crop_dir is not None:
        print()
        print(f"=== F2-SCOPE: rendering pair crops to {crop_dir} ===")
        crop_dir.mkdir(parents=True, exist_ok=True)

        flat_pairs = []  # (page_num, circle, triangle)
        for page_num, pairs in sorted(all_pairs_by_page.items()):
            circles, triangles = page_shapes[page_num]
            for p in pairs:
                flat_pairs.append((page_num, circles[p["circle_idx"]], triangles[p["triangle_idx"]]))

        sampled = flat_pairs
        sampled_note = ""
        if len(flat_pairs) > MAX_CROPS:
            step = len(flat_pairs) / MAX_CROPS
            sampled = [flat_pairs[int(i * step)] for i in range(MAX_CROPS)]
            sampled_note = (
                f" (sampled evenly from {len(flat_pairs)} total pairs, capped at {MAX_CROPS})"
            )

        index_lines = []
        by_page: dict[int, int] = Counter()
        for page_num, circle, triangle in sampled:
            by_page[page_num] += 1
            n = by_page[page_num]
            fname = f"p{page_num}_pair{n}.png"
            page = doc[page_num - 1]
            _render_pair_crop(page, circle, triangle, crop_dir / fname)
            combined_bbox = (
                min(circle["x0"], triangle["x0"]),
                min(circle["y0"], triangle["y0"]),
                max(circle["x1"], triangle["x1"]),
                max(circle["y1"], triangle["y1"]),
            )
            index_lines.append(f"{fname}\tpage={page_num}\tbbox_pt={combined_bbox}")

        (crop_dir / "index.txt").write_text("\n".join(index_lines) + "\n")
        print(f"  Wrote {len(sampled)} crop(s){sampled_note}")
        print(f"  Index: {crop_dir / 'index.txt'}")

    doc.close()


if __name__ == "__main__":
    main()
