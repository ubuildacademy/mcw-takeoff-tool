import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage, StoredTakeoffMeasurement } from '../storage';
import { supabase, TABLES } from '../supabase';

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

// Get all takeoff measurements
router.get('/', async (req, res) => {
  try {
    const measurements = await storage.getTakeoffMeasurements();
    return res.json({ measurements });
  } catch (error) {
    console.error('Error fetching takeoff measurements:', error);
    return res.status(500).json({ error: 'Failed to fetch takeoff measurements' });
  }
});

// Get takeoff measurements for a project
router.get('/project/:projectId', async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { projectId } = req.params;
    
    // Check if user is admin
    const userIsAdmin = await isAdmin(user.id);
    
    // First, verify the user has access to this project
    let projectQuery = supabase
      .from(TABLES.PROJECTS)
      .select('id, user_id')
      .eq('id', projectId);
    
    if (!userIsAdmin) {
      projectQuery = projectQuery.eq('user_id', user.id);
    }
    
    const { data: project, error: projectError } = await projectQuery.single();
    
    if (projectError || !project) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }
    
    // Get measurements for the project
    const { data: measurements, error } = await supabase
      .from(TABLES.TAKEOFF_MEASUREMENTS)
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching project takeoff measurements:', error);
      return res.status(500).json({ error: 'Failed to fetch project takeoff measurements' });
    }
    
    return res.json({ measurements: measurements || [] });
  } catch (error) {
    console.error('Error fetching project takeoff measurements:', error);
    return res.status(500).json({ error: 'Failed to fetch project takeoff measurements' });
  }
});

// Get takeoff measurements for a specific sheet
router.get('/sheet/:sheetId', async (req, res) => {
  try {
    const { sheetId } = req.params;
    const measurements = await storage.getTakeoffMeasurementsBySheet(sheetId);
    return res.json({ measurements });
  } catch (error) {
    console.error('Error fetching sheet takeoff measurements:', error);
    return res.status(500).json({ error: 'Failed to fetch sheet takeoff measurements' });
  }
});

// Create a new takeoff measurement
router.post('/', async (req, res) => {
  try {
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
      perimeterValue
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
      perimeterValue
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

// Update an existing takeoff measurement
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const measurements = await storage.getTakeoffMeasurements();
    const existingMeasurement = measurements.find(m => m.id === id);
    
    if (!existingMeasurement) {
      return res.status(404).json({ error: 'Takeoff measurement not found' });
    }
    
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

// Delete a takeoff measurement
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await storage.deleteTakeoffMeasurement(id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting takeoff measurement:', error);
    return res.status(500).json({ error: 'Failed to delete takeoff measurement' });
  }
});

export default router;
