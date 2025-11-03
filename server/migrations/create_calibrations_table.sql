-- Create calibrations table to store scale calibration data per sheet
-- page_number: NULL = document-level (applies to all pages), INTEGER = page-specific
CREATE TABLE IF NOT EXISTS takeoff_calibrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES takeoff_projects(id) ON DELETE CASCADE,
  sheet_id UUID NOT NULL REFERENCES takeoff_files(id) ON DELETE CASCADE,
  page_number INTEGER NULL, -- NULL = document-level, INTEGER = specific page
  scale_factor NUMERIC(20, 10) NOT NULL,
  unit VARCHAR(10) NOT NULL DEFAULT 'ft',
  calibrated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(project_id, sheet_id, page_number)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_calibrations_project_sheet ON takeoff_calibrations(project_id, sheet_id);
CREATE INDEX IF NOT EXISTS idx_calibrations_project_sheet_page ON takeoff_calibrations(project_id, sheet_id, page_number);

-- Add RLS policies (if RLS is enabled)
ALTER TABLE takeoff_calibrations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see calibrations for projects they have access to
CREATE POLICY "Users can view calibrations for their projects"
  ON takeoff_calibrations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects tp
      WHERE tp.id = takeoff_calibrations.project_id
      AND tp.user_id = auth.uid()
    )
  );

-- Policy: Users can insert calibrations for their projects
CREATE POLICY "Users can insert calibrations for their projects"
  ON takeoff_calibrations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM takeoff_projects tp
      WHERE tp.id = takeoff_calibrations.project_id
      AND tp.user_id = auth.uid()
    )
  );

-- Policy: Users can update calibrations for their projects
CREATE POLICY "Users can update calibrations for their projects"
  ON takeoff_calibrations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects tp
      WHERE tp.id = takeoff_calibrations.project_id
      AND tp.user_id = auth.uid()
    )
  );

-- Policy: Users can delete calibrations for their projects
CREATE POLICY "Users can delete calibrations for their projects"
  ON takeoff_calibrations
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM takeoff_projects tp
      WHERE tp.id = takeoff_calibrations.project_id
      AND tp.user_id = auth.uid()
    )
  );

