/**
 * Work Order document — job-info header (scoped 2026-08-10 straight from a real MCW
 * workbook's WORK ORDER + BASIC JOB INFO sheets) plus the same consolidated materials
 * list the P.O. generator already builds (`buildPurchaseOrderWorkbook.ts`), reused as-is:
 * one line per product, summed across every priced condition — the WORK ORDER sheet's
 * Materials table is the same shape (Materials | Qty | Unit Type), just without a price
 * column and with a Colors column the source sheet fills in by hand.
 *
 * Equipment, Incidentals, Accessories, Supplier and Man Days are blank cells in the
 * source template too — nothing in Meridian's data model drives them, so they're left
 * for the estimator to fill in on paper/in Excel, same as the P.O.'s blank Price column.
 */
import ExcelJS from 'exceljs';
import type { ReportBranding } from './branding';
import type { PurchaseOrder } from '../../../services/apiService';
import type { JobInfo } from '../../../types';
import { QTY_FMT, headerStyle } from './sheetStyles';


/**
 * Label/value pairs, two per row (A/B and D/E), skipping pairs where both sides are
 * empty — except the first row (JOB NAME / JOB #), which always renders so the document
 * has a fixed, predictable top line even on a project with no other job info filled in.
 */
function writeInfoGrid(sheet: ExcelJS.Worksheet, startRow: number, pairs: [string, string][]): number {
  let row = startRow;
  for (let i = 0; i < pairs.length; i += 2) {
    const [leftLabel, leftValue] = pairs[i];
    const right = pairs[i + 1];
    if (i > 0 && !leftValue && !(right?.[1])) continue;
    sheet.getCell(row, 1).value = leftLabel;
    sheet.getCell(row, 1).font = { bold: true };
    sheet.getCell(row, 2).value = leftValue;
    if (right) {
      sheet.getCell(row, 4).value = right[0];
      sheet.getCell(row, 4).font = { bold: true };
      sheet.getCell(row, 5).value = right[1];
    }
    row += 1;
  }
  return row;
}

export async function buildWorkOrderWorkbook(
  po: PurchaseOrder,
  branding: ReportBranding
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const info: JobInfo = po.jobInfo ?? {};
  const workbook = new ExcelJS.Workbook();
  workbook.creator = branding.name;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Work Order');
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 28;
  sheet.getColumn(3).width = 4;
  sheet.getColumn(4).width = 20;
  sheet.getColumn(5).width = 28;

  sheet.mergeCells('A1:E1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `${branding.name} — WORK ORDER`;
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
      console.error('Failed to embed report logo, continuing without it:', error);
    }
  }

  let row = 3;
  row = writeInfoGrid(sheet, row, [
    ['JOB NAME', po.jobName || ''], ['JOB #', po.jobNumber || ''],
    ['JOB ADDRESS', info.jobAddress ?? ''], ['# OF STORIES', info.numberOfStories ?? ''],
    ['COMPANY', info.company ?? ''], ['EST. START DATE', info.estStartDate ?? ''],
    ['GENERAL CONTRACTOR', info.generalContractor ?? ''], ['GC PHONE', info.gcPhone ?? ''],
    ['GC ADDRESS', info.gcAddress ?? ''], ['', ''],
    ['SUPERINTENDENT', info.superintendent ?? ''], ['SUPT. CELL', info.superintendentCell ?? ''],
    ['GC PROJECT MANAGER', info.gcProjectManager ?? ''], ['GC PM PHONE', info.gcProjectManagerPhone ?? ''],
    ['OWNER', info.ownerName ?? ''], ['OWNER PHONE', info.ownerPhone ?? ''],
    ['ARCHITECT', info.architectName ?? ''], ['ARCHITECT PHONE', info.architectPhone ?? ''],
    ['WARRANTY REQUIRED', info.warrantyRequired ?? ''], ['NTO REQUIRED', info.ntoRequired ?? ''],
    ['INSURANCE CERTIFICATE', info.insuranceCertificate ?? ''], ['PERMIT REQUIRED', info.permitRequired ?? ''],
    ['BOND REQUIRED', info.bondRequired ?? ''], ['CONTRACT AMOUNT', info.contractAmount ?? ''],
    ['BILLING DUE DATE', info.billingDueDate ?? ''], ['CONTRACT RECEIVED', info.contractReceived ?? ''],
    ['CONTRACT RETURNED', info.contractReturned ?? ''], ['EXECUTED ON FILE', info.executedOnFile ?? ''],
  ]);

  if (info.scopeOfWork) {
    row += 1;
    sheet.getCell(row, 1).value = 'SCOPE OF WORK';
    sheet.getCell(row, 1).font = { bold: true };
    row += 1;
    sheet.mergeCells(row, 1, row, 5);
    const scopeCell = sheet.getCell(row, 1);
    scopeCell.value = info.scopeOfWork;
    scopeCell.alignment = { wrapText: true, vertical: 'top' };
    sheet.getRow(row).height = Math.max(20, Math.ceil(info.scopeOfWork.length / 90) * 15);
    row += 1;
  }

  row += 1;
  const columns = [
    { label: 'Materials', width: 40 },
    { label: 'Qty', width: 10 },
    { label: 'Unit Type', width: 14 },
    { label: 'Colors', width: 20 },
  ];
  columns.forEach(({ label, width }, index) => {
    const cell = sheet.getCell(row, index + 1);
    cell.value = label;
    cell.style = headerStyle(branding);
    sheet.getColumn(index + 1).width = Math.max(sheet.getColumn(index + 1).width ?? 0, width);
  });
  sheet.getRow(row).height = 28;
  row += 1;

  for (const line of po.lines) {
    sheet.getCell(row, 1).value = line.product;
    sheet.getCell(row, 2).value = line.qty;
    sheet.getCell(row, 2).numFmt = QTY_FMT;
    sheet.getCell(row, 3).value = line.uom ?? '';
    // Colors is filled by hand — not tracked on a component in Meridian's data model.
    sheet.getCell(row, 4).value = '';

    if (line.issue) {
      for (let col = 1; col <= 4; col += 1) {
        sheet.getCell(row, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      }
      sheet.getCell(row, 1).note = line.issue;
    }
    row += 1;
  }

  if (po.warnings.length > 0) {
    row += 1;
    for (const warning of po.warnings) {
      sheet.getCell(row, 1).value = `⚠ ${warning}`;
      sheet.getCell(row, 1).font = { italic: true, color: { argb: 'FFB45309' } };
      row += 1;
    }
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const safeName = (po.jobName || 'project').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-');
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  return { buffer, filename: `${safeName}-Work-Order-${timestamp}.xlsx` };
}
