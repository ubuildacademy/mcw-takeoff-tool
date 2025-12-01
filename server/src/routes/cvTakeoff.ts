/**
 * CV Takeoff API Routes
 * 
 * Provides endpoints for computer vision-based boundary detection takeoff
 */

import express from 'express';
import { cvTakeoffService } from '../services/cvTakeoffService';
import { storage } from '../storage';
import { supabase, TABLES } from '../supabase';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// In-memory job storage for CV takeoff processing
// In production, you might want to use Redis or a database
interface CVTakeoffJob {
  id: string;
  documentId: string;
  pageNumber: number;
  projectId: string;
  scaleFactor: number;
  options?: any; // Store options from request
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  result?: any;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

const cvTakeoffJobs = new Map<string, CVTakeoffJob>();

// Background processing function
async function processCVTakeoffJob(jobId: string) {
  const job = cvTakeoffJobs.get(jobId);
  if (!job) {
    console.error(`❌ Job ${jobId} not found`);
    return;
  }

  try {
    job.status = 'processing';
    job.progress = 10;
    job.startedAt = new Date();

    console.log(`🔄 Processing CV takeoff job ${jobId} for page ${job.pageNumber}`);

    // Use options from job, or default to detecting all elements
    const options = job.options || {
      detectRooms: true,
      detectWalls: true,
      detectDoors: true,
      detectWindows: true
    };

    const result = await cvTakeoffService.processPage(
      job.documentId,
      job.pageNumber,
      job.projectId,
      job.scaleFactor,
      options
    );

    job.status = 'completed';
    job.progress = 100;
    job.result = result;
    job.completedAt = new Date();

    console.log(`✅ CV takeoff job ${jobId} completed successfully`);
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    job.completedAt = new Date();
    console.error(`❌ CV takeoff job ${jobId} failed:`, job.error);
  }
}

// Helper function to get authenticated user
async function getAuthenticatedUser(req: express.Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return null;
  }
  
  return user;
}

// Check CV takeoff service availability
router.get('/status', async (req, res) => {
  try {
    const available = await cvTakeoffService.isAvailable();
    const details = await cvTakeoffService.getStatusDetails();
    
    // Add diagnostic information
    const diagnostics = {
      platform: process.platform,
      nodeVersion: process.version,
      cwd: process.cwd(),
      currentPath: process.env.PATH,
      pythonAvailable: details.pythonAvailable,
      opencvAvailable: details.opencvAvailable,
      pythonVersion: details.pythonVersion,
      opencvVersion: details.opencvVersion,
      error: details.error
    };
    
    res.json({
      success: true,
      available,
      message: available 
        ? 'CV takeoff service is available' 
        : 'CV takeoff service requires Python 3 and OpenCV',
      details: {
        ...details,
        diagnostics
      }
    });
  } catch (error) {
    const errorDetails = {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      platform: process.platform,
      nodeVersion: process.version
    };
    console.error('Error checking CV takeoff status:', JSON.stringify(errorDetails, null, 2));
    res.status(500).json({
      success: false,
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      details: errorDetails
    });
  }
});

// Test CV detection with a sample (for verification)
router.post('/test', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Create a simple test image (white square with black border)
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    
    // Test boundary detection with a minimal scale factor
    const { boundaryDetectionService } = await import('../services/boundaryDetectionService');
    const result = await boundaryDetectionService.detectBoundaries(
      testImageBase64,
      0.0833, // Default scale factor
      { minRoomArea: 1, minWallLength: 1 }
    );

    res.json({
      success: true,
      message: 'CV detection test successful',
      result: {
        roomsDetected: result.rooms.length,
        wallsDetected: result.walls.length,
        doorsDetected: result.doors.length,
        windowsDetected: result.windows.length,
        processingTime: result.processingTime
      }
    });
  } catch (error) {
    const errorDetails = {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      platform: process.platform,
      nodeVersion: process.version
    };
    console.error('CV detection test failed:', JSON.stringify(errorDetails, null, 2));
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'CV detection test failed. Please ensure Python 3 and OpenCV are installed.',
      details: errorDetails
    });
  }
});

// Process a single page (async - returns job ID immediately)
router.post('/process-page', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { documentId, pageNumber, projectId, scaleFactor, options } = req.body;

    // Validate required fields
    if (!documentId || !pageNumber || !projectId || scaleFactor === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: documentId, pageNumber, projectId, and scaleFactor are required'
      });
    }

    // Check if user has access to this project
    const { data: project, error: projectError } = await supabase
      .from(TABLES.PROJECTS)
      .select('id, user_id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    // Create job
    const jobId = uuidv4();
    const job: CVTakeoffJob = {
      id: jobId,
      documentId,
      pageNumber,
      projectId,
      scaleFactor,
      options: options || {
        detectRooms: true,
        detectWalls: true,
        detectDoors: true,
        detectWindows: true
      },
      status: 'pending',
      progress: 0,
      startedAt: new Date()
    };

    cvTakeoffJobs.set(jobId, job);

    // Start processing in background (don't await)
    processCVTakeoffJob(jobId).catch(error => {
      console.error(`❌ Background processing error for job ${jobId}:`, error);
    });

    // Return immediately with job ID
    res.json({
      success: true,
      jobId,
      status: 'pending',
      message: `CV takeoff processing started for page ${pageNumber}`
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Error starting CV takeoff job:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// Get job status
router.get('/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = cvTakeoffJobs.get(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      result: job.result,
      error: job.error,
      startedAt: job.startedAt,
      completedAt: job.completedAt
    });
  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

// Process multiple pages
router.post('/process-pages', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { documentId, pageNumbers, projectId, scaleFactor, options } = req.body;

    // Validate required fields
    if (!documentId || !pageNumbers || !projectId || scaleFactor === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: documentId, pageNumbers, projectId, and scaleFactor are required'
      });
    }

    if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) {
      return res.status(400).json({
        error: 'pageNumbers must be a non-empty array'
      });
    }

    // Check if user has access to this project
    const { data: project, error: projectError } = await supabase
      .from(TABLES.PROJECTS)
      .select('id, user_id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    console.log(`🔍 Processing ${pageNumbers.length} pages for CV takeoff`);

    const result = await cvTakeoffService.processPages(
      documentId,
      pageNumbers,
      projectId,
      scaleFactor,
      options || {}
    );

    res.json({
      success: result.success,
      result,
      message: `Processed ${pageNumbers.length} pages: ${result.conditionsCreated} conditions, ${result.measurementsCreated} measurements`
    });

  } catch (error) {
    const { documentId, pageNumbers, projectId, scaleFactor } = req.body || {};
    const errorDetails = {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      documentId,
      pageNumbers,
      projectId,
      scaleFactor,
      platform: process.platform,
      nodeVersion: process.version
    };
    console.error('Error processing pages:', JSON.stringify(errorDetails, null, 2));
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      details: errorDetails
    });
  }
});

export default router;

