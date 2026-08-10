/**
 * Organizations API — system-admin-only company list, for the "Companies" panel that
 * grants or revokes the assemblies feature per company (upsell switch, Jeff 2026-08-10).
 *
 * Platform admin only, deliberately: a company admin manages their own org's members
 * and library, never the roster of companies or what features they're paying for.
 */
import express from 'express';
import { requireAuth, requireAdmin, validateUUIDParam } from '../middleware';
import { createOrganization, listOrganizations, setAssembliesEnabled } from '../services/assemblyLibraryService';

const router = express.Router();

router.get('/', requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json({ organizations: await listOrganizations() });
  } catch (error) {
    console.error('Error listing organizations:', error);
    res.status(500).json({ error: 'Failed to list organizations' });
  }
});

/**
 * Create a company. There was previously no way to do this outside a one-off SQL
 * insert (how MCW's own org was seeded) — a system admin needs this before they can
 * invite anyone into a company that isn't MCW (Jeff, 2026-08-10).
 */
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      return res.status(400).json({ error: 'A company name is required' });
    }
    if (name.length > 200) {
      return res.status(400).json({ error: 'That name is too long (200 characters max)' });
    }
    const organization = await createOrganization(name);
    res.json({ organization });
  } catch (error) {
    console.error('Error creating organization:', error);
    res.status(500).json({ error: 'Failed to create company' });
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
