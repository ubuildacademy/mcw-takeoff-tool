/**
 * Material / Labor budget report (task I7).
 *
 * The labor budget carves an already-computed job total into accounting
 * buckets, so the test that matters is that the buckets add back up to the
 * total — for one assembly, for several, and when the numbers are ugly.
 * Everything else here pins a column shape that a real accounting import
 * depends on.
 *
 * Column semantics were read from `Neogard Auto Gard FC.xlsx` and confirmed
 * against `Aquafin-2K M.xlsx`; the rates from all 478 workbooks that carry a
 * Labor budgets sheet.
 */
import { describe, it, expect } from 'vitest';
import {
  buildAssemblyReport,
  buildLaborRow,
  buildMaterialBudget,
  buildPurchaseOrderLines,
  formatUom,
  ratesForWorkType,
  sumLaborRows,
  HOURS_PER_MAN_DAY,
  MATERIAL_COST_TYPE,
  type AccountingRates,
  type MaterialLineSource,
} from './assemblyReport';
import type { ConditionPricing } from './conditionAssemblyPricing';
import { roundCents } from './assemblyCosting';

const RATES: AccountingRates = {
  payrollTaxPct: 0.1133,
  workersCompPct: 0.0772,
  generalLiabilityPct: 0.1273,
};

function pricing(overrides: Partial<ConditionPricing> = {}): ConditionPricing {
  const breakdown = {
    components: [],
    materialSubtotal: 1000,
    escalation: 0,
    surcharge: 0,
    tax: 0,
    materialTotal: 1000,
    laborManDays: 4,
    jobDurationDays: 2,
    laborBase: 896,
    laborBurden: 313.6,
    laborTotal: 1210,
    equipmentCost: 0,
    miscCost: 0,
    costBeforeMargins: 2210,
    marginSteps: [],
    marginsTotal: 790,
    insuranceBase: 0,
    insuranceTotal: 0,
    total: 3000,
    issues: [],
    ...(overrides.breakdown ?? {}),
  } as ConditionPricing['breakdown'];

  return {
    conditionId: 'cond-1',
    assemblyId: 'asm-1',
    assemblyName: 'Aquafin-2K M',
    quantityInputId: 'input-1',
    quantityInputName: 'SF-Floor',
    quantity: 1000,
    unfedInputs: [],
    warnings: [],
    ...overrides,
    breakdown,
  };
}

function component(overrides: Record<string, unknown> = {}) {
  return {
    componentId: 'component-1',
    seq: 1,
    description: 'Aquafin 2K/M Standard gray',
    productCode: '1000',
    adjustedQuantity: 1000,
    packages: 10,
    unitPrice: 210.51,
    extendedCost: 2105.1,
    included: true,
    issue: null,
    ...overrides,
  };
}

describe('ratesForWorkType', () => {
  const defaults = {
    payrollTaxPct: 0.1133,
    workersCompPct: 0.0772,
    generalLiabilityPct: 0.1273,
    generalLiabilityRestorationPct: 0.05337,
  };

  it('uses the waterproofing liability rate by default', () => {
    expect(ratesForWorkType(defaults, 'waterproofing').generalLiabilityPct).toBe(0.1273);
  });

  it('swaps in the restoration rate when asked', () => {
    expect(ratesForWorkType(defaults, 'restoration').generalLiabilityPct).toBe(0.05337);
  });

  it('treats an unset rate as zero rather than crashing the report', () => {
    const empty = {
      payrollTaxPct: null,
      workersCompPct: null,
      generalLiabilityPct: null,
      generalLiabilityRestorationPct: null,
    };
    expect(ratesForWorkType(empty, 'waterproofing')).toEqual({
      payrollTaxPct: 0,
      workersCompPct: 0,
      generalLiabilityPct: 0,
    });
  });
});

describe('formatUom', () => {
  it('joins yield and packaging as the workbook CONCATENATEs them', () => {
    expect(formatUom('5gal', '/pail')).toBe('5gal/pail');
    expect(formatUom('77lb', '/bag')).toBe('77lb/bag');
  });

  it('drops a missing half instead of leaving a stray separator', () => {
    expect(formatUom('5gal', null)).toBe('5gal');
    expect(formatUom(null, '/pail')).toBe('/pail');
    expect(formatUom(null, null)).toBe('');
  });
});

