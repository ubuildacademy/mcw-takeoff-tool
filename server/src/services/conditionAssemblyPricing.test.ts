/**
 * Condition → assembly pricing (task I6).
 *
 * The engine's arithmetic is pinned in `assemblyCosting.test.ts` and proven
 * against real workbooks by the golden harness. What is here is the layer
 * above it: which quantity reaches which components, which production rates
 * are paced by it, and — the part that actually protects an estimator — what
 * the caller is told about the parts of the assembly nobody is measuring.
 */
import { describe, it, expect } from 'vitest';
import {
  AssemblyComponentRow,
  AssemblyProductionRateRow,
  AssemblyQuantityInputRow,
  AssemblyRow,
  buildAssemblyDetail,
  type CostDefaults,
} from './assemblyLibrary';
import {
  bindProductionRates,
  findUnfedInputs,
  priceCondition,
  sumConditionPricing,
} from './conditionAssemblyPricing';

const ASSEMBLY_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FLOOR = 'input-1';
const WALL = 'input-2';

const DEFAULTS: CostDefaults = {
  dayRatePerMan: 224,
  laborBurdenPct: 0.35,
  escalationPct: 0,
  surchargePct: 0,
  taxPct: 0,
  marginChain: [{ name: 'Profit', rate: 0.2 }],
  insuranceRatePerThousand: null,
  insuranceMarginPct: null,
};

function assemblyRow(overrides: Partial<AssemblyRow> = {}): AssemblyRow {
  return {
    id: ASSEMBLY_ID,
    org_id: 'org-1',
    name: 'Aquafin-2K M',
    day_rate_per_man: null,
    crew_size: 2,
    labor_burden_pct: null,
    escalation_pct: null,
    surcharge_pct: null,
    tax_pct: null,
    margin_chain: [],
    source_workbook_id: null,
    notes: null,
    created_at: '2026-07-30T00:00:00Z',
    updated_at: '2026-07-30T00:00:00Z',
    ...overrides,
  };
}

function inputRow(id: string, seq: number, name: string, wastePct = 0): AssemblyQuantityInputRow {
  return { id, assembly_id: ASSEMBLY_ID, seq, name, unit: 'SF', waste_pct: wastePct };
}

function componentRow(
  seq: number,
  overrides: Partial<AssemblyComponentRow> = {}
): AssemblyComponentRow {
  return {
    id: `component-${seq}`,
    assembly_id: ASSEMBLY_ID,
    seq,
    quantity_input_id: FLOOR,
    description: `Component ${seq}`,
    product_code: 'CODE1',
    unit_price: null,
    coverage_yield: 100,
    yield_unit: 'SF/bag',
    packaging_unit: 'bag',
    is_optional: false,
    ...overrides,
  };
}

function rateRow(
  seq: number,
  overrides: Partial<AssemblyProductionRateRow> = {}
): AssemblyProductionRateRow {
  return {
    id: `rate-${seq}`,
    assembly_id: ASSEMBLY_ID,
    seq,
    description: `Rate ${seq}`,
    rate_per_day: 500,
    unit: 'SF',
    quantity_input_id: FLOOR,
    rounds_up: true,
    is_optional: false,
    ...overrides,
  };
}

function build(
  inputs: AssemblyQuantityInputRow[],
  components: AssemblyComponentRow[],
  rates: AssemblyProductionRateRow[] = [],
  overrides: Partial<AssemblyRow> = {}
) {
  return buildAssemblyDetail(assemblyRow(overrides), inputs, components, rates);
}

const PRICES = { CODE1: 50, CODE2: 10 };

describe('bindProductionRates', () => {
  it('paces a rate by the quantity of the input it is bound to', () => {
    const assembly = build([inputRow(FLOOR, 1, 'SF-Floor')], [componentRow(1)], [rateRow(1)]);
    const { labor } = bindProductionRates(assembly, { [FLOOR]: 1000 });
    expect(labor.rates).toEqual([{ ratePerDay: 500, quantity: 1000, roundsUp: true }]);
  });

  it('drops a rate bound to an input nobody is feeding', () => {
    const assembly = build(
      [inputRow(FLOOR, 1, 'SF-Floor'), inputRow(WALL, 2, 'SF-Wall')],
      [componentRow(1)],
      [rateRow(1), rateRow(2, { quantity_input_id: WALL })]
    );
    const { labor } = bindProductionRates(assembly, { [FLOOR]: 1000 });
    expect(labor.rates).toHaveLength(1);
    expect(labor.rates[0].quantity).toBe(1000);
  });

  it('counts an unbound rate rather than pacing it with the fed quantity', () => {
    // Assuming an unbound rate paces the measured quantity would invent labor
    // out of an extraction gap.
    const assembly = build(
      [inputRow(FLOOR, 1, 'SF-Floor')],
      [componentRow(1)],
      [rateRow(1, { quantity_input_id: null })]
    );
    const { labor, unboundRateCount } = bindProductionRates(assembly, { [FLOOR]: 1000 });
    expect(labor.rates).toHaveLength(0);
    expect(unboundRateCount).toBe(1);
  });

  it('carries per-line rounding through, since it differs by workbook family', () => {
    const assembly = build(
      [inputRow(FLOOR, 1, 'SF-Floor')],
      [componentRow(1)],
      [rateRow(1, { rounds_up: false })]
    );
    const { labor } = bindProductionRates(assembly, { [FLOOR]: 1000 });
    expect(labor.rates[0].roundsUp).toBe(false);
  });

  it('skips a rate with no rate per day instead of dividing by zero', () => {
    const assembly = build(
      [inputRow(FLOOR, 1, 'SF-Floor')],
      [componentRow(1)],
      [rateRow(1, { rate_per_day: null }), rateRow(2, { rate_per_day: 0 })]
    );
    const { labor, unboundRateCount } = bindProductionRates(assembly, { [FLOOR]: 1000 });
    expect(labor.rates).toHaveLength(0);
    expect(unboundRateCount).toBe(0);
  });
});

