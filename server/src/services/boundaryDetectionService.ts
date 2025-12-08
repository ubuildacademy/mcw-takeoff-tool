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
import re

# Try to enable OCR/Tesseract if available
TESSERACT_AVAILABLE = False
TESSERACT_BINARY_AVAILABLE = False

try:
    import pytesseract
    import shutil
    import subprocess
    TESSERACT_AVAILABLE = True
    
    # Try to find tesseract binary in PATH or Nix store
    tesseract_path = shutil.which('tesseract')
    if not tesseract_path:
        # Try to find in Nix store (common location for nixpacks)
        try:
            result = subprocess.run(
                ['find', '/nix/store', '-name', 'tesseract', '-type', 'f', '-executable'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                tesseract_path = result.stdout.strip().split('\\n')[0]
                print(f"Found tesseract in Nix store: {tesseract_path}", file=sys.stderr)
            else:
                print(f"Tesseract search in Nix store returned: returncode={result.returncode}, stdout={result.stdout[:200]}", file=sys.stderr)
        except (subprocess.TimeoutExpired, FileNotFoundError, Exception) as e:
            print(f"Could not find tesseract in Nix store: {str(e)}", file=sys.stderr)
    
    # Configure pytesseract to use found binary
    if tesseract_path:
        pytesseract.pytesseract.tesseract_cmd = tesseract_path
        try:
            pytesseract.get_tesseract_version()
            TESSERACT_BINARY_AVAILABLE = True
            print(f"Tesseract OCR is available at: {tesseract_path}", file=sys.stderr)
        except Exception as e:
            print(f"Tesseract binary found but version check failed: {str(e)}", file=sys.stderr)
            TESSERACT_BINARY_AVAILABLE = False
    else:
        print("Tesseract Python library available but binary not found in PATH or Nix store", file=sys.stderr)
        TESSERACT_BINARY_AVAILABLE = False
except ImportError:
    print("Tesseract OCR not available (pytesseract not installed)", file=sys.stderr)
    TESSERACT_AVAILABLE = False
    TESSERACT_BINARY_AVAILABLE = False

# Try to import NetworkX for wall graph (Phase 1)
try:
    import networkx as nx
    NETWORKX_AVAILABLE = True
    print("NetworkX available for wall graph structure", file=sys.stderr)
except ImportError:
    NETWORKX_AVAILABLE = False
    print("NetworkX not available - wall graph features will be limited", file=sys.stderr)

# Import PyTorch for deep learning (Phase 5) - REQUIRED
try:
    import torch
    import torch.nn as nn
    import torchvision.transforms as transforms
    import segmentation_models_pytorch as smp
    from PIL import Image
    TORCH_AVAILABLE = True
    print("PyTorch and segmentation-models-pytorch loaded successfully", file=sys.stderr)
except ImportError as e:
    print(f"ERROR: PyTorch or segmentation-models-pytorch not installed: {str(e)}", file=sys.stderr)
    print("Please install: pip install torch torchvision segmentation-models-pytorch", file=sys.stderr)
    TORCH_AVAILABLE = False
    raise  # Fail fast - DL is required

# Try to import HuggingFace Transformers (optional, for alternative models)
HUGGINGFACE_AVAILABLE = False
try:
    from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor
    HUGGINGFACE_AVAILABLE = True
    print("HuggingFace Transformers available for alternative models", file=sys.stderr)
except ImportError:
    HUGGINGFACE_AVAILABLE = False
    print("HuggingFace Transformers not available (optional)", file=sys.stderr)

# ============================================================================
# PHASE 0: Configuration Constants
# ============================================================================
CONFIG = {
    # Wall detection
    'min_wall_length_ft': 2.0,  # Increased from 1.0 to filter short segments
    'min_wall_confidence': 0.5,  # Minimum confidence for walls (filter low-confidence)
    'wall_thickness_pixels': 3,
    'wall_thickness_ft_range': (0.25, 2.0),  # 3" to 24"
    
    # Tolerances
    'endpoint_snap_distance_px': 3,
    'angular_tolerance_deg': 5.0,
    'parallel_angle_tolerance_deg': 10.0,
    
    # Room detection
    'min_room_area_sf': 75.0,  # Increased from 50.0 to filter small false positives
    'max_room_area_sf': 800.0,  # Reduced from 1000 to be more aggressive
    'min_room_confidence': 0.6,  # Minimum confidence for rooms
    'corridor_aspect_ratio_threshold': 5.0,
    'corridor_perimeter_area_ratio_threshold': 0.3,
    
    # Preprocessing
    'image_max_dimension_px': 3000,
    'gaussian_blur_kernel': (5, 5),
    'bilateral_filter_d': 9,
    'bilateral_filter_sigma_color': 75,
    'bilateral_filter_sigma_space': 75,
    
    # Morphological operations
    'morph_horizontal_kernel_size': (15, 3),
    'morph_vertical_kernel_size': (3, 15),
    'morph_closing_iterations': 2,
    'morph_opening_iterations': 1,
    
    # Graph building
    'node_snap_distance_px': 2,
    'collinear_merge_distance_px': 5,
    
    # Confidence scoring weights
    'confidence_weights': {
        'length': 0.3,
        'mask_overlap': 0.3,
        'local_density': 0.2,
        'structural_alignment': 0.2
    },
    
    # Titleblock exclusion (normalized 0-1)
    'titleblock_exclude_top': 0.10,
    'titleblock_exclude_bottom': 0.90,
    'titleblock_exclude_left': 0.05,
    'titleblock_exclude_right': 0.85,
    
    # Deep learning settings (REQUIRED)
    'dl_confidence_threshold': 0.5,  # Minimum confidence for DL predictions (0-1)
    'dl_model_input_size': 512,  # Input size for DL model (512x512 recommended, larger = more detail but slower)
    # Auto-configured by: python3 server/scripts/auto_setup_floor_plan_model.py
    'dl_model_path': 'server/models/floor_plan_cubicasa5k_resnet50.pth',  # Path to custom pre-trained floor plan model weights (relative to project root, None = use ImageNet pre-trained)
    'dl_use_huggingface': False,  # Use HuggingFace Transformers model instead
    'dl_huggingface_model': 'nvidia/segformer-b0-finetuned-ade-512-512',  # HuggingFace model name
}

# ============================================================================
# PHASE 0: Preprocessing Pipeline
# ============================================================================
def preprocess_image(image_path, scale_factor):
    """
    Preprocess floor plan image for wall/room detection
    
    Returns:
        - processed_image: Binary image
        - scale_factor_adjusted: Adjusted scale factor if image was resized
        - pixel_to_unit: Conversion factor (pixels to feet)
        - image_shape: (height, width)
    """
    img = cv2.imread(image_path)
    if img is None:
        return None, scale_factor, scale_factor, None
    
    height, width = img.shape[:2]
    original_shape = (height, width)
    
    # Resize if needed
    max_dim = CONFIG['image_max_dimension_px']
    if width > max_dim or height > max_dim:
        scale_down = max_dim / max(width, height)
        new_width = int(width * scale_down)
        new_height = int(height * scale_down)
        img = cv2.resize(img, (new_width, new_height), interpolation=cv2.INTER_AREA)
        height, width = img.shape[:2]
        scale_factor = scale_factor / scale_down
        print(f"Resized image to {width}x{height} for processing", file=sys.stderr)
    
    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Denoise with bilateral filter (preserves edges better than Gaussian)
    denoised = cv2.bilateralFilter(
        gray,
        CONFIG['bilateral_filter_d'],
        CONFIG['bilateral_filter_sigma_color'],
        CONFIG['bilateral_filter_sigma_space']
    )
    
    # Adaptive threshold to binary
    binary = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 11, 2
    )
    
    pixel_to_unit = scale_factor
    
    return binary, scale_factor, pixel_to_unit, (height, width)

# ============================================================================
# PHASE 1.1: Wall-Likelihood Mask Generation
# ============================================================================
def generate_wall_likelihood_mask(binary_image):
    """
    Create a wall-likelihood mask using morphological operations
    
    Returns: Binary image where walls are likely present
    """
    # Horizontal wall emphasis
    kernel_h = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        CONFIG['morph_horizontal_kernel_size']
    )
    horizontal = cv2.morphologyEx(
        binary_image, cv2.MORPH_CLOSE, kernel_h,
        iterations=CONFIG['morph_closing_iterations']
    )
    
    # Vertical wall emphasis
    kernel_v = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        CONFIG['morph_vertical_kernel_size']
    )
    vertical = cv2.morphologyEx(
        binary_image, cv2.MORPH_CLOSE, kernel_v,
        iterations=CONFIG['morph_closing_iterations']
    )
    
    # Optional: Diagonal walls (45° and 135°)
    kernel_d1 = np.zeros((11, 11), np.uint8)
    cv2.line(kernel_d1, (0, 11), (11, 0), 255, 2)  # 45° diagonal
    kernel_d2 = np.zeros((11, 11), np.uint8)
    cv2.line(kernel_d2, (0, 0), (11, 11), 255, 2)  # 135° diagonal
    
    diagonal_45 = cv2.morphologyEx(
        binary_image, cv2.MORPH_CLOSE, kernel_d1,
        iterations=CONFIG['morph_closing_iterations']
    )
    diagonal_135 = cv2.morphologyEx(
        binary_image, cv2.MORPH_CLOSE, kernel_d2,
        iterations=CONFIG['morph_closing_iterations']
    )
    
    # Combine all orientations
    combined = cv2.bitwise_or(horizontal, vertical)
    combined = cv2.bitwise_or(combined, diagonal_45)
    combined = cv2.bitwise_or(combined, diagonal_135)
    
    # Optional: Opening to remove small artifacts
    kernel_small = np.ones((3, 3), np.uint8)
    cleaned = cv2.morphologyEx(
        combined, cv2.MORPH_OPEN, kernel_small,
        iterations=CONFIG['morph_opening_iterations']
    )
    
    return cleaned

# ============================================================================
# PHASE 1.2: Line Segment Detection
# ============================================================================
def detect_line_segments(wall_likelihood_mask):
    """
    Detect line segments from wall-likelihood mask using LSD
    
    Returns: List of line segments with start, end, length, angle
    """
    # Use LSD for better accuracy (handles arbitrary angles)
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    lines, widths, prec, nfa = lsd.detect(wall_likelihood_mask)
    
    if lines is None or len(lines) == 0:
        return []
    
    segments = []
    for line in lines:
        # Handle different line formats from LSD
        if line.shape == (1, 4):
            x1, y1, x2, y2 = line[0]
        elif line.shape == (4,):
            x1, y1, x2, y2 = line
        else:
            coords = line.flatten()[:4]
            x1, y1, x2, y2 = coords
        
        length = np.sqrt((x2 - x1)**2 + (y2 - y1)**2)
        angle = np.arctan2(y2 - y1, x2 - x1)
        
        segments.append({
            'start': (int(x1), int(y1)),
            'end': (int(x2), int(y2)),
            'length': length,
            'angle': angle
        })
    
    return segments

# ============================================================================
# PHASE 1.3: Filter Non-Wall Segments
# ============================================================================
def create_text_mask(ocr_text, width, height):
    """Create a mask of text regions from OCR results"""
    text_mask = np.zeros((height, width), dtype=np.uint8)
    
    for text_elem in ocr_text:
        bbox = text_elem.get('bbox', {})
        x_norm = bbox.get('x', 0)
        y_norm = bbox.get('y', 0)
        w_norm = bbox.get('width', 0)
        h_norm = bbox.get('height', 0)
        
        x_px = int(x_norm * width)
        y_px = int(y_norm * height)
        w_px = int(w_norm * width)
        h_px = int(h_norm * height)
        
        cv2.rectangle(text_mask, (x_px, y_px), (x_px + w_px, y_px + h_px), 255, -1)
    
    # Dilate to capture nearby regions
    kernel = np.ones((10, 10), np.uint8)
    text_mask = cv2.dilate(text_mask, kernel, iterations=1)
    
    return text_mask

def is_dimension_string(segment, text_mask, width, height, scale_factor):
    """Detect if segment is likely a dimension string"""
    x1, y1 = segment['start']
    x2, y2 = segment['end']
    length = segment['length']
    
    # Check if horizontal or vertical
    dx = abs(x2 - x1)
    dy = abs(y2 - y1)
    is_horizontal = dy < dx * 0.1
    is_vertical = dx < dy * 0.1
    
    # Sample points along line
    num_samples = max(10, int(length / 5))
    text_intersections = 0
    
    for i in range(num_samples):
        t = i / (num_samples - 1) if num_samples > 1 else 0
        x = int(x1 + t * (x2 - x1))
        y = int(y1 + t * (y2 - y1))
        if 0 <= x < width and 0 <= y < height:
            if text_mask[y, x] > 0:
                text_intersections += 1
    
    text_ratio = text_intersections / num_samples
    
    # Check edge proximity
    center_x = (x1 + x2) / 2
    center_y = (y1 + y2) / 2
    edge_distance = min(center_x, center_y, width - center_x, height - center_y)
    is_near_edge = edge_distance < min(width, height) * 0.15
    
    # Dimension string criteria
    min_length_px = CONFIG['min_wall_length_ft'] / scale_factor
    is_short = length < min_length_px * 2
    is_very_long = length > min(width, height) * 0.25
    
    if (is_short and text_ratio > 0.15) or \\
       (is_near_edge and (is_horizontal or is_vertical) and text_ratio > 0.1) or \\
       (is_very_long and is_near_edge and (is_horizontal or is_vertical)) or \\
       (text_ratio > 0.3):
        return True
    
    return False

def is_dashed_line(segment, wall_likelihood_mask):
    """Detect if segment is a dashed line (not a solid wall)"""
    x1, y1 = segment['start']
    x2, y2 = segment['end']
    length = segment['length']
    
    # Sample points along line
    num_samples = max(20, int(length / 3))
    edge_hits = 0
    consecutive_gaps = 0
    max_consecutive_gaps = 0
    
    height, width = wall_likelihood_mask.shape
    
    for i in range(num_samples):
        t = i / (num_samples - 1) if num_samples > 1 else 0
        x = int(x1 + t * (x2 - x1))
        y = int(y1 + t * (y2 - y1))
        
        # Check 3x3 region around point
        y_min = max(0, y - 1)
        y_max = min(height, y + 2)
        x_min = max(0, x - 1)
        x_max = min(width, x + 2)
        
        if np.any(wall_likelihood_mask[y_min:y_max, x_min:x_max] > 0):
            edge_hits += 1
            consecutive_gaps = 0
        else:
            consecutive_gaps += 1
            max_consecutive_gaps = max(max_consecutive_gaps, consecutive_gaps)
    
    edge_continuity = edge_hits / num_samples if num_samples > 0 else 0
    
    # Dashed lines have low continuity or large gaps
    if edge_continuity < 0.60 or max_consecutive_gaps > num_samples * 0.3:
        return True
    
    return False

def filter_non_wall_segments(segments, scale_factor, ocr_text, image_shape, wall_likelihood_mask):
    """Filter out obvious non-wall segments"""
    height, width = image_shape
    min_length_px = CONFIG['min_wall_length_ft'] / scale_factor
    
    # Create text mask from OCR
    text_mask = create_text_mask(ocr_text, width, height) if ocr_text else np.zeros((height, width), dtype=np.uint8)
    
    # Titleblock exclusion zones
    exclude_top = int(height * CONFIG['titleblock_exclude_top'])
    exclude_bottom = int(height * CONFIG['titleblock_exclude_bottom'])
    exclude_left = int(width * CONFIG['titleblock_exclude_left'])
    exclude_right = int(width * CONFIG['titleblock_exclude_right'])
    
    candidate_walls = []
    
    for seg in segments:
        x1, y1 = seg['start']
        x2, y2 = seg['end']
        length = seg['length']
        
        # Filter 1: Minimum length (stricter)
        if length < min_length_px * 1.5:  # Require 1.5x minimum length
            continue
        
        # Filter 2: Titleblock exclusion
        center_x = (x1 + x2) / 2
        center_y = (y1 + y2) / 2
        if (center_y < exclude_top or center_y > exclude_bottom or
            center_x < exclude_left or center_x > exclude_right):
            continue
        
        # Filter 3: Dimension string detection
        if is_dimension_string(seg, text_mask, width, height, scale_factor):
            continue
        
        # Filter 4: Dashed line detection
        if is_dashed_line(seg, wall_likelihood_mask):
            continue
        
        # Filter 5: Check if segment is too close to image edges (likely not a wall)
        edge_margin = min(width, height) * 0.02  # 2% margin
        if (x1 < edge_margin or x1 > width - edge_margin or
            x2 < edge_margin or x2 > width - edge_margin or
            y1 < edge_margin or y1 > height - edge_margin or
            y2 < edge_margin or y2 > height - edge_margin):
            # Check if it's a very short edge segment (likely dimension line)
            if length < min_length_px * 3:
                continue
        
        candidate_walls.append(seg)
    
    return candidate_walls

