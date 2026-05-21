#!/usr/bin/env python3
"""Generate bundled default PNG templates for callout bubble template matching (ink only, no text)."""
from __future__ import annotations

import os
import sys

import cv2
import numpy as np


def draw_split_circle(size: int = 96) -> np.ndarray:
    img = np.ones((size, size, 3), dtype=np.uint8) * 255
    cx, cy = size // 2, size // 2
    r = int(size * 0.36)
    cv2.circle(img, (cx, cy), r, (0, 0, 0), 2, lineType=cv2.LINE_AA)
    cv2.line(img, (cx - r + 2, cy), (cx + r - 2, cy), (0, 0, 0), 2, lineType=cv2.LINE_AA)
    return img


def draw_cloud_outline(size: int = 112) -> np.ndarray:
    """Simplified revision-cloud style closed stroke (no fill)."""
    img = np.ones((size, size, 3), dtype=np.uint8) * 255
    pts = np.array(
        [
            [18, 56],
            [24, 40],
            [38, 32],
            [56, 28],
            [76, 32],
            [90, 44],
            [94, 60],
            [88, 76],
            [72, 86],
            [52, 88],
            [32, 82],
            [20, 70],
        ],
        dtype=np.int32,
    )
    cv2.polylines(img, [pts], isClosed=True, color=(0, 0, 0), thickness=2, lineType=cv2.LINE_AA)
    return img


def main() -> int:
    root = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.normpath(os.path.join(root, '..', 'assets', 'callout-templates'))
    os.makedirs(out_dir, exist_ok=True)

    p1 = os.path.join(out_dir, 'split_circle_default.png')
    p2 = os.path.join(out_dir, 'cloud_outline_default.png')
    cv2.imwrite(p1, draw_split_circle())
    cv2.imwrite(p2, draw_cloud_outline())
    print(f'Wrote {p1} and {p2}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
