-- Add viewport dimensions to calibrations table
-- These dimensions are critical for accurate measurement calculations
-- They represent the PDF viewport dimensions at scale=1 when calibration was performed

ALTER TABLE takeoff_calibrations
ADD COLUMN IF NOT EXISTS viewport_width NUMERIC,
ADD COLUMN IF NOT EXISTS viewport_height NUMERIC;

-- Add comment explaining the purpose
COMMENT ON COLUMN takeoff_calibrations.viewport_width IS 'PDF viewport width at scale=1 when calibration was performed (pixels)';
COMMENT ON COLUMN takeoff_calibrations.viewport_height IS 'PDF viewport height at scale=1 when calibration was performed (pixels)';

