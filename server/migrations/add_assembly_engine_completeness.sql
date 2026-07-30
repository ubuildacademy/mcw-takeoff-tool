-- Migration: complete the native assembly schema so a SAVED assembly can be
-- priced (Stage 2, task I5).
--
-- Run this in Supabase Dashboard → SQL Editor, then click Run.
--
-- The I1 schema was designed before the costing engine existed. Building the
-- engine (I4) and measuring it against 165 real workbooks surfaced five things
-- an assembly must carry that the tables had nowhere to put. Each one below is
-- load-bearing: without it a saved assembly either cannot be priced at all, or
-- prices differently from the workbook it was imported from.
--
-- Background: docs/ASSEMBLIES_DESIGN.md ("I3 — extractor built", "I4 — the
-- costing engine reproduces the books") and IMPLEMENTATION_PLAN.md Workstream I.
--
-- Deliberately bundled into ONE migration rather than added as they were found,
-- so the live database is altered once.

-- =============================================================================
-- 1. Insurance
-- =============================================================================
-- Insurance is NOT part of the divide-through margin chain. The workbook
-- charges a dollars-per-thousand rate on the material+labor+equipment cost,
-- applies insurance's own divide-through margin to that, and adds the result to
-- the job total alongside the chain:
--   F69 = ROUNDUP(ratePerThousand * cost / 1000)
--   F71 = F69 / (1 - insuranceMarginPct)
--   F77 = ROUNDUP(cost + F71 + margins)
-- Folding insurance into the chain (or dropping it) misprices every assembly
-- that has one, which is most of them.

ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS insurance_rate_per_thousand NUMERIC(12, 4);
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS insurance_margin_pct NUMERIC(6, 4);

COMMENT ON COLUMN assemblies.insurance_rate_per_thousand IS 'Dollars of insurance per $1,000 of material+labor+equipment cost (the workbook''s "Dollars per Thousand"). Applied outside the margin chain.';
COMMENT ON COLUMN assemblies.insurance_margin_pct IS 'Insurance''s own divide-through margin, applied to the insurance charge only.';

-- =============================================================================
-- 2. Production rates
-- =============================================================================
-- Labor is not a single rate. Each assembly lists a production rate per line
-- item, each line paces a SPECIFIC quantity input (one sheet paces floor and
-- wall separately), and whether a line rounds up to a whole day is a property
-- of the source workbook — Aquafin wraps every line in ROUNDUP, Henry's
-- Blueskin sheets wrap none and round only the summed total. Assuming either
-- way misprices the other family.
--
-- Without this table a saved assembly has no labor at all.

CREATE TABLE IF NOT EXISTS assembly_production_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id UUID NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  description TEXT,
  rate_per_day NUMERIC(14, 4),
  unit TEXT,
  quantity_input_id UUID REFERENCES assembly_quantity_inputs(id) ON DELETE SET NULL,
  -- TRUE: this line rounds up to a whole day on its own (the majority layout).
  -- FALSE: it contributes a fraction and only the summed total is rounded.
  rounds_up BOOLEAN NOT NULL DEFAULT true,
  -- The line sits behind an include toggle in the source workbook.
  is_optional BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assembly_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_assembly_production_rates_assembly ON assembly_production_rates (assembly_id);
CREATE INDEX IF NOT EXISTS idx_assembly_production_rates_input ON assembly_production_rates (quantity_input_id);

COMMENT ON TABLE assembly_production_rates IS 'Per-line-item production rates. Labor man-days are the sum of each line''s quantity/rate; the crew then works ROUNDUP(manDays / crewSize) calendar days.';
COMMENT ON COLUMN assembly_production_rates.rounds_up IS 'Whether THIS line rounds to a whole day. Workbook-specific: some sheets round every line, others only the total.';
COMMENT ON COLUMN assembly_production_rates.quantity_input_id IS 'Which named quantity input this line paces. Lines in one assembly can pace different inputs.';

-- =============================================================================
-- 3. Components: quantity rules that are not coverage yield
-- =============================================================================
-- 26 component rows across the library take their quantity from somewhere other
-- than ROUNDUP(quantity / yield): a tape that ships one-to-one with the
-- membrane above it, or an initiator counted per pail of another product. They
-- are unmistakably components — code, price, line total — so they import, but
-- until they carry a rule they cannot price and are flagged instead.

ALTER TABLE assembly_components
  ADD COLUMN IF NOT EXISTS quantity_rule TEXT NOT NULL DEFAULT 'coverage_yield';

ALTER TABLE assembly_components
  DROP CONSTRAINT IF EXISTS assembly_components_quantity_rule_check;
ALTER TABLE assembly_components
  ADD CONSTRAINT assembly_components_quantity_rule_check
  CHECK (quantity_rule IN ('coverage_yield', 'same_as_component', 'fixed', 'manual'));

-- For 'same_as_component': the seq of the component whose package count this
-- one copies. A seq rather than an id, so an import can wire rows up before
-- they have been inserted.
ALTER TABLE assembly_components ADD COLUMN IF NOT EXISTS quantity_rule_component_seq INTEGER;
-- For 'fixed': a flat package count independent of quantity.
ALTER TABLE assembly_components ADD COLUMN IF NOT EXISTS fixed_quantity NUMERIC(14, 4);

COMMENT ON COLUMN assembly_components.quantity_rule IS 'How this component''s package count is derived. coverage_yield = ROUNDUP(adjusted quantity / yield), the normal case. same_as_component = copies another line. fixed = a flat count. manual = the workbook computed it from something we do not model; it must be set by hand before the assembly prices.';

-- Components that divide the SUM of several named inputs (a deck area plus the
-- pile-collar area wrapping it). Each contributing input keeps its own waste %,
-- so they are adjusted individually and then added — using one input's waste
-- for the combined figure is wrong whenever they differ, and they routinely do
-- (17% vs 5% in the same component).
ALTER TABLE assembly_components ADD COLUMN IF NOT EXISTS additional_quantity_input_ids UUID[];

COMMENT ON COLUMN assembly_components.additional_quantity_input_ids IS 'Further quantity inputs this component also divides; its quantity is the sum, each input adjusted by its own waste %. Empty/NULL for the normal single-input case.';

-- =============================================================================
-- 4. Import provenance
-- =============================================================================
-- What the importer could not resolve, kept with the assembly so the review
-- screen can show it and so a later reviewer can see why a field was left
-- empty. Flags belong to the import, not to the costing.

ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS import_flags JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;
ALTER TABLE assembly_components ADD COLUMN IF NOT EXISTS import_flags JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN assemblies.import_flags IS 'Assembly-level notes from the workbook importer (task I3), e.g. a missing day rate. Cleared as a reviewer resolves them.';
COMMENT ON COLUMN assembly_components.import_flags IS 'Per-component notes from the importer, e.g. "price lookup was a pasted value" or "quantity copies another row".';

-- =============================================================================
-- 5. RLS for the new table
-- =============================================================================
-- Same posture as the rest of the library: read = any org member, write =
-- company admins. The backend uses the service_role key and bypasses these, so
-- they are defence in depth for direct frontend access.

ALTER TABLE assembly_production_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read production rates" ON assembly_production_rates;
CREATE POLICY "Members read production rates"
  ON assembly_production_rates FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM assemblies a WHERE a.id = assembly_id AND public.is_org_member(a.org_id)
  ));

DROP POLICY IF EXISTS "Company admins write production rates" ON assembly_production_rates;
CREATE POLICY "Company admins write production rates"
  ON assembly_production_rates FOR ALL
  USING (EXISTS (
    SELECT 1 FROM assemblies a WHERE a.id = assembly_id AND public.is_org_admin(a.org_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM assemblies a WHERE a.id = assembly_id AND public.is_org_admin(a.org_id)
  ));
