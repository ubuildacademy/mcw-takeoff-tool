-- Migration: job_number on takeoff_projects
--
-- Run this in Supabase Dashboard → SQL Editor, then click Run.
--
-- The P.O. generator's header is JOB NAME + JOB # (a real MCW workbook's P.O. sheet
-- has exactly those two fields, nothing else — see docs/OPEN_ITEMS.md item 16). Job
-- name is already `takeoff_projects.name`; job number has never existed here. Nullable,
-- same as every other job-info-shaped column on this table (client, location, etc.) —
-- a project without one still generates a P.O., just with a blank Job # cell, matching
-- the source workbooks' own "xxxx" placeholder convention for unfilled fields.

ALTER TABLE takeoff_projects
  ADD COLUMN IF NOT EXISTS job_number TEXT;

COMMENT ON COLUMN takeoff_projects.job_number IS
  'Job/project number for paperwork (P.O., work order). Distinct from the internal project id. NULL = not set.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'takeoff_projects' AND column_name = 'job_number'
  ) THEN
    RAISE EXCEPTION 'takeoff_projects.job_number was not created';
  END IF;
END $$;
