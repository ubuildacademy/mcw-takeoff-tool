/**
 * Company cost defaults: inheritance and override rules (task I10).
 *
 * The point of these rates living in one place is that raising the company day
 * rate reprices every assembly that has not deliberately overridden it. Two
 * things break that quietly, so both are pinned here: treating a NULL as zero
 * rather than "inherit", and storing every extracted value on import (which
 * would freeze 232 copies of the same number).
 */
import { describe, it, expect } from 'vitest';
import {
  CostDefaults,
  EMPTY_COST_DEFAULTS,
  overridesAgainstDefaults,
  resolveAssemblyCostSettings,
} from './assemblyLibrary';

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

function assembly(overrides: Record<string, unknown> = {}) {
  return {
    dayRatePerMan: null,
    laborBurdenPct: null,
    escalationPct: null,
    surchargePct: null,
    taxPct: null,
    marginChain: [],
    insuranceRatePerThousand: null,
    insuranceMarginPct: null,
    ...overrides,
  } as Parameters<typeof resolveAssemblyCostSettings>[0];
}

describe('resolveAssemblyCostSettings', () => {
  it('inherits every unset field from the company', () => {
    const resolved = resolveAssemblyCostSettings(assembly(), MCW);
    expect(resolved.dayRatePerMan).toBe(224);
    expect(resolved.laborBurdenPct).toBe(0.35);
    expect(resolved.taxPct).toBe(0.07);
    expect(resolved.marginChain).toEqual(MCW.marginChain);
    expect(resolved.insuranceRatePerThousand).toBe(79);
    expect(resolved.sources.dayRatePerMan).toBe('company');
  });

  it('lets an assembly override one field without disturbing the rest', () => {
    // The three real deviations in the library: $275 and $200 day rates, and a
    // $35/thousand insurance rate on one caulking sheet.
    const resolved = resolveAssemblyCostSettings(assembly({ dayRatePerMan: 275 }), MCW);
    expect(resolved.dayRatePerMan).toBe(275);
    expect(resolved.sources.dayRatePerMan).toBe('assembly');
    expect(resolved.laborBurdenPct).toBe(0.35);
    expect(resolved.sources.laborBurdenPct).toBe('company');
  });

  it('treats an explicit zero as an override, not an absence', () => {
    // A job with no escalation must be able to say so rather than silently
    // picking up the company's 3%.
    const resolved = resolveAssemblyCostSettings(assembly({ escalationPct: 0 }), MCW);
    expect(resolved.escalationPct).toBe(0);
    expect(resolved.sources.escalationPct).toBe('assembly');
  });

  it('inherits the margin chain only when the assembly has none', () => {
    const inherited = resolveAssemblyCostSettings(assembly(), MCW);
    expect(inherited.marginChain).toEqual(MCW.marginChain);

    const own = [{ name: 'Profit', rate: 0.1 }];
    const overridden = resolveAssemblyCostSettings(assembly({ marginChain: own }), MCW);
    expect(overridden.marginChain).toEqual(own);
    expect(overridden.sources.marginChain).toBe('assembly');
  });

  it('reports a field as unset when neither side has it', () => {
    const resolved = resolveAssemblyCostSettings(assembly(), EMPTY_COST_DEFAULTS);
    expect(resolved.dayRatePerMan).toBeNull();
    expect(resolved.sources.dayRatePerMan).toBe('unset');
    // Null must stay null rather than becoming zero — a missing day rate is a
    // gap to surface, not free labor.
    expect(resolved.laborBurdenPct).toBeNull();
  });

  it('raising the company rate reprices everything that did not override it', () => {
    const inheriting = assembly();
    const overriding = assembly({ dayRatePerMan: 275 });
    const raised: CostDefaults = { ...MCW, dayRatePerMan: 240 };

    expect(resolveAssemblyCostSettings(inheriting, raised).dayRatePerMan).toBe(240);
    expect(resolveAssemblyCostSettings(overriding, raised).dayRatePerMan).toBe(275);
  });
});

describe('overridesAgainstDefaults', () => {
  it('stores nothing when the workbook matches the company', () => {
    expect(overridesAgainstDefaults({ ...MCW }, MCW)).toEqual({});
  });

  it('stores only the fields that genuinely differ', () => {
    const extracted = { ...MCW, dayRatePerMan: 275, taxPct: 0.07 };
    expect(overridesAgainstDefaults(extracted, MCW)).toEqual({ dayRatePerMan: 275 });
  });

  it('ignores spreadsheet float noise', () => {
    // Excel stores 7% as 0.07000000000000001; an exact comparison would call
    // that an override on every import and defeat the whole mechanism.
    expect(overridesAgainstDefaults({ taxPct: 0.07000000000000001 }, MCW)).toEqual({});
  });

  it('stores an explicit zero that differs from the default', () => {
    expect(overridesAgainstDefaults({ escalationPct: 0 }, MCW)).toEqual({ escalationPct: 0 });
  });

  it('skips fields the workbook did not provide', () => {
    // A missing day rate must not be recorded as an override of null.
    expect(overridesAgainstDefaults({ dayRatePerMan: null, taxPct: 0.07 }, MCW)).toEqual({});
  });

  it('stores a margin chain only when it actually differs', () => {
    expect(overridesAgainstDefaults({ marginChain: MCW.marginChain }, MCW)).toEqual({});

    const different = [
      { name: 'Safety', rate: 0.02 },
      { name: 'Over Head', rate: 0.17 },
      { name: 'Profit', rate: 0.18 },
    ];
    expect(overridesAgainstDefaults({ marginChain: different }, MCW)).toEqual({
      marginChain: different,
    });
  });

  it('stores everything when the company has no defaults yet', () => {
    const overrides = overridesAgainstDefaults({ dayRatePerMan: 224, taxPct: 0.07 }, EMPTY_COST_DEFAULTS);
    expect(overrides).toEqual({ dayRatePerMan: 224, taxPct: 0.07 });
  });
});
