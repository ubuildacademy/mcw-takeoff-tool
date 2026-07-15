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

Usage:
    python3 scope_bubble_callouts.py <pdf_path> [page,page,...]

Output: human-readable report to stdout. Optional second arg restricts to a
comma-separated 1-indexed page list (for fast iteration on a known range);
omit it to scan every page.
"""
from __future__ import annotations

import re
import sys
from collections import Counter

import fitz  # PyMuPDF

MIN_DIAMETER_PT = 8.0
MAX_DIAMETER_PT = 90.0
MIN_ASPECT = 0.68
MAX_ASPECT = 1.47

# Same acceptance pattern as vector_callout_pass.SHEET_REF_RE.
SHEET_REF_RE = re.compile(r"^[A-Za-z]{1,3}-?\d{1,3}(\.\d{1,2})?[A-Za-z]?$")


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

    deduped: list[dict] = []
    for cand in out:
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


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: scope_bubble_callouts.py <pdf_path> [page,page,...]")
        sys.exit(1)

    pdf_path = sys.argv[1]
    page_filter = None
    if len(sys.argv) > 2:
        page_filter = {int(p) for p in sys.argv[2].split(",")}

    doc = fitz.open(pdf_path)

    total_candidates = 0
    no_text = 0
    has_text = 0
    parseable_sheetref = 0
    single_letter_tag = 0
    per_page_rows = []

    for page_index in range(len(doc)):
        page_num = page_index + 1
        if page_filter is not None and page_num not in page_filter:
            continue
        page = doc[page_index]
        words = page.get_text("words") or []
        cands = shape_candidates(page)

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

    doc.close()


if __name__ == "__main__":
    main()
