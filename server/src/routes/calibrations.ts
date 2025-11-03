import express from 'express';
import { storage } from '../storage';
import { supabase } from '../supabase';

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

// Get calibration for a specific project and sheet (optionally for a specific page)
router.get('/project/:projectId/sheet/:sheetId', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { projectId, sheetId } = req.params;
    const pageNumber = req.query.pageNumber ? parseInt(req.query.pageNumber as string) : undefined;
    
    // Verify user has access to this project
    const { data: project } = await supabase
      .from('takeoff_projects')
      .select('id, user_id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!project) {
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
router.get('/project/:projectId', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { projectId } = req.params;
    
    // Verify user has access to this project
    const { data: project } = await supabase
      .from('takeoff_projects')
      .select('id, user_id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!project) {
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
router.post('/', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { projectId, sheetId, scaleFactor, unit, pageNumber, scope } = req.body;

    if (!projectId || !sheetId || scaleFactor === undefined || !unit) {
      return res.status(400).json({ error: 'Missing required fields: projectId, sheetId, scaleFactor, unit' });
    }

    // Verify user has access to this project
    const { data: project } = await supabase
      .from('takeoff_projects')
      .select('id, user_id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!project) {
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
      calibratedAt: new Date().toISOString()
    });

    res.json({ calibration });
  } catch (error: any) {
    console.error('Error saving calibration:', error);
    res.status(500).json({ error: 'Failed to save calibration' });
  }
});

export default router;