describe('findUnfedInputs', () => {
  it('names an input with components that no condition feeds', () => {
    const assembly = build(
      [inputRow(FLOOR, 1, 'SF-Floor'), inputRow(WALL, 2, 'SF-Wall')],
      [componentRow(1), componentRow(2, { quantity_input_id: WALL })]
    );
    const unfed = findUnfedInputs(assembly, { [FLOOR]: 1000 });
    expect(unfed).toEqual([{ id: WALL, name: 'SF-Wall', unit: 'SF', componentCount: 1 }]);
  });

  it('stays quiet about an unfed input with no components attached', () => {
    const assembly = build(
      [inputRow(FLOOR, 1, 'SF-Floor'), inputRow(WALL, 2, 'SF-Wall')],
      [componentRow(1)]
    );
    expect(findUnfedInputs(assembly, { [FLOOR]: 1000 })).toEqual([]);
  });

  it('counts a component that also divides the unfed input', () => {
    const assembly = build(
      [inputRow(FLOOR, 1, 'SF-Floor'), inputRow(WALL, 2, 'SF-Wall')],
      [componentRow(1, { additional_quantity_input_ids: [WALL] })]
    );
    expect(findUnfedInputs(assembly, { [FLOOR]: 1000 })[0].componentCount).toBe(1);
  });
});

