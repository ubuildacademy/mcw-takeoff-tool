/**
 * Auth proxy routes - bypass CORS by proxying Supabase auth through our backend.
 * The browser calls our API (same-origin via proxy); the server calls Supabase server-side (no CORS).
 */
import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { requireAuth } from '../middleware';

const router = Router();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

function getAuthClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_* equivalents) for auth proxy'
    );
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: (url: any, init?: any) => {
        // Add a 10-second timeout to prevent hanging when Supabase is paused/unreachable
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        return fetch(url, { ...init, signal: controller.signal }).finally(() =>
          clearTimeout(timeout)
        );
      },
    },
  });
}

/**
 * POST /api/auth/login
 * Proxies sign-in to Supabase. Returns session for frontend to set via setSession.
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const supabaseAuth = getAuthClient();
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });

    if (error) {
      return res.status(401).json({ error: error.message });
    }

    if (!data.session) {
      return res.status(401).json({ error: 'No session returned' });
    }

    res.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in,
        expires_at: data.session.expires_at,
        token_type: data.session.token_type,
        user: data.user,
      },
    });
  } catch (err: unknown) {
    console.error('[Auth] Login proxy error:', err);
    // Detect timeout / abort errors (Supabase project likely paused or unreachable)
    const isTimeout =
      err instanceof Error &&
      (err.name === 'AbortError' || err.message.includes('aborted'));
    if (isTimeout) {
      return res.status(504).json({
        error:
          'Unable to reach the authentication service. The Supabase project may be paused — please check the Supabase dashboard and restore it.',
      });
    }
    const message = err instanceof Error ? err.message : 'Login failed';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/auth/validate-invite/:token
 * Public endpoint - validates an invitation token and returns invitation details.
 * Used by the signup page to show the accept-invite form. No auth required.
 */
router.get('/validate-invite/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const { data, error } = await supabase
      .from('user_invitations')
      .select('id, email, role, status, expires_at')
      .eq('invite_token', token)
      .eq('status', 'pending')
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Invalid or expired invitation' });
    }

    if (new Date(data.expires_at) < new Date()) {
      await supabase
        .from('user_invitations')
        .update({ status: 'expired' })
        .eq('id', data.id);
      return res.status(404).json({ error: 'Invitation has expired' });
    }

    res.json({ email: data.email, role: data.role });
  } catch (err) {
    console.error('[Auth] Validate invite error:', err);
    res.status(500).json({ error: 'Failed to validate invitation' });
  }
});

/**
 * POST /api/auth/accept-invitation
 * Completes invitation acceptance: creates user_metadata and marks invitation as accepted.
 * Requires auth (user must have just signed up via the invite flow).
 */
router.post('/accept-invitation', requireAuth, async (req: Request, res: Response) => {
  try {
    const { token, full_name, company } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invitation token is required' });
    }

    const userId = req.user!.id;
    const userEmail = req.user!.email?.toLowerCase();

    const { data: invitation, error: invError } = await supabase
      .from('user_invitations')
      .select('id, email, role')
      .eq('invite_token', token)
      .eq('status', 'pending')
      .single();

    if (invError || !invitation) {
      return res.status(404).json({ error: 'Invalid or expired invitation' });
    }

    if (invitation.email.toLowerCase() !== userEmail) {
      return res.status(403).json({ error: 'This invitation was sent to a different email address' });
    }

    const { error: metadataError } = await supabase
      .from('user_metadata')
      .insert({
        id: userId,
        role: invitation.role,
        full_name: full_name || null,
        company: company || null,
      });

    if (metadataError) {
      console.error('[Auth] Error creating user metadata:', metadataError);
      return res.status(500).json({ error: 'Failed to complete account setup' });
    }

    await supabase
      .from('user_invitations')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    res.json({ success: true });
  } catch (err) {
    console.error('[Auth] Accept invitation error:', err);
    res.status(500).json({ error: 'Failed to complete invitation' });
  }
});

export default router;
