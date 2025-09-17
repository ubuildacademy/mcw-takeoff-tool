import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage, StoredTakeoffMeasurement } from '../storage';

const router = express.Router();

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
    const { projectId } = req.params;
    const measurements = await storage.getTakeoffMeasurementsByProject(projectId);
    return res.json({ measurements });
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
    const now = new Date().toISOString();
    
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
    console.error('Error creating takeoff measurement:', error);
    return res.status(500).json({ error: 'Failed to create takeoff measurement' });
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
