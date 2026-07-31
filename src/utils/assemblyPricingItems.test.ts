import { describe, it, expect } from 'vitest';
import { buildAssemblyPriceItems, assemblyPricingSignature } from './assemblyPricingItems';

const condition = (over: Partial<Parameters<typeof buildAssemblyPriceItems>[0][number]> = {}) => ({
  id: 'c1',
  assemblyId: 'a1',
  assemblyQuantityInputId: 'q1',
  ...over,
});

describe('buildAssemblyPriceItems', () => {
  it('skips conditions that are not linked to an assembly quantity input', () => {
    const items = buildAssemblyPriceItems(
      [
        condition({ id: 'linked' }),
        condition({ id: 'noAssembly', assemblyId: null }),
        condition({ id: 'noInput', assemblyQuantityInputId: null }),
      ],
      []
    );
    expect(items.map((i) => i.conditionId)).toEqual(['linked']);
  });

  it('prefers the net value over the gross one and sums a condition’s measurements', () => {
    const [item] = buildAssemblyPriceItems(
      [condition()],
      [
        { conditionId: 'c1', calculatedValue: 100, netCalculatedValue: 90 },
        { conditionId: 'c1', calculatedValue: 10, netCalculatedValue: null },
        { conditionId: 'other', calculatedValue: 999, netCalculatedValue: 999 },
      ]
    );
    expect(item.quantity).toBe(100);
  });

  it('applies the condition multiplier but never its waste factor', () => {
    const [item] = buildAssemblyPriceItems(
      [{ ...condition(), multiplier: 2, wasteFactor: 10 } as never],
      [{ conditionId: 'c1', calculatedValue: 50, netCalculatedValue: 50 }]
    );
    expect(item.quantity).toBe(100);
  });
});

describe('assemblyPricingSignature', () => {
  it('is stable for the same quantities and changes when one moves', () => {
    const items = buildAssemblyPriceItems(
      [condition()],
      [{ conditionId: 'c1', calculatedValue: 50, netCalculatedValue: 50 }]
    );
    const moved = buildAssemblyPriceItems(
      [condition()],
      [{ conditionId: 'c1', calculatedValue: 50, netCalculatedValue: 50.5 }]
    );
    expect(assemblyPricingSignature(items)).toBe(assemblyPricingSignature(items));
    expect(assemblyPricingSignature(items)).not.toBe(assemblyPricingSignature(moved));
  });

  it('is empty when nothing is linked, which is what callers treat as "no request"', () => {
    expect(assemblyPricingSignature([])).toBe('');
  });
});
