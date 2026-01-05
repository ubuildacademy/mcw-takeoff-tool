-- Migration: Add equipment_cost column to takeoff_conditions table
-- Date: 2025-01-XX
-- Description: Adds equipment_cost column for fixed equipment costs (e.g., crane rental, specialized tools)

-- Add equipment_cost column to takeoff_conditions table (nullable, for one-time equipment costs)
ALTER TABLE takeoff_conditions 
ADD COLUMN equipment_cost NUMERIC(10, 2);

-- Add comment to document the column purpose
COMMENT ON COLUMN takeoff_conditions.equipment_cost IS 'Fixed equipment cost for this condition (e.g., crane rental, specialized tools). This is a one-time cost, not multiplied by quantity.';

-- Set default value of 0 for existing conditions
UPDATE takeoff_conditions 
SET equipment_cost = 0 
WHERE equipment_cost IS NULL;

