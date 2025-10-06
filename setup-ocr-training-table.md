# OCR Training Database Setup

## The Problem
You're not seeing OCR training data because the `ocr_training_data` table doesn't exist in your Supabase database yet.

## The Solution
You need to run the SQL migration script to create the table.

## Steps to Fix:

### 1. Go to Supabase Dashboard
- Open your Supabase project: https://supabase.com/dashboard/project/mxjyytwfhmoonkduvybr
- Go to the "SQL Editor" tab

### 2. Run the Migration Script
Copy and paste this SQL script into the SQL Editor and run it:

```sql
-- Create OCR training data table for improving OCR accuracy over time
CREATE TABLE IF NOT EXISTS ocr_training_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    field_type TEXT NOT NULL CHECK (field_type IN ('sheet_number', 'sheet_name')),
    original_text TEXT NOT NULL,
    corrected_text TEXT NOT NULL,
    confidence DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    corrections JSONB DEFAULT '[]'::jsonb,
    user_validated BOOLEAN DEFAULT false,
    has_titleblock BOOLEAN DEFAULT true, -- Whether this sheet has a titleblock
    field_coordinates JSONB, -- JSON object containing x, y, width, height coordinates
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_project_id ON ocr_training_data(project_id);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_document_id ON ocr_training_data(document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_field_type ON ocr_training_data(field_type);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_created_at ON ocr_training_data(created_at);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_user_validated ON ocr_training_data(user_validated);
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_has_titleblock ON ocr_training_data(has_titleblock);

-- Create a composite index for common queries
CREATE INDEX IF NOT EXISTS idx_ocr_training_data_project_field ON ocr_training_data(project_id, field_type);

-- Add RLS (Row Level Security) policies
ALTER TABLE ocr_training_data ENABLE ROW LEVEL SECURITY;

-- Policy to allow all operations (for now)
CREATE POLICY "Allow all operations on ocr_training_data" ON ocr_training_data FOR ALL USING (true);

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
COMMENT ON COLUMN ocr_training_data.has_titleblock IS 'Whether this sheet has a titleblock (helps OCR engine understand context)';
COMMENT ON COLUMN ocr_training_data.field_coordinates IS 'JSON object containing x, y, width, height coordinates of the field';
```

### 3. Test the Connection
After running the SQL script:
1. Go back to your app
2. Open the Admin Panel (click "Admin Panel" button on jobs dashboard)
3. Enter "admin" as the key
4. Click the "Test DB" button in the Quick Actions section
5. You should see "✅ Database connection successful!"

### 4. Re-run OCR Training
Once the table is created:
1. Go to your project workspace
2. Open the titleblock configuration dialog
3. Run "Extract Sheet Names" again
4. The training data should now be saved to the database
5. Check the Admin Panel → OCR Training to see the data

## What This Table Does:
- Stores all OCR training data from your sheet extractions
- Tracks original vs corrected text for pattern learning
- Records confidence scores and user validations
- Enables the AI to learn from your corrections over time

## Troubleshooting:
If you still don't see data after setting up the table:
1. Check the browser console for any error messages
2. Make sure you're running "Extract Sheet Names" (not just OCR)
3. Verify the projectId is being passed correctly
4. Check that the extraction actually found sheet numbers/names

The training data is only saved when you successfully extract sheet numbers and names from your PDFs using the titleblock configuration dialog.
