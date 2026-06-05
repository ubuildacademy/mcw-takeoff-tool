import express from 'express';
import { supabase, TABLES } from '../supabase';
import { requireAuth, requireAdmin, generousRateLimit } from '../middleware';
import {
  HELP_FAQ_SETTING_KEY,
  buildHelpFaqPayload,
  parseStoredHelpFaq,
  type HelpFaqConfig,
} from '../help/helpFaq';

const router = express.Router();

async function loadCustomFaq(): Promise<HelpFaqConfig | null> {
  const { data, error } = await supabase
    .from(TABLES.APP_SETTINGS)
    .select('value')
    .eq('key', HELP_FAQ_SETTING_KEY)
    .maybeSingle();

  if (error || !data?.value) return null;
  return parseStoredHelpFaq(data.value);
}

/** Public read — no auth; clients merge with bundled defaults when customized is false. */
router.get('/faq', generousRateLimit, async (_req, res) => {
  try {
    const faq = await loadCustomFaq();
    if (faq) {
      return res.json({ customized: true, faq });
    }
    return res.json({ customized: false, faq: null });
  } catch (error) {
    console.error('Error loading help FAQ:', error);
    return res.status(500).json({ error: 'Failed to load help FAQ' });
  }
});

router.put('/faq', requireAuth, requireAdmin, async (req, res) => {
  try {
    const payload = buildHelpFaqPayload(req.body, req.user?.email ?? req.user?.id);
    if (!payload) {
      return res.status(400).json({
        error: 'Invalid FAQ payload. Provide dashboard and/or workspace arrays with question and answer fields.',
      });
    }

    const stringValue = JSON.stringify(payload);
    const { error } = await supabase.from(TABLES.APP_SETTINGS).upsert(
      {
        key: HELP_FAQ_SETTING_KEY,
        value: stringValue,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );

    if (error) {
      console.error('Error saving help FAQ:', error);
      return res.status(500).json({ error: 'Failed to save help FAQ' });
    }

    return res.json({ success: true, faq: payload });
  } catch (error) {
    console.error('Error saving help FAQ:', error);
    return res.status(500).json({ error: 'Failed to save help FAQ' });
  }
});

router.delete('/faq', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { error } = await supabase
      .from(TABLES.APP_SETTINGS)
      .delete()
      .eq('key', HELP_FAQ_SETTING_KEY);

    if (error) {
      console.error('Error clearing help FAQ:', error);
      return res.status(500).json({ error: 'Failed to reset help FAQ' });
    }

    return res.json({ success: true, customized: false });
  } catch (error) {
    console.error('Error clearing help FAQ:', error);
    return res.status(500).json({ error: 'Failed to reset help FAQ' });
  }
});

export default router;
