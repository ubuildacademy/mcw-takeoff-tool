#!/usr/bin/env python3
"""
Visual Search Script using OpenCV Template Matching

Searches for symbols/patterns in construction drawings by matching a template
image against a larger image using OpenCV's template matching algorithms.

Usage:
    python3 visual_search.py <image_path> <template_path> <confidence_threshold> [method]

Arguments:
    image_path: Path to the full page image to search in
    template_path: Path to the template image (cropped symbol/pattern)
    confidence_threshold: Minimum confidence threshold (0.0-1.0)
    method: Matching method ('cv2.TM_CCOEFF_NORMED', 'cv2.TM_CCORR_NORMED', etc.), default 'cv2.TM_CCOEFF_NORMED'

Output:
    JSON with:
    - success: boolean
    - matches: array of match objects with boundingBox, confidence, etc.
    - totalMatches: number of matches found
    - error: error message (if failed)
"""

import cv2
import numpy as np
import json
import sys
import os

def visual_search(image_path, template_path, confidence_threshold=0.7, method='cv2.TM_CCOEFF_NORMED'):
    """
    Search for template matches in an image using OpenCV template matching
    
    Args:
        image_path: Path to full page image
        template_path: Path to template image (cropped symbol)
        confidence_threshold: Minimum confidence (0.0-1.0)
        method: OpenCV template matching method
    
    Returns:
        dict with success, matches array, totalMatches, or error
    """
    try:
        # Validate inputs
        if confidence_threshold < 0 or confidence_threshold > 1:
            return {
                "success": False,
                "error": f"Confidence threshold must be between 0.0 and 1.0, got {confidence_threshold}"
            }
        
        # Load images
        if not os.path.exists(image_path):
            return {
                "success": False,
                "error": f"Image file not found: {image_path}"
            }
        
        if not os.path.exists(template_path):
            return {
                "success": False,
                "error": f"Template file not found: {template_path}"
            }
        
        img = cv2.imread(image_path)
        template = cv2.imread(template_path)
        
        if img is None:
            return {
                "success": False,
                "error": f"Failed to load image: {image_path}"
            }
        
        if template is None:
            return {
                "success": False,
                "error": f"Failed to load template: {template_path}"
            }
        
        # Get image dimensions
        img_height, img_width = img.shape[:2]
        template_height, template_width = template.shape[:2]
        
        # Validate template is smaller than image
        if template_width > img_width or template_height > img_height:
            return {
                "success": False,
                "error": f"Template ({template_width}x{template_height}) is larger than image ({img_width}x{img_height})"
            }
        
        # Convert to grayscale for matching (more reliable)
        img_gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        template_gray = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
        
        # Parse matching method
        method_map = {
            'cv2.TM_CCOEFF_NORMED': cv2.TM_CCOEFF_NORMED,
            'cv2.TM_CCORR_NORMED': cv2.TM_CCORR_NORMED,
            'cv2.TM_SQDIFF_NORMED': cv2.TM_SQDIFF_NORMED,
            'TM_CCOEFF_NORMED': cv2.TM_CCOEFF_NORMED,
            'TM_CCORR_NORMED': cv2.TM_CCORR_NORMED,
            'TM_SQDIFF_NORMED': cv2.TM_SQDIFF_NORMED
        }
        
        match_method = method_map.get(method, cv2.TM_CCOEFF_NORMED)
        
        # Test multiple rotations: 0°, 90°, 180°, 270°
        # This allows finding symbols in different orientations
        rotations = [0, 90, 180, 270]
        all_detections = []
        
        for rotation in rotations:
            # Rotate template if needed
            if rotation == 0:
                rotated_template = template_gray
                rotated_width = template_width
                rotated_height = template_height
            else:
                # Get rotation matrix
                center = (template_width // 2, template_height // 2)
                rotation_matrix = cv2.getRotationMatrix2D(center, rotation, 1.0)
                
                # Calculate new dimensions after rotation
                cos = np.abs(rotation_matrix[0, 0])
                sin = np.abs(rotation_matrix[0, 1])
                rotated_width = int((template_height * sin) + (template_width * cos))
                rotated_height = int((template_height * cos) + (template_width * sin))
                
                # Adjust rotation matrix for new center
                rotation_matrix[0, 2] += (rotated_width / 2) - center[0]
                rotation_matrix[1, 2] += (rotated_height / 2) - center[1]
                
                # Perform rotation
                rotated_template = cv2.warpAffine(template_gray, rotation_matrix, (rotated_width, rotated_height))
            
            # Perform template matching with rotated template
            result = cv2.matchTemplate(img_gray, rotated_template, match_method)
            
            # For TM_SQDIFF_NORMED, lower values are better, so we invert
            if match_method in [cv2.TM_SQDIFF, cv2.TM_SQDIFF_NORMED]:
                result = 1 - result
            
            # Find all locations where match exceeds threshold
            locations = np.where(result >= confidence_threshold)
            
            # Extract match information with rotation
            for pt in zip(*locations[::-1]):  # Switch x and y coordinates
                x, y = pt
                confidence = float(result[y, x])
                
                all_detections.append({
                    'x': x,
                    'y': y,
                    'width': rotated_width,
                    'height': rotated_height,
                    'confidence': confidence,
                    'rotation': rotation
                })
        
        # Limit total detections to prevent runaway matching
        if len(all_detections) > 1000:
            # Sort by confidence and take top 1000
            all_detections = sorted(all_detections, key=lambda d: d['confidence'], reverse=True)[:1000]
        
        # Group nearby detections to avoid duplicates (distance-based deduplication)
        # Similar to JP Takeoff prototype approach
        matches = []
        match_id = 0
        detected_positions = []
        
        # Sort by confidence (highest first)
        all_detections_sorted = sorted(all_detections, key=lambda d: d['confidence'], reverse=True)
        
        for detection in all_detections_sorted:
            x, y = detection['x'], detection['y']
            w, h = detection['width'], detection['height']
            
            # Check if this position is too close to existing detections
            # Use distance-based threshold (like JP Takeoff: max(width, height) * 0.8)
            min_distance = max(w, h) * 0.8
            too_close = False
            
            for existing_x, existing_y in detected_positions:
                distance = np.sqrt((x - existing_x)**2 + (y - existing_y)**2)
                if distance < min_distance:
                    too_close = True
                    break
            
            if not too_close:
                detected_positions.append((x, y))
                
                # Normalize coordinates (0-1)
                bbox = {
                    "x": float(x) / img_width,
                    "y": float(y) / img_height,
                    "width": float(w) / img_width,
                    "height": float(h) / img_height
                }
                
                # PDF coordinates (pixels)
                pdf_coordinates = {
                    "x": float(x),
                    "y": float(y),
                    "width": float(w),
                    "height": float(h)
                }
                
                matches.append({
                    "id": f"match_{match_id}",
                    "confidence": round(detection['confidence'], 4),
                    "boundingBox": bbox,
                    "pdfCoordinates": pdf_coordinates,
                    "rotation": detection['rotation'],  # Include rotation angle
                    "pageNumber": 1  # Will be set by caller
                })
                
                match_id += 1
        
        # Remove overlapping matches (non-maximum suppression)
        # Keep only the highest confidence match in each overlapping region
        filtered_matches = []
        used = set()
        
        # Sort by confidence (highest first)
        matches_sorted = sorted(matches, key=lambda m: m['confidence'], reverse=True)
        
        for match in matches_sorted:
            x = int(match['pdfCoordinates']['x'])
            y = int(match['pdfCoordinates']['y'])
            w = int(match['pdfCoordinates']['width'])
            h = int(match['pdfCoordinates']['height'])
            
            # Check if this match overlaps significantly with any used match
            overlap = False
            for used_match in filtered_matches:
                ux = int(used_match['pdfCoordinates']['x'])
                uy = int(used_match['pdfCoordinates']['y'])
                uw = int(used_match['pdfCoordinates']['width'])
                uh = int(used_match['pdfCoordinates']['height'])
                
                # Calculate overlap area
                overlap_x = max(0, min(x + w, ux + uw) - max(x, ux))
                overlap_y = max(0, min(y + h, uy + uh) - max(y, uy))
                overlap_area = overlap_x * overlap_y
                
                match_area = w * h
                overlap_ratio = overlap_area / match_area if match_area > 0 else 0
                
                # If overlap is > 50%, skip this match
                if overlap_ratio > 0.5:
                    overlap = True
                    break
            
            if not overlap:
                filtered_matches.append(match)
        
        return {
            "success": True,
            "matches": filtered_matches,
            "totalMatches": len(filtered_matches),
            "imageWidth": img_width,
            "imageHeight": img_height,
            "templateWidth": template_width,
            "templateHeight": template_height
        }
        
    except Exception as e:
        error_msg = str(e)
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": f"Visual search failed: {error_msg}"
        }

def main():
    """Main entry point"""
    if len(sys.argv) < 4:
        result = {
            "success": False,
            "error": "Missing required arguments. Usage: python3 visual_search.py <image_path> <template_path> <confidence_threshold> [method]"
        }
        print(json.dumps(result))
        sys.exit(1)
    
    image_path = sys.argv[1]
    template_path = sys.argv[2]
    confidence_threshold = float(sys.argv[3])
    method = sys.argv[4] if len(sys.argv) > 4 else 'cv2.TM_CCOEFF_NORMED'
    
    result = visual_search(image_path, template_path, confidence_threshold, method)
    print(json.dumps(result))
    
    if not result.get("success"):
        sys.exit(1)

if __name__ == "__main__":
    main()

