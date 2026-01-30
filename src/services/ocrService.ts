import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

/** Tesseract logger message (progress updates) */
interface TesseractLoggerMessage {
  status?: string;
  progress?: number;
  [key: string]: unknown;
}

/** Tesseract recognize result word shape (compatible with Tesseract Page.words) */
interface TesseractWord {
  text?: string;
  bbox?: { x0?: number; y0?: number; x1?: number; y1?: number };
  confidence?: number;
}

/** Tesseract recognize result data shape (compatible with Tesseract Page) */
interface TesseractRecognizeData {
  text?: string;
  confidence?: number;
  words?: TesseractWord[];
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
  words: Array<{
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    confidence: number;
  }>;
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

  // Initialize Tesseract worker (lazy initialization)
  private async initializeWorker(): Promise<void> {
    if (this.isInitialized && this.worker) return;

    try {
      // Try to create worker with local files first, fallback to CDN
      const workerConfig: TesseractWorkerConfigWithPaths = {
        logger: (m: TesseractLoggerMessage) => {
          // Reduce OCR logging to prevent console spam - only log major milestones
          if (m.status === 'recognizing text' && (m.progress === 0.25 || m.progress === 0.5 || m.progress === 0.75 || m.progress === 1.0)) {
            console.log(`OCR Progress: ${Math.round((m.progress ?? 0) * 100)}%`);
          }
        },
        // Try local files first
        workerPath: '/tesseract/',
        langPath: '/tesseract/lang-data/',
        corePath: '/tesseract/',
        // Optimize for architectural drawings and technical text
        // @ts-ignore - tessedit_char_whitelist is a valid Tesseract option
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?()[]{}\'"-+=/\\@#$%^&*|<>~` ',
        tessedit_pageseg_mode: Tesseract.PSM.AUTO_OSD, // Better for mixed text/graphics
        preserve_interword_spaces: '1',
        tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY, // Use LSTM for better accuracy
        tessedit_create_hocr: '0', // Disable HOCR output
        tessedit_create_tsv: '0', // Disable TSV output
        tessedit_create_pdf: '0', // Disable PDF output
      };

      try {
        this.worker = await Tesseract.createWorker('eng', 1, workerConfig);
        console.log('✅ Tesseract OCR worker initialized with local files');
      } catch (localError) {
        console.warn('⚠️ Local Tesseract files not found, trying CDN fallback:', localError);
        // Fallback to CDN: omit path overrides so Tesseract uses CDN
        const { workerPath: _w, langPath: _l, corePath: _c, ...cdnConfig } = workerConfig;
        this.worker = await Tesseract.createWorker('eng', 1, cdnConfig as Parameters<typeof Tesseract.createWorker>[2]);
        console.log('✅ Tesseract OCR worker initialized with CDN fallback');
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
    pageNumber: number
  ): Promise<OCRResult> {
    if (!this.worker) {
      throw new Error('OCR worker not initialized');
    }

    const startTime = Date.now();
    console.log(`🔍 Processing page ${pageNumber} with Tesseract...`);

    try {
      // Validate canvas before processing
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        throw new Error('Invalid canvas: width or height is 0');
      }
      
      // Convert canvas to high-quality image data
      const imageData = canvas.toDataURL('image/png', 1.0);
      
      // Validate image data
      if (!imageData || imageData.length < 100) {
        throw new Error('Invalid image data generated from canvas');
      }
      
      // Set optimized parameters for architectural drawings
      await this.worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.AUTO_OSD, // Auto orientation and script detection
        tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY, // Use LSTM for better accuracy
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?()[]{}\'"-+=/\\@#$%^&*|<>~` ',
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
      const { data } = await this.worker.recognize(imageData);
      
      const processingTime = Date.now() - startTime;
      
      console.log(`✅ Page ${pageNumber} OCR completed:`, {
        textLength: data.text?.length || 0,
        confidence: data.confidence,
        processingTime: `${processingTime}ms`,
        textPreview: data.text?.substring(0, 100) + '...'
      });

      return this.createOCRResult(data, pageNumber, processingTime);
      
    } catch (error) {
      console.error(`❌ OCR failed for page ${pageNumber}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`OCR processing failed for page ${pageNumber}: ${errorMessage}`);
    }
  }

  // Process entire PDF document
  async processDocument(documentId: string, pdfUrl: string): Promise<DocumentOCRData> {
    // Check if already processing
    if (this.processingQueue.has(documentId)) {
      return this.processingQueue.get(documentId)!;
    }

    // Check if already completed
    if (this.completedOCR.has(documentId)) {
      return this.completedOCR.get(documentId)!;
    }

    // Check memory usage before starting
    const memoryInfo = this.getMemoryInfo();
    if (memoryInfo.completedOCR > 10) {
      console.warn('⚠️ High memory usage detected, cleaning up old OCR data');
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
    console.log(`🔍 Starting OCR processing for document: ${documentId}`);
    console.log(`📄 PDF URL: ${pdfUrl}`);
    
    await this.initializeWorker();

    try {
      // Load PDF document with comprehensive error handling
      console.log(`📥 Loading PDF from: ${pdfUrl}`);
      
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
      console.log(`📄 PDF loaded successfully: ${totalPages} pages`);

      if (totalPages === 0) {
        throw new Error('PDF contains no pages');
      }

      const pages: OCRResult[] = [];
      const searchIndex = new Map<string, number[]>();

      // Process pages in smaller batches for better memory management
      const batchSize = Math.min(2, totalPages); // Process max 2 pages at a time
      console.log(`🔄 Processing in batches of ${batchSize} pages...`);
      
      for (let i = 0; i < totalPages; i += batchSize) {
        const batchPromises = [];
        const batchStart = i + 1;
        const batchEnd = Math.min(i + batchSize, totalPages);
        
        console.log(`📄 Processing batch: pages ${batchStart}-${batchEnd}`);
        
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
              console.warn(`⚠️ Page ${result?.pageNumber || 'unknown'} produced no text`);
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

      console.log(`✅ OCR processing completed for document: ${documentId}`, {
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
        console.warn(`⚠️ Attempt ${attempt} failed for page ${pageNumber}:`, errorMessage);
        
        if (attempt === maxRetries) {
          console.error(`❌ All attempts failed for page ${pageNumber}`);
          // Return empty result instead of throwing to allow processing to continue
          return {
            pageNumber,
            text: '',
            confidence: 0,
            processingTime: 0,
            words: []
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
      words: []
    };
  }

  // Process a specific page number using quadrant-based approach
  private async processPageNumber(pdf: PDFDocumentProxy, pageNumber: number): Promise<OCRResult> {
    try {
      const page = await pdf.getPage(pageNumber);
      
      // First, try full-page OCR with high resolution
      console.log(`🔍 Processing page ${pageNumber} with full-page OCR...`);
      
      const fullPageResult = await this.processFullPage(page, pageNumber);
      
      // If full page OCR quality is poor, try quadrant-based approach
      if (this.isGarbledText(fullPageResult.text) || fullPageResult.confidence < 40) {
        console.log(`⚠️ Full page OCR quality poor (confidence: ${fullPageResult.confidence}), trying quadrant approach...`);
        return await this.processPageQuadrants(page, pageNumber);
      }
      
      console.log(`✅ Page ${pageNumber} processed successfully with full-page OCR (confidence: ${fullPageResult.confidence})`);
      return fullPageResult;
    } catch (error) {
      console.error(`Error processing page ${pageNumber}:`, error);
      throw error;
    }
  }

  // Process full page with high resolution
  private async processFullPage(page: PDFPageProxy, pageNumber: number): Promise<OCRResult> {
    const viewport = page.getViewport({ scale: 4.0 }); // Very high resolution
    
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

      const result = await this.processPage(canvas, pageNumber);
      
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
    const baseViewport = page.getViewport({ scale: 6.0 }); // Even higher resolution for quadrants
    const quadrantWidth = baseViewport.width / 2;
    const quadrantHeight = baseViewport.height / 2;
    
    console.log(`📐 Processing page ${pageNumber} in 4 quadrants at ${baseViewport.width}x${baseViewport.height} resolution`);
    
    const quadrantResults: OCRResult[] = [];
    
    // Process each quadrant
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const quadrantNumber = row * 2 + col + 1;
        console.log(`🔍 Processing quadrant ${quadrantNumber} (${row}, ${col})`);
        
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
            console.log(`✅ Quadrant ${quadrantNumber} extracted: "${quadrantResult.text.substring(0, 100)}..."`);
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
      scale: 6.0,
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

    // Process with specialized settings for small text
    return this.processPageWithSpecializedSettings(canvas, pageNumber, quadrantNumber);
  }

  // Process canvas with specialized settings for architectural drawings
  private async processPageWithSpecializedSettings(canvas: HTMLCanvasElement, pageNumber: number, quadrantNumber?: number): Promise<OCRResult> {
    if (!this.worker) {
      throw new Error('OCR worker not initialized');
    }

    const startTime = Date.now();

    try {
      // Convert to high-quality image
      const imageData = canvas.toDataURL('image/png', 1.0);
      
      // Set specialized parameters for architectural drawings
      await this.worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK, // Treat as single text block
        tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?()[]{}\'"-+=/\\@#$%^&*|<>~` ',
        preserve_interword_spaces: '1',
        // Optimize for small text
        tessedit_min_char_height: '8',
        tessedit_max_char_height: '100',
        // Better handling of technical drawings
        classify_bln_numeric_mode: '1',
        textord_min_linesize: '2.5',
      });

      const { data } = await this.worker.recognize(imageData);
      
      console.log(`📄 Quadrant ${quadrantNumber || 'full'} OCR result:`, {
        hasText: !!data.text,
        textLength: data.text?.length || 0,
        confidence: data.confidence,
        textPreview: data.text?.substring(0, 200) + '...'
      });

      return this.createOCRResult(data, pageNumber, Date.now() - startTime);
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
        words: []
      };
    }

