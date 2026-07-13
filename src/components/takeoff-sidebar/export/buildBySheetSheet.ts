/**
 * Builds the "By Sheet" summary worksheet: one row per (sheet, condition) pair,
 * grouped under a bold sheet header row with condition rows at outline level 1,
 * so collapsing the outline shows one row per sheet. Answers "what's on A-101?"
 * without pivoting. Called from useTakeoffExport's exportToExcel after the Data
 * sheet so existing sheet order/names are untouched.
 */
import type ExcelJS from 'exceljs';
import type { TakeoffCondition } from '../../../types';

export interface BySheetPageData {
  pageNumber: number;
  sheetName: string;
  sheetNumber: string | null;
  sheetId: string;
  total: number;
}

export interface BySheetConditionData {
  condition: TakeoffCondition;
  pages: Record<string, BySheetPageData>;
}

const QTY_FMT = '#,##0.00';

/**
 * Natural-sort comparator for sheet numbers: digit runs compare numerically so
 * A1.01 < A1.02 < A10.01 (plain lexicographic sorting would put A10.01 first).
 */
export function compareSheetNumbers(a: string, b: string): number {
  const tokenize = (s: string): string[] => s.match(/\d+|\D+/g) ?? [];
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const len = Math.min(tokensA.length, tokensB.length);
  for (let i = 0; i < len; i++) {
    const tokenA = tokensA[i];
    const tokenB = tokensB[i];
    if (/^\d/.test(tokenA) && /^\d/.test(tokenB)) {
      const diff = Number(tokenA) - Number(tokenB);
      if (diff !== 0) return diff;
    } else {
      const diff = tokenA.localeCompare(tokenB, undefined, { sensitivity: 'base' });
      if (diff !== 0) return diff;
    }
  }
  return tokensA.length - tokensB.length;
}

export function buildBySheetSheet(
  workbook: ExcelJS.Workbook,
  reportData: Record<string, BySheetConditionData>,
  headerStyle: Partial<ExcelJS.Style>,
  conditionSummaryStyle: Partial<ExcelJS.Style>
): void {
  // Invert the per-condition pages records into per-sheet condition rows.
  type SheetGroup = {
    pageData: BySheetPageData;
    rows: Array<{ conditionName: string; quantity: number; unit: string }>;
  };
  const sheetGroups = new Map<string, SheetGroup>();
  Object.values(reportData).forEach(({ condition, pages }) => {
    Object.entries(pages).forEach(([pageKey, pageData]) => {
      let group = sheetGroups.get(pageKey);
      if (!group) {
        group = { pageData, rows: [] };
        sheetGroups.set(pageKey, group);
      }
      group.rows.push({ conditionName: condition.name, quantity: pageData.total, unit: condition.unit });
    });
  });

  const sortKey = (group: SheetGroup): string =>
    group.pageData.sheetNumber ?? group.pageData.sheetName;
  const sortedGroups = Array.from(sheetGroups.values()).sort((a, b) => {
    const diff = compareSheetNumbers(sortKey(a), sortKey(b));
    if (diff !== 0) return diff;
    return a.pageData.pageNumber - b.pageData.pageNumber;
  });

  const bySheet = workbook.addWorksheet('By Sheet');

  const headers: Array<{ label: string; width: number }> = [
    { label: 'Sheet Number', width: 14 },
    { label: 'Sheet Name', width: 35 },
    { label: 'Condition', width: 25 },
    { label: 'Quantity', width: 12 },
    { label: 'Unit', width: 8 },
  ];
  headers.forEach(({ label, width }, colIdx) => {
    const cell = bySheet.getCell(1, colIdx + 1);
    cell.value = label;
    cell.style = headerStyle;
    bySheet.getColumn(colIdx + 1).width = width;
  });

  let rowNum = 2;
  sortedGroups.forEach((group) => {
    bySheet.getCell(rowNum, 1).value = group.pageData.sheetNumber ?? '';
    bySheet.getCell(rowNum, 2).value = group.pageData.sheetName;
    for (let col = 1; col <= headers.length; col++) {
      bySheet.getCell(rowNum, col).style = conditionSummaryStyle;
    }
    bySheet.getRow(rowNum).outlineLevel = 0;
    rowNum++;

    group.rows
      .sort((a, b) => a.conditionName.localeCompare(b.conditionName))
      .forEach((row) => {
        bySheet.getCell(rowNum, 3).value = row.conditionName;
        const quantityCell = bySheet.getCell(rowNum, 4);
        quantityCell.value = row.quantity;
        quantityCell.numFmt = QTY_FMT;
        bySheet.getCell(rowNum, 5).value = row.unit;
        bySheet.getRow(rowNum).outlineLevel = 1;
        rowNum++;
      });

    // Blank spacer between sheets; level 1 so it collapses with the group.
    // ExcelJS drops row properties on cell-less rows, so anchor an empty cell.
    bySheet.getCell(rowNum, 1).value = '';
    bySheet.getRow(rowNum).outlineLevel = 1;
    rowNum++;
  });

  const props = bySheet.properties as unknown as Record<string, unknown>;
  props.outlineLevelRow = 1;
  props.summaryBelow = false;
  bySheet.views = [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }];
}
