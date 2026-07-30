/**
 * Costing-engine rules.
 *
 * These test the arithmetic in isolation. They are NOT the gate — the gate is
 * reproducing real workbook totals, which lives in the golden harness
 * (`assembly_costing_golden.py`) because it needs real workbooks and real
 * prices. What is here pins the four rules that are easy to get wrong and
 * silently wrong: per-input waste, per-line package rounding, subtotal
 * rounding, and the divide-through margin chain.
 */
import { describe, it, expect } from 'vitest';
import {
  AssemblyComponentRow,
  AssemblyQuantityInputRow,
  AssemblyRow,
  buildAssemblyDetail,
} from './assemblyLibrary';
import {
  applyMarginChain,
  computeAssemblyCost,
  computeJobDurationDays,
  computeLaborDays,
  roundUp,
} from './assemblyCosting';

const ASSEMBLY_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function assemblyRow(overrides: Partial<AssemblyRow> = {}): AssemblyRow {
  return {
    id: ASSEMBLY_ID,
    org_id: 'org-1',
    name: 'Test assembly',
    day_rate_per_man: 224,
    crew_size: 2,
    labor_burden_pct: 0.35,
    escalation_pct: 0,
    surcharge_pct: 0,
    tax_pct: 0,
    margin_chain: [],
    source_workbook_id: null,
    notes: null,
    created_at: '2026-07-27T00:00:00Z',
    updated_at: '2026-07-27T00:00:00Z',
    ...overrides,
  };
}

function inputRow(seq: number, name: string, wastePct: number): AssemblyQuantityInputRow {
  return { id: `input-${seq}`, assembly_id: ASSEMBLY_ID, seq, name, unit: 'SF', waste_pct: wastePct };
}

function componentRow(
  seq: number,
  overrides: Partial<AssemblyComponentRow> = {}
): AssemblyComponentRow {
  return {
    id: `component-${seq}`,
    assembly_id: ASSEMBLY_ID,
    seq,
    quantity_input_id: 'input-1',
    description: `Component ${seq}`,
    product_code: 'CODE1',
    unit_price: null,
    coverage_yield: 100,
    yield_unit: 'SF/bag',
    packaging_unit: 'lb/bag',
    is_optional: false,
    ...overrides,
  };
}

describe('roundUp', () => {
  it('matches Excel ROUNDUP, rounding away from zero', () => {
    expect(roundUp(4.01)).toBe(5);
    expect(roundUp(4.0)).toBe(4);
    expect(roundUp(-4.01)).toBe(-5);
  });
});

describe('applyMarginChain', () => {
  // Aquafin's Safety/Overhead/Profit rows are G186-F59, G187-G186, G188-G187,
  // each helper dividing the previous running total by (1 - rate). A multiply
  // would be materially cheaper and the gap compounds.
  it('divides through and compounds, rather than multiplying', () => {
    const steps = applyMarginChain(1000, [
      { name: 'Safety', rate: 0.02 },
      { name: 'Overhead', rate: 0.22 },
      { name: 'Profit', rate: 0.2 },
    ]);

    expect(steps[0].runningTotal).toBeCloseTo(1000 / 0.98, 6);
    expect(steps[1].runningTotal).toBeCloseTo(1000 / 0.98 / 0.78, 6);
    expect(steps[2].runningTotal).toBeCloseTo(1000 / 0.98 / 0.78 / 0.8, 6);

    // The sum of the increments is the total margin the workbook reports.
    const total = steps.reduce((sum, step) => sum + step.amount, 0);
    expect(total).toBeCloseTo(1000 / 0.98 / 0.78 / 0.8 - 1000, 6);

    // And it is NOT what multiplying would give.
    expect(steps[2].runningTotal).not.toBeCloseTo(1000 * 1.02 * 1.22 * 1.2, 2);
  });

  it('applies margins in order — order changes the result', () => {
    const forward = applyMarginChain(1000, [
      { name: 'A', rate: 0.5 },
      { name: 'B', rate: 0.1 },
    ]);
    // Chained division is commutative in the total, but each step's reported
    // amount is not — the workbook shows those amounts per margin row.
    const reverse = applyMarginChain(1000, [
      { name: 'B', rate: 0.1 },
      { name: 'A', rate: 0.5 },
    ]);
    expect(forward[0].amount).not.toBeCloseTo(reverse[0].amount, 2);
    expect(forward[1].runningTotal).toBeCloseTo(reverse[1].runningTotal, 6);
  });

  it('treats a zero margin as a no-op', () => {
    const steps = applyMarginChain(1000, [{ name: 'Safety', rate: 0 }]);
    expect(steps[0].runningTotal).toBe(1000);
    expect(steps[0].amount).toBe(0);
  });

  it('refuses a rate of 1 or more instead of returning Infinity', () => {
    const steps = applyMarginChain(1000, [{ name: 'Broken', rate: 1 }]);
    expect(Number.isNaN(steps[0].amount)).toBe(true);
    expect(steps[0].runningTotal).toBe(1000);
  });
});

