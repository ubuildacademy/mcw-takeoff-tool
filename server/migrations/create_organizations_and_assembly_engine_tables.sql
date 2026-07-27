-- Migration: Organizations + native assembly engine tables (Stage 2, task I1)
--
-- Run this in Supabase Dashboard → SQL Editor, then click Run.
--
-- Creates the org model the assembly library needs, and the five tables the
-- native costing engine runs on. Background: docs/ASSEMBLIES_DESIGN.md
-- (Stage 2 + the 2026-07-21 viability and 2026-07-27 I0 accuracy measurements)
-- and docs/IMPLEMENTATION_PLAN.md Workstream I.
--
-- Three constraints below are load-bearing and were each measured against
-- MCW's 236 live workbooks. They are called out again at their tables:
--   1. A component is identified by a surrogate id + sequence, NEVER by
--      (assembly, product code) — the same code legitimately appears twice at
--      different yields (two coats).
--   2. An assembly has MANY named quantity inputs, each with its own waste %.
--      74% of the library does. One quantity per assembly misprices them.
--   3. A component's price is EITHER a product-code reference OR a literal —
--      19 workbooks are priced entirely by hand with no price-list lookup.
--
-- Scope boundary (deliberate): this migration org-scopes the assembly library
-- and the Stage 1 workbook registry only. Projects, conditions, sheets and
-- measurements stay user-owned exactly as they are today; converting those to
-- org ownership is a separate, much larger change and is NOT part of Stage 2.

-- =============================================================================
-- 1. Organizations and membership
-- =============================================================================

-- Role model (Jeff, 2026-07-21) has three tiers:
--   platform admin — sees every company; dev/support only, never sold.
--   company admin  — manages their own company's assemblies and pricing.
--   regular user   — consumes assemblies during takeoff.
--
-- This migration expresses that ADDITIVELY and does not touch user_metadata.role
-- or the auth middleware: `user_metadata.role = 'admin'` remains the platform
-- flag that isAdmin() reads, and org_role below covers the two company tiers.
-- Consolidating the two notions of "admin" is a later task; doing it here would
-- mean editing auth middleware in a migration task and could lock every current
-- admin out of the admin panel.

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE organizations IS 'A company. Owns the assembly library and the product price list; projects remain user-owned.';

