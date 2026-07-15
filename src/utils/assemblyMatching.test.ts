import { describe, it, expect } from 'vitest';
import { matchConditionsToMapping, deriveConditionPattern, type MatchableCondition } from './assemblyMatching';

const conditions: MatchableCondition[] = [
  { id: '1', name: 'Aquafin 2K deck' },
  { id: '2', name: 'aquafin waterproofing' },
  { id: '3', name: 'Dow 790 sealant' },
  { id: '4', name: 'Cover plates' },
  { id: '5', name: '  Aquafin trim  ' },
];

describe('matchConditionsToMapping', () => {
  it('matches exact name case-insensitively', () => {
    const result = matchConditionsToMapping(conditions, 'Dow 790 sealant');
    expect(result.map((c) => c.id)).toEqual(['3']);
  });

  it('matches exact name regardless of casing on both sides', () => {
    const result = matchConditionsToMapping(conditions, 'DOW 790 SEALANT');
    expect(result.map((c) => c.id)).toEqual(['3']);
  });

  it('matches trailing-* prefix wildcard case-insensitively', () => {
    const result = matchConditionsToMapping(conditions, 'Aquafin*');
    expect(result.map((c) => c.id).sort()).toEqual(['1', '2', '5']);
  });

  it('trims whitespace on condition names when wildcard matching', () => {
    const result = matchConditionsToMapping(conditions, 'aquafin*');
    expect(result.some((c) => c.id === '5')).toBe(true);
  });

  it('returns empty array when nothing matches', () => {
    expect(matchConditionsToMapping(conditions, 'Nonexistent*')).toEqual([]);
    expect(matchConditionsToMapping(conditions, 'Nonexistent')).toEqual([]);
  });

  it('returns empty array for blank conditionRef', () => {
    expect(matchConditionsToMapping(conditions, '   ')).toEqual([]);
  });

  it('bare "*" matches every condition', () => {
    const result = matchConditionsToMapping(conditions, '*');
    expect(result).toHaveLength(conditions.length);
  });
});

describe('deriveConditionPattern', () => {
  it('strips extension and a trailing short revision token', () => {
    expect(deriveConditionPattern('Aquafin-2K M.xlsx')).toBe('Aquafin-2K*');
  });

  it('keeps longer trailing tokens', () => {
    expect(deriveConditionPattern('Dow 790.xlsx')).toBe('Dow 790*');
  });

  it('handles filenames with no spaces', () => {
    expect(deriveConditionPattern('CoverPlates.xlsm')).toBe('CoverPlates*');
  });
});
