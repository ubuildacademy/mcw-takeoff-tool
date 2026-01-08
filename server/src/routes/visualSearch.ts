/**
 * Visual Search API Routes
 * 
 * Handles visual search operations for symbol detection and matching
 */

import { Router } from 'express';
import { visualSearchService } from '../services/visualSearchService';
import { storage } from '../storage';

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

    const template = await visualSearchService.extractSymbolTemplate(
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

    const result = await visualSearchService.searchForSymbols(
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

// Complete visual search workflow: extract template, search, and create measurements
router.post('/complete-search', async (req, res) => {
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

    console.log('🔍 Starting complete visual search workflow...');

    // Check if condition already has measurements (prevent re-running)
    const measurements = await storage.getTakeoffMeasurements();
    const existingMeasurements = measurements.filter(m => m.conditionId === conditionId);
    if (existingMeasurements.length > 0) {
      return res.status(400).json({
        error: 'This condition already has measurements. Please delete the condition and recreate it to run a new search.',
        existingCount: existingMeasurements.length
      });
    }

    // Get condition info for color and name
    const conditions = await storage.getConditions();
    const condition = conditions.find(c => c.id === conditionId);
    if (!condition) {
      return res.status(404).json({ error: 'Condition not found' });
    }

    // Step 1: Extract symbol template (pass projectId for PDF download)
    const template = await visualSearchService.extractSymbolTemplate(
      pdfFileId,
      pageNumber,
      selectionBox,
      projectId
    );

    // Step 2: Save template image to condition (as base64 reference)
    // Read the template image file and convert to base64
    try {
      const fs = require('fs-extra');
      if (await fs.pathExists(template.imageData)) {
        const imageBuffer = await fs.readFile(template.imageData);
        const base64Image = imageBuffer.toString('base64');
        const dataUrl = `data:image/png;base64,${base64Image}`;
        
        // Update condition with search image
        const updatedCondition = {
          ...condition,
          searchImage: dataUrl,
          searchThreshold: condition.searchThreshold || options?.confidenceThreshold || 0.7
        };
        await storage.saveCondition(updatedCondition);
        console.log('✅ Saved search template image to condition');
      }
    } catch (templateError) {
      console.warn('⚠️ Could not save template image to condition:', templateError);
      // Continue anyway - template saving is not critical
    }

    // Step 3: Search for matching symbols (pass pageNumber and projectId)
    const searchResult = await visualSearchService.searchForSymbols(
      conditionId,
      pdfFileId,
      template,
      options,
      pageNumber,
      projectId
    );

    // Step 4: Create count measurements with condition's color and name
    await visualSearchService.createCountMeasurements(
      conditionId,
      searchResult.matches,
      projectId,
      sheetId,
      condition.color,
      condition.name,
      condition.unit
    );

    console.log(`✅ Visual search workflow complete: ${searchResult.totalMatches} matches found`);

    return res.json({
      success: true,
      result: searchResult,
      measurementsCreated: searchResult.totalMatches
    });
  } catch (error) {
    console.error('Error in complete visual search workflow:', error);
    return res.status(500).json({ 
      error: 'Visual search workflow failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Get visual search results for a condition
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
    console.error('Error getting visual search results:', error);
    return res.status(500).json({ error: 'Failed to get visual search results' });
  }
});

export default router;
