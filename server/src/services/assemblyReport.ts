/**
 * Task I7 — the Material and Labor budget report.
 *
 * This is the deliverable that lets a bid leave Meridian without opening
 * Excel. It reproduces the two sheets MCW's workbooks hand to accounting:
 *
 *   Material Budgets — one purchase line per component:
 *     Product | CostCode | Qty | Amount + Tax | Uom | CostType
 *
 *   Labor budgets — the job total decomposed into posting buckets:
 *     Description | TotalCost | ManDays | $/ManDay | ManHours | Reg. Pay |
 *     $P/R Tax | $W/Comp | $ Labor | Material | Equipment | Misc.Exp |
 *     $G/Liab | OH&P
 *
 * The labor budget is a RECONCILIATION, not a second estimate. Every bucket
 * is carved out of the total the costing engine already produced, and OH&P is
 * whatever is left. That makes it self-checking: the buckets must sum back to
 * the total, and `reconciliationError` says so when they do not.
 *
 * Pure: no database, no formatting. `assemblyReportService` loads and the
 * client renders.
 */

import { roundCents } from './assemblyCosting';
import type { ConditionPricing } from './conditionAssemblyPricing';

/**
 * The accounting rates, which live on the workbook's Labor budgets sheet
 * rather than on ASSEMBLY. Measured 2026-07-30: 11.33 / 7.72 / 12.73 in all
 * 478 workbooks that have the sheet — no exceptions at all.
 */
export interface AccountingRates {
  payrollTaxPct: number;
  workersCompPct: number;
  generalLiabilityPct: number;
}

/**
 * Which liability rate applies. The workbooks carry the note "12.73 for
 * Waterproofing & 5.337 for Restoration"; every one of them uses the
 * waterproofing figure, so that is the default.
 */
export type WorkType = 'waterproofing' | 'restoration';

/** Hours in a working day, as the sheet's `ManHours = ManDays * 8` assumes. */
export const HOURS_PER_MAN_DAY = 8;

/**
 * The workbook writes this constant in the CostType column of every material
 * line. It is an accounting classification, not a computed value.
 */
export const MATERIAL_COST_TYPE = '205';

export interface MaterialBudgetLine {
  /** Component description, as the workbook's Product column. */
  product: string;
  /** The workbook's CostCode column, which holds the product code. */
  costCode: string | null;
  /**
   * Whole packages to buy. The workbooks leave this column EMPTY — it is
   * filled in by hand from the P.O. Meridian knows the number, so it fills it.
   */
  qty: number;
  /** Per-package price including tax, as `unitPrice + unitPrice * taxPct`. */
  amountPlusTax: number;
  /** Packaging, e.g. "5gal/pail" — yield unit and packaging unit joined. */
  uom: string;
  costType: string;
  /** Extended cost for the line, so the sheet can be checked against itself. */
  extendedCost: number;
  /** Set when this line cannot be trusted (no price, no yield). */
  issue: string | null;
}

export interface LaborBudgetRow {
  description: string;
  totalCost: number;
  /**
   * Billed man-days: crew size × calendar days on site. NOT the raw
   * production-rate sum — the workbook's Reg. Pay is `manDays × dayRate` with
   * no crew factor, so the crew has to already be inside this number or the
   * pay comes out short by a factor of the crew.
   */
  manDays: number;
  dayRatePerMan: number;
  manHours: number;
  regularPay: number;
  payrollTax: number;
  workersComp: number;
  /** Regular pay + payroll tax + workers' comp. */
  laborTotal: number;
  material: number;
  equipment: number;
  miscExpense: number;
  generalLiability: number;
  /** The residual: total minus every other bucket. */
  overheadAndProfit: number;
}

export interface AssemblyReport {
  materialLines: MaterialBudgetLine[];
  laborRows: LaborBudgetRow[];
  laborTotals: LaborBudgetRow;
  workType: WorkType;
  rates: AccountingRates;
  /**
   * Buckets minus the job total. Non-zero means the decomposition lost money
   * somewhere and the report must not be filed.
   */
  reconciliationError: number;
  /** Everything carried up from pricing, plus anything found here. */
  warnings: string[];
}

export function ratesForWorkType(
  defaults: {
    payrollTaxPct: number | null;
    workersCompPct: number | null;
    generalLiabilityPct: number | null;
    generalLiabilityRestorationPct: number | null;
  },
  workType: WorkType
): AccountingRates {
  return {
    payrollTaxPct: defaults.payrollTaxPct ?? 0,
    workersCompPct: defaults.workersCompPct ?? 0,
    generalLiabilityPct:
      (workType === 'restoration'
        ? defaults.generalLiabilityRestorationPct
        : defaults.generalLiabilityPct) ?? 0,
  };
}

