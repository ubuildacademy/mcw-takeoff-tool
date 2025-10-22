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
    this.tempDir = path.join(process.cwd(), 'server', 'temp', 'pdf-images');
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
        const imageBuffer = await fs.readFile(result.images[0]);
        
        // Clean up the temporary file
        await this.cleanupTempFiles(result.images);

        return imageBuffer;
      }

      // Fallback to ImageMagick if pdf2pic fails
      console.log('pdf2pic failed, trying ImageMagick fallback...');
      return await this.convertPageToBufferWithImageMagick(pdfPath, pageNumber, options);
    } catch (error) {
      console.error('Error converting PDF page to buffer:', error);
      // Try ImageMagick fallback
      console.log('Trying ImageMagick fallback...');
      return await this.convertPageToBufferWithImageMagick(pdfPath, pageNumber, options);
    }
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

      // Use ImageMagick magick command with flattening and text enhancement options
      const command = `magick -density ${density} "${pdfPath}[${pageNumber - 1}]" -background white -alpha remove -flatten -enhance -sharpen 0x1 -quality ${quality} "${outputFile}"`;
      
      console.log('Running ImageMagick command:', command);
      await execAsync(command);

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
