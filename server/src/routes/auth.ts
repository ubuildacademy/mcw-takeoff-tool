/**
 * Auth proxy routes - bypass CORS by proxying Supabase auth through our backend.
 * The browser calls our API (same-origin via proxy); the server calls Supabase server-side (no CORS).
 */
import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

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

export default router;