/** "5gal" + "/pail" → "5gal/pail", skipping whichever part is missing. */
export function formatUom(yieldUnit: string | null, packagingUnit: string | null): string {
  return [yieldUnit, packagingUnit].filter((part) => part && part.trim() !== '').join('');
}

export interface MaterialLineSource {
  description: string | null;
  productCode: string | null;
  yieldUnit: string | null;
  packagingUnit: string | null;
}

/**
 * One material line per priced component, in the order the assembly lists them.
 *
 * Components that contributed nothing are still emitted when they carry an
 * issue — a purchase list that silently omits a line an estimator expected to
 * see is worse than one that shows it flagged at zero.
 */
export function buildMaterialBudget(
  pricings: ConditionPricing[],
  sourcesByComponentId: Map<string, MaterialLineSource>,
  taxPct: number
): MaterialBudgetLine[] {
  const lines: MaterialBudgetLine[] = [];
  for (const pricing of pricings) {
    for (const component of pricing.breakdown.components) {
      if (!component.included && component.extendedCost === 0 && !component.issue) continue;
      const source = sourcesByComponentId.get(component.componentId);
      const unitPrice = component.unitPrice ?? 0;
      lines.push({
        product: component.description || component.productCode || `Line ${component.seq}`,
        costCode: component.productCode,
        qty: component.packages,
        amountPlusTax: roundCents(unitPrice + unitPrice * taxPct),
        uom: formatUom(source?.yieldUnit ?? null, source?.packagingUnit ?? null),
        costType: MATERIAL_COST_TYPE,
        extendedCost: roundCents(component.extendedCost),
        issue: component.issue,
      });
    }
  }
  return lines;
}

export interface PurchaseOrderLine {
  /** Component description, as the workbook's MATERIALS column. */
  product: string;
  /** The workbook's "Product Codes and Cost codes" column. */
  costCode: string | null;
  /** Whole packages to buy, summed across every assembly in the request that uses this product. */
  qty: number;
  /** Packaging, e.g. "5gal/pail". */
  uom: string;
  /** Set when at least one contributing line could not be trusted (no price, no yield). */
  issue: string | null;
}

/**
 * One purchase line per PRODUCT, not per component instance — this is the actual
 * difference from `buildMaterialBudget`. A real P.O. is what gets called in to a
 * supplier: the same primer bought by three different assemblies on the same job is
 * one order for three times the quantity, not three separate lines. Grouped by
 * product code, falling back to description when a component is priced by a fixed
 * literal rather than a Pricing DB lookup (I0 finding 4 — 19 workbooks have no code
 * at all for some lines).
 */
