-- Migration: Create sheet_label_patterns table for storing custom sheet identification patterns
-- Description: Allows admins to add custom patterns for sheet names and numbers used by different architects/engineers

-- Create sheet_label_patterns table
CREATE TABLE IF NOT EXISTS sheet_label_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('sheet_name', 'sheet_number')),
  pattern_label TEXT NOT NULL, -- e.g., "drawing data", "sheet title", "dwg no"
  pattern_regex TEXT NOT NULL, -- Regex pattern to match the label
  priority INTEGER DEFAULT 0, -- Higher priority patterns are tried first
  description TEXT, -- Optional description of where this pattern is used
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES user_metadata(id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sheet_label_patterns_type ON sheet_label_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_sheet_label_patterns_active ON sheet_label_patterns(is_active);
CREATE INDEX IF NOT EXISTS idx_sheet_label_patterns_priority ON sheet_label_patterns(pattern_type, priority DESC);

-- Add comment
COMMENT ON TABLE sheet_label_patterns IS 'Custom patterns for identifying sheet names and numbers in titleblocks';

-- Enable Row Level Security
ALTER TABLE sheet_label_patterns ENABLE ROW LEVEL SECURITY;

-- Create policy: Only admins can read/write patterns
CREATE POLICY "Only admins can manage sheet label patterns"
  ON sheet_label_patterns
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_metadata
      WHERE user_metadata.id = auth.uid()
      AND user_metadata.role = 'admin'
    )
  );

-- Insert default patterns for sheet names
INSERT INTO sheet_label_patterns (pattern_type, pattern_label, pattern_regex, priority, description) VALUES
  ('sheet_name', 'drawing data', 'drawing\s*data\s*:?\s*(.+?)(?:\n|$)', 100, 'Common in Hilton format'),
  ('sheet_name', 'drawing title', 'drawing\s*title\s*:?\s*(.+?)(?:\n|$)', 90, 'Very common format'),
  ('sheet_name', 'drawing name', 'drawing\s*name\s*:?\s*(.+?)(?:\n|$)', 85, 'Common format'),
  ('sheet_name', 'sheet title', 'sheet\s*title\s*:?\s*(.+?)(?:\n|$)', 80, 'Common format'),
  ('sheet_name', 'sheet name', 'sheet\s*name\s*:?\s*(.+?)(?:\n|$)', 75, 'Common format')
ON CONFLICT DO NOTHING;

-- Insert default patterns for sheet numbers
INSERT INTO sheet_label_patterns (pattern_type, pattern_label, pattern_regex, priority, description) VALUES
  ('sheet_number', 'sheet number', 'sheet\s*number\s*:?\s*([A-Z0-9.]+)', 100, 'Most common format'),
  ('sheet_number', 'sheet #', 'sheet\s*#\s*:?\s*([A-Z0-9.]+)', 95, 'Common abbreviation'),
  ('sheet_number', 'dwg no', 'dwg\s*no\s*:?\s*([A-Z0-9.]+)', 90, 'Drawing number format'),
  ('sheet_number', 'drawing number', 'drawing\s*number\s*:?\s*([A-Z0-9.]+)', 85, 'Full form'),
  ('sheet_number', 'sheet', 'sheet\s*:?\s*([A-Z0-9.]+)', 80, 'Short form')
ON CONFLICT DO NOTHING;
