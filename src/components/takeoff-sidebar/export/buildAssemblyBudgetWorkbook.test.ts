/**
 * The budget workbook is rendered and read back here, because the failure mode
 * it guards against is silent: a broken formula, a shifted column or a corrupt
 * file looks fine until an estimator opens it in Excel — or worse, until an
 * accounting import reads the wrong column.
 *
 * Column ORDER is asserted literally. This file feeds an accounting system;
 * a tidier arrangement would break it.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildAssemblyBudgetWorkbook } from './buildAssemblyBudgetWorkbook';
import type { ReportBranding } from './branding';
import type { AssemblyReport } from '../../../services/apiService';

const BRANDING: ReportBranding = {
  name: 'TEST CO',
  accentARGB: 'FF3B82F6',
  logoBase64: null,
};

const LABOR_ROW = {
  description: 'Aquafin-2K M',
  totalCost: 6183,
  manDays: 3,
  dayRatePerMan: 224,
  manHours: 24,
  regularPay: 672,
  payrollTax: 76.1376,
  workersComp: 51.8784,
  laborTotal: 800.016,
  material: 1000,
  equipment: 0,
  miscExpense: 45,
  generalLiability: 787.0959,
  overheadAndProfit: 3550.8881,
};

function report(overrides: Partial<AssemblyReport> = {}): AssemblyReport {
  return {
    materialLines: [
      {
        product: 'Aquafin 2K/M Standard gray',
        costCode: '1000',
        qty: 10,
        amountPlusTax: 225.25,
        uom: '77lb/bag',
        costType: '205',
        extendedCost: 2252.46,
        issue: null,
      },
      {
        product: 'Preprufe Tape',
        costCode: '2000',
        qty: 0,
        amountPlusTax: 0,
        uom: '',
        costType: '205',
        extendedCost: 0,
        issue: 'quantity copies the row above',
      },
    ],
    laborRows: [LABOR_ROW],
    laborTotals: { ...LABOR_ROW, description: 'Total', dayRatePerMan: 0 },
    workType: 'waterproofing',
    rates: { payrollTaxPct: 0.1133, workersCompPct: 0.0772, generalLiabilityPct: 0.1273 },
    reconciliationError: 0,
    warnings: [],
    ...overrides,
  };
}

async function render(input: AssemblyReport) {
  const { buffer, filename } = await buildAssemblyBudgetWorkbook(input, BRANDING, 'Test Project');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return { workbook, filename };
}

function rowValues(sheet: ExcelJS.Worksheet, rowNumber: number, count: number) {
  return Array.from({ length: count }, (_, i) => sheet.getCell(rowNumber, i + 1).value);
}

describe('buildAssemblyBudgetWorkbook', () => {
  it('produces a file Excel can actually open', async () => {
    const { workbook, filename } = await render(report());
    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      'Material Budgets',
      'Labor budgets',
      'Notes',
    ]);
    expect(filename).toMatch(/^Test-Project-Assembly-Budgets-.*\.xlsx$/);
  });

  it('keeps the material columns in the source workbook’s order', async () => {
    const { workbook } = await render(report());
    const sheet = workbook.getWorksheet('Material Budgets')!;
    // Row 4: title, subtitle, blank, header.
    expect(rowValues(sheet, 4, 7)).toEqual([
      'Product',
      'CostCode',
      'Qty',
      'Amount + Tax',
      'Uom',
      'CostType',
      'Extended',
    ]);
  });

  it('keeps the 14 labor columns in the source workbook’s order', async () => {
    const { workbook } = await render(report());
    const sheet = workbook.getWorksheet('Labor budgets')!;
    const header = sheet.getRow(9).values as unknown[];
    expect(header.slice(1, 15)).toEqual([
      'Description',
      'TotalCost',
      'ManDays',
      '$/ManDay',
      'ManHours',
      'Reg. Pay',
      '$P/R Tax',
      '$W/Comp',
      '$ Labor',
      'Material',
      'Equipment',
      'Misc.Exp',
      '$G/Liab',
      'OH&P',
    ]);
  });

  it('writes the material line values, Qty included', async () => {
    const { workbook } = await render(report());
    const sheet = workbook.getWorksheet('Material Budgets')!;
    expect(rowValues(sheet, 5, 7)).toEqual([
      'Aquafin 2K/M Standard gray',
      '1000',
      10,
      225.25,
      '77lb/bag',
      '205',
      2252.46,
    ]);
  });

  it('carries a flagged line’s reason into the cell as a note', async () => {
    const { workbook } = await render(report());
    const sheet = workbook.getWorksheet('Material Budgets')!;
    const note = sheet.getCell(6, 1).note;
    const text = typeof note === 'string' ? note : note?.texts?.map((t) => t.text).join('');
    expect(text).toContain('quantity copies the row above');
  });

  it('leaves a live reconciliation formula the recipient can watch', async () => {
    const { workbook } = await render(report());
    const sheet = workbook.getWorksheet('Labor budgets')!;
    // Header row 9, one data row 10, totals row 11, check at 13.
    const cell = sheet.getCell(13, 2).value as { formula?: string };
    expect(cell?.formula).toBe('I11+J11+K11+L11+M11+N11-B11');
    expect(sheet.getCell(13, 1).value).toContain('must be $0.00');
  });

  it('leaves the day-rate column blank on the totals row', async () => {
    const { workbook } = await render(report());
    const sheet = workbook.getWorksheet('Labor budgets')!;
    expect(sheet.getCell(11, 1).value).toBe('Total');
    // A blended rate across assemblies charging different rates is invented.
    expect(sheet.getCell(11, 4).value).toBe('');
  });

  it('states both departures from the Excel workbook on the Notes sheet', async () => {
    const { workbook } = await render(report());
    const notes = workbook.getWorksheet('Notes')!;
    const text = (notes.getSheetValues() as unknown[][])
      .flat()
      .filter((v) => typeof v === 'string')
      .join('\n');
    expect(text).toContain('Qty on the material budget is filled in');
    expect(text).toContain('Material carries the material cost');
  });

  it('shouts on the Notes sheet when the report does not reconcile', async () => {
    const { workbook } = await render(report({ reconciliationError: -12.5 }));
    const notes = workbook.getWorksheet('Notes')!;
    const text = (notes.getSheetValues() as unknown[][])
      .flat()
      .filter((v) => typeof v === 'string')
      .join('\n');
    expect(text).toContain('DOES NOT RECONCILE');
    expect(text).toContain('Do not file it');
  });

  it('lists pricing warnings for the reader', async () => {
    const { workbook } = await render(
      report({ warnings: ['Aquafin-2K M: "SF-Wall" is not measured by any condition'] })
    );
    const notes = workbook.getWorksheet('Notes')!;
    const text = (notes.getSheetValues() as unknown[][])
      .flat()
      .filter((v) => typeof v === 'string')
      .join('\n');
    expect(text).toContain('SF-Wall');
  });

  it('records the restoration basis in the subtitle and rates block', async () => {
    const { workbook } = await render(
      report({
        workType: 'restoration',
        rates: { payrollTaxPct: 0.1133, workersCompPct: 0.0772, generalLiabilityPct: 0.05337 },
      })
    );
    const sheet = workbook.getWorksheet('Labor budgets')!;
    expect(String(sheet.getCell('A2').value)).toContain('restoration');
    expect(sheet.getCell(6, 2).value).toBe(0.05337);
  });

  it('renders an empty report without producing a broken file', async () => {
    const { workbook } = await render(
      report({ materialLines: [], laborRows: [], warnings: [] })
    );
    expect(workbook.getWorksheet('Material Budgets')).toBeTruthy();
    expect(workbook.getWorksheet('Labor budgets')).toBeTruthy();
  });
});
