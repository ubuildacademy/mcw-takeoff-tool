#!/usr/bin/env python3
"""
Vector callout detection for Auto-hyperlink (no rasterization, no OCR).

CAD-exported construction PDFs draw detail/section callouts as vector paths:
a circle (4 bezier arcs) or hexagon, often split by a horizontal line, with
the detail number in the top half and the target sheet number in the bottom
half. This script reads that geometry directly via PyMuPDF `get_drawings()`
and pairs each shape with the exact text words inside it — precise where the
raster template-matching pass (callout_hyperlink_pass.py) has to guess.

Usage:
    python3 vector_callout_pass.py <pdf_path>

Output (stdout, JSON):
    {
      "success": true,
      "totalPages": N,
      "calloutsFound": M,
      "pages": [
        {
          "pageNumber": 1,
          "width": <points>, "height": <points>, "rotation": 0,
          "callouts": [
            {
              "bbox": {"x": 0.61, "y": 0.40, "width": 0.02, "height": 0.02},  # 0..1 of page
              "shape": "circle" | "hexagon",
              "detailLabel": "5" | null,          # top-half label
              "sheetRef": "A-501" | null,         # bottom-half sheet number (raw join)
              "kind": "reference" | "detail_title" | "unlabeled",
              "titleText": "TYP. PARAPET DETAIL" | null,  # detail_title only
              "words": [{"text": "...", "x":..., "y":..., "width":..., "height":...}]
            }
          ]
        }
      ]
    }

Coordinates use the same convention as pymupdf_text_extract.py: divide by
page.rect (top-left origin) so the consumer gets base-normalized boxes.
"""
from __future__ import annotations

import json
import re
import sys

import fitz  # PyMuPDF

# Callout bubbles on real sheets: ~10-70 pt across. Below = text glyph curves,
# above = plan geometry (tanks, columns, north arrows).
MIN_DIAMETER_PT = 8.0
MAX_DIAMETER_PT = 90.0
MIN_ASPECT = 0.68
MAX_ASPECT = 1.47

# Sheet number as drawn inside callouts: "A-501", "A501", "S3.1", "M1.02A"...
SHEET_REF_RE = re.compile(r"^[A-Za-z]{1,3}-?\d{1,3}(\.\d{1,2})?[A-Za-z]?$")
# Detail label: "5", "A", "12", "D1"
DETAIL_LABEL_RE = re.compile(r"^[A-Za-z0-9]{1,4}$")


def _clamp01(v: float) -> float:
    return 0.0 if v < 0 else (1.0 if v > 1 else v)


def _shape_candidates(page: "fitz.Page") -> list[dict]:
    """Circle/hexagon-shaped closed paths in callout size range, deduped."""
    out: list[dict] = []
    try:
        drawings = page.get_drawings()
    except Exception:  # noqa: BLE001 -- malformed content stream; skip page
        return out

    for path in drawings:
        items = path.get("items") or []
        if not items:
            continue
        kinds = [it[0] for it in items]
        rect = path.get("rect")
        if rect is None:
            continue
        w = float(rect.width)
        h = float(rect.height)
        if w < MIN_DIAMETER_PT or h < MIN_DIAMETER_PT:
            continue
        if w > MAX_DIAMETER_PT or h > MAX_DIAMETER_PT:
            continue
        aspect = w / h if h else 0
        if aspect < MIN_ASPECT or aspect > MAX_ASPECT:
            continue

        curve_count = sum(1 for k in kinds if k == "c")
        line_count = sum(1 for k in kinds if k == "l")

        shape = None
        if curve_count >= 2 and line_count <= 1 and len(kinds) <= 10:
            # 2-8 bezier arcs (+ optional split line in the same path) = circle
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

    # Dedupe stroke/fill duplicates: same center (±3 pt) and similar size.
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


def _word_in_shape(word: tuple, shape: dict) -> bool:
    """Word center inside the shape's inscribed ellipse (slightly relaxed)."""
    wx = (float(word[0]) + float(word[2])) / 2
    wy = (float(word[1]) + float(word[3])) / 2
    cx = (shape["x0"] + shape["x1"]) / 2
    cy = (shape["y0"] + shape["y1"]) / 2
    rx = (shape["x1"] - shape["x0"]) / 2
    ry = (shape["y1"] - shape["y0"]) / 2
    if rx <= 0 or ry <= 0:
        return False
    nx = (wx - cx) / rx
    ny = (wy - cy) / ry
    return nx * nx + ny * ny <= 1.2


