/**
 * CV Takeoff API Routes
 * 
 * Provides endpoints for computer vision-based boundary detection takeoff
 */

import express from 'express';
import { cvTakeoffService } from '../services/cvTakeoffService';
import { storage } from '../storage';
import { supabase, TABLES } from '../supabase';

const router = express.Router();

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
    res.json({
      success: true,
      available,
      message: available 
        ? 'CV takeoff service is available' 
        : 'CV takeoff service requires Python 3 and OpenCV',
      details
    });
  } catch (error) {
    console.error('Error checking CV takeoff status:', error);
    res.status(500).json({
      success: false,
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error'
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
    console.error('CV detection test failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'CV detection test failed. Please ensure Python 3 and OpenCV are installed.'
    });
  }
});

// Process a single page
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

    console.log(`🔍 Processing page ${pageNumber} of document ${documentId} for CV takeoff`);

    const result = await cvTakeoffService.processPage(
      documentId,
      pageNumber,
      projectId,
      scaleFactor,
      options || {}
    );

    res.json({
      success: true,
      result,
      message: `Processed page ${pageNumber}: ${result.conditionsCreated} conditions, ${result.measurementsCreated} measurements`
    });

  } catch (error) {
    console.error('Error processing page:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
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
    console.error('Error processing pages:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;

