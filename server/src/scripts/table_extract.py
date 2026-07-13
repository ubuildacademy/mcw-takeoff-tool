#!/usr/bin/env python3
"""
Schedule table extraction for vector PDFs — deterministic, no OCR, no LLM.

Reconstructs a table from a user-boxed region of a CAD-exported sheet:
  1. "ruled" mode: cluster the region's horizontal/vertical line segments
     (get_drawings) into a cell lattice, assign exact text words to cells.
  2. "clustered" fallback (borderless schedules): cluster word baselines into
     rows and x-starts into columns.

Usage:
    python3 table_extract.py <pdf_path> <page_number_1based> <x0> <y0> <x1> <y1> [ocr]
    (region in 0..1 normalized page coordinates, top-left origin)
    Pass a 7th arg "ocr" to enable the per-cell Tesseract fallback for
    outlined/flattened schedules whose data cells have no selectable text.

Output (stdout JSON):
    {
      "success": true,
      "mode": "ruled" | "clustered" | "ruled_ocr",
      "rows": [["MARK", "WIDTH", ...], ["W1", "3'-0\"", ...]],
      "rowBoxes": [{"y0": 0.31, "y1": 0.33}, ...],   # normalized, per row
      "cellConfidence": [[97, 88, ...], ...],         # ruled_ocr only, 0..100 per cell
      "region": {"x0":..., "y0":..., "x1":..., "y1":...}
    }
"""
from __future__ import annotations

import json
import sys

import fitz  # PyMuPDF

LINE_AXIS_TOL_PT = 0.7      # max cross-axis deviation for h/v classification
MIN_LINE_LEN_PT = 12.0      # ignore tick marks / glyph strokes
CLUSTER_TOL_PT = 2.5        # merge nearby parallel lines into one boundary
WORD_ROW_TOL_FACTOR = 0.7   # row clustering: fraction of median word height
COL_TOL_PT = 9.0            # column clustering tolerance on x-starts
OCR_ZOOM = 4.0              # render scale for OCR fallback (72*4 ≈ 288 DPI)


def _cluster(values: list[float], tol: float) -> list[float]:
    """1-D cluster sorted values; returns cluster centers."""
    if not values:
        return []
    values = sorted(values)
    centers: list[list[float]] = [[values[0]]]
    for v in values[1:]:
        if v - centers[-1][-1] <= tol:
            centers[-1].append(v)
        else:
            centers.append([v])
    return [sum(c) / len(c) for c in centers]


def _segments_in_region(page: "fitz.Page", x0: float, y0: float, x1: float, y1: float):
    """(horizontal, vertical) line segments clipped to the region (unrotated space)."""
    horizontals: list[tuple[float, float, float]] = []  # (y, xa, xb)
    verticals: list[tuple[float, float, float]] = []    # (x, ya, yb)

    def add_segment(pa, pb) -> None:
        ax, ay, bx, by = float(pa.x), float(pa.y), float(pb.x), float(pb.y)
        # Clip test: midpoint inside region (cheap, adequate for table grids)
        mx, my = (ax + bx) / 2, (ay + by) / 2
        if not (x0 - 2 <= mx <= x1 + 2 and y0 - 2 <= my <= y1 + 2):
            return
        if abs(ay - by) <= LINE_AXIS_TOL_PT and abs(bx - ax) >= MIN_LINE_LEN_PT:
            horizontals.append(((ay + by) / 2, min(ax, bx), max(ax, bx)))
        elif abs(ax - bx) <= LINE_AXIS_TOL_PT and abs(by - ay) >= MIN_LINE_LEN_PT:
            verticals.append(((ax + bx) / 2, min(ay, by), max(ay, by)))

    try:
        drawings = page.get_drawings()
    except Exception:  # noqa: BLE001
        return horizontals, verticals

    for path in drawings:
        for item in path.get("items") or []:
            kind = item[0]
            if kind == "l":
                add_segment(item[1], item[2])
            elif kind == "re":
                r = item[1]
                add_segment(fitz.Point(r.x0, r.y0), fitz.Point(r.x1, r.y0))
                add_segment(fitz.Point(r.x0, r.y1), fitz.Point(r.x1, r.y1))
                add_segment(fitz.Point(r.x0, r.y0), fitz.Point(r.x0, r.y1))
                add_segment(fitz.Point(r.x1, r.y0), fitz.Point(r.x1, r.y1))
    return horizontals, verticals


