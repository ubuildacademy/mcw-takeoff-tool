-- Migration: company-wide cost defaults (Stage 2, task I10)
--
-- Run this in Supabase Dashboard → SQL Editor, then click Run.
--
-- Measured across MCW's 232 live assembly workbooks: the labor burden (0.35),
-- tax (0.07) and insurance margin (0.15) are identical in every single one, and
-- the day rate (224), insurance rate per thousand (79), margin chain
-- (Safety 2 / Overhead 22 / Profit 20) and escalation (0.03) hold in 86-99% of
-- them. Freezing those into every imported assembly would mean 232 copies of
-- the same number, and "raise the day rate" would become 232 edits.
--
-- So they live here once per company, and an assembly stores a value ONLY
-- where it genuinely differs.
--
-- Deliberately NOT here: crew size (2/1/3, varies by trade) and production
-- rates (36 distinct values across the library, up to 10 within a single
-- workbook — they are the pacing itself). Those stay on the assembly.

CREATE TABLE IF NOT EXISTS organization_cost_defaults (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  day_rate_per_man NUMERIC(12, 4),
  labor_burden_pct NUMERIC(6, 4),
  escalation_pct NUMERIC(6, 4),
  surcharge_pct NUMERIC(6, 4),
  tax_pct NUMERIC(6, 4),
  margin_chain JSONB NOT NULL DEFAULT '[]'::jsonb,
  insurance_rate_per_thousand NUMERIC(12, 4),
  insurance_margin_pct NUMERIC(6, 4),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE organization_cost_defaults IS 'Company-wide costing rates. An assembly column left NULL INHERITS the value here; it is only set on the assembly when that assembly genuinely differs.';
COMMENT ON COLUMN organization_cost_defaults.margin_chain IS 'ORDERED array of {name, rate}, applied divide-through: cost / (1 - rate) per entry. Same shape as assemblies.margin_chain, which overrides it when non-empty.';

-- Seed the existing org(s) with the values measured from the live workbooks, so
-- imports and pricing behave identically to the spreadsheets on day one.
INSERT INTO organization_cost_defaults (
  org_id, day_rate_per_man, labor_burden_pct, escalation_pct, surcharge_pct, tax_pct,
  margin_chain, insurance_rate_per_thousand, insurance_margin_pct
)
SELECT
  o.id, 224, 0.35, 0.03, 0, 0.07,
  '[{"name":"Safety","rate":0.02},{"name":"Over Head","rate":0.22},{"name":"Profit","rate":0.20}]'::jsonb,
  79, 0.15
FROM organizations o
ON CONFLICT (org_id) DO NOTHING;

-- =============================================================================
-- RLS — read by any member, written by company admins
-- =============================================================================
-- Same posture as the rest of the library. The backend uses the service_role
-- key and bypasses these; they are defence in depth for direct frontend access.

ALTER TABLE organization_cost_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read cost defaults" ON organization_cost_defaults;
CREATE POLICY "Members read cost defaults"
  ON organization_cost_defaults FOR SELECT
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Company admins write cost defaults" ON organization_cost_defaults;
CREATE POLICY "Company admins write cost defaults"
  ON organization_cost_defaults FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));
