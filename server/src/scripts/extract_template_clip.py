#!/usr/bin/env python3
"""
Extract a template image by clipping the PDF page, then rasterizing.

The client sends Meridian base-normalized coordinates (0-1): origin at the top-left of the
rendered page (ny=0 at visual top), matching PDF.js + cssDragRectToBasePdfAabb.

PyMuPDF (1.19+) page.rect uses top-left origin with y increasing downward, and
get_pixmap(clip=...) uses the same coordinate system. So Meridian ny maps directly:
  y_top  = rect.y0 + ny * H
  y_bot  = rect.y0 + (ny + nh) * H

page.rect already accounts for built-in /Rotate, so its width/height match the visual
(rendered) page dimensions — same as PDF.js getViewport({ scale: 1, rotation: 0 }).
"""
import json
import sys

import fitz  # PyMuPDF


def main() -> None:
    # Minimal: ... nx ny nw nh <out_png>
    # Optional PDF.js base viewport (points at scale=1, rotation=0) for Meridian mapping:
    # ... nx ny nw nh <pdf_js_w> <pdf_js_h> <out_png>
    if len(sys.argv) < 9:
        print(
            json.dumps(
                {
                    "success": False,
                    "error": "Usage: extract_template_clip.py <pdf_path> <page_1based> <scale> "
                    "<nx> <ny> <nw> <nh> [pdf_js_w pdf_js_h] <out_png_path>",
                }
            )
        )
        sys.exit(1)

    pdf_path = sys.argv[1]
    page_num = int(sys.argv[2])
    scale = float(sys.argv[3])
    nx = float(sys.argv[4])
    ny = float(sys.argv[5])
    nw = float(sys.argv[6])
    nh = float(sys.argv[7])
    w_js = None
    h_js = None
    if len(sys.argv) >= 11:
        w_js = float(sys.argv[8])
        h_js = float(sys.argv[9])
        out_path = sys.argv[10]
    else:
        out_path = sys.argv[8]

    try:
        doc = fitz.open(pdf_path)
        if page_num < 1 or page_num > len(doc):
            doc.close()
            print(json.dumps({"success": False, "error": f"Invalid page {page_num}"}))
            sys.exit(1)

        page = doc[page_num - 1]
        r = page.rect
        # PDF.js base viewport (scale=1) can differ slightly from page.rect width/height;
        # use client-reported size when provided so Meridian fractions match PDF.js.
        W = w_js if (w_js is not None and w_js > 0) else r.width
        H = h_js if (h_js is not None and h_js > 0) else r.height
        # Clamp to valid normalized range
        nx = max(0.0, min(1.0, nx))
        ny = max(0.0, min(1.0, ny))
        nw = max(0.001, min(1.0 - nx, nw))
        nh = max(0.001, min(1.0 - ny, nh))

        x0 = r.x0 + nx * W
        x1 = r.x0 + (nx + nw) * W
        # PyMuPDF y-down: ny=0 → top of page (r.y0), ny=1 → bottom (r.y1)
        y0 = r.y0 + ny * H
        y1 = r.y0 + (ny + nh) * H
        clip = fitz.Rect(x0, y0, x1, y1)

        import sys as _sys
        _sys.stderr.write(
            f"[extract_clip] page.rect={r} W={W:.1f} H={H:.1f} "
            f"norm=({nx:.4f},{ny:.4f},{nw:.4f},{nh:.4f}) "
            f"clip=({x0:.1f},{y0:.1f},{x1:.1f},{y1:.1f}) "
            f"pymupdf={fitz.version}\n"
        )

        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, alpha=False, clip=clip)
        pix.save(out_path)
        w, h = pix.width, pix.height
        pix = None
        doc.close()

        print(
            json.dumps(
                {
                    "success": True,
                    "output": out_path,
                    "width": w,
                    "height": h,
                }
            )
        )
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
