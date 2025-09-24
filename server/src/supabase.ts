import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ufbsppxapyuplxafmpsn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmYnNwcHhhcHl1cGx4YWZtcHNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEzNDA1ODYsImV4cCI6MjA2NjkxNjU4Nn0.WmW6cfQfKwPtmYn_w0joNEQLs59URsYrVgY5KML-CrE';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Database table names
export const TABLES = {
  PROJECTS: 'takeoff_projects',
  FILES: 'takeoff_files',
  CONDITIONS: 'takeoff_conditions',
  SHEETS: 'takeoff_sheets',
  TAKEOFF_MEASUREMENTS: 'takeoff_measurements'
} as const;
