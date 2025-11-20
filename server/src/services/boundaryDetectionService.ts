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

export interface BoundaryDetectionResult {
  rooms: RoomBoundary[];
  walls: WallSegment[];
  doors: DoorWindow[];
  windows: DoorWindow[];
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
    // In Railway: process.cwd() is /app/server (service root)
    // In local dev: process.cwd() might be repo root or server/
    const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;
    
    // Get current file's directory (works in both source and compiled)
    // In compiled: __dirname = /app/server/dist/services
    // In source (ts-node): __dirname = /app/server/src/services
    let currentDir: string;
    try {
      // @ts-ignore - __dirname exists at runtime in CommonJS
      currentDir = __dirname;
    } catch {
      // Fallback if __dirname not available (shouldn't happen in CommonJS)
      currentDir = process.cwd();
    }
    
    // Determine if we're in dist (compiled) or src (source)
    const isCompiled = currentDir.includes('dist');
    
    // Scripts directory should always be in src/scripts (not dist)
    // Navigate from current location to server root, then to src/scripts
    let scriptsBaseDir: string;
    if (isCompiled) {
      // dist/services -> dist -> server root -> src
      scriptsBaseDir = path.join(currentDir, '..', '..', 'src');
    } else {
      // src/services -> src
      scriptsBaseDir = path.join(currentDir, '..');
    }
    
    this.pythonScriptPath = path.join(scriptsBaseDir, 'scripts', 'cv_boundary_detection.py');
    
    // Temp directory: use /tmp in production, local temp in dev
    if (isProduction) {
      this.tempDir = '/tmp/cv-detection';
    } else {
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
    console.log(`📁 Current dir: ${currentDir}`);
    console.log(`📁 Is compiled: ${isCompiled}`);
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

def detect_rooms(image_path, scale_factor, min_area_sf, epsilon):
    """Detect room boundaries using contour detection"""
    img = cv2.imread(image_path)
    if img is None:
        return []
    
    height, width = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Apply Gaussian blur to reduce noise
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Edge detection with adjusted thresholds for better room separation
    edges = cv2.Canny(blurred, 50, 150)
    
    # Dilate edges to close gaps (but less aggressive to preserve room boundaries)
    kernel = np.ones((3, 3), np.uint8)
    dilated = cv2.dilate(edges, kernel, iterations=1)
    
    # Find ALL contours (not just external) to detect individual rooms
    # RETR_TREE retrieves all contours and reconstructs a full hierarchy
    contours, hierarchy = cv2.findContours(dilated, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    
    rooms = []
    min_area_pixels = (min_area_sf / (scale_factor ** 2)) if scale_factor > 0 else 1000
    # Maximum area to filter out the entire floor plan (e.g., 80% of image)
    max_area_pixels = (width * height) * 0.8
    
    # Track processed contours to avoid duplicates
    processed_contours = set()
    
    for i, contour in enumerate(contours):
        # Skip if already processed
        contour_id = id(contour)
        if contour_id in processed_contours:
            continue
        
        area_pixels = cv2.contourArea(contour)
        
        # Skip if too small
        if area_pixels < min_area_pixels:
            continue
        
        # Skip if too large (likely the entire floor plan)
        if area_pixels > max_area_pixels:
            continue
        
        # Check if this is a child contour (internal room) or has reasonable aspect ratio
        # Rooms should have reasonable width/height ratio (not extremely elongated)
        x, y, w, h = cv2.boundingRect(contour)
        aspect_ratio = max(w, h) / min(w, h) if min(w, h) > 0 else 0
        
        # Filter out extremely elongated shapes (likely corridors or hallways)
        if aspect_ratio > 10:
            continue
        
        # Simplify contour (reduce vertices)
        epsilon_factor = epsilon * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, epsilon_factor, True)
        
        # Skip if simplified contour has too few points (likely noise)
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
        
        # Confidence based on contour regularity (more regular = higher confidence)
        bbox_area = w * h
        regularity = area_pixels / bbox_area if bbox_area > 0 else 0
        # Higher confidence for more regular shapes (closer to rectangle)
        confidence = min(0.95, 0.5 + regularity * 0.45)
        
        # Lower confidence for very large rooms (might be multiple rooms merged)
        if area_sf > 5000:  # Very large rooms get lower confidence
            confidence *= 0.7
        
        rooms.append({
            "points": points,
            "area": round(area_sf, 2),
            "perimeter": round(perimeter_lf, 2),
            "confidence": round(confidence, 3)
        })
        
        processed_contours.add(contour_id)
    
    # Sort by confidence (highest first) and limit to top results
    rooms.sort(key=lambda r: r["confidence"], reverse=True)
    
    return rooms

def detect_walls(image_path, scale_factor, min_length_lf):
    """Detect wall segments using line detection with improved filtering"""
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
    # Higher threshold = fewer but more confident lines
    # Longer minLineLength = only detect substantial wall segments
    min_line_length_pixels = max(50, min_length_lf / scale_factor * 0.8) if scale_factor > 0 else 50
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=150, minLineLength=int(min_line_length_pixels), maxLineGap=15)
    
