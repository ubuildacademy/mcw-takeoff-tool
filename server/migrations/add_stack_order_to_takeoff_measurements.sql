-- Lower stack_order = drawn first (behind); higher = on top (SVG paint order).
ALTER TABLE takeoff_measurements
ADD COLUMN IF NOT EXISTS stack_order INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN takeoff_measurements.stack_order IS 'Z-order on the PDF page overlay; lower values render behind higher values.';
