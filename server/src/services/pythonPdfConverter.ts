/**
 * Python PDF Converter Service
 * 
 * Uses PyMuPDF (via Python script) to convert PDF pages to images.
 * This replaces the Node.js pdf2pic/ImageMagick approach with a pure Python solution.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';

const execAsync = promisify(exec);

export interface PDFToImageOptions {
  format?: 'png' | 'jpeg';
  quality?: number; // 1-100, only used for JPEG
  scale?: number; // Scale factor (default: 2.0 for higher resolution)
}

interface PythonConversionResult {
  success: boolean;
  imageData?: string; // Base64-encoded image data
  imageWidth?: number;
  imageHeight?: number;
  format?: string;
  error?: string;
}

class PythonPdfConverter {
  private pythonScriptPath: string;

  constructor() {
    // Determine script path (works in both source and compiled)
    const isCompiled = __dirname.includes('dist');
    const baseDir = isCompiled 
      ? path.join(__dirname, '..', '..') // dist/services -> dist -> server root
      : path.join(__dirname, '..'); // src/services -> src -> server root

    this.pythonScriptPath = path.join(baseDir, 'src', 'scripts', 'pdf_to_image.py');
  }

  /**
   * Get enhanced PATH for Railway/Nixpacks environments
   */
  private getEnhancedPath(): string {
    return [
      '/opt/venv/bin',  // Python venv (Railway)
      '/root/.nix-profile/bin',  // Nix user profile
      '/nix/var/nix/profiles/default/bin',  // Nix default profile
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      process.env.PATH || ''
    ].filter(Boolean).join(':');
  }

  /**
   * Check if Python and PyMuPDF are available
   */
  async checkAvailability(): Promise<{ available: boolean; pythonVersion?: string; error?: string }> {
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    const enhancedPath = this.getEnhancedPath();

    try {
      // Check Python
      const { stdout: pythonVersion } = await execAsync(`${pythonCommand} --version`, {
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
          pythonVersion: pythonVersion.trim(),
          error: 'PyMuPDF (fitz) not available. Install with: pip install pymupdf'
        };
      }

      return {
        available: true,
        pythonVersion: pythonVersion.trim()
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Python not available'
      };
    }
  }

  /**
   * Convert a PDF page to image buffer
   */
  async convertPageToBuffer(
    pdfPath: string,
    pageNumber: number,
    options: PDFToImageOptions = {}
  ): Promise<Buffer | null> {
    try {
      // Validate PDF file exists
      if (!await fs.pathExists(pdfPath)) {
        throw new Error(`PDF file not found: ${pdfPath}`);
      }

      const pdfStats = await fs.stat(pdfPath);
      if (pdfStats.size === 0) {
        throw new Error(`PDF file is empty: ${pdfPath}`);
      }

      const {
        format = 'png',
        quality = 90,
        scale = 2.0
      } = options;

      console.log(`📄 Converting PDF page ${pageNumber} using PyMuPDF: ${pdfPath} (${pdfStats.size} bytes)`);
      console.log(`   Options: format=${format}, scale=${scale}, quality=${quality}`);

      // Check availability
      const availability = await this.checkAvailability();
      if (!availability.available) {
        throw new Error(`Python/PyMuPDF not available: ${availability.error}`);
      }

      // Ensure script exists (it should be in the repo, but check anyway)
      if (!await fs.pathExists(this.pythonScriptPath)) {
        throw new Error(`Python script not found: ${this.pythonScriptPath}`);
      }

      // Build command
      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
      const command = `${pythonCommand} "${this.pythonScriptPath}" "${pdfPath}" ${pageNumber} ${scale} ${format} ${quality}`;

      console.log(`🔧 Executing: ${command}`);

      // Execute Python script
      const enhancedPath = this.getEnhancedPath();
      let stdout: string;
      let stderr: string;

      try {
        const execResult = await execAsync(command, {
          timeout: 30000, // 30 second timeout
          maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large images
          env: {
            ...process.env,
            PATH: enhancedPath
          }
        });
        stdout = execResult.stdout;
        stderr = execResult.stderr;
      } catch (execError: any) {
        const errorDetails = {
          command,
          pdfPath,
          pageNumber,
          error: execError instanceof Error ? execError.message : 'Unknown error',
          code: execError?.code,
          stdout: execError?.stdout || '',
          stderr: execError?.stderr || ''
        };
        console.error('❌ Python script execution failed:', JSON.stringify(errorDetails, null, 2));
        throw new Error(`PDF conversion failed: ${execError instanceof Error ? execError.message : 'Unknown error'}`);
      }

      if (stderr && !stderr.includes('DeprecationWarning')) {
        console.warn('⚠️ Python script warnings:', stderr);
      }

      // Parse JSON result
      let result: PythonConversionResult;
      try {
        const trimmedOutput = stdout.trim();
        result = JSON.parse(trimmedOutput);
      } catch (parseError) {
        console.error('❌ Failed to parse Python output:', stdout.substring(0, 500));
        throw new Error(`Failed to parse conversion results: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`);
      }

      if (!result.success) {
        throw new Error(result.error || 'PDF conversion failed');
      }

      if (!result.imageData) {
        throw new Error('No image data returned from Python script');
      }

      // Decode base64 to buffer
      const imageBuffer = Buffer.from(result.imageData, 'base64');

      if (imageBuffer.length === 0) {
        throw new Error('Decoded image buffer is empty');
      }

      console.log(`✅ PDF conversion successful: ${imageBuffer.length} bytes, ${result.imageWidth}x${result.imageHeight}px, format=${result.format}`);

      return imageBuffer;
    } catch (error) {
      console.error('❌ Error converting PDF page to buffer:', error);
      throw error;
    }
  }

  /**
   * Convert PDF page to image file (for services that need file paths)
   * This is a convenience method that converts to buffer then saves to temp file
   */
  async convertPageToImage(
    pdfPath: string,
    pageNumber: number,
    options: PDFToImageOptions & { outputDir?: string } = {}
  ): Promise<{ success: boolean; images: string[]; error?: string }> {
    try {
      const { outputDir, ...bufferOptions } = options;
      
      // Convert to buffer
      const imageBuffer = await this.convertPageToBuffer(pdfPath, pageNumber, bufferOptions);
      
      if (!imageBuffer) {
        return {
          success: false,
          images: [],
          error: 'Failed to convert PDF page to buffer'
        };
      }

      // Save to temp file
      const tempDir = outputDir || '/tmp/pdf-images';
      await fs.ensureDir(tempDir);

      const format = options.format || 'png';
      const extension = format === 'jpeg' ? 'jpg' : 'png';
      const filename = `page_${pageNumber}_${Date.now()}.${extension}`;
      const outputPath = path.join(tempDir, filename);

      await fs.writeFile(outputPath, imageBuffer);

      return {
        success: true,
        images: [outputPath]
      };
    } catch (error) {
      return {
        success: false,
        images: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export const pythonPdfConverter = new PythonPdfConverter();

