/**
 * PDF summary report tables (A5): replaces the manual pdf.text() legend/breakdown
 * loops in exportToPDF with jspdf-autotable tables that paginate themselves. Row
 * shapes mirror what A1-A4 already established for the Excel export (Data sheet's
 * per-condition category, By Sheet's per-(sheet,condition) rows) so both exports
 * describe the same project the same way.
 */
import type { TakeoffCondition } from '../../../types';
import type { BySheetConditionData } from './buildBySheetSheet';
import { compareSheetNumbers } from './buildBySheetSheet';

// jsPDF's own type is `any` in practice once autotable augments it; typing just the
// property this file actually reads keeps it honest without pulling in jsPDF's full
// (loosely typed) surface.
export interface AutoTableDoc {
  lastAutoTable?: { finalY: number };
}

export interface PdfConditionSummaryRow {
  condition: TakeoffCondition;
  category: string;
  qty: number;
  materialCost: number;
  equipmentCost: number;
}

export interface PdfSheetBreakdownRow {
  sheetNumber: string;
  sheetName: string;
  conditionName: string;
  quantity: number;
  unit: string;
}

const TABLE_MARGIN_X = 20;

/** 'FF3B82F6' or '3B82F6' (ARGB/RGB hex) -> [r,g,b] 0-255 for autotable fillColor. */
export function argbToRgb(hex: string): [number, number, number] {
  const cleaned = hex.length === 8 ? hex.slice(2) : hex;
  return [
    parseInt(cleaned.slice(0, 2), 16),
    parseInt(cleaned.slice(2, 4), 16),
    parseInt(cleaned.slice(4, 6), 16),
  ];
}

/** Flattens the same per-condition `pages` records buildBySheetSheet groups, sorted
 * by sheet (natural sort) then condition name — one row per (sheet, condition) pair. */
export function buildSheetBreakdownRows(
  reportData: Record<string, BySheetConditionData>
): PdfSheetBreakdownRow[] {
  const rows: Array<PdfSheetBreakdownRow & { pageNumber: number }> = [];
  Object.values(reportData).forEach(({ condition, pages }) => {
    Object.values(pages).forEach((pageData) => {
      rows.push({
        sheetNumber: pageData.sheetNumber ?? '',
        sheetName: pageData.sheetName,
        conditionName: condition.name,
        quantity: pageData.total,
        unit: condition.unit,
        pageNumber: pageData.pageNumber,
      });
    });
  });
  rows.sort((a, b) => {
    const sheetDiff = compareSheetNumbers(a.sheetNumber || a.sheetName, b.sheetNumber || b.sheetName);
    if (sheetDiff !== 0) return sheetDiff;
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    return a.conditionName.localeCompare(b.conditionName);
  });
  return rows.map(({ pageNumber: _pageNumber, ...row }) => row);
}

// Dynamically imported per call, same reasoning as jsPDF itself in useTakeoffExport's
// exportToPDF: keeps a table-formatting library out of the main bundle for users who
// only ever export Excel.
async function loadAutoTable() {
  return (await import('jspdf-autotable')).default;
}

export async function buildConditionsSummaryTable(
  pdf: AutoTableDoc,
  rows: PdfConditionSummaryRow[],
  startY: number,
  accentRgb: [number, number, number]
): Promise<number> {
  const autoTable = await loadAutoTable();
  autoTable(pdf as never, {
    startY,
    margin: { left: TABLE_MARGIN_X, right: TABLE_MARGIN_X },
    head: [['Condition', 'Category', 'Qty', 'Unit', 'Material $', 'Equipment $']],
    body: rows.map((r) => [
      r.condition.name,
      r.category,
      r.qty.toFixed(2),
      r.condition.unit,
      `$${r.materialCost.toFixed(2)}`,
      `$${r.equipmentCost.toFixed(2)}`,
    ]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: accentRgb, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      2: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
  });
  return pdf.lastAutoTable?.finalY ?? startY;
}

export async function buildPageBreakdownTable(
  pdf: AutoTableDoc,
  rows: PdfSheetBreakdownRow[],
  startY: number,
  accentRgb: [number, number, number]
): Promise<number> {
  const autoTable = await loadAutoTable();
  autoTable(pdf as never, {
    startY,
    margin: { left: TABLE_MARGIN_X, right: TABLE_MARGIN_X },
    head: [['Sheet #', 'Sheet Name', 'Condition', 'Qty', 'Unit']],
    body: rows.map((r) => [r.sheetNumber, r.sheetName, r.conditionName, r.quantity.toFixed(2), r.unit]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: accentRgb, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      3: { halign: 'right' },
    },
    // A blank sheet number/name means "same sheet as the row above" — dedupe visually
    // by not repeating them, the same collapsed shape By Sheet's Excel grouping shows.
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      if (data.column.index !== 0 && data.column.index !== 1) return;
      const prevRow = rows[data.row.index - 1];
      const currentRow = rows[data.row.index];
      if (prevRow && currentRow && prevRow.sheetNumber === currentRow.sheetNumber && prevRow.sheetName === currentRow.sheetName) {
        data.cell.text = [''];
      }
    },
  });
  return pdf.lastAutoTable?.finalY ?? startY;
}
