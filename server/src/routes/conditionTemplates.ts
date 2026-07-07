/**
 * Condition templates API — DB persistence for reusable condition ("trade
 * pack") templates, so they follow the user across devices and can be shared
 * with the team instead of living in one browser's localStorage.
 *
 * Ids are client-generated strings: the client keeps its optimistic state and
 * one-time localStorage imports keep their existing ids (upsert).
 */
import express from 'express';
import { storage, type StoredConditionTemplate } from '../storage';
import { requireAuth } from '../middleware';

const router = express.Router();

function sanitizeTemplate(raw: unknown, userId: string): StoredConditionTemplate | null {
  const t = raw as Partial<StoredConditionTemplate> | null;
  if (!t || typeof t !== 'object') return null;
  if (typeof t.id !== 'string' || !t.id) return null;
  if (typeof t.name !== 'string' || !t.name.trim()) return null;
  if (!Array.isArray(t.conditions)) return null;
  const now = new Date().toISOString();
  return {
    id: t.id.slice(0, 128),
    userId,
    name: t.name.trim(),
    shared: typeof t.shared === 'boolean' ? t.shared : false,
    conditions: t.conditions,
    createdAt: typeof t.createdAt === 'string' ? t.createdAt : now,
    updatedAt: now,
  };
}

// Own templates + templates shared by other users
router.get('/', requireAuth, async (req, res) => {
  try {
    const templates = await storage.getConditionTemplatesForUser(req.user!.id);
    res.json({ templates });
  } catch (error) {
    console.error('Error fetching condition templates:', error);
    res.status(500).json({ error: 'Failed to fetch condition templates' });
  }
});

// Create (always owned by the requesting user)
router.post('/', requireAuth, async (req, res) => {
  try {
    const clean = sanitizeTemplate(req.body, req.user!.id);
    if (!clean) {
      return res.status(400).json({ error: 'Invalid condition template payload' });
    }
    // Save is an upsert on a client-supplied id: refuse to overwrite a row
    // someone else owns (shared template ids are visible to every user).
    const existing = await storage.getConditionTemplateById(clean.id);
    if (existing && existing.userId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'A template with this id belongs to another user' });
    }
    if (existing) {
      clean.userId = existing.userId; // never reassign ownership via upsert
      clean.createdAt = existing.createdAt;
    }
    await storage.saveConditionTemplate(clean);
    res.json({ success: true, template: clean });
  } catch (error) {
    console.error('Error saving condition template:', error);
    res.status(500).json({ error: 'Failed to save condition template' });
  }
});

// Update (owner or admin only; non-owners can't reassign ownership)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await storage.getConditionTemplateById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Condition template not found' });
    }
    if (existing.userId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to update this template' });
    }
    const { name, shared, conditions } = req.body ?? {};
    await storage.updateConditionTemplate(id, {
      ...(typeof name === 'string' && name.trim() && { name: name.trim() }),
      ...(typeof shared === 'boolean' && { shared }),
      ...(Array.isArray(conditions) && { conditions }),
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating condition template:', error);
    res.status(500).json({ error: 'Failed to update condition template' });
  }
});

// Delete (owner or admin only)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await storage.getConditionTemplateById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Condition template not found' });
    }
    if (existing.userId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to delete this template' });
    }
    await storage.deleteConditionTemplate(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting condition template:', error);
    res.status(500).json({ error: 'Failed to delete condition template' });
  }
});

export default router;
