import express from 'express';
import { trainingService } from '../services/trainingService.js';

const router = express.Router();

/**
 * Start a new training session
 */
router.post('/start', async (req, res) => {
  try {
    const { projectId, documentId, pageNumber, scope } = req.body;
    
    if (!projectId || !documentId || !pageNumber || !scope) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const sessionId = await trainingService.startTrainingSession(
      projectId,
      documentId,
      pageNumber,
      scope
    );

    res.json({ 
      id: sessionId,
      projectId,
      documentId,
      pageNumber,
      scope,
      status: 'active',
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Failed to start training session:', error);
    res.status(500).json({ 
      error: 'Failed to start training session',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Record a human action during training
 */
router.post('/action', async (req, res) => {
  try {
    const { sessionId, action } = req.body;
    
    if (!sessionId || !action) {
      return res.status(400).json({ error: 'Missing sessionId or action' });
    }

    await trainingService.recordHumanAction(sessionId, action);
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Failed to record action:', error);
    res.status(500).json({ 
      error: 'Failed to record action',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Complete a training session
 */
router.post('/complete', async (req, res) => {
  try {
    const { sessionId, accuracy, feedback } = req.body;
    
    if (!sessionId || accuracy === undefined) {
      return res.status(400).json({ error: 'Missing sessionId or accuracy' });
    }

    // Get the AI result for comparison (this would come from the AI analysis)
    const aiResult = {
      conditions: [],
      measurements: [],
      calibration: {
        scaleFactor: 0.0833,
        unit: 'ft',
        scaleText: 'estimated'
      }
    };

    await trainingService.completeTrainingSession(
      sessionId,
      aiResult,
      accuracy,
      feedback || ''
    );

    res.json({ 
      sessionId,
      accuracy,
      completedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Failed to complete training session:', error);
    res.status(500).json({ 
      error: 'Failed to complete training session',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get training statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const { scope } = req.query;
    
    if (!scope || typeof scope !== 'string') {
      return res.status(400).json({ error: 'Scope parameter is required' });
    }

    const analysis = await trainingService.analyzeTrainingData(scope);
    
    res.json({
      totalSessions: analysis.accuracyTrends.length,
      avgAccuracy: analysis.accuracyTrends.length > 0 
        ? analysis.accuracyTrends.reduce((sum, acc) => sum + acc, 0) / analysis.accuracyTrends.length 
        : 0,
      commonPatterns: analysis.commonPatterns,
      improvementSuggestions: analysis.improvementSuggestions
    });
  } catch (error) {
    console.error('❌ Failed to get training stats:', error);
    res.status(500).json({ 
      error: 'Failed to get training statistics',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get training examples for a scope
 */
router.get('/examples', async (req, res) => {
  try {
    const { scope, limit = 10 } = req.query;
    
    if (!scope || typeof scope !== 'string') {
      return res.status(400).json({ error: 'Scope parameter is required' });
    }

    const examples = await trainingService.getTrainingExamples(scope, Number(limit));
    
    res.json(examples);
  } catch (error) {
    console.error('❌ Failed to get training examples:', error);
    res.status(500).json({ 
      error: 'Failed to get training examples',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Generate training prompts based on collected data
 */
router.get('/prompts/:scope', async (req, res) => {
  try {
    const { scope } = req.params;
    
    const prompt = await trainingService.generateTrainingPrompts(scope);
    
    res.json({ prompt });
  } catch (error) {
    console.error('❌ Failed to generate training prompts:', error);
    res.status(500).json({ 
      error: 'Failed to generate training prompts',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