describe('priceCondition', () => {
  const request = { conditionId: 'cond-1', quantityInputId: FLOOR, quantity: 1000 };

  it('prices the components the fed input drives', () => {
    const assembly = build([inputRow(FLOOR, 1, 'SF-Floor')], [componentRow(1)]);
    const pricing = priceCondition({
      assembly,
      request,
      pricesByCode: PRICES,
      costDefaults: DEFAULTS,
    });
    // 1000 SF / 100 SF per bag = 10 bags at $50.
    expect(pricing.breakdown.materialSubtotal).toBe(500);
    expect(pricing.quantityInputName).toBe('SF-Floor');
  });

  it('inherits company rates the assembly leaves null', () => {
    // The assembly's day rate is null; the crew still has to be paid.
    const assembly = build([inputRow(FLOOR, 1, 'SF-Floor')], [componentRow(1)], [rateRow(1)]);
    const pricing = priceCondition({
      assembly,
      request,
      pricesByCode: PRICES,
      costDefaults: DEFAULTS,
    });
    // 1000 SF at 500 SF/day = 2 man-days; crew of 2 → 1 calendar day.
    expect(pricing.breakdown.laborManDays).toBe(2);
    expect(pricing.breakdown.jobDurationDays).toBe(1);
    expect(pricing.breakdown.laborBase).toBe(224 * 2 * 1);
  });

  it("an assembly's own rate wins over the company default", () => {
    const assembly = build(
      [inputRow(FLOOR, 1, 'SF-Floor')],
      [componentRow(1)],
      [rateRow(1)],
      { day_rate_per_man: 200 }
    );
    const pricing = priceCondition({
      assembly,
      request,
      pricesByCode: PRICES,
      costDefaults: DEFAULTS,
    });
    expect(pricing.breakdown.laborBase).toBe(200 * 2 * 1);
  });

  it('reads back an insurance rate the assembly overrode', () => {
    // This is the regression that matters: insurance is written on import but
    // was not mapped on read, so an assembly at 35 quietly billed the company 79.
    const assembly = build([inputRow(FLOOR, 1, 'SF-Floor')], [componentRow(1)], [], {
      insurance_rate_per_thousand: 35,
      insurance_margin_pct: 0,
    });
    const pricing = priceCondition({
      assembly,
      request,
      pricesByCode: PRICES,
      costDefaults: { ...DEFAULTS, insuranceRatePerThousand: 79, insuranceMarginPct: 0 },
    });
    expect(pricing.breakdown.insuranceBase).toBe(Math.ceil((35 * 500) / 1000));
  });

  it('warns, loudly, when a whole input is unmeasured', () => {
    const assembly = build(
      [inputRow(FLOOR, 1, 'SF-Floor'), inputRow(WALL, 2, 'SF-Wall')],
      [componentRow(1), componentRow(2, { quantity_input_id: WALL })]
    );
    const pricing = priceCondition({
      assembly,
      request,
      pricesByCode: PRICES,
      costDefaults: DEFAULTS,
    });
    expect(pricing.unfedInputs).toHaveLength(1);
    expect(pricing.warnings.some((w) => w.includes('SF-Wall') && w.includes('$0'))).toBe(true);
  });

  it('prices zero without complaint for a condition with no measurements yet', () => {
    const assembly = build([inputRow(FLOOR, 1, 'SF-Floor')], [componentRow(1)]);
    const pricing = priceCondition({
      assembly,
      request: { ...request, quantity: 0 },
      pricesByCode: PRICES,
      costDefaults: DEFAULTS,
    });
    expect(pricing.breakdown.materialSubtotal).toBe(0);
    expect(pricing.warnings.some((w) => w.includes('negative'))).toBe(false);
  });

  it('clamps a negative quantity instead of pricing negative packages', () => {
    const assembly = build([inputRow(FLOOR, 1, 'SF-Floor')], [componentRow(1)]);
    const pricing = priceCondition({
      assembly,
      request: { ...request, quantity: -500 },
      pricesByCode: PRICES,
      costDefaults: DEFAULTS,
    });
    expect(pricing.quantity).toBe(0);
    expect(pricing.breakdown.materialSubtotal).toBe(0);
    expect(pricing.warnings.some((w) => w.includes('negative'))).toBe(true);
  });

  it('says so when the condition points at an input the assembly no longer has', () => {
    const assembly = build([inputRow(FLOOR, 1, 'SF-Floor')], [componentRow(1)]);
    const pricing = priceCondition({
      assembly,
      request: { ...request, quantityInputId: 'input-gone' },
      pricesByCode: PRICES,
      costDefaults: DEFAULTS,
    });
    expect(pricing.quantityInputName).toBeNull();
    expect(pricing.warnings.some((w) => w.includes('Re-link'))).toBe(true);
  });

  it('surfaces the engine\'s own issues alongside its total', () => {
    // An unpriced component still produces a number AND a reason not to quote it.
    const assembly = build([inputRow(FLOOR, 1, 'SF-Floor')], [componentRow(1, { product_code: 'MISSING' })]);
    const pricing = priceCondition({
      assembly,
      request,
      pricesByCode: PRICES,
      costDefaults: DEFAULTS,
    });
    expect(pricing.warnings.length).toBeGreaterThan(0);
    expect(pricing.breakdown.total).toBeGreaterThanOrEqual(0);
  });

  it('applies the margin chain the assembly inherits', () => {
    const assembly = build([inputRow(FLOOR, 1, 'SF-Floor')], [componentRow(1)]);
    const pricing = priceCondition({
      assembly,
      request,
      pricesByCode: PRICES,
      costDefaults: DEFAULTS,
    });
    // Divide-through, not markup: 500 / (1 - 0.2) = 625.
    expect(pricing.breakdown.total).toBe(625);
  });
});

describe('sumConditionPricing', () => {
  it('adds per-condition totals rather than re-applying one margin chain', () => {
    const assembly = build([inputRow(FLOOR, 1, 'SF-Floor')], [componentRow(1)]);
    const one = priceCondition({
      assembly,
      request: { conditionId: 'a', quantityInputId: FLOOR, quantity: 1000 },
      pricesByCode: PRICES,
      costDefaults: DEFAULTS,
    });
    const two = priceCondition({
      assembly,
      request: { conditionId: 'b', quantityInputId: FLOOR, quantity: 2000 },
      pricesByCode: PRICES,
      costDefaults: DEFAULTS,
    });
    const totals = sumConditionPricing([one, two]);
    expect(totals.conditionCount).toBe(2);
    expect(totals.total).toBe(one.breakdown.total + two.breakdown.total);
    expect(totals.conditionsWithWarnings).toBe(0);
  });

  it('counts the conditions carrying a warning', () => {
    const assembly = build(
      [inputRow(FLOOR, 1, 'SF-Floor'), inputRow(WALL, 2, 'SF-Wall')],
      [componentRow(1), componentRow(2, { quantity_input_id: WALL })]
    );
    const pricing = priceCondition({
      assembly,
      request: { conditionId: 'a', quantityInputId: FLOOR, quantity: 1000 },
      pricesByCode: PRICES,
      costDefaults: DEFAULTS,
    });
    expect(sumConditionPricing([pricing]).conditionsWithWarnings).toBe(1);
  });

  it('is zero for an empty project', () => {
    expect(sumConditionPricing([]).total).toBe(0);
  });
});
