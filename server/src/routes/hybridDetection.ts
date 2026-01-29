/**
 * Hybrid Detection API Routes
 * 
 * Provides endpoints for the hybrid detection pipeline (YOLOv8 + Qwen3-VL)
 */

import { Router } from 'express';
import { hybridDetectionService } from '../services/hybridDetectionService';
import { yoloDetectionService } from '../services/yoloDetectionService';
import { requireAuth } from '../middleware';

const router = Router();

/**
 * POST /api/hybrid-detection/detect
 * Perform hybrid detection on an image
 */
router.post('/detect', requireAuth, async (req, res) => {
  try {
    const { imageData, scope, options } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    if (!scope) {
      return res.status(400).json({ error: 'Scope is required' });
    }

    console.log(`🔍 Hybrid detection request: scope="${scope}"`);
    
    const result = await hybridDetectionService.detectElements(imageData, scope, options);
    
    res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('❌ Hybrid detection error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/hybrid-detection/status
 * Get service availability status
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const status = await hybridDetectionService.getServiceStatus();
    
    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('❌ Status check error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/hybrid-detection/yolo-only
 * Perform YOLOv8 detection only (for testing)
 */
router.post('/yolo-only', requireAuth, async (req, res) => {
  try {
    const { imageData } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    console.log('🔍 YOLOv8-only detection request');
    
    const result = await yoloDetectionService.detectElements(imageData);
    const elements = yoloDetectionService.convertToConstructionElements(result);
    const stats = yoloDetectionService.getDetectionStats(result.detections);
    
    res.json({
      success: true,
      result: {
        elements,
        detections: result.detections,
        statistics: stats,
        processingTime: result.processingTime
      }
    });
  } catch (error) {
    console.error('❌ YOLOv8 detection error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/hybrid-detection/yolo-stats
 * Get YOLOv8 detection statistics
 */
router.get('/yolo-stats', requireAuth, async (req, res) => {
  try {
    const isAvailable = await yoloDetectionService.isAvailable();
    
    res.json({
      success: true,
      available: isAvailable,
      service: 'YOLOv8 Detection Service'
    });
  } catch (error) {
    console.error('❌ YOLOv8 stats error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
