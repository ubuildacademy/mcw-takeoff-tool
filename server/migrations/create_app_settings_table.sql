-- Migration: Create app_settings table for storing application-wide settings
-- Description: Stores admin panel settings like AI models, prompts, and other app configuration

-- Create app_settings table
CREATE TABLE IF NOT EXISTS app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on key for faster lookups
CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(key);

-- Add comment
COMMENT ON TABLE app_settings IS 'Application-wide settings stored by admins (AI models, prompts, etc.)';

-- Enable Row Level Security
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Create policy: Only admins can read/write settings
CREATE POLICY "Only admins can manage app settings"
  ON app_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_metadata
      WHERE user_metadata.id = auth.uid()
      AND user_metadata.role = 'admin'
    )
  );

-- Note: In production, the backend uses service_role key which bypasses RLS
-- This policy is for frontend direct access scenarios

