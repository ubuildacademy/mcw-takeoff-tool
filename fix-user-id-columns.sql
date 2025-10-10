-- Add user_id columns to all tables that need them
-- Run this in your Supabase SQL editor

-- Add user_id to takeoff_files
ALTER TABLE takeoff_files 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to takeoff_conditions  
ALTER TABLE takeoff_conditions 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to takeoff_measurements
ALTER TABLE takeoff_measurements 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to takeoff_sheets
ALTER TABLE takeoff_sheets 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to ocr_results
ALTER TABLE ocr_results 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to ocr_jobs
ALTER TABLE ocr_jobs 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_takeoff_files_user_id ON takeoff_files(user_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_conditions_user_id ON takeoff_conditions(user_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_measurements_user_id ON takeoff_measurements(user_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_sheets_user_id ON takeoff_sheets(user_id);
CREATE INDEX IF NOT EXISTS idx_ocr_results_user_id ON ocr_results(user_id);
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_user_id ON ocr_jobs(user_id);

-- Now assign all existing data to the admin user
UPDATE takeoff_files 
SET user_id = '2de254e9-a22e-423b-afd9-b9b2cfee9f71' 
WHERE user_id IS NULL;

UPDATE takeoff_conditions 
SET user_id = '2de254e9-a22e-423b-afd9-b9b2cfee9f71' 
WHERE user_id IS NULL;

UPDATE takeoff_measurements 
SET user_id = '2de254e9-a22e-423b-afd9-b9b2cfee9f71' 
WHERE user_id IS NULL;

UPDATE takeoff_sheets 
SET user_id = '2de254e9-a22e-423b-afd9-b9b2cfee9f71' 
WHERE user_id IS NULL;

UPDATE ocr_results 
SET user_id = '2de254e9-a22e-423b-afd9-b9b2cfee9f71' 
WHERE user_id IS NULL;

UPDATE ocr_jobs 
SET user_id = '2de254e9-a22e-423b-afd9-b9b2cfee9f71' 
WHERE user_id IS NULL;

-- Drop ALL existing policies first (including the ones that already exist)
-- Projects
DROP POLICY IF EXISTS "Admin can access all projects" ON takeoff_projects;
DROP POLICY IF EXISTS "Users can access their own projects" ON takeoff_projects;
DROP POLICY IF EXISTS "Allow all authenticated users" ON takeoff_projects;
DROP POLICY IF EXISTS "Allow all operations on takeoff_projects" ON takeoff_projects;

-- Files
DROP POLICY IF EXISTS "Admin can access all files" ON takeoff_files;
DROP POLICY IF EXISTS "Users can access files for their projects" ON takeoff_files;
DROP POLICY IF EXISTS "Allow all authenticated users" ON takeoff_files;
DROP POLICY IF EXISTS "Allow all operations on takeoff_files" ON takeoff_files;

-- Conditions
DROP POLICY IF EXISTS "Admin can access all conditions" ON takeoff_conditions;
DROP POLICY IF EXISTS "Users can access conditions for their projects" ON takeoff_conditions;
DROP POLICY IF EXISTS "Allow all authenticated users" ON takeoff_conditions;
DROP POLICY IF EXISTS "Allow all operations on takeoff_conditions" ON takeoff_conditions;

-- Measurements
DROP POLICY IF EXISTS "Admin can access all measurements" ON takeoff_measurements;
DROP POLICY IF EXISTS "Users can access measurements for their projects" ON takeoff_measurements;
DROP POLICY IF EXISTS "Allow all authenticated users" ON takeoff_measurements;
DROP POLICY IF EXISTS "Allow all operations on takeoff_measurements" ON takeoff_measurements;

-- Sheets
DROP POLICY IF EXISTS "Admin can access all sheets" ON takeoff_sheets;
DROP POLICY IF EXISTS "Users can access sheets for their projects" ON takeoff_sheets;
DROP POLICY IF EXISTS "Allow all authenticated users" ON takeoff_sheets;
DROP POLICY IF EXISTS "Allow all operations on takeoff_sheets" ON takeoff_sheets;

-- OCR Results
DROP POLICY IF EXISTS "Admin can access all ocr results" ON ocr_results;
DROP POLICY IF EXISTS "Users can access ocr results for their projects" ON ocr_results;
DROP POLICY IF EXISTS "Allow all authenticated users" ON ocr_results;
DROP POLICY IF EXISTS "Allow all operations on ocr_results" ON ocr_results;

-- OCR Jobs
DROP POLICY IF EXISTS "Admin can access all ocr jobs" ON ocr_jobs;
DROP POLICY IF EXISTS "Users can access ocr jobs for their projects" ON ocr_jobs;
DROP POLICY IF EXISTS "Allow all authenticated users" ON ocr_jobs;
DROP POLICY IF EXISTS "Allow all operations on ocr_jobs" ON ocr_jobs;

-- Create proper RLS policies
CREATE POLICY "Admin can access all projects" ON takeoff_projects 
  FOR ALL USING (is_admin(auth.uid()));

CREATE POLICY "Users can access their own projects" ON takeoff_projects 
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Admin can access all files" ON takeoff_files 
  FOR ALL USING (is_admin(auth.uid()));

CREATE POLICY "Users can access files for their projects" ON takeoff_files 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND (user_id = auth.uid() OR is_admin(auth.uid()))
    )
  );

CREATE POLICY "Admin can access all conditions" ON takeoff_conditions 
  FOR ALL USING (is_admin(auth.uid()));

CREATE POLICY "Users can access conditions for their projects" ON takeoff_conditions 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND (user_id = auth.uid() OR is_admin(auth.uid()))
    )
  );

CREATE POLICY "Admin can access all measurements" ON takeoff_measurements 
  FOR ALL USING (is_admin(auth.uid()));

CREATE POLICY "Users can access measurements for their projects" ON takeoff_measurements 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND (user_id = auth.uid() OR is_admin(auth.uid()))
    )
  );

CREATE POLICY "Admin can access all sheets" ON takeoff_sheets 
  FOR ALL USING (is_admin(auth.uid()));

CREATE POLICY "Users can access sheets for their projects" ON takeoff_sheets 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects tp
      JOIN takeoff_files tf ON tp.id = tf.project_id
      WHERE tf.filename = document_id AND (tp.user_id = auth.uid() OR is_admin(auth.uid()))
    )
  );

CREATE POLICY "Admin can access all ocr results" ON ocr_results 
  FOR ALL USING (is_admin(auth.uid()));

CREATE POLICY "Users can access ocr results for their projects" ON ocr_results 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND (user_id = auth.uid() OR is_admin(auth.uid()))
    )
  );

CREATE POLICY "Admin can access all ocr jobs" ON ocr_jobs 
  FOR ALL USING (is_admin(auth.uid()));

CREATE POLICY "Users can access ocr jobs for their projects" ON ocr_jobs 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND (user_id = auth.uid() OR is_admin(auth.uid()))
    )
  );