describe('buildMaterialBudget', () => {
  const sources = new Map<string, MaterialLineSource>([
    [
      'component-1',
      { description: null, productCode: '1000', yieldUnit: '77lb', packagingUnit: '/bag' },
    ],
  ]);

  it('emits one purchase line per component in the workbook’s column order', () => {
    const priced = pricing({
      breakdown: { components: [component()] } as ConditionPricing['breakdown'],
    });
    const [line] = buildMaterialBudget([priced], sources, 0.07);
    expect(line.product).toBe('Aquafin 2K/M Standard gray');
    expect(line.costCode).toBe('1000');
    expect(line.uom).toBe('77lb/bag');
    expect(line.costType).toBe(MATERIAL_COST_TYPE);
  });

  it('fills the Qty column the workbooks leave empty', () => {
    const priced = pricing({
      breakdown: { components: [component({ packages: 14 })] } as ConditionPricing['breakdown'],
    });
    expect(buildMaterialBudget([priced], sources, 0.07)[0].qty).toBe(14);
  });

  it('taxes the unit price, as `price + price * tax`', () => {
    const priced = pricing({
      breakdown: { components: [component({ unitPrice: 100 })] } as ConditionPricing['breakdown'],
    });
    expect(buildMaterialBudget([priced], sources, 0.07)[0].amountPlusTax).toBe(107);
  });

  it('keeps a flagged component visible rather than dropping it from the buy list', () => {
    const priced = pricing({
      breakdown: {
        components: [
          component({ included: false, extendedCost: 0, issue: 'no price for code 1000' }),
        ],
      } as ConditionPricing['breakdown'],
    });
    const lines = buildMaterialBudget([priced], sources, 0.07);
    expect(lines).toHaveLength(1);
    expect(lines[0].issue).toBe('no price for code 1000');
  });

  it('omits a component that contributed nothing and had nothing wrong', () => {
    const priced = pricing({
      breakdown: {
        components: [component({ included: false, extendedCost: 0, issue: null })],
      } as ConditionPricing['breakdown'],
    });
    expect(buildMaterialBudget([priced], sources, 0.07)).toHaveLength(0);
  });
});

describe('buildPurchaseOrderLines', () => {
  const sources = new Map<string, MaterialLineSource>([
    [
      'component-1',
      { description: null, productCode: '1000', yieldUnit: '77lb', packagingUnit: '/bag' },
    ],
  ]);

  it('sums quantity across every assembly in the project that buys the same product', () => {
    // Two different conditions (different assemblies), same product code — the
    // whole point of a consolidated P.O. over the per-assembly workbook shape.
    const priced1 = pricing({
      conditionId: 'cond-1',
      breakdown: { components: [component({ packages: 10 })] } as ConditionPricing['breakdown'],
    });
    const priced2 = pricing({
      conditionId: 'cond-2',
      assemblyId: 'asm-2',
      breakdown: { components: [component({ packages: 4 })] } as ConditionPricing['breakdown'],
    });
    const lines = buildPurchaseOrderLines([priced1, priced2], sources);
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(14);
    expect(lines[0].costCode).toBe('1000');
    expect(lines[0].uom).toBe('77lb/bag');
  });

  it('keeps two different products as separate lines', () => {
    const priced = pricing({
      breakdown: {
        components: [
          component({ componentId: 'component-1', productCode: '1000', packages: 10 }),
          component({ componentId: 'component-2', productCode: '2000', description: 'Primer', packages: 3 }),
        ],
      } as ConditionPricing['breakdown'],
    });
    const lines = buildPurchaseOrderLines([priced], sources);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.qty)).toEqual([10, 3]);
  });

  it('falls back to description when a component has no product code, without merging unrelated fixed-price lines', () => {
    const priced = pricing({
      breakdown: {
        components: [
          component({ componentId: 'component-1', productCode: null, description: 'Hand-priced sundry A', packages: 2 }),
          component({ componentId: 'component-2', productCode: null, description: 'Hand-priced sundry B', packages: 5 }),
        ],
      } as ConditionPricing['breakdown'],
    });
    const lines = buildPurchaseOrderLines([priced], sources);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.product)).toEqual(['Hand-priced sundry A', 'Hand-priced sundry B']);
  });

  it('never carries price — the P.O. leaves it blank like the source workbooks', () => {
    const priced = pricing({
      breakdown: { components: [component()] } as ConditionPricing['breakdown'],
    });
    const [line] = buildPurchaseOrderLines([priced], sources);
    expect(line).not.toHaveProperty('amountPlusTax');
    expect(line).not.toHaveProperty('unitPrice');
  });

  it('surfaces an issue from any contributing line', () => {
    const priced = pricing({
      breakdown: {
        components: [
          component({ packages: 10, issue: null }),
        ],
      } as ConditionPricing['breakdown'],
    });
    const flagged = pricing({
      conditionId: 'cond-2',
      breakdown: {
        components: [
          component({ packages: 0, included: false, issue: 'no price for code 1000' }),
        ],
      } as ConditionPricing['breakdown'],
    });
    const lines = buildPurchaseOrderLines([priced, flagged], sources);
    expect(lines).toHaveLength(1);
    expect(lines[0].issue).toBe('no price for code 1000');
  });

  it('omits a component that contributed nothing and had nothing wrong', () => {
    const priced = pricing({
      breakdown: {
        components: [component({ included: false, extendedCost: 0, packages: 0, issue: null })],
      } as ConditionPricing['breakdown'],
    });
    expect(buildPurchaseOrderLines([priced], sources)).toHaveLength(0);
  });
});

