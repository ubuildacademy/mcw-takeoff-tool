import { ocrService } from './apiService';

export interface OCRResult {
  pageNumber: number;
  text: string;
  confidence: number;
  processingTime: number;
  method: 'direct_extraction' | 'trocr' | 'tesseract';
  wordPositions?: Array<{
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    confidence: number;
  }>;
}

export interface DocumentOCRData {
  documentId: string;
  projectId: string;
  totalPages: number;
  results: OCRResult[];
  processedAt: string;
}

export interface SearchResult {
  documentId: string;
  pageNumber: number;
  matches: Array<{
    text: string;
    context: string;
    confidence: number;
  }>;
}

class ServerOCRService {
  private processingJobs = new Map<string, Promise<DocumentOCRData>>();
  private completedOCR = new Map<string, DocumentOCRData>();

  // Process a document with server-side OCR
  async processDocument(documentId: string, projectId: string): Promise<DocumentOCRData> {
    // Check if already processing
    if (this.processingJobs.has(documentId)) {
      return this.processingJobs.get(documentId)!;
    }

    // Check if already completed
    if (this.completedOCR.has(documentId)) {
      return this.completedOCR.get(documentId)!;
    }

    const processingPromise = this._processDocument(documentId, projectId);
    this.processingJobs.set(documentId, processingPromise);

    try {
      const result = await processingPromise;
      this.completedOCR.set(documentId, result);
      return result;
    } catch (error) {
      console.error(`❌ Server OCR processing failed for document ${documentId}:`, error);
      throw error;
    } finally {
      this.processingJobs.delete(documentId);
    }
  }

  private async _processDocument(documentId: string, projectId: string): Promise<DocumentOCRData> {
    // Starting server-side OCR processing
    
    try {
      // Start OCR processing on server
      const startResponse = await ocrService.processDocument(documentId, projectId);
      
      if (startResponse.alreadyProcessed) {
        // Document already processed, fetching results
        // Document already processed, fetch results
        const resultsResponse = await ocrService.getDocumentResults(documentId, projectId);
        return resultsResponse;
      }

      const jobId = startResponse.jobId;
      if (!jobId) {
        throw new Error('No job ID returned from server');
      }

      console.log(`📋 OCR job started with ID: ${jobId}`);

      // Poll for completion
      return await this.pollForCompletion(jobId, documentId, projectId);

    } catch (error) {
      console.error(`❌ Server OCR processing failed for document ${documentId}:`, error);
      throw error;
    }
  }

