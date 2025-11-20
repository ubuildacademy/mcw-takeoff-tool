#!/usr/bin/env python3
"""
Titleblock Extraction Script using OCR and Pattern Matching

Extracts sheet numbers and names from construction drawing titleblocks.
Uses spatial detection to find titleblock region, then OCR + pattern matching.

Usage:
    python3 titleblock_extraction.py <pdf_path> <page_numbers> [output_dir]

Arguments:
    pdf_path: Path to PDF file
    page_numbers: Comma-separated page numbers (1-based, e.g., "1,2,3")
    output_dir: Optional directory for temporary images (default: /tmp)

Output:
    JSON array with:
    - pageNumber: page number
    - sheetNumber: extracted sheet number or "Unknown"
    - sheetName: extracted sheet name or "Unknown"
"""

import json
import sys
import os
import re
import fitz  # PyMuPDF
from pathlib import Path

# Try to import OpenCV, but continue without it if not available
try:
    import cv2
    import numpy as np
    OPENCV_AVAILABLE = True
except ImportError:
    OPENCV_AVAILABLE = False
    print("Warning: OpenCV not available, using fallback titleblock detection", file=sys.stderr)

# Try to import PIL/Pillow for image cropping (fallback when OpenCV unavailable)
try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    print("Warning: PIL/Pillow not available, will need OpenCV for region extraction", file=sys.stderr)

