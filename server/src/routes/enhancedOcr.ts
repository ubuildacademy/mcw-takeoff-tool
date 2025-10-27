/**
 * Enhanced OCR API Routes
 * 
 * Provides endpoints for enhanced OCR analysis with construction-specific features
 */

import { Router } from 'express';
import { enhancedOcrService } from '../services/enhancedOcrService';

const router = Router();

/**
 * POST /api/enhanced-ocr/analyze
 * Perform enhanced OCR analysis on an image
 */
router.post('/analyze', async (req, res) => {
  try {
    const { imageData } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    console.log('🔍 Enhanced OCR analysis request');
    
    const result = await enhancedOcrService.analyzeImage(imageData);
    
    res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('❌ Enhanced OCR error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/enhanced-ocr/status
 * Get enhanced OCR service status
 */
router.get('/status', async (req, res) => {
  try {
    const isAvailable = await enhancedOcrService.isAvailable();
    
    res.json({
      success: true,
      available: isAvailable,
      service: 'Enhanced OCR Service'
    });
  } catch (error) {
    console.error('❌ Enhanced OCR status error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
