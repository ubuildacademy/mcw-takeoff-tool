-- =====================================================
-- MERIDIAN TAKEOFF MIGRATION: SCHEMA SETUP
-- Target Project: mxjyytwfhmoonkduvybr
-- =====================================================
-- Run this in your NEW Supabase project SQL Editor
-- This creates the complete schema for the migration

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- MAIN TABLES
-- =====================================================

-- Projects table
CREATE TABLE IF NOT EXISTS takeoff_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  client TEXT NOT NULL,
  location TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  description TEXT DEFAULT '',
  project_type TEXT DEFAULT 'Commercial',
  start_date DATE,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_modified TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Conditions table
CREATE TABLE IF NOT EXISTS takeoff_conditions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES takeoff_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('area', 'volume', 'linear', 'count')),
  unit TEXT NOT NULL,
  waste_factor DECIMAL(5,2) DEFAULT 0,
  color TEXT NOT NULL,
  description TEXT DEFAULT '',
  labor_cost DECIMAL(10,2),
  material_cost DECIMAL(10,2),
  include_perimeter BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Files table
CREATE TABLE IF NOT EXISTS takeoff_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES takeoff_projects(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  size BIGINT NOT NULL,
  mimetype TEXT NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sheets table
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

-- Takeoff measurements table
CREATE TABLE IF NOT EXISTS takeoff_measurements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES takeoff_projects(id) ON DELETE CASCADE,
  sheet_id TEXT NOT NULL,
  condition_id UUID NOT NULL REFERENCES takeoff_conditions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('area', 'volume', 'linear', 'count')),
  points JSONB NOT NULL, -- Canvas coordinates for rendering
  calculated_value DECIMAL(15,4) NOT NULL,
  unit TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  pdf_page INTEGER NOT NULL,
  pdf_coordinates JSONB NOT NULL, -- PDF-relative coordinates (0-1 scale)
  condition_color TEXT NOT NULL,
  condition_name TEXT NOT NULL,
  perimeter_value DECIMAL(15,4),
  cutouts JSONB, -- Array of cut-out objects
  net_calculated_value DECIMAL(15,4), -- calculated_value - sum of all cutouts
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- OCR TABLES
-- =====================================================

-- OCR results table
CREATE TABLE IF NOT EXISTS ocr_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES takeoff_projects(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  text_content TEXT NOT NULL,
  confidence_score DECIMAL(5,2),
  processing_method TEXT NOT NULL CHECK (processing_method IN ('direct_extraction', 'trocr', 'tesseract')),
  processing_time_ms INTEGER,
  word_positions JSONB, -- Array of {text, bbox, confidence} objects
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(project_id, document_id, page_number)
);

-- OCR jobs table for tracking processing status
CREATE TABLE IF NOT EXISTS ocr_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES takeoff_projects(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress INTEGER DEFAULT 0,
  total_pages INTEGER DEFAULT 0,
  processed_pages INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- OCR training data table
CREATE TABLE IF NOT EXISTS ocr_training_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES takeoff_projects(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES takeoff_files(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    field_type TEXT NOT NULL CHECK (field_type IN ('sheet_number', 'sheet_name')),
    original_text TEXT NOT NULL,
    corrected_text TEXT NOT NULL,
    confidence DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    corrections JSONB DEFAULT '[]'::jsonb,
    user_validated BOOLEAN DEFAULT false,
    field_coordinates JSONB, -- JSON object containing x, y, width, height coordinates
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_takeoff_conditions_project_id ON takeoff_conditions(project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_files_project_id ON takeoff_files(project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_sheets_document_id ON takeoff_sheets(document_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_measurements_project_id ON takeoff_measurements(project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_measurements_sheet_id ON takeoff_measurements(sheet_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_measurements_condition_id ON takeoff_measurements(condition_id);
CREATE INDEX IF NOT EXISTS idx_ocr_results_project_document ON ocr_results(project_id, document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_results_document_page ON ocr_results(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_project_document ON ocr_jobs(project_id, document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_status ON ocr_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_project_id ON ocr_training_data(project_id);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_document_id ON ocr_training_data(document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_field_type ON ocr_training_data(field_type);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_created_at ON ocr_training_data(created_at);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_user_validated ON ocr_training_data(user_validated);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_project_field ON ocr_training_data(project_id, field_type);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_field_coordinates ON ocr_training_data USING GIN (field_coordinates);

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

ALTER TABLE takeoff_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_training_data ENABLE ROW LEVEL SECURITY;

-- For now, allow all operations (you can restrict this later based on user authentication)
CREATE POLICY "Allow all operations on takeoff_projects" ON takeoff_projects FOR ALL USING (true);
CREATE POLICY "Allow all operations on takeoff_conditions" ON takeoff_conditions FOR ALL USING (true);
CREATE POLICY "Allow all operations on takeoff_files" ON takeoff_files FOR ALL USING (true);
CREATE POLICY "Allow all operations on takeoff_sheets" ON takeoff_sheets FOR ALL USING (true);
CREATE POLICY "Allow all operations on takeoff_measurements" ON takeoff_measurements FOR ALL USING (true);
CREATE POLICY "Allow all operations on ocr_results" ON ocr_results FOR ALL USING (true);
CREATE POLICY "Allow all operations on ocr_jobs" ON ocr_jobs FOR ALL USING (true);
CREATE POLICY "Allow all operations on ocr_training_data" ON ocr_training_data FOR ALL USING (true);

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_ocr_training_data_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_ocr_training_data_updated_at
    BEFORE UPDATE ON ocr_training_data
    FOR EACH ROW
    EXECUTE FUNCTION update_ocr_training_data_updated_at();

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE ocr_training_data IS 'Stores OCR training data to improve accuracy over time';
COMMENT ON COLUMN ocr_training_data.field_type IS 'Type of field: sheet_number or sheet_name';
COMMENT ON COLUMN ocr_training_data.original_text IS 'Original text extracted by OCR';
COMMENT ON COLUMN ocr_training_data.corrected_text IS 'User-corrected or system-corrected text';
COMMENT ON COLUMN ocr_training_data.confidence IS 'OCR confidence score (0-100)';
COMMENT ON COLUMN ocr_training_data.corrections IS 'JSON array of corrections applied';
COMMENT ON COLUMN ocr_training_data.user_validated IS 'Whether the correction was validated by a user';
COMMENT ON COLUMN ocr_training_data.field_coordinates IS 'JSON object containing x, y, width, height coordinates of the field region (as percentages 0-1)';

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- Schema is now ready for data migration
-- Next step: Run the data export/import scripts


