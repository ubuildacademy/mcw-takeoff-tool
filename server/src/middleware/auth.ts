import { Request, Response, NextFunction } from 'express';
import { supabase, TABLES } from '../supabase';
import { devLog, devWarn } from '../lib/devLog';
import { getOrganizationForUser, getOrgRole } from '../services/assemblyLibraryService';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role: 'admin' | 'user';
      };
      /** Set once per request in index.ts, for correlating logs across a request's lifetime. */
      requestId?: string;
    }
  }
}

/**
 * Get authenticated user from request authorization header
 */
export async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    devWarn('[Auth] No Bearer token in request to:', req.method, req.path);
    return null;
  }

  const token = authHeader.substring(7);

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      devWarn('[Auth] getUser failed for', req.method, req.path, ':', error?.message ?? 'No user');
      return null;
    }

    devLog('[Auth] ✓ Authenticated user:', user.id, 'for', req.method, req.path);

    return user;
  } catch (err) {
    devWarn('[Auth] Error verifying token for', req.method, req.path, ':', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Check if a user has admin role (cached briefly to reduce DB lookups).
 */
const ADMIN_CACHE_TTL_MS = 60_000;
const adminRoleCache = new Map<string, { isAdmin: boolean; expiresAt: number }>();

export async function isAdmin(userId: string): Promise<boolean> {
  const cached = adminRoleCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.isAdmin;
  }

  try {
    const { data, error } = await supabase
      .from('user_metadata')
      .select('role')
      .eq('id', userId)
      .single();
    
    if (error || !data) {
      adminRoleCache.set(userId, { isAdmin: false, expiresAt: Date.now() + ADMIN_CACHE_TTL_MS });
      return false;
    }
    
    const result = data.role === 'admin';
    adminRoleCache.set(userId, { isAdmin: result, expiresAt: Date.now() + ADMIN_CACHE_TTL_MS });
    return result;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

/**
 * Whether `userId` may access data belonging to `projectId`.
 *
 * Today this means **ownership**: `takeoff_projects.user_id` must match `userId`
 * (admins bypass via `userIsAdmin`).
 *
 * **Shared projects** in this app are copied on import into a new project owned by the
 * importer — there is no multi-user membership row here yet. If you add collaborators,
 * extend this function and keep route checks consistent.
 */
export async function hasProjectAccess(userId: string, projectId: string, userIsAdmin: boolean): Promise<boolean> {
  if (userIsAdmin) {
    return true;
  }
  
  try {
    const { data: project, error } = await supabase
      .from(TABLES.PROJECTS)
      .select('id, user_id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single();
    
    return !error && !!project;
  } catch (error) {
    console.error('Error checking project access:', error);
    return false;
  }
}

/**
 * Middleware that requires authentication
 * Attaches user info to request if authenticated
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  (async () => {
    try {
      const user = await getAuthenticatedUser(req);
      
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized - authentication required' });
      }
      
      // Get user role
      const userIsAdmin = await isAdmin(user.id);
      
      // Attach user to request
      req.user = {
        id: user.id,
        email: user.email,
        role: userIsAdmin ? 'admin' : 'user'
      };
      
      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      return res.status(500).json({ error: 'Authentication error' });
    }
  })();
}

/**
 * Middleware that requires admin role
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  (async () => {
    try {
      if (req.user) {
        if (req.user.role === 'admin') return next();
        return res.status(403).json({ error: 'Forbidden - admin access required' });
      }

      const user = await getAuthenticatedUser(req);
      
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized - authentication required' });
      }
      
      const userIsAdmin = await isAdmin(user.id);
      
      if (!userIsAdmin) {
        return res.status(403).json({ error: 'Forbidden - admin access required' });
      }
      
      // Attach user to request
      req.user = {
        id: user.id,
        email: user.email,
        role: 'admin'
      };
      
      next();
    } catch (error) {
      console.error('Admin middleware error:', error);
      return res.status(500).json({ error: 'Authentication error' });
    }
  })();
}

/**
 * Middleware that requires company-admin authorization (task I9).
 *
 * Passes for a platform admin (`user_metadata.role = 'admin'`, unchanged) OR the
 * `company_admin` of the org the caller belongs to. Every route this guards derives
 * its org from the caller (`getOrganizationForUser`), never from a request param, so
 * "the org being acted on" is always the caller's own org — there is nothing to
 * cross-check.
 *
 * This is about *authorization* only. Org *isolation* (a company admin cannot touch
 * another org's rows) is already enforced by every service function filtering on
 * org_id, and by RLS as defence in depth — see I1.
 */
export function requireCompanyAdmin(req: Request, res: Response, next: NextFunction) {
  (async () => {
    try {
      if (!req.user) {
        const user = await getAuthenticatedUser(req);
        if (!user) {
          return res.status(401).json({ error: 'Unauthorized - authentication required' });
        }
        const userIsAdmin = await isAdmin(user.id);
        req.user = { id: user.id, email: user.email, role: userIsAdmin ? 'admin' : 'user' };
      }

      if (req.user.role === 'admin') return next();

      const org = await getOrganizationForUser(req.user.id);
      if (!org) {
        return res.status(409).json({
          error: 'No organization',
          message: 'This account is not a member of any company yet.',
        });
      }

      const orgRole = await getOrgRole(req.user.id, org.id);
      if (orgRole !== 'company_admin') {
        return res.status(403).json({ error: 'Forbidden - company admin access required' });
      }

      next();
    } catch (error) {
      console.error('Company admin middleware error:', error);
      return res.status(500).json({ error: 'Authorization error' });
    }
  })();
}

/**
 * Middleware that requires access to a specific project
 * Project ID is extracted from req.params.projectId or req.body.projectId
 */
export function requireProjectAccess(req: Request, res: Response, next: NextFunction) {
  (async () => {
    try {
      const user = await getAuthenticatedUser(req);
      
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized - authentication required' });
      }
      
      const userIsAdmin = await isAdmin(user.id);
      const projectId = req.params.projectId || req.params.id || req.body.projectId;
      
      if (!projectId) {
        return res.status(400).json({ error: 'Project ID is required' });
      }
      
      const hasAccess = await hasProjectAccess(user.id, projectId, userIsAdmin);
      
      if (!hasAccess) {
        return res.status(404).json({ error: 'Project not found or access denied' });
      }
      
      // Attach user to request
      req.user = {
        id: user.id,
        email: user.email,
        role: userIsAdmin ? 'admin' : 'user'
      };
      
      next();
    } catch (error) {
      console.error('Project access middleware error:', error);
      return res.status(500).json({ error: 'Authorization error' });
    }
  })();
}

/**
 * Optional auth - attaches user if authenticated, but doesn't require it
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  (async () => {
    try {
      const user = await getAuthenticatedUser(req);
      
      if (user) {
        const userIsAdmin = await isAdmin(user.id);
        req.user = {
          id: user.id,
          email: user.email,
          role: userIsAdmin ? 'admin' : 'user'
        };
      }
      
      next();
    } catch (error) {
      // Don't fail on optional auth errors
      next();
    }
  })();
}
