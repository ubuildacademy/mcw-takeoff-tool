#!/usr/bin/env python3
"""
Precision-targeted bubble OCR pass for Auto-hyperlink.

Most architectural PDFs draw their round detail-callout bubbles as vector
paths (stroked line segments forming the glyphs), which means PDF.js *and*
MuPDF both miss the text inside them. Running full-page Tesseract recovers
that text but is far too slow to use interactively.

This script reuses vector_callout_pass.py's geometry-qualified circle/hexagon
candidates (via callout_geometry.py) as OCR crop targets, and (since F1.5)
cross-checks every Tesseract read against a per-document glyph template
library (glyph_templates.py) built from the doc's own high-confidence glyphs:

    Phase 1 (parallel, per page):
        shape_candidates() -> circle/hexagon paths in callout size/aspect band
        skip candidates already resolved via the PDF text layer -- but harvest
            their rendered glyphs as TRUSTED template samples (the label is
            real PDF text)
        for each remaining ("unlabeled", vector-glyph-only) candidate:
            render JUST that bubble's bbox at high resolution ->
            binarize, mask off the bubble's own arc, remove divider/leader
            lines, segment into per-glyph cells (glyph_templates.preprocess_crop)
            -> Tesseract --psm 6 on the cleaned image ->
            structural accept: OCR text must decompose into exactly a top
            token (detail label) and a bottom token (sheet ref), nothing else
        ship each candidate's glyph cells + Tesseract read to the parent

    Phase 2 (parent):
        build the glyph template library from trusted text-layer samples plus
        high-confidence structurally-valid Tesseract reads (with per-class
        outlier rejection -- see glyph_templates.build_library)
        for every candidate, template-read its cells and combine:
            Tesseract and template agree        -> accept
            template decisive (every cell scores high with a clear margin)
                                                -> accept template read
            Tesseract valid, template no opinion -> accept Tesseract read
            they disagree and neither decisive   -> DROP the bubble
        The drop rule preserves F1's zero-false-positive property: a missing
        link costs a click, a wrong link costs trust.

Progress goes to stderr (line-buffered, with flush): per-page candidate
counts from the workers, then a library summary + per-page accept/drop
counts from the parent.

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
            { "text": "15 A9.22", "x": 0.62, "y": 0.41, "width": 0.04, "height": 0.04, "confidence": 92 },
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
from typing import Any, Dict, List, Optional, Tuple

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
from glyph_templates import (
    assign_chars_to_cells,
    build_library,
    preprocess_crop,
    read_row,
)

# Render just the candidate's own TIGHT geometry bbox (no outward padding) at
# this many pixels per PDF point. Affordable because there are only ~10-40
# "unlabeled" candidates per page, not a full-page raster -- and it's why
# Tesseract actually has signal on a ~20pt bubble, versus the old fixed
# full-page RENDER_SCALE=1.5.
#
# No outward padding is deliberate: padding out from the bbox pulls in
# whatever sits just outside it, and compound "flag"/pointer callouts (circle
# + an adjacent solid triangle, common for interior-elevation direction
# indicators) often have that triangle drawn as a SEPARATE path touching the
# circle's edge. Cropping to the tight bbox excludes it automatically, since
# it's a different path with its own (non-overlapping) rect.
CROP_SCALE = 14.0

# Tesseract config:
#   --oem 3 --psm 6 : uniform text block -- split-circle / "pill" callouts
#              have two lines (detail# on top, sheet# below a divider).
#   tessedit_char_whitelist : architectural sheet refs only use A-Z 0-9 ./-
TESS_CONFIG = (
    "--oem 3 --psm 6 "
    "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./-"
)

# Tesseract reads at or above this mean confidence that also parse
# structurally are harvested as (untrusted) glyph template samples.
HARVEST_MIN_CONF = 80.0

# A mean confidence of exactly 0.0 out of image_to_data means Tesseract had
# NO real per-word confidence values at all (every returned "word" was a
# confidence=-1 non-text line grouping) -- i.e. it produced a plausible-
# looking two-line structural parse purely by accident, not a read it has
# any signal behind. Observed on a real false positive: an equipment-tag
# circle ("S" in a circle, page 36 of the beta doc) whose cleaned crop
# happened to OCR as "TS\nVU2" -- a garbage read that nonetheless matched
# both the detail-label and sheet-ref regexes. Gating the Tesseract-only
# acceptance path (used when the template matcher has no opinion) on a
# nonzero confidence closes this without touching the template-agreement or
# template-decisive paths, which have their own independent evidence. Set
# well above zero (not just >0): a real doc-wide false positive found during
# full-80-page measurement -- a stray ~13pt circle in an equipment schedule,
# nowhere near a genuine callout -- OCR'd as "FR W274" at conf=15.0. The
# lowest-confidence GENUINE exact match measured on the fixture set is
# conf=30.0 ("15 A9.31"), so 20.0 sits in the gap between them with margin on
# both sides.
MIN_TESS_ONLY_CONF = 20.0

# Common digit/letter OCR confusions on this CAD glyph style, applied only to
# the numeric portion of an already-plausible sheet ref (after its leading
# letter prefix) -- e.g. "A6.OZ" -> "A6.02". Kept deliberately small and
# conservative so we don't paper over genuine misreads with a blanket
# substitution; the template matcher is what catches the rest now.
_DIGIT_LOOKALIKES = {"O": "0", "Z": "2", "S": "5", "B": "8"}
_SHEET_REF_PREFIX_RE = re.compile(r"^([A-Z]{1,3})(-?)(.*)$")


def _clamp01(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


# Center tolerance for concentric-group detection: shapes whose centers land
# within this many PDF points of each other are treated as rings of the same
# compound symbol. Reuses shape_candidates()'s own same-center tolerance
# (callout_geometry.py dedupes stroke/fill duplicates at +/-3pt).
CONCENTRIC_CENTER_TOL_PT = 3.0


def _concentric_shape_indices(shapes: List[dict]) -> set:
    """Indices of shapes that share a center with another, differently-sized
    shape -- rings of a compound target/crosshair/compass symbol rather than
    a genuine standalone callout circle."""
    concentric: set = set()
    for i, a in enumerate(shapes):
        acx, acy = (a["x0"] + a["x1"]) / 2, (a["y0"] + a["y1"]) / 2
        aw = a["x1"] - a["x0"]
        for j in range(i + 1, len(shapes)):
            b = shapes[j]
            bcx, bcy = (b["x0"] + b["x1"]) / 2, (b["y0"] + b["y1"]) / 2
            bw = b["x1"] - b["x0"]
            if (
                abs(acx - bcx) <= CONCENTRIC_CENTER_TOL_PT
                and abs(acy - bcy) <= CONCENTRIC_CENTER_TOL_PT
                and abs(aw - bw) > 6
            ):
                concentric.add(i)
                concentric.add(j)
    return concentric


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


def _ocr_cleaned(cleaned: np.ndarray) -> Tuple[str, float]:
    """Run Tesseract on a cleaned binary crop (ink=255 -> re-inverted to
    black-on-white). Returns (text_with_line_breaks, mean_confidence)."""
    if cleaned.size <= 1 or not cleaned.any():
        return "", 0.0
    try:
        data = pytesseract.image_to_data(
            255 - cleaned, config=TESS_CONFIG, output_type=pytesseract.Output.DICT
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


def _structural_parse(text: str) -> Tuple[Optional[str], Optional[str]]:
    """Decompose OCR text into (detailLabel, sheetRef), or (None, None).

    Structural accept: the crop must OCR to exactly two single-token lines --
    a top detail label and a bottom sheet ref matching the strict pattern.
    This is what rejects prose substring matches like "FRAMED HEADBOAR
    GR-216" (the pre-F1 bug in the old permissive substring-anywhere accept):
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


