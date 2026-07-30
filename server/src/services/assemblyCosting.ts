/**
 * Native assembly costing engine (Stage 2, task I4).
 *
 * Pure arithmetic: no database, no I/O. Given an assembly, its components, the
 * prices those components resolve to, and a quantity per named input, it
 * reproduces what the Excel workbook computes.
 *
 * This module is the hard gate of Stage 2. Parsing was already measured as
 * viable (see docs/ASSEMBLIES_DESIGN.md); what was never verified is whether a
 * native engine reproduces MCW's own totals. If it does not, the engine is
 * unusable however good the UI is — so every rule below mirrors a formula read
 * out of a real workbook, and the comments name it.
 *
 * The four rules that are easy to get wrong, in the order they bite:
 *
 *  1. **Waste is per quantity input, not per assembly.** 74% of the library has
 *     several named inputs, each with its own waste %.
 *  2. **Package counts round UP per component line**, not at the end:
 *     `ROUNDUP(adjustedQuantity / coverageYield)`. Rounding the sum instead
 *     under-buys material on almost every line.
 *  3. **Subtotals round up too.** The workbook wraps its material subtotal and
 *     its labor total in ROUNDUP, so the cents it carries forward are not the
 *     cents a naive sum produces.
 *  4. **Margins are divide-through and chained**, never a multiply:
 *     `running = running / (1 - rate)` for each margin in order. `cost x 1.22`
 *     is not `cost / 0.78`, and the gap compounds across Safety, Overhead and
 *     Profit.
 */
import { AssemblyComponent, AssemblyDetail, Margin } from './assemblyLibrary';

/** Excel's ROUNDUP(value, 0) — away from zero, not toward positive infinity. */
export function roundUp(value: number): number {
  return value < 0 ? -Math.ceil(-value) : Math.ceil(value);
}

/** Currency rounding for comparison and display; the engine itself carries full precision. */
export function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface CostingInputs {
  /** Quantity entered per quantity-input id. Missing ids count as zero. */
  quantitiesByInputId: Record<string, number>;
  /** Unit price per product code, from the org's price list. */
  pricesByCode: Record<string, number>;
  /** Include components flagged optional in the source workbook. Defaults to true. */
  includeOptional?: boolean;
  /**
   * Equipment and miscellaneous costs the workbook carries on its own rows
   * (incidentals, sundries, parking). Not parsed from the sheet yet — passed in
   * so the engine's total can be compared against the workbook's.
   */
  equipmentCost?: number;
  miscCost?: number;
}

export interface ComponentCost {
  componentId: string;
  seq: number;
  description: string | null;
  productCode: string | null;
  /** Input quantity after that input's waste %. */
  adjustedQuantity: number;
  coverageYield: number | null;
  /** ROUNDUP(adjustedQuantity / coverageYield) — whole packages. */
  packages: number;
  unitPrice: number | null;
  extendedCost: number;
  included: boolean;
  /** Why this line contributed nothing, when it did not. */
  issue: string | null;
}

export interface MarginStep {
  name: string;
  rate: number;
  /** Running total after this margin is divided through. */
  runningTotal: number;
  /** What this margin added — the workbook shows these as the margin rows. */
  amount: number;
}

export interface CostBreakdown {
  components: ComponentCost[];
  /** ROUNDUP of the summed component lines, as the workbook's material Total row does. */
  materialSubtotal: number;
  escalation: number;
  surcharge: number;
  tax: number;
  /** ROUNDUP(subtotal + escalation + surcharge + tax). */
  materialTotal: number;
  /** Man-days: per-line days rounded up, summed, rounded up again. */
  laborManDays: number;
  /** Calendar days on site: ROUNDUP(manDays / crewSize). */
  jobDurationDays: number;
  laborBase: number;
  laborBurden: number;
  laborTotal: number;
  equipmentCost: number;
  miscCost: number;
  /** Material + labor + equipment + misc, before margins and insurance. */
  costBeforeMargins: number;
  marginSteps: MarginStep[];
  marginsTotal: number;
  /** ROUNDUP(ratePerThousand x costBeforeMargins / 1000). */
  insuranceBase: number;
  /** Insurance after its own divide-through margin. */
  insuranceTotal: number;
  /** ROUNDUP(costBeforeMargins + insuranceTotal + marginsTotal). */
  total: number;
  /** Anything that makes this number untrustworthy. Empty means it can be quoted. */
  issues: string[];
}

