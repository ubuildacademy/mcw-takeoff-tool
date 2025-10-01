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
      
      // Parse PDF
      const data = await pdfParse(dataBuffer);
      
      const processingTime = Date.now() - startTime;
      
      console.log(`📄 PDF parsed: ${data.numpages} pages, ${data.text.length} characters`);
      
      if (!data.text || data.text.trim().length === 0) {
        console.log('⚠️ No text found in PDF');
        return [];
      }
      
      // For vector PDFs, we'll treat the entire document as one result
      // since pdf-parse extracts all text at once
      const result: SimpleOCRResult = {
        pageNumber: 1, // We'll treat it as page 1 for simplicity
        text: data.text.trim(),
        confidence: 100, // pdf-parse is considered 100% accurate for vector text
        processingTime,
        method: 'direct_extraction'
      };
      
      console.log(`✅ Text extraction successful: ${result.text.length} characters`);
      return [result];
      
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

      // Extract text from PDF
      const results = await this.extractTextFromPDF(documentPath);
      
      if (results.length === 0) {
        throw new Error('No text could be extracted from the PDF');
      }
      
      // Save results to database
      await this.saveOCRResults(projectId, documentId, results);
      
      // Update job status
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
}

export const simpleOcrService = new SimpleOCRService();
