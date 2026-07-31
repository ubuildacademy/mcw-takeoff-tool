import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage } from '../storage';
import { supabase, TABLES } from '../supabase';
import { devLog } from '../lib/devLog';
import { 
  requireAuth, 
  requireProjectAccess,
  validateUUIDParam,
  sanitizeBody,
  isAdmin as checkIsAdmin,
  hasProjectAccess,
  isValidUUIDAnyVersion
} from '../middleware';
import { getAssemblyDetail, getOrganizationForUser } from '../services/assemblyLibraryService';

const router = express.Router();

/**
 * Resolve and validate a condition's assembly link before it is saved (task I6).
 *
 * The database trigger enforces that the input belongs to the assembly, but it
 * cannot know whose org the assembly is in — and an id from another company is
 * exactly what must not be linkable. Checking here also turns a raw trigger
 * exception into a message the UI can show.
 *
 * When the assembly has exactly ONE quantity input, it is chosen here rather
 * than asked for. That is what keeps the dialog to "pick an assembly and go"
 * for the common case.
 */
async function resolveAssemblyLink(
  userId: string,
  assemblyId: unknown,
  quantityInputId: unknown
): Promise<
  | { error: string }
  | { assemblyId: string | null; assemblyQuantityInputId: string | null }
> {
  if (assemblyId === undefined || assemblyId === null || assemblyId === '') {
    // Clearing the link, or never setting one.
    return { assemblyId: null, assemblyQuantityInputId: null };
  }
  if (typeof assemblyId !== 'string' || !isValidUUIDAnyVersion(assemblyId)) {
    return { error: 'assemblyId must be a valid id' };
  }
  const org = await getOrganizationForUser(userId);
  if (!org) {
    return { error: 'You are not a member of an organization, so assemblies are unavailable' };
  }

  const assembly = await getAssemblyDetail(org.id, assemblyId);
  if (!assembly) return { error: 'Assembly not found in your organization' };

  if (quantityInputId === undefined || quantityInputId === null || quantityInputId === '') {
    if (assembly.quantityInputs.length === 1) {
      return { assemblyId, assemblyQuantityInputId: assembly.quantityInputs[0].id };
    }
    // Nothing to price against, and nothing to guess from.
    return {
      error:
        assembly.quantityInputs.length === 0
          ? 'That assembly has no quantity inputs, so it cannot price a condition'
          : 'This assembly prices more than one quantity, so one must be chosen',
    };
  }
  if (typeof quantityInputId !== 'string' || !assembly.quantityInputs.some((i) => i.id === quantityInputId)) {
    return { error: 'That quantity input does not belong to the selected assembly' };
  }
  return { assemblyId, assemblyQuantityInputId: quantityInputId };
}

// Get all conditions - requires admin (dangerous endpoint that returns all data)
router.get('/', requireAuth, async (req, res) => {
  try {
    // Only admins can see all conditions across all projects
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required to view all conditions' });
    }
    
    const conditions = await storage.getConditions();
    return res.json({ conditions });
  } catch (error) {
    console.error('Error fetching all conditions:', error);
    return res.status(500).json({ error: 'Failed to fetch conditions' });
  }
});

// Get all conditions for a project - uses middleware for auth
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
    
    // Get conditions for the project using storage service to ensure proper data conversion
    const conditions = await storage.getConditionsByProject(projectId);
    
    return res.json({ conditions: conditions || [] });
  } catch (error) {
    console.error('Error fetching conditions:', error);
    return res.status(500).json({ error: 'Failed to fetch conditions' });
  }
});

// Get a specific condition by ID - requires auth and project access
router.get('/:id', requireAuth, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    
    const condition = await storage.getConditionById(id);

    if (!condition) {
      return res.status(404).json({ error: 'Condition not found' });
    }

    // Verify user has access to the project this condition belongs to
    const hasAccess = await hasProjectAccess(userId!, condition.projectId, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Condition not found or access denied' });
    }
    
    return res.json({ condition });
  } catch (error) {
    console.error('Error fetching condition:', error);
    return res.status(500).json({ error: 'Failed to fetch condition' });
  }
});

