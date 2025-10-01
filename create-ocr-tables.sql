-- Create OCR tables for Meridian Takeoff
-- Run this SQL in the Supabase SQL Editor to create the missing OCR tables

-- OCR results table
CREATE TABLE IF NOT EXISTS ocr_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL REFERENCES takeoff_projects(id) ON DELETE CASCADE,
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
  project_id TEXT NOT NULL REFERENCES takeoff_projects(id) ON DELETE CASCADE,
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

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ocr_results_project_document ON ocr_results(project_id, document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_results_document_page ON ocr_results(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_project_document ON ocr_jobs(project_id, document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_status ON ocr_jobs(status);

-- Row Level Security (RLS) policies
ALTER TABLE ocr_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_jobs ENABLE ROW LEVEL SECURITY;

-- For now, allow all operations (you can restrict this later based on user authentication)
-- Note: CREATE POLICY doesn't support IF NOT EXISTS, so we'll create them directly
CREATE POLICY "Allow all operations on ocr_results" ON ocr_results FOR ALL USING (true);
CREATE POLICY "Allow all operations on ocr_jobs" ON ocr_jobs FOR ALL USING (true);

