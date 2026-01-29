import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage, StoredTakeoffMeasurement } from '../storage';
import { supabase, TABLES } from '../supabase';
import { 
  requireAuth, 
  validateUUIDParam,
  hasProjectAccess
} from '../middleware';

const router = express.Router();

// Get all takeoff measurements - admin only (returns all data)
router.get('/', requireAuth, async (req, res) => {
  try {
    // Only admins can see all measurements across all projects
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required to view all measurements' });
    }
    
    const measurements = await storage.getTakeoffMeasurements();
    return res.json({ measurements });
  } catch (error) {
    console.error('Error fetching takeoff measurements:', error);
    return res.status(500).json({ error: 'Failed to fetch takeoff measurements' });
  }
});

// Get takeoff measurements for a project - requires auth and project access
router.get('/project/:projectId', requireAuth, validateUUIDParam('projectId'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    
    // Verify access to project
    const hasAccess = await hasProjectAccess(userId!, projectId, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }
    
    // Get measurements for the project using storage service to ensure proper data conversion
    const measurements = await storage.getTakeoffMeasurementsByProject(projectId);
    
    return res.json({ measurements: measurements || [] });
  } catch (error) {
    console.error('Error fetching project takeoff measurements:', error);
    return res.status(500).json({ error: 'Failed to fetch project takeoff measurements' });
  }
});

// Get takeoff measurements for a specific sheet - requires auth
router.get('/sheet/:sheetId', requireAuth, validateUUIDParam('sheetId'), async (req, res) => {
  try {
    const { sheetId } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    
    // Get the sheet to find its project for access control
    const sheet = await storage.getSheet(sheetId);
    if (!sheet) {
      return res.status(404).json({ error: 'Sheet not found' });
    }
    
    // Get document to find project
    const file = await storage.getFile(sheet.documentId);
    if (!file) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Verify access to project
    const hasAccess = await hasProjectAccess(userId!, file.projectId, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Sheet not found or access denied' });
    }
    
    const measurements = await storage.getTakeoffMeasurementsBySheet(sheetId);
    return res.json({ measurements });
  } catch (error) {
    console.error('Error fetching sheet takeoff measurements:', error);
    return res.status(500).json({ error: 'Failed to fetch sheet takeoff measurements' });
  }
});

// Get takeoff measurements for a specific page - requires auth
router.get('/sheet/:sheetId/page/:pageNumber', requireAuth, validateUUIDParam('sheetId'), async (req, res) => {
  try {
    const { sheetId, pageNumber } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    const pageNum = parseInt(pageNumber, 10);
    
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ error: 'Invalid page number' });
    }
    
    // Get the sheet to find its project for access control
    const sheet = await storage.getSheet(sheetId);
    if (!sheet) {
      return res.status(404).json({ error: 'Sheet not found' });
    }
    
    // Get document to find project
    const file = await storage.getFile(sheet.documentId);
    if (!file) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Verify access to project
    const hasAccess = await hasProjectAccess(userId!, file.projectId, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Sheet not found or access denied' });
    }
    
    const measurements = await storage.getTakeoffMeasurementsByPage(sheetId, pageNum);
    return res.json({ measurements });
  } catch (error) {
    console.error('Error fetching page takeoff measurements:', error);
    return res.status(500).json({ error: 'Failed to fetch page takeoff measurements' });
  }
});

// Create a new takeoff measurement - requires auth and project access
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    
    const {
      projectId,
      sheetId,
      conditionId,
      type,
      points,
      calculatedValue,
      unit,
      pdfPage,
      pdfCoordinates,
      conditionColor,
      conditionName,
      perimeterValue,
      areaValue
    } = req.body;

    // Validation
    if (!projectId || !sheetId || !conditionId || !type || !points || calculatedValue === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: projectId, sheetId, conditionId, type, points, and calculatedValue are required' 
      });
    }

    if (!['area', 'volume', 'linear', 'count'].includes(type)) {
      return res.status(400).json({ 
        error: 'Invalid type. Must be one of: area, volume, linear, count' 
      });
    }
    
    // Verify access to project
    const hasAccess = await hasProjectAccess(userId!, projectId, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    const id = uuidv4();
    const now = Date.now().toString(); // Use Unix timestamp as string
    
    const newMeasurement: StoredTakeoffMeasurement = {
      id,
      projectId,
      sheetId,
      conditionId,
      type,
      points,
      calculatedValue,
      unit,
      timestamp: now,
      pdfPage: pdfPage || 1,
      pdfCoordinates: pdfCoordinates || [],
      conditionColor: conditionColor || '#000000',
      conditionName: conditionName || 'Unknown',
      perimeterValue,
      areaValue
    };
    
    const savedMeasurement = await storage.saveTakeoffMeasurement(newMeasurement);
    
    return res.status(201).json({ 
      success: true, 
      measurement: savedMeasurement 
    });
  } catch (error) {
    console.error('❌ ERROR: Error creating takeoff measurement:', error);
    console.error('❌ ERROR: Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined
    });
    return res.status(500).json({ 
      error: 'Failed to create takeoff measurement',
      details: error instanceof Error ? error.message : JSON.stringify(error)
    });
  }
});

// Update an existing takeoff measurement - requires auth and project access
router.put('/:id', requireAuth, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    const updates = req.body;
    
    const measurements = await storage.getTakeoffMeasurements();
    const existingMeasurement = measurements.find(m => m.id === id);
    
    if (!existingMeasurement) {
      return res.status(404).json({ error: 'Takeoff measurement not found' });
    }
    
    // Verify access to project
    const hasAccess = await hasProjectAccess(userId!, existingMeasurement.projectId, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Measurement not found or access denied' });
    }
    
    // Don't allow changing project ownership
    delete updates.projectId;
    
    const updatedMeasurement = { ...existingMeasurement, ...updates };
    const savedMeasurement = await storage.saveTakeoffMeasurement(updatedMeasurement);
    
    return res.json({ 
      success: true, 
      measurement: savedMeasurement 
    });
  } catch (error) {
    console.error('Error updating takeoff measurement:', error);
    return res.status(500).json({ error: 'Failed to update takeoff measurement' });
  }
});

// Delete a takeoff measurement - requires auth and project access
router.delete('/:id', requireAuth, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    
    // Get measurement to check project access
    const measurements = await storage.getTakeoffMeasurements();
    const measurement = measurements.find(m => m.id === id);
    
    if (!measurement) {
      return res.status(404).json({ error: 'Takeoff measurement not found' });
    }
    
    // Verify access to project
    const hasAccess = await hasProjectAccess(userId!, measurement.projectId, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Measurement not found or access denied' });
    }
    
    await storage.deleteTakeoffMeasurement(id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting takeoff measurement:', error);
    return res.status(500).json({ error: 'Failed to delete takeoff measurement' });
  }
});

export default router;
