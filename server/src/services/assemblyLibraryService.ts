/**
 * Database access for the native assembly library (Stage 2, task I1).
 *
 * Mirrors `assemblyRegistryService.ts` (the Stage 1 workbook registry) in
 * shape: typed row mappers, `wrapDatabaseError` on every call, no business
 * logic. The rules that matter — component identity, per-input waste — live in
 * `assemblyLibrary.ts` so they can be tested without a database.
 *
 * Tables come from `server/migrations/create_organizations_and_assembly_engine_tables.sql`.
 * The backend uses the service_role key and so bypasses RLS; the policies in
 * that migration are defence in depth for direct frontend access. Org scoping
 * is therefore enforced HERE, by always filtering on org_id — a missing filter
 * is a cross-tenant leak that RLS will not catch on this path.
 */
import { supabase } from '../supabase';
import { wrapDatabaseError } from '../errors';
import {
  Assembly,
  AssemblyComponent,
  AssemblyComponentRow,
  AssemblyDetail,
  AssemblyQuantityInput,
  AssemblyQuantityInputRow,
  AssemblyRow,
  Margin,
  buildAssemblyDetail,
  mapAssemblyRow,
  mapComponentRow,
  mapQuantityInputRow,
} from './assemblyLibrary';

export * from './assemblyLibrary';

// ── Organizations ──────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export type OrgRole = 'company_admin' | 'user';

export async function getOrganizationForUser(userId: string): Promise<Organization | null> {
  const { data: membership, error: membershipError } = await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (membershipError) {
    throw wrapDatabaseError('Get organization for user', membershipError, { userId });
  }
  if (!membership) return null;

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, name, created_at')
    .eq('id', membership.org_id)
    .maybeSingle();
  if (orgError) throw wrapDatabaseError('Get organization', orgError, { orgId: membership.org_id });
  return org ? { id: org.id, name: org.name, createdAt: org.created_at } : null;
}

export async function getOrgRole(userId: string, orgId: string): Promise<OrgRole | null> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('org_role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw wrapDatabaseError('Get org role', error, { userId, orgId });
  return (data?.org_role as OrgRole | undefined) ?? null;
}

// ── Products ───────────────────────────────────────────────────────────

export interface Product {
  id: string;
  orgId: string;
  code: string;
  item: string | null;
  description: string | null;
  netPrice: number | null;
  priceDate: string | null;
}

interface ProductRow {
  id: string;
  org_id: string;
  code: string;
  item: string | null;
  description: string | null;
  net_price: number | string | null;
  price_date: string | null;
}

function mapProductRow(row: ProductRow): Product {
  const price = row.net_price === null ? null : Number(row.net_price);
  return {
    id: row.id,
    orgId: row.org_id,
    code: row.code,
    item: row.item,
    description: row.description,
    netPrice: price !== null && Number.isFinite(price) ? price : null,
    priceDate: row.price_date,
  };
}

export async function listProducts(orgId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('org_id', orgId)
    .order('code');
  if (error) throw wrapDatabaseError('List products', error, { orgId });
  return (data || []).map(mapProductRow);
}

/**
 * Price lookup for a set of component codes, keyed by code.
 *
 * Codes with no product row are simply absent from the map — "not on the price
 * list" is a normal state (workbooks reference codes before they are imported)
 * and the caller decides whether that is a gap or a hand-priced component.
 */
