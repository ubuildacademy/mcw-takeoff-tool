/**
 * Database access for the native assembly library (Stage 2, task I1).
 *
 * Mirrors the retired `assemblyRegistryService.ts` (the Stage 1 workbook registry) in
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
  CostDefaults,
  EMPTY_COST_DEFAULTS,
  AssemblyComponent,
  AssemblyComponentRow,
  AssemblyDetail,
  AssemblyQuantityInput,
  AssemblyProductionRateRow,
  AssemblyQuantityInputRow,
  AssemblyRow,
  Margin,
  buildAssemblyDetail,
  mapAssemblyRow,
  mapComponentRow,
  mapMarginChain,
  mapQuantityInputRow,
} from './assemblyLibrary';

export * from './assemblyLibrary';

// ── Organizations ──────────────────────────────────────────────────────

interface Organization {
  id: string;
  name: string;
  createdAt: string;
  /** Assemblies feature gate (upsell switch, system-admin controlled). */
  assembliesEnabled: boolean;
  /** Whether the Costs tab shows MCW's waterproofing/restoration-liability basis
   *  toggle — MCW-specific accounting language, off for every other company. */
  restorationLiabilityEnabled: boolean;
}

type OrgRole = 'company_admin' | 'user';

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
    .select('id, name, created_at, assemblies_enabled, restoration_liability_enabled')
    .eq('id', membership.org_id)
    .maybeSingle();
  if (orgError) throw wrapDatabaseError('Get organization', orgError, { orgId: membership.org_id });
  return org
    ? {
        id: org.id,
        name: org.name,
        createdAt: org.created_at,
        assembliesEnabled: org.assemblies_enabled ?? true,
        restorationLiabilityEnabled: org.restoration_liability_enabled ?? false,
      }
    : null;
}

/** Every company, for the system-admin "Companies" panel — not org-scoped, platform admin only. */
export async function listOrganizations(): Promise<Organization[]> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, created_at, assemblies_enabled, restoration_liability_enabled')
    .order('name');
  if (error) throw wrapDatabaseError('List organizations', error, {});
  return (data ?? []).map((org) => ({
    id: org.id,
    name: org.name,
    createdAt: org.created_at,
    assembliesEnabled: org.assemblies_enabled ?? true,
    restorationLiabilityEnabled: org.restoration_liability_enabled ?? false,
  }));
}

/** Create a company. System admin only — see routes/organizations.ts. */
export async function createOrganization(name: string): Promise<Organization> {
  const { data, error } = await supabase
    .from('organizations')
    .insert({ name })
    .select('id, name, created_at, assemblies_enabled, restoration_liability_enabled')
    .single();
  if (error) throw wrapDatabaseError('Create organization', error, { name });
  return {
    id: data.id,
    name: data.name,
    createdAt: data.created_at,
    assembliesEnabled: data.assemblies_enabled ?? true,
    restorationLiabilityEnabled: data.restoration_liability_enabled ?? false,
  };
}

/** Grant or revoke the assemblies feature for a company (system admin only). */
export async function setAssembliesEnabled(orgId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('organizations')
    .update({ assemblies_enabled: enabled })
    .eq('id', orgId);
  if (error) throw wrapDatabaseError('Set assemblies enabled', error, { orgId, enabled });
}

// ── Report branding ────────────────────────────────────────────────────

interface ReportBrandingRecord {
  companyName: string | null;
  accentColor: string | null;
  logoBase64: string | null;
}

/** White-label settings for this org's Excel exports. No row yet = stock branding. */
export async function getReportBranding(orgId: string): Promise<ReportBrandingRecord> {
  const { data, error } = await supabase
    .from('organization_report_branding')
    .select('company_name, accent_color, logo_base64')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw wrapDatabaseError('Get report branding', error, { orgId });
  return {
    companyName: data?.company_name ?? null,
    accentColor: data?.accent_color ?? null,
    logoBase64: data?.logo_base64 ?? null,
  };
}

