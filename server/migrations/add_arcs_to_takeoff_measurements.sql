-- Circular-arc segments for takeoff markups (DXF bulge convention).
-- JSON array of { "segmentIndex": number, "bulge": number }; segmentIndex i is
-- the edge points[i] -> points[i+1] (for area/volume polygons the last index is
-- the closing edge). NULL / absent = all straight segments (legacy markups).
ALTER TABLE takeoff_measurements
ADD COLUMN IF NOT EXISTS arcs JSONB;

COMMENT ON COLUMN takeoff_measurements.arcs IS 'Arc segments as [{segmentIndex, bulge}]; bulge = tan(theta/4), DXF convention. NULL = polyline with straight segments only.';
