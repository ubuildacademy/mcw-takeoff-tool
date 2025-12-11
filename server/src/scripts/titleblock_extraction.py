#!/usr/bin/env python3
"""
Titleblock Extraction Script - Optimized for Vector PDFs

Extracts sheet numbers and names from construction drawing titleblocks.
For vector PDFs: Uses PyMuPDF's native text extraction from right-side region (fast, accurate)
For raster PDFs: Falls back to image rendering + OCR

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
    
    # For sheet numbers (alphanumeric with dots): fix common errors
    if re.match(r'^[A-Z0-9.]+$', text.upper()):
        # This looks like a sheet number
        text = text.replace('O', '0')  # O → 0
        text = text.replace('l', '1')  # lowercase L → 1
        text = text.replace('I', '1')  # I → 1
    
    # General fixes for all text
    text = text.replace('０', '0')  # Full-width zero
    text = text.replace('１', '1')  # Full-width one
    text = text.replace('Ｏ', 'O')  # Full-width O
    text = text.replace('Ｉ', 'I')  # Full-width I
    
    return text.strip()

def extract_text_from_pdf_region(page, region):
    """
    Extract text from a specific region of a PDF page using PyMuPDF's native text extraction.
    This is MUCH faster and more accurate for vector PDFs than OCR.
    
    Args:
        page: PyMuPDF page object
        region: dict with 'x', 'y', 'width', 'height' (normalized 0-1)
    
    Returns:
        List of text elements with bbox info
    """
    try:
        # Get page dimensions
        page_rect = page.rect
        page_width = page_rect.width
        page_height = page_rect.height
        
        # Convert normalized region to absolute coordinates
        x0 = region['x'] * page_width
        y0 = region['y'] * page_height
        x1 = (region['x'] + region['width']) * page_width
        y1 = (region['y'] + region['height']) * page_height
        
        # Create rectangle for the right-side region
        region_rect = fitz.Rect(x0, y0, x1, y1)
        
        # Use clip parameter to directly extract text from the region (more efficient)
        text_dict = page.get_text("dict", clip=region_rect)
        
        text_elements = []
        for block in text_dict.get("blocks", []):
            if block.get("type") != 0:  # Skip non-text blocks
                continue
                
            if "lines" not in block:
                continue
            
            for line in block["lines"]:
                for span in line.get("spans", []):
                    # Get text and bounding box
                    text = span.get("text", "").strip()
                    if not text:
                        continue
                    
                    # Get bbox (PyMuPDF format: [x0, y0, x1, y1])
                    bbox = span.get("bbox", [])
                    if len(bbox) != 4:
                        continue
                    
                    # Normalize bbox coordinates
                    text_elements.append({
                        'text': text,
                        'confidence': 1.0,  # Vector text is perfect
                        'bbox': {
                            'x': bbox[0] / page_width,
                            'y': bbox[1] / page_height,
                            'width': (bbox[2] - bbox[0]) / page_width,
                            'height': (bbox[3] - bbox[1]) / page_height
                        }
                    })
        
        # If no text found in the clipped region, try the entire page as fallback
        # (some PDFs might have text slightly outside the expected region)
        if not text_elements:
            # Try a wider region (right 30% instead of 20%)
            wider_region = fitz.Rect(page_width * 0.70, 0, page_width, page_height)
            text_dict_wide = page.get_text("dict", clip=wider_region)
            
            for block in text_dict_wide.get("blocks", []):
                if block.get("type") != 0:
                    continue
                if "lines" not in block:
                    continue
                
                for line in block["lines"]:
                    for span in line.get("spans", []):
                        text = span.get("text", "").strip()
                        if not text:
                            continue
                        bbox = span.get("bbox", [])
                        if len(bbox) != 4:
                            continue
                        
                        text_elements.append({
                            'text': text,
                            'confidence': 1.0,
                            'bbox': {
                                'x': bbox[0] / page_width,
                                'y': bbox[1] / page_height,
                                'width': (bbox[2] - bbox[0]) / page_width,
                                'height': (bbox[3] - bbox[1]) / page_height
                            }
                        })
        
        return text_elements
    except Exception as e:
        print(f"Error extracting text from PDF region: {str(e)}", file=sys.stderr)
        return []

def detect_titleblock_region(image_path=None, page_width=None, page_height=None):
    """
    Detect titleblock region on the right side of the page.
    Returns bounding box coordinates (x, y, width, height) normalized 0-1.
    
    For vector PDFs, we can use page dimensions directly.
    For raster PDFs, we use image analysis.
    """
    # Use right 20% of page, full height (standard for construction drawings)
    # This is more reliable than trying to detect borders
    return {
        'x': 0.80,  # Start at 80% from left
        'y': 0.0,
        'width': 0.20,  # 20% width
        'height': 1.0
    }

def extract_text_from_region(image_path, region):
    """Extract text from a specific region using OCR (fallback for raster PDFs)"""
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
        img = Image.open(image_path)
        width, height = img.size
        
        x = int(region['x'] * width)
        y = int(region['y'] * height)
        w = int(region['width'] * width)
        h = int(region['height'] * height)
        
        roi = img.crop((x, y, x + w, y + h))
        
        if roi.size[0] == 0 or roi.size[1] == 0:
            return []
        
        rgb_roi = roi.convert('RGB')
        img_width = width
        img_height = height
        roi_x_offset = x
        roi_y_offset = y
        
    else:
        return []
    
    # Perform OCR
    try:
        if OPENCV_AVAILABLE:
            ocr_input = rgb_roi
        else:
            ocr_input = rgb_roi
        
        ocr_data = pytesseract.image_to_data(ocr_input, output_type=pytesseract.Output.DICT, config='--psm 6')
        
        text_elements = []
        n_boxes = len(ocr_data['text'])
        
        for i in range(n_boxes):
            text = ocr_data['text'][i].strip()
            conf = int(ocr_data['conf'][i])
            
            if not text or conf < 30:
                continue
            
            x_local = ocr_data['left'][i]
            y_local = ocr_data['top'][i]
            w_local = ocr_data['width'][i]
            h_local = ocr_data['height'][i]
            
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
    Extract sheet number and name from text elements using pattern matching.
    Prioritizes "drawing data" and "sheet number" patterns (Hilton format).
    Returns (sheet_number, sheet_name, confidence)
    """
    sheet_number = "Unknown"
    sheet_name = "Unknown"
    confidence = 0.0
    
    if not text_elements:
        return sheet_number, sheet_name, confidence
    
    # PRIORITIZE: "drawing data" and "sheet number" patterns first (Hilton format)
    sheet_number_patterns = [
        r'sheet\s*number\s*:?\s*([A-Z0-9.]+)',  # "sheet number: A4.21"
        r'sheet\s*#\s*:?\s*([A-Z0-9.]+)',      # "sheet #: A4.21"
        r'dwg\s*no\s*:?\s*([A-Z0-9.]+)',       # "dwg no: A4.21"
        r'drawing\s*number\s*:?\s*([A-Z0-9.]+)', # "drawing number: A4.21"
        r'sheet\s*:?\s*([A-Z0-9.]+)',          # "sheet: A4.21"
    ]
    
    # PRIORITIZE: "drawing data" first (Hilton format), then other patterns
    sheet_name_patterns = [
        r'drawing\s*data\s*:?\s*(.+)',          # "drawing data: Floor Plan" (Hilton format - PRIORITY)
        r'drawing\s*title\s*:?\s*(.+)',        # "drawing title: Floor Plan"
        r'sheet\s*title\s*:?\s*(.+)',          # "sheet title: Floor Plan"
        r'title\s*:?\s*(.+)',                  # "title: Floor Plan"
        r'project\s*name\s*:?\s*(.+)',         # "project name: Floor Plan"
    ]
    
    # Sort by Y coordinate (top to bottom), then X (left to right)
    sorted_elements = sorted(text_elements, key=lambda e: (e['bbox']['y'], e['bbox']['x']))
    
    # Build text lines by grouping elements on the same horizontal line
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
    
    # If no label found, look for standalone sheet number patterns (e.g., "A4.21", "A-4.21", "A4", "S0.02")
    if sheet_number == "Unknown":
        for elem in sorted_elements:
            text = elem['text'].strip()
            text_upper = text.upper()
            
            # Skip single characters or very short strings that are likely not sheet numbers
            if len(text_upper) < 2:
                continue
            
            # More flexible patterns:
            # - A4.21, S0.02 (letter + digits + dot + digits) - BEST MATCH
            # - A-4.21, S-0.02 (letter + dash + digits + dot + digits)
            # - A4, S0 (letter + digits, but require at least 2 chars total and digit after letter)
            if re.match(r'^[A-Z][0-9]+\.[0-9]+$', text_upper):  # A4.21
                sheet_number = fix_ocr_errors(text_upper)
                confidence = 0.6
                break
            elif re.match(r'^[A-Z]-?[0-9]+\.[0-9]+$', text_upper):  # A-4.21 or A4.21
                sheet_number = fix_ocr_errors(text_upper)
                confidence = 0.6
                break
            elif re.match(r'^[A-Z][0-9]+$', text_upper) and len(text_upper) >= 2 and len(text_upper) <= 5:  # A4, S0 (require at least letter+digit)
                # Additional check: must have at least one digit
                if re.search(r'[0-9]', text_upper):
                    sheet_number = fix_ocr_errors(text_upper)
                    confidence = 0.5  # Lower confidence for shorter patterns
                    break
    
    # Search for sheet name - prioritize "drawing data"
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
        doc = fitz.open(pdf_path)
        if page_number > len(doc):
            doc.close()
            return {
                "pageNumber": page_number,
                "sheetNumber": "Unknown",
                "sheetName": "Unknown"
            }
        
        page = doc[page_number - 1]
        page_width = page.rect.width
        page_height = page.rect.height
        
        text_elements = []
        
        # Strategy 1: Use custom titleblock region if provided via environment,
        # otherwise fall back to automatic right-side detection.
        custom_region_str = os.environ.get('TITLEBLOCK_REGION')
        if custom_region_str:
            try:
                parts = [float(p.strip()) for p in custom_region_str.split(',')]
                if len(parts) == 4:
                    titleblock_region = {
                        'x': parts[0],
                        'y': parts[1],
                        'width': parts[2],
                        'height': parts[3]
                    }
                    print(f\"Page {page_number}: Using custom TITLEBLOCK_REGION={titleblock_region}\", file=sys.stderr)
                else:
                    print(f\"Page {page_number}: Invalid TITLEBLOCK_REGION format '{custom_region_str}', falling back to auto-detect\", file=sys.stderr)
                    titleblock_region = detect_titleblock_region()
            except Exception as e:
                print(f\"Page {page_number}: Failed to parse TITLEBLOCK_REGION '{custom_region_str}': {e}, falling back to auto-detect\", file=sys.stderr)
                titleblock_region = detect_titleblock_region()
        else:
            titleblock_region = detect_titleblock_region()
        
        text_elements = extract_text_from_pdf_region(page, titleblock_region)
        
        if text_elements:
            print(f"Page {page_number}: Found {len(text_elements)} text elements in right region (20%)", file=sys.stderr)
        else:
            # Strategy 2: Try wider right region (30% width)
            wider_region = {'x': 0.70, 'y': 0.0, 'width': 0.30, 'height': 1.0}
            text_elements = extract_text_from_pdf_region(page, wider_region)
            if text_elements:
                print(f"Page {page_number}: Found {len(text_elements)} text elements in wider right region (30%)", file=sys.stderr)
        
        # Strategy 3: If still nothing, try bottom-right corner (common for titleblocks)
        if not text_elements:
            bottom_right_region = {'x': 0.70, 'y': 0.85, 'width': 0.30, 'height': 0.15}
            text_elements = extract_text_from_pdf_region(page, bottom_right_region)
            if text_elements:
                print(f"Page {page_number}: Found {len(text_elements)} text elements in bottom-right corner", file=sys.stderr)
        
        # Strategy 4: Last resort - extract from ENTIRE page and filter for titleblock patterns
        if not text_elements:
            print(f"Page {page_number}: No text in expected regions, trying entire page...", file=sys.stderr)
            full_page_region = {'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0}
            all_text_elements = extract_text_from_pdf_region(page, full_page_region)
            
            if all_text_elements:
                print(f"Page {page_number}: Found {len(all_text_elements)} text elements on entire page", file=sys.stderr)
                # Filter to right-side elements (x > 0.7) or bottom elements (y > 0.8)
                filtered = []
                for elem in all_text_elements:
                    bbox = elem.get('bbox', {})
                    x = bbox.get('x', 0)
                    y = bbox.get('y', 0)
                    # Include if in right 30% OR bottom 20%
                    if x >= 0.70 or y >= 0.80:
                        filtered.append(elem)
                
                if filtered:
                    text_elements = filtered
                    print(f"Page {page_number}: Filtered to {len(text_elements)} elements in titleblock areas", file=sys.stderr)
                else:
                    # If no filtering worked, use all text (better than nothing)
                    text_elements = all_text_elements
                    print(f"Page {page_number}: Using all {len(text_elements)} text elements from page", file=sys.stderr)
        
        # Strategy 5: If still no vector text and OCR is available, try OCR (but it's broken in deployment)
        if not text_elements and TESSERACT_AVAILABLE:
            try:
                print(f"Page {page_number}: Attempting OCR fallback...", file=sys.stderr)
                zoom = 2.0
                mat = fitz.Matrix(zoom, zoom)
                pix = page.get_pixmap(matrix=mat, alpha=False)
                
                os.makedirs(output_dir, exist_ok=True)
                image_path = os.path.join(output_dir, f"page_{page_number}.png")
                pix.save(image_path)
                
                # Try right region first
                text_elements = extract_text_from_region(image_path, titleblock_region)
                if not text_elements:
                    # Try wider region
                    text_elements = extract_text_from_region(image_path, wider_region)
                
                if text_elements:
                    print(f"Page {page_number}: OCR found {len(text_elements)} text elements", file=sys.stderr)
                
                try:
                    os.remove(image_path)
                except:
                    pass
                
                pix = None
            except Exception as ocr_error:
                print(f"Page {page_number}: OCR fallback failed: {str(ocr_error)}", file=sys.stderr)
        
        doc.close()
        
        # Extract sheet info from text elements
        sheet_number, sheet_name, confidence = extract_sheet_info(text_elements)
        
        # Debug: log extraction results
        if sheet_number != "Unknown" or sheet_name != "Unknown":
            print(f"Page {page_number}: ✅ Extracted sheetNumber='{sheet_number}', sheetName='{sheet_name}'", file=sys.stderr)
        else:
            # If extraction failed, log sample text for debugging
            if text_elements:
                sample_texts = [elem['text'] for elem in text_elements[:10]]
                print(f"Page {page_number}: ❌ Extraction failed. Sample text found: {sample_texts}", file=sys.stderr)
            else:
                print(f"Page {page_number}: ❌ No text elements found at all", file=sys.stderr)
        
        return {
            "pageNumber": page_number,
            "sheetNumber": sheet_number,
            "sheetName": sheet_name
        }
        
    except Exception as e:
        error_msg = str(e)
        print(f"Error processing page {page_number}: {error_msg}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
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
