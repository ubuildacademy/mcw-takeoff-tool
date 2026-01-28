#!/usr/bin/env python3
"""
PDF to Image Conversion Script using PyMuPDF

Converts PDF pages to PNG images with configurable quality and scale.
Returns image data as base64-encoded JSON for easy consumption by Node.js.

Usage:
    python3 pdf_to_image.py <pdf_path> <page_number> <scale> [format] [quality]

Arguments:
    pdf_path: Path to PDF file
    page_number: Page number to convert (1-based)
    scale: Scale factor for resolution (e.g., 2.0 = 2x resolution)
    format: Output format ('png' or 'jpeg'), default 'png'
    quality: JPEG quality (1-100), default 90, only used for JPEG format

Output:
    JSON with:
    - success: boolean
    - imageData: base64-encoded image data (if success)
    - imageWidth: image width in pixels (scaled)
    - imageHeight: image height in pixels (scaled)
    - pdfWidth: base PDF page width in points (at scale 1.0)
    - pdfHeight: base PDF page height in points (at scale 1.0)
    - imageScale: rendering scale factor used
    - error: error message (if failed)
"""

import fitz  # PyMuPDF
import json
import sys
import base64
import io

def convert_pdf_page_to_image(pdf_path, page_number, scale=2.0, format='png', quality=90):
    """
    Convert a PDF page to an image using PyMuPDF
    
    Args:
        pdf_path: Path to PDF file
        page_number: Page number (1-based)
        scale: Scale factor for resolution (2.0 = 2x resolution)
        format: Output format ('png' or 'jpeg')
        quality: JPEG quality (1-100), only used for JPEG
    
    Returns:
        dict with success, imageData (base64), imageWidth, imageHeight, or error
    """
    try:
        # Validate inputs
        if page_number < 1:
            return {
                "success": False,
                "error": f"Page number must be >= 1, got {page_number}"
            }
        
        if scale <= 0:
            return {
                "success": False,
                "error": f"Scale must be > 0, got {scale}"
            }
        
        # Open PDF
        doc = fitz.open(pdf_path)
        
        if page_number > len(doc):
            doc.close()
            return {
                "success": False,
                "error": f"Page {page_number} not found. PDF has {len(doc)} pages"
            }
        
        # Get page (0-indexed)
        page = doc[page_number - 1]
        
        # Get base PDF page dimensions (at scale 1.0, rotation 0)
        # This represents the PDF viewport dimensions used for coordinate normalization
        base_rect = page.rect  # Page rectangle in PDF points (72 DPI)
        base_width = base_rect.width
        base_height = base_rect.height
        
        # Create transformation matrix for scale
        # PyMuPDF uses 72 DPI as base, so scale of 2.0 = 144 DPI
        # For higher quality, we multiply by scale
        zoom = scale  # 1.0 = 72 DPI, 2.0 = 144 DPI, etc.
        mat = fitz.Matrix(zoom, zoom)
        
        # Render page to pixmap
        pix = page.get_pixmap(matrix=mat, alpha=False)
        
        # Get image dimensions (scaled)
        width = pix.width
        height = pix.height
        
        # Convert to image bytes
        if format.lower() == 'jpeg' or format.lower() == 'jpg':
            # Convert to JPEG
            img_bytes = pix.tobytes("jpeg", jpg_quality=quality)
            image_format = 'jpeg'
        else:
            # Convert to PNG (default)
            img_bytes = pix.tobytes("png")
            image_format = 'png'
        
        # Encode to base64
        image_data_b64 = base64.b64encode(img_bytes).decode('utf-8')
        
        # Clean up
        pix = None
        doc.close()
        
        return {
            "success": True,
            "imageData": image_data_b64,
            "imageWidth": width,
            "imageHeight": height,
            "pdfWidth": base_width,  # Base PDF page width (at scale 1.0)
            "pdfHeight": base_height,  # Base PDF page height (at scale 1.0)
            "imageScale": scale,  # Image rendering scale factor
            "format": image_format
        }
        
    except Exception as e:
        error_msg = str(e)
        return {
            "success": False,
            "error": f"PDF conversion failed: {error_msg}"
        }

def main():
    """Main entry point"""
    if len(sys.argv) < 4:
        result = {
            "success": False,
            "error": "Missing required arguments. Usage: python3 pdf_to_image.py <pdf_path> <page_number> <scale> [format] [quality]"
        }
        print(json.dumps(result))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    page_number = int(sys.argv[2])
    scale = float(sys.argv[3])
    format = sys.argv[4] if len(sys.argv) > 4 else 'png'
    quality = int(sys.argv[5]) if len(sys.argv) > 5 else 90
    
    result = convert_pdf_page_to_image(pdf_path, page_number, scale, format, quality)
    print(json.dumps(result))
    
    if not result.get("success"):
        sys.exit(1)

if __name__ == "__main__":
    main()

