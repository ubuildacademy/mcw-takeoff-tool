-- Migration: Ensure takeoff_projects.user_id is NEVER null
-- Prevents "Unknown Owner" bug where projects end up without an owner.
--
-- PREREQUISITE: If you have existing projects with user_id IS NULL, run the
-- recovery steps in scripts/trace-unknown-projects.sql FIRST to reassign them.
-- This migration will FAIL if any rows have null user_id.
--
-- Run in Supabase Dashboard → SQL Editor

-- 1. First, report any projects that would block the migration
DO $$
DECLARE
  null_count INT;
BEGIN
  SELECT COUNT(*) INTO null_count FROM takeoff_projects WHERE user_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Cannot add constraint: % project(s) have user_id IS NULL. Run scripts/trace-unknown-projects.sql to fix them first.', null_count;
  END IF;
END $$;

-- 2. Add NOT NULL constraint - blocks future NULL inserts/updates at DB level
ALTER TABLE takeoff_projects
  ALTER COLUMN user_id SET NOT NULL;

-- 3. Add a comment for future developers
COMMENT ON COLUMN takeoff_projects.user_id IS 'Owner of the project. Must NEVER be null. Required for: new projects, backup restore, shared import.';
