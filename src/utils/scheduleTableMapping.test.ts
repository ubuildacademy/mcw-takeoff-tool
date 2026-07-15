import { describe, it, expect } from 'vitest';
import {
  detectHeaderRowCount,
  buildColumnLabels,
  detectInstanceColumns,
  guessNameColumn,
  guessQtyMapping,
  computeRowQty,
  groupScheduleRows,
  isBlankOrDashCell,
  isInstanceCode,
  cleanConditionName,
  isJunkRow,
} from './scheduleTableMapping';

/**
 * Shaped like a real multi-level door schedule: group-header row, sub-header
 * row, then data rows with a door number per level column (dash = no door on
 * that level) and NO quantity column.
 */
const DOOR_ROWS: string[][] = [
  ['DOOR NUMBER', '', '', '', '', '', 'DOOR', '', '', 'FIRE', ''],
  ['2nd LEVEL', '3rd LEVEL', '4th LEVEL', '5th LEVEL', '6th LEVEL', 'ROOM NAME', "MAT'L", 'FINISH', 'HARDWARE SET', 'RATED', 'REMARKS / NOTES'],
  ['201A', '301A', '401A', '501A', '601A', 'UNIT "K-A" — ENTRANCE', 'WD.', 'P.LAM.', '#16.0', 'YES', ''],
  ['201B', '301B', '401B', '501B', '601B', 'UNIT "K-A" — BATHROOM', 'WD.', 'P.LAM.', '#18.0', 'NO', ''],
  ['212D', '–', '–', '–', '–', 'UNIT "QQ-B" — CONNECT.', 'WD.', 'P.LAM.', '#17.0', 'YES', ''],
  ['229', '329', '429', '529', '629', 'STAIRS# 1', 'H.M.', 'P.LAM.', '#15.0', 'YES', ''],
  ['–', '–', '–', '–', '729', 'STAIRS# 1', 'H.M.', 'PAINT', '#15.0', 'YES', 'NOA #17-1102.02'],
  ['202A', '302A', '402A', '502A', '602A', 'UNIT "K-A" — ENTRANCE', 'WD.', 'P.LAM.', '#16.0', 'YES', ''],
];

const COLS = 11;

