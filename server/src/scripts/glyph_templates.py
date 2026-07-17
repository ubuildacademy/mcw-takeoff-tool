#!/usr/bin/env python3
"""
Per-document glyph template matching for bubble OCR (Workstream F1.5).

CAD-exported drawings render every instance of a glyph stroke-identically, so
a digit read correctly once anywhere in the document is a pixel-level template
for every other instance of that digit. This module exploits that to correct
and rescue Tesseract reads on vector-stroke callout bubbles:

  1. `preprocess_crop` turns a rendered bubble crop into clean per-glyph cells:
     Otsu binarize -> mask outside the inscribed ellipse (removes the bubble's
     own outline arc, which otherwise wrecks Tesseract -- see the F1 notes in
     docs/IMPLEMENTATION_PLAN.md) -> morphological removal of long horizontal/
     vertical lines (the label/ref divider, plus leader and section lines that
     cross many bubbles) -> connected components -> merge x-overlapping pieces
     (a removed line can split a glyph into stacked halves) -> split into a
     top row (detail label) and bottom row (sheet ref) around the divider.

  2. `build_library` assembles {char: templates} from high-confidence sources:
     text-layer-resolved callouts (trusted -- the label is real PDF text) and
     structurally-valid high-confidence Tesseract reads. Per-class outlier
     rejection drops mislabeled samples (a "3" that a misread smuggled in as
     "2" disagrees with the genuine "2" samples and is discarded), and a class
     harvested from a single bubble with no trusted sample is dropped entirely
     rather than risk a systematically wrong template.

  3. `read_row` matches each cell against the library (equal-size normalized
     cross-correlation via cv2.matchTemplate) and reports per-cell
     decisiveness, so the caller can distinguish "template says X, decisively"
     from "template has no opinion" and preserve the zero-false-positive
     accept policy.

Dots and dashes are classified geometrically (relative size/aspect within the
row), not by correlation -- a dot normalized to template height carries no
useful NCC signal.

Cells cross process boundaries (workers segment, the parent matches), so the
exchange format is a plain dict: {"w": int, "h": int, "norm": uint8 2-D array
TEMPLATE_H tall}. numpy/cv2 only (both already required by bubble_ocr_pass).
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

# Cells and templates are normalized to this height (aspect preserved) before
# correlation. 48 px keeps a full digit's stroke topology while staying cheap
# enough to correlate tens of thousands of cell/template pairs in seconds.
TEMPLATE_H = 48
MAX_TEMPLATE_W = 120

# Fraction of the crop's inscribed ellipse kept when masking out the bubble's
# own outline arc. 0.90 removes the arc while keeping wide bottom rows
# ("A9.02" nearly touches the circle at mid-height) intact.
ELLIPSE_MASK_RADIUS = 0.90

# A cell is only matched against a class whose median aspect ratio is within
# this log-ratio band (~1.35x either way) -- prevents a "1" from being scored
# against "0" templates at a meaningless stretch.
MAX_ASPECT_LOG_RATIO = 0.30

# Per-cell decisiveness: best class correlation must clear MIN_SCORE and beat
# the runner-up class by MIN_MARGIN. Identical vector glyphs rendered at the
# same scale correlate near 1.0, so these can sit far above the cross-digit
# confusion band (see the F1.5 measurements in the commit message).
MIN_TEMPLATE_SCORE = 0.72
MIN_TEMPLATE_MARGIN = 0.06

# Library hygiene: a sample must agree with its class (median pairwise NCC)
# at this level or it is discarded as mislabeled.
MIN_CLASS_AGREEMENT = 0.70
# Untrusted classes need samples from at least this many distinct bubbles --
# a single bubble's misread must not become the sole authority for a char.
MIN_DISTINCT_SOURCES = 2
MAX_TEMPLATES_PER_CLASS = 6

# Geometric dot/dash classification, relative to the tallest glyph in the row.
DOT_MAX_REL_HEIGHT = 0.45
DASH_MIN_ASPECT = 1.8

# A connected component whose ink covers less than this fraction of its own
# bbox is a stroke fragment (a leftover ring segment from an equipment-symbol
# circle, a crosshair quadrant, a leader line stub), not a glyph -- real
# digit/letter strokes on this CAD font fill 0.4-0.9 of their bbox even at
# their thinnest (a "1"). Measured on a false-positive crosshair/target
# symbol (page 64 of the beta doc, mistaken for a callout by the geometry
# filter): its residual quadrant blobs filled only ~0.10 of their bbox after
# line removal, versus 0.53-0.88 for every real glyph cell sampled from
# genuine callouts. This is what the pure size/aspect cell filter misses --
# the blobs there were plausibly glyph-sized, just not glyph-*shaped*.
MIN_CELL_FILL_RATIO = 0.30


class Cell:
    """One segmented glyph candidate within a bubble crop row (worker-side)."""

    __slots__ = ("img", "x", "y", "w", "h")

    def __init__(self, img: np.ndarray, x: int, y: int, w: int, h: int):
        self.img = img  # uint8 0/255, tight bbox, ORIGINAL crop resolution
        self.x = x
        self.y = y
        self.w = w
        self.h = h

    def to_meta(self) -> Dict[str, object]:
        """Cross-process form: normalized uint8 image + original bbox size."""
        return {"w": self.w, "h": self.h, "norm": normalize_glyph(self.img, self.h)}


def normalize_glyph(img: np.ndarray, orig_h: int) -> np.ndarray:
    """Resize a glyph image to TEMPLATE_H tall, aspect preserved, uint8."""
    h, w = img.shape[:2]
    out_w = max(1, min(MAX_TEMPLATE_W, round(w * TEMPLATE_H / max(1, h))))
    return cv2.resize(img, (out_w, TEMPLATE_H), interpolation=cv2.INTER_AREA)


def _remove_long_lines(binary: np.ndarray) -> Tuple[np.ndarray, Optional[float]]:
    """Subtract long horizontal + vertical strokes (divider, leader/section
    lines). Returns (cleaned, divider_y) where divider_y is the y of the
    horizontal line nearest the crop's vertical center, if one exists."""
    h, w = binary.shape
    horiz_kern = cv2.getStructuringElement(cv2.MORPH_RECT, (max(3, int(w * 0.45)), 1))
    horiz = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horiz_kern)
    vert_kern = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(3, int(h * 0.55))))
    vert = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vert_kern)

    divider_y: Optional[float] = None
    row_hits = np.where(horiz.max(axis=1) > 0)[0]
    if len(row_hits):
        # Group contiguous runs of line rows; pick the run nearest mid-height.
        runs: List[Tuple[int, int]] = []
        start = prev = int(row_hits[0])
        for r in row_hits[1:]:
            r = int(r)
            if r == prev + 1:
                prev = r
                continue
            runs.append((start, prev))
            start = prev = r
        runs.append((start, prev))
        mid = h / 2
        best = min(runs, key=lambda run: abs((run[0] + run[1]) / 2 - mid))
        center = (best[0] + best[1]) / 2
        if 0.25 * h <= center <= 0.75 * h:
            divider_y = center

    # Dilate the extracted lines so their full stroke thickness (plus the
    # anti-aliased fringe) is subtracted, not just the morphological core.
    grow = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 5))
    lines = cv2.dilate(cv2.bitwise_or(horiz, vert), grow)
    cleaned = cv2.bitwise_and(binary, cv2.bitwise_not(lines))
    return cleaned, divider_y