/**
 * Apply an ordered margin chain divide-through.
 *
 * From `Aquafin-2K M.xlsx`: the Safety row is `G186-F59`, Overhead is
 * `G187-G186`, Profit is `G188-G187`, where each helper divides the previous
 * running total by `1 - rate`. So each margin's *amount* is the increment it
 * causes, and the margins compound.
 */
export function applyMarginChain(cost: number, chain: Margin[]): MarginStep[] {
  const steps: MarginStep[] = [];
  let running = cost;
  for (const margin of chain) {
    if (!Number.isFinite(margin.rate) || margin.rate <= 0) {
      // A zero or absent margin is a no-op, not a division by one.
      steps.push({ name: margin.name, rate: margin.rate, runningTotal: running, amount: 0 });
      continue;
    }
    if (margin.rate >= 1) {
      // Dividing by zero or a negative would produce an infinite or negative
      // price. Refuse rather than emit a number.
      steps.push({ name: margin.name, rate: margin.rate, runningTotal: running, amount: NaN });
      continue;
    }
    const next = running / (1 - margin.rate);
    steps.push({
      name: margin.name,
      rate: margin.rate,
      runningTotal: next,
      amount: next - running,
    });
    running = next;
  }
  return steps;
}

function componentCost(
  component: AssemblyComponent,
  assembly: AssemblyDetail,
  inputs: CostingInputs
): ComponentCost {
  const includeOptional = inputs.includeOptional ?? true;
  const base: ComponentCost = {
    componentId: component.id,
    seq: component.seq,
    description: component.description,
    productCode: component.productCode,
    adjustedQuantity: 0,
    coverageYield: component.coverageYield,
    packages: 0,
    unitPrice: null,
    extendedCost: 0,
    included: true,
    issue: null,
  };

  if (component.isOptional && !includeOptional) {
    return { ...base, included: false, issue: 'excluded: optional component' };
  }

  // A component usually divides one input, but some divide the SUM of several
  // (a deck area plus the pile-collar area that wraps it). Each contributing
  // input brings its own waste %, so they are adjusted individually and then
  // added — applying one input's waste to the combined figure would be wrong
  // whenever the two differ, which they routinely do (17% vs 5%).
  const inputIds =
    component.additionalQuantityInputIds && component.additionalQuantityInputIds.length > 0
      ? [component.quantityInputId, ...component.additionalQuantityInputIds]
      : [component.quantityInputId];

  const boundInputs = inputIds
    .map((id) => assembly.quantityInputs.find((qi) => qi.id === id))
    .filter((qi): qi is NonNullable<typeof qi> => !!qi);

  if (boundInputs.length === 0) {
    return { ...base, included: false, issue: 'not bound to a quantity input' };
  }

  // Rule 1: the waste that applies is each input's own, not an assembly-wide figure.
  const adjustedQuantity = boundInputs.reduce((sum, input) => {
    const quantity = inputs.quantitiesByInputId[input.id] ?? 0;
    return sum + quantity + quantity * input.wastePct;
  }, 0);

  if (component.coverageYield === null || component.coverageYield <= 0) {
    return { ...base, adjustedQuantity, included: false, issue: 'no coverage yield' };
  }

  // Rule 2: whole packages, rounded up per line.
  const packages = roundUp(adjustedQuantity / component.coverageYield);

  let unitPrice: number | null = null;
  if (component.unitPrice !== null) {
    unitPrice = component.unitPrice;
  } else if (component.productCode) {
    const price = inputs.pricesByCode[component.productCode];
    unitPrice = price === undefined ? null : price;
  }
  if (unitPrice === null) {
    return {
      ...base,
      adjustedQuantity,
      packages,
      included: false,
      issue: component.productCode
        ? `no price on file for ${component.productCode}`
        : 'no price and no product code',
    };
  }

  return {
    ...base,
    adjustedQuantity,
    packages,
    unitPrice,
    extendedCost: packages * unitPrice,
  };
}