describe('scheduleTableMapping', () => {
  describe('cell classifiers', () => {
    it('classifies dash and empty cells as blank', () => {
      expect(isBlankOrDashCell('–')).toBe(true);
      expect(isBlankOrDashCell('-')).toBe(true);
      expect(isBlankOrDashCell('')).toBe(true);
      expect(isBlankOrDashCell(undefined)).toBe(true);
      expect(isBlankOrDashCell('201A')).toBe(false);
    });

    it('recognizes door instance codes', () => {
      expect(isInstanceCode('201A')).toBe(true);
      expect(isInstanceCode('729')).toBe(true);
      expect(isInstanceCode('212D')).toBe(true);
      expect(isInstanceCode('UNIT "K-A"')).toBe(false);
      expect(isInstanceCode('WD.')).toBe(false);
      expect(isInstanceCode('#16.0')).toBe(false);
    });
  });

  describe('detectHeaderRowCount', () => {
    it('finds two header rows on a grouped-header door schedule', () => {
      expect(detectHeaderRowCount(DOOR_ROWS)).toBe(2);
    });

    it('finds one header row on a simple schedule', () => {
      const rows = [
        ['MARK', 'DESCRIPTION', 'QTY'],
        ['W1', 'ALUM WINDOW', '4'],
        ['W2', 'STOREFRONT', '2'],
      ];
      expect(detectHeaderRowCount(rows)).toBe(1);
    });

    it('returns 0 when data starts immediately', () => {
      const rows = [
        ['201A', '301A', 'UNIT ENTRANCE'],
        ['201B', '301B', 'UNIT BATHROOM'],
      ];
      expect(detectHeaderRowCount(rows)).toBe(0);
    });

    it('defaults to one header row when nothing looks like data', () => {
      const rows = [
        ['DOOR SCHEDULE', ''],
        ['NOTES', 'GENERAL'],
      ];
      expect(detectHeaderRowCount(rows)).toBe(1);
    });
  });

  describe('buildColumnLabels', () => {
    it('joins group header and sub-header top-down', () => {
      const labels = buildColumnLabels(DOOR_ROWS, 2, COLS);
      expect(labels[0]).toBe('DOOR NUMBER 2nd LEVEL');
      expect(labels[1]).toBe('3rd LEVEL');
      expect(labels[5]).toBe('ROOM NAME');
      expect(labels[9]).toBe('FIRE RATED');
    });
  });

  describe('detectInstanceColumns', () => {
    it('finds the five level columns on the door schedule', () => {
      expect(detectInstanceColumns(DOOR_ROWS, 2, COLS)).toEqual([0, 1, 2, 3, 4]);
    });

    it('does not treat a lone MARK column as an instance group', () => {
      const rows = [
        ['MARK', 'DESCRIPTION', 'QTY'],
        ['W1', 'ALUM WINDOW', '4'],
        ['W2', 'STOREFRONT', '2'],
        ['W3', 'CURTAIN WALL', '1'],
      ];
      expect(detectInstanceColumns(rows, 1, 3)).toEqual([]);
    });
  });

  describe('guessNameColumn / guessQtyMapping', () => {
    it('picks ROOM NAME and count-columns mode on the door schedule', () => {
      const labels = buildColumnLabels(DOOR_ROWS, 2, COLS);
      const instanceCols = detectInstanceColumns(DOOR_ROWS, 2, COLS);
      expect(guessNameColumn(labels, instanceCols)).toBe(5);
      expect(guessQtyMapping(labels, instanceCols)).toEqual({
        mode: 'countColumns',
        columns: [0, 1, 2, 3, 4],
      });
    });

    it('prefers an explicit QTY column when present', () => {
      const labels = ['MARK', 'DESCRIPTION', 'QTY'];
      expect(guessQtyMapping(labels, [])).toEqual({ mode: 'column', column: 2 });
    });

    it('never suggests an instance column as the name column', () => {
      const labels = ['DOOR NUMBER 2nd LEVEL', '3rd LEVEL', 'ROOM NAME'];
      expect(guessNameColumn(labels, [0, 1])).toBe(2);
    });

    it('falls back to the most alpha-dominant column when no header matches', () => {
      // Glazing-schedule shape: no header word matches /room|name|mark|type|desc/i,
      // so the pick must come from actual cell content — column 1 (remarks/NOA,
      // mostly digits and punctuation) must lose to column 0 (real descriptions).
      const noHeaderLabels = ['GLASS SPEC', 'REF'];
      const rows = [
        noHeaderLabels,
        ['TEMPERED LAMINATED', '#190002-R1'],
        ['INSULATED GLASS', '17-1102.02'],
        ['LAMINATED SAFETY', '0.70'],
      ];
      expect(guessNameColumn(noHeaderLabels, [], rows, 1)).toBe(0);
    });
  });

  describe('computeRowQty', () => {
    const mapping = { mode: 'countColumns' as const, columns: [0, 1, 2, 3, 4] };

    it('counts filled level cells (full row = 5 doors)', () => {
      expect(computeRowQty(DOOR_ROWS[2], mapping)).toBe(5);
    });

    it('skips dash cells (single-level door = 1)', () => {
      expect(computeRowQty(DOOR_ROWS[4], mapping)).toBe(1);
      expect(computeRowQty(DOOR_ROWS[6], mapping)).toBe(1);
    });

    it('column mode parses integers and floors invalid to 1', () => {
      expect(computeRowQty(['W1', 'WINDOW', '4'], { mode: 'column', column: 2 })).toBe(4);
      expect(computeRowQty(['W1', 'WINDOW', 'EA'], { mode: 'column', column: 2 })).toBe(1);
    });
  });

  describe('groupScheduleRows', () => {
    const mapped = [
      { rowIndex: 2, name: 'UNIT "K-A" — ENTRANCE', qty: 5 },
      { rowIndex: 3, name: 'UNIT "K-A" — BATHROOM', qty: 5 },
      { rowIndex: 7, name: 'UNIT "K-A" — ENTRANCE', qty: 5 },
      { rowIndex: 5, name: 'STAIRS# 1', qty: 5 },
      { rowIndex: 6, name: 'STAIRS# 1', qty: 1 },
    ];

    it('merges same-name rows into one condition with summed qty', () => {
      const groups = groupScheduleRows(mapped, true);
      expect(groups).toHaveLength(3);
      const entrance = groups[0];
      expect(entrance.name).toBe('UNIT "K-A" — ENTRANCE');
      expect(entrance.totalQty).toBe(10);
      expect(entrance.markerRows).toEqual([
        { rowIndex: 2, qty: 5 },
        { rowIndex: 7, qty: 5 },
      ]);
      const stairs = groups[2];
      expect(stairs.totalQty).toBe(6);
      expect(stairs.markerRows).toHaveLength(2);
    });

    it('keeps one group per row when grouping is off', () => {
      const groups = groupScheduleRows(mapped, false);
      expect(groups).toHaveLength(5);
      expect(groups.map((g) => g.totalQty)).toEqual([5, 5, 5, 5, 1]);
    });
  });

  describe('cleanConditionName', () => {
    it('leaves a good door-schedule name untouched', () => {
      expect(cleanConditionName('LINEN STORAGE')).toBe('LINEN STORAGE');
    });

    it('collapses whitespace and strips a leading stray quote', () => {
      const raw = '"D NOA # EXPIRATION DATE ZONE 4 ZONE 5';
      const cleaned = cleanConditionName(raw);
      expect(cleaned.startsWith('"')).toBe(false);
      expect(cleaned).toBe('D NOA # EXPIRATION DATE ZONE 4 ZONE 5');
    });

    it('caps long remarks/spec text at 60 chars on a word boundary', () => {
      const raw =
        'STC—42 0.70 0.60 #190002-R1 FL 30, EXPIRES JUNE 2019 —50.2 —50.2 -92.0 +50.2';
      const cleaned = cleanConditionName(raw);
      expect(cleaned.length).toBeLessThanOrEqual(61); // 60 chars + ellipsis
      expect(cleaned.endsWith('…')).toBe(true);
      expect(cleaned.endsWith(' …')).toBe(false); // cut on a word boundary, no trailing space
    });

    it('passes short garbage through unchanged when there is nothing to strip', () => {
      expect(cleanConditionName('e')).toBe('e');
      expect(cleanConditionName('Z2e oS Ow')).toBe('Z2e oS Ow');
    });

    it('strips stray pipes and brackets anywhere in the cell', () => {
      expect(cleanConditionName('LINEN | STORAGE')).toBe('LINEN STORAGE');
      expect(cleanConditionName('[LINEN STORAGE]')).toBe('LINEN STORAGE');
    });
  });

  describe('isJunkRow', () => {
    it('keeps a good door-schedule row', () => {
      const row = ['201A', '301A', 'LINEN STORAGE', 'WD.', '#16.0', 'YES'];
      expect(isJunkRow(row, 2)).toBe(false);
    });

    it('flags a single-letter name as junk (too few alphabetic chars)', () => {
      const row = ['e', '2', 'WD.'];
      expect(isJunkRow(row, 0)).toBe(true);
    });

    it('flags a name cell dominated by non-alphanumeric characters (3+ alpha chars, but mostly noise)', () => {
      const row = ['A#B#C#---', '1'];
      expect(isJunkRow(row, 0)).toBe(true);
    });

    it('flags an all-blank/dash row', () => {
      const row = ['–', '-', '', undefined as unknown as string];
      expect(isJunkRow(row, 0)).toBe(true);
    });

    it('does not flag real remarks/spec text just for looking messy', () => {
      // These beta-test garbage names have plenty of alpha chars and a
      // low non-alnum ratio — they aren't junk by these mechanical rules,
      // so hygiene here comes from cleanConditionName + better column pick,
      // not junk-row suppression.
      const row1 = ['"D NOA # EXPIRATION DATE ZONE 4 ZONE 5'];
      const row2 = ['Z2e oS Ow'];
      expect(isJunkRow(row1, 0)).toBe(false);
      expect(isJunkRow(row2, 0)).toBe(false);
    });
  });
});
