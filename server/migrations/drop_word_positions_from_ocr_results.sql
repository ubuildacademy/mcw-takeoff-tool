-- Word-level bboxes were only used for the removed auto-hyperlink feature.
-- Apply in Supabase SQL editor when convenient; safe to skip if column already absent.
ALTER TABLE ocr_results DROP COLUMN IF EXISTS word_positions;
