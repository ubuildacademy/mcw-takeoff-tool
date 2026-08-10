/**
 * Rendered and read back, same reasoning as buildPurchaseOrderWorkbook.test.ts. Row
 * positions below the job header are data-dependent (blank job-info fields are skipped),
 * so most assertions scan the sheet's values rather than pin exact cell refs.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkOrderWorkbook } from './buildWorkOrderWorkbook';
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
    jobInfo: {
      jobAddress: '123 Main St',
      generalContractor: 'ACME Construction',
      superintendent: 'Bob Smith',
      scopeOfWork: 'Waterproof the below-grade parking garage.',
    },
    ...overrides,
  };
}

async function render(input: PurchaseOrder) {
  const { buffer, filename } = await buildWorkOrderWorkbook(input, BRANDING);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return { workbook, filename };
}

function allText(sheet: ExcelJS.Worksheet): string {
  return (sheet.getSheetValues() as unknown[][])
    .flat()
    .filter((v) => typeof v === 'string')
    .join('\n');
}

function findRow(sheet: ExcelJS.Worksheet, firstCellValue: string, count: number): unknown[] | null {
  for (let r = 1; r <= sheet.rowCount; r += 1) {
    if (sheet.getCell(r, 1).value === firstCellValue) {
      return Array.from({ length: count }, (_, i) => sheet.getCell(r, i + 1).value);
    }
  }
  return null;
}

describe('buildWorkOrderWorkbook', () => {
  it('produces a file Excel can actually open', async () => {
    const { workbook, filename } = await render(po());
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['Work Order']);
    expect(filename).toMatch(/^Test-Project-Work-Order-.*\.xlsx$/);
  });

  it('always writes Job Name / Job # on the first info row, even with everything else blank', async () => {
    const { workbook } = await render(po({ jobInfo: null }));
    const sheet = workbook.getWorksheet('Work Order')!;
    expect(sheet.getCell('A3').value).toBe('JOB NAME');
    expect(sheet.getCell('B3').value).toBe('Test Project');
    expect(sheet.getCell('D3').value).toBe('JOB #');
    expect(sheet.getCell('E3').value).toBe('J-1234');
  });

  it('carries job-info fields into the header grid', async () => {
    const { workbook } = await render(po());
    const sheet = workbook.getWorksheet('Work Order')!;
    const text = allText(sheet);
    expect(text).toContain('123 Main St');
    expect(text).toContain('ACME Construction');
    expect(text).toContain('Bob Smith');
  });

  it('writes the scope of work as its own block', async () => {
    const { workbook } = await render(po());
    const sheet = workbook.getWorksheet('Work Order')!;
    expect(allText(sheet)).toContain('Waterproof the below-grade parking garage.');
  });

  it('omits the scope of work block when not set, without breaking the file', async () => {
    const { workbook } = await render(po({ jobInfo: { jobAddress: '123 Main St' } }));
    const sheet = workbook.getWorksheet('Work Order')!;
    expect(allText(sheet)).not.toContain('SCOPE OF WORK');
  });

  it('materials table: Materials | Qty | Unit Type | Colors, Colors left blank', async () => {
    const { workbook } = await render(po());
    const sheet = workbook.getWorksheet('Work Order')!;
    const headerRow = findRow(sheet, 'Materials', 4);
    expect(headerRow).toEqual(['Materials', 'Qty', 'Unit Type', 'Colors']);

    const lineRow = findRow(sheet, 'Aquafin 2K/M Standard gray', 4);
    expect(lineRow).toEqual(['Aquafin 2K/M Standard gray', 14, '77lb/bag', '']);
  });

  it('carries a flagged line’s reason into the cell as a note', async () => {
    const { workbook } = await render(po());
    const sheet = workbook.getWorksheet('Work Order')!;
    const row = sheet.getSheetValues() as unknown[][];
    const flaggedRowIndex = row.findIndex((r) => r?.[1] === 'Preprufe Tape');
    const note = sheet.getCell(flaggedRowIndex, 1).note;
    const text = typeof note === 'string' ? note : (note as { texts?: { text: string }[] })?.texts?.map((t) => t.text).join('');
    expect(text).toContain('quantity copies the row above');
  });

  it('lists warnings for the reader', async () => {
    const { workbook } = await render(
      po({ warnings: ['1 condition(s) are linked to an assembly that is no longer in the library'] })
    );
    const sheet = workbook.getWorksheet('Work Order')!;
    expect(allText(sheet)).toContain('no longer in the library');
  });

  it('renders an empty work order without producing a broken file', async () => {
    const { workbook } = await render(po({ lines: [], warnings: [], jobInfo: null }));
    expect(workbook.getWorksheet('Work Order')).toBeTruthy();
  });
});
