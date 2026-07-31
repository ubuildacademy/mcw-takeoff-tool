/**
 * Turning an extracted workbook proposal into insert-ready assembly records
 * (Stage 2, task I5).
 *
 * Pure: no database. The DB writes live in `assemblyImportService.ts`; what is
 * here is the shaping, so the rules that decide *what gets stored* can be
 * tested without Supabase.
 *
 * Two of those rules are the whole point of the task:
 *
 *  - **Store only what differs from the company defaults.** Persisting every
 *    extracted value would freeze 232 copies of the same day rate and make
 *    "raise the day rate" a 232-row edit. See `overridesAgainstDefaults`.
 *  - **Never silently drop a component.** A row the extractor could not fully
 *    resolve is stored with a quantity rule of `manual` and its flags intact,
 *    so it is visible and unpriceable rather than absent and invisible.
 */
import {
  CostDefaults,
  EMPTY_COST_DEFAULTS,
  Margin,
  overridesAgainstDefaults,
} from './assemblyLibrary';

// ── the shape the extractor emits (see assembly_extract.py) ────────────

export interface ProposalQuantityInput {
  seq: number;
  name: string;
  unit: string | null;
  wastePct: number;
  derived?: boolean;
}

export interface ProposalComponent {
  seq: number;
  quantityInputSeq: number | null;
  additionalQuantityInputSeqs?: number[];
  description: string | null;
  productCode: string | null;
  unitPrice: number | null;
  coverageYield: number | null;
  yieldUnit: string | null;
  packagingUnit: string | null;
  isOptional: boolean;
  flags: string[];
}

export interface ProposalProductionRate {
  seq?: number;
  description: string | null;
  ratePerDay: number;
  unit: string | null;
  quantityInputSeq: number | null;
  roundsUp: boolean;
  isOptional?: boolean;
}

export interface AssemblyProposalInput {
  name: string;
  /** Manufacturer / product line. Optional — bulk import sets it from the folder. */
  brand?: string | null;
  sourceFile?: string;
  quantityInputs: ProposalQuantityInput[];
  components: ProposalComponent[];
  productionRates: ProposalProductionRate[];
  dayRatePerMan: number | null;
  crewSize: number | null;
  laborBurdenPct: number | null;
  marginChain: Margin[];
  insuranceRatePerThousand: number | null;
  insuranceMarginPct: number | null;
  escalationPct: number | null;
  surchargePct: number | null;
  taxPct: number | null;
  flags: string[];
}

// ── insert-ready records, keyed by seq until the DB assigns ids ────────

export type QuantityRule = 'coverage_yield' | 'same_as_component' | 'fixed' | 'manual';

export interface AssemblyRecord {
  name: string;
  brand: string | null;
  /** Crew size is per-assembly, never a company default. */
  crewSize: number | null;
  /** Only the fields that differ from the company defaults. */
  overrides: Partial<CostDefaults>;
  importFlags: string[];
}

export interface QuantityInputRecord {
  seq: number;
  name: string;
  unit: string | null;
  wastePct: number;
}

export interface ComponentRecord {
  seq: number;
  quantityInputSeq: number | null;
  additionalQuantityInputSeqs: number[];
  description: string | null;
  productCode: string | null;
  unitPrice: number | null;
  coverageYield: number | null;
  yieldUnit: string | null;
  packagingUnit: string | null;
  isOptional: boolean;
  quantityRule: QuantityRule;
  importFlags: string[];
}

export interface ProductionRateRecord {
  seq: number;
  description: string | null;
  ratePerDay: number | null;
  unit: string | null;
  quantityInputSeq: number | null;
  roundsUp: boolean;
  isOptional: boolean;
}

export interface AssemblyRecords {
  assembly: AssemblyRecord;
  quantityInputs: QuantityInputRecord[];
  components: ComponentRecord[];
  productionRates: ProductionRateRecord[];
  /** Everything that stops this assembly pricing correctly once saved. */
  blockers: string[];
}

/**
 * Which rule drives a component's package count.
 *
 * A component with a usable coverage yield is the normal case. Anything else
 * came from a workbook formula this model does not express — a tape that ships
 * one-to-one with the membrane above it, an initiator counted per pail of
 * another product — and is marked `manual` so it is visibly unpriceable rather
 * than silently costing zero.
 */
