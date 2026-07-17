#!/usr/bin/env python3
"""
PyMuPDF text extraction for Auto-hyperlink.

Reads a PDF directly via fitz (MuPDF) and emits per-page word boxes in 0..1
normalized page coordinates. Designed to fix the gap where PDF.js silently
drops glyphs in Type-3 fonts or form XObjects with broken ToUnicode CMaps --
the exact case that hides callout-bubble text in vector architectural PDFs.

Usage:
    python3 pymupdf_text_extract.py <pdf_path>

Output (stdout, JSON):
    {
      "success": true,
      "totalPages": N,
      "pages": [
        {
          "pageNumber": 1,
          "width": <points>,
          "height": <points>,
          "rotation": <0|90|180|270>,
          "text": "concatenated page text",
          "words": [
            { "text": "A9.22", "x": 0.62, "y": 0.41, "width": 0.04, "height": 0.012 },
            ...
          ]
        },
        ...
      ]
    }

On failure: { "success": false, "error": "..." } and non-zero exit.

Coordinate normalization: PyMuPDF page.rect is in PDF points with origin at
top-left and y growing downward. We divide each word's (x0,y0,x1,y1) by the
unrotated page dimensions so the consumer ("source: 'pymupdf'") matches the
same base-normalized coordinate system used by simpleOcrService's PDF.js
boxes (rotation: 0 in extractTextFromPdfJs).
"""

import fitz  # PyMuPDF
import json
import sys


def _clamp01(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def extract_text(pdf_path: str) -> dict:
    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:  # noqa: BLE001 -- surface the message to Node
        return {"success": False, "error": f"Failed to open PDF: {exc}"}

    pages_payload = []

    try:
        total_pages = len(doc)
        for page_index in range(total_pages):
            try:
                page = doc[page_index]
                # PyMuPDF word coordinates are in UNROTATED page space, but
                # page.rect is the ROTATED visible box — swap the normalization
                # dims on /Rotate 90/270 pages or every box lands misplaced
                # (same fix as archived table_extract.py; verified empirically).
                rotation = int(getattr(page, "rotation", 0) or 0) % 360
                rect = page.rect  # In PDF points; origin top-left
                if rotation in (90, 270):
                    width = float(rect.height) or 1.0
                    height = float(rect.width) or 1.0
                else:
                    width = float(rect.width) or 1.0
                    height = float(rect.height) or 1.0

                # get_text("words") -> list of tuples
                #   (x0, y0, x1, y1, "word", block_no, line_no, word_no)
                # Coordinates are in PDF user space relative to page.rect (top-left origin).
                # We sort by block/line/word so the assembled text reads naturally.
                raw_words = page.get_text("words") or []

                words_payload = []
                text_parts = []
                last_block = None
                last_line = None
                for entry in raw_words:
                    if len(entry) < 5:
                        continue
                    x0, y0, x1, y1, text = entry[0], entry[1], entry[2], entry[3], entry[4]
                    block_no = entry[5] if len(entry) > 5 else 0
                    line_no = entry[6] if len(entry) > 6 else 0

                    if not isinstance(text, str):
                        continue
                    stripped = text.strip()
                    if not stripped:
                        continue

                    try:
                        x0f = float(x0)
                        y0f = float(y0)
                        x1f = float(x1)
                        y1f = float(y1)
                    except (TypeError, ValueError):
                        continue

                    bx = min(x0f, x1f)
                    by = min(y0f, y1f)
                    bw = abs(x1f - x0f)
                    bh = abs(y1f - y0f)
                    if bw <= 0 or bh <= 0:
                        continue

                    words_payload.append(
                        {
                            "text": stripped,
                            "x": _clamp01(bx / width),
                            "y": _clamp01(by / height),
                            "width": _clamp01(bw / width),
                            "height": _clamp01(bh / height),
                        }
                    )

                    # Rebuild a readable text blob so search APIs can hit on
                    # text PyMuPDF found that PDF.js missed.
                    if last_block is not None and (block_no != last_block or line_no != last_line):
                        text_parts.append("\n")
                    elif text_parts:
                        text_parts.append(" ")
                    text_parts.append(stripped)
                    last_block = block_no
                    last_line = line_no

                pages_payload.append(
                    {
                        "pageNumber": page_index + 1,
                        "width": width,
                        "height": height,
                        "rotation": int(getattr(page, "rotation", 0) or 0),
                        "text": "".join(text_parts).strip(),
                        "words": words_payload,
                    }
                )
            except Exception as page_exc:  # noqa: BLE001 -- keep going on bad pages
                pages_payload.append(
                    {
                        "pageNumber": page_index + 1,
                        "width": 0,
                        "height": 0,
                        "rotation": 0,
                        "text": "",
                        "words": [],
                        "error": str(page_exc),
                    }
                )
    finally:
        try:
            doc.close()
        except Exception:  # noqa: BLE001
            pass

    return {"success": True, "totalPages": len(pages_payload), "pages": pages_payload}


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Usage: pymupdf_text_extract.py <pdf_path>"}))
        sys.exit(1)

    result = extract_text(sys.argv[1])
    # Stream as a single JSON document. For huge docs this can be several MB;
    # the Node-side wrapper bumps maxBuffer accordingly.
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