# Try to import pytesseract, but continue without it if not available
try:
    import pytesseract
    TESSERACT_AVAILABLE = True
    
    # Try to find tesseract binary and configure pytesseract to use it
    # This is needed on Railway/Nixpacks where tesseract might be in /nix/store
    import shutil
    tesseract_path = shutil.which('tesseract')
    if not tesseract_path:
        # Try to find in common Nix store locations
        import subprocess
        try:
            result = subprocess.run(
                ['find', '/nix/store', '-name', 'tesseract', '-type', 'f', '-executable'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                tesseract_path = result.stdout.strip().split('\n')[0]
        except (subprocess.TimeoutExpired, FileNotFoundError, Exception):
            pass
    
    if tesseract_path:
        pytesseract.pytesseract.tesseract_cmd = tesseract_path
        print(f"Configured pytesseract to use: {tesseract_path}", file=sys.stderr)
    else:
        print("Warning: tesseract binary not found, OCR may fail", file=sys.stderr)
        
except ImportError:
    TESSERACT_AVAILABLE = False
    print("Warning: pytesseract not available, OCR will be skipped", file=sys.stderr)

def fix_ocr_errors(text):
    """Fix common OCR errors in sheet numbers and names"""
    if not text:
        return text
    
    # Common OCR errors: O→0, I→1, l→1, S→5, etc.
    # But be careful - don't change actual letters in sheet names
    # Only fix obvious errors in sheet numbers (alphanumeric patterns)
    
    # For sheet numbers (alphanumeric with dots): fix common errors
    if re.match(r'^[A-Z0-9.]+$', text.upper()):
        # This looks like a sheet number
        text = text.replace('O', '0')  # O → 0
        text = text.replace('l', '1')  # lowercase L → 1
        text = text.replace('I', '1')  # I → 1 (but this might be wrong for sheet names)
        text = text.replace('S', '5')  # S → 5 (but this might be wrong)
    
    # General fixes for all text
    # Fix common character confusions
    text = text.replace('０', '0')  # Full-width zero
    text = text.replace('１', '1')  # Full-width one
    text = text.replace('Ｏ', 'O')  # Full-width O
    text = text.replace('Ｉ', 'I')  # Full-width I
    
    return text.strip()

def detect_titleblock_region(image_path):
    """
    Detect titleblock region on the right side of the page.
    Returns bounding box coordinates (x, y, width, height) normalized 0-1.
    """
    if not OPENCV_AVAILABLE:
        # Fallback: Use right 20% of page, full height
        # This is a safe assumption for construction drawings (landscape orientation)
        return {
            'x': 0.80,  # Start at 80% from left
            'y': 0.0,
            'width': 0.20,  # 20% width
            'height': 1.0
        }
    
    img = cv2.imread(image_path)
    if img is None:
        return None
    
    height, width = img.shape[:2]
    
    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Try to detect bordered region on right side
    # Titleblocks are typically on the right 15-25% of the page
    right_region_start = int(width * 0.75)  # Start at 75% from left
    right_region = gray[:, right_region_start:]
    
    # Detect edges to find borders
    edges = cv2.Canny(right_region, 50, 150)
    
    # Find contours (potential borders)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # Find largest rectangular contour (likely the titleblock border)
    titleblock_contour = None
    max_area = 0
    
    for contour in contours:
        # Approximate contour to polygon
        epsilon = 0.02 * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, epsilon, True)
        
        # Check if it's roughly rectangular
        if len(approx) >= 4:
            area = cv2.contourArea(contour)
            if area > max_area:
                max_area = area
                titleblock_contour = contour
    
    if titleblock_contour is not None and max_area > (width * height * 0.01):  # At least 1% of image
        # Get bounding box
        x, y, w, h = cv2.boundingRect(titleblock_contour)
        # Adjust x to account for right_region_start offset
        x += right_region_start
        
        # Normalize coordinates
        return {
            'x': float(x) / width,
            'y': float(y) / height,
            'width': float(w) / width,
            'height': float(h) / height
        }
    
    # Fallback: Use right 20% of page, full height
    # Check if page is landscape (width > height)
    if width > height:
        # Landscape: titleblock on right side
        return {
            'x': 0.80,  # Start at 80% from left
            'y': 0.0,
            'width': 0.20,  # 20% width
            'height': 1.0
        }
    else:
        # Portrait: might be rotated, use right side anyway
        return {
            'x': 0.80,
            'y': 0.0,
            'width': 0.20,
            'height': 1.0
        }

def extract_text_from_region(image_path, region):
    """Extract text from a specific region using OCR"""
    if not TESSERACT_AVAILABLE:
        return []
    
    # Get image dimensions and extract region
    if OPENCV_AVAILABLE:
        img = cv2.imread(image_path)
        if img is None:
            return []
        
        height, width = img.shape[:2]
        
        # Convert region coordinates to pixels
        x = int(region['x'] * width)
        y = int(region['y'] * height)
        w = int(region['width'] * width)
        h = int(region['height'] * height)
        
        # Extract region
        roi = img[y:y+h, x:x+w]
        
        if roi.size == 0:
            return []
        
        # Convert to RGB for pytesseract
        rgb_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2RGB)
        img_width = width
        img_height = height
        roi_x_offset = x
        roi_y_offset = y
        
    elif PIL_AVAILABLE:
        # Use PIL/Pillow as fallback
        img = Image.open(image_path)
        width, height = img.size
        
        # Convert region coordinates to pixels
        x = int(region['x'] * width)
        y = int(region['y'] * height)
        w = int(region['width'] * width)
        h = int(region['height'] * height)
        
        # Extract region
        roi = img.crop((x, y, x + w, y + h))
        
        if roi.size[0] == 0 or roi.size[1] == 0:
            return []
        
        # Convert to RGB (PIL images are already RGB)
        rgb_roi = roi.convert('RGB')
        img_width = width
        img_height = height
        roi_x_offset = x
        roi_y_offset = y
        
    else:
        # No image library available - can't extract region
        print("Error: Neither OpenCV nor PIL available for region extraction", file=sys.stderr)
        return []
    
    # Perform OCR with detailed data
    # pytesseract accepts PIL Images directly, or numpy arrays
    try:
        # Convert to numpy array if using OpenCV, or use PIL Image directly
        if OPENCV_AVAILABLE:
            # OpenCV image is already numpy array
            ocr_input = rgb_roi
        else:
            # PIL Image - pytesseract can use it directly
            ocr_input = rgb_roi
        
        ocr_data = pytesseract.image_to_data(ocr_input, output_type=pytesseract.Output.DICT, config='--psm 6')
        
        text_elements = []
        n_boxes = len(ocr_data['text'])
        
        for i in range(n_boxes):
            text = ocr_data['text'][i].strip()
            conf = int(ocr_data['conf'][i])
            
            if not text or conf < 30:
                continue
            
            # Get bounding box (relative to ROI)
            x_local = ocr_data['left'][i]
            y_local = ocr_data['top'][i]
            w_local = ocr_data['width'][i]
            h_local = ocr_data['height'][i]
            
            # Convert to absolute coordinates (normalized)
            x_abs = (roi_x_offset + x_local) / img_width
            y_abs = (roi_y_offset + y_local) / img_height
            w_abs = w_local / img_width
            h_abs = h_local / img_height
            
            text_elements.append({
                'text': text,
                'confidence': float(conf) / 100.0,
                'bbox': {
                    'x': x_abs,
                    'y': y_abs,
                    'width': w_abs,
                    'height': h_abs
                }
            })
        
        return text_elements
    except Exception as e:
        print(f"OCR error: {str(e)}", file=sys.stderr)
        return []

