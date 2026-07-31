import { describe, it, expect } from 'vitest';
import {
  buildConditionsFromAssembly,
  resolveConditionUnit,
  uniqueConditionName,
} from './assemblyConditionTemplate';
import type { AssemblyDetail, AssemblyQuantityInput } from '../services/apiService';

function input(overrides: Partial<AssemblyQuantityInput> & { id: string; name: string }): AssemblyQuantityInput {
  return { seq: 1, unit: 'SF', wastePct: 0.1, ...overrides };
}

function assembly(overrides: Partial<AssemblyDetail> = {}): AssemblyDetail {
  return {
    id: 'asm-1',
    name: 'Aquafin 2K',
    crewSize: 2,
    dayRatePerMan: 224,
    createdAt: '2026-07-31T00:00:00.000Z',
    quantityInputs: [input({ id: 'in-1', name: 'Job Quantity' })],
    components: [],
    ...overrides,
  };
}

const options = {
  existingNames: [] as string[],
  existingColors: [] as string[],
  pickColor: (existing: string[]) => `#00000${existing.length}`,
};

describe('resolveConditionUnit', () => {
  it('maps the workbook units to measurement types', () => {
    expect(resolveConditionUnit('SF')).toEqual({ type: 'area', unit: 'SF', recognized: true });
    expect(resolveConditionUnit('lf')).toEqual({ type: 'linear', unit: 'LF', recognized: true });
    expect(resolveConditionUnit('EA')).toEqual({ type: 'count', unit: 'EA', recognized: true });
    expect(resolveConditionUnit('CY')).toEqual({ type: 'volume', unit: 'CY', recognized: true });
  });

  it('normalises aliases to the canonical unit', () => {
    expect(resolveConditionUnit(' sq ft ')).toEqual({ type: 'area', unit: 'SF', recognized: true });
    expect(resolveConditionUnit('EACH')).toEqual({ type: 'count', unit: 'EA', recognized: true });
  });

  it('keeps an unknown unit but flags it rather than guessing silently', () => {
    expect(resolveConditionUnit('GAL')).toEqual({ type: 'area', unit: 'GAL', recognized: false });
  });

  it('falls back to SF when the assembly records no unit at all', () => {
    expect(resolveConditionUnit(null)).toEqual({ type: 'area', unit: 'SF', recognized: false });
  });
});

describe('uniqueConditionName', () => {
  it('returns the name unchanged when it is free', () => {
    expect(uniqueConditionName('Aquafin 2K', new Set())).toBe('Aquafin 2K');
  });

  it('suffixes past every taken variant', () => {
    const taken = new Set(['aquafin 2k', 'aquafin 2k (2)']);
    expect(uniqueConditionName('Aquafin 2K', taken)).toBe('Aquafin 2K (3)');
  });

  it('compares case-insensitively', () => {
    expect(uniqueConditionName('Aquafin 2K', new Set(['AQUAFIN 2K']))).toBe('Aquafin 2K (2)');
  });
});

describe('buildConditionsFromAssembly', () => {
  it('wires a single-quantity assembly to one ready-to-price condition', () => {
    const { drafts } = buildConditionsFromAssembly(assembly(), options);

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      name: 'Aquafin 2K',
      type: 'area',
      unit: 'SF',
      assemblyId: 'asm-1',
      assemblyQuantityInputId: 'in-1',
    });
  });

  it('names one condition per quantity input when the assembly prices several', () => {
    const { drafts } = buildConditionsFromAssembly(
      assembly({
        quantityInputs: [
          input({ id: 'in-1', name: 'SF-Floor' }),
          input({ id: 'in-2', name: 'LF-Cove', unit: 'LF' }),
        ],
      }),
      options
    );

    expect(drafts.map((d) => d.name)).toEqual(['Aquafin 2K — SF-Floor', 'Aquafin 2K — LF-Cove']);
    expect(drafts.map((d) => d.assemblyQuantityInputId)).toEqual(['in-1', 'in-2']);
    expect(drafts[1].type).toBe('linear');
  });

  it('leaves waste at zero so the assembly stays the only source of it', () => {
    const { drafts } = buildConditionsFromAssembly(assembly(), options);
    expect(drafts[0].wasteFactor).toBe(0);
  });

  it('does not collide with a condition the project already has', () => {
    const { drafts } = buildConditionsFromAssembly(assembly(), {
      ...options,
      existingNames: ['aquafin 2k'],
    });
    expect(drafts[0].name).toBe('Aquafin 2K (2)');
  });

  it('gives each new condition a colour distinct from the project and from each other', () => {
    const { drafts } = buildConditionsFromAssembly(
      assembly({
        quantityInputs: [input({ id: 'in-1', name: 'A' }), input({ id: 'in-2', name: 'B' })],
      }),
      { ...options, existingColors: ['#ff0000'] }
    );
    expect(drafts.map((d) => d.color)).toEqual(['#000001', '#000002']);
  });

  it('reports the inputs whose unit it could not map', () => {
    const { drafts, unrecognizedUnits } = buildConditionsFromAssembly(
      assembly({
        quantityInputs: [
          input({ id: 'in-1', name: 'Deck', unit: 'SF' }),
          input({ id: 'in-2', name: 'Primer', unit: 'GAL' }),
        ],
      }),
      options
    );

    expect(unrecognizedUnits).toEqual(['Primer']);
    expect(drafts[1].unit).toBe('GAL');
  });
});
