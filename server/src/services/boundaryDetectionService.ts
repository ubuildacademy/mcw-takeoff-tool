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

def detect_rooms(image_path, scale_factor, min_area_sf, epsilon, exterior_walls=None):
    """Detect room boundaries - rooms are enclosed spaces surrounded by EXTERIOR walls only
    Interior walls (like bathroom walls within a hotel unit) are ignored for room boundaries"""
    img = cv2.imread(image_path)
    if img is None:
        return []
    
    height, width = img.shape[:2]
    
    # PHASE 2: Increase max dimension to 3000px for better accuracy (queue removes timeout constraint)
    max_dimension = 3000
    scale_down = 1.0
    if width > max_dimension or height > max_dimension:
        if width > height:
            scale_down = max_dimension / width
        else:
            scale_down = max_dimension / height
        new_width = int(width * scale_down)
        new_height = int(height * scale_down)
        img = cv2.resize(img, (new_width, new_height), interpolation=cv2.INTER_AREA)
        height, width = img.shape[:2]
        # Adjust scale factor for resized image
        scale_factor = scale_factor / scale_down
        print(f"Resized image to {width}x{height} for faster processing", file=sys.stderr)
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # PHASE 3: Improved titleblock/legend exclusion (relaxed to catch more rooms)
    # Titleblocks are typically in corners or along edges with high text density
    # Exclude smaller regions: top 15%, bottom 15%, left 10%, right 20% (titleblocks often on right)
    exclude_top = height * 0.15
    exclude_bottom = height * 0.85
    exclude_left = width * 0.10
    exclude_right = width * 0.80  # Less aggressive right-side exclusion
    
    # Create a mask for titleblock regions using edge density (text creates high edge density)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    
    # Find regions with very high edge density (titleblocks, legends, notes)
    kernel_large = np.ones((25, 25), np.float32) / 625  # Larger kernel for titleblock detection
    edge_density = cv2.filter2D((edges > 0).astype(np.uint8), -1, kernel_large)
    titleblock_mask = (edge_density > 0.6).astype(np.uint8)  # Higher threshold to be more selective
    
    # Also mark edge regions as potential titleblocks
    titleblock_mask[0:int(exclude_top), :] = 1
    titleblock_mask[int(exclude_bottom):, :] = 1
    titleblock_mask[:, 0:int(exclude_left)] = 1
    titleblock_mask[:, int(exclude_right):] = 1
    
    # PHASE 3: Use walls to constrain room detection
    # Rooms must be bounded by detected walls - this is the key logical constraint
    wall_mask = None
    if exterior_walls and len(exterior_walls) > 0:
        wall_mask = np.zeros((height, width), dtype=np.uint8)
        for wall in exterior_walls:
            # Convert normalized coordinates to pixel coordinates
            x1 = int(wall["start"]["x"] * width)
            y1 = int(wall["start"]["y"] * height)
            x2 = int(wall["end"]["x"] * width)
            y2 = int(wall["end"]["y"] * height)
            # Draw wall line on mask (thicker for better alignment detection)
            cv2.line(wall_mask, (x1, y1), (x2, y2), 255, 5)  # Increased thickness from 3 to 5
        
        # Dilate wall mask to create a boundary region (rooms can be slightly inside walls)
        kernel_wall = np.ones((7, 7), np.uint8)  # Increased from 5x5 to 7x7
        wall_mask = cv2.dilate(wall_mask, kernel_wall, iterations=3)  # Increased iterations from 2 to 3
    
    # Edge detection - rooms are surrounded by walls, so we need to detect closed boundaries
    # OPTIMIZATION: Use smaller blur kernel for faster processing
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blurred, 50, 150)
    
    # PHASE 3: If we have wall mask, use it to enhance edges
    if wall_mask is not None:
        # Combine edges with wall mask (walls should have strong edges)
        edges = cv2.bitwise_or(edges, (wall_mask > 0).astype(np.uint8) * 255)
    
    # OPTIMIZATION: Use smaller kernel and fewer iterations for faster processing
    kernel = np.ones((3, 3), np.uint8)
    dilated = cv2.dilate(edges, kernel, iterations=1)
    closed = cv2.erode(dilated, kernel, iterations=1)
    
    # PHASE 3: Use RETR_EXTERNAL first to get only outer boundaries (rooms, not interior spaces)
    # This naturally groups connected spaces (like hotel room + bathroom) into one room
    contours, hierarchy = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    rooms = []
    min_area_pixels = (min_area_sf / (scale_factor ** 2)) if scale_factor > 0 else 1000
    # Maximum area to filter out the entire floor plan - lowered to 50% to exclude full page
    max_area_pixels = (width * height) * 0.5
    
    # PHASE 3: Pre-filter contours by area and titleblock exclusion
    # Calculate areas first and sort to process likely rooms first
    contour_areas = [(i, cv2.contourArea(contour)) for i, contour in enumerate(contours)]
    
    # Filter by area and titleblock exclusion
    filtered_indices = []
    for i, area in contour_areas:
        if area < min_area_pixels or area > max_area_pixels:
            continue
        
        contour = contours[i]
        x, y, w, h = cv2.boundingRect(contour)
        
        # PHASE 3: Relaxed titleblock exclusion (to catch more rooms while still avoiding titleblocks)
        # Check if contour overlaps significantly with titleblock mask
        contour_mask = np.zeros((height, width), dtype=np.uint8)
        cv2.drawContours(contour_mask, [contour], -1, 255, -1)
        titleblock_overlap = cv2.bitwise_and(contour_mask, titleblock_mask)
        overlap_ratio = np.sum(titleblock_overlap > 0) / max(1, np.sum(contour_mask > 0))
        
        # If more than 40% of contour is in titleblock regions, skip it (relaxed from 20%)
        if overlap_ratio > 0.4:
            continue
        
        # Check if bounding box is in exclusion zones
        if (y < exclude_top or y + h > exclude_bottom or 
            x < exclude_left or x + w > exclude_right):
            # If more than 60% of bounding box is in exclusion zones, skip (relaxed from 40%)
            exclusion_overlap = 0
            if y < exclude_top:
                exclusion_overlap += min(h, exclude_top - y) * w
            if y + h > exclude_bottom:
                exclusion_overlap += min(h, (y + h) - exclude_bottom) * w
            if x < exclude_left:
                exclusion_overlap += min(w, exclude_left - x) * h
            if x + w > exclude_right:
                exclusion_overlap += min(w, (x + w) - exclude_right) * h
            
            if exclusion_overlap > (w * h * 0.6):  # Relaxed from 0.4 to 0.6
                continue
        
        filtered_indices.append(i)
    
    # Sort by area (largest first) and limit to top 100
    filtered_indices.sort(key=lambda i: contour_areas[i][1], reverse=True)
    filtered_indices = filtered_indices[:100]
    
    # Track processed contours to avoid duplicates
    processed_contours = set()
    
    for i in filtered_indices:
        contour = contours[i]
        # Skip if already processed
        contour_id = id(contour)
        if contour_id in processed_contours:
            continue
        
        area_pixels = cv2.contourArea(contour)
        
        # Get bounding box to check aspect ratio and position
        x, y, w, h = cv2.boundingRect(contour)
        aspect_ratio = max(w, h) / min(w, h) if min(w, h) > 0 else 0
        
        # PHASE 3: Relaxed aspect ratio - rooms should be reasonably rectangular
        # Very elongated shapes are likely corridors or dimension strings
        if aspect_ratio > 12:  # Relaxed from 10 to 12 to catch more room shapes
            continue
        
        # PHASE 3: Validate that room is bounded by walls (relaxed requirement)
        # Rooms should ideally be enclosed by detected walls, but allow more flexibility
        if wall_mask is not None:
            # Check if room boundary aligns with walls
            # Sample points along the contour and check if they're near walls
            contour_points = contour.reshape(-1, 2)
            wall_alignment_count = 0
            num_check_points = min(50, len(contour_points))  # Check up to 50 points
            
            # Increase search radius for wall alignment (from 5 to 10 pixels)
            search_radius = 10
            
            for i in range(0, len(contour_points), max(1, len(contour_points) // num_check_points)):
                px, py = contour_points[i]
                px, py = int(px), int(py)
                
                if 0 <= px < width and 0 <= py < height:
                    # Check if this point is near a wall (within search_radius pixels)
                    y_min = max(0, py - search_radius)
                    y_max = min(height, py + search_radius + 1)
                    x_min = max(0, px - search_radius)
                    x_max = min(width, px + search_radius + 1)
                    
                    if np.any(wall_mask[y_min:y_max, x_min:x_max] > 0):
                        wall_alignment_count += 1
            
            # PHASE 3: At least 25% of room boundary should align with walls (relaxed from 40%)
            # This ensures rooms are somewhat bounded by detected walls, but allows more flexibility
            alignment_ratio = wall_alignment_count / num_check_points if num_check_points > 0 else 0
            if alignment_ratio < 0.25:
                continue  # Room is not properly bounded by walls, skip it
        
        # Check if contour is approximately closed (rooms should be enclosed)
        # Calculate how close the start and end points are
        if len(contour) > 0:
            start_point = contour[0][0]
            end_point = contour[-1][0]
            closure_dist = np.sqrt((start_point[0] - end_point[0])**2 + (start_point[1] - end_point[1])**2)
            perimeter = cv2.arcLength(contour, True)
            # PHASE 3: Relaxed closure - rooms should be reasonably enclosed
            # Some rooms may have small gaps (doors, openings), but not too large
            if perimeter > 0 and closure_dist / perimeter > 0.20:  # Relaxed from 0.15 to 0.20
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
    
    # PHASE 2: Keep more rooms for better accuracy (queue removes timeout constraint)
    rooms = rooms[:100]  # Increased from 50 to 100
    
    return rooms

def detect_walls(image_path, scale_factor, min_length_lf):
    """Detect wall segments using Line Segment Detector (LSD) for better accuracy"""
    img = cv2.imread(image_path)
    if img is None:
        return []
    
    height, width = img.shape[:2]
    
    # PHASE 2: Increase max dimension to 3000px for better accuracy (queue removes timeout constraint)
    max_dimension = 3000
    scale_down = 1.0
    if width > max_dimension or height > max_dimension:
        if width > height:
            scale_down = max_dimension / width
        else:
            scale_down = max_dimension / height
        new_width = int(width * scale_down)
        new_height = int(height * scale_down)
        img = cv2.resize(img, (new_width, new_height), interpolation=cv2.INTER_AREA)
        height, width = img.shape[:2]
        scale_factor = scale_factor / scale_down
        print(f"Resized image to {width}x{height} for wall detection", file=sys.stderr)
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # PHASE 2: Better preprocessing for architectural drawings
    # Use adaptive thresholding to handle varying line weights
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # PHASE 2: Use Line Segment Detector (LSD) instead of Hough transform
    # LSD is more accurate for architectural drawings and handles corners better
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    lines, widths, prec, nfa = lsd.detect(gray)
    
    if lines is None or len(lines) == 0:
        return []
    
    # PHASE 2: Convert LSD lines to wall segments with filtering
    segments = []
    min_length_pixels = min_length_lf / scale_factor if scale_factor > 0 else 20
    
    # PHASE 3: Better text/dimension string detection
    # Create a mask for text regions using edge density
    edges = cv2.Canny(blurred, 50, 150)
    kernel = np.ones((5, 5), np.uint8)
    dilated_edges = cv2.dilate(edges, kernel, iterations=2)
    
    # Find regions with very high edge density (likely text/dimension strings)
    edge_density = cv2.filter2D((dilated_edges > 0).astype(np.uint8), -1, np.ones((15, 15), np.float32) / 225)
    text_mask = (edge_density > 0.4).astype(np.uint8)  # Threshold for text regions
    
    # PHASE 3: Detect solid vs dashed lines
    # Walls are solid or hatched (continuous edges), not dashed
    # Create a binary edge image for continuity checking
    binary_edges = (edges > 0).astype(np.uint8)
    
    for line in lines:
        # LSD returns lines as numpy arrays with shape (1, 4) containing [x1, y1, x2, y2]
        # Handle different possible shapes: (1, 4), (4,), or scalar access
        if line.shape == (1, 4):
            x1, y1, x2, y2 = line[0]
        elif line.shape == (4,):
            x1, y1, x2, y2 = line
        else:
            # Fallback: flatten and take first 4 elements
            coords = line.flatten()[:4]
            x1, y1, x2, y2 = coords
        
        # Calculate length
        length_pixels = np.sqrt((x2 - x1)**2 + (y2 - y1)**2)
        length_lf = length_pixels * scale_factor
        
        if length_pixels < min_length_pixels:
            continue
        
        # PHASE 3: Filter out dimension string lines
        # Dimension strings are typically:
        # - Short lines (extension lines, dimension lines)
        # - Near text/numbers
        # - Horizontal or vertical
        # Sample points along the line and check if they're in text regions
        num_samples = max(10, int(length_pixels / 5))  # More samples for better detection
        text_intersections = 0
        near_text_count = 0
        
        # Check if line is horizontal or vertical (common for dimension strings)
        dx = abs(x2 - x1)
        dy = abs(y2 - y1)
        is_horizontal = dy < dx * 0.1  # Mostly horizontal
        is_vertical = dx < dy * 0.1   # Mostly vertical
        
        # Check points along the line
        for i in range(num_samples):
            t = i / (num_samples - 1) if num_samples > 1 else 0
            x = int(x1 + t * (x2 - x1))
            y = int(y1 + t * (y2 - y1))
            if 0 <= x < width and 0 <= y < height:
                # Check if point is in text region
                if text_mask[y, x] > 0:
                    text_intersections += 1
                
                # Check if point is near text (within 10 pixels)
                y_min = max(0, y - 10)
                y_max = min(height, y + 10)
                x_min = max(0, x - 10)
                x_max = min(width, x + 10)
                if np.any(text_mask[y_min:y_max, x_min:x_max] > 0):
                    near_text_count += 1
        
        # PHASE 3: Filter dimension strings more aggressively
        # If line is short AND (passes through text OR is near text), likely a dimension string
        is_short_line = length_pixels < min_length_pixels * 2  # Short relative to min wall length
        text_ratio = text_intersections / num_samples
        near_text_ratio = near_text_count / num_samples
        
        # Dimension strings: short, horizontal/vertical, and near text
        if is_short_line and (is_horizontal or is_vertical) and (text_ratio > 0.2 or near_text_ratio > 0.5):
            continue
        
        # If more than 40% of the line passes through text regions, skip it (stricter)
        if text_ratio > 0.4:
            continue
        
        # PHASE 3: Filter out dashed lines - walls are solid or hatched
        # Sample points along the line and check edge continuity
        # Dashed lines will have gaps (low edge density in segments)
        continuity_samples = max(20, int(length_pixels / 3))  # More samples for continuity check
        edge_hits = 0
        gap_count = 0
        consecutive_gaps = 0
        max_consecutive_gaps = 0
        
        for i in range(continuity_samples):
            t = i / (continuity_samples - 1) if continuity_samples > 1 else 0
            x = int(x1 + t * (x2 - x1))
            y = int(y1 + t * (y2 - y1))
            if 0 <= x < width and 0 <= y < height:
                # Check if there's an edge at this point (with small tolerance for line width)
                # Check a 3x3 region around the point
                y_min = max(0, y - 1)
                y_max = min(height, y + 2)
                x_min = max(0, x - 1)
                x_max = min(width, x + 2)
                has_edge = np.any(binary_edges[y_min:y_max, x_min:x_max] > 0)
                
                if has_edge:
                    edge_hits += 1
                    consecutive_gaps = 0
                else:
                    gap_count += 1
                    consecutive_gaps += 1
                    max_consecutive_gaps = max(max_consecutive_gaps, consecutive_gaps)
        
        # PHASE 3: Dashed line detection
        # Solid walls should have high edge continuity (>70% edge hits)
        # Dashed lines will have lower continuity and larger gaps
        edge_continuity = edge_hits / continuity_samples if continuity_samples > 0 else 0
        
        # Filter out dashed lines:
        # - Low edge continuity (< 60%)
        # - OR has large consecutive gaps (indicating dashes)
        if edge_continuity < 0.60 or max_consecutive_gaps > continuity_samples * 0.3:
            continue  # Likely a dashed line, not a wall
        
        segments.append({
            "start": (int(x1), int(y1)),
            "end": (int(x2), int(y2)),
            "length": length_pixels,
            "angle": np.arctan2(y2 - y1, x2 - x1)  # Store angle for parallel matching
        })
    
    if len(segments) < 2:
        print(f"No segments found for wall pairing (need at least 2, found {len(segments)})", file=sys.stderr)
        return []  # Need at least 2 lines to form a wall pair
    
    print(f"Found {len(segments)} candidate segments for wall pairing", file=sys.stderr)
    
    # PHASE 4: Walls are TWO parallel lines with space between (wall thickness)
    # Wall thickness is typically 4" to 12"+ at scale (0.33' to 2.0'+)
    # Relaxed range to catch more wall types (3" to 24")
    min_wall_thickness_pixels = (0.25 / scale_factor) if scale_factor > 0 else 2  # 3" minimum (relaxed)
    max_wall_thickness_pixels = (2.0 / scale_factor) if scale_factor > 0 else 60  # 24" maximum (allows for very thick walls)
    
    def are_parallel(seg1, seg2, angle_tolerance=10.0):
        """Check if two segments are parallel (within tolerance in degrees)"""
        angle1 = seg1["angle"] * 180 / np.pi
        angle2 = seg2["angle"] * 180 / np.pi
        
        # Normalize angles to 0-180
        angle1 = angle1 % 180
        angle2 = angle2 % 180
        
        angle_diff = abs(angle1 - angle2)
        if angle_diff > 90:
            angle_diff = 180 - angle_diff
        
        return angle_diff < angle_tolerance
    
    def distance_between_parallel_lines(seg1, seg2):
        """Calculate perpendicular distance between two parallel line segments"""
        # Get a point on each line
        x1, y1 = seg1["start"][0], seg1["start"][1]
        x2, y2 = seg2["start"][0], seg2["start"][1]
        
        # Get direction vector of first line
        dx = seg1["end"][0] - seg1["start"][0]
        dy = seg1["end"][1] - seg1["start"][1]
        dir_norm = np.sqrt(dx*dx + dy*dy)
        if dir_norm == 0:
            return float('inf')
        
        # Calculate perpendicular distance from point on line2 to line1
        # Using formula: distance = |(y2-y1)*dx - (x2-x1)*dy| / sqrt(dx^2 + dy^2)
        perp_dist = abs((y2 - y1) * dx - (x2 - x1) * dy) / dir_norm
        
        return perp_dist
    
    def lines_overlap(seg1, seg2, min_overlap_ratio=0.3):
        """Check if two parallel line segments overlap along their length
        More lenient: requires at least 30% overlap (was 100% before)"""
        # Project both lines onto their direction vector
        dir1 = np.array([seg1["end"][0] - seg1["start"][0], seg1["end"][1] - seg1["start"][1]])
        dir1_norm = np.linalg.norm(dir1)
        if dir1_norm == 0:
            return False
        dir1 = dir1 / dir1_norm
        
        # Project start and end points of both segments
        p1_start = np.array([seg1["start"][0], seg1["start"][1]])
        p1_end = np.array([seg1["end"][0], seg1["end"][1]])
        p2_start = np.array([seg2["start"][0], seg2["start"][1]])
        p2_end = np.array([seg2["end"][0], seg2["end"][1]])
        
        proj1_start = np.dot(p1_start, dir1)
        proj1_end = np.dot(p1_end, dir1)
        proj2_start = np.dot(p2_start, dir1)
        proj2_end = np.dot(p2_end, dir1)
        
        # Check for overlap
        range1 = (min(proj1_start, proj1_end), max(proj1_start, proj1_end))
        range2 = (min(proj2_start, proj2_end), max(proj2_start, proj2_end))
        
        # Calculate overlap length
        overlap_start = max(range1[0], range2[0])
        overlap_end = min(range1[1], range2[1])
        overlap_length = max(0, overlap_end - overlap_start)
        
        # Calculate minimum length of the two segments
        len1 = range1[1] - range1[0]
        len2 = range2[1] - range2[0]
        min_length = min(len1, len2)
        
        # Require at least 30% overlap relative to the shorter segment
        if min_length == 0:
            return False
        overlap_ratio = overlap_length / min_length
        
        return overlap_ratio >= min_overlap_ratio
    
    # PHASE 4: Find wall pairs (two parallel lines with appropriate spacing)
    wall_pairs = []
    used_segments = set()
    
    for i in range(len(segments)):
        if i in used_segments:
            continue
        
        seg1 = segments[i]
        best_pair = None
        best_distance = float('inf')
        
        # Find the best matching parallel line
        for j in range(i + 1, len(segments)):
            if j in used_segments:
                continue
            
            seg2 = segments[j]
            
            # Check if lines are parallel (relaxed tolerance: 10°)
            if not are_parallel(seg1, seg2, angle_tolerance=10.0):
                continue
            
            # Check if lines overlap along their length (relaxed: 30% overlap required)
            if not lines_overlap(seg1, seg2, min_overlap_ratio=0.3):
                continue
            
            # Calculate distance between parallel lines (wall thickness)
            dist = distance_between_parallel_lines(seg1, seg2)
            
            # Wall thickness should be between 4" and 18" (0.33' to 1.5')
            if min_wall_thickness_pixels <= dist <= max_wall_thickness_pixels:
                # This is a potential wall pair
                if dist < best_distance:
                    best_distance = dist
                    best_pair = j
        
        # If we found a matching pair, create a wall
        if best_pair is not None:
            seg2 = segments[best_pair]
            
            # Create wall from the pair - use the average of the two lines
            # Wall centerline is the midpoint between the two parallel lines
            mid_start = (
                (seg1["start"][0] + seg2["start"][0]) / 2,
                (seg1["start"][1] + seg2["start"][1]) / 2
            )
            mid_end = (
                (seg1["end"][0] + seg2["end"][0]) / 2,
                (seg1["end"][1] + seg2["end"][1]) / 2
            )
            
            # Use the longer of the two segments for length
            wall_length = max(seg1["length"], seg2["length"])
            wall_length_lf = wall_length * scale_factor
            
            if wall_length_lf >= min_length_lf:
                wall_pairs.append({
                    "start": (int(mid_start[0]), int(mid_start[1])),
                    "end": (int(mid_end[0]), int(mid_end[1])),
                    "length": wall_length,
                    "thickness": best_distance * scale_factor  # Wall thickness in feet
                })
                
                used_segments.add(i)
                used_segments.add(best_pair)
    
    print(f"Found {len(wall_pairs)} wall pairs from {len(segments)} segments", file=sys.stderr)
    
    if len(wall_pairs) == 0:
        print("No valid wall pairs found - wall thickness range may be too restrictive", file=sys.stderr)
        print(f"Wall thickness range: {min_wall_thickness_pixels:.1f} to {max_wall_thickness_pixels:.1f} pixels", file=sys.stderr)
        return []  # No valid wall pairs found
    
    # PHASE 4: Merge connected wall pairs into continuous walls
    CONNECTION_THRESHOLD = 20  # pixels (increased for better corner detection)
    ANGLE_TOLERANCE = 15  # degrees (allow 90° ± 15°)
    
    def distance(p1, p2):
        return np.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)
    
    def angle_between_walls(wall1, wall2):
        """Calculate angle between two wall segments"""
        # Calculate direction vectors
        dx1 = wall1["end"][0] - wall1["start"][0]
        dy1 = wall1["end"][1] - wall1["start"][1]
        dx2 = wall2["end"][0] - wall2["start"][0]
        dy2 = wall2["end"][1] - wall2["start"][1]
        
        # Calculate angles
        angle1 = np.arctan2(dy1, dx1) * 180 / np.pi
        angle2 = np.arctan2(dy2, dx2) * 180 / np.pi
        
        # Normalize angles to 0-180
        angle_diff = abs(angle1 - angle2)
        if angle_diff > 180:
            angle_diff = 360 - angle_diff
        
        return angle_diff
    
    def are_walls_connected(wall1, wall2):
        """Check if two wall segments can be connected with angle constraint"""
        # Check all endpoint combinations
        d1 = distance(wall1["end"], wall2["start"])
        d2 = distance(wall1["end"], wall2["end"])
        d3 = distance(wall1["start"], wall2["start"])
        d4 = distance(wall1["start"], wall2["end"])
        
        min_dist = min(d1, d2, d3, d4)
        if min_dist >= CONNECTION_THRESHOLD:
            return False
        
        # PHASE 4: Check if the angle is approximately 90° (wall corner)
        # or 0°/180° (straight continuation)
        angle = angle_between_walls(wall1, wall2)
        
        # Allow 90° corners (± tolerance) or straight lines (0° or 180°)
        is_corner = abs(angle - 90) < ANGLE_TOLERANCE
        is_straight = angle < ANGLE_TOLERANCE or abs(angle - 180) < ANGLE_TOLERANCE
        
        return is_corner or is_straight
    
    def merge_walls(wall1, wall2):
        """Merge two connected wall segments"""
        # Find the connection point
        d1 = distance(wall1["end"], wall2["start"])
        d2 = distance(wall1["end"], wall2["end"])
        d3 = distance(wall1["start"], wall2["start"])
        d4 = distance(wall1["start"], wall2["end"])
        
        min_dist = min(d1, d2, d3, d4)
        
        # Determine connection type and merge accordingly
        if min_dist == d1:  # wall1.end -> wall2.start
            return {
                "start": wall1["start"],
                "end": wall2["end"],
                "length": distance(wall1["start"], wall2["end"]),
                "thickness": (wall1["thickness"] + wall2["thickness"]) / 2  # Average thickness
            }
        elif min_dist == d2:  # wall1.end -> wall2.end
            return {
                "start": wall1["start"],
                "end": wall2["start"],
                "length": distance(wall1["start"], wall2["start"]),
                "thickness": (wall1["thickness"] + wall2["thickness"]) / 2
            }
        elif min_dist == d3:  # wall1.start -> wall2.start
            return {
                "start": wall1["end"],
                "end": wall2["end"],
                "length": distance(wall1["end"], wall2["end"]),
                "thickness": (wall1["thickness"] + wall2["thickness"]) / 2
            }
        else:  # wall1.start -> wall2.end
            return {
                "start": wall1["end"],
                "end": wall2["start"],
                "length": distance(wall1["end"], wall2["start"]),
                "thickness": (wall1["thickness"] + wall2["thickness"]) / 2
            }
    
    # Group wall pairs into connected chains
    merged_walls = []
    used = [False] * len(wall_pairs)
    
    for i in range(len(wall_pairs)):
        if used[i]:
            continue
        
        # Start a new wall chain
        current_wall = wall_pairs[i]
        used[i] = True
        changed = True
        
        # Keep merging connected walls until no more connections found
        while changed:
            changed = False
            for j in range(len(wall_pairs)):
                if used[j]:
                    continue
                
                if are_walls_connected(current_wall, wall_pairs[j]):
                    current_wall = merge_walls(current_wall, wall_pairs[j])
                    used[j] = True
                    changed = True
        
        # Convert merged wall to normalized coordinates
        length_lf = current_wall["length"] * scale_factor
        if length_lf >= min_length_lf:
            merged_walls.append({
                "start": {"x": float(current_wall["start"][0]) / width, "y": float(current_wall["start"][1]) / height},
                "end": {"x": float(current_wall["end"][0]) / width, "y": float(current_wall["end"][1]) / height},
                "length": round(length_lf, 2),
                "thickness": round(current_wall["thickness"], 2),  # Wall thickness in feet
                "confidence": min(0.95, 0.8 + (length_lf / 200) * 0.1)  # Higher confidence for longer walls
            })
    
    # Sort by length (longest first) and limit to reasonable number
    merged_walls.sort(key=lambda w: w["length"], reverse=True)
    
    # PHASE 4: Keep more walls for better accuracy (queue removes timeout constraint)
    merged_walls = merged_walls[:100]  # Increased limit for better coverage
    
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
        
        # PHASE 3: Detect walls FIRST, then use them to constrain room detection
        # This ensures rooms are logically bounded by walls
        walls = detect_walls(image_path, scale_factor, min_wall_length)
        
        # Now detect rooms using walls as constraints
        # Rooms must be enclosed by detected walls
        rooms = detect_rooms(image_path, scale_factor, min_room_area, epsilon, exterior_walls=walls)
        
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

      // Validate script path is set and exists (scriptExists already checked above)
      if (!this.pythonScriptPath || this.pythonScriptPath.trim() === '') {
        throw new Error(`Python script path is not set! Current value: "${this.pythonScriptPath}"`);
      }

      // Re-verify script exists (scriptExists was already checked above, but double-check for safety)
      const scriptStillExists = await fs.pathExists(this.pythonScriptPath);
      if (!scriptStillExists) {
        throw new Error(`Python script does not exist at path: ${this.pythonScriptPath}. Please ensure the script was created.`);
      }

      // Build command with explicit validation
      const command = `${pythonCommand} "${this.pythonScriptPath}" "${imagePath}" ${opts.scaleFactor} ${opts.minRoomArea} ${opts.minWallLength} ${opts.contourApproximationEpsilon}`;
      
      // Validate command contains script path (safety check)
      if (!command.includes(this.pythonScriptPath)) {
        throw new Error(`Command does not include script path! Command: ${command}, Script path: ${this.pythonScriptPath}`);
      }
      
      console.log(`🔍 Executing boundary detection:`);
      console.log(`   Python command: ${pythonCommand}`);
      console.log(`   Script path: ${this.pythonScriptPath}`);
      console.log(`   Script exists: ${scriptExists}`);
      console.log(`   Script size: ${(await fs.stat(this.pythonScriptPath)).size} bytes`);
      console.log(`   Image path: ${imagePath}`);
      console.log(`   Image exists: ${await fs.pathExists(imagePath)}`);
      console.log(`   Full command: ${command}`);
      console.log(`   Python: ${statusDetails.pythonVersion || 'unknown'}`);
      console.log(`   OpenCV: ${statusDetails.opencvVersion || 'unknown'}`);
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

        // Test that the script can at least be executed (run with --help or version check)
        try {
          const testScriptCommand = `${pythonCommand} "${this.pythonScriptPath}" --test 2>&1 || ${pythonCommand} -c "import sys; sys.path.insert(0, '/tmp'); exec(open('${this.pythonScriptPath}').read().split('if __name__')[0] + 'print(\"Script syntax OK\")')"`;
          const scriptTest = await execAsync(testScriptCommand, {
            timeout: 10000,
            env: { 
              ...process.env, 
              PATH: this.getEnhancedPath(),
              LD_LIBRARY_PATH: enhancedLdPath,
              PYTHONUNBUFFERED: '1'
            }
          });
          console.log(`✅ Python script test: ${scriptTest.stdout.trim().substring(0, 200)}`);
        } catch (scriptTestError: any) {
          // Don't fail on this - it's just a diagnostic
          console.warn('⚠️ Python script test failed (non-fatal):', scriptTestError.stderr?.substring(0, 200) || scriptTestError.message);
        }

        // Run the actual script with better error capture
        // Note: Railway may kill processes after ~2 minutes, so we need to finish faster
        // Reduced timeout to 90 seconds to finish before Railway kills it
        const execResult = await execAsync(command, {
          timeout: 90000, // 90 second timeout (finish before Railway's ~2 minute process limit)
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

