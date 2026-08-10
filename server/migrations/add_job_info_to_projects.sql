-- Migration: job_info on takeoff_projects (Work Order generator)
--
-- Run this in Supabase Dashboard → SQL Editor, then click Run.
--
-- The Work Order document needs ~25 job-paperwork fields Meridian doesn't track anywhere
-- today (GC name/address/phone, superintendent, GC PM, owner, architect, # of stories,
-- warranty/permit/bond/NTO flags, contract dates, scope of work…) — read straight off a
-- real MCW workbook's BASIC JOB INFO sheet (see src/types/index.ts's JobInfo interface).
--
-- One JSONB blob, not 25 columns: every field is free text, none of them are ever queried
-- individually — only read as a whole when generating a Work Order document. A typed
-- table would mean a 25-column migration for data with no query pattern to justify it.

ALTER TABLE takeoff_projects
  ADD COLUMN IF NOT EXISTS job_info JSONB;

COMMENT ON COLUMN takeoff_projects.job_info IS
  'Work Order paperwork fields (GC, super, owner, architect, warranty/permit/bond/NTO, contract dates, scope of work) as a JSONB blob — see JobInfo in src/types/index.ts. NULL = not filled in yet.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'takeoff_projects' AND column_name = 'job_info'
  ) THEN
    RAISE EXCEPTION 'takeoff_projects.job_info was not created';
  END IF;
END $$;
