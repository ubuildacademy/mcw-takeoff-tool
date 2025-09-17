-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
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
CREATE TABLE IF NOT EXISTS conditions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  size BIGINT NOT NULL,
  mimetype TEXT NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Takeoff measurements table
CREATE TABLE IF NOT EXISTS takeoff_measurements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_id TEXT NOT NULL,
  condition_id UUID NOT NULL REFERENCES conditions(id) ON DELETE CASCADE,
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_conditions_project_id ON conditions(project_id);
CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_measurements_project_id ON takeoff_measurements(project_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_measurements_sheet_id ON takeoff_measurements(sheet_id);
CREATE INDEX IF NOT EXISTS idx_takeoff_measurements_condition_id ON takeoff_measurements(condition_id);

-- Row Level Security (RLS) policies
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff_measurements ENABLE ROW LEVEL SECURITY;

-- For now, allow all operations (you can restrict this later based on user authentication)
CREATE POLICY "Allow all operations on projects" ON projects FOR ALL USING (true);
CREATE POLICY "Allow all operations on conditions" ON conditions FOR ALL USING (true);
CREATE POLICY "Allow all operations on files" ON files FOR ALL USING (true);
CREATE POLICY "Allow all operations on takeoff_measurements" ON takeoff_measurements FOR ALL USING (true);

-- No sample data - start with empty tables
