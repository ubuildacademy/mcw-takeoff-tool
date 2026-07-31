import { describe, it, expect } from 'vitest';
import {
  assemblyQueryTerms,
  brandFromFolderName,
  filterAssemblies,
  groupAssembliesByBrand,
  matchesAssemblyQuery,
  normalizeBrand,
  sortAssembliesByName,
} from './assemblyListFilter';

const library = [
  { id: 'a', name: '250GC Retaining wall 10 Year', brand: 'Tremco' },
  { id: 'b', name: '250GC Retaining wall 5 Year', brand: 'Tremco' },
  { id: 'c', name: 'Aquafin 2K M', brand: 'Aquafin' },
  { id: 'd', name: 'aquafin 1K', brand: 'Aquafin' },
  { id: 'e', name: 'Custom patch', brand: null },
];

const names = (items: { name: string }[]) => items.map((item) => item.name);

describe('matchesAssemblyQuery', () => {
  it('matches case-insensitively', () => {
    expect(matchesAssemblyQuery('Aquafin 2K M', 'AQUAFIN')).toBe(true);
    expect(matchesAssemblyQuery('aquafin 1K', 'AQUAFIN')).toBe(true);
  });

  it('matches a word anywhere in the name, not only the start', () => {
    expect(matchesAssemblyQuery('250GC Retaining wall 5 Year', 'retaining')).toBe(true);
    expect(matchesAssemblyQuery('250GC Retaining wall 5 Year', 'wall')).toBe(true);
  });

  it('matches the brand as well as the name', () => {
    expect(matchesAssemblyQuery('250GC Retaining wall 5 Year', 'tremco', 'Tremco')).toBe(true);
    expect(matchesAssemblyQuery('250GC Retaining wall 5 Year', 'tremco retain', 'Tremco')).toBe(
      true
    );
    expect(matchesAssemblyQuery('250GC Retaining wall 5 Year', 'sika', 'Tremco')).toBe(false);
  });

  it('requires every term, in any order', () => {
    expect(matchesAssemblyQuery('250GC Retaining wall 5 Year', 'wall retaining')).toBe(true);
    expect(matchesAssemblyQuery('250GC Retaining wall 5 Year', 'wall aquafin')).toBe(false);
  });

  it('ignores surrounding and repeated whitespace', () => {
    expect(matchesAssemblyQuery('Aquafin 2K M', '  aquafin   2k ')).toBe(true);
    expect(matchesAssemblyQuery('Aquafin 2K M', '   ')).toBe(true);
  });
});

describe('assemblyQueryTerms', () => {
  it('drops the empty pieces whitespace splitting leaves behind', () => {
    expect(assemblyQueryTerms('  retaining   wall ')).toEqual(['retaining', 'wall']);
    expect(assemblyQueryTerms('')).toEqual([]);
  });
});

describe('sortAssembliesByName', () => {
  it('sorts numbers by value, so 5 Year comes before 10 Year', () => {
    expect(names(sortAssembliesByName(library))).toEqual([
      '250GC Retaining wall 5 Year',
      '250GC Retaining wall 10 Year',
      'aquafin 1K',
      'Aquafin 2K M',
      'Custom patch',
    ]);
  });
});

describe('filterAssemblies', () => {
  it('returns everything, sorted, for an empty query', () => {
    expect(names(filterAssemblies(library, ''))).toEqual([
      '250GC Retaining wall 5 Year',
      '250GC Retaining wall 10 Year',
      'aquafin 1K',
      'Aquafin 2K M',
      'Custom patch',
    ]);
  });

  it('matches brand terms across the library', () => {
    expect(names(filterAssemblies(library, 'tremco'))).toEqual([
      '250GC Retaining wall 5 Year',
      '250GC Retaining wall 10 Year',
    ]);
  });

  it('returns nothing when no name or brand matches', () => {
    expect(filterAssemblies(library, 'sika')).toEqual([]);
  });
});

describe('groupAssembliesByBrand', () => {
  it('groups brands alphabetically with uncategorised last', () => {
    const groups = groupAssembliesByBrand(library);
    expect(groups.map((g) => g.label)).toEqual(['Aquafin', 'Tremco', 'Other']);
    expect(names(groups[0].assemblies)).toEqual(['aquafin 1K', 'Aquafin 2K M']);
    expect(names(groups[1].assemblies)).toEqual([
      '250GC Retaining wall 5 Year',
      '250GC Retaining wall 10 Year',
    ]);
    expect(names(groups[2].assemblies)).toEqual(['Custom patch']);
  });

  it('omits the Other bucket when every assembly has a brand', () => {
    const groups = groupAssembliesByBrand(library.filter((a) => a.brand));
    expect(groups.map((g) => g.label)).toEqual(['Aquafin', 'Tremco']);
  });
});

describe('normalizeBrand', () => {
  it('treats blank as null', () => {
    expect(normalizeBrand('  Tremco  ')).toBe('Tremco');
    expect(normalizeBrand('')).toBeNull();
    expect(normalizeBrand('   ')).toBeNull();
    expect(normalizeBrand(null)).toBeNull();
  });
});

describe('brandFromFolderName', () => {
  it('keeps a plain brand folder', () => {
    expect(brandFromFolderName('Tremco')).toEqual({ brand: 'Tremco', qualifier: null });
  });

  it('splits a pricing-holdout qualifier off the brand', () => {
    expect(brandFromFolderName('Laticrete - Need to request pricing by Project')).toEqual({
      brand: 'Laticrete',
      qualifier: 'Need to request pricing by Project',
    });
    expect(brandFromFolderName('Sherwin Williams - Need to request pricing by Project')).toEqual({
      brand: 'Sherwin Williams',
      qualifier: 'Need to request pricing by Project',
    });
  });
});
