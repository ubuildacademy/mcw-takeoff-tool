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
    console.log(`🔍 Starting server-side OCR processing for document: ${documentId}`);
    
    try {
      // Start OCR processing on server
      const startResponse = await ocrService.processDocument(documentId, projectId);
      
      if (startResponse.alreadyProcessed) {
        console.log(`✅ Document ${documentId} already processed, fetching results...`);
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
    const maxAttempts = 120; // 10 minutes max (5 second intervals)
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const statusResponse = await ocrService.getJobStatus(jobId);
        
        console.log(`📊 OCR Progress: ${statusResponse.progress}% (${statusResponse.processedPages}/${statusResponse.totalPages} pages)`);
        
        if (statusResponse.status === 'completed') {
          console.log(`✅ OCR processing completed for document: ${documentId}`);
          
          // Fetch the results
          const resultsResponse = await ocrService.getDocumentResults(documentId, projectId);
          return resultsResponse;
        }
        
        if (statusResponse.status === 'failed') {
          throw new Error(`OCR processing failed: ${statusResponse.error || 'Unknown error'}`);
        }
        
        // Still processing, wait and try again
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        attempts++;
        
      } catch (error) {
        console.error(`❌ Error polling OCR status:`, error);
        attempts++;
        
        if (attempts >= maxAttempts) {
          throw new Error('OCR processing timeout');
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    throw new Error('OCR processing timeout');
  }

  // Search for text across all processed documents
  async searchText(query: string, projectId: string, documentId?: string): Promise<SearchResult[]> {
    const searchQuery = query.toLowerCase().trim();
    if (searchQuery.length < 2) return [];

    console.log('🔍 Searching for:', searchQuery);

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

    return searchResponse.results.map((result: any) => ({
      documentId,
      pageNumber: result.pageNumber,
      matches: result.matches.map((match: any) => ({
        text: match.snippet,
        context: match.snippet, // Using snippet as context for now
        confidence: match.confidence
      }))
    }));
  }

  // Get OCR data for a document
  async getDocumentData(documentId: string, projectId: string): Promise<DocumentOCRData | null> {
    try {
      const resultsResponse = await ocrService.getDocumentResults(documentId, projectId);
      return resultsResponse;
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
