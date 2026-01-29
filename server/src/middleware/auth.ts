import { Request, Response, NextFunction } from 'express';
import { supabase, TABLES } from '../supabase';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role: 'admin' | 'user';
      };
    }
  }
}

/**
 * Get authenticated user from request authorization header
 */
export async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.substring(7);
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return null;
    }
    
    return user;
  } catch (error) {
    console.error('Error verifying auth token:', error);
    return null;
  }
}

/**
 * Check if a user has admin role
 */
export async function isAdmin(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('user_metadata')
      .select('role')
      .eq('id', userId)
      .single();
    
    if (error || !data) {
      return false;
    }
    
    return data.role === 'admin';
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

/**
 * Check if user has access to a specific project
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
