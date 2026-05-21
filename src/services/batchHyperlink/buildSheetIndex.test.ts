import { describe, expect, it } from 'vitest';
import {
  buildSheetIndexFromDocuments,
  normalizeSheetNumberForMatch,
  sheetNumberKeyAliases,
  isMeaningfulSheetNumber,
  resolveTargetForSource,
  expandNearMissSheetRefCandidates,
  getTargetsWithNearMiss,
  type SheetIndexTarget,
} from './buildSheetIndex';
import type { PDFDocument } from '../../types';

function pageMeta(sheetNumber: string, pageNumber: number) {
  return {
    pageNumber,
    hasTakeoffs: false as const,
    takeoffCount: 0,
    isVisible: true as const,
    ocrProcessed: true as const,
    sheetNumber,
  };
}

describe('normalizeSheetNumberForMatch', () => {
  it('unifies hyphen and space variants', () => {
    expect(normalizeSheetNumberForMatch('A-101')).toBe('A101');
    expect(normalizeSheetNumberForMatch('A 101')).toBe('A101');
    expect(normalizeSheetNumberForMatch('a101')).toBe('A101');
  });

  it('preserves dot in sheet-style numbers', () => {
    expect(normalizeSheetNumberForMatch('A4.21')).toBe('A4.21');
  });
});

describe('sheetNumberKeyAliases', () => {
  it('adds a no-dot alias for dotted refs', () => {
    expect(sheetNumberKeyAliases('A4.51').sort()).toEqual(['A4.51', 'A451']);
  });

  it('does not guess a dotted variant from a digit-only ref', () => {
    expect(sheetNumberKeyAliases('A451')).toEqual(['A451']);
  });

  it('returns empty array for empty input', () => {
    expect(sheetNumberKeyAliases('')).toEqual([]);
  });
});

describe('isMeaningfulSheetNumber', () => {
  it('rejects Unknown', () => {
    expect(isMeaningfulSheetNumber('Unknown')).toBe(false);
    expect(isMeaningfulSheetNumber('A1')).toBe(true);
  });
});

describe('buildSheetIndexFromDocuments', () => {
  it('marks ambiguous keys when two pages share a normalized sheet number', () => {
    const documents: PDFDocument[] = [
      {
        id: 'docA',
        name: 'A',
        totalPages: 2,
        pages: [pageMeta('S1', 1), pageMeta('S1', 2)],
        isExpanded: false,
        ocrEnabled: false,
      },
    ];
    const r = buildSheetIndexFromDocuments(documents);
    expect(r.ambiguousKeys).toContain('S1');
    expect(r.getTargets('S1')).toHaveLength(2);
  });

  it('resolves unique sheet numbers', () => {
    const documents: PDFDocument[] = [
      {
        id: 'd1',
        name: 'Main',
        totalPages: 2,
        pages: [pageMeta('G0.01', 1), pageMeta('A4.21', 2)],
        isExpanded: false,
        ocrEnabled: false,
      },
    ];
    const r = buildSheetIndexFromDocuments(documents);
    expect(r.getTargets('G0.01')).toEqual([{ documentId: 'd1', pageNumber: 1 }]);
    expect(r.getTargets('A4.21')).toEqual([{ documentId: 'd1', pageNumber: 2 }]);
  });

  it('lets dotted index keys be found by no-dot queries and vice versa', () => {
    const documents: PDFDocument[] = [
      {
        id: 'd1',
        name: 'Main',
        totalPages: 1,
        pages: [pageMeta('A4.51', 1)],
        isExpanded: false,
        ocrEnabled: false,
      },
    ];
    const r = buildSheetIndexFromDocuments(documents);
    expect(r.getTargets('A4.51')).toHaveLength(1);
    expect(r.getTargets('A451')).toHaveLength(1);
  });

  it('returns all targets across documents for the same sheet number', () => {
    const documents: PDFDocument[] = [
      {
        id: 'd1',
        name: 'Set A',
        totalPages: 1,
        pages: [pageMeta('A4.51', 1)],
        isExpanded: false,
        ocrEnabled: false,
      },
      {
        id: 'd2',
        name: 'Set B (revision)',
        totalPages: 3,
        pages: [pageMeta('A4.51', 3)],
        isExpanded: false,
        ocrEnabled: false,
      },
    ];
    const r = buildSheetIndexFromDocuments(documents);
    expect(r.getTargets('A4.51').map((t) => t.documentId).sort()).toEqual(['d1', 'd2']);
    expect(r.ambiguousKeys).toContain('A4.51');
  });
});

