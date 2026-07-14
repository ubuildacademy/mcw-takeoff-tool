-- Migration: Create assembly_workbooks and assembly_mappings tables (Stage 1 bridge)
-- Description: Org-scoped registry of priced assembly workbooks and their condition
-- input-cell mappings. See docs/ASSEMBLIES_DESIGN.md for background. `condition_ref`
-- keys on a condition name pattern or template id (not a concrete condition id) so
-- Stage 2 convergence with condition templates ("open an assembly as a template") is
-- not precluded by this schema.

CREATE TABLE IF NOT EXISTS assembly_workbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assembly_workbooks_uploaded_by ON assembly_workbooks (uploaded_by);

COMMENT ON TABLE assembly_workbooks IS 'Priced assembly workbook registry (Stage 1 workbook bridge); org-scoped, uploaded_by is audit only.';

CREATE TABLE IF NOT EXISTS assembly_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workbook_id UUID NOT NULL REFERENCES assembly_workbooks(id) ON DELETE CASCADE,
  condition_ref TEXT NOT NULL,
  inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  job_info_cells JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assembly_mappings_workbook ON assembly_mappings (workbook_id);
CREATE INDEX IF NOT EXISTS idx_assembly_mappings_condition_ref ON assembly_mappings (condition_ref);

COMMENT ON TABLE assembly_mappings IS 'Condition-to-workbook input-cell mapping. condition_ref is a condition name pattern or template id, not a concrete condition id — keeps Stage 2 (assembly-linked templates) open.';
COMMENT ON COLUMN assembly_mappings.inputs IS 'Array of {label, cell} quantity input targets on the workbook''s ASSEMBLY sheet.';
COMMENT ON COLUMN assembly_mappings.job_info_cells IS 'Optional map of job-info field -> cell address (project name, client, address).';

-- Enable Row Level Security. Mirrors condition_templates: the backend uses the
-- service_role key (bypasses RLS) for all normal reads/writes, so this policy is
-- defense-in-depth for any direct frontend access. Assembly workbooks are an
-- org-wide shared registry (not per-user owned like condition_templates), so any
-- authenticated user may read/write.
ALTER TABLE assembly_workbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE assembly_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage assembly workbooks"
  ON assembly_workbooks
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can manage assembly mappings"
  ON assembly_mappings
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
