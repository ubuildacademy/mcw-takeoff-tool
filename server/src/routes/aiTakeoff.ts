import express from 'express';
import { aiTakeoffService } from '../services/aiTakeoffService';
import { storage } from '../storage';
import { supabase, TABLES } from '../supabase';

// Import types from the service
interface AITakeoffResult {
  pageNumber: number;
  documentId: string;
  conditions: Array<{
    name: string;
    type: 'area' | 'volume' | 'linear' | 'count';
    unit: string;
    description: string;
    color: string;
  }>;
  measurements: Array<{
    conditionIndex: number;
    points: Array<{ x: number; y: number }>;
    calculatedValue: number;
  }>;
  calibration?: {
    scaleFactor: number;
    unit: string;
  };
}

const router = express.Router();

// Helper function to get authenticated user from request
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

// Helper function to check if user is admin
async function isAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_metadata')
    .select('role')
    .eq('id', userId)
    .single();
  
  if (error || !data) {
    return false;
  }
  
  return data.role === 'admin';
}

// Check AI takeoff service availability
router.get('/status', async (req, res) => {
  try {
    const availability = await aiTakeoffService.isAvailable();
    res.json({
      success: true,
      services: availability,
      message: availability.qwenVision && availability.chatAI 
        ? 'All AI services available' 
        : 'Some AI services unavailable'
    });
  } catch (error) {
    console.error('Error checking AI takeoff status:', error);
    res.status(500).json({ 
      error: 'Failed to check AI takeoff status',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Identify relevant pages using chat AI
router.post('/identify-pages', async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { scope, documentIds, projectId } = req.body;
    
    // Validate required fields
    if (!scope || !documentIds || !projectId) {
      return res.status(400).json({ 
        error: 'Missing required fields: scope, documentIds, and projectId are required' 
      });
    }
    
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      return res.status(400).json({ 
        error: 'documentIds must be a non-empty array' 
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
    
    console.log(`Identifying pages for scope: "${scope}" in project: ${projectId}`);
    
    // Identify pages using AI service
    const identifiedPages = await aiTakeoffService.identifyPages({
      scope,
      documentIds,
      projectId
    });
    
    res.json({
      success: true,
      identifiedPages,
      totalPages: identifiedPages.length,
      message: `Identified ${identifiedPages.length} relevant pages`
    });
  } catch (error) {
    console.error('Error identifying pages:', error);
    res.status(500).json({ 
      error: 'Failed to identify pages',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Process a single page with Qwen3-VL
router.post('/process-page', async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { documentId, pageNumber, scope, projectId, pageType } = req.body;
    
    // Validate required fields
    if (!documentId || !pageNumber || !scope || !projectId) {
      return res.status(400).json({ 
        error: 'Missing required fields: documentId, pageNumber, scope, and projectId are required' 
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
    
    console.log(`Processing page ${pageNumber} of document ${documentId} for scope: "${scope}"`);
    
    // Process page with Qwen3-VL
    const result = await aiTakeoffService.processPage({
      documentId,
      pageNumber,
      scope,
      projectId,
      pageType
    });
    
    res.json({
      success: true,
      result,
      message: `Processed page ${pageNumber}: found ${result.conditions.length} conditions and ${result.measurements.length} measurements`
    });
  } catch (error) {
    console.error('Error processing page:', error);
    res.status(500).json({ 
      error: 'Failed to process page',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Process multiple pages and aggregate results
router.post('/process-batch', async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { 
      pages, 
      scope, 
      projectId,
      aggregateResults = true
    } = req.body;
    
    // Validate required fields
    if (!pages || !scope || !projectId) {
      return res.status(400).json({ 
        error: 'Missing required fields: pages, scope, and projectId are required' 
      });
    }
    
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ 
        error: 'pages must be a non-empty array' 
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
    
    console.log(`Processing batch of ${pages.length} pages for scope: "${scope}"`);
    
    // Process each page
    const results: AITakeoffResult[] = [];
    for (const page of pages) {
      try {
        const result = await aiTakeoffService.processPage({
          documentId: page.documentId,
          pageNumber: page.pageNumber,
          scope,
          projectId,
          pageType: page.pageType
        });
        results.push(result);
      } catch (error) {
        console.error(`Error processing page ${page.pageNumber}:`, error);
        // Continue with other pages
      }
    }
    
    // Aggregate results if requested
    let finalResults = results;
    if (aggregateResults && results.length > 1) {
      finalResults = await aiTakeoffService.aggregateTakeoffResults(results, projectId);
    }
    
    res.json({
      success: true,
      results: finalResults,
      totalPages: pages.length,
      processedPages: results.length,
      aggregated: aggregateResults && results.length > 1,
      message: `Processed ${results.length} pages${aggregateResults && results.length > 1 ? ' and aggregated results' : ''}`
    });
  } catch (error) {
    console.error('Error processing batch:', error);
    res.status(500).json({ 
      error: 'Failed to process batch',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Create AI-generated conditions and measurements
router.post('/create-conditions', async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { 
      conditions, 
      measurements, 
      projectId, 
      documentId, 
      pageNumber 
    } = req.body;
    
    // Validate required fields
    if (!conditions || !measurements || !projectId || !documentId || !pageNumber) {
      return res.status(400).json({ 
        error: 'Missing required fields: conditions, measurements, projectId, documentId, and pageNumber are required' 
      });
    }
    
    if (!Array.isArray(conditions) || !Array.isArray(measurements)) {
      return res.status(400).json({ 
        error: 'conditions and measurements must be arrays' 
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
    
    console.log(`Creating ${conditions.length} AI conditions and ${measurements.length} measurements for page ${pageNumber}`);
    
    // Create conditions first
    const createdConditions = await aiTakeoffService.createAIConditions(conditions, projectId);
    const conditionIds = createdConditions.map(c => c.id);
    
    // Create measurements with condition IDs
    await aiTakeoffService.createAIMeasurements(
      measurements, 
      conditionIds, 
      projectId, 
      documentId, 
      pageNumber
    );
    
    res.json({
      success: true,
      conditions: createdConditions,
      conditionIds,
      message: `Successfully created ${createdConditions.length} conditions and ${measurements.length} measurements`
    });
  } catch (error) {
    console.error('Error creating AI conditions:', error);
    res.status(500).json({ 
      error: 'Failed to create conditions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get AI-generated conditions for a project
router.get('/conditions/:projectId', async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { projectId } = req.params;
    
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
    
    // Get AI-generated conditions
    const { data: conditions, error } = await supabase
      .from(TABLES.CONDITIONS)
      .select('*')
      .eq('project_id', projectId)
      .eq('ai_generated', true)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching AI conditions:', error);
      return res.status(500).json({ error: 'Failed to fetch AI conditions' });
    }
    
    res.json({
      success: true,
      conditions: conditions || [],
      count: conditions?.length || 0
    });
  } catch (error) {
    console.error('Error fetching AI conditions:', error);
    res.status(500).json({ 
      error: 'Failed to fetch AI conditions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Delete AI-generated conditions and their measurements
router.delete('/conditions/:projectId', async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { projectId } = req.params;
    const { conditionIds } = req.body;
    
    // Validate required fields
    if (!conditionIds || !Array.isArray(conditionIds)) {
      return res.status(400).json({ 
        error: 'conditionIds must be an array' 
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
    
    console.log(`Deleting ${conditionIds.length} AI conditions for project ${projectId}`);
    
    // Delete measurements first (foreign key constraint)
    for (const conditionId of conditionIds) {
      // Get all measurements for this condition and delete them
      const { data: measurements } = await supabase
        .from(TABLES.TAKEOFF_MEASUREMENTS)
        .select('id')
        .eq('condition_id', conditionId);
      
      if (measurements) {
        for (const measurement of measurements) {
          await storage.deleteTakeoffMeasurement(measurement.id);
        }
      }
    }
    
    // Delete conditions
    for (const conditionId of conditionIds) {
      await storage.deleteCondition(conditionId);
    }
    
    res.json({
      success: true,
      message: `Successfully deleted ${conditionIds.length} AI conditions and their measurements`
    });
  } catch (error) {
    console.error('Error deleting AI conditions:', error);
    res.status(500).json({ 
      error: 'Failed to delete AI conditions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
