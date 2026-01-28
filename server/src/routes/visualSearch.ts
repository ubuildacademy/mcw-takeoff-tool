/**
 * Auto-Count API Routes
 * 
 * Handles auto-count operations for symbol detection and matching
 */

import { Router } from 'express';
import { autoCountService } from '../services/visualSearchService';
import { storage } from '../storage';
import fs from 'fs-extra';
import path from 'path';

const router = Router();

// Extract symbol template from selection box
router.post('/extract-template', async (req, res) => {
  try {
    const { pdfFileId, pageNumber, selectionBox } = req.body;

    if (!pdfFileId || !pageNumber || !selectionBox) {
      return res.status(400).json({
        error: 'Missing required fields: pdfFileId, pageNumber, and selectionBox are required'
      });
    }

    const template = await autoCountService.extractSymbolTemplate(
      pdfFileId,
      pageNumber,
      selectionBox
    );

    return res.json({
      success: true,
      template
    });
  } catch (error) {
    console.error('Error extracting symbol template:', error);
    return res.status(500).json({ error: 'Failed to extract symbol template' });
  }
});

// Search for symbols matching a template
router.post('/search-symbols', async (req, res) => {
  try {
    const { conditionId, pdfFileId, template, options, pageNumber } = req.body;

    if (!conditionId || !pdfFileId || !template) {
      return res.status(400).json({
        error: 'Missing required fields: conditionId, pdfFileId, and template are required'
      });
    }

    const result = await autoCountService.searchForSymbols(
      conditionId,
      pdfFileId,
      template,
      options,
      pageNumber
    );

    return res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('Error searching for symbols:', error);
    return res.status(500).json({ error: 'Failed to search for symbols' });
  }
});

