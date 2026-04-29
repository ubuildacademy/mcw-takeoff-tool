-- Persist per-page OCR word boxes for Search-tab highlighting.
ALTER TABLE ocr_results
ADD COLUMN IF NOT EXISTS word_boxes JSONB;
