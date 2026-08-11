-- Migration: per-company report branding
--
-- Run this in Supabase Dashboard → SQL Editor, then click Run.
--
-- Report branding (company name/accent color/logo on every Excel export header) lived
-- in `app_settings` — a single global key-value store, platform-admin-only. That's fine
-- for AI prompts and knowledge base content, which really are Jeff's alone, but branding
-- is company identity: once a second company exists, they'd get MCW's name and logo on
-- their own P.O./Work Order/Budget exports. One row per org, not mixed into the global
-- settings table (which stays exactly as-is for everything else it holds).

CREATE TABLE IF NOT EXISTS organization_report_branding (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  company_name TEXT,
  accent_color TEXT,
  logo_base64 TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

COMMENT ON TABLE organization_report_branding IS
  'Per-company white-label settings for Excel export headers (P.O., Work Order, Budget report, takeoff export). NULL columns fall back to stock Meridian branding.';

ALTER TABLE organization_report_branding ENABLE ROW LEVEL SECURITY;

-- Defence in depth, same posture as every other org table (I1): the backend uses the
-- service_role key and bypasses RLS; these policies matter only for direct frontend
-- access. Any member reads their own company's branding (every export needs it, not
-- just company admins); only a company admin or platform admin writes it.
DROP POLICY IF EXISTS "Members read report branding" ON organization_report_branding;
CREATE POLICY "Members read report branding"
  ON organization_report_branding FOR SELECT USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Company admins write report branding" ON organization_report_branding;
CREATE POLICY "Company admins write report branding"
  ON organization_report_branding FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'organization_report_branding'
  ) THEN
    RAISE EXCEPTION 'organization_report_branding was not created';
  END IF;
END $$;
