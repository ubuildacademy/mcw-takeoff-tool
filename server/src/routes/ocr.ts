import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../supabase';
import { simpleOcrService, type OCRWordBox, type SimpleOCRResult } from '../services/simpleOcrService';
import { pymupdfTextExtractor } from '../services/pymupdfTextExtractor';
import { bubbleOcrExtractor } from '../services/bubbleOcrExtractor';
import { requireAuth, hasProjectAccess, isAdmin, validateUUIDParam, isValidUUID } from '../middleware';
import { devLog, devWarn } from '../lib/devLog';

const router = express.Router();

/** Express may parse repeated keys as arrays; normalize to a single string. */
function firstQueryString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

/** Shared: download PDF, create job, start background processing. Returns jobId or null if skipped. */
async function startOCRJob(projectId: string, documentId: string, options?: { clearIfProcessed?: boolean }): Promise<string | null> {
  const { data: documentData, error: documentError } = await supabase
    .from('takeoff_files')
    .select('filename, path')
    .eq('id', documentId)
    .eq('project_id', projectId)
    .single();

  if (documentError || !documentData?.path) return null;

  const { data: fileData, error: downloadError } = await supabase.storage
    .from('project-files')
    .download(documentData.path);

  if (downloadError || !fileData) return null;

  if (options?.clearIfProcessed) {
    const isProcessed = await simpleOcrService.isDocumentProcessed(projectId, documentId);
    if (isProcessed) {
      await simpleOcrService.clearDocumentResults(projectId, documentId);
    }
  }

  const tempDir = path.join(process.cwd(), 'server', 'temp', 'pdf-processing');
  await fs.ensureDir(tempDir);
  const documentPath = path.join(tempDir, `${documentId}.pdf`);
  await fs.writeFile(documentPath, Buffer.from(await fileData.arrayBuffer()));

  const jobId = uuidv4();
  const { error: jobError } = await supabase.from('ocr_jobs').insert({
    id: jobId,
    project_id: projectId,
    document_id: documentId,
    status: 'pending',
    progress: 0,
    total_pages: 0,
    processed_pages: 0
  });

  if (jobError) {
    console.error('Failed to create OCR job:', jobError);
    return null;
  }

  processDocumentOCR(documentPath, jobId, documentId, projectId);
  return jobId;
}

// Process entire document with OCR
router.post('/process-document/:documentId', requireAuth, validateUUIDParam('documentId'), async (req, res) => {
  const { documentId } = req.params;
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  const userIsAdmin = await isAdmin(req.user!.id);
  if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
    return res.status(404).json({ error: 'Project not found or access denied' });
  }

  try {
    const jobId = await startOCRJob(projectId, documentId, { clearIfProcessed: true });
    if (!jobId) {
      return res.status(404).json({ error: 'Document not found or could not be prepared for OCR' });
    }
    res.json({ jobId, message: 'OCR processing started', status: 'pending' });
  } catch (error) {
    console.error('Error starting OCR processing:', error);
    res.status(500).json({ error: 'Failed to start OCR processing' });
  }
});

// Get OCR job status
router.get('/status/:jobId', requireAuth, validateUUIDParam('jobId'), async (req, res) => {
  const { jobId } = req.params;

  try {
    const { data: job, error } = await supabase
      .from('ocr_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const userIsAdmin = await isAdmin(req.user!.id);
    const projectId = job.project_id as string;
    if (
      projectId &&
      !userIsAdmin &&
      !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))
    ) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      totalPages: job.total_pages,
      processedPages: job.processed_pages,
      error: job.error_message,
      startTime: job.started_at,
      completedAt: job.completed_at
    });
  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

// Distinct document IDs that have OCR text stored for this project (Search tab, badges)
router.get('/documents-with-ocr', requireAuth, async (req, res) => {
  const projectId = firstQueryString(req.query.projectId);
  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }
  if (!isValidUUID(projectId)) {
    return res.status(400).json({ error: 'Invalid project ID format' });
  }

  const userIsAdmin = await isAdmin(req.user!.id);
  if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
    return res.status(404).json({ error: 'Project not found or access denied' });
  }

  try {
    const documentIds = await simpleOcrService.getDocumentIdsWithOcrForProject(projectId);
    res.json({ documentIds });
  } catch (error) {
    console.error('Error listing OCR documents:', error);
    res.status(500).json({ error: 'Failed to list OCR documents' });
  }
});

