import { pipeline } from '@xenova/transformers';
import * as pdf2pic from 'pdf2pic';
import * as pdfParse from 'pdf-parse';
import * as Tesseract from 'tesseract.js';
import path from 'path';
import fs from 'fs-extra';
import { supabase } from '../supabase';

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

class TrOCRService {
  private trocrPipeline: any = null;
  private isInitialized = false;

  // Initialize TrOCR pipeline
  private async initializeTrOCR(): Promise<void> {
    if (this.isInitialized && this.trocrPipeline) return;

    try {
      console.log('🔄 Initializing TrOCR pipeline...');
      
      // Load TrOCR model with proper configuration - try a different model first
      this.trocrPipeline = await pipeline(
        'image-to-text',
        'microsoft/trocr-base-stage1', // Try stage1 model which might have different tokenizer
        {
          quantized: false, // Disable quantization to avoid tokenizer issues
          progress_callback: (progress: any) => {
            if (progress.status === 'downloading') {
              console.log(`📥 Downloading model: ${progress.file} (${Math.round(progress.progress * 100)}%)`);
            }
          }
        }
      );

      this.isInitialized = true;
      console.log('✅ TrOCR pipeline initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize TrOCR pipeline:', error);
      
      // Try alternative approach with explicit model configuration
      try {
        console.log('🔄 Trying alternative TrOCR initialization...');
        
        this.trocrPipeline = await pipeline(
          'image-to-text',
          'microsoft/trocr-base-printed',
          {
            quantized: false,
            revision: 'main'
          }
        );
        
        this.isInitialized = true;
        console.log('✅ TrOCR pipeline initialized with alternative method');
      } catch (altError) {
        console.error('❌ Alternative TrOCR initialization also failed:', altError);
        
        // Try with a different TrOCR model that might be more stable
        try {
          console.log('🔄 Trying with TrOCR small model...');
          
          this.trocrPipeline = await pipeline(
            'image-to-text',
            'microsoft/trocr-base-handwritten', // Try handwritten model as fallback
            {
              quantized: false,
              revision: 'main'
            }
          );
          
          this.isInitialized = true;
          console.log('✅ TrOCR pipeline initialized with handwritten model');
        } catch (finalError) {
          console.error('❌ All TrOCR initialization attempts failed:', finalError);
          throw new Error(`TrOCR initialization failed: ${finalError instanceof Error ? finalError.message : 'Unknown error'}`);
        }
      }
    }
  }

  // For now, skip direct text extraction to avoid PDF.js issues in Node.js
  // We'll focus on TrOCR which should work well for architectural drawings
  private async extractTextDirectly(pdfPath: string): Promise<OCRResult[]> {
    try {
      console.log('📄 Attempting direct text extraction from PDF...');
      
      const dataBuffer = await fs.readFile(pdfPath);
      const data = await pdfParse(dataBuffer);
      
      if (!data.text || data.text.trim().length === 0) {
        console.log('📄 No text found in PDF, will use OCR');
        return [];
      }
      
      console.log(`📄 Direct extraction successful! Found ${data.numpages} pages with text`);
      
      // Split text by pages (approximate)
      const pages = data.text.split('\f'); // Form feed character often separates pages
      const results: OCRResult[] = [];
      
      for (let i = 0; i < Math.max(pages.length, data.numpages); i++) {
        const pageText = pages[i] || '';
        if (pageText.trim().length > 0) {
          results.push({
            pageNumber: i + 1,
            text: pageText.trim(),
            confidence: 0.95, // High confidence for direct extraction
            processingTime: 0,
            method: 'direct_extraction'
          });
        }
      }
      
      return results;
    } catch (error) {
      console.log('📄 Direct extraction failed:', error);
      return [];
    }
  }

