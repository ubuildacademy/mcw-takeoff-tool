import express from 'express';
import { supabase, TABLES } from '../supabase';
import { aiTakeoffService } from '../services/aiTakeoffService';

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

// Execute automated takeoff with Playwright
router.post('/execute-automated-takeoff', async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { 
      documentId, 
      pageNumber, 
      scope, 
      projectId, 
      pageType,
      executeAutomation = true 
    } = req.body;
    
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
    
    console.log(`🤖 Starting automated takeoff for page ${pageNumber} of document ${documentId}`);
    
    // Step 1: Process page with Qwen3-VL to get AI analysis
    console.log('📊 Step 1: Analyzing page with Qwen3-VL...');
    const aiResult = await aiTakeoffService.processPage({
      documentId,
      pageNumber,
      scope,
      projectId,
      pageType
    });
    
    console.log(`✅ Qwen3-VL analysis complete: ${aiResult.conditions.length} conditions, ${aiResult.measurements.length} measurements`);
    
    // Step 2: Create conditions in database
    console.log('💾 Step 2: Creating conditions in database...');
    const createdConditions = await aiTakeoffService.createAIConditions(aiResult.conditions, projectId);
    const conditionIds = createdConditions.map(c => c.id);
    
    // Step 3: Create measurements in database
    console.log('📏 Step 3: Creating measurements in database...');
    await aiTakeoffService.createAIMeasurements(
      aiResult.measurements, 
      conditionIds, 
      projectId, 
      documentId, 
      pageNumber
    );
    
    console.log('✅ Database operations complete');
    
    // Step 4: Execute Playwright automation if requested
    let automationResult = null;
    if (executeAutomation) {
      console.log('🎭 Step 4: Executing Playwright automation...');
      
      try {
        // Import services dynamically to avoid issues in server environment
        const { playwrightTakeoffService } = await import('../services/playwrightTakeoffService');
        const { livePreviewService } = await import('../services/livePreviewService');
        
        // Execute automated measurement placement
        automationResult = await playwrightTakeoffService.executeAITakeoffResult(
          aiResult,
          projectId,
          req.headers.authorization?.substring(7) // Pass auth token
        );
        
        console.log(`✅ Playwright automation complete: ${automationResult.measurementsPlaced} measurements placed`);
      } catch (automationError) {
        console.error('❌ Playwright automation failed:', automationError);
        automationResult = {
          success: false,
          measurementsPlaced: 0,
          errors: [`Automation failed: ${automationError instanceof Error ? automationError.message : 'Unknown error'}`]
        };
      }
    }
    
    // Return comprehensive results
    res.json({
      success: true,
      aiAnalysis: {
        conditionsFound: aiResult.conditions.length,
        measurementsFound: aiResult.measurements.length,
        hasCalibration: !!aiResult.calibration
      },
      databaseOperations: {
        conditionsCreated: createdConditions.length,
        measurementsCreated: aiResult.measurements.length,
        conditionIds
      },
      automation: automationResult ? {
        executed: true,
        success: automationResult.success,
        measurementsPlaced: automationResult.measurementsPlaced,
        errors: automationResult.errors
      } : {
        executed: false,
        reason: 'Automation disabled'
      },
      message: `Automated takeoff complete: ${aiResult.conditions.length} conditions created, ${automationResult?.measurementsPlaced || 0} measurements placed`
    });
    
  } catch (error) {
    console.error('❌ Error in automated takeoff:', error);
    res.status(500).json({ 
      error: 'Failed to execute automated takeoff',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Execute batch automated takeoff for multiple pages
router.post('/execute-batch-automated-takeoff', async (req, res) => {
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
      executeAutomation = true,
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
    
    console.log(`🤖 Starting batch automated takeoff for ${pages.length} pages`);
    
    const results = [];
    const allErrors = [];
    let totalConditionsCreated = 0;
    let totalMeasurementsPlaced = 0;
    
    // Process each page
    for (const page of pages) {
      try {
        console.log(`📄 Processing page ${page.pageNumber} of document ${page.documentId}`);
        
        // Process page with Qwen3-VL
        const aiResult = await aiTakeoffService.processPage({
          documentId: page.documentId,
          pageNumber: page.pageNumber,
          scope,
          projectId,
          pageType: page.pageType
        });
        
        // Create conditions and measurements
        const createdConditions = await aiTakeoffService.createAIConditions(aiResult.conditions, projectId);
        const conditionIds = createdConditions.map(c => c.id);
        
        await aiTakeoffService.createAIMeasurements(
          aiResult.measurements, 
          conditionIds, 
          projectId, 
          page.documentId, 
          page.pageNumber
        );
        
        totalConditionsCreated += createdConditions.length;
        
        // Execute automation if requested
        let automationResult = null;
        if (executeAutomation) {
          try {
            const { playwrightTakeoffService } = await import('../services/playwrightTakeoffService');
            
            automationResult = await playwrightTakeoffService.executeAITakeoffResult(
              aiResult,
              projectId,
              req.headers.authorization?.substring(7)
            );
            
            totalMeasurementsPlaced += automationResult.measurementsPlaced;
            allErrors.push(...automationResult.errors);
          } catch (automationError) {
            const errorMsg = `Automation failed for page ${page.pageNumber}: ${automationError instanceof Error ? automationError.message : 'Unknown error'}`;
            allErrors.push(errorMsg);
            console.error(`❌ ${errorMsg}`);
          }
        }
        
        results.push({
          pageNumber: page.pageNumber,
          documentId: page.documentId,
          conditionsCreated: createdConditions.length,
          measurementsPlaced: automationResult?.measurementsPlaced || 0,
          automationSuccess: automationResult?.success || false
        });
        
      } catch (pageError) {
        const errorMsg = `Failed to process page ${page.pageNumber}: ${pageError instanceof Error ? pageError.message : 'Unknown error'}`;
        allErrors.push(errorMsg);
        console.error(`❌ ${errorMsg}`);
        
        results.push({
          pageNumber: page.pageNumber,
          documentId: page.documentId,
          error: errorMsg,
          conditionsCreated: 0,
          measurementsPlaced: 0,
          automationSuccess: false
        });
      }
    }
    
    // Aggregate results if requested
    let aggregatedResults = null;
    if (aggregateResults && results.length > 1) {
      try {
        console.log('🔄 Aggregating results across pages...');
        // Get all conditions created in this batch for aggregation
        const allConditions = results.flatMap(r => 
          r.conditionsCreated > 0 ? [{ pageNumber: r.pageNumber, documentId: r.documentId }] : []
        );
        
        if (allConditions.length > 0) {
          // This would require implementing aggregation logic
          // For now, we'll just note that aggregation was requested
          aggregatedResults = {
            requested: true,
            message: 'Aggregation logic to be implemented'
          };
        }
      } catch (aggregationError) {
        console.error('❌ Aggregation failed:', aggregationError);
        allErrors.push(`Aggregation failed: ${aggregationError instanceof Error ? aggregationError.message : 'Unknown error'}`);
      }
    }
    
    console.log(`🎉 Batch automated takeoff complete: ${totalConditionsCreated} conditions created, ${totalMeasurementsPlaced} measurements placed`);
    
    res.json({
      success: allErrors.length === 0,
      summary: {
        totalPages: pages.length,
        processedPages: results.length,
        totalConditionsCreated,
        totalMeasurementsPlaced,
        totalErrors: allErrors.length
      },
      results,
      aggregation: aggregatedResults,
      errors: allErrors,
      message: `Batch automated takeoff complete: ${totalConditionsCreated} conditions created, ${totalMeasurementsPlaced} measurements placed across ${results.length} pages`
    });
    
  } catch (error) {
    console.error('❌ Error in batch automated takeoff:', error);
    res.status(500).json({ 
      error: 'Failed to execute batch automated takeoff',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get automation status and capabilities
router.get('/automation-status', async (req, res) => {
  try {
    // Check if Playwright is available
    let playwrightAvailable = false;
    try {
      const { chromium } = await import('playwright');
      playwrightAvailable = true;
    } catch (error) {
      console.log('Playwright not available:', error);
    }
    
    // Check AI services
    const aiServices = await aiTakeoffService.isAvailable();
    
    res.json({
      success: true,
      capabilities: {
        playwright: playwrightAvailable,
        qwenVision: aiServices.qwenVision,
        chatAI: aiServices.chatAI,
        fullAutomation: playwrightAvailable && aiServices.qwenVision && aiServices.chatAI
      },
      message: playwrightAvailable && aiServices.qwenVision && aiServices.chatAI 
        ? 'Full automation available' 
        : 'Partial automation available'
    });
  } catch (error) {
    console.error('Error checking automation status:', error);
    res.status(500).json({ 
      error: 'Failed to check automation status',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Store active takeoff sessions for progress tracking
const activeTakeoffs = new Map<string, {
  status: string;
  progress: number;
  message: string;
  startTime: Date;
  currentStep: string;
  totalPages: number;
  processedPages: number;
  conditionsCreated: number;
  measurementsPlaced: number;
  errors: string[];
}>();

// Get takeoff progress status
router.get('/takeoff-progress/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const takeoffStatus = activeTakeoffs.get(projectId);
    
    if (!takeoffStatus) {
      return res.json({
        success: true,
        active: false,
        message: 'No active takeoff session'
      });
    }
    
    res.json({
      success: true,
      active: true,
      ...takeoffStatus,
      duration: Date.now() - takeoffStatus.startTime.getTime()
    });
  } catch (error) {
    console.error('Error getting takeoff progress:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get takeoff progress' 
    });
  }
});

// Debug endpoint to check project state
router.get('/debug/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Get project info
    const { data: project, error: projectError } = await supabase
      .from('takeoff_projects')
      .select('*')
      .eq('id', projectId)
      .single();
    
    // Get conditions
    const { data: conditions, error: conditionsError } = await supabase
      .from('takeoff_conditions')
      .select('*')
      .eq('project_id', projectId);
    
    // Get files
    const { data: files, error: filesError } = await supabase
      .from('project_files')
      .select('*')
      .eq('project_id', projectId);
    
    // Get measurements
    const { data: measurements, error: measurementsError } = await supabase
      .from('takeoff_measurements')
      .select('*')
      .eq('project_id', projectId);
    
    res.json({
      success: true,
      project: project || null,
      projectError: projectError?.message || null,
      conditions: conditions || [],
      conditionsError: conditionsError?.message || null,
      files: files || [],
      filesError: filesError?.message || null,
      measurements: measurements || [],
      measurementsError: measurementsError?.message || null,
      activeTakeoffs: Array.from(activeTakeoffs.entries()).map(([id, status]) => ({ id, status }))
    });
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get debug info',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Execute full automated takeoff workflow (identify pages + process + automate)
router.post('/execute-full-automated-takeoff', async (req, res) => {
  const { 
    scope, 
    documentIds, 
    projectId,
    selectedPages = [],
    enableAutomation = true 
  } = req.body;
  
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
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
    
    console.log(`🤖 Starting full automated takeoff workflow for scope: "${scope}"`);
    console.log(`📋 Document IDs: ${documentIds.join(', ')}`);
    console.log(`🏗️ Project ID: ${projectId}`);
    
    // Initialize progress tracking
    activeTakeoffs.set(projectId, {
      status: 'starting',
      progress: 0,
      message: 'Initializing takeoff workflow...',
      startTime: new Date(),
      currentStep: 'initializing',
      totalPages: 0,
      processedPages: 0,
      conditionsCreated: 0,
      measurementsPlaced: 0,
      errors: []
    });
    
    // Step 1: Identify relevant pages using AI
    console.log('📊 Step 1: Identifying relevant pages...');
    activeTakeoffs.set(projectId, {
      ...activeTakeoffs.get(projectId)!,
      status: 'identifying',
      progress: 10,
      message: 'Identifying relevant pages with AI...',
      currentStep: 'page_identification'
    });
    
    let identifiedPages: any[] = [];
    if (selectedPages && selectedPages.length > 0) {
      console.log(`DEBUG: selectedPages type: ${typeof selectedPages}, value:`, selectedPages);
      console.log(`DEBUG: selectedPages[0] type: ${typeof selectedPages[0]}, value:`, selectedPages[0]);
      
      // Convert selectedPages (numbers) to the expected format
      identifiedPages = selectedPages.map((pageNumber: number) => ({
        pageNumber,
        documentId: documentIds[0], // Use first document ID for selected pages
        pageType: 'floor-plan', // Default page type
        confidence: 1.0,
        reason: 'User selected',
        selected: true
      }));
      console.log(`✅ Using user-selected pages: ${identifiedPages.length} pages selected`);
      console.log(`DEBUG: mapped identifiedPages[0]:`, identifiedPages[0]);
    } else {
      // Fall back to AI identification
      try {
        identifiedPages = await aiTakeoffService.identifyPages({
          scope,
          documentIds,
          projectId
        });
        console.log(`✅ Page identification complete: ${identifiedPages.length} pages identified`);
      } catch (error) {
        console.error('❌ Error in page identification:', error);
        activeTakeoffs.set(projectId, {
          ...activeTakeoffs.get(projectId)!,
          status: 'error',
          progress: 0,
          message: `Page identification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          currentStep: 'error',
          errors: [...(activeTakeoffs.get(projectId)?.errors || []), `Page identification: ${error instanceof Error ? error.message : 'Unknown error'}`]
        });
        throw error;
      }
    }
    
    // Check if we have any pages to process
    if (identifiedPages.length === 0) {
      activeTakeoffs.set(projectId, {
        ...activeTakeoffs.get(projectId)!,
        status: 'completed',
        progress: 100,
        message: 'No relevant pages identified for the given scope',
        currentStep: 'completed'
      });
      return res.json({
        success: true,
        message: 'No relevant pages identified for the given scope',
        summary: {
          totalPages: 0,
          totalConditionsCreated: 0,
          totalMeasurementsPlaced: 0,
          totalErrors: 0
        },
        details: []
      });
    }
    
    // Set the pages identified status
    activeTakeoffs.set(projectId, {
      ...activeTakeoffs.get(projectId)!,
      status: 'pages_identified',
      progress: 20,
      message: `Identified ${identifiedPages.length} relevant pages`,
      currentStep: 'condition_creation',
      totalPages: identifiedPages.length
    });
    
    // Step 2: Create the basic condition after identifying pages
    console.log('📝 Step 2: Creating basic condition for scope...');
    activeTakeoffs.set(projectId, {
      ...activeTakeoffs.get(projectId)!,
      status: 'creating_condition',
      progress: 25,
      message: 'Creating basic condition for scope...',
      currentStep: 'condition_creation'
    });
    const basicCondition = {
      name: scope,
      type: 'count', // Default to count for unit counting
      unit: 'EA',
      description: `AI-generated condition for: ${scope} (found on ${identifiedPages.length} pages)`,
      color: '#FF6B6B'
    };
    
    const createdConditions = await aiTakeoffService.createAIConditions([basicCondition], projectId);
    const conditionId = createdConditions[0].id;
    console.log(`✅ Basic condition created: ${basicCondition.name} (ID: ${conditionId})`);
    
    console.log(`✅ Identified ${identifiedPages.length} relevant pages`);
    
    // Step 3: Process each identified page with full automation
    console.log('🎭 Step 3: Processing pages with full automation...');
    activeTakeoffs.set(projectId, {
      ...activeTakeoffs.get(projectId)!,
      status: 'processing_pages',
      progress: 30,
      message: `Processing ${identifiedPages.length} pages with AI analysis...`,
      currentStep: 'page_processing',
      conditionsCreated: 1
    });
    
    const results = [];
    let totalConditionsCreated = 1; // We already created 1 condition
    let totalMeasurementsPlaced = 0;
    let totalErrors = 0;
    
    for (let i = 0; i < identifiedPages.length; i++) {
      const page = identifiedPages[i];
      const pageProgress = 30 + (i / identifiedPages.length) * 60; // 30-90% for page processing
      
      activeTakeoffs.set(projectId, {
        ...activeTakeoffs.get(projectId)!,
        status: 'processing_pages',
        progress: Math.round(pageProgress),
        message: `Processing page ${page.pageNumber} (${i + 1}/${identifiedPages.length}) with Qwen3-VL...`,
        currentStep: 'page_processing',
        processedPages: i
      });
      try {
        console.log(`📄 Processing page ${page.pageNumber} of document ${page.documentId}`);
        console.log(`🔍 Page type: ${page.pageType || 'unknown'}`);
        
        // Process page with Qwen3-VL
        console.log(`🤖 Starting Qwen3-VL analysis for page ${page.pageNumber}...`);
        
        // Send live preview update
        const { livePreviewService } = await import('../services/livePreviewService');
        livePreviewService.sendProgressUpdate(
          projectId, 
          (results.length / identifiedPages.length) * 60, // 60% for analysis phase
          `Analyzing page ${page.pageNumber} with Qwen3-VL...`,
          page.documentId,
          page.pageNumber
        );
        
        console.log(`DEBUG: page object:`, page);
        console.log(`DEBUG: page.pageNumber type: ${typeof page.pageNumber}, value:`, page.pageNumber);
        
        const aiResult = await aiTakeoffService.processPage({
          documentId: page.documentId,
          pageNumber: page.pageNumber,
          scope,
          projectId,
          pageType: page.pageType
        });
        console.log(`✅ Qwen3-VL analysis complete for page ${page.pageNumber}: ${aiResult.conditions.length} conditions, ${aiResult.measurements.length} measurements`);
        
        // Send page analysis update (image data will be included in the result)
        livePreviewService.sendPageAnalysisUpdate(
          projectId,
          page.documentId,
          page.pageNumber,
          {
            conditions: aiResult.conditions,
            measurements: aiResult.measurements,
            calibration: aiResult.calibration
          }
        );
        
        // Use the existing condition we created earlier
        const conditionIds = [conditionId];
        
        // Send condition usage update
        livePreviewService.sendConditionCreatedUpdate(
          projectId,
          createdConditions[0],
          page.documentId,
          page.pageNumber
        );
        
        await aiTakeoffService.createAIMeasurements(
          aiResult.measurements, 
          conditionIds, 
          projectId, 
          page.documentId, 
          page.pageNumber
        );
        
        // Don't add to totalConditionsCreated here since we already counted the basic condition
        
        // Execute Playwright automation if enabled
        let automationResult = null;
        if (enableAutomation) {
          try {
            console.log(`🎭 Step 4: Executing Playwright automation for page ${page.pageNumber}...`);
            
            const { playwrightTakeoffService } = await import('../services/playwrightTakeoffService');
            
            automationResult = await playwrightTakeoffService.executeAITakeoffResult(
              aiResult,
              projectId,
              req.headers.authorization?.substring(7)
            );
            
            totalMeasurementsPlaced += automationResult.measurementsPlaced;
            totalErrors += automationResult.errors.length;
          } catch (automationError) {
            const errorMsg = `Automation failed for page ${page.pageNumber}: ${automationError instanceof Error ? automationError.message : 'Unknown error'}`;
            console.error(`❌ ${errorMsg}`);
            totalErrors++;
          }
        }
        
        results.push({
          pageNumber: page.pageNumber,
          documentId: page.documentId,
          conditionsCreated: createdConditions.length,
          measurementsPlaced: automationResult?.measurementsPlaced || 0,
          errors: automationResult?.errors || [],
          success: true
        });
        
      } catch (error) {
        const errorMsg = `Failed to process page ${page.pageNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`❌ ${errorMsg}`);
        totalErrors++;
        
        results.push({
          pageNumber: page.pageNumber,
          documentId: page.documentId,
          conditionsCreated: 0,
          measurementsPlaced: 0,
          errors: [errorMsg],
          success: false
        });
      }
    }
    
    console.log(`🎉 Full automation complete: ${totalConditionsCreated} conditions, ${totalMeasurementsPlaced} measurements, ${totalErrors} errors`);
    
    // Mark as completed
    activeTakeoffs.set(projectId, {
      ...activeTakeoffs.get(projectId)!,
      status: 'completed',
      progress: 100,
      message: `Takeoff completed! ${totalConditionsCreated} conditions created, ${totalMeasurementsPlaced} measurements placed`,
      currentStep: 'completed',
      processedPages: identifiedPages.length,
      conditionsCreated: totalConditionsCreated,
      measurementsPlaced: totalMeasurementsPlaced
    });
    
    res.json({
      success: true,
      message: `Full automation complete! ${totalConditionsCreated} conditions created, ${totalMeasurementsPlaced} measurements placed across ${identifiedPages.length} pages. ${totalErrors} errors encountered.`,
      summary: {
        totalPages: identifiedPages.length,
        totalConditionsCreated,
        totalMeasurementsPlaced,
        totalErrors
      },
      details: results
    });
    
  } catch (error) {
    console.error('❌ Error executing full automated takeoff:', error);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('❌ Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
    
    // Mark as error
    const currentStatus = activeTakeoffs.get(projectId);
    if (currentStatus) {
      activeTakeoffs.set(projectId, {
        ...currentStatus,
        status: 'error',
        progress: 0,
        message: `Takeoff failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        currentStep: 'error',
        errors: [...currentStatus.errors, `Workflow error: ${error instanceof Error ? error.message : 'Unknown error'}`]
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to execute full automated takeoff',
      details: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
});

export default router;
