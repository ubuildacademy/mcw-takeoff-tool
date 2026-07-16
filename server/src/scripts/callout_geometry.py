#!/usr/bin/env python3
"""
Shared vector-geometry candidate detection for callout bubbles (circle/hexagon
detail/section/elevation markers on CAD-exported architectural PDFs).

Extracted from vector_callout_pass.py so bubble_ocr_pass.py can reuse the same
shape/dedupe heuristic as its OCR crop targets instead of running an
independent HoughCircles scan (see docs/IMPLEMENTATION_PLAN.md Workstream F,
Task F1). Both callers read `page.get_drawings()` / `page.get_text("words")`,
which PyMuPDF returns in UNROTATED page space -- callers that need to render a
crop from a bbox produced here must transform it through
`page.rotation_matrix` first (get_pixmap's `clip` expects rotated space; see
bubble_ocr_pass.py's `_rotated_clip`).
"""
from __future__ import annotations

import re

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


def shape_candidates(page: "fitz.Page") -> list[dict]:
    """Circle/hexagon-shaped closed paths in callout size range, deduped.

    Coordinates are in UNROTATED page space (bbox x0/y0/x1/y1 in PDF points).
    """
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


def word_in_shape(word: tuple, shape: dict) -> bool:
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


def classify_from_words(shape: dict, inside_words: list[tuple]) -> tuple[str | None, str | None]:
    """(detailLabel, sheetRef) from text-layer words already inside the shape.

    Convention: sheet ref in the bottom half, detail label in the top half.
    Falls back to pattern shape when a callout has only one word. Mirrors
    vector_callout_pass._classify so "already resolved via text layer"
    candidates are identified identically in both scripts.
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

    if sheet_ref is None and detail_label is None:
        joined = (top_join + bottom_join).replace(" ", "")
        if joined and SHEET_REF_RE.match(joined) and any(c.isdigit() for c in joined):
            sheet_ref = joined.upper()
        elif joined and DETAIL_LABEL_RE.match(joined):
            detail_label = joined.upper()

    return detail_label, sheet_ref


def rotated_clip(page: "fitz.Page", x0: float, y0: float, x1: float, y1: float) -> "fitz.Rect":
    """Transform an UNROTATED bbox (get_drawings/get_text space) into the
    rotated space get_pixmap's `clip` expects.

    get_drawings() and get_text("words") always return coordinates in the
    page's unrotated content-stream space, but Page.get_pixmap(clip=...)
    expects coordinates in the rotated `page.rect` space. On a page with
    /Rotate 90 or 270, using the raw unrotated bbox as `clip` renders the
    wrong region (or an empty one, since the axis extents differ). This doc's
    beta set is rotation=270 on 69/80 pages, so this transform is required,
    not optional.
    """
    rect = fitz.Rect(x0, y0, x1, y1) * page.rotation_matrix
    rect.normalize()
    return rect