export async function getProductsByCodes(
  orgId: string,
  codes: string[]
): Promise<Map<string, Product>> {
  const unique = [...new Set(codes.filter((code) => !!code))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('org_id', orgId)
    .in('code', unique);
  if (error) throw wrapDatabaseError('Get products by codes', error, { orgId, count: unique.length });
  return new Map((data || []).map((row: ProductRow) => [row.code, mapProductRow(row)]));
}

// ── Assemblies ─────────────────────────────────────────────────────────

export async function listAssemblies(orgId: string): Promise<Assembly[]> {
  const { data, error } = await supabase
    .from('assemblies')
    .select('*')
    .eq('org_id', orgId)
    .order('name');
  if (error) throw wrapDatabaseError('List assemblies', error, { orgId });
  return (data || []).map((row: AssemblyRow) => mapAssemblyRow(row));
}

/** Assembly with its quantity inputs and components, or null if not in `orgId`. */
export async function getAssemblyDetail(orgId: string, assemblyId: string): Promise<AssemblyDetail | null> {
  const { data: assemblyRow, error: assemblyError } = await supabase
    .from('assemblies')
    .select('*')
    .eq('org_id', orgId)
    .eq('id', assemblyId)
    .maybeSingle();
  if (assemblyError) {
    throw wrapDatabaseError('Get assembly', assemblyError, { orgId, assemblyId });
  }
  if (!assemblyRow) return null;

  const [{ data: inputRows, error: inputError }, { data: componentRows, error: componentError }] =
    await Promise.all([
      supabase.from('assembly_quantity_inputs').select('*').eq('assembly_id', assemblyId),
      supabase.from('assembly_components').select('*').eq('assembly_id', assemblyId),
    ]);
  if (inputError) throw wrapDatabaseError('Get assembly quantity inputs', inputError, { assemblyId });
  if (componentError) throw wrapDatabaseError('Get assembly components', componentError, { assemblyId });

  return buildAssemblyDetail(
    assemblyRow as AssemblyRow,
    (inputRows || []) as AssemblyQuantityInputRow[],
    (componentRows || []) as AssemblyComponentRow[]
  );
}

export interface CreateAssemblyParams {
  orgId: string;
  name: string;
  dayRatePerMan?: number | null;
  crewSize?: number | null;
  laborBurdenPct?: number | null;
  escalationPct?: number | null;
  surchargePct?: number | null;
  taxPct?: number | null;
  marginChain?: Margin[];
  sourceWorkbookId?: string | null;
  notes?: string | null;
}

export async function createAssembly(params: CreateAssemblyParams): Promise<Assembly> {
  const { data, error } = await supabase
    .from('assemblies')
    .insert({
      org_id: params.orgId,
      name: params.name,
      day_rate_per_man: params.dayRatePerMan ?? null,
      crew_size: params.crewSize ?? null,
      labor_burden_pct: params.laborBurdenPct ?? null,
      escalation_pct: params.escalationPct ?? null,
      surcharge_pct: params.surchargePct ?? null,
      tax_pct: params.taxPct ?? null,
      margin_chain: params.marginChain ?? [],
      source_workbook_id: params.sourceWorkbookId ?? null,
      notes: params.notes ?? null,
    })
    .select('*')
    .single();
  if (error) throw wrapDatabaseError('Create assembly', error, { orgId: params.orgId, name: params.name });
  return mapAssemblyRow(data as AssemblyRow);
}

/** Cascades to quantity inputs and components (FK ON DELETE CASCADE). */
export async function deleteAssembly(orgId: string, assemblyId: string): Promise<void> {
  const { error } = await supabase
    .from('assemblies')
    .delete()
    .eq('org_id', orgId)
    .eq('id', assemblyId);
  if (error) throw wrapDatabaseError('Delete assembly', error, { orgId, assemblyId });
}

// ── Quantity inputs ────────────────────────────────────────────────────

export interface CreateQuantityInputParams {
  assemblyId: string;
  seq: number;
  name: string;
  unit?: string | null;
  wastePct?: number;
}

export async function createQuantityInputs(
  inputs: CreateQuantityInputParams[]
): Promise<AssemblyQuantityInput[]> {
  if (inputs.length === 0) return [];
  const { data, error } = await supabase
    .from('assembly_quantity_inputs')
    .insert(
      inputs.map((input) => ({
        assembly_id: input.assemblyId,
        seq: input.seq,
        name: input.name,
        unit: input.unit ?? null,
        waste_pct: input.wastePct ?? 0,
      }))
    )
    .select('*');
  if (error) {
    throw wrapDatabaseError('Create assembly quantity inputs', error, { count: inputs.length });
  }
  return ((data || []) as AssemblyQuantityInputRow[]).map(mapQuantityInputRow);
}

// ── Components ─────────────────────────────────────────────────────────

export interface CreateComponentParams {
  assemblyId: string;
  seq: number;
  quantityInputId?: string | null;
  description?: string | null;
  /** Mutually exclusive with `unitPrice` — enforced by a CHECK constraint. */
  productCode?: string | null;
  unitPrice?: number | null;
  coverageYield?: number | null;
  yieldUnit?: string | null;
  packagingUnit?: string | null;
  isOptional?: boolean;
}

/**
 * Insert components as an ordered batch.
 *
 * `seq` is the component's identity within the assembly. Callers must number
 * rows in source order and must NOT collapse repeated product codes: the same
 * code at two yields is a product applied in two coats, and merging them
 * halves the material quantity.
 */
export async function createComponents(
  components: CreateComponentParams[]
): Promise<AssemblyComponent[]> {
  if (components.length === 0) return [];
  const { data, error } = await supabase
    .from('assembly_components')
    .insert(
      components.map((component) => ({
        assembly_id: component.assemblyId,
        seq: component.seq,
        quantity_input_id: component.quantityInputId ?? null,
        description: component.description ?? null,
        product_code: component.productCode ?? null,
        unit_price: component.unitPrice ?? null,
        coverage_yield: component.coverageYield ?? null,
        yield_unit: component.yieldUnit ?? null,
        packaging_unit: component.packagingUnit ?? null,
        is_optional: component.isOptional ?? false,
      }))
    )
    .select('*');
  if (error) {
    throw wrapDatabaseError('Create assembly components', error, { count: components.length });
  }
  return ((data || []) as AssemblyComponentRow[]).map(mapComponentRow);
}
