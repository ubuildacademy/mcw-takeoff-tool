#!/usr/bin/env python3
"""
Region-targeted bubble OCR pass for Auto-hyperlink.

Most architectural PDFs draw their round detail-callout bubbles as vector
paths (stroked line segments forming the glyphs), which means PDF.js *and*
MuPDF both miss the text inside them. Running full-page Tesseract recovers
that text but is far too slow to use interactively (15+ min for an 80-page
sheet set).

Bluebeam's Batch Link works around this by detecting the bubble shapes first
and OCRing each small crop in isolation. This script does the same:

    For each page (PARALLELIZED across worker processes):
        render -> HoughCircles -> for each circle:
            crop (asymmetric, extra below the center) + upscale + binarize ->
            Tesseract --psm 6 (multi-line block for split-pill callouts) ->
            keep only crops whose OCR matches a sheet-ref regex

The result is per-page word boxes (normalized 0..1 bboxes) that downstream
code merges into the document's stored OCR rows under `source: 'bubble_ocr'`.

Progress: every page prints `[bubble-ocr] page N/M: K circles → P matches
(elapsed Xs)` to stderr (line-buffered, with flush). The TS wrapper pipes
stderr live into the server log so we can see throughput as it happens.

Usage:
    python3 bubble_ocr_pass.py <pdf_path>

Output (stdout, JSON):
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


# Render scale: 1.5x the PDF's intrinsic point space gives us ~108 DPI on
# letter-size pages and ~5400 px wide on a 24x36 plan -- still plenty of
# resolution for Tesseract to read 0.35-0.65" callout bubbles, while cutting
# pixel count ~44% vs the previous 2.0 setting. That ~44% directly translates
# to OCR throughput.
RENDER_SCALE = 1.5

# Sheet ref shapes accepted in OCR text. Mirrors the regexes used by
# detectSheetRefsFromWordBoxes.ts on the client. We only need to *validate*
# that OCR'd text looks like a sheet ref -- the detection layer will run its
# own regex anyway, so this is a permissive accept filter.
SHEET_REF_PATTERNS = [
    re.compile(r"\b\d{1,3}\s*/\s*[A-Z]{1,3}\d{1,2}(?:\.\d{1,2})?\b", re.IGNORECASE),
    # Split-pill OCR often reads "15 A9.22" or "23 A9.81" (space / newline, no slash).
    re.compile(r"\b\d{1,3}\s+[A-Z]{1,3}\d{1,2}(?:\.\d{1,2})?\b", re.IGNORECASE),
    re.compile(r"\b[A-Z]{1,3}\d{1,2}\.\d{1,2}\b", re.IGNORECASE),
    re.compile(r"\b[A-Z]{1,3}-\d{2,3}\b", re.IGNORECASE),
]
# No-dot `[A-Z]{1,3}\d{3}`: matches title-block / volume junk (V786, KLW786). Bubble pass only —
# keep accept filter in sync with `passesLooseNoiseGate` in detectSheetRefsFromWordBoxes.ts.
NO_DOT_SHEET_REF = re.compile(r"\b([A-Z]{1,3}\d{3})\b", re.IGNORECASE)
_NO_DOT_NOISE_VW = re.compile(r"^[VW]\d{3}$")
_NO_DOT_NOISE_AAA = re.compile(r"^[A-Z]{3}\d{3}$")

# Tesseract config:
#   --psm 6  : uniform text block — split-circle / "pill" callouts have two lines
#              (detail# on top, sheet# below a divider). PSM 7 returns empty on those.
#   tessedit_char_whitelist : architectural sheet refs only use A-Z 0-9 ./-
TESS_CONFIG = (
    "--oem 3 --psm 6 "
    "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./-"
)


def _looks_like_sheet_ref(text: str) -> bool:
    if not text:
        return False
    upper = text.upper()
    if any(p.search(upper) for p in SHEET_REF_PATTERNS):
        return True
    m = NO_DOT_SHEET_REF.search(upper)
    if not m:
        return False
    cand = m.group(1).upper()
    if _NO_DOT_NOISE_VW.match(cand) or _NO_DOT_NOISE_AAA.match(cand):
        return False
    return True


def _clamp01(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def _render_page_bgr(page: "fitz.Page") -> np.ndarray:
    """Render a PyMuPDF page to a BGR numpy array (OpenCV's native layout)."""
    mat = fitz.Matrix(RENDER_SCALE, RENDER_SCALE)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    # pix.samples is an RGB byte buffer of size width*height*3
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _detect_circles(gray: np.ndarray):
    """
    Run HoughCircles tuned for callout bubble sizes.

    Callout bubbles on architectural sheets are typically 0.35-0.65 inches in
    diameter. At our 1.5x PDF-point render that's ~38-71 px diameter -> ~19-36
    px radius. We widen modestly on both sides for scale variation between
    8.5x11 cover sheets and 24x36 plan sheets:
        minRadius=14, maxRadius=55

    HoughCircles parameter notes (param2 is the accumulator threshold; lower
    = more detections + more false positives; we filter via OCR anyway, but
    every false positive costs an OCR call so keep param2 conservative).
    `minDist` higher than radius prevents lots of overlapping detections on
    the same bubble outline (Hough quirk on crisp vectors).

        dp=1.2, minDist=45, param1=120, param2=45
    """
    return cv2.HoughCircles(
        gray,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=45,
        param1=120,
        param2=45,
        minRadius=14,
        maxRadius=55,
    )


def _crop_has_interior_text(crop: np.ndarray, min_interior_dark: float = 0.06) -> bool:
    """
    Cheap pre-OCR filter: does the bubble crop contain meaningful interior
    content (text-like dark pixels in the center, not just an outline)?

    HoughCircles routinely fires on circular gradients that have nothing
    inside them -- dimension arrowheads, hatch patterns, faint architectural
    details. Tesseract on those takes the same ~50-80 ms as a real bubble
    crop and returns nothing useful. By rejecting interior-empty crops in
    pure numpy (microseconds, no subprocess), we keep the actual OCR queue
    short.

    We check only the inner ~60% of the crop so the bubble's own circular
    OUTLINE doesn't count as "interior content".
    """
    if crop.size == 0:
        return False
    if crop.ndim == 3:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    else:
        gray = crop
    h, w = gray.shape[:2]
    if h < 6 or w < 6:
        return False
    cy_lo = int(h * 0.20)
    cy_hi = int(h * 0.80)
    cx_lo = int(w * 0.20)
    cx_hi = int(w * 0.80)
    interior = gray[cy_lo:cy_hi, cx_lo:cx_hi]
    if interior.size == 0:
        return False
    dark_fraction = float((interior < 200).mean())
    return dark_fraction >= min_interior_dark


def _prepare_crop_for_ocr(crop: np.ndarray) -> np.ndarray:
    """Upscale + binarize a bubble crop so Tesseract has more pixels to chew on."""
    if crop.size == 0:
        return crop
    # Convert to grayscale if not already.
    if crop.ndim == 3:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    else:
        gray = crop
    # Upscale 2x for thin strokes.
    h, w = gray.shape[:2]
    gray = cv2.resize(gray, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
    # Otsu binarization handles varying contrast on aged scans + crisp vectors.
    _, binarized = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Tesseract prefers dark text on light background; flip if needed.
    if np.mean(binarized) < 127:
        binarized = cv2.bitwise_not(binarized)
    return binarized


def _ocr_circle(crop: np.ndarray) -> Tuple[str, float]:
    """
    Run Tesseract on a single bubble crop. Returns (cleaned_text, confidence).

    Uses `image_to_string` (not `image_to_data`) because it's noticeably
    faster: `image_to_data` builds a full per-word TSV with bboxes that we
    discard anyway. With 1000+ crops per page and a 6-process pool, the
    savings add up. We pay the price of having no per-word confidence -- we
    return 0.0 as a placeholder; the detection regex is the real accuracy
    gate downstream.

    PSM 6 (block) is required for two-line split-pill bubbles; PSM 7 often
    reads nothing when a horizontal divider splits the glyph stack.
    """
    if crop.size == 0:
        return "", 0.0
    prepped = _prepare_crop_for_ocr(crop)
    try:
        text = pytesseract.image_to_string(prepped, config=TESS_CONFIG)
    except Exception:
        return "", 0.0
    cleaned = " ".join(text.split()).strip()
    if not cleaned:
        return "", 0.0
    return cleaned, 0.0


def _process_single_page(page: "fitz.Page", page_index: int) -> Dict[str, Any]:
    """
    Run bubble detection + OCR for one page. Returns the page payload dict
    in the same shape the script's JSON output expects.

    Defined at module level (rather than nested) so worker processes can
    reach it after `spawn`-style import.
    """
    rect = page.rect
    page_width_pts = float(rect.width) or 1.0
    page_height_pts = float(rect.height) or 1.0

    image_bgr = _render_page_bgr(page)
    img_h, img_w = image_bgr.shape[:2]
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    # Light Gaussian blur stabilizes Hough on noisy scans without losing the
    # thin strokes that real bubbles have.
    gray_blurred = cv2.GaussianBlur(gray, (5, 5), 1.2)

    circles = _detect_circles(gray_blurred)
    circles_count = 0 if circles is None else int(circles.shape[1])
    blank_skipped = 0
    ocr_attempted = 0
    bubbles: List[Dict[str, Any]] = []
    if circles is not None:
        circles = np.round(circles[0, :]).astype(int)
        for cx, cy, r in circles:
            # Asymmetric crop: many refs are "split pill" / two-line callouts where
            # Hough sees the upper arc as a circle but the sheet ID sits *below*
            # a horizontal divider — a tight square crop misses it entirely.
            pad_side = int(r * 0.18) + 2
            pad_top = int(r * 0.22) + 2
            pad_bottom = int(r * 0.92) + 4
            x0 = max(0, cx - r - pad_side)
            y0 = max(0, cy - r - pad_top)
            x1 = min(img_w, cx + r + pad_side)
            y1 = min(img_h, cy + r + pad_bottom)
            if x1 <= x0 or y1 <= y0:
                continue
            crop = image_bgr[y0:y1, x0:x1]
            # Cheap pre-OCR filter: must have at least a few percent of dark
            # pixels in the CENTER (interior text), not just an outline. This
            # skips Hough's many false positives on hatch patterns, dimension
            # marks, and gradient artifacts without ever spawning Tesseract.
            if not _crop_has_interior_text(crop):
                blank_skipped += 1
                continue
            ocr_attempted += 1
            text, confidence = _ocr_circle(crop)
            if not _looks_like_sheet_ref(text):
                continue

            # Hotspot: the actual OCR crop (includes sheet line below the divider).
            bubbles.append(
                {
                    "text": text.upper(),
                    "x": _clamp01(x0 / img_w),
                    "y": _clamp01(y0 / img_h),
                    "width": _clamp01((x1 - x0) / img_w),
                    "height": _clamp01((y1 - y0) / img_h),
                    "confidence": round(confidence, 1),
                }
            )

    return {
        "pageNumber": page_index + 1,
        "width": page_width_pts,
        "height": page_height_pts,
        "bubbles": bubbles,
        "_circles_count": circles_count,
        "_blank_skipped": blank_skipped,
        "_ocr_attempted": ocr_attempted,
    }


def _process_page_worker(args: Tuple[str, int, int]) -> Dict[str, Any]:
    """
    Multiprocessing worker entry point: opens its own copy of the PDF,
    processes ONE page, and returns the page payload (with a `_elapsed_s`
    timing key + the `_circles_count` returned by `_process_single_page`).

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
            "_circles_count": 0,
        }

    elapsed = time.time() - start
    result["_elapsed_s"] = elapsed
    circles_count = result.pop("_circles_count", 0)
    blank_skipped = result.pop("_blank_skipped", 0)
    ocr_attempted = result.pop("_ocr_attempted", 0)
    sample_texts = ", ".join(repr(b["text"]) for b in result["bubbles"][:3])
    sample_suffix = f" (e.g. {sample_texts})" if sample_texts else ""
    print(
        f"[bubble-ocr] page {page_index + 1}/{total_pages}: "
        f"{circles_count} circles ({blank_skipped} blank-skipped, {ocr_attempted} ocr'd) "
        f"\u2192 {len(result['bubbles'])} matches "
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

    # Cap at 6 workers to keep memory bounded on a Mac laptop. The largest
    # consumer is the rendered page image (~6048x4320x3 ≈ 75 MB at scale 2.0,
    # ~45 MB at 1.5). 6 workers x ~250 MB peak = ~1.5 GB which is fine.
    cpu = os.cpu_count() or 2
    pool_size = max(1, min(6, cpu - 1))

    overall_start = time.time()
    print(
        f"[bubble-ocr] starting: {total_pages} pages, "
        f"{pool_size} worker process(es), render_scale={RENDER_SCALE}",
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
        p.pop("_circles_count", None)
        p.pop("_blank_skipped", None)
        p.pop("_ocr_attempted", None)

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
