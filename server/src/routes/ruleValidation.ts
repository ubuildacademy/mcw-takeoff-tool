/**
 * Rule-based Validation API Routes
 * 
 * Provides endpoints for rule-based validation of construction takeoff results
 */

import { Router } from 'express';
import { ruleBasedValidationService } from '../services/ruleBasedValidationService';
import { requireAuth } from '../middleware';

const router = Router();

/**
 * POST /api/rule-validation/validate
 * Validate takeoff results using construction industry rules
 */
router.post('/validate', requireAuth, async (req, res) => {
  try {
    const { elements, scaleInfo, ocrData } = req.body;

    if (!elements || !scaleInfo) {
      return res.status(400).json({ error: 'Elements and scaleInfo are required' });
    }

    console.log('🔍 Rule-based validation request');
    console.log(`📊 Validating ${elements.length} elements`);
    
    const result = await ruleBasedValidationService.validateTakeoffResults(
      elements,
      scaleInfo,
      ocrData
    );
    
    res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('❌ Rule validation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/rule-validation/rules
 * Get all available validation rules
 */
router.get('/rules', requireAuth, async (req, res) => {
  try {
    const rules = ruleBasedValidationService.getRules();
    
    res.json({
      success: true,
      rules
    });
  } catch (error) {
    console.error('❌ Rules fetch error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/rule-validation/rules/:category
 * Get validation rules by category
 */
router.get('/rules/:category', requireAuth, async (req, res) => {
  try {
    const { category } = req.params;
    const rules = ruleBasedValidationService.getRulesByCategory(category);
    
    res.json({
      success: true,
      category,
      rules
    });
  } catch (error) {
    console.error('❌ Rules by category error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/rule-validation/status
 * Get rule validation service status
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const isAvailable = await ruleBasedValidationService.isAvailable();
    
    res.json({
      success: true,
      available: isAvailable,
      service: 'Rule-based Validation Service'
    });
  } catch (error) {
    console.error('❌ Rule validation status error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
