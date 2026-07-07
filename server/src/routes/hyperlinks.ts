/**
 * Sheet hyperlinks API — DB persistence for manual + auto-hyperlink link
 * regions (incl. deep-link target views), so links follow the project across
 * devices and shared-project members instead of living in one browser's
 * localStorage.
 *
 * Ids are client-generated strings: the client keeps its optimistic state and
 * one-time localStorage imports keep their existing ids (bulk upsert).
 */
import express from 'express';
import { storage, type StoredSheetHyperlink } from '../storage';
import { requireAuth, hasProjectAccess, validateUUIDParam, isAdmin } from '../middleware';

const router = express.Router();

async function requireProjectAccess(
  userId: string,
  projectId: string,
  res: express.Response
): Promise<boolean> {
  const userIsAdmin = await isAdmin(userId);
  if (!userIsAdmin && !(await hasProjectAccess(userId, projectId, userIsAdmin))) {
    res.status(404).json({ error: 'Project not found or access denied' });
    return false;
  }
  return true;
}

function sanitizeHyperlink(raw: unknown, projectId: string): StoredSheetHyperlink | null {
  const h = raw as Partial<StoredSheetHyperlink> | null;
  if (!h || typeof h !== 'object') return null;
  const rect = h.sourceRect;
  if (
    typeof h.id !== 'string' ||
    !h.id ||
    typeof h.sourceSheetId !== 'string' ||
    !Number.isInteger(h.sourcePageNumber) ||
    !rect ||
    typeof rect.x !== 'number' ||
    typeof rect.y !== 'number' ||
    typeof rect.width !== 'number' ||
    typeof rect.height !== 'number'
  ) {
    return null;
  }
  const viewport = h.targetViewport;
  const validViewport =
    viewport &&
    typeof viewport.x === 'number' &&
    typeof viewport.y === 'number' &&
    typeof viewport.zoom === 'number' &&
    viewport.zoom > 0
      ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
      : null;
  return {
    id: h.id.slice(0, 128),
    projectId,
    sourceSheetId: h.sourceSheetId,
    sourcePageNumber: h.sourcePageNumber as number,
    sourceRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    targetSheetId: typeof h.targetSheetId === 'string' ? h.targetSheetId : '',
    targetPageNumber: Number.isInteger(h.targetPageNumber) ? (h.targetPageNumber as number) : 1,
    targetUrl: typeof h.targetUrl === 'string' ? h.targetUrl : null,
    targetViewport: validViewport,
    origin: h.origin === 'batch' ? 'batch' : 'manual',
    detectedSheetRef: typeof h.detectedSheetRef === 'string' ? h.detectedSheetRef : null,
    timestamp: typeof h.timestamp === 'string' ? h.timestamp : new Date().toISOString(),
  };
}

// All hyperlinks for a project
router.get('/project/:projectId', requireAuth, validateUUIDParam('projectId'), async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!(await requireProjectAccess(req.user!.id, projectId, res))) return;
    const hyperlinks = await storage.getHyperlinksByProject(projectId);
    res.json({ hyperlinks });
  } catch (error) {
    console.error('Error fetching hyperlinks:', error);
    res.status(500).json({ error: 'Failed to fetch hyperlinks' });
  }
});

// Bulk upsert (create flow, auto-hyperlink apply, localStorage import, backup restore)
router.post('/project/:projectId/bulk', requireAuth, validateUUIDParam('projectId'), async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!(await requireProjectAccess(req.user!.id, projectId, res))) return;
    const rawList = Array.isArray(req.body?.hyperlinks) ? req.body.hyperlinks : [];
    const clean = rawList
      .map((raw: unknown) => sanitizeHyperlink(raw, projectId))
      .filter((h: StoredSheetHyperlink | null): h is StoredSheetHyperlink => h != null);
    if (clean.length === 0 && rawList.length > 0) {
      return res.status(400).json({ error: 'No valid hyperlinks in payload' });
    }
    await storage.saveHyperlinksBulk(clean);
    res.json({ success: true, saved: clean.length, skipped: rawList.length - clean.length });
  } catch (error) {
    console.error('Error saving hyperlinks:', error);
    res.status(500).json({ error: 'Failed to save hyperlinks' });
  }
});

// Update one link's target/rect/viewport
router.put('/project/:projectId/:id', requireAuth, validateUUIDParam('projectId'), async (req, res) => {
  try {
    const { projectId, id } = req.params;
    if (!(await requireProjectAccess(req.user!.id, projectId, res))) return;
    const { targetSheetId, targetPageNumber, targetUrl, sourceRect, targetViewport } = req.body ?? {};
    await storage.updateHyperlink(id, projectId, {
      ...(typeof targetSheetId === 'string' && { targetSheetId }),
      ...(Number.isInteger(targetPageNumber) && { targetPageNumber }),
      ...(typeof targetUrl === 'string' && { targetUrl }),
      ...(sourceRect && typeof sourceRect.x === 'number' && { sourceRect }),
      // null clears a saved view; a valid object sets it
      ...(targetViewport !== undefined && {
        targetViewport:
          targetViewport && typeof targetViewport.zoom === 'number' ? targetViewport : null,
      }),
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating hyperlink:', error);
    res.status(500).json({ error: 'Failed to update hyperlink' });
  }
});

// Clear auto-generated (batch) links for a project.
// MUST register before the '/:id' delete or 'batch' would match as an id.
router.delete('/project/:projectId/batch', requireAuth, validateUUIDParam('projectId'), async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!(await requireProjectAccess(req.user!.id, projectId, res))) return;
    const removed = await storage.deleteBatchHyperlinksByProject(projectId);
    res.json({ success: true, removed });
  } catch (error) {
    console.error('Error clearing batch hyperlinks:', error);
    res.status(500).json({ error: 'Failed to clear batch hyperlinks' });
  }
});

// Delete one link
router.delete('/project/:projectId/:id', requireAuth, validateUUIDParam('projectId'), async (req, res) => {
  try {
    const { projectId, id } = req.params;
    if (!(await requireProjectAccess(req.user!.id, projectId, res))) return;
    await storage.deleteHyperlink(id, projectId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting hyperlink:', error);
    res.status(500).json({ error: 'Failed to delete hyperlink' });
  }
});

// Clear all links for a project
router.delete('/project/:projectId', requireAuth, validateUUIDParam('projectId'), async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!(await requireProjectAccess(req.user!.id, projectId, res))) return;
    const removed = await storage.deleteAllHyperlinksByProject(projectId);
    res.json({ success: true, removed });
  } catch (error) {
    console.error('Error clearing hyperlinks:', error);
    res.status(500).json({ error: 'Failed to clear hyperlinks' });
  }
});

export default router;