export function buildPurchaseOrderLines(
  pricings: ConditionPricing[],
  sourcesByComponentId: Map<string, MaterialLineSource>
): PurchaseOrderLine[] {
  const byKey = new Map<string, PurchaseOrderLine>();
  for (const pricing of pricings) {
    for (const component of pricing.breakdown.components) {
      if (!component.included && component.extendedCost === 0 && !component.issue) continue;
      const source = sourcesByComponentId.get(component.componentId);
      const key = component.productCode ?? `desc:${component.description ?? component.seq}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.qty += component.packages;
        if (component.issue && !existing.issue) existing.issue = component.issue;
      } else {
        byKey.set(key, {
          product: component.description || component.productCode || `Line ${component.seq}`,
          costCode: component.productCode,
          qty: component.packages,
          uom: formatUom(source?.yieldUnit ?? null, source?.packagingUnit ?? null),
          issue: component.issue,
        });
      }
    }
  }
  return Array.from(byKey.values());
}

/**
 * Decompose one priced condition into the accounting buckets.
 *
 * Material goes in the Material column. The source workbooks read that column
 * from a cell that is empty, so their material cost falls through into the
 * OH&P residual and the Material column reads $0 on every sheet. The job total
 * is identical either way — OH&P is the plug — but posting a real material
 * figure is the point of the column, so it is filled here. Flagged in the docs
 * because it changes what lands in the accounting system.
 */
export function buildLaborRow(
  pricing: ConditionPricing,
  crewSize: number,
  dayRatePerMan: number,
  rates: AccountingRates
): LaborBudgetRow {
  const { breakdown } = pricing;
  const manDays = crewSize * breakdown.jobDurationDays;
  const regularPay = manDays * dayRatePerMan;
  const payrollTax = regularPay * rates.payrollTaxPct;
  const workersComp = regularPay * rates.workersCompPct;
  const laborTotal = regularPay + payrollTax + workersComp;
  const generalLiability = breakdown.total * rates.generalLiabilityPct;
  const material = breakdown.materialTotal;
  const equipment = breakdown.equipmentCost;
  const miscExpense = breakdown.miscCost;

  return {
    description: pricing.assemblyName,
    totalCost: breakdown.total,
    manDays,
    dayRatePerMan,
    manHours: manDays * HOURS_PER_MAN_DAY,
    regularPay,
    payrollTax,
    workersComp,
    laborTotal,
    material,
    equipment,
    miscExpense,
    generalLiability,
    // The plug. Everything the buckets above did not account for is overhead
    // and profit, which is exactly what the workbook's `B9-I9-J9-K9-L9-M9` does.
    overheadAndProfit:
      breakdown.total - laborTotal - material - equipment - miscExpense - generalLiability,
  };
}

/** Column-wise sum, matching the workbook's totals row. */
export function sumLaborRows(rows: LaborBudgetRow[]): LaborBudgetRow {
  const total: LaborBudgetRow = {
    description: 'Total',
    totalCost: 0,
    manDays: 0,
    // A blended day rate would be a made-up number when assemblies differ, and
    // the workbook's totals row leaves the column empty. Zero means "not
    // applicable to a sum", and the renderer omits it.
    dayRatePerMan: 0,
    manHours: 0,
    regularPay: 0,
    payrollTax: 0,
    workersComp: 0,
    laborTotal: 0,
    material: 0,
    equipment: 0,
    miscExpense: 0,
    generalLiability: 0,
    overheadAndProfit: 0,
  };
  for (const row of rows) {
    total.totalCost += row.totalCost;
    total.manDays += row.manDays;
    total.manHours += row.manHours;
    total.regularPay += row.regularPay;
    total.payrollTax += row.payrollTax;
    total.workersComp += row.workersComp;
    total.laborTotal += row.laborTotal;
    total.material += row.material;
    total.equipment += row.equipment;
    total.miscExpense += row.miscExpense;
    total.generalLiability += row.generalLiability;
    total.overheadAndProfit += row.overheadAndProfit;
  }
  return total;
}

export interface BuildReportParams {
  pricings: ConditionPricing[];
  /** Crew size and day rate per assembly id, already resolved against defaults. */
  laborByAssemblyId: Map<string, { crewSize: number; dayRatePerMan: number }>;
  sourcesByComponentId: Map<string, MaterialLineSource>;
  taxPct: number;
  rates: AccountingRates;
  workType: WorkType;
}

export function buildAssemblyReport({
  pricings,
  laborByAssemblyId,
  sourcesByComponentId,
  taxPct,
  rates,
  workType,
}: BuildReportParams): AssemblyReport {
  const materialLines = buildMaterialBudget(pricings, sourcesByComponentId, taxPct);

  const laborRows = pricings.map((pricing) => {
    const labor = laborByAssemblyId.get(pricing.assemblyId);
    return buildLaborRow(pricing, labor?.crewSize ?? 0, labor?.dayRatePerMan ?? 0, rates);
  });
  const laborTotals = sumLaborRows(laborRows);

  const warnings: string[] = [];
  for (const pricing of pricings) {
    for (const warning of pricing.warnings) {
      warnings.push(`${pricing.assemblyName}: ${warning}`);
    }
  }

  // The buckets are carved out of the total, so this can only be non-zero if
  // the arithmetic above is wrong. Checked rather than assumed, because a
  // report that does not add up must not reach an accounting system.
  const bucketSum =
    laborTotals.laborTotal +
    laborTotals.material +
    laborTotals.equipment +
    laborTotals.miscExpense +
    laborTotals.generalLiability +
    laborTotals.overheadAndProfit;
  // `+ 0` collapses negative zero, which float subtraction produces whenever
  // the buckets land exactly on the total. Left alone it renders as "-0.00".
  const reconciliationError = roundCents(bucketSum - laborTotals.totalCost) + 0;
  if (reconciliationError !== 0) {
    warnings.push(
      `Budget buckets do not sum to the job total (off by ${reconciliationError.toFixed(2)}). Do not file this report.`
    );
  }

  // A negative residual means the buckets have eaten more than the job is
  // worth — a real possibility when general liability is charged on a total
  // that carries little margin, and an estimator needs to see it.
  if (laborTotals.overheadAndProfit < 0) {
    warnings.push(
      'Overhead & profit is negative: the accounting buckets exceed the job total. Check the margin chain and liability rate.'
    );
  }

  return {
    materialLines,
    laborRows,
    laborTotals,
    workType,
    rates,
    reconciliationError,
    warnings,
  };
}