/**
 * MAN-days of labor.
 *
 * The workbook lists a production rate per line item, computes days per line as
 * `ROUNDUP(quantity / ratePerDay)`, sums them, and rounds the sum up again.
 * Its own hidden helper labels this figure "man days for job Completion".
 * Lines with a zero or missing rate contribute nothing rather than dividing by
 * zero.
 *
 * Production-rate lines are not yet bound to a specific quantity input by the
 * extractor, so the caller supplies the quantity each rate applies to.
 */
export function computeLaborDays(
  rates: { ratePerDay: number; quantity: number; roundsUp?: boolean }[]
): number {
  let days = 0;
  for (const rate of rates) {
    if (!rate.ratePerDay || rate.ratePerDay <= 0) continue;
    const lineDays = rate.quantity / rate.ratePerDay;
    // Whether a line rounds up to a whole day is a property of the source
    // workbook, not a universal rule. Aquafin wraps each line in ROUNDUP;
    // Henry's Blueskin sheets wrap none and round only this sum. Defaulting
    // either way misprices the other family, so the flag is carried per line
    // and defaults to the majority behaviour.
    days += rate.roundsUp === false ? lineDays : roundUp(lineDays);
  }
  return roundUp(days);
}

/**
 * Calendar days the crew is on site: `ROUNDUP(manDays / crewSize)`.
 *
 * This is the step that is easy to miss, and it is not a rounding detail — it
 * changes the labor bill. `Aquafin-2K M.xlsx` computes labor as
 * `C41 * H181`, where `C41 = dayRate x crewSize` (the crew's cost for one day)
 * and `H181 = ROUNDUP(G179 / D38)` — man-days divided by crew size, labelled
 * in the sheet as "Job Duration is N Days with N Man/Men". Billing
 * `dayRate x crew x manDays` instead would multiply the crew in twice.
 *
 * The ROUNDUP matters on its own: 3 man-days with a crew of 2 bills 2 whole
 * days of a 2-man crew, i.e. 4 man-days, not 3.
 */
export function computeJobDurationDays(manDays: number, crewSize: number): number {
  if (crewSize <= 0) return 0;
  return roundUp(manDays / crewSize);
}

export interface LaborInputs {
  /** One entry per production-rate line, with the quantity that line covers. */
  rates: { ratePerDay: number; quantity: number }[];
}

/**
 * Insurance, which the workbook applies OUTSIDE the margin chain.
 *
 * From the hidden helper block: `I183 = F59/1000` (cost per thousand),
 * `F69 = ROUNDUP(D69 * I183)` where D69 is a dollars-per-thousand rate, and
 * `F71 = F69 / E184` where `E184 = (100 - insuranceMarginPct)/100`. So
 * insurance takes its own divide-through margin and is then added to the job
 * total alongside the margin chain — `F77 = ROUNDUP(F59 + F71 + F66)`.
 */
export interface InsuranceInputs {
  /** Dollars of insurance per $1,000 of cost (the sheet's "Dollars per Thousand"). */
  ratePerThousand: number | null;
  /** Insurance's own margin, as a fraction. */
  marginPct: number | null;
}

/**
 * Full cost breakdown for one assembly at the given quantities.
 *
 * Everything that would make the number wrong is collected in `issues` rather
 * than silently absorbed — an assembly with an unpriced component produces a
 * total AND an issue saying it is incomplete, so a caller can refuse to quote
 * it. Returning a plausible-looking total with a component quietly missing is
 * the failure mode this whole workstream exists to avoid.
 */
