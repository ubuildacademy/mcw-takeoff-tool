import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://mxjyytwfhmoonkduvybr.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Database table names
export const TABLES = {
  PROJECTS: 'takeoff_projects',
  FILES: 'takeoff_files',
  CONDITIONS: 'takeoff_conditions',
  SHEETS: 'takeoff_sheets',
  TAKEOFF_MEASUREMENTS: 'takeoff_measurements'
} as const;
