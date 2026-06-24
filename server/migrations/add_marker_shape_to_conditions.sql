-- Migration: Add marker_shape to takeoff_conditions table
-- Description: Shape of the marker for count conditions (circle, triangle, square, star, checkmark)

ALTER TABLE takeoff_conditions
ADD COLUMN IF NOT EXISTS marker_shape TEXT DEFAULT 'circle';

COMMENT ON COLUMN takeoff_conditions.marker_shape IS 'For count conditions, shape of the marker rendered on the PDF. Default: circle';

-- Set default for existing conditions
UPDATE takeoff_conditions
SET marker_shape = 'circle'
WHERE marker_shape IS NULL;
