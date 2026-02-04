/**
 * Hook that encapsulates takeoff export logic: quantity report data aggregation,
 * cost analysis, Excel export, and PDF export. Used by TakeoffSidebar.
 */
import { useConditionStore } from '../../store/slices/conditionSlice';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import { useProjectStore } from '../../store/slices/projectSlice';
import { useAnnotationStore } from '../../store/slices/annotationSlice';
import { useDocumentViewStore } from '../../store/slices/documentViewSlice';
import { toast } from 'sonner';
import { sheetService } from '../../services/apiService';
import type { TakeoffCondition, TakeoffMeasurement, PDFDocument, Sheet } from '../../types';

export interface UseTakeoffExportOptions {
  projectId: string;
  documents: PDFDocument[];
  onExportStatusUpdate?: (type: 'excel' | 'pdf' | null, progress: number) => void;
}

export interface ReportDataPage {
  pageNumber: number;
  sheetName: string;
  sheetNumber: string | null;
  sheetId: string;
  measurements: unknown[];
  total: number;
}

export interface UseTakeoffExportResult {
  getQuantityReportData: () => {
    reportData: Record<string, { condition: TakeoffCondition; pages: Record<string, ReportDataPage>; grandTotal: number }>;
    sortedPages: Array<{ pageNumber: number; sheetName: string; sheetId: string; sheetNumber?: string | null }>;
  };
  getQuantityReportDataAsync: () => Promise<{
    reportData: Record<string, { condition: TakeoffCondition; pages: Record<string, ReportDataPage>; grandTotal: number }>;
    sortedPages: Array<{ pageNumber: number; sheetName: string; sheetNumber: string | null; sheetId: string }>;
  }>;
  getCostAnalysisData: () => {
    costData: Record<string, {
      condition: TakeoffCondition;
      quantity: number;
      materialCostPerUnit: number;
      totalMaterialCost: number;
      totalCost: number;
      hasCosts: boolean;
    }>;
    summary: {
      totalMaterialCost: number;
      totalProjectCost: number;
      conditionsWithCosts: number;
      totalConditions: number;
    };
  };
  exportToExcel: () => Promise<void>;
  exportToPDF: () => Promise<void>;
}

