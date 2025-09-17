import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage } from '../storage';

const router = express.Router();

// Get all conditions
router.get('/', async (req, res) => {
  try {
    const conditions = await storage.getConditions();
    return res.json({ conditions });
  } catch (error) {
    console.error('Error fetching all conditions:', error);
    return res.status(500).json({ error: 'Failed to fetch conditions' });
  }
});

// Get all conditions for a project
router.get('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const conditions = await storage.getConditionsByProject(projectId);
    return res.json({ conditions });
  } catch (error) {
    console.error('Error fetching conditions:', error);
    return res.status(500).json({ error: 'Failed to fetch conditions' });
  }
});

// Get a specific condition by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const conditions = await storage.getConditions();
    const condition = conditions.find(c => c.id === id);
    
    if (!condition) {
      return res.status(404).json({ error: 'Condition not found' });
    }
    
    return res.json({ condition });
  } catch (error) {
    console.error('Error fetching condition:', error);
    return res.status(500).json({ error: 'Failed to fetch condition' });
  }
});

// Create a new condition
router.post('/', async (req, res) => {
  try {
    const {
      projectId,
      name,
      type,
      unit,
      wasteFactor = 0,
      color = '#ff6b6b',
      description,
      laborCost,
      materialCost
    } = req.body;

    // Validation
    if (!projectId || !name || !type || !unit) {
      return res.status(400).json({ 
        error: 'Missing required fields: projectId, name, type, and unit are required' 
      });
    }

    if (!['area', 'volume', 'linear', 'count'].includes(type)) {
      return res.status(400).json({ 
        error: 'Invalid type. Must be one of: area, volume, linear, count' 
      });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    
    const newCondition = {
      id,
      projectId,
      name,
      type,
      unit,
      wasteFactor,
      color,
      description,
      laborCost,
      materialCost,
      createdAt: now
    };
    
    const savedCondition = await storage.saveCondition(newCondition);
    
    return res.status(201).json({ 
      success: true, 
      condition: savedCondition 
    });
  } catch (error) {
    console.error('Error creating condition:', error);
    return res.status(500).json({ error: 'Failed to create condition' });
  }
});

// Update an existing condition
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      type,
      unit,
      wasteFactor,
      color,
      description,
      laborCost,
      materialCost
    } = req.body;

    // Validation
    if (type && !['area', 'volume', 'linear', 'count'].includes(type)) {
      return res.status(400).json({ 
        error: 'Invalid type. Must be one of: area, volume, linear, count' 
      });
    }

    const conditions = await storage.getConditions();
    const existingCondition = conditions.find(c => c.id === id);
    
    if (!existingCondition) {
      return res.status(404).json({ error: 'Condition not found' });
    }
    
    // Update the condition
    const updatedCondition = {
      ...existingCondition,
      ...(name !== undefined && { name }),
      ...(type !== undefined && { type }),
      ...(unit !== undefined && { unit }),
      ...(wasteFactor !== undefined && { wasteFactor }),
      ...(color !== undefined && { color }),
      ...(description !== undefined && { description }),
      ...(laborCost !== undefined && { laborCost }),
      ...(materialCost !== undefined && { materialCost })
    };
    
    const savedCondition = await storage.saveCondition(updatedCondition);
    
    return res.json({ 
      success: true, 
      condition: savedCondition 
    });
  } catch (error) {
    console.error('Error updating condition:', error);
    return res.status(500).json({ error: 'Failed to update condition' });
  }
});

// Delete a condition
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await storage.deleteCondition(id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting condition:', error);
    return res.status(500).json({ error: 'Failed to delete condition' });
  }
});

// Duplicate a condition (copy to same project)
router.post('/:id/duplicate', async (req, res) => {
  try {
    const { id } = req.params;
    const conditions = await storage.getConditions();
    const originalCondition = conditions.find(c => c.id === id);
    
    if (!originalCondition) {
      return res.status(404).json({ error: 'Condition not found' });
    }
    
    const newId = uuidv4();
    const now = new Date().toISOString();
    
    const newCondition = {
      ...originalCondition,
      id: newId,
      name: `${originalCondition.name} (Copy)`,
      createdAt: now
    };
    
    const savedCondition = await storage.saveCondition(newCondition);
    
    return res.status(201).json({ 
      success: true, 
      condition: savedCondition 
    });
  } catch (error) {
    console.error('Error duplicating condition:', error);
    return res.status(500).json({ error: 'Failed to duplicate condition' });
  }
});

export { router as conditionRoutes };
