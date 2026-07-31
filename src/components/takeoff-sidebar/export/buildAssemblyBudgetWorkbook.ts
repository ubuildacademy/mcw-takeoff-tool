/**
 * Task I7 — the downloadable Material / Labor budget workbook.
 *
 * Mirrors the two sheets MCW's assembly workbooks hand to accounting, so a bid
 * can leave Meridian without anyone opening Excel. Columns, order and headers
 * match the source sheets exactly — this file feeds an accounting import, and
 * a "nicer" column order would break it.
 *
 * Two deliberate departures from the source, both improvements rather than
 * accidents, and both stated in the workbook itself on the Notes sheet:
 *
 *  - **Qty is filled in.** The workbooks leave that column empty for someone to
 *    complete from the P.O.; Meridian already knows the package count.
 *  - **Material carries the material cost.** The source sheets read that column
 *    from an empty cell, so material falls into the OH&P residual and the
 *    column reads $0 on every sheet. The job total is identical either way.
 */
import ExcelJS from 'exceljs';
import type { ReportBranding } from './branding';
import type { AssemblyReport } from '../../../services/apiService';

const MONEY_FMT = '"$"#,##0.00';
const QTY_FMT = '#,##0.00';
const PCT_FMT = '0.000%';

function headerStyle(branding: ReportBranding): Partial<ExcelJS.Style> {
  return {
    font: { bold: true, size: 11, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: branding.accentARGB } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } },
  };
}

function writeHeaderRow(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  columns: { label: string; width: number }[],
  branding: ReportBranding
): void {
  const style = headerStyle(branding);
  columns.forEach(({ label, width }, index) => {
    const cell = sheet.getCell(rowNumber, index + 1);
    cell.value = label;
    cell.style = style;
    sheet.getColumn(index + 1).width = width;
  });
  sheet.getRow(rowNumber).height = 28;
}

/** Title block shared by both sheets, so either one stands alone when printed. */
function writeTitle(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  lastColumn: string,
  branding: ReportBranding
): number {
  sheet.mergeCells(`A1:${lastColumn}1`);
  const titleCell = sheet.getCell('A1');
  titleCell.value = `${branding.name} — ${title}`;
  titleCell.style = {
    font: { bold: true, size: 16, color: { argb: 'FF1F2937' } },
    alignment: { horizontal: 'left', vertical: 'middle' },
    border: { bottom: { style: 'medium', color: { argb: branding.accentARGB } } },
  };
  sheet.getRow(1).height = 34;

  if (branding.logoBase64) {
    try {
      const logoId = workbook.addImage({ extension: 'png', base64: branding.logoBase64 });
      sheet.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 60, height: 45 } });
    } catch (error) {
      // A bad logo must never cost someone their report.
      console.error('Failed to embed report logo, continuing without it:', error);
    }
  }

  sheet.mergeCells(`A2:${lastColumn}2`);
  const subtitleCell = sheet.getCell('A2');
  subtitleCell.value = subtitle;
  subtitleCell.style = {
    font: { size: 10, color: { argb: 'FF6B7280' } },
    alignment: { horizontal: 'left', vertical: 'middle' },
  };
  return 4;
}

