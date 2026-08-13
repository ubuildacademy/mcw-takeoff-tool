-- Bond, as an org-wide default rate (OPEN_ITEMS.md item 22).
--
-- Checked all 232 of MCW's 2026 assembly workbooks: none carry a "Bond" row in
-- their margin chain (only Safety, Over Head, Profit ever appear) — a
-- performance/payment bond is priced on the whole contract by a surety
-- company, not per material vendor. So unlike insurance, bond does not belong
-- in resolveAssemblyCostSettings's per-assembly merge (CostDefaults in
-- assemblyLibrary.ts): it never reprices an assembly, it is applied once to a
-- project's aggregated total (see getProjectCostBreakdown in
-- measurementSlice.ts). Stored alongside the other company rates purely
-- because this is where an admin already edits company-wide percentages.
ALTER TABLE organization_cost_defaults
  ADD COLUMN IF NOT EXISTS bond_pct NUMERIC(6, 4);

COMMENT ON COLUMN organization_cost_defaults.bond_pct IS
  'Company-wide bond % applied once to a project''s aggregated total cost. NULL = no bond by default; a project can still set its own via takeoff_projects.bond_pct_override.';