export function inferQuantityRule(component: ProposalComponent): QuantityRule {
  if (component.coverageYield !== null && component.coverageYield > 0) return 'coverage_yield';
  return 'manual';
}

/**
 * Reasons this assembly will not price correctly. Surfaced by the review screen
 * before saving, and stored with the assembly afterwards.
 */
export function importBlockers(records: Omit<AssemblyRecords, 'blockers'>): string[] {
  const blockers: string[] = [];
  const inputSeqs = new Set(records.quantityInputs.map((input) => input.seq));

  if (records.quantityInputs.length === 0) {
    blockers.push('No quantity inputs — nothing drives the component quantities.');
  }
  if (records.components.length === 0) {
    blockers.push('No components.');
  }

  for (const component of records.components) {
    const label = component.description || component.productCode || `Component ${component.seq}`;
    if (component.quantityInputSeq === null || !inputSeqs.has(component.quantityInputSeq)) {
      blockers.push(`${label}: not bound to a quantity input.`);
    }
    if (component.quantityRule === 'manual') {
      blockers.push(`${label}: quantity rule needs setting by hand.`);
    }
    if (component.productCode === null && component.unitPrice === null) {
      blockers.push(`${label}: no product code and no price.`);
    }
  }

  return blockers;
}

/**
 * Shape a proposal into records ready for insertion.
 *
 * `defaults` are the company's rates: a field matching them is NOT stored on
 * the assembly, so it keeps inheriting. Pass EMPTY_COST_DEFAULTS to store
 * everything, which is what a company with no defaults yet gets.
 */
export function buildAssemblyRecords(
  proposal: AssemblyProposalInput,
  defaults: CostDefaults = EMPTY_COST_DEFAULTS
): AssemblyRecords {
  const overrides = overridesAgainstDefaults(
    {
      dayRatePerMan: proposal.dayRatePerMan,
      laborBurdenPct: proposal.laborBurdenPct,
      escalationPct: proposal.escalationPct,
      surchargePct: proposal.surchargePct,
      taxPct: proposal.taxPct,
      marginChain: proposal.marginChain,
      insuranceRatePerThousand: proposal.insuranceRatePerThousand,
      insuranceMarginPct: proposal.insuranceMarginPct,
    },
    defaults
  );

  const quantityInputs: QuantityInputRecord[] = proposal.quantityInputs.map((input) => ({
    seq: input.seq,
    name: input.name,
    unit: input.unit,
    wastePct: input.wastePct,
  }));

  const components: ComponentRecord[] = proposal.components.map((component) => ({
    seq: component.seq,
    quantityInputSeq: component.quantityInputSeq,
    additionalQuantityInputSeqs: component.additionalQuantityInputSeqs ?? [],
    description: component.description,
    productCode: component.productCode,
    // The schema's CHECK allows a code or a price, never both. The extractor
    // keeps the code when a workbook's price lookup was flattened to a pasted
    // value, because the product list will reprice it.
    unitPrice: component.productCode ? null : component.unitPrice,
    coverageYield: component.coverageYield,
    yieldUnit: component.yieldUnit,
    packagingUnit: component.packagingUnit,
    isOptional: component.isOptional,
    quantityRule: inferQuantityRule(component),
    importFlags: component.flags ?? [],
  }));

  const productionRates: ProductionRateRecord[] = proposal.productionRates
    // A rate line with no rate paces nothing; the workbooks carry these as
    // empty placeholder rows (Surface Prep at 0 SF/day).
    .filter((rate) => rate.ratePerDay > 0)
    .map((rate, index) => ({
      seq: rate.seq ?? index + 1,
      description: rate.description,
      ratePerDay: rate.ratePerDay,
      unit: rate.unit,
      quantityInputSeq: rate.quantityInputSeq,
      roundsUp: rate.roundsUp,
      isOptional: rate.isOptional ?? false,
    }));

  const brand = (proposal.brand ?? '').trim() || null;

  const withoutBlockers = {
    assembly: {
      name: proposal.name,
      brand,
      crewSize: proposal.crewSize,
      overrides,
      importFlags: proposal.flags ?? [],
    },
    quantityInputs,
    components,
    productionRates,
  };

  return { ...withoutBlockers, blockers: importBlockers(withoutBlockers) };
}
