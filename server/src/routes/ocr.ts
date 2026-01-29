import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../supabase';
import { simpleOcrService } from '../services/simpleOcrService';
import { requireAuth, hasProjectAccess, isAdmin, validateUUIDParam } from '../middleware';

const router = express.Router();



// Process entire document with OCR
router.post('/process-document/:documentId', requireAuth, validateUUIDParam('documentId'), async (req, res) => {
  const { documentId } = req.params;
  const { projectId } = req.body;

  console.log('🔍 OCR Request received:', { documentId, projectId });

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  // Verify user has access to this project
  const userIsAdmin = await isAdmin(req.user!.id);
  if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
    return res.status(404).json({ error: 'Project not found or access denied' });
  }

  try {
    // Get document info from database to find the Supabase Storage path
    const { data: documentData, error: documentError } = await supabase
      .from('takeoff_files')
      .select('filename, path')
      .eq('id', documentId)
      .eq('project_id', projectId)
      .single();

    if (documentError || !documentData) {
      console.error('Document lookup failed:', documentError);
      return res.status(404).json({ error: 'Document not found' });
    }

    // Download PDF from Supabase Storage to temporary location for processing
    const storagePath = documentData.path;
    console.log('Downloading PDF from Supabase Storage:', storagePath);
    
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('project-files')
      .download(storagePath);
    
    if (downloadError || !fileData) {
      console.error('Document file not found in Supabase Storage:', downloadError);
      return res.status(404).json({ error: 'Document file not found in storage' });
    }
    
    // Save to temporary file for OCR processing
    const tempDir = path.join(process.cwd(), 'server', 'temp', 'pdf-processing');
    await fs.ensureDir(tempDir);
    const documentPath = path.join(tempDir, `${documentId}.pdf`);
    
    const arrayBuffer = await fileData.arrayBuffer();
    await fs.writeFile(documentPath, Buffer.from(arrayBuffer));
    
    console.log('PDF downloaded to temporary location for OCR:', documentPath);

    // Check if document is already processed
    const isProcessed = await simpleOcrService.isDocumentProcessed(projectId, documentId);
    if (isProcessed) {
      // Allow re-processing by clearing existing results
      console.log('🔄 Document already processed, clearing existing results for re-processing...');
      await simpleOcrService.clearDocumentResults(projectId, documentId);
    }

    // Create OCR job in database
    const jobId = uuidv4();
    const { data: jobData, error: jobError } = await supabase
      .from('ocr_jobs')
      .insert({
        id: jobId,
        project_id: projectId,
        document_id: documentId,
        status: 'pending',
        progress: 0,
        total_pages: 0,
        processed_pages: 0
      })
      .select()
      .single();

    if (jobError) {
      console.error('Failed to create OCR job:', jobError);
      console.error('Job data attempted:', {
        id: jobId,
        project_id: projectId,
        document_id: documentId,
        status: 'pending',
        progress: 0,
        total_pages: 0,
        processed_pages: 0
      });
      return res.status(500).json({ 
        error: 'Failed to create OCR job',
        details: jobError.message,
        code: jobError.code
      });
    }

    // Start processing in background
    processDocumentOCR(documentPath, jobId, documentId, projectId);

    res.json({ 
      jobId,
      message: 'OCR processing started',
      status: 'pending'
    });

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

// Search OCR results
router.get('/search/:documentId', requireAuth, validateUUIDParam('documentId'), async (req, res) => {
  const { documentId } = req.params;
  const { query, projectId } = req.query;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Search query is required' });
  }

  if (!projectId || typeof projectId !== 'string') {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
      // Search OCR results using the simple OCR service
      const searchResults = await simpleOcrService.searchOCRResults(projectId, documentId, query);
      
      console.log(`🔍 Raw search results from database:`, searchResults.map(r => ({ page_number: r.page_number, text_preview: r.text_content.substring(0, 50) })));

    // Format results for frontend
    const formattedResults = searchResults.map(result => {
      const text = result.text_content.toLowerCase();
      const queryLower = query.toLowerCase();
      const matches = [];
      let index = text.indexOf(queryLower);
      
      while (index !== -1) {
        const start = Math.max(0, index - 50);
        const end = Math.min(text.length, index + query.length + 50);
        const snippet = result.text_content.substring(start, end);
        
        matches.push({
          snippet,
          position: index,
          confidence: result.confidence_score
        });
        
        index = text.indexOf(queryLower, index + 1);
      }

      return {
        pageNumber: result.page_number,
        matches,
        totalMatches: matches.length,
        method: result.processing_method,
        processingTime: result.processing_time_ms
      };
    }).filter(result => result.totalMatches > 0)
      .sort((a, b) => b.totalMatches - a.totalMatches);

    console.log(`📊 Formatted results being sent to frontend:`, formattedResults.map(r => ({ pageNumber: r.pageNumber, totalMatches: r.totalMatches })));

    res.json({
      query,
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

    // Convert client-side OCR results to server format
    const serverResults = results.map((result: any) => ({
      pageNumber: result.pageNumber,
      text: result.text || '',
      confidence: result.confidence || 0,
      processingTime: result.processingTime || 0,
      method: 'tesseract' as const // Client-side uses Tesseract.js
    }));

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


export { router as ocrRoutes };
