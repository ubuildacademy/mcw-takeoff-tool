-- Migration: Add area_value column to takeoff_measurements table
-- Date: 2025-12-22
-- Description: Adds area_value column for linear measurements with height (area = linear × height)

-- Add area_value column to takeoff_measurements table (in square feet, nullable)
ALTER TABLE takeoff_measurements 
ADD COLUMN area_value NUMERIC(10, 4);

-- Add comment to document the column purpose
COMMENT ON COLUMN takeoff_measurements.area_value IS 'Area in square feet for linear measurements with height (calculated as linear × height)';
