#!/usr/bin/env python3
"""
Precision-targeted bubble OCR pass for Auto-hyperlink.

Most architectural PDFs draw their round detail-callout bubbles as vector
paths (stroked line segments forming the glyphs), which means PDF.js *and*
MuPDF both miss the text inside them. Running full-page Tesseract recovers
that text but is far too slow to use interactively.

This script no longer runs an independent HoughCircles scan against a
full-page raster (that approach found 95 circles on a real "Details" sheet
and produced 6/6 false positives -- see docs/IMPLEMENTATION_PLAN.md
Workstream F scoping notes). Instead it reuses vector_callout_pass.py's
geometry-qualified circle/hexagon candidates (via callout_geometry.py) as OCR
crop targets:

    For each page:
        shape_candidates() -> circle/hexagon paths in callout size/aspect band
        skip candidates already resolved via the PDF text layer (their
            detail label / sheet ref already parses from get_text("words"))
        for each remaining ("unlabeled", vector-glyph-only) candidate:
            render JUST that bubble's bbox (padded) at high resolution ->
            upscale + binarize -> Tesseract --psm 6 ->
            structural accept: OCR text must decompose into exactly a top
                token (detail label) and a bottom token (sheet ref matching
                the strict pattern), nothing else -- rejects prose substring
                matches like "FRAMED HEADBOAR GR-216"

Pages are still parallelized across worker processes for throughput, but the
per-page work is now "OCR ~10-40 precise crops" instead of "raster the whole
page and Hough-scan it", which is both faster and far more precise.

Progress: every page prints `[bubble-ocr] page N/M: K candidates -> P ocr'd
-> Q matches (elapsed Xs)` to stderr (line-buffered, with flush).

Usage:
    python3 bubble_ocr_pass.py <pdf_path>

Output (stdout, JSON) -- unchanged shape from the previous implementation:
    {
      "success": true,
      "totalPages": N,
      "calloutsFound": K,
      "pages": [
        {
          "pageNumber": 1,
          "width": <points>,
          "height": <points>,
          "bubbles": [
            { "text": "A9.22", "x": 0.62, "y": 0.41, "width": 0.04, "height": 0.04, "confidence": 92 },
            ...
          ]
        },
        ...
      ]
    }

On failure: { "success": false, "error": "..." } and non-zero exit.
"""

import json
import multiprocessing as mp
import os
import re
import sys
import time
from typing import Any, Dict, List, Tuple

import cv2
import fitz  # PyMuPDF
import numpy as np
import pytesseract

from callout_geometry import (
    DETAIL_LABEL_RE,
    SHEET_REF_RE,
    classify_from_words,
    rotated_clip,
    shape_candidates,
    word_in_shape,
)

# Render just the candidate's own TIGHT geometry bbox (no outward padding) at
# this many pixels per PDF point. Affordable because there are only ~10-40
# "unlabeled" candidates per page, not a full-page raster -- and it's why
# Tesseract actually has signal on a ~20pt bubble now, versus the old fixed
# full-page RENDER_SCALE=1.5.
#
# No outward padding is deliberate: padding out from the bbox pulls in
# whatever sits just outside it, and compound "flag"/pointer callouts (circle
# + an adjacent solid triangle, common for interior-elevation direction
# indicators) often have that triangle drawn as a SEPARATE path touching the
# circle's edge. Cropping to the tight bbox excludes it automatically, since
# it's a different path with its own (non-overlapping) rect.
CROP_SCALE = 14.0
# Even with a tight bbox, the shape's OWN outline stroke (the circle/hexagon
# arc itself) sits right at the crop edges and confuses Tesseract's line
# segmentation badly -- empirically, leaving the arc in produces near-100%
# garbage reads even on trivially clean "04"-style text, because the LSTM
# model merges the arc into character shapes. Insetting inward by this
# fraction on every side crops the arc out, leaving just the interior top/
# bottom text. Tuned empirically against the F1 ground truth fixture
# (fixtures/f1_bubble_ground_truth.json): 0.14 was the best-performing inset
# in a 0.10-0.20 sweep.
INSET_FRACTION = 0.14

