-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_takeoff_conditions_project_id ON takeoff_conditions(project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_files_project_id ON takeoff_files(project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_sheets_document_id ON takeoff_sheets(document_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_measurements_project_id ON takeoff_measurements(project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_measurements_sheet_id ON takeoff_measurements(sheet_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_measurements_condition_id ON takeoff_measurements(condition_id);

-- Row Level Security (RLS) policies
ALTER TABLE takeoff_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_measurements ENABLE ROW LEVEL SECURITY;

-- For now, allow all operations (you can restrict this later based on user authentication)
CREATE POLICY "Allow all operations on takeoff_projects" ON takeoff_projects FOR ALL USING (true);
CREATE POLICY "Allow all operations on takeoff_conditions" ON takeoff_conditions FOR ALL USING (true);
CREATE POLICY "Allow all operations on takeoff_files" ON takeoff_files FOR ALL USING (true);
CREATE POLICY "Allow all operations on takeoff_sheets" ON takeoff_sheets FOR ALL USING (true);
CREATE POLICY "Allow all operations on takeoff_measurements" ON takeoff_measurements FOR ALL USING (true);

-- No sample data - start with empty tables