def _template_row_valid(top: Optional[str], bottom: Optional[str]) -> bool:
    """Same structural gate the Tesseract path uses, applied to a template
    read: top must be a detail label, bottom a digit-bearing sheet ref."""
    if not top or not bottom:
        return False
    if not DETAIL_LABEL_RE.match(top):
        return False
    return bool(SHEET_REF_RE.match(bottom)) and any(ch.isdigit() for ch in bottom)


def _process_single_page(page: "fitz.Page", page_index: int) -> Dict[str, Any]:
    """
    Geometry-candidate detection + crop rendering + segmentation + Tesseract
    for one page. Returns the page payload dict WITHOUT final bubbles -- the
    parent decides acceptance once the doc-wide glyph library exists. The
    payload carries:
      _records: one entry per OCR'd candidate (bbox, shipped glyph cells,
                Tesseract parse + confidence)
      _harvest: trusted (char, cell) template samples from text-layer-resolved
                callouts on this page

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
    concentric = _concentric_shape_indices(shapes)

    candidates_count = len(shapes)
    already_resolved = 0
    ocr_attempted = 0
    records: List[Dict[str, Any]] = []
    harvest: List[Tuple[str, np.ndarray, bool, Any]] = []

    for shape_index, shape in enumerate(shapes):
        if shape_index in concentric:
            # A candidate sharing its center with another differently-sized
            # candidate is one ring of a concentric compound symbol (target/
            # crosshair, compass marker) -- never a genuine callout, which is
            # always a single isolated circle. Found via a real false
            # positive: a crosshair target's middle ring segmented into
            # plausible quadrant "cells" (its own crosshair lines mimic a
            # bubble's label/ref divider) that both Tesseract and the
            # template matcher misread as a sheet ref. Skip entirely --
            # don't OCR, don't harvest, and don't count toward already
            # resolved (this candidate was never a callout to begin with).
            continue
        inside = [w for w in words if len(w) >= 5 and word_in_shape(w, shape)]
        detail_label, sheet_ref = classify_from_words(shape, inside)
        if detail_label is not None or sheet_ref is not None:
            # Already resolved via the text layer (includes short alpha-only
            # equipment tags like "SD"/"HS"/"J") -- don't re-OCR it. But a
            # fully-resolved genuine callout is a TRUSTED glyph source: its
            # rendered strokes come with known text.
            already_resolved += 1
            if (
                detail_label
                and sheet_ref
                and SHEET_REF_RE.match(sheet_ref)
                and any(ch.isdigit() for ch in sheet_ref)
            ):
                seg = preprocess_crop(_render_bubble_crop_gray(page, shape))
                source = (page_index, shape_index)
                for row_text, row_cells in ((detail_label, seg["top"]), (sheet_ref, seg["bottom"])):
                    pairs = assign_chars_to_cells(row_cells, row_text)
                    if pairs:
                        for char, cell in pairs:
                            meta = cell.to_meta()
                            harvest.append((char, meta["norm"], True, source))
            continue

        gray = _render_bubble_crop_gray(page, shape)
        seg = preprocess_crop(gray)
        ocr_attempted += 1

        if not seg["divider_found"]:
            # Every genuine detail-callout bubble in this doc convention is a
            # SPLIT circle -- a divider stroke between the detail label and
            # the sheet ref (confirmed visually on every ground-truth
            # example). A plain undivided circle is a different symbol
            # (equipment tag, target/crosshair marker) that the geometry
            # filter can't tell apart from a callout by shape alone. Found
            # via a real false positive: a crosshair target's middle ring
            # (itself just one of several concentric circle candidates the
            # geometry pass emits for a crosshair) segmented into plausible-
            # looking quadrant "cells" that both Tesseract and the template
            # matcher then misread as a sheet ref. Void the read entirely
            # rather than let either path guess at an undivided circle.
            tess_top = tess_bottom = None
            confidence = 0.0
            seg["top"], seg["bottom"] = [], []
        else:
            raw_text, confidence = _ocr_cleaned(seg["cleaned"])
            tess_top, tess_bottom = _structural_parse(raw_text)

        record: Dict[str, Any] = {
            "bbox": (shape["x0"], shape["y0"], shape["x1"], shape["y1"]),
            "top_cells": [c.to_meta() for c in seg["top"]],
            "bottom_cells": [c.to_meta() for c in seg["bottom"]],
            "tess_top": tess_top,
            "tess_bottom": tess_bottom,
            "conf": confidence,
        }
        records.append(record)

        # High-confidence valid reads double as (untrusted) template samples
        # when the parse maps 1:1 onto the segmented cells.
        if tess_top and tess_bottom and confidence >= HARVEST_MIN_CONF:
            source = (page_index, shape_index)
            for row_text, row_cells in ((tess_top, seg["top"]), (tess_bottom, seg["bottom"])):
                pairs = assign_chars_to_cells(row_cells, row_text)
                if pairs:
                    for char, cell in pairs:
                        meta = cell.to_meta()
                        harvest.append((char, meta["norm"], False, source))

    return {
        "pageNumber": page_index + 1,
        "width": page_width_pts,
        "height": page_height_pts,
        "bubbles": [],
        "_records": records,
        "_harvest": harvest,
        "_candidates_count": candidates_count,
        "_already_resolved": already_resolved,
        "_ocr_attempted": ocr_attempted,
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
        }

    elapsed = time.time() - start
    result["_elapsed_s"] = elapsed
    print(
        f"[bubble-ocr] page {page_index + 1}/{total_pages}: "
        f"{result['_candidates_count']} candidates "
        f"({result['_already_resolved']} already resolved via text layer, "
        f"{result['_ocr_attempted']} ocr'd, "
        f"{len(result['_harvest'])} glyph samples harvested) "
        f"(elapsed {elapsed:.1f}s)",
        file=sys.stderr,
        flush=True,
    )
    return result


def _decide_pages(pages_payload: List[Dict[str, Any]]) -> None:
    """Phase 2 (parent): build the glyph library from every page's harvest,
    then template-check each candidate record and fill in page["bubbles"].
    Mutates the payloads in place; internal keys are stripped by the caller.
    """
    samples: List[Tuple[str, np.ndarray, bool, Any]] = []
    for p in pages_payload:
        samples.extend(p.get("_harvest") or [])
    trusted_n = sum(1 for s in samples if s[2])
    lib, kept_counts = build_library(samples)
    print(
        f"[bubble-ocr] glyph library: {len(lib.classes)} classes from "
        f"{len(samples)} samples ({trusted_n} trusted) -> "
        + (", ".join(f"{c}:{n}" for c, n in sorted(kept_counts.items())) or "EMPTY"),
        file=sys.stderr,
        flush=True,
    )

    agree_n = rescued_n = tess_only_n = corrected_n = dropped_n = 0
    for p in pages_payload:
        page_width_pts = p.get("width") or 1.0
        page_height_pts = p.get("height") or 1.0
        bubbles: List[Dict[str, Any]] = []
        for rec in p.get("_records") or []:
            tess_top, tess_bottom = rec["tess_top"], rec["tess_bottom"]
            tess_valid = tess_top is not None and tess_bottom is not None

            tmpl_top, dec_top, score_top = read_row(rec["top_cells"], lib)
            tmpl_bottom, dec_bottom, score_bottom = read_row(rec["bottom_cells"], lib)
            if tmpl_top:
                tmpl_top = tmpl_top.upper()
            if tmpl_bottom:
                tmpl_bottom = _normalize_sheet_ref(tmpl_bottom.upper())
            tmpl_valid = _template_row_valid(tmpl_top, tmpl_bottom)
            tmpl_decisive = tmpl_valid and dec_top and dec_bottom

            accepted: Optional[Tuple[str, str, float]] = None
            if tess_valid and tmpl_valid and (tess_top, tess_bottom) == (tmpl_top, tmpl_bottom):
                agree_n += 1
                accepted = (tess_top, tess_bottom, max(rec["conf"], 90.0))
            elif tmpl_decisive:
                # Template wins on decisive reads -- stroke-identical glyph
                # correlation beats LSTM guessing on this font, and misreads
                # routinely carry 78-94% Tesseract confidence.
                if tess_valid:
                    corrected_n += 1
                else:
                    rescued_n += 1
                accepted = (tmpl_top, tmpl_bottom, round(100 * min(score_top, score_bottom), 1))
            elif tess_valid and not tmpl_valid and rec["conf"] >= MIN_TESS_ONLY_CONF:
                # Template has no opinion (empty rows / no library coverage):
                # keep the structurally-valid Tesseract read, as before F1.5
                # -- but only when Tesseract had real confidence behind it.
                tess_only_n += 1
                accepted = (tess_top, tess_bottom, rec["conf"])
            else:
                # Disagreement with no decisive side, or nothing valid at
                # all: drop. A missing link costs a click; a wrong link
                # costs trust.
                dropped_n += 1

            if accepted is None:
                continue
            top, bottom, conf = accepted
            x0, y0, x1, y1 = rec["bbox"]
            bubbles.append(
                {
                    "text": f"{top} {bottom}",
                    "x": _clamp01(x0 / page_width_pts),
                    "y": _clamp01(y0 / page_height_pts),
                    "width": _clamp01((x1 - x0) / page_width_pts),
                    "height": _clamp01((y1 - y0) / page_height_pts),
                    "confidence": round(float(conf), 1),
                }
            )
        p["bubbles"] = bubbles

    print(
        f"[bubble-ocr] template pass: {agree_n} agree, {corrected_n} corrected, "
        f"{rescued_n} rescued, {tess_only_n} tesseract-only, {dropped_n} dropped",
        file=sys.stderr,
        flush=True,
    )


def process_pdf(pdf_path: str, pages: Optional[List[int]] = None) -> Dict[str, Any]:
    """Run the full two-phase pass. `pages` (1-based page numbers) restricts
    processing to a subset -- used by the eval harness; production passes
    None for all pages."""
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

    page_indices = (
        list(range(total_pages))
        if pages is None
        else [p - 1 for p in pages if 1 <= p <= total_pages]
    )

    # Cap at 6 workers to keep memory bounded on a Mac laptop.
    cpu = os.cpu_count() or 2
    pool_size = max(1, min(6, cpu - 1))

    overall_start = time.time()
    print(
        f"[bubble-ocr] starting: {len(page_indices)} pages, "
        f"{pool_size} worker process(es), crop_scale={CROP_SCALE}",
        file=sys.stderr,
        flush=True,
    )

    work_items: List[Tuple[str, int, int]] = [
        (pdf_path, i, total_pages) for i in page_indices
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

    _decide_pages(pages_payload)

    # Strip internal keys before returning JSON (workers add these for the
    # parent's template pass + progress log only).
    for p in pages_payload:
        p.pop("_elapsed_s", None)
        p.pop("_records", None)
        p.pop("_harvest", None)
        p.pop("_candidates_count", None)
        p.pop("_already_resolved", None)
        p.pop("_ocr_attempted", None)

    total_callouts = sum(len(p.get("bubbles", [])) for p in pages_payload)
    overall_elapsed = time.time() - overall_start
    print(
        f"[bubble-ocr] done: {len(pages_payload)} pages, {total_callouts} callouts, "
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
