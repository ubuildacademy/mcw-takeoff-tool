/**
 * Proposal → records shaping (task I5).
 *
 * Two rules carry the task and both fail silently if wrong: storing a value
 * that matches the company default (which would freeze 232 copies of it), and
 * dropping a component the extractor could not fully resolve (which would
 * under-price an assembly while looking complete).
 */
import { describe, it, expect } from 'vitest';
import { CostDefaults, EMPTY_COST_DEFAULTS } from './assemblyLibrary';
import {
  AssemblyProposalInput,
  buildAssemblyRecords,
  inferQuantityRule,
} from './assemblyImport';

const MCW: CostDefaults = {
  dayRatePerMan: 224,
  laborBurdenPct: 0.35,
  escalationPct: 0.03,
  surchargePct: 0,
  taxPct: 0.07,
  marginChain: [
    { name: 'Safety', rate: 0.02 },
    { name: 'Over Head', rate: 0.22 },
    { name: 'Profit', rate: 0.2 },
  ],
  insuranceRatePerThousand: 79,
  insuranceMarginPct: 0.15,
};

function proposal(overrides: Partial<AssemblyProposalInput> = {}): AssemblyProposalInput {
  return {
    name: 'Aquafin-2K M',
    quantityInputs: [{ seq: 1, name: 'SF', unit: 'SF', wastePct: 0.05 }],
    components: [
      {
        seq: 1,
        quantityInputSeq: 1,
        description: 'Aquafin 2K/M',
        productCode: 'AQU2KMG46',
        unitPrice: null,
        coverageYield: 125,
        yieldUnit: 'SF/bag',
        packagingUnit: 'lb/bag',
        isOptional: false,
        flags: [],
      },
    ],
    productionRates: [
      { description: 'Membrane', ratePerDay: 800, unit: 'SF/Day', quantityInputSeq: 1, roundsUp: true },
    ],
    dayRatePerMan: 224,
    crewSize: 2,
    laborBurdenPct: 0.35,
    marginChain: MCW.marginChain,
    insuranceRatePerThousand: 79,
    insuranceMarginPct: 0.15,
    escalationPct: 0.03,
    surchargePct: 0,
    taxPct: 0.07,
    flags: [],
    ...overrides,
  };
}

describe('storing only what differs', () => {
  it('stores no rates at all when the workbook matches the company', () => {
    const records = buildAssemblyRecords(proposal(), MCW);
    expect(records.assembly.overrides).toEqual({});
  });

  it('stores just the field that differs', () => {
    // The three real deviations in MCW's library are day rates of 275 and 200,
    // and one $35/thousand insurance rate.
    const records = buildAssemblyRecords(proposal({ dayRatePerMan: 275 }), MCW);
    expect(records.assembly.overrides).toEqual({ dayRatePerMan: 275 });
  });

  it('stores everything when the company has no defaults yet', () => {
    const records = buildAssemblyRecords(proposal(), EMPTY_COST_DEFAULTS);
    expect(records.assembly.overrides.dayRatePerMan).toBe(224);
    expect(records.assembly.overrides.taxPct).toBe(0.07);
  });

  it('keeps crew size on the assembly — it is never a company default', () => {
    const records = buildAssemblyRecords(proposal({ crewSize: 3 }), MCW);
    expect(records.assembly.crewSize).toBe(3);
    expect(records.assembly.overrides).toEqual({});
  });
});

describe('components', () => {
  it('preserves two coats of the same product as two rows', () => {
    const records = buildAssemblyRecords(
      proposal({
        components: [
          { ...proposal().components[0], seq: 1, coverageYield: 125 },
          { ...proposal().components[0], seq: 2, coverageYield: 90 },
        ],
      }),
      MCW
    );
    expect(records.components).toHaveLength(2);
    expect(records.components.map((c) => c.coverageYield)).toEqual([125, 90]);
  });

  it('never stores both a product code and a price', () => {
    // The extractor keeps the code when a workbook's lookup was flattened to a
    // pasted value; the product list reprices it, so the stale literal is
    // dropped. The schema's CHECK constraint enforces this too.
    const records = buildAssemblyRecords(
      proposal({
        components: [{ ...proposal().components[0], productCode: 'AQU2KMG46', unitPrice: 117.55 }],
      }),
      MCW
    );
    expect(records.components[0].productCode).toBe('AQU2KMG46');
    expect(records.components[0].unitPrice).toBeNull();
  });

  it('keeps a hand-priced component with no code', () => {
    const records = buildAssemblyRecords(
      proposal({
        components: [{ ...proposal().components[0], productCode: null, unitPrice: 122 }],
      }),
      MCW
    );
    expect(records.components[0].unitPrice).toBe(122);
    expect(records.blockers).toEqual([]);
  });

  it('carries multi-input bindings through', () => {
    const records = buildAssemblyRecords(
      proposal({
        quantityInputs: [
          { seq: 1, name: 'SF-Floor', unit: 'SF', wastePct: 0.17 },
          { seq: 2, name: 'Piles', unit: 'SF', wastePct: 0.05 },
        ],
        components: [
          { ...proposal().components[0], quantityInputSeq: 1, additionalQuantityInputSeqs: [2] },
        ],
      }),
      MCW
    );
    expect(records.components[0].additionalQuantityInputSeqs).toEqual([2]);
  });

  it('keeps its import flags', () => {
    const records = buildAssemblyRecords(
      proposal({
        components: [
          { ...proposal().components[0], flags: ['price lookup was replaced by a pasted value'] },
        ],
      }),
      MCW
    );
    expect(records.components[0].importFlags).toEqual([
      'price lookup was replaced by a pasted value',
    ]);
  });
});

