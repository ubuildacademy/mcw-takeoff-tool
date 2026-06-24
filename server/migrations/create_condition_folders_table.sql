-- Migration: Create takeoff_condition_folders table
-- Description: Folder grouping for takeoff conditions within a project

CREATE TABLE IF NOT EXISTS takeoff_condition_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES takeoff_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_condition_folders_project_id
  ON takeoff_condition_folders(project_id);

COMMENT ON TABLE takeoff_condition_folders IS 'Folders for grouping takeoff conditions within a project';
COMMENT ON COLUMN takeoff_condition_folders.sort_order IS 'Display order within project (ascending)';
