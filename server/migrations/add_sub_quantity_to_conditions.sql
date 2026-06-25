-- Add sub-quantity fields to count conditions.
-- Enables a fixed measurement (linear, area, or volume) to be attached to each
-- count marker — e.g. "10 LF of trim per window" → 5 counts × 10 LF = 50 LF total.
ALTER TABLE takeoff_conditions
ADD COLUMN IF NOT EXISTS sub_quantity_type TEXT,        -- 'linear' | 'area' | 'volume'
ADD COLUMN IF NOT EXISTS sub_quantity_unit TEXT,        -- 'LF' | 'SF' | 'CY' etc.
ADD COLUMN IF NOT EXISTS sub_quantity_per_count NUMERIC; -- quantity per count instance
