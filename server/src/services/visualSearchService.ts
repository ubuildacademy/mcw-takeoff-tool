/**
 * Auto-Count Service for Symbol Detection and Matching
 * 
 * This service uses OpenCV template matching (via Python) to detect and match symbols
 * in construction drawings based on user-selected reference symbols.
 * Supports searching on current page, entire document, or entire project.
 */

import { pythonPdfConverter } from './pythonPdfConverter';
import { storage } from '../storage';
import { supabase } from '../supabase';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { parseDocumentIdFromSheetId, parsePageNumberFromSheetId } from '../lib/sheetUtils';

const execAsync = promisify(exec);

/** Bounded parallelism for scanning many PDF pages (entire-document / entire-project scopes). */
const PAGE_SEARCH_CONCURRENCY = 4;

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.min(Math.max(1, concurrency), items.length);
  let nextIndex = 0;
  async function runner(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      await worker(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => runner()));
}

/** Best-effort temp removal; warns on failure for ops/debug without failing callers. */
async function removeVisualSearchTemp(filePath: string): Promise<void> {
  try {
    await fs.remove(filePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[visualSearchService] failed to remove temp file', { path: filePath, message });
  }
}

export interface AutoCountMatch {
  id: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  pageNumber: number;
  documentId?: string;
  pdfCoordinates?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  description?: string;
}

export interface AutoCountResult {
  matches: AutoCountMatch[];
  totalMatches: number;
  searchTime: number;
  conditionId?: string;
  searchImageId?: string;
  processingTime?: number;
  threshold?: number;
}

export interface SymbolTemplate {
  id: string;
  imageData: string; // File path to template image
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  description?: string;
}

export interface AutoCountOptions {
  confidenceThreshold: number;
  maxMatches: number; // Increased limit for broader searches (default: 10000)
  searchRadius: number; // How far to search around the template (not used in template matching)
  scaleTolerance: number; // How much scale variation to allow (not used in template matching)
}

interface PythonVisualSearchResult {
  success: boolean;
  matches?: Array<{
    id: string;
    confidence: number;
    boundingBox: { x: number; y: number; width: number; height: number };
    pdfCoordinates: { x: number; y: number; width: number; height: number };
    pageNumber: number;
  }>;
  totalMatches?: number;
  imageWidth?: number;
  imageHeight?: number;
  templateWidth?: number;
  templateHeight?: number;
  error?: string;
}

class AutoCountService {
  private defaultOptions: AutoCountOptions = {
    confidenceThreshold: 0.7,
    maxMatches: 10000, // Increased from 100 to support broader searches
    searchRadius: 0.1,
    scaleTolerance: 0.2
  };

  private pythonScriptPath: string;
  private extractTemplateClipScriptPath: string;
  private tempDir: string;
  private cachedGlibLibPath: string | null = null;
  /** Cache PyMuPDF page.rect width/height (points) per file:page */
  private pageRectSizeCache = new Map<string, { width: number; height: number }>();

  constructor() {
    // Determine script path (works in both source and compiled)
    const isCompiled = __dirname.includes('dist');
    const baseDir = isCompiled 
      ? path.join(__dirname, '..', '..') // dist/services -> dist -> server root
      : path.join(__dirname, '..'); // src/services -> src -> server root

    // When compiled: baseDir is server root, need to add 'src' to get to scripts
    // When not compiled: baseDir is already 'src', so just add 'scripts'
    this.pythonScriptPath = isCompiled
      ? path.join(baseDir, 'src', 'scripts', 'visual_search.py')
      : path.join(baseDir, 'scripts', 'visual_search.py');
    this.extractTemplateClipScriptPath = isCompiled
      ? path.join(baseDir, 'src', 'scripts', 'extract_template_clip.py')
      : path.join(baseDir, 'scripts', 'extract_template_clip.py');
    
    // Temp directory for images
    const isProduction = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
    this.tempDir = isProduction ? '/tmp/visual-search' : path.join(baseDir, 'temp', 'visual-search');
  }

  /**
   * Get enhanced PATH for Railway/Nixpacks environments
   */
  private getEnhancedPath(): string {
    return [
      '/opt/venv/bin',
      '/root/.nix-profile/bin',
      '/nix/var/nix/profiles/default/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      process.env.PATH || ''
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
   * Rasterize a Meridian-normalized rect (PDF clip in user space) to a PNG via extract_template_clip.py.
   * When `pdfJsPageSize` is set (PDF.js base viewport at scale=1, rotation=0), it matches client-side
   * cssDragRectToBasePdfAabb even if PyMuPDF page.rect differs slightly.
   */
  private async extractMeridianClipToPng(
    pdfPath: string,
    pageNumber: number,
    selectionBox: { x: number; y: number; width: number; height: number },
    outputPath: string,
    pdfJsPageSize?: { width: number; height: number }
  ): Promise<void> {
    const scale = 2.0;
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const hasJs =
      pdfJsPageSize &&
      typeof pdfJsPageSize.width === 'number' &&
      pdfJsPageSize.width > 0 &&
      typeof pdfJsPageSize.height === 'number' &&
      pdfJsPageSize.height > 0;
    const command = hasJs
      ? `${pythonCommand} "${this.extractTemplateClipScriptPath}" "${pdfPath}" ${pageNumber} ${scale} ${selectionBox.x} ${selectionBox.y} ${selectionBox.width} ${selectionBox.height} ${pdfJsPageSize!.width} ${pdfJsPageSize!.height} "${outputPath}"`
      : `${pythonCommand} "${this.extractTemplateClipScriptPath}" "${pdfPath}" ${pageNumber} ${scale} ${selectionBox.x} ${selectionBox.y} ${selectionBox.width} ${selectionBox.height} "${outputPath}"`;

    console.log(`📐 [extractMeridianClipToPng] selectionBox=`, selectionBox,
      `pdfJsPageSize=`, pdfJsPageSize ?? 'N/A',
      `page=${pageNumber}`);

    const enhancedPath = this.getEnhancedPath();
    const enhancedLdPath = await this.getEnhancedLdLibraryPath();
    const { stdout, stderr } = await execAsync(command, {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PATH: enhancedPath, LD_LIBRARY_PATH: enhancedLdPath }
    });
    if (stderr) {
      const lines = stderr.split('\n').filter(l => l.trim());
      for (const line of lines) {
        if (line.includes('[extract_clip]')) {
          console.log(`📐 ${line.trim()}`);
        } else if (!line.includes('DeprecationWarning')) {
          console.warn('⚠️ extract_template_clip stderr:', line);
        }
      }
    }

    const result = JSON.parse(stdout.trim()) as { success?: boolean; error?: string; width?: number; height?: number };
    if (!result.success) {
      throw new Error(result.error || 'PDF clip rasterize failed');
    }
    console.log(`📐 [extractMeridianClipToPng] output: ${result.width}×${result.height}px`);
  }

  /**
   * Extract a symbol template from a selection box on a PDF page.
   * Renders the full page as a raster then crops the selected region with OpenCV,
   * which guarantees the crop matches the same image space used for template matching.
   */
  async extractSymbolTemplate(
    pdfFileId: string,
    pageNumber: number,
    selectionBox: { x: number; y: number; width: number; height: number },
    projectId?: string,
    _pdfJsPageSize?: { width: number; height: number }
  ): Promise<SymbolTemplate> {
    try {
      console.log('🔍 Extracting symbol template from selection box...');
      
      const pdfPath = await this.getPDFFilePath(pdfFileId, projectId);

      const imageBuffer = await pythonPdfConverter.convertPageToBuffer(pdfPath, pageNumber, {
        format: 'png',
        scale: 2.0,
        quality: 90
      });

      if (!imageBuffer) {
        throw new Error('Failed to convert PDF page to image');
      }

      await fs.ensureDir(this.tempDir);
      const fullPageImagePath = path.join(this.tempDir, `fullpage_${uuidv4()}.png`);
      await fs.writeFile(fullPageImagePath, imageBuffer);

      const templateImagePath = await this.cropImageRegion(
        fullPageImagePath,
        selectionBox,
        pageNumber
      );

      await removeVisualSearchTemp(fullPageImagePath);

      const templateId = `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      return {
        id: templateId,
        imageData: templateImagePath,
        boundingBox: selectionBox,
        description: `Symbol template extracted from page ${pageNumber}`
      };
    } catch (error) {
      console.error('❌ Failed to extract symbol template:', error);
      throw new Error(`Failed to extract symbol template: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Crop an image region using Python/OpenCV.
   * selectionBox coordinates are normalized 0-1 fractions of the image dimensions.
   */
  private async cropImageRegion(
    imagePath: string,
    selectionBox: { x: number; y: number; width: number; height: number },
    _pageNumber: number
  ): Promise<string> {
    try {
      const cropScript = `
import cv2
import sys
import json

image_path = sys.argv[1]
output_path = sys.argv[2]
x = float(sys.argv[3])
y = float(sys.argv[4])
width = float(sys.argv[5])
height = float(sys.argv[6])

img = cv2.imread(image_path)
if img is None:
    print(json.dumps({"success": False, "error": f"Failed to load image: {image_path}"}))
    sys.exit(1)

img_height, img_width = img.shape[:2]

x_px = int(x * img_width)
y_px = int(y * img_height)
w_px = int(width * img_width)
h_px = int(height * img_height)

x_px = max(0, min(x_px, img_width - 1))
y_px = max(0, min(y_px, img_height - 1))
w_px = min(w_px, img_width - x_px)
h_px = min(h_px, img_height - y_px)

cropped = img[y_px:y_px+h_px, x_px:x_px+w_px]

cv2.imwrite(output_path, cropped)
print(json.dumps({"success": True, "output": output_path}))
`;

      await fs.ensureDir(this.tempDir);
      const cropScriptPath = path.join(this.tempDir, `crop_${uuidv4()}.py`);
      await fs.writeFile(cropScriptPath, cropScript);

      const outputPath = path.join(this.tempDir, `template_${uuidv4()}.png`);
      
      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
      const command = `${pythonCommand} "${cropScriptPath}" "${imagePath}" "${outputPath}" ${selectionBox.x} ${selectionBox.y} ${selectionBox.width} ${selectionBox.height}`;

      const enhancedPath = this.getEnhancedPath();
      const enhancedLdPath = await this.getEnhancedLdLibraryPath();
      const { stdout } = await execAsync(command, {
        timeout: 10000,
        env: { ...process.env, PATH: enhancedPath, LD_LIBRARY_PATH: enhancedLdPath }
      });

      await removeVisualSearchTemp(cropScriptPath);

      const result = JSON.parse(stdout.trim());
      if (!result.success) {
        throw new Error(result.error || 'Crop failed');
      }

      return outputPath;
    } catch (error) {
      console.error('❌ Failed to crop image region:', error);
      throw new Error(`Failed to crop image region: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get PDF page count using PyMuPDF
   */
  private async getPDFPageCount(pdfPath: string): Promise<number> {
    try {
      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
      const script = `
import fitz
import sys
import json

pdf_path = sys.argv[1]
try:
    doc = fitz.open(pdf_path)
    page_count = len(doc)
    doc.close()
    print(json.dumps({"success": True, "pageCount": page_count}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
    sys.exit(1)
`;
      const scriptPath = path.join(this.tempDir, `get_page_count_${uuidv4()}.py`);
      await fs.writeFile(scriptPath, script);
      
      const enhancedPath = this.getEnhancedPath();
      const enhancedLdPath = await this.getEnhancedLdLibraryPath();
      const command = `${pythonCommand} "${scriptPath}" "${pdfPath}"`;
      
      const { stdout } = await execAsync(command, {
        timeout: 10000,
        env: { ...process.env, PATH: enhancedPath, LD_LIBRARY_PATH: enhancedLdPath }
      });
      
      await removeVisualSearchTemp(scriptPath);
      
      const result = JSON.parse(stdout.trim());
      if (!result.success) {
        throw new Error(result.error || 'Failed to get page count');
      }
      
      return result.pageCount;
    } catch (error) {
      console.error('❌ Failed to get PDF page count:', error);
      throw new Error(`Failed to get PDF page count: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * PyMuPDF page.rect size in PDF points (same space as OpenCV search raster normalization).
   */
  private async getPdfPageRectSize(pdfPath: string, pageNumber: number): Promise<{ width: number; height: number }> {
    const cacheKey = `${pdfPath}:${pageNumber}`;
    const cached = this.pageRectSizeCache.get(cacheKey);
    if (cached) return cached;

    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const script = `
import fitz
import sys
import json
pdf_path = sys.argv[1]
page_num = int(sys.argv[2])
try:
    doc = fitz.open(pdf_path)
    page = doc[page_num - 1]
    r = page.rect
    doc.close()
    print(json.dumps({"success": True, "width": r.width, "height": r.height}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
    sys.exit(1)
`;
    await fs.ensureDir(this.tempDir);
    const scriptPath = path.join(this.tempDir, `page_rect_${uuidv4()}.py`);
    await fs.writeFile(scriptPath, script);

    const enhancedPath = this.getEnhancedPath();
    const enhancedLdPath = await this.getEnhancedLdLibraryPath();
    const command = `${pythonCommand} "${scriptPath}" "${pdfPath}" ${pageNumber}`;

    try {
      const { stdout } = await execAsync(command, {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PATH: enhancedPath, LD_LIBRARY_PATH: enhancedLdPath }
      });
      await removeVisualSearchTemp(scriptPath);
      const result = JSON.parse(stdout.trim()) as { success?: boolean; width?: number; height?: number; error?: string };
      if (!result.success || result.width == null || result.height == null) {
        throw new Error(result.error || 'Failed to read page rect');
      }
      const size = { width: result.width, height: result.height };
      this.pageRectSizeCache.set(cacheKey, size);
      return size;
    } catch (error) {
      await removeVisualSearchTemp(scriptPath);
      throw error;
    }
  }

  /** Cache for page rotation values */
  private pageRotationCache = new Map<string, number>();

  /**
   * Get the built-in /Rotate attribute of a PDF page from PyMuPDF.
   * Returns 0, 90, 180, or 270.
   */
  private async getPageRotation(pdfPath: string, pageNumber: number): Promise<number> {
    const cacheKey = `${pdfPath}:${pageNumber}:rot`;
    const cached = this.pageRotationCache.get(cacheKey);
    if (cached != null) return cached;

    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const script = `
import fitz
import sys
import json
pdf_path = sys.argv[1]
page_num = int(sys.argv[2])
try:
    doc = fitz.open(pdf_path)
    page = doc[page_num - 1]
    rot = page.rotation
    doc.close()
    print(json.dumps({"success": True, "rotation": rot}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
    sys.exit(1)
`;
    await fs.ensureDir(this.tempDir);
    const scriptPath = path.join(this.tempDir, `page_rot_${uuidv4()}.py`);
    await fs.writeFile(scriptPath, script);

    const enhancedPath = this.getEnhancedPath();
    const enhancedLdPath = await this.getEnhancedLdLibraryPath();
    const command = `${pythonCommand} "${scriptPath}" "${pdfPath}" ${pageNumber}`;

    try {
      const { stdout } = await execAsync(command, {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PATH: enhancedPath, LD_LIBRARY_PATH: enhancedLdPath }
      });
      await removeVisualSearchTemp(scriptPath);
      const result = JSON.parse(stdout.trim()) as { success?: boolean; rotation?: number; error?: string };
      if (!result.success || result.rotation == null) {
        throw new Error(result.error || 'Failed to read page rotation');
      }
      this.pageRotationCache.set(cacheKey, result.rotation);
      return result.rotation;
    } catch (error) {
      await removeVisualSearchTemp(scriptPath);
      throw error;
    }
  }

  /**
   * Convert raster/MediaBox-normalized coordinates to base-normalized (visual orientation)
   * coordinates, accounting for the page's built-in /Rotate attribute.
   * PyMuPDF's get_pixmap() renders in MediaBox space; PDF.js getViewport({rotation:0})
   * includes page.rotate. This bridge aligns the two.
   */
  private rasterNormToBaseNorm(x: number, y: number, pageRotation: number): { x: number; y: number } {
    const r = ((pageRotation % 360) + 360) % 360;
    if (r === 0) return { x, y };
    if (r === 90) return { x: y, y: 1 - x };
    if (r === 180) return { x: 1 - x, y: 1 - y };
    if (r === 270) return { x: 1 - y, y: x };
    return { x, y };
  }

  /** OpenCV / PyMuPDF raster norm (0–1) → PDF.js base-normalized (0–1) for the same physical point. */
  private opencvNormToPdfJsNorm(
    box: { x: number; y: number; width: number; height: number },
    pym: { width: number; height: number },
    pdfJs: { width: number; height: number }
  ): { x: number; y: number; width: number; height: number } {
    const sx = pym.width / pdfJs.width;
    const sy = pym.height / pdfJs.height;
    return {
      x: box.x * sx,
      y: box.y * sy,
      width: box.width * sx,
      height: box.height * sy
    };
  }

  /**
   * Get PDF file path (downloads from Supabase Storage if needed)
   */
  private async getPDFFilePath(pdfFileId: string, projectId?: string): Promise<string> {
    try {
      // Get file info
      const files = projectId 
        ? await storage.getFilesByProject(projectId)
        : await storage.getFiles();
      const file = files.find(f => f.id === pdfFileId);

      if (!file || file.mimetype !== 'application/pdf') {
        throw new Error(`PDF file not found: ${pdfFileId}`);
      }

      // Download PDF from Supabase Storage
      const { data, error } = await supabase.storage
        .from('project-files')
        .download(file.path);

      if (error || !data) {
        console.error(`Error downloading PDF:`, error);
        throw new Error(`Failed to download PDF: ${error?.message || 'Unknown error'}`);
      }

      // Save to temporary file
      const isProduction = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
      let baseTempDir: string;
      
      if (isProduction) {
        baseTempDir = '/tmp/pdf-processing';
      } else {
        const cwd = process.cwd();
        if (cwd.endsWith('server') || cwd.endsWith('server/')) {
          baseTempDir = path.join(cwd, 'temp', 'pdf-processing');
        } else {
          baseTempDir = path.join(cwd, 'server', 'temp', 'pdf-processing');
        }
      }

      await fs.ensureDir(baseTempDir);
      const pdfPath = path.join(baseTempDir, `${pdfFileId}.pdf`);
      
      // Convert blob to buffer and save
      const arrayBuffer = await data.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.writeFile(pdfPath, buffer);

      return pdfPath;
    } catch (error) {
      console.error(`Error getting PDF file path:`, error);
      throw new Error(`Failed to get PDF file path: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Search for symbols matching the template on a single page
   */
  private async searchPage(
    pdfPath: string,
    pageNumber: number,
    template: SymbolTemplate,
    options: AutoCountOptions,
    documentId?: string
  ): Promise<AutoCountMatch[]> {
    try {
      console.log(`🔍 Searching page ${pageNumber} for symbols matching template ${template.id}...`);
      
      // Convert PDF page to image
      const imageBuffer = await pythonPdfConverter.convertPageToBuffer(pdfPath, pageNumber, {
        format: 'png',
        scale: 2.0,
        quality: 90
      });

      if (!imageBuffer) {
        throw new Error('Failed to convert PDF page to image');
      }

      // Save full page image temporarily
      await fs.ensureDir(this.tempDir);
      const fullPageImagePath = path.join(this.tempDir, `search_${uuidv4()}.png`);
      await fs.writeFile(fullPageImagePath, imageBuffer);

      // Call Python auto-count script
      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
      const command = `${pythonCommand} "${this.pythonScriptPath}" "${fullPageImagePath}" "${template.imageData}" ${options.confidenceThreshold}`;

      console.log(`🔧 Executing auto-count: ${command}`);

      const enhancedPath = this.getEnhancedPath();
      const enhancedLdPath = await this.getEnhancedLdLibraryPath();
      let stdout: string;
      let stderr: string;

      try {
        const execResult = await execAsync(command, {
          timeout: 60000, // 60 second timeout
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          env: { ...process.env, PATH: enhancedPath, LD_LIBRARY_PATH: enhancedLdPath }
        });
        stdout = execResult.stdout;
        stderr = execResult.stderr;
      } catch (execError: any) {
        // Clean up temp file
        await removeVisualSearchTemp(fullPageImagePath);
        throw new Error(`Auto-count failed: ${execError instanceof Error ? execError.message : 'Unknown error'}`);
      }

      // Clean up temp file
      await removeVisualSearchTemp(fullPageImagePath);

      if (stderr && !stderr.includes('DeprecationWarning')) {
        console.warn('⚠️ Python script warnings:', stderr);
      }

      // Parse JSON result
      let result: PythonVisualSearchResult;
      try {
        const trimmedOutput = stdout.trim();
        result = JSON.parse(trimmedOutput);
      } catch (parseError) {
        console.error('❌ Failed to parse Python output:', stdout.substring(0, 500));
        throw new Error(`Failed to parse auto-count results: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`);
      }

      if (!result.success) {
        throw new Error(result.error || 'Auto-count failed');
      }

      // Convert Python matches to AutoCountMatch format
      // Note: boundingBox from Python is already normalized (0-1), pdfCoordinates are in pixels
      // Normalize pdfCoordinates if we have image dimensions
      const imageWidth = result.imageWidth || 0;
      const imageHeight = result.imageHeight || 0;
      
      const matches: AutoCountMatch[] = (result.matches || []).map((match, index) => {
        // Normalize pdfCoordinates from pixel space to 0-1 normalized coordinates if we have dimensions
        let normalizedPdfCoordinates = match.pdfCoordinates;
        if (match.pdfCoordinates && imageWidth > 0 && imageHeight > 0) {
          normalizedPdfCoordinates = {
            x: match.pdfCoordinates.x / imageWidth,
            y: match.pdfCoordinates.y / imageHeight,
            width: match.pdfCoordinates.width / imageWidth,
            height: match.pdfCoordinates.height / imageHeight
          };
        }
        
        return {
          id: match.id || `match_${Date.now()}_${pageNumber}_${index}`,
          confidence: match.confidence,
          boundingBox: match.boundingBox, // Already normalized 0-1
          pageNumber: pageNumber,
          documentId: documentId,
          pdfCoordinates: normalizedPdfCoordinates,
          description: `Match for ${template.description || 'symbol'}`
        };
      });

      return matches;
    } catch (error) {
      console.error(`❌ Auto-count failed on page ${pageNumber}:`, error);
      throw error;
    }
  }

  /**
   * Search for symbols matching the template using Python/OpenCV template matching
   * Supports multiple scopes: current-page, entire-document, entire-project
   */
  async searchForSymbols(
    conditionId: string,
    pdfFileId: string,
    template: SymbolTemplate,
    options: Partial<AutoCountOptions> = {},
    pageNumber?: number,
    projectId?: string,
    searchScope: 'current-page' | 'entire-document' | 'entire-project' = 'current-page',
    onProgress?: (progress: { current: number; total: number; currentPage?: number; currentDocument?: string }) => void
  ): Promise<AutoCountResult> {
    const opts = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    const allMatches: AutoCountMatch[] = [];

    try {
      console.log(`🔍 Starting auto-count search with scope: ${searchScope}`);
      
      if (searchScope === 'current-page') {
        // Search only the current page
        const pdfPath = await this.getPDFFilePath(pdfFileId, projectId);
        const searchPageNum = pageNumber || 1;
        
        if (onProgress) {
          onProgress({ current: 0, total: 1, currentPage: searchPageNum });
        }
        
        const pageMatches = await this.searchPage(pdfPath, searchPageNum, template, opts, pdfFileId);
        allMatches.push(...pageMatches);
        if (onProgress) {
          onProgress({ current: 1, total: 1, currentPage: searchPageNum });
        }
      } else if (searchScope === 'entire-document') {
        // Search all pages in the current document
        const pdfPath = await this.getPDFFilePath(pdfFileId, projectId);
        const totalPages = await this.getPDFPageCount(pdfPath);
        
        console.log(`📄 Searching ${totalPages} pages in document ${pdfFileId}`);
        
        // Send initial progress with total pages
        if (onProgress && totalPages > 0) {
          onProgress({ current: 0, total: totalPages });
        }
        
        const pageNumbers = Array.from({ length: totalPages }, (_, idx) => idx + 1);
        let completedPages = 0;
        await runWithConcurrency(pageNumbers, PAGE_SEARCH_CONCURRENCY, async (pageNum) => {
          try {
            const pageMatches = await this.searchPage(pdfPath, pageNum, template, opts, pdfFileId);
            allMatches.push(...pageMatches);
          } catch (pageError) {
            console.warn(`⚠️ Failed to search page ${pageNum}, continuing...`, pageError);
          }
          completedPages++;
          if (onProgress) {
            onProgress({ current: completedPages, total: totalPages, currentPage: pageNum });
          }
        });
      } else if (searchScope === 'entire-project') {
        // Search all pages in all documents in the project
        if (!projectId) {
          throw new Error('Project ID is required for entire-project scope');
        }
        
        const files = await storage.getFilesByProject(projectId);
        const pdfFiles = files.filter(f => f.mimetype === 'application/pdf');
        
        console.log(`📚 Searching ${pdfFiles.length} documents in project ${projectId}`);
        
        let totalPages = 0;

        type PageTask = {
          pdfPath: string;
          pageNum: number;
          documentId: string;
          documentLabel: string;
        };
        const pageTasks: PageTask[] = [];

        for (const file of pdfFiles) {
          try {
            const pdfPath = await this.getPDFFilePath(file.id, projectId);
            const pageCount = await this.getPDFPageCount(pdfPath);
            totalPages += pageCount;
            console.log(`📄 Scheduling ${pageCount} pages for document ${file.originalName || file.id}`);
            for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
              pageTasks.push({
                pdfPath,
                pageNum,
                documentId: file.id,
                documentLabel: file.originalName || file.id,
              });
            }
          } catch (error) {
            console.warn(`⚠️ Failed to get page count for document ${file.id}, skipping...`, error);
          }
        }
        
        // Send initial progress with total pages
        if (onProgress && totalPages > 0) {
          onProgress({ current: 0, total: totalPages });
        }
        
        let processedPages = 0;
        await runWithConcurrency(pageTasks, PAGE_SEARCH_CONCURRENCY, async (task) => {
          try {
            const pageMatches = await this.searchPage(task.pdfPath, task.pageNum, template, opts, task.documentId);
            allMatches.push(...pageMatches);
          } catch (pageError) {
            console.warn(
              `⚠️ Failed to search page ${task.pageNum} of document ${task.documentId}, continuing...`,
              pageError,
            );
          }
          processedPages++;
          if (onProgress) {
            onProgress({
              current: processedPages,
              total: totalPages,
              currentPage: task.pageNum,
              currentDocument: task.documentLabel,
            });
          }
        });
      }

      // Sort by confidence and limit to maxMatches
      const sortedMatches = allMatches.sort((a, b) => b.confidence - a.confidence);
      const limitedMatches = sortedMatches.slice(0, opts.maxMatches);

      const processingTime = Date.now() - startTime;
      
      console.log(`✅ Auto-count complete: ${limitedMatches.length} matches found (from ${allMatches.length} total) in ${processingTime}ms`);

      return {
        conditionId,
        matches: limitedMatches,
        totalMatches: limitedMatches.length,
        searchTime: processingTime,
        searchImageId: template.id,
        processingTime,
        threshold: opts.confidenceThreshold
      };
    } catch (error) {
      console.error('❌ Auto-count failed:', error);
      throw new Error(`Auto-count failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create count measurements from auto-count matches
   */
  async createCountMeasurements(
    conditionId: string,
    matches: AutoCountMatch[],
    projectId: string,
    conditionColor: string = '#3B82F6',
    conditionName: string = 'Auto-Count Match',
    conditionUnit: string = 'EA',
    options?: {
      /** PDF.js getViewport({ scale: 1, rotation: 0 }) — aligns stored coords with the client */
      pdfJsViewport?: { width: number; height: number };
      /** Fallback when match.documentId is missing */
      primaryPdfFileId?: string;
    },
    onProgress?: (progress: { current: number; total: number }) => void
  ): Promise<void> {
    try {
      console.log(`📊 Creating ${matches.length} count measurements...`);

      const totalMatches = matches.length;
      for (let i = 0; i < totalMatches; i++) {
        const match = matches[i];
        if (onProgress) {
          onProgress({ current: i, total: totalMatches });
        }
        const documentId = match.documentId || options?.primaryPdfFileId;
        if (!documentId) {
          throw new Error('Auto-count match missing document id');
        }

        const pdfPath = await this.getPDFFilePath(documentId, projectId);
        const pageRot = await this.getPageRotation(pdfPath, match.pageNumber);

        const rasterCenterX = match.boundingBox.x + (match.boundingBox.width / 2);
        const rasterCenterY = match.boundingBox.y + (match.boundingBox.height / 2);
        const { x: centerX, y: centerY } = this.rasterNormToBaseNorm(rasterCenterX, rasterCenterY, pageRot);

        const bboxInfo = match.pdfCoordinates ? {
          bbox: {
            x: match.pdfCoordinates.x,
            y: match.pdfCoordinates.y,
            width: match.pdfCoordinates.width,
            height: match.pdfCoordinates.height
          },
          normalizedBbox: {
            x: match.boundingBox.x,
            y: match.boundingBox.y,
            width: match.boundingBox.width,
            height: match.boundingBox.height
          }
        } : null;

        const pdfCenterX = (match.pdfCoordinates?.x || 0) + ((match.pdfCoordinates?.width || 0) / 2);
        const pdfCenterY = (match.pdfCoordinates?.y || 0) + ((match.pdfCoordinates?.height || 0) / 2);
        const { x: basePdfCx, y: basePdfCy } = this.rasterNormToBaseNorm(pdfCenterX, pdfCenterY, pageRot);

        const measurement = {
          id: uuidv4(),
          projectId,
          sheetId: documentId,
          conditionId,
          type: 'count' as const,
          points: [{ x: centerX, y: centerY }],
          calculatedValue: 1,
          unit: conditionUnit,
          timestamp: new Date().toISOString(),
          pdfPage: match.pageNumber,
          pdfCoordinates: [{ x: basePdfCx, y: basePdfCy }],
          description: bboxInfo ? JSON.stringify(bboxInfo) : 'Auto-Count Match',
          conditionColor: conditionColor,
          conditionName: conditionName
        };

        await storage.saveTakeoffMeasurement(measurement);
      }

      if (onProgress) {
        onProgress({ current: totalMatches, total: totalMatches });
      }

      console.log(`✅ Created ${matches.length} count measurements`);
    } catch (error) {
      console.error('❌ Failed to create count measurements:', error);
      // Preserve the actual error message for debugging
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create count measurements: ${errorMessage}`);
    }
  }

  /**
   * Extract thumbnail images for visual search matches
   */
  async extractMatchThumbnails(
    conditionId: string,
    projectId: string,
    maxThumbnails: number = 6
  ): Promise<Array<{ measurementId: string; thumbnail: string }>> {
    try {
      console.log(`[VisualSearchService] Extracting thumbnails for condition ${conditionId}, project ${projectId}`);
      // Get all measurements for this condition
      const conditionMeasurements = await storage.getTakeoffMeasurementsByCondition(conditionId);
      
      console.log(`[VisualSearchService] Found ${conditionMeasurements.length} measurements for condition ${conditionId}`);
      
      if (conditionMeasurements.length === 0) {
        console.log(`[VisualSearchService] No measurements found, returning empty array`);
        return [];
      }

      // Group by sheet (sheetId is already `${documentId}-${pageNumber}` — do not append pdfPage again)
      const measurementsByPage = new Map<string, typeof conditionMeasurements>();
      for (const measurement of conditionMeasurements) {
        const key = measurement.sheetId;
        if (!measurementsByPage.has(key)) {
          measurementsByPage.set(key, []);
        }
        measurementsByPage.get(key)!.push(measurement);
      }

      const thumbnails: Array<{ measurementId: string; thumbnail: string }> = [];
      let thumbnailCount = 0;

      const projectFiles = await storage.getFilesByProject(projectId);

      // Process each page
      for (const [compositeSheetId, pageMeasurements] of measurementsByPage) {
        if (thumbnailCount >= maxThumbnails) break;

        const documentId = parseDocumentIdFromSheetId(compositeSheetId);
        const pageNumber = parsePageNumberFromSheetId(compositeSheetId);
        if (!Number.isFinite(pageNumber) || pageNumber < 1) continue;

        const file = projectFiles.find((f) => f.id === documentId);
        if (!file || file.mimetype !== 'application/pdf') continue;

        const pdfPath = await this.getPDFFilePath(documentId, projectId);
        await fs.ensureDir(this.tempDir);

        // Extract thumbnails for measurements on this page (same PDF clip as template extraction)
        for (const measurement of pageMeasurements.slice(0, maxThumbnails - thumbnailCount)) {
          if (thumbnailCount >= maxThumbnails) break;

          // Try to get bounding box from description (stored as JSON)
          let selectionBox: { x: number; y: number; width: number; height: number } | null = null;
          
          let pdfJsPageSize: { width: number; height: number } | undefined;
          if (measurement.description) {
            try {
              const descData = JSON.parse(measurement.description) as {
                normalizedBbox?: { x: number; y: number; width: number; height: number };
                baseViewport?: { width: number; height: number };
              };
              if (descData.normalizedBbox) {
                selectionBox = {
                  x: descData.normalizedBbox.x,
                  y: descData.normalizedBbox.y,
                  width: descData.normalizedBbox.width,
                  height: descData.normalizedBbox.height
                };
              }
              if (
                descData.baseViewport &&
                typeof descData.baseViewport.width === 'number' &&
                descData.baseViewport.width > 0 &&
                typeof descData.baseViewport.height === 'number' &&
                descData.baseViewport.height > 0
              ) {
                pdfJsPageSize = {
                  width: descData.baseViewport.width,
                  height: descData.baseViewport.height
                };
              }
            } catch (e) {
              // Description is not JSON, fall back to center point method
            }
          }
          
          // Fallback: use center point with estimated size
          if (!selectionBox) {
            const center = measurement.pdfCoordinates?.[0];
            if (!center) continue;

            // Use a thumbnail size that's reasonable for symbols (typically 2-5% of page)
            // We'll use 4% which should capture most symbols nicely
            const thumbnailSize = 0.04; // 4% of page size
            const halfSize = thumbnailSize / 2;
            
            // Calculate bounding box ensuring it stays within page bounds
            let x = center.x - halfSize;
            let y = center.y - halfSize;
            let width = thumbnailSize;
            let height = thumbnailSize;
            
            // Clamp to page bounds
            if (x < 0) {
              width += x;
              x = 0;
            }
            if (y < 0) {
              height += y;
              y = 0;
            }
            if (x + width > 1) {
              width = 1 - x;
            }
            if (y + height > 1) {
              height = 1 - y;
            }
            
            // Skip if the bounding box is too small
            if (width < 0.01 || height < 0.01) continue;
            
            selectionBox = { x, y, width, height };
          }
          
          // Ensure bounding box is valid
          if (!selectionBox || selectionBox.width < 0.01 || selectionBox.height < 0.01) continue;

          try {
            const thumbnailPath = path.join(this.tempDir, `thumb_${uuidv4()}.png`);
            await this.extractMeridianClipToPng(pdfPath, pageNumber, selectionBox, thumbnailPath, pdfJsPageSize);
            const thumbnailBuffer = await fs.readFile(thumbnailPath);
            const thumbnailBase64 = thumbnailBuffer.toString('base64');
            
            thumbnails.push({
              measurementId: measurement.id,
              thumbnail: `data:image/png;base64,${thumbnailBase64}`
            });
            
            thumbnailCount++;
            console.log(`[VisualSearchService] Extracted thumbnail ${thumbnailCount}/${maxThumbnails} for measurement ${measurement.id}`);
            
            // Clean up thumbnail file
            await removeVisualSearchTemp(thumbnailPath);
          } catch (error) {
            console.error(`[VisualSearchService] Failed to extract thumbnail for measurement ${measurement.id}:`, error);
          }
        }
      }

      console.log(`[VisualSearchService] Returning ${thumbnails.length} thumbnails for condition ${conditionId}`);
      return thumbnails;
    } catch (error) {
      console.error('❌ Failed to extract match thumbnails:', error);
      return [];
    }
  }
}

export const autoCountService = new AutoCountService();
// Legacy export for backward compatibility during migration
export const visualSearchService = autoCountService;