describe('quantity rules', () => {
  it('uses coverage yield when there is one', () => {
    expect(inferQuantityRule({ ...proposal().components[0], coverageYield: 125 })).toBe(
      'coverage_yield'
    );
  });

  it('marks a component with no usable yield as manual rather than dropping it', () => {
    // The 26 rows across the library whose quantity copies another line or
    // reads a helper cell. Storing them unpriceable-but-visible beats losing
    // them: a missing component under-prices an assembly that looks complete.
    expect(inferQuantityRule({ ...proposal().components[0], coverageYield: null })).toBe('manual');
    expect(inferQuantityRule({ ...proposal().components[0], coverageYield: 0 })).toBe('manual');
  });

  it('blocks on a manual rule so it cannot be quoted unnoticed', () => {
    const records = buildAssemblyRecords(
      proposal({
        components: [
          { ...proposal().components[0], coverageYield: null, description: 'Preprufe Tape HC' },
        ],
      }),
      MCW
    );
    expect(records.components[0].quantityRule).toBe('manual');
    expect(records.blockers.join(' ')).toContain('Preprufe Tape HC');
  });
});

describe('production rates', () => {
  it('drops placeholder lines with no rate', () => {
    // Workbooks carry empty rows like "Surface Prep" at 0 SF/day.
    const records = buildAssemblyRecords(
      proposal({
        productionRates: [
          { description: 'Surface Prep', ratePerDay: 0, unit: 'SF/Day', quantityInputSeq: 1, roundsUp: true },
          { description: 'Membrane', ratePerDay: 800, unit: 'SF/Day', quantityInputSeq: 1, roundsUp: true },
        ],
      }),
      MCW
    );
    expect(records.productionRates).toHaveLength(1);
    expect(records.productionRates[0].description).toBe('Membrane');
    expect(records.productionRates[0].seq).toBe(1);
  });

  it('preserves per-line rounding and the input each line paces', () => {
    const records = buildAssemblyRecords(
      proposal({
        quantityInputs: [
          { seq: 1, name: 'SF-Floor', unit: 'SF', wastePct: 0.05 },
          { seq: 2, name: 'LF', unit: 'LF', wastePct: 0.05 },
        ],
        productionRates: [
          { description: 'Floor', ratePerDay: 700, unit: 'SF/Day', quantityInputSeq: 1, roundsUp: false },
          { description: 'Joints', ratePerDay: 350, unit: 'LF/Day', quantityInputSeq: 2, roundsUp: true },
        ],
      }),
      MCW
    );
    expect(records.productionRates.map((r) => r.roundsUp)).toEqual([false, true]);
    expect(records.productionRates.map((r) => r.quantityInputSeq)).toEqual([1, 2]);
  });
});

describe('blockers', () => {
  it('is empty for a clean assembly', () => {
    expect(buildAssemblyRecords(proposal(), MCW).blockers).toEqual([]);
  });

  it('flags a component bound to nothing', () => {
    const records = buildAssemblyRecords(
      proposal({ components: [{ ...proposal().components[0], quantityInputSeq: null }] }),
      MCW
    );
    expect(records.blockers.join(' ')).toContain('not bound to a quantity input');
  });

  it('flags a component bound to an input that does not exist', () => {
    const records = buildAssemblyRecords(
      proposal({ components: [{ ...proposal().components[0], quantityInputSeq: 99 }] }),
      MCW
    );
    expect(records.blockers.join(' ')).toContain('not bound to a quantity input');
  });

  it('flags an assembly with no components or inputs', () => {
    const records = buildAssemblyRecords(
      proposal({ quantityInputs: [], components: [] }),
      MCW
    );
    expect(records.blockers).toHaveLength(2);
  });

  it('flags a component with neither a code nor a price', () => {
    const records = buildAssemblyRecords(
      proposal({
        components: [{ ...proposal().components[0], productCode: null, unitPrice: null }],
      }),
      MCW
    );
    expect(records.blockers.join(' ')).toContain('no product code and no price');
  });
});