# Tesseract config:
#   --oem 3 --psm 6 : uniform text block -- split-circle / "pill" callouts
#              have two lines (detail# on top, sheet# below a divider).
#   tessedit_char_whitelist : architectural sheet refs only use A-Z 0-9 ./-
TESS_CONFIG = (
    "--oem 3 --psm 6 "
    "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./-"
)

# Common digit/letter OCR confusions on this CAD glyph style, applied only to
# the numeric portion of an already-plausible sheet ref (after its leading
# letter prefix) -- e.g. "A6.OZ" -> "A6.02", "A9.0E" -> "A9.06" would NOT be
# fixed (E isn't in this map; kept deliberately small/conservative so we
# don't paper over genuine misreads with a blanket substitution).
_DIGIT_LOOKALIKES = {"O": "0", "Z": "2", "S": "5", "B": "8"}
_SHEET_REF_PREFIX_RE = re.compile(r"^([A-Z]{1,3})(-?)(.*)$")


def _clamp01(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def _render_bubble_crop_gray(page: "fitz.Page", shape: dict) -> np.ndarray:
    """Render one candidate's TIGHT bbox at CROP_SCALE, as grayscale."""
    x0, y0, x1, y1 = shape["x0"], shape["y0"], shape["x1"], shape["y1"]
    clip = rotated_clip(page, x0, y0, x1, y1)
    mat = fitz.Matrix(CROP_SCALE, CROP_SCALE)
    pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
    if pix.width == 0 or pix.height == 0:
        return np.zeros((1, 1), dtype=np.uint8)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)


def _inset_for_ocr(gray: np.ndarray) -> np.ndarray:
    """Crop inward by INSET_FRACTION to drop the bubble's own outline stroke."""
    h, w = gray.shape[:2]
    if h < 6 or w < 6:
        return gray
    x0, x1 = int(w * INSET_FRACTION), int(w * (1 - INSET_FRACTION))
    y0, y1 = int(h * INSET_FRACTION), int(h * (1 - INSET_FRACTION))
    if x1 <= x0 or y1 <= y0:
        return gray
    return gray[y0:y1, x0:x1]


def _ocr_crop(gray: np.ndarray) -> Tuple[str, float]:
    """Run Tesseract on a single (already inset) bubble crop. Returns
    (raw_text, mean_confidence)."""
    if gray.size == 0:
        return "", 0.0
    try:
        data = pytesseract.image_to_data(
            gray, config=TESS_CONFIG, output_type=pytesseract.Output.DICT
        )
    except Exception:
        return "", 0.0
    confs = [float(c) for c in data.get("conf", []) if c not in ("-1", -1)]
    mean_conf = sum(confs) / len(confs) if confs else 0.0
    # Rebuild text with line breaks preserved (image_to_data gives per-word
    # rows; join words on the same line, newline between line_num changes) so
    # the structural top/bottom split below has real line boundaries to work
    # with, same as image_to_string's --psm 6 output would have given us.
    rows = list(zip(data.get("line_num", []), data.get("text", [])))
    lines: Dict[int, List[str]] = {}
    for line_num, word in rows:
        word = (word or "").strip()
        if not word:
            continue
        lines.setdefault(line_num, []).append(word)
    text = "\n".join(" ".join(words) for _, words in sorted(lines.items()))
    return text, mean_conf


def _normalize_sheet_ref(token: str) -> str:
    """Fix common digit/letter OCR confusions in the numeric part of a
    plausible sheet ref, e.g. "A6.OZ" -> "A6.02". Leaves the leading letter
    prefix untouched (those are real letters, not digit misreads)."""
    m = _SHEET_REF_PREFIX_RE.match(token)
    if not m:
        return token
    prefix, dash, rest = m.groups()
    rest = "".join(_DIGIT_LOOKALIKES.get(ch, ch) for ch in rest)
    return prefix + dash + rest


