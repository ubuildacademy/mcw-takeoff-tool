import express from 'express';
import { supabase, TABLES } from '../supabase';

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

// Get all app settings
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
    
    // Get all settings
    const { data, error } = await supabase
      .from(TABLES.APP_SETTINGS)
      .select('*')
      .order('key', { ascending: true });
    
    if (error) {
      console.error('Error fetching settings:', error);
      return res.status(500).json({ error: 'Failed to fetch settings' });
    }
    
    // Convert array to object
    const settingsObject: Record<string, any> = {};
    (data || []).forEach((setting: any) => {
      try {
        settingsObject[setting.key] = JSON.parse(setting.value);
      } catch {
        settingsObject[setting.key] = setting.value;
      }
    });
    
    return res.json({ settings: settingsObject });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Get a specific setting
router.get('/:key', async (req, res) => {
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
    
    const { key } = req.params;
    
    const { data, error } = await supabase
      .from(TABLES.APP_SETTINGS)
      .select('*')
      .eq('key', key)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Setting not found' });
      }
      console.error('Error fetching setting:', error);
      return res.status(500).json({ error: 'Failed to fetch setting' });
    }
    
    try {
      const parsedValue = JSON.parse(data.value);
      return res.json({ key: data.key, value: parsedValue });
    } catch {
      return res.json({ key: data.key, value: data.value });
    }
  } catch (error) {
    console.error('Error fetching setting:', error);
    return res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

// Create or update a setting
router.put('/:key', async (req, res) => {
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
    
    const { key } = req.params;
    const { value } = req.body;
    
    if (value === undefined) {
      return res.status(400).json({ error: 'Value is required' });
    }
    
    // Stringify the value if it's an object
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    
    const { data, error } = await supabase
      .from(TABLES.APP_SETTINGS)
      .upsert({
        key,
        value: stringValue,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'key'
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error saving setting:', error);
      return res.status(500).json({ error: 'Failed to save setting' });
    }
    
    try {
      const parsedValue = JSON.parse(data.value);
      return res.json({ key: data.key, value: parsedValue, success: true });
    } catch {
      return res.json({ key: data.key, value: data.value, success: true });
    }
  } catch (error) {
    console.error('Error saving setting:', error);
    return res.status(500).json({ error: 'Failed to save setting' });
  }
});

// Update multiple settings at once
router.put('/', async (req, res) => {
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
    
    const { settings } = req.body;
    
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Settings object is required' });
    }
    
    // Convert settings object to array of database records
    const settingsArray = Object.entries(settings).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
      updated_at: new Date().toISOString()
    }));
    
    const { data, error } = await supabase
      .from(TABLES.APP_SETTINGS)
      .upsert(settingsArray, {
        onConflict: 'key'
      })
      .select();
    
    if (error) {
      console.error('Error saving settings:', error);
      return res.status(500).json({ error: 'Failed to save settings' });
    }
    
    // Convert back to object
    const settingsObject: Record<string, any> = {};
    (data || []).forEach((setting: any) => {
      try {
        settingsObject[setting.key] = JSON.parse(setting.value);
      } catch {
        settingsObject[setting.key] = setting.value;
      }
    });
    
    return res.json({ settings: settingsObject, success: true });
  } catch (error) {
    console.error('Error saving settings:', error);
    return res.status(500).json({ error: 'Failed to save settings' });
  }
});

export default router;

