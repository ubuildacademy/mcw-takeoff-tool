/**
 * Purchase-order material list, consolidated across every assembly in the project.
 *
 * Deliberately not a one-per-assembly document like the source workbooks' P.O. sheet
 * (Jeff, 2026-07-31: fewer documents to send out beats matching the workbook shape
 * exactly) — one product bought by three different assemblies on the same job is one
 * line at 3x quantity, not three lines.
 *
 * Price is left BLANK, matching the source sheet: the estimator confirms it live with
 * the supplier rather than Meridian's price list going out on a document to a vendor.
 */
import ExcelJS from 'exceljs';
import type { ReportBranding } from './branding';
import type { PurchaseOrder } from '../../../services/apiService';

const QTY_FMT = '#,##0.00';

function headerStyle(branding: ReportBranding): Partial<ExcelJS.Style> {
  return {
    font: { bold: true, size: 11, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: branding.accentARGB } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } },
  };
}

export async function buildPurchaseOrderWorkbook(
  po: PurchaseOrder,
  branding: ReportBranding
): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = branding.name;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Purchase Order');
  sheet.mergeCells('A1:E1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `${branding.name} — PURCHASE ORDER`;
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

  // Job header — matches the source P.O. sheet: JOB NAME / JOB #, nothing else.
  sheet.getCell('A3').value = 'JOB NAME';
  sheet.getCell('A3').font = { bold: true };
  sheet.getCell('B3').value = po.jobName || 'Insert job name';
  sheet.getCell('D3').value = 'JOB #';
  sheet.getCell('D3').font = { bold: true };
  sheet.getCell('E3').value = po.jobNumber || '';

  let row = 5;
  const columns = [
    { label: 'Materials', width: 40 },
    { label: 'Product / Cost Codes', width: 20 },
    { label: 'Qty', width: 10 },
    { label: 'Price', width: 14 },
    { label: 'S/P', width: 14 },
  ];
  columns.forEach(({ label, width }, index) => {
    const cell = sheet.getCell(row, index + 1);
    cell.value = label;
    cell.style = headerStyle(branding);
    sheet.getColumn(index + 1).width = width;
  });
  sheet.getRow(row).height = 28;
  row += 1;

  for (const line of po.lines) {
    sheet.getCell(row, 1).value = line.product;
    sheet.getCell(row, 2).value = line.costCode ?? '';
    sheet.getCell(row, 3).value = line.qty;
    sheet.getCell(row, 3).numFmt = QTY_FMT;
    // Price and Supplier are deliberately blank — the estimator fills these in
    // after calling the supplier, same as the source workbook.
    sheet.getCell(row, 4).value = '';
    sheet.getCell(row, 5).value = '';

    if (line.issue) {
      for (let col = 1; col <= 5; col += 1) {
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
  return { buffer, filename: `${safeName}-Purchase-Order-${timestamp}.xlsx` };
}
