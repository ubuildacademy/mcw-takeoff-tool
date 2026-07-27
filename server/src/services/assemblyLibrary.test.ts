/**
 * Guards for the two mispricing bugs measured against MCW's live workbook
 * library. Both are silent — they produce a smaller, plausible-looking
 * assembly rather than an error — so they get tests rather than comments.
 *
 * See docs/ASSEMBLIES_DESIGN.md (Stage 2 viability + I0 accuracy findings).
 */
import { describe, it, expect } from 'vitest';
import {
  AssemblyComponentRow,
  AssemblyQuantityInputRow,
  AssemblyRow,
  assemblyIntegrityIssues,
  buildAssemblyDetail,
  componentsForInput,
  mapMarginChain,
  wastePctForComponent,
} from './assemblyLibrary';

const ASSEMBLY_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function assemblyRow(overrides: Partial<AssemblyRow> = {}): AssemblyRow {
  return {
    id: ASSEMBLY_ID,
    org_id: 'org-1',
    name: 'Test assembly',
    day_rate_per_man: '224',
    crew_size: 1,
    labor_burden_pct: '0.35',
    escalation_pct: '0.03',
    surcharge_pct: '0',
    tax_pct: '0.07',
    margin_chain: [
      { name: 'Safety', rate: 0.02 },
      { name: 'Overhead', rate: 0.22 },
      { name: 'Profit', rate: 0.2 },
    ],
    source_workbook_id: null,
    notes: null,
    created_at: '2026-07-27T00:00:00Z',
    updated_at: '2026-07-27T00:00:00Z',
    ...overrides,
  };
}

function inputRow(seq: number, name: string, wastePct: string): AssemblyQuantityInputRow {
  return {
    id: `input-${seq}`,
    assembly_id: ASSEMBLY_ID,
    seq,
    name,
    unit: 'SF',
    waste_pct: wastePct,
  };
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
    coverage_yield: '125',
    yield_unit: 'SF/bag',
    packaging_unit: 'lb/bag',
    is_optional: false,
    ...overrides,
  };
}

describe('component identity', () => {
  // Aquafin-2K M.xlsx rows 19/20: the same product code at two different
  // yields — one product applied in two coats. Anything that keys, groups or
  // de-duplicates components by product code halves the material quantity on
  // every bid that uses the assembly.
  it('keeps two components that share a product code at different yields', () => {
    const detail = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', '0.05')],
      [
        componentRow(1, { product_code: 'AQU2KMG46', coverage_yield: '125' }),
        componentRow(2, { product_code: 'AQU2KMG46', coverage_yield: '90' }),
      ]
    );

    expect(detail.components).toHaveLength(2);
    expect(detail.components.map((c) => c.coverageYield)).toEqual([125, 90]);
    expect(componentsForInput(detail, 'input-1')).toHaveLength(2);
    expect(assemblyIntegrityIssues(detail)).toEqual([]);
  });

  it('orders components by seq regardless of row order', () => {
    const detail = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', '0.05')],
      [componentRow(3), componentRow(1), componentRow(2)]
    );
    expect(detail.components.map((c) => c.seq)).toEqual([1, 2, 3]);
  });
});

describe('named quantity inputs', () => {
  // Euclid "Eucopoxy Tufcoat and duralkote 240 at walls": four named inputs,
  // each with its own waste %, each component dividing one of them. 74% of the
  // live library is shaped like this.
  const fourInput = () =>
    buildAssemblyDetail(
      assemblyRow(),
      [
        inputRow(1, 'SF-Floor', '0.05'),
        inputRow(2, 'LF', '0.10'),
        inputRow(3, 'SF-Walls', '0.05'),
        inputRow(4, 'Sand (Optional)', '0.02'),
      ],
      [
        componentRow(1, { quantity_input_id: 'input-2', product_code: 'DYM100' }),
        componentRow(2, { quantity_input_id: 'input-1', product_code: 'EUCETCGR' }),
        componentRow(3, { quantity_input_id: 'input-1', product_code: 'EUCETCGR' }),
        componentRow(4, { quantity_input_id: 'input-4', product_code: 'UCPGRNSLJC2040SS' }),
        componentRow(5, { quantity_input_id: 'input-3', product_code: 'EUCTD2379104' }),
      ]
    );

  it('binds each component to its own input', () => {
    const detail = fourInput();
    expect(componentsForInput(detail, 'input-1').map((c) => c.seq)).toEqual([2, 3]);
    expect(componentsForInput(detail, 'input-2').map((c) => c.seq)).toEqual([1]);
    expect(componentsForInput(detail, 'input-3').map((c) => c.seq)).toEqual([5]);
    expect(componentsForInput(detail, 'input-4').map((c) => c.seq)).toEqual([4]);
  });

  it('resolves waste % from the component\'s own input, not the assembly', () => {
    const detail = fourInput();
    const wasteBySeq = detail.components.map((c) => wastePctForComponent(detail, c));
    expect(wasteBySeq).toEqual([0.1, 0.05, 0.05, 0.02, 0.05]);
  });

  it('flags a component that is not bound to any input', () => {
    const detail = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', '0.05')],
      [componentRow(1, { quantity_input_id: null })]
    );
    expect(wastePctForComponent(detail, detail.components[0])).toBeNull();
    expect(assemblyIntegrityIssues(detail).map((i) => i.code)).toContain(
      'component_without_quantity_input'
    );
  });

  it('flags a component bound to an input that does not exist', () => {
    const detail = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', '0.05')],
      [componentRow(1, { quantity_input_id: 'input-99' })]
    );
    expect(assemblyIntegrityIssues(detail).map((i) => i.code)).toContain(
      'component_without_quantity_input'
    );
  });
});