// Search OCR results
router.get('/search/:documentId', requireAuth, validateUUIDParam('documentId'), async (req, res) => {
  const { documentId } = req.params;
  const query = firstQueryString(req.query.query);
  const projectId = firstQueryString(req.query.projectId);

  if (!query || !query.trim()) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  const userIsAdmin = await isAdmin(req.user!.id);
  if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
    return res.status(404).json({ error: 'Project not found or access denied' });
  }

  const trimmedQuery = query.trim();

  try {
      // Search OCR results using the simple OCR service
      const searchResults = await simpleOcrService.searchOCRResults(projectId, documentId, trimmedQuery);
      
      if (process.env.NODE_ENV !== 'production') {
        devLog('OCR search: db results', {
          projectId,
          documentId,
          query: trimmedQuery,
          count: searchResults.length,
        });
      }

    // Format results for frontend
    const formattedResults = searchResults.map((result: { page_number?: number; text_content?: string | null; confidence_score?: number; processing_method?: string; processing_time_ms?: number }) => {
      const rawText = typeof result.text_content === 'string' ? result.text_content : '';
      const text = rawText.toLowerCase();
      const queryLower = trimmedQuery.toLowerCase();
      const matches = [];
      let index = text.indexOf(queryLower);
      
      while (index !== -1) {
        const start = Math.max(0, index - 50);
        const end = Math.min(text.length, index + trimmedQuery.length + 50);
        const snippet = rawText.substring(start, end);
        
        matches.push({
          snippet,
          position: index,
          confidence: result.confidence_score ?? 0
        });
        
        index = text.indexOf(queryLower, index + 1);
      }

      return {
        pageNumber: result.page_number,
        matches,
        totalMatches: matches.length,
        method: result.processing_method ?? 'direct_extraction',
        processingTime: result.processing_time_ms ?? 0
      };
    })
      .filter(
        (result): result is typeof result & { pageNumber: number } =>
          result.totalMatches > 0 && result.pageNumber != null && Number.isFinite(result.pageNumber)
      )
      .sort((a, b) => b.totalMatches - a.totalMatches);

    devLog(`📊 Formatted results being sent to frontend:`, formattedResults.map(r => ({ pageNumber: r.pageNumber, totalMatches: r.totalMatches })));

    res.json({
      query: trimmedQuery,
      totalResults: formattedResults.reduce((sum, result) => sum + result.totalMatches, 0),
      results: formattedResults
    });

  } catch (error) {
    console.error('Error searching OCR results:', error);
    res.status(500).json({ error: 'Failed to search OCR results' });
  }
});

// Get OCR word boxes for a specific page (optionally filtered by query)
router.get('/word-boxes/:documentId', requireAuth, validateUUIDParam('documentId'), async (req, res) => {
  const { documentId } = req.params;
  const projectId = firstQueryString(req.query.projectId);
  const pageNumberRaw = firstQueryString(req.query.pageNumber);
  const query = firstQueryString(req.query.query);

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }
  if (!pageNumberRaw) {
    return res.status(400).json({ error: 'Page number is required' });
  }
  const pageNumber = Number.parseInt(pageNumberRaw, 10);
  if (!Number.isFinite(pageNumber) || pageNumber < 1) {
    return res.status(400).json({ error: 'Page number must be a positive integer' });
  }

  const userIsAdmin = await isAdmin(req.user!.id);
  if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
    return res.status(404).json({ error: 'Project not found or access denied' });
  }

  try {
    const boxes = await simpleOcrService.getWordBoxesForPage(projectId, documentId, pageNumber, query);
    res.json({
      documentId,
      projectId,
      pageNumber,
      query: query?.trim() || '',
      boxes,
      total: boxes.length,
    });
  } catch (error) {
    console.error('Error getting OCR word boxes:', error);
    res.status(500).json({ error: 'Failed to get OCR word boxes' });
  }
});

