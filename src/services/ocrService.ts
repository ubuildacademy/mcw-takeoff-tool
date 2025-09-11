import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

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
      this.worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        },
        // Optimize for architectural drawings and technical text
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?()[]{}\'"-+=/\\@#$%^&*|<>~` ',
        tessedit_pageseg_mode: Tesseract.PSM.AUTO_OSD, // Better for mixed text/graphics
        preserve_interword_spaces: '1',
        tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY, // Use LSTM for better accuracy
        tessedit_create_hocr: '0', // Disable HOCR output
        tessedit_create_tsv: '0', // Disable TSV output
        tessedit_create_pdf: '0', // Disable PDF output
      });

      this.isInitialized = true;
      console.log('✅ Tesseract OCR worker initialized');
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
    return this.processPageWithSpecializedSettings(canvas, pageNumber);
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
      // Load PDF document with error handling
      console.log(`📥 Loading PDF from: ${pdfUrl}`);
      const pdf = await pdfjsLib.getDocument({
        url: pdfUrl,
        httpHeaders: {
          'Accept': 'application/pdf'
        }
      }).promise;
      const totalPages = pdf.numPages;
      
      console.log(`📄 Processing ${totalPages} pages...`);

      const pages: OCRResult[] = [];
      const searchIndex = new Map<string, number[]>();

      // Process pages in batches to avoid overwhelming the system
      const batchSize = 3; // Process 3 pages at a time
      
      for (let i = 0; i < totalPages; i += batchSize) {
        const batchPromises = [];
        
        for (let j = i; j < Math.min(i + batchSize, totalPages); j++) {
          const pageNumber = j + 1;
          batchPromises.push(this.processPageNumber(pdf, pageNumber));
        }

        const batchResults = await Promise.all(batchPromises);
        
        for (const result of batchResults) {
          pages.push(result);
          
          // Build search index
          this.buildSearchIndex(result, searchIndex);
          
          // Emit progress event
          this.emitProgress(documentId, pages.length, totalPages);
        }

        // Small delay between batches to prevent system overload
        if (i + batchSize < totalPages) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      const documentData: DocumentOCRData = {
        documentId,
        totalPages,
        pages,
        processedAt: new Date().toISOString(),
        searchIndex
      };

      console.log(`✅ OCR processing completed for document: ${documentId}`);
      return documentData;

    } catch (error) {
      console.error(`❌ OCR processing failed for document ${documentId}:`, error);
      throw error;
    }
  }

  // Process a specific page number using quadrant-based approach
  private async processPageNumber(pdf: any, pageNumber: number): Promise<OCRResult> {
    try {
      const page = await pdf.getPage(pageNumber);
      
      // First, try full-page OCR with high resolution
      console.log(`🔍 Processing page ${pageNumber} with quadrant-based OCR...`);
      
      const fullPageResult = await this.processFullPage(page, pageNumber);
      
      // If full page OCR quality is poor, try quadrant-based approach
      if (this.isGarbledText(fullPageResult.text) || fullPageResult.confidence < 50) {
        console.log(`⚠️ Full page OCR quality poor, trying quadrant approach...`);
        return await this.processPageQuadrants(page, pageNumber);
      }
      
      return fullPageResult;
    } catch (error) {
      console.error(`Error processing page ${pageNumber}:`, error);
      throw error;
    }
  }

  // Process full page with high resolution
  private async processFullPage(page: any, pageNumber: number): Promise<OCRResult> {
    const viewport = page.getViewport({ scale: 4.0 }); // Very high resolution
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    if (context) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
    }

    return this.processPage(canvas, pageNumber);
  }

  // Process page in quadrants for better text detection
  private async processPageQuadrants(page: any, pageNumber: number): Promise<OCRResult> {
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
    page: any, 
    pageNumber: number, 
    quadrantNumber: number,
    baseViewport: any,
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
      
      // Render the quadrant
      await page.render({
        canvasContext: context,
        viewport: quadrantViewport
      }).promise;
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

    const documentsToSearch = documentId 
      ? [documentId].filter(id => this.completedOCR.has(id))
      : Array.from(this.completedOCR.keys());

    documentsToSearch.forEach(docId => {
      const docData = this.completedOCR.get(docId);
      if (!docData) {
        console.log(`❌ No OCR data for document: ${docId}`);
        return;
      }

      console.log(`📄 Searching document ${docId} with ${docData.pages.length} pages`);

      docData.pages.forEach(page => {
        const matches: Array<{
          text: string;
          context: string;
          confidence: number;
        }> = [];

        // Search in page text
        const text = page.text.toLowerCase();
        const queryWords = searchQuery.split(/\s+/);
        
        console.log(`🔍 Searching page ${page.pageNumber}:`, {
          query: searchQuery,
          queryWords,
          textLength: text.length,
          textPreview: text.substring(0, 200) + '...',
          hasQuery: text.includes(searchQuery)
        });
        
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

    console.log('🎯 Search results:', results);
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

  // Emit progress events
  private emitProgress(documentId: string, current: number, total: number): void {
    // Dispatch custom event for progress updates
    window.dispatchEvent(new CustomEvent('ocr-progress', {
      detail: { documentId, current, total }
    }));
  }

  // Check if text appears to be garbled
  private isGarbledText(text: string): boolean {
    if (!text || text.length < 10) return false;
    
    // Check for patterns that indicate garbled text
    const garbledPatterns = [
      /[a-z]{1,2}\s+[a-z]{1,2}\s+[a-z]{1,2}/g, // Short random letters
      /[^a-zA-Z0-9\s.,;:!?()]{3,}/g, // Too many special characters
      /\s{3,}/g, // Too many spaces
      /[|]{2,}/g, // Multiple pipe characters
      /[=]{3,}/g, // Multiple equals signs
      /[#]{2,}/g, // Multiple hash signs
    ];
    
    const matches = garbledPatterns.reduce((count, pattern) => {
      return count + (text.match(pattern) || []).length;
    }, 0);
    
    // Check for architectural drawing keywords that should be present
    const architecturalKeywords = ['elevator', 'detail', 'plan', 'section', 'floor', 'wall', 'door', 'window', 'dimension'];
    const hasArchitecturalContent = architecturalKeywords.some(keyword => 
      text.toLowerCase().includes(keyword)
    );
    
    // If we have architectural content, be more lenient
    if (hasArchitecturalContent) {
      return matches > (text.length * 0.3); // 30% threshold for architectural drawings
    }
    
    // If more than 20% of the text matches garbled patterns, consider it garbled
    return matches > (text.length * 0.2);
  }

  // Create OCR result from data
  private createOCRResult(data: any, pageNumber: number, processingTime: number): OCRResult {
    const words = (data.words || []).map(word => ({
      text: word.text || '',
      bbox: word.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
      confidence: word.confidence || 0
    }));

    return {
      pageNumber,
      text: data.text || '',
      confidence: data.confidence || 0,
      processingTime,
      words
    };
  }

  // Cleanup worker
  async cleanup(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      console.log('🧹 OCR worker cleaned up');
    }
  }
}

// Export singleton instance
export const ocrService = new OCRService();