def _ocr_words(page: "fitz.Page", x0: float, y0: float, x1: float, y1: float):
    """OCR the boxed region ONCE; return words as (wx0, wy0, wx1, wy1, text, conf)
    in unrotated PAGE-point coordinates so they slot into the same cell lattice
    the vector path uses. One Tesseract pass over the region — not per cell —
    keeps this fast and reuses the proven grid-assignment logic.

    The region (x0..y1) is in UNROTATED page space, where the lattice lives.
    But OCR needs visually-upright pixels, so we render at the page's NATIVE
    rotation (get_pixmap works in rotated/visible space) and map each word's
    pixel box back to unrotated space via the page's derotation matrix. This is
    what makes rotated CAD sheets (e.g. /Rotate 270 landscape plots) read
    correctly instead of sideways. The doc is closed by the caller.
    """
    from PIL import Image
    import pytesseract

    # Unrotated region -> visible (rotated) clip that get_pixmap understands.
    vis_clip = fitz.Rect(x0, y0, x1, y1) * page.rotation_matrix
    vis_clip.normalize()

    pix = page.get_pixmap(matrix=fitz.Matrix(OCR_ZOOM, OCR_ZOOM), clip=vis_clip, alpha=False)
    # Feed grayscale straight to Tesseract and let it Otsu-threshold internally.
    # A manual global binarize flips the schedule's gray SHADED rows (level
    # grouping bands) to solid black, erasing their text and wrecking layout
    # analysis for the whole region — measurably worse (≈half the confident
    # words) than raw grayscale on the real outlined door schedule.
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).convert("L")

    # PSM 11 (sparse text: find every word regardless of layout). We do NOT want
    # Tesseract to infer the table — the vector lattice already provides the grid,
    # and we only need words + positions to drop into cells. PSM 6 ("uniform
    # block") mis-segments the dense schedule grid and door-number ovals into
    # near-garbage; sparse mode is dramatically more robust on a loose box.
    data = pytesseract.image_to_data(
        img,
        config="--psm 11 -c preserve_interword_spaces=1",
        output_type=pytesseract.Output.DICT,
    )

    derot = page.derotation_matrix  # visible (rotated) -> unrotated
    words = []
    for i in range(len(data["text"])):
        text = (data["text"][i] or "").strip()
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1.0
        if not text or conf < 0:
            continue
        px, py = data["left"][i], data["top"][i]
        pw2, ph2 = data["width"][i], data["height"][i]
        # pixel -> visible page point (pixmap origin = vis_clip top-left)
        v0 = fitz.Point(vis_clip.x0 + px / OCR_ZOOM, vis_clip.y0 + py / OCR_ZOOM) * derot
        v1 = fitz.Point(
            vis_clip.x0 + (px + pw2) / OCR_ZOOM, vis_clip.y0 + (py + ph2) / OCR_ZOOM
        ) * derot
        ux0, ux1 = sorted((v0.x, v1.x))
        uy0, uy1 = sorted((v0.y, v1.y))
        words.append((ux0, uy0, ux1, uy1, text, conf))
    return words


def _drop_empty(rows, row_boxes, conf=None):
    """Drop fully-empty rows and columns, keeping row_boxes and an optional
    per-cell confidence matrix aligned. Returns (rows, row_boxes, conf)."""
    keep = [i for i, r in enumerate(rows) if any(cell for cell in r)]
    rows = [rows[i] for i in keep]
    row_boxes = [row_boxes[i] for i in keep]
    if conf is not None:
        conf = [conf[i] for i in keep]

    if rows:
        n = max(len(r) for r in rows)
        rows = [r + [""] * (n - len(r)) for r in rows]
        if conf is not None:
            conf = [c + [0] * (n - len(c)) for c in conf]
        keep_cols = [j for j in range(n) if any(r[j] for r in rows)]
        rows = [[r[j] for j in keep_cols] for r in rows]
        if conf is not None:
            conf = [[c[j] for j in keep_cols] for c in conf]
    return rows, row_boxes, conf