describe('price source', () => {
  // 19 workbooks price every component by hand with no price-list lookup, and
  // 60 further rows had their lookup flattened to a literal — so a fixed price
  // is a valid, complete component, not a gap.
  it('accepts a hand-priced component with no product code', () => {
    const detail = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', '0.05')],
      [componentRow(1, { product_code: null, unit_price: '122' })]
    );
    expect(detail.components[0].unitPrice).toBe(122);
    expect(assemblyIntegrityIssues(detail)).toEqual([]);
  });

  it('flags a component with neither a code nor a price', () => {
    const detail = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', '0.05')],
      [componentRow(1, { product_code: null, unit_price: null })]
    );
    expect(assemblyIntegrityIssues(detail).map((i) => i.code)).toContain(
      'component_without_price_source'
    );
  });

  it('flags a component carrying both a code and a price', () => {
    const detail = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', '0.05')],
      [componentRow(1, { product_code: 'CODE1', unit_price: '122' })]
    );
    expect(assemblyIntegrityIssues(detail).map((i) => i.code)).toContain(
      'component_with_conflicting_price_source'
    );
  });

  it('flags a missing or zero yield', () => {
    const detail = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', '0.05')],
      [componentRow(1, { coverage_yield: null }), componentRow(2, { coverage_yield: '0' })]
    );
    const yieldIssues = assemblyIntegrityIssues(detail).filter(
      (i) => i.code === 'component_without_yield'
    );
    expect(yieldIssues.map((i) => i.seq)).toEqual([1, 2]);
  });
});

describe('numeric mapping', () => {
  // PostgREST returns NUMERIC as a string. A yield arriving as "125" instead
  // of 125 would string-divide downstream in the costing engine.
  it('converts NUMERIC strings to numbers', () => {
    const detail = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', '0.05')],
      [componentRow(1)]
    );
    expect(detail.dayRatePerMan).toBe(224);
    expect(detail.laborBurdenPct).toBe(0.35);
    expect(detail.taxPct).toBe(0.07);
    expect(detail.quantityInputs[0].wastePct).toBe(0.05);
    expect(detail.components[0].coverageYield).toBe(125);
  });

  it('treats empty and unparseable numerics as null, not NaN or zero', () => {
    const detail = buildAssemblyDetail(
      assemblyRow({ day_rate_per_man: '', crew_size: null }),
      [inputRow(1, 'SF', '0.05')],
      [componentRow(1, { coverage_yield: 'n/a' })]
    );
    expect(detail.dayRatePerMan).toBeNull();
    expect(detail.crewSize).toBeNull();
    expect(detail.components[0].coverageYield).toBeNull();
  });

  it('defaults a missing waste % to zero rather than null', () => {
    const detail = buildAssemblyDetail(
      assemblyRow(),
      [{ ...inputRow(1, 'SF', '0.05'), waste_pct: null }],
      [componentRow(1)]
    );
    expect(detail.quantityInputs[0].wastePct).toBe(0);
  });
});

describe('margin chain', () => {
  it('preserves order — the chain is applied in sequence', () => {
    const chain = mapMarginChain([
      { name: 'Safety', rate: '0.02' },
      { name: 'Overhead', rate: '0.22' },
      { name: 'Profit', rate: '0.2' },
    ]);
    expect(chain.map((m) => m.name)).toEqual(['Safety', 'Overhead', 'Profit']);
    expect(chain.map((m) => m.rate)).toEqual([0.02, 0.22, 0.2]);
  });

  it('ignores malformed entries instead of producing NaN margins', () => {
    expect(mapMarginChain([null, 'nonsense', { rate: 0.2 }, { name: 'Profit', rate: 'x' }])).toEqual([
      { name: 'Profit', rate: 0 },
    ]);
    expect(mapMarginChain(undefined)).toEqual([]);
  });
});

describe('assembly-level integrity', () => {
  it('flags an assembly with no quantity inputs', () => {
    const detail = buildAssemblyDetail(assemblyRow(), [], [componentRow(1)]);
    expect(assemblyIntegrityIssues(detail).map((i) => i.code)).toContain(
      'assembly_without_quantity_inputs'
    );
  });

  it('flags a quantity input no component uses', () => {
    const detail = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF-Floor', '0.05'), inputRow(2, 'Sand (Optional)', '0.02')],
      [componentRow(1, { quantity_input_id: 'input-1' })]
    );
    const unused = assemblyIntegrityIssues(detail).filter((i) => i.code === 'quantity_input_unused');
    expect(unused).toHaveLength(1);
    expect(unused[0].seq).toBe(2);
  });

  it('does not attach another assembly\'s rows', () => {
    const detail = buildAssemblyDetail(
      assemblyRow(),
      [inputRow(1, 'SF', '0.05'), { ...inputRow(2, 'Other', '0.05'), assembly_id: 'other' }],
      [componentRow(1), { ...componentRow(2), assembly_id: 'other' }]
    );
    expect(detail.quantityInputs).toHaveLength(1);
    expect(detail.components).toHaveLength(1);
  });
});