CREATE TABLE IF NOT EXISTS organization_members (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_role TEXT NOT NULL DEFAULT 'user' CHECK (org_role IN ('company_admin', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user ON organization_members (user_id);

COMMENT ON TABLE organization_members IS 'Company membership. org_role covers the two company tiers; platform admin stays on user_metadata.role.';

-- --- backfill -----------------------------------------------------------
-- Everyone in the beta is one company (MCW). Seed a single org, named from the
-- most common non-empty user_metadata.company, and put every existing user in
-- it. Existing platform admins also become company admins so nobody loses the
-- ability to manage the library they already manage.
DO $$
DECLARE
  v_org_id UUID;
  v_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM organizations) THEN
    RAISE NOTICE 'organizations already populated — skipping backfill';
    RETURN;
  END IF;

  SELECT company INTO v_name
  FROM user_metadata
  WHERE company IS NOT NULL AND btrim(company) <> ''
  GROUP BY company
  ORDER BY count(*) DESC, company
  LIMIT 1;

  INSERT INTO organizations (name)
  VALUES (COALESCE(NULLIF(btrim(v_name), ''), 'Default Organization'))
  RETURNING id INTO v_org_id;

  INSERT INTO organization_members (org_id, user_id, org_role)
  SELECT v_org_id, um.id, CASE WHEN um.role = 'admin' THEN 'company_admin' ELSE 'user' END
  FROM user_metadata um
  ON CONFLICT (org_id, user_id) DO NOTHING;

  RAISE NOTICE 'Seeded organization % with % member(s)', v_org_id,
    (SELECT count(*) FROM organization_members WHERE org_id = v_org_id);
END $$;

-- --- RLS helpers --------------------------------------------------------
-- SECURITY DEFINER with a pinned search_path, matching the convention set by
-- supabase_security_advisor_fixes.sql. These exist so policies stay readable
-- and so membership lookups don't recurse through organization_members' own
-- policy.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_metadata WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = p_org_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM organization_members
    WHERE org_id = p_org_id AND user_id = auth.uid() AND org_role = 'company_admin'
  );
$$;

COMMENT ON FUNCTION public.is_org_member(UUID) IS 'True if the caller belongs to the org (or is a platform admin). Read gate for org-owned data.';
COMMENT ON FUNCTION public.is_org_admin(UUID) IS 'True if the caller is a company admin of the org (or a platform admin). Write gate for the assembly library.';

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read their organization" ON organizations;
CREATE POLICY "Members can read their organization"
  ON organizations FOR SELECT
  USING (public.is_org_member(id));

DROP POLICY IF EXISTS "Platform admins manage organizations" ON organizations;
CREATE POLICY "Platform admins manage organizations"
  ON organizations FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Members can read their own membership" ON organization_members;
CREATE POLICY "Members can read their own membership"
  ON organization_members FOR SELECT
  USING (user_id = auth.uid() OR public.is_org_admin(org_id));

DROP POLICY IF EXISTS "Company admins manage membership" ON organization_members;
CREATE POLICY "Company admins manage membership"
  ON organization_members FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- =============================================================================
-- 2. Product price list (mirrors the MCW Pricing Manager export)
-- =============================================================================

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  item TEXT,
  description TEXT,
  net_price NUMERIC(12, 4),
  price_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE INDEX IF NOT EXISTS idx_products_org ON products (org_id);

COMMENT ON TABLE products IS 'Org-scoped product price list, imported from the MCW Pricing Manager''s "Export DB". The Pricing Manager remains the system of record; this is a read cache for costing.';
COMMENT ON COLUMN products.code IS 'CPC code. Unique per org — this is what assembly_components.product_code resolves against.';
COMMENT ON COLUMN products.net_price IS '4 decimal places: the Pricing Manager compares prices with a 0.001 tolerance.';

-- =============================================================================
-- 3. Assemblies
-- =============================================================================

CREATE TABLE IF NOT EXISTS assemblies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- labor
  day_rate_per_man NUMERIC(12, 4),
  crew_size INTEGER,
  labor_burden_pct NUMERIC(6, 4),
  -- material adjustments applied after waste
  escalation_pct NUMERIC(6, 4),
  surcharge_pct NUMERIC(6, 4),
  tax_pct NUMERIC(6, 4),
  -- ordered divide-through margin chain
  margin_chain JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- provenance: which Stage 1 workbook this was imported from, if any
  source_workbook_id UUID REFERENCES assembly_workbooks(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assemblies_org ON assemblies (org_id);
CREATE INDEX IF NOT EXISTS idx_assemblies_source_workbook ON assemblies (source_workbook_id);

COMMENT ON TABLE assemblies IS 'A priced assembly (one product line, e.g. Aquafin-2K). Company-level: reused across every project, like condition templates.';
COMMENT ON COLUMN assemblies.margin_chain IS 'ORDERED array of {name, rate}, applied DIVIDE-THROUGH and chained: cost / (1 - rate) per entry, in order (Safety, Overhead, Profit, Insurance). Never cost * (1 + rate) — that does not reproduce MCW''s books.';
COMMENT ON COLUMN assemblies.crew_size IS 'Men on the job. Labor = days x day_rate_per_man x crew_size x (1 + labor_burden_pct).';

-- --- CONSTRAINT 2: many named quantity inputs, each with its own waste ----
-- Measured 2026-07-27 (I0 finding 2): 171 of 231 workbooks (74%) have
-- components dividing more than one quantity cell. These are named, per-column
-- inputs with their own waste %, e.g. Euclid's
-- "SF-Floor | LF | SF-Walls | Sand (Optional)" or Emseal EJ's six. Stage 1's
-- audit saw one "Job Quantity" LABEL, which spans several value columns — the
-- same reason a multi-input Stage 1 mapping writes one summed total into every
-- cell. A single quantity per assembly would misprice three quarters of the
-- library, so the inputs get their own table and components bind to one.
CREATE TABLE IF NOT EXISTS assembly_quantity_inputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id UUID NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  unit TEXT,
  waste_pct NUMERIC(6, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assembly_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_assembly_quantity_inputs_assembly ON assembly_quantity_inputs (assembly_id);

COMMENT ON TABLE assembly_quantity_inputs IS 'The named quantity inputs of an assembly (SF-Floor, LF, SF-Walls, ...). Most assemblies have several; one is just N=1. Waste % is per input, not per assembly.';
COMMENT ON COLUMN assembly_quantity_inputs.seq IS 'Source column order in the workbook. Stable identity for the input; the name is editable.';

-- --- CONSTRAINTS 1 and 3: component identity and price source -------------
-- CONSTRAINT 1 (measured 2026-07-21): Aquafin-2K M.xlsx rows 19 and 20 carry
-- the SAME product code at DIFFERENT yields — one product applied in two coats.
-- Keying components on (assembly_id, product_code) would collapse them and
-- silently HALVE the material quantity on every bid using the assembly. Hence
-- a surrogate id, with (assembly_id, seq) as the only uniqueness.
--
-- CONSTRAINT 3 (measured 2026-07-27, I0 finding 4): 19 workbooks price every
-- component by hand with no price-list lookup at all, and 60 further rows in
-- 16 workbooks have had their lookup flattened to a pasted literal. Those are
-- real, complete components — so a component's price is either a product_code
-- reference or a literal unit_price, and exactly one must be set.
--
-- product_code is deliberately NOT a foreign key to products: workbooks
-- legitimately reference codes that have not been imported into the price list
-- yet, and a hard FK would turn "price not on file" into "import failed".
-- Resolution happens at costing time against products (org_id, code).
CREATE TABLE IF NOT EXISTS assembly_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id UUID NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  quantity_input_id UUID REFERENCES assembly_quantity_inputs(id) ON DELETE SET NULL,
  description TEXT,
  product_code TEXT,
  unit_price NUMERIC(12, 4),
  coverage_yield NUMERIC(14, 6),
  yield_unit TEXT,
  packaging_unit TEXT,
  is_optional BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assembly_id, seq),
  CONSTRAINT assembly_components_price_source CHECK (
    (product_code IS NOT NULL AND unit_price IS NULL)
    OR (product_code IS NULL AND unit_price IS NOT NULL)
    OR (product_code IS NULL AND unit_price IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_assembly_components_assembly ON assembly_components (assembly_id);
CREATE INDEX IF NOT EXISTS idx_assembly_components_quantity_input ON assembly_components (quantity_input_id);
CREATE INDEX IF NOT EXISTS idx_assembly_components_product_code ON assembly_components (product_code);

COMMENT ON TABLE assembly_components IS 'One material line of an assembly. Identified by (assembly_id, seq) — NEVER by product code: the same code appears twice at different yields when a product is applied in two coats.';
COMMENT ON COLUMN assembly_components.quantity_input_id IS 'Which of the assembly''s named quantity inputs this component divides. NULL means unresolved on import and must be set before the assembly prices.';
COMMENT ON COLUMN assembly_components.product_code IS 'Price-list reference, resolved against products(org_id, code) at costing time. Not an FK: workbooks reference codes that may not be imported yet. Mutually exclusive with unit_price.';
COMMENT ON COLUMN assembly_components.unit_price IS 'Literal price for hand-priced components (19 workbooks have no price-list lookup at all). Mutually exclusive with product_code.';
COMMENT ON COLUMN assembly_components.coverage_yield IS 'Units of the quantity input covered per package. Quantity = ROUNDUP(adjusted input quantity / coverage_yield).';
COMMENT ON COLUMN assembly_components.packaging_unit IS 'Informational only (lb/bag, gal kit). Never gates completeness — it is not used in the cost math.';
COMMENT ON COLUMN assembly_components.is_optional IS 'Component sits behind an include toggle or capacity gate in the source workbook (55 rows across 38 workbooks). Defaults to included.';

-- --- condition link -----------------------------------------------------
-- A condition feeds a NAMED INPUT of an assembly, not the assembly as a whole,
-- so several conditions can feed different inputs of the same assembly.
ALTER TABLE takeoff_conditions
  ADD COLUMN IF NOT EXISTS assembly_quantity_input_id UUID
  REFERENCES assembly_quantity_inputs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_takeoff_conditions_assembly_quantity_input
  ON takeoff_conditions (assembly_quantity_input_id);

COMMENT ON COLUMN takeoff_conditions.assembly_quantity_input_id IS 'The named assembly quantity input this condition feeds (e.g. "Aquafin 2K -> SF-Floor"). The assembly is reached through the input.';

-- =============================================================================
-- 4. RLS for the assembly library
-- =============================================================================
-- Read = any member of the org. Write = company admins (and platform admins).
-- The backend uses the service_role key, which bypasses RLS, so these are
-- defence in depth for direct frontend access — the same posture as the
-- Stage 1 registry tables.

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE assemblies ENABLE ROW LEVEL SECURITY;
ALTER TABLE assembly_quantity_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assembly_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read products" ON products;
CREATE POLICY "Members read products"
  ON products FOR SELECT USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Company admins write products" ON products;
CREATE POLICY "Company admins write products"
  ON products FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

DROP POLICY IF EXISTS "Members read assemblies" ON assemblies;
CREATE POLICY "Members read assemblies"
  ON assemblies FOR SELECT USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Company admins write assemblies" ON assemblies;
CREATE POLICY "Company admins write assemblies"
  ON assemblies FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- Child tables inherit their org through the parent assembly.
DROP POLICY IF EXISTS "Members read quantity inputs" ON assembly_quantity_inputs;
CREATE POLICY "Members read quantity inputs"
  ON assembly_quantity_inputs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM assemblies a WHERE a.id = assembly_id AND public.is_org_member(a.org_id)
  ));

DROP POLICY IF EXISTS "Company admins write quantity inputs" ON assembly_quantity_inputs;
CREATE POLICY "Company admins write quantity inputs"
  ON assembly_quantity_inputs FOR ALL
  USING (EXISTS (
    SELECT 1 FROM assemblies a WHERE a.id = assembly_id AND public.is_org_admin(a.org_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM assemblies a WHERE a.id = assembly_id AND public.is_org_admin(a.org_id)
  ));

DROP POLICY IF EXISTS "Members read components" ON assembly_components;
CREATE POLICY "Members read components"
  ON assembly_components FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM assemblies a WHERE a.id = assembly_id AND public.is_org_member(a.org_id)
  ));

DROP POLICY IF EXISTS "Company admins write components" ON assembly_components;
CREATE POLICY "Company admins write components"
  ON assembly_components FOR ALL
  USING (EXISTS (
    SELECT 1 FROM assemblies a WHERE a.id = assembly_id AND public.is_org_admin(a.org_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM assemblies a WHERE a.id = assembly_id AND public.is_org_admin(a.org_id)
  ));

-- =============================================================================
-- 5. Retrofit the Stage 1 registry to org scoping
-- =============================================================================
-- create_assembly_workbooks_tables.sql shipped an authenticated-only policy
-- with a note that it MUST tighten before multi-tenant. This is that tightening.

ALTER TABLE assembly_workbooks ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE assembly_mappings ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE assembly_workbooks SET org_id = (SELECT id FROM organizations ORDER BY created_at LIMIT 1) WHERE org_id IS NULL;
UPDATE assembly_mappings SET org_id = (SELECT id FROM organizations ORDER BY created_at LIMIT 1) WHERE org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_assembly_workbooks_org ON assembly_workbooks (org_id);
CREATE INDEX IF NOT EXISTS idx_assembly_mappings_org ON assembly_mappings (org_id);

DROP POLICY IF EXISTS "Authenticated users can manage assembly workbooks" ON assembly_workbooks;
DROP POLICY IF EXISTS "Authenticated users can manage assembly mappings" ON assembly_mappings;

DROP POLICY IF EXISTS "Members read assembly workbooks" ON assembly_workbooks;
CREATE POLICY "Members read assembly workbooks"
  ON assembly_workbooks FOR SELECT USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Company admins write assembly workbooks" ON assembly_workbooks;
CREATE POLICY "Company admins write assembly workbooks"
  ON assembly_workbooks FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

DROP POLICY IF EXISTS "Members read assembly mappings" ON assembly_mappings;
CREATE POLICY "Members read assembly mappings"
  ON assembly_mappings FOR SELECT USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Company admins write assembly mappings" ON assembly_mappings;
CREATE POLICY "Company admins write assembly mappings"
  ON assembly_mappings FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- org_id stays nullable on the two Stage 1 tables: the backend writes through
-- service_role and would otherwise start failing inserts the moment this
-- migration lands, before the service change that supplies org_id deploys.
-- Tighten to NOT NULL once the app is writing it (tracked in Workstream I).