def extract_sheet_info(text_elements):
    """
    Extract sheet number and name from OCR text elements using pattern matching.
    Returns (sheet_number, sheet_name, confidence)
    """
    sheet_number = "Unknown"
    sheet_name = "Unknown"
    confidence = 0.0
    
    if not text_elements:
        return sheet_number, sheet_name, confidence
    
    # Common label patterns for sheet number
    sheet_number_patterns = [
        r'sheet\s*number\s*:?\s*([A-Z0-9.]+)',
        r'sheet\s*#\s*:?\s*([A-Z0-9.]+)',
        r'dwg\s*no\s*:?\s*([A-Z0-9.]+)',
        r'drawing\s*number\s*:?\s*([A-Z0-9.]+)',
        r'sheet\s*:?\s*([A-Z0-9.]+)',
    ]
    
    # Common label patterns for sheet name
    sheet_name_patterns = [
        r'drawing\s*data\s*:?\s*(.+)',
        r'drawing\s*title\s*:?\s*(.+)',
        r'sheet\s*title\s*:?\s*(.+)',
        r'title\s*:?\s*(.+)',
        r'project\s*name\s*:?\s*(.+)',
    ]
    
    # Combine all text into lines (preserving spatial order)
    # Sort by Y coordinate (top to bottom), then X (left to right)
    sorted_elements = sorted(text_elements, key=lambda e: (e['bbox']['y'], e['bbox']['x']))
    
    # Build text lines by grouping elements that are on the same horizontal line
    lines = []
    current_line = []
    current_y = None
    y_threshold = 0.02  # 2% of image height tolerance
    
    for elem in sorted_elements:
        y = elem['bbox']['y']
        if current_y is None or abs(y - current_y) > y_threshold:
            if current_line:
                lines.append(' '.join([e['text'] for e in current_line]))
            current_line = [elem]
            current_y = y
        else:
            current_line.append(elem)
    
    if current_line:
        lines.append(' '.join([e['text'] for e in current_line]))
    
    # Search for sheet number
    for line in lines:
        line_lower = line.lower()
        for pattern in sheet_number_patterns:
            match = re.search(pattern, line_lower, re.IGNORECASE)
            if match:
                sheet_number = fix_ocr_errors(match.group(1).strip())
                confidence = 0.8
                break
        if sheet_number != "Unknown":
            break
    
    # If no label found, look for standalone sheet number patterns (e.g., "A4.21")
    if sheet_number == "Unknown":
        for elem in sorted_elements:
            text = elem['text'].strip()
            # Pattern: Letter(s) followed by digits and dots (e.g., A4.21, S0.02)
            if re.match(r'^[A-Z][0-9]+\.[0-9]+$', text.upper()):
                sheet_number = fix_ocr_errors(text.upper())
                confidence = 0.6  # Lower confidence without label
                break
    
    # Search for sheet name
    # Sheet names are usually longer and come after "drawing data:" label
    name_started = False
    name_parts = []
    
    for line in lines:
        line_lower = line.lower()
        
        # Check if this line contains a sheet name label
        for pattern in sheet_name_patterns:
            match = re.search(pattern, line_lower, re.IGNORECASE)
            if match:
                # Extract text after the label
                name_text = match.group(1).strip()
                if name_text:
                    name_parts.append(name_text)
                    name_started = True
                break
        
        # If we've started collecting name parts, continue until we hit another label or end
        if name_started:
            # Check if this line is still part of the name (doesn't contain another label)
            is_label = any(re.search(p, line_lower, re.IGNORECASE) for p in sheet_number_patterns)
            if not is_label and line.strip():
                # This might be continuation of the name
                if not any(p in line_lower for p in ['sheet number', 'dwg no', 'drawing number']):
                    name_parts.append(line.strip())
            else:
                # Hit another label, stop collecting
                break
    
    if name_parts:
        sheet_name = ' '.join(name_parts).strip()
        # Clean up common OCR artifacts
        sheet_name = re.sub(r'\s+', ' ', sheet_name)  # Multiple spaces to single
        sheet_name = sheet_name.strip('.,;:')  # Remove trailing punctuation
        if len(sheet_name) > 2:  # Only use if meaningful
            confidence = max(confidence, 0.7)
        else:
            sheet_name = "Unknown"
    
    return sheet_number, sheet_name, confidence

