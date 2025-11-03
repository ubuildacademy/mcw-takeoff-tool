import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://mxjyytwfhmoonkduvybr.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  const errorMessage = `
❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable

To fix this:
1. Create a .env file in the server directory
2. Add your Supabase service role key:
   SUPABASE_URL=https://mxjyytwfhmoonkduvybr.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

Get your service role key from:
   https://supabase.com/dashboard/project/mxjyytwfhmoonkduvybr/settings/api

Or copy .env.example to .env and fill in the values:
   cp .env.example .env
`;
  throw new Error(errorMessage.trim());
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Database table names
export const TABLES = {
  PROJECTS: 'takeoff_projects',
  FILES: 'takeoff_files',
  CONDITIONS: 'takeoff_conditions',
  SHEETS: 'takeoff_sheets',
  TAKEOFF_MEASUREMENTS: 'takeoff_measurements',
  APP_SETTINGS: 'app_settings',
  CALIBRATIONS: 'takeoff_calibrations'
} as const;
