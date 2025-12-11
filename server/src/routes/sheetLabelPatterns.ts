import express from 'express';
import { supabase } from '../supabase';

const router = express.Router();

// Helper function to get authenticated user from request
async function getAuthenticatedUser(req: express.Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return null;
  }
  
  return user;
}

// Helper function to check if user is admin
async function isAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_metadata')
    .select('role')
    .eq('id', userId)
    .single();
  
  if (error || !data) {
    return false;
  }
  
  return data.role === 'admin';
}

// Get all sheet label patterns
router.get('/', async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check if user is admin
    const userIsAdmin = await isAdmin(user.id);
    if (!userIsAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { pattern_type } = req.query;
    
    let query = supabase
      .from('sheet_label_patterns')
      .select('*')
      .order('priority', { ascending: false })
      .order('pattern_label', { ascending: true });
    
    if (pattern_type && (pattern_type === 'sheet_name' || pattern_type === 'sheet_number')) {
      query = query.eq('pattern_type', pattern_type);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching sheet label patterns:', error);
      return res.status(500).json({ error: 'Failed to fetch patterns' });
    }
    
    return res.json({ patterns: data || [] });
  } catch (error) {
    console.error('Error fetching sheet label patterns:', error);
    return res.status(500).json({ error: 'Failed to fetch patterns' });
  }
});

// Get active patterns only (for extraction use)
router.get('/active', async (req, res) => {
  try {
    // This endpoint doesn't require auth - it's used by extraction logic
    const { pattern_type } = req.query;
    
    let query = supabase
      .from('sheet_label_patterns')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false });
    
    if (pattern_type && (pattern_type === 'sheet_name' || pattern_type === 'sheet_number')) {
      query = query.eq('pattern_type', pattern_type);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching active patterns:', error);
      return res.status(500).json({ error: 'Failed to fetch patterns' });
    }
    
    return res.json({ patterns: data || [] });
  } catch (error) {
    console.error('Error fetching active patterns:', error);
    return res.status(500).json({ error: 'Failed to fetch patterns' });
  }
});

// Create a new pattern
router.post('/', async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check if user is admin
    const userIsAdmin = await isAdmin(user.id);
    if (!userIsAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { pattern_type, pattern_label, pattern_regex, priority, description, is_active } = req.body;
    
    if (!pattern_type || !pattern_label || !pattern_regex) {
      return res.status(400).json({ error: 'pattern_type, pattern_label, and pattern_regex are required' });
    }
    
    if (pattern_type !== 'sheet_name' && pattern_type !== 'sheet_number') {
      return res.status(400).json({ error: 'pattern_type must be "sheet_name" or "sheet_number"' });
    }
    
    // Validate regex
    try {
      new RegExp(pattern_regex);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid regex pattern' });
    }
    
    const { data, error } = await supabase
      .from('sheet_label_patterns')
      .insert({
        pattern_type,
        pattern_label,
        pattern_regex,
        priority: priority ?? 0,
        description: description || null,
        is_active: is_active !== undefined ? is_active : true,
        created_by: user.id
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating pattern:', error);
      return res.status(500).json({ error: 'Failed to create pattern' });
    }
    
    return res.json({ pattern: data, success: true });
  } catch (error) {
    console.error('Error creating pattern:', error);
    return res.status(500).json({ error: 'Failed to create pattern' });
  }
});

// Update a pattern
router.put('/:id', async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check if user is admin
    const userIsAdmin = await isAdmin(user.id);
    if (!userIsAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { id } = req.params;
    const { pattern_label, pattern_regex, priority, description, is_active } = req.body;
    
    const updates: any = {
      updated_at: new Date().toISOString()
    };
    
    if (pattern_label !== undefined) updates.pattern_label = pattern_label;
    if (pattern_regex !== undefined) {
      // Validate regex
      try {
        new RegExp(pattern_regex);
        updates.pattern_regex = pattern_regex;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid regex pattern' });
      }
    }
    if (priority !== undefined) updates.priority = priority;
    if (description !== undefined) updates.description = description;
    if (is_active !== undefined) updates.is_active = is_active;
    
    const { data, error } = await supabase
      .from('sheet_label_patterns')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating pattern:', error);
      return res.status(500).json({ error: 'Failed to update pattern' });
    }
    
    if (!data) {
      return res.status(404).json({ error: 'Pattern not found' });
    }
    
    return res.json({ pattern: data, success: true });
  } catch (error) {
    console.error('Error updating pattern:', error);
    return res.status(500).json({ error: 'Failed to update pattern' });
  }
});

// Delete a pattern
router.delete('/:id', async (req, res) => {
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check if user is admin
    const userIsAdmin = await isAdmin(user.id);
    if (!userIsAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { id } = req.params;
    
    const { error } = await supabase
      .from('sheet_label_patterns')
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Error deleting pattern:', error);
      return res.status(500).json({ error: 'Failed to delete pattern' });
    }
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting pattern:', error);
    return res.status(500).json({ error: 'Failed to delete pattern' });
  }
});

export default router;
