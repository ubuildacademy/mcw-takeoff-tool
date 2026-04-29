import Tesseract from 'tesseract.js';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';

/** Verbose OCR tracing; silent in production builds. */
function ocrDevLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.log(...args);
}
function ocrDevWarn(...args: unknown[]): void {
  if (import.meta.env.DEV) console.warn(...args);
}

/** Tesseract logger message (progress updates) */
interface TesseractLoggerMessage {
  status?: string;
  progress?: number;
  [key: string]: unknown;
}

/** Tesseract recognize result data shape (compatible with Tesseract Page) */
interface TesseractRecognizeData {
  text?: string;
  confidence?: number;
  words?: Array<{
    text?: string;
    confidence?: number;
    bbox?: {
      x0?: number;
      y0?: number;
      x1?: number;
      y1?: number;
    };
  }>;
}

/** Worker config with optional path overrides (omit for CDN) */
interface TesseractWorkerConfigWithPaths {
  logger?: (m: TesseractLoggerMessage) => void;
  workerPath?: string;
  langPath?: string;
  corePath?: string;
  [key: string]: unknown;
}

export interface OCRResult {
  pageNumber: number;
  text: string;
  confidence: number;
  processingTime: number;
  wordBoxes: OCRWordBox[];
}

export interface OCRWordBox {
  index: number;
  text: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  source: 'tesseract' | 'pdfjs';
  ocrRotationDeg: number;
}

export interface DocumentOCRData {
  documentId: string;
  totalPages: number;
  pages: OCRResult[];
  processedAt: string;
  searchIndex: Map<string, number[]>; // word -> page numbers
}

class OCRService {
  private worker: Tesseract.Worker | null = null;
  private isInitialized = false;
  private processingQueue: Map<string, Promise<DocumentOCRData>> = new Map();
  private completedOCR: Map<string, DocumentOCRData> = new Map();

