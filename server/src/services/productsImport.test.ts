/**
 * Import-diff rules. The counts an import reports are the only signal the user
 * gets that it did the right thing, so they are tested rather than assumed.
 */
import { describe, it, expect } from 'vitest';
import {
  ExistingProduct,
  ImportedProduct,
  PRICE_TOLERANCE,
  diffProducts,
  productChanged,
} from './productsImport';

function incoming(overrides: Partial<ImportedProduct> = {}): ImportedProduct {
  return {
    code: 'AQU2KMG46',
    item: '604581',
    description: 'Aquafin 2K/M Standard gray',
    netPrice: 46.25,
    priceDate: '2026-07-17',
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingProduct> = {}): ExistingProduct {
  return { ...incoming(), ...overrides };
}

describe('diffProducts', () => {
  it('classifies new, changed and unchanged rows', () => {
    const result = diffProducts(
      [existing({ code: 'A' }), existing({ code: 'B', netPrice: 10 })],
      [
        incoming({ code: 'A' }),
        incoming({ code: 'B', netPrice: 12 }),
        incoming({ code: 'C' }),
      ]
    );

    expect(result.toInsert.map((p) => p.code)).toEqual(['C']);
    expect(result.toUpdate.map((p) => p.code)).toEqual(['B']);
    expect(result.unchangedCount).toBe(1);
  });

  // Re-importing the same export must be a no-op — the success criterion for
  // this task, and the thing that tells the user nothing moved.
  it('reports a re-import of an identical file as entirely unchanged', () => {
    const rows = [
      incoming({ code: 'A' }),
      incoming({ code: 'B', netPrice: 10.5 }),
      incoming({ code: 'C', netPrice: null, description: null }),
    ];
    const result = diffProducts(rows.map((row) => ({ ...row })), rows);

    expect(result.toInsert).toHaveLength(0);
    expect(result.toUpdate).toHaveLength(0);
    expect(result.unchangedCount).toBe(3);
  });

  it('never deletes codes that are absent from the file', () => {
    const result = diffProducts([existing({ code: 'GONE' })], [incoming({ code: 'A' })]);
    expect(result.toInsert.map((p) => p.code)).toEqual(['A']);
    expect(result.toUpdate).toHaveLength(0);
    // 'GONE' is simply not mentioned — a partial price list must not empty the
    // catalogue.
    expect(result.unchangedCount).toBe(0);
  });
});

describe('productChanged', () => {
  it('ignores price differences below the tolerance', () => {
    const before = existing({ netPrice: 46.25 });
    expect(productChanged(incoming({ netPrice: 46.25 + PRICE_TOLERANCE / 2 }), before)).toBe(false);
    expect(productChanged(incoming({ netPrice: 46.26 }), before)).toBe(true);
  });

  it('ignores whitespace and null-vs-empty differences in text', () => {
    expect(
      productChanged(incoming({ description: '  Aquafin 2K/M Standard gray ' }), existing())
    ).toBe(false);
    expect(productChanged(incoming({ item: null }), existing({ item: '' }))).toBe(false);
  });

  it('treats a price appearing or disappearing as a change', () => {
    expect(productChanged(incoming({ netPrice: null }), existing({ netPrice: 46.25 }))).toBe(true);
    expect(productChanged(incoming({ netPrice: 46.25 }), existing({ netPrice: null }))).toBe(true);
    expect(productChanged(incoming({ netPrice: null }), existing({ netPrice: null }))).toBe(false);
  });

  it('detects a changed price date even when the price is the same', () => {
    expect(productChanged(incoming({ priceDate: '2026-07-17' }), existing({ priceDate: '2025-07-15' }))).toBe(
      true
    );
  });
});
