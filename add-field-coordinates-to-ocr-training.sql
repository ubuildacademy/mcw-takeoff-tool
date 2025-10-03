-- Add field coordinates column to OCR training data table
-- This stores the exact coordinates where the text was extracted from

ALTER TABLE ocr_training_data 
ADD COLUMN IF NOT EXISTS field_coordinates JSONB;

-- Add comment for documentation
COMMENT ON COLUMN ocr_training_data.field_coordinates IS 'JSON object containing x, y, width, height coordinates of the field region (as percentages 0-1)';

-- Create index for field coordinates queries
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_field_coordinates ON ocr_training_data USING GIN (field_coordinates);