def _merge_x_overlapping(cells: List[Cell]) -> List[Cell]:
    """Merge cells whose x-ranges overlap heavily -- a removed crossing line
    splits a glyph into stacked halves that must be reunited before matching."""
    merged = True
    cells = list(cells)
    while merged:
        merged = False
        for i in range(len(cells)):
            for j in range(i + 1, len(cells)):
                a, b = cells[i], cells[j]
                overlap = min(a.x + a.w, b.x + b.w) - max(a.x, b.x)
                if overlap <= 0 or overlap / min(a.w, b.w) < 0.5:
                    continue
                x0, y0 = min(a.x, b.x), min(a.y, b.y)
                x1 = max(a.x + a.w, b.x + b.w)
                y1 = max(a.y + a.h, b.y + b.h)
                img = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)
                img[a.y - y0:a.y - y0 + a.h, a.x - x0:a.x - x0 + a.w] |= a.img
                img[b.y - y0:b.y - y0 + b.h, b.x - x0:b.x - x0 + b.w] |= b.img
                cells[i] = Cell(img, x0, y0, x1 - x0, y1 - y0)
                del cells[j]
                merged = True
                break
            if merged:
                break
    return cells


def preprocess_crop(gray: np.ndarray) -> Dict[str, object]:
    """Segment a rendered bubble crop into glyph cells.

    Returns {"top": [Cell...], "bottom": [Cell...], "divider_found": bool,
    "cleaned": uint8 image (ink=255, arc/lines removed)} with rows sorted
    left-to-right. Rows are split at the detected divider line (fallback:
    crop vertical center).
    """
    h, w = gray.shape[:2]
    if h < 12 or w < 12:
        return {"top": [], "bottom": [], "divider_found": False,
                "cleaned": np.zeros((1, 1), dtype=np.uint8)}

    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    mask = np.zeros_like(binary)
    cv2.ellipse(
        mask,
        (w // 2, h // 2),
        (int(w / 2 * ELLIPSE_MASK_RADIUS), int(h / 2 * ELLIPSE_MASK_RADIUS)),
        0, 0, 360, 255, -1,
    )
    binary = cv2.bitwise_and(binary, mask)

    cleaned, divider_y = _remove_long_lines(binary)
    split_y = divider_y if divider_y is not None else h / 2

    n, labels, stats, _centroids = cv2.connectedComponentsWithStats(cleaned, connectivity=8)
    # Two-stage size filter: absolute specks first (line-removal residue),
    # then a dot-sized floor AFTER merging, so a genuine "." survives but
    # residue that didn't merge into a glyph does not.
    speck_area = max(4.0, (0.015 * h) ** 2)
    raw: List[Cell] = []
    for i in range(1, n):
        x, y, cw, ch, area = (int(v) for v in stats[i])
        if area < speck_area:
            continue
        img = (labels[y:y + ch, x:x + cw] == i).astype(np.uint8) * 255
        raw.append(Cell(img, x, y, cw, ch))

    top_raw = [c for c in raw if (c.y + c.h / 2) < split_y]
    bottom_raw = [c for c in raw if (c.y + c.h / 2) >= split_y]

    min_cell_area = (0.03 * h) ** 2
    out: Dict[str, object] = {"divider_found": divider_y is not None, "cleaned": cleaned}
    for key, row in (("top", top_raw), ("bottom", bottom_raw)):
        row = _merge_x_overlapping(row)
        row = [c for c in row if c.w * c.h >= min_cell_area]
        row = [c for c in row if (c.img > 0).sum() / (c.w * c.h) >= MIN_CELL_FILL_RATIO]
        row.sort(key=lambda c: c.x)
        out[key] = row
    return out


def classify_geometric(w: int, h: int, row_max_h: int) -> Optional[str]:
    """Dot/dash classification by shape relative to the row's tallest glyph.
    Returns '.', '-', or None (= needs template matching)."""
    if row_max_h <= 0 or h >= DOT_MAX_REL_HEIGHT * row_max_h:
        return None
    aspect = w / h if h else 99.0
    return "-" if aspect >= DASH_MIN_ASPECT else "."


# ---------------------------------------------------------------------------
# Library
# ---------------------------------------------------------------------------

class GlyphLibrary:
    """{char: {"templates": [float32 TEMPLATE_H x class_w], "w", "aspect"}}"""

    def __init__(self) -> None:
        self.classes: Dict[str, Dict[str, object]] = {}

    def match(self, norm_u8: np.ndarray, cell_aspect: float) -> Tuple[Optional[str], float, float]:
        """Best (char, score, margin_over_second_class) for a normalized cell."""
        cell_f = None
        best_char: Optional[str] = None
        best = second = -1.0
        for char, cls in self.classes.items():
            cls_aspect = float(cls["aspect"])  # type: ignore[arg-type]
            if abs(np.log(max(cell_aspect, 1e-3) / max(cls_aspect, 1e-3))) > MAX_ASPECT_LOG_RATIO:
                continue
            if cell_f is None:
                cell_f = norm_u8.astype(np.float32) / 255.0
            w = int(cls["w"])  # type: ignore[arg-type]
            resized = cell_f if cell_f.shape[1] == w else cv2.resize(
                cell_f, (w, TEMPLATE_H), interpolation=cv2.INTER_AREA
            )
            score = -1.0
            for tmpl in cls["templates"]:  # type: ignore[union-attr]
                s = float(cv2.matchTemplate(resized, tmpl, cv2.TM_CCOEFF_NORMED)[0, 0])
                if s > score:
                    score = s
            if score > best:
                best_char, second, best = char, best, score
            elif score > second:
                second = score
        margin = best - second if second > -1.0 else best
        return best_char, best, margin


def _norm_to_width(sample: np.ndarray, w: int) -> np.ndarray:
    if sample.shape[1] == w:
        return sample
    return cv2.resize(sample, (w, TEMPLATE_H), interpolation=cv2.INTER_AREA)


def build_library(
    samples: List[Tuple[str, np.ndarray, bool, object]],
) -> Tuple[GlyphLibrary, Dict[str, int]]:
    """Build the per-document library.

    samples: (char, normalized uint8 image (TEMPLATE_H tall), trusted,
    source_id). `trusted` samples come from the PDF text layer; untrusted
    ones from high-confidence Tesseract reads. source_id groups samples from
    the same physical bubble for the distinct-source rule.

    Returns (library, {char: kept_template_count}) -- counts are for the
    progress log only.
    """
    lib = GlyphLibrary()
    kept_counts: Dict[str, int] = {}
    by_char: Dict[str, List[Tuple[np.ndarray, bool, object]]] = {}
    for char, img, trusted, source in samples:
        if char in (".", "-"):
            continue  # dots/dashes are classified geometrically
        by_char.setdefault(char, []).append(
            (img.astype(np.float32) / 255.0, trusted, source)
        )

    for char, entries in by_char.items():
        widths = sorted(e[0].shape[1] for e in entries)
        class_w = max(2, widths[len(widths) // 2])
        norm = [(_norm_to_width(e[0], class_w), e[1], e[2]) for e in entries]

        if len(norm) >= 3:
            k = len(norm)
            sim = np.full((k, k), np.nan, dtype=np.float32)
            for i in range(k):
                for j in range(i + 1, k):
                    s = float(cv2.matchTemplate(norm[i][0], norm[j][0], cv2.TM_CCOEFF_NORMED)[0, 0])
                    sim[i, j] = sim[j, i] = s
            med = np.nanmedian(sim, axis=1)
            keep = [norm[i] for i in range(k) if med[i] >= MIN_CLASS_AGREEMENT or norm[i][1]]
        else:
            keep = norm
        if not keep:
            continue

        trusted_present = any(t for _, t, _ in keep)
        distinct_sources = len({s for _, _, s in keep})
        if not trusted_present and distinct_sources < MIN_DISTINCT_SOURCES:
            continue

        # Prefer a spread: trusted first, then each distinct source once.
        keep.sort(key=lambda e: (not e[1],))
        templates: List[np.ndarray] = []
        seen_sources: set = set()
        for img, _trusted, source in keep:
            if len(templates) >= MAX_TEMPLATES_PER_CLASS:
                break
            if source in seen_sources and len(keep) > MAX_TEMPLATES_PER_CLASS:
                continue
            seen_sources.add(source)
            templates.append(img)
        if not templates:
            templates = [keep[0][0]]

        lib.classes[char] = {
            "templates": templates,
            "w": class_w,
            "aspect": class_w / TEMPLATE_H,
        }
        kept_counts[char] = len(templates)
    return lib, kept_counts


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def read_row(cells_meta: List[Dict[str, object]], lib: GlyphLibrary) -> Tuple[Optional[str], bool, float]:
    """Read one row of shipped cells ({"w","h","norm"} dicts) via the library.

    Returns (text, decisive, min_cell_score). text is None when the row is
    empty or any glyph cell has no plausible class at all (no library
    coverage) -- callers treat that as "template has no opinion".
    """
    if not cells_meta:
        return None, False, 0.0
    row_max_h = max(int(m["h"]) for m in cells_meta)
    chars: List[str] = []
    decisive = True
    min_score = 1.0
    for m in cells_meta:
        w, h = int(m["w"]), int(m["h"])
        geo = classify_geometric(w, h, row_max_h)
        if geo is not None:
            chars.append(geo)
            continue
        char, score, margin = lib.match(m["norm"], w / h if h else 99.0)
        if char is None:
            return None, False, 0.0
        chars.append(char)
        min_score = min(min_score, score)
        if score < MIN_TEMPLATE_SCORE or margin < MIN_TEMPLATE_MARGIN:
            decisive = False
    return "".join(chars), decisive, min_score


def assign_chars_to_cells(cells: List[Cell], text: str) -> Optional[List[Tuple[str, Cell]]]:
    """Pair a known row string with its segmented cells for harvesting.
    Returns (char, Cell) pairs for glyph cells only (dots/dashes are skipped
    -- they need no template), or None unless counts line up exactly."""
    if len(cells) != len(text) or not text:
        return None
    row_max_h = max(c.h for c in cells)
    pairs: List[Tuple[str, Cell]] = []
    for char, cell in zip(text, cells):
        geo = classify_geometric(cell.w, cell.h, row_max_h)
        if char in (".", "-"):
            if geo != char:
                return None
            continue
        if geo is not None:
            return None  # a glyph-sized char landed on a dot-sized cell
        pairs.append((char, cell))
    return pairs
