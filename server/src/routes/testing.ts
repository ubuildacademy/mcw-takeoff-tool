/**
 * Testing and Validation API Routes
 * 
 * Provides endpoints for comprehensive testing and validation
 */

import { Router } from 'express';
import { testingValidationService } from '../services/testingValidationService';
import { enhancedPlaywrightService } from '../services/enhancedPlaywrightService';

const router = Router();

/**
 * POST /api/testing/suites
 * Create a new test suite
 */
router.post('/suites', async (req, res) => {
  try {
    const { id, name, description } = req.body;

    if (!id || !name) {
      return res.status(400).json({ error: 'ID and name are required' });
    }

    const testSuite = testingValidationService.createTestSuite(id, name, description);
    
    res.json({
      success: true,
      testSuite
    });
  } catch (error) {
    console.error('❌ Test suite creation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/testing/suites/:suiteId/test-cases
 * Add a test case to a test suite
 */
router.post('/suites/:suiteId/test-cases', async (req, res) => {
  try {
    const { suiteId } = req.params;
    const testCase = req.body;

    if (!testCase.id || !testCase.name) {
      return res.status(400).json({ error: 'Test case ID and name are required' });
    }

    testingValidationService.addTestCase(suiteId, testCase);
    
    res.json({
      success: true,
      message: 'Test case added successfully'
    });
  } catch (error) {
    console.error('❌ Test case addition error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/testing/suites/:suiteId/execute
 * Execute a test suite
 */
router.post('/suites/:suiteId/execute', async (req, res) => {
  try {
    const { suiteId } = req.params;

    console.log(`🚀 Executing test suite: ${suiteId}`);
    
    const testSuite = await testingValidationService.executeTestSuite(suiteId);
    
    res.json({
      success: true,
      testSuite
    });
  } catch (error) {
    console.error('❌ Test suite execution error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/testing/suites/:suiteId
 * Get a test suite
 */
router.get('/suites/:suiteId', async (req, res) => {
  try {
    const { suiteId } = req.params;
    
    const testSuite = testingValidationService.getTestSuite(suiteId);
    
    if (!testSuite) {
      return res.status(404).json({ error: 'Test suite not found' });
    }
    
    res.json({
      success: true,
      testSuite
    });
  } catch (error) {
    console.error('❌ Test suite fetch error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/testing/suites
 * List all test suites
 */
router.get('/suites', async (req, res) => {
  try {
    const testSuites = testingValidationService.listTestSuites();
    
    res.json({
      success: true,
      testSuites
    });
  } catch (error) {
    console.error('❌ Test suites list error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/testing/suites/:suiteId/report
 * Generate test report
 */
router.get('/suites/:suiteId/report', async (req, res) => {
  try {
    const { suiteId } = req.params;
    
    const report = testingValidationService.generateTestReport(suiteId);
    
    res.json({
      success: true,
      report
    });
  } catch (error) {
    console.error('❌ Test report generation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/testing/performance
 * Run performance tests
 */
router.post('/performance', async (req, res) => {
  try {
    console.log('🚀 Running performance tests...');
    
    const metrics = await testingValidationService.runPerformanceTests();
    
    res.json({
      success: true,
      metrics
    });
  } catch (error) {
    console.error('❌ Performance test error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/testing/performance
 * Get performance metrics
 */
router.get('/performance', async (req, res) => {
  try {
    const metrics = testingValidationService.getPerformanceMetrics();
    
    res.json({
      success: true,
      metrics
    });
  } catch (error) {
    console.error('❌ Performance metrics fetch error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/testing/playwright/sessions
 * Create a Playwright session
 */
router.post('/playwright/sessions', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const session = await enhancedPlaywrightService.createSession(sessionId);
    
    res.json({
      success: true,
      session: {
        id: session.id,
        status: session.status,
        startTime: session.startTime
      }
    });
  } catch (error) {
    console.error('❌ Playwright session creation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/testing/playwright/sessions/:sessionId/execute
 * Execute a takeoff plan
 */
router.post('/playwright/sessions/:sessionId/execute', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { plan, imageData, scope } = req.body;

    if (!plan || !imageData || !scope) {
      return res.status(400).json({ error: 'Plan, imageData, and scope are required' });
    }

    const result = await enhancedPlaywrightService.executeTakeoffPlan(
      sessionId,
      plan,
      imageData,
      scope
    );
    
    res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('❌ Playwright execution error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/testing/playwright/sessions/:sessionId
 * Close a Playwright session
 */
router.delete('/playwright/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    await enhancedPlaywrightService.closeSession(sessionId);
    
    res.json({
      success: true,
      message: 'Session closed successfully'
    });
  } catch (error) {
    console.error('❌ Playwright session close error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/testing/status
 * Get testing service status
 */
router.get('/status', async (req, res) => {
  try {
    const isAvailable = await testingValidationService.isAvailable();
    
    res.json({
      success: true,
      available: isAvailable,
      service: 'Testing and Validation Service'
    });
  } catch (error) {
    console.error('❌ Testing status error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