describe('near-miss sheet ref repair (OCR dot / duplicate letter)', () => {
  it('insert-dot candidate aligns OCR no-dot noise with dotted index keys', () => {
    const documents: PDFDocument[] = [
      {
        id: 'd1',
        name: 'Main',
        totalPages: 1,
        pages: [pageMeta('A6.53', 1)],
        isExpanded: false,
        ocrEnabled: false,
      },
    ];
    const idx = buildSheetIndexFromDocuments(documents);
    // Alias already maps A653 → same slot; near-miss still supplies A6.53 as candidate.
    expect(expandNearMissSheetRefCandidates('A653', idx.allKeys)).toContain('A6.53');
    expect(getTargetsWithNearMiss(idx, 'A653')).toEqual([{ documentId: 'd1', pageNumber: 1 }]);
  });

  it('strips duplicated leading letters: LL7.1 → L7.1', () => {
    const documents: PDFDocument[] = [
      {
        id: 'd1',
        name: 'Main',
        totalPages: 1,
        pages: [pageMeta('L7.1', 1)],
        isExpanded: false,
        ocrEnabled: false,
      },
    ];
    const idx = buildSheetIndexFromDocuments(documents);
    expect(getTargetsWithNearMiss(idx, 'LL7.1')).toEqual([{ documentId: 'd1', pageNumber: 1 }]);
  });

  it('does not guess when A9 could map to several A9.xx sheets', () => {
    const documents: PDFDocument[] = [
      {
        id: 'd1',
        name: 'Main',
        totalPages: 2,
        pages: [pageMeta('A9.22', 1), pageMeta('A9.03', 2)],
        isExpanded: false,
        ocrEnabled: false,
      },
    ];
    const idx = buildSheetIndexFromDocuments(documents);
    expect(getTargetsWithNearMiss(idx, 'A9')).toEqual([]);
  });

  it('maps short A9 to the only A9.xx when unique', () => {
    const documents: PDFDocument[] = [
      {
        id: 'd1',
        name: 'Main',
        totalPages: 1,
        pages: [pageMeta('A9.22', 1)],
        isExpanded: false,
        ocrEnabled: false,
      },
    ];
    const idx = buildSheetIndexFromDocuments(documents);
    expect(getTargetsWithNearMiss(idx, 'A9')).toEqual([{ documentId: 'd1', pageNumber: 1 }]);
  });

  it('expandNearMissSheetRefCandidates lists expected variants', () => {
    const keys = new Set(['A6.53', 'A653', 'L7.1', 'A9.22']);
    const ex = expandNearMissSheetRefCandidates('LL7.1', keys);
    expect(ex).toContain('LL7.1');
    expect(ex).toContain('L7.1');
  });
});

describe('resolveTargetForSource', () => {
  const t1: SheetIndexTarget = { documentId: 'd1', pageNumber: 5 };
  const t2: SheetIndexTarget = { documentId: 'd2', pageNumber: 7 };

  it('returns the single target unchanged', () => {
    expect(resolveTargetForSource([t1], 'd1')).toEqual({ target: t1, ambiguous: false });
  });

  it('prefers the same-document target when ambiguous across files', () => {
    expect(resolveTargetForSource([t1, t2], 'd1')).toEqual({ target: t1, ambiguous: false });
    expect(resolveTargetForSource([t1, t2], 'd2')).toEqual({ target: t2, ambiguous: false });
  });

  it('flags ambiguous when multiple targets exist in the same source doc', () => {
    const t1b: SheetIndexTarget = { documentId: 'd1', pageNumber: 9 };
    expect(resolveTargetForSource([t1, t1b], 'd1')).toEqual({ target: null, ambiguous: true });
  });

  it('uses any unique cross-doc target when source doc has none', () => {
    const t2b: SheetIndexTarget = { documentId: 'd2', pageNumber: 9 };
    expect(resolveTargetForSource([t2, t2b], 'd1')).toEqual({ target: t2, ambiguous: false });
  });

  it('flags ambiguous when targets span multiple unrelated docs and none is source', () => {
    expect(resolveTargetForSource([t1, t2], 'd3')).toEqual({ target: null, ambiguous: true });
  });
});