  private async pollForCompletion(jobId: string, documentId: string, projectId: string): Promise<DocumentOCRData> {
    const maxAttempts = 600; // 10 minutes max (1 second intervals for better progress updates)
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const statusResponse = await ocrService.getJobStatus(jobId);
        
        // OCR progress update
        
        if (statusResponse.status === 'completed') {
          // Check if server found no embedded text (image-based PDF)
          if (statusResponse.error === 'No searchable text found in PDF') {
            console.log('📸 Server found no embedded text, triggering client-side image-based OCR fallback...');
            
            // Fetch results to check if we got any
            const resultsResponse = await ocrService.getDocumentResults(documentId, projectId);
            
            // If no results, trigger client-side OCR
            if (!resultsResponse.results || resultsResponse.results.length === 0) {
              return await this.triggerClientSideOCR(documentId, projectId, jobId);
            }
            
            // If we got some results, return them
            return resultsResponse;
          }
          
          // OCR processing completed with results
          const resultsResponse = await ocrService.getDocumentResults(documentId, projectId);
          return resultsResponse;
        }
        
        if (statusResponse.status === 'failed') {
          throw new Error(`OCR processing failed: ${statusResponse.error || 'Unknown error'}`);
        }
        
        // Still processing, wait and try again
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second for more frequent updates
        attempts++;
        
      } catch (error) {
        console.error(`❌ Error polling OCR status:`, error);
        attempts++;
        
        if (attempts >= maxAttempts) {
          throw new Error('OCR processing timeout');
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    throw new Error('OCR processing timeout');
  }

  /**
   * Trigger client-side image-based OCR when server finds no embedded text
   */
  private async triggerClientSideOCR(documentId: string, projectId: string, jobId: string): Promise<DocumentOCRData> {
    try {
      console.log('🖼️ Starting client-side image-based OCR for document:', documentId);
      
      // Get PDF URL from Supabase
      const { supabaseService } = await import('./supabaseService');
      const pdfUrl = await supabaseService.getPDFUrl(documentId);
      
      if (!pdfUrl) {
        throw new Error('Failed to get PDF URL for client-side OCR');
      }
      
      console.log('📄 PDF URL obtained, starting Tesseract.js OCR...');
      
      // Use existing client-side OCR service
      const { ocrService: clientOcrService } = await import('./ocrService');
      const ocrResult = await clientOcrService.processDocument(documentId, pdfUrl);
      
      console.log(`✅ Client-side OCR completed: ${ocrResult.pages.length} pages processed`);
      
      // Convert client OCR results to server format
      const serverResults = ocrResult.pages.map(page => ({
        pageNumber: page.pageNumber,
        text: page.text,
        confidence: page.confidence,
        processingTime: page.processingTime,
        method: 'tesseract' as const
      }));
      
      // Send results back to server
      await ocrService.submitClientResults(documentId, projectId, serverResults, jobId);
      
      console.log('✅ Client-side OCR results submitted to server');
      
      // Return formatted results matching DocumentOCRData interface
      return {
        documentId,
        projectId,
        totalPages: ocrResult.totalPages,
        results: ocrResult.pages.map(page => ({
          pageNumber: page.pageNumber,
          text: page.text,
          confidence: page.confidence,
          processingTime: page.processingTime,
          method: 'tesseract' as const,
          wordPositions: page.words?.map(word => ({
            text: word.text,
            bbox: word.bbox,
            confidence: word.confidence
          }))
        })),
        processedAt: ocrResult.processedAt
      };
      
    } catch (error) {
      console.error('❌ Client-side OCR fallback failed:', error);
      throw new Error(`Client-side OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Search for text across all processed documents
  async searchText(query: string, projectId: string, documentId?: string): Promise<SearchResult[]> {
    const searchQuery = query.toLowerCase().trim();
    if (searchQuery.length < 2) return [];

    // Searching OCR data

    try {
      if (documentId) {
        // Search specific document
        const searchResponse = await ocrService.searchDocument(documentId, query, projectId);
        return this.formatSearchResults(searchResponse, documentId);
      } else {
        // Search all documents (would need to implement this on server)
        console.warn('⚠️ Searching all documents not yet implemented');
        return [];
      }
    } catch (error) {
      console.error('❌ OCR search error:', error);
      return [];
    }
  }

  private formatSearchResults(searchResponse: any, documentId: string): SearchResult[] {
    if (!searchResponse.results || searchResponse.results.length === 0) {
      return [];
    }

    // CRITICAL FIX: Filter out null/undefined results before accessing pageNumber
    return searchResponse.results
      .filter((result: any) => result != null && result.pageNumber != null)
      .map((result: any) => ({
        documentId,
        pageNumber: result.pageNumber,
        matches: (result.matches || []).filter((match: any) => match != null).map((match: any) => ({
          text: match.snippet,
          context: match.snippet, // Using snippet as context for now
          confidence: match.confidence
        }))
      }));
  }

  // Get OCR data for a document
  async getDocumentData(documentId: string, projectId: string): Promise<DocumentOCRData | null> {
    try {
      // Getting OCR data for document
      const resultsResponse = await ocrService.getDocumentResults(documentId, projectId);
      
      // CRITICAL FIX: Ensure resultsResponse is valid and has a results array
      if (!resultsResponse || typeof resultsResponse !== 'object') {
        console.warn(`⚠️ OCR data response is invalid for document ${documentId}:`, resultsResponse);
        return null;
      }
      
      // CRITICAL FIX: Safely handle results array - filter out null/undefined before mapping
      // This prevents "Cannot read properties of undefined (reading 'pageNumber')" errors
      // Handle case where results might be null, undefined, or not an array
      let safeResults: any[] = [];
      try {
        if (Array.isArray(resultsResponse.results)) {
          safeResults = resultsResponse.results.filter((r: any) => {
            // Comprehensive check: ensure r is an object and has pageNumber
            return r != null && typeof r === 'object' && r.pageNumber != null;
          });
        } else if (resultsResponse.results != null) {
          console.warn(`⚠️ OCR results is not an array for document ${documentId}:`, typeof resultsResponse.results);
        }
      } catch (error) {
        console.error(`❌ Error processing OCR results array for document ${documentId}:`, error);
        safeResults = [];
      }
      
      // Safely build sampleResults with comprehensive error handling
      let sampleResults: any[] = [];
      try {
        sampleResults = safeResults
          .slice(0, 3)
          .map((r: any) => {
            // Double-check pageNumber exists before accessing
            if (r && typeof r === 'object' && r.pageNumber != null) {
              return {
                pageNumber: r.pageNumber,
                textLength: r.text?.length || 0,
                textPreview: r.text?.substring(0, 100) + '...'
              };
            }
            return null;
          })
          .filter((item: any) => item != null);
      } catch (error) {
        console.error(`❌ Error building sample results for document ${documentId}:`, error);
        sampleResults = [];
      }
      
      // OCR data retrieved
      
      // Ensure we return a valid structure with a safe results array
      // Don't spread resultsResponse to avoid any potential issues with its structure
      return {
        documentId: resultsResponse.documentId || documentId,
        projectId: resultsResponse.projectId || projectId,
        totalPages: resultsResponse.totalPages || safeResults.length || 0,
        results: safeResults,
        processedAt: resultsResponse.processedAt || new Date().toISOString()
      };
    } catch (error) {
      console.error(`❌ Failed to get OCR data for document ${documentId}:`, error);
      return null;
    }
  }

  // Check if document is being processed
  isProcessing(documentId: string): boolean {
    return this.processingJobs.has(documentId);
  }

  // Check if document processing is complete
  isComplete(documentId: string): boolean {
    return this.completedOCR.has(documentId);
  }

  // Get processing progress (not available for server-side processing)
  getProgress(documentId: string): { current: number; total: number } | null {
    // Server-side processing progress is not easily accessible from client
    return null;
  }

  // Cleanup (clear local cache)
  async cleanup(): Promise<void> {
    this.processingJobs.clear();
    this.completedOCR.clear();
    console.log('🧹 Server OCR service cleaned up');
  }
}

// Export singleton instance
export const serverOcrService = new ServerOCRService();
