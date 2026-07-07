-- Condition templates move from browser localStorage to the database so they
-- follow the user across devices and browsers, and can be shared with the team.
-- Ids are client-generated strings (existing localStorage templates keep their
-- ids on one-time import).
CREATE TABLE IF NOT EXISTS condition_templates (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  shared BOOLEAN NOT NULL DEFAULT false,
  conditions JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_condition_templates_user ON condition_templates (user_id);
CREATE INDEX IF NOT EXISTS idx_condition_templates_shared ON condition_templates (shared) WHERE shared = true;

COMMENT ON TABLE condition_templates IS 'Reusable condition ("trade pack") templates; owned by a user, optionally shared with the team.';
