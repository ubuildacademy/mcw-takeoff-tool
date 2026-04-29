import pdfParse from 'pdf-parse';
import fs from 'fs-extra';
import { supabase } from '../supabase';

export interface OCRBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRWordBox {
  index: number;
  text: string;
  confidence: number;
  bbox: OCRBoundingBox;
  source: 'pdfjs' | 'tesseract';
}

export interface SimpleOCRResult {
  pageNumber: number;
  text: string;
  confidence: number;
  processingTime: number;
  method: 'direct_extraction' | 'tesseract';
  wordBoxes?: OCRWordBox[];
}

export interface SimpleDocumentOCRData {
  documentId: string;
  projectId: string;
  totalPages: number;
  results: SimpleOCRResult[];
  processedAt: string;
}

class SimpleOCRService {
  private clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private normalizeForWordMatch(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  }

  private toResultFromPdfJsPage(
    page: { pageNumber: number; text: string; wordBoxes: OCRWordBox[] },
    perPageMs: number
  ): SimpleOCRResult {
    const text = typeof page.text === 'string' ? page.text : '';
    const hasText = text.trim().length > 0;
    return {
      pageNumber: page.pageNumber,
      text,
      confidence: hasText ? 100 : 0,
      processingTime: perPageMs,
      method: 'direct_extraction',
      wordBoxes: page.wordBoxes,
    };
  }

  private async extractTextFromPdfJs(dataBuffer: Buffer): Promise<{
    totalPages: number;
    pages: Array<{ pageNumber: number; text: string; wordBoxes: OCRWordBox[] }>;
  }> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = (pdfjs as any).getDocument({
      data: new Uint8Array(dataBuffer),
      disableWorker: true,
      useSystemFonts: true,
      stopAtErrors: false,
      isEvalSupported: false,
    });

