-- Sheet hyperlinks move from browser localStorage to the database so they
-- follow the project across devices, browsers, and shared-project members.
-- Ids are client-generated strings (existing localStorage links keep their ids
-- on one-time import).
CREATE TABLE IF NOT EXISTS sheet_hyperlinks (
  id TEXT PRIMARY KEY,
  project_id UUID NOT NULL,
  source_sheet_id UUID NOT NULL,
  source_page_number INTEGER NOT NULL,
  -- {x, y, width, height} normalized 0..1 (rotation-0 page space)
  source_rect JSONB NOT NULL,
  target_sheet_id TEXT NOT NULL DEFAULT '',
  target_page_number INTEGER NOT NULL DEFAULT 1,
  target_url TEXT,
  -- {x, y, zoom} deep-link landing view; NULL = default page view
  target_viewport JSONB,
  origin TEXT NOT NULL DEFAULT 'manual',
  detected_sheet_ref TEXT,
  timestamp TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sheet_hyperlinks_project ON sheet_hyperlinks (project_id);
CREATE INDEX IF NOT EXISTS idx_sheet_hyperlinks_source ON sheet_hyperlinks (source_sheet_id, source_page_number);

COMMENT ON TABLE sheet_hyperlinks IS 'Clickable sheet-to-sheet link regions (manual + auto-hyperlink), incl. deep-link target views.';