// Create a new condition - requires auth and project access
router.post('/', requireAuth, sanitizeBody('name', 'description'), async (req, res) => {
  try {
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';

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
      searchScope,
      lineThickness,
      folderId,
      markerShape,
      multiplier,
      subQuantityType,
      subQuantityUnit,
      subQuantityPerCount,
      assemblyId,
      assemblyQuantityInputId,
    } = req.body;

    // Validation
    if (!projectId || !name || !type || !unit) {
      return res.status(400).json({ 
        error: 'Missing required fields: projectId, name, type, and unit are required' 
      });
    }

    // Verify the user has access to this project
    const hasAccess = await hasProjectAccess(userId!, projectId, userIsAdmin);
    if (!hasAccess) {
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
      devLog('🔍 Validating depth for volume condition:', { depth, depthType: typeof depth });
      
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
      
      devLog('✅ Depth validation passed:', depthValue);
      // Use the numeric value
      validatedDepth = depthValue;
    }

    // Validate height for linear conditions with height enabled
    let validatedHeight = height;
    if (type === 'linear' && includeHeight) {
      devLog('🔍 Validating height for linear condition:', { height, heightType: typeof height });
      
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
      
      devLog('✅ Height validation passed:', heightValue);
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

    const link = await resolveAssemblyLink(userId!, assemblyId, assemblyQuantityInputId);
    if ('error' in link) {
      return res.status(400).json({ error: link.error });
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
      ...(type === 'linear' && lineThickness != null && {
        lineThickness: Math.max(1, Math.min(8, typeof lineThickness === 'string' ? parseInt(lineThickness, 10) || 2 : lineThickness))
      }),
      ...((type === 'count' || type === 'auto-count') && markerShape != null && { markerShape }),
      ...(multiplier != null && Number.isInteger(Number(multiplier)) && Number(multiplier) >= 1 && { multiplier: Number(multiplier) }),
      ...((type === 'count' || type === 'auto-count') && subQuantityType != null ? {
        subQuantityType: subQuantityType || null,
        subQuantityUnit: subQuantityUnit || null,
        subQuantityPerCount: subQuantityPerCount != null ? Number(subQuantityPerCount) : null,
      } : {}),
      assemblyId: link.assemblyId,
      assemblyQuantityInputId: link.assemblyQuantityInputId,
      folderId: folderId ?? null,
      createdAt: now
    };

    devLog('Creating condition with data:', JSON.stringify(newCondition, null, 2));
    devLog('Depth value being saved:', { depth: newCondition.depth, depthType: typeof newCondition.depth });
    
    try {
      const savedCondition = await storage.saveCondition(newCondition);
      devLog('Successfully created condition:', savedCondition.id);
      
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
      const dbErr = saveError && typeof saveError === 'object' && 'code' in saveError ? saveError as { code?: string; details?: unknown; hint?: string } : null;
      if (dbErr) {
        console.error('❌ Database error code:', dbErr.code);
        console.error('❌ Database error details:', dbErr.details);
        console.error('❌ Database error hint:', dbErr.hint);
      }
      
      return res.status(500).json({ 
        error: 'Failed to save condition to database',
        details: saveErrorMessage,
        code: dbErr?.code,
        hint: dbErr?.hint
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

// Update an existing condition - requires auth and project access
router.put('/:id', requireAuth, validateUUIDParam('id'), sanitizeBody('name', 'description'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
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
      // Auto-count specific fields
      searchImage,
      searchImageId,
      searchThreshold,
      searchScope,
      lineThickness,
      folderId,
      markerShape,
      multiplier,
      subQuantityType,
      subQuantityUnit,
      subQuantityPerCount,
      assemblyId,
      assemblyQuantityInputId,
    } = req.body;

    // Validation
    if (type && !['area', 'volume', 'linear', 'count', 'auto-count'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid type. Must be one of: area, volume, linear, count, auto-count'
      });
    }

    const existingCondition = await storage.getConditionById(id);
    
    if (!existingCondition) {
      return res.status(404).json({ error: 'Condition not found' });
    }
    
    // Verify user has access to the project this condition belongs to
    const hasAccess = await hasProjectAccess(userId!, existingCondition.projectId, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Condition not found or access denied' });
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

    // The assembly link is only touched when the request mentions it — a PUT
    // that says nothing about assemblies must leave an existing link alone.
    // Sending only an input id re-checks it against the link already stored.
    let link: { assemblyId: string | null; assemblyQuantityInputId: string | null } | null = null;
    if (assemblyId !== undefined || assemblyQuantityInputId !== undefined) {
      const targetAssemblyId = assemblyId !== undefined ? assemblyId : existingCondition.assemblyId;
      const resolved = await resolveAssemblyLink(userId!, targetAssemblyId, assemblyQuantityInputId);
      if ('error' in resolved) {
        return res.status(400).json({ error: resolved.error });
      }
      link = resolved;
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
      ...(searchScope !== undefined && { searchScope }),
      ...(lineThickness !== undefined && {
        lineThickness: Math.max(1, Math.min(8, typeof lineThickness === 'string' ? parseInt(lineThickness, 10) || 2 : lineThickness))
      }),
      ...(folderId !== undefined && { folderId: folderId ?? null }),
      ...(markerShape !== undefined && { markerShape }),
      ...(multiplier !== undefined && (
        multiplier === null
          ? { multiplier: undefined }
          : Number.isInteger(Number(multiplier)) && Number(multiplier) >= 1
            ? { multiplier: Number(multiplier) }
            : {}
      )),
      ...(subQuantityType !== undefined && { subQuantityType: subQuantityType || null }),
      ...(subQuantityUnit !== undefined && { subQuantityUnit: subQuantityUnit || null }),
      ...(subQuantityPerCount !== undefined && { subQuantityPerCount: subQuantityPerCount === null ? null : Number(subQuantityPerCount) }),
      ...(link !== null && {
        assemblyId: link.assemblyId,
        assemblyQuantityInputId: link.assemblyQuantityInputId,
      }),
    };

    const savedCondition = await storage.saveCondition(updatedCondition);
    
    return res.json({ 
      success: true, 
      condition: savedCondition 
    });
  } catch (error: unknown) {
    console.error('Error updating condition:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    const errObj = error && typeof error === 'object' && 'details' in error ? error as { details?: unknown; hint?: string } : null;
    if (errObj?.details) console.error('Error details:', errObj.details);
    if (errObj?.hint) console.error('Error hint:', errObj.hint);
    return res.status(500).json({ 
      error: 'Failed to update condition',
      details: errMsg
    });
  }
});

// Delete a condition - requires auth and project access
router.delete('/:id', requireAuth, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    
    const condition = await storage.getConditionById(id);
    
    if (!condition) {
      return res.status(404).json({ error: 'Condition not found' });
    }
    
    // Verify user has access to the project
    const hasAccess = await hasProjectAccess(userId!, condition.projectId, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Condition not found or access denied' });
    }
    
    await storage.deleteCondition(id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting condition:', error);
    return res.status(500).json({ error: 'Failed to delete condition' });
  }
});

// Duplicate a condition (copy to same project) - requires auth and project access
router.post('/:id/duplicate', requireAuth, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';
    
    const originalCondition = await storage.getConditionById(id);
    
    if (!originalCondition) {
      return res.status(404).json({ error: 'Condition not found' });
    }
    
    // Verify user has access to the project
    const hasAccess = await hasProjectAccess(userId!, originalCondition.projectId, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Condition not found or access denied' });
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