function buildMaterialSheet(
  workbook: ExcelJS.Workbook,
  report: AssemblyReport,
  subtitle: string,
  branding: ReportBranding
): void {
  const sheet = workbook.addWorksheet('Material Budgets');
  let row = writeTitle(workbook, sheet, 'MATERIAL BUDGET', subtitle, 'G', branding);

  writeHeaderRow(
    sheet,
    row,
    [
      { label: 'Product', width: 42 },
      { label: 'CostCode', width: 12 },
      { label: 'Qty', width: 10 },
      { label: 'Amount + Tax', width: 15 },
      { label: 'Uom', width: 14 },
      { label: 'CostType', width: 10 },
      { label: 'Extended', width: 15 },
    ],
    branding
  );
  row += 1;

  for (const line of report.materialLines) {
    sheet.getCell(row, 1).value = line.product;
    sheet.getCell(row, 2).value = line.costCode ?? '';
    sheet.getCell(row, 3).value = line.qty;
    sheet.getCell(row, 4).value = line.amountPlusTax;
    sheet.getCell(row, 5).value = line.uom;
    sheet.getCell(row, 6).value = line.costType;
    sheet.getCell(row, 7).value = line.extendedCost;
    sheet.getCell(row, 3).numFmt = QTY_FMT;
    sheet.getCell(row, 4).numFmt = MONEY_FMT;
    sheet.getCell(row, 7).numFmt = MONEY_FMT;

    // A flagged line is tinted and carries its reason as a cell note, so it
    // survives being printed or pasted into another sheet.
    if (line.issue) {
      for (let col = 1; col <= 7; col += 1) {
        sheet.getCell(row, col).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEF3C7' },
        };
      }
      sheet.getCell(row, 1).note = line.issue;
    }
    row += 1;
  }

  const totalRow = row;
  sheet.getCell(totalRow, 1).value = 'Total';
  sheet.getCell(totalRow, 7).value = {
    formula: `SUM(G${totalRow - report.materialLines.length}:G${totalRow - 1})`,
  };
  sheet.getCell(totalRow, 7).numFmt = MONEY_FMT;
  for (let col = 1; col <= 7; col += 1) {
    sheet.getCell(totalRow, col).font = { bold: true };
    sheet.getCell(totalRow, col).border = {
      top: { style: 'medium', color: { argb: branding.accentARGB } },
    };
  }
}

const LABOR_COLUMNS: { label: string; width: number; money: boolean }[] = [
  { label: 'Description', width: 32, money: false },
  { label: 'TotalCost', width: 15, money: true },
  { label: 'ManDays', width: 10, money: false },
  { label: '$/ManDay', width: 12, money: true },
  { label: 'ManHours', width: 11, money: false },
  { label: 'Reg. Pay', width: 14, money: true },
  { label: '$P/R Tax', width: 13, money: true },
  { label: '$W/Comp', width: 13, money: true },
  { label: '$ Labor', width: 14, money: true },
  { label: 'Material', width: 14, money: true },
  { label: 'Equipment', width: 13, money: true },
  { label: 'Misc.Exp', width: 13, money: true },
  { label: '$G/Liab', width: 13, money: true },
  { label: 'OH&P', width: 15, money: true },
];

function laborValues(row: AssemblyReport['laborTotals']): (string | number)[] {
  return [
    row.description,
    row.totalCost,
    row.manDays,
    row.dayRatePerMan,
    row.manHours,
    row.regularPay,
    row.payrollTax,
    row.workersComp,
    row.laborTotal,
    row.material,
    row.equipment,
    row.miscExpense,
    row.generalLiability,
    row.overheadAndProfit,
  ];
}

