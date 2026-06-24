import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage } from '../storage';
import {
  requireAuth,
  validateUUIDParam,
  sanitizeBody,
  hasProjectAccess,
} from '../middleware';

const router = express.Router();

// GET /condition-folders/project/:projectId
router.get('/project/:projectId', requireAuth, validateUUIDParam('projectId'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';

    const hasAccess = await hasProjectAccess(userId!, projectId, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    const folders = await storage.getConditionFoldersByProject(projectId);
    return res.json({ folders });
  } catch (error) {
    console.error('Error fetching condition folders:', error);
    return res.status(500).json({ error: 'Failed to fetch condition folders' });
  }
});

// POST /condition-folders
router.post('/', requireAuth, sanitizeBody('name'), async (req, res) => {
  try {
    const { projectId, name } = req.body;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';

    if (!projectId || !name?.trim()) {
      return res.status(400).json({ error: 'projectId and name are required' });
    }

    const hasAccess = await hasProjectAccess(userId!, projectId, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    // Sort order = count of existing folders so new folder goes to end
    const existing = await storage.getConditionFoldersByProject(projectId);
    const sortOrder = existing.length;

    const folder = await storage.saveConditionFolder({
      id: uuidv4(),
      projectId,
      name: name.trim(),
      sortOrder,
    });

    return res.status(201).json({ success: true, folder });
  } catch (error) {
    console.error('Error creating condition folder:', error);
    return res.status(500).json({ error: 'Failed to create condition folder' });
  }
});

// PUT /condition-folders/:id
router.put('/:id', requireAuth, validateUUIDParam('id'), sanitizeBody('name'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sortOrder } = req.body;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';

    // Fetch existing to check project access
    const existing = await storage.getConditionFoldersByProject('');
    // We need the folder to get its projectId — fetch via a broader lookup
    // Re-use supabase direct query since storage doesn't have getFolder by id
    const { supabase, TABLES } = await import('../supabase');
    const { data, error } = await supabase
      .from(TABLES.CONDITION_FOLDERS)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const hasAccess = await hasProjectAccess(userId!, data.project_id, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Folder not found or access denied' });
    }

    const folder = await storage.saveConditionFolder({
      id,
      projectId: data.project_id,
      name: name?.trim() ?? data.name,
      sortOrder: sortOrder ?? data.sort_order,
      createdAt: data.created_at,
    });

    return res.json({ success: true, folder });
  } catch (error) {
    console.error('Error updating condition folder:', error);
    return res.status(500).json({ error: 'Failed to update condition folder' });
  }
});

// DELETE /condition-folders/:id
router.delete('/:id', requireAuth, validateUUIDParam('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userIsAdmin = req.user?.role === 'admin';

    const { supabase, TABLES } = await import('../supabase');
    const { data, error } = await supabase
      .from(TABLES.CONDITION_FOLDERS)
      .select('project_id')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const hasAccess = await hasProjectAccess(userId!, data.project_id, userIsAdmin);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Folder not found or access denied' });
    }

    await storage.deleteConditionFolder(id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting condition folder:', error);
    return res.status(500).json({ error: 'Failed to delete condition folder' });
  }
});

export { router as conditionFolderRoutes };
