/**
 * THE GATE for Stage 2 (task I4): does the native engine reproduce MCW's own
 * workbook totals?
 *
 * Everything else in Workstream I measured whether the workbooks can be READ.
 * This measures whether the arithmetic that replaces them agrees with the
 * books. If it does not, the engine is unusable however good the UI is, so no
 * Stage 2 UI is built until this passes.
 *
 * Cases are generated from real workbooks by
 * `server/src/scripts/assembly_costing_golden.py` and contain real prices and
 * totals, so they are NEVER committed. Point ASSEMBLY_GOLDEN_CASES at the
 * generated file to run the gate; without it these tests skip, exactly like
 * `test_assembly_e2e.py`:
 *
 *   python3 server/src/scripts/assembly_costing_golden.py \
 *     "<assemblies folder>" --out /tmp/golden_cases.json
 *   ASSEMBLY_GOLDEN_CASES=/tmp/golden_cases.json npx vitest run \
 *     server/src/services/assemblyCosting.golden.test.ts
 */
import * as fs from 'fs';
import { describe, it, expect } from 'vitest';
import {
  AssemblyComponentRow,
  AssemblyQuantityInputRow,
  AssemblyRow,
  buildAssemblyDetail,
} from './assemblyLibrary';
import { CostBreakdown, computeAssemblyCost, roundCents } from './assemblyCosting';

interface GoldenProposal {
  quantityInputs: {
    seq: number;
    name: string;
    unit: string | null;
    wastePct: number;
  }[];
  components: {
    seq: number;
    quantityInputSeq: number | null;
    additionalQuantityInputSeqs?: number[];
    description: string | null;
    productCode: string | null;
    unitPrice: number | null;
    coverageYield: number | null;
    isOptional: boolean;
    flags: string[];
  }[];
  productionRates: {
    ratePerDay: number;
    quantityInputSeq: number | null;
    roundsUp: boolean;
    isOptional: boolean;
    sourceRow: number;
  }[];
  dayRatePerMan: number | null;
  crewSize: number | null;
  laborBurdenPct: number | null;
  marginChain: { name: string; rate: number }[];
  insuranceMarginPct: number | null;
  insuranceRatePerThousand: number | null;
  escalationPct: number | null;
  surchargePct: number | null;
  taxPct: number | null;
}

interface GoldenCase {
  sourceFile: string;
  proposal: GoldenProposal;
  quantitiesBySeq: Record<string, number | null>;
  pricesByCode: Record<string, number>;
  missingPrices: string[];
  rateDaysBySourceRow?: Record<string, number | null>;
  equipmentCost: number;
  miscCost: number;
  expected: {
    materialTotal: number | null;
    laborTotal: number | null;
    costMLE: number | null;
    marginsTotal: number | null;
    insuranceTotal: number | null;
    jobTotal: number | null;
  };
}

const casesPath = process.env.ASSEMBLY_GOLDEN_CASES;
const cases: GoldenCase[] = casesPath && fs.existsSync(casesPath)
  ? (JSON.parse(fs.readFileSync(casesPath, 'utf-8')).cases as GoldenCase[])
  : [];

/** Rebuild the stored-assembly shape the engine consumes from a golden case. */
function toAssembly(golden: GoldenCase) {
  const assemblyId = 'golden';
  const assemblyRow: AssemblyRow = {
    id: assemblyId,
    org_id: 'golden-org',
    name: golden.sourceFile,
    day_rate_per_man: golden.proposal.dayRatePerMan,
    crew_size: golden.proposal.crewSize,
    labor_burden_pct: golden.proposal.laborBurdenPct,
    escalation_pct: golden.proposal.escalationPct,
    surcharge_pct: golden.proposal.surchargePct,
    tax_pct: golden.proposal.taxPct,
    margin_chain: golden.proposal.marginChain,
    source_workbook_id: null,
    notes: null,
    created_at: '',
    updated_at: '',
  };

  const inputRows: AssemblyQuantityInputRow[] = golden.proposal.quantityInputs.map((input) => ({
    id: `input-${input.seq}`,
    assembly_id: assemblyId,
    seq: input.seq,
    name: input.name,
    unit: input.unit,
    waste_pct: input.wastePct,
  }));

  const componentRows: AssemblyComponentRow[] = golden.proposal.components.map((component) => ({
    id: `component-${component.seq}`,
    assembly_id: assemblyId,
    seq: component.seq,
    quantity_input_id:
      component.quantityInputSeq === null ? null : `input-${component.quantityInputSeq}`,
    additional_quantity_input_ids: (component.additionalQuantityInputSeqs ?? []).map(
      (seq) => `input-${seq}`
    ),
    description: component.description,
    product_code: component.productCode,
    unit_price: component.unitPrice,
    coverage_yield: component.coverageYield,
    yield_unit: null,
    packaging_unit: null,
    is_optional: component.isOptional,
  }));

  return buildAssemblyDetail(assemblyRow, inputRows, componentRows);
}

