-- Migration: org_id + org_role on user_invitations (task I9)
--
-- Run this in Supabase Dashboard → SQL Editor, then click Run.
--
-- The bug this closes: `user_invitations` has never carried an org_id, and
-- `POST /api/auth/accept-invitation` has never written `organization_members`.
-- Every invited user today lands with a `user_metadata` row and NO org
-- membership at all — the assembly library and product list both read that
-- as "not a member of any company yet" (409) until someone fixes it by hand
-- in Supabase. I9 wires the invite flow to actually put people in a company;
-- this migration is the column that carries which one.
--
-- `org_role` rides along so a company admin can invite someone straight in
-- as another company admin, not just a regular member — same shape as
-- `organization_members.org_role`, same default.
--
-- Existing rows get org_id = NULL (unknowable after the fact) and
-- org_role = 'user' (the column default). Nothing reads org_id on a historic
-- row: accept-invitation only runs once, at signup time, and every row this
-- old is long past 'pending'.

ALTER TABLE user_invitations
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS org_role TEXT NOT NULL DEFAULT 'user' CHECK (org_role IN ('company_admin', 'user'));

COMMENT ON COLUMN user_invitations.org_id IS
  'Company the invite joins on acceptance. NULL = platform-only invite (no company yet), the historic default.';
COMMENT ON COLUMN user_invitations.org_role IS
  'organization_members.org_role to assign on acceptance, when org_id is set.';

CREATE INDEX IF NOT EXISTS idx_user_invitations_org ON user_invitations (org_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_invitations' AND column_name = 'org_id'
  ) THEN
    RAISE EXCEPTION 'user_invitations.org_id was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_invitations' AND column_name = 'org_role'
  ) THEN
    RAISE EXCEPTION 'user_invitations.org_role was not created';
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_invitations WHERE org_role NOT IN ('company_admin', 'user')
  ) THEN
    RAISE EXCEPTION 'user_invitations.org_role has a value outside the check constraint';
  END IF;
END $$;
