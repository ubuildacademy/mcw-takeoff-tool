-- Migration: assemblies_enabled on organizations
--
-- Run this in Supabase Dashboard → SQL Editor, then click Run.
--
-- Assemblies becomes an upsell, not a given: a company that doesn't buy the
-- feature shouldn't see it anywhere (Conditions, the admin library tab, P.O./
-- report buttons), and a system admin needs one switch per company to grant or
-- revoke it. This column is that switch, read by the backend on every
-- assembly/product-list route and by the frontend to decide what to render.
--
-- DEFAULT true grandfathers in every org that exists today (only MCW, which is
-- already using the feature) — nobody currently on assemblies loses access the
-- moment this migration runs. Future companies get created with it off by a
-- system admin's explicit choice (or the org-creation step can pass false
-- outright; that's a later change, not this one).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS assemblies_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN organizations.assemblies_enabled IS
  'Whether this company has the assemblies feature (system-admin controlled upsell). false hides assembly UI and 403s assembly/product-list API routes for every member of the org.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'assemblies_enabled'
  ) THEN
    RAISE EXCEPTION 'organizations.assemblies_enabled was not created';
  END IF;
END $$;
