-- Per-project bond % override (OPEN_ITEMS.md item 22), same shape as
-- profit_margin_percent: a dedicated numeric column, not folded into the
-- free-text job_info JSONB blob, because this one is actually read by the
-- costing engine (getProjectCostBreakdown) rather than only rendered on a
-- document.
--
-- NULL means "inherit the company's bond_pct default"
-- (organization_cost_defaults.bond_pct) — not zero. A project that genuinely
-- has no bond requirement sets this to 0 explicitly.
ALTER TABLE takeoff_projects
  ADD COLUMN IF NOT EXISTS bond_pct_override NUMERIC(6, 4);

COMMENT ON COLUMN takeoff_projects.bond_pct_override IS
  'This project''s own bond %, overriding organization_cost_defaults.bond_pct. NULL = inherit the company default.';
