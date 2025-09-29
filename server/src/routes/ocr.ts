import express from 'express';
import { createWorker } from 'tesseract.js';
import path from 'path';
import fs from 'fs-extra';
import pdf2pic from 'pdf2pic';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// In-memory storage for OCR progress and results
// In production, this should be stored in a database
const ocrJobs = new Map<string, {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  totalPages: number;
  processedPages: number;
  results: Array<{
    pageNumber: number;
    text: string;
    confidence: number;
    processingTime: number;
  }>;
  error?: string;
  startTime: Date;
}>();

// Process entire document with OCR
router.post('/process-document/:documentId', async (req, res) => {
  const { documentId } = req.params;
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  try {
    // Check if document exists
    const documentPath = path.join(__dirname, `../../uploads/${projectId}/${documentId}`);
    if (!fs.existsSync(documentPath)) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Initialize OCR job
    const jobId = uuidv4();
    ocrJobs.set(jobId, {
      status: 'pending',
      progress: 0,
      totalPages: 0,
      processedPages: 0,
      results: [],
      startTime: new Date()
    });

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
router.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = ocrJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    jobId,
    status: job.status,
    progress: job.progress,
    totalPages: job.totalPages,
    processedPages: job.processedPages,
    results: job.results,
    error: job.error,
    startTime: job.startTime
  });
});

// Search OCR results
router.get('/search/:documentId', async (req, res) => {
  const { documentId } = req.params;
  const { query } = req.query;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    // Find completed OCR job for this document
    const job = Array.from(ocrJobs.values()).find(j => 
      j.status === 'completed' && j.results.length > 0
    );

    if (!job) {
      return res.status(404).json({ error: 'No OCR data available for this document' });
    }

    // Search through results
    const searchResults = job.results
      .map(result => {
        const text = result.text.toLowerCase();
        const queryLower = query.toLowerCase();
        const matches = [];
        let index = text.indexOf(queryLower);
        
        while (index !== -1) {
          const start = Math.max(0, index - 50);
          const end = Math.min(text.length, index + query.length + 50);
          const snippet = result.text.substring(start, end);
          
          matches.push({
            snippet,
            position: index,
            confidence: result.confidence
          });
          
          index = text.indexOf(queryLower, index + 1);
        }

        return {
          pageNumber: result.pageNumber,
          matches,
          totalMatches: matches.length
        };
      })
      .filter(result => result.totalMatches > 0)
      .sort((a, b) => b.totalMatches - a.totalMatches);

    res.json({
      query,
      totalResults: searchResults.reduce((sum, result) => sum + result.totalMatches, 0),
      results: searchResults
    });

  } catch (error) {
    console.error('Error searching OCR results:', error);
    res.status(500).json({ error: 'Failed to search OCR results' });
  }
});

// Background OCR processing function
async function processDocumentOCR(documentPath: string, jobId: string, documentId: string, projectId: string) {
  const job = ocrJobs.get(jobId);
  if (!job) return;

  try {
    job.status = 'processing';
    
    // Convert PDF to images
    const convert = pdf2pic.fromPath(documentPath, {
      density: 300,
      saveFilename: 'page',
      savePath: path.join(__dirname, `../../temp/${jobId}`),
      format: 'png',
      width: 2000,
      height: 2000
    });

    // Get total pages
    const pdfInfo = await convert.bulk(-1, { responseType: 'base64' });
    job.totalPages = pdfInfo.length;

    // Initialize Tesseract worker
    const worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const progress = Math.round(m.progress * 100);
          if (progress % 10 === 0) { // Log every 10%
            console.log(`OCR Progress for ${documentId}: ${progress}%`);
          }
        }
      }
    });

    // Process pages in parallel batches
    const batchSize = 4; // Process 4 pages at a time
    const results = [];

    for (let i = 0; i < pdfInfo.length; i += batchSize) {
      const batch = pdfInfo.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (pageInfo, batchIndex) => {
        const pageNumber = i + batchIndex + 1;
        const startTime = Date.now();
        
        try {
          // Convert base64 to buffer
          const imageBuffer = Buffer.from(pageInfo.base64, 'base64');
          
          // Perform OCR
          const { data: { text, confidence } } = await worker.recognize(imageBuffer);
          
          const processingTime = Date.now() - startTime;
          
          return {
            pageNumber,
            text: text.trim(),
            confidence: Math.round(confidence),
            processingTime
          };
        } catch (error) {
          console.error(`Error processing page ${pageNumber}:`, error);
          return {
            pageNumber,
            text: '',
            confidence: 0,
            processingTime: Date.now() - startTime
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Update progress
      job.processedPages = results.length;
      job.progress = Math.round((results.length / pdfInfo.length) * 100);
      
      console.log(`Processed ${results.length}/${pdfInfo.length} pages (${job.progress}%)`);
    }

    // Clean up worker
    await worker.terminate();

    // Update job with results
    job.results = results.sort((a, b) => a.pageNumber - b.pageNumber);
    job.status = 'completed';
    job.progress = 100;

    // Clean up temp files
    const tempDir = path.join(__dirname, `../../temp/${jobId}`);
    if (fs.existsSync(tempDir)) {
      fs.removeSync(tempDir);
    }

    console.log(`OCR processing completed for ${documentId}: ${results.length} pages processed`);

  } catch (error) {
    console.error('OCR processing failed:', error);
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
  }
}

export { router as ocrRoutes };