def process_page(pdf_path, page_number, output_dir):
    """Process a single page and extract titleblock info"""
    try:
        # Convert PDF page to image
        doc = fitz.open(pdf_path)
        if page_number > len(doc):
            doc.close()
            return {
                "pageNumber": page_number,
                "sheetNumber": "Unknown",
                "sheetName": "Unknown"
            }
        
        page = doc[page_number - 1]
        zoom = 2.0  # Higher resolution for better OCR
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        
        # Save to temporary image file
        os.makedirs(output_dir, exist_ok=True)
        image_path = os.path.join(output_dir, f"page_{page_number}.png")
        pix.save(image_path)
        
        # Clean up
        pix = None
        doc.close()
        
        # Detect titleblock region
        titleblock_region = detect_titleblock_region(image_path)
        
        if not titleblock_region:
            # Clean up temp image
            try:
                os.remove(image_path)
            except:
                pass
            return {
                "pageNumber": page_number,
                "sheetNumber": "Unknown",
                "sheetName": "Unknown"
            }
        
        # Extract text from titleblock region
        text_elements = extract_text_from_region(image_path, titleblock_region)
        
        # Extract sheet info
        sheet_number, sheet_name, confidence = extract_sheet_info(text_elements)
        
        # Clean up temp image
        try:
            os.remove(image_path)
        except:
            pass
        
        return {
            "pageNumber": page_number,
            "sheetNumber": sheet_number,
            "sheetName": sheet_name
        }
        
    except Exception as e:
        error_msg = str(e)
        print(f"Error processing page {page_number}: {error_msg}", file=sys.stderr)
        return {
            "pageNumber": page_number,
            "sheetNumber": "Unknown",
            "sheetName": "Unknown"
        }

def main():
    """Main entry point"""
    if len(sys.argv) < 3:
        result = {
            "success": False,
            "error": "Missing required arguments. Usage: python3 titleblock_extraction.py <pdf_path> <page_numbers> [output_dir]"
        }
        print(json.dumps(result))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    page_numbers_str = sys.argv[2]
    output_dir = sys.argv[3] if len(sys.argv) > 3 else '/tmp/titleblock-extraction'
    
    # Parse page numbers
    try:
        page_numbers = [int(p.strip()) for p in page_numbers_str.split(',')]
    except ValueError:
        result = {
            "success": False,
            "error": f"Invalid page numbers format: {page_numbers_str}. Expected comma-separated numbers."
        }
        print(json.dumps(result))
        sys.exit(1)
    
    # Process each page
    results = []
    for page_number in page_numbers:
        result = process_page(pdf_path, page_number, output_dir)
        results.append(result)
    
    # Output JSON array
    print(json.dumps(results))
    sys.stdout.flush()

if __name__ == "__main__":
    main()

