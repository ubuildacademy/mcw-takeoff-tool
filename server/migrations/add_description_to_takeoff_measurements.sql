-- Optional notes per measurement; auto-count stores bbox JSON for thumbnails / "Auto-Count Match" label.
ALTER TABLE takeoff_measurements
ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN takeoff_measurements.description IS 'Optional text or JSON metadata for a measurement (e.g. auto-count bounding box for thumbnails).';