describe('buildLaborRow', () => {
  it('bills crew x calendar days, not the raw production-rate man-days', () => {
    // The sheet's Reg. Pay is manDays * dayRate with no crew factor, so the
    // crew has to already be inside manDays or the pay comes out short.
    const row = buildLaborRow(pricing(), 2, 224, RATES);
    expect(row.manDays).toBe(4); // crew 2 x 2 calendar days
    expect(row.regularPay).toBe(896);
    expect(row.manHours).toBe(4 * HOURS_PER_MAN_DAY);
  });

  it('takes payroll tax and workers comp off regular pay', () => {
    const row = buildLaborRow(pricing(), 2, 224, RATES);
    expect(roundCents(row.payrollTax)).toBe(roundCents(896 * 0.1133));
    expect(roundCents(row.workersComp)).toBe(roundCents(896 * 0.0772));
    expect(roundCents(row.laborTotal)).toBe(
      roundCents(896 + 896 * 0.1133 + 896 * 0.0772)
    );
  });

  it('charges general liability on the JOB TOTAL, not on pay', () => {
    const row = buildLaborRow(pricing(), 2, 224, RATES);
    expect(roundCents(row.generalLiability)).toBe(roundCents(3000 * 0.1273));
  });

  it('puts material in the Material column, which the workbooks leave at zero', () => {
    const row = buildLaborRow(pricing(), 2, 224, RATES);
    expect(row.material).toBe(1000);
  });

  it('makes overhead and profit the residual', () => {
    const row = buildLaborRow(pricing(), 2, 224, RATES);
    const expected =
      3000 - row.laborTotal - row.material - row.equipment - row.miscExpense - row.generalLiability;
    expect(row.overheadAndProfit).toBeCloseTo(expected, 8);
  });
});

describe('sumLaborRows', () => {
  it('adds the money columns and leaves the day rate out of the total', () => {
    const rows = [buildLaborRow(pricing(), 2, 224, RATES), buildLaborRow(pricing(), 1, 300, RATES)];
    const totals = sumLaborRows(rows);
    expect(totals.totalCost).toBe(6000);
    expect(totals.manDays).toBe(rows[0].manDays + rows[1].manDays);
    // A blended day rate across differing assemblies would be invented.
    expect(totals.dayRatePerMan).toBe(0);
  });

  it('is zero for an empty report', () => {
    expect(sumLaborRows([]).totalCost).toBe(0);
  });
});