# ============================================================================
# PHASE 1.4: Build Wall Graph (with NetworkX if available)
# ============================================================================
def snap_endpoints(segments, snap_distance):
    """Snap endpoints that are within snap_distance pixels"""
    node_mapping = {}
    used_nodes = set()
    
    # Group nearby endpoints
    for i, seg in enumerate(segments):
        node1 = seg['start']
        node2 = seg['end']
        
        # Find existing group for node1
        found_group1 = None
        for existing_node, group in node_mapping.items():
            if existing_node in used_nodes:
                continue
            dist = np.sqrt((node1[0] - existing_node[0])**2 + (node1[1] - existing_node[1])**2)
            if dist <= snap_distance:
                found_group1 = existing_node
                break
        
        # Find existing group for node2
        found_group2 = None
        for existing_node, group in node_mapping.items():
            if existing_node in used_nodes:
                continue
            dist = np.sqrt((node2[0] - existing_node[0])**2 + (node2[1] - existing_node[1])**2)
            if dist <= snap_distance:
                found_group2 = existing_node
                break
        
        # Create or merge groups
        if found_group1 and found_group2:
            # Merge groups
            if found_group1 != found_group2:
                node_mapping[found_group1].extend(node_mapping[found_group2])
                for node in node_mapping[found_group2]:
                    node_mapping[node] = node_mapping[found_group1]
                del node_mapping[found_group2]
        elif found_group1:
            node_mapping[found_group1].append(node2)
            node_mapping[node2] = node_mapping[found_group1]
        elif found_group2:
            node_mapping[found_group2].append(node1)
            node_mapping[node1] = node_mapping[found_group2]
        else:
            # Create new group
            group = [node1, node2]
            node_mapping[node1] = group
            node_mapping[node2] = group
    
    # Calculate centroids for each group
    snapped_nodes = {}
    for node, group in node_mapping.items():
        if node in used_nodes:
            continue
        center_x = sum(n[0] for n in group) / len(group)
        center_y = sum(n[1] for n in group) / len(group)
        snapped_node = (int(center_x), int(center_y))
        for n in group:
            snapped_nodes[n] = snapped_node
            used_nodes.add(n)
    
    # Update segments with snapped nodes
    snapped_segments = []
    for seg in segments:
        new_start = snapped_nodes.get(seg['start'], seg['start'])
        new_end = snapped_nodes.get(seg['end'], seg['end'])
        if new_start != new_end:  # Don't add zero-length segments
            new_seg = seg.copy()
            new_seg['start'] = new_start
            new_seg['end'] = new_end
            snapped_segments.append(new_seg)
    
    return snapped_segments

