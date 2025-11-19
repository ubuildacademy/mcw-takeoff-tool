import { fromPath } from 'pdf2pic';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface PDFToImageOptions {
  pageNumber?: number; // Convert specific page (1-based), if not provided converts all pages
  outputDir?: string; // Output directory for images
  format?: 'png' | 'jpeg'; // Output format
  quality?: number; // Quality for JPEG (1-100)
  scale?: number; // Scale factor (default: 2.0 for higher resolution)
}

export interface PDFToImageResult {
  success: boolean;
  images: string[]; // Array of image file paths
  error?: string;
}

class PDFToImageConverter {
  private tempDir: string;

  constructor() {
    // Use /tmp on Railway/production, or local temp directory in development
    const baseTempDir = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production' 
      ? '/tmp/pdf-images' 
      : path.join(process.cwd(), 'temp', 'pdf-images');
    this.tempDir = baseTempDir;
    this.ensureTempDir();
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.ensureDir(this.tempDir);
    } catch (error) {
      console.error('Error creating temp directory:', error);
    }
  }

  /**
   * Convert PDF page(s) to image(s)
   */
  async convertPageToImage(
    pdfPath: string, 
    options: PDFToImageOptions = {}
  ): Promise<PDFToImageResult> {
    try {
      console.log(`Converting PDF to image: ${pdfPath}`);
      
      // Validate PDF file exists
      if (!await fs.pathExists(pdfPath)) {
        throw new Error(`PDF file not found: ${pdfPath}`);
      }

      const {
        pageNumber,
        outputDir = this.tempDir,
        format = 'png',
        quality = 90,
        scale = 2.0
      } = options;

      // Ensure output directory exists
      await fs.ensureDir(outputDir);

      // Generate unique output filename
      const baseName = path.basename(pdfPath, '.pdf');
      const uniqueId = uuidv4().substring(0, 8);

      // Configure pdf2pic options
      const convertOptions = {
        density: Math.round(150 * scale), // DPI (150 * scale for higher resolution)
        saveFilename: `${baseName}_${uniqueId}`,
        savePath: outputDir,
        format: format === 'jpeg' ? 'jpeg' : 'png',
        quality: quality,
        width: Math.round(2048 * scale), // Max width
        height: Math.round(2048 * scale) // Max height
      };

      console.log('PDF conversion options:', convertOptions);

      // Convert PDF to images using pdf2pic
      const convert = fromPath(pdfPath, convertOptions);
      
      let result;
      if (pageNumber) {
        // Convert specific page
        result = await convert(pageNumber, { responseType: 'image' });
      } else {
        // Convert all pages
        result = await convert.bulk(-1, { responseType: 'image' });
      }

      console.log('PDF conversion result:', result);

      // Handle single page result
      if (!Array.isArray(result)) {
        result = [result];
      }

      // Get the generated image files
      const imageFiles = result
        .filter((item: any) => item && item.path)
        .map((item: any) => item.path)
        .sort(); // Sort to maintain page order

      console.log(`Generated ${imageFiles.length} image(s):`, imageFiles);

      return {
        success: true,
        images: imageFiles
      };

    } catch (error) {
      console.error('Error converting PDF to image:', error);
      return {
        success: false,
        images: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Convert a specific PDF page to image buffer
   */
  async convertPageToBuffer(
    pdfPath: string, 
    pageNumber: number,
    options: Omit<PDFToImageOptions, 'pageNumber'> = {}
  ): Promise<Buffer | null> {
    try {
      // Try pdf2pic first
      const result = await this.convertPageToImage(pdfPath, {
        ...options,
        pageNumber
      });

      if (result.success && result.images.length > 0) {
        // Read the first (and should be only) image file
        const imagePath = result.images[0];
        console.log(`Reading image file: ${imagePath}`);
        
        // Verify file exists and has content
        if (!await fs.pathExists(imagePath)) {
          console.error(`Image file does not exist: ${imagePath}`);
          // Fallback to ImageMagick
          return await this.convertPageToBufferWithImageMagick(pdfPath, pageNumber, options);
        }
        
        const imageBuffer = await fs.readFile(imagePath);
        console.log(`Image buffer size: ${imageBuffer.length} bytes`);
        
        if (imageBuffer.length === 0) {
          console.error(`Image file is empty: ${imagePath}`);
          // Fallback to ImageMagick
          return await this.convertPageToBufferWithImageMagick(pdfPath, pageNumber, options);
        }
        
        // Clean up the temporary file
        await this.cleanupTempFiles(result.images);

        return imageBuffer;
      }

      // Fallback to ImageMagick if pdf2pic fails
      console.log(`pdf2pic failed (success: ${result.success}, images: ${result.images.length}), trying ImageMagick fallback...`);
      if (result.error) {
        console.error(`pdf2pic error: ${result.error}`);
      }
      return await this.convertPageToBufferWithImageMagick(pdfPath, pageNumber, options);
    } catch (error) {
      console.error('Error converting PDF page to buffer:', error);
      // Try ImageMagick fallback
      console.log('Trying ImageMagick fallback...');
      return await this.convertPageToBufferWithImageMagick(pdfPath, pageNumber, options);
    }
  }

  /**
   * Get enhanced PATH for Railway/Nixpacks environments
   */
  private getEnhancedPath(): string {
    return [
      '/nix/var/nix/profiles/default/bin',  // Nix default profile
      '/root/.nix-profile/bin',               // Nix user profile
      '/usr/local/bin',                        // Common system location
      '/usr/bin',                              // Standard system location
      '/bin',                                  // Basic system location
      process.env.PATH || ''                   // Existing PATH
    ].filter(Boolean).join(':');
  }

  /**
   * Check if ImageMagick is available and can handle PDFs
   */
  private async checkImageMagickAvailable(): Promise<{ available: boolean; command: string; error?: string }> {
    // Try 'magick' first (ImageMagick 7+), then 'convert' (ImageMagick 6 or legacy)
    const commands = ['magick', 'convert'];
    const enhancedPath = this.getEnhancedPath();
    
    // First, try to find ImageMagick using 'which' with enhanced PATH
    for (const cmd of commands) {
      try {
        const { stdout: whichOutput } = await execAsync(`which ${cmd}`, {
          timeout: 5000,
          env: { ...process.env, PATH: enhancedPath }
        });
        if (whichOutput && whichOutput.trim()) {
          const cmdPath = whichOutput.trim();
          console.log(`✅ ImageMagick found via 'which': ${cmdPath}`);
          // Verify it works and check PDF support
          try {
            await execAsync(`${cmdPath} --version`, { timeout: 5000, env: { ...process.env, PATH: enhancedPath } });
            // Check PDF support
            try {
              const { stdout: delegateStdout } = await execAsync(`${cmdPath} -list delegate`, { 
                timeout: 5000,
                env: { ...process.env, PATH: enhancedPath }
              });
              if (delegateStdout && delegateStdout.toLowerCase().includes('pdf')) {
                console.log(`✅ ImageMagick PDF support confirmed`);
                return { available: true, command: cmdPath };
              } else {
                console.warn(`⚠️ ImageMagick found but PDF support may be missing (Ghostscript required)`);
                return { available: true, command: cmdPath, error: 'PDF support may be missing' };
              }
            } catch {
              console.warn(`⚠️ Could not verify PDF support, will attempt anyway`);
              return { available: true, command: cmdPath };
            }
          } catch {
            // which found it but it doesn't work, continue searching
            continue;
          }
        }
      } catch {
        // which didn't find it, continue to manual paths
      }
    }
    
    // If 'which' didn't find it, try known paths
    for (const cmd of commands) {
      const cmdPaths = [
        cmd,  // Try in PATH first
        `/nix/var/nix/profiles/default/bin/${cmd}`,  // Nix default profile
        `/root/.nix-profile/bin/${cmd}`,              // Nix user profile
        `/usr/local/bin/${cmd}`,                      // Common system location
        `/usr/bin/${cmd}`                             // Standard system location
      ];
      
      for (const cmdPath of cmdPaths) {
        try {
          // Try to run the command with --version to check if it exists
          const { stdout } = await execAsync(`${cmdPath} --version`, { 
            timeout: 5000,
            env: { ...process.env, PATH: enhancedPath }
          });
          
          if (stdout) {
            console.log(`✅ ImageMagick found: ${cmdPath}`);
            
            // Check if it can handle PDFs by checking delegates
            try {
              const { stdout: delegateStdout } = await execAsync(`${cmdPath} -list delegate`, { 
                timeout: 5000,
                env: { ...process.env, PATH: enhancedPath }
              });
              if (delegateStdout && delegateStdout.toLowerCase().includes('pdf')) {
                console.log(`✅ ImageMagick PDF support confirmed`);
                return { available: true, command: cmdPath };
              } else {
                console.warn(`⚠️ ImageMagick found but PDF support may be missing (Ghostscript required)`);
                return { available: true, command: cmdPath, error: 'PDF support may be missing' };
              }
            } catch {
              // If delegate check fails, still try to use it
              console.warn(`⚠️ Could not verify PDF support, will attempt anyway`);
              return { available: true, command: cmdPath };
            }
          }
        } catch {
          continue;
        }
      }
    }
    
    return { available: false, command: 'magick', error: 'ImageMagick not found in PATH or standard locations' };
  }

  /**
   * Fallback method using ImageMagick directly
   */
  private async convertPageToBufferWithImageMagick(
    pdfPath: string, 
    pageNumber: number,
    options: Omit<PDFToImageOptions, 'pageNumber'> = {}
  ): Promise<Buffer | null> {
    try {
      // Check if ImageMagick is available
      const magickCheck = await this.checkImageMagickAvailable();
      if (!magickCheck.available) {
        console.error(`❌ ImageMagick not available: ${magickCheck.error}`);
        return null;
      }
      
      const magickCmd = magickCheck.command;
      const {
        outputDir = this.tempDir,
        format = 'png',
        quality = 90,
        scale = 2.0
      } = options;

      // Ensure output directory exists
      await fs.ensureDir(outputDir);

      // Generate unique output filename
      const baseName = path.basename(pdfPath, '.pdf');
      const uniqueId = uuidv4().substring(0, 8);
      const outputFile = path.join(outputDir, `${baseName}_${uniqueId}_page${pageNumber}.${format}`);

      // Calculate density (DPI) based on scale - use higher density for better text quality
      const density = Math.round(200 * scale);

      // Use ImageMagick command (magick for v7+, convert for v6)
      // Note: For 'convert', we need to adjust the syntax slightly
      const command = magickCmd === 'convert' 
        ? `${magickCmd} -density ${density} "${pdfPath}[${pageNumber - 1}]" -background white -alpha remove -flatten -enhance -sharpen 0x1 -quality ${quality} "${outputFile}"`
        : `${magickCmd} -density ${density} "${pdfPath}[${pageNumber - 1}]" -background white -alpha remove -flatten -enhance -sharpen 0x1 -quality ${quality} "${outputFile}"`;
      
      console.log(`Running ImageMagick command (${magickCmd}):`, command);
      console.log(`PDF path exists: ${await fs.pathExists(pdfPath)}`);
      console.log(`PDF path: ${pdfPath}`);
      console.log(`Output file will be: ${outputFile}`);
      
      try {
        const enhancedPath = this.getEnhancedPath();
        const { stdout, stderr } = await execAsync(command, { 
          timeout: 30000,
          env: { ...process.env, PATH: enhancedPath }
        });
        if (stdout) console.log('ImageMagick stdout:', stdout);
        if (stderr && !stderr.includes('deprecated')) {
          console.warn('ImageMagick stderr:', stderr);
        }
      } catch (execError: any) {
        console.error('ImageMagick command failed:', execError);
        console.error('Command stdout:', execError.stdout);
        console.error('Command stderr:', execError.stderr);
        console.error('Error code:', execError.code);
        console.error('Enhanced PATH used:', this.getEnhancedPath());
        throw execError;
      }

      // Check if the file was created
      if (await fs.pathExists(outputFile)) {
        const imageBuffer = await fs.readFile(outputFile);
        
        // Clean up the temporary file
        await fs.remove(outputFile);
        
        console.log(`ImageMagick conversion successful, buffer size: ${imageBuffer.length} bytes`);
        return imageBuffer;
      } else {
        console.error('ImageMagick conversion failed - no output file created');
        return null;
      }
    } catch (error) {
      console.error('ImageMagick conversion failed:', error);
      return null;
    }
  }

  /**
   * Clean up temporary image files
   */
  async cleanupTempFiles(imagePaths: string[]): Promise<void> {
    try {
      for (const imagePath of imagePaths) {
        if (await fs.pathExists(imagePath)) {
          await fs.remove(imagePath);
          console.log(`Cleaned up temp file: ${imagePath}`);
        }
      }
    } catch (error) {
      console.error('Error cleaning up temp files:', error);
    }
  }

  /**
   * Get PDF page count
   */
  async getPageCount(pdfPath: string): Promise<number> {
    try {
      if (!await fs.pathExists(pdfPath)) {
        throw new Error(`PDF file not found: ${pdfPath}`);
      }

      // Use pdf2pic to get page count by converting all pages with minimal settings
      const convertOptions = {
        density: 50, // Very low DPI for page count only
        saveFilename: 'page_count_check',
        savePath: this.tempDir,
        format: 'png',
        quality: 1,
        width: 100, // Very small size
        height: 100
      };

      const convert = fromPath(pdfPath, convertOptions);
      const result = await convert.bulk(-1, { responseType: 'image' });

      // Count the generated files
      const pageCount = Array.isArray(result) ? result.length : 1;

      // Clean up the temporary files
      if (Array.isArray(result)) {
        const tempFiles = result
          .filter((item: any) => item && item.path)
          .map((item: any) => item.path);
        await this.cleanupTempFiles(tempFiles);
      }

      return pageCount;
    } catch (error) {
      console.error('Error getting PDF page count:', error);
      return 0;
    }
  }
}

export const pdfToImage = new PDFToImageConverter();
