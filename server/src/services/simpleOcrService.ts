import pdfParse from 'pdf-parse';
import fs from 'fs-extra';
import { supabase } from '../supabase';

export interface SimpleOCRResult {
  pageNumber: number;
  text: string;
  confidence: number;
  processingTime: number;
  method: 'direct_extraction';
}

export interface SimpleDocumentOCRData {
  documentId: string;
  projectId: string;
  totalPages: number;
  results: SimpleOCRResult[];
  processedAt: string;
}

class SimpleOCRService {
  // Extract text directly from PDF using pdf-parse (perfect for vector PDFs)
  async extractTextFromPDF(pdfPath: string): Promise<SimpleOCRResult[]> {
    try {
      console.log('📄 Extracting text from vector PDF using pdf-parse...');
      
      const startTime = Date.now();
      const dataBuffer = await fs.readFile(pdfPath);
      
      // Parse PDF with page-by-page extraction
      const data = await pdfParse(dataBuffer, {
        // Enable page-by-page extraction
        max: 0, // Process all pages
        version: 'v1.10.100' // Use specific version for stability
      });
      
      const processingTime = Date.now() - startTime;
      
      console.log(`📄 PDF parsed: ${data.numpages} pages, ${data.text.length} characters`);
      
      if (!data.text || data.text.trim().length === 0) {
        console.log('⚠️ No text found in PDF');
        return [];
      }
      
      // Try to extract text per page if available
      const totalPages = data.numpages;
      const results: SimpleOCRResult[] = [];
      
      // Check if we have page-specific data
      if (data.pages && Array.isArray(data.pages) && data.pages.length > 0) {
        console.log(`📄 Found ${data.pages.length} page-specific text blocks`);
        
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          // Find text for this specific page
          const pageText = data.pages.find((page: any) => page.page === pageNum)?.text || '';
          
          const result: SimpleOCRResult = {
            pageNumber: pageNum,
            text: pageText.trim(),
            confidence: 100,
            processingTime: Math.round(processingTime / totalPages),
            method: 'direct_extraction'
          };
          results.push(result);
        }
      } else {
        // Fallback: Split text evenly across pages (better than duplicating full text)
        console.log('⚠️ No page-specific data available, splitting text evenly across pages');
        
        const textLength = data.text.length;
        const charsPerPage = Math.ceil(textLength / totalPages);
        
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          const startIndex = (pageNum - 1) * charsPerPage;
          const endIndex = Math.min(startIndex + charsPerPage, textLength);
          const pageText = data.text.substring(startIndex, endIndex);
          
          const result: SimpleOCRResult = {
            pageNumber: pageNum,
            text: pageText.trim(),
            confidence: 100,
            processingTime: Math.round(processingTime / totalPages),
            method: 'direct_extraction'
          };
          results.push(result);
        }
      }
      
