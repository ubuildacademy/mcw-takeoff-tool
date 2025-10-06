import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../supabase';
import { simpleOcrService } from '../services/simpleOcrService';

const router = express.Router();

// Test endpoint to check if OCR tables exist (useful for verification)
router.get('/test-tables', async (req, res) => {
  try {
    const results: any = {};
    
    // Test if ocr_jobs table exists
    const { data: jobsData, error: jobsError } = await supabase
      .from('ocr_jobs')
      .select('*')
      .limit(1);
    
    results.ocr_jobs = {
      exists: !jobsError,
      error: jobsError?.message,
      code: jobsError?.code
    };
    
    // Test if ocr_results table exists
    const { data: resultsData, error: resultsError } = await supabase
      .from('ocr_results')
      .select('*')
      .limit(1);
    
    results.ocr_results = {
      exists: !resultsError,
      error: resultsError?.message,
      code: resultsError?.code
    };
    
    res.json(results);
  } catch (error) {
    res.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});


// Process entire document with OCR
router.post('/process-document/:documentId', async (req, res) => {
  const { documentId } = req.params;
  const { projectId } = req.body;

  console.log('🔍 OCR Request received:', { documentId, projectId });

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    // Get document info from database to find the actual file path
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

    // Check if document file exists
    const documentPath = documentData.path;
    if (!fs.existsSync(documentPath)) {
      console.error('Document file not found at path:', documentPath);
      return res.status(404).json({ error: 'Document file not found' });
    }

    // Check if document is already processed
    const isProcessed = await simpleOcrService.isDocumentProcessed(projectId, documentId);
    if (isProcessed) {
      return res.json({
        jobId: null,
        message: 'Document already processed',
        status: 'completed',
        alreadyProcessed: true
      });
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
router.get('/status/:jobId', async (req, res) => {
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
router.get('/search/:documentId', async (req, res) => {
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
router.get('/results/:documentId', async (req, res) => {
  const { documentId } = req.params;
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    const results = await simpleOcrService.getDocumentOCRResults(projectId, documentId);
    
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

// Get OCR training data
router.get('/training-data', async (req, res) => {
  const { projectId } = req.query;

  try {
    let query = supabase
      .from('ocr_training_data')
      .select('*')
      .order('created_at', { ascending: false });

    // Handle special case for "global" - show all data
    if (projectId && typeof projectId === 'string' && projectId !== 'global') {
      query = query.eq('project_id', projectId);
    }

    const { data, error } = await query.limit(1000);

    if (error) {
      console.error('Failed to fetch training data:', error);
      return res.status(500).json({ error: 'Failed to fetch training data' });
    }

    res.json({
      trainingData: data || [],
      totalEntries: data?.length || 0
    });
  } catch (error) {
    console.error('Error fetching training data:', error);
    res.status(500).json({ error: 'Failed to fetch training data' });
  }
});

// Update OCR training data
router.put('/training-data/:id', async (req, res) => {
  const { id } = req.params;
  const { correctedText, userValidated, corrections } = req.body;

  try {
    console.log('📝 Updating training data entry:', { id, correctedText, userValidated });

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (correctedText !== undefined) {
      updateData.corrected_text = correctedText;
    }
    if (userValidated !== undefined) {
      updateData.user_validated = userValidated;
    }
    if (corrections !== undefined) {
      updateData.corrections = corrections;
    }

    const { data, error } = await supabase
      .from('ocr_training_data')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Failed to update training data:', error);
      return res.status(500).json({ error: 'Failed to update training data' });
    }

    console.log('✅ Successfully updated training data entry:', data);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error updating training data:', error);
    res.status(500).json({ error: 'Failed to update training data' });
  }
});

// Get training statistics
router.get('/training-stats', async (req, res) => {
  const { projectId } = req.query;

  try {
    let query = supabase
      .from('ocr_training_data')
      .select('*');

    // Handle special case for "global" - show all data
    if (projectId && typeof projectId === 'string' && projectId !== 'global') {
      query = query.eq('project_id', projectId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch training stats:', error);
      return res.status(500).json({ error: 'Failed to fetch training stats' });
    }

    const trainingData = data || [];
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const fieldTypeStats: Record<string, number> = {};
    let totalConfidence = 0;
    let highConfidence = 0;
    let mediumConfidence = 0;
    let lowConfidence = 0;
    let recentActivity = 0;

    trainingData.forEach((entry: any) => {
      // Field type stats
      fieldTypeStats[entry.field_type] = (fieldTypeStats[entry.field_type] || 0) + 1;

      // Confidence stats
      totalConfidence += entry.confidence || 0;
      if (entry.confidence > 80) highConfidence++;
      else if (entry.confidence >= 50) mediumConfidence++;
      else lowConfidence++;

      // Recent activity
      if (entry.created_at && new Date(entry.created_at) > sevenDaysAgo) {
        recentActivity++;
      }
    });

    const stats = {
      totalEntries: trainingData.length,
      fieldTypeStats,
      confidenceStats: {
        average: trainingData.length > 0 ? totalConfidence / trainingData.length : 0,
        high: highConfidence,
        medium: mediumConfidence,
        low: lowConfidence
      },
      recentActivity
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching training stats:', error);
    res.status(500).json({ error: 'Failed to fetch training stats' });
  }
});

export { router as ocrRoutes };
