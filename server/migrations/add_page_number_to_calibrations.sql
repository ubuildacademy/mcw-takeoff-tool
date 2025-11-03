-- Add page_number column to existing takeoff_calibrations table
-- This migration is for tables created before the page_number column was added

-- Add the page_number column (NULL = document-level, INTEGER = page-specific)
ALTER TABLE takeoff_calibrations 
ADD COLUMN IF NOT EXISTS page_number INTEGER NULL;

-- Update unique constraint to include page_number
-- First, drop the old constraint if it exists
ALTER TABLE takeoff_calibrations 
DROP CONSTRAINT IF EXISTS takeoff_calibrations_project_id_sheet_id_key;

-- Add new constraint with page_number
ALTER TABLE takeoff_calibrations 
ADD CONSTRAINT takeoff_calibrations_project_id_sheet_id_page_number_key 
UNIQUE(project_id, sheet_id, page_number);

-- Add index for faster lookups with page_number
CREATE INDEX IF NOT EXISTS idx_calibrations_project_sheet_page 
ON takeoff_calibrations(project_id, sheet_id, page_number);

-- Note: Existing calibrations will have page_number = NULL (document-level)
-- This is correct - they'll apply to all pages until page-specific calibrations are created

