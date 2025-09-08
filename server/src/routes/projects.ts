import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage, StoredProject } from '../storage';

const router = express.Router();

router.get('/', (req, res) => {
  const projects = storage.getProjects();
  return res.json({ projects });
});

router.post('/', (req, res) => {
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
  const projects = storage.getProjects();
  projects.push(project);
  storage.saveProjects(projects);
  return res.status(201).json({ success: true, project });
});

router.get('/:id', (req, res) => {
  const { id } = req.params;
  const projects = storage.getProjects();
  const project = projects.find(p => p.id === id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  return res.json({ project });
});

router.get('/:id/conditions', (req, res) => {
  const { id } = req.params;
  
  // This endpoint is deprecated - use /api/conditions/project/:projectId instead
  // Keeping for backward compatibility but returning empty array
  return res.json({ conditions: [] });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const projects = storage.getProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const updates = req.body as Partial<StoredProject>;
  const updated: StoredProject = { ...projects[idx], ...updates, lastModified: new Date().toISOString() };
  projects[idx] = updated;
  storage.saveProjects(projects);
  return res.json({ success: true, project: updated });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const before = storage.getProjects();
  const after = before.filter(p => p.id !== id);
  if (after.length === before.length) return res.status(404).json({ error: 'Not found' });
  storage.saveProjects(after);
  return res.json({ success: true });
});

export { router as projectRoutes };
