-- Item 15 (OPEN_ITEMS.md): the projects list computes its total from flat
-- condition costs only and has no way to price an assembly-linked condition,
-- so a job priced through assemblies shows a stale total until it is opened.
--
-- Fix: cache the full project total (flat + assembly) here whenever the
-- workspace prices a project, and have the list read it when present.
ALTER TABLE takeoff_projects
  ADD COLUMN IF NOT EXISTS total_value_cache NUMERIC;
