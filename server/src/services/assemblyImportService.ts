/**
 * Saving an extracted workbook proposal as a native assembly (Stage 2, task I5).
 *
 * The shaping — what gets stored, what inherits, what blocks — is in
 * `assemblyImport.ts` and tested without a database. This module does the
 * writes, whose only real complexity is ORDER: components and production rates
 * reference quantity inputs by id, but a proposal references them by `seq`, so
 * inputs must be inserted first and their ids mapped back.
 *
 * Postgres has no transaction across separate PostgREST calls, so a failure
 * part-way through would leave an assembly with inputs but no components. Every
 * write path therefore deletes the assembly on failure — a half-imported
 * assembly that looked complete would be worse than none, since it would price.
 */
import { supabase } from '../supabase';
import { wrapDatabaseError } from '../errors';
import { devLog } from '../lib/devLog';
import { CostDefaults } from './assemblyLibrary';
import {
  AssemblyProposalInput,
  AssemblyRecords,
  buildAssemblyRecords,
} from './assemblyImport';
import { getCostDefaults } from './assemblyLibraryService';

export interface ImportedAssemblySummary {
  id: string;
  name: string;
  componentCount: number;
  quantityInputCount: number;
  productionRateCount: number;
  /** Fields stored because they differ from the company defaults. */
  overriddenFields: string[];
  /** Why this assembly cannot price yet. Empty means it is ready. */
  blockers: string[];
}

async function insertQuantityInputs(
  assemblyId: string,
  records: AssemblyRecords
): Promise<Map<number, string>> {
  if (records.quantityInputs.length === 0) return new Map();
  const { data, error } = await supabase
    .from('assembly_quantity_inputs')
    .insert(
      records.quantityInputs.map((input) => ({
        assembly_id: assemblyId,
        seq: input.seq,
        name: input.name,
        unit: input.unit,
        waste_pct: input.wastePct,
      }))
    )
    .select('id, seq');
  if (error) throw wrapDatabaseError('Insert quantity inputs', error, { assemblyId });
  return new Map((data || []).map((row: { id: string; seq: number }) => [row.seq, row.id]));
}

async function insertComponents(
  assemblyId: string,
  records: AssemblyRecords,
  inputIdBySeq: Map<number, string>
): Promise<void> {
  if (records.components.length === 0) return;
  const { error } = await supabase.from('assembly_components').insert(
    records.components.map((component) => ({
      assembly_id: assemblyId,
      seq: component.seq,
      quantity_input_id:
        component.quantityInputSeq === null
          ? null
          : (inputIdBySeq.get(component.quantityInputSeq) ?? null),
      additional_quantity_input_ids: component.additionalQuantityInputSeqs
        .map((seq) => inputIdBySeq.get(seq))
        .filter((id): id is string => !!id),
      description: component.description,
      product_code: component.productCode,
      unit_price: component.unitPrice,
      coverage_yield: component.coverageYield,
      yield_unit: component.yieldUnit,
      packaging_unit: component.packagingUnit,
      is_optional: component.isOptional,
      quantity_rule: component.quantityRule,
      import_flags: component.importFlags,
    }))
  );
  if (error) throw wrapDatabaseError('Insert components', error, { assemblyId });
}

async function insertProductionRates(
  assemblyId: string,
  records: AssemblyRecords,
  inputIdBySeq: Map<number, string>
): Promise<void> {
  if (records.productionRates.length === 0) return;
  const { error } = await supabase.from('assembly_production_rates').insert(
    records.productionRates.map((rate) => ({
      assembly_id: assemblyId,
      seq: rate.seq,
      description: rate.description,
      rate_per_day: rate.ratePerDay,
      unit: rate.unit,
      quantity_input_id:
        rate.quantityInputSeq === null ? null : (inputIdBySeq.get(rate.quantityInputSeq) ?? null),
      rounds_up: rate.roundsUp,
      is_optional: rate.isOptional,
    }))
  );
  if (error) throw wrapDatabaseError('Insert production rates', error, { assemblyId });
}

/**
 * Save a proposal as an assembly.
 *
 * `defaults` are read from the org unless supplied. A field matching them is
 * not written, so the assembly keeps inheriting and a later change to the
 * company rate reaches it.
 */
export async function saveAssemblyFromProposal(
  orgId: string,
  proposal: AssemblyProposalInput,
  options: { sourceWorkbookId?: string | null; defaults?: CostDefaults } = {}
): Promise<ImportedAssemblySummary> {
  const defaults = options.defaults ?? (await getCostDefaults(orgId));
  const records = buildAssemblyRecords(proposal, defaults);
  const { overrides } = records.assembly;

  const { data: assemblyRow, error: assemblyError } = await supabase
    .from('assemblies')
    .insert({
      org_id: orgId,
      name: records.assembly.name,
      crew_size: records.assembly.crewSize,
      // Only overrides are written; everything else stays NULL and inherits.
      day_rate_per_man: overrides.dayRatePerMan ?? null,
      labor_burden_pct: overrides.laborBurdenPct ?? null,
      escalation_pct: overrides.escalationPct ?? null,
      surcharge_pct: overrides.surchargePct ?? null,
      tax_pct: overrides.taxPct ?? null,
      margin_chain: overrides.marginChain ?? [],
      insurance_rate_per_thousand: overrides.insuranceRatePerThousand ?? null,
      insurance_margin_pct: overrides.insuranceMarginPct ?? null,
      source_workbook_id: options.sourceWorkbookId ?? null,
      import_flags: records.assembly.importFlags,
      imported_at: new Date().toISOString(),
    })
    .select('id, name')
    .single();
  if (assemblyError) {
    throw wrapDatabaseError('Insert assembly', assemblyError, { orgId, name: proposal.name });
  }

  const assemblyId = assemblyRow.id as string;

  try {
    const inputIdBySeq = await insertQuantityInputs(assemblyId, records);
    await insertComponents(assemblyId, records, inputIdBySeq);
    await insertProductionRates(assemblyId, records, inputIdBySeq);
  } catch (error) {
    // No cross-call transaction: roll back by hand rather than leave a
    // half-built assembly that would price as though it were complete.
    await supabase.from('assemblies').delete().eq('id', assemblyId);
    throw error;
  }

  devLog(
    `📐 Imported assembly "${records.assembly.name}": ${records.components.length} component(s), ` +
      `${records.quantityInputs.length} input(s), ${records.blockers.length} blocker(s)`
  );

  return {
    id: assemblyId,
    name: assemblyRow.name as string,
    componentCount: records.components.length,
    quantityInputCount: records.quantityInputs.length,
    productionRateCount: records.productionRates.length,
    overriddenFields: Object.keys(overrides),
    blockers: records.blockers,
  };
}

/** Preview what saving would produce, without writing. Drives the review screen. */
export async function previewAssemblyImport(
  orgId: string,
  proposal: AssemblyProposalInput
): Promise<AssemblyRecords & { defaults: CostDefaults }> {
  const defaults = await getCostDefaults(orgId);
  return { ...buildAssemblyRecords(proposal, defaults), defaults };
}
