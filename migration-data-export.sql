-- =====================================================
-- MERIDIAN TAKEOFF MIGRATION: DATA EXPORT
-- Source Project: ufbsppxapyuplxafmpsn
-- =====================================================
-- Run this in your OLD Supabase project SQL Editor
-- This exports all data in the correct order for migration

-- =====================================================
-- EXPORT 1: PROJECTS (must be first - other tables reference this)
-- =====================================================

-- Copy this output and save it for import
SELECT 
  'INSERT INTO takeoff_projects (id, name, client, location, status, description, project_type, start_date, contact_person, contact_email, contact_phone, created_at, last_modified) VALUES (' ||
  quote_literal(id::text) || ', ' ||
  quote_literal(name) || ', ' ||
  quote_literal(client) || ', ' ||
  quote_literal(location) || ', ' ||
  quote_literal(status) || ', ' ||
  quote_literal(description) || ', ' ||
  quote_literal(project_type) || ', ' ||
  CASE WHEN start_date IS NULL THEN 'NULL' ELSE quote_literal(start_date::text) END || ', ' ||
  CASE WHEN contact_person IS NULL THEN 'NULL' ELSE quote_literal(contact_person) END || ', ' ||
  CASE WHEN contact_email IS NULL THEN 'NULL' ELSE quote_literal(contact_email) END || ', ' ||
  CASE WHEN contact_phone IS NULL THEN 'NULL' ELSE quote_literal(contact_phone) END || ', ' ||
  quote_literal(created_at::text) || ', ' ||
  quote_literal(last_modified::text) || ');' as insert_statement
FROM takeoff_projects
ORDER BY created_at;

-- =====================================================
-- EXPORT 2: CONDITIONS (references projects)
-- =====================================================

SELECT 
  'INSERT INTO takeoff_conditions (id, project_id, name, type, unit, waste_factor, color, description, labor_cost, material_cost, include_perimeter, created_at) VALUES (' ||
  quote_literal(id::text) || ', ' ||
  quote_literal(project_id::text) || ', ' ||
  quote_literal(name) || ', ' ||
  quote_literal(type) || ', ' ||
  quote_literal(unit) || ', ' ||
  waste_factor || ', ' ||
  quote_literal(color) || ', ' ||
  quote_literal(description) || ', ' ||
  CASE WHEN labor_cost IS NULL THEN 'NULL' ELSE labor_cost::text END || ', ' ||
  CASE WHEN material_cost IS NULL THEN 'NULL' ELSE material_cost::text END || ', ' ||
  include_perimeter || ', ' ||
  quote_literal(created_at::text) || ');' as insert_statement
FROM takeoff_conditions
ORDER BY created_at;

-- =====================================================
-- EXPORT 3: FILES (references projects)
-- =====================================================

SELECT 
  'INSERT INTO takeoff_files (id, project_id, original_name, filename, path, size, mimetype, uploaded_at) VALUES (' ||
  quote_literal(id::text) || ', ' ||
  quote_literal(project_id::text) || ', ' ||
  quote_literal(original_name) || ', ' ||
  quote_literal(filename) || ', ' ||
  quote_literal(path) || ', ' ||
  size || ', ' ||
  quote_literal(mimetype) || ', ' ||
  quote_literal(uploaded_at::text) || ');' as insert_statement
FROM takeoff_files
ORDER BY uploaded_at;

-- =====================================================
-- EXPORT 4: SHEETS (independent table)
-- =====================================================

SELECT 
  'INSERT INTO takeoff_sheets (id, document_id, page_number, sheet_number, sheet_name, extracted_text, thumbnail, has_takeoffs, takeoff_count, is_visible, ocr_processed, titleblock_config, created_at, updated_at) VALUES (' ||
  quote_literal(id) || ', ' ||
  quote_literal(document_id) || ', ' ||
  page_number || ', ' ||
  CASE WHEN sheet_number IS NULL THEN 'NULL' ELSE quote_literal(sheet_number) END || ', ' ||
  CASE WHEN sheet_name IS NULL THEN 'NULL' ELSE quote_literal(sheet_name) END || ', ' ||
  CASE WHEN extracted_text IS NULL THEN 'NULL' ELSE quote_literal(extracted_text) END || ', ' ||
  CASE WHEN thumbnail IS NULL THEN 'NULL' ELSE quote_literal(thumbnail) END || ', ' ||
  has_takeoffs || ', ' ||
  takeoff_count || ', ' ||
  is_visible || ', ' ||
  ocr_processed || ', ' ||
  CASE WHEN titleblock_config IS NULL THEN 'NULL' ELSE quote_literal(titleblock_config::text) END || ', ' ||
  quote_literal(created_at::text) || ', ' ||
  quote_literal(updated_at::text) || ');' as insert_statement
FROM takeoff_sheets
ORDER BY created_at;

