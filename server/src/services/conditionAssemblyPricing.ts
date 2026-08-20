/**
 * Task I6 — price a takeoff condition through its linked assembly.
 *
 * The condition supplies ONE named quantity input's value, measured live. The
 * assembly supplies everything else: which components that input drives, their
 * yields and prices, the production rates that pace the labor, and the rates it
 * inherits from the company.
 *
 * The hard part is not the arithmetic — task I4's engine already does that and
 * is proven against 144 of MCW's workbooks. The hard part is what happens to
 * the assembly's OTHER inputs, which no condition is feeding. Their components
 * price at zero. A total that quietly omits a third of an assembly is exactly
 * the failure this workstream exists to prevent, so every unfed input is named
 * and counted here and shown in the UI beside the number.
 *
 * Pure: no database, no network. The service layer loads, this shapes.
 */

import {
  computeAssemblyCost,
  type CostBreakdown,
  type LaborInputs,
} from './assemblyCosting';
import type { AssemblyDetail, CostDefaults } from './assemblyLibrary';

/** An input the assembly prices against that no condition is feeding. */
interface UnfedInput {
  id: string;
  name: string;
  unit: string | null;
  /** How many components price at zero because of it. */
  componentCount: number;
}

export interface ConditionPricingRequest {
  /** The condition being priced — echoed back so a batch can be matched up. */
  conditionId: string;
  /** Which of the assembly's named inputs the takeoff quantity feeds. */
  quantityInputId: string;
  /** Live takeoff quantity, already carrying the condition's own waste/multiplier. */
  quantity: number;
}

export interface ConditionPricing {
  conditionId: string;
  assemblyId: string;
  assemblyName: string;
  quantityInputId: string;
  quantityInputName: string | null;
  quantity: number;
  breakdown: CostBreakdown;
  unfedInputs: UnfedInput[];
  /**
   * Everything that makes this number not quotable — the engine's own issues
   * plus the unfed inputs. Empty means the total stands on its own.
   */
  warnings: string[];
}

/**
 * Bind each production-rate line to the quantity it paces.
 *
 * A rate bound to the fed input paces the measured quantity. A rate bound to
 * an unfed input paces zero, which is correct — nobody is doing that work in
 * this condition. A rate bound to NO input at all is the interesting case: the
 * extractor could not tell which input it belongs to, and assuming it paces
 * the fed quantity would invent labor. It contributes zero and is warned about.
 */
export function bindProductionRates(
  assembly: AssemblyDetail,
  quantitiesByInputId: Record<string, number>
): { labor: LaborInputs; unboundRateCount: number } {
  const rates: LaborInputs['rates'] = [];
  let unboundRateCount = 0;

  for (const rate of assembly.productionRates) {
    if (rate.ratePerDay === null || rate.ratePerDay <= 0) continue;
    if (!rate.quantityInputId) {
      unboundRateCount += 1;
      continue;
    }
    const quantity = quantitiesByInputId[rate.quantityInputId] ?? 0;
    if (quantity <= 0) continue;
    rates.push({ ratePerDay: rate.ratePerDay, quantity, roundsUp: rate.roundsUp });
  }

  return { labor: { rates }, unboundRateCount };
}

/** Inputs with components attached that this request leaves at zero. */
export function findUnfedInputs(
  assembly: AssemblyDetail,
  quantitiesByInputId: Record<string, number>
): UnfedInput[] {
  const unfed: UnfedInput[] = [];
  for (const input of assembly.quantityInputs) {
    if ((quantitiesByInputId[input.id] ?? 0) > 0) continue;
    const componentCount = assembly.components.filter(
      (component) =>
        component.quantityInputId === input.id ||
        (component.additionalQuantityInputIds ?? []).includes(input.id)
    ).length;
    // An input with no components attached costs nothing when unfed, so it is
    // not worth alarming anyone about.
    if (componentCount === 0) continue;
    unfed.push({
      id: input.id,
      name: input.name,
      unit: input.unit,
      componentCount,
    });
  }
  return unfed;
}