  private async canvasToImageInput(canvas: HTMLCanvasElement): Promise<Blob | string> {
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/png')
    );
    if (blob) return blob;
    // Fallback (older browsers / rare failures) — keep behavior compatible.
    return canvas.toDataURL('image/png', 1.0);
  }

  private getCappedScale(page: PDFPageProxy, desiredScale: number): number {
    // Rough pixel budget to avoid huge canvases (memory spikes / main-thread stalls).
    const maxPixels = 12_000_000; // ~12MP
    const base = page.getViewport({ scale: 1.0 });
    const desiredPixels = base.width * base.height * desiredScale * desiredScale;
    if (desiredPixels <= maxPixels) return desiredScale;
    const capped = Math.sqrt(maxPixels / (base.width * base.height));
    return Math.max(1.0, Math.min(desiredScale, capped));
  }

  private preprocessCanvasForOCR(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const pixelCount = canvas.width * canvas.height;
    // Skip heavy preprocessing for very large pages to keep OCR responsive.
    if (pixelCount > 16_000_000) return canvas;

    const processed = document.createElement('canvas');
    processed.width = canvas.width;
    processed.height = canvas.height;
    const ctx = processed.getContext('2d');
    if (!ctx) return canvas;

    ctx.drawImage(canvas, 0, 0);
    const imageData = ctx.getImageData(0, 0, processed.width, processed.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Grayscale + contrast stretch + gentle clipping for noisy blueprint backgrounds.
      let gray = 0.299 * r + 0.587 * g + 0.114 * b;
      gray = (gray - 128) * 1.25 + 128;
      if (gray > 210) gray = 255;
      if (gray < 35) gray = 0;
      const clamped = Math.max(0, Math.min(255, gray));
      data[i] = clamped;
      data[i + 1] = clamped;
      data[i + 2] = clamped;
    }

    ctx.putImageData(imageData, 0, 0);
    return processed;
  }

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private viewportNormPointToBaseNorm(
    point: { x: number; y: number },
    rotationDeg: number
  ): { x: number; y: number } {
    const r = ((rotationDeg % 360) + 360) % 360;
    if (r === 0) return { x: point.x, y: point.y };
    if (r === 90) return { x: point.y, y: 1 - point.x };
    if (r === 180) return { x: 1 - point.x, y: 1 - point.y };
    if (r === 270) return { x: 1 - point.y, y: point.x };
    return { x: point.x, y: point.y };
  }

  private viewportNormRectToBaseNorm(
    rect: { x: number; y: number; width: number; height: number },
    rotationDeg: number
  ): { x: number; y: number; width: number; height: number } {
    const corners = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ].map((point) => this.viewportNormPointToBaseNorm(point, rotationDeg));
    const xs = corners.map((point) => this.clamp01(point.x));
    const ys = corners.map((point) => this.clamp01(point.y));
    const xMin = Math.min(...xs);
    const yMin = Math.min(...ys);
    const xMax = Math.max(...xs);
    const yMax = Math.max(...ys);
    return {
      x: xMin,
      y: yMin,
      width: this.clamp01(xMax - xMin),
      height: this.clamp01(yMax - yMin),
    };
  }

  private extractWordBoxes(
    data: TesseractRecognizeData,
    context: {
      canvasWidth: number;
      canvasHeight: number;
      rotationDeg: number;
      fullPageViewport?: { offsetX: number; offsetY: number; width: number; height: number; fullWidth: number; fullHeight: number };
    }
  ): OCRWordBox[] {
    const words = Array.isArray(data.words) ? data.words : [];
    if (words.length === 0 || context.canvasWidth <= 0 || context.canvasHeight <= 0) {
      return [];
    }

    const boxes: OCRWordBox[] = [];
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const text = typeof word.text === 'string' ? word.text.trim() : '';
      if (!text) continue;

      const x0 = Number(word.bbox?.x0);
      const y0 = Number(word.bbox?.y0);
      const x1 = Number(word.bbox?.x1);
      const y1 = Number(word.bbox?.y1);
      if (![x0, y0, x1, y1].every((value) => Number.isFinite(value))) continue;

      const normRectInCanvas = {
        x: this.clamp01(x0 / context.canvasWidth),
        y: this.clamp01(y0 / context.canvasHeight),
        width: this.clamp01((x1 - x0) / context.canvasWidth),
        height: this.clamp01((y1 - y0) / context.canvasHeight),
      };
      if (normRectInCanvas.width <= 0 || normRectInCanvas.height <= 0) continue;

      const viewportNormRect = context.fullPageViewport
        ? {
            x: this.clamp01((context.fullPageViewport.offsetX + normRectInCanvas.x * context.fullPageViewport.width) / context.fullPageViewport.fullWidth),
            y: this.clamp01((context.fullPageViewport.offsetY + normRectInCanvas.y * context.fullPageViewport.height) / context.fullPageViewport.fullHeight),
            width: this.clamp01((normRectInCanvas.width * context.fullPageViewport.width) / context.fullPageViewport.fullWidth),
            height: this.clamp01((normRectInCanvas.height * context.fullPageViewport.height) / context.fullPageViewport.fullHeight),
          }
        : normRectInCanvas;

      const baseNormRect = this.viewportNormRectToBaseNorm(viewportNormRect, context.rotationDeg);
      boxes.push({
        index: boxes.length,
        text,
        confidence: typeof word.confidence === 'number' ? word.confidence : 0,
        bbox: baseNormRect,
        source: 'tesseract',
        ocrRotationDeg: ((context.rotationDeg % 360) + 360) % 360,
      });
    }

    return boxes;
  }

  // Initialize Tesseract worker (lazy initialization)
  private async initializeWorker(): Promise<void> {
    if (this.isInitialized && this.worker) return;

    try {
      // Try to create worker with local files first, fallback to CDN
      const workerConfig: TesseractWorkerConfigWithPaths = {
        logger: (m: TesseractLoggerMessage) => {
          // Reduce OCR logging to prevent console spam - only log major milestones
          if (m.status === 'recognizing text' && (m.progress === 0.25 || m.progress === 0.5 || m.progress === 0.75 || m.progress === 1.0)) {
            ocrDevLog(`OCR Progress: ${Math.round((m.progress ?? 0) * 100)}%`);
          }
        },
        // Try local files first
        workerPath: '/tesseract/',
        langPath: '/tesseract/lang-data/',
        corePath: '/tesseract/',
        // Optimize for architectural drawings and technical text
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT_OSD, // Better for mixed text/graphics on plan sheets
        preserve_interword_spaces: '1',
        tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY, // Use LSTM for better accuracy
        tessedit_create_hocr: '0', // Disable HOCR output
        tessedit_create_tsv: '0', // Disable TSV output
        tessedit_create_pdf: '0', // Disable PDF output
      };

      try {
        this.worker = await Tesseract.createWorker('eng', 1, workerConfig);
        ocrDevLog('✅ Tesseract OCR worker initialized with local files');
      } catch (localError) {
        ocrDevWarn('⚠️ Local Tesseract files not found, trying CDN fallback:', localError);
        // Fallback to CDN: omit path overrides so Tesseract uses CDN
        const { workerPath: _w, langPath: _l, corePath: _c, ...cdnConfig } = workerConfig;
        this.worker = await Tesseract.createWorker('eng', 1, cdnConfig as Parameters<typeof Tesseract.createWorker>[2]);
        ocrDevLog('✅ Tesseract OCR worker initialized with CDN fallback');
      }

      this.isInitialized = true;
    } catch (error) {
      console.error('❌ Failed to initialize Tesseract worker:', error);
      throw error;
    }
  }

  // Process a single PDF page
  private async processPage(
    canvas: HTMLCanvasElement, 
    pageNumber: number,
    context?: {
      rotationDeg?: number;
      fullPageViewport?: { offsetX: number; offsetY: number; width: number; height: number; fullWidth: number; fullHeight: number };
    }
  ): Promise<OCRResult> {
    if (!this.worker) {
      throw new Error('OCR worker not initialized');
    }

    const startTime = Date.now();
    ocrDevLog(`🔍 Processing page ${pageNumber} with Tesseract...`);

    try {
      // Validate canvas before processing
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        throw new Error('Invalid canvas: width or height is 0');
      }
      
      // Convert canvas to an image input without huge base64 strings
      const preprocessedCanvas = this.preprocessCanvasForOCR(canvas);
      const imageInput = await this.canvasToImageInput(preprocessedCanvas);
      
      // Validate image data
      if (!imageInput || (typeof imageInput === 'string' && imageInput.length < 100)) {
        throw new Error('Invalid image data generated from canvas');
      }
      
      // Set optimized parameters for architectural drawings
      await this.worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT_OSD, // Better for sparse technical text
        tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY, // Use LSTM for better accuracy
        preserve_interword_spaces: '1',
        // Optimize for small text in drawings
        tessedit_min_char_height: '6',
        tessedit_max_char_height: '120',
        // Better handling of technical drawings
        classify_bln_numeric_mode: '1',
        textord_min_linesize: '2.0',
        // Improve text detection in mixed content
        textord_tabfind_show_vlines: '0',
        textord_show_final_blobs: '0'
      });

      // Perform OCR recognition
      const { data } = await this.worker.recognize(imageInput);
      
      const processingTime = Date.now() - startTime;
      
      ocrDevLog(`✅ Page ${pageNumber} OCR completed:`, {
        textLength: data.text?.length || 0,
        confidence: data.confidence,
        processingTime: `${processingTime}ms`,
        textPreview: data.text?.substring(0, 100) + '...'
      });

      return this.createOCRResult(data, pageNumber, processingTime, {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        rotationDeg: context?.rotationDeg ?? 0,
        fullPageViewport: context?.fullPageViewport,
      });

    } catch (error) {
      console.error(`❌ OCR failed for page ${pageNumber}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`OCR processing failed for page ${pageNumber}: ${errorMessage}`);
    }
  }

  // Process entire PDF document
  async processDocument(documentId: string, pdfUrl: string): Promise<DocumentOCRData> {
    // Check if already processing
    const queued = this.processingQueue.get(documentId);
    if (queued != null) return queued;

    // Check if already completed
    const completed = this.completedOCR.get(documentId);
    if (completed != null) return completed;

    // Check memory usage before starting
    const memoryInfo = this.getMemoryInfo();
    if (memoryInfo.completedOCR > 10) {
      ocrDevWarn('⚠️ High memory usage detected, cleaning up old OCR data');
      this.cleanupOldData();
    }

    const processingPromise = this._processDocument(documentId, pdfUrl);
    this.processingQueue.set(documentId, processingPromise);

    try {
      const result = await processingPromise;
      this.completedOCR.set(documentId, result);
      return result;
    } catch (error) {
      console.error(`❌ OCR processing failed for document ${documentId}:`, error);
      // Don't cache failed results, allow retry
      throw error;
    } finally {
      this.processingQueue.delete(documentId);
    }
  }

  private async _processDocument(documentId: string, pdfUrl: string): Promise<DocumentOCRData> {
    ocrDevLog(`🔍 Starting OCR processing for document: ${documentId}`);
    ocrDevLog(`📄 PDF URL: ${pdfUrl}`);
    
    await this.initializeWorker();

    try {
      // Load PDF document with comprehensive error handling
      ocrDevLog(`📥 Loading PDF from: ${pdfUrl}`);
      
      const { getPdfjs } = await import('../lib/pdfjs');
      const pdfjsLib = await getPdfjs();

      const pdf = await pdfjsLib.getDocument({
        url: pdfUrl,
        httpHeaders: {
          'Accept': 'application/pdf'
        },
        // Add timeout and retry logic
        maxImageSize: 1024 * 1024, // 1MB max image size
        disableAutoFetch: false,
        disableStream: false
      }).promise;
      
      const totalPages = pdf.numPages;
      ocrDevLog(`📄 PDF loaded successfully: ${totalPages} pages`);

      if (totalPages === 0) {
        throw new Error('PDF contains no pages');
      }

      const pages: OCRResult[] = [];
      const searchIndex = new Map<string, number[]>();

      // Process pages in smaller batches for better memory management
      const batchSize = Math.min(2, totalPages); // Process max 2 pages at a time
      ocrDevLog(`🔄 Processing in batches of ${batchSize} pages...`);
      
      for (let i = 0; i < totalPages; i += batchSize) {
        const batchPromises = [];
        const batchStart = i + 1;
        const batchEnd = Math.min(i + batchSize, totalPages);
        
        ocrDevLog(`📄 Processing batch: pages ${batchStart}-${batchEnd}`);
        
        for (let j = i; j < batchEnd; j++) {
          const pageNumber = j + 1;
          batchPromises.push(this.processPageNumberWithRetry(pdf, pageNumber));
        }

        try {
          const batchResults = await Promise.all(batchPromises);
          
          for (const result of batchResults) {
            if (result && result.text && result.text.trim().length > 0) {
              pages.push(result);
              
              // Build search index
              this.buildSearchIndex(result, searchIndex);
              
              // Emit progress event
              this.emitProgress(documentId, pages.length, totalPages, 'Processing pages');
            } else {
              ocrDevWarn(`⚠️ Page ${result?.pageNumber || 'unknown'} produced no text`);
            }
          }
        } catch (batchError) {
          console.error(`❌ Batch processing failed for pages ${batchStart}-${batchEnd}:`, batchError);
          // Continue with next batch instead of failing completely
        }

        // Longer delay between batches for large documents
        if (i + batchSize < totalPages) {
          const delay = totalPages > 20 ? 500 : 200; // Longer delay for large docs
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      const documentData: DocumentOCRData = {
        documentId,
        totalPages,
        pages,
        processedAt: new Date().toISOString(),
        searchIndex
      };

      ocrDevLog(`✅ OCR processing completed for document: ${documentId}`, {
        totalPages,
        processedPages: pages.length,
        totalTextLength: pages.reduce((sum, page) => sum + page.text.length, 0)
      });
      
      return documentData;

    } catch (error) {
      console.error(`❌ OCR processing failed for document ${documentId}:`, error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Provide more specific error messages
      if (errorMessage.includes('Invalid PDF')) {
        throw new Error(`Invalid PDF file: ${errorMessage}`);
      } else if (errorMessage.includes('network')) {
        throw new Error(`Network error loading PDF: ${errorMessage}`);
      } else if (errorMessage.includes('timeout')) {
        throw new Error(`PDF loading timeout: ${errorMessage}`);
      } else {
        throw new Error(`OCR processing failed: ${errorMessage}`);
      }
    }
  }

  // Process a specific page number with retry mechanism
  private async processPageNumberWithRetry(pdf: PDFDocumentProxy, pageNumber: number, maxRetries: number = 2): Promise<OCRResult> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.processPageNumber(pdf, pageNumber);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        ocrDevWarn(`⚠️ Attempt ${attempt} failed for page ${pageNumber}:`, errorMessage);
        
        if (attempt === maxRetries) {
          console.error(`❌ All attempts failed for page ${pageNumber}`);
          // Return empty result instead of throwing to allow processing to continue
          return {
            pageNumber,
            text: '',
            confidence: 0,
            processingTime: 0,
            wordBoxes: [],
          };
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
    
    // This should never be reached, but TypeScript requires it
    return {
      pageNumber,
      text: '',
      confidence: 0,
      processingTime: 0,
      wordBoxes: [],
    };
  }

  // Process a specific page number using quadrant-based approach
  private async processPageNumber(pdf: PDFDocumentProxy, pageNumber: number): Promise<OCRResult> {
    try {
      const page = await pdf.getPage(pageNumber);
      
      // First, try full-page OCR with high resolution
      ocrDevLog(`🔍 Processing page ${pageNumber} with full-page OCR...`);
      
      const fullPageResult = await this.processFullPage(page, pageNumber);
      
      // If full page OCR quality is poor, try quadrant-based approach
      if (this.isGarbledText(fullPageResult.text) || fullPageResult.confidence < 40) {
        ocrDevLog(`⚠️ Full page OCR quality poor (confidence: ${fullPageResult.confidence}), trying quadrant approach...`);
        return await this.processPageQuadrants(page, pageNumber);
      }
      
      ocrDevLog(`✅ Page ${pageNumber} processed successfully with full-page OCR (confidence: ${fullPageResult.confidence})`);
      return fullPageResult;
    } catch (error) {
      console.error(`Error processing page ${pageNumber}:`, error);
      throw error;
    }
  }

  // Process full page with high resolution
  private async processFullPage(page: PDFPageProxy, pageNumber: number): Promise<OCRResult> {
    const scale = this.getCappedScale(page, 4.0);
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    try {
      if (context) {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        
        await page.render({
          canvas,
          canvasContext: context,
          viewport: viewport
        }).promise;
      }

      const result = await this.processPage(canvas, pageNumber, {
        rotationDeg: viewport.rotation ?? 0,
      });
      
      // Clean up canvas resources
      this.cleanupPageResources(canvas);
      
      return result;
    } catch (error) {
      // Clean up canvas resources even on error
      this.cleanupPageResources(canvas);
      throw error;
    }
  }

  // Process page in quadrants for better text detection
  private async processPageQuadrants(page: PDFPageProxy, pageNumber: number): Promise<OCRResult> {
    const scale = this.getCappedScale(page, 6.0);
    const baseViewport = page.getViewport({ scale });
    const quadrantWidth = baseViewport.width / 2;
    const quadrantHeight = baseViewport.height / 2;
    
    ocrDevLog(`📐 Processing page ${pageNumber} in 4 quadrants at ${baseViewport.width}x${baseViewport.height} resolution`);
    
    const quadrantResults: OCRResult[] = [];
    
    // Process each quadrant
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const quadrantNumber = row * 2 + col + 1;
        ocrDevLog(`🔍 Processing quadrant ${quadrantNumber} (${row}, ${col})`);
        
        try {
          const quadrantResult = await this.processQuadrant(
            page, 
            pageNumber, 
            quadrantNumber,
            baseViewport,
            col * quadrantWidth,
            row * quadrantHeight,
            quadrantWidth,
            quadrantHeight
          );
          
          if (quadrantResult.text && quadrantResult.text.trim().length > 0) {
            quadrantResults.push(quadrantResult);
            ocrDevLog(`✅ Quadrant ${quadrantNumber} extracted: "${quadrantResult.text.substring(0, 100)}..."`);
          }
        } catch (error) {
          console.error(`❌ Error processing quadrant ${quadrantNumber}:`, error);
        }
      }
    }
    
    // Combine all quadrant results
    return this.combineQuadrantResults(quadrantResults, pageNumber);
  }

  // Process a single quadrant
  private async processQuadrant(
    page: PDFPageProxy,
    pageNumber: number,
    quadrantNumber: number,
    baseViewport: PageViewport,
    offsetX: number,
    offsetY: number,
    width: number,
    height: number
  ): Promise<OCRResult> {
    // Create a high-resolution viewport for this quadrant
    const quadrantViewport = page.getViewport({ 
      scale: baseViewport.scale,
      offsetX: offsetX,
      offsetY: offsetY
    });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;

    if (context) {
      // Set high-quality rendering
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      
      // Clear canvas first
      context.clearRect(0, 0, width, height);
      
      // Render the quadrant
      await page.render({
        canvas,
        canvasContext: context,
        viewport: quadrantViewport
      }).promise;
    } else {
      throw new Error('Failed to get canvas context for quadrant rendering');
    }

    return this.processPageWithSpecializedSettings(canvas, pageNumber, quadrantNumber, {
      rotationDeg: baseViewport.rotation ?? 0,
      fullPageViewport: {
        offsetX,
        offsetY,
        width,
        height,
        fullWidth: baseViewport.width,
        fullHeight: baseViewport.height,
      },
    });
  }

  // Process canvas with specialized settings for architectural drawings
  private async processPageWithSpecializedSettings(
    canvas: HTMLCanvasElement,
    pageNumber: number,
    quadrantNumber?: number,
    context?: {
      rotationDeg?: number;
      fullPageViewport?: { offsetX: number; offsetY: number; width: number; height: number; fullWidth: number; fullHeight: number };
    }
  ): Promise<OCRResult> {
    if (!this.worker) {
      throw new Error('OCR worker not initialized');
    }

    const startTime = Date.now();

    try {
      // Convert to high-quality image
      const preprocessedCanvas = this.preprocessCanvasForOCR(canvas);
      const imageInput = await this.canvasToImageInput(preprocessedCanvas);
      
      // Set specialized parameters for architectural drawings
      await this.worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT, // Better for fragmented text in quadrants
        tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
        preserve_interword_spaces: '1',
        // Optimize for small text
        tessedit_min_char_height: '8',
        tessedit_max_char_height: '100',
        // Better handling of technical drawings
        classify_bln_numeric_mode: '1',
        textord_min_linesize: '2.5',
      });

      const { data } = await this.worker.recognize(imageInput);
      
      ocrDevLog(`📄 Quadrant ${quadrantNumber || 'full'} OCR result:`, {
        hasText: !!data.text,
        textLength: data.text?.length || 0,
        confidence: data.confidence,
        textPreview: data.text?.substring(0, 200) + '...'
      });

      return this.createOCRResult(data, pageNumber, Date.now() - startTime, {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        rotationDeg: context?.rotationDeg ?? 0,
        fullPageViewport: context?.fullPageViewport,
      });
    } catch (error) {
      console.error(`Error processing quadrant ${quadrantNumber}:`, error);
      throw error;
    }
  }

  // Combine results from multiple quadrants
  private combineQuadrantResults(quadrantResults: OCRResult[], pageNumber: number): OCRResult {
    if (quadrantResults.length === 0) {
      return {
        pageNumber,
        text: '',
        confidence: 0,
        processingTime: 0,
        wordBoxes: [],
      };
    }

    // Combine all text
    const combinedText = quadrantResults
      .map(result => result.text)
      .filter(text => text && text.trim().length > 0)
      .join('\n');

    // Calculate average confidence
    const avgConfidence = quadrantResults.reduce((sum, result) => sum + result.confidence, 0) / quadrantResults.length;

    // Calculate total processing time
    const totalProcessingTime = quadrantResults.reduce((sum, result) => sum + result.processingTime, 0);
    const mergedWordBoxes = quadrantResults.flatMap((result) => result.wordBoxes || []);

    ocrDevLog(`✅ Combined ${quadrantResults.length} quadrants:`, {
      textLength: combinedText.length,
      avgConfidence: Math.round(avgConfidence),
      textPreview: combinedText.substring(0, 300) + '...'
    });

    return {
      pageNumber,
      text: combinedText,
      confidence: avgConfidence,
      processingTime: totalProcessingTime,
      wordBoxes: mergedWordBoxes,
    };
  }

  // Build search index from OCR results
  private buildSearchIndex(result: OCRResult, searchIndex: Map<string, number[]>): void {
    const words = result.text.toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(word => word.length > 2); // Filter out short words

    words.forEach(word => {
      let pages = searchIndex.get(word);
      if (!pages) {
        pages = [];
        searchIndex.set(word, pages);
      }
      if (!pages.includes(result.pageNumber)) {
        pages.push(result.pageNumber);
      }
    });
  }

  // Search for text across all processed documents
  searchText(query: string, documentId?: string): Array<{
    documentId: string;
    pageNumber: number;
    matches: Array<{
      text: string;
      context: string;
      confidence: number;
    }>;
  }> {
    const results: Array<{
      documentId: string;
      pageNumber: number;
      matches: Array<{
        text: string;
        context: string;
        confidence: number;
      }>;
    }> = [];

    const searchQuery = query.toLowerCase().trim();
    if (searchQuery.length < 2) return results;

    ocrDevLog('🔍 Searching for:', searchQuery);
    ocrDevLog('📚 Available documents:', Array.from(this.completedOCR.keys()));
    ocrDevLog('📊 Completed OCR data:', this.completedOCR.size, 'documents');
    
    // Only show detailed OCR data if there are results
    if (this.completedOCR.size > 0) {
      ocrDevLog('📋 OCR data details:', Array.from(this.completedOCR.entries()).map(([id, data]) => ({
        documentId: id,
        totalPages: data.totalPages,
        processedPages: data.pages.length,
        hasText: data.pages.some(p => p.text && p.text.trim().length > 0)
      })));
    }

    const documentsToSearch = documentId 
      ? [documentId].filter(id => this.completedOCR.has(id))
      : Array.from(this.completedOCR.keys());

    if (documentsToSearch.length === 0) {
      ocrDevLog('❌ No documents available for search');
      return results;
    }

    documentsToSearch.forEach(docId => {
      const docData = this.completedOCR.get(docId);
      if (!docData) {
        ocrDevLog(`❌ No OCR data for document: ${docId}`);
        return;
      }

      // Only log document search start, not every page

      docData.pages.forEach(page => {
        const matches: Array<{
          text: string;
          context: string;
          confidence: number;
        }> = [];

        // Search in page text
        const text = page.text.toLowerCase();
        const queryWords = searchQuery.split(/\s+/);
        
        // Only log if there's a potential match to reduce console spam
        if (text.includes(searchQuery) || queryWords.some(word => text.includes(word))) {
          ocrDevLog(`🔍 Potential match on page ${page.pageNumber}:`, {
            query: searchQuery,
            textLength: text.length,
            hasQuery: text.includes(searchQuery)
          });
        }
        
        // Check if query is present (exact match or partial match)
        const hasExactMatch = text.includes(searchQuery);
        const hasAllWords = queryWords.every(word => text.includes(word));
        
        if (hasExactMatch || hasAllWords) {
          ocrDevLog(`✅ Found match on page ${page.pageNumber}`, { hasExactMatch, hasAllWords });
          
          // Find context around matches
          const sentences = page.text.split(/[.!?]+/);
          sentences.forEach(sentence => {
            const sentenceLower = sentence.toLowerCase();
            if (sentenceLower.includes(searchQuery)) {
              matches.push({
                text: sentence.trim(),
                context: this.getContext(sentence, searchQuery),
                confidence: page.confidence
              });
            }
          });

          // If no sentence matches, use word matches
          if (matches.length === 0) {
            queryWords.forEach(word => {
              if (text.includes(word)) {
                matches.push({
                  text: word,
                  context: this.getContext(page.text, word),
                  confidence: page.confidence
                });
              }
            });
          }
          
          // If still no matches, create a general match for the page
          if (matches.length === 0 && hasExactMatch) {
            matches.push({
              text: searchQuery,
              context: this.getContext(page.text, searchQuery),
              confidence: page.confidence
            });
          }
        }

        if (matches.length > 0) {
          results.push({
            documentId: docId,
            pageNumber: page.pageNumber,
            matches
          });
        }
      });
    });

    ocrDevLog('🎯 Final search results:', results);
    return results;
  }

  // Get context around a match
  private getContext(text: string, query: string): string {
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return text;

    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, index + query.length + 50);
    
    let context = text.substring(start, end);
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';
    
    return context;
  }

  // Get OCR data for a document
  getDocumentData(documentId: string): DocumentOCRData | null {
    return this.completedOCR.get(documentId) || null;
  }

  // Check if document is being processed
  isProcessing(documentId: string): boolean {
    return this.processingQueue.has(documentId);
  }

  // Check if document processing is complete
  isComplete(documentId: string): boolean {
    return this.completedOCR.has(documentId);
  }

  // Get processing progress
  getProgress(documentId: string): { current: number; total: number } | null {
    const docData = this.completedOCR.get(documentId);
    if (docData) {
      return { current: docData.totalPages, total: docData.totalPages };
    }
    return null;
  }

  // Emit progress events with detailed information
  private emitProgress(documentId: string, current: number, total: number, stage: string = 'Processing'): void {
    const percentage = Math.round((current / total) * 100);
    
    // Dispatch custom event for progress updates
    window.dispatchEvent(new CustomEvent('ocr-progress', {
      detail: { 
        documentId, 
        current, 
        total, 
        percentage,
        stage,
        estimatedTimeRemaining: this.calculateEstimatedTime(current, total)
      }
    }));
    
    ocrDevLog(`📊 OCR Progress: ${current}/${total} pages (${percentage}%) - ${stage}`);
  }

  // Calculate estimated time remaining based on processing speed
  private calculateEstimatedTime(current: number, total: number): number | null {
    if (current === 0) return null;
    
    // Rough estimate: 2-5 seconds per page for architectural drawings
    const avgTimePerPage = 3500; // 3.5 seconds average
    const remainingPages = total - current;
    return remainingPages * avgTimePerPage;
  }

  // Check if text appears to be garbled (optimized for construction documents)
  private isGarbledText(text: string): boolean {
    if (!text || text.length < 5) return false;
    
    // Check for patterns that indicate garbled text
    const garbledPatterns = [
      /[a-z]{1,2}\s+[a-z]{1,2}\s+[a-z]{1,2}/g, // Short random letters
      // Brackets [ ] and / as hex to avoid regex/template parse issues
      /[^a-zA-Z0-9\s.,;:!?()[\x5B\x5D]{}'"-+=\x2F\\@#$%^&*|<>~\u0060]{4,}/g, // Too many special characters
      /\s{4,}/g, // Too many consecutive spaces
      /[|]{3,}/g, // Multiple pipe characters
      /[=]{4,}/g, // Multiple equals signs
      /[#]{3,}/g, // Multiple hash signs
      /[.]{3,}/g, // Multiple dots
      /[~]{2,}/g, // Multiple tildes
    ];
    
    const matches = garbledPatterns.reduce((count, pattern) => {
      return count + (text.match(pattern) || []).length;
    }, 0);
    
    // Check for construction/architectural drawing keywords
    const constructionKeywords = [
      'elevator', 'detail', 'plan', 'section', 'floor', 'wall', 'door', 'window', 
      'dimension', 'scale', 'drawing', 'sheet', 'revision', 'date', 'project',
      'architect', 'engineer', 'contractor', 'specification', 'note', 'legend',
      'title', 'block', 'north', 'south', 'east', 'west', 'elevation', 'foundation',
      'roof', 'structural', 'electrical', 'plumbing', 'hvac', 'fire', 'safety',
      'exit', 'stair', 'ramp', 'parking', 'landscape', 'site', 'utilities'
    ];
    
    const hasConstructionContent = constructionKeywords.some(keyword => 
      text.toLowerCase().includes(keyword)
    );
    
    // Check for common construction document patterns
    const constructionPatterns = [
      /\d+['"]?\s*[x×]\s*\d+['"]?/g, // Dimensions like "10' x 12'"
      /\d+['"]?\s*[-–]\s*\d+['"]?/g, // Ranges like "10'-12'"
      /\d+\/\d+["']?\s*=\s*\d+['"]?/g, // Scales like "1/8" = 1'-0""
      /[A-Z]\d+[-]\d+/g, // Drawing numbers like "A1-1"
      /\d+['"]?\s*[x×]\s*\d+['"]?\s*[x×]\s*\d+['"]?/g, // 3D dimensions
    ];
    
    const hasConstructionPatterns = constructionPatterns.some(pattern => 
      pattern.test(text)
    );
    
    // If we have construction content or patterns, be more lenient
    if (hasConstructionContent || hasConstructionPatterns) {
      return matches > (text.length * 0.4); // 40% threshold for construction drawings
    }
    
    // Check for reasonable text density (not too sparse)
    const wordCount = text.split(/\s+/).filter(word => word.length > 1).length;
    const textDensity = wordCount / text.length;
    
    // If text is too sparse, it might be garbled
    if (textDensity < 0.05) {
      return true;
    }
    
    // If more than 25% of the text matches garbled patterns, consider it garbled
    return matches > (text.length * 0.25);
  }

  private createOCRResult(
    data: TesseractRecognizeData,
    pageNumber: number,
    processingTime: number,
    context: {
      canvasWidth: number;
      canvasHeight: number;
      rotationDeg: number;
      fullPageViewport?: { offsetX: number; offsetY: number; width: number; height: number; fullWidth: number; fullHeight: number };
    }
  ): OCRResult {
    return {
      pageNumber,
      text: data.text ?? '',
      confidence: data.confidence ?? 0,
      processingTime,
      wordBoxes: this.extractWordBoxes(data, context),
    };
  }

  // Cleanup worker and memory
  async cleanup(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.terminate();
        this.worker = null;
        this.isInitialized = false;
        ocrDevLog('🧹 OCR worker cleaned up');
      } catch (error) {
        console.error('Error cleaning up OCR worker:', error);
      }
    }
    
    // Clear processing queues and completed results to free memory
    this.processingQueue.clear();
    this.completedOCR.clear();
    
    // Force garbage collection if available
    if (typeof window !== 'undefined' && window.gc) {
      window.gc();
    }
  }

  // Memory management for large documents
  private cleanupPageResources(canvas: HTMLCanvasElement): void {
    try {
      // Clear canvas to free memory
      const context = canvas.getContext('2d');
      if (context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
      
      // Remove canvas from DOM if it was added
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    } catch (error) {
      ocrDevWarn('Error cleaning up canvas resources:', error);
    }
  }

  // Get memory usage information
  getMemoryInfo(): { processingQueue: number; completedOCR: number; workerActive: boolean } {
    return {
      processingQueue: this.processingQueue.size,
      completedOCR: this.completedOCR.size,
      workerActive: this.isInitialized && this.worker !== null
    };
  }

  // Clean up old OCR data to prevent memory issues
  private cleanupOldData(): void {
    const entries = Array.from(this.completedOCR.entries());
    if (entries.length > 5) {
      // Keep only the 5 most recent documents
      const sortedEntries = entries.sort((a, b) => 
        new Date(b[1].processedAt).getTime() - new Date(a[1].processedAt).getTime()
      );
      
      // Remove older entries
      const toKeep = sortedEntries.slice(0, 5);
      this.completedOCR.clear();
      toKeep.forEach(([id, data]) => {
        this.completedOCR.set(id, data);
      });
      
      ocrDevLog(`🧹 Cleaned up OCR data, kept ${toKeep.length} most recent documents`);
    }
  }

  // Public method to initialize the OCR service
  async initialize(): Promise<void> {
    await this.initializeWorker();
  }

  // Public method to process a canvas directly (for titleblock extraction)
  async processCanvas(canvas: HTMLCanvasElement, pageNumber: number = 1): Promise<OCRResult> {
    await this.initializeWorker();
    return await this.processPage(canvas, pageNumber, { rotationDeg: 0 });
  }
}

// Export singleton instance (client-side Tesseract OCR)
export const clientOcrService = new OCRService();
