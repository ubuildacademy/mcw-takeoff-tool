import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage } from '../storage';
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
    
    // Get conditions for the project
    const { data: conditions, error } = await supabase
      .from(TABLES.CONDITIONS)
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching conditions:', error);
      return res.status(500).json({ error: 'Failed to fetch conditions' });
    }
    
    return res.json({ conditions: conditions || [] });
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
      materialCost,
      aiGenerated = false
    } = req.body;

    // Count conditions should not have waste factors
    const finalWasteFactor = type === 'count' ? 0 : wasteFactor;

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
      wasteFactor: finalWasteFactor,
      color,
      description,
      laborCost,
      materialCost,
      aiGenerated,
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
      materialCost,
      aiGenerated
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
    
    // Count conditions should not have waste factors
    const finalWasteFactor = (type !== undefined && type === 'count') ? 0 : 
                            (wasteFactor !== undefined ? wasteFactor : existingCondition.wasteFactor);

    // Update the condition
    const updatedCondition = {
      ...existingCondition,
      ...(name !== undefined && { name }),
      ...(type !== undefined && { type }),
      ...(unit !== undefined && { unit }),
      ...(wasteFactor !== undefined && { wasteFactor: finalWasteFactor }),
      ...(color !== undefined && { color }),
      ...(description !== undefined && { description }),
      ...(laborCost !== undefined && { laborCost }),
      ...(materialCost !== undefined && { materialCost }),
      ...(aiGenerated !== undefined && { aiGenerated })
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