    // Combine all text
    const combinedText = quadrantResults
      .map(result => result.text)
      .filter(text => text && text.trim().length > 0)
      .join('\n');

    // Calculate average confidence
    const avgConfidence = quadrantResults.reduce((sum, result) => sum + result.confidence, 0) / quadrantResults.length;

    // Combine all words
    const combinedWords = quadrantResults.flatMap(result => result.words);

    // Calculate total processing time
    const totalProcessingTime = quadrantResults.reduce((sum, result) => sum + result.processingTime, 0);

    console.log(`✅ Combined ${quadrantResults.length} quadrants:`, {
      textLength: combinedText.length,
      avgConfidence: Math.round(avgConfidence),
      wordCount: combinedWords.length,
      textPreview: combinedText.substring(0, 300) + '...'
    });

    return {
      pageNumber,
      text: combinedText,
      confidence: avgConfidence,
      processingTime: totalProcessingTime,
      words: combinedWords
    };
  }

  // Build search index from OCR results
  private buildSearchIndex(result: OCRResult, searchIndex: Map<string, number[]>): void {
    const words = result.text.toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(word => word.length > 2); // Filter out short words

    words.forEach(word => {
      if (!searchIndex.has(word)) {
        searchIndex.set(word, []);
      }
      const pages = searchIndex.get(word)!;
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

    console.log('🔍 Searching for:', searchQuery);
    console.log('📚 Available documents:', Array.from(this.completedOCR.keys()));
    console.log('📊 Completed OCR data:', this.completedOCR.size, 'documents');
    
    // Only show detailed OCR data if there are results
    if (this.completedOCR.size > 0) {
      console.log('📋 OCR data details:', Array.from(this.completedOCR.entries()).map(([id, data]) => ({
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
      console.log('❌ No documents available for search');
      return results;
    }

    documentsToSearch.forEach(docId => {
      const docData = this.completedOCR.get(docId);
      if (!docData) {
        console.log(`❌ No OCR data for document: ${docId}`);
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
          console.log(`🔍 Potential match on page ${page.pageNumber}:`, {
            query: searchQuery,
            textLength: text.length,
            hasQuery: text.includes(searchQuery)
          });
        }
        
        // Check if query is present (exact match or partial match)
        const hasExactMatch = text.includes(searchQuery);
        const hasAllWords = queryWords.every(word => text.includes(word));
        
        if (hasExactMatch || hasAllWords) {
          console.log(`✅ Found match on page ${page.pageNumber}`, { hasExactMatch, hasAllWords });
          
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

    console.log('🎯 Final search results:', results);
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
    
    console.log(`📊 OCR Progress: ${current}/${total} pages (${percentage}%) - ${stage}`);
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
      /[^a-zA-Z0-9\s.,;:!?()\[\]{}'"-+=/\\@#$%^&*|<>~`]{4,}/g, // Too many special characters
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

  // Create OCR result from data
  private createOCRResult(data: TesseractRecognizeData, pageNumber: number, processingTime: number): OCRResult {
    const words = (data.words || []).map((word: TesseractWord) => ({
      text: word.text ?? '',
      bbox: word.bbox ? { x0: word.bbox.x0 ?? 0, y0: word.bbox.y0 ?? 0, x1: word.bbox.x1 ?? 0, y1: word.bbox.y1 ?? 0 } : { x0: 0, y0: 0, x1: 0, y1: 0 },
      confidence: word.confidence ?? 0
    }));

    return {
      pageNumber,
      text: data.text ?? '',
      confidence: data.confidence ?? 0,
      processingTime,
      words
    };
  }

  // Cleanup worker and memory
  async cleanup(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.terminate();
        this.worker = null;
        this.isInitialized = false;
        console.log('🧹 OCR worker cleaned up');
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
      console.warn('Error cleaning up canvas resources:', error);
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
      
      console.log(`🧹 Cleaned up OCR data, kept ${toKeep.length} most recent documents`);
    }
  }

  // Public method to initialize the OCR service
  async initialize(): Promise<void> {
    await this.initializeWorker();
  }

  // Public method to process a canvas directly (for titleblock extraction)
  async processCanvas(canvas: HTMLCanvasElement, pageNumber: number = 1): Promise<OCRResult> {
    await this.initializeWorker();
    return await this.processPage(canvas, pageNumber);
  }
}

// Export singleton instance
export const ocrService = new OCRService();