// Complete auto-count workflow with Server-Sent Events for real-time progress
router.post('/complete-search', async (req, res) => {
  // Check if client wants SSE (via Accept header or query param)
  const wantsSSE = req.headers.accept?.includes('text/event-stream') || req.query.sse === 'true';
  
  if (wantsSSE) {
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    
    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    
    // Handle client disconnect
    req.on('close', () => {
      console.log('⚠️ Client disconnected from SSE stream (connection closed by client)');
      // Don't call res.end() here - it may already be closed
    });
    
    // Handle errors on the response stream
    res.on('error', (error) => {
      console.error('❌ SSE response stream error:', error);
    });
    
    // Handle response finish
    res.on('finish', () => {
      console.log('✅ SSE response stream finished');
    });
  }
  
  const sendProgress = (progress: { current: number; total: number; currentPage?: number; currentDocument?: string }) => {
    if (wantsSSE) {
      res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
    }
  };
  
  const sendError = (error: string) => {
    if (wantsSSE) {
      res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`);
      res.end();
    }
  };
  
  const sendComplete = (result: any) => {
    if (wantsSSE) {
      try {
        const completeMessage = { type: 'complete', ...result };
        console.log('📤 Sending SSE complete message:', JSON.stringify(completeMessage, null, 2));
        const message = `data: ${JSON.stringify(completeMessage)}\n\n`;
        res.write(message);
        // Ensure the stream is properly flushed before ending
        if (typeof res.flush === 'function') {
          res.flush();
        }
        console.log('✅ SSE complete message sent, closing connection');
        res.end();
      } catch (error) {
        console.error('❌ Error sending SSE complete message:', error);
        // Try to send error instead
        try {
          res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to send completion' })}\n\n`);
          res.end();
        } catch (e) {
          console.error('❌ Failed to send error message:', e);
        }
      }
    }
  };
  
  try {
    const { 
      conditionId, 
      pdfFileId, 
      pageNumber, 
      selectionBox, 
      projectId, 
      sheetId, 
      options 
    } = req.body;

    if (!conditionId || !pdfFileId || !pageNumber || !selectionBox || !projectId || !sheetId) {
      return res.status(400).json({
        error: 'Missing required fields: conditionId, pdfFileId, pageNumber, selectionBox, projectId, and sheetId are required'
      });
    }

    console.log('🔍 Starting complete auto-count workflow...');
    console.log('📋 Request details:', {
      conditionId,
      pdfFileId,
      pageNumber,
      selectionBox,
      projectId,
      sheetId,
      options
    });

    // Check if condition already has measurements (prevent re-running)
    const measurements = await storage.getTakeoffMeasurements();
    const existingMeasurements = measurements.filter(m => m.conditionId === conditionId);
    if (existingMeasurements.length > 0) {
      console.log(`⚠️ Condition ${conditionId} already has ${existingMeasurements.length} measurements`);
      const errorMsg = 'This condition already has measurements. Please delete the condition and recreate it to run a new search.';
      if (wantsSSE) {
        sendError(errorMsg);
        return;
      }
      return res.status(400).json({
        error: errorMsg,
        existingCount: existingMeasurements.length
      });
    }

    // Get condition info for color and name
    const conditions = await storage.getConditions();
    const condition = conditions.find(c => c.id === conditionId);
    if (!condition) {
      console.error(`❌ Condition ${conditionId} not found`);
      const errorMsg = 'Condition not found';
      if (wantsSSE) {
        sendError(errorMsg);
        return;
      }
      return res.status(404).json({ error: errorMsg });
    }

    console.log(`✅ Found condition: ${condition.name} (type: ${condition.type})`);

    // Step 1: Extract symbol template (pass projectId for PDF download)
    console.log('📦 Step 1: Extracting symbol template from selection box...');
    console.log('📐 Selection box:', selectionBox);
    const template = await autoCountService.extractSymbolTemplate(
      pdfFileId,
      pageNumber,
      selectionBox,
      projectId
    );

    // Step 1.5: Save the template image to the condition so it can be displayed in the UI
    // template.imageData is a file path, so we need to read it and convert to base64
    if (template.imageData) {
      try {
        // Check if it's already base64 (starts with data: or is a long base64 string)
        // or if it's a file path (starts with / or contains path separators)
        let base64Image: string;
        
        if (template.imageData.startsWith('data:') || template.imageData.startsWith('/') || template.imageData.includes(path.sep)) {
          // It's a file path, read and convert to base64
          if (await fs.pathExists(template.imageData)) {
            const imageBuffer = await fs.readFile(template.imageData);
            base64Image = imageBuffer.toString('base64');
          } else {
            console.warn('⚠️ Template image file not found:', template.imageData);
            // Skip saving if file doesn't exist
            base64Image = '';
          }
        } else {
          // Assume it's already base64
          base64Image = template.imageData;
        }
        
        if (base64Image) {
          const conditions = await storage.getConditions();
          const existingCondition = conditions.find(c => c.id === conditionId);
          if (existingCondition) {
            const updatedCondition = {
              ...existingCondition,
              searchImage: base64Image,
              searchImageId: template.id
            };
            await storage.saveCondition(updatedCondition);
            console.log('✅ Saved template image to condition (base64)');
          }
        }
      } catch (error) {
        console.error('⚠️ Failed to save template image to condition:', error);
        // Don't fail the whole workflow if saving the image fails
      }
    }

    // Step 3: Search for matching symbols (pass pageNumber, projectId, and searchScope)
    const searchScope = condition.searchScope || 'current-page';
    console.log(`🔎 Step 3: Searching for matching symbols (scope: ${searchScope})...`);
    console.log('⚙️ Search options:', options);
    
    // Send initial progress update
    if (wantsSSE) {
      sendProgress({ current: 0, total: 1, currentPage: pageNumber });
    }
    
    const searchResult = await autoCountService.searchForSymbols(
      conditionId,
      pdfFileId,
      template,
      options,
      pageNumber,
      projectId,
      searchScope as 'current-page' | 'entire-document' | 'entire-project',
      sendProgress // Pass the SSE progress function
    );

    // Step 4: Create count measurements with condition's color and name
    console.log(`📝 Step 4: Creating ${searchResult.matches.length} count measurements...`);
    if (wantsSSE) {
      sendProgress({ 
        current: searchResult.totalMatches, 
        total: searchResult.totalMatches,
        currentPage: pageNumber 
      });
    }
    
    try {
      await autoCountService.createCountMeasurements(
        conditionId,
        searchResult.matches,
        projectId,
        sheetId,
        condition.color,
        condition.name,
        condition.unit
      );
    } catch (measurementError) {
      console.error('❌ Error creating measurements:', measurementError);
      // Even if measurement creation fails, we should still send the search results
      // The user can see what was found even if we couldn't save it
      if (wantsSSE) {
        sendError(`Failed to create measurements: ${measurementError instanceof Error ? measurementError.message : String(measurementError)}`);
        return;
      } else {
        return res.status(500).json({
          error: 'Failed to create measurements',
          details: measurementError instanceof Error ? measurementError.message : String(measurementError),
          result: searchResult // Include search results even on error
        });
      }
    }

    console.log(`✅ Auto-count workflow complete: ${searchResult.totalMatches} matches found and ${searchResult.totalMatches} measurements created`);

    // Send completion via SSE or regular JSON
    if (wantsSSE) {
      console.log('📤 About to send complete message via SSE...');
      sendComplete({
        success: true,
        result: searchResult,
        measurementsCreated: searchResult.totalMatches
      });
      console.log('✅ Complete message sent');
    } else {
      return res.json({
        success: true,
        result: searchResult,
        measurementsCreated: searchResult.totalMatches
      });
    }
  } catch (error) {
    console.error('❌ Error in complete auto-count workflow:', error);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('❌ Error details:', {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Unknown',
      type: typeof error
    });
    
    if (wantsSSE) {
      try {
        sendError(error instanceof Error ? error.message : String(error));
      } catch (sseError) {
        console.error('❌ Failed to send SSE error message:', sseError);
        // Connection might already be closed, try to end it gracefully
        try {
          res.end();
        } catch (e) {
          // Ignore - connection is already closed
        }
      }
    } else {
      return res.status(500).json({ 
        error: 'Auto-count workflow failed',
        details: error instanceof Error ? error.message : String(error),
        stack: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined
      });
    }
  }
});

// Get auto-count results for a condition
router.get('/results/:conditionId', async (req, res) => {
  try {
    const { conditionId } = req.params;

    // Get measurements for this condition
    const measurements = await storage.getTakeoffMeasurements();
    const conditionMeasurements = measurements.filter(m => m.conditionId === conditionId);

    return res.json({
      success: true,
      measurements: conditionMeasurements,
      count: conditionMeasurements.length
    });
  } catch (error) {
    console.error('Error getting auto-count results:', error);
    return res.status(500).json({ error: 'Failed to get auto-count results' });
  }
});

// Get match thumbnails for a visual search condition
router.get('/thumbnails/:conditionId', async (req, res) => {
  try {
    const { conditionId } = req.params;
    const { projectId } = req.query;
    const maxThumbnails = parseInt(req.query.maxThumbnails as string) || 6;

    if (!projectId || typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId query parameter is required' });
    }

    const thumbnails = await autoCountService.extractMatchThumbnails(
      conditionId,
      projectId,
      maxThumbnails
    );

    return res.json({
      success: true,
      thumbnails
    });
  } catch (error) {
    console.error('Error getting match thumbnails:', error);
    return res.status(500).json({ error: 'Failed to get match thumbnails' });
  }
});

export default router;