-- =====================================================
-- EXPORT 5: MEASUREMENTS (references projects, conditions, sheets)
-- =====================================================

SELECT 
  'INSERT INTO takeoff_measurements (id, project_id, sheet_id, condition_id, type, points, calculated_value, unit, timestamp, pdf_page, pdf_coordinates, condition_color, condition_name, perimeter_value, cutouts, net_calculated_value, created_at) VALUES (' ||
  quote_literal(id::text) || ', ' ||
  quote_literal(project_id::text) || ', ' ||
  quote_literal(sheet_id) || ', ' ||
  quote_literal(condition_id::text) || ', ' ||
  quote_literal(type) || ', ' ||
  quote_literal(points::text) || ', ' ||
  calculated_value || ', ' ||
  quote_literal(unit) || ', ' ||
  quote_literal(timestamp) || ', ' ||
  pdf_page || ', ' ||
  quote_literal(pdf_coordinates::text) || ', ' ||
  quote_literal(condition_color) || ', ' ||
  quote_literal(condition_name) || ', ' ||
  CASE WHEN perimeter_value IS NULL THEN 'NULL' ELSE perimeter_value::text END || ', ' ||
  CASE WHEN cutouts IS NULL THEN 'NULL' ELSE quote_literal(cutouts::text) END || ', ' ||
  CASE WHEN net_calculated_value IS NULL THEN 'NULL' ELSE net_calculated_value::text END || ', ' ||
  quote_literal(created_at::text) || ');' as insert_statement
FROM takeoff_measurements
ORDER BY created_at;

-- =====================================================
-- EXPORT 6: OCR RESULTS (references projects)
-- =====================================================

SELECT 
  'INSERT INTO ocr_results (id, project_id, document_id, page_number, text_content, confidence_score, processing_method, processing_time_ms, word_positions, created_at, updated_at) VALUES (' ||
  quote_literal(id::text) || ', ' ||
  quote_literal(project_id::text) || ', ' ||
  quote_literal(document_id) || ', ' ||
  page_number || ', ' ||
  quote_literal(text_content) || ', ' ||
  CASE WHEN confidence_score IS NULL THEN 'NULL' ELSE confidence_score::text END || ', ' ||
  quote_literal(processing_method) || ', ' ||
  CASE WHEN processing_time_ms IS NULL THEN 'NULL' ELSE processing_time_ms::text END || ', ' ||
  CASE WHEN word_positions IS NULL THEN 'NULL' ELSE quote_literal(word_positions::text) END || ', ' ||
  quote_literal(created_at::text) || ', ' ||
  quote_literal(updated_at::text) || ');' as insert_statement
FROM ocr_results
ORDER BY created_at;

-- =====================================================
-- EXPORT 7: OCR JOBS (references projects)
-- =====================================================

SELECT 
  'INSERT INTO ocr_jobs (id, project_id, document_id, status, progress, total_pages, processed_pages, error_message, started_at, completed_at, created_at) VALUES (' ||
  quote_literal(id::text) || ', ' ||
  quote_literal(project_id::text) || ', ' ||
  quote_literal(document_id) || ', ' ||
  quote_literal(status) || ', ' ||
  progress || ', ' ||
  total_pages || ', ' ||
  processed_pages || ', ' ||
  CASE WHEN error_message IS NULL THEN 'NULL' ELSE quote_literal(error_message) END || ', ' ||
  quote_literal(started_at::text) || ', ' ||
  CASE WHEN completed_at IS NULL THEN 'NULL' ELSE quote_literal(completed_at::text) END || ', ' ||
  quote_literal(created_at::text) || ');' as insert_statement
FROM ocr_jobs
ORDER BY created_at;

-- =====================================================
-- EXPORT 8: OCR TRAINING DATA (references projects and files)
-- =====================================================

SELECT 
  'INSERT INTO ocr_training_data (id, project_id, document_id, page_number, field_type, original_text, corrected_text, confidence, corrections, user_validated, field_coordinates, created_at, updated_at) VALUES (' ||
  quote_literal(id::text) || ', ' ||
  quote_literal(project_id::text) || ', ' ||
  quote_literal(document_id::text) || ', ' ||
  page_number || ', ' ||
  quote_literal(field_type) || ', ' ||
  quote_literal(original_text) || ', ' ||
  quote_literal(corrected_text) || ', ' ||
  confidence || ', ' ||
  quote_literal(corrections::text) || ', ' ||
  user_validated || ', ' ||
  CASE WHEN field_coordinates IS NULL THEN 'NULL' ELSE quote_literal(field_coordinates::text) END || ', ' ||
  quote_literal(created_at::text) || ', ' ||
  quote_literal(updated_at::text) || ');' as insert_statement
FROM ocr_training_data
ORDER BY created_at;

-- =====================================================
-- EXPORT COMPLETE
-- =====================================================
-- Copy each section's output and save them separately
-- Then run the import script in the new project