export function computeAssemblyCost(
  assembly: AssemblyDetail,
  inputs: CostingInputs,
  labor: LaborInputs = { rates: [] },
  insurance: InsuranceInputs = { ratePerThousand: null, marginPct: null }
): CostBreakdown {
  const issues: string[] = [];

  const components = assembly.components.map((component) =>
    componentCost(component, assembly, inputs)
  );
  for (const component of components) {
    if (!component.included && component.issue && !component.issue.startsWith('excluded:')) {
      issues.push(
        `${component.description || component.productCode || `component ${component.seq}`}: ${component.issue}`
      );
    }
  }

  // Rule 3: the workbook's material Total row is ROUNDUP(SUM(lines)).
  const materialSubtotal = roundUp(
    components.reduce((sum, component) => sum + component.extendedCost, 0)
  );

  const escalation = materialSubtotal * (assembly.escalationPct ?? 0);
  const surcharge = materialSubtotal * (assembly.surchargePct ?? 0);
  // Tax applies to the escalated, surcharged subtotal, not to the raw one.
  const tax = (materialSubtotal + escalation + surcharge) * (assembly.taxPct ?? 0);
  const materialTotal = roundUp(materialSubtotal + escalation + surcharge + tax);

  const laborManDays = computeLaborDays(labor.rates);
  const dayRate = assembly.dayRatePerMan ?? 0;
  const crewSize = assembly.crewSize ?? 0;
  const jobDurationDays = computeJobDurationDays(laborManDays, crewSize);
  // dayRate x crew is the crew's cost for ONE day; multiply by calendar days,
  // never by man-days, or the crew size counts twice.
  const laborBase = dayRate * crewSize * jobDurationDays;
  const laborBurden = laborBase * (assembly.laborBurdenPct ?? 0);
  const laborTotal = roundUp(laborBase + laborBurden);
  if (laborManDays > 0 && (dayRate === 0 || crewSize === 0)) {
    issues.push('labor days computed but the day rate or crew size is missing');
  }

  const equipmentCost = inputs.equipmentCost ?? 0;
  const miscCost = inputs.miscCost ?? 0;
  const costBeforeMargins = materialTotal + laborTotal + equipmentCost + miscCost;

  // Rule 4: divide-through, chained, in order.
  const marginSteps = applyMarginChain(costBeforeMargins, assembly.marginChain);
  for (const step of marginSteps) {
    if (Number.isNaN(step.amount)) {
      issues.push(`margin "${step.name}" has a rate of ${step.rate}, which cannot be applied`);
    }
  }
  const marginsTotal = marginSteps.reduce(
    (sum, step) => sum + (Number.isNaN(step.amount) ? 0 : step.amount),
    0
  );

  if (assembly.marginChain.length === 0) {
    issues.push('assembly has no margin chain');
  }

  // Insurance sits outside the chain: its own base, its own margin, added to
  // the job total alongside the margins.
  let insuranceBase = 0;
  let insuranceTotal = 0;
  if (insurance.ratePerThousand) {
    insuranceBase = roundUp((insurance.ratePerThousand * costBeforeMargins) / 1000);
    const marginPct = insurance.marginPct ?? 0;
    if (marginPct >= 1) {
      issues.push(`insurance margin of ${marginPct} cannot be applied`);
      insuranceTotal = insuranceBase;
    } else {
      insuranceTotal = insuranceBase / (1 - marginPct);
    }
  }

  return {
    components,
    materialSubtotal,
    escalation,
    surcharge,
    tax,
    materialTotal,
    laborManDays,
    jobDurationDays,
    laborBase,
    laborBurden,
    laborTotal,
    equipmentCost,
    miscCost,
    costBeforeMargins,
    marginSteps,
    marginsTotal,
    insuranceBase,
    insuranceTotal,
    total: roundUp(costBeforeMargins + insuranceTotal + marginsTotal),
    issues,
  };
}
