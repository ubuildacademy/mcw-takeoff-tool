import express from 'express';
import { storage } from '../storage';
import { supabase } from '../supabase';
import { requireAuth, hasProjectAccess, validateUUIDParam, isAdmin } from '../middleware';

const router = express.Router();

// Get calibration for a specific project and sheet (optionally for a specific page)
// Note: sheetId is a compound format (documentId-pageNumber), not a UUID
router.get('/project/:projectId/sheet/:sheetId', requireAuth, validateUUIDParam('projectId'), async (req, res) => {
  try {
    const { projectId, sheetId } = req.params;
    const pageNumber = req.query.pageNumber ? parseInt(req.query.pageNumber as string) : undefined;
    
    // Verify user has access to this project
    const userIsAdmin = await isAdmin(req.user!.id);
    if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    // Get calibration with page-specific fallback to document-level
    const calibration = await storage.getCalibration(projectId, sheetId, pageNumber);
    
    if (!calibration) {
      return res.status(404).json({ error: 'Calibration not found' });
    }

    res.json({ calibration });
  } catch (error: any) {
    console.error('Error fetching calibration:', error);
    res.status(500).json({ error: 'Failed to fetch calibration' });
  }
});

// Get all calibrations for a project
router.get('/project/:projectId', requireAuth, validateUUIDParam('projectId'), async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Verify user has access to this project
    const userIsAdmin = await isAdmin(req.user!.id);
    if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    const calibrations = await storage.getCalibrationsByProject(projectId);
    res.json({ calibrations });
  } catch (error: any) {
    console.error('Error fetching calibrations:', error);
    res.status(500).json({ error: 'Failed to fetch calibrations' });
  }
});

// Save calibration
router.post('/', requireAuth, async (req, res) => {
  try {
    const { projectId, sheetId, scaleFactor, unit, pageNumber, scope, viewportWidth, viewportHeight, rotation } = req.body;

    if (!projectId || !sheetId || scaleFactor === undefined || !unit) {
      return res.status(400).json({ error: 'Missing required fields: projectId, sheetId, scaleFactor, unit' });
    }

    // Verify user has access to this project
    const userIsAdmin = await isAdmin(req.user!.id);
    if (!userIsAdmin && !(await hasProjectAccess(req.user!.id, projectId, userIsAdmin))) {
      return res.status(404).json({ error: 'Project not found or access denied' });
    }

    // Determine pageNumber based on scope
    // scope = 'document' -> pageNumber = null (applies to all pages)
    // scope = 'page' -> pageNumber = provided pageNumber (page-specific)
    const calibrationPageNumber = (scope === 'document') ? null : (pageNumber ?? null);

    const calibration = await storage.saveCalibration({
      projectId,
      sheetId,
      pageNumber: calibrationPageNumber,
      scaleFactor,
      unit,
      calibratedAt: new Date().toISOString(),
      viewportWidth: viewportWidth ?? null,
      viewportHeight: viewportHeight ?? null,
      rotation: rotation ?? null
    });

    res.json({ calibration });
  } catch (error: any) {
    console.error('Error saving calibration:', error);
    res.status(500).json({ error: 'Failed to save calibration' });
  }
});

export default router;

