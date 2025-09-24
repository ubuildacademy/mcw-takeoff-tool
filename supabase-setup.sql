-- Meridian Takeoff Database Setup
-- Run this in your Supabase SQL Editor

-- Create takeoff_projects table
CREATE TABLE IF NOT EXISTS takeoff_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT,
  location TEXT,
  status TEXT,
  description TEXT,
  project_type TEXT,
  start_date TEXT,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_modified TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create takeoff_files table
CREATE TABLE IF NOT EXISTS takeoff_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mimetype TEXT NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create takeoff_conditions table
CREATE TABLE IF NOT EXISTS takeoff_conditions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  unit TEXT NOT NULL,
  waste_factor DECIMAL DEFAULT 0,
  color TEXT NOT NULL,
  description TEXT,
  labor_cost DECIMAL,
  material_cost DECIMAL,
  include_perimeter BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create takeoff_sheets table
CREATE TABLE IF NOT EXISTS takeoff_sheets (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  sheet_number TEXT,
  sheet_name TEXT,
  extracted_text TEXT,
  thumbnail TEXT,
  has_takeoffs BOOLEAN DEFAULT false,
  takeoff_count INTEGER DEFAULT 0,
  is_visible BOOLEAN DEFAULT true,
  ocr_processed BOOLEAN DEFAULT false,
  titleblock_config JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create takeoff_measurements table
CREATE TABLE IF NOT EXISTS takeoff_measurements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  sheet_id TEXT NOT NULL,
  condition_id TEXT NOT NULL,
  type TEXT NOT NULL,
  points JSONB NOT NULL,
  calculated_value DECIMAL NOT NULL,
  unit TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  pdf_page INTEGER NOT NULL,
  pdf_coordinates JSONB NOT NULL,
  condition_color TEXT NOT NULL,
  condition_name TEXT NOT NULL,
  perimeter_value DECIMAL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_takeoff_projects_status ON takeoff_projects(status);
CREATE INDEX IF NOT EXISTS idx_takeoff_files_project_id ON takeoff_files(project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_conditions_project_id ON takeoff_conditions(project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_sheets_document_id ON takeoff_sheets(document_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_measurements_project_id ON takeoff_measurements(project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_measurements_sheet_id ON takeoff_measurements(sheet_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_measurements_condition_id ON takeoff_measurements(condition_id);

-- Enable Row Level Security (RLS) for all tables
ALTER TABLE takeoff_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_measurements ENABLE ROW LEVEL SECURITY;

-- Create policies to allow all operations (for now - you can restrict later)
CREATE POLICY "Allow all operations on takeoff_projects" ON takeoff_projects FOR ALL USING (true);
CREATE POLICY "Allow all operations on takeoff_files" ON takeoff_files FOR ALL USING (true);
CREATE POLICY "Allow all operations on takeoff_conditions" ON takeoff_conditions FOR ALL USING (true);
CREATE POLICY "Allow all operations on takeoff_sheets" ON takeoff_sheets FOR ALL USING (true);
CREATE POLICY "Allow all operations on takeoff_measurements" ON takeoff_measurements FOR ALL USING (true);
