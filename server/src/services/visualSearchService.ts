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

const execAsync = promisify(exec);

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
  private tempDir: string;
  private cachedGlibLibPath: string | null = null;

  constructor() {
    // Determine script path (works in both source and compiled)
    const isCompiled = __dirname.includes('dist');
    const baseDir = isCompiled 
      ? path.join(__dirname, '..', '..') // dist/services -> dist -> server root
      : path.join(__dirname, '..'); // src/services -> src -> server root

    this.pythonScriptPath = path.join(baseDir, 'src', 'scripts', 'visual_search.py');
    
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
   * Extract a symbol template from a selection box on a PDF page
   */
  async extractSymbolTemplate(
    pdfFileId: string,
    pageNumber: number,
    selectionBox: { x: number; y: number; width: number; height: number },
    projectId?: string
  ): Promise<SymbolTemplate> {
    try {
      console.log('🔍 Extracting symbol template from selection box...');
      
      // Download PDF to temp location if needed
      const pdfPath = await this.getPDFFilePath(pdfFileId, projectId);
      
      // Convert PDF page to image buffer
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
      const fullPageImagePath = path.join(this.tempDir, `fullpage_${uuidv4()}.png`);
      await fs.writeFile(fullPageImagePath, imageBuffer);

      // Crop the selected region using Python/OpenCV
      const templateImagePath = await this.cropImageRegion(
        fullPageImagePath,
        selectionBox,
        pageNumber
      );

      // Clean up full page image
      await fs.remove(fullPageImagePath).catch(() => {});

      // Generate a unique ID for this template
      const templateId = `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      return {
        id: templateId,
        imageData: templateImagePath, // File path to template
        boundingBox: selectionBox,
        description: `Symbol template extracted from page ${pageNumber}`
      };
    } catch (error) {
      console.error('❌ Failed to extract symbol template:', error);
      throw new Error(`Failed to extract symbol template: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Crop an image region using Python/OpenCV
   */
  private async cropImageRegion(
    imagePath: string,
    selectionBox: { x: number; y: number; width: number; height: number },
    pageNumber: number
  ): Promise<string> {
    try {
      // Create a simple Python script to crop the image
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

# Load image
img = cv2.imread(image_path)
if img is None:
    print(json.dumps({"success": False, "error": f"Failed to load image: {image_path}"}))
    sys.exit(1)

img_height, img_width = img.shape[:2]

# Convert normalized coordinates to pixels
x_px = int(x * img_width)
y_px = int(y * img_height)
w_px = int(width * img_width)
h_px = int(height * img_height)

# Ensure coordinates are within image bounds
x_px = max(0, min(x_px, img_width - 1))
y_px = max(0, min(y_px, img_height - 1))
w_px = min(w_px, img_width - x_px)
h_px = min(h_px, img_height - y_px)

# Crop the region
cropped = img[y_px:y_px+h_px, x_px:x_px+w_px]

# Save cropped image
cv2.imwrite(output_path, cropped)
print(json.dumps({"success": True, "output": output_path}))
`;

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

      // Clean up script
      await fs.remove(cropScriptPath).catch(() => {});

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
      
      await fs.remove(scriptPath).catch(() => {});
      
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
   * Get PDF file path (downloads from Supabase Storage if needed)
   * Matches the pattern used in cvTakeoffService
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
        await fs.remove(fullPageImagePath).catch(() => {});
        throw new Error(`Auto-count failed: ${execError instanceof Error ? execError.message : 'Unknown error'}`);
      }

      // Clean up temp file
      await fs.remove(fullPageImagePath).catch(() => {});

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
          onProgress({ current: 1, total: 1, currentPage: searchPageNum });
        }
        
        const pageMatches = await this.searchPage(pdfPath, searchPageNum, template, opts, pdfFileId);
        allMatches.push(...pageMatches);
      } else if (searchScope === 'entire-document') {
        // Search all pages in the current document
        const pdfPath = await this.getPDFFilePath(pdfFileId, projectId);
        const totalPages = await this.getPDFPageCount(pdfPath);
        
        console.log(`📄 Searching ${totalPages} pages in document ${pdfFileId}`);
        
        // Send initial progress with total pages
        if (onProgress && totalPages > 0) {
          onProgress({ current: 0, total: totalPages });
        }
        
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          if (onProgress) {
            onProgress({ current: pageNum, total: totalPages, currentPage: pageNum });
          }
          
          try {
            const pageMatches = await this.searchPage(pdfPath, pageNum, template, opts, pdfFileId);
            allMatches.push(...pageMatches);
          } catch (pageError) {
            console.warn(`⚠️ Failed to search page ${pageNum}, continuing...`, pageError);
            // Continue with other pages
          }
        }
      } else if (searchScope === 'entire-project') {
        // Search all pages in all documents in the project
        if (!projectId) {
          throw new Error('Project ID is required for entire-project scope');
        }
        
        const files = await storage.getFilesByProject(projectId);
        const pdfFiles = files.filter(f => f.mimetype === 'application/pdf');
        
        console.log(`📚 Searching ${pdfFiles.length} documents in project ${projectId}`);
        
        let totalPages = 0;
        let processedPages = 0;
        
        // First, count total pages for progress tracking
        for (const file of pdfFiles) {
          try {
            const pdfPath = await this.getPDFFilePath(file.id, projectId);
            const pageCount = await this.getPDFPageCount(pdfPath);
            totalPages += pageCount;
          } catch (error) {
            console.warn(`⚠️ Failed to get page count for document ${file.id}, skipping...`, error);
          }
        }
        
        // Send initial progress with total pages
        if (onProgress && totalPages > 0) {
          onProgress({ current: 0, total: totalPages });
        }
        
        // Now search all pages
        for (const file of pdfFiles) {
          try {
            const pdfPath = await this.getPDFFilePath(file.id, projectId);
            const pageCount = await this.getPDFPageCount(pdfPath);
            
            console.log(`📄 Searching ${pageCount} pages in document ${file.originalName || file.id}`);
            
            for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
              processedPages++;
              
              if (onProgress) {
                onProgress({ 
                  current: processedPages, 
                  total: totalPages, 
                  currentPage: pageNum,
                  currentDocument: file.originalName || file.id
                });
              }
              
              try {
                const pageMatches = await this.searchPage(pdfPath, pageNum, template, opts, file.id);
                allMatches.push(...pageMatches);
              } catch (pageError) {
                console.warn(`⚠️ Failed to search page ${pageNum} of document ${file.id}, continuing...`, pageError);
                // Continue with other pages
              }
            }
          } catch (fileError) {
            console.warn(`⚠️ Failed to process document ${file.id}, skipping...`, fileError);
            // Continue with other documents
          }
        }
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
    sheetId: string,
    conditionColor: string = '#3B82F6',
    conditionName: string = 'Auto-Count Match',
    conditionUnit: string = 'EA'
  ): Promise<void> {
    try {
      console.log(`📊 Creating ${matches.length} count measurements...`);
      
      for (const match of matches) {
        // Calculate the center point of the bounding box for the dot
        const centerX = match.boundingBox.x + (match.boundingBox.width / 2);
        const centerY = match.boundingBox.y + (match.boundingBox.height / 2);
        
        // Store bounding box info in description as JSON for thumbnail extraction
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
        
        const measurement = {
          id: `measurement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          projectId,
          sheetId,
          conditionId,
          type: 'count' as const,
          points: [{ x: centerX, y: centerY }],
          calculatedValue: 1,
          unit: conditionUnit,
          timestamp: new Date().toISOString(),
          pdfPage: match.pageNumber,
          pdfCoordinates: [
            { 
              x: (match.pdfCoordinates?.x || 0) + ((match.pdfCoordinates?.width || 0) / 2), 
              y: (match.pdfCoordinates?.y || 0) + ((match.pdfCoordinates?.height || 0) / 2) 
            }
          ],
          description: bboxInfo ? JSON.stringify(bboxInfo) : 'Auto-Count Match',
          conditionColor: conditionColor,
          conditionName: conditionName
        };
        
        await storage.saveTakeoffMeasurement(measurement);
      }
      
      console.log(`✅ Created ${matches.length} count measurements`);
    } catch (error) {
      console.error('❌ Failed to create count measurements:', error);
      throw new Error('Failed to create count measurements');
    }
  }
}

export const autoCountService = new AutoCountService();
// Legacy export for backward compatibility during migration
export const visualSearchService = autoCountService;
