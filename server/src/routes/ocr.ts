import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../supabase';
import { simpleOcrService, type SimpleOCRResult } from '../services/simpleOcrService';
import { requireAuth, hasProjectAccess, isAdmin, validateUUIDParam, isValidUUID } from '../middleware';

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
        console.log('OCR search: db results', {
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

    console.log(`📊 Formatted results being sent to frontend:`, formattedResults.map(r => ({ pageNumber: r.pageNumber, totalMatches: r.totalMatches })));

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
      console.log(`🔍 Backend: Getting OCR results for document ${documentId} in project ${projectId}`);
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
      
      console.log(`📊 Backend: OCR results retrieved:`, {
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
    console.log(`🗑️ Clearing OCR results for document: ${documentId}`);
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
    console.log(`📥 Receiving client-side OCR results for document: ${documentId} (${results.length} pages)`);

    const serverResults: SimpleOCRResult[] = results.map((result: Record<string, unknown>) => {
      const pageNumber = typeof result.pageNumber === 'number' ? result.pageNumber : Number(result.pageNumber);
      return {
        pageNumber: Number.isFinite(pageNumber) ? pageNumber : 0,
        text: typeof result.text === 'string' ? result.text : '',
        confidence: typeof result.confidence === 'number' ? result.confidence : 0,
        processingTime: typeof result.processingTime === 'number' ? result.processingTime : 0,
        method: 'tesseract' as const,
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

    console.log(`✅ Client-side OCR results saved: ${results.length} pages`);

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

// Background OCR processing function using OCR service
async function processDocumentOCR(documentPath: string, jobId: string, documentId: string, projectId: string) {
  try {
    console.log(`🚀 Starting OCR processing for document: ${documentId}`);
    
    // Use the simple OCR service to process the document
    const result = await simpleOcrService.processDocument(documentPath, projectId, documentId, jobId);
    
    console.log(`✅ OCR processing completed for ${documentId}: ${result.results.length} pages processed`);
    
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
    if (jobId) console.log(`📄 OCR triggered for document ${documentId}`);
  } catch (error) {
    console.error(`OCR trigger failed for ${documentId}:`, error);
  }
}

export { router as ocrRoutes };
