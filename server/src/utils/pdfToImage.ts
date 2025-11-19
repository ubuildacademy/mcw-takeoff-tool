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
    const isProduction = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      this.tempDir = '/tmp/pdf-images';
    } else {
      // In dev, check if cwd is server/ or repo root
      const cwd = process.cwd();
      if (cwd.endsWith('server') || cwd.endsWith('server/')) {
        this.tempDir = path.join(cwd, 'temp', 'pdf-images');
      } else {
        this.tempDir = path.join(cwd, 'server', 'temp', 'pdf-images');
      }
    }
    
    console.log(`📁 PDF to Image temp directory: ${this.tempDir}`);
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
      // Validate PDF file first
      if (!await fs.pathExists(pdfPath)) {
        console.error(`❌ PDF file does not exist: ${pdfPath}`);
        throw new Error(`PDF file not found: ${pdfPath}`);
      }
      
      const pdfStats = await fs.stat(pdfPath);
      if (pdfStats.size === 0) {
        console.error(`❌ PDF file is empty: ${pdfPath}`);
        throw new Error(`PDF file is empty: ${pdfPath}`);
      }
      
      console.log(`📄 Converting PDF page ${pageNumber} from: ${pdfPath} (${pdfStats.size} bytes)`);
      
      // Try pdf2pic first (but it often fails in Railway, so we'll fallback quickly)
      try {
        const result = await this.convertPageToImage(pdfPath, {
          ...options,
          pageNumber
        });

        if (result.success && result.images.length > 0) {
          // Read the first (and should be only) image file
          const imagePath = result.images[0];
          console.log(`📖 Reading image file: ${imagePath}`);
          
          // Verify file exists and has content
          if (!await fs.pathExists(imagePath)) {
            console.warn(`⚠️ Image file does not exist: ${imagePath}, falling back to ImageMagick`);
            return await this.convertPageToBufferWithImageMagick(pdfPath, pageNumber, options);
          }
          
          const imageBuffer = await fs.readFile(imagePath);
          console.log(`📊 Image buffer size: ${imageBuffer.length} bytes`);
          
          if (imageBuffer.length === 0) {
            console.warn(`⚠️ Image file is empty: ${imagePath}, falling back to ImageMagick`);
            // Clean up empty file
            await fs.remove(imagePath).catch(() => {});
            return await this.convertPageToBufferWithImageMagick(pdfPath, pageNumber, options);
          }
          
          // Clean up the temporary file
          await this.cleanupTempFiles(result.images);

          console.log(`✅ pdf2pic conversion successful: ${imageBuffer.length} bytes`);
          return imageBuffer;
        }

        // Fallback to ImageMagick if pdf2pic fails
        console.log(`⚠️ pdf2pic failed (success: ${result.success}, images: ${result.images.length}), trying ImageMagick fallback...`);
        if (result.error) {
          console.error(`pdf2pic error: ${result.error}`);
        }
      } catch (pdf2picError) {
        console.warn(`⚠️ pdf2pic threw error, falling back to ImageMagick:`, pdf2picError);
      }
      
      // Always try ImageMagick as fallback (more reliable in Railway)
      return await this.convertPageToBufferWithImageMagick(pdfPath, pageNumber, options);
    } catch (error) {
      console.error('❌ Error converting PDF page to buffer:', error);
      // Try ImageMagick fallback as last resort
      try {
        console.log('🔄 Attempting ImageMagick fallback as last resort...');
        return await this.convertPageToBufferWithImageMagick(pdfPath, pageNumber, options);
      } catch (fallbackError) {
        console.error('❌ ImageMagick fallback also failed:', fallbackError);
        throw new Error(`Failed to convert PDF page ${pageNumber} to image. pdf2pic error: ${error instanceof Error ? error.message : 'Unknown'}. ImageMagick error: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown'}`);
      }
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
      console.log(`🖼️ Attempting ImageMagick conversion for page ${pageNumber}...`);
      
      // Validate PDF file exists
      if (!await fs.pathExists(pdfPath)) {
        throw new Error(`PDF file does not exist: ${pdfPath}`);
      }
      
      // Check if ImageMagick is available
      const magickCheck = await this.checkImageMagickAvailable();
      if (!magickCheck.available) {
        const errorMsg = `ImageMagick not available: ${magickCheck.error}`;
        console.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
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
      console.log(`📁 Output directory: ${outputDir}`);

      // Generate unique output filename
      const baseName = path.basename(pdfPath, '.pdf');
      const uniqueId = uuidv4().substring(0, 8);
      const outputFile = path.join(outputDir, `${baseName}_${uniqueId}_page${pageNumber}.${format}`);

      // Calculate density (DPI) based on scale - use higher density for better text quality
      const density = Math.round(200 * scale);

      // Use ImageMagick command (magick for v7+, convert for v6)
      // Note: For 'convert', we need to adjust the syntax slightly
      // Page numbers in ImageMagick are 0-indexed, so subtract 1
      const pageIndex = pageNumber - 1;
      const command = magickCmd === 'convert' 
        ? `${magickCmd} -density ${density} "${pdfPath}[${pageIndex}]" -background white -alpha remove -flatten -enhance -sharpen 0x1 -quality ${quality} "${outputFile}"`
        : `${magickCmd} -density ${density} "${pdfPath}[${pageIndex}]" -background white -alpha remove -flatten -enhance -sharpen 0x1 -quality ${quality} "${outputFile}"`;
      
      console.log(`🔧 Running ImageMagick command: ${magickCmd}`);
      console.log(`📄 PDF path: ${pdfPath}`);
      console.log(`📄 PDF exists: ${await fs.pathExists(pdfPath)}`);
      console.log(`📄 PDF size: ${(await fs.stat(pdfPath)).size} bytes`);
      console.log(`📄 Page index: ${pageIndex} (page ${pageNumber})`);
      console.log(`📁 Output file: ${outputFile}`);
      console.log(`⚙️ Command: ${command}`);
      
      const enhancedPath = this.getEnhancedPath();
      const enhancedLdPath = [
        '/nix/var/nix/profiles/default/lib',
        '/root/.nix-profile/lib',
        '/usr/lib',
        '/usr/local/lib',
        process.env.LD_LIBRARY_PATH || ''
      ].filter(Boolean).join(':');
      
      try {
        const { stdout, stderr } = await execAsync(command, { 
          timeout: 60000, // Increased timeout for complex PDFs
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          env: { 
            ...process.env, 
            PATH: enhancedPath,
            LD_LIBRARY_PATH: enhancedLdPath
          }
        });
        
        if (stdout) {
          console.log('✅ ImageMagick stdout:', stdout.substring(0, 500));
        }
        if (stderr && !stderr.includes('deprecated') && !stderr.includes('warning')) {
          console.warn('⚠️ ImageMagick stderr:', stderr.substring(0, 500));
        }
      } catch (execError: any) {
        const errorDetails = {
          command,
          magickCmd,
          pdfPath,
          pageNumber,
          pageIndex,
          outputFile,
          stdout: execError.stdout?.substring(0, 1000),
          stderr: execError.stderr?.substring(0, 1000),
          code: execError.code,
          signal: execError.signal,
          enhancedPath,
          enhancedLdPath
        };
        console.error('❌ ImageMagick command failed:', JSON.stringify(errorDetails, null, 2));
        throw new Error(`ImageMagick conversion failed: ${execError.message || 'Unknown error'}. Command: ${command}`);
      }

      // Wait a bit for file system to sync
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if the file was created
      if (await fs.pathExists(outputFile)) {
        const imageBuffer = await fs.readFile(outputFile);
        
        if (imageBuffer.length === 0) {
          console.error(`❌ ImageMagick created empty file: ${outputFile}`);
          await fs.remove(outputFile).catch(() => {});
          throw new Error(`ImageMagick created empty output file`);
        }
        
        // Clean up the temporary file
        await fs.remove(outputFile).catch(() => {
          console.warn(`⚠️ Could not clean up temp file: ${outputFile}`);
        });
        
        console.log(`✅ ImageMagick conversion successful: ${imageBuffer.length} bytes`);
        return imageBuffer;
      } else {
        const errorMsg = `ImageMagick conversion failed - no output file created at ${outputFile}`;
        console.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error('❌ ImageMagick conversion failed:', error);
      throw error; // Re-throw to allow caller to handle
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
