-- Create OCR training data table for improving OCR accuracy over time
CREATE TABLE IF NOT EXISTS ocr_training_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES takeoff_files(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    field_type TEXT NOT NULL CHECK (field_type IN ('sheet_number', 'sheet_name')),
    original_text TEXT NOT NULL,
    corrected_text TEXT NOT NULL,
    confidence DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    corrections JSONB DEFAULT '[]'::jsonb,
    user_validated BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_project_id ON ocr_training_data(project_id);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_document_id ON ocr_training_data(document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_field_type ON ocr_training_data(field_type);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_created_at ON ocr_training_data(created_at);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_user_validated ON ocr_training_data(user_validated);

-- Create a composite index for common queries
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_project_field ON ocr_training_data(project_id, field_type);

-- Add RLS (Row Level Security) policies
ALTER TABLE ocr_training_data ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to access training data for their projects
CREATE POLICY "Users can access training data for their projects" ON ocr_training_data
    FOR ALL USING (
        project_id IN (
            SELECT id FROM projects 
            WHERE user_id = auth.uid()
        )
    );

-- Policy to allow users to insert training data for their projects
CREATE POLICY "Users can insert training data for their projects" ON ocr_training_data
    FOR INSERT WITH CHECK (
        project_id IN (
            SELECT id FROM projects 
            WHERE user_id = auth.uid()
        )
    );

-- Policy to allow users to update training data for their projects
CREATE POLICY "Users can update training data for their projects" ON ocr_training_data
    FOR UPDATE USING (
        project_id IN (
            SELECT id FROM projects 
            WHERE user_id = auth.uid()
        )
    );

-- Policy to allow users to delete training data for their projects
CREATE POLICY "Users can delete training data for their projects" ON ocr_training_data
    FOR DELETE USING (
        project_id IN (
            SELECT id FROM projects 
            WHERE user_id = auth.uid()
        )
    );

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

-- Add comments for documentation
COMMENT ON TABLE ocr_training_data IS 'Stores OCR training data to improve accuracy over time';
COMMENT ON COLUMN ocr_training_data.field_type IS 'Type of field: sheet_number or sheet_name';
COMMENT ON COLUMN ocr_training_data.original_text IS 'Original text extracted by OCR';
COMMENT ON COLUMN ocr_training_data.corrected_text IS 'User-corrected or system-corrected text';
COMMENT ON COLUMN ocr_training_data.confidence IS 'OCR confidence score (0-100)';
COMMENT ON COLUMN ocr_training_data.corrections IS 'JSON array of corrections applied';
COMMENT ON COLUMN ocr_training_data.user_validated IS 'Whether the correction was validated by a user';