describe('buildAssemblyReport', () => {
  const sources = new Map<string, MaterialLineSource>();
  const labor = new Map([['asm-1', { crewSize: 2, dayRatePerMan: 224 }]]);

  it('reconciles: the buckets sum back to the job total', () => {
    const report = buildAssemblyReport({
      pricings: [pricing()],
      laborByAssemblyId: labor,
      sourcesByComponentId: sources,
      taxPct: 0.07,
      rates: RATES,
      workType: 'waterproofing',
    });
    expect(report.reconciliationError).toBe(0);
    expect(report.warnings).toHaveLength(0);
  });

  it('reconciles across several assemblies with awkward numbers', () => {
    const report = buildAssemblyReport({
      pricings: [
        pricing({ conditionId: 'a' }),
        pricing({
          conditionId: 'b',
          breakdown: {
            materialTotal: 777.77,
            jobDurationDays: 3,
            equipmentCost: 13.13,
            miscCost: 9.99,
            total: 4321.09,
          } as ConditionPricing['breakdown'],
        }),
      ],
      laborByAssemblyId: labor,
      sourcesByComponentId: sources,
      taxPct: 0.07,
      rates: RATES,
      workType: 'waterproofing',
    });
    expect(report.reconciliationError).toBe(0);
    expect(report.laborTotals.totalCost).toBeCloseTo(3000 + 4321.09, 8);
  });

  it('warns rather than filing when overhead and profit goes negative', () => {
    // A job whose total barely exceeds its labor: liability eats the rest.
    const report = buildAssemblyReport({
      pricings: [
        pricing({
          breakdown: {
            materialTotal: 1000,
            jobDurationDays: 10,
            total: 1200,
          } as ConditionPricing['breakdown'],
        }),
      ],
      laborByAssemblyId: labor,
      sourcesByComponentId: sources,
      taxPct: 0.07,
      rates: RATES,
      workType: 'waterproofing',
    });
    expect(report.laborTotals.overheadAndProfit).toBeLessThan(0);
    expect(report.warnings.some((w) => w.includes('negative'))).toBe(true);
    // Still reconciles — a negative residual is a real number, not an error.
    expect(report.reconciliationError).toBe(0);
  });

  it('carries pricing warnings up, named by assembly', () => {
    const report = buildAssemblyReport({
      pricings: [pricing({ warnings: ['"SF-Wall" is not measured by any condition'] })],
      laborByAssemblyId: labor,
      sourcesByComponentId: sources,
      taxPct: 0.07,
      rates: RATES,
      workType: 'waterproofing',
    });
    expect(report.warnings[0]).toContain('Aquafin-2K M');
    expect(report.warnings[0]).toContain('SF-Wall');
  });

  it('records which liability basis was used', () => {
    const report = buildAssemblyReport({
      pricings: [pricing()],
      laborByAssemblyId: labor,
      sourcesByComponentId: sources,
      taxPct: 0.07,
      rates: { ...RATES, generalLiabilityPct: 0.05337 },
      workType: 'restoration',
    });
    expect(report.workType).toBe('restoration');
    expect(report.rates.generalLiabilityPct).toBe(0.05337);
  });

  it('produces an empty but valid report when nothing is linked', () => {
    const report = buildAssemblyReport({
      pricings: [],
      laborByAssemblyId: labor,
      sourcesByComponentId: sources,
      taxPct: 0.07,
      rates: RATES,
      workType: 'waterproofing',
    });
    expect(report.materialLines).toHaveLength(0);
    expect(report.laborTotals.totalCost).toBe(0);
    expect(report.reconciliationError).toBe(0);
  });

  it('falls back to zero labor when an assembly is missing its crew or rate', () => {
    const report = buildAssemblyReport({
      pricings: [pricing()],
      laborByAssemblyId: new Map(),
      sourcesByComponentId: sources,
      taxPct: 0.07,
      rates: RATES,
      workType: 'waterproofing',
    });
    expect(report.laborRows[0].regularPay).toBe(0);
    // Still reconciles: the unbilled labor lands in OH&P rather than vanishing.
    expect(report.reconciliationError).toBe(0);
  });
});
