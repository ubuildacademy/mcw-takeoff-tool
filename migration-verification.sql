-- =====================================================
-- MERIDIAN TAKEOFF MIGRATION: VERIFICATION
-- Target Project: mxjyytwfhmoonkduvybr
-- =====================================================
-- Run this in your NEW Supabase project SQL Editor
-- This verifies that all data was migrated correctly

-- =====================================================
-- VERIFICATION 1: TABLE COUNTS
-- =====================================================

SELECT 'takeoff_projects' as table_name, COUNT(*) as record_count FROM takeoff_projects
UNION ALL
SELECT 'takeoff_conditions' as table_name, COUNT(*) as record_count FROM takeoff_conditions
UNION ALL
SELECT 'takeoff_files' as table_name, COUNT(*) as record_count FROM takeoff_files
UNION ALL
SELECT 'takeoff_sheets' as table_name, COUNT(*) as record_count FROM takeoff_sheets
UNION ALL
SELECT 'takeoff_measurements' as table_name, COUNT(*) as record_count FROM takeoff_measurements
UNION ALL
SELECT 'ocr_results' as table_name, COUNT(*) as record_count FROM ocr_results
UNION ALL
SELECT 'ocr_jobs' as table_name, COUNT(*) as record_count FROM ocr_jobs
UNION ALL
SELECT 'ocr_training_data' as table_name, COUNT(*) as record_count FROM ocr_training_data
ORDER BY table_name;

-- =====================================================
-- VERIFICATION 2: FOREIGN KEY INTEGRITY
-- =====================================================

-- Check for orphaned conditions
SELECT 'Orphaned conditions' as check_name, COUNT(*) as count
FROM takeoff_conditions tc
LEFT JOIN takeoff_projects tp ON tc.project_id = tp.id
WHERE tp.id IS NULL;

-- Check for orphaned files
SELECT 'Orphaned files' as check_name, COUNT(*) as count
FROM takeoff_files tf
LEFT JOIN takeoff_projects tp ON tf.project_id = tp.id
WHERE tp.id IS NULL;

-- Check for orphaned measurements
SELECT 'Orphaned measurements (no project)' as check_name, COUNT(*) as count
FROM takeoff_measurements tm
LEFT JOIN takeoff_projects tp ON tm.project_id = tp.id
WHERE tp.id IS NULL;

-- Check for orphaned measurements (no condition)
SELECT 'Orphaned measurements (no condition)' as check_name, COUNT(*) as count
FROM takeoff_measurements tm
LEFT JOIN takeoff_conditions tc ON tm.condition_id = tc.id
WHERE tc.id IS NULL;

-- Check for orphaned OCR results
SELECT 'Orphaned OCR results' as check_name, COUNT(*) as count
FROM ocr_results or_res
LEFT JOIN takeoff_projects tp ON or_res.project_id = tp.id
WHERE tp.id IS NULL;

-- Check for orphaned OCR jobs
SELECT 'Orphaned OCR jobs' as check_name, COUNT(*) as count
FROM ocr_jobs oj
LEFT JOIN takeoff_projects tp ON oj.project_id = tp.id
WHERE tp.id IS NULL;

-- Check for orphaned OCR training data
SELECT 'Orphaned OCR training data (no project)' as check_name, COUNT(*) as count
FROM ocr_training_data otd
LEFT JOIN takeoff_projects tp ON otd.project_id = tp.id
WHERE tp.id IS NULL;

-- Check for orphaned OCR training data (no file)
SELECT 'Orphaned OCR training data (no file)' as check_name, COUNT(*) as count
FROM ocr_training_data otd
LEFT JOIN takeoff_files tf ON otd.document_id = tf.id
WHERE tf.id IS NULL;

-- =====================================================
-- VERIFICATION 3: DATA SAMPLE CHECKS
-- =====================================================

-- Sample projects
SELECT 'Sample projects' as check_name, id, name, client, created_at
FROM takeoff_projects
ORDER BY created_at DESC
LIMIT 3;

-- Sample conditions
SELECT 'Sample conditions' as check_name, id, project_id, name, type, color
FROM takeoff_conditions
ORDER BY created_at DESC
LIMIT 3;

-- Sample measurements
SELECT 'Sample measurements' as check_name, id, project_id, condition_id, type, calculated_value, unit
FROM takeoff_measurements
ORDER BY created_at DESC
LIMIT 3;

-- Sample OCR results
SELECT 'Sample OCR results' as check_name, id, project_id, document_id, page_number, processing_method
FROM ocr_results
ORDER BY created_at DESC
LIMIT 3;

-- =====================================================
-- VERIFICATION 4: JSON DATA INTEGRITY
-- =====================================================

-- Check measurements with valid JSON
SELECT 'Measurements with valid JSON points' as check_name, COUNT(*) as count
FROM takeoff_measurements
WHERE points IS NOT NULL AND jsonb_typeof(points) = 'object';

-- Check measurements with valid PDF coordinates
SELECT 'Measurements with valid PDF coordinates' as check_name, COUNT(*) as count
FROM takeoff_measurements
WHERE pdf_coordinates IS NOT NULL AND jsonb_typeof(pdf_coordinates) = 'object';

-- Check sheets with valid titleblock config
SELECT 'Sheets with valid titleblock config' as check_name, COUNT(*) as count
FROM takeoff_sheets
WHERE titleblock_config IS NOT NULL AND jsonb_typeof(titleblock_config) = 'object';

-- Check OCR results with valid word positions
SELECT 'OCR results with valid word positions' as check_name, COUNT(*) as count
FROM ocr_results
WHERE word_positions IS NOT NULL AND jsonb_typeof(word_positions) = 'array';

-- =====================================================
-- VERIFICATION 5: INDEX VERIFICATION
-- =====================================================

-- Check that indexes exist
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
    AND tablename IN (
        'takeoff_projects', 'takeoff_conditions', 'takeoff_files', 
        'takeoff_sheets', 'takeoff_measurements', 'ocr_results', 
        'ocr_jobs', 'ocr_training_data'
    )
ORDER BY tablename, indexname;

-- =====================================================
-- VERIFICATION COMPLETE
-- =====================================================
-- If all checks pass, the migration was successful!
-- Next step: Update configuration files and test the application


