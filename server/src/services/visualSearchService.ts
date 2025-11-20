/**
 * Visual Search Service for Symbol Detection and Matching
 * 
 * This service uses OpenCV template matching (via Python) to detect and match symbols
 * in construction drawings based on user-selected reference symbols.
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

export interface VisualSearchMatch {
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

export interface VisualSearchResult {
  matches: VisualSearchMatch[];
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

export interface VisualSearchOptions {
  confidenceThreshold: number;
  maxMatches: number;
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
  error?: string;
}

class VisualSearchService {
  private defaultOptions: VisualSearchOptions = {
    confidenceThreshold: 0.7,
    maxMatches: 100,
    searchRadius: 0.1,
    scaleTolerance: 0.2
  };

  private pythonScriptPath: string;
  private tempDir: string;

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
      const { stdout } = await execAsync(command, {
        timeout: 10000,
        env: { ...process.env, PATH: enhancedPath }
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
   * Search for symbols matching the template using Python/OpenCV template matching
   */
  async searchForSymbols(
    conditionId: string,
    pdfFileId: string,
    template: SymbolTemplate,
    options: Partial<VisualSearchOptions> = {},
    pageNumber?: number,
    projectId?: string
  ): Promise<VisualSearchResult> {
    const opts = { ...this.defaultOptions, ...options };
    const startTime = Date.now();

    try {
      console.log(`🔍 Searching for symbols matching template ${template.id}...`);
      
      // Get PDF file path
      const pdfPath = await this.getPDFFilePath(pdfFileId, projectId);
      
      // Use provided page number or default to 1
      const searchPageNumber = pageNumber || 1;
      
      // Convert PDF page to image
      const imageBuffer = await pythonPdfConverter.convertPageToBuffer(pdfPath, searchPageNumber, {
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

      // Call Python visual search script
      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
      const command = `${pythonCommand} "${this.pythonScriptPath}" "${fullPageImagePath}" "${template.imageData}" ${opts.confidenceThreshold}`;

      console.log(`🔧 Executing visual search: ${command}`);

      const enhancedPath = this.getEnhancedPath();
      let stdout: string;
      let stderr: string;

      try {
        const execResult = await execAsync(command, {
          timeout: 60000, // 60 second timeout
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          env: { ...process.env, PATH: enhancedPath }
        });
        stdout = execResult.stdout;
        stderr = execResult.stderr;
      } catch (execError: any) {
        // Clean up temp file
        await fs.remove(fullPageImagePath).catch(() => {});
        
        const errorDetails = {
          command,
          error: execError instanceof Error ? execError.message : 'Unknown error',
          stdout: execError?.stdout || '',
          stderr: execError?.stderr || ''
        };
        console.error('❌ Python visual search failed:', JSON.stringify(errorDetails, null, 2));
        throw new Error(`Visual search failed: ${execError instanceof Error ? execError.message : 'Unknown error'}`);
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
        throw new Error(`Failed to parse visual search results: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`);
      }

      if (!result.success) {
        throw new Error(result.error || 'Visual search failed');
      }

      // Convert Python matches to VisualSearchMatch format
      const matches: VisualSearchMatch[] = (result.matches || []).map((match, index) => ({
        id: match.id || `match_${Date.now()}_${index}`,
        confidence: match.confidence,
        boundingBox: match.boundingBox,
        pageNumber: searchPageNumber,
        pdfCoordinates: match.pdfCoordinates,
        description: `Match for ${template.description || 'symbol'}`
      }));

      // Limit to maxMatches
      const limitedMatches = matches
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, opts.maxMatches);

      const processingTime = Date.now() - startTime;
      
      console.log(`✅ Visual search complete: ${limitedMatches.length} matches found in ${processingTime}ms`);

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
      console.error('❌ Visual search failed:', error);
      throw new Error(`Visual search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create count measurements from visual search matches
   */
  async createCountMeasurements(
    conditionId: string,
    matches: VisualSearchMatch[],
    projectId: string,
    sheetId: string
  ): Promise<void> {
    try {
      console.log(`📊 Creating ${matches.length} count measurements...`);
      
      for (const match of matches) {
        // Calculate the center point of the bounding box for the dot
        const centerX = match.boundingBox.x + (match.boundingBox.width / 2);
        const centerY = match.boundingBox.y + (match.boundingBox.height / 2);
        
        const measurement = {
          id: `measurement_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          projectId,
          sheetId,
          conditionId,
          type: 'count' as const,
          points: [{ x: centerX, y: centerY }],
          calculatedValue: 1,
          unit: 'EA',
          timestamp: new Date().toISOString(),
          pdfPage: match.pageNumber,
          pdfCoordinates: [
            { 
              x: (match.pdfCoordinates?.x || 0) + ((match.pdfCoordinates?.width || 0) / 2), 
              y: (match.pdfCoordinates?.y || 0) + ((match.pdfCoordinates?.height || 0) / 2) 
            }
          ],
          conditionColor: '#3B82F6',
          conditionName: 'Visual Search Match'
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

export const visualSearchService = new VisualSearchService();