describe('material quantities', () => {
  it('applies each input\'s own waste, not one assembly-wide figure', () => {
    const assembly = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF-Floor', 0.05), inputRow(2, 'SF-Walls', 0.2)],
      [
        componentRow(1, { quantity_input_id: 'input-1' }),
        componentRow(2, { quantity_input_id: 'input-2' }),
      ]
    );

    const result = computeAssemblyCost(assembly, {
      quantitiesByInputId: { 'input-1': 1000, 'input-2': 1000 },
      pricesByCode: { CODE1: 10 },
    });

    expect(result.components[0].adjustedQuantity).toBeCloseTo(1050, 6);
    expect(result.components[1].adjustedQuantity).toBeCloseTo(1200, 6);
    expect(result.components[0].packages).toBe(11); // ROUNDUP(1050/100)
    expect(result.components[1].packages).toBe(12);
  });

  it('rounds packages up per line, not on the summed quantity', () => {
    // Three lines each needing 1.2 packages is 3 x 2 = 6 packages, not
    // ROUNDUP(3.6) = 4. Rounding late under-buys material on nearly every line.
    const assembly = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', 0)],
      [componentRow(1), componentRow(2), componentRow(3)]
    );
    const result = computeAssemblyCost(assembly, {
      quantitiesByInputId: { 'input-1': 120 },
      pricesByCode: { CODE1: 10 },
    });
    expect(result.components.map((c) => c.packages)).toEqual([2, 2, 2]);
    expect(result.materialSubtotal).toBe(60);
  });

  it('prices a component from its literal price when it has no code', () => {
    const assembly = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', 0)],
      [componentRow(1, { product_code: null, unit_price: 122 })]
    );
    const result = computeAssemblyCost(assembly, {
      quantitiesByInputId: { 'input-1': 100 },
      pricesByCode: {},
    });
    expect(result.components[0].unitPrice).toBe(122);
    expect(result.materialSubtotal).toBe(122);
    // A hand-priced component is complete, not a gap — no component-level issue.
    // (The bare fixture has no margin chain, which the engine flags separately.)
    expect(result.components[0].issue).toBeNull();
  });

  it('reports an unpriced component as an issue rather than costing it at zero', () => {
    const assembly = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', 0)],
      [componentRow(1, { product_code: 'MISSING' })]
    );
    const result = computeAssemblyCost(assembly, {
      quantitiesByInputId: { 'input-1': 100 },
      pricesByCode: {},
    });
    expect(result.components[0].extendedCost).toBe(0);
    expect(result.components[0].included).toBe(false);
    expect(result.issues.join(' ')).toContain('no price on file for MISSING');
  });

  it('reports a component with no yield rather than dividing by zero', () => {
    const assembly = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', 0)],
      [componentRow(1, { coverage_yield: null })]
    );
    const result = computeAssemblyCost(assembly, {
      quantitiesByInputId: { 'input-1': 100 },
      pricesByCode: { CODE1: 10 },
    });
    expect(Number.isFinite(result.total)).toBe(true);
    expect(result.issues.join(' ')).toContain('no coverage yield');
  });

  it('can exclude optional components', () => {
    const assembly = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', 0)],
      [componentRow(1), componentRow(2, { is_optional: true })]
    );
    const included = computeAssemblyCost(assembly, {
      quantitiesByInputId: { 'input-1': 100 },
      pricesByCode: { CODE1: 10 },
    });
    const excluded = computeAssemblyCost(assembly, {
      quantitiesByInputId: { 'input-1': 100 },
      pricesByCode: { CODE1: 10 },
      includeOptional: false,
    });
    expect(included.materialSubtotal).toBe(20);
    expect(excluded.materialSubtotal).toBe(10);
    // An excluded optional is a choice, not a problem: the line reports why it
    // contributed nothing, but it must not surface as an assembly-level issue.
    expect(excluded.components[1].issue).toBe('excluded: optional component');
    expect(excluded.issues.join(' ')).not.toContain('optional');
  });

  it('leaves an input nobody entered at zero without inventing quantity', () => {
    const assembly = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF-Floor', 0), inputRow(2, 'SF-Walls', 0)],
      [componentRow(1, { quantity_input_id: 'input-2' })]
    );
    const result = computeAssemblyCost(assembly, {
      quantitiesByInputId: { 'input-1': 500 },
      pricesByCode: { CODE1: 10 },
    });
    expect(result.components[0].packages).toBe(0);
    expect(result.materialSubtotal).toBe(0);
  });
});

