/**
 * Finding one assembly among 200+ — the shared search and ordering behind every
 * place the library is listed (condition dialog, templates dialog, Admin).
 *
 * Names come from the source workbook filenames and read like
 * "250GC Retaining wall 5 Year": the distinguishing word is rarely the first
 * one, so a prefix match would make the estimator remember how each name
 * starts. Every query term is matched anywhere in the name (and the brand)
 * instead, and all terms must match, so "tremco retain 10" narrows to the
 * 10-year retaining wall under Tremco.
 *
 * Brand is a separate column, not a prefix glued onto the name — the source
 * folder is organised that way (Aquafin/, Tremco/, Sika/…), and at 200+ the
 * picker groups on it.
 */

/** Natural order, so "5 Year" sorts before "10 Year" rather than after it. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export interface NamedAssembly {
  name: string;
  /** Null/undefined/blank means uncategorised — shown last, under "Other". */
  brand?: string | null;
}

export function sortAssembliesByName<T extends NamedAssembly>(assemblies: T[]): T[] {
  return [...assemblies].sort((a, b) => collator.compare(a.name, b.name));
}

/** Canonical brand label for grouping; blank becomes null. */
export function normalizeBrand(brand: string | null | undefined): string | null {
  const trimmed = (brand ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/** The query split into the terms that all have to match. Empty means "no filter". */
export function assemblyQueryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesAssemblyQuery(
  name: string,
  query: string,
  brand?: string | null
): boolean {
  const haystack = `${name} ${brand ?? ''}`.toLowerCase();
  return assemblyQueryTerms(query).every((term) => haystack.includes(term));
}

/**
 * The list to render: matches only, always in name order. Sorting here rather
 * than at each call site is what keeps the three screens agreeing on the order
 * an estimator sees.
 */
export function filterAssemblies<T extends NamedAssembly>(assemblies: T[], query: string): T[] {
  const terms = assemblyQueryTerms(query);
  const matched =
    terms.length === 0
      ? assemblies
      : assemblies.filter((assembly) => {
          const haystack = `${assembly.name} ${assembly.brand ?? ''}`.toLowerCase();
          return terms.every((term) => haystack.includes(term));
        });
  return sortAssembliesByName(matched);
}

export interface AssemblyBrandGroup<T extends NamedAssembly> {
  /** Null means the uncategorised bucket, always last. */
  brand: string | null;
  /** Display label for the section header. */
  label: string;
  assemblies: T[];
}

/**
 * Group a (already filtered) list by brand. Brands A–Z, then uncategorised.
 * Assemblies within a brand stay in name order.
 */
export function groupAssembliesByBrand<T extends NamedAssembly>(
  assemblies: T[]
): AssemblyBrandGroup<T>[] {
  const sorted = sortAssembliesByName(assemblies);
  const byBrand = new Map<string | null, T[]>();

  for (const assembly of sorted) {
    const brand = normalizeBrand(assembly.brand);
    const bucket = byBrand.get(brand);
    if (bucket) bucket.push(assembly);
    else byBrand.set(brand, [assembly]);
  }

  const brands = [...byBrand.keys()].filter((b): b is string => b !== null).sort(collator.compare);
  const groups: AssemblyBrandGroup<T>[] = brands.map((brand) => ({
    brand,
    label: brand,
    assemblies: byBrand.get(brand) ?? [],
  }));

  const uncategorized = byBrand.get(null);
  if (uncategorized && uncategorized.length > 0) {
    groups.push({ brand: null, label: 'Other', assemblies: uncategorized });
  }
  return groups;
}

/**
 * Pull a brand label out of a source-folder name.
 *
 * "Tremco" stays "Tremco". "Laticrete - Need to request pricing by Project"
 * becomes "Laticrete", with the qualifier returned separately so the importer
 * can flag it rather than bake a sentence into every assembly's brand.
 */
export function brandFromFolderName(folderName: string): {
  brand: string;
  qualifier: string | null;
} {
  const trimmed = folderName.trim();
  const split = trimmed.match(/^(.+?)\s+-\s+(.+)$/);
  if (!split) return { brand: trimmed, qualifier: null };
  return { brand: split[1].trim(), qualifier: split[2].trim() };
}
