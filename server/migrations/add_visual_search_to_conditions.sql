-- Migration: Add visual search fields to takeoff_conditions table
-- Date: 2025-01-XX
-- Description: Adds search_image, search_image_id, and search_threshold columns for visual-search conditions
-- This migration is idempotent - it checks if columns exist before adding them

DO $$
BEGIN
    -- Add search_image column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'takeoff_conditions' AND column_name = 'search_image'
    ) THEN
        ALTER TABLE takeoff_conditions ADD COLUMN search_image TEXT;
        COMMENT ON COLUMN takeoff_conditions.search_image IS 'Base64 encoded image or image URL used as search template for visual-search conditions';
    END IF;

    -- Add search_image_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'takeoff_conditions' AND column_name = 'search_image_id'
    ) THEN
        ALTER TABLE takeoff_conditions ADD COLUMN search_image_id TEXT;
        COMMENT ON COLUMN takeoff_conditions.search_image_id IS 'Reference to uploaded image file used as search template';
    END IF;

    -- Add search_threshold column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'takeoff_conditions' AND column_name = 'search_threshold'
    ) THEN
        ALTER TABLE takeoff_conditions ADD COLUMN search_threshold NUMERIC(3, 2);
        COMMENT ON COLUMN takeoff_conditions.search_threshold IS 'Confidence threshold for visual search matches (0.1 = very loose, 1.0 = very strict). Default 0.7';
    END IF;
END $$;

-- Set default threshold for existing visual-search conditions (if any)
-- This is safe to run multiple times
UPDATE takeoff_conditions 
SET search_threshold = 0.7 
WHERE type = 'visual-search' AND search_threshold IS NULL;