  // Process document with Tesseract OCR
  private async processWithTesseract(pdfPath: string, jobId: string): Promise<OCRResult[]> {
    try {
      console.log('🔍 Starting Tesseract OCR processing...');
      
      // Create temporary directory for images
      const tempDir = path.join(__dirname, `../../temp/${jobId}`);
      await fs.ensureDir(tempDir);
      
      // Convert PDF to images
      const imagePaths = await this.convertPdfToImages(pdfPath, tempDir);
      
      const results: OCRResult[] = [];
      
      // Process each image with Tesseract
      for (let i = 0; i < imagePaths.length; i++) {
        const imagePath = imagePaths[i];
        const pageNumber = i + 1;
        
        console.log(`🔍 Processing page ${pageNumber} with Tesseract...`);
        
        const startTime = Date.now();
        const { data: { text, confidence } } = await Tesseract.recognize(imagePath, 'eng', {
          logger: m => console.log(`📊 Tesseract progress: ${m.status}`)
        });
        const processingTime = Date.now() - startTime;
        
        if (text && text.trim().length > 0) {
          results.push({
            pageNumber,
            text: text.trim(),
            confidence: confidence / 100, // Convert to 0-1 scale
            processingTime,
            method: 'tesseract'
          });
        }
        
        // Update progress
        const progress = Math.round(((i + 1) / imagePaths.length) * 100);
        await this.updateJobStatus(jobId, {
          progress,
          processed_pages: i + 1
        });
      }
      
      // Clean up temporary files
      await fs.remove(tempDir);
      
      return results;
    } catch (error) {
      console.error('❌ Tesseract processing failed:', error);
      throw error;
    }
  }

  // Convert PDF to high-quality images for OCR
  private async convertPdfToImages(pdfPath: string, outputDir: string): Promise<string[]> {
    try {
      console.log('🖼️ Converting PDF to images...');
      
      const convert = pdf2pic.fromPath(pdfPath, {
        density: 600, // Higher DPI for better OCR accuracy
        saveFilename: 'page',
        savePath: outputDir,
        format: 'png',
        width: 3000, // Higher resolution
        height: 3000
      });

      // Convert to images and save to disk
      const results = await convert.bulk(-1);
      const imagePaths = results.map((result: any, index: number) => 
        path.join(outputDir, `page.${index + 1}.png`)
      );
      
      console.log(`✅ Converted PDF to ${imagePaths.length} images`);
      return imagePaths;
    } catch (error) {
      console.error('❌ PDF to image conversion failed:', error);
      throw error;
    }
  }

  // Process image with TrOCR
  private async processImageWithTrOCR(imagePath: string, pageNumber: number): Promise<OCRResult> {
    if (!this.trocrPipeline) {
      throw new Error('TrOCR pipeline not initialized');
    }

    const startTime = Date.now();
    
    try {
      console.log(`🔍 Processing page ${pageNumber} with TrOCR...`);
      
      // Read image file
      const imageBuffer = await fs.readFile(imagePath);
      
      // Process with TrOCR
      const result = await this.trocrPipeline(imageBuffer);
      
      const processingTime = Date.now() - startTime;
      
      // TrOCR returns an array of results, get the first one
      const ocrResult = Array.isArray(result) ? result[0] : result;
      const text = ocrResult?.generated_text || '';
      const confidence = ocrResult?.score || 0;
      
      console.log(`✅ Page ${pageNumber} TrOCR completed:`, {
        textLength: text.length,
        confidence: Math.round(confidence * 100),
        processingTime: `${processingTime}ms`,
        textPreview: text.substring(0, 100) + '...'
      });

      return {
        pageNumber,
        text: text.trim(),
        confidence: Math.round(confidence * 100),
        processingTime,
        method: 'trocr'
      };
    } catch (error) {
      console.error(`❌ TrOCR failed for page ${pageNumber}:`, error);
      const processingTime = Date.now() - startTime;
      
      return {
        pageNumber,
        text: '',
        confidence: 0,
        processingTime,
        method: 'trocr'
      };
    }
  }