def _classify(shape: dict, inside_words: list[tuple]) -> tuple[str | None, str | None]:
    """(detailLabel, sheetRef) from words inside the shape.

    Convention: sheet ref in the bottom half, detail label in the top half.
    Falls back to pattern shape when a callout has only one word.
    """
    cy = (shape["y0"] + shape["y1"]) / 2
    top: list[str] = []
    bottom: list[str] = []
    for wd in inside_words:
        wcy = (float(wd[1]) + float(wd[3])) / 2
        (top if wcy < cy else bottom).append(str(wd[4]).strip())

    bottom_join = "".join(bottom).replace(" ", "")
    top_join = "".join(top).replace(" ", "")

    sheet_ref = None
    detail_label = None

    if bottom_join and SHEET_REF_RE.match(bottom_join):
        sheet_ref = bottom_join.upper()
    if top_join and DETAIL_LABEL_RE.match(top_join) and not SHEET_REF_RE.match(top_join):
        detail_label = top_join.upper()

    # Single word dead-center (split not detected): let the pattern decide.
    if sheet_ref is None and detail_label is None:
        joined = (top_join + bottom_join).replace(" ", "")
        if joined and SHEET_REF_RE.match(joined) and any(c.isdigit() for c in joined):
            sheet_ref = joined.upper()
        elif joined and DETAIL_LABEL_RE.match(joined):
            detail_label = joined.upper()

    return detail_label, sheet_ref


def _title_text(shape: dict, words: list[tuple]) -> str | None:
    """For detail-title bubbles: title text sits right of the bubble on the same line."""
    x1 = shape["x1"]
    cy = (shape["y0"] + shape["y1"]) / 2
    h = shape["y1"] - shape["y0"]
    w = shape["x1"] - shape["x0"]
    picked: list[tuple[float, str]] = []
    for wd in words:
        wx0 = float(wd[0])
        wcy = (float(wd[1]) + float(wd[3])) / 2
        if wx0 >= x1 - 1 and wx0 <= x1 + 6 * w and abs(wcy - cy) <= h * 0.75:
            text = str(wd[4]).strip()
            if text:
                picked.append((wx0, text))
    if not picked:
        return None
    picked.sort(key=lambda t: t[0])
    title = " ".join(t[1] for t in picked)[:120]
    return title or None


def extract_callouts(pdf_path: str) -> dict:
    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:  # noqa: BLE001 -- surface message to Node
        return {"success": False, "error": f"Failed to open PDF: {exc}"}

    pages_payload = []
    callouts_found = 0

    try:
        for page_index in range(len(doc)):
            try:
                page = doc[page_index]
                # Drawing/word coords are in UNROTATED space; page.rect is the
                # rotated box — swap dims on /Rotate 90/270 (see table_extract.py).
                rotation = int(getattr(page, "rotation", 0) or 0) % 360
                rect = page.rect
                if rotation in (90, 270):
                    width = float(rect.height) or 1.0
                    height = float(rect.width) or 1.0
                else:
                    width = float(rect.width) or 1.0
                    height = float(rect.height) or 1.0

                shapes = _shape_candidates(page)
                words = page.get_text("words") or [] if shapes else []

                callouts = []
                for shape in shapes:
                    inside = [w for w in words if len(w) >= 5 and _word_in_shape(w, shape)]
                    detail_label, sheet_ref = _classify(shape, inside)
                    if detail_label is None and sheet_ref is None:
                        continue  # plain circle on the plan, not a callout

                    if sheet_ref is not None:
                        kind = "reference"
                        title = None
                    elif detail_label is not None:
                        title = _title_text(shape, words)
                        kind = "detail_title" if title else "unlabeled"
                    else:
                        kind = "unlabeled"
                        title = None

                    callouts.append(
                        {
                            "bbox": {
                                "x": _clamp01(shape["x0"] / width),
                                "y": _clamp01(shape["y0"] / height),
                                "width": _clamp01((shape["x1"] - shape["x0"]) / width),
                                "height": _clamp01((shape["y1"] - shape["y0"]) / height),
                            },
                            "shape": shape["shape"],
                            "detailLabel": detail_label,
                            "sheetRef": sheet_ref,
                            "kind": kind,
                            "titleText": title,
                            "words": [
                                {
                                    "text": str(w[4]).strip(),
                                    "x": _clamp01(min(float(w[0]), float(w[2])) / width),
                                    "y": _clamp01(min(float(w[1]), float(w[3])) / height),
                                    "width": _clamp01(abs(float(w[2]) - float(w[0])) / width),
                                    "height": _clamp01(abs(float(w[3]) - float(w[1])) / height),
                                }
                                for w in inside
                            ],
                        }
                    )

                callouts_found += len(callouts)
                pages_payload.append(
                    {
                        "pageNumber": page_index + 1,
                        "width": width,
                        "height": height,
                        "rotation": int(getattr(page, "rotation", 0) or 0),
                        "callouts": callouts,
                    }
                )
                print(
                    f"[vector-callout] page {page_index + 1}/{len(doc)}: "
                    f"{len(shapes)} shapes, {len(callouts)} callouts",
                    file=sys.stderr,
                    flush=True,
                )
            except Exception as page_exc:  # noqa: BLE001 -- keep going on bad pages
                pages_payload.append(
                    {
                        "pageNumber": page_index + 1,
                        "width": 0,
                        "height": 0,
                        "rotation": 0,
                        "callouts": [],
                        "error": str(page_exc),
                    }
                )
    finally:
        try:
            doc.close()
        except Exception:  # noqa: BLE001
            pass

    return {
        "success": True,
        "totalPages": len(pages_payload),
        "calloutsFound": callouts_found,
        "pages": pages_payload,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Usage: vector_callout_pass.py <pdf_path>"}))
        sys.exit(1)

    result = extract_callouts(sys.argv[1])
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