// Get OCR results for a document
router.get('/results/:documentId', requireAuth, validateUUIDParam('documentId'), async (req, res) => {
  const { documentId } = req.params;
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  // Verify user has access to this project
  const userIsAdmin = await isAdmin(req.user!.id);
  if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
    return res.status(404).json({ error: 'Project not found or access denied' });
  }

  try {
    // Only log in development to reduce production log noise
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      devLog(`🔍 Backend: Getting OCR results for document ${documentId} in project ${projectId}`);
    }
    
    const results = await simpleOcrService.getDocumentOCRResults(projectId, documentId);
    
    // CRITICAL FIX: Safely build sampleResults with null checks to prevent TypeError
    // Filter out null/undefined entries before mapping
    const safeResults = Array.isArray(results) ? results.filter(r => r != null) : [];
    
    // Only log detailed results in development
    if (isDev) {
      const sampleResults = safeResults
        .slice(0, 3)
        .filter(r => r && r.pageNumber != null)
        .map(r => ({
          pageNumber: r.pageNumber,
          textLength: r.text?.length || 0,
          textPreview: r.text?.substring(0, 100) + '...'
        }));
      
      devLog(`📊 Backend: OCR results retrieved:`, {
        documentId,
        projectId,
        resultsCount: safeResults.length,
        sampleResults: sampleResults
      });
    }
    
    res.json({
      documentId,
      projectId,
      results,
      totalPages: results.length
    });
  } catch (error) {
    console.error('Error getting OCR results:', error);
    res.status(500).json({ error: 'Failed to get OCR results' });
  }
});

// Clear OCR results for a document (allows re-processing)
router.delete('/results/:documentId', requireAuth, validateUUIDParam('documentId'), async (req, res) => {
  const { documentId } = req.params;
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  // Verify user has access to this project
  const userIsAdmin = await isAdmin(req.user!.id);
  if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
    return res.status(404).json({ error: 'Project not found or access denied' });
  }

  try {
    devLog(`🗑️ Clearing OCR results for document: ${documentId}`);
    await simpleOcrService.clearDocumentResults(projectId, documentId);
    
    res.json({
      success: true,
      message: 'OCR results cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing OCR results:', error);
    res.status(500).json({ error: 'Failed to clear OCR results' });
  }
});