interface UpdateReportBrandingParams extends Partial<ReportBrandingRecord> {
  updatedBy?: string | null;
}

export async function setReportBranding(
  orgId: string,
  params: UpdateReportBrandingParams
): Promise<ReportBrandingRecord> {
  const patch: Record<string, unknown> = { org_id: orgId, updated_at: new Date().toISOString() };
  if (params.updatedBy !== undefined) patch.updated_by = params.updatedBy;
  if (params.companyName !== undefined) patch.company_name = params.companyName;
  if (params.accentColor !== undefined) patch.accent_color = params.accentColor;
  if (params.logoBase64 !== undefined) patch.logo_base64 = params.logoBase64;

  const { data, error } = await supabase
    .from('organization_report_branding')
    .upsert(patch, { onConflict: 'org_id' })
    .select('company_name, accent_color, logo_base64')
    .single();
  if (error) throw wrapDatabaseError('Set report branding', error, { orgId });
  return {
    companyName: data.company_name,
    accentColor: data.accent_color,
    logoBase64: data.logo_base64,
  };
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

/** User ids belonging to an org — the scoping filter for company-admin user management (I9). */
export async function listOrgMemberIds(orgId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('org_id', orgId);
  if (error) throw wrapDatabaseError('List org member ids', error, { orgId });
  return (data ?? []).map((row) => row.user_id as string);
}

/** org_role for every member of `orgId`, keyed by user id — one query for a whole user list. */
export async function getOrgRolesByUserId(orgId: string): Promise<Record<string, OrgRole>> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('user_id, org_role')
    .eq('org_id', orgId);
  if (error) throw wrapDatabaseError('Get org roles by user id', error, { orgId });
  const result: Record<string, OrgRole> = {};
  for (const row of data ?? []) result[row.user_id as string] = row.org_role as OrgRole;
  return result;
}

export async function countCompanyAdmins(orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from('organization_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('org_role', 'company_admin');
  if (error) throw wrapDatabaseError('Count company admins', error, { orgId });
  return count ?? 0;
}

/** Promote/demote a member's org_role. Caller (the route) is responsible for the "at least
 *  one company admin remains" check — that is a UX guard, not a data-integrity one, so it
 *  belongs where the error message can be specific. */
export async function setOrgRole(orgId: string, userId: string, orgRole: OrgRole): Promise<void> {
  const { error } = await supabase
    .from('organization_members')
    .update({ org_role: orgRole })
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) throw wrapDatabaseError('Set org role', error, { orgId, userId, orgRole });
}

// ── Company cost defaults ──────────────────────────────────────────────

interface CostDefaultsRow {
  org_id: string;
  day_rate_per_man: number | string | null;
  labor_burden_pct: number | string | null;
  escalation_pct: number | string | null;
  surcharge_pct: number | string | null;
  tax_pct: number | string | null;
  margin_chain: unknown;
  insurance_rate_per_thousand: number | string | null;
  insurance_margin_pct: number | string | null;
  payroll_tax_pct?: number | string | null;
  workers_comp_pct?: number | string | null;
  general_liability_pct?: number | string | null;
  general_liability_restoration_pct?: number | string | null;
  bond_pct?: number | string | null;
  updated_at: string;
}

/**
 * Rates the assembly REPORT posts against, kept apart from `CostDefaults`
 * because they do not affect the price. They carve an already-computed job
 * total into accounting buckets; changing one moves money between columns and
 * never changes what the customer is quoted.
 */
interface AccountingRateDefaults {
  payrollTaxPct: number | null;
  workersCompPct: number | null;
  generalLiabilityPct: number | null;
  generalLiabilityRestorationPct: number | null;
}

/**
 * Bond, kept apart from `CostDefaults` for the same reason as the assembly
 * README explains for insurance not living there wholesale: this rate never
 * reprices an assembly. Unlike insurance, it doesn't even flow through
 * `resolveAssemblyCostSettings` at all — none of MCW's 232 workbooks carry a
 * bond line, so there is no per-assembly value to merge against. It is a
 * project-aggregate rate, applied once in `getProjectCostBreakdown`
 * (measurementSlice.ts) against a project's combined total.
 */