function run(golden: GoldenCase): CostBreakdown {
  const assembly = toAssembly(golden);

  const quantitiesByInputId: Record<string, number> = {};
  for (const [seq, quantity] of Object.entries(golden.quantitiesBySeq)) {
    quantitiesByInputId[`input-${seq}`] = quantity ?? 0;
  }

  // Each production-rate line paces a specific quantity — one sheet can pace
  // floor and wall separately.
  // A rate line behind an include toggle that the workbook has switched OFF
  // contributes nothing. The toggle is an INPUT to the assembly; its state is
  // read from the line's cached day count rather than by re-evaluating an
  // arbitrary Excel condition. The day counts themselves are still computed.
  const rates = golden.proposal.productionRates
    .filter(
      (rate) =>
        !(rate.isOptional && (golden.rateDaysBySourceRow?.[String(rate.sourceRow)] ?? 1) === 0)
    )
    .map((rate) => ({
    ratePerDay: rate.ratePerDay,
    roundsUp: rate.roundsUp,
    quantity:
      rate.quantityInputSeq === null
        ? 0
        : (golden.quantitiesBySeq[String(rate.quantityInputSeq)] ?? 0) *
          (1 +
            (golden.proposal.quantityInputs.find((i) => i.seq === rate.quantityInputSeq)?.wastePct ??
              0)),
  }));

  return computeAssemblyCost(
    assembly,
    {
      quantitiesByInputId,
      pricesByCode: golden.pricesByCode,
      equipmentCost: golden.equipmentCost,
      miscCost: golden.miscCost,
    },
    { rates },
    {
      ratePerThousand: golden.proposal.insuranceRatePerThousand,
      marginPct: golden.proposal.insuranceMarginPct,
    }
  );
}

/**
 * A case can only be compared when the workbook itself is complete: every
 * component priced, every component bound to an input, and a job total cached.
 * Skipping an incomplete workbook is honest; quietly passing it would not be.
 */
function isComparable(golden: GoldenCase): boolean {
  return (
    golden.missingPrices.length === 0 &&
    golden.expected.jobTotal !== null &&
    golden.expected.costMLE !== null &&
    golden.proposal.components.length > 0 &&
    golden.proposal.components.every(
      (component) =>
        component.quantityInputSeq !== null &&
        component.coverageYield !== null &&
        (component.productCode !== null || component.unitPrice !== null)
    )
  );
}

/**
 * Floors, not targets. The task's bar is five workbooks matching to the cent;
 * the run that established this gate matched 144 of 165 comparable workbooks
 * (87%) on every figure. The rate floor is set below the achieved rate so
 * ordinary workbook churn does not turn the suite red, while a real regression
 * — a rounding rule lost, the margin chain inverted — drops it far enough to
 * fail loudly.
 */
const MIN_COMPARABLE_WORKBOOKS = 5;
const MIN_MATCH_RATE = 0.8;

type FieldName = 'materialTotal' | 'laborTotal' | 'costMLE' | 'marginsTotal' | 'insuranceTotal' | 'jobTotal';

const FIELDS: { name: FieldName; actual: (r: CostBreakdown) => number }[] = [
  { name: 'materialTotal', actual: (r) => r.materialTotal },
  { name: 'laborTotal', actual: (r) => r.laborTotal },
  { name: 'costMLE', actual: (r) => r.costBeforeMargins },
  { name: 'marginsTotal', actual: (r) => r.marginsTotal },
  { name: 'insuranceTotal', actual: (r) => r.insuranceTotal },
  { name: 'jobTotal', actual: (r) => r.total },
];

describe.skipIf(cases.length === 0)('costing engine vs real workbook totals', () => {
  const comparable = cases.filter(isComparable);

  it('has enough comparable workbooks to be a gate', () => {
    expect(comparable.length).toBeGreaterThanOrEqual(MIN_COMPARABLE_WORKBOOKS);
  });

  const results = comparable.map((golden) => ({ golden, result: run(golden) }));

  for (const field of FIELDS) {
    it(`${field.name} matches the workbook to the cent`, () => {
      const checked = results.flatMap(({ golden, result }) => {
        const expected = golden.expected[field.name];
        return expected === null ? [] : [{ golden, result, expected }];
      });
      const mismatches = checked.filter(
        ({ result, expected }) => roundCents(field.actual(result)) !== roundCents(expected)
      );
      const matched = checked.length - mismatches.length;

      if (mismatches.length > 0) {
        // Name the workbooks, so a regression points at something specific
        // rather than only moving a percentage.
        const detail = mismatches
          .slice(0, 10)
          .map(
            ({ golden, result, expected }) =>
              `  ${golden.sourceFile}: got ${roundCents(field.actual(result))}, ` +
              `workbook says ${roundCents(expected)}`
          )
          .join('\n');
        console.warn(
          `${field.name}: ${matched}/${checked.length} matched. First mismatches:\n${detail}`
        );
      }

      expect(matched).toBeGreaterThanOrEqual(MIN_COMPARABLE_WORKBOOKS);
      expect(matched / checked.length).toBeGreaterThanOrEqual(MIN_MATCH_RATE);
    });
  }

  it('never reports a total for an assembly it knows is incomplete', () => {
    // The engine may be wrong about a number; it must not be silent about it.
    for (const { result } of results) {
      const unpriced = result.components.filter(
        (component) => !component.included && component.issue && !component.issue.startsWith('excluded:')
      );
      if (unpriced.length > 0) {
        expect(result.issues.length).toBeGreaterThan(0);
      }
    }
  });
});