interface PriceConditionParams {
  assembly: AssemblyDetail;
  request: ConditionPricingRequest;
  /** Unit price per product code, from the org's imported price list. */
  pricesByCode: Record<string, number>;
  costDefaults: CostDefaults;
}

export function priceCondition({
  assembly,
  request,
  pricesByCode,
  costDefaults,
}: PriceConditionParams): ConditionPricing {
  const input = assembly.quantityInputs.find((qi) => qi.id === request.quantityInputId);

  // A quantity of zero is legitimate — a condition with no measurements yet.
  // A NEGATIVE one is not, and would flow through the engine into a negative
  // package count, so it is clamped and warned about rather than priced.
  const quantity = Number.isFinite(request.quantity) ? Math.max(0, request.quantity) : 0;
  const quantitiesByInputId: Record<string, number> = { [request.quantityInputId]: quantity };

  const { labor, unboundRateCount } = bindProductionRates(assembly, quantitiesByInputId);

  const breakdown = computeAssemblyCost(
    assembly,
    { quantitiesByInputId, pricesByCode, costDefaults },
    labor
  );

  const unfedInputs = findUnfedInputs(assembly, quantitiesByInputId);

  const warnings: string[] = [];
  if (!input) {
    warnings.push(
      'This condition points at a quantity input that is no longer part of the assembly. Re-link it.'
    );
  }
  if (request.quantity < 0) {
    warnings.push('Takeoff quantity was negative and has been treated as zero.');
  }
  for (const unfedInput of unfedInputs) {
    warnings.push(
      `"${unfedInput.name}" is not measured by any condition, so its ${unfedInput.componentCount} component${
        unfedInput.componentCount === 1 ? '' : 's'
      } price at $0.`
    );
  }
  if (unboundRateCount > 0) {
    warnings.push(
      `${unboundRateCount} production rate${unboundRateCount === 1 ? '' : 's'} could not be matched to a quantity, so that labor is not counted.`
    );
  }
  warnings.push(...breakdown.issues);

  return {
    conditionId: request.conditionId,
    assemblyId: assembly.id,
    assemblyName: assembly.name,
    quantityInputId: request.quantityInputId,
    quantityInputName: input ? input.name : null,
    quantity,
    breakdown,
    unfedInputs,
    warnings,
  };
}

interface ProjectAssemblyTotals {
  /** Sum of every priced condition's quotable total. */
  total: number;
  materialTotal: number;
  laborTotal: number;
  marginsTotal: number;
  insuranceTotal: number;
  conditionCount: number;
  /** Conditions whose price carries at least one warning. */
  conditionsWithWarnings: number;
}

/**
 * Roll several priced conditions into a project figure.
 *
 * Summing per-condition totals is deliberate: each assembly carries its own
 * margin chain and insurance, so there is no single chain to apply once at the
 * project level. This matches how the estimator bids today — one workbook per
 * scope, totals added at the end.
 */
export function sumConditionPricing(pricings: ConditionPricing[]): ProjectAssemblyTotals {
  const totals: ProjectAssemblyTotals = {
    total: 0,
    materialTotal: 0,
    laborTotal: 0,
    marginsTotal: 0,
    insuranceTotal: 0,
    conditionCount: pricings.length,
    conditionsWithWarnings: 0,
  };
  for (const pricing of pricings) {
    totals.total += pricing.breakdown.total;
    totals.materialTotal += pricing.breakdown.materialTotal;
    totals.laborTotal += pricing.breakdown.laborTotal;
    totals.marginsTotal += pricing.breakdown.marginsTotal;
    totals.insuranceTotal += pricing.breakdown.insuranceTotal;
    if (pricing.warnings.length > 0) totals.conditionsWithWarnings += 1;
  }
  return totals;
}
