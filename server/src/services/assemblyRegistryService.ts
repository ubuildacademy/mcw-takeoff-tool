import { supabase } from '../supabase';
import { wrapDatabaseError } from '../errors';

export interface AssemblyWorkbook {
  id: string;
  filename: string;
  storagePath: string;
  uploadedBy: string;
  createdAt: string;
}

interface AssemblyWorkbookRow {
  id: string;
  filename: string;
  storage_path: string;
  uploaded_by: string;
  created_at: string;
}

function mapWorkbookRow(row: AssemblyWorkbookRow): AssemblyWorkbook {
  return {
    id: row.id,
    filename: row.filename,
    storagePath: row.storage_path,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

export interface AssemblyMappingInput {
  label: string;
  cell: string;
}

export interface AssemblyMapping {
  id: string;
  workbookId: string;
  conditionRef: string;
  inputs: AssemblyMappingInput[];
  jobInfoCells: Record<string, string> | null;
  createdAt: string;
}

interface AssemblyMappingRow {
  id: string;
  workbook_id: string;
  condition_ref: string;
  inputs: unknown;
  job_info_cells: unknown;
  created_at: string;
}

function mapMappingRow(row: AssemblyMappingRow): AssemblyMapping {
  return {
    id: row.id,
    workbookId: row.workbook_id,
    conditionRef: row.condition_ref,
    inputs: Array.isArray(row.inputs) ? (row.inputs as AssemblyMappingInput[]) : [],
    jobInfoCells: (row.job_info_cells as Record<string, string> | null) ?? null,
    createdAt: row.created_at,
  };
}

// ── Assembly workbooks (org-wide registry) ─────────────────────────────

export async function createAssemblyWorkbook(params: {
  filename: string;
  storagePath: string;
  uploadedBy: string;
}): Promise<AssemblyWorkbook> {
  const { data, error } = await supabase
    .from('assembly_workbooks')
    .insert({
      filename: params.filename,
      storage_path: params.storagePath,
      uploaded_by: params.uploadedBy,
    })
    .select('*')
    .single();
  if (error) throw wrapDatabaseError('Create assembly workbook', error, { filename: params.filename });
  return mapWorkbookRow(data);
}

export async function listAssemblyWorkbooks(): Promise<AssemblyWorkbook[]> {
  const { data, error } = await supabase
    .from('assembly_workbooks')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw wrapDatabaseError('List assembly workbooks', error);
  return (data || []).map(mapWorkbookRow);
}

export async function getAssemblyWorkbook(id: string): Promise<AssemblyWorkbook | null> {
  const { data, error } = await supabase
    .from('assembly_workbooks')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw wrapDatabaseError('Get assembly workbook', error, { id });
  return data ? mapWorkbookRow(data) : null;
}

/** Cascades to the workbook's mappings (FK ON DELETE CASCADE). */
export async function deleteAssemblyWorkbook(id: string): Promise<void> {
  const { error } = await supabase.from('assembly_workbooks').delete().eq('id', id);
  if (error) throw wrapDatabaseError('Delete assembly workbook', error, { id });
}

// ── Assembly mappings (condition ref -> workbook input cells) ──────────

export async function createAssemblyMapping(params: {
  workbookId: string;
  conditionRef: string;
  inputs: AssemblyMappingInput[];
  jobInfoCells?: Record<string, string> | null;
}): Promise<AssemblyMapping> {
  const { data, error } = await supabase
    .from('assembly_mappings')
    .insert({
      workbook_id: params.workbookId,
      condition_ref: params.conditionRef,
      inputs: params.inputs,
      job_info_cells: params.jobInfoCells ?? null,
    })
    .select('*')
    .single();
  if (error) {
    throw wrapDatabaseError('Create assembly mapping', error, { workbookId: params.workbookId });
  }
  return mapMappingRow(data);
}

export async function listAssemblyMappings(workbookId?: string): Promise<AssemblyMapping[]> {
  let query = supabase.from('assembly_mappings').select('*').order('created_at', { ascending: false });
  if (workbookId) query = query.eq('workbook_id', workbookId);
  const { data, error } = await query;
  if (error) throw wrapDatabaseError('List assembly mappings', error, { workbookId });
  return (data || []).map(mapMappingRow);
}

export async function deleteAssemblyMapping(id: string): Promise<void> {
  const { error } = await supabase.from('assembly_mappings').delete().eq('id', id);
  if (error) throw wrapDatabaseError('Delete assembly mapping', error, { id });
}