export interface ProjectRateDefaults {
  bondPct: number | null;
}

const EMPTY_PROJECT_RATE_DEFAULTS: ProjectRateDefaults = {
  bondPct: null,
};

export interface CostDefaultsRecord extends CostDefaults, AccountingRateDefaults, ProjectRateDefaults {
  orgId: string;
  updatedAt: string | null;
}

function toNumber(value: number | string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapCostDefaultsRow(row: CostDefaultsRow): CostDefaultsRecord {
  return {
    orgId: row.org_id,
    dayRatePerMan: toNumber(row.day_rate_per_man),
    laborBurdenPct: toNumber(row.labor_burden_pct),
    escalationPct: toNumber(row.escalation_pct),
    surchargePct: toNumber(row.surcharge_pct),
    taxPct: toNumber(row.tax_pct),
    marginChain: mapMarginChain(row.margin_chain),
    insuranceRatePerThousand: toNumber(row.insurance_rate_per_thousand),
    insuranceMarginPct: toNumber(row.insurance_margin_pct),
    payrollTaxPct: toNumber(row.payroll_tax_pct ?? null),
    workersCompPct: toNumber(row.workers_comp_pct ?? null),
    generalLiabilityPct: toNumber(row.general_liability_pct ?? null),
    generalLiabilityRestorationPct: toNumber(row.general_liability_restoration_pct ?? null),
    bondPct: toNumber(row.bond_pct ?? null),
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * What an org with no defaults row falls back to. Nulls, not zeros: a zero
 * payroll-tax rate is a real (if unusual) setting, while null says the rate
 * was never entered and the report should say so rather than post $0 of tax.
 */
const EMPTY_ACCOUNTING_RATES: AccountingRateDefaults = {
  payrollTaxPct: null,
  workersCompPct: null,
  generalLiabilityPct: null,
  generalLiabilityRestorationPct: null,
};

/**
 * The company's costing rates. A company with no row yet inherits nothing —
 * every assembly then relies on its own values, which is exactly how imports
 * behaved before this existed.
 */
export async function getCostDefaults(orgId: string): Promise<CostDefaultsRecord> {
  const { data, error } = await supabase
    .from('organization_cost_defaults')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw wrapDatabaseError('Get cost defaults', error, { orgId });
  if (!data) {
    return {
      orgId,
      ...EMPTY_COST_DEFAULTS,
      ...EMPTY_ACCOUNTING_RATES,
      ...EMPTY_PROJECT_RATE_DEFAULTS,
      updatedAt: null,
    };
  }
  return mapCostDefaultsRow(data as CostDefaultsRow);
}

interface UpdateCostDefaultsParams
  extends Partial<CostDefaults>,
    Partial<AccountingRateDefaults>,
    Partial<ProjectRateDefaults> {
  updatedBy?: string | null;
}

export async function updateCostDefaults(
  orgId: string,
  params: UpdateCostDefaultsParams
): Promise<CostDefaultsRecord> {
  const patch: Record<string, unknown> = { org_id: orgId, updated_at: new Date().toISOString() };
  if (params.updatedBy !== undefined) patch.updated_by = params.updatedBy;
  // Only fields the caller actually sent are written, so a form that edits one
  // rate cannot blank the others.
  if (params.dayRatePerMan !== undefined) patch.day_rate_per_man = params.dayRatePerMan;
  if (params.laborBurdenPct !== undefined) patch.labor_burden_pct = params.laborBurdenPct;
  if (params.escalationPct !== undefined) patch.escalation_pct = params.escalationPct;
  if (params.surchargePct !== undefined) patch.surcharge_pct = params.surchargePct;
  if (params.taxPct !== undefined) patch.tax_pct = params.taxPct;
  if (params.marginChain !== undefined) patch.margin_chain = params.marginChain;
  if (params.insuranceRatePerThousand !== undefined) {
    patch.insurance_rate_per_thousand = params.insuranceRatePerThousand;
  }
  if (params.insuranceMarginPct !== undefined) patch.insurance_margin_pct = params.insuranceMarginPct;
  if (params.payrollTaxPct !== undefined) patch.payroll_tax_pct = params.payrollTaxPct;
  if (params.workersCompPct !== undefined) patch.workers_comp_pct = params.workersCompPct;
  if (params.generalLiabilityPct !== undefined) {
    patch.general_liability_pct = params.generalLiabilityPct;
  }
  if (params.generalLiabilityRestorationPct !== undefined) {
    patch.general_liability_restoration_pct = params.generalLiabilityRestorationPct;
  }
  if (params.bondPct !== undefined) patch.bond_pct = params.bondPct;

  const { data, error } = await supabase
    .from('organization_cost_defaults')
    .upsert(patch, { onConflict: 'org_id' })
    .select('*')
    .single();
  if (error) throw wrapDatabaseError('Update cost defaults', error, { orgId });
  return mapCostDefaultsRow(data as CostDefaultsRow);
}

/** How many assemblies override a given field — what the UI warns about before a change. */
export async function countAssembliesOverriding(orgId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('assemblies')
    .select('day_rate_per_man, labor_burden_pct, escalation_pct, surcharge_pct, tax_pct, margin_chain, insurance_rate_per_thousand, insurance_margin_pct')
    .eq('org_id', orgId);
  if (error) throw wrapDatabaseError('Count overriding assemblies', error, { orgId });

  const counts: Record<string, number> = {
    dayRatePerMan: 0,
    laborBurdenPct: 0,
    escalationPct: 0,
    surchargePct: 0,
    taxPct: 0,
    marginChain: 0,
    insuranceRatePerThousand: 0,
    insuranceMarginPct: 0,
  };
  for (const row of data || []) {
    if (row.day_rate_per_man !== null) counts.dayRatePerMan += 1;
    if (row.labor_burden_pct !== null) counts.laborBurdenPct += 1;
    if (row.escalation_pct !== null) counts.escalationPct += 1;
    if (row.surcharge_pct !== null) counts.surchargePct += 1;
    if (row.tax_pct !== null) counts.taxPct += 1;
    if (Array.isArray(row.margin_chain) && row.margin_chain.length > 0) counts.marginChain += 1;
    if (row.insurance_rate_per_thousand !== null) counts.insuranceRatePerThousand += 1;
    if (row.insurance_margin_pct !== null) counts.insuranceMarginPct += 1;
  }
  return counts;
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

  const [
    { data: inputRows, error: inputError },
    { data: componentRows, error: componentError },
    { data: rateRows, error: rateError },
  ] = await Promise.all([
    supabase.from('assembly_quantity_inputs').select('*').eq('assembly_id', assemblyId),
    supabase.from('assembly_components').select('*').eq('assembly_id', assemblyId),
    supabase.from('assembly_production_rates').select('*').eq('assembly_id', assemblyId),
  ]);
  if (inputError) throw wrapDatabaseError('Get assembly quantity inputs', inputError, { assemblyId });
  if (componentError) throw wrapDatabaseError('Get assembly components', componentError, { assemblyId });
  if (rateError) throw wrapDatabaseError('Get assembly production rates', rateError, { assemblyId });

  return buildAssemblyDetail(
    assemblyRow as AssemblyRow,
    (inputRows || []) as AssemblyQuantityInputRow[],
    (componentRows || []) as AssemblyComponentRow[],
    (rateRows || []) as AssemblyProductionRateRow[]
  );
}

/**
 * Several assemblies with everything needed to price them, in as few round
 * trips as the shape allows.
 *
 * The Costs tab prices every linked condition in a project at once, and a
 * per-assembly `getAssemblyDetail` would be four queries per condition. This
 * is four queries total, regardless of how many assemblies are asked for.
 */
export async function getAssemblyDetails(
  orgId: string,
  assemblyIds: string[]
): Promise<Map<string, AssemblyDetail>> {
  const unique = [...new Set(assemblyIds)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const { data: assemblyRows, error: assemblyError } = await supabase
    .from('assemblies')
    .select('*')
    .eq('org_id', orgId)
    .in('id', unique);
  if (assemblyError) throw wrapDatabaseError('Get assemblies', assemblyError, { orgId });

  // Org filter above is what keeps this from leaking: the child queries are by
  // assembly id, so they must only ever see ids this org actually owns.
  const ownedIds = (assemblyRows || []).map((row: AssemblyRow) => row.id);
  if (ownedIds.length === 0) return new Map();

  const [
    { data: inputRows, error: inputError },
    { data: componentRows, error: componentError },
    { data: rateRows, error: rateError },
  ] = await Promise.all([
    supabase.from('assembly_quantity_inputs').select('*').in('assembly_id', ownedIds),
    supabase.from('assembly_components').select('*').in('assembly_id', ownedIds),
    supabase.from('assembly_production_rates').select('*').in('assembly_id', ownedIds),
  ]);
  if (inputError) throw wrapDatabaseError('Get assembly quantity inputs', inputError, { orgId });
  if (componentError) throw wrapDatabaseError('Get assembly components', componentError, { orgId });
  if (rateError) throw wrapDatabaseError('Get assembly production rates', rateError, { orgId });

  // Group the child rows by assembly once. buildAssemblyDetail filters by assembly_id
  // itself, so handing it the whole result set per assembly re-scanned every input,
  // component and rate row N times over — for a company with a few hundred assemblies
  // that is the bulk of the work in loading the library. Pre-filtered input is
  // identical from its point of view.
  const groupByAssembly = <T extends { assembly_id: string }>(rows: T[]): Map<string, T[]> => {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
      const existing = grouped.get(row.assembly_id);
      if (existing) existing.push(row);
      else grouped.set(row.assembly_id, [row]);
    }
    return grouped;
  };

  const inputsByAssembly = groupByAssembly((inputRows || []) as AssemblyQuantityInputRow[]);
  const componentsByAssembly = groupByAssembly((componentRows || []) as AssemblyComponentRow[]);
  const ratesByAssembly = groupByAssembly((rateRows || []) as AssemblyProductionRateRow[]);

  const details = new Map<string, AssemblyDetail>();
  for (const row of (assemblyRows || []) as AssemblyRow[]) {
    details.set(
      row.id,
      buildAssemblyDetail(
        row,
        inputsByAssembly.get(row.id) || [],
        componentsByAssembly.get(row.id) || [],
        ratesByAssembly.get(row.id) || []
      )
    );
  }
  return details;
}

interface CreateAssemblyParams {
  orgId: string;
  name: string;
  brand?: string | null;
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
      brand: params.brand?.trim() ? params.brand.trim() : null,
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

/**
 * Update an assembly's name and/or brand. Null when the id is not in `orgId`.
 *
 * Only identity fields: the costing fields are what the workbook said, and
 * letting a rename carry them would make a typo fix a repricing.
 */
export async function renameAssembly(
  orgId: string,
  assemblyId: string,
  patch: { name?: string; brand?: string | null }
): Promise<Assembly | null> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.brand !== undefined) {
    update.brand = patch.brand?.trim() ? patch.brand.trim() : null;
  }
  if (Object.keys(update).length === 0) {
    return (await getAssemblyDetail(orgId, assemblyId)) ?? null;
  }

  const { data, error } = await supabase
    .from('assemblies')
    .update(update)
    .eq('org_id', orgId)
    .eq('id', assemblyId)
    .select('*')
    .maybeSingle();
  if (error) throw wrapDatabaseError('Rename assembly', error, { orgId, assemblyId });
  return data ? mapAssemblyRow(data as AssemblyRow) : null;
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

interface CreateQuantityInputParams {
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

interface CreateComponentParams {
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
