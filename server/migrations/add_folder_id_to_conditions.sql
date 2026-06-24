-- Migration: Add folder_id to takeoff_conditions table
-- Run AFTER create_condition_folders_table.sql

ALTER TABLE takeoff_conditions
ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES takeoff_condition_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conditions_folder_id
  ON takeoff_conditions(folder_id);

COMMENT ON COLUMN takeoff_conditions.folder_id IS 'Optional folder grouping; NULL = uncategorized';
