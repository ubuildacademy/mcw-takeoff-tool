-- Migration: Add line_thickness to takeoff_conditions table
-- Description: Stroke width in px for linear condition measurements (1-8, default 2)

ALTER TABLE takeoff_conditions
ADD COLUMN IF NOT EXISTS line_thickness INTEGER DEFAULT 2;

COMMENT ON COLUMN takeoff_conditions.line_thickness IS 'For linear measurements, stroke width in px (1-8, default 2)';

-- Set default for existing conditions
UPDATE takeoff_conditions
SET line_thickness = 2
WHERE line_thickness IS NULL;
