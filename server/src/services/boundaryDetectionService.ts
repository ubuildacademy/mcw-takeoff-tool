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

  constructor() {
    // Path to Python CV detection script (will be created dynamically)
    // Store in server/src/scripts directory
    this.pythonScriptPath = path.join(process.cwd(), 'server', 'src', 'scripts', 'cv_boundary_detection.py');
    this.tempDir = path.join(process.cwd(), 'server', 'temp', 'cv-detection');
    
    // Ensure temp directory exists
    fs.ensureDirSync(this.tempDir);
    fs.ensureDirSync(path.dirname(this.pythonScriptPath));
  }

  /**
   * Get enhanced PATH for Railway/Nixpacks environments
   */
  private getEnhancedPath(): string {
    return [
      '/opt/venv/bin',           // Railway Nixpacks virtual environment
      '/usr/local/bin',          // Common system location
      '/usr/bin',                // Standard system location
      '/bin',                    // Basic system location
      process.env.PATH || ''     // Existing PATH
    ].filter(Boolean).join(':');
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

    try {
      // Save image to temp file
      const imageId = uuidv4();
      const imagePath = path.join(this.tempDir, `${imageId}.png`);
      const imageBuffer = Buffer.from(imageData, 'base64');
      await fs.writeFile(imagePath, imageBuffer);

      // Prepare options
      const opts = {
        minRoomArea: options.minRoomArea || 50, // 50 square feet minimum
        minWallLength: options.minWallLength || 2, // 2 linear feet minimum
        edgeThreshold1: options.edgeThreshold1 || 50,
        edgeThreshold2: options.edgeThreshold2 || 150,
        contourApproximationEpsilon: options.contourApproximationEpsilon || 0.02,
        scaleFactor: scaleFactor || 1.0
      };

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
    
    # Edge detection
    edges = cv2.Canny(blurred, 50, 150)
    
    # Dilate edges to close gaps
    kernel = np.ones((3, 3), np.uint8)
    dilated = cv2.dilate(edges, kernel, iterations=1)
    
    # Find contours
    contours, hierarchy = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    rooms = []
    min_area_pixels = (min_area_sf / (scale_factor ** 2)) if scale_factor > 0 else 1000
    
    for contour in contours:
        area_pixels = cv2.contourArea(contour)
        if area_pixels < min_area_pixels:
            continue
        
        # Simplify contour (reduce vertices)
        epsilon_factor = epsilon * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, epsilon_factor, True)
        
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
        # Simple heuristic: compare area of contour vs bounding box
        x, y, w, h = cv2.boundingRect(contour)
        bbox_area = w * h
        regularity = area_pixels / bbox_area if bbox_area > 0 else 0
        confidence = min(0.95, 0.5 + regularity * 0.45)
        
        rooms.append({
            "points": points,
            "area": round(area_sf, 2),
            "perimeter": round(perimeter_lf, 2),
            "confidence": round(confidence, 3)
        })
    
    return rooms

def detect_walls(image_path, scale_factor, min_length_lf):
    """Detect wall segments using line detection"""
    img = cv2.imread(image_path)
    if img is None:
        return []
    
    height, width = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Apply Gaussian blur
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Edge detection
    edges = cv2.Canny(blurred, 50, 150)
    
    # Hough Line Transform
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=100, minLineLength=50, maxLineGap=10)
    
    walls = []
    min_length_pixels = min_length_lf / scale_factor if scale_factor > 0 else 20
    
    if lines is not None:
        for line in lines:
            x1, y1, x2, y2 = line[0]
            
            # Calculate length
            length_pixels = np.sqrt((x2 - x1)**2 + (y2 - y1)**2)
            length_lf = length_pixels * scale_factor
            
            if length_lf < min_length_lf:
                continue
            
            # Normalize coordinates
            start = {"x": float(x1) / width, "y": float(y1) / height}
            end = {"x": float(x2) / width, "y": float(y2) / height}
            
            # Confidence based on line strength (simplified)
            confidence = 0.7
            
            walls.append({
                "start": start,
                "end": end,
                "length": round(length_lf, 2),
                "confidence": round(confidence, 3)
            })
    
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
      }

      // Execute Python script
      // Use enhanced PATH to ensure Python is found in Railway/Nixpacks environments
      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
      const command = `${pythonCommand} "${this.pythonScriptPath}" "${imagePath}" ${opts.scaleFactor} ${opts.minRoomArea} ${opts.minWallLength} ${opts.contourApproximationEpsilon}`;
      
      console.log(`🔍 Executing boundary detection: ${command}`);
      const { stdout, stderr } = await execAsync(command, {
        timeout: 60000, // 60 second timeout (increased for complex images)
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        env: { ...process.env, PATH: this.getEnhancedPath() }
      });

      if (stderr && !stderr.includes('DeprecationWarning')) {
        console.warn('⚠️ Python script warnings:', stderr);
      }

      // Parse JSON result
      let result;
      try {
        result = JSON.parse(stdout.trim());
      } catch (parseError) {
        console.error('Failed to parse Python script output:', stdout);
        throw new Error(`Failed to parse detection results: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`);
      }
      
      if (result.error) {
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
      console.error('❌ Boundary detection error:', error);
      throw new Error(`Boundary detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

      // Try to find Python using 'which' command first (most reliable)
      let pythonCommand: string | null = null;
      
      // First, try using 'which' to dynamically find python3
      try {
        const { stdout: whichOutput } = await execAsync('which python3', {
          timeout: 5000,
          env: { ...process.env, PATH: enhancedPath }
        });
        const foundPath = whichOutput.trim();
        if (foundPath) {
          // Verify it works
          const { stdout } = await execAsync(`${foundPath} --version`, {
            timeout: 5000,
            env: { ...process.env, PATH: enhancedPath }
          });
          result.pythonAvailable = true;
          result.pythonVersion = stdout.trim();
          pythonCommand = foundPath;
        }
      } catch {
        // 'which' failed, continue to fallback paths
      }

      // Fallback: try multiple known paths (including Railway-specific)
      if (!pythonCommand) {
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
            const { stdout } = await execAsync(`${pythonPath} --version`, {
              timeout: 5000,
              env: { ...process.env, PATH: enhancedPath }
            });
            result.pythonAvailable = true;
            result.pythonVersion = stdout.trim();
            pythonCommand = pythonPath;
            break;
          } catch {
            continue;
          }
        }
      }
      
      if (!pythonCommand) {
        result.error = 'Python not found. Checked: /opt/venv/bin/python3, /usr/local/bin/python3, /usr/bin/python3, python3, python';
        return result;
      }
      
      // Check OpenCV with enhanced PATH
      try {
        const { stdout } = await execAsync(
          `${pythonCommand} -c "import cv2; print(cv2.__version__)"`,
          {
            timeout: 5000,
            env: { ...process.env, PATH: enhancedPath }
          }
        );
        result.opencvAvailable = true;
        result.opencvVersion = stdout.trim();
      } catch (error) {
        result.error = `OpenCV not found: ${error instanceof Error ? error.message : 'Unknown error'}. Python found at: ${pythonCommand}`;
        return result;
      }

      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error';
      return result;
    }
  }
}

export const boundaryDetectionService = new BoundaryDetectionService();