function buildLaborSheet(
  workbook: ExcelJS.Workbook,
  report: AssemblyReport,
  subtitle: string,
  branding: ReportBranding
): void {
  const sheet = workbook.addWorksheet('Labor budgets');
  let row = writeTitle(workbook, sheet, 'LABOR BUDGET', subtitle, 'N', branding);

  // The rates block, in the same place the source sheet keeps it.
  const rates: [string, number][] = [
    ['P/R Tax %:', report.rates.payrollTaxPct],
    ['W/Comp %:', report.rates.workersCompPct],
    ['G/Liability %:', report.rates.generalLiabilityPct],
  ];
  for (const [label, value] of rates) {
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 1).font = { bold: true };
    sheet.getCell(row, 2).value = value;
    sheet.getCell(row, 2).numFmt = PCT_FMT;
    row += 1;
  }
  sheet.getCell(row, 1).value = `Liability basis: ${report.workType}`;
  sheet.getCell(row, 1).font = { italic: true, color: { argb: 'FF6B7280' } };
  row += 2;

  writeHeaderRow(sheet, row, LABOR_COLUMNS, branding);
  row += 1;

  const firstDataRow = row;
  for (const laborRow of report.laborRows) {
    laborValues(laborRow).forEach((value, index) => {
      const cell = sheet.getCell(row, index + 1);
      cell.value = value;
      if (LABOR_COLUMNS[index].money) cell.numFmt = MONEY_FMT;
    });
    row += 1;
  }

  const totalRow = row;
  laborValues(report.laborTotals).forEach((value, index) => {
    const cell = sheet.getCell(totalRow, index + 1);
    // The day-rate column is blank on a totals row: a blended rate across
    // assemblies that charge different rates would be an invented number.
    cell.value = index === 3 ? '' : value;
    if (LABOR_COLUMNS[index].money && index !== 3) cell.numFmt = MONEY_FMT;
    cell.font = { bold: true };
    cell.border = { top: { style: 'medium', color: { argb: branding.accentARGB } } };
  });

  // A live check the recipient can see, not just one Meridian ran. If someone
  // edits a bucket in Excel, this cell stops reading zero.
  row = totalRow + 2;
  sheet.getCell(row, 1).value = 'Buckets − TotalCost (must be $0.00)';
  sheet.getCell(row, 1).font = { bold: true };
  sheet.getCell(row, 2).value = {
    formula: `I${totalRow}+J${totalRow}+K${totalRow}+L${totalRow}+M${totalRow}+N${totalRow}-B${totalRow}`,
  };
  sheet.getCell(row, 2).numFmt = MONEY_FMT;

  sheet.views = [{ state: 'frozen', ySplit: firstDataRow - 1 }];
}

function buildNotesSheet(
  workbook: ExcelJS.Workbook,
  report: AssemblyReport,
  branding: ReportBranding
): void {
  const sheet = workbook.addWorksheet('Notes');
  sheet.getColumn(1).width = 110;
  let row = 1;

  const write = (text: string, bold = false) => {
    const cell = sheet.getCell(row, 1);
    cell.value = text;
    cell.style = { font: { bold, size: 11 }, alignment: { wrapText: true, vertical: 'top' } };
    row += 1;
  };

  write(`${branding.name} — how to read this report`, true);
  row += 1;
  write('The labor budget decomposes the job total into posting buckets. OH&P is the residual: every other bucket is subtracted from the total, and what is left is overhead and profit. The buckets therefore always sum back to the total.');
  row += 1;
  write('Two differences from the Excel assembly workbook:', true);
  write('1. Qty on the material budget is filled in. The workbook leaves that column empty to be completed from the P.O.; Meridian already knows the package count from the coverage yield.');
  write('2. Material carries the material cost. The workbook reads that column from a cell that is empty, so material falls through into OH&P and the column reads $0. The job total is identical either way — only the split differs.');
  row += 1;

  if (report.warnings.length > 0) {
    write('Check before filing:', true);
    for (const warning of report.warnings) write(`• ${warning}`);
    row += 1;
  }

  if (report.reconciliationError !== 0) {
    write(
      `THIS REPORT DOES NOT RECONCILE — buckets are off the job total by ${report.reconciliationError.toFixed(2)}. Do not file it.`,
      true
    );
  }

  write(`Generated ${new Date().toLocaleString()}.`);
}

export async function buildAssemblyBudgetWorkbook(
  report: AssemblyReport,
  branding: ReportBranding,
  projectName: string
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = branding.name;
  workbook.created = new Date();

  const subtitle = `${projectName} · ${report.laborRows.length} assembly line${
    report.laborRows.length === 1 ? '' : 's'
  } · liability basis: ${report.workType}`;

  buildMaterialSheet(workbook, report, subtitle, branding);
  buildLaborSheet(workbook, report, subtitle, branding);
  buildNotesSheet(workbook, report, branding);

  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const safeName = projectName.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-') || 'project';
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  return { buffer, filename: `${safeName}-Assembly-Budgets-${timestamp}.xlsx` };
}
