import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { storage, StoredProject } from '../storage';

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const projects = await storage.getProjects();
    
    // Calculate takeoff counts for each project
    const projectsWithCounts = await Promise.all(
      projects.map(async (project) => {
        try {
          const measurements = await storage.getTakeoffMeasurementsByProject(project.id);
          const takeoffCount = measurements.length;
          
          // Note: We don't calculate totalValue here since calculatedValue represents
          // measurement quantities (SF, LF, etc.) not monetary values
          // Total value would need to be calculated using condition pricing if available
          
          return {
            ...project,
            takeoffCount,
            totalValue: 0 // Set to 0 since we don't have pricing information
          };
        } catch (error) {
          console.error(`Error calculating takeoff count for project ${project.id}:`, error);
          return {
            ...project,
            takeoffCount: 0,
            totalValue: 0
          };
        }
      })
    );
    
    return res.json({ projects: projectsWithCounts });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

router.post('/', async (req, res) => {
  try {
    const id = uuidv4();
    const now = new Date().toISOString();
    const incoming = req.body as Partial<StoredProject>;
    const project: StoredProject = {
      id,
      name: incoming.name || 'Untitled',
      client: incoming.client,
      location: incoming.location,
      status: (incoming.status as any) || 'active',
      description: incoming.description,
      projectType: incoming.projectType,
      startDate: incoming.startDate,
      estimatedValue: incoming.estimatedValue,
      contactPerson: incoming.contactPerson,
      contactEmail: incoming.contactEmail,
      contactPhone: incoming.contactPhone,
      createdAt: now,
      lastModified: now
    };
    const savedProject = await storage.saveProject(project);
    return res.status(201).json({ success: true, project: savedProject });
  } catch (error) {
    console.error('Error creating project:', error);
    return res.status(500).json({ error: 'Failed to create project' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const projects = await storage.getProjects();
    const project = projects.find(p => p.id === id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    // Calculate takeoff count for this project
    try {
      const measurements = await storage.getTakeoffMeasurementsByProject(project.id);
      const takeoffCount = measurements.length;
      
      // Note: We don't calculate totalValue here since calculatedValue represents
      // measurement quantities (SF, LF, etc.) not monetary values
      // Total value would need to be calculated using condition pricing if available
      
      const projectWithCounts = {
        ...project,
        takeoffCount,
        totalValue: 0 // Set to 0 since we don't have pricing information
      };
      
      return res.json({ project: projectWithCounts });
    } catch (error) {
      console.error(`Error calculating takeoff count for project ${project.id}:`, error);
      const projectWithCounts = {
        ...project,
        takeoffCount: 0,
        totalValue: 0
      };
      return res.json({ project: projectWithCounts });
    }
  } catch (error) {
    console.error('Error fetching project:', error);
    return res.status(500).json({ error: 'Failed to fetch project' });
  }
});

router.get('/:id/conditions', (req, res) => {
  const { id } = req.params;
  
  // This endpoint is deprecated - use /api/conditions/project/:projectId instead
  // Keeping for backward compatibility but returning empty array
  return res.json({ conditions: [] });
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const projects = await storage.getProjects();
    const existingProject = projects.find(p => p.id === id);
    if (!existingProject) return res.status(404).json({ error: 'Not found' });
    
    const updates = req.body as Partial<StoredProject>;
    const updated: StoredProject = { ...existingProject, ...updates, lastModified: new Date().toISOString() };
    const savedProject = await storage.saveProject(updated);
    return res.json({ success: true, project: savedProject });
  } catch (error) {
    console.error('Error updating project:', error);
    return res.status(500).json({ error: 'Failed to update project' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await storage.deleteProject(id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    return res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Export project endpoint
router.get('/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get all project data
    const [project, conditions, files, measurements] = await Promise.all([
      storage.getProject(id),
      storage.getConditionsByProject(id),
      storage.getFilesByProject(id),
      storage.getTakeoffMeasurementsByProject(id)
    ]);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get sheets data for each file
    const sheetsPromises = files.map(async (file) => {
      try {
        const sheets = await storage.getSheetsByDocument(file.id);
        return sheets;
      } catch (error) {
        console.warn('Failed to get sheets for file:', file.id, error);
        return [];
      }
    });

    const sheetsArrays = await Promise.all(sheetsPromises);
    const sheets = sheetsArrays.flat();

    // Create backup object
    const backup = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      project,
      conditions,
      files,
      sheets,
      measurements,
      metadata: {
        totalFiles: files.length,
        totalConditions: conditions.length,
        totalMeasurements: measurements.length,
        totalSheets: sheets.length
      }
    };

    // Set headers for file download
    const filename = `${project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_backup_${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    return res.json(backup);
  } catch (error) {
    console.error('Error exporting project:', error);
    return res.status(500).json({ error: 'Failed to export project' });
  }
});

// Import project endpoint
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Parse the backup file
    const text = req.file.buffer.toString('utf-8');
    const backup = JSON.parse(text);

    // Validate backup format
    if (!backup.version || !backup.project || !backup.timestamp) {
      return res.status(400).json({ error: 'Invalid backup file format' });
    }

    // Create the project (without the original ID to avoid conflicts)
    const { id: originalId, ...projectData } = backup.project;
    const newProject = await storage.saveProject({
      ...projectData,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString()
    });

    const newProjectId = newProject.id;

    // Import conditions
    if (backup.conditions && backup.conditions.length > 0) {
      const conditionsPromises = backup.conditions.map(async (condition: any) => {
        const { id: originalId, ...conditionData } = condition;
        return storage.saveCondition({
          ...conditionData,
          id: uuidv4(),
          projectId: newProjectId
        });
      });
      await Promise.all(conditionsPromises);
    }

    // Import measurements
    if (backup.measurements && backup.measurements.length > 0) {
      const measurementsPromises = backup.measurements.map(async (measurement: any) => {
        const { id: originalId, ...measurementData } = measurement;
        return storage.saveTakeoffMeasurement({
          ...measurementData,
          id: uuidv4(),
          projectId: newProjectId
        });
      });
      await Promise.all(measurementsPromises);
    }

    // Note: Files cannot be automatically restored as they contain binary data
    // Users will need to re-upload PDF files manually

    return res.json({ 
      success: true, 
      project: newProject,
      message: 'Project restored successfully. Please re-upload PDF files manually.'
    });
  } catch (error) {
    console.error('Error importing project:', error);
    return res.status(500).json({ error: 'Failed to import project' });
  }
});

export { router as projectRoutes };