def build_wall_graph(segments, scale_factor, wall_likelihood_mask):
    """
    Build a graph representation of wall segments
    
    Returns: NetworkX graph (or list of segments if NetworkX unavailable)
    """
    try:
        if not segments:
            print("WARNING: No segments provided to build_wall_graph", file=sys.stderr)
            return [] if not NETWORKX_AVAILABLE else nx.Graph()
        
        # Snap endpoints
        segments = snap_endpoints(segments, CONFIG['node_snap_distance_px'])
        
        if NETWORKX_AVAILABLE:
            try:
                G = nx.Graph()
                
                # Add segments as edges
                for seg in segments:
                    try:
                        node1 = seg['start']
                        node2 = seg['end']
                        
                        # Add nodes and edge
                        G.add_node(node1)
                        G.add_node(node2)
                        G.add_edge(node1, node2, **seg)
                    except Exception as e:
                        print(f"ERROR adding edge to graph: {str(e)}", file=sys.stderr)
                        continue
                
                if G.number_of_edges() == 0:
                    print("WARNING: Graph has no edges after building", file=sys.stderr)
                    return G
                
                # Compute node metadata
                for node in G.nodes():
                    try:
                        degree = G.degree(node)
                        G.nodes[node]['degree'] = degree
                        G.nodes[node]['is_junction'] = degree >= 3
                        G.nodes[node]['is_corner'] = degree == 2
                    except Exception as e:
                        print(f"ERROR computing node metadata: {str(e)}", file=sys.stderr)
                        continue
                
                # Calculate confidence scores
                for edge in G.edges():
                    try:
                        seg_data = G.edges[edge]
                        confidence = compute_segment_confidence(seg_data, wall_likelihood_mask, G, scale_factor)
                        G.edges[edge]['confidence'] = confidence
                    except Exception as e:
                        print(f"ERROR computing confidence for edge: {str(e)}", file=sys.stderr)
                        G.edges[edge]['confidence'] = 0.7  # Default
                        continue
                
                print(f"Built wall graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges", file=sys.stderr)
                return G
            except Exception as e:
                print(f"ERROR building NetworkX graph: {str(e)}", file=sys.stderr)
                import traceback
                print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
                # Fallback to list
                for seg in segments:
                    seg['confidence'] = 0.7
                return segments
        else:
            # Fallback: return segments with basic confidence
            for seg in segments:
                seg['confidence'] = 0.7  # Default confidence
            return segments
    except Exception as e:
        print(f"ERROR in build_wall_graph: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return [] if not NETWORKX_AVAILABLE else nx.Graph()

def compute_segment_confidence(segment_data, wall_likelihood_mask, graph, scale_factor):
    """Compute confidence score for a wall segment"""
    try:
        length = segment_data.get('length', 0)
        angle = segment_data.get('angle', 0)
        start = segment_data.get('start', (0, 0))
        end = segment_data.get('end', (0, 0))
        
        # 1. Length score (more strict - prefer longer walls)
        min_wall_length_px = CONFIG['min_wall_length_ft'] / scale_factor
        if length < min_wall_length_px * 2:
            length_score = 0.3  # Very low for short segments
        elif length < min_wall_length_px * 5:
            length_score = 0.5  # Medium for medium segments
        else:
            length_score = 1.0  # High for long segments
        
        # 2. Mask overlap score (calculate actual overlap)
        mask_overlap_score = 0.5  # Default
        if wall_likelihood_mask is not None:
            try:
                # Sample points along segment
                num_samples = max(5, int(length / 5))
                overlap_count = 0
                height, width = wall_likelihood_mask.shape
                
                for i in range(num_samples):
                    t = i / (num_samples - 1) if num_samples > 1 else 0
                    x = int(start[0] + t * (end[0] - start[0]))
                    y = int(start[1] + t * (end[1] - start[1]))
                    
                    if 0 <= x < width and 0 <= y < height:
                        if wall_likelihood_mask[y, x] > 0:
                            overlap_count += 1
                
                mask_overlap_score = overlap_count / num_samples if num_samples > 0 else 0.5
            except:
                mask_overlap_score = 0.5
        
        # 3. Local density score (connections to other walls)
        parallel_count = 0
        perpendicular_count = 0
        if NETWORKX_AVAILABLE and graph:
            try:
                for edge in graph.edges(data=True):
                    if edge[0:2] == (start, end) or edge[0:2] == (end, start):
                        continue
                    other_angle = edge[2].get('angle', 0)
                    angle_diff = abs(angle - other_angle) % np.pi
                    if angle_diff < np.pi / 6 or angle_diff > 5 * np.pi / 6:  # Parallel
                        parallel_count += 1
                    elif abs(angle_diff - np.pi / 2) < np.pi / 6:  # Perpendicular
                        perpendicular_count += 1
            except:
                pass
        
        # Density score: prefer walls with connections
        total_connections = parallel_count + perpendicular_count
        density_score = min(1.0, total_connections / 3.0)  # Good if 3+ connections
        
        # 4. Structural alignment (prefer horizontal/vertical walls)
        angle_deg = abs(np.degrees(angle)) % 90
        if angle_deg < 5 or angle_deg > 85:  # Nearly horizontal or vertical
            structural_score = 1.0
        elif angle_deg < 15 or angle_deg > 75:  # Close to horizontal/vertical
            structural_score = 0.8
        else:  # Diagonal
            structural_score = 0.6
        
        # Combine scores with weights
        weights = CONFIG['confidence_weights']
        confidence = (
            weights['length'] * length_score +
            weights['mask_overlap'] * mask_overlap_score +
            weights['local_density'] * density_score +
            weights['structural_alignment'] * structural_score
        )
        
        # Penalize very short segments more aggressively
        if length < min_wall_length_px * 1.5:
            confidence *= 0.5  # Halve confidence for short segments
        
        return min(1.0, max(0.0, confidence))
    except Exception as e:
        print(f"ERROR computing segment confidence: {str(e)}", file=sys.stderr)
        return 0.5  # Default confidence on error

# ============================================================================
# PHASE 1: New Wall Detection (using graph-based approach)
# ============================================================================
def detect_walls_new(image_path, scale_factor, min_length_lf, ocr_text=None):
    """
    New wall detection using Phase 1 approach:
    1. Preprocess image
    2. Generate wall-likelihood mask
    3. Detect line segments
    4. Filter non-walls
    5. Build wall graph
    """
    # Phase 0: Preprocessing
    try:
        binary, scale_factor_adj, pixel_to_unit, image_shape = preprocess_image(image_path, scale_factor)
        if binary is None or image_shape is None:
            print("ERROR: Preprocessing failed - binary or image_shape is None", file=sys.stderr)
            return [], None, None, None, scale_factor
    except Exception as e:
        print(f"ERROR in preprocessing: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return [], None, None, None, scale_factor
    
    try:
        height, width = image_shape
        
        # Phase 1.1: Generate wall-likelihood mask
        wall_likelihood_mask = generate_wall_likelihood_mask(binary)
        if wall_likelihood_mask is None:
            print("ERROR: Failed to generate wall-likelihood mask", file=sys.stderr)
            return [], None, None, image_shape, scale_factor_adj
        
        # Phase 1.2: Detect line segments
        segments = detect_line_segments(wall_likelihood_mask)
        print(f"Detected {len(segments)} line segments", file=sys.stderr)
        
        # Phase 1.3: Filter non-wall segments
        ocr_text_list = ocr_text if ocr_text else []
        candidate_walls = filter_non_wall_segments(segments, scale_factor_adj, ocr_text_list, image_shape, wall_likelihood_mask)
        print(f"Filtered to {len(candidate_walls)} candidate wall segments", file=sys.stderr)
        
        # Phase 1.4: Build wall graph
        wall_graph = build_wall_graph(candidate_walls, scale_factor_adj, wall_likelihood_mask)
        if wall_graph is None:
            print("ERROR: Failed to build wall graph", file=sys.stderr)
            return [], None, wall_likelihood_mask, image_shape, scale_factor_adj
        
        # Convert graph to wall segments format (for compatibility)
        walls = []
        try:
            if NETWORKX_AVAILABLE and isinstance(wall_graph, nx.Graph):
                for edge in wall_graph.edges(data=True):
                    try:
                        node1, node2, data = edge
                        x1, y1 = node1
                        x2, y2 = node2
                        
                        # Validate coordinates
                        if not (0 <= x1 < width and 0 <= y1 < height and 0 <= x2 < width and 0 <= y2 < height):
                            continue
                        
                        # Convert to normalized coordinates
                        length_lf = data.get('length', 0) * scale_factor_adj
                        confidence = data.get('confidence', 0.7)
                        
                        # Filter by confidence threshold
                        if confidence < CONFIG['min_wall_confidence']:
                            continue
                        
                        # Additional length check (in real units)
                        if length_lf < CONFIG['min_wall_length_ft']:
                            continue
                        
                        walls.append({
                            "start": {"x": float(x1) / width, "y": float(y1) / height},
                            "end": {"x": float(x2) / width, "y": float(y2) / height},
                            "length": length_lf,
                            "confidence": confidence,
                            "thickness": data.get('thickness')
                        })
                    except Exception as e:
                        print(f"ERROR converting edge to wall segment: {str(e)}", file=sys.stderr)
                        continue
            else:
                # Fallback: use segments directly
                if isinstance(wall_graph, list):
                    for seg in wall_graph:
                        try:
                            x1, y1 = seg['start']
                            x2, y2 = seg['end']
                            
                            # Validate coordinates
                            if not (0 <= x1 < width and 0 <= y1 < height and 0 <= x2 < width and 0 <= y2 < height):
                                continue
                            
                            length_lf = seg['length'] * scale_factor_adj
                            
                            walls.append({
                                "start": {"x": float(x1) / width, "y": float(y1) / height},
                                "end": {"x": float(x2) / width, "y": float(y2) / height},
                                "length": length_lf,
                                "confidence": seg.get('confidence', 0.7)
                            })
                        except Exception as e:
                            print(f"ERROR converting segment to wall: {str(e)}", file=sys.stderr)
                            continue
        except Exception as e:
            print(f"ERROR converting wall graph to segments: {str(e)}", file=sys.stderr)
            import traceback
            print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        
        print(f"Converted to {len(walls)} wall segments", file=sys.stderr)
        return walls, wall_graph, wall_likelihood_mask, image_shape, scale_factor_adj
    except Exception as e:
        print(f"ERROR in detect_walls_new after preprocessing: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return [], None, None, image_shape if 'image_shape' in locals() else None, scale_factor_adj if 'scale_factor_adj' in locals() else scale_factor

# ============================================================================
# PHASE 2.1: Render Wall Mask from Graph
# ============================================================================
def render_wall_mask(wall_graph, image_shape, scale_factor):
    """
    Create a binary mask of walls from the wall graph
    
    Returns: Binary image (255 = wall, 0 = free space)
    """
    try:
        height, width = image_shape
        wall_mask = np.zeros((height, width), dtype=np.uint8)
        
        # Calculate wall thickness in pixels
        min_thickness_ft, max_thickness_ft = CONFIG['wall_thickness_ft_range']
        avg_thickness_ft = (min_thickness_ft + max_thickness_ft) / 2
        wall_thickness_px = int(avg_thickness_ft / scale_factor)
        wall_thickness_px = max(2, min(wall_thickness_px, 10))  # Clamp 2-10 pixels
        
        print(f"Rendering wall mask with thickness {wall_thickness_px}px (avg {avg_thickness_ft:.2f}ft)", file=sys.stderr)
        
        if NETWORKX_AVAILABLE and isinstance(wall_graph, nx.Graph):
            # Draw each edge in the graph
            edge_count = 0
            for edge in wall_graph.edges(data=True):
                try:
                    node1, node2, data = edge
                    x1, y1 = node1
                    x2, y2 = node2
                    
                    # Adjust thickness based on confidence
                    confidence = data.get('confidence', 0.7)
                    thickness = int(wall_thickness_px * (0.5 + 0.5 * confidence))
                    
                    # Ensure coordinates are within bounds
                    if (0 <= x1 < width and 0 <= y1 < height and
                        0 <= x2 < width and 0 <= y2 < height):
                        cv2.line(wall_mask, (x1, y1), (x2, y2), 255, thickness)
                        edge_count += 1
                except Exception as e:
                    print(f"Error drawing wall edge {edge}: {str(e)}", file=sys.stderr)
                    continue
            
            print(f"Drew {edge_count} wall edges on mask", file=sys.stderr)
        else:
            # Fallback: use segments directly
            segment_count = 0
            for seg in wall_graph:
                try:
                    x1, y1 = seg['start']
                    x2, y2 = seg['end']
                    confidence = seg.get('confidence', 0.7)
                    thickness = int(wall_thickness_px * (0.5 + 0.5 * confidence))
                    
                    if (0 <= x1 < width and 0 <= y1 < height and
                        0 <= x2 < width and 0 <= y2 < height):
                        cv2.line(wall_mask, (x1, y1), (x2, y2), 255, thickness)
                        segment_count += 1
                except Exception as e:
                    print(f"Error drawing wall segment: {str(e)}", file=sys.stderr)
                    continue
            
            print(f"Drew {segment_count} wall segments on mask", file=sys.stderr)
        
        # Dilate slightly to close gaps
        kernel = np.ones((3, 3), np.uint8)
        wall_mask = cv2.dilate(wall_mask, kernel, iterations=1)
        
        wall_pixel_count = np.sum(wall_mask > 0)
        print(f"Wall mask created: {wall_pixel_count} wall pixels ({wall_pixel_count/(width*height)*100:.2f}% of image)", file=sys.stderr)
        
        return wall_mask
    except Exception as e:
        print(f"ERROR in render_wall_mask: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        # Return empty mask on error
        return np.zeros(image_shape, dtype=np.uint8)

# ============================================================================
# PHASE 2.2: Generate Distance Transform
# ============================================================================
def generate_distance_transform(wall_mask):
    """
    Compute distance transform on inverse of wall mask
    
    Returns: Distance map (higher values = farther from walls)
    """
    try:
        # Invert mask (walls = 0, free space = 255)
        free_space = 255 - wall_mask
        
        # Distance transform
        dist_transform = cv2.distanceTransform(free_space, cv2.DIST_L2, 5)
        
        max_dist = np.max(dist_transform)
        print(f"Distance transform: max distance = {max_dist:.1f} pixels", file=sys.stderr)
        
        return dist_transform
    except Exception as e:
        print(f"ERROR in generate_distance_transform: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return None

# ============================================================================
# PHASE 2.3: Prepare Room Label Seeds
# ============================================================================
def prepare_room_seeds(ocr_text, wall_mask, distance_transform):
    """
    Prepare seed points for room detection from OCR room labels
    
    Returns: List of room seeds
    """
    try:
        if not ocr_text:
            print("No OCR text provided for room seed preparation", file=sys.stderr)
            return []
        
        height, width = wall_mask.shape
        
        # Filter OCR text for room labels
        room_labels = [text for text in ocr_text if text.get('type') == 'room_label']
        print(f"Found {len(room_labels)} room labels from {len(ocr_text)} OCR elements", file=sys.stderr)
        
        if not room_labels:
            print("No room labels found in OCR text", file=sys.stderr)
            return []
        
        room_seeds = []
        
        for i, label in enumerate(room_labels):
            try:
                bbox = label.get('bbox', {})
                label_text = label.get('text', '')
                
                if not bbox:
                    print(f"Skipping label {i}: no bbox", file=sys.stderr)
                    continue
                
                # Convert normalized bbox to pixel coordinates
                x_norm = bbox.get('x', 0)
                y_norm = bbox.get('y', 0)
                w_norm = bbox.get('width', 0)
                h_norm = bbox.get('height', 0)
                
                x_px = int(x_norm * width)
                y_px = int(y_norm * height)
                w_px = int(w_norm * width)
                h_px = int(h_norm * height)
                
                # Check if bbox center is in free space
                center_x = x_px + w_px // 2
                center_y = y_px + h_px // 2
                
                if not (0 <= center_x < width and 0 <= center_y < height):
                    print(f"Skipping label {i} '{label_text}': center out of bounds", file=sys.stderr)
                    continue
                
                if wall_mask[center_y, center_x] == 0:  # Free space
                    seed_x, seed_y = center_x, center_y
                else:
                    # Find max distance transform value in bbox
                    bbox_roi = distance_transform[
                        max(0, y_px):min(height, y_px + h_px),
                        max(0, x_px):min(width, x_px + w_px)
                    ]
                    
                    if bbox_roi.size > 0:
                        max_val = np.max(bbox_roi)
                        max_pos = np.unravel_index(np.argmax(bbox_roi), bbox_roi.shape)
                        seed_x = x_px + max_pos[1]
                        seed_y = y_px + max_pos[0]
                    else:
                        print(f"Skipping label {i} '{label_text}': empty bbox ROI", file=sys.stderr)
                        continue
                
                # Validate seed is in free space
                if 0 <= seed_x < width and 0 <= seed_y < height:
                    if wall_mask[seed_y, seed_x] == 0:
                        room_seeds.append({
                            'seed_id': i,
                            'position': (seed_x, seed_y),
                            'text_label': label_text,
                            'bbox': (x_px, y_px, w_px, h_px),
                            'confidence': label.get('confidence', 0.7)
                        })
                        print(f"Added seed {i} for '{label_text}' at ({seed_x}, {seed_y})", file=sys.stderr)
                    else:
                        print(f"Skipping label {i} '{label_text}': seed at wall pixel", file=sys.stderr)
                else:
                    print(f"Skipping label {i} '{label_text}': seed out of bounds", file=sys.stderr)
            except Exception as e:
                print(f"ERROR processing room label {i}: {str(e)}", file=sys.stderr)
                import traceback
                print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
                continue
        
        print(f"Prepared {len(room_seeds)} room seeds from {len(room_labels)} labels", file=sys.stderr)
        return room_seeds
    except Exception as e:
        print(f"ERROR in prepare_room_seeds: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return []

# ============================================================================
# PHASE 3.1: Constrained Flood Fill for Room Extraction
# ============================================================================
def extract_rooms_constrained_flood_fill(room_seeds, wall_mask, scale_factor):
    """
    Extract room polygons using constrained flood fill
    
    Returns: List of room dictionaries
    """
    try:
        if not room_seeds:
            print("No room seeds provided for flood fill", file=sys.stderr)
            return []
        
        height, width = wall_mask.shape
        free_space_mask = 255 - wall_mask  # Invert: free space = 255
        
        rooms = []
        min_area_px = CONFIG['min_room_area_sf'] / (scale_factor ** 2)
        max_area_px = CONFIG['max_room_area_sf'] / (scale_factor ** 2)
        
        print(f"Starting flood fill for {len(room_seeds)} seeds (min_area={min_area_px:.0f}px, max_area={max_area_px:.0f}px)", file=sys.stderr)
        
        for seed_idx, seed in enumerate(room_seeds):
            try:
                seed_x, seed_y = seed['position']
                
                # Validate seed position
                if not (0 <= seed_x < width and 0 <= seed_y < height):
                    print(f"Skipping seed {seed_idx}: out of bounds ({seed_x}, {seed_y})", file=sys.stderr)
                    continue
                
                if wall_mask[seed_y, seed_x] > 0:
                    print(f"Skipping seed {seed_idx}: on wall pixel", file=sys.stderr)
                    continue
                
                # Create mask for flood fill
                fill_mask = np.zeros((height + 2, width + 2), dtype=np.uint8)
                
                # Flood fill parameters
                lo_diff = (20, 20, 20)
                up_diff = (20, 20, 20)
                flags = 4 | (255 << 8) | cv2.FLOODFILL_MASK_ONLY
                
                # Create image copy for flood fill
                img_copy = free_space_mask.copy().astype(np.uint8)
                
                # Perform flood fill
                try:
                    _, img_copy, fill_mask, rect = cv2.floodFill(
                        img_copy, fill_mask, (seed_x + 1, seed_y + 1), 255,
                        loDiff=lo_diff, upDiff=up_diff, flags=flags
                    )
                except Exception as e:
                    print(f"Flood fill failed for seed {seed_idx}: {str(e)}", file=sys.stderr)
                    continue
                
                # Remove border padding
                fill_mask = fill_mask[1:-1, 1:-1]
                
                # Find contours in filled region
                contours, _ = cv2.findContours(fill_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                
                if not contours:
                    print(f"No contours found for seed {seed_idx}", file=sys.stderr)
                    continue
                
                # Get largest contour
                largest_contour = max(contours, key=cv2.contourArea)
                area_px = cv2.contourArea(largest_contour)
                
                # Validate area
                if area_px < min_area_px:
                    print(f"Seed {seed_idx}: area {area_px:.0f}px < min {min_area_px:.0f}px", file=sys.stderr)
                    continue
                
                if area_px > max_area_px:
                    print(f"Seed {seed_idx}: area {area_px:.0f}px > max {max_area_px:.0f}px", file=sys.stderr)
                    continue
                
                # Check aspect ratio
                x, y, w, h = cv2.boundingRect(largest_contour)
                aspect_ratio = max(w, h) / min(w, h) if min(w, h) > 0 else 0
                if aspect_ratio > 15:
                    print(f"Seed {seed_idx}: aspect ratio {aspect_ratio:.2f} too high", file=sys.stderr)
                    continue
                
                # Simplify contour
                epsilon = 0.02 * cv2.arcLength(largest_contour, True)
                approx = cv2.approxPolyDP(largest_contour, epsilon, True)
                
                if len(approx) < 3:
                    print(f"Seed {seed_idx}: simplified contour has {len(approx)} points (< 3)", file=sys.stderr)
                    continue
                
                # Convert to normalized coordinates
                polygon = []
                for point in approx:
                    x_norm = float(point[0][0]) / width
                    y_norm = float(point[0][1]) / height
                    polygon.append({'x': x_norm, 'y': y_norm})
                
                # Calculate area and perimeter
                area_sf = area_px * (scale_factor ** 2)
                perimeter_px = cv2.arcLength(largest_contour, True)
                perimeter_lf = perimeter_px * scale_factor
                
                rooms.append({
                    'room_id': seed['seed_id'],
                    'label_text': seed.get('text_label', ''),
                    'polygon': polygon,
                    'area_sf': round(area_sf, 2),
                    'perimeter_lf': round(perimeter_lf, 2),
                    'confidence': seed.get('confidence', 0.7)
                })
                
                print(f"Extracted room {seed_idx}: {area_sf:.1f} SF, {len(polygon)} points, label='{seed.get('text_label', '')}'", file=sys.stderr)
                
            except Exception as e:
                print(f"ERROR processing seed {seed_idx}: {str(e)}", file=sys.stderr)
                import traceback
                print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
                continue
        
        print(f"Extracted {len(rooms)} rooms from {len(room_seeds)} seeds", file=sys.stderr)
        return rooms
    except Exception as e:
        print(f"ERROR in extract_rooms_constrained_flood_fill: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return []

# ============================================================================
# PHASE 3.2: Room Validation
# ============================================================================
def validate_rooms(rooms, wall_mask, wall_graph):
    """
    Validate detected rooms
    
    Returns: Validated rooms with validation flags
    """
    try:
        if not rooms:
            print("No rooms to validate", file=sys.stderr)
            return []
        
        height, width = wall_mask.shape
        validated_rooms = []
        
        print(f"Validating {len(rooms)} rooms", file=sys.stderr)
        
        for i, room in enumerate(rooms):
            try:
                polygon = room['polygon']
                area_sf = room['area_sf']
                perimeter_lf = room['perimeter_lf']
                
                # Convert polygon to pixel coordinates for validation
                polygon_px = [
                    (int(p['x'] * width), int(p['y'] * height))
                    for p in polygon
                ]
                
                # 1. Enclosure check
                enclosure_score = check_enclosure(polygon_px, wall_mask)
                
                # 2. Area and shape checks
                aspect_ratio = calculate_aspect_ratio(polygon_px)
                perimeter_area_ratio = perimeter_lf / area_sf if area_sf > 0 else 0
                
                # 3. Classify room type
                is_corridor = (
                    aspect_ratio > CONFIG['corridor_aspect_ratio_threshold'] or
                    perimeter_area_ratio > CONFIG['corridor_perimeter_area_ratio_threshold']
                )
                
                is_open_space = enclosure_score < 0.5  # Less than 50% enclosed
                
                # Validation flags - stricter criteria
                # Require higher enclosure score for enclosed rooms
                room['valid_enclosed_room'] = enclosure_score > 0.75 and not is_corridor and area_sf >= CONFIG['min_room_area_sf'] and area_sf <= CONFIG['max_room_area_sf']
                # Open space rooms still allowed but with stricter checks
                room['valid_open_space_room'] = is_open_space and not is_corridor and area_sf >= CONFIG['min_room_area_sf'] and area_sf <= CONFIG['max_room_area_sf']
                room['corridor_like_region'] = is_corridor
                room['invalid_region'] = not (room['valid_enclosed_room'] or room['valid_open_space_room'] or room['corridor_like_region'])
                room['enclosure_score'] = enclosure_score
                room['aspect_ratio'] = aspect_ratio
                
                print(f"Room {i} '{room.get('label_text', '')}': enclosure={enclosure_score:.2f}, aspect={aspect_ratio:.2f}, valid={room['valid_enclosed_room']}", file=sys.stderr)
                
                validated_rooms.append(room)
            except Exception as e:
                print(f"ERROR validating room {i}: {str(e)}", file=sys.stderr)
                import traceback
                print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
                continue
        
        valid_count = sum(1 for r in validated_rooms if r['valid_enclosed_room'] or r['valid_open_space_room'])
        print(f"Validation complete: {valid_count}/{len(validated_rooms)} rooms valid", file=sys.stderr)
        
        return validated_rooms
    except Exception as e:
        print(f"ERROR in validate_rooms: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return rooms  # Return original rooms on error

def check_enclosure(polygon_px, wall_mask):
    """Check that room boundary is mostly adjacent to walls"""
    try:
        height, width = wall_mask.shape
        
        # Sample points along polygon boundary
        boundary_points = []
        for j in range(len(polygon_px)):
            p1 = polygon_px[j]
            p2 = polygon_px[(j + 1) % len(polygon_px)]
            
            # Sample points along edge
            num_samples = max(5, int(np.sqrt((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2) / 5))
            for k in range(num_samples):
                t = k / num_samples
                x = int(p1[0] + t * (p2[0] - p1[0]))
                y = int(p1[1] + t * (p2[1] - p1[1]))
                boundary_points.append((x, y))
        
        # Check how many boundary points are near walls
        wall_adjacent_count = 0
        search_radius = 5
        
        for x, y in boundary_points:
            if 0 <= x < width and 0 <= y < height:
                y_min = max(0, y - search_radius)
                y_max = min(height, y + search_radius + 1)
                x_min = max(0, x - search_radius)
                x_max = min(width, x + search_radius + 1)
                
                if np.any(wall_mask[y_min:y_max, x_min:x_max] > 0):
                    wall_adjacent_count += 1
        
        enclosure_score = wall_adjacent_count / len(boundary_points) if boundary_points else 0
        return enclosure_score
    except Exception as e:
        print(f"ERROR in check_enclosure: {str(e)}", file=sys.stderr)
        return 0.5  # Default score on error

# ============================================================================
# PHASE 5: Deep Learning Segmentation Service
# ============================================================================

class DeepLearningSegmentationService:
    """
    Deep learning-based segmentation for floor plans
    Uses segmentation-models-pytorch with pre-trained models
    
    Model: U-Net with EfficientNet-B0 encoder (good for architectural segmentation)
    Pre-trained on ImageNet, fine-tuned for segmentation tasks
    """
    
    def __init__(self):
        if not TORCH_AVAILABLE:
            raise RuntimeError("PyTorch and segmentation-models-pytorch are required but not installed")
        
        # Detect best available device (CUDA > MPS > CPU)
        if torch.cuda.is_available():
            self.device = torch.device('cuda')
            print(f"Using CUDA device: {torch.cuda.get_device_name(0)}", file=sys.stderr)
        elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            self.device = torch.device('mps')
            print("Using Apple Metal Performance Shaders (MPS)", file=sys.stderr)
        else:
            self.device = torch.device('cpu')
            print("Using CPU (slower - consider using GPU if available)", file=sys.stderr)
        
        self.model = None
        self.hf_model = None
        self.hf_processor = None
        self.preprocessing_fn = None
        self.use_huggingface = False
        self.load_model()
    
    def load_model(self):
        """Load pre-trained U-Net segmentation model
        
        Supports:
        1. Custom pre-trained floor plan model (if dl_model_path is set)
        2. HuggingFace Transformers model (if dl_use_huggingface is True)
        3. Default: ImageNet pre-trained U-Net (fallback)
        """
        try:
            model_path = CONFIG.get('dl_model_path')
            use_huggingface = CONFIG.get('dl_use_huggingface', False)
            
            # Option 1: Use HuggingFace Transformers model
            if use_huggingface and HUGGINGFACE_AVAILABLE:
                model_name = CONFIG.get('dl_huggingface_model', 'nvidia/segformer-b0-finetuned-ade-512-512')
                print(f"Loading HuggingFace model: {model_name}", file=sys.stderr)
                self.hf_model = SegformerForSemanticSegmentation.from_pretrained(model_name)
                self.hf_processor = SegformerImageProcessor.from_pretrained(model_name)
                self.hf_model.to(self.device)
                self.hf_model.eval()
                self.use_huggingface = True
                print(f"HuggingFace model loaded successfully", file=sys.stderr)
                return
            
            # Option 2: Load custom pre-trained floor plan model
            if model_path:
                print(f"DEBUG: Attempting to load model from path: {model_path}", file=sys.stderr)
                print(f"DEBUG: Current working directory: {os.getcwd()}", file=sys.stderr)
                
                # Resolve relative paths (relative to project root)
                if not os.path.isabs(model_path):
                    # On Railway: cwd = /app, model_path = 'server/models/floor_plan_cubicasa5k_resnet50.pth'
                    # We need: /app/server/models/floor_plan_cubicasa5k_resnet50.pth
                    cwd = os.getcwd()
                    
                    # Check multiple locations where Node.js might save the model
                    # Primary: /app/models/ (simplest, always exists)
                    primary_path = os.path.join(cwd, 'models', 'floor_plan_cubicasa5k_resnet50.pth')
                    
                    # Also check /app/server/models/ and /tmp (backup locations)
                    server_path = os.path.join(cwd, 'server', 'models', 'floor_plan_cubicasa5k_resnet50.pth')
                    tmp_path = '/tmp/floor_plan_cubicasa5k_resnet50.pth'
                    
                    possible_paths = [
                        primary_path,  # Primary: /app/models/... (simplest path)
                        server_path,  # Alternative: /app/server/models/...
                        tmp_path,  # Backup: /tmp/... (also saved by Node.js)
                        os.path.join(cwd, model_path),  # /app/server/models/... (from config)
                        os.path.join(cwd, '..', model_path),  # If cwd is server/
                        model_path  # Try as-is
                    ]
                    
                    # Also try relative to where Python script might be running from
                    try:
                        # If this is embedded in a TypeScript file, we might be in server/dist or server/
                        script_dir = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else cwd
                        possible_paths.extend([
                            os.path.join(script_dir, '..', '..', '..', 'server', 'models', 'floor_plan_cubicasa5k_resnet50.pth'),  # From server/dist/src/services/
                            os.path.join(script_dir, '..', '..', 'models', 'floor_plan_cubicasa5k_resnet50.pth'),  # From server/dist/
                        ])
                    except:
                        pass
                    
                    # Remove duplicates while preserving order
                    seen = set()
                    unique_paths = []
                    for p in possible_paths:
                        abs_p = os.path.abspath(p)
                        if abs_p not in seen:
                            seen.add(abs_p)
                            unique_paths.append(p)
                    possible_paths = unique_paths
                    
                    print(f"DEBUG: Trying {len(possible_paths)} possible paths...", file=sys.stderr)
                    model_path_resolved = None
                    for test_path in possible_paths:
                        abs_path = os.path.abspath(test_path)
                        print(f"DEBUG: Checking: {abs_path} (exists: {os.path.exists(abs_path)})", file=sys.stderr)
                        if os.path.exists(abs_path):
                            model_path_resolved = abs_path
                            break
                    model_path = model_path_resolved
                
                if model_path and os.path.exists(model_path):
                    print(f"DEBUG: Found model at: {model_path}", file=sys.stderr)
                    print(f"Loading custom floor plan model from: {model_path}", file=sys.stderr)
                    ENCODER = 'resnet50'  # ResNet-50 encoder (matches training)
                    CLASSES = ['background', 'walls', 'rooms']
                    
                    # Create model architecture
                    self.model = smp.Unet(
                        encoder_name=ENCODER,
                        encoder_weights=None,  # Don't load ImageNet weights
                        classes=len(CLASSES),
                        activation='softmax',
                    )
                    
                    # Load custom weights
                    # Load to CPU first, then move to device (more reliable across platforms)
                    checkpoint = torch.load(model_path, map_location='cpu')
                    
                    # Try to load state dict with error handling
                    try:
                        if isinstance(checkpoint, dict) and 'state_dict' in checkpoint:
                            missing_keys, unexpected_keys = self.model.load_state_dict(checkpoint['state_dict'], strict=False)
                        elif isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
                            missing_keys, unexpected_keys = self.model.load_state_dict(checkpoint['model_state_dict'], strict=False)
                        else:
                            missing_keys, unexpected_keys = self.model.load_state_dict(checkpoint, strict=False)
                        
                        if missing_keys:
                            print(f"WARNING: Missing keys in checkpoint: {len(missing_keys)} keys", file=sys.stderr)
                            if len(missing_keys) <= 10:  # Only print if not too many
                                print(f"Missing keys: {missing_keys}", file=sys.stderr)
                        if unexpected_keys:
                            print(f"WARNING: Unexpected keys in checkpoint: {len(unexpected_keys)} keys", file=sys.stderr)
                            if len(unexpected_keys) <= 10:
                                print(f"Unexpected keys: {unexpected_keys}", file=sys.stderr)
                    except Exception as e:
                        print(f"ERROR: Failed to load model state dict: {str(e)}", file=sys.stderr)
                        raise RuntimeError(f"Model checkpoint format incompatible: {str(e)}")
                    
                    self.model.to(self.device)
                    self.model.eval()
                    # Preprocessing function uses ImageNet normalization (standard for ResNet encoders)
                    # This matches the training preprocessing
                    try:
                        self.preprocessing_fn = smp.encoders.get_preprocessing_fn(ENCODER, 'imagenet')
                    except Exception as e:
                        print(f"WARNING: Could not get preprocessing function for {ENCODER}: {str(e)}", file=sys.stderr)
                        print("Will use manual ImageNet normalization as fallback", file=sys.stderr)
                        self.preprocessing_fn = None
                    self.use_huggingface = False
                    print(f"Custom floor plan model loaded successfully", file=sys.stderr)
                    print(f"Model parameters: {sum(p.numel() for p in self.model.parameters()):,}", file=sys.stderr)
                    print(f"Encoder: {ENCODER}, Classes: {len(CLASSES)}, Input size: {CONFIG['dl_model_input_size']}", file=sys.stderr)
                    return
                else:
                    print(f"WARNING: Model path specified but file not found: {model_path}", file=sys.stderr)
                    print(f"WARNING: Falling back to ImageNet pre-trained model", file=sys.stderr)
            
            # Option 3: Default - ImageNet pre-trained (fallback)
            print(f"Loading default U-Net model (ImageNet pre-trained)", file=sys.stderr)
            print("NOTE: For better accuracy, use a floor-plan-trained model. See FLOOR_PLAN_MODEL_RESEARCH.md", file=sys.stderr)
            
            ENCODER = 'efficientnet-b0'
            ENCODER_WEIGHTS = 'imagenet'
            CLASSES = ['background', 'walls', 'rooms']
            ACTIVATION = 'softmax'
            
            self.model = smp.Unet(
                encoder_name=ENCODER,
                encoder_weights=ENCODER_WEIGHTS,
                classes=len(CLASSES),
                activation=ACTIVATION,
            )
            
            self.model.to(self.device)
            self.model.eval()
            self.preprocessing_fn = smp.encoders.get_preprocessing_fn(ENCODER, ENCODER_WEIGHTS)
            self.use_huggingface = False
            
            print(f"U-Net model loaded successfully (encoder: {ENCODER})", file=sys.stderr)
            print(f"Model parameters: {sum(p.numel() for p in self.model.parameters()):,}", file=sys.stderr)
            
        except Exception as e:
            print(f"ERROR loading DL model: {str(e)}", file=sys.stderr)
            import traceback
            print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
            raise RuntimeError(f"Failed to load deep learning model: {str(e)}")
    
    def segment_image(self, image_path):
        """
        Use DL to segment floor plans into walls and rooms
        
        Returns:
            - wall_mask: Binary mask of wall pixels (uint8, 0-255)
            - room_mask: Binary mask of room pixels (uint8, 0-255)
            - confidence_map: Confidence scores (float32, 0-1)
        """
        try:
            # Load image in RGB format (matches training)
            image_bgr = cv2.imread(image_path)
            if image_bgr is None:
                raise ValueError(f"Failed to load image: {image_path}")
            
            # Validate image dimensions
            original_height, original_width = image_bgr.shape[:2]
            if original_height <= 0 or original_width <= 0:
                raise ValueError(f"Invalid image dimensions: {original_width}x{original_height}")
            if original_height < 32 or original_width < 32:
                raise ValueError(f"Image too small: {original_width}x{original_height} (minimum 32x32)")
            if original_height > 10000 or original_width > 10000:
                print(f"WARNING: Very large image: {original_width}x{original_height} (may cause memory issues)", file=sys.stderr)
            
            # Convert BGR to RGB (OpenCV loads as BGR, but model expects RGB)
            image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
            
            # Keep grayscale for post-processing (Canny edge detection)
            gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
            
            # Run inference based on model type
            if self.use_huggingface and self.hf_model is not None:
                # Use HuggingFace Transformers model
                image_pil = Image.fromarray(image_rgb)
                inputs = self.hf_processor(images=image_pil, return_tensors="pt")
                inputs = {k: v.to(self.device) for k, v in inputs.items()}
                
                with torch.no_grad():
                    outputs = self.hf_model(**inputs)
                    logits = outputs.logits
                
                # Validate logits shape
                if len(logits.shape) != 4 or logits.shape[0] != 1:
                    raise ValueError(f"Unexpected logits shape from HuggingFace model: {logits.shape}")
                
                # Upsample logits to original size
                upsampled_logits = nn.functional.interpolate(
                    logits, size=(original_height, original_width),
                    mode="bilinear", align_corners=False
                )
                pr_mask_np = torch.softmax(upsampled_logits, dim=1)[0].cpu().numpy()
                
                # Clean up GPU memory
                del logits, upsampled_logits, inputs, outputs
                if self.device.type == 'cuda':
                    torch.cuda.empty_cache()
                elif self.device.type == 'mps':
                    torch.mps.empty_cache()
                
                # Validate output shape
                if len(pr_mask_np.shape) != 3:
                    raise ValueError(f"Unexpected probability mask shape: {pr_mask_np.shape}")
                
                # Segformer outputs: background, walls, rooms (or similar classes)
                if pr_mask_np.shape[0] >= 3:
                    edge_probs = pr_mask_np[1].copy()  # Walls/edges - copy to avoid memory issues
                    region_probs = pr_mask_np[2].copy()  # Rooms
                else:
                    # Fallback if model has different class structure
                    if pr_mask_np.shape[0] > 0:
                        edge_probs = pr_mask_np[0].copy() if pr_mask_np.shape[0] > 0 else np.zeros((original_height, original_width), dtype=np.float32)
                    else:
                        edge_probs = np.zeros((original_height, original_width), dtype=np.float32)
                    region_probs = pr_mask_np[1].copy() if pr_mask_np.shape[0] > 1 else np.zeros((original_height, original_width), dtype=np.float32)
                
                # Clean up large array
                del pr_mask_np
            else:
                # Use segmentation-models-pytorch model
                # CRITICAL: Match training preprocessing exactly!
                # Training uses A.Resize(512, 512) which STRETCHES to 512x512 (no aspect ratio preservation)
                # This is important for accuracy - model was trained on stretched images
                target_size = CONFIG['dl_model_input_size']
                if original_width <= 0 or original_height <= 0:
                    raise ValueError(f"Invalid image dimensions for resizing: {original_width}x{original_height}")
                
                # Stretch to target_size x target_size (matches training - albumentations Resize)
                # Use INTER_LINEAR to match albumentations default interpolation
                image_resized = cv2.resize(image_rgb, (target_size, target_size), interpolation=cv2.INTER_LINEAR)
                image_padded = image_resized  # No padding needed - already exactly target_size x target_size
                new_width = target_size
                new_height = target_size
                
                # Preprocess for model (ImageNet normalization - matches training exactly)
                # Training: ToTensorV2() converts to [0,1] range, then Normalize applies ImageNet stats
                # We need to match this order: convert to [0,1] first, then normalize
                if self.preprocessing_fn:
                    # preprocessing_fn from smp handles the full pipeline correctly
                    image_preprocessed = self.preprocessing_fn(image_padded)
                else:
                    # Fallback: manual ImageNet normalization (matches albumentations exactly)
                    # Step 1: Convert to [0, 1] range (matches ToTensorV2)
                    image_preprocessed = image_padded.astype(np.float32) / 255.0
                    # Step 2: Apply ImageNet normalization (matches A.Normalize)
                    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
                    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
                    # Ensure std values are non-zero to avoid division by zero
                    std = np.maximum(std, 1e-7)  # Prevent division by zero
                    image_preprocessed = (image_preprocessed - mean) / std
                
                # Convert to tensor format: [C, H, W] (matches ToTensorV2 output)
                image_tensor = torch.from_numpy(image_preprocessed).permute(2, 0, 1).float()
                image_tensor = image_tensor.unsqueeze(0).to(self.device)  # Add batch dimension: [1, C, H, W]
                
                # Run inference (model already has softmax activation, so output is probabilities)
                with torch.no_grad():
                    pr_mask = self.model(image_tensor)  # Use model() not model.predict()
                
                # Validate model output shape
                if pr_mask.shape[1] != 3:
                    raise ValueError(f"Model output has {pr_mask.shape[1]} classes, expected 3 (background, walls, rooms)")
                
                # Model has activation='softmax', so output is already probabilities [0-1]
                # No need to apply softmax again
                pr_mask_np = pr_mask[0].cpu().numpy()  # [3, H, W] - already softmaxed
                
                # Clean up GPU memory
                del pr_mask, image_tensor
                if self.device.type == 'cuda':
                    torch.cuda.empty_cache()
                elif self.device.type == 'mps':
                    torch.mps.empty_cache()
                
                # Debug: Log prediction statistics
                print(f"DL prediction stats: shape={pr_mask_np.shape}, min={pr_mask_np.min():.3f}, max={pr_mask_np.max():.3f}, mean={pr_mask_np.mean():.3f}", file=sys.stderr)
                print(f"Class probabilities - background: {pr_mask_np[0].mean():.3f}, walls: {pr_mask_np[1].mean():.3f}, rooms: {pr_mask_np[2].mean():.3f}", file=sys.stderr)
                
                # Extract class probabilities (model output is [3, target_size, target_size])
                # Since we stretched to square, no cropping needed - use full output
                edge_probs = pr_mask_np[1].copy()  # Walls (class 1) - copy to avoid memory issues
                region_probs = pr_mask_np[2].copy()  # Rooms (class 2)
                
                # Clean up large array before resizing
                del pr_mask_np
                
                # Validate dimensions before resizing
                if edge_probs.shape[0] <= 0 or edge_probs.shape[1] <= 0:
                    raise ValueError(f"Invalid probability map dimensions: {edge_probs.shape}")
                if region_probs.shape[0] <= 0 or region_probs.shape[1] <= 0:
                    raise ValueError(f"Invalid probability map dimensions: {region_probs.shape}")
                
                # Resize back to original image size (stretch back to original aspect ratio)
                # Use INTER_LINEAR to match training interpolation
                if original_width > 0 and original_height > 0:
                    edge_probs = cv2.resize(edge_probs, (original_width, original_height), interpolation=cv2.INTER_LINEAR)
                    region_probs = cv2.resize(region_probs, (original_width, original_height), interpolation=cv2.INTER_LINEAR)
                else:
                    raise ValueError(f"Invalid original dimensions for resizing: {original_width}x{original_height}")
                
                # Clean up intermediate arrays
                del image_resized, image_padded, image_preprocessed
            
            # Validate that probability maps exist and have correct shape
            if edge_probs is None or region_probs is None:
                raise ValueError("Probability maps are None - model inference failed")
            if edge_probs.shape != (original_height, original_width):
                raise ValueError(f"Edge probabilities shape mismatch: {edge_probs.shape} != ({original_height}, {original_width})")
            if region_probs.shape != (original_height, original_width):
                raise ValueError(f"Region probabilities shape mismatch: {region_probs.shape} != ({original_height}, {original_width})")
            
            # Validate confidence threshold
            conf_threshold = CONFIG['dl_confidence_threshold']
            if not (0.0 <= conf_threshold <= 1.0):
                print(f"WARNING: Invalid confidence threshold {conf_threshold}, clamping to [0, 1]", file=sys.stderr)
                conf_threshold = max(0.0, min(1.0, conf_threshold))
            
            # Create wall mask from DL predictions
            # Use a slightly lower threshold for walls to capture more detail
            wall_threshold = max(0.3, conf_threshold - 0.1)
            wall_mask = (edge_probs > wall_threshold).astype(np.uint8) * 255
            
            # Optional: Combine with Canny edges for refinement (but DL should be primary)
            # This helps fill small gaps in wall detection
            canny_edges = cv2.Canny(gray, 50, 150)
            # Only add Canny edges that are near DL-detected walls (within 3 pixels)
            kernel_dilate = np.ones((3, 3), np.uint8)
            wall_mask_dilated = cv2.dilate(wall_mask, kernel_dilate, iterations=1)
            canny_near_walls = cv2.bitwise_and(canny_edges, wall_mask_dilated)
            wall_mask = cv2.bitwise_or(wall_mask, canny_near_walls)
            
            # Dilate slightly to create thicker wall mask (walls are typically 3-6 inches)
            kernel = np.ones((3, 3), np.uint8)
            wall_mask = cv2.dilate(wall_mask, kernel, iterations=1)
            
            # Create room mask from DL predictions
            # Use the configured threshold for rooms (more conservative to avoid false positives)
            room_mask = (region_probs > conf_threshold).astype(np.uint8) * 255
            
            # Remove wall regions from room mask
            room_mask = cv2.bitwise_and(room_mask, 255 - wall_mask)
            
            # Apply titleblock exclusion to room mask
            # Clamp exclusion values to valid ranges
            exclude_top = max(0, min(int(original_height * CONFIG['titleblock_exclude_top']), original_height))
            exclude_bottom = max(0, min(int(original_height * CONFIG['titleblock_exclude_bottom']), original_height))
            exclude_left = max(0, min(int(original_width * CONFIG['titleblock_exclude_left']), original_width))
            exclude_right = max(0, min(int(original_width * CONFIG['titleblock_exclude_right']), original_width))
            
            # Ensure exclude_bottom > exclude_top and exclude_right > exclude_left
            if exclude_bottom <= exclude_top:
                exclude_bottom = min(exclude_top + 1, original_height)
            if exclude_right <= exclude_left:
                exclude_right = min(exclude_left + 1, original_width)
            
            # Zero out titleblock regions (safely handle edge cases)
            if exclude_top > 0:
                room_mask[0:exclude_top, :] = 0
            if exclude_bottom < original_height:
                room_mask[exclude_bottom:, :] = 0
            if exclude_left > 0:
                room_mask[:, 0:exclude_left] = 0
            if exclude_right < original_width:
                room_mask[:, exclude_right:] = 0
            
            # Filter out very large regions (likely white space outside floor plan)
            # Find connected components and remove large ones
            num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(room_mask, connectivity=8)
            max_room_area_px = (original_width * original_height) * 0.3  # Max 30% of image
            for i in range(1, num_labels):
                area = stats[i, cv2.CC_STAT_AREA]
                if area > max_room_area_px:
                    room_mask[labels == i] = 0
            
            # Create confidence map (safely handle potential NaN or inf values)
            confidence_map = np.maximum(
                np.nan_to_num(edge_probs, nan=0.0, posinf=1.0, neginf=0.0),
                np.nan_to_num(region_probs, nan=0.0, posinf=1.0, neginf=0.0)
            )
            
            wall_pixels = np.sum(wall_mask > 0)
            room_pixels = np.sum(room_mask > 0)
            total_pixels = original_width * original_height
            if total_pixels > 0:
                wall_pct = (wall_pixels / total_pixels) * 100.0
                room_pct = (room_pixels / total_pixels) * 100.0
                print(f"DL-enhanced segmentation: wall_mask={wall_pixels}px ({wall_pct:.1f}%), room_mask={room_pixels}px ({room_pct:.1f}%)", file=sys.stderr)
            else:
                print(f"DL-enhanced segmentation: wall_mask={wall_pixels}px, room_mask={room_pixels}px (invalid dimensions)", file=sys.stderr)
            
            # Final cleanup of probability maps
            del edge_probs, region_probs
            
            return wall_mask, room_mask, confidence_map
            
        except Exception as e:
            print(f"ERROR in DL segmentation: {str(e)}", file=sys.stderr)
            import traceback
            print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
            raise RuntimeError(f"Deep learning segmentation failed: {str(e)}")

def build_wall_graph_from_mask(wall_mask, scale_factor, image_shape):
    """
    Build wall graph from deep learning segmentation mask
    
    Steps:
    1. Extract line segments from mask
    2. Filter and validate
    3. Build graph
    """
    try:
        # Use existing line detection on DL mask
        segments = detect_line_segments(wall_mask)
        print(f"DL mask: Detected {len(segments)} line segments", file=sys.stderr)
        
        # Filter segments (use existing filter function)
        # Note: OCR text might not be available yet, so pass empty list
        candidate_walls = filter_non_wall_segments(segments, scale_factor, [], image_shape, wall_mask)
        print(f"DL mask: Filtered to {len(candidate_walls)} candidate wall segments", file=sys.stderr)
        
        # Build graph
        wall_graph = build_wall_graph(candidate_walls, scale_factor, wall_mask)
        
        return wall_graph
    except Exception as e:
        print(f"ERROR building wall graph from DL mask: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return None

def extract_rooms_from_dl_mask(room_mask, scale_factor, ocr_text, image_shape):
    """
    Extract rooms from deep learning segmentation mask
    
    Steps:
    1. Find connected components in room mask
    2. Filter by titleblock exclusion
    3. Match with OCR labels
    4. Validate and classify
    """
    try:
        height, width = image_shape
        
        # Titleblock exclusion zones
        exclude_top = int(height * CONFIG['titleblock_exclude_top'])
        exclude_bottom = int(height * CONFIG['titleblock_exclude_bottom'])
        exclude_left = int(width * CONFIG['titleblock_exclude_left'])
        exclude_right = int(width * CONFIG['titleblock_exclude_right'])
        
        # Find connected components
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(room_mask, connectivity=8)
        
        rooms = []
        for i in range(1, num_labels):  # Skip background (label 0)
            # Get component mask
            component_mask = (labels == i).astype(np.uint8) * 255
            
            # Check if centroid is in titleblock region
            centroid_x = int(centroids[i][0])
            centroid_y = int(centroids[i][1])
            if (centroid_y < exclude_top or centroid_y > exclude_bottom or
                centroid_x < exclude_left or centroid_x > exclude_right):
                continue  # Skip rooms in titleblock region
            
            # Find contours
            contours, _ = cv2.findContours(component_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                continue
            
            # Get largest contour
            largest_contour = max(contours, key=cv2.contourArea)
            area_px = cv2.contourArea(largest_contour)
            
            # Validate area (stricter limits)
            min_area_px = CONFIG['min_room_area_sf'] / (scale_factor ** 2) if scale_factor > 0 else 1000
            max_area_px = CONFIG['max_room_area_sf'] / (scale_factor ** 2) if scale_factor > 0 else (width * height * 0.25)  # Reduced from 0.7 to 0.25
            
            if area_px < min_area_px or area_px > max_area_px:
                continue
            
            # Simplify contour
            epsilon = 0.02 * cv2.arcLength(largest_contour, True)
            approx = cv2.approxPolyDP(largest_contour, epsilon, True)
            
            if len(approx) < 3:
                continue
            
            # Calculate area and perimeter
            area_sf = area_px * (scale_factor ** 2)
            perimeter_px = cv2.arcLength(largest_contour, True)
            perimeter_lf = perimeter_px * scale_factor
            
            # Convert to normalized coordinates
            polygon = []
            for point in approx:
                x_norm = float(point[0][0]) / width
                y_norm = float(point[0][1]) / height
                polygon.append({'x': x_norm, 'y': y_norm})
            
            # Match with OCR labels
            label_text = ''
            if ocr_text:
                centroid_x = centroids[i][0] / width
                centroid_y = centroids[i][1] / height
                # Find nearest OCR label
                min_dist = float('inf')
                for text in ocr_text:
                    if text.get('type') == 'room_label':
                        bbox = text.get('bbox', {})
                        text_x = bbox.get('x', 0) + bbox.get('width', 0) / 2
                        text_y = bbox.get('y', 0) + bbox.get('height', 0) / 2
                        dist = np.sqrt((centroid_x - text_x)**2 + (centroid_y - text_y)**2)
                        if dist < min_dist and dist < 0.1:  # Within 10% of image
                            min_dist = dist
                            label_text = text.get('text', '')
            
            rooms.append({
                'polygon': polygon,
                'area_sf': round(area_sf, 2),
                'perimeter_lf': round(perimeter_lf, 2),
                'label_text': label_text,
                'confidence': 0.8  # DL confidence (higher than CV default)
            })
        
        print(f"DL mask: Extracted {len(rooms)} rooms from segmentation", file=sys.stderr)
        return rooms
    except Exception as e:
        print(f"ERROR extracting rooms from DL mask: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return []

# ============================================================================
# PHASE 4: Wall Refinement with Room Feedback (Iterative Refinement)
# ============================================================================

def refine_walls_with_room_feedback(wall_graph, rooms, wall_mask, wall_likelihood_mask, scale_factor, image_shape):
    """
    Iteratively refine walls using room boundary feedback
    
    Steps:
    1. Identify rooms with gaps (enclosure_score 0.3-0.7)
    2. Find boundary gaps in these rooms
    3. Search for nearby segments that could close gaps
    4. Promote segments if they align with room boundaries
    5. Remove spurious walls (not supporting any room)
    6. Re-validate rooms with refined walls
    7. Iterate until convergence or max iterations
    """
    try:
        max_iterations = 3
        convergence_threshold = 0.05  # Stop if enclosure improvement < 5%
        
        height, width = image_shape
        previous_avg_enclosure = 0.0
        
        if not rooms or len(rooms) == 0:
            print("Phase 4: No rooms to refine walls with", file=sys.stderr)
            return wall_graph, wall_mask, rooms
        
        print(f"Phase 4: Starting iterative refinement with {len(rooms)} rooms", file=sys.stderr)
        
        for iteration in range(max_iterations):
            print(f"Phase 4 iteration {iteration + 1}/{max_iterations}", file=sys.stderr)
            
            # Step 1: Close gaps from room boundaries
            wall_graph, wall_mask = close_wall_gaps_from_rooms(
                rooms, wall_graph, wall_mask, wall_likelihood_mask, scale_factor, image_shape
            )
            
            # Step 2: Remove spurious walls
            wall_graph = remove_spurious_walls(wall_graph, rooms, image_shape)
            
            # Step 3: Re-render wall mask
            wall_mask = render_wall_mask(wall_graph, image_shape, scale_factor)
            
            # Step 4: Re-validate rooms with refined walls
            rooms = validate_rooms(rooms, wall_mask, wall_graph)
            
            # Step 5: Check convergence
            valid_rooms = [r for r in rooms if r.get('valid_enclosed_room') or r.get('valid_open_space_room')]
            if valid_rooms:
                current_avg_enclosure = sum(r.get('enclosure_score', 0) for r in valid_rooms) / len(valid_rooms)
                improvement = current_avg_enclosure - previous_avg_enclosure
                
                print(f"Iteration {iteration + 1}: avg_enclosure={current_avg_enclosure:.3f}, improvement={improvement:.3f}", file=sys.stderr)
                
                if improvement < convergence_threshold and iteration > 0:
                    print(f"Converged after {iteration + 1} iterations", file=sys.stderr)
                    break
                
                previous_avg_enclosure = current_avg_enclosure
            else:
                print(f"Iteration {iteration + 1}: No valid rooms to measure improvement", file=sys.stderr)
                break
        
        print(f"Phase 4 complete: Refined walls and re-validated {len(rooms)} rooms", file=sys.stderr)
        return wall_graph, wall_mask, rooms
    except Exception as e:
        print(f"ERROR in refine_walls_with_room_feedback: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return wall_graph, wall_mask, rooms  # Return unchanged on error

def close_wall_gaps_from_rooms(rooms, wall_graph, wall_mask, wall_likelihood_mask, scale_factor, image_shape):
    """
    Use room polygons to identify and close gaps in walls
    
    Steps:
    1. For each "almost enclosed" room, find boundary gaps
    2. Search for nearby low-confidence segments that could close gaps
    3. Promote segments if they align geometrically
    4. Update wall graph and mask
    """
    try:
        height, width = image_shape
        segments_promoted = 0
        
        for room in rooms:
            enclosure_score = room.get('enclosure_score', 1.0)
            # Focus on rooms that are "almost enclosed" (0.3-0.7)
            if enclosure_score < 0.7 and enclosure_score > 0.3:
                polygon_px = [
                    (int(p['x'] * width), int(p['y'] * height))
                    for p in room['polygon']
                ]
                
                # Find boundary arcs with gaps
                gaps = find_boundary_gaps(polygon_px, wall_mask, image_shape)
                
                for gap in gaps:
                    # Search for segments that could close this gap
                    candidate_segments = find_gap_closing_segments(
                        gap, wall_graph, wall_likelihood_mask, image_shape
                    )
                    
                    for seg_info in candidate_segments:
                        # Promote segment confidence
                        edge = seg_info['edge']
                        if NETWORKX_AVAILABLE and isinstance(wall_graph, nx.Graph):
                            if wall_graph.has_edge(*edge):
                                current_conf = wall_graph.edges[edge].get('confidence', 0.3)
                                if current_conf < 0.5:
                                    wall_graph.edges[edge]['confidence'] = 0.7
                                    segments_promoted += 1
        
        if segments_promoted > 0:
            print(f"Promoted {segments_promoted} segments to close gaps", file=sys.stderr)
        
        # Re-render wall mask with updated segments
        wall_mask = render_wall_mask(wall_graph, image_shape, scale_factor)
        
        return wall_graph, wall_mask
    except Exception as e:
        print(f"ERROR in close_wall_gaps_from_rooms: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return wall_graph, wall_mask

def find_boundary_gaps(polygon_px, wall_mask, image_shape):
    """
    Find gaps in room boundary where walls should be
    
    Returns list of gap segments
    """
    try:
        gaps = []
        search_radius = 10
        height, width = image_shape
        
        for i in range(len(polygon_px)):
            p1 = polygon_px[i]
            p2 = polygon_px[(i + 1) % len(polygon_px)]
            
            # Sample points along edge
            edge_length = np.sqrt((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2)
            num_samples = max(10, int(edge_length / 5))
            gap_points = []
            
            for j in range(num_samples):
                t = j / (num_samples - 1) if num_samples > 1 else 0
                x = int(p1[0] + t * (p2[0] - p1[0]))
                y = int(p1[1] + t * (p2[1] - p1[1]))
                
                # Check if point is near a wall
                y_min = max(0, y - search_radius)
                y_max = min(height, y + search_radius + 1)
                x_min = max(0, x - search_radius)
                x_max = min(width, x + search_radius + 1)
                
                if 0 <= y < height and 0 <= x < width:
                    if not np.any(wall_mask[y_min:y_max, x_min:x_max] > 0):
                        gap_points.append((x, y))
            
            # If more than 30% of edge is gap, record it
            if len(gap_points) > num_samples * 0.3:
                gaps.append({
                    'start': p1,
                    'end': p2,
                    'gap_points': gap_points
                })
        
        return gaps
    except Exception as e:
        print(f"ERROR in find_boundary_gaps: {str(e)}", file=sys.stderr)
        return []

def find_gap_closing_segments(gap, wall_graph, wall_likelihood_mask, image_shape):
    """
    Find low-confidence segments that could close a gap
    
    Returns candidate segments
    """
    try:
        candidates = []
        height, width = image_shape
        
        # Search for segments near gap
        gap_center_x = (gap['start'][0] + gap['end'][0]) / 2
        gap_center_y = (gap['start'][1] + gap['end'][1]) / 2
        
        # Calculate gap direction
        gap_angle = np.arctan2(gap['end'][1] - gap['start'][1], gap['end'][0] - gap['start'][0])
        
        if NETWORKX_AVAILABLE and isinstance(wall_graph, nx.Graph):
            for edge in wall_graph.edges(data=True):
                node1, node2, data = edge
                x1, y1 = node1
                x2, y2 = node2
                
                # Check if segment is near gap
                seg_center_x = (x1 + x2) / 2
                seg_center_y = (y1 + y2) / 2
                
                distance = np.sqrt((gap_center_x - seg_center_x)**2 + (gap_center_y - seg_center_y)**2)
                
                if distance < 50:  # Within 50 pixels
                    confidence = data.get('confidence', 1.0)
                    if confidence < 0.5:  # Low confidence segment
                        # Check if segment aligns with gap direction
                        seg_angle = data.get('angle', np.arctan2(y2 - y1, x2 - x1))
                        
                        angle_diff = abs(gap_angle - seg_angle) % np.pi
                        if angle_diff < np.pi / 6 or angle_diff > 5 * np.pi / 6:  # Within 30°
                            candidates.append({
                                'edge': (node1, node2),
                                'data': data,
                                'confidence': confidence
                            })
        
        return candidates
    except Exception as e:
        print(f"ERROR in find_gap_closing_segments: {str(e)}", file=sys.stderr)
        return []

def remove_spurious_walls(wall_graph, rooms, image_shape):
    """
    Remove walls that don't support any room boundary
    
    Returns: Updated wall_graph with spurious walls removed
    """
    try:
        height, width = image_shape
        
        if not rooms or len(rooms) == 0:
            return wall_graph
        
        # Create room boundary mask
        room_boundary_mask = np.zeros((height, width), dtype=np.uint8)
        
        for room in rooms:
            polygon_px = [
                (int(p['x'] * width), int(p['y'] * height))
                for p in room['polygon']
            ]
            # Draw room boundary
            if len(polygon_px) >= 3:
                cv2.polylines(room_boundary_mask, [np.array(polygon_px, dtype=np.int32)], True, 255, 2)
        
        # Dilate to include nearby regions
        kernel = np.ones((15, 15), np.uint8)
        room_boundary_mask = cv2.dilate(room_boundary_mask, kernel, iterations=1)
        
        # Check each wall segment
        edges_to_remove = []
        
        if NETWORKX_AVAILABLE and isinstance(wall_graph, nx.Graph):
            for edge in wall_graph.edges(data=True):
                node1, node2, data = edge
                x1, y1 = node1
                x2, y2 = node2
                
                # Sample points along segment
                length = data.get('length', np.sqrt((x2-x1)**2 + (y2-y1)**2))
                num_samples = max(5, int(length / 10))
                near_room_count = 0
                
                for i in range(num_samples):
                    t = i / (num_samples - 1) if num_samples > 1 else 0
                    x = int(x1 + t * (x2 - x1))
                    y = int(y1 + t * (y2 - y1))
                    
                    if 0 <= x < width and 0 <= y < height:
                        if room_boundary_mask[y, x] > 0:
                            near_room_count += 1
                
                # If segment is far from rooms and has low confidence, mark for removal
                near_room_ratio = near_room_count / num_samples if num_samples > 0 else 0
                confidence = data.get('confidence', 0.5)
                
                if near_room_ratio < 0.2 and confidence < 0.4:
                    # Check if isolated (few connections)
                    degree1 = wall_graph.degree(node1)
                    degree2 = wall_graph.degree(node2)
                    
                    if degree1 <= 2 and degree2 <= 2:
                        edges_to_remove.append((node1, node2))
            
            # Remove spurious walls
            for edge in edges_to_remove:
                wall_graph.remove_edge(*edge)
        
        if len(edges_to_remove) > 0:
            print(f"Removed {len(edges_to_remove)} spurious wall segments", file=sys.stderr)
        
        return wall_graph
    except Exception as e:
        print(f"ERROR in remove_spurious_walls: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return wall_graph

def calculate_aspect_ratio(polygon_px):
    """Calculate aspect ratio of room polygon"""
    try:
        if len(polygon_px) < 3:
            return 0
        
        # Get bounding box
        xs = [p[0] for p in polygon_px]
        ys = [p[1] for p in polygon_px]
        w = max(xs) - min(xs)
        h = max(ys) - min(ys)
        
        if min(w, h) == 0:
            return 0
        
        return max(w, h) / min(w, h)
    except Exception as e:
        print(f"ERROR in calculate_aspect_ratio: {str(e)}", file=sys.stderr)
        return 1.0  # Default aspect ratio on error

# ============================================================================
# PHASE 3.3: Room Type Classification
# ============================================================================
def classify_room_types(rooms):
    """
    Classify room types from labels and context
    
    Returns rooms with 'room_type' field added
    """
    try:
        room_type_keywords = {
            'living_room': ['living', 'lr', 'family', 'great room'],
            'bedroom': ['bedroom', 'br', 'master', 'guest'],
            'kitchen': ['kitchen', 'kt', 'cooking'],
            'bathroom': ['bath', 'ba', 'wc', 'toilet', 'lavatory'],
            'dining_room': ['dining', 'dr', 'eat'],
            'office': ['office', 'of', 'study', 'den'],
            'closet': ['closet', 'cl', 'storage'],
            'hallway': ['hall', 'hallway', 'corridor'],
            'balcony': ['balcony', 'deck', 'patio'],
            'garage': ['garage', 'gar'],
            'utility': ['utility', 'laundry', 'mechanical']
        }
        
        print(f"Classifying {len(rooms)} rooms", file=sys.stderr)
        
        for room in rooms:
            try:
                label_lower = room.get('label_text', '').lower()
                room_type = 'other'
                confidence = 0.5
                
                for type_name, keywords in room_type_keywords.items():
                    for keyword in keywords:
                        if keyword in label_lower:
                            room_type = type_name
                            confidence = 0.9
                            break
                    if room_type != 'other':
                        break
                
                # Special case: open kitchen
                if room_type == 'kitchen' and room.get('enclosure_score', 1.0) < 0.5:
                    room_type = 'open_kitchen'
                    confidence = 0.8
                
                room['room_type'] = room_type
                room['type_confidence'] = confidence
                
                print(f"Room '{room.get('label_text', '')}': classified as {room_type} (confidence={confidence:.2f})", file=sys.stderr)
            except Exception as e:
                print(f"ERROR classifying room: {str(e)}", file=sys.stderr)
                room['room_type'] = 'other'
                room['type_confidence'] = 0.5
                continue
        
        return rooms
    except Exception as e:
        print(f"ERROR in classify_room_types: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return rooms  # Return original rooms on error

# ============================================================================
# PHASE 3.4: Adjacency and Topology
# ============================================================================
def compute_room_adjacency(rooms):
    """
    Compute adjacency graph of rooms
    
    Returns rooms with 'adjacent_rooms' field added
    """
    try:
        print(f"Computing adjacency for {len(rooms)} rooms", file=sys.stderr)
        
        for i, room1 in enumerate(rooms):
            try:
                adjacent = []
                
                for j, room2 in enumerate(rooms):
                    if i == j:
                        continue
                    
                    # Check if polygons are adjacent (simplified distance check)
                    if are_rooms_adjacent(room1, room2):
                        adjacent.append(j)
                
                room1['adjacent_rooms'] = adjacent
                
                if adjacent:
                    print(f"Room {i} '{room1.get('label_text', '')}': adjacent to {len(adjacent)} rooms", file=sys.stderr)
            except Exception as e:
                print(f"ERROR computing adjacency for room {i}: {str(e)}", file=sys.stderr)
                room1['adjacent_rooms'] = []
                continue
        
        return rooms
    except Exception as e:
        print(f"ERROR in compute_room_adjacency: {str(e)}", file=sys.stderr)
        import traceback
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        return rooms  # Return original rooms on error

def are_rooms_adjacent(room1, room2):
    """Check if two rooms are adjacent"""
    try:
        poly1 = room1['polygon']
        poly2 = room2['polygon']
        
        # Check if bounding boxes are close (simplified)
        center1_x = sum(p['x'] for p in poly1) / len(poly1)
        center1_y = sum(p['y'] for p in poly1) / len(poly1)
        center2_x = sum(p['x'] for p in poly2) / len(poly2)
        center2_y = sum(p['y'] for p in poly2) / len(poly2)
        
        distance = np.sqrt((center1_x - center2_x)**2 + (center1_y - center2_y)**2)
        
        # Rooms are adjacent if close (within 0.1 normalized units)
        return distance < 0.1
    except Exception as e:
        print(f"ERROR in are_rooms_adjacent: {str(e)}", file=sys.stderr)
        return False

def detect_rooms(image_path, scale_factor, min_area_sf, epsilon, exterior_walls=None, dimension_text_mask=None):
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
    
    # PHASE 3: Very relaxed titleblock/legend exclusion (to catch more rooms)
    # Titleblocks are typically in corners or along edges with high text density
    # Exclude even smaller regions: top 10%, bottom 10%, left 5%, right 15% (titleblocks often on right)
    exclude_top = height * 0.10
    exclude_bottom = height * 0.90
    exclude_left = width * 0.05
    exclude_right = width * 0.85  # Much less aggressive right-side exclusion
    
    # Create a mask for titleblock regions using edge density (text creates high edge density)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    
    # Find regions with very high edge density (titleblocks, legends, notes, dimension strings)
    # Use smaller kernel and higher threshold to be more selective - only mark dense text regions
    kernel_large = np.ones((15, 15), np.float32) / 225  # Smaller kernel for more precise detection
    edge_density = cv2.filter2D((edges > 0).astype(np.uint8), -1, kernel_large)
    titleblock_mask = (edge_density > 0.8).astype(np.uint8)  # Much higher threshold (0.8) to only catch very dense text regions
    
    # Also mark edge regions as potential titleblocks
    titleblock_mask[0:int(exclude_top), :] = 1
    titleblock_mask[int(exclude_bottom):, :] = 1
    titleblock_mask[:, 0:int(exclude_left)] = 1
    titleblock_mask[:, int(exclude_right):] = 1
    
    # Create dimension string mask - detect elongated horizontal/vertical line regions
    # Dimension strings are typically long thin lines with text nearby
    dimension_mask = np.zeros((height, width), dtype=np.uint8)
    
    # Detect horizontal lines (dimension strings are often horizontal)
    # Use longer kernel to catch dimension baselines, but be more selective
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (60, 1))  # Longer horizontal kernel
    horizontal_lines = cv2.morphologyEx(edges, cv2.MORPH_OPEN, horizontal_kernel)
    # Less aggressive dilation to avoid removing room boundaries
    horizontal_lines = cv2.dilate(horizontal_lines, np.ones((2, 2), np.uint8), iterations=2)
    dimension_mask = cv2.bitwise_or(dimension_mask, horizontal_lines)
    
    # Detect vertical lines (some dimension strings are vertical)
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 60))  # Longer vertical kernel
    vertical_lines = cv2.morphologyEx(edges, cv2.MORPH_OPEN, vertical_kernel)
    # Less aggressive dilation
    vertical_lines = cv2.dilate(vertical_lines, np.ones((2, 2), np.uint8), iterations=2)
    dimension_mask = cv2.bitwise_or(dimension_mask, vertical_lines)
    
    # Dilate dimension mask to exclude areas near dimension strings
    # Reduced dilation to avoid removing too much (from 15x15 iterations=2 to 8x8 iterations=1)
    dimension_mask = cv2.dilate(dimension_mask, np.ones((8, 8), np.uint8), iterations=1)
    
    # Combine titleblock and dimension masks
    exclusion_mask = cv2.bitwise_or(titleblock_mask, dimension_mask)
    
    # If dimension_text_mask is provided (from OCR), add it to exclusion mask
    if dimension_text_mask is not None:
        exclusion_mask = cv2.bitwise_or(exclusion_mask, dimension_text_mask)
    
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
    
    # PHASE 3: Remove dimension string edges from edge detection
    # Dimension strings create false boundaries, so exclude them
    if dimension_mask is not None:
        # Remove edges that are in dimension string regions
        edges = cv2.bitwise_and(edges, 255 - dimension_mask)
    
    # PHASE 3: If we have wall mask, use it to enhance edges
    if wall_mask is not None:
        # Combine edges with wall mask (walls should have strong edges)
        edges = cv2.bitwise_or(edges, (wall_mask > 0).astype(np.uint8) * 255)
    
    # OPTIMIZATION: Use smaller kernel and fewer iterations for faster processing
    kernel = np.ones((3, 3), np.uint8)
    dilated = cv2.dilate(edges, kernel, iterations=1)
    closed = cv2.erode(dilated, kernel, iterations=1)
    
    # PHASE 3: Use RETR_TREE to get all contours (including nested ones)
    # This helps find rooms even when they're not perfectly closed or have interior elements
    # RETR_TREE gets nested contours (rooms inside the building outline)
    # Fallback to RETR_CCOMP if we get too many contours (still gets nested contours, just 2-level hierarchy)
    contours, hierarchy = cv2.findContours(closed, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    
    # If we get too many contours, use RETR_CCOMP instead (still gets nested contours, better than RETR_EXTERNAL)
    # RETR_CCOMP retrieves all contours and organizes them into a two-level hierarchy
    # This allows us to find individual rooms even when there's a building outline
    if len(contours) > 500:
        print(f"Too many contours ({len(contours)}), using RETR_CCOMP instead to get nested contours", file=sys.stderr)
        contours, hierarchy = cv2.findContours(closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    print(f"Found {len(contours)} contours for room detection", file=sys.stderr)
    
    rooms = []
    min_area_pixels = (min_area_sf / (scale_factor ** 2)) if scale_factor > 0 else 1000
    # Maximum area to filter out the entire floor plan - set to 40% to exclude building outline but allow large rooms
    # Individual rooms should be much smaller than the entire floor plan
    max_area_pixels = (width * height) * 0.40
    
    # PHASE 3: Pre-filter contours by area and titleblock exclusion
    # Calculate areas first and sort to process likely rooms first
    contour_areas = [(i, cv2.contourArea(contour)) for i, contour in enumerate(contours)]
    
    # Filter by area and titleblock exclusion
    # Also filter out contours that are clearly the entire building (cover too much of the image)
    filtered_indices = []
    image_area = width * height
    print(f"Pre-filtering {len(contour_areas)} contours (min_area={min_area_pixels:.0f}, max_area={max_area_pixels:.0f})", file=sys.stderr)
    for i, area in contour_areas:
        # Check area bounds
        if area < min_area_pixels or area > max_area_pixels:
            print(f"  Contour {i}: rejected - area {area:.0f} outside range [{min_area_pixels:.0f}, {max_area_pixels:.0f}]", file=sys.stderr)
            continue
        
        # Additional check: if contour covers more than 50% of image, it's likely the entire building outline
        area_ratio = area / image_area if image_area > 0 else 0
        if area_ratio > 0.50:
            print(f"  Contour {i}: rejected - covers {area_ratio*100:.1f}% of image (likely entire building outline)", file=sys.stderr)
            continue
        
        contour = contours[i]
        x, y, w, h = cv2.boundingRect(contour)
        
        # PHASE 3: Very relaxed titleblock/dimension exclusion (to catch more rooms)
        # Check if contour overlaps significantly with titleblock or dimension string mask
        contour_mask = np.zeros((height, width), dtype=np.uint8)
        cv2.drawContours(contour_mask, [contour], -1, 255, -1)
        exclusion_overlap = cv2.bitwise_and(contour_mask, exclusion_mask)
        overlap_ratio = np.sum(exclusion_overlap > 0) / max(1, np.sum(contour_mask > 0))
        
        # If more than 95% of contour is in exclusion regions (titleblock/dimensions), skip it
        # Relaxed from 0.8 to 0.95 to allow rooms near dimension strings but still filter out dimension artifacts
        if overlap_ratio > 0.95:
            print(f"  Contour {i}: rejected - exclusion zone overlap {overlap_ratio:.2f} > 0.95", file=sys.stderr)
            continue
        
        # Additional check: filter out very small contours that are likely note boxes or dimension artifacts
        # These are typically small rectangular areas with high text density
        # Only check very small contours to avoid filtering out actual rooms
        if area < min_area_pixels * 1.2:  # Only check contours very close to minimum
            # Check if it's a small rectangular box (likely a note box)
            box_ratio = area / (w * h) if (w * h) > 0 else 0
            # Only filter very small boxes (less than 80px) with high text density
            if box_ratio > 0.7 and (w < 80 or h < 80):  # Very small, compact rectangle
                # Check if it has high text density (likely a note box)
                contour_region = gray[y:y+h, x:x+w]
                if contour_region.size > 0:
                    # High edge density in small area = likely text box
                    region_edges = cv2.Canny(contour_region, 50, 150)
                    edge_density = np.sum(region_edges > 0) / max(1, region_edges.size)
                    # Higher threshold to avoid filtering actual rooms (0.35 instead of 0.25)
                    if edge_density > 0.35:  # Very high edge density = text box
                        print(f"  Contour {i}: rejected - small text box (area={area:.0f}, size={w}x{h}, edge_density={edge_density:.2f})", file=sys.stderr)
                        continue
                
                # Also check if it's in a high text density region (using exclusion mask)
                # Only reject if almost entirely in text region
                contour_mask = np.zeros((height, width), dtype=np.uint8)
                cv2.drawContours(contour_mask, [contour], -1, 255, -1)
                text_overlap = cv2.bitwise_and(contour_mask, exclusion_mask)
                text_overlap_ratio = np.sum(text_overlap > 0) / max(1, np.sum(contour_mask > 0))
                if text_overlap_ratio > 0.9:  # More than 90% overlap with text regions (very strict)
                    print(f"  Contour {i}: rejected - note box in text region (text_overlap={text_overlap_ratio:.2f})", file=sys.stderr)
                    continue
        
        # Check if bounding box is in exclusion zones (very relaxed)
        if (y < exclude_top or y + h > exclude_bottom or 
            x < exclude_left or x + w > exclude_right):
            # If more than 80% of bounding box is in exclusion zones, skip (very relaxed from 60%)
            exclusion_overlap = 0
            if y < exclude_top:
                exclusion_overlap += min(h, exclude_top - y) * w
            if y + h > exclude_bottom:
                exclusion_overlap += min(h, (y + h) - exclude_bottom) * w
            if x < exclude_left:
                exclusion_overlap += min(w, exclude_left - x) * h
            if x + w > exclude_right:
                exclusion_overlap += min(w, (x + w) - exclude_right) * h
            
            exclusion_ratio = exclusion_overlap / (w * h) if (w * h) > 0 else 0
            if exclusion_overlap > (w * h * 0.8):  # Very relaxed from 0.6 to 0.8
                print(f"  Contour {i}: rejected - exclusion zone overlap {exclusion_ratio:.2f} > 0.8", file=sys.stderr)
                continue
        
        print(f"  Contour {i}: passed pre-filter (area={area:.0f}, bbox=({x},{y},{w},{h}))", file=sys.stderr)
        filtered_indices.append(i)
    
    # Sort by area (largest first) and limit to top 100
    filtered_indices.sort(key=lambda i: contour_areas[i][1], reverse=True)
    filtered_indices = filtered_indices[:100]
    
    # Track processed contours to avoid duplicates
    processed_contours = set()
    
    print(f"Processing {len(filtered_indices)} filtered contours for room detection", file=sys.stderr)
    
    for contour_idx in filtered_indices:
        contour = contours[contour_idx]
        # Skip if already processed
        contour_id = id(contour)
        if contour_id in processed_contours:
            continue
        
        area_pixels = cv2.contourArea(contour)
        
        # Get bounding box to check aspect ratio and position
        x, y, w, h = cv2.boundingRect(contour)
        aspect_ratio = max(w, h) / min(w, h) if min(w, h) > 0 else 0
        
        # PHASE 3: Filter out dimension string artifacts
        # Dimension strings create very elongated contours between dimension lines and floor plan
        # These are typically very thin and long
        if aspect_ratio > 15:  # Very elongated
            # Check if it's likely a dimension string artifact (thin, long, near edges)
            min_dim = min(w, h)
            max_dim = max(w, h)
            # If it's very thin (< 20 pixels) and very long, likely a dimension artifact
            if min_dim < 20 and max_dim > 200:
                print(f"  Rejected contour {contour_idx}: dimension string artifact (aspect={aspect_ratio:.2f}, size={w}x{h})", file=sys.stderr)
                continue
            # Also check if it's near the edges (where dimension strings typically are)
            edge_distance = min(x, y, width - x - w, height - y - h)
            if edge_distance < 50:  # Close to edge
                print(f"  Rejected contour {contour_idx}: elongated shape near edge (aspect={aspect_ratio:.2f}, edge_dist={edge_distance})", file=sys.stderr)
                continue
        
        # PHASE 3: Very relaxed aspect ratio - rooms should be reasonably rectangular
        # Very elongated shapes are likely corridors or dimension strings
        # Further relaxed from 15 to 20 to catch more room shapes
        if aspect_ratio > 20:
            print(f"  Rejected contour {contour_idx}: aspect ratio too high ({aspect_ratio:.2f})", file=sys.stderr)
            continue
        
        # PHASE 3: Validate that room is bounded by walls (optional requirement)
        # Rooms should ideally be enclosed by detected walls, but make this optional
        # Only enforce wall alignment if we have a reasonable number of walls detected
        if wall_mask is not None and exterior_walls is not None and len(exterior_walls) >= 4:  # Only enforce if we have at least 4 walls
            # Check if room boundary aligns with walls
            # Sample points along the contour and check if they're near walls
            contour_points = contour.reshape(-1, 2)
            wall_alignment_count = 0
            num_check_points = min(50, len(contour_points))  # Check up to 50 points
            
            # Increase search radius for wall alignment (from 5 to 10 pixels)
            search_radius = 10
            
            for pt_idx in range(0, len(contour_points), max(1, len(contour_points) // num_check_points)):
                px, py = contour_points[pt_idx]
                px, py = int(px), int(py)
                
                if 0 <= px < width and 0 <= py < height:
                    # Check if this point is near a wall (within search_radius pixels)
                    y_min = max(0, py - search_radius)
                    y_max = min(height, py + search_radius + 1)
                    x_min = max(0, px - search_radius)
                    x_max = min(width, px + search_radius + 1)
                    
                    if np.any(wall_mask[y_min:y_max, x_min:x_max] > 0):
                        wall_alignment_count += 1
            
            # PHASE 3: At least 15% of room boundary should align with walls (very relaxed from 20%)
            # This ensures rooms are somewhat bounded by detected walls, but allows more flexibility
            alignment_ratio = wall_alignment_count / num_check_points if num_check_points > 0 else 0
            if alignment_ratio < 0.15:
                print(f"  Rejected contour {contour_idx}: wall alignment too low ({alignment_ratio:.3f})", file=sys.stderr)
                continue  # Room is not properly bounded by walls, skip it
        # If we have fewer than 4 walls or no walls, skip wall alignment check entirely
        else:
            print(f"  Skipping wall alignment check for contour {contour_idx} (walls={len(exterior_walls) if exterior_walls else 0})", file=sys.stderr)
        
        # Check if contour is approximately closed (rooms should be enclosed)
        # Calculate how close the start and end points are
        if len(contour) > 0:
            start_point = contour[0][0]
            end_point = contour[-1][0]
            closure_dist = np.sqrt((start_point[0] - end_point[0])**2 + (start_point[1] - end_point[1])**2)
            perimeter = cv2.arcLength(contour, True)
            # PHASE 3: Very relaxed closure - rooms should be reasonably enclosed
            # Some rooms may have small gaps (doors, openings), but not too large
            # Further relaxed from 0.25 to 0.40 to catch rooms with larger openings
            if perimeter > 0 and closure_dist / perimeter > 0.40:
                print(f"  Rejected contour {contour_idx}: closure check failed (closure_dist/perimeter = {closure_dist/perimeter:.3f})", file=sys.stderr)
                continue
        
        # Simplify contour (reduce vertices while preserving shape)
        epsilon_factor = epsilon * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, epsilon_factor, True)
        
        # Skip if simplified contour has too few points (likely noise)
        # Further relaxed from 3 to 2 to catch even simpler shapes
        if len(approx) < 2:
            print(f"  Rejected contour {contour_idx}: simplified contour has too few points ({len(approx)})", file=sys.stderr)
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
        
        print(f"  Accepted contour {contour_idx}: area={area_sf:.1f} SF, aspect={aspect_ratio:.2f}, confidence={confidence:.3f}", file=sys.stderr)
        
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
        # Dimension strings are typically:
        # - Short lines (extension lines, dimension lines) OR very long horizontal/vertical lines near edges
        # - Near text/numbers
        # - Horizontal or vertical
        # - Near the edges of the drawing (where dimensions are placed)
        is_short_line = length_pixels < min_length_pixels * 2  # Short relative to min wall length
        text_ratio = text_intersections / num_samples
        near_text_ratio = near_text_count / num_samples
        
        # Check if line is near edges (dimension strings are typically near drawing edges)
        line_center_x = (x1 + x2) / 2
        line_center_y = (y1 + y2) / 2
        edge_distance = min(line_center_x, line_center_y, width - line_center_x, height - line_center_y)
        is_near_edge = edge_distance < min(width, height) * 0.15  # Within 15% of edge
        
        # Check if line is near edges (dimension strings are typically near drawing edges)
        line_center_x = (x1 + x2) / 2
        line_center_y = (y1 + y2) / 2
        edge_distance = min(line_center_x, line_center_y, width - line_center_x, height - line_center_y)
        is_near_edge = edge_distance < min(width, height) * 0.20  # Within 20% of edge
        
        # More aggressive dimension string filtering:
        # 1. Short lines near text (dimension extension lines)
        # 2. Lines near edges that are horizontal/vertical and near text (dimension strings)
        # 3. Very long horizontal/vertical lines near edges (dimension baselines)
        # 4. Any line with high text intersection (>30%)
        is_very_long = length_pixels > min(width, height) * 0.25  # Very long line
        
        if (is_short_line and (text_ratio > 0.15 or near_text_ratio > 0.3)) or \
           (is_near_edge and (is_horizontal or is_vertical) and (text_ratio > 0.1 or near_text_ratio > 0.2)) or \
           (is_very_long and is_near_edge and (is_horizontal or is_vertical)) or \
           (text_ratio > 0.3):  # Any line with >30% text intersection
            continue  # Skip dimension string lines
        
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
    
    if len(segments) == 0:
        print(f"No segments found for wall detection", file=sys.stderr)
        return []  # No line segments found at all
    
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
    
    # If no wall pairs found, fallback to using single line segments as walls
    # This handles cases where walls are drawn as single lines or pairing logic is too strict
    if len(wall_pairs) == 0:
        print("No valid wall pairs found - falling back to single line segments", file=sys.stderr)
        print(f"Wall thickness range was: {min_wall_thickness_pixels:.1f} to {max_wall_thickness_pixels:.1f} pixels", file=sys.stderr)
        
        # Use single line segments as walls (assume default wall thickness)
        # Filter segments by length and convert to normalized wall format
        default_wall_thickness = 0.5  # Assume 6" wall thickness in feet
        single_wall_segments = []
        
        for seg in segments:
            length_lf = seg["length"] * scale_factor
            if length_lf >= min_length_lf:
                # Convert to normalized coordinates (0-1) like the merged walls
                single_wall_segments.append({
                    "start": {"x": float(seg["start"][0]) / width, "y": float(seg["start"][1]) / height},
                    "end": {"x": float(seg["end"][0]) / width, "y": float(seg["end"][1]) / height},
                    "length": round(length_lf, 2),
                    "thickness": default_wall_thickness,  # Default thickness in feet
                    "confidence": min(0.95, 0.7 + (length_lf / 200) * 0.1)  # Lower confidence for single lines
                })
        
        if len(single_wall_segments) > 0:
            print(f"Using {len(single_wall_segments)} single line segments as walls", file=sys.stderr)
            # Sort by length (longest first) and limit to reasonable number
            single_wall_segments.sort(key=lambda w: w["length"], reverse=True)
            single_wall_segments = single_wall_segments[:100]  # Limit to top 100
            return single_wall_segments  # Return directly, skip merging
        else:
            print("No valid single line segments found either", file=sys.stderr)
            return []  # No valid walls found at all
    
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
        print("Tesseract not available, skipping OCR", file=sys.stderr)
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
            
            # Classify text type based on patterns (improved for architectural drawings)
            text_lower = text.lower().strip()
            text_upper = text.upper().strip()
            text_type = 'other'
            
            # Skip if text is clearly a dimension (has units)
            has_dimension_units = any(unit in text_lower for unit in ["'", '"', 'ft', 'in', 'cm', 'm', 'feet', 'inch', 'meter'])
            
            # Improved room label detection patterns based on actual floor plans
            is_room_label = False
            
            # Pattern 1: Explicit room keywords (ROOM, UNIT, SPACE, AREA, etc.)
            room_keywords = ['room', 'rm', 'unit', 'space', 'area', 'zone', 'lobby', 'vestibule', 'vest']
            if any(keyword in text_lower for keyword in room_keywords):
                is_room_label = True
            
            # Pattern 2: Room type names (OFFICE, RESTROOM, LOUNGE, etc.)
            room_types = [
                'office', 'restroom', 'bathroom', 'bath', 'kitchen', 'bedroom', 'closet', 
                'hall', 'corridor', 'stair', 'elevator', 'lounge', 'breakroom', 'laundry',
                'storage', 'fitness', 'game', 'trash', 'fire', 'elect', 'linen', 'prep',
                'hydration', 'dry', 'goods', 'women', 'men', 'accessible', 'housekeeping',
                'mech', 'command', 'center', 'work', 'eat', 'drink', 'mailroom', 'pbx'
            ]
            if any(room_type in text_lower for room_type in room_types):
                is_room_label = True
            
            # Pattern 3: Name + Number format (e.g., "OFFICE 107", "FITNESS ROOM 123")
            # Matches: [WORD(S)] [3-4 digit number]
            # Use raw string - quotes are optional so we can match without them
            name_number_pattern = r'^[A-Z][A-Z0-9\s\-]+\s+\d{3,4}$'
            if re.match(name_number_pattern, text_upper):
                is_room_label = True
            
            # Pattern 4: Unit codes (e.g., "Unit 'QQ-A' 202", "QQ-B 203")
            # Use separate patterns to avoid quote conflicts in raw strings
            # Pattern 4a: Unit with quotes (single or double)
            unit_with_quotes = r"unit\s*" + chr(39) + r"[A-Z0-9\-]+" + chr(39) + r"\s*\d+"
            unit_with_dquotes = r'unit\s*"[A-Z0-9\-]+"\s*\d+'
            # Pattern 4b: Unit without quotes
            unit_no_quotes = r"unit\s+[A-Z0-9\-]+\s+\d+"
            # Pattern 4c: Code format like QQ-A 202
            unit_code = r"[A-Z]{1,3}[-'][A-Z]\s*\d{3}"
            
            if (re.search(unit_with_quotes, text_upper, re.IGNORECASE) or 
                re.search(unit_with_dquotes, text_upper, re.IGNORECASE) or
                re.search(unit_no_quotes, text_upper, re.IGNORECASE) or
                re.search(unit_code, text_upper, re.IGNORECASE)):
                is_room_label = True
            
            # EXCLUDE: Gridlines and section tags (e.g., "A6.01", "A4.05", "16A A4.05", "03", "01 A6.01")
            # These are typically alphanumeric codes with dots or small numbers in circles
            is_gridline_or_section = False
            # Pattern: Letter(s) + number(s) + dot + number(s) - e.g., "A6.01", "A4.05"
            if re.match(r'^[A-Z]\d+\.\d+$', text_upper):
                is_gridline_or_section = True
            # Pattern: Number(s) + Letter(s) + space + Letter + number + dot + number - e.g., "16A A4.05"
            if re.match(r'^\d+[A-Z]\s+[A-Z]\d+\.\d+$', text_upper):
                is_gridline_or_section = True
            # Pattern: Small numbers in circles (typically 1-2 digits) - e.g., "03", "01", "07"
            if text.isdigit() and len(text) <= 2:
                # Check if it's very small (likely a circle annotation)
                if w < 30 and h < 30:  # Very small text = likely annotation
                    is_gridline_or_section = True
            # Pattern: Number + Letter + dot + number - e.g., "01 A6.01", "02 A6.02"
            if re.match(r'^\d+\s+[A-Z]\d+\.\d+$', text_upper):
                is_gridline_or_section = True
            
            if is_gridline_or_section:
                text_type = 'annotation'  # Mark as annotation, not room label
                is_room_label = False
            
            # Pattern 5: Standalone 3-4 digit numbers (likely room numbers)
            # But exclude if it's clearly a dimension, gridline, or in titleblock area
            if not is_gridline_or_section and text.replace('.', '').replace('-', '').isdigit() and 3 <= len(text) <= 4:
                # Check if it's in titleblock region (right 20% or bottom 20%)
                if x_norm < 0.8 and y_norm < 0.8:  # Not in titleblock
                    is_room_label = True
            
            # Pattern 6: Room abbreviations (BR, BA, KT, OF, etc.)
            # But exclude if it matches gridline patterns
            if not is_gridline_or_section:
                room_abbrevs = ['br', 'ba', 'kt', 'lr', 'dr', 'of', 'cl', 'st', 'el', 'lb', 'vb', 'hk', 'la']
                if text_lower in room_abbrevs or re.match(r'^[A-Z]{1,3}\s*\d+$', text_upper):
                    is_room_label = True
            
            # Exclude dimensions (has units) and very long text (notes)
            # Note: gridlines/section tags are already marked as 'annotation' above
            if has_dimension_units:
                text_type = 'dimension'
            elif len(text) > 25:
                text_type = 'note'
            elif is_room_label:
                text_type = 'room_label'
            elif any(char.isdigit() for char in text) and ('ft' in text_lower or 'in' in text_lower or "'" in text or '"' in text):
                text_type = 'dimension'
            # If already marked as annotation (gridline/section), keep that type
            
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

def detect_rooms_from_text(image_path, scale_factor, min_area_sf, room_labels, walls=None):
    """Detect rooms using text-first approach: grow regions from room label positions"""
    img = cv2.imread(image_path)
    if img is None or len(room_labels) == 0:
        return []
    
    height, width = img.shape[:2]
    
    # Resize if needed (same as detect_rooms)
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
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Create boundary mask from walls if available
    boundary_mask = np.zeros((height, width), dtype=np.uint8)
    if walls and len(walls) > 0:
        for wall in walls:
            x1 = int(wall["start"]["x"] * width)
            y1 = int(wall["start"]["y"] * height)
            x2 = int(wall["end"]["x"] * width)
            y2 = int(wall["end"]["y"] * height)
            cv2.line(boundary_mask, (x1, y1), (x2, y2), 255, 3)
        # Dilate walls to create boundary region
        kernel = np.ones((5, 5), np.uint8)
        boundary_mask = cv2.dilate(boundary_mask, kernel, iterations=2)
    
    # Also use edge detection to find boundaries
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    kernel = np.ones((3, 3), np.uint8)
    dilated_edges = cv2.dilate(edges, kernel, iterations=2)
    boundary_mask = cv2.bitwise_or(boundary_mask, dilated_edges)
    
    # Titleblock exclusion (same as detect_rooms)
    exclude_top = height * 0.10
    exclude_bottom = height * 0.90
    exclude_left = width * 0.05
    exclude_right = width * 0.85
    
    rooms = []
    min_area_pixels = (min_area_sf / (scale_factor ** 2)) if scale_factor > 0 else 1000
    max_area_pixels = (width * height) * 0.7
    
    def grow_room_from_seed(seed_x, seed_y, search_direction='down', max_distance=200):
        """Grow room region from seed point using flood fill"""
        if not (0 <= seed_x < width and 0 <= seed_y < height):
            return None
        
        # Check if seed is in titleblock region
        if seed_y < exclude_top or seed_y > exclude_bottom or seed_x < exclude_left or seed_x > exclude_right:
            return None
        
        # Create mask for flood fill
        fill_mask = np.zeros((height + 2, width + 2), dtype=np.uint8)
        
        # Adjust seed for mask (floodFill needs +1 offset)
        mask_x, mask_y = int(seed_x) + 1, int(seed_y) + 1
        
        # Flood fill parameters
        lo_diff = (20, 20, 20)
        up_diff = (20, 20, 20)
        flags = 4 | (255 << 8) | cv2.FLOODFILL_MASK_ONLY
        
        # Create a copy of image for flood fill
        img_copy = img.copy()
        
        try:
            # Perform flood fill
            _, img_copy, fill_mask, rect = cv2.floodFill(
                img_copy, fill_mask, (mask_x, mask_y), 255,
                loDiff=lo_diff, upDiff=up_diff, flags=flags
            )
            
            # Remove border padding
            fill_mask = fill_mask[1:-1, 1:-1]
            
            # Stop at boundaries (walls/edges)
            fill_mask = cv2.bitwise_and(fill_mask, 255 - boundary_mask)
            
            # Find contours in the filled region
            contours, _ = cv2.findContours(fill_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            if not contours:
                return None
            
            # Get largest contour
            largest_contour = max(contours, key=cv2.contourArea)
            area_pixels = cv2.contourArea(largest_contour)
            
            # Validate area
            if area_pixels < min_area_pixels or area_pixels > max_area_pixels:
                return None
            
            # Check aspect ratio
            x, y, w, h = cv2.boundingRect(largest_contour)
            aspect_ratio = max(w, h) / min(w, h) if min(w, h) > 0 else 0
            if aspect_ratio > 15:
                return None
            
            # Simplify contour
            epsilon = 0.02 * cv2.arcLength(largest_contour, True)
            approx = cv2.approxPolyDP(largest_contour, epsilon, True)
            
            if len(approx) < 3:
                return None
            
            # Convert to normalized coordinates
            points = []
            for point in approx:
                x_norm = float(point[0][0]) / width
                y_norm = float(point[0][1]) / height
                points.append({"x": x_norm, "y": y_norm})
            
            # Calculate area and perimeter
            area_sf = area_pixels * (scale_factor ** 2)
            perimeter_pixels = cv2.arcLength(largest_contour, True)
            perimeter_lf = perimeter_pixels * scale_factor
            
            return {
                "points": points,
                "area": round(area_sf, 2),
                "perimeter": round(perimeter_lf, 2),
                "confidence": 0.85,  # High confidence for text-based detection
                "roomLabel": None  # Will be set by caller
            }
        except Exception as e:
            print(f"Flood fill error: {str(e)}", file=sys.stderr)
            return None
    
    # Process each room label
    for label in room_labels:
        label_bbox = label.get("bbox", {})
        label_text = label.get("text", "")
        
        # Get label position (normalized to 0-1)
        label_x_norm = label_bbox.get("x", 0) + label_bbox.get("width", 0) / 2
        label_y_norm = label_bbox.get("y", 0) + label_bbox.get("height", 0) / 2
        
        # Convert to pixel coordinates
        label_x = int(label_x_norm * width)
        label_y = int(label_y_norm * height)
        label_w = int(label_bbox.get("width", 0) * width)
        label_h = int(label_bbox.get("height", 0) * height)
        
        # Try multiple search strategies
        strategies = [
            # Strategy 1: Label above room (most common) - search down
            (label_x, label_y + label_h + 10, 'down', 0.9),
            # Strategy 2: Label inside room - use center
            (label_x, label_y, 'all', 0.85),
            # Strategy 3: Label below room - search up
            (label_x, label_y - 20, 'up', 0.8),
            # Strategy 4: Label beside room - search right
            (label_x + label_w + 10, label_y, 'right', 0.75),
            # Strategy 5: Label beside room - search left
            (label_x - 10, label_y, 'left', 0.75),
        ]
        
        best_room = None
        best_confidence = 0
        
        for seed_x, seed_y, direction, base_conf in strategies:
            room = grow_room_from_seed(seed_x, seed_y, direction)
            if room:
                # Adjust confidence based on strategy
                room["confidence"] = base_conf
                room["roomLabel"] = label_text
                
                if room["confidence"] > best_confidence:
                    best_room = room
                    best_confidence = room["confidence"]
        
        if best_room:
            rooms.append(best_room)
    
    print(f"Text-first detection found {len(rooms)} rooms from {len(room_labels)} labels", file=sys.stderr)
    return rooms

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
        
        # PHASE 0 & 1: New wall detection using graph-based approach
        # First get OCR text for filtering
        ocr_text = []
        room_labels = []
        try:
            ocr_text = detect_text_ocr(image_path)
            room_labels = [text for text in ocr_text if text.get("type") == "room_label"]
            print(f"OCR found {len(ocr_text)} text elements, {len(room_labels)} room labels", file=sys.stderr)
        except Exception as e:
            print(f"OCR detection failed: {str(e)}", file=sys.stderr)
            ocr_text = []
            room_labels = []
        
        # PHASE 1: Wall detection using deep learning (REQUIRED)
        if not TORCH_AVAILABLE:
            raise RuntimeError("PyTorch and segmentation-models-pytorch are required but not installed. Please install: pip install torch torchvision segmentation-models-pytorch")
        
        print("Starting deep learning segmentation...", file=sys.stderr)
        dl_service = DeepLearningSegmentationService()
        wall_mask_dl, room_mask_dl, confidence_map = dl_service.segment_image(image_path)
        
        if wall_mask_dl is None or room_mask_dl is None:
            raise RuntimeError("Deep learning segmentation failed - returned None masks")
        
        print("Deep learning segmentation complete, building wall graph...", file=sys.stderr)
        
        # Build wall graph from DL mask
        image_shape_adj = (height, width)
        scale_factor_adj = scale_factor
        wall_graph = build_wall_graph_from_mask(wall_mask_dl, scale_factor, image_shape_adj)
        
        if wall_graph is None:
            raise RuntimeError("Failed to build wall graph from DL mask")
        
        # Create wall_likelihood_mask from DL mask for compatibility
        wall_likelihood_mask = wall_mask_dl.copy()
        
        # Convert graph to wall segments format
        walls = []
        if NETWORKX_AVAILABLE and isinstance(wall_graph, nx.Graph):
            for edge in wall_graph.edges(data=True):
                try:
                    node1, node2, data = edge
                    x1, y1 = node1
                    x2, y2 = node2
                    
                    if not (0 <= x1 < width and 0 <= y1 < height and 0 <= x2 < width and 0 <= y2 < height):
                        continue
                    
                    length_lf = data.get('length', 0) * scale_factor
                    confidence = data.get('confidence', 0.7)
                    
                    if confidence < CONFIG['min_wall_confidence']:
                        continue
                    if length_lf < CONFIG['min_wall_length_ft']:
                        continue
                    
                    walls.append({
                        "start": {"x": float(x1) / width, "y": float(y1) / height},
                        "end": {"x": float(x2) / width, "y": float(y2) / height},
                        "length": length_lf,
                        "confidence": confidence,
                        "thickness": data.get('thickness')
                    })
                except Exception as e:
                    print(f"ERROR converting DL edge to wall: {str(e)}", file=sys.stderr)
                    continue
        
        print(f"DL Phase 1 complete: {len(walls)} walls detected from DL mask", file=sys.stderr)
        
        # PHASE 2: Wall mask generation and room seeds
        text_based_rooms = []
        try:
            if wall_graph is not None and wall_likelihood_mask is not None:
                # Phase 2.1: Render wall mask
                wall_mask = render_wall_mask(wall_graph, image_shape_adj, scale_factor_adj)
                
                # Phase 2.2: Generate distance transform
                distance_transform = generate_distance_transform(wall_mask)
                
                if distance_transform is not None:
                    # Phase 2.3: Prepare room seeds
                    room_seeds = prepare_room_seeds(ocr_text, wall_mask, distance_transform)
                    print(f"Phase 2 complete: {len(room_seeds)} room seeds prepared", file=sys.stderr)
                    
                    # PHASE 3: Room extraction from DL mask (REQUIRED)
                    print("Extracting rooms from DL segmentation mask", file=sys.stderr)
                    rooms = extract_rooms_from_dl_mask(room_mask_dl, scale_factor_adj, ocr_text, image_shape_adj)
                    print(f"DL Phase 3.1 complete: {len(rooms)} rooms extracted from DL mask", file=sys.stderr)
                    
                    # Phase 3.2: Validate rooms
                    rooms = validate_rooms(rooms, wall_mask, wall_graph)
                    print(f"DL Phase 3.2 complete: {len(rooms)} rooms validated", file=sys.stderr)
                    
                    # Phase 3.3: Classify room types
                    rooms = classify_room_types(rooms)
                    print(f"DL Phase 3.3 complete: room types classified", file=sys.stderr)
                    
                    # Phase 3.4: Compute adjacency
                    rooms = compute_room_adjacency(rooms)
                    print(f"DL Phase 3.4 complete: adjacency computed", file=sys.stderr)
                    
                    # Convert to output format - ONLY include validated rooms (for both DL and CV)
                    if rooms:
                        text_based_rooms = []
                        for room in rooms:
                            # Only include rooms that passed validation
                            if room.get('valid_enclosed_room') or room.get('valid_open_space_room'):
                                # Additional filtering: exclude very large rooms (likely false positives)
                                area_sf = room.get('area_sf', 0)
                                if area_sf > CONFIG['max_room_area_sf']:
                                    print(f"Filtering out oversized room: {area_sf:.1f} SF (max: {CONFIG['max_room_area_sf']} SF)", file=sys.stderr)
                                    continue
                                
                                # Filter by confidence and area
                                room_confidence = room.get('confidence', 0.7)
                                if room_confidence < CONFIG['min_room_confidence']:
                                    continue
                                
                                text_based_rooms.append({
                                    "points": room['polygon'],
                                    "area": room['area_sf'],
                                    "perimeter": room['perimeter_lf'],
                                    "confidence": room_confidence,
                                    "roomLabel": room.get('label_text', ''),
                                    "roomType": room.get('room_type', 'other')
                                })
                        
                        print(f"Phase 3 complete: {len(text_based_rooms)} valid rooms (after validation and size filtering)", file=sys.stderr)
                        
                        # PHASE 4: Iterative wall refinement with room feedback
                        if wall_graph is not None and len(rooms) > 0:
                            try:
                                print("Starting Phase 4: Iterative wall refinement", file=sys.stderr)
                                wall_graph, wall_mask, rooms = refine_walls_with_room_feedback(
                                    wall_graph, rooms, wall_mask, wall_likelihood_mask, scale_factor_adj, image_shape_adj
                                )
                                
                                # Re-convert rooms to output format after refinement
                                text_based_rooms = []
                                for room in rooms:
                                    if room.get('valid_enclosed_room') or room.get('valid_open_space_room'):
                                        area_sf = room.get('area_sf', 0)
                                        if area_sf > CONFIG['max_room_area_sf']:
                                            continue
                                        
                                        # Filter by confidence
                                        room_confidence = room.get('confidence', 0.7)
                                        if room_confidence < CONFIG['min_room_confidence']:
                                            continue
                                        
                                        text_based_rooms.append({
                                            "points": room['polygon'],
                                            "area": room['area_sf'],
                                            "perimeter": room['perimeter_lf'],
                                            "confidence": room_confidence,
                                            "roomLabel": room.get('label_text', ''),
                                            "roomType": room.get('room_type', 'other')
                                        })
                                
                                print(f"Phase 4 complete: {len(text_based_rooms)} rooms after refinement", file=sys.stderr)
                            except Exception as e:
                                print(f"ERROR in Phase 4: {str(e)}", file=sys.stderr)
                                import traceback
                                print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
                                # Continue with Phase 3 results if Phase 4 fails
                        else:
                            print("Phase 4: Skipping (wall graph or rooms not available)", file=sys.stderr)
                    else:
                        print("Phase 2: No room seeds found, skipping Phase 3", file=sys.stderr)
                else:
                    print("Phase 2: Distance transform failed, skipping Phase 3", file=sys.stderr)
            else:
                print("Phase 2: Wall graph/mask not available, skipping Phase 2-3", file=sys.stderr)
        except Exception as e:
            print(f"ERROR in Phase 2-3: {str(e)}", file=sys.stderr)
            import traceback
            print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
            text_based_rooms = []
        
        # Create dimension text mask from OCR if available
        dimension_text_mask = None
        if len(ocr_text) > 0:
            dimension_text_mask = np.zeros((height, width), dtype=np.uint8)
            for text_elem in ocr_text:
                if text_elem.get("type") == "dimension":
                    bbox = text_elem.get("bbox", {})
                    x_norm = bbox.get("x", 0)
                    y_norm = bbox.get("y", 0)
                    w_norm = bbox.get("width", 0)
                    h_norm = bbox.get("height", 0)
                    
                    # Convert to pixel coordinates
                    x_px = int(x_norm * width)
                    y_px = int(y_norm * height)
                    w_px = int(w_norm * width)
                    h_px = int(h_norm * height)
                    
                    # Mark dimension text region and expand it (dimension strings extend beyond text)
                    cv2.rectangle(dimension_text_mask, (x_px, y_px), (x_px + w_px, y_px + h_px), 255, -1)
            
            # Dilate dimension text mask to exclude areas near dimension strings
            if np.sum(dimension_text_mask > 0) > 0:
                dimension_text_mask = cv2.dilate(dimension_text_mask, np.ones((20, 20), np.uint8), iterations=2)
                print(f"Created dimension text mask from {len([t for t in ocr_text if t.get('type') == 'dimension'])} dimension text elements", file=sys.stderr)
        
        # Geometry-based room detection (ONLY as fallback if Phase 2-3 found no rooms)
        # Disable geometry-based detection if we have good text-based results to avoid false positives
        geometry_rooms = []
        if len(text_based_rooms) == 0:
            print("No text-based rooms found, falling back to geometry-based detection", file=sys.stderr)
            geometry_rooms = detect_rooms(image_path, scale_factor, min_room_area, epsilon, exterior_walls=walls, dimension_text_mask=dimension_text_mask)
            print(f"Geometry-based detection found {len(geometry_rooms)} rooms", file=sys.stderr)
        else:
            print(f"Skipping geometry-based detection - using {len(text_based_rooms)} text-based rooms only", file=sys.stderr)
        
        # Use text-based rooms as primary, geometry only if no text-based found
        if len(text_based_rooms) > 0:
            # Use text-based rooms directly (already validated in Phase 3)
            rooms = text_based_rooms
            print(f"Using {len(rooms)} text-based rooms (Phase 2-3 detection)", file=sys.stderr)
        else:
            # Fallback to geometry-based if no text-based found
            rooms = geometry_rooms
            print(f"Using {len(rooms)} geometry-based rooms (fallback)", file=sys.stderr)
        
        # Final filtering: remove any rooms that are too large (likely false positives)
        # This catches cases where entire floor plans or multiple floors are detected
        max_reasonable_room_area = CONFIG['max_room_area_sf']
        filtered_rooms = []
        for room in rooms:
            area = room.get('area', 0)
            if area > max_reasonable_room_area:
                print(f"Filtering out oversized room: {area:.1f} SF (max: {max_reasonable_room_area} SF)", file=sys.stderr)
                continue
            filtered_rooms.append(room)
        
        rooms = filtered_rooms
        rooms.sort(key=lambda r: r.get("confidence", 0.5), reverse=True)
        rooms = rooms[:100]  # Limit to top 100
        
        print(f"Final detection: {len(rooms)} rooms after filtering", file=sys.stderr)
        
        doors, windows = detect_openings(image_path, scale_factor)
        
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