def _ocr_fill_grid(page, row_edges, col_edges, x0, y0, x1, y1, pw, ph):
    """Build table rows from OCR words assigned to the vector lattice, oriented
    for VISIBLE reading order (doors as rows) regardless of page rotation.

    The lattice (row_edges × col_edges) is in unrotated space. On a rotated
    sheet (e.g. /Rotate 270 landscape plots) the unrotated rows are the
    schedule's visual columns, so we re-index every cell by its VISIBLE center
    (unrotated center × rotation_matrix). Each output row also carries its
    UNROTATED bounding box (normalized) so the app can place count markers in
    the coordinate space it uses — visible reading, unrotated placement.

    Returns (rows, row_boxes, cell_confidence) or None if OCR read nothing.
    row_boxes entries are {x0, y0, x1, y1} normalized (unrotated).
    """
    ocr_words = _ocr_words(page, x0, y0, x1, y1)
    if not ocr_words:
        return None

    n_rows = len(row_edges) - 1
    n_cols = len(col_edges) - 1
    cells: list[list[list[tuple[float, str, float]]]] = [
        [[] for _ in range(n_cols)] for _ in range(n_rows)
    ]
    for (wx0, wy0, wx1, wy1, text, conf) in ocr_words:
        cx = (wx0 + wx1) / 2
        cy = (wy0 + wy1) / 2
        ri = next((i for i in range(n_rows) if row_edges[i] <= cy <= row_edges[i + 1]), None)
        ci = next((j for j in range(n_cols) if col_edges[j] <= cx <= col_edges[j + 1]), None)
        if ri is not None and ci is not None:
            cells[ri][ci].append((wx0, text, conf))

    rot_matrix = page.rotation_matrix  # unrotated -> visible

    # Project every lattice cell to its visible center; cluster those into the
    # visible row/column bands so output reads the way a person sees the sheet.
    infos = []  # (vis_y, vis_x, unrot_box, text, conf)
    for i in range(n_rows):
        uy0, uy1 = row_edges[i], row_edges[i + 1]
        for j in range(n_cols):
            ux0, ux1 = col_edges[j], col_edges[j + 1]
            vc = fitz.Point((ux0 + ux1) / 2, (uy0 + uy1) / 2) * rot_matrix
            toks = sorted(cells[i][j], key=lambda t: t[0])
            text = " ".join(t for _, t, _ in toks)
            # Cell confidence = weakest token (min): one shaky glyph flags the cell.
            conf = round(min((c for _, _, c in toks), default=0))
            infos.append((vc.y, vc.x, (ux0, uy0, ux1, uy1), text, conf))

    row_centers = _cluster(sorted(inf[0] for inf in infos), CLUSTER_TOL_PT)
    col_centers = _cluster(sorted(inf[1] for inf in infos), CLUSTER_TOL_PT)

    def nearest(values: list[float], v: float) -> int:
        return min(range(len(values)), key=lambda k: abs(values[k] - v))

    v_rows = len(row_centers)
    v_cols = len(col_centers)
    rows = [["" for _ in range(v_cols)] for _ in range(v_rows)]
    conf_matrix = [[0 for _ in range(v_cols)] for _ in range(v_rows)]
    # Per visible row: accumulate the unrotated extent for marker placement.
    extent = [[float("inf"), float("inf"), float("-inf"), float("-inf")] for _ in range(v_rows)]

    for (vy, vx, (bx0, by0, bx1, by1), text, conf) in infos:
        r = nearest(row_centers, vy)
        c = nearest(col_centers, vx)
        if text:
            rows[r][c] = f"{rows[r][c]} {text}".strip() if rows[r][c] else text
            conf_matrix[r][c] = conf if conf_matrix[r][c] == 0 else min(conf_matrix[r][c], conf)
        e = extent[r]
        e[0], e[1] = min(e[0], bx0), min(e[1], by0)
        e[2], e[3] = max(e[2], bx1), max(e[3], by1)

    row_boxes = [
        {
            "x0": extent[r][0] / pw, "y0": extent[r][1] / ph,
            "x1": extent[r][2] / pw, "y1": extent[r][3] / ph,
        }
        for r in range(v_rows)
    ]
    return _drop_empty(rows, row_boxes, conf_matrix)


