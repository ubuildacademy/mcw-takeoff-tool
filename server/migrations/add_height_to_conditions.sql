-- Migration: Add height fields to takeoff_conditions table
-- Date: 2025-12-22
-- Description: Adds include_height and height columns for linear conditions with area calculation

-- Add include_height column to takeoff_conditions table
ALTER TABLE takeoff_conditions 
ADD COLUMN include_height BOOLEAN DEFAULT FALSE;

-- Add height column to takeoff_conditions table (in feet, nullable)
ALTER TABLE takeoff_conditions 
ADD COLUMN height NUMERIC(10, 4);

-- Add comments to document the column purposes
COMMENT ON COLUMN takeoff_conditions.include_height IS 'For linear measurements, flag to include height for area calculation';
COMMENT ON COLUMN takeoff_conditions.height IS 'For linear measurements with height, height in feet';

-- Update existing conditions to have include_height = false (explicit default)
UPDATE takeoff_conditions 
SET include_height = FALSE 
WHERE include_height IS NULL;