def _structural_parse(text: str) -> Tuple[str | None, str | None]:
    """Decompose OCR text into (detailLabel, sheetRef), or (None, None).

    Structural accept: the crop must OCR to exactly two single-token lines --
    a top detail label and a bottom sheet ref matching the strict pattern.
    This is what rejects prose substring matches like "FRAMED HEADBOAR
    GR-216" (today's bug in the old permissive substring-anywhere accept):
    that OCR output has 2 words on one line and doesn't decompose into a
    clean top/bottom pair at all.
    """
    lines = [ln.strip(" .,-") for ln in text.splitlines() if ln.strip()]
    if len(lines) == 1:
        # Some split-pill crops OCR onto a single line ("15 A9.22") rather
        # than two -- accept exactly-two-token single lines too.
        parts = lines[0].split()
        if len(parts) == 2:
            lines = [p.strip(" .,-") for p in parts]
    if len(lines) != 2:
        return None, None

    top, bottom = lines[0], lines[1]
    if not top or not bottom:
        return None, None
    if len(top.split()) != 1 or len(bottom.split()) != 1:
        return None, None

    top = top.upper()
    bottom = _normalize_sheet_ref(bottom.upper())
    if not DETAIL_LABEL_RE.match(top):
        return None, None
    if not SHEET_REF_RE.match(bottom) or not any(ch.isdigit() for ch in bottom):
        return None, None
    return top, bottom


def _process_single_page(page: "fitz.Page", page_index: int) -> Dict[str, Any]:
    """
    Run geometry-candidate detection + targeted OCR for one page. Returns the
    page payload dict in the same shape the script's JSON output expects.

    Defined at module level (rather than nested) so worker processes can
    reach it after `spawn`-style import.
    """
    rect = page.rect
    rotation = int(getattr(page, "rotation", 0) or 0) % 360
    if rotation in (90, 270):
        page_width_pts = float(rect.height) or 1.0
        page_height_pts = float(rect.width) or 1.0
    else:
        page_width_pts = float(rect.width) or 1.0
        page_height_pts = float(rect.height) or 1.0

    words = page.get_text("words") or []
    shapes = shape_candidates(page)

    candidates_count = len(shapes)
    already_resolved = 0
    ocr_attempted = 0
    structural_rejects = 0
    bubbles: List[Dict[str, Any]] = []

    for shape in shapes:
        inside = [w for w in words if len(w) >= 5 and word_in_shape(w, shape)]
        detail_label, sheet_ref = classify_from_words(shape, inside)
        if detail_label is not None or sheet_ref is not None:
            # Already resolved via the text layer (includes short alpha-only
            # equipment tags like "SD"/"HS"/"J") -- don't re-OCR it.
            already_resolved += 1
            continue

        gray = _render_bubble_crop_gray(page, shape)
        inset = _inset_for_ocr(gray)
        ocr_attempted += 1
        raw_text, confidence = _ocr_crop(inset)
        top, bottom = _structural_parse(raw_text)
        if top is None or bottom is None:
            structural_rejects += 1
            continue

        x0, y0, x1, y1 = shape["x0"], shape["y0"], shape["x1"], shape["y1"]
        bubbles.append(
            {
                "text": f"{top} {bottom}",
                "x": _clamp01(x0 / page_width_pts),
                "y": _clamp01(y0 / page_height_pts),
                "width": _clamp01((x1 - x0) / page_width_pts),
                "height": _clamp01((y1 - y0) / page_height_pts),
                "confidence": round(confidence, 1),
            }
        )

    return {
        "pageNumber": page_index + 1,
        "width": page_width_pts,
        "height": page_height_pts,
        "bubbles": bubbles,
        "_candidates_count": candidates_count,
        "_already_resolved": already_resolved,
        "_ocr_attempted": ocr_attempted,
        "_structural_rejects": structural_rejects,
    }


