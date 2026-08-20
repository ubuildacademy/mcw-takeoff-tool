/**
 * Shared Excel number formats and header styling for the export builders.
 *
 * These were copy-pasted per builder (`headerStyle` was byte-identical in the purchase
 * order, work order, and assembly budget workbooks; `QTY_FMT` existed in five files), so
 * a branding or format change had to be repeated in every copy to keep exports
 * consistent. Defined once here instead.
 */
import type ExcelJS from 'exceljs';
import type { ReportBranding } from './branding';

/** Quantities: thousands-separated, two decimals. */
export const QTY_FMT = '#,##0.00';
/** Currency: leading $, thousands-separated, two decimals. */
export const MONEY_FMT = '"$"#,##0.00';

/** Header row: white bold text on the company accent color, thin bottom rule. */
export function headerStyle(branding: ReportBranding): Partial<ExcelJS.Style> {
  return {
    font: { bold: true, size: 11, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: branding.accentARGB } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } },
  };
}