      console.log(`✅ Text extraction successful: ${results.length} pages processed`);
      return results;
      
    } catch (error) {
      console.error('❌ PDF text extraction failed:', error);
      throw error;
    }
  }

  // Extract text from PDF with detailed progress updates
  async extractTextFromPDFWithProgress(pdfPath: string, jobId: string): Promise<SimpleOCRResult[]> {
    try {
      console.log('📄 Extracting text from vector PDF using pdf-parse with progress updates...');
      
      // Update progress: Starting file read (5%)
      await this.updateJobStatus(jobId, {
        progress: 5,
        total_pages: 0,
        processed_pages: 0
      });
      
      const startTime = Date.now();
      const dataBuffer = await fs.readFile(pdfPath);
      
      // Update progress: File read complete, starting PDF parsing (10%)
      await this.updateJobStatus(jobId, {
        progress: 10,
        total_pages: 0,
        processed_pages: 0
      });
      
      // Parse PDF with page-by-page extraction
      const data = await pdfParse(dataBuffer, {
        // Enable page-by-page extraction
        max: 0, // Process all pages
        version: 'v1.10.100' // Use specific version for stability
      });
      
      const processingTime = Date.now() - startTime;
      
      console.log(`📄 PDF parsed: ${data.numpages} pages, ${data.text.length} characters`);
      
      if (!data.text || data.text.trim().length === 0) {
        console.log('⚠️ No text found in PDF');
        return [];
      }
      
      // Update progress: PDF parsing complete, starting text processing (20%)
      await this.updateJobStatus(jobId, {
        progress: 20,
        total_pages: data.numpages,
        processed_pages: 0
      });
      
      // Try to extract text per page if available
      const totalPages = data.numpages;
      const results: SimpleOCRResult[] = [];
      
      // Check if we have page-specific data
      if (data.pages && Array.isArray(data.pages) && data.pages.length > 0) {
        console.log(`📄 Found ${data.pages.length} page-specific text blocks`);
        
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          // Find text for this specific page
          const pageText = data.pages.find((page: any) => page.page === pageNum)?.text || '';
          
          const result: SimpleOCRResult = {
            pageNumber: pageNum,
            text: pageText.trim(),
            confidence: 100,
            processingTime: Math.round(processingTime / totalPages),
            method: 'direct_extraction'
          };
          results.push(result);
          
          // Update progress: Processing pages (20-80%)
          const pageProgress = 20 + Math.round((pageNum / totalPages) * 60);
          await this.updateJobStatus(jobId, {
            progress: pageProgress,
            total_pages: totalPages,
            processed_pages: pageNum
          });
          
          // Add a small delay to make progress visible
          if (pageNum % 5 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      } else {
        // Fallback: Split text evenly across pages (better than duplicating full text)
        console.log('⚠️ No page-specific data available, splitting text evenly across pages');
        
        const textLength = data.text.length;
        const charsPerPage = Math.ceil(textLength / totalPages);
        
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          const startIndex = (pageNum - 1) * charsPerPage;
          const endIndex = Math.min(startIndex + charsPerPage, textLength);
          const pageText = data.text.substring(startIndex, endIndex);
          
          const result: SimpleOCRResult = {
            pageNumber: pageNum,
            text: pageText.trim(),
            confidence: 100,
            processingTime: Math.round(processingTime / totalPages),
            method: 'direct_extraction'
          };
          results.push(result);
          
          // Update progress: Processing pages (20-80%)
          const pageProgress = 20 + Math.round((pageNum / totalPages) * 60);
          await this.updateJobStatus(jobId, {
            progress: pageProgress,
            total_pages: totalPages,
            processed_pages: pageNum
          });
          
          // Add a small delay to make progress visible
          if (pageNum % 5 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      }
      
      // Update progress: Text processing complete (80%)
      await this.updateJobStatus(jobId, {
        progress: 80,
        total_pages: totalPages,
        processed_pages: totalPages
      });
      
      console.log(`✅ Text extraction successful: ${results.length} pages processed`);
      return results;
      
    } catch (error) {
      console.error('❌ PDF text extraction failed:', error);
      throw error;
    }
  }

  // Save OCR results to database
  async saveOCRResults(projectId: string, documentId: string, results: SimpleOCRResult[]): Promise<void> {
    try {
      // Filter out empty results before inserting
      const filteredResults = results.filter(r => r.text && r.text.trim().length > 0);

      if (filteredResults.length === 0) {
        console.log('⚠️ No valid OCR results to save.');
        return;
      }

      // Insert results into ocr_results table
      const { error } = await supabase.from('ocr_results').insert(
        filteredResults.map(result => ({
          project_id: projectId,
          document_id: documentId,
          page_number: result.pageNumber,
          text_content: result.text,
          confidence_score: result.confidence,
          processing_method: result.method,
          processing_time_ms: result.processingTime,
          word_positions: null, // Not available with pdf-parse
        }))
      );

      if (error) {
        console.error('❌ Failed to save OCR results:', error);
        throw error;
      }

      console.log('✅ OCR results saved to database');
    } catch (error) {
      console.error('❌ Failed to save OCR results:', error);
      throw error;
    }
  }

  // Update OCR job status in database
  async updateJobStatus(jobId: string, updates: any): Promise<void> {
    try {
      const { error } = await supabase
        .from('ocr_jobs')
        .update(updates)
        .eq('id', jobId);

      if (error) {
        console.error('❌ Failed to update job status:', error);
        throw error;
      }
    } catch (error) {
      console.error('❌ Failed to update job status:', error);
    }
  }

  // Main processing function
  async processDocument(
    documentPath: string, 
    projectId: string, 
    documentId: string, 
    jobId: string
  ): Promise<SimpleDocumentOCRData> {
    try {
      console.log(`🚀 Starting simple OCR processing for document: ${documentId}`);
      
      // Update job status to processing
      await this.updateJobStatus(jobId, {
        status: 'processing',
        started_at: new Date().toISOString()
      });

      // Extract text from PDF with progress updates
      const results = await this.extractTextFromPDFWithProgress(documentPath, jobId);
      
      if (results.length === 0) {
        throw new Error('No text could be extracted from the PDF');
      }
      
      // Update progress: Saving results to database (90-95%)
      await this.updateJobStatus(jobId, {
        progress: 90,
        total_pages: results.length,
        processed_pages: results.length
      });
      
      // Save results to database
      await this.saveOCRResults(projectId, documentId, results);
      
      // Update progress: Finalizing (95-100%)
      await this.updateJobStatus(jobId, {
        progress: 95,
        total_pages: results.length,
        processed_pages: results.length
      });
      
      // Update job status to completed
      await this.updateJobStatus(jobId, {
        status: 'completed',
        progress: 100,
        total_pages: results.length,
        processed_pages: results.length,
        completed_at: new Date().toISOString()
      });

      console.log(`✅ Simple OCR processing completed: ${results.length} results processed`);
      
      return {
        documentId,
        projectId,
        totalPages: results.length,
        results,
        processedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ Simple OCR processing failed:', error);
      
      // Update job status to failed
      await this.updateJobStatus(jobId, {
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        completed_at: new Date().toISOString()
      });
      
      throw error;
    }
  }

  // Search OCR results from database
  async searchOCRResults(projectId: string, documentId: string, query: string): Promise<any[]> {
    try {
      console.log(`🔍 Searching OCR results for: "${query}"`);

      const { data, error } = await supabase
        .from('ocr_results')
        .select('*')
        .eq('project_id', projectId)
        .eq('document_id', documentId)
        .ilike('text_content', `%${query}%`);

      if (error) {
        console.error('❌ Failed to search OCR results:', error);
        throw error;
      }

      console.log(`✅ Found ${data?.length || 0} matching results`);
      return data || [];
    } catch (error) {
      console.error('❌ OCR search failed:', error);
      throw error;
    }
  }

  // Get OCR results for a document
  async getDocumentOCRResults(projectId: string, documentId: string): Promise<SimpleOCRResult[]> {
    try {
      const { data, error } = await supabase
        .from('ocr_results')
        .select('*')
        .eq('project_id', projectId)
        .eq('document_id', documentId)
        .order('page_number');

      if (error) {
        console.error('❌ Failed to get OCR results:', error);
        throw error;
      }

      return (data || []).map(row => ({
        pageNumber: row.page_number,
        text: row.text_content,
        confidence: row.confidence_score,
        processingTime: row.processing_time_ms,
        method: 'direct_extraction' as const
      }));
    } catch (error) {
      console.error('❌ Failed to get document OCR results:', error);
      throw error;
    }
  }

  // Check if document has been processed
  async isDocumentProcessed(projectId: string, documentId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('ocr_results')
        .select('id')
        .eq('project_id', projectId)
        .eq('document_id', documentId)
        .limit(1);

      if (error) {
        console.error('❌ Failed to check document processing status:', error);
        return false;
      }

      return (data || []).length > 0;
    } catch (error) {
      console.error('❌ Failed to check document processing status:', error);
      return false;
    }
  }

  // Clear existing OCR results for a document (allows re-processing)
  async clearDocumentResults(projectId: string, documentId: string): Promise<void> {
    try {
      console.log(`🗑️ Clearing existing OCR results for document: ${documentId}`);
      
      // Delete existing OCR results
      const { error: resultsError } = await supabase
        .from('ocr_results')
        .delete()
        .eq('project_id', projectId)
        .eq('document_id', documentId);

      if (resultsError) {
        console.error('❌ Failed to clear OCR results:', resultsError);
        throw resultsError;
      }

      // Delete existing OCR jobs
      const { error: jobsError } = await supabase
        .from('ocr_jobs')
        .delete()
        .eq('project_id', projectId)
        .eq('document_id', documentId);

      if (jobsError) {
        console.error('❌ Failed to clear OCR jobs:', jobsError);
        throw jobsError;
      }

      console.log('✅ Successfully cleared existing OCR data');
    } catch (error) {
      console.error('❌ Failed to clear document results:', error);
      throw error;
    }
  }
}

export const simpleOcrService = new SimpleOCRService();
