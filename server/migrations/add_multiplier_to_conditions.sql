-- Migration: Add multiplier to takeoff_conditions table
-- Description: Integer quantity multiplier for conditions (e.g. ×3 = same area in 3 locations)

ALTER TABLE takeoff_conditions
ADD COLUMN IF NOT EXISTS multiplier INTEGER DEFAULT NULL;

COMMENT ON COLUMN takeoff_conditions.multiplier IS 'Integer quantity multiplier applied to all measurements in this condition (null = 1x, no effect)';