describe('material adjustments', () => {
  it('taxes the escalated subtotal, not the raw one', () => {
    const assembly = buildAssemblyDetail(
      assemblyRow({ escalation_pct: 0.03, surcharge_pct: 0, tax_pct: 0.07 }),
      [inputRow(1, 'SF', 0)],
      [componentRow(1)]
    );
    const result = computeAssemblyCost(assembly, {
      quantitiesByInputId: { 'input-1': 100 },
      pricesByCode: { CODE1: 1000 },
    });

    expect(result.materialSubtotal).toBe(1000);
    expect(result.escalation).toBeCloseTo(30, 6);
    expect(result.tax).toBeCloseTo(1030 * 0.07, 6);
    expect(result.materialTotal).toBe(roundUp(1000 + 30 + 1030 * 0.07));
  });
});

describe('labor', () => {
  it('rounds days up per line, then rounds the sum up again', () => {
    // Two lines of 1.5 days each: 2 + 2 = 4, not ROUNDUP(3) = 3.
    expect(
      computeLaborDays([
        { ratePerDay: 100, quantity: 150 },
        { ratePerDay: 100, quantity: 150 },
      ])
    ).toBe(4);
  });

  it('skips lines with no rate instead of dividing by zero', () => {
    expect(
      computeLaborDays([
        { ratePerDay: 0, quantity: 500 },
        { ratePerDay: 100, quantity: 100 },
      ])
    ).toBe(1);
  });

  // The workbook divides man-days by the crew to get calendar days on site
  // ("Job Duration is N Days with N Man/Men"), then bills the crew's daily
  // cost for those days. Multiplying the crew's daily cost by MAN-days would
  // count the crew twice.
  it('converts man-days to calendar days before billing the crew', () => {
    expect(computeJobDurationDays(4, 2)).toBe(2);
    // 3 man-days with a crew of 2 is 2 whole days on site, i.e. 4 man-days billed.
    expect(computeJobDurationDays(3, 2)).toBe(2);
    expect(computeJobDurationDays(4, 0)).toBe(0);
  });

  it('bills the crew day rate for the job duration, plus burden', () => {
    const assembly = buildAssemblyDetail(
      assemblyRow({ day_rate_per_man: 224, crew_size: 2, labor_burden_pct: 0.35 }),
      [inputRow(1, 'SF', 0)],
      []
    );
    const result = computeAssemblyCost(
      assembly,
      { quantitiesByInputId: {}, pricesByCode: {} },
      { rates: [{ ratePerDay: 800, quantity: 1600 }] }
    );

    expect(result.laborManDays).toBe(2);
    expect(result.jobDurationDays).toBe(1); // 2 man-days across a 2-man crew
    expect(result.laborBase).toBeCloseTo(224 * 2 * 1, 6);
    expect(result.laborTotal).toBe(roundUp(224 * 2 * 1 * 1.35));
    // The wrong formula would be dayRate x crew x manDays — twice this.
    expect(result.laborBase).not.toBeCloseTo(224 * 2 * 2, 2);
  });
});

