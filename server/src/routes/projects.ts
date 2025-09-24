import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage, StoredProject } from '../storage';

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

export { router as projectRoutes };
