/**
 * Builds the flat, pivot-ready "Data" worksheet for the Excel export: one row per
 * measurement, plain values only (no formulas, no merged cells, no protection).
 * Called from useTakeoffExport's exportToExcel after the _Calc sheet so the Data
 * tab is added last and existing sheet order/names are untouched.
 */
import type ExcelJS from 'exceljs';
import type { ConditionFolder, TakeoffCondition } from '../../../types';

export interface DataSheetEntry {
  condition: TakeoffCondition;
  pageData: { pageNumber: number; sheetName: string; sheetNumber: string | null; sheetId: string };
  measurement: {
    netCalculatedValue?: number;
    calculatedValue: number;
    timestamp: string;
    areaValue?: number;
    perimeterValue?: number;
  };
}

const QTY_FMT = '#,##0.00';
const MONEY_FMT = '"$"#,##0.00';

/** Timestamps are stored as epoch-millis strings; fall back to Date parsing. */
function toIsoDate(timestamp: string | undefined): string {
  if (!timestamp) return '';
  const asNumber = Number(timestamp);
  const date = new Date(Number.isFinite(asNumber) && timestamp.trim() !== '' ? asNumber : timestamp);
  if (isNaN(date.getTime())) return '';
  return date.toISOString();
}

export async function buildDataSheet(
  workbook: ExcelJS.Workbook,
  allMeasurements: DataSheetEntry[],
  projectId: string,
  headerStyle: Partial<ExcelJS.Style>
): Promise<void> {
  // Folder (category) lookup — load lazily; a failed load just means "Uncategorized".
  let folders: ConditionFolder[] = [];
  try {
    const { useConditionFolderStore } = await import('../../../store/slices/conditionFolderSlice');
    await useConditionFolderStore.getState().ensureFoldersLoaded(projectId);
    folders = useConditionFolderStore.getState().getFolders(projectId);
  } catch {
    // fall through with empty folder list
  }
  const folderNamesById = new Map(folders.map((f) => [f.id, f.name]));

  const dataSheet = workbook.addWorksheet('Data');

  const headers: Array<{ label: string; width: number }> = [
    { label: 'Condition', width: 25 },
    { label: 'Category', width: 20 },
    { label: 'Type', width: 10 },
    { label: 'Quantity', width: 12 },
    { label: 'Unit', width: 8 },
    { label: 'Sub-Qty Total', width: 14 },
    { label: 'Sub-Qty Unit', width: 12 },
    { label: 'Area (SF)', width: 12 },
    { label: 'Perimeter (LF)', width: 14 },
    { label: 'Height', width: 10 },
    { label: 'Sheet Number', width: 14 },
    { label: 'Sheet Name', width: 35 },
    { label: 'Page', width: 8 },
    { label: 'Multiplier', width: 10 },
    { label: 'Waste %', width: 10 },
    { label: 'Material $/Unit', width: 14 },
    { label: 'Equipment $', width: 12 },
    { label: 'Description', width: 30 },
    { label: 'Measured At', width: 22 },
  ];
  headers.forEach(({ label, width }, colIdx) => {
    const cell = dataSheet.getCell(1, colIdx + 1);
    cell.value = label;
    cell.style = headerStyle;
    dataSheet.getColumn(colIdx + 1).width = width;
  });

  allMeasurements.forEach(({ condition, pageData, measurement }, idx) => {
    const rowNum = idx + 2;
    const quantity = measurement.netCalculatedValue ?? measurement.calculatedValue;
    let col = 1;
    const setCell = (value: ExcelJS.CellValue, numFmt?: string) => {
      const cell = dataSheet.getCell(rowNum, col++);
      if (value !== null && value !== '') cell.value = value;
      if (numFmt) cell.numFmt = numFmt;
    };
    setCell(condition.name);
    setCell(condition.folderId ? folderNamesById.get(condition.folderId) ?? 'Uncategorized' : 'Uncategorized');
    setCell(condition.type);
    setCell(quantity, QTY_FMT);
    setCell(condition.unit);
    const hasSubQty = condition.subQuantityPerCount != null && condition.subQuantityPerCount > 0;
    setCell(hasSubQty ? quantity * (condition.subQuantityPerCount ?? 0) : null, QTY_FMT);
    setCell(hasSubQty ? condition.subQuantityUnit ?? '' : null);
    // Area mirrors the Quantities sheet: explicit value, or derived for linear-with-height.
    if (measurement.areaValue != null) {
      setCell(measurement.areaValue, QTY_FMT);
    } else if (condition.type === 'linear' && condition.includeHeight && condition.height) {
      setCell(quantity * condition.height, QTY_FMT);
    } else {
      setCell(null, QTY_FMT);
    }
    setCell(measurement.perimeterValue ?? null, QTY_FMT);
    setCell(
      condition.type === 'linear' && condition.includeHeight && condition.height ? condition.height : null,
      QTY_FMT
    );
    setCell(pageData.sheetNumber ?? '');
    setCell(pageData.sheetName);
    setCell(pageData.pageNumber);
    setCell(condition.multiplier ?? 1, '#,##0');
    setCell(condition.wasteFactor ?? 0, '0.00');
    setCell(condition.materialCost ?? null, MONEY_FMT);
    setCell(condition.equipmentCost ?? null, MONEY_FMT);
    setCell(condition.description ?? '');
    setCell(toIsoDate(measurement.timestamp));
  });

  dataSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
  dataSheet.views = [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }];
}
