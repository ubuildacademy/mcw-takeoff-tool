-- Add rotation to calibrations table
-- This stores the rotation that was used during calibration
-- Critical for accurate measurements when page rotation changes

ALTER TABLE takeoff_calibrations
ADD COLUMN IF NOT EXISTS rotation INTEGER DEFAULT 0;

-- Add comment explaining the purpose
COMMENT ON COLUMN takeoff_calibrations.rotation IS 'PDF page rotation (in degrees: 0, 90, 180, 270) used during calibration';

