/**
 * Pure shaping and integrity rules for the native assembly library (Stage 2).
 *
 * Split out from `assemblyLibraryService.ts` so the rules that protect against
 * the two measured mispricing bugs can be unit-tested without a database:
 *
 *   - the same product code appears more than once in an assembly, at
 *     different yields (a product applied in two coats). Anything that keys or
 *     groups components by product code silently halves the material quantity.
 *   - a component divides ONE of the assembly's named quantity inputs, and
 *     waste % belongs to that input. 74% of the live workbook library has more
 *     than one input.
 *
 * See docs/ASSEMBLIES_DESIGN.md (I0 findings) for the measurements.
 *
 * No cost arithmetic lives here — that is the costing engine's job (task I4).
 */

export interface Margin {
  name: string;
  rate: number;
}

export interface AssemblyQuantityInput {
  id: string;
  assemblyId: string;
  seq: number;
  name: string;
  unit: string | null;
  wastePct: number;
}

export interface AssemblyComponent {
  id: string;
  assemblyId: string;
  seq: number;
  quantityInputId: string | null;
  description: string | null;
  productCode: string | null;
  unitPrice: number | null;
  coverageYield: number | null;
  yieldUnit: string | null;
  packagingUnit: string | null;
  isOptional: boolean;
}

export interface Assembly {
  id: string;
  orgId: string;
  name: string;
  dayRatePerMan: number | null;
  crewSize: number | null;
  laborBurdenPct: number | null;
  escalationPct: number | null;
  surchargePct: number | null;
  taxPct: number | null;
  marginChain: Margin[];
  sourceWorkbookId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An assembly with its inputs and components attached, ordered by `seq`. */
export interface AssemblyDetail extends Assembly {
  quantityInputs: AssemblyQuantityInput[];
  components: AssemblyComponent[];
}

export type IntegrityIssueCode =
  | 'component_without_quantity_input'
  | 'component_without_price_source'
  | 'component_with_conflicting_price_source'
  | 'component_without_yield'
  | 'assembly_without_quantity_inputs'
  | 'quantity_input_unused';

export interface IntegrityIssue {
  code: IntegrityIssueCode;
  /** Component `seq`, or quantity-input `seq`, whichever the issue is about. */
  seq?: number;
  message: string;
}

// ── row mapping ────────────────────────────────────────────────────────

export interface AssemblyRow {
  id: string;
  org_id: string;
  name: string;
  day_rate_per_man: number | string | null;
  crew_size: number | null;
  labor_burden_pct: number | string | null;
  escalation_pct: number | string | null;
  surcharge_pct: number | string | null;
  tax_pct: number | string | null;
  margin_chain: unknown;
  source_workbook_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssemblyQuantityInputRow {
  id: string;
  assembly_id: string;
  seq: number;
  name: string;
  unit: string | null;
  waste_pct: number | string | null;
}

export interface AssemblyComponentRow {
  id: string;
  assembly_id: string;
  seq: number;
  quantity_input_id: string | null;
  description: string | null;
  product_code: string | null;
  unit_price: number | string | null;
  coverage_yield: number | string | null;
  yield_unit: string | null;
  packaging_unit: string | null;
  is_optional: boolean | null;
}

/**
 * Postgres NUMERIC comes back from PostgREST as a string. Everything that
 * feeds the costing engine goes through here so a yield never arrives as
 * `"125"` and silently string-divides downstream.
 */
function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mapMarginChain(raw: unknown): Margin[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({ name: String(entry.name ?? ''), rate: num(entry.rate as number | string) ?? 0 }))
    .filter((margin) => margin.name !== '');
}

export function mapAssemblyRow(row: AssemblyRow): Assembly {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    dayRatePerMan: num(row.day_rate_per_man),
    crewSize: row.crew_size ?? null,
    laborBurdenPct: num(row.labor_burden_pct),
    escalationPct: num(row.escalation_pct),
    surchargePct: num(row.surcharge_pct),
    taxPct: num(row.tax_pct),
    marginChain: mapMarginChain(row.margin_chain),
    sourceWorkbookId: row.source_workbook_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapQuantityInputRow(row: AssemblyQuantityInputRow): AssemblyQuantityInput {
  return {
    id: row.id,
    assemblyId: row.assembly_id,
    seq: row.seq,
    name: row.name,
    unit: row.unit,
    wastePct: num(row.waste_pct) ?? 0,
  };
}

export function mapComponentRow(row: AssemblyComponentRow): AssemblyComponent {
  return {
    id: row.id,
    assemblyId: row.assembly_id,
    seq: row.seq,
    quantityInputId: row.quantity_input_id,
    description: row.description,
    productCode: row.product_code,
    unitPrice: num(row.unit_price),
    coverageYield: num(row.coverage_yield),
    yieldUnit: row.yield_unit,
    packagingUnit: row.packaging_unit,
    isOptional: row.is_optional ?? false,
  };
}

/**
 * Attach inputs and components to an assembly, ordered by `seq`.
 *
 * Components are kept as a flat, ordered list and are NEVER grouped or
 * de-duplicated by product code — two rows with the same code and different
 * yields are two coats of one product and both must survive.
 */
export function buildAssemblyDetail(
  assemblyRow: AssemblyRow,
  inputRows: AssemblyQuantityInputRow[],
  componentRows: AssemblyComponentRow[]
): AssemblyDetail {
  const bySeq = (a: { seq: number }, b: { seq: number }) => a.seq - b.seq;
  return {
    ...mapAssemblyRow(assemblyRow),
    quantityInputs: inputRows
      .filter((row) => row.assembly_id === assemblyRow.id)
      .map(mapQuantityInputRow)
      .sort(bySeq),
    components: componentRows
      .filter((row) => row.assembly_id === assemblyRow.id)
      .map(mapComponentRow)
      .sort(bySeq),
  };
}

/**
 * The waste % a component's quantity is adjusted by — that of the input it
 * divides, not a single assembly-wide figure. Returns null when the component
 * is not bound to an input yet (an import gap, surfaced by
 * `assemblyIntegrityIssues`).
 */
export function wastePctForComponent(
  assembly: AssemblyDetail,
  component: AssemblyComponent
): number | null {
  if (!component.quantityInputId) return null;
  const input = assembly.quantityInputs.find((qi) => qi.id === component.quantityInputId);
  return input ? input.wastePct : null;
}

/** Components bound to a given quantity input, in `seq` order. */
export function componentsForInput(
  assembly: AssemblyDetail,
  quantityInputId: string
): AssemblyComponent[] {
  return assembly.components.filter((c) => c.quantityInputId === quantityInputId);
}

/**
 * Everything that would make this assembly price wrongly or incompletely.
 * Import (task I5) shows these; the costing engine (task I4) refuses to price
 * an assembly that still has any.
 */
export function assemblyIntegrityIssues(assembly: AssemblyDetail): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  if (assembly.quantityInputs.length === 0) {
    issues.push({
      code: 'assembly_without_quantity_inputs',
      message: 'Assembly has no quantity inputs, so nothing drives its component quantities.',
    });
  }

  const inputIds = new Set(assembly.quantityInputs.map((qi) => qi.id));

  for (const component of assembly.components) {
    const label = component.description || component.productCode || `component ${component.seq}`;

    if (!component.quantityInputId || !inputIds.has(component.quantityInputId)) {
      issues.push({
        code: 'component_without_quantity_input',
        seq: component.seq,
        message: `"${label}" is not bound to a quantity input.`,
      });
    }
    if (component.productCode && component.unitPrice !== null) {
      issues.push({
        code: 'component_with_conflicting_price_source',
        seq: component.seq,
        message: `"${label}" has both a product code and a fixed price; it must have exactly one.`,
      });
    }
    if (!component.productCode && component.unitPrice === null) {
      issues.push({
        code: 'component_without_price_source',
        seq: component.seq,
        message: `"${label}" has no product code and no fixed price.`,
      });
    }
    if (component.coverageYield === null || component.coverageYield <= 0) {
      issues.push({
        code: 'component_without_yield',
        seq: component.seq,
        message: `"${label}" has no coverage yield, so its quantity cannot be computed.`,
      });
    }
  }

  for (const input of assembly.quantityInputs) {
    if (componentsForInput(assembly, input.id).length === 0) {
      issues.push({
        code: 'quantity_input_unused',
        seq: input.seq,
        message: `Quantity input "${input.name}" has no components.`,
      });
    }
  }

  return issues;
}