  // Save OCR results to database
  private async saveOCRResults(projectId: string, documentId: string, results: OCRResult[]): Promise<void> {
    try {
      console.log(`💾 Saving ${results.length} OCR results to database...`);
      
      for (const result of results) {
        const { data, error } = await supabase
          .from('ocr_results')
          .upsert({
            project_id: projectId,
            document_id: documentId,
            page_number: result.pageNumber,
            text_content: result.text,
            confidence_score: result.confidence,
            processing_method: result.method,
            processing_time_ms: result.processingTime,
            word_positions: result.wordPositions || null,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'project_id,document_id,page_number'
          });

        if (error) {
          console.error(`❌ Failed to save OCR result for page ${result.pageNumber}:`, error);
        }
      }
      
      console.log('✅ OCR results saved to database');
    } catch (error) {
      console.error('❌ Failed to save OCR results:', error);
      throw error;
    }
  }

  // Update OCR job status
  private async updateJobStatus(jobId: string, updates: any): Promise<void> {
    try {
      const { error } = await supabase
        .from('ocr_jobs')
        .update(updates)
        .eq('id', jobId);

      if (error) {
        console.error('❌ Failed to update job status:', error);
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
  ): Promise<DocumentOCRData> {
    try {
      console.log(`🚀 Starting OCR processing for document: ${documentId}`);
      
      // Update job status to processing
      await this.updateJobStatus(jobId, {
        status: 'processing',
        started_at: new Date().toISOString()
      });

      // First, try direct text extraction
      const directResults = await this.extractTextDirectly(documentPath);
      
      if (directResults.length > 0) {
        console.log(`✅ Direct extraction successful for ${directResults.length} pages`);
        
        // Save results to database
        await this.saveOCRResults(projectId, documentId, directResults);
        
        // Update job status
        await this.updateJobStatus(jobId, {
          status: 'completed',
          progress: 100,
          total_pages: directResults.length,
          processed_pages: directResults.length,
          completed_at: new Date().toISOString()
        });

        return {
          documentId,
          projectId,
          totalPages: directResults.length,
          results: directResults,
          processedAt: new Date().toISOString()
        };
      }

      // If direct extraction failed, try Tesseract OCR
      console.log('🔄 Direct extraction failed, falling back to Tesseract OCR...');
      
      try {
        const tesseractResults = await this.processWithTesseract(documentPath, jobId);
        if (tesseractResults.length > 0) {
          console.log(`✅ Tesseract OCR successful for ${tesseractResults.length} pages`);
          
          // Save results to database
          await this.saveOCRResults(projectId, documentId, tesseractResults);
          
          // Update job status
          await this.updateJobStatus(jobId, {
            status: 'completed',
            progress: 100,
            total_pages: tesseractResults.length,
            processed_pages: tesseractResults.length,
            completed_at: new Date().toISOString()
          });

          return {
            documentId,
            projectId,
            totalPages: tesseractResults.length,
            results: tesseractResults,
            processedAt: new Date().toISOString()
          };
        }
      } catch (tesseractError) {
        console.error('❌ Tesseract OCR failed:', tesseractError);
      }
      
      // If all methods failed, mark as failed
      console.log('❌ All OCR methods failed');
      await this.updateJobStatus(jobId, {
        status: 'failed',
        error_message: 'All OCR methods failed - direct extraction and Tesseract OCR both failed'
      });
      
      throw new Error('All OCR methods failed');
      
    } catch (error) {
      console.error('❌ OCR processing failed:', error);
      
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

      console.log(`✅ Found ${data?.length || 0} matching pages`);
      return data || [];
    } catch (error) {
      console.error('❌ OCR search failed:', error);
      throw error;
    }
  }

  // Get OCR results for a document
  async getDocumentOCRResults(projectId: string, documentId: string): Promise<OCRResult[]> {
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
        method: row.processing_method,
        wordPositions: row.word_positions
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

// Export singleton instance
export const trocrService = new TrOCRService();
