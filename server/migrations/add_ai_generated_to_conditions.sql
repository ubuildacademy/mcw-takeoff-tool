-- Migration: Add ai_generated column to takeoff_conditions table
-- Date: 2024-01-XX
-- Description: Adds ai_generated boolean column to track AI-created conditions

-- Add ai_generated column to takeoff_conditions table
ALTER TABLE takeoff_conditions 
ADD COLUMN ai_generated BOOLEAN DEFAULT FALSE;

-- Add comment to document the column purpose
COMMENT ON COLUMN takeoff_conditions.ai_generated IS 'Flag to indicate if this condition was created by AI takeoff agent';

-- Create index for better query performance when filtering AI-generated conditions
CREATE INDEX idx_takeoff_conditions_ai_generated ON takeoff_conditions(ai_generated);

-- Update existing conditions to have ai_generated = false (explicit default)
UPDATE takeoff_conditions 
SET ai_generated = FALSE 
WHERE ai_generated IS NULL;
