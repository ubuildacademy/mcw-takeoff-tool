-- Fix takeoff_files table by adding missing created_at column
-- This script adds the created_at column that the backend API expects

-- Add created_at column to takeoff_files table
ALTER TABLE takeoff_files 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update existing rows to have a created_at timestamp
UPDATE takeoff_files 
SET created_at = NOW() 
WHERE created_at IS NULL;

-- Verify the column was added
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'takeoff_files' 
AND column_name = 'created_at';
