import { describe, it, expect } from 'vitest';
import { assemblyNameFromFilename, brandFromFolderName } from './assemblyExtractor';

describe('assemblyNameFromFilename', () => {
  it('drops the extension', () => {
    expect(assemblyNameFromFilename('250GC Retaining wall 5 Year.xlsx')).toBe(
      '250GC Retaining wall 5 Year'
    );
    expect(assemblyNameFromFilename('Aquafin-2K M.xlsm')).toBe('Aquafin-2K M');
  });

  it('drops the uuid an upload temp file is prefixed with', () => {
    expect(
      assemblyNameFromFilename('697d5e88-9718-401e-b6a3-97e413999027-250GC Retaining wall.xlsx')
    ).toBe('250GC Retaining wall');
  });

  it('keeps a name that merely contains hyphens and digits', () => {
    expect(assemblyNameFromFilename('Tremco EWS - Vehicular.xlsx')).toBe('Tremco EWS - Vehicular');
    expect(assemblyNameFromFilename('Preprufe 300R+ for piles.xlsx')).toBe(
      'Preprufe 300R+ for piles'
    );
  });

  it('trims surrounding whitespace', () => {
    expect(assemblyNameFromFilename('  Dow 790.xlsx  ')).toBe('Dow 790');
  });

  it('returns empty for a filename that is nothing but an extension', () => {
    expect(assemblyNameFromFilename('.xlsx')).toBe('');
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
  });
});