def _process_page_worker(args: Tuple[str, int, int]) -> Dict[str, Any]:
    """
    Multiprocessing worker entry point: opens its own copy of the PDF,
    processes ONE page, and returns the page payload (with a `_elapsed_s`
    timing key + the internal counters returned by `_process_single_page`).

    Every worker emits a single `[bubble-ocr] page N/M` line to stderr when
    its page finishes so the TS wrapper can stream live progress to the
    server log.
    """
    pdf_path, page_index, total_pages = args
    start = time.time()
    try:
        doc = fitz.open(pdf_path)
        try:
            page = doc[page_index]
            result = _process_single_page(page, page_index)
        finally:
            try:
                doc.close()
            except Exception:  # noqa: BLE001
                pass
    except Exception as exc:  # noqa: BLE001
        elapsed = time.time() - start
        print(
            f"[bubble-ocr] page {page_index + 1}/{total_pages}: ERROR {exc} "
            f"(elapsed {elapsed:.1f}s)",
            file=sys.stderr,
            flush=True,
        )
        return {
            "pageNumber": page_index + 1,
            "width": 0,
            "height": 0,
            "bubbles": [],
            "error": str(exc),
            "_elapsed_s": elapsed,
            "_candidates_count": 0,
        }

    elapsed = time.time() - start
    result["_elapsed_s"] = elapsed
    candidates_count = result.pop("_candidates_count", 0)
    already_resolved = result.pop("_already_resolved", 0)
    ocr_attempted = result.pop("_ocr_attempted", 0)
    structural_rejects = result.pop("_structural_rejects", 0)
    sample_texts = ", ".join(repr(b["text"]) for b in result["bubbles"][:3])
    sample_suffix = f" (e.g. {sample_texts})" if sample_texts else ""
    print(
        f"[bubble-ocr] page {page_index + 1}/{total_pages}: "
        f"{candidates_count} candidates ({already_resolved} already resolved via text layer, "
        f"{ocr_attempted} ocr'd, {structural_rejects} rejected) "
        f"→ {len(result['bubbles'])} matches "
        f"(elapsed {elapsed:.1f}s)"
        f"{sample_suffix}",
        file=sys.stderr,
        flush=True,
    )
    return result


def process_pdf(pdf_path: str) -> Dict[str, Any]:
    try:
        # Open once just to count pages; workers each re-open.
        doc = fitz.open(pdf_path)
        total_pages = len(doc)
        try:
            doc.close()
        except Exception:  # noqa: BLE001
            pass
    except Exception as exc:  # noqa: BLE001
        return {"success": False, "error": f"Failed to open PDF: {exc}"}

    if total_pages == 0:
        return {"success": True, "totalPages": 0, "calloutsFound": 0, "pages": []}

    # Cap at 6 workers to keep memory bounded on a Mac laptop.
    cpu = os.cpu_count() or 2
    pool_size = max(1, min(6, cpu - 1))

    overall_start = time.time()
    print(
        f"[bubble-ocr] starting: {total_pages} pages, "
        f"{pool_size} worker process(es), crop_scale={CROP_SCALE}",
        file=sys.stderr,
        flush=True,
    )

    work_items: List[Tuple[str, int, int]] = [
        (pdf_path, i, total_pages) for i in range(total_pages)
    ]

    # `spawn` start method is required on macOS for OpenCV + multiprocessing
    # safety (`fork` deadlocks on macOS when the parent has loaded native libs
    # like libomp/libdispatch that aren't fork-safe).
    ctx = mp.get_context("spawn")
    pages_payload: List[Dict[str, Any]] = []
    try:
        if pool_size == 1:
            # Sequential fallback (helps debugging + small docs).
            for item in work_items:
                pages_payload.append(_process_page_worker(item))
        else:
            with ctx.Pool(processes=pool_size) as pool:
                # `imap` (not `map`) so we get pages in order as they complete
                # and any partial progress is at least in `pages_payload` if
                # the script is interrupted.
                for page_result in pool.imap(_process_page_worker, work_items):
                    pages_payload.append(page_result)
    except Exception as exc:  # noqa: BLE001
        print(
            f"[bubble-ocr] worker pool failed: {exc}",
            file=sys.stderr,
            flush=True,
        )
        return {"success": False, "error": f"Worker pool failed: {exc}"}

    # Strip internal counters before returning JSON (workers add these for
    # the progress log only; if a worker errored before popping them they may
    # still be present here).
    for p in pages_payload:
        p.pop("_elapsed_s", None)
        p.pop("_candidates_count", None)
        p.pop("_already_resolved", None)
        p.pop("_ocr_attempted", None)
        p.pop("_structural_rejects", None)

    total_callouts = sum(len(p.get("bubbles", [])) for p in pages_payload)
    overall_elapsed = time.time() - overall_start
    print(
        f"[bubble-ocr] done: {total_pages} pages, {total_callouts} callouts, "
        f"elapsed {overall_elapsed:.1f}s",
        file=sys.stderr,
        flush=True,
    )

    return {
        "success": True,
        "totalPages": len(pages_payload),
        "calloutsFound": total_callouts,
        "pages": pages_payload,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Usage: bubble_ocr_pass.py <pdf_path>"}))
        sys.exit(1)

    result = process_pdf(sys.argv[1])
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
