-- Migration script to add user authentication to existing Meridian Takeoff database
-- Run this script in your Supabase SQL editor

-- Step 1: Add user_id column to existing takeoff_projects table
ALTER TABLE takeoff_projects 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 2: Create user metadata table for role management
CREATE TABLE IF NOT EXISTS user_metadata (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  full_name TEXT,
  company TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 3: Create user invitations table
CREATE TABLE IF NOT EXISTS user_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  invite_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  accepted_at TIMESTAMP WITH TIME ZONE
);

-- Step 4: Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_takeoff_projects_user_id ON takeoff_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_user_metadata_role ON user_metadata(role);
CREATE INDEX IF NOT EXISTS idx_user_invitations_email ON user_invitations(email);
CREATE INDEX IF NOT EXISTS idx_user_invitations_token ON user_invitations(invite_token);
CREATE INDEX IF NOT EXISTS idx_user_invitations_status ON user_invitations(status);

-- Step 5: Enable RLS on new tables
ALTER TABLE user_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;

-- Step 6: Create helper function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_metadata 
    WHERE id = user_id AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 7: Update existing RLS policies for takeoff_projects
-- First, drop existing policies
DROP POLICY IF EXISTS "Allow all operations on takeoff_projects" ON takeoff_projects;
DROP POLICY IF EXISTS "Allow all operations on takeoff_conditions" ON takeoff_conditions;
DROP POLICY IF EXISTS "Allow all operations on takeoff_files" ON takeoff_files;
DROP POLICY IF EXISTS "Allow all operations on takeoff_sheets" ON takeoff_sheets;
DROP POLICY IF EXISTS "Allow all operations on takeoff_measurements" ON takeoff_measurements;
DROP POLICY IF EXISTS "Allow all operations on ocr_results" ON ocr_results;
DROP POLICY IF EXISTS "Allow all operations on ocr_jobs" ON ocr_jobs;

-- Step 8: Create new RLS policies for projects
CREATE POLICY "Admin can access all projects" ON takeoff_projects 
  FOR ALL USING (is_admin(auth.uid()));

CREATE POLICY "Users can access their own projects" ON takeoff_projects 
  FOR ALL USING (auth.uid() = user_id);

-- Step 9: Create new RLS policies for conditions (inherit from projects)
CREATE POLICY "Admin can access all conditions" ON takeoff_conditions 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND is_admin(auth.uid())
    )
  );

CREATE POLICY "Users can access conditions for their projects" ON takeoff_conditions 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND user_id = auth.uid()
    )
  );

-- Step 10: Create new RLS policies for files (inherit from projects)
CREATE POLICY "Admin can access all files" ON takeoff_files 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND is_admin(auth.uid())
    )
  );

CREATE POLICY "Users can access files for their projects" ON takeoff_files 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND user_id = auth.uid()
    )
  );

-- Step 11: Create new RLS policies for sheets (inherit from projects via document_id)
CREATE POLICY "Admin can access all sheets" ON takeoff_sheets 
  FOR ALL USING (is_admin(auth.uid()));

CREATE POLICY "Users can access sheets for their projects" ON takeoff_sheets 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects tp
      JOIN takeoff_files tf ON tp.id = tf.project_id
      WHERE tf.filename = document_id AND tp.user_id = auth.uid()
    )
  );

-- Step 12: Create new RLS policies for measurements (inherit from projects)
CREATE POLICY "Admin can access all measurements" ON takeoff_measurements 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND is_admin(auth.uid())
    )
  );

CREATE POLICY "Users can access measurements for their projects" ON takeoff_measurements 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND user_id = auth.uid()
    )
  );

-- Step 13: Create new RLS policies for OCR results (inherit from projects)
CREATE POLICY "Admin can access all ocr results" ON ocr_results 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND is_admin(auth.uid())
    )
  );

CREATE POLICY "Users can access ocr results for their projects" ON ocr_results 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND user_id = auth.uid()
    )
  );

-- Step 14: Create new RLS policies for OCR jobs (inherit from projects)
CREATE POLICY "Admin can access all ocr jobs" ON ocr_jobs 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND is_admin(auth.uid())
    )
  );

CREATE POLICY "Users can access ocr jobs for their projects" ON ocr_jobs 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects 
      WHERE id = project_id AND user_id = auth.uid()
    )
  );

-- Step 15: Create RLS policies for user metadata
CREATE POLICY "Users can view their own metadata" ON user_metadata 
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own metadata" ON user_metadata 
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admin can view all user metadata" ON user_metadata 
  FOR SELECT USING (is_admin(auth.uid()));

CREATE POLICY "Admin can update all user metadata" ON user_metadata 
  FOR UPDATE USING (is_admin(auth.uid()));

-- Step 16: Create RLS policies for user invitations
CREATE POLICY "Admin can manage all invitations" ON user_invitations 
  FOR ALL USING (is_admin(auth.uid()));

CREATE POLICY "Users can view their own invitations" ON user_invitations 
  FOR SELECT USING (email = auth.jwt() ->> 'email');

-- Step 17: Create the initial admin user (you'll need to replace the UUID with the actual admin user ID)
-- This will be done by the setup-admin.js script, but we can prepare the structure here

-- Note: After running this migration, you'll need to:
-- 1. Run the setup-admin.js script to create the admin user
-- 2. Assign existing projects to the admin user
-- 3. Test the authentication flow