    walls = []
    min_length_pixels = min_length_lf / scale_factor if scale_factor > 0 else 20
    
    # Track similar lines to merge nearby parallel lines
    processed_lines = []
    
    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = line[0]
            
            # Calculate length
            length_pixels = np.sqrt((x2 - x1)**2 + (y2 - y1)**2)
            length_lf = length_pixels * scale_factor
            
            if length_lf < min_length_lf:
                continue
            
            # Filter out very short segments (likely noise)
            if length_pixels < 20:
                continue
            
            # Normalize coordinates
            start = {"x": float(x1) / width, "y": float(y1) / height}
            end = {"x": float(x2) / width, "y": float(y2) / height}
            
            # Check if this line is too similar to an existing one (within 5 pixels)
            is_duplicate = False
            for existing in processed_lines:
                ex_start = existing["start"]
                ex_end = existing["end"]
                # Check if start and end points are close
                dist_start = np.sqrt((start["x"] - ex_start["x"])**2 * width**2 + (start["y"] - ex_start["y"])**2 * height**2)
                dist_end = np.sqrt((end["x"] - ex_end["x"])**2 * width**2 + (end["y"] - ex_end["y"])**2 * height**2)
                if dist_start < 5 and dist_end < 5:
                    is_duplicate = True
                    break
            
            if is_duplicate:
                continue
            
            # Confidence based on line length (longer = more confident)
            # Normalize confidence: 0.6 for min_length, 0.9 for very long walls
            confidence = min(0.9, 0.6 + (length_lf / 100) * 0.1)
            
            walls.append({
                "start": start,
                "end": end,
                "length": round(length_lf, 2),
                "confidence": round(confidence, 3)
            })
            
            processed_lines.append({"start": start, "end": end})
    
    # Sort by confidence and limit to reasonable number (top 2000 to avoid overwhelming database)
    walls.sort(key=lambda w: w["confidence"], reverse=True)
    walls = walls[:2000]  # Limit to top 2000 most confident walls
    
    return walls

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
        # Get image dimensions
        img = cv2.imread(image_path)
        height, width = img.shape[:2] if img is not None else (0, 0)
        
        # Detect elements
        rooms = detect_rooms(image_path, scale_factor, min_room_area, epsilon)
        walls = detect_walls(image_path, scale_factor, min_wall_length)
        doors, windows = detect_openings(image_path, scale_factor)
        
        result = {
            "rooms": rooms,
            "walls": walls,
            "doors": doors,
            "windows": windows,
            "imageWidth": width,
            "imageHeight": height
        }
        
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
`;

      // Write Python script if it doesn't exist
      if (!await fs.pathExists(this.pythonScriptPath)) {
        await fs.ensureDir(path.dirname(this.pythonScriptPath));
        await fs.writeFile(this.pythonScriptPath, pythonScript);
        // Make script executable (Unix/Linux/Mac)
        if (process.platform !== 'win32') {
          await execAsync(`chmod +x "${this.pythonScriptPath}"`).catch(() => {
            // Ignore errors - script will still work without execute permission
          });
        }
        console.log(`✅ Created Python script at: ${this.pythonScriptPath}`);
      } else {
        console.log(`✅ Python script exists at: ${this.pythonScriptPath}`);
      }
      
      // Verify script exists before executing
      const scriptExists = await fs.pathExists(this.pythonScriptPath);
      if (!scriptExists) {
        throw new Error(`Python script was not created at expected path: ${this.pythonScriptPath}`);
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
      // Use enhanced PATH to ensure Python is found in Railway/Nixpacks environments
      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
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
        const execResult = await execAsync(command, {
          timeout: 60000, // 60 second timeout (increased for complex images)
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          env: { 
            ...process.env, 
            PATH: this.getEnhancedPath(),
            LD_LIBRARY_PATH: enhancedLdPath
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
        
        const errorDetails = {
          command,
          pythonCommand,
          scriptPath: this.pythonScriptPath,
          imagePath,
          platform: process.platform,
          enhancedPath: this.getEnhancedPath(),
          error: execErrorMessage,
          code: execError?.code,
          signal: execError?.signal,
          stdout: execError?.stdout || '',
          stderr: execError?.stderr || '',
          killed: execError?.killed,
          timedOut: execError?.timedOut
        };
        console.error('❌ Python script execution failed:', JSON.stringify(errorDetails, null, 2));
        throw new Error(`Python script execution failed: ${execErrorMessage}. Command: ${command}. Stderr: ${errorDetails.stderr || 'none'}. Stdout: ${errorDetails.stdout.substring(0, 500) || 'none'}`);
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
    pythonVersion?: string;
    opencvVersion?: string;
    error?: string;
  }> {
    const result: {
      pythonAvailable: boolean;
      opencvAvailable: boolean;
      pythonVersion?: string;
      opencvVersion?: string;
      error?: string;
    } = {
      pythonAvailable: false,
      opencvAvailable: false
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