// Receive client-side OCR results (for image-based OCR fallback)
router.post('/client-results/:documentId', requireAuth, validateUUIDParam('documentId'), async (req, res) => {
  const { documentId } = req.params;
  const { projectId, results, jobId } = req.body;

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  if (!results || !Array.isArray(results)) {
    return res.status(400).json({ error: 'Results array is required' });
  }

  // Verify user has access to this project
  const userIsAdmin = await isAdmin(req.user!.id);
  if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
    return res.status(404).json({ error: 'Project not found or access denied' });
  }

  try {
    devLog(`📥 Receiving client-side OCR results for document: ${documentId} (${results.length} pages)`);

    const serverResults: SimpleOCRResult[] = results.map((result: Record<string, unknown>) => {
      const pageNumber = typeof result.pageNumber === 'number' ? result.pageNumber : Number(result.pageNumber);
      const rawWordBoxes = Array.isArray(result.wordBoxes) ? result.wordBoxes : [];
      const wordBoxes: OCRWordBox[] = rawWordBoxes
        .map((entry: unknown, index: number): OCRWordBox | null => {
          if (!entry || typeof entry !== 'object') return null;
          const candidate = entry as Record<string, unknown>;
          const bboxCandidate = candidate.bbox as Record<string, unknown> | undefined;
          const x = typeof bboxCandidate?.x === 'number' ? bboxCandidate.x : 0;
          const y = typeof bboxCandidate?.y === 'number' ? bboxCandidate.y : 0;
          const width = typeof bboxCandidate?.width === 'number' ? bboxCandidate.width : 0;
          const height = typeof bboxCandidate?.height === 'number' ? bboxCandidate.height : 0;
          const sourceRaw = candidate.source;
          const source =
            sourceRaw === 'pdfjs'
              ? 'pdfjs'
              : sourceRaw === 'pymupdf'
                ? 'pymupdf'
                : sourceRaw === 'bubble_ocr'
                  ? 'bubble_ocr'
                  : 'tesseract';
          return {
            index: typeof candidate.index === 'number' ? candidate.index : index,
            text: typeof candidate.text === 'string' ? candidate.text : '',
            confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0,
            bbox: { x, y, width, height },
            source,
          };
        })
        .filter((box): box is OCRWordBox => box != null);

      return {
        pageNumber: Number.isFinite(pageNumber) ? pageNumber : 0,
        text: typeof result.text === 'string' ? result.text : '',
        confidence: typeof result.confidence === 'number' ? result.confidence : 0,
        processingTime: typeof result.processingTime === 'number' ? result.processingTime : 0,
        method: 'tesseract' as const,
        wordBoxes,
      };
    });

    // Save results to database using the simple OCR service
    await simpleOcrService.saveOCRResults(projectId, documentId, serverResults);

    // Update OCR job status if jobId provided
    if (jobId) {
      await simpleOcrService.updateJobStatus(jobId, {
        status: 'completed',
        progress: 100,
        total_pages: results.length,
        processed_pages: results.length,
        completed_at: new Date().toISOString()
      });
    }

    devLog(`✅ Client-side OCR results saved: ${results.length} pages`);

    res.json({
      success: true,
      message: 'Client-side OCR results saved successfully',
      pagesProcessed: results.length
    });
  } catch (error) {
    console.error('Error saving client-side OCR results:', error);
    res.status(500).json({ 
      error: 'Failed to save client-side OCR results',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Auto-hyperlink pre-step: re-extract per-word text from a PDF using PyMuPDF (MuPDF) and merge
 * the results into the document's stored OCR rows under `source: 'pymupdf'`.
 *
 * Why: PDF.js' `getTextContent` silently drops glyphs in Type 3 fonts and form XObjects with
 * malformed ToUnicode CMaps, which is exactly how callout-bubble text in vector architectural
 * PDFs gets hidden. MuPDF is far more permissive and typically extracts those glyphs cleanly --
 * no rasterization or OCR required. This makes the auto-hyperlink step seconds-per-document
 * instead of the 7-20 minutes the old client-side Tesseract pre-step was costing us.
 *
 * Existing PDF.js word boxes are preserved (see `mergeWordBoxesPreservingExisting`); we only
 * add new boxes for words PDF.js missed.
 */
router.post(
  '/pymupdf-extract/:documentId',
  requireAuth,
  validateUUIDParam('documentId'),
  async (req, res) => {
    // The 15-min global server timeout is plenty for a single document, but bump
    // the socket timeout just in case a huge PDF takes a while.
    req.setTimeout(15 * 60 * 1000);
    res.setTimeout(15 * 60 * 1000);

    const { documentId } = req.params;
    const { projectId } = req.body ?? {};

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const userIsAdmin = await isAdmin(req.user!.id);
    if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    const { data: documentData, error: documentError } = await supabase
      .from('takeoff_files')
      .select('filename, path')
      .eq('id', documentId)
      .eq('project_id', projectId)
      .single();

    if (documentError || !documentData?.path) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const { data: fileData, error: downloadError } = await supabase.storage
      .from('project-files')
      .download(documentData.path);

    if (downloadError || !fileData) {
      console.error('pymupdf-extract: failed to download PDF', downloadError);
      return res.status(500).json({ error: 'Failed to download PDF for extraction' });
    }

    const tempDir = path.join(process.cwd(), 'server', 'temp', 'pdf-processing');
    await fs.ensureDir(tempDir);
    const tempPath = path.join(tempDir, `${documentId}-pymupdf-${uuidv4()}.pdf`);
    await fs.writeFile(tempPath, Buffer.from(await fileData.arrayBuffer()));

    try {
      const extraction = await pymupdfTextExtractor.extractAllPages(tempPath);
      let pagesWithText = 0;
      for (const page of extraction.pages) {
        const wordBoxes: OCRWordBox[] = (page.words || [])
          .map((word, idx): OCRWordBox | null => {
            const w = word?.width ?? 0;
            const h = word?.height ?? 0;
            if (w <= 0 || h <= 0) return null;
            const text = typeof word.text === 'string' ? word.text.trim() : '';
            if (!text) return null;
            return {
              index: idx,
              text,
              // PyMuPDF gives us exact glyph positions, not a probability. Tag with
              // 100 so the same downstream code that already trusts pdfjs boxes
              // treats these as authoritative too.
              confidence: 100,
              bbox: { x: word.x, y: word.y, width: w, height: h },
              source: 'pymupdf',
            };
          })
          .filter((b): b is OCRWordBox => b != null);

        if (wordBoxes.length > 0) pagesWithText += 1;

        await simpleOcrService.mergeWordBoxesForPage(
          projectId,
          documentId,
          {
            pageNumber: page.pageNumber,
            text: typeof page.text === 'string' ? page.text : '',
            // Same rationale as confidence above: this is direct text, not OCR.
            confidence: wordBoxes.length > 0 ? 100 : 0,
            processingTime: 0,
            wordBoxes,
          },
          'pymupdf',
        );
      }

      res.json({
        documentId,
        totalPages: extraction.totalPages,
        pagesExtracted: extraction.pages.length,
        pagesWithText,
      });
    } catch (error) {
      console.error('pymupdf-extract failed:', error);
      res.status(500).json({
        error: 'PyMuPDF extraction failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      try {
        await fs.remove(tempPath);
      } catch (cleanupErr) {
        devWarn('pymupdf-extract: failed to remove temp PDF', cleanupErr);
      }
    }
  },
);

/**
 * Auto-hyperlink pre-step (second half): run region-targeted OCR over circular
 * callout bubbles. Most architectural PDFs draw round detail-callout bubbles
 * as vector paths (stroked line segments forming the glyphs), so PDF.js and
 * MuPDF both miss the text inside them. This route detects each bubble with
 * OpenCV's HoughCircles, runs Tesseract on the small crop, validates the OCR
 * against sheet-ref regexes, and merges the survivors into ocr_results as
 * tesseract-sourced word boxes.
 *
 * Empirically ~1-2s/page on an 8-core laptop; an 80-page set lands ~1-3 min.
 */
router.post(
  '/bubble-ocr-extract/:documentId',
  requireAuth,
  validateUUIDParam('documentId'),
  async (req, res) => {
    req.setTimeout(15 * 60 * 1000);
    res.setTimeout(15 * 60 * 1000);

    const { documentId } = req.params;
    const { projectId } = req.body ?? {};

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const userIsAdmin = await isAdmin(req.user!.id);
    if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    const { data: documentData, error: documentError } = await supabase
      .from('takeoff_files')
      .select('filename, path')
      .eq('id', documentId)
      .eq('project_id', projectId)
      .single();

    if (documentError || !documentData?.path) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const { data: fileData, error: downloadError } = await supabase.storage
      .from('project-files')
      .download(documentData.path);

    if (downloadError || !fileData) {
      console.error('bubble-ocr-extract: failed to download PDF', downloadError);
      return res.status(500).json({ error: 'Failed to download PDF for bubble OCR' });
    }

    const tempDir = path.join(process.cwd(), 'server', 'temp', 'pdf-processing');
    await fs.ensureDir(tempDir);
    const tempPath = path.join(tempDir, `${documentId}-bubble-${uuidv4()}.pdf`);
    await fs.writeFile(tempPath, Buffer.from(await fileData.arrayBuffer()));

    try {
      const extraction = await bubbleOcrExtractor.extractAllPages(tempPath);
      let pagesWithCallouts = 0;
      let pagesMarked = 0;
      // Group merges per page so we hit `mergeWordBoxesForPage` once per page
      // (the merge dedupes against existing PDF.js/PyMuPDF boxes for us).
      //
      // IMPORTANT: even when a page has zero detected bubbles we still need to
      // *mark* it as bubble-OCR'd so the Auto-hyperlink preflight knows not to
      // re-run this pass on subsequent runs. We do that by writing an empty
      // sentinel word box (text: '', zero-sized bbox, source: 'bubble_ocr')
      // when there are no real callouts. Empty-text boxes are filtered out of
      // detection downstream, so they have no effect on results — they only
      // serve as a "we ran this" marker.
      for (const page of extraction.pages) {
        const bubbles = page.bubbles || [];
        const hasBubbles = bubbles.length > 0;
        if (hasBubbles) pagesWithCallouts += 1;

        const wordBoxes: OCRWordBox[] = bubbles
          .map((bubble, idx): OCRWordBox | null => {
            const w = bubble?.width ?? 0;
            const h = bubble?.height ?? 0;
            if (w <= 0 || h <= 0) return null;
            const text = typeof bubble.text === 'string' ? bubble.text.trim() : '';
            if (!text) return null;
            return {
              index: idx,
              text,
              confidence:
                typeof bubble.confidence === 'number' ? bubble.confidence : 0,
              bbox: { x: bubble.x, y: bubble.y, width: w, height: h },
              source: 'bubble_ocr',
            };
          })
          .filter((b): b is OCRWordBox => b != null);

        if (wordBoxes.length === 0) {
          // Sentinel marker so the preflight knows we processed this page.
          wordBoxes.push({
            index: 0,
            text: '',
            confidence: 0,
            bbox: { x: 0, y: 0, width: 0, height: 0 },
            source: 'bubble_ocr',
          });
        }

        await simpleOcrService.mergeWordBoxesForPage(
          projectId,
          documentId,
          {
            pageNumber: page.pageNumber,
            // Don't dump bubble text into text_content — it would pollute
            // the title-block text search results. Word boxes are enough
            // for the detection layer.
            text: '',
            confidence: 0,
            processingTime: 0,
            wordBoxes,
          },
          'bubble_ocr',
        );
        pagesMarked += 1;
      }

      devLog(
        `🫧 Bubble OCR: ${extraction.totalPages} pages, ${extraction.calloutsFound} callouts on ${pagesWithCallouts} page(s); marked ${pagesMarked} page(s) as bubble-OCR processed`
      );

      res.json({
        documentId,
        totalPages: extraction.totalPages,
        calloutsFound: extraction.calloutsFound,
        pagesWithCallouts,
        pagesMarked,
      });
    } catch (error) {
      console.error('bubble-ocr-extract failed:', error);
      res.status(500).json({
        error: 'Bubble OCR pass failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      try {
        await fs.remove(tempPath);
      } catch (cleanupErr) {
        devWarn('bubble-ocr-extract: failed to remove temp PDF', cleanupErr);
      }
    }
  },
);

// Background OCR processing function using OCR service
async function processDocumentOCR(documentPath: string, jobId: string, documentId: string, projectId: string) {
  try {
    devLog(`🚀 Starting OCR processing for document: ${documentId}`);
    
    // Use the simple OCR service to process the document
    const result = await simpleOcrService.processDocument(documentPath, projectId, documentId, jobId);
    
    devLog(`✅ OCR processing completed for ${documentId}: ${result.results.length} pages processed`);
    
  } catch (error) {
    console.error('❌ OCR processing failed:', error);
    
    // Update job status to failed in database
    try {
      await supabase
        .from('ocr_jobs')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          completed_at: new Date().toISOString()
        })
        .eq('id', jobId);
    } catch (updateError) {
      console.error('Failed to update job status to failed:', updateError);
    }
  }
}

/**
 * Trigger OCR for a document (e.g. after import). Fire-and-forget; swallows errors.
 */
export async function triggerOCRForDocument(projectId: string, documentId: string): Promise<void> {
  try {
    const jobId = await startOCRJob(projectId, documentId);
    if (jobId) devLog(`📄 OCR triggered for document ${documentId}`);
  } catch (error) {
    console.error(`OCR trigger failed for ${documentId}:`, error);
  }
}

export { router as ocrRoutes };
