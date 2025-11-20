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
  async checkAvailability(): Promise<{ available: boolean; error?: string }> {
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

      // Check pytesseract (optional but recommended)
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

      // Check OpenCV (optional but recommended)
      try {
        await execAsync(`${pythonCommand} -c "import cv2; print('OpenCV available')"`, {
          timeout: 5000,
          env: { ...process.env, PATH: enhancedPath }
        });
      } catch (cvError) {
        return {
          available: false,
          error: 'OpenCV not available. Titleblock detection may be limited. Install with: pip install opencv-python'
        };
      }

      return { available: true };
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
    batchSize: number = 10
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
          this.processBatch(pdfPath, batch)
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
  private async processBatch(pdfPath: string, pageNumbers: number[]): Promise<ExtractionResult> {
    try {
      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
      const pageNumbersStr = pageNumbers.join(',');
      
      const command = `${pythonCommand} "${this.pythonScriptPath}" "${pdfPath}" "${pageNumbersStr}" "${this.tempDir}"`;
      
      const enhancedPath = this.getEnhancedPath();
      const execResult = await execAsync(command, {
        timeout: 120000, // 2 minutes per batch
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        env: {
          ...process.env,
          PATH: enhancedPath
        }
      });

      // Parse JSON output
      const output = execResult.stdout.trim();
      let sheets: SheetInfo[];
      
      try {
        sheets = JSON.parse(output);
        
        // Validate format
        if (!Array.isArray(sheets)) {
          throw new Error('Output is not an array');
        }
        
        // Ensure all pages are represented
        const resultPages = new Set(sheets.map(s => s.pageNumber));
        for (const pageNum of pageNumbers) {
          if (!resultPages.has(pageNum)) {
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
        console.error('Failed to parse Python output:', output.substring(0, 500));
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
      console.error(`Error processing batch [${pageNumbers.join(',')}]:`, error);
      
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
}

export const titleblockExtractionService = new TitleblockExtractionService();

