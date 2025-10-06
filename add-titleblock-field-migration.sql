-- Migration to add has_titleblock field to ocr_training_data table
-- This field tracks whether a sheet has a titleblock, which helps the OCR engine
-- understand when it should or shouldn't look for titleblock information

-- Add the has_titleblock column with a default value of true for backward compatibility
ALTER TABLE ocr_training_data 
ADD COLUMN IF NOT EXISTS has_titleblock BOOLEAN DEFAULT true;

-- Add a comment to document the new field
COMMENT ON COLUMN ocr_training_data.has_titleblock IS 'Whether this sheet has a titleblock (defaults to true for backward compatibility)';

-- Create an index for better query performance when filtering by titleblock presence
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_has_titleblock ON ocr_training_data(has_titleblock);

-- Update any existing NULL values to true (shouldn't be any, but just in case)
UPDATE ocr_training_data 
SET has_titleblock = true 
WHERE has_titleblock IS NULL;
