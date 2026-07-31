import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AssemblyPriceResponse } from '../../services/apiService';

const price = vi.fn();

vi.mock('../../services/apiService', () => ({
  assemblyLibraryService: {
    price: (...args: unknown[]) => price(...args),
  },
}));

import { useAssemblyPricingStore } from './assemblyPricingSlice';

const response = (total: number, conditionTotals: Record<string, number> = {}) =>
  ({
    pricings: Object.entries(conditionTotals).map(([conditionId, conditionTotal]) => ({
      conditionId,
      breakdown: { total: conditionTotal },
    })),
    totals: { total },
    unknownAssemblyIds: [],
  }) as unknown as AssemblyPriceResponse;

const items = [
  { conditionId: 'c1', assemblyId: 'a1', quantityInputId: 'q1', quantity: 10 },
];

describe('assembly pricing store', () => {
  beforeEach(() => {
    price.mockReset();
    useAssemblyPricingStore.setState({ byProject: {} });
  });

  it('prices once for two callers asking the same question in the same tick', async () => {
    price.mockResolvedValue(response(500));
    const { priceProject } = useAssemblyPricingStore.getState();

    await Promise.all([
      priceProject('p1', items, 'sig-1'),
      priceProject('p1', items, 'sig-1'),
    ]);

    expect(price).toHaveBeenCalledTimes(1);
    expect(useAssemblyPricingStore.getState().getAssemblyTotal('p1')).toBe(500);
  });

  it('re-prices when the takeoff moves', async () => {
    price.mockResolvedValueOnce(response(500)).mockResolvedValueOnce(response(750));
    const { priceProject } = useAssemblyPricingStore.getState();

    await priceProject('p1', items, 'sig-1');
    await priceProject('p1', items, 'sig-2');

    expect(price).toHaveBeenCalledTimes(2);
    expect(useAssemblyPricingStore.getState().getAssemblyTotal('p1')).toBe(750);
  });

  it('ignores a slow response that a newer request has already superseded', async () => {
    let resolveSlow: (value: AssemblyPriceResponse) => void = () => {};
    price
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSlow = resolve; }))
      .mockResolvedValueOnce(response(750));
    const { priceProject } = useAssemblyPricingStore.getState();

    const slow = priceProject('p1', items, 'sig-1');
    await priceProject('p1', items, 'sig-2');
    resolveSlow(response(500));
    await slow;

    expect(useAssemblyPricingStore.getState().getAssemblyTotal('p1')).toBe(750);
  });

  it('keeps the last good total when a refresh fails, and reports the error', async () => {
    price.mockResolvedValueOnce(response(500)).mockRejectedValueOnce(new Error('engine down'));
    const { priceProject } = useAssemblyPricingStore.getState();

    await priceProject('p1', items, 'sig-1');
    await priceProject('p1', items, 'sig-2');

    const entry = useAssemblyPricingStore.getState().getEntry('p1');
    expect(entry.error).toContain('engine down');
    expect(useAssemblyPricingStore.getState().getAssemblyTotal('p1')).toBe(500);
  });

  it('clears the total when the last assembly-linked condition goes away', async () => {
    price.mockResolvedValue(response(500, { c1: 500 }));
    const { priceProject } = useAssemblyPricingStore.getState();

    await priceProject('p1', items, 'sig-1');
    await priceProject('p1', [], '');

    expect(useAssemblyPricingStore.getState().getAssemblyTotal('p1')).toBe(0);
    expect(useAssemblyPricingStore.getState().getConditionTotals('p1')).toEqual({});
  });

  it('exposes per-condition totals so exports can drop hidden conditions', async () => {
    price.mockResolvedValue(response(800, { c1: 500, c2: 300 }));

    await useAssemblyPricingStore.getState().priceProject('p1', items, 'sig-1');

    expect(useAssemblyPricingStore.getState().getConditionTotals('p1')).toEqual({
      c1: 500,
      c2: 300,
    });
  });
});
