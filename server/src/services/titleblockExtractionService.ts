/**
 * Titleblock Extraction Service
 * 
 * Uses Python OCR to extract sheet numbers and names from PDF titleblocks.
 * Provides spatial detection and pattern matching for accurate extraction.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';

const execAsync = promisify(exec);

export interface SheetInfo {
  pageNumber: number;
  sheetNumber: string;
  sheetName: string;
}

export interface ExtractionResult {
  success: boolean;
  sheets: SheetInfo[];
  error?: string;
}

class TitleblockExtractionService {
  private pythonScriptPath: string;
  private tempDir: string;

  constructor() {
    // Determine script path (works in both source and compiled)
    const isCompiled = __dirname.includes('dist');
    const baseDir = isCompiled 
      ? path.join(__dirname, '..', '..') // dist/services -> dist -> server root
      : path.join(__dirname, '..'); // src/services -> src -> server root

    this.pythonScriptPath = path.join(baseDir, 'src', 'scripts', 'titleblock_extraction.py');
    
    // Temp directory for image processing
    const isProduction = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
    if (isProduction) {
      this.tempDir = '/tmp/titleblock-extraction';
    } else {
      const cwd = process.cwd();
      if (cwd.endsWith('server') || cwd.endsWith('server/')) {
        this.tempDir = path.join(cwd, 'temp', 'titleblock-extraction');
      } else {
        this.tempDir = path.join(cwd, 'server', 'temp', 'titleblock-extraction');
      }
    }
    
    // Ensure temp directory exists
    fs.ensureDirSync(this.tempDir);
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
   * Check if Python and required libraries are available
   */
  async checkAvailability(): Promise<{ available: boolean; error?: string; warning?: string }> {
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const enhancedPath = this.getEnhancedPath();

    try {
      // Check Python
      await execAsync(`${pythonCommand} --version`, {
        timeout: 5000,
        env: { ...process.env, PATH: enhancedPath }
      });

      // Check PyMuPDF
      try {
        await execAsync(`${pythonCommand} -c "import fitz; print('PyMuPDF available')"`, {
          timeout: 5000,
          env: { ...process.env, PATH: enhancedPath }
        });
      } catch (fitzError) {
        return {
          available: false,
          error: 'PyMuPDF (fitz) not available. Install with: pip install pymupdf'
        };
      }

      // Check pytesseract (required for OCR)
      try {
        await execAsync(`${pythonCommand} -c "import pytesseract; print('pytesseract available')"`, {
          timeout: 5000,
          env: { ...process.env, PATH: enhancedPath }
        });
      } catch (tesseractError) {
        return {
          available: false,
          error: 'pytesseract not available. OCR will not work. Install with: pip install pytesseract'
        };
      }

      // Check OpenCV (optional - script has fallback without it)
      let opencvAvailable = false;
      try {
        await execAsync(`${pythonCommand} -c "import cv2; print('OpenCV available')"`, {
          timeout: 5000,
          env: { ...process.env, PATH: enhancedPath }
        });
        opencvAvailable = true;
      } catch (cvError) {
        // OpenCV is optional - script will use fallback region detection
        console.warn('OpenCV not available - will use fallback titleblock detection');
        opencvAvailable = false;
      }

      // Service is available if we have PyMuPDF and pytesseract
      // OpenCV is nice-to-have but not required
      return { 
        available: true,
        ...(opencvAvailable ? {} : { warning: 'OpenCV not available - using fallback detection' })
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Python not available'
      };
    }
  }

  /**
   * Extract sheet information from PDF pages using Python OCR
   * Processes pages in batches for parallel processing
   */
  async extractSheets(
    pdfPath: string,
    pageNumbers: number[],
    batchSize: number = 10,
    titleblockRegion?: { x: number; y: number; width: number; height: number }
  ): Promise<ExtractionResult> {
    try {
      // Validate PDF exists
      if (!await fs.pathExists(pdfPath)) {
        return {
          success: false,
          sheets: [],
          error: `PDF file not found: ${pdfPath}`
        };
      }

      // Process pages in batches
      const allSheets: SheetInfo[] = [];
      const batches: number[][] = [];
      
      for (let i = 0; i < pageNumbers.length; i += batchSize) {
        batches.push(pageNumbers.slice(i, i + batchSize));
      }

      // Process batches in parallel (with concurrency limit)
      const CONCURRENT_BATCHES = 5; // Process 5 batches at a time
      for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
        const concurrentBatches = batches.slice(i, i + CONCURRENT_BATCHES);
        
        const batchPromises = concurrentBatches.map(batch => 
          this.processBatch(pdfPath, batch, titleblockRegion)
        );
        
        const batchResults = await Promise.all(batchPromises);
        
        // Collect results
        for (const result of batchResults) {
          if (result.success) {
            allSheets.push(...result.sheets);
          } else {
            // If batch failed, create Unknown entries for those pages
            const batch = concurrentBatches[concurrentBatches.indexOf(
              batchResults.find(r => r === result) ? concurrentBatches[0] : concurrentBatches[0]
            )];
            for (const pageNum of batch) {
              allSheets.push({
                pageNumber: pageNum,
                sheetNumber: "Unknown",
                sheetName: "Unknown"
              });
            }
          }
        }
      }

      // Sort by page number
      allSheets.sort((a, b) => a.pageNumber - b.pageNumber);

      return {
        success: true,
        sheets: allSheets
      };
    } catch (error) {
      return {
        success: false,
        sheets: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Process a batch of pages
   */
  private async processBatch(
    pdfPath: string,
    pageNumbers: number[],
    titleblockRegion?: { x: number; y: number; width: number; height: number }
  ): Promise<ExtractionResult> {
    try {
      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
      const pageNumbersStr = pageNumbers.join(',');
      
      const command = `${pythonCommand} "${this.pythonScriptPath}" "${pdfPath}" "${pageNumbersStr}" "${this.tempDir}"`;
      
      console.log(`[Python Extraction] Processing batch: pages ${pageNumbers.join(',')}`);
      console.log(`[Python Extraction] Command: ${command.substring(0, 200)}...`);
      
      const enhancedPath = this.getEnhancedPath();
      const execResult = await execAsync(command, {
        timeout: 120000, // 2 minutes per batch
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        env: {
          ...process.env,
          PATH: enhancedPath,
          // Optional: pass custom titleblock region to Python via env var
          ...(titleblockRegion
            ? {
                TITLEBLOCK_REGION: [
                  titleblockRegion.x,
                  titleblockRegion.y,
                  titleblockRegion.width,
                  titleblockRegion.height
                ].join(',')
              }
            : {})
        }
      });

      // Log stderr if present (Python warnings/errors)
      if (execResult.stderr && execResult.stderr.trim()) {
        console.warn(`[Python Extraction] Python stderr: ${execResult.stderr.substring(0, 500)}`);
      }

      // Parse JSON output
      const output = execResult.stdout.trim();
      console.log(`[Python Extraction] Python stdout length: ${output.length} chars`);
      console.log(`[Python Extraction] Python stdout preview: ${output.substring(0, 500)}`);
      
      let sheets: SheetInfo[];
      
      try {
        sheets = JSON.parse(output);
        
        // Validate format
        if (!Array.isArray(sheets)) {
          throw new Error('Output is not an array');
        }
        
        console.log(`[Python Extraction] Parsed ${sheets.length} sheets from batch`);
        
        // Log what was extracted
        const extractedCount = sheets.filter(s => s.sheetNumber !== 'Unknown' || s.sheetName !== 'Unknown').length;
        console.log(`[Python Extraction] Successfully extracted info for ${extractedCount}/${sheets.length} pages`);
        
        if (extractedCount === 0) {
          console.warn(`[Python Extraction] WARNING: All pages returned "Unknown" - extraction may have failed`);
        }
        
        // Ensure all pages are represented
        const resultPages = new Set(sheets.map(s => s.pageNumber));
        for (const pageNum of pageNumbers) {
          if (!resultPages.has(pageNum)) {
            console.warn(`[Python Extraction] Missing result for page ${pageNum}, adding Unknown`);
            sheets.push({
              pageNumber: pageNum,
              sheetNumber: "Unknown",
              sheetName: "Unknown"
            });
          }
        }
        
        // Sort by page number
        sheets.sort((a, b) => a.pageNumber - b.pageNumber);
        
      } catch (parseError) {
        console.error(`[Python Extraction] Failed to parse Python output:`, parseError);
        console.error(`[Python Extraction] Raw output: ${output.substring(0, 1000)}`);
        // Return Unknown for all pages in batch
        sheets = pageNumbers.map(pageNum => ({
          pageNumber: pageNum,
          sheetNumber: "Unknown",
          sheetName: "Unknown"
        }));
      }

      return {
        success: true,
        sheets
      };
    } catch (error) {
      console.error(`[Python Extraction] Error processing batch [${pageNumbers.join(',')}]:`, error);
      
      // Return Unknown for all pages in batch
      const sheets: SheetInfo[] = pageNumbers.map(pageNum => ({
        pageNumber: pageNum,
        sheetNumber: "Unknown",
        sheetName: "Unknown"
      }));
      
      return {
        success: false,
        sheets,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Extract raw text from a specific region of a PDF page
   * Returns the extracted text as a string
   */
  async extractTextFromRegion(
    pdfPath: string,
    pageNumber: number,
    region: { x: number; y: number; width: number; height: number }
  ): Promise<string | null> {
    try {
      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
      
      // Create a temporary script that extracts text from a specific region using OCR
      const tempScriptPath = path.join(this.tempDir, `extract_region_${Date.now()}.py`);
      const extractScript = `
import sys
import fitz  # PyMuPDF
import io
import pytesseract
from PIL import Image

pdf_path = sys.argv[1]
page_num = int(sys.argv[2])
region_x = float(sys.argv[3])
region_y = float(sys.argv[4])
region_w = float(sys.argv[5])
region_h = float(sys.argv[6])

try:
    doc = fitz.open(pdf_path)
    if page_num > len(doc):
        print("", end="")
        sys.exit(0)
    
    page = doc[page_num - 1]
    page_width = page.rect.width
    page_height = page.rect.height
    
    # Convert normalized region to absolute coordinates (clamp to page bounds)
    def clamp(value, min_value, max_value):
        return max(min_value, min(value, max_value))

    x0 = clamp(region_x, 0.0, 1.0) * page_width
    y0 = clamp(region_y, 0.0, 1.0) * page_height
    x1 = clamp(region_x + region_w, 0.0, 1.0) * page_width
    y1 = clamp(region_y + region_h, 0.0, 1.0) * page_height
    
    region_rect = fitz.Rect(x0, y0, x1, y1)
    
    # Render the clipped region to an image for OCR
    DPI = 300  # High-enough resolution for crisp text
    zoom = DPI / 72  # 72 points per inch baseline
    matrix = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=matrix, clip=region_rect, alpha=False)

    img_bytes = pix.tobytes("png")
    image = Image.open(io.BytesIO(img_bytes))

    # Perform OCR on the rendered image
    # PSM 6: Assume a block of text; OEM 3: default LSTM
    text = pytesseract.image_to_string(image, lang="eng", config="--oem 3 --psm 6")
    
    print(text.strip(), end="")
    doc.close()
except Exception as e:
    # Log error to stderr for debugging, but return empty string to caller
    print(f"Error extracting text from region: {e}", file=sys.stderr)
    print("", end="")
    sys.exit(0)
`;

      await fs.writeFile(tempScriptPath, extractScript);

      const enhancedPath = this.getEnhancedPath();
      const command = `${pythonCommand} "${tempScriptPath}" "${pdfPath}" "${pageNumber}" "${region.x}" "${region.y}" "${region.width}" "${region.height}"`;

      const execResult = await execAsync(command, {
        timeout: 30000,
        maxBuffer: 1024 * 1024, // 1MB
        env: {
          ...process.env,
          PATH: enhancedPath,
        },
      });

      // Clean up temp script
      await fs.remove(tempScriptPath).catch(() => {});

      const text = execResult.stdout.trim();
      return text || null;
    } catch (error) {
      console.error(`[Titleblock] Error extracting text from region for page ${pageNumber}:`, error);
      return null;
    }
  }
}

export const titleblockExtractionService = new TitleblockExtractionService();