export function useTakeoffExport({
  projectId,
  documents,
  onExportStatusUpdate,
}: UseTakeoffExportOptions): UseTakeoffExportResult {
  const conditions = useConditionStore((s) => s.conditions);
  const getConditionTakeoffMeasurements = useMeasurementStore((s) => s.getConditionTakeoffMeasurements);
  const getProjectTakeoffMeasurements = useMeasurementStore((s) => s.getProjectTakeoffMeasurements);
  const getProjectCostBreakdown = useMeasurementStore((s) => s.getProjectCostBreakdown);

  const getSheetName = (sheetId: string, pageNumber: number): string => {
    const document = documents.find((doc) => doc.id === sheetId);
    if (!document) return `Page ${pageNumber}`;
    const page = document.pages.find((p) => p.pageNumber === pageNumber);
    if (!page) return `Page ${pageNumber}`;
    return page.sheetName || page.sheetNumber || `Page ${pageNumber}`;
  };

  const getSheetNumber = (sheetId: string, pageNumber: number): string | null => {
    const document = documents.find((doc) => doc.id === sheetId);
    if (!document) return null;
    const page = document.pages.find((p) => p.pageNumber === pageNumber);
    if (!page) return null;
    return page.sheetNumber || null;
  };

  const getSheetNameWithFallback = async (sheetId: string, pageNumber: number): Promise<string> => {
    const localResult = getSheetName(sheetId, pageNumber);
    if (localResult && localResult !== `Page ${pageNumber}`) return localResult;
    try {
      const sheetIdForBackend = `${sheetId}-${pageNumber}`;
      const sheetData = await sheetService.getSheet(sheetIdForBackend);
      if (sheetData?.sheet?.sheetName) return sheetData.sheet.sheetName;
    } catch {
      // fallback to local
    }
    return localResult;
  };

  const getQuantityReportDataAsync = async () => {
    const projectMeasurements = getProjectTakeoffMeasurements(projectId);
    const projectConditions = conditions.filter((c) => c.projectId === projectId);
    const pagesWithMeasurements = new Map<string, { pageNumber: number; sheetName: string; sheetNumber: string | null; sheetId: string }>();

    await Promise.all(
      projectMeasurements.map(async (measurement) => {
        const key = `${measurement.sheetId}-${measurement.pdfPage}`;
        if (!pagesWithMeasurements.has(key)) {
          const sheetName = await getSheetNameWithFallback(measurement.sheetId, measurement.pdfPage);
          const sheetNumber = getSheetNumber(measurement.sheetId, measurement.pdfPage);
          pagesWithMeasurements.set(key, {
            pageNumber: measurement.pdfPage,
            sheetName,
            sheetNumber,
            sheetId: measurement.sheetId,
          });
        }
      })
    );

    const sortedPages = Array.from(pagesWithMeasurements.values()).sort((a, b) => a.pageNumber - b.pageNumber);
    const reportData: Record<string, { condition: TakeoffCondition; pages: Record<string, ReportDataPage>; grandTotal: number }> = {};

    projectConditions.forEach((condition) => {
      const conditionMeasurements = getConditionTakeoffMeasurements(projectId, condition.id);
      if (conditionMeasurements.length > 0) {
        const pages: Record<string, ReportDataPage> = {};
        let grandTotal = 0;
        conditionMeasurements.forEach((measurement) => {
          const pageKey = `${measurement.sheetId}-${measurement.pdfPage}`;
          if (!pages[pageKey]) {
            const pageInfo = pagesWithMeasurements.get(pageKey);
            pages[pageKey] = {
              pageNumber: measurement.pdfPage,
              sheetName: pageInfo?.sheetName ?? `Page ${measurement.pdfPage}`,
              sheetNumber: pageInfo?.sheetNumber ?? null,
              sheetId: measurement.sheetId,
              measurements: [],
              total: 0,
            };
          }
          pages[pageKey].measurements.push(measurement);
          pages[pageKey].total += measurement.netCalculatedValue ?? measurement.calculatedValue;
          grandTotal += measurement.netCalculatedValue ?? measurement.calculatedValue;
        });
        reportData[condition.id] = { condition, pages, grandTotal };
      }
    });

    return { reportData, sortedPages };
  };

  const getQuantityReportData = () => {
    const projectMeasurements = getProjectTakeoffMeasurements(projectId);
    const projectConditions = conditions.filter((c) => c.projectId === projectId);
    const pagesWithMeasurements = new Map<string, { pageNumber: number; sheetName: string; sheetId: string }>();
    projectMeasurements.forEach((measurement) => {
      const key = `${measurement.sheetId}-${measurement.pdfPage}`;
      if (!pagesWithMeasurements.has(key)) {
        pagesWithMeasurements.set(key, {
          pageNumber: measurement.pdfPage,
          sheetName: getSheetName(measurement.sheetId, measurement.pdfPage),
          sheetId: measurement.sheetId,
        });
      }
    });
    const sortedPages = Array.from(pagesWithMeasurements.values()).sort((a, b) => a.pageNumber - b.pageNumber);
    const reportData: Record<string, { condition: TakeoffCondition; pages: Record<string, ReportDataPage>; grandTotal: number }> = {};

    projectConditions.forEach((condition) => {
      const conditionMeasurements = getConditionTakeoffMeasurements(projectId, condition.id);
      if (conditionMeasurements.length > 0) {
        const pages: Record<string, ReportDataPage> = {};
        let grandTotal = 0;
        conditionMeasurements.forEach((measurement) => {
          const pageKey = `${measurement.sheetId}-${measurement.pdfPage}`;
          if (!pages[pageKey]) {
            pages[pageKey] = {
              pageNumber: measurement.pdfPage,
              sheetName: getSheetName(measurement.sheetId, measurement.pdfPage),
              sheetNumber: getSheetNumber(measurement.sheetId, measurement.pdfPage),
              sheetId: measurement.sheetId,
              measurements: [],
              total: 0,
            };
          }
          pages[pageKey].measurements.push(measurement);
          pages[pageKey].total += measurement.calculatedValue;
          grandTotal += measurement.calculatedValue;
        });
        reportData[condition.id] = { condition, pages, grandTotal };
      }
    });
    return { reportData, sortedPages };
  };

  const getCostAnalysisData = () => {
    const { reportData } = getQuantityReportData();
    const conditionIds = Object.keys(reportData);
    const costData: Record<string, {
      condition: TakeoffCondition;
      quantity: number;
      materialCostPerUnit: number;
      totalMaterialCost: number;
      totalCost: number;
      hasCosts: boolean;
    }> = {};
    let totalMaterialCost = 0;
    let totalProjectCost = 0;
    let conditionsWithCosts = 0;

    conditionIds.forEach((conditionId) => {
      const conditionData = reportData[conditionId];
      const condition = conditionData.condition;
      const quantity = conditionData.grandTotal;
      const materialCostPerUnit = condition.materialCost ?? 0;
      const totalMaterialCostForCondition = quantity * materialCostPerUnit;
      const totalCostForCondition = totalMaterialCostForCondition;
      const hasCosts = materialCostPerUnit > 0;
      costData[conditionId] = {
        condition,
        quantity,
        materialCostPerUnit,
        totalMaterialCost: totalMaterialCostForCondition,
        totalCost: totalCostForCondition,
        hasCosts,
      };
      if (hasCosts) {
        totalMaterialCost += totalMaterialCostForCondition;
        totalProjectCost += totalCostForCondition;
        conditionsWithCosts++;
      }
    });

    return {
      costData,
      summary: { totalMaterialCost, totalProjectCost, conditionsWithCosts, totalConditions: conditionIds.length },
    };
  };

  const exportToExcel = async () => {
    try {
      const { reportData } = await getQuantityReportDataAsync();
      const conditionIds = Object.keys(reportData);
      if (conditionIds.length === 0) {
        toast.warning('No data to export');
        return;
      }
      onExportStatusUpdate?.('excel', 5);

      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const currentProject = useProjectStore.getState().getCurrentProject();
      const costBreakdown = getProjectCostBreakdown(projectId);

      const formatDate = (dateString: string | undefined): string => {
        if (!dateString) return 'N/A';
        try {
          const date = new Date(dateString);
          if (isNaN(date.getTime())) return 'N/A';
          return date.toLocaleDateString();
        } catch {
          return 'N/A';
        }
      };

      const formatTimestamp = (timestamp: string | number | undefined): string => {
        if (!timestamp) return 'N/A';
        try {
          const timestampNum = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
          if (isNaN(timestampNum)) return 'N/A';
          const date = new Date(timestampNum);
          if (isNaN(date.getTime())) return 'N/A';
          return date.toLocaleString();
        } catch {
          return 'N/A';
        }
      };

      const colIndexToLetter = (colNum: number): string => {
        let result = '';
        while (colNum > 0) {
          colNum--;
          result = String.fromCharCode(65 + (colNum % 26)) + result;
          colNum = Math.floor(colNum / 26);
        }
        return result;
      };

      const headerStyle = {
        font: { bold: true, size: 11, color: { argb: 'FF1F2937' } },
        fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF3F4F6' } },
        border: {
          top: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
          left: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
        },
        alignment: { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true },
      };

      const _titleStyle = {
        font: { bold: true, size: 16, color: { argb: 'FF111827' } },
        alignment: { horizontal: 'left' as const, vertical: 'middle' as const, wrapText: true },
      };

      const _sectionHeaderStyle = {
        font: { bold: true, size: 12, color: { argb: 'FF374151' } },
        alignment: { horizontal: 'left' as const, vertical: 'middle' as const },
      };

      const _totalsStyle = {
        font: { bold: true, size: 11, color: { argb: 'FF111827' } },
        fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE5E7EB' } },
        border: {
          top: { style: 'medium' as const, color: { argb: 'FF9CA3AF' } },
          bottom: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
          left: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
        },
      };

      const dataEvenStyle = {
        fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFFFFF' } },
        border: {
          top: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
        },
      };

      const dataOddStyle = {
        fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF9FAFB' } },
        border: {
          top: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin' as const, color: { argb: 'FFE5E7EB' } },
        },
      };

      const executiveSheet = workbook.addWorksheet('Executive Summary');
      executiveSheet.getColumn(1).width = 28;
      executiveSheet.getColumn(2).width = 50;
      let row = 1;
      executiveSheet.getRow(row).height = 15;
      row += 2;
      executiveSheet.mergeCells(`A${row}:B${row}`);
      const titleCell = executiveSheet.getCell(`A${row}`);
      titleCell.value = 'MERIDIAN TAKEOFF - TAKEOFF REPORT';
      titleCell.style = {
        font: { bold: true, size: 18, color: { argb: 'FF1F2937' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
      };
      executiveSheet.getRow(row).height = 35;
      row += 2;
      executiveSheet.mergeCells(`A${row}:B${row}`);
      const summaryHeaderCell = executiveSheet.getCell(`A${row}`);
      summaryHeaderCell.value = 'EXECUTIVE SUMMARY';
      summaryHeaderCell.style = {
        font: { bold: true, size: 14, color: { argb: 'FF111827' } },
        alignment: { horizontal: 'left', vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } },
        border: { bottom: { style: 'medium', color: { argb: 'FF3B82F6' } } },
      };
      executiveSheet.getRow(row).height = 25;
      row += 2;
      executiveSheet.mergeCells(`A${row}:B${row}`);
      const projectInfoHeader = executiveSheet.getCell(`A${row}`);
      projectInfoHeader.value = 'Project Information';
      projectInfoHeader.style = {
        font: { bold: true, size: 12, color: { argb: 'FF374151' } },
        alignment: { horizontal: 'left', vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } },
        border: {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        },
      };
      executiveSheet.getRow(row).height = 22;
      row++;

      const projectInfo = [
        ['Project Name', currentProject?.name ?? 'Unknown Project'],
        ['Client', currentProject?.client ?? 'N/A'],
        ['Location', currentProject?.location ?? 'N/A'],
        ['Project Type', currentProject?.projectType ?? 'N/A'],
        ['Description', currentProject?.description ?? 'N/A'],
        ['Contact Person', currentProject?.contactPerson ?? 'N/A'],
        ['Contact Email', currentProject?.contactEmail ?? 'N/A'],
        ['Contact Phone', currentProject?.contactPhone ?? 'N/A'],
        ['Estimated Value', currentProject?.estimatedValue ? `$${currentProject.estimatedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'N/A'],
        ['Start Date', formatDate(currentProject?.startDate)],
        ['Created', formatDate(currentProject?.createdAt)],
        ['Last Modified', formatDate(currentProject?.lastModified)],
        ['Report Date', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })],
        ['Generated Time', new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })],
      ];

      projectInfo.forEach(([label, value], index) => {
        const isEven = index % 2 === 0;
        const labelCell = executiveSheet.getCell(`A${row}`);
        const valueCell = executiveSheet.getCell(`B${row}`);
        labelCell.value = label;
        labelCell.style = {
          font: { size: 11, color: { argb: 'FF6B7280' } },
          alignment: { horizontal: 'left', vertical: 'middle' },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF9FAFB' } },
          border: {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          },
        };
        valueCell.value = value;
        valueCell.style = {
          font: { size: 11, color: { argb: 'FF111827' }, bold: label === 'Project Name' || label === 'Estimated Value' },
          alignment: { horizontal: 'left', vertical: 'middle' },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF9FAFB' } },
          border: {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          },
        };
        executiveSheet.getRow(row).height = 20;
        row++;
      });
      row++;
      executiveSheet.mergeCells(`A${row}:B${row}`);
      const kpiHeader = executiveSheet.getCell(`A${row}`);
      kpiHeader.value = 'Key Performance Indicators';
      kpiHeader.style = {
        font: { bold: true, size: 12, color: { argb: 'FF374151' } },
        alignment: { horizontal: 'left', vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } },
        border: {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        },
      };
      executiveSheet.getRow(row).height = 22;
      row++;

      const uniquePagesSet = new Set<string>();
      conditionIds.forEach((id) => {
        Object.keys(reportData[id].pages).forEach((pageKey) => uniquePagesSet.add(pageKey));
      });
      const kpiData = [
        ['Total Conditions', conditionIds.length],
        ['Conditions with Costs', costBreakdown.summary.conditionsWithCosts],
        ['Total Pages with Measurements', uniquePagesSet.size],
        ['Total Measurements', conditionIds.reduce((sum, id) => sum + Object.values(reportData[id].pages).reduce((pageSum, page) => pageSum + page.measurements.length, 0), 0)],
      ];
      kpiData.forEach(([label, value], index) => {
        const isEven = index % 2 === 0;
        const labelCell = executiveSheet.getCell(`A${row}`);
        const valueCell = executiveSheet.getCell(`B${row}`);
        labelCell.value = label;
        labelCell.style = {
          font: { size: 11, color: { argb: 'FF6B7280' } },
          alignment: { horizontal: 'left', vertical: 'middle' },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF9FAFB' } },
          border: {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          },
        };
        valueCell.value = value;
        if (label === 'Conditions with Costs') valueCell.numFmt = '#,##0';
        valueCell.style = {
          font: { size: 11, color: { argb: 'FF111827' }, bold: true },
          alignment: { horizontal: 'left', vertical: 'middle' },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF9FAFB' } },
          border: {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          },
        };
        executiveSheet.getRow(row).height = 20;
        row++;
      });
      row++;
      executiveSheet.mergeCells(`A${row}:B${row}`);
      const costHeader = executiveSheet.getCell(`A${row}`);
      costHeader.value = 'Cost Analysis Summary';
      costHeader.style = {
        font: { bold: true, size: 12, color: { argb: 'FF374151' } },
        alignment: { horizontal: 'left', vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } },
        border: {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        },
      };
      executiveSheet.getRow(row).height = 22;
      row++;

      const costStartRow = row;
      const materialCostRow = costStartRow;
      const equipmentCostRow = costStartRow + 1;
      const wasteCostRow = costStartRow + 2;
      const subtotalRow = costStartRow + 3;
      const profitMarginRow = costStartRow + 4;
      const totalCostRow = costStartRow + 5;
      const costInfo = [
        { label: 'Material Cost', formula: null as string | null, value: costBreakdown.summary.totalMaterialCost, row: materialCostRow },
        { label: 'Equipment Cost', formula: null, value: costBreakdown.summary.totalEquipmentCost, row: equipmentCostRow },
        { label: 'Waste Factor Cost', formula: null, value: costBreakdown.summary.totalWasteCost, row: wasteCostRow },
        { label: 'Subtotal', formula: `SUM(B${materialCostRow}:B${wasteCostRow})`, value: null, row: subtotalRow },
        { label: 'Profit Margin', formula: `B${subtotalRow}*${(costBreakdown.summary.profitMarginPercent ?? 0) / 100}`, value: costBreakdown.summary.profitMarginAmount, percent: costBreakdown.summary.profitMarginPercent, row: profitMarginRow },
        { label: 'Total Project Cost', formula: `B${subtotalRow}+B${profitMarginRow}`, value: null, isHighlighted: true, row: totalCostRow },
      ];

      costInfo.forEach((item, index) => {
        const isEven = index % 2 === 0;
        const isTotalRow = item.isHighlighted ?? false;
        const labelCell = executiveSheet.getCell(`A${row}`);
        const valueCell = executiveSheet.getCell(`B${row}`);
        const displayLabel = item.label === 'Profit Margin' && item.percent ? `Profit Margin (${item.percent}%)` : item.label;
        labelCell.value = displayLabel;
        labelCell.style = {
          font: { size: 11, color: { argb: isTotalRow ? 'FF111827' : 'FF6B7280' }, bold: isTotalRow },
          alignment: { horizontal: 'left', vertical: 'middle' },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: isTotalRow ? 'FFE5E7EB' : (isEven ? 'FFFFFFFF' : 'FFF9FAFB') } },
          border: {
            top: { style: isTotalRow ? 'medium' : 'thin', color: { argb: isTotalRow ? 'FF3B82F6' : 'FFE5E7EB' } },
            bottom: { style: isTotalRow ? 'medium' : 'thin', color: { argb: isTotalRow ? 'FF3B82F6' : 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          },
        };
        if (item.formula) valueCell.value = { formula: item.formula };
        else if (item.value != null) valueCell.value = item.value;
        else valueCell.value = 0;
        valueCell.style = {
          font: { size: 11, color: { argb: isTotalRow ? 'FF111827' : 'FF111827' }, bold: isTotalRow || item.label === 'Profit Margin' },
          alignment: { horizontal: 'right', vertical: 'middle' },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: isTotalRow ? 'FFE5E7EB' : (isEven ? 'FFFFFFFF' : 'FFF9FAFB') } },
          border: {
            top: { style: isTotalRow ? 'medium' : 'thin', color: { argb: isTotalRow ? 'FF3B82F6' : 'FFE5E7EB' } },
            bottom: { style: isTotalRow ? 'medium' : 'thin', color: { argb: isTotalRow ? 'FF3B82F6' : 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          },
        };
        valueCell.numFmt = '$#,##0.00';
        executiveSheet.getRow(row).height = isTotalRow ? 25 : 20;
        row++;
      });

      const reportStartRow = 2;
      const reportEndRow = row - 1;
      const reportStartCol = 1;
      const reportEndCol = 2;
      const thickBorderStyle = { style: 'thick' as const, color: { argb: 'FF1F2937' } };
      for (let col = reportStartCol; col <= reportEndCol; col++) {
        const cell = executiveSheet.getCell(reportStartRow, col);
        cell.border = { ...(cell.border ?? {}), top: thickBorderStyle };
      }
      for (let col = reportStartCol; col <= reportEndCol; col++) {
        const cell = executiveSheet.getCell(reportEndRow, col);
        cell.border = { ...(cell.border ?? {}), bottom: thickBorderStyle };
      }
      for (let r = reportStartRow; r <= reportEndRow; r++) {
        const cell = executiveSheet.getCell(r, reportStartCol);
        cell.border = { ...(cell.border ?? {}), left: thickBorderStyle };
      }
      for (let r = reportStartRow; r <= reportEndRow; r++) {
        const cell = executiveSheet.getCell(r, reportEndCol);
        cell.border = { ...(cell.border ?? {}), right: thickBorderStyle };
      }
      (executiveSheet.pageSetup as Record<string, unknown>) = {
        margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
        printOptions: { gridLines: false, horizontalCentered: true, verticalCentered: false },
        paperSize: 9,
        fitToPage: false,
        scale: 100,
      };
      const lastRow = row - 1;
      executiveSheet.pageSetup.printArea = `A1:B${lastRow}`;
      onExportStatusUpdate?.('excel', 15);

      const allMeasurements: Array<{
        conditionId: string;
        condition: TakeoffCondition;
        pageData: { pageNumber: number; sheetName: string; sheetNumber: string | null; sheetId: string };
        measurement: { netCalculatedValue?: number; calculatedValue: number; timestamp: string; areaValue?: number; perimeterValue?: number };
      }> = [];
      conditionIds.forEach((conditionId) => {
        const conditionData = reportData[conditionId];
        const condition = conditionData.condition;
        Object.values(conditionData.pages).forEach((pageData) => {
          (pageData.measurements as Array<{ netCalculatedValue?: number; calculatedValue: number; timestamp: string; areaValue?: number; perimeterValue?: number }>).forEach((m) => {
            allMeasurements.push({ conditionId, condition, pageData, measurement: m });
          });
        });
      });
      allMeasurements.sort((a, b) => {
        const c = a.condition.name.localeCompare(b.condition.name);
        if (c !== 0) return c;
        const p = a.pageData.pageNumber - b.pageData.pageNumber;
        if (p !== 0) return p;
        return new Date(a.measurement.timestamp).getTime() - new Date(b.measurement.timestamp).getTime();
      });

      const detailSheet = workbook.addWorksheet('Quantities');
      detailSheet.getColumn(1).width = 25;
      detailSheet.getColumn(2).width = 12;
      detailSheet.getColumn(3).width = 6;
      detailSheet.getColumn(4).width = 15;
      detailSheet.getColumn(5).width = 15;
      detailSheet.getColumn(6).width = 15;
      detailSheet.getColumn(7).width = 12;
      detailSheet.getColumn(8).width = 35;
      detailSheet.getColumn(9).width = 10;
      detailSheet.getColumn(10).width = 12;
      detailSheet.getColumn(11).width = 15;
      detailSheet.getColumn(12).width = 18;
      detailSheet.getColumn(13).width = 18;
      detailSheet.getColumn(14).width = 30;
      detailSheet.getColumn(15).width = 20;

      const detailHeaders = [
        'Condition', 'Quantity', 'Unit', 'Area Value (SF)', 'Perimeter (LF)', 'Height (LF)', 'Sheet Number', 'Sheet Name', 'Page Reference',
        'Waste Factor (%)', 'Waste Amount', 'Material Cost/Unit', 'Equipment Cost', 'Description', 'Timestamp',
      ];
      const detailHeaderRowNum = 1;
      detailHeaders.forEach((header, colIdx) => {
        const cell = detailSheet.getCell(detailHeaderRowNum, colIdx + 1);
        cell.value = header;
        cell.style = headerStyle;
        if (colIdx === 7) cell.style = { ...headerStyle, alignment: { ...headerStyle.alignment, wrapText: true } };
      });

      type SheetPageData = { pageNumber: number; sheetName: string; sheetNumber: string | null; sheetId: string };
      const conditionGroups: Record<string, {
        condition: TakeoffCondition;
        sheets: Record<string, {
          pageData: SheetPageData;
          measurements: Array<{ conditionId: string; condition: TakeoffCondition; pageData: SheetPageData; measurement: unknown }>;
          total: number;
        }>;
        total: number;
      }> = {};
      allMeasurements.forEach(({ conditionId, condition, pageData, measurement }) => {
        if (!conditionGroups[conditionId]) conditionGroups[conditionId] = { condition, sheets: {}, total: 0 };
        const sheetKey = `${pageData.sheetId}-${pageData.pageNumber}`;
        if (!conditionGroups[conditionId].sheets[sheetKey]) {
          conditionGroups[conditionId].sheets[sheetKey] = { pageData, measurements: [], total: 0 };
        }
        const value = measurement.netCalculatedValue ?? measurement.calculatedValue;
        conditionGroups[conditionId].sheets[sheetKey].measurements.push({ conditionId, condition, pageData, measurement });
        conditionGroups[conditionId].sheets[sheetKey].total += value;
        conditionGroups[conditionId].total += value;
      });

      const conditionSummaryStyle = {
        font: { bold: true, size: 11, color: { argb: 'FF111827' } },
        fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE5E7EB' } },
        border: {
          top: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
          left: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
        },
      };

      const writeMeasurementRow = (
        rowNum: number,
        condition: TakeoffCondition,
        pageData: { pageNumber: number; sheetName: string; sheetNumber: string | null; sheetId: string },
        measurement: { netCalculatedValue?: number; calculatedValue: number; areaValue?: number; perimeterValue?: number; timestamp?: string }
      ) => {
        const rowStyle = rowNum % 2 === 0 ? dataEvenStyle : dataOddStyle;
        let col = 1;
        detailSheet.getCell(rowNum, col++).value = condition.name;
        const quantityCell = detailSheet.getCell(rowNum, col++);
        quantityCell.value = measurement.netCalculatedValue ?? measurement.calculatedValue;
        quantityCell.numFmt = '#,##0.00';
        quantityCell.style = rowStyle;
        detailSheet.getCell(rowNum, col++).value = condition.unit;
        const areaValueCell = detailSheet.getCell(rowNum, col++);
        if (measurement.areaValue != null) {
          areaValueCell.value = measurement.areaValue;
          areaValueCell.numFmt = '#,##0.00';
        } else if (condition.type === 'linear' && condition.includeHeight && condition.height) {
          areaValueCell.value = (measurement.netCalculatedValue ?? measurement.calculatedValue) * condition.height;
          areaValueCell.numFmt = '#,##0.00';
        }
        areaValueCell.style = rowStyle;
        const perimeterCell = detailSheet.getCell(rowNum, col++);
        if (measurement.perimeterValue != null) {
          perimeterCell.value = measurement.perimeterValue;
          perimeterCell.numFmt = '#,##0.00';
        }
        perimeterCell.style = rowStyle;
        const heightCell = detailSheet.getCell(rowNum, col++);
        if (condition.type === 'linear' && condition.includeHeight && condition.height) {
          heightCell.value = condition.height;
          heightCell.numFmt = '#,##0.00';
        }
        heightCell.style = rowStyle;
        detailSheet.getCell(rowNum, col++).value = pageData.sheetNumber ?? '';
        const sheetNameCell = detailSheet.getCell(rowNum, col++);
        sheetNameCell.value = pageData.sheetName;
        sheetNameCell.style = { ...rowStyle, alignment: { horizontal: 'left', vertical: 'top', wrapText: true } };
        detailSheet.getCell(rowNum, col++).value = `P${pageData.pageNumber}`;
        const wasteFactorCell = detailSheet.getCell(rowNum, col++);
        wasteFactorCell.value = condition.wasteFactor ?? 0;
        wasteFactorCell.numFmt = '0.00"%"';
        wasteFactorCell.style = rowStyle;
        const wasteAmountCell = detailSheet.getCell(rowNum, col++);
        const val = measurement.netCalculatedValue ?? measurement.calculatedValue;
        if (condition.wasteFactor && condition.wasteFactor > 0 && val > 0) {
          wasteAmountCell.value = val * (condition.wasteFactor / 100);
          wasteAmountCell.numFmt = '#,##0.00';
        }
        wasteAmountCell.style = rowStyle;
        const materialCostCell = detailSheet.getCell(rowNum, col++);
        if (condition.materialCost) {
          materialCostCell.value = condition.materialCost;
          materialCostCell.numFmt = '"$"#,##0.00';
        }
        materialCostCell.style = rowStyle;
        const equipmentCostCell = detailSheet.getCell(rowNum, col++);
        if (condition.equipmentCost) {
          equipmentCostCell.value = condition.equipmentCost;
          equipmentCostCell.numFmt = '"$"#,##0.00';
        }
        equipmentCostCell.style = rowStyle;
        detailSheet.getCell(rowNum, col++).value = condition.description ?? '';
        detailSheet.getCell(rowNum, col++).value = formatTimestamp((condition as TakeoffCondition & { createdAt?: string }).createdAt);
        for (let c = 1; c <= detailHeaders.length; c++) {
          const cell = detailSheet.getCell(rowNum, c);
          if (!cell.style || Object.keys(cell.style).length === 0) cell.style = rowStyle;
        }
      };

      let detailRowNum = 2;
      Object.entries(conditionGroups).forEach(([_conditionId, conditionGroup]) => {
        const condition = conditionGroup.condition;
        const conditionStartRow = detailRowNum;
        let col = 1;
        detailSheet.getCell(detailRowNum, col++).value = `${condition.name} - TOTAL`;
        const quantityCol = col++;
        detailSheet.getCell(detailRowNum, col++).value = condition.unit;
        const areaValueCol = col++;
        const areaValueCell = detailSheet.getCell(detailRowNum, areaValueCol);
        areaValueCell.style = conditionSummaryStyle;
        const perimeterCol = col++;
        const perimeterCell = detailSheet.getCell(detailRowNum, perimeterCol);
        perimeterCell.style = conditionSummaryStyle;
        const heightCol = col++;
        const heightCell = detailSheet.getCell(detailRowNum, heightCol);
        if (condition.type === 'linear' && condition.includeHeight && condition.height) {
          heightCell.value = condition.height;
          heightCell.numFmt = '#,##0.00';
        }
        heightCell.style = conditionSummaryStyle;
        detailSheet.getCell(detailRowNum, col++).value = '';
        detailSheet.getCell(detailRowNum, col++).value = '';
        detailSheet.getCell(detailRowNum, col++).value = '';
        detailSheet.getCell(detailRowNum, col++).value = condition.wasteFactor ?? 0;
        const wasteAmountCol = col++;
        const wasteAmountCell = detailSheet.getCell(detailRowNum, wasteAmountCol);
        wasteAmountCell.style = conditionSummaryStyle;
        detailSheet.getCell(detailRowNum, col++).value = condition.materialCost ?? '';
        detailSheet.getCell(detailRowNum, col++).value = condition.equipmentCost ?? '';
        col += 2;
        for (let c = 1; c <= detailHeaders.length; c++) {
          const cell = detailSheet.getCell(detailRowNum, c);
          if (!cell.style || Object.keys(cell.style).length === 0) cell.style = conditionSummaryStyle;
        }
        detailSheet.getRow(detailRowNum).outlineLevel = 0;
        detailRowNum++;
        Object.entries(conditionGroup.sheets).forEach(([, sheetData]) => {
          sheetData.measurements.forEach(({ measurement }) => {
            writeMeasurementRow(detailRowNum, condition, sheetData.pageData, measurement as { netCalculatedValue?: number; calculatedValue: number; areaValue?: number; perimeterValue?: number; timestamp?: string });
            detailSheet.getRow(detailRowNum).outlineLevel = 1;
            detailRowNum++;
          });
        });
        const measurementStartRow = conditionStartRow + 1;
        const measurementEndRowActual = detailRowNum - 1;
        const quantityColLetter = colIndexToLetter(quantityCol);
        const quantityFormulaCell = detailSheet.getCell(conditionStartRow, quantityCol);
        quantityFormulaCell.value = { formula: `SUM(${quantityColLetter}${measurementStartRow}:${quantityColLetter}${measurementEndRowActual})` };
        quantityFormulaCell.numFmt = '#,##0.00';
        quantityFormulaCell.style = conditionSummaryStyle;
        if (condition.type === 'linear' && condition.includeHeight) {
          const areaValueColLetter = colIndexToLetter(areaValueCol);
          areaValueCell.value = { formula: `SUM(${areaValueColLetter}${measurementStartRow}:${areaValueColLetter}${measurementEndRowActual})` };
          areaValueCell.numFmt = '#,##0.00';
        }
        if ((condition.type === 'area' || condition.type === 'volume') && condition.includePerimeter) {
          const perimeterColLetter = colIndexToLetter(perimeterCol);
          perimeterCell.value = { formula: `SUM(${perimeterColLetter}${measurementStartRow}:${perimeterColLetter}${measurementEndRowActual})` };
          perimeterCell.numFmt = '#,##0.00';
        }
        if (condition.wasteFactor && condition.wasteFactor > 0) {
          const wasteAmountColLetter = colIndexToLetter(wasteAmountCol);
          wasteAmountCell.value = { formula: `SUM(${wasteAmountColLetter}${measurementStartRow}:${wasteAmountColLetter}${measurementEndRowActual})` };
          wasteAmountCell.numFmt = '#,##0.00';
        }
      });

      const props = detailSheet.properties as unknown as Record<string, unknown>;
      props.outlineLevelRow = 1;
      props.summaryBelow = false;
      props.summaryRight = false;
      detailSheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 1, topLeftCell: 'D2', activeCell: 'D2' }];
      (detailSheet.pageSetup as Record<string, unknown>) = {
        margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
        printOptions: { gridLines: true, horizontalCentered: false },
        repeatRows: '1:1',
      };
      onExportStatusUpdate?.('excel', 90);

      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const projectName = currentProject?.name?.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-') ?? 'project';
      const filename = `${projectName}-Professional-Takeoff-Report-${timestamp}.xlsx`;
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onExportStatusUpdate?.('excel', 100);
      setTimeout(() => onExportStatusUpdate?.(null, 0), 1000);
    } catch (error) {
      console.error('Excel export error:', error);
      onExportStatusUpdate?.(null, 0);
      throw error;
    }
  };

  const exportToPDF = async () => {
    try {
      const { reportData } = await getQuantityReportDataAsync();
      const conditionIds = Object.keys(reportData);
      if (conditionIds.length === 0) {
        toast.warning('No data to export');
        return;
      }
      onExportStatusUpdate?.('pdf', 10);

      const pagesWithMeasurements = new Map<string, { pageNumber: number; sheetName: string; sheetId: string }>();
      const existingFileIds = new Set(documents.map((d) => d.id));
      conditionIds.forEach((conditionId) => {
        Object.entries(reportData[conditionId].pages).forEach(([pageKey, pageData]) => {
          if (existingFileIds.has(pageData.sheetId) && !pagesWithMeasurements.has(pageKey)) {
            pagesWithMeasurements.set(pageKey, {
              pageNumber: pageData.pageNumber,
              sheetName: pageData.sheetName,
              sheetId: pageData.sheetId,
            });
          }
        });
      });

      const annotations = useAnnotationStore.getState().annotations;
      const projectAnnotations = annotations.filter((a) => a.projectId === projectId);
      projectAnnotations.forEach((annotation) => {
        if (existingFileIds.has(annotation.sheetId)) {
          const pageKey = `${annotation.sheetId}-${annotation.pageNumber}`;
          if (!pagesWithMeasurements.has(pageKey)) {
            const doc = documents.find((d) => d.id === annotation.sheetId);
            const sheetName = doc?.sheets?.find((s: Sheet) => s.pageNumber === annotation.pageNumber)?.name ?? `Page ${annotation.pageNumber}`;
            pagesWithMeasurements.set(pageKey, {
              pageNumber: annotation.pageNumber,
              sheetName,
              sheetId: annotation.sheetId,
            });
          }
        }
      });

      if (pagesWithMeasurements.size === 0) {
        toast.warning('No pages with measurements or annotations found');
        return;
      }
      onExportStatusUpdate?.('pdf', 10);

      const jsPDF = (await import('jspdf')).default;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const currentProject = useProjectStore.getState().getCurrentProject();
      const costBreakdown = getProjectCostBreakdown(projectId);

      pdf.setFontSize(20);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Takeoff Summary Report', 20, 30);
      if (currentProject) {
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`Project: ${currentProject.name}`, 20, 45);
        pdf.text(`Generated: ${new Date().toLocaleString()}`, 20, 55);
        pdf.text(`Total Conditions: ${conditionIds.length}`, 20, 65);
        pdf.text(`Pages with Measurements: ${pagesWithMeasurements.size}`, 20, 75);
        if (costBreakdown.summary.totalCost > 0) {
          pdf.setFontSize(14);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Cost Summary', 20, 95);
          pdf.setFontSize(10);
          pdf.setFont('helvetica', 'normal');
          pdf.text(`Total Project Cost: $${costBreakdown.summary.totalCost.toFixed(2)}`, 20, 105);
          pdf.text(`Material Cost: $${costBreakdown.summary.totalMaterialCost.toFixed(2)}`, 20, 115);
          pdf.text(`Equipment Cost: $${costBreakdown.summary.totalEquipmentCost.toFixed(2)}`, 20, 125);
          pdf.text(`Waste Factor Cost: $${costBreakdown.summary.totalWasteCost.toFixed(2)}`, 20, 135);
          pdf.text(`Profit Margin: ${costBreakdown.summary.profitMarginPercent}% ($${costBreakdown.summary.profitMarginAmount.toFixed(2)})`, 20, 155);
        }
      }

      let legendY = costBreakdown.summary.totalCost > 0 ? 170 : 90;
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Conditions Legend', 20, legendY);
      legendY += 10;
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      conditionIds.forEach((conditionId) => {
        if (legendY > 270) {
          pdf.addPage();
          legendY = 20;
        }
        const conditionData = reportData[conditionId];
        const color = conditionData.condition.color;
        const r = parseInt(color.slice(1, 3), 16) / 255;
        const g = parseInt(color.slice(3, 5), 16) / 255;
        const b = parseInt(color.slice(5, 7), 16) / 255;
        pdf.setFillColor(r * 255, g * 255, b * 255);
        pdf.rect(20, legendY - 3, 5, 4, 'F');
        const conditionName = conditionData.condition.name.length > 35 ? conditionData.condition.name.substring(0, 32) + '...' : conditionData.condition.name;
        pdf.setTextColor(0, 0, 0);
        pdf.text(`${conditionName} - ${conditionData.condition.type.toUpperCase()} (${conditionData.grandTotal.toFixed(2)} ${conditionData.condition.unit})`, 28, legendY);
        legendY += 6;
      });

      legendY += 10;
      if (legendY > 250) {
        pdf.addPage();
        legendY = 20;
      }
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Page Breakdown', 20, legendY);
      legendY += 10;
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');

      const pageBreakdown = new Map<string, Array<{ condition: TakeoffCondition; total: number }>>();
      conditionIds.forEach((conditionId) => {
        const conditionData = reportData[conditionId];
        Object.entries(conditionData.pages).forEach(([pageKey, pageData]) => {
          if (!pageBreakdown.has(pageKey)) pageBreakdown.set(pageKey, []);
          const arr = pageBreakdown.get(pageKey);
          if (arr) arr.push({ condition: conditionData.condition, total: pageData.total });
        });
      });
      const sortedPageKeys = Array.from(pageBreakdown.keys()).sort((a, b) => {
        const pageA = pagesWithMeasurements.get(a);
        const pageB = pagesWithMeasurements.get(b);
        if (!pageA || !pageB) return 0;
        return pageA.pageNumber - pageB.pageNumber;
      });
      sortedPageKeys.forEach((pageKey) => {
        const pageInfo = pagesWithMeasurements.get(pageKey);
        const conditionsOnPage = pageBreakdown.get(pageKey) ?? [];
        if (!pageInfo) return;
        if (legendY > 260) {
          pdf.addPage();
          legendY = 20;
        }
        pdf.setFont('helvetica', 'bold');
        const hasCustomName = pageInfo.sheetName && pageInfo.sheetName !== `Page ${pageInfo.pageNumber}`;
        const pageLabel = hasCustomName ? `${pageInfo.sheetName} (P.${pageInfo.pageNumber})` : `Page ${pageInfo.pageNumber}`;
        pdf.text(pageLabel, 20, legendY);
        legendY += 5;
        pdf.setFont('helvetica', 'normal');
        conditionsOnPage.forEach((item) => {
          const color = item.condition.color;
          const r = parseInt(color.slice(1, 3), 16) / 255;
          const g = parseInt(color.slice(3, 5), 16) / 255;
          const b = parseInt(color.slice(5, 7), 16) / 255;
          pdf.setFillColor(r * 255, g * 255, b * 255);
          pdf.rect(25, legendY - 2.5, 3, 3, 'F');
          pdf.setTextColor(0, 0, 0);
          const condName = item.condition.name.length > 30 ? item.condition.name.substring(0, 27) + '...' : item.condition.name;
          pdf.text(`  ${condName}: ${item.total.toFixed(2)} ${item.condition.unit}`, 28, legendY);
          legendY += 5;
        });
        legendY += 3;
      });

      onExportStatusUpdate?.('pdf', 25);
      const summaryPdfBytes = new Uint8Array(pdf.output('arraybuffer'));

      const getConditionTakeoffMeasurementsFromStore = useMeasurementStore.getState().getConditionTakeoffMeasurements;
      const storeAnnotations = useAnnotationStore.getState().annotations;
      const pagesForExport = Array.from(pagesWithMeasurements.values())
        .map((pageInfo) => {
          const pageMeasurements: TakeoffMeasurement[] = [];
          conditionIds.forEach((conditionId) => {
            const conditionMeasurements = getConditionTakeoffMeasurementsFromStore(projectId, conditionId);
            const pageSpecific = conditionMeasurements.filter((m) => m.sheetId === pageInfo.sheetId && m.pdfPage === pageInfo.pageNumber);
            pageMeasurements.push(...pageSpecific);
          });
          const pageAnnotations = storeAnnotations.filter(
            (a) => a.projectId === projectId && a.sheetId === pageInfo.sheetId && a.pageNumber === pageInfo.pageNumber
          );
          return {
            pageNumber: pageInfo.pageNumber,
            sheetName: pageInfo.sheetName,
            sheetId: pageInfo.sheetId,
            measurements: pageMeasurements,
            annotations: pageAnnotations,
          };
        })
        .filter((page) => page.measurements.length > 0 || page.annotations.length > 0)
        .sort((a, b) => {
          if (a.sheetId !== b.sheetId) return a.sheetId.localeCompare(b.sheetId);
          return a.pageNumber - b.pageNumber;
        });

      onExportStatusUpdate?.('pdf', 30);
      const getDocumentRotation = useDocumentViewStore.getState().getDocumentRotation;
      const documentRotations = new Map<string, number>();
      pagesForExport.forEach((page) => {
        if (!documentRotations.has(page.sheetId)) documentRotations.set(page.sheetId, getDocumentRotation(page.sheetId));
      });

      const { exportPagesWithMeasurementsToPDF, downloadPDF } = await import('../../utils/pdfExportUtils');
      const { PDFDocument: PDFLibDocument } = await import('pdf-lib');

      const exportResult = await exportPagesWithMeasurementsToPDF(
        pagesForExport,
        currentProject?.name ?? 'Project',
        documentRotations,
        (progress) => {
          const mappedProgress = 30 + progress * 0.5;
          onExportStatusUpdate?.('pdf', Math.round(mappedProgress));
        }
      );

      if (exportResult.skippedSheets.length > 0) {
        const skippedCount = exportResult.skippedSheets.length;
        const warningMessage =
          `Warning: ${skippedCount} sheet(s) were skipped because the files were not found. ` +
          `This may indicate files were deleted but measurements still reference them. ` +
          `Your export may be incomplete. Please check your project files.`;
        console.warn('⚠️ PDF Export Warning:', warningMessage, exportResult.skippedSheets);
        toast.warning(warningMessage);
      }

      onExportStatusUpdate?.('pdf', 85);
      const summaryPdfDoc = await PDFLibDocument.load(summaryPdfBytes);
      const measurementsPdfDoc = await PDFLibDocument.load(exportResult.pdfBytes);
      const finalPdf = await PDFLibDocument.create();
      const summaryPages = await finalPdf.copyPages(summaryPdfDoc, summaryPdfDoc.getPageIndices());
      summaryPages.forEach((page) => finalPdf.addPage(page));
      const measurementPages = await finalPdf.copyPages(measurementsPdfDoc, measurementsPdfDoc.getPageIndices());
      measurementPages.forEach((page) => finalPdf.addPage(page));
      onExportStatusUpdate?.('pdf', 90);
      const finalPdfBytes = await finalPdf.save();
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const projectName = currentProject?.name?.replace(/[^a-zA-Z0-9]/g, '-') ?? 'project';
      const filename = `${projectName}-takeoff-report-${timestamp}.pdf`;
      downloadPDF(finalPdfBytes, filename);
      onExportStatusUpdate?.('pdf', 100);
      setTimeout(() => onExportStatusUpdate?.(null, 0), 1000);
    } catch (error) {
      console.error('PDF export error:', error);
      toast.error('Error exporting PDF. Please try again.');
      onExportStatusUpdate?.(null, 0);
      throw error;
    }
  };

  return {
    getQuantityReportData,
    getQuantityReportDataAsync,
    getCostAnalysisData,
    exportToExcel,
    exportToPDF,
  };
}
