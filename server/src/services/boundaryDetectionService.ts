/**
 * Boundary Detection Service
 * 
 * Uses computer vision to detect architectural elements by their boundaries:
 * - Rooms: Closed polygons (contours)
 * - Walls: Line segments
 * - Doors/Windows: Symbol detection or opening detection
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

export interface RoomBoundary {
  points: Array<{ x: number; y: number }>; // Normalized 0-1 coordinates
  area: number; // Square feet
  perimeter: number; // Linear feet
  confidence: number;
  roomLabel?: string; // If OCR can identify room name
}

export interface WallSegment {
  start: { x: number; y: number }; // Normalized 0-1 coordinates
  end: { x: number; y: number };
  length: number; // Linear feet
  confidence: number;
  thickness?: number; // Wall thickness in feet
}

export interface DoorWindow {
  type: 'door' | 'window';
  bbox: { x: number; y: number; width: number; height: number }; // Normalized 0-1
  opening: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    width: number; // Linear feet
  };
  confidence: number;
}

export interface OCRTextElement {
  text: string;
  confidence: number;
  bbox: {
    x: number; // Normalized 0-1
    y: number; // Normalized 0-1
    width: number; // Normalized 0-1
    height: number; // Normalized 0-1
  };
  type?: 'room_label' | 'dimension' | 'note' | 'other';
}

export interface BoundaryDetectionResult {
  rooms: RoomBoundary[];
  walls: WallSegment[];
  doors: DoorWindow[];
  windows: DoorWindow[];
  ocrText: OCRTextElement[]; // OCR text with coordinates
  processingTime: number;
  imageWidth: number;
  imageHeight: number;
}

export interface DetectionOptions {
  minRoomArea?: number; // Minimum room area in square feet (default: 50 SF)
  minWallLength?: number; // Minimum wall length in feet (default: 2 LF)
  edgeThreshold1?: number; // Canny edge detection threshold 1 (default: 50)
  edgeThreshold2?: number; // Canny edge detection threshold 2 (default: 150)
  contourApproximationEpsilon?: number; // Polygon simplification factor (default: 0.02)
  scaleFactor?: number; // Scale factor from pixels to feet (will be calculated from calibration)
}

class BoundaryDetectionService {
  private pythonScriptPath: string;
  private tempDir: string;
  private cachedGlibLibPath: string | null = null;

  constructor() {
    // Path to Python CV detection script (will be created dynamically)
    // Use the same pattern as other services (titleblockExtractionService, visualSearchService, pythonPdfConverter)
    // In compiled: __dirname = /app/server/dist/services
    // In source: __dirname = /app/server/src/services
    
    // Determine script path (works in both source and compiled)
    const isCompiled = __dirname.includes('dist');
    // Detect production: check for Railway environment or if we're in /app (Railway's working directory)
    const isProduction = process.env.RAILWAY_ENVIRONMENT || 
                         process.env.NODE_ENV === 'production' || 
                         process.cwd() === '/app' ||
                         __dirname.startsWith('/app/');
    
    // In production, use /tmp for scripts (writable and reliable)
    // In dev, use the server/src/scripts directory
    if (isProduction) {
      // Production: use /tmp for script storage (always writable)
      this.pythonScriptPath = '/tmp/cv_boundary_detection.py';
      this.tempDir = '/tmp/cv-detection';
    } else {
      // Development: use server/src/scripts
      const baseDir = isCompiled 
        ? path.join(__dirname, '..', '..') // dist/services -> dist -> server root
        : path.join(__dirname, '..'); // src/services -> src -> server root

      // Scripts are always in src/scripts (not dist)
      // Use absolute path to avoid any relative path issues
      this.pythonScriptPath = path.resolve(path.join(baseDir, 'src', 'scripts', 'cv_boundary_detection.py'));
      
      // In dev, check if cwd is server/ or repo root
      const cwd = process.cwd();
      if (cwd.endsWith('server') || cwd.endsWith('server/')) {
        this.tempDir = path.join(cwd, 'temp', 'cv-detection');
      } else {
        this.tempDir = path.join(cwd, 'server', 'temp', 'cv-detection');
      }
    }
    
    // Ensure temp directory exists
    fs.ensureDirSync(this.tempDir);
    fs.ensureDirSync(path.dirname(this.pythonScriptPath));
    
    console.log(`📁 Python script path: ${this.pythonScriptPath}`);
    console.log(`📁 Temp directory: ${this.tempDir}`);
    console.log(`📁 Process CWD: ${process.cwd()}`);
    console.log(`📁 __dirname: ${__dirname}`);
    console.log(`📁 Is compiled: ${isCompiled}`);
    console.log(`📁 Is production: ${isProduction}`);
  }

  /**
   * Get enhanced PATH for Railway/Nixpacks environments
   */
  private getEnhancedPath(): string {
    return [
      '/opt/venv/bin',           // Railway Nixpacks virtual environment
      '/nix/var/nix/profiles/default/bin',  // Nix default profile
      '/root/.nix-profile/bin',   // Nix user profile
      '/usr/local/bin',          // Common system location
      '/usr/bin',                // Standard system location
      '/bin',                    // Basic system location
      process.env.PATH || ''     // Existing PATH
    ].filter(Boolean).join(':');
  }

  /**
   * Find glib library directory in Nix store (cached)
   */
  private async findGlibLibPath(): Promise<string> {
    if (this.cachedGlibLibPath !== null) {
      return this.cachedGlibLibPath;
    }

    try {
      // Try to find libgthread-2.0.so.0 in the Nix store
      const { stdout } = await execAsync(
        "find /nix/store -name 'libgthread-2.0.so.0' 2>/dev/null | head -1 | xargs dirname 2>/dev/null || echo ''",
        { timeout: 5000 }
      );
      const glibPath = stdout.trim();
      if (glibPath) {
        this.cachedGlibLibPath = glibPath;
        console.log(`✅ Found glib libraries at: ${glibPath}`);
        return glibPath;
      }
    } catch (error) {
      console.warn(`⚠️ Could not find glib libraries: ${error}`);
    }

    this.cachedGlibLibPath = '';
    return '';
  }

  /**
   * Get enhanced LD_LIBRARY_PATH for OpenCV to find shared libraries
   */
  private async getEnhancedLdLibraryPath(): Promise<string> {
    const glibLibPath = await this.findGlibLibPath();
    const paths = [
      glibLibPath,                          // Glib libraries from Nix store (if found)
      '/nix/var/nix/profiles/default/lib',  // Nix default profile libs
      '/root/.nix-profile/lib',             // Nix user profile libs
      '/usr/lib',                           // System libs
      '/usr/local/lib',                     // Local libs
      process.env.LD_LIBRARY_PATH || ''     // Existing LD_LIBRARY_PATH
    ].filter(Boolean);
    return paths.join(':');
  }

  /**
   * Detect boundaries in a construction drawing image
   */
  async detectBoundaries(
    imageData: string, // Base64 encoded image
    scaleFactor: number, // Scale factor from pixels to feet
    options: DetectionOptions = {}
  ): Promise<BoundaryDetectionResult> {
    const startTime = Date.now();
    let imageId: string | undefined;
    let imagePath: string | undefined;
    const opts = {
      minRoomArea: options.minRoomArea || 50, // 50 square feet minimum
      minWallLength: options.minWallLength || 2, // 2 linear feet minimum
      edgeThreshold1: options.edgeThreshold1 || 50,
      edgeThreshold2: options.edgeThreshold2 || 150,
      contourApproximationEpsilon: options.contourApproximationEpsilon || 0.02,
      scaleFactor: scaleFactor || 1.0
    };

    try {
      // Save image to temp file
      imageId = uuidv4();
      imagePath = path.join(this.tempDir, `${imageId}.png`);
      const imageBuffer = Buffer.from(imageData, 'base64');
      await fs.writeFile(imagePath, imageBuffer);

      // Call Python script for boundary detection
      const pythonScript = `
import cv2
import numpy as np
import json
import sys
import os

# OCR/Tesseract is disabled for now - CV detection works without it
# Can be re-enabled later if needed
TESSERACT_AVAILABLE = False
TESSERACT_BINARY_AVAILABLE = False

def detect_rooms(image_path, scale_factor, min_area_sf, epsilon):
    """Detect room boundaries - rooms are enclosed spaces surrounded by walls"""
    img = cv2.imread(image_path)
    if img is None:
        return []
    
    height, width = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # OCR disabled for now - using geometric filtering only
    text_regions = []
    
    # Apply Gaussian blur to reduce noise
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Edge detection - rooms are surrounded by walls, so we need to detect closed boundaries
    edges = cv2.Canny(blurred, 50, 150)
    
    # Morphological operations to close gaps in walls
    # Use a larger kernel to better connect wall segments
    kernel = np.ones((5, 5), np.uint8)
    dilated = cv2.dilate(edges, kernel, iterations=2)
    # Then erode to restore approximate original size
    closed = cv2.erode(dilated, kernel, iterations=1)
    
    # Find ALL contours including internal ones (rooms inside the building)
    # RETR_TREE gets all contours with full hierarchy
    # RETR_CCOMP might be better for finding enclosed spaces
    contours, hierarchy = cv2.findContours(closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    rooms = []
    min_area_pixels = (min_area_sf / (scale_factor ** 2)) if scale_factor > 0 else 1000
    # Maximum area to filter out the entire floor plan - lowered to 50% to exclude full page
    max_area_pixels = (width * height) * 0.5
    
    # Define exclusion zones for title blocks (typically at edges)
    # Exclude top 15%, bottom 15%, left 10%, right 10% of image
    exclude_top = height * 0.15
    exclude_bottom = height * 0.85
    exclude_left = width * 0.10
    exclude_right = width * 0.90
    
    # Track processed contours to avoid duplicates
    processed_contours = set()
    
    for i, contour in enumerate(contours):
        # Skip if already processed
        contour_id = id(contour)
        if contour_id in processed_contours:
            continue
        
        area_pixels = cv2.contourArea(contour)
        
        # Skip if too small (likely noise or furniture)
        if area_pixels < min_area_pixels:
            continue
        
        # Skip if too large (likely the entire floor plan or building outline)
        if area_pixels > max_area_pixels:
            continue
        
        # Get bounding box to check aspect ratio and position
        x, y, w, h = cv2.boundingRect(contour)
        aspect_ratio = max(w, h) / min(w, h) if min(w, h) > 0 else 0
        
        # Filter out extremely elongated shapes (likely corridors) - relaxed from 8 to 10
        if aspect_ratio > 10:
            continue
        
        # Exclude title blocks and edge areas
        bbox_center_x = x + w / 2
        bbox_center_y = y + h / 2
        
        # Check if bounding box is in exclusion zones (title blocks)
        if (y < exclude_top or y + h > exclude_bottom or 
            x < exclude_left or x + w > exclude_right):
            # Additional check: if it's mostly in an exclusion zone, skip it
            exclusion_overlap = 0
            if y < exclude_top:
                exclusion_overlap += min(h, exclude_top - y) * w
            if y + h > exclude_bottom:
                exclusion_overlap += min(h, (y + h) - exclude_bottom) * w
            if x < exclude_left:
                exclusion_overlap += min(w, exclude_left - x) * h
            if x + w > exclude_right:
                exclusion_overlap += min(w, (x + w) - exclude_right) * h
            
            # If more than 30% of bounding box is in exclusion zones, skip
            if exclusion_overlap > (w * h * 0.3):
                continue
        
        # Text density filtering disabled (OCR not available)
        # Using only geometric exclusion zones for title blocks
        
        # Check if contour is approximately closed (rooms should be enclosed)
        # Calculate how close the start and end points are
        if len(contour) > 0:
            start_point = contour[0][0]
            end_point = contour[-1][0]
            closure_dist = np.sqrt((start_point[0] - end_point[0])**2 + (start_point[1] - end_point[1])**2)
            perimeter = cv2.arcLength(contour, True)
            # If start and end are far apart relative to perimeter, it's not closed
            # Relaxed from 0.1 to 0.15 to allow slightly more open contours
            if perimeter > 0 and closure_dist / perimeter > 0.15:
                continue
        
        # Simplify contour (reduce vertices while preserving shape)
        epsilon_factor = epsilon * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, epsilon_factor, True)
        
        # Skip if simplified contour has too few points (likely noise)
        # Relaxed from 4 to 3 to catch simpler shapes
        if len(approx) < 3:
            continue
        
        # Convert to normalized coordinates (0-1)
        points = []
        for point in approx:
            x_norm = float(point[0][0]) / width
            y_norm = float(point[0][1]) / height
            points.append({"x": x_norm, "y": y_norm})
        
        # Calculate area in square feet
        area_sf = area_pixels * (scale_factor ** 2)
        
        # Calculate perimeter in linear feet
        perimeter_pixels = cv2.arcLength(contour, True)
        perimeter_lf = perimeter_pixels * scale_factor
        
        # Confidence based on multiple factors:
        # 1. Contour regularity (closer to rectangle = higher confidence)
        bbox_area = w * h
        regularity = area_pixels / bbox_area if bbox_area > 0 else 0
        
        # 2. Size appropriateness (typical rooms are 100-500 SF)
        size_score = 1.0
        if area_sf < 50 or area_sf > 2000:
            size_score = 0.7  # Lower confidence for unusual sizes
        
        # 3. Aspect ratio (rooms are usually somewhat rectangular, not extremely elongated)
        aspect_score = 1.0 if aspect_ratio < 3 else max(0.5, 1.0 - (aspect_ratio - 3) * 0.1)
        
        confidence = min(0.95, 0.5 + regularity * 0.3) * size_score * aspect_score
        
        rooms.append({
            "points": points,
            "area": round(area_sf, 2),
            "perimeter": round(perimeter_lf, 2),
            "confidence": round(confidence, 3)
        })
        
        processed_contours.add(contour_id)
    
    # Sort by confidence (highest first) and limit to reasonable number
    rooms.sort(key=lambda r: r["confidence"], reverse=True)
    
    # Limit to top rooms (reasonable number for a single page)
    rooms = rooms[:100]
    
    return rooms

def detect_walls(image_path, scale_factor, min_length_lf):
    """Detect wall segments and merge connected segments into continuous stretches"""
    img = cv2.imread(image_path)
    if img is None:
        return []
    
    height, width = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Apply Gaussian blur
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Edge detection
    edges = cv2.Canny(blurred, 50, 150)
    
    # Hough Line Transform with stricter parameters to reduce false positives
    min_line_length_pixels = max(30, min_length_lf / scale_factor * 0.5) if scale_factor > 0 else 30
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=100, minLineLength=int(min_line_length_pixels), maxLineGap=20)
    
    if lines is None or len(lines) == 0:
        return []
    
    # Convert lines to wall segments with pixel coordinates
    segments = []
    min_length_pixels = min_length_lf / scale_factor if scale_factor > 0 else 20
    
    for line in lines:
        x1, y1, x2, y2 = line[0]
        
        # Calculate length
        length_pixels = np.sqrt((x2 - x1)**2 + (y2 - y1)**2)
        length_lf = length_pixels * scale_factor
        
        if length_pixels < min_length_pixels:
            continue
        
        segments.append({
            "start": (x1, y1),
            "end": (x2, y2),
            "length": length_pixels
        })
    
    if len(segments) == 0:
        return []
    
    # Merge connected segments into continuous wall stretches
    # Two segments are connected if their endpoints are close together
    CONNECTION_THRESHOLD = 15  # pixels
    
    def distance(p1, p2):
        return np.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)
    
    def are_connected(seg1, seg2):
        """Check if two segments can be connected"""
        # Check all endpoint combinations
        d1 = distance(seg1["end"], seg2["start"])
        d2 = distance(seg1["end"], seg2["end"])
        d3 = distance(seg1["start"], seg2["start"])
        d4 = distance(seg1["start"], seg2["end"])
        
        return min(d1, d2, d3, d4) < CONNECTION_THRESHOLD
    
    def merge_segments(seg1, seg2):
        """Merge two connected segments"""
        # Find the two endpoints that are farthest apart
        points = [seg1["start"], seg1["end"], seg2["start"], seg2["end"]]
        max_dist = 0
        merged_start = points[0]
        merged_end = points[1]
        
        for i in range(len(points)):
            for j in range(i + 1, len(points)):
                dist = distance(points[i], points[j])
                if dist > max_dist:
                    max_dist = dist
                    merged_start = points[i]
                    merged_end = points[j]
        
        return {
            "start": merged_start,
            "end": merged_end,
            "length": max_dist
        }
    
    # Group segments into connected chains
    merged_walls = []
    used = [False] * len(segments)
    
    for i in range(len(segments)):
        if used[i]:
            continue
        
        # Start a new wall chain
        current_wall = segments[i]
        used[i] = True
        changed = True
        
        # Keep merging connected segments until no more connections found
        while changed:
            changed = False
            for j in range(len(segments)):
                if used[j]:
                    continue
                
                if are_connected(current_wall, segments[j]):
                    current_wall = merge_segments(current_wall, segments[j])
                    used[j] = True
                    changed = True
        
        # Convert merged wall to normalized coordinates
        length_lf = current_wall["length"] * scale_factor
        if length_lf >= min_length_lf:
            merged_walls.append({
                "start": {"x": float(current_wall["start"][0]) / width, "y": float(current_wall["start"][1]) / height},
                "end": {"x": float(current_wall["end"][0]) / width, "y": float(current_wall["end"][1]) / height},
                "length": round(length_lf, 2),
                "confidence": min(0.95, 0.7 + (length_lf / 200) * 0.1)  # Higher confidence for longer walls
            })
    
    # Sort by length (longest first) and limit to reasonable number
    merged_walls.sort(key=lambda w: w["length"], reverse=True)
    
    # Limit to top walls (should be 3-4 stretches per floor plan)
    merged_walls = merged_walls[:50]  # Reasonable limit for a single page
    
    return merged_walls

def detect_openings(image_path, scale_factor):
    """Detect doors and windows by finding openings in walls"""
    img = cv2.imread(image_path)
    if img is None:
        return [], []
    
    height, width = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # This is a simplified detection - in production, you'd use more sophisticated methods
    # For now, detect rectangular openings
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    
    # Find contours that might be openings
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    doors = []
    windows = []
    
    for contour in contours:
        area_pixels = cv2.contourArea(contour)
        if area_pixels < 100:  # Too small
            continue
        
        # Approximate as rectangle
        epsilon = 0.02 * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, epsilon, True)
        
        if len(approx) == 4:  # Rectangle
            x, y, w, h = cv2.boundingRect(contour)
            
            # Determine if door or window based on size
            width_lf = w * scale_factor
            height_lf = h * scale_factor
            
            # Doors are typically wider (2.5-3.5 feet) and taller
            # Windows are typically narrower and shorter
            if 2.0 <= width_lf <= 4.0 and height_lf >= 6.0:
                # Likely a door
                doors.append({
                    "type": "door",
                    "bbox": {
                        "x": float(x) / width,
                        "y": float(y) / height,
                        "width": float(w) / width,
                        "height": float(h) / height
                    },
                    "opening": {
                        "start": {"x": float(x) / width, "y": float(y + h/2) / height},
                        "end": {"x": float(x + w) / width, "y": float(y + h/2) / height},
                        "width": round(width_lf, 2)
                    },
                    "confidence": 0.6
                })
            elif 1.0 <= width_lf <= 3.0 and height_lf <= 5.0:
                # Likely a window
                windows.append({
                    "type": "window",
                    "bbox": {
                        "x": float(x) / width,
                        "y": float(y) / height,
                        "width": float(w) / width,
                        "height": float(h) / height
                    },
                    "opening": {
                        "start": {"x": float(x) / width, "y": float(y + h/2) / height},
                        "end": {"x": float(x + w) / width, "y": float(y + h/2) / height},
                        "width": round(width_lf, 2)
                    },
                    "confidence": 0.6
                })
    
    return doors, windows

def detect_text_ocr(image_path):
    """Detect text using OCR with bounding boxes"""
    if not TESSERACT_AVAILABLE or not TESSERACT_BINARY_AVAILABLE:
        return []
    
    try:
        img = cv2.imread(image_path)
        if img is None:
            return []
        
        height, width = img.shape[:2]
        
        # Convert to RGB for pytesseract (it expects RGB)
        rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        
        # Get detailed OCR data with bounding boxes
        # Using --psm 6 (Assume a single uniform block of text) for architectural drawings
        try:
            ocr_data = pytesseract.image_to_data(rgb_img, output_type=pytesseract.Output.DICT, config='--psm 6')
        except Exception as tesseract_err:
            print(f"Tesseract OCR call failed: {str(tesseract_err)}", file=sys.stderr)
            return []
        
        text_elements = []
        
        # Process OCR results
        n_boxes = len(ocr_data['text'])
        for i in range(n_boxes):
            text = ocr_data['text'][i].strip()
            conf = int(ocr_data['conf'][i])
            
            # Skip empty text or low confidence
            if not text or conf < 30:
                continue
            
            # Get bounding box coordinates
            x = ocr_data['left'][i]
            y = ocr_data['top'][i]
            w = ocr_data['width'][i]
            h = ocr_data['height'][i]
            
            # Normalize coordinates (0-1)
            x_norm = float(x) / width
            y_norm = float(y) / height
            w_norm = float(w) / width
            h_norm = float(h) / height
            
            # Classify text type based on patterns
            text_lower = text.lower()
            text_type = 'other'
            
            # Room labels: numbers, "room", "bedroom", etc.
            if any(keyword in text_lower for keyword in ['room', 'bedroom', 'bath', 'kitchen', 'closet', 'office', 'hall', 'corridor']):
                text_type = 'room_label'
            elif text.replace('.', '').replace('-', '').isdigit() and len(text) <= 4:
                # Short numeric strings are likely room numbers
                text_type = 'room_label'
            elif any(char in text for char in ["'", '"', 'ft', 'in', 'cm', 'm']) or any(char.isdigit() for char in text):
                # Contains measurement units or numbers - likely dimension
                text_type = 'dimension'
            elif len(text) > 20:
                # Long text is likely a note
                text_type = 'note'
            
            text_elements.append({
                "text": text,
                "confidence": float(conf) / 100.0,  # Convert to 0-1 scale
                "bbox": {
                    "x": x_norm,
                    "y": y_norm,
                    "width": w_norm,
                    "height": h_norm
                },
                "type": text_type
            })
        
        return text_elements
    except Exception as e:
        # Log the error but don't crash - return empty list
        print(f"OCR detection error in detect_text_ocr: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return []

# Main execution
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Missing arguments"}))
        sys.exit(1)
    
    image_path = sys.argv[1]
    scale_factor = float(sys.argv[2])
    min_room_area = float(sys.argv[3]) if len(sys.argv) > 3 else 50.0
    min_wall_length = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0
    epsilon = float(sys.argv[5]) if len(sys.argv) > 5 else 0.02
    
    try:
        # Validate image file exists
        if not os.path.exists(image_path):
            print(json.dumps({"error": f"Image file not found: {image_path}"}))
            sys.exit(1)
        
        # Get image dimensions
        img = cv2.imread(image_path)
        if img is None:
            print(json.dumps({"error": f"Failed to load image: {image_path}"}))
            sys.exit(1)
        
        height, width = img.shape[:2]
        
        # Detect elements
        rooms = detect_rooms(image_path, scale_factor, min_room_area, epsilon)
        walls = detect_walls(image_path, scale_factor, min_wall_length)
        doors, windows = detect_openings(image_path, scale_factor)
        
        # OCR disabled - CV detection works without it
        ocr_text = []
        
        result = {
            "rooms": rooms,
            "walls": walls,
            "doors": doors,
            "windows": windows,
            "ocrText": ocr_text,
            "imageWidth": width,
            "imageHeight": height
        }
        
        print(json.dumps(result))
        sys.stdout.flush()  # Ensure output is flushed
    except Exception as e:
        import traceback
        error_msg = f"{str(e)}\\nTraceback:\\n{traceback.format_exc()}"
        print(json.dumps({"error": error_msg}), file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)
`;

      // Write Python script if it doesn't exist
      if (!await fs.pathExists(this.pythonScriptPath)) {
        try {
          await fs.ensureDir(path.dirname(this.pythonScriptPath));
          await fs.writeFile(this.pythonScriptPath, pythonScript);
          // Make script executable (Unix/Linux/Mac)
          if (process.platform !== 'win32') {
            await execAsync(`chmod +x "${this.pythonScriptPath}"`).catch(() => {
              // Ignore errors - script will still work without execute permission
            });
          }
          console.log(`✅ Created Python script at: ${this.pythonScriptPath}`);
        } catch (writeError) {
          const errorDetails = {
            scriptPath: this.pythonScriptPath,
            dirname: path.dirname(this.pythonScriptPath),
            dirExists: await fs.pathExists(path.dirname(this.pythonScriptPath)),
            cwd: process.cwd(),
            error: writeError instanceof Error ? writeError.message : String(writeError)
          };
          console.error('❌ Failed to create Python script:', JSON.stringify(errorDetails, null, 2));
          throw new Error(`Failed to create Python script at ${this.pythonScriptPath}: ${errorDetails.error}`);
        }
      } else {
        console.log(`✅ Python script exists at: ${this.pythonScriptPath}`);
      }
      
      // Verify script exists and is readable before executing
      const scriptExists = await fs.pathExists(this.pythonScriptPath);
      if (!scriptExists) {
        throw new Error(`Python script was not created at expected path: ${this.pythonScriptPath}`);
      }
      
      // Verify script is readable
      try {
        const stats = await fs.stat(this.pythonScriptPath);
        if (stats.size === 0) {
          throw new Error(`Python script exists but is empty: ${this.pythonScriptPath}`);
        }
        console.log(`✅ Python script verified: ${stats.size} bytes`);
      } catch (statError) {
        console.error(`❌ Failed to verify Python script: ${statError}`);
        throw new Error(`Python script exists but cannot be read: ${this.pythonScriptPath}`);
      }

      // Check Python availability before executing
      const statusDetails = await this.getStatusDetails();
      if (!statusDetails.pythonAvailable || !statusDetails.opencvAvailable) {
        const errorDetails = {
          pythonAvailable: statusDetails.pythonAvailable,
          opencvAvailable: statusDetails.opencvAvailable,
          pythonVersion: statusDetails.pythonVersion,
          opencvVersion: statusDetails.opencvVersion,
          error: statusDetails.error,
          platform: process.platform,
          nodeVersion: process.version,
          cwd: process.cwd(),
          enhancedPath: this.getEnhancedPath(),
          scriptPath: this.pythonScriptPath,
          scriptExists: await fs.pathExists(this.pythonScriptPath)
        };
        console.error('❌ Python/OpenCV not available before execution:', JSON.stringify(errorDetails, null, 2));
        throw new Error(`Python/OpenCV not available. ${statusDetails.error || 'Unknown error'}. Details: ${JSON.stringify(errorDetails)}`);
      }

      // Execute Python script
      // Find Python command using the same logic as getStatusDetails
      const pythonCommand = await this.findPythonCommand();
      if (!pythonCommand) {
        throw new Error('Python command not found. Please ensure Python 3 is installed and available in PATH.');
      }
      const command = `${pythonCommand} "${this.pythonScriptPath}" "${imagePath}" ${opts.scaleFactor} ${opts.minRoomArea} ${opts.minWallLength} ${opts.contourApproximationEpsilon}`;
      
      console.log(`🔍 Executing boundary detection:`);
      console.log(`   Command: ${command}`);
      console.log(`   Python: ${statusDetails.pythonVersion || 'unknown'}`);
      console.log(`   OpenCV: ${statusDetails.opencvVersion || 'unknown'}`);
      console.log(`   Script path: ${this.pythonScriptPath}`);
      console.log(`   Script exists: ${await fs.pathExists(this.pythonScriptPath)}`);
      console.log(`   Image path: ${imagePath}`);
      console.log(`   Image exists: ${await fs.pathExists(imagePath)}`);
      console.log(`   Enhanced PATH: ${this.getEnhancedPath()}`);
      const enhancedLdPath = await this.getEnhancedLdLibraryPath();
      console.log(`   Enhanced LD_LIBRARY_PATH: ${enhancedLdPath}`);
      
      let stdout: string;
      let stderr: string;
      try {
        // Test Python script syntax first by trying to import it
        const testCommand = `${pythonCommand} -m py_compile "${this.pythonScriptPath}"`;
        try {
          await execAsync(testCommand, {
            timeout: 5000,
            env: { 
              ...process.env, 
              PATH: this.getEnhancedPath(),
              LD_LIBRARY_PATH: enhancedLdPath
            }
          });
        } catch (compileError: any) {
          console.error('❌ Python script syntax error:', compileError.stderr || compileError.message);
          throw new Error(`Python script has syntax errors: ${compileError.stderr || compileError.message}`);
        }

        // First, verify Python can read the script file
        try {
          // Use Python to check if file is readable (escape path properly)
          const escapedPath = this.pythonScriptPath.replace(/'/g, "'\"'\"'");
          const testReadCommand = `${pythonCommand} -c "import os; assert os.path.exists('${escapedPath}'), 'File not found'; f=open('${escapedPath}'); f.read(1); f.close(); print('Script readable')"`;
          await execAsync(testReadCommand, {
            timeout: 5000,
            env: { 
              ...process.env, 
              PATH: this.getEnhancedPath(),
              LD_LIBRARY_PATH: enhancedLdPath
            }
          });
        } catch (readError: any) {
          // Don't fail on read test - just log it, the actual execution will show the real error
          console.warn('⚠️ Script readability test failed (non-fatal):', readError instanceof Error ? readError.message : String(readError));
        }

        // Test Python can import required modules before running the script
        try {
          const testImportCommand = `${pythonCommand} -c "import cv2; import numpy; import json; import sys; print('Imports OK')"`;
          const importTest = await execAsync(testImportCommand, {
            timeout: 10000,
            env: { 
              ...process.env, 
              PATH: this.getEnhancedPath(),
              LD_LIBRARY_PATH: enhancedLdPath
            }
          });
          console.log(`✅ Python imports test: ${importTest.stdout.trim()}`);
        } catch (importError: any) {
          console.error('❌ Python import test failed:', importError.stderr || importError.message);
          throw new Error(`Python cannot import required modules (cv2, numpy). Error: ${importError.stderr || importError.message}`);
        }

        // Run the actual script with better error capture
        // Note: Railway free tier has memory limits, so we need to be careful with large images
        const execResult = await execAsync(command, {
          timeout: 120000, // 120 second timeout (2 minutes for complex images with OpenCV processing)
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          env: { 
            ...process.env, 
            PATH: this.getEnhancedPath(),
            LD_LIBRARY_PATH: enhancedLdPath,
            PYTHONUNBUFFERED: '1', // Ensure Python output is not buffered
            PYTHONIOENCODING: 'utf-8', // Ensure UTF-8 encoding
            // Limit Python memory usage to prevent OOM kills
            PYTHONHASHSEED: '0', // Deterministic hashing (saves some memory)
            MALLOC_TRIM_THRESHOLD_: '131072' // Help Python release memory
          }
        });
        stdout = execResult.stdout;
        stderr = execResult.stderr;
      } catch (execError: any) {
        // Extract error message properly
        let execErrorMessage = 'Unknown error';
        if (execError instanceof Error) {
          execErrorMessage = execError.message || String(execError);
        } else if (execError && typeof execError === 'object') {
          execErrorMessage = execError.message || execError.error || execError.toString() || JSON.stringify(execError);
        } else {
          execErrorMessage = String(execError);
        }
        
        // Try to get more details about the failure
        let scriptContentPreview = '';
        try {
          const scriptContent = await fs.readFile(this.pythonScriptPath, 'utf8');
          scriptContentPreview = scriptContent.substring(0, 200);
        } catch {
          scriptContentPreview = 'Could not read script file';
        }

        // Try to run Python with verbose error output to capture what's happening
        let verboseError = '';
        try {
          const verboseCommand = `${pythonCommand} -u "${this.pythonScriptPath}" "${imagePath}" ${opts.scaleFactor} ${opts.minRoomArea} ${opts.minWallLength} ${opts.contourApproximationEpsilon} 2>&1 || echo "EXIT_CODE:$?"`;
          const verboseResult = await execAsync(verboseCommand, {
            timeout: 5000,
            env: { 
              ...process.env, 
              PATH: this.getEnhancedPath(),
              LD_LIBRARY_PATH: enhancedLdPath,
              PYTHONUNBUFFERED: '1',
              PYTHONIOENCODING: 'utf-8'
            }
          });
          verboseError = verboseResult.stdout || verboseResult.stderr || '';
        } catch {
          // Ignore - this is just for diagnostics
        }
        
        const errorDetails = {
          command,
          pythonCommand,
          scriptPath: this.pythonScriptPath,
          scriptExists: await fs.pathExists(this.pythonScriptPath),
          scriptSize: (await fs.stat(this.pythonScriptPath).catch(() => ({ size: 0 }))).size,
          scriptPreview: scriptContentPreview,
          imagePath,
          imageExists: await fs.pathExists(imagePath),
          imageSize: (await fs.stat(imagePath).catch(() => ({ size: 0 }))).size,
          platform: process.platform,
          cwd: process.cwd(),
          enhancedPath: this.getEnhancedPath(),
          enhancedLdPath,
          error: execErrorMessage,
          code: execError?.code,
          signal: execError?.signal,
          stdout: execError?.stdout || '',
          stderr: execError?.stderr || '',
          killed: execError?.killed,
          timedOut: execError?.timedOut,
          verboseError: verboseError.substring(0, 1000) // Limit verbose output
        };
        console.error('❌ Python script execution failed:', JSON.stringify(errorDetails, null, 2));
        
        // Provide a more helpful error message
        let helpfulError = `Python script execution failed: ${execErrorMessage}`;
        if (execError?.code) {
          helpfulError += ` (exit code: ${execError.code})`;
        }
        if (execError?.signal) {
          helpfulError += ` (signal: ${execError.signal})`;
        }
        if (execError?.killed) {
          helpfulError += ' (process was killed)';
        }
        if (execError?.timedOut) {
          helpfulError += ' (process timed out)';
        }
        if (errorDetails.stderr) {
          helpfulError += `. Stderr: ${errorDetails.stderr.substring(0, 500)}`;
        } else if (errorDetails.stdout) {
          helpfulError += `. Stdout: ${errorDetails.stdout.substring(0, 500)}`;
        } else {
          helpfulError += '. No output from Python script (script may have crashed immediately or failed to start)';
        }
        
        throw new Error(helpfulError);
      }

      if (stderr && !stderr.includes('DeprecationWarning')) {
        console.warn('⚠️ Python script warnings:', stderr);
      }

      // Parse JSON result
      let result;
      try {
        const trimmedOutput = stdout.trim();
        console.log(`📄 Python script output length: ${trimmedOutput.length} characters`);
        console.log(`📄 First 500 chars: ${trimmedOutput.substring(0, 500)}`);
        result = JSON.parse(trimmedOutput);
      } catch (parseError) {
        const errorDetails = {
          parseError: parseError instanceof Error ? parseError.message : 'Unknown parse error',
          stdoutLength: stdout.length,
          stdoutPreview: stdout.substring(0, 1000),
          stderr: stderr || 'none'
        };
        console.error('❌ Failed to parse Python script output:', JSON.stringify(errorDetails, null, 2));
        throw new Error(`Failed to parse detection results: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}. Output preview: ${stdout.substring(0, 500)}`);
      }
      
      if (result.error) {
        const errorDetails = {
          pythonError: result.error,
          command,
          stdout: stdout.substring(0, 500),
          stderr: stderr || 'none'
        };
        console.error('❌ Python script returned error:', JSON.stringify(errorDetails, null, 2));
        throw new Error(`Boundary detection failed: ${result.error}`);
      }

      // Clean up temp image file
      await fs.remove(imagePath).catch(() => {});

      const processingTime = Date.now() - startTime;

      // Validate and return results
      return {
        rooms: Array.isArray(result.rooms) ? result.rooms : [],
        walls: Array.isArray(result.walls) ? result.walls : [],
        doors: Array.isArray(result.doors) ? result.doors : [],
        windows: Array.isArray(result.windows) ? result.windows : [],
        ocrText: Array.isArray(result.ocrText) ? result.ocrText : [],
        processingTime,
        imageWidth: result.imageWidth || 0,
        imageHeight: result.imageHeight || 0
      };

    } catch (error) {
      // Extract error message properly
      let errorMessage = 'Unknown error';
      let errorStack: string | undefined;
      
      if (error instanceof Error) {
        errorMessage = error.message || String(error);
        errorStack = error.stack;
        // If message is "[object Object]", try to extract more details
        if (errorMessage === '[object Object]' || errorMessage.includes('[object Object]')) {
          try {
            const errorObj = error as any;
            errorMessage = errorObj.message || errorObj.error || JSON.stringify(errorObj, Object.getOwnPropertyNames(errorObj)) || 'Unknown error';
          } catch {
            errorMessage = 'Unknown error occurred during boundary detection';
          }
        }
      } else if (error && typeof error === 'object') {
        try {
          const errorObj = error as any;
          errorMessage = errorObj.message || errorObj.error || errorObj.toString() || JSON.stringify(errorObj);
          errorStack = errorObj.stack;
        } catch {
          errorMessage = 'Unknown error occurred during boundary detection';
        }
      } else {
        errorMessage = String(error);
      }
      
      const errorDetails = {
        error: errorMessage,
        stack: errorStack,
        imageId,
        imagePath,
        scaleFactor: opts.scaleFactor,
        options: opts,
        platform: process.platform,
        nodeVersion: process.version,
        cwd: process.cwd(),
        pythonScriptPath: this.pythonScriptPath,
        scriptExists: await fs.pathExists(this.pythonScriptPath).catch(() => false),
        tempDir: this.tempDir,
        tempDirExists: await fs.pathExists(this.tempDir).catch(() => false)
      };
      console.error('❌ Boundary detection error:', JSON.stringify(errorDetails, null, 2));
      const formattedError = new Error(`Boundary detection failed: ${errorMessage}. Full details logged.`);
      if (errorStack) {
        formattedError.stack = errorStack;
      }
      throw formattedError;
    }
  }

  /**
   * Find Python command path (reusable helper)
   */
  private async findPythonCommand(): Promise<string | null> {
    const enhancedPath = this.getEnhancedPath();
    
    // Try using 'which' command first (most reliable)
    try {
      const { stdout: whichOutput } = await execAsync('which python3', {
        timeout: 5000,
        env: { ...process.env, PATH: enhancedPath }
      });
      const foundPath = whichOutput.trim();
      if (foundPath) {
        // Verify it works
        await execAsync(`${foundPath} --version`, {
          timeout: 5000,
          env: { ...process.env, PATH: enhancedPath }
        });
        return foundPath;
      }
    } catch {
      // Continue to fallback paths
    }

    // Fallback: try multiple known paths (including Railway-specific)
    const pythonPaths = [
      '/opt/venv/bin/python3',              // Railway Nixpacks virtual environment
      '/usr/local/bin/python3',             // Common system location
      '/usr/bin/python3',                   // Standard system location
      '/root/.nix-profile/bin/python3',     // Nix profile (if exists)
      '/nix/var/nix/profiles/default/bin/python3', // Nix default profile
      'python3',                            // System PATH
      process.platform === 'win32' ? 'python' : 'python3' // Platform-specific fallback
    ];
    
    for (const pythonPath of pythonPaths) {
      try {
        await execAsync(`${pythonPath} --version`, {
          timeout: 5000,
          env: { ...process.env, PATH: enhancedPath }
        });
        return pythonPath;
      } catch {
        continue;
      }
    }
    
    return null;
  }

  /**
   * Check if Python and OpenCV are available
   */
  async isAvailable(): Promise<boolean> {
    const details = await this.getStatusDetails();
    return details.pythonAvailable && details.opencvAvailable;
  }

  /**
   * Get detailed status information
   */
  async getStatusDetails(): Promise<{
    pythonAvailable: boolean;
    opencvAvailable: boolean;
    pytesseractAvailable: boolean;
    pythonVersion?: string;
    opencvVersion?: string;
    tesseractVersion?: string;
    error?: string;
  }> {
    const result: {
      pythonAvailable: boolean;
      opencvAvailable: boolean;
      pytesseractAvailable: boolean;
      pythonVersion?: string;
      opencvVersion?: string;
      tesseractVersion?: string;
      error?: string;
    } = {
      pythonAvailable: false,
      opencvAvailable: false,
      pytesseractAvailable: false
    };

    try {
      // Enhanced PATH for Railway/Nixpacks environments
      const enhancedPath = this.getEnhancedPath();
      
      // Log current PATH for debugging
      console.log('🔍 Checking Python/OpenCV availability...');
      console.log(`   Current PATH: ${process.env.PATH}`);
      console.log(`   Enhanced PATH: ${enhancedPath}`);

      // Try to find Python using 'which' command first (most reliable)
      let pythonCommand: string | null = null;
      let pythonError: string | null = null;
      
      // First, try using 'which' to dynamically find python3
      try {
        console.log('   Trying "which python3"...');
        const { stdout: whichOutput, stderr: whichStderr } = await execAsync('which python3', {
          timeout: 5000,
          env: { ...process.env, PATH: enhancedPath }
        });
        const foundPath = whichOutput.trim();
        if (foundPath) {
          console.log(`   Found Python at: ${foundPath}`);
          // Verify it works
          const { stdout } = await execAsync(`${foundPath} --version`, {
            timeout: 5000,
            env: { ...process.env, PATH: enhancedPath }
          });
          result.pythonAvailable = true;
          result.pythonVersion = stdout.trim();
          pythonCommand = foundPath;
          console.log(`   ✅ Python version: ${result.pythonVersion}`);
        } else {
          pythonError = `which python3 returned empty: ${whichStderr || 'no output'}`;
        }
      } catch (whichError) {
        pythonError = `which python3 failed: ${whichError instanceof Error ? whichError.message : 'Unknown error'}`;
        console.log(`   ⚠️ ${pythonError}`);
      }

      // Fallback: try multiple known paths (including Railway-specific)
      if (!pythonCommand) {
        console.log('   Trying fallback paths...');
        const pythonPaths = [
          '/opt/venv/bin/python3',              // Railway Nixpacks virtual environment
          '/usr/local/bin/python3',             // Common system location
          '/usr/bin/python3',                   // Standard system location
          '/root/.nix-profile/bin/python3',     // Nix profile (if exists)
          '/nix/var/nix/profiles/default/bin/python3', // Nix default profile
          'python3',                            // System PATH
          'python'                              // Fallback
        ];
        
        for (const pythonPath of pythonPaths) {
          try {
            console.log(`   Checking: ${pythonPath}`);
            const { stdout, stderr } = await execAsync(`${pythonPath} --version`, {
              timeout: 5000,
              env: { ...process.env, PATH: enhancedPath }
            });
            result.pythonAvailable = true;
            result.pythonVersion = stdout.trim();
            pythonCommand = pythonPath;
            console.log(`   ✅ Found Python at: ${pythonPath} (${result.pythonVersion})`);
            break;
          } catch (pathError) {
            console.log(`   ❌ ${pythonPath} failed: ${pathError instanceof Error ? pathError.message : 'Unknown error'}`);
            continue;
          }
        }
      }
      
      if (!pythonCommand) {
        const errorDetails = {
          checkedPaths: [
            '/opt/venv/bin/python3',
            '/usr/local/bin/python3',
            '/usr/bin/python3',
            '/root/.nix-profile/bin/python3',
            '/nix/var/nix/profiles/default/bin/python3',
            'python3',
            'python'
          ],
          pythonError,
          platform: process.platform,
          nodeVersion: process.version,
          currentPath: process.env.PATH,
          enhancedPath: enhancedPath,
          cwd: process.cwd(),
          whichOutput: pythonError
        };
        const errorMsg = `Python not found. Checked: /opt/venv/bin/python3, /usr/local/bin/python3, /usr/bin/python3, python3, python. ${pythonError ? `Last error: ${pythonError}` : ''}`;
        console.error(`   ❌ ${errorMsg}`);
        console.error(`   Python check details:`, JSON.stringify(errorDetails, null, 2));
        result.error = `${errorMsg}. Details: ${JSON.stringify(errorDetails)}`;
        return result;
      }
      
      // Check OpenCV with enhanced PATH
      console.log(`   Checking OpenCV with Python: ${pythonCommand}`);
      
      // First, check if pip can see opencv-python
      try {
        console.log(`   Checking if opencv-python is installed...`);
        const enhancedLdPath = await this.getEnhancedLdLibraryPath();
        const { stdout: pipList } = await execAsync(
          `${pythonCommand} -m pip list | grep -i opencv || echo "not found"`,
          {
            timeout: 5000,
            env: { 
              ...process.env, 
              PATH: enhancedPath,
              LD_LIBRARY_PATH: enhancedLdPath
            }
          }
        );
        console.log(`   pip list opencv: ${pipList.trim()}`);
      } catch (pipError) {
        console.warn(`   Could not check pip list: ${pipError}`);
      }
      
      // Check Python site-packages location
      try {
        const enhancedLdPath = await this.getEnhancedLdLibraryPath();
        const { stdout: sitePackages } = await execAsync(
          `${pythonCommand} -c "import site; print(site.getsitepackages())"`,
          {
            timeout: 5000,
            env: { 
              ...process.env, 
              PATH: enhancedPath,
              LD_LIBRARY_PATH: enhancedLdPath
            }
          }
        );
        console.log(`   Python site-packages: ${sitePackages.trim()}`);
      } catch (siteError) {
        console.warn(`   Could not check site-packages: ${siteError}`);
      }
      
      try {
        const enhancedLdPath = await this.getEnhancedLdLibraryPath();
        const { stdout, stderr } = await execAsync(
          `${pythonCommand} -c "import cv2; print(cv2.__version__)"`,
          {
            timeout: 5000,
            env: { 
              ...process.env, 
              PATH: enhancedPath,
              LD_LIBRARY_PATH: enhancedLdPath
            }
          }
        );
        result.opencvAvailable = true;
        result.opencvVersion = stdout.trim();
        console.log(`   ✅ OpenCV version: ${result.opencvVersion}`);
        if (stderr && !stderr.includes('DeprecationWarning')) {
          console.warn(`   OpenCV import warnings: ${stderr}`);
        }
      } catch (error) {
        // Try to get more details about the import error
        let importErrorDetails = '';
        try {
          const enhancedLdPath = await this.getEnhancedLdLibraryPath();
          const { stderr: importStderr } = await execAsync(
            `${pythonCommand} -c "import cv2" 2>&1 || true`,
            {
              timeout: 5000,
              env: { 
                ...process.env, 
                PATH: enhancedPath,
                LD_LIBRARY_PATH: enhancedLdPath
              }
            }
          );
          importErrorDetails = importStderr || '';
        } catch {
          // Ignore
        }
        
        const errorDetails = {
          pythonCommand,
          pythonVersion: result.pythonVersion,
          command: `${pythonCommand} -c "import cv2; print(cv2.__version__)"`,
          error: error instanceof Error ? error.message : 'Unknown error',
          importError: importErrorDetails,
          code: (error as any)?.code,
          signal: (error as any)?.signal,
          stdout: (error as any)?.stdout || '',
          stderr: (error as any)?.stderr || '',
          killed: (error as any)?.killed,
          timedOut: (error as any)?.timedOut,
          platform: process.platform,
          enhancedPath: enhancedPath,
          currentPath: process.env.PATH
        };
        const errorMsg = `OpenCV not found: ${error instanceof Error ? error.message : 'Unknown error'}. Python found at: ${pythonCommand}`;
        console.error(`   ❌ ${errorMsg}`);
        console.error(`   OpenCV check details:`, JSON.stringify(errorDetails, null, 2));
        result.error = `${errorMsg}. Details: ${JSON.stringify(errorDetails)}`;
        return result;
      }

      // Check pytesseract availability
      try {
        const enhancedLdPath = await this.getEnhancedLdLibraryPath();
        const { stdout: tesseractVersion } = await execAsync(
          `${pythonCommand} -c "import pytesseract; print(pytesseract.get_tesseract_version())"`,
          {
            timeout: 5000,
            env: { 
              ...process.env, 
              PATH: enhancedPath,
              LD_LIBRARY_PATH: enhancedLdPath
            }
          }
        );
        result.pytesseractAvailable = true;
        result.tesseractVersion = tesseractVersion.trim();
        console.log(`   ✅ Tesseract version: ${result.tesseractVersion}`);
      } catch (tesseractError) {
        console.warn(`   ⚠️ pytesseract/Tesseract not available: ${tesseractError instanceof Error ? tesseractError.message : 'Unknown error'}`);
        result.pytesseractAvailable = false;
        // Don't fail - OCR is optional, CV detection will still work
      }

      console.log('   ✅ Python and OpenCV are available!');
      return result;
    } catch (error) {
      const enhancedPath = this.getEnhancedPath();
      const errorDetails = {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        platform: process.platform,
        nodeVersion: process.version,
        cwd: process.cwd(),
        currentPath: process.env.PATH,
        enhancedPath: enhancedPath
      };
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`   ❌ Unexpected error: ${errorMsg}`);
      console.error(`   Status check error details:`, JSON.stringify(errorDetails, null, 2));
      result.error = `${errorMsg}. Details: ${JSON.stringify(errorDetails)}`;
      return result;
    }
  }
}

export const boundaryDetectionService = new BoundaryDetectionService();

