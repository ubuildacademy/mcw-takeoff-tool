-- Migration: drop the dead Stage 1 assembly registry tables (open item 14)
--
-- Run this in Supabase Dashboard → SQL Editor, then click Run.
--
-- `assembly_workbooks` and `assembly_mappings` were Stage 1's workbook registry — the
-- write-quantities-into-a-copy-of-the-customer's-own-spreadsheet approach, superseded by
-- the native library (Stage 2) at task I8a on 2026-07-31. No route or service has read or
-- written either table since. Confirmed with Jeff 2026-08-10 (docs/OPEN_ITEMS.md item 14)
-- that the mappings are of no further interest.
--
-- `assemblies.source_workbook_id` still references `assembly_workbooks(id)` and is a live,
-- populated column (every native import sets it, see assemblyLibraryService.createAssembly).
-- CASCADE drops that one FK *constraint* along with the table — the column and its stored
-- ids are untouched, they just stop being validated against a table nothing else uses.
-- Nothing reads the constraint itself, only the column value (kept as provenance, same as
-- any soft pointer).

DROP TABLE IF EXISTS assembly_mappings CASCADE;
DROP TABLE IF EXISTS assembly_workbooks CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'assembly_workbooks'
  ) THEN
    RAISE EXCEPTION 'assembly_workbooks still exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'assembly_mappings'
  ) THEN
    RAISE EXCEPTION 'assembly_mappings still exists';
  END IF;
END $$;
