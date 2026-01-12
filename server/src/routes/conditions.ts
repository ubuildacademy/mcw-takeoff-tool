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
    
    // Get conditions for the project using storage service to ensure proper data conversion
    const conditions = await storage.getConditionsByProject(projectId);
    
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
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

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
      equipmentCost,
      includePerimeter,
      depth,
      includeHeight,
      height,
      // Note: aiGenerated column doesn't exist in database, so it's not included
      // Auto-count specific fields
      searchImage,
      searchImageId,
      searchThreshold,
      searchScope
    } = req.body;

    // Validation
    if (!projectId || !name || !type || !unit) {
      return res.status(400).json({ 
        error: 'Missing required fields: projectId, name, type, and unit are required' 
      });
    }

    // Check if user is admin
    const userIsAdmin = await isAdmin(user.id);
    
    // Verify the user has access to this project
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

    // Count and auto-count conditions should not have waste factors
    const finalWasteFactor = (type === 'count' || type === 'auto-count') ? 0 : wasteFactor;

    if (!['area', 'volume', 'linear', 'count', 'auto-count'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid type. Must be one of: area, volume, linear, count, auto-count'
      });
    }

    // Validate depth for volume conditions
    let validatedDepth = depth;
    if (type === 'volume') {
      console.log('🔍 Validating depth for volume condition:', { depth, depthType: typeof depth });
      
      // Handle depth - it should already be a number from frontend, but handle string case
      let depthValue: number;
      if (typeof depth === 'string') {
        // Try to parse as number
        depthValue = parseFloat(depth);
        if (isNaN(depthValue)) {
          console.error('❌ Depth is not a valid number:', depth);
          return res.status(400).json({ 
            error: 'Depth must be a valid number greater than 0' 
          });
        }
      } else if (typeof depth === 'number') {
        depthValue = depth;
      } else {
        console.error('❌ Depth is missing or invalid type:', depth);
        return res.status(400).json({ 
          error: 'Depth is required for volume conditions and must be greater than 0' 
        });
      }
      
      if (!depthValue || isNaN(depthValue) || depthValue <= 0) {
        console.error('❌ Depth validation failed:', { depthValue, isNaN: isNaN(depthValue), isPositive: depthValue > 0 });
        return res.status(400).json({ 
          error: 'Depth is required for volume conditions and must be greater than 0' 
        });
      }
      
      console.log('✅ Depth validation passed:', depthValue);
      // Use the numeric value
      validatedDepth = depthValue;
    }

    // Validate height for linear conditions with height enabled
    let validatedHeight = height;
    if (type === 'linear' && includeHeight) {
      console.log('🔍 Validating height for linear condition:', { height, heightType: typeof height });
      
      // Handle height - it should already be a number from frontend, but handle string case
      let heightValue: number;
      if (typeof height === 'string') {
        // Try to parse as number
        heightValue = parseFloat(height);
        if (isNaN(heightValue)) {
          console.error('❌ Height is not a valid number:', height);
          return res.status(400).json({ 
            error: 'Height must be a valid number greater than 0' 
          });
        }
      } else if (typeof height === 'number') {
        heightValue = height;
      } else {
        console.error('❌ Height is missing or invalid type:', height);
        return res.status(400).json({ 
          error: 'Height is required when height calculation is enabled and must be greater than 0' 
        });
      }
      
      if (!heightValue || isNaN(heightValue) || heightValue <= 0) {
        console.error('❌ Height validation failed:', { heightValue, isNaN: isNaN(heightValue), isPositive: heightValue > 0 });
        return res.status(400).json({ 
          error: 'Height is required when height calculation is enabled and must be greater than 0' 
        });
      }
      
      console.log('✅ Height validation passed:', heightValue);
      // Use the numeric value
      validatedHeight = heightValue;
    }

    // Normalize equipmentCost - convert to number or null
    let normalizedEquipmentCost: number | null | undefined = equipmentCost;
    if (equipmentCost !== undefined) {
      if (equipmentCost === null || equipmentCost === '') {
        normalizedEquipmentCost = null;
      } else {
        const numValue = typeof equipmentCost === 'string' ? parseFloat(equipmentCost) : equipmentCost;
        normalizedEquipmentCost = isNaN(numValue) ? null : numValue;
      }
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
      equipmentCost: normalizedEquipmentCost,
      includePerimeter: includePerimeter !== undefined ? includePerimeter : false,
      depth: validatedDepth,
      includeHeight: includeHeight !== undefined ? includeHeight : false,
      height: validatedHeight,
      // Note: aiGenerated is not included as the column doesn't exist in the database
      // aiGenerated,
      // Auto-count specific fields
      ...(type === 'auto-count' && {
        searchImage,
        searchImageId,
        searchThreshold: searchThreshold || 0.7,
        searchScope: searchScope || 'current-page'
      }),
      createdAt: now
    };
    
    console.log('Creating condition with data:', JSON.stringify(newCondition, null, 2));
    console.log('Depth value being saved:', { depth: newCondition.depth, depthType: typeof newCondition.depth });
    
    try {
      const savedCondition = await storage.saveCondition(newCondition);
      console.log('Successfully created condition:', savedCondition.id);
      
      return res.status(201).json({ 
        success: true, 
        condition: savedCondition 
      });
    } catch (saveError) {
      console.error('❌ Error saving condition to database:', saveError);
      const saveErrorMessage = saveError instanceof Error ? saveError.message : String(saveError);
      const saveErrorDetails = saveError instanceof Error ? saveError.stack : undefined;
      console.error('❌ Save error details:', saveErrorDetails);
      
      // If it's a database error, provide more details
      if (saveError && typeof saveError === 'object' && 'code' in saveError) {
        console.error('❌ Database error code:', (saveError as any).code);
        console.error('❌ Database error details:', (saveError as any).details);
        console.error('❌ Database error hint:', (saveError as any).hint);
      }
      
      return res.status(500).json({ 
        error: 'Failed to save condition to database',
        details: saveErrorMessage,
        code: (saveError as any)?.code,
        hint: (saveError as any)?.hint
      });
    }
  } catch (error) {
    console.error('❌ Error creating condition (outer catch):', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorDetails = error instanceof Error ? error.stack : undefined;
    console.error('❌ Error details:', errorDetails);
    return res.status(500).json({ 
      error: 'Failed to create condition',
      details: errorMessage
    });
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
      equipmentCost,
      includePerimeter,
      depth,
      includeHeight,
      height,
      // Note: aiGenerated column doesn't exist in database, so it's not included
      // Visual search specific fields
      searchImage,
      searchImageId,
      searchThreshold
    } = req.body;

    // Validation
    if (type && !['area', 'volume', 'linear', 'count', 'auto-count'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid type. Must be one of: area, volume, linear, count, auto-count'
      });
    }

    const conditions = await storage.getConditions();
    const existingCondition = conditions.find(c => c.id === id);
    
    if (!existingCondition) {
      return res.status(404).json({ error: 'Condition not found' });
    }
    
    // Count and auto-count conditions should not have waste factors
    const finalWasteFactor = (type !== undefined && (type === 'count' || type === 'auto-count')) ? 0 : 
                            (wasteFactor !== undefined ? wasteFactor : existingCondition.wasteFactor);

    // Validate height for linear conditions with height enabled
    let validatedHeight = height;
    if ((type === 'linear' || existingCondition.type === 'linear') && (includeHeight !== undefined ? includeHeight : existingCondition.includeHeight)) {
      const heightToValidate = height !== undefined ? height : existingCondition.height;
      
      if (heightToValidate === undefined || heightToValidate === null) {
        return res.status(400).json({ 
          error: 'Height is required when height calculation is enabled and must be greater than 0' 
        });
      }
      
      let heightValue: number;
      if (typeof heightToValidate === 'string') {
        heightValue = parseFloat(heightToValidate);
        if (isNaN(heightValue)) {
          return res.status(400).json({ 
            error: 'Height must be a valid number greater than 0' 
          });
        }
      } else if (typeof heightToValidate === 'number') {
        heightValue = heightToValidate;
      } else {
        return res.status(400).json({ 
          error: 'Height must be a valid number greater than 0' 
        });
      }
      
      if (!heightValue || isNaN(heightValue) || heightValue <= 0) {
        return res.status(400).json({ 
          error: 'Height is required when height calculation is enabled and must be greater than 0' 
        });
      }
      
      validatedHeight = heightValue;
    }

    // Normalize equipmentCost - convert to number or null, handle 0 explicitly
    let normalizedEquipmentCost: number | null | undefined = equipmentCost;
    if (equipmentCost !== undefined) {
      if (equipmentCost === null || equipmentCost === '') {
        normalizedEquipmentCost = null;
      } else {
        const numValue = typeof equipmentCost === 'string' ? parseFloat(equipmentCost) : equipmentCost;
        normalizedEquipmentCost = isNaN(numValue) ? null : numValue;
      }
    }

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
      ...(normalizedEquipmentCost !== undefined && { equipmentCost: normalizedEquipmentCost }),
      ...(includePerimeter !== undefined && { includePerimeter }),
      ...(depth !== undefined && { depth }),
      ...(includeHeight !== undefined && { includeHeight }),
      ...(height !== undefined && { height: validatedHeight }),
      // Note: aiGenerated not included as column doesn't exist in database
      // Auto-count specific fields
      ...(searchImage !== undefined && { searchImage }),
      ...(searchImageId !== undefined && { searchImageId }),
      ...(searchThreshold !== undefined && { searchThreshold }),
      ...(searchScope !== undefined && { searchScope })
    };
    
    const savedCondition = await storage.saveCondition(updatedCondition);
    
    return res.json({ 
      success: true, 
      condition: savedCondition 
    });
  } catch (error: any) {
    console.error('Error updating condition:', error);
    // Log more details for debugging
    if (error.message) {
      console.error('Error message:', error.message);
    }
    if (error.details) {
      console.error('Error details:', error.details);
    }
    if (error.hint) {
      console.error('Error hint:', error.hint);
    }
    return res.status(500).json({ 
      error: 'Failed to update condition',
      details: error.message || 'Unknown error'
    });
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
