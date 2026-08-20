import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import {
  argbToRgb,
  buildSheetBreakdownRows,
  buildConditionsSummaryTable,
  buildPageBreakdownTable,
  type AutoTableDoc,
} from './buildPdfSummaryTables';
import type { BySheetConditionData } from './buildBySheetSheet';
import type { TakeoffCondition } from '../../../types';

function condition(overrides: Partial<TakeoffCondition> = {}): TakeoffCondition {
  return {
    id: 'c1',
    name: 'Waterproofing',
    type: 'area',
    unit: 'SF',
    color: '#3B82F6',
    ...overrides,
  } as TakeoffCondition;
}

describe('argbToRgb', () => {
  it('drops the alpha byte from an 8-char ARGB hex', () => {
    expect(argbToRgb('FF3B82F6')).toEqual([0x3b, 0x82, 0xf6]);
  });

  it('reads a 6-char RGB hex directly', () => {
    expect(argbToRgb('3B82F6')).toEqual([0x3b, 0x82, 0xf6]);
  });
});

describe('buildSheetBreakdownRows', () => {
  it('flattens per-condition pages into one row per (sheet, condition), sorted by sheet then condition', () => {
    const reportData: Record<string, BySheetConditionData> = {
      c2: {
        condition: condition({ id: 'c2', name: 'Sealant' }),
        pages: {
          'sheetA-1': { pageNumber: 1, sheetName: 'Detail A', sheetNumber: 'A9.03', sheetId: 'sheetA', total: 12 },
        },
      },
      c1: {
        condition: condition({ id: 'c1', name: 'Waterproofing' }),
        pages: {
          'sheetA-1': { pageNumber: 1, sheetName: 'Detail A', sheetNumber: 'A9.03', sheetId: 'sheetA', total: 100 },
          'sheetB-1': { pageNumber: 1, sheetName: 'Detail B', sheetNumber: 'A9.10', sheetId: 'sheetB', total: 50 },
        },
      },
    };

    const rows = buildSheetBreakdownRows(reportData);

    expect(rows).toEqual([
      { sheetNumber: 'A9.03', sheetName: 'Detail A', conditionName: 'Sealant', quantity: 12, unit: 'SF' },
      { sheetNumber: 'A9.03', sheetName: 'Detail A', conditionName: 'Waterproofing', quantity: 100, unit: 'SF' },
      { sheetNumber: 'A9.10', sheetName: 'Detail B', conditionName: 'Waterproofing', quantity: 50, unit: 'SF' },
    ]);
  });

  it('natural-sorts sheet numbers (A10.01 after A2.01, not before)', () => {
    const reportData: Record<string, BySheetConditionData> = {
      c1: {
        condition: condition(),
        pages: {
          'sheetB-1': { pageNumber: 1, sheetName: 'Ten', sheetNumber: 'A10.01', sheetId: 'sheetB', total: 1 },
          'sheetA-1': { pageNumber: 1, sheetName: 'Two', sheetNumber: 'A2.01', sheetId: 'sheetA', total: 1 },
        },
      },
    };

    const rows = buildSheetBreakdownRows(reportData);
    expect(rows.map((r) => r.sheetNumber)).toEqual(['A2.01', 'A10.01']);
  });
});

describe('PDF autotable rendering', () => {
  it('draws the conditions summary table and advances lastAutoTable.finalY', async () => {
    const pdf = new jsPDF('p', 'mm', 'a4') as unknown as AutoTableDoc;
    const startY = 100;
    const finalY = await buildConditionsSummaryTable(
      pdf,
      [
        { condition: condition(), category: 'Uncategorized', qty: 240, materialCost: 500, equipmentCost: 50 },
      ],
      startY,
      [59, 130, 246]
    );
    expect(finalY).toBeGreaterThan(startY);
    expect(pdf.lastAutoTable?.finalY).toBe(finalY);
  });

  it('draws the page breakdown table and paginates without throwing on many rows', async () => {
    const pdf = new jsPDF('p', 'mm', 'a4') as unknown as AutoTableDoc;
    const rows = Array.from({ length: 60 }, (_, i) => ({
      sheetNumber: `A${i}.01`,
      sheetName: `Sheet ${i}`,
      conditionName: 'Waterproofing',
      quantity: i,
      unit: 'SF',
    }));
    const finalY = await buildPageBreakdownTable(pdf, rows, 20, [59, 130, 246]);
    expect(finalY).toBeGreaterThan(20);
    expect((pdf as unknown as jsPDF).getNumberOfPages()).toBeGreaterThan(1);
  });
});
