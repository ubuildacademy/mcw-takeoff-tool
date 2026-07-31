-- Migration: accounting rates for the assembly report (Stage 2, task I7)
--
-- Run this in Supabase Dashboard → SQL Editor, then click Run.
--
-- The workbook's "Labor budgets" sheet decomposes a job total into the buckets
-- the accounting system posts against: payroll tax, workers' comp, general
-- liability, and OH&P as the residual. Those three rates are held on that sheet
-- rather than on ASSEMBLY, which is why they are only surfacing now.
--
-- Measured 2026-07-30 across all 478 workbooks that carry a Labor budgets
-- sheet: 11.33 / 7.72 / 12.73 in EVERY ONE of them. 478/478 on all three. That
-- is company-level with no exceptions, so it belongs here beside the other
-- company rates rather than on any assembly.
--
-- The restoration variant is the one documented alternative: the sheet carries
-- the note "12.73 for Waterproofing & 5.337 for Restoration" but no workbook
-- uses the lower figure. It is stored so the report can offer the choice
-- without anyone re-deriving where 5.337 came from.

-- NUMERIC(8, 6), not the (6, 4) the older rate columns use: the restoration
-- rate is 0.05337, which (6, 4) would silently round to 0.0534. Six decimals
-- store every rate here exactly.
ALTER TABLE organization_cost_defaults
  ADD COLUMN IF NOT EXISTS payroll_tax_pct NUMERIC(8, 6),
  ADD COLUMN IF NOT EXISTS workers_comp_pct NUMERIC(8, 6),
  ADD COLUMN IF NOT EXISTS general_liability_pct NUMERIC(8, 6),
  ADD COLUMN IF NOT EXISTS general_liability_restoration_pct NUMERIC(8, 6);

COMMENT ON COLUMN organization_cost_defaults.payroll_tax_pct IS
  'Payroll tax as a fraction of regular pay. 0.1133 in all 478 workbooks measured 2026-07-30.';
COMMENT ON COLUMN organization_cost_defaults.workers_comp_pct IS
  'Workers'' comp as a fraction of regular pay. 0.0772 in all 478 workbooks.';
COMMENT ON COLUMN organization_cost_defaults.general_liability_pct IS
  'General liability as a fraction of the JOB TOTAL, not of pay. 0.1273 in all 478 workbooks.';
COMMENT ON COLUMN organization_cost_defaults.general_liability_restoration_pct IS
  'General liability for restoration work. 0.05337, documented in the workbooks but not used by any of them.';

-- Backfill existing orgs with the measured values. COALESCE rather than a bare
-- UPDATE so re-running cannot overwrite a rate someone has since changed.
UPDATE organization_cost_defaults
SET payroll_tax_pct = COALESCE(payroll_tax_pct, 0.1133),
    workers_comp_pct = COALESCE(workers_comp_pct, 0.0772),
    general_liability_pct = COALESCE(general_liability_pct, 0.1273),
    general_liability_restoration_pct = COALESCE(general_liability_restoration_pct, 0.05337);
