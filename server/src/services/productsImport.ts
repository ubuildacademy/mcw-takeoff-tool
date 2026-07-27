/**
 * Pure diff rules for a product price-list import (Stage 2, task I2).
 *
 * Split from `productsImportService.ts` so the comparison that decides what an
 * import actually changes can be unit-tested without a database. The import is
 * an upsert on (org, code): the point of the diff is to report honest counts —
 * "42 new, 7 updated, 1102 unchanged" — rather than claiming every row was
 * written every time.
 *
 * See docs/ASSEMBLIES_DESIGN.md. The MCW Pricing Manager remains the system of
 * record for pricing; this is a read cache for costing.
 */

/** A row as parsed from the price list. */
export interface ImportedProduct {
  code: string;
  item: string | null;
  description: string | null;
  netPrice: number | null;
  priceDate: string | null;
}

/** The subset of a stored product the diff compares against. */
export interface ExistingProduct {
  code: string;
  item: string | null;
  description: string | null;
  netPrice: number | null;
  priceDate: string | null;
}

export interface ProductsDiff {
  toInsert: ImportedProduct[];
  toUpdate: ImportedProduct[];
  unchangedCount: number;
}

/**
 * Price equality tolerance, matching the MCW Pricing Manager's own diff
 * engine. Without it, floating-point round-tripping through Postgres NUMERIC
 * and JSON reports unchanged prices as changes on every import.
 */
export const PRICE_TOLERANCE = 0.001;

function pricesEqual(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < PRICE_TOLERANCE;
}

/**
 * Text equality that ignores differences no human would call a change —
 * surrounding whitespace, and absent vs empty. The Pricing Manager's diff is
 * deliberately insensitive to the same cosmetic differences.
 */
function textEqual(a: string | null, b: string | null): boolean {
  return (a ?? '').trim() === (b ?? '').trim();
}

export function productChanged(incoming: ImportedProduct, existing: ExistingProduct): boolean {
  return (
    !pricesEqual(incoming.netPrice, existing.netPrice) ||
    !textEqual(incoming.item, existing.item) ||
    !textEqual(incoming.description, existing.description) ||
    !textEqual(incoming.priceDate, existing.priceDate)
  );
}

/**
 * Split incoming rows into inserts, updates and no-ops.
 *
 * Codes present in the database but absent from the file are deliberately left
 * alone: a price list may be a partial or supplier-specific export, and
 * deleting on absence would silently empty the catalogue for anyone who
 * imported one. Removing a product stays a manual act.
 */
export function diffProducts(
  existing: ExistingProduct[],
  incoming: ImportedProduct[]
): ProductsDiff {
  const byCode = new Map(existing.map((product) => [product.code, product]));
  const toInsert: ImportedProduct[] = [];
  const toUpdate: ImportedProduct[] = [];
  let unchangedCount = 0;

  for (const row of incoming) {
    const current = byCode.get(row.code);
    if (!current) {
      toInsert.push(row);
    } else if (productChanged(row, current)) {
      toUpdate.push(row);
    } else {
      unchangedCount += 1;
    }
  }

  return { toInsert, toUpdate, unchangedCount };
}