describe('insurance', () => {
  // F69 = ROUNDUP(ratePerThousand x costMLE / 1000); F71 = F69 / (1 - margin);
  // and the job total is ROUNDUP(costMLE + F71 + margins) — insurance is added
  // alongside the chain, not folded into it.
  it('charges per thousand of cost and takes its own margin', () => {
    const assembly = buildAssemblyDetail(
      assemblyRow({ margin_chain: [{ name: 'Profit', rate: 0.2 }] }),
      [inputRow(1, 'SF', 0)],
      [componentRow(1)]
    );
    const result = computeAssemblyCost(
      assembly,
      { quantitiesByInputId: { 'input-1': 100 }, pricesByCode: { CODE1: 1000 } },
      { rates: [] },
      { ratePerThousand: 79, marginPct: 0.15 }
    );

    expect(result.insuranceBase).toBe(roundUp((79 * result.costBeforeMargins) / 1000));
    expect(result.insuranceTotal).toBeCloseTo(result.insuranceBase / 0.85, 6);
    expect(result.total).toBe(
      roundUp(result.costBeforeMargins + result.insuranceTotal + result.marginsTotal)
    );
  });

  it('is absent, not zero-rated, when the assembly carries no insurance rate', () => {
    const assembly = buildAssemblyDetail(
      assemblyRow({ margin_chain: [{ name: 'Profit', rate: 0.2 }] }),
      [inputRow(1, 'SF', 0)],
      [componentRow(1)]
    );
    const result = computeAssemblyCost(assembly, {
      quantitiesByInputId: { 'input-1': 100 },
      pricesByCode: { CODE1: 1000 },
    });
    expect(result.insuranceBase).toBe(0);
    expect(result.insuranceTotal).toBe(0);
  });
});

describe('total', () => {
  it('composes material, labor, equipment and the margin chain', () => {
    const assembly = buildAssemblyDetail(
      assemblyRow({
        escalation_pct: 0,
        tax_pct: 0,
        margin_chain: [
          { name: 'Safety', rate: 0.02 },
          { name: 'Overhead', rate: 0.22 },
          { name: 'Profit', rate: 0.2 },
        ],
      }),
      [inputRow(1, 'SF', 0)],
      [componentRow(1)]
    );

    const result = computeAssemblyCost(
      assembly,
      {
        quantitiesByInputId: { 'input-1': 100 },
        pricesByCode: { CODE1: 100 },
        equipmentCost: 50,
        miscCost: 25,
      },
      { rates: [{ ratePerDay: 100, quantity: 100 }] }
    );

    const material = 100; // 1 package at 100
    const labor = roundUp(224 * 2 * 1 * 1.35);
    const before = material + labor + 50 + 25;
    expect(result.costBeforeMargins).toBe(before);
    expect(result.total).toBe(roundUp(before / 0.98 / 0.78 / 0.8));
    expect(result.issues).toEqual([]);
  });
});
