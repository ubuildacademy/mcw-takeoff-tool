/**
 * Organizations API — system-admin-only company list, for the "Companies" panel that
 * grants or revokes the assemblies feature per company (upsell switch, Jeff 2026-08-10).
 *
 * Platform admin only, deliberately: a company admin manages their own org's members
 * and library, never the roster of companies or what features they're paying for.
 */
import express from 'express';
import { requireAuth, requireAdmin, validateUUIDParam } from '../middleware';
import { listOrganizations, setAssembliesEnabled } from '../services/assemblyLibraryService';

const router = express.Router();

router.get('/', requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json({ organizations: await listOrganizations() });
  } catch (error) {
    console.error('Error listing organizations:', error);
    res.status(500).json({ error: 'Failed to list organizations' });
  }
});

router.patch('/:id/assemblies-enabled', requireAuth, requireAdmin, validateUUIDParam('id'), async (req, res) => {
  try {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    await setAssembliesEnabled(req.params.id, enabled);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating assemblies-enabled flag:', error);
    res.status(500).json({ error: 'Failed to update the assemblies flag' });
  }
});

export default router;
