/**
 * Rendered and read back, same reasoning as buildAssemblyBudgetWorkbook.test.ts: a
 * shifted column or blank job header looks fine until someone opens it and sends it
 * to a supplier.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildPurchaseOrderWorkbook } from './buildPurchaseOrderWorkbook';
import type { ReportBranding } from './branding';
import type { PurchaseOrder } from '../../../services/apiService';

const BRANDING: ReportBranding = {
  name: 'TEST CO',
  accentARGB: 'FF3B82F6',
  logoBase64: null,
};

function po(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    jobName: 'Test Project',
    jobNumber: 'J-1234',
    lines: [
      { product: 'Aquafin 2K/M Standard gray', costCode: '1000', qty: 14, uom: '77lb/bag', issue: null },
      { product: 'Preprufe Tape', costCode: '2000', qty: 0, uom: '', issue: 'quantity copies the row above' },
    ],
    warnings: [],
    ...overrides,
  };
}

async function render(input: PurchaseOrder) {
  const { buffer, filename } = await buildPurchaseOrderWorkbook(input, BRANDING);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return { workbook, filename };
}

function rowValues(sheet: ExcelJS.Worksheet, rowNumber: number, count: number) {
  return Array.from({ length: count }, (_, i) => sheet.getCell(rowNumber, i + 1).value);
}

describe('buildPurchaseOrderWorkbook', () => {
  it('produces a file Excel can actually open', async () => {
    const { workbook, filename } = await render(po());
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['Purchase Order']);
    expect(filename).toMatch(/^Test-Project-Purchase-Order-.*\.xlsx$/);
  });

  it('writes the job header — Job Name and Job #, nothing else', async () => {
    const { workbook } = await render(po());
    const sheet = workbook.getWorksheet('Purchase Order')!;
    expect(sheet.getCell('A3').value).toBe('JOB NAME');
    expect(sheet.getCell('B3').value).toBe('Test Project');
    expect(sheet.getCell('D3').value).toBe('JOB #');
    expect(sheet.getCell('E3').value).toBe('J-1234');
  });

  it('keeps the material columns in the source sheet’s order', async () => {
    const { workbook } = await render(po());
    const sheet = workbook.getWorksheet('Purchase Order')!;
    expect(rowValues(sheet, 5, 5)).toEqual(['Materials', 'Product / Cost Codes', 'Qty', 'Price', 'S/P']);
  });

  it('writes the material line, Qty included, Price and S/P blank like the workbook', async () => {
    const { workbook } = await render(po());
    const sheet = workbook.getWorksheet('Purchase Order')!;
    expect(rowValues(sheet, 6, 5)).toEqual(['Aquafin 2K/M Standard gray', '1000', 14, '', '']);
  });

  it('carries a flagged line’s reason into the cell as a note', async () => {
    const { workbook } = await render(po());
    const sheet = workbook.getWorksheet('Purchase Order')!;
    const note = sheet.getCell(7, 1).note;
    const text = typeof note === 'string' ? note : note?.texts?.map((t) => t.text).join('');
    expect(text).toContain('quantity copies the row above');
  });

  it('falls back to a placeholder job name and blank job number when unset', async () => {
    const { workbook } = await render(po({ jobName: '', jobNumber: '' }));
    const sheet = workbook.getWorksheet('Purchase Order')!;
    expect(sheet.getCell('B3').value).toBe('Insert job name');
    expect(sheet.getCell('E3').value).toBe('');
  });

  it('lists warnings for the reader', async () => {
    const { workbook } = await render(
      po({ warnings: ['1 condition(s) are linked to an assembly that is no longer in the library'] })
    );
    const sheet = workbook.getWorksheet('Purchase Order')!;
    const text = (sheet.getSheetValues() as unknown[][])
      .flat()
      .filter((v) => typeof v === 'string')
      .join('\n');
    expect(text).toContain('no longer in the library');
  });

  it('renders an empty purchase order without producing a broken file', async () => {
    const { workbook } = await render(po({ lines: [], warnings: [] }));
    expect(workbook.getWorksheet('Purchase Order')).toBeTruthy();
  });
});
