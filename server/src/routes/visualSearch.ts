/**
 * Visual Search API Routes
 * 
 * Handles visual search operations for symbol detection and matching
 */

import { Router } from 'express';
import { visualSearchService } from '../services/visualSearchService';
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

    // Step 1: Extract symbol template (pass projectId for PDF download)
    const template = await visualSearchService.extractSymbolTemplate(
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

    // Step 2: Search for matching symbols (pass pageNumber and projectId)
    const searchResult = await visualSearchService.searchForSymbols(
      conditionId,
      pdfFileId,
      template,
      options,
      pageNumber,
      projectId
    );

    // Step 3: Create count measurements
    await visualSearchService.createCountMeasurements(
      conditionId,
      searchResult.matches,
      projectId,
      sheetId
    );

    console.log(`✅ Visual search workflow complete: ${searchResult.totalMatches} matches found`);

    return res.json({
      success: true,
      result: searchResult,
      measurementsCreated: searchResult.totalMatches
    });
  } catch (error) {
    console.error('Error in complete visual search workflow:', error);
    return res.status(500).json({ error: 'Visual search workflow failed' });
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