def extract_table(
    pdf_path: str,
    page_number: int,
    nx0: float,
    ny0: float,
    nx1: float,
    ny1: float,
    ocr: bool = False,
) -> dict:
    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:  # noqa: BLE001
        return {"success": False, "error": f"Failed to open PDF: {exc}"}

    try:
        if page_number < 1 or page_number > len(doc):
            return {"success": False, "error": f"Page {page_number} out of range"}
        page = doc[page_number - 1]

        # The client's region is normalized in UNROTATED (rotation-0) page
        # space — the same convention PDF.js uses for markups. PyMuPDF's
        # get_text/get_drawings coordinates are ALREADY in unrotated space
        # (verified empirically against /Rotate 90 pages), but page.rect is the
        # ROTATED visible box — so only the normalization dims need the swap.
        rotation = int(getattr(page, "rotation", 0) or 0) % 360
        rect = page.rect
        if rotation in (90, 270):
            pw = float(rect.height) or 1.0
            ph = float(rect.width) or 1.0
        else:
            pw = float(rect.width) or 1.0
            ph = float(rect.height) or 1.0
        x0, y0, x1, y1 = nx0 * pw, ny0 * ph, nx1 * pw, ny1 * ph

        all_words = [
            w for w in (page.get_text("words") or [])
            if len(w) >= 5 and str(w[4]).strip()
        ]
        words = [
            w for w in all_words
            if x0 <= (w[0] + w[2]) / 2 <= x1 and y0 <= (w[1] + w[3]) / 2 <= y1
        ]
        print(
            f"[table-extract] page {page_number}: rotation={rotation}, "
            f"{len(all_words)} words on page, {len(words)} in region "
            f"({nx0:.3f},{ny0:.3f})-({nx1:.3f},{ny1:.3f})",
            file=sys.stderr,
            flush=True,
        )
        if not words:
            hint = (
                "no vector text on this page (scanned sheet?)"
                if not all_words
                else "the box missed the text — try boxing the schedule again"
            )
            return {"success": False, "error": f"No text found in the boxed region ({hint})"}

        horizontals, verticals = _segments_in_region(page, x0, y0, x1, y1)
        row_bounds = _cluster([h[0] for h in horizontals], CLUSTER_TOL_PT)
        col_bounds = _cluster([v[0] for v in verticals], CLUSTER_TOL_PT)

        mode = "ruled" if len(row_bounds) >= 3 and len(col_bounds) >= 2 else "clustered"

        if mode == "ruled":
            row_edges = row_bounds
            col_edges = col_bounds
            # Ensure region edges act as outer boundaries if the drawn grid
            # doesn't include them (common: no outer border on one side).
            if row_edges[0] - y0 > 4:
                row_edges = [y0] + row_edges
            if y1 - row_edges[-1] > 4:
                row_edges = row_edges + [y1]
            if col_edges[0] - x0 > 4:
                col_edges = [x0] + col_edges
            if x1 - col_edges[-1] > 4:
                col_edges = col_edges + [x1]

            n_rows = len(row_edges) - 1
            n_cols = len(col_edges) - 1
            grid: list[list[list[tuple[float, str]]]] = [
                [[] for _ in range(n_cols)] for _ in range(n_rows)
            ]
            for w in words:
                cx = (w[0] + w[2]) / 2
                cy = (w[1] + w[3]) / 2
                ri = next((i for i in range(n_rows) if row_edges[i] <= cy <= row_edges[i + 1]), None)
                ci = next((j for j in range(n_cols) if col_edges[j] <= cx <= col_edges[j + 1]), None)
                if ri is not None and ci is not None:
                    grid[ri][ci].append((w[0], str(w[4]).strip()))
            rows = [
                [" ".join(t for _, t in sorted(cell)) for cell in row]
                for row in grid
            ]
            row_boxes = [
                {"y0": row_edges[i] / ph, "y1": row_edges[i + 1] / ph}
                for i in range(n_rows)
            ]
        else:
            heights = sorted(abs(w[3] - w[1]) for w in words)
            median_h = heights[len(heights) // 2] or 6.0
            row_centers = _cluster(
                [(w[1] + w[3]) / 2 for w in words], median_h * WORD_ROW_TOL_FACTOR
            )
            col_starts = _cluster([w[0] for w in words], COL_TOL_PT)

            def nearest(values: list[float], v: float) -> int:
                return min(range(len(values)), key=lambda i: abs(values[i] - v))

            n_rows = len(row_centers)
            n_cols = len(col_starts)
            grid = [[[] for _ in range(n_cols)] for _ in range(n_rows)]
            for w in words:
                ri = nearest(row_centers, (w[1] + w[3]) / 2)
                ci = nearest(col_starts, w[0])
                # Keep word end for the column-merge pass below.
                grid[ri][ci].append((w[0], str(w[4]).strip(), w[2]))

            # Multi-word cells split into fake columns when word x-starts align
            # across rows ("FIXTURE" | "A"). Merge adjacent column clusters whose
            # typical horizontal gap is word-spacing sized, not column sized.
            def merge_gap(j: int) -> float | None:
                gaps = []
                for ri2 in range(n_rows):
                    left = grid[ri2][j]
                    right = grid[ri2][j + 1]
                    if left and right:
                        gaps.append(min(x for x, _, _ in right) - max(e for _, _, e in left))
                if not gaps:
                    return None
                gaps.sort()
                return gaps[len(gaps) // 2]

            j = 0
            while j < n_cols - 1:
                gap = merge_gap(j)
                if gap is not None and gap < median_h * 1.1:
                    for ri2 in range(n_rows):
                        grid[ri2][j].extend(grid[ri2][j + 1])
                        grid[ri2][j + 1] = []
                    del col_starts[j + 1]
                    for ri2 in range(n_rows):
                        del grid[ri2][j + 1]
                    n_cols -= 1
                else:
                    j += 1

            rows = [
                [" ".join(t for _, t, _ in sorted(cell)) for cell in row]
                for row in grid
            ]
            half = median_h * 0.75
            row_boxes = [
                {"y0": max(y0, c - half) / ph, "y1": min(y1, c + half) / ph}
                for c in row_centers
            ]

        # Outlined-body guard: some CAD exports convert the schedule's data
        # cells to vector outlines (curves), leaving only header labels and
        # titleblock text extractable. The grid is real but nearly every data
        # cell is empty — deterministic vector extraction cannot read it, and
        # proceeding would emit garbage rows. Detect a real grid whose interior
        # is mostly empty and fail with a precise, actionable hint instead.
        if mode == "ruled" and n_rows >= 6 and n_cols >= 3:
            data_cells = n_rows * n_cols
            filled_cells = sum(
                1 for row in grid for cell in row if cell
            )
            if data_cells > 0 and filled_cells / data_cells < 0.12:
                # The lattice (row_edges × col_edges) is real and fully known —
                # only the glyphs are missing. If OCR is enabled, read the cells
                # with a single Tesseract pass over the region; otherwise report
                # the condition precisely so the caller can guide the user.
                if ocr:
                    ocr_result = _ocr_fill_grid(
                        page, row_edges, col_edges, x0, y0, x1, y1, pw, ph
                    )
                    if ocr_result is not None:
                        ocr_rows, ocr_boxes, ocr_conf = ocr_result
                        if ocr_rows:
                            return {
                                "success": True,
                                "mode": "ruled_ocr",
                                "rows": ocr_rows,
                                "rowBoxes": ocr_boxes,
                                "cellConfidence": ocr_conf,
                                "region": {"x0": nx0, "y0": ny0, "x1": nx1, "y1": ny1},
                            }
                return {
                    "success": False,
                    "error": (
                        "The schedule grid was found, but its cells have no selectable "
                        "text — the body appears to be outlined/flattened to graphics by "
                        "the CAD export. Vector extraction can't read it; this schedule "
                        "needs OCR."
                    ),
                    "reason": "outlined_body",
                    "gridRows": n_rows,
                    "gridCols": n_cols,
                    "filledCells": filled_cells,
                }

        rows, row_boxes, _ = _drop_empty(rows, row_boxes)

        return {
            "success": True,
            "mode": mode,
            "rows": rows,
            "rowBoxes": row_boxes,
            "region": {"x0": nx0, "y0": ny0, "x1": nx1, "y1": ny1},
        }
    finally:
        try:
            doc.close()
        except Exception:  # noqa: BLE001
            pass


def main() -> None:
    if len(sys.argv) < 7:
        print(json.dumps({"success": False, "error": "Usage: table_extract.py <pdf> <page> <x0> <y0> <x1> <y1>"}))
        sys.exit(1)
    ocr = len(sys.argv) > 7 and str(sys.argv[7]).strip().lower() == "ocr"
    result = extract_table(
        sys.argv[1],
        int(sys.argv[2]),
        float(sys.argv[3]),
        float(sys.argv[4]),
        float(sys.argv[5]),
        float(sys.argv[6]),
        ocr,
    )
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
