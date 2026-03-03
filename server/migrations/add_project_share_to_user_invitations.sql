-- Migration: Add project share tracking to user_invitations
-- When a project is shared with an email, create a pending invitation record for visibility in admin panel.
-- source: 'admin' = explicit admin invite, 'project_share' = shared via project link
-- project_name: name of project when shared (nullable, for project_share source)

ALTER TABLE user_invitations
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'admin' CHECK (source IN ('admin', 'project_share')),
ADD COLUMN IF NOT EXISTS project_name TEXT;

COMMENT ON COLUMN user_invitations.source IS 'admin = explicit invite from admin panel, project_share = shared via project link';
COMMENT ON COLUMN user_invitations.project_name IS 'Project name when shared via project link (for project_share source)';
