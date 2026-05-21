#!/usr/bin/env python3
"""
Callout bubble pass: built-in synthetic template library + optional disk PNGs + geometry
proposals, multi-scale OpenCV match, NMS, ROI Tesseract.

Usage:
  python3 callout_hyperlink_pass.py <page_image.png> <templates_dir> <confidence> <roi_scale>

templates_dir may be missing or empty — synthetic + geometry library still runs.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any

import cv2
import numpy as np

try:
    import pytesseract
    from pytesseract import Output as TessOutput
except ImportError:
    pytesseract = None  # type: ignore


def list_templates(templates_dir: str) -> list[str]:
    if not os.path.isdir(templates_dir):
        return []
    out: list[str] = []
    for name in sorted(os.listdir(templates_dir)):
        if name.lower().endswith('.png'):
            out.append(os.path.join(templates_dir, name))
    return out


# Disk PNGs: fewer ratios (matching is expensive at full pyramid resolution).
SCALE_RATIOS: tuple[float, ...] = (0.42, 0.58, 0.75, 0.88, 1.0, 1.18, 1.42, 1.72)
# Built-in synthetics: small jitter around nominal size (templates are already size-varied).
SYNTH_SCALE_RATIOS: tuple[float, ...] = (0.78, 0.9, 1.0, 1.12)

# Match on a downscaled gray image for speed; map boxes back to full raster for OCR.
MATCH_WORK_MAX_SIDE = 1150


def match_one_template_multiscale(
    img_gray: np.ndarray,
    template_gray_base: np.ndarray,
    img_w: int,
    img_h: int,
    confidence_threshold: float,
    template_id: str,
    match_method: int = cv2.TM_CCOEFF_NORMED,
    scale_ratios: tuple[float, ...] | None = None,
) -> list[dict[str, Any]]:
    th0, tw0 = template_gray_base.shape[:2]
    if th0 < 8 or tw0 < 8:
        return []
    ratios = scale_ratios if scale_ratios is not None else SCALE_RATIOS
    all_det: list[dict[str, Any]] = []
    for s in ratios:
        tw = max(8, int(round(tw0 * s)))
        th = max(8, int(round(th0 * s)))
        if tw >= img_w or th >= img_h:
            continue
        interpol_p = cv2.INTER_AREA if s < 1.0 else cv2.INTER_CUBIC
        resized = cv2.resize(template_gray_base, (tw, th), interpolation=interpol_p)
        all_det.extend(
            match_one_template(img_gray, resized, img_w, img_h, confidence_threshold, template_id, match_method)
        )
    if len(all_det) > 8000:
        all_det = sorted(all_det, key=lambda d: d['confidence'], reverse=True)[:8000]
    return all_det


def work_plane_from_full_gray(img_gray: np.ndarray) -> tuple[np.ndarray, float]:
    """Returns (work_gray, full_per_work) — multiply work-plane boxes by full_per_work for full-raster coords."""
    h, w = img_gray.shape[:2]
    m = max(w, h)
    if m <= MATCH_WORK_MAX_SIDE:
        return img_gray, 1.0
    s = MATCH_WORK_MAX_SIDE / float(m)
    nw = max(96, int(round(w * s)))
    nh = max(96, int(round(h * s)))
    work = cv2.resize(img_gray, (nw, nh), interpolation=cv2.INTER_AREA)
    full_per_work = w / float(nw)
    return work, full_per_work


def template_gray_on_work_plane(template_gray_base: np.ndarray, full_per_work: float) -> np.ndarray:
    """Map a template sized in full-raster pixels onto the work-plane scale."""
    if full_per_work <= 1.0 + 1e-6:
        return template_gray_base
    th0, tw0 = template_gray_base.shape[:2]
    tw = max(8, int(round(tw0 / full_per_work)))
    th = max(8, int(round(th0 / full_per_work)))
    return cv2.resize(template_gray_base, (tw, th), interpolation=cv2.INTER_AREA)


def detections_work_to_full(dets: list[dict[str, Any]], full_per_work: float) -> list[dict[str, Any]]:
    if full_per_work <= 1.0 + 1e-6:
        return dets
    out: list[dict[str, Any]] = []
    for d in dets:
        out.append(
            {
                **d,
                'x': float(d['x']) * full_per_work,
                'y': float(d['y']) * full_per_work,
                'width': float(d['width']) * full_per_work,
                'height': float(d['height']) * full_per_work,
            }
        )
    return out


def match_one_template(
    img_gray: np.ndarray,
    template_gray: np.ndarray,
    img_w: int,
    img_h: int,
    confidence_threshold: float,
    template_id: str,
    match_method: int = cv2.TM_CCOEFF_NORMED,
) -> list[dict[str, Any]]:
    th, tw = template_gray.shape[:2]
    if tw > img_w or th > img_h:
        return []
    result = cv2.matchTemplate(img_gray, template_gray, match_method)
    loc = np.where(result >= confidence_threshold)
    detections: list[dict[str, Any]] = []
    for pt in zip(*loc[::-1]):
        x, y = int(pt[0]), int(pt[1])
        conf = float(result[y, x])
        detections.append(
            {
                'x': x,
                'y': y,
                'width': tw,
                'height': th,
                'confidence': conf,
                'templateId': template_id,
            }
        )
    if len(detections) > 5000:
        detections = sorted(detections, key=lambda d: d['confidence'], reverse=True)[:5000]
    return detections


def iou_px(a: dict[str, float], b: dict[str, float]) -> float:
    ax, ay, aw, ah = a['x'], a['y'], a['width'], a['height']
    bx, by, bw, bh = b['x'], b['y'], b['width'], b['height']
    inter_x = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    inter_y = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    inter = inter_x * inter_y
    union = aw * ah + bw * bh - inter
    return float(inter / union) if union > 0 else 0.0


def nms_detections(detections: list[dict[str, Any]], iou_thresh: float = 0.35) -> list[dict[str, Any]]:
    if not detections:
        return []
    boxes = sorted(detections, key=lambda d: d['confidence'], reverse=True)
    kept: list[dict[str, Any]] = []
    for det in boxes:
        dup = False
        for k in kept:
            if iou_px(det, k) >= iou_thresh:
                dup = True
                break
        if not dup:
            kept.append(det)
    return kept


def expand_roi(
    det: dict[str, Any], img_w: int, img_h: int, roi_scale: float
) -> tuple[int, int, int, int]:
    x, y, w, h = int(det['x']), int(det['y']), int(det['width']), int(det['height'])
    cx = x + w / 2.0
    cy = y + h / 2.0
    nw = w * roi_scale
    nh = h * roi_scale
    nx0 = int(max(0, round(cx - nw / 2)))
    ny0 = int(max(0, round(cy - nh / 2)))
    nx1 = int(min(img_w, round(cx + nw / 2)))
    ny1 = int(min(img_h, round(cy + nh / 2)))
    if nx1 <= nx0 or ny1 <= ny0:
        return x, y, x + w, y + h
    return nx0, ny0, nx1, ny1


def configure_tesseract() -> None:
    if pytesseract is None:
        return
    import shutil

    for candidate in ('/usr/bin/tesseract', shutil.which('tesseract') or ''):
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            pytesseract.pytesseract.tesseract_cmd = candidate
            break


def ocr_with_psm(
    gray2x: np.ndarray,
    x0: int,
    y0: int,
    img_w: int,
    img_h: int,
    scale: int,
    psm_config: str,
) -> list[dict[str, Any]]:
    if pytesseract is None:
        return []
    configure_tesseract()
    try:
        data = pytesseract.image_to_data(
            gray2x,
            output_type=TessOutput.DICT,
            config=psm_config,
            lang='eng',
        )
    except Exception:
        return []

    words: list[dict[str, Any]] = []
    n = len(data.get('text', []))
    for i in range(n):
        raw = (data['text'][i] or '').strip()
        if not raw:
            continue
        try:
            conf = int(data['conf'][i])
        except (ValueError, TypeError):
            conf = -1
        if conf < 0 or conf < 25:
            continue
        l = int(data['left'][i]) // scale
        t = int(data['top'][i]) // scale
        w = max(1, int(data['width'][i]) // scale)
        h = max(1, int(data['height'][i]) // scale)
        fx = (x0 + l) / float(img_w)
        fy = (y0 + t) / float(img_h)
        fw = w / float(img_w)
        fh = h / float(img_h)
        words.append(
            {
                'text': raw,
                'bbox': {
                    'x': max(0.0, min(1.0, fx)),
                    'y': max(0.0, min(1.0, fy)),
                    'width': max(0.0, min(1.0, fw)),
                    'height': max(0.0, min(1.0, fh)),
                },
                'confidence': float(conf),
            }
        )
    return words


def ocr_crop_to_word_boxes(
    img_bgr: np.ndarray, x0: int, y0: int, x1: int, y1: int, img_w: int, img_h: int
) -> list[dict[str, Any]]:
    if pytesseract is None:
        return []
    configure_tesseract()
    crop = img_bgr[y0:y1, x0:x1]
    if crop.size == 0:
        return []
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    scale = 2
    gray2x = cv2.resize(gray, (gray.shape[1] * scale, gray.shape[0] * scale), interpolation=cv2.INTER_CUBIC)

    # Single PSM keeps latency predictable; callout ROIs are small multi-word blocks.
    return ocr_with_psm(gray2x, x0, y0, img_w, img_h, scale, '--oem 3 --psm 6')


def synthetic_split_circle_templates() -> list[tuple[str, np.ndarray]]:
    """Built-in library: split-circle section callout (strokes only, no digits)."""
    out: list[tuple[str, np.ndarray]] = []
    for size in (48, 58, 68, 80, 92, 104, 120):
        for thk in (2, 3):
            if size <= thk * 10:
                continue
            img = np.ones((size, size), dtype=np.uint8) * 255
            c = size // 2
            r = max(8, int(size * 0.37))
            cv2.circle(img, (c, c), r, 0, thk, cv2.LINE_AA)
            x0 = max(1, c - r + thk)
            x1 = min(size - 2, c + r - thk)
            cv2.line(img, (x0, c), (x1, c), 0, thk, cv2.LINE_AA)
            out.append((f'synth_split_circle_s{size}_k{thk}', img))
    return out


def _cloud_polygon(base_size: int, variant: int) -> np.ndarray:
    img = np.ones((base_size, base_size), dtype=np.uint8) * 255
    if variant == 0:
        pts = np.array(
            [
                [0.14, 0.52],
                [0.22, 0.28],
                [0.42, 0.16],
                [0.62, 0.14],
                [0.78, 0.22],
                [0.88, 0.42],
                [0.86, 0.62],
                [0.72, 0.78],
                [0.48, 0.86],
                [0.28, 0.78],
                [0.16, 0.62],
            ],
            dtype=np.float64,
        )
    elif variant == 1:
        pts = np.array(
            [
                [0.18, 0.5],
                [0.28, 0.22],
                [0.55, 0.12],
                [0.82, 0.28],
                [0.9, 0.55],
                [0.75, 0.82],
                [0.45, 0.88],
                [0.15, 0.72],
            ],
            dtype=np.float64,
        )
    else:
        pts = np.array(
            [
                [0.2, 0.48],
                [0.35, 0.2],
                [0.65, 0.18],
                [0.85, 0.45],
                [0.78, 0.75],
                [0.52, 0.88],
                [0.22, 0.78],
            ],
            dtype=np.float64,
        )
    pts[:, 0] *= base_size - 1
    pts[:, 1] *= base_size - 1
    ipt = pts.astype(np.int32)
    cv2.polylines(img, [ipt], True, 0, 2, cv2.LINE_AA)
    return img


def synthetic_cloud_templates() -> list[tuple[str, np.ndarray]]:
    out: list[tuple[str, np.ndarray]] = []
    for base in (80, 100):
        for v in (0, 2):
            out.append((f'synth_cloud_b{base}_v{v}', _cloud_polygon(base, v)))
    return out


def built_in_synthetic_templates() -> list[tuple[str, np.ndarray]]:
    return synthetic_split_circle_templates() + synthetic_cloud_templates()


def geometric_blob_proposals(
    img_gray: np.ndarray, img_w: int, img_h: int, max_keep: int = 28
) -> list[dict[str, Any]]:
    """
    Small closed blobs (roughly round) from contours — catches bubbles that
    don't correlate with template matching. NMS + caps limit duplicate/noise ROIs.
    """
    page_area = float(img_w * img_h)
    blur = cv2.GaussianBlur(img_gray, (3, 3), 0)
    _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    props: list[dict[str, Any]] = []
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        area = float(cv2.contourArea(cnt))
        if area < page_area * 1.8e-5 or area > page_area * 0.0018:
            continue
        if w < 12 or h < 12:
            continue
        if w > int(img_w * 0.11) or h > int(img_h * 0.11):
            continue
        ar = w / float(max(h, 1))
        if ar < 0.42 or ar > 2.35:
            continue
        peri = cv2.arcLength(cnt, True)
        if peri < 1e-3:
            continue
        circ = 4.0 * np.pi * area / (peri * peri + 1e-6)
        if circ < 0.26:
            continue
        props.append(
            {
                'x': float(x),
                'y': float(y),
                'width': float(w),
                'height': float(h),
                'confidence': 0.33,
                'templateId': 'geom_blob',
            }
        )
    merged = nms_detections(props, 0.4)
    return merged[:max_keep]


def lower_half_followup_ocr(template_id: str) -> bool:
    """Extra OCR on bottom of ROI for split circles; skip blobs/clouds to save Tesseract calls."""
    t = (template_id or '').lower()
    if 'geom_blob' in t or 'synth_cloud' in t:
        return False
    return 'circle' in t or 'synth_split' in t


MAX_PRE_NMS_DETECTIONS = 12_000
MAX_MERGED_ROIS_FOR_OCR = 72


def run_pass(
    image_path: str,
    templates_dir: str,
    confidence_threshold: float,
    roi_scale: float,
) -> dict[str, Any]:
    if not os.path.isfile(image_path):
        return {'success': False, 'error': f'Image not found: {image_path}'}

    img = cv2.imread(image_path)
    if img is None:
        return {'success': False, 'error': f'Failed to load image: {image_path}'}

    img_h, img_w = img.shape[:2]
    img_gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    work_gray, full_per_work = work_plane_from_full_gray(img_gray)
    ww, wh = work_gray.shape[1], work_gray.shape[0]

    all_det: list[dict[str, Any]] = []

    disk_paths = list_templates(templates_dir)
    for tpath in disk_paths:
        tid = os.path.basename(tpath)
        tmpl = cv2.imread(tpath)
        if tmpl is None:
            continue
        tg_full = cv2.cvtColor(tmpl, cv2.COLOR_BGR2GRAY)
        tg = template_gray_on_work_plane(tg_full, full_per_work)
        dets = match_one_template_multiscale(
            work_gray, tg, ww, wh, confidence_threshold, tid
        )
        all_det.extend(detections_work_to_full(dets, full_per_work))

    for tid, tmpl_bgr in built_in_synthetic_templates():
        tg_full = tmpl_bgr if tmpl_bgr.ndim == 2 else cv2.cvtColor(tmpl_bgr, cv2.COLOR_BGR2GRAY)
        tg = template_gray_on_work_plane(tg_full, full_per_work)
        dets = match_one_template_multiscale(
            work_gray,
            tg,
            ww,
            wh,
            confidence_threshold,
            tid,
            scale_ratios=SYNTH_SCALE_RATIOS,
        )
        all_det.extend(detections_work_to_full(dets, full_per_work))

    geom = geometric_blob_proposals(work_gray, ww, wh)
    all_det.extend(detections_work_to_full(geom, full_per_work))

    if len(all_det) > MAX_PRE_NMS_DETECTIONS:
        all_det = sorted(all_det, key=lambda d: d['confidence'], reverse=True)[:MAX_PRE_NMS_DETECTIONS]

    merged = nms_detections(all_det, 0.35)
    if len(merged) > MAX_MERGED_ROIS_FOR_OCR:
        merged = sorted(merged, key=lambda d: d['confidence'], reverse=True)[:MAX_MERGED_ROIS_FOR_OCR]

    word_boxes: list[dict[str, Any]] = []
    seen_text_rect: set[str] = set()
    for det in merged:
        x0, y0, x1, y1 = expand_roi(det, img_w, img_h, roi_scale)
        for w in ocr_crop_to_word_boxes(img, x0, y0, x1, y1, img_w, img_h):
            key = f"{w['text']}|{w['bbox']['x']:.4f}|{w['bbox']['y']:.4f}"
            if key in seen_text_rect:
                continue
            seen_text_rect.add(key)
            word_boxes.append(w)
        if lower_half_followup_ocr(str(det.get('templateId', ''))):
            ch = y1 - y0
            if ch > 12:
                y_split = int(y0 + ch * 0.38)
                for w in ocr_crop_to_word_boxes(img, x0, y_split, x1, y1, img_w, img_h):
                    key = f"{w['text']}|{w['bbox']['x']:.4f}|{w['bbox']['y']:.4f}"
                    if key in seen_text_rect:
                        continue
                    seen_text_rect.add(key)
                    word_boxes.append(w)

    return {
        'success': True,
        'imageWidth': img_w,
        'imageHeight': img_h,
        'templateMatches': len(merged),
        'wordBoxes': word_boxes,
    }


def main() -> int:
    if len(sys.argv) < 5:
        print(
            json.dumps(
                {
                    'success': False,
                    'error': 'Usage: callout_hyperlink_pass.py <page.png> <templates_dir> <confidence> <roi_scale>',
                }
            )
        )
        return 1
    image_path = sys.argv[1]
    templates_dir = sys.argv[2]
    confidence = float(sys.argv[3])
    roi_scale = float(sys.argv[4])
    out = run_pass(image_path, templates_dir, confidence, roi_scale)
    print(json.dumps(out))
    return 0 if out.get('success') else 1


if __name__ == '__main__':
    raise SystemExit(main())
