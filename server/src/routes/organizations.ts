/**
 * Organizations API.
 *
 * The company-roster routes (list/create/toggle assemblies) are system-admin-only,
 * deliberately: a company admin manages their own org's members and library, never
 * the roster of companies or what features they're paying for.
 *
 * The branding routes below are the opposite shape — every route resolves the
 * CALLER's own org (never a param), same pattern as requireCompanyAdmin elsewhere,
 * because branding is a per-company setting a company admin sets for themselves.
 */
import express from 'express';
import { requireAuth, requireAdmin, requireCompanyAdmin, validateUUIDParam } from '../middleware';
import {
  createOrganization,
  getOrganizationForUser,
  getReportBranding,
  listOrganizations,
  setAssembliesEnabled,
  setReportBranding,
} from '../services/assemblyLibraryService';

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

/**
 * The caller's own company's export branding — every export needs this (P.O., Work
 * Order, Budget report, takeoff export), so any org member may read it, not just a
 * company admin. `requireAuth` only, deliberately not `requireCompanyAdmin`.
 */
router.get('/branding', requireAuth, async (req, res) => {
  try {
    const caller = req.user;
    if (!caller) return res.status(401).json({ error: 'Authentication required' });
    const org = await getOrganizationForUser(caller.id);
    if (!org) {
      // No company yet — every field falls back to stock Meridian branding client-side.
      return res.json({ branding: { companyName: null, accentColor: null, logoBase64: null } });
    }
    res.json({ branding: await getReportBranding(org.id) });
  } catch (error) {
    console.error('Error loading report branding:', error);
    res.status(500).json({ error: 'Failed to load report branding' });
  }
});

/** Editing branding is a company-admin action — it's the whole company's export look. */
router.put('/branding', requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    const caller = req.user;
    if (!caller) return res.status(401).json({ error: 'Authentication required' });
    const org = await getOrganizationForUser(caller.id);
    if (!org) {
      return res.status(409).json({
        error: 'No organization',
        message: 'This account is not a member of any company yet.',
      });
    }

    const body = req.body ?? {};
    const patch: { companyName?: string | null; accentColor?: string | null; logoBase64?: string | null } = {};
    if ('companyName' in body) patch.companyName = body.companyName ? String(body.companyName).trim() : null;
    if ('accentColor' in body) patch.accentColor = body.accentColor ? String(body.accentColor).trim() : null;
    if ('logoBase64' in body) patch.logoBase64 = body.logoBase64 ? String(body.logoBase64) : null;

    const branding = await setReportBranding(org.id, { ...patch, updatedBy: caller.id });
    res.json({ success: true, branding });
  } catch (error) {
    console.error('Error saving report branding:', error);
    res.status(500).json({ error: 'Failed to save report branding' });
  }
});

export default router;
