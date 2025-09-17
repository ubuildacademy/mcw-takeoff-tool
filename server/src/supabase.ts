import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://mxjyytwfhmoonkduvybr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14anl5dHdmaG1vb25rZHV2eWJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxMzE4NTksImV4cCI6MjA3MzcwNzg1OX0.nG28P04Gdg9hbwasEeYKL2ekoSkWoInoT6RwUwA0BJ8';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Database table names
export const TABLES = {
  PROJECTS: 'projects',
  FILES: 'files',
  CONDITIONS: 'conditions',
  SHEETS: 'sheets',
  TAKEOFF_MEASUREMENTS: 'takeoff_measurements'
} as const;