    const pdf = await loadingTask.promise;
    const totalPages = Math.max(1, Number(pdf.numPages) || 1);
    const pages: Array<{ pageNumber: number; text: string; wordBoxes: OCRWordBox[] }> = [];

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1, rotation: 0 });
      // The viewport with explicit `rotation: 0` is in unrotated page space.
      // Coordinates produced by `Util.transform(viewport.transform, item.transform)` are
      // therefore already in the app's "base" (unrotated) space. No further rotation
      // remap is required when `rotation: 0` is used here.
      const textContent = await page.getTextContent({ disableNormalization: false });
      const items = Array.isArray((textContent as any).items) ? (textContent as any).items : [];

      const textParts: string[] = [];
      const wordBoxes: OCRWordBox[] = [];
      let wordIndex = 0;

      for (const item of items) {
        const raw = typeof item?.str === 'string' ? item.str : '';
        const hasEOL = Boolean(item?.hasEOL);
        if (!raw.trim()) {
          if (hasEOL) textParts.push('\n');
          continue;
        }

        textParts.push(raw);
        textParts.push(hasEOL ? '\n' : ' ');

        const transform = Array.isArray(item?.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
        const transformed = (pdfjs as any).Util?.transform
          ? (pdfjs as any).Util.transform(viewport.transform, transform)
          : transform;

        // Per PDF.js source (legacy/build/pdf.worker.mjs):
        //   - `item.transform` = ctm × textMatrix × [fontSize·textHScale, 0, 0, fontSize, 0, textRise]
        //     (NO fontMatrix /1000 scaling — the matrix entries are in user-space units per
        //     unit text-space, where 1 text-space unit ≈ 1 em.)
        //   - `item.width` = accumulated glyph advances in USER-SPACE units (already
        //     incorporating glyph.width * fontMatrix[0] * fontSize and any ctm scaling
        //     via `textAdvanceScale`).
        //   - For horizontal text `item.height = hypot(transform[2], transform[3])`
        //     (also in user-space units = font height).
        // Therefore, to extend a text run by its own width/height we must walk the UNIT
        // direction vectors of the transform — multiplying user-space distances by the raw
        // transform entries (which encode fontSize) overshoots by a factor of fontSize.
        const a = Number(transformed?.[0]) || 0;
        const b = Number(transformed?.[1]) || 0;
        const c = Number(transformed?.[2]) || 0;
        const d = Number(transformed?.[3]) || 0;
        const e = Number(transformed?.[4]) || 0;
        const f = Number(transformed?.[5]) || 0;

        const baselineLen = Math.hypot(a, b);
        const ascenderLen = Math.hypot(c, d);
        if (baselineLen <= 0 || ascenderLen <= 0) continue;

        const ubX = a / baselineLen; // unit vector along baseline (in viewport space)
        const ubY = b / baselineLen;
        const uaX = c / ascenderLen; // unit vector along ascender (in viewport space)
        const uaY = d / ascenderLen;

        const itemWidth = Number(item?.width) || 0;
        // For horizontal text PDF.js sets item.height = hypot(transform[2], transform[3]).
        // Fall back to that magnitude if the property is missing/zero.
        const rawHeight = Number(item?.height);
        const itemHeight = rawHeight > 0 ? rawHeight : ascenderLen;

        if (itemWidth <= 0 || itemHeight <= 0 || viewport.width <= 0 || viewport.height <= 0) {
          continue;
        }

        const totalChars = Math.max(raw.length, 1);
        const words = [...raw.matchAll(/\S+/g)];

        for (const wordMatch of words) {
          const wordText = wordMatch[0]?.trim();
          if (!wordText) continue;

          const charStart = Math.max(0, wordMatch.index ?? 0);
          const charLength = Math.max(1, wordText.length);

          // Walk along the actual baseline direction (unit vector) by the proportional
          // fraction of itemWidth that this word occupies. For proportional fonts this is
          // an approximation, but it follows the text's true reading direction (handles
          // rotated text correctly).
          const startFrac = charStart / totalChars;
          const endFrac = (charStart + charLength) / totalChars;

          const wp0x = e + startFrac * itemWidth * ubX;
          const wp0y = f + startFrac * itemWidth * ubY;
          const wp1x = e + endFrac * itemWidth * ubX;
          const wp1y = f + endFrac * itemWidth * ubY;
          const wp2x = wp1x + itemHeight * uaX;
          const wp2y = wp1y + itemHeight * uaY;
          const wp3x = wp0x + itemHeight * uaX;
          const wp3y = wp0y + itemHeight * uaY;

          const wMinX = Math.min(wp0x, wp1x, wp2x, wp3x);
          const wMaxX = Math.max(wp0x, wp1x, wp2x, wp3x);
          const wMinY = Math.min(wp0y, wp1y, wp2y, wp3y);
          const wMaxY = Math.max(wp0y, wp1y, wp2y, wp3y);

          const viewportNormRect: OCRBoundingBox = {
            x: this.clamp01(wMinX / viewport.width),
            y: this.clamp01(wMinY / viewport.height),
            width: this.clamp01((wMaxX - wMinX) / viewport.width),
            height: this.clamp01((wMaxY - wMinY) / viewport.height),
          };
          // viewport was created with `rotation: 0`, so viewportNormRect is already in
          // base (unrotated) normalized space. No remap required.

          wordBoxes.push({
            index: wordIndex++,
            text: wordText,
            confidence: 100,
            bbox: viewportNormRect,
            source: 'pdfjs',
          });
        }
      }

      const text = textParts
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      pages.push({ pageNumber, text, wordBoxes });
    }

    return { totalPages, pages };
  }

  private async extractTextFromPdfParseFallback(
    dataBuffer: Buffer,
    startTime: number
  ): Promise<SimpleOCRResult[]> {
    const data = await pdfParse(dataBuffer, {
      max: 0,
      version: 'v1.10.100'
    });

    const totalPages = Math.max(1, data.numpages || 1);
    const processingTime = Math.max(1, Date.now() - startTime);
    const perPageMs = Math.max(1, Math.round(processingTime / totalPages));

    if (!data.text || data.text.trim().length === 0) {
      return Array.from({ length: totalPages }, (_, i) => ({
        pageNumber: i + 1,
        text: '',
        confidence: 0,
        processingTime: perPageMs,
        method: 'direct_extraction' as const,
        wordBoxes: [],
      }));
    }

    const charsPerPage = Math.ceil(data.text.length / totalPages);
    return Array.from({ length: totalPages }, (_, i) => {
      const start = i * charsPerPage;
      const end = Math.min(start + charsPerPage, data.text.length);
      return {
        pageNumber: i + 1,
        text: data.text.slice(start, end).trim(),
        confidence: 100,
        processingTime: perPageMs,
        method: 'direct_extraction' as const,
        wordBoxes: [],
      };
    });
  }

  // Extract text directly from PDF using pdf-parse (perfect for vector PDFs)
  async extractTextFromPDF(pdfPath: string): Promise<SimpleOCRResult[]> {
    try {
      console.log('📄 Extracting text from vector PDF using PDF.js...');
      
      const startTime = Date.now();
      const dataBuffer = await fs.readFile(pdfPath);
      const extraction = await this.extractTextFromPdfJs(dataBuffer);
      const processingTime = Math.max(1, Date.now() - startTime);
      const perPageMs = Math.max(1, Math.round(processingTime / extraction.totalPages));

      const results = extraction.pages.map((page) => this.toResultFromPdfJsPage(page, perPageMs));
      console.log(`✅ Text extraction successful: ${results.length} pages processed`);
      return results;
      
    } catch (error) {
      console.error('❌ PDF.js text extraction failed, falling back to pdf-parse:', error);
      const startTime = Date.now();
      const dataBuffer = await fs.readFile(pdfPath);
      return this.extractTextFromPdfParseFallback(dataBuffer, startTime);
    }
  }

  // Extract text from PDF with detailed progress updates
  async extractTextFromPDFWithProgress(pdfPath: string, jobId: string): Promise<SimpleOCRResult[]> {
    try {
      console.log('📄 Extracting text from vector PDF using PDF.js with progress updates...');
      
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
      
      const extraction = await this.extractTextFromPdfJs(dataBuffer);
      const processingTime = Math.max(1, Date.now() - startTime);
      const totalPages = extraction.totalPages;
      const perPageMs = Math.max(1, Math.round(processingTime / totalPages));
      
      // Update progress: PDF parsing complete, starting text processing (20%)
      await this.updateJobStatus(jobId, {
        progress: 20,
        total_pages: totalPages,
        processed_pages: 0
      });
      const results: SimpleOCRResult[] = extraction.pages.map((page) => this.toResultFromPdfJsPage(page, perPageMs));

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const pageProgress = 20 + Math.round((pageNum / totalPages) * 60);
        await this.updateJobStatus(jobId, {
          progress: pageProgress,
          total_pages: totalPages,
          processed_pages: pageNum
        });
        if (pageNum % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
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
      console.error('❌ PDF.js text extraction with progress failed, falling back to pdf-parse:', error);
      const startTime = Date.now();
      const dataBuffer = await fs.readFile(pdfPath);
      return this.extractTextFromPdfParseFallback(dataBuffer, startTime);
    }
  }

  // Save OCR results to database
  async saveOCRResults(projectId: string, documentId: string, results: SimpleOCRResult[]): Promise<void> {
    try {
      const rows = results.filter((r) => r != null && typeof r.pageNumber === 'number' && r.pageNumber >= 1);
      if (rows.length === 0) {
        console.log('⚠️ No OCR result rows to save.');
        return;
      }

      // Persist every page, including empty text (scanned PDFs / blank pages). Omitting empty pages
      // used to save nothing, so the UI never showed those PDFs as "OCR'd" even after a successful job.
      const { error } = await supabase.from('ocr_results').insert(
        rows.map((result) => ({
          project_id: projectId,
          document_id: documentId,
          page_number: result.pageNumber,
          text_content: typeof result.text === 'string' ? result.text : '',
          confidence_score: result.confidence ?? 0,
          processing_method: result.method,
          processing_time_ms: result.processingTime ?? 0,
          word_boxes: Array.isArray(result.wordBoxes) ? result.wordBoxes : null,
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
      
      // If no text could be extracted (e.g. purely raster PDF), treat this as a
      // completed job with zero results instead of a hard failure. This keeps
      // the OCR pipeline stable for image-only drawings while clearly signaling
      // "no searchable text" to the caller.
      if (results.length === 0) {
        console.log('⚠️ No text could be extracted from the PDF; marking OCR job as completed with 0 results');
        
        await this.updateJobStatus(jobId, {
          status: 'completed',
          progress: 100,
          total_pages: 0,
          processed_pages: 0,
          completed_at: new Date().toISOString(),
          error_message: 'No searchable text found in PDF'
        });
        
        return {
          documentId,
          projectId,
          totalPages: 0,
          results: [],
          processedAt: new Date().toISOString()
        };
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
      const q = query.trim();
      if (!q) {
        return [];
      }
      const qLower = q.toLowerCase();
      console.log(`🔍 Searching OCR results for: "${q}"`);

      // Load all pages for this document and match in-process. PostgREST ILIKE + escape
      // rules can miss real matches; in-memory search matches the formatter below.
      const { data, error } = await supabase
        .from('ocr_results')
        .select('*')
        .eq('project_id', projectId)
        .eq('document_id', documentId)
        .order('page_number');

      if (error) {
        console.error('❌ Failed to search OCR results:', error);
        throw error;
      }

      const rows = data || [];
      const matched = rows.filter((row) => {
        const t = typeof row.text_content === 'string' ? row.text_content.toLowerCase() : '';
        return t.includes(qLower);
      });

      console.log(`✅ Found ${matched.length} matching page(s) (${rows.length} total OCR row(s))`);
      return matched;
    } catch (error) {
      console.error('❌ OCR search failed:', error);
      throw error;
    }
  }

  /** Distinct document IDs that have at least one row in ocr_results for this project. */
  async getDocumentIdsWithOcrForProject(projectId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('ocr_results')
      .select('document_id')
      .eq('project_id', projectId);

    if (error) {
      console.error('❌ Failed to list OCR document ids for project:', error);
      throw error;
    }

    const ids = new Set<string>();
    for (const row of data || []) {
      const id = (row as { document_id?: string | null }).document_id;
      if (typeof id === 'string' && id.length > 0) ids.add(id);
    }
    return [...ids];
  }

  // Get OCR results for a document
  async getDocumentOCRResults(projectId: string, documentId: string): Promise<SimpleOCRResult[]> {
    try {
      // Only log in development to reduce production log noise
      const isDev = process.env.NODE_ENV !== 'production';
      if (isDev) {
        console.log(`🔍 Database: Querying OCR results for document ${documentId} in project ${projectId}`);
      }
      
      const { data, error } = await supabase
        .from('ocr_results')
        .select('*')
        .eq('project_id', projectId)
        .eq('document_id', documentId)
        .order('page_number');

      if (error) {
        console.error('❌ Database query failed:', error);
        throw error;
      }

      // Only log summary in development
      if (isDev && data) {
        console.log(`📊 Database: Found ${data.length} OCR results for document ${documentId}`);
      }

      // CRITICAL FIX: Filter out null/undefined rows and ensure page_number exists
      // This prevents "Cannot read properties of undefined (reading 'pageNumber')" errors
      return (data || [])
        .filter(row => row != null && row.page_number != null)
        .map(row => {
          const methodRaw = row.processing_method as string | undefined;
          const method: 'direct_extraction' | 'tesseract' =
            methodRaw === 'tesseract' ? 'tesseract' : 'direct_extraction';
          return {
            pageNumber: row.page_number,
            text: row.text_content || '',
            confidence: row.confidence_score || 0,
            processingTime: row.processing_time_ms || 0,
            method,
            wordBoxes: Array.isArray(row.word_boxes) ? row.word_boxes : [],
          };
        });
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

  async getWordBoxesForPage(
    projectId: string,
    documentId: string,
    pageNumber: number,
    query?: string
  ): Promise<OCRWordBox[]> {
    const { data, error } = await supabase
      .from('ocr_results')
      .select('word_boxes')
      .eq('project_id', projectId)
      .eq('document_id', documentId)
      .eq('page_number', pageNumber)
      .limit(1)
      .single();

    if (error) {
      console.error('❌ Failed to load OCR word boxes:', error);
      throw error;
    }

    const boxesRaw = (data as { word_boxes?: unknown } | null)?.word_boxes;
    const boxes = Array.isArray(boxesRaw) ? (boxesRaw as OCRWordBox[]) : [];
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    if (!normalizedQuery) return boxes;

    const queryTokens = normalizedQuery
      .split(/\s+/)
      .map((token) => this.normalizeForWordMatch(token))
      .filter((token) => token.length > 0);
    if (queryTokens.length === 0) return boxes;

    const normalizedWords = boxes.map((box) => this.normalizeForWordMatch(box.text || ''));
    const matchedIndexes = new Set<number>();

    if (queryTokens.length > 1) {
      for (let i = 0; i <= normalizedWords.length - queryTokens.length; i++) {
        let allMatch = true;
        for (let tokenIdx = 0; tokenIdx < queryTokens.length; tokenIdx++) {
          if (normalizedWords[i + tokenIdx] !== queryTokens[tokenIdx]) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          for (let tokenIdx = 0; tokenIdx < queryTokens.length; tokenIdx++) {
            matchedIndexes.add(i + tokenIdx);
          }
        }
      }
    }

    if (matchedIndexes.size === 0) {
      normalizedWords.forEach((word, index) => {
        if (queryTokens.some((token) => word.includes(token))) {
          matchedIndexes.add(index);
        }
      });
    }

    if (matchedIndexes.size === 0) return [];
    return boxes.filter((_, index) => matchedIndexes.has(index));
  }

  /**
   * Analyze image data (placeholder for compatibility)
   */
  async analyzeImage(imageData: string): Promise<{
    success: boolean;
    text: string;
    words?: any[];
  }> {
    // This is a placeholder implementation
    // In a real implementation, this would process the image data
    return {
      success: false,
      text: '',
      words: []
    };
  }

  /**
   * Check if the service is available
   */
  async isAvailable(): Promise<boolean> {
    return true; // SimpleOCRService is always available
  }
}

export const simpleOcrService = new SimpleOCRService();
