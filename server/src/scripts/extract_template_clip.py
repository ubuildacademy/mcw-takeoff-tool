#!/usr/bin/env python3
"""
Extract a template image by clipping the PDF page in PDF user space, then rasterizing.

The client sends Meridian base-normalized coordinates (0-1): origin at the top-left of the
rendered page (ny=0 at visual top), matching PDF.js + cssDragRectToBasePdfAabb.

Cropping the full-page PNG with y_px = ny * img_height is WRONG for PDF: PyMuPDF images use
top row = high PDF y. Meridian ny is "fraction from visual top", which maps to PDF as:
  y_pdf_top = rect.y1 - ny * rect.height
  y_pdf_bottom = rect.y1 - (ny + nh) * rect.height

This script uses fitz.Rect in PDF space + get_pixmap(clip=...) so the template matches the
same rendering pipeline as full-page search (OpenCV).
"""
import json
import sys

import fitz  # PyMuPDF


def main() -> None:
    if len(sys.argv) < 9:
        print(
            json.dumps(
                {
                    "success": False,
                    "error": "Usage: extract_template_clip.py <pdf_path> <page_1based> <scale> "
                    "<nx> <ny> <nw> <nh> <out_png_path>",
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
    out_path = sys.argv[8]

    try:
        doc = fitz.open(pdf_path)
        if page_num < 1 or page_num > len(doc):
            doc.close()
            print(json.dumps({"success": False, "error": f"Invalid page {page_num}"}))
            sys.exit(1)

        page = doc[page_num - 1]
        r = page.rect
        # Clamp to valid normalized range
        nx = max(0.0, min(1.0, nx))
        ny = max(0.0, min(1.0, ny))
        nw = max(0.001, min(1.0 - nx, nw))
        nh = max(0.001, min(1.0 - ny, nh))

        x0 = r.x0 + nx * r.width
        x1 = r.x0 + (nx + nw) * r.width
        # Visual top (ny=0) -> PDF y = r.y1; visual bottom -> r.y0
        y_top = r.y1 - ny * r.height
        y_bottom = r.y1 - (ny + nh) * r.height
        clip = fitz.Rect(x0, y_bottom, x1, y_top)

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
