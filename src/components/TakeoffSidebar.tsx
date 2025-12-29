import { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { 
  Plus, 
  Calculator, 
  Ruler, 
  Square, 
  Circle, 
  Hash,
  Package,
  Trash2,
  Edit3,
  Copy,
  FileText,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileImage,
  Scissors,
  DollarSign,
  Bot,
  Search,
} from 'lucide-react';
import { useTakeoffStore } from '../store/useTakeoffStore';
import { sheetService } from '../services/apiService';
import type { TakeoffCondition, PDFDocument, Sheet } from '../types';
import { CreateConditionDialog } from './CreateConditionDialog';
import { formatFeetAndInches } from '../lib/utils';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import { exportPagesWithMeasurementsToPDF, downloadPDF } from '../utils/pdfExportUtils';

// TakeoffCondition interface imported from shared types

interface TakeoffSidebarProps {
  projectId: string;
  onConditionSelect: (condition: TakeoffCondition | null) => void;
  onToolSelect: (tool: string) => void;
  documents?: PDFDocument[];
  onPageSelect?: (documentId: string, pageNumber: number) => void;
  onExportStatusUpdate?: (type: 'excel' | 'pdf' | null, progress: number) => void;
  onCutoutMode?: (conditionId: string | null) => void;
  cutoutMode?: boolean;
  cutoutTargetConditionId?: string | null;
  selectedDocumentId?: string | null;
}

export function TakeoffSidebar({ projectId, onConditionSelect, onToolSelect, documents = [], onPageSelect, onExportStatusUpdate, onCutoutMode, cutoutMode, cutoutTargetConditionId, selectedDocumentId }: TakeoffSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingCondition, setEditingCondition] = useState<TakeoffCondition | null>(null);
  const [activeTab, setActiveTab] = useState<'conditions' | 'reports' | 'costs'>('conditions');
  const [expandedConditions, setExpandedConditions] = useState<Set<string>>(new Set());
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { addCondition, conditions, setSelectedCondition, selectedConditionId, getConditionTakeoffMeasurements, loadProjectConditions, getProjectTakeoffMeasurements, takeoffMeasurements, loadingConditions, refreshProjectConditions, ensureConditionsLoaded, getProjectCostBreakdown, getConditionCostBreakdown } = useTakeoffStore();

  useEffect(() => {
    // Ensure conditions are loaded when component mounts or projectId changes
    if (projectId) {
      ensureConditionsLoaded(projectId).catch((error) => {
        console.error('Failed to ensure conditions:', error);
      });
    }
  }, [projectId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showExportDropdown && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowExportDropdown(false);
      }
    };

    if (showExportDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showExportDropdown]);

  const filteredConditions = conditions.filter(condition =>
    condition.projectId === projectId && (
      condition.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      condition.description.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );


  // Helper function to get sheet name for a page
  const getSheetName = (sheetId: string, pageNumber: number): string => {
    const document = documents.find(doc => doc.id === sheetId);
    if (!document) {
      return `Page ${pageNumber}`;
    }
    
    const page = document.pages.find(p => p.pageNumber === pageNumber);
    if (!page) {
      return `Page ${pageNumber}`;
    }
    
    // Use sheetName if available, otherwise use sheetNumber, otherwise fall back to page number
    return page.sheetName || page.sheetNumber || `Page ${pageNumber}`;
  };

  // Helper function to get sheet number for a page
  const getSheetNumber = (sheetId: string, pageNumber: number): string | null => {
    const document = documents.find(doc => doc.id === sheetId);
    if (!document) {
      return null;
    }
    
    const page = document.pages.find(p => p.pageNumber === pageNumber);
    if (!page) {
      return null;
    }
    
    return page.sheetNumber || null;
  };

  // Enhanced helper function to get sheet name with fallback to backend
  const getSheetNameWithFallback = async (sheetId: string, pageNumber: number): Promise<string> => {
    // First try to get from local documents
    const localResult = getSheetName(sheetId, pageNumber);
    
    // If we got a custom sheet name, return it
    if (localResult && localResult !== `Page ${pageNumber}`) {
      return localResult;
    }
    
    // If no custom name found locally, try to fetch from backend
    try {
      const sheetIdForBackend = `${sheetId}-${pageNumber}`;
      const sheetData = await sheetService.getSheet(sheetIdForBackend);
      if (sheetData && sheetData.sheet && sheetData.sheet.sheetName) {
        return sheetData.sheet.sheetName;
      }
    } catch (error) {
      // Silently handle error - fall back to local result
    }
    
    // Fall back to local result
    return localResult;
  };

  // Quantity Reports Data Aggregation (async version for exports)
  const getQuantityReportDataAsync = async () => {
    const projectMeasurements = getProjectTakeoffMeasurements(projectId);
    const projectConditions = conditions.filter(c => c.projectId === projectId);
    
    // Get all unique pages that have measurements with their sheet names and numbers
    const pagesWithMeasurements = new Map<string, { pageNumber: number; sheetName: string; sheetNumber: string | null; sheetId: string }>();
    
    // Use Promise.all to fetch all sheet names in parallel
    const sheetNamePromises = projectMeasurements.map(async (measurement) => {
      const key = `${measurement.sheetId}-${measurement.pdfPage}`;
      if (!pagesWithMeasurements.has(key)) {
        const sheetName = await getSheetNameWithFallback(measurement.sheetId, measurement.pdfPage);
        const sheetNumber = getSheetNumber(measurement.sheetId, measurement.pdfPage);
        pagesWithMeasurements.set(key, {
          pageNumber: measurement.pdfPage,
          sheetName: sheetName,
          sheetNumber: sheetNumber,
          sheetId: measurement.sheetId
        });
      }
    });
    
    await Promise.all(sheetNamePromises);
    
    const sortedPages = Array.from(pagesWithMeasurements.values()).sort((a, b) => a.pageNumber - b.pageNumber);
    
    // Group measurements by condition and page
    const reportData: Record<string, {
      condition: TakeoffCondition;
      pages: Record<string, {
        pageNumber: number;
        sheetName: string;
        sheetNumber: string | null;
        sheetId: string;
        measurements: any[];
        total: number;
      }>;
      grandTotal: number;
    }> = {};
    
    projectConditions.forEach(condition => {
      const conditionMeasurements = getConditionTakeoffMeasurements(projectId, condition.id);
      
      if (conditionMeasurements.length > 0) {
        const pages: Record<string, { pageNumber: number; sheetName: string; sheetNumber: string | null; sheetId: string; measurements: any[]; total: number }> = {};
        let grandTotal = 0;
        
        conditionMeasurements.forEach(measurement => {
          const pageKey = `${measurement.sheetId}-${measurement.pdfPage}`;
          if (!pages[pageKey]) {
            const pageInfo = pagesWithMeasurements.get(pageKey);
            pages[pageKey] = { 
              pageNumber: measurement.pdfPage,
              sheetName: pageInfo?.sheetName || `Page ${measurement.pdfPage}`,
              sheetNumber: pageInfo?.sheetNumber || null,
              sheetId: measurement.sheetId,
              measurements: [], 
              total: 0 
            };
          }
          
          pages[pageKey].measurements.push(measurement);
          pages[pageKey].total += measurement.netCalculatedValue || measurement.calculatedValue;
          grandTotal += measurement.netCalculatedValue || measurement.calculatedValue;
        });
        
        reportData[condition.id] = {
          condition,
          pages,
          grandTotal
        };
      }
    });
    
    return { reportData, sortedPages };
  };

  // Quantity Reports Data Aggregation (synchronous version for UI)
  const getQuantityReportData = () => {
    const projectMeasurements = getProjectTakeoffMeasurements(projectId);
    const projectConditions = conditions.filter(c => c.projectId === projectId);
    
    // Get all unique pages that have measurements with their sheet names
    const pagesWithMeasurements = new Map<string, { pageNumber: number; sheetName: string; sheetId: string }>();
    projectMeasurements.forEach(measurement => {
      const key = `${measurement.sheetId}-${measurement.pdfPage}`;
      if (!pagesWithMeasurements.has(key)) {
        pagesWithMeasurements.set(key, {
          pageNumber: measurement.pdfPage,
          sheetName: getSheetName(measurement.sheetId, measurement.pdfPage),
          sheetId: measurement.sheetId
        });
      }
    });
    
    const sortedPages = Array.from(pagesWithMeasurements.values()).sort((a, b) => a.pageNumber - b.pageNumber);
    
    // Group measurements by condition and page
    const reportData: Record<string, {
      condition: TakeoffCondition;
      pages: Record<string, {
        pageNumber: number;
        sheetName: string;
        sheetId: string;
        measurements: any[];
        total: number;
      }>;
      grandTotal: number;
    }> = {};
    
    projectConditions.forEach(condition => {
      const conditionMeasurements = getConditionTakeoffMeasurements(projectId, condition.id);
      
      if (conditionMeasurements.length > 0) {
        const pages: Record<string, { pageNumber: number; sheetName: string; sheetId: string; measurements: any[]; total: number }> = {};
        let grandTotal = 0;
        
        conditionMeasurements.forEach(measurement => {
          const pageKey = `${measurement.sheetId}-${measurement.pdfPage}`;
          if (!pages[pageKey]) {
            pages[pageKey] = { 
              pageNumber: measurement.pdfPage,
              sheetName: getSheetName(measurement.sheetId, measurement.pdfPage),
              sheetId: measurement.sheetId,
              measurements: [], 
              total: 0 
            };
          }
          pages[pageKey].measurements.push(measurement);
          pages[pageKey].total += measurement.calculatedValue;
          grandTotal += measurement.calculatedValue;
        });
        
        reportData[condition.id] = {
          condition,
          pages,
          grandTotal
        };
      }
    });
    
    return {
      reportData,
      sortedPages
    };
  };

  // Cost Analysis Data Aggregation
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
    
    conditionIds.forEach(conditionId => {
      const conditionData = reportData[conditionId];
      const condition = conditionData.condition;
      const quantity = conditionData.grandTotal;
      
      const materialCostPerUnit = condition.materialCost || 0;
      
      const totalMaterialCostForCondition = quantity * materialCostPerUnit;
      const totalCostForCondition = totalMaterialCostForCondition;
      
      const hasCosts = materialCostPerUnit > 0;
      
      costData[conditionId] = {
        condition,
        quantity,
        materialCostPerUnit,
        totalMaterialCost: totalMaterialCostForCondition,
        totalCost: totalCostForCondition,
        hasCosts
      };
      
      if (hasCosts) {
        totalMaterialCost += totalMaterialCostForCondition;
        totalProjectCost += totalCostForCondition;
        conditionsWithCosts++;
      }
    });
    
    return {
      costData,
      summary: {
        totalMaterialCost,
        totalProjectCost,
        conditionsWithCosts,
        totalConditions: conditionIds.length
      }
    };
  };

  const toggleConditionExpansion = (conditionId: string) => {
    const newExpanded = new Set(expandedConditions);
    if (newExpanded.has(conditionId)) {
      newExpanded.delete(conditionId);
    } else {
      newExpanded.add(conditionId);
    }
    setExpandedConditions(newExpanded);
  };

  const handlePageClick = (sheetId: string, pageNumber: number, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent expanding/collapsing the condition
    if (onPageSelect) {
      onPageSelect(sheetId, pageNumber);
    }
  };

  const exportToExcel = async () => {
    try {
      const { reportData, sortedPages } = await getQuantityReportDataAsync();
      const conditionIds = Object.keys(reportData);
      
      if (conditionIds.length === 0) {
        alert('No data to export');
        return;
      }

      // Start export progress
      onExportStatusUpdate?.('excel', 5);

      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      
      // Get current project info and calculate cost breakdown once (optimize)
      const currentProject = useTakeoffStore.getState().getCurrentProject();
      const costBreakdown = getProjectCostBreakdown(projectId);
      
      // Helper function to format date safely
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
      
      // Helper function to format timestamp safely
      const formatTimestamp = (timestamp: string | number | undefined): string => {
        if (!timestamp) return 'N/A';
        try {
          const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
          if (isNaN(date.getTime())) return 'N/A';
          return date.toLocaleString();
        } catch {
          return 'N/A';
        }
      };
      
      // Helper to merge cells
      const mergeCells = (sheet: any, range: string) => {
        if (!sheet['!merges']) sheet['!merges'] = [];
        sheet['!merges'].push(XLSX.utils.decode_range(range));
      };
      
      // Helper to set cell properties (wrap text, alignment, etc.)
      const setCellProps = (sheet: any, cellAddress: string, props: any) => {
        if (!sheet[cellAddress]) {
          sheet[cellAddress] = { t: 's', v: '' };
        }
        if (!sheet[cellAddress].s) {
          sheet[cellAddress].s = {};
        }
        Object.assign(sheet[cellAddress].s, props);
      };
      
      // 1. EXECUTIVE SUMMARY SHEET
      const executiveSummaryData = [
        ['MERIDIAN TAKEOFF - PROFESSIONAL CONSTRUCTION TAKEOFF REPORT', ''],
        ['', ''],
        ['EXECUTIVE SUMMARY', ''],
        ['', ''],
        ['Project Information', ''],
        ['Project Name', currentProject?.name || 'Unknown Project'],
        ['Client', currentProject?.client || 'N/A'],
        ['Location', currentProject?.location || 'N/A'],
        ['Project Type', currentProject?.projectType || 'N/A'],
        ['Status', currentProject?.status || 'N/A'],
        ['Description', currentProject?.description || 'N/A'],
        ['Contact Person', currentProject?.contactPerson || 'N/A'],
        ['Contact Email', currentProject?.contactEmail || 'N/A'],
        ['Contact Phone', currentProject?.contactPhone || 'N/A'],
        ['Estimated Value', currentProject?.estimatedValue ? `$${currentProject.estimatedValue.toFixed(2)}` : 'N/A'],
        ['Start Date', formatDate(currentProject?.startDate)],
        ['Created', formatDate(currentProject?.createdAt)],
        ['Last Modified', formatDate(currentProject?.lastModified)],
        ['Report Date', new Date().toLocaleDateString()],
        ['Generated Time', new Date().toLocaleTimeString()],
        ['', ''],
        ['Key Performance Indicators', ''],
        ['Total Conditions', conditionIds.length],
        ['Total Pages with Measurements', sortedPages.length],
        ['Total Measurements', conditionIds.reduce((sum, id) => sum + Object.values(reportData[id].pages).reduce((pageSum, page) => pageSum + page.measurements.length, 0), 0)],
        ['', ''],
        ['Cost Analysis Summary', ''],
        ['Total Project Cost', `$${costBreakdown.summary.totalCost.toFixed(2)}`],
        ['Material Cost', `$${costBreakdown.summary.totalMaterialCost.toFixed(2)}`],
        ['Equipment Cost', `$${costBreakdown.summary.totalEquipmentCost.toFixed(2)}`],
        ['Waste Factor Cost', `$${costBreakdown.summary.totalWasteCost.toFixed(2)}`],
        ['Subtotal', `$${costBreakdown.summary.subtotal.toFixed(2)}`],
        ['Profit Margin', `${costBreakdown.summary.profitMarginPercent}% ($${costBreakdown.summary.profitMarginAmount.toFixed(2)})`],
        ['Conditions with Costs', costBreakdown.summary.conditionsWithCosts]
      ];
      
      const executiveSheet = XLSX.utils.aoa_to_sheet(executiveSummaryData);
      executiveSheet['!cols'] = [{ wch: 30 }, { wch: 40 }];
      
      // Merge and style title cell (A1:B1) - merge across both columns and enable wrap text
      mergeCells(executiveSheet, 'A1:B1');
      setCellProps(executiveSheet, 'A1', {
        alignment: { wrapText: true, vertical: 'center' },
        font: { bold: true, sz: 14 }
      });
      
      // Print settings for Executive Summary
      executiveSheet['!margins'] = { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
      executiveSheet['!printOptions'] = { gridLines: false, horizontalCentered: true, verticalCentered: false };
      XLSX.utils.book_append_sheet(workbook, executiveSheet, 'Executive Summary');

      onExportStatusUpdate?.('excel', 15);

      // 2. ENHANCED QUANTITY SUMMARY SHEET
      const summaryData = [];
      
      // Enhanced header with professional formatting
      const headerRow = [
        'Condition', 
        'Type', 
        'Unit', 
        'Description',
        ...sortedPages.map(p => {
          const sheetNum = p.sheetNumber ? ` (${p.sheetNumber})` : '';
          const hasCustomName = p.sheetName && p.sheetName !== `Page ${p.pageNumber}`;
          return hasCustomName ? `${p.sheetName}${sheetNum} (P.${p.pageNumber})` : `Page ${p.pageNumber}${sheetNum}`;
        }), 
        'Total Quantity', 
        'Area Value (SF)', 
        'Material Cost/Unit', 
        'Equipment Cost',
        'Total Cost',
        'Cost per Unit'
      ];
      summaryData.push(headerRow);
      
      // Calculate area values for conditions (sum of areaValue from linear measurements with height)
      const conditionAreaValues: Record<string, number> = {};
      conditionIds.forEach(conditionId => {
        const conditionData = reportData[conditionId];
        let totalArea = 0;
        Object.values(conditionData.pages).forEach(pageData => {
          pageData.measurements.forEach(measurement => {
            if (measurement.areaValue) {
              totalArea += measurement.areaValue;
            }
          });
        });
        conditionAreaValues[conditionId] = totalArea;
      });
      
      // Get cost breakdown for equipment costs
      const costAnalysis = getCostAnalysisData();
      
      // Data rows with enhanced formatting
      conditionIds.forEach(conditionId => {
        const conditionData = reportData[conditionId];
        const costInfo = costAnalysis.costData[conditionId];
        const condition = conditionData.condition;
        const breakdown = getConditionCostBreakdown(conditionId);
        
        if (!conditionData || !conditionData.condition) {
          console.warn(`Missing condition data for ID: ${conditionId}`);
          return;
        }
        
        const row = [
          condition.name || 'Unknown',
          condition.type || 'Unknown',
          condition.unit || 'Unknown',
          condition.description || 'No description provided',
          ...sortedPages.map(page => {
            const pageKey = Object.keys(conditionData.pages || {}).find(key => 
              conditionData.pages[key].pageNumber === page.pageNumber
            );
            const pageData = pageKey ? conditionData.pages[pageKey] : null;
            return pageData ? pageData.total.toFixed(2) : '';
          }),
          (conditionData.grandTotal || 0).toFixed(2),
          conditionAreaValues[conditionId] > 0 ? conditionAreaValues[conditionId].toFixed(2) : '',
          costInfo?.materialCostPerUnit > 0 ? costInfo.materialCostPerUnit : null,
          breakdown?.equipmentCost > 0 ? breakdown.equipmentCost : null,
          costInfo?.hasCosts ? costInfo.totalCost : null,
          costInfo?.hasCosts && conditionData.grandTotal > 0 ? (costInfo.totalCost / conditionData.grandTotal) : null
        ];
        summaryData.push(row);
      });
      
      // Helper to convert column index to Excel column letter (0=A, 1=B, etc.)
      const colIndexToLetter = (col: number): string => {
        let result = '';
        col++;
        while (col > 0) {
          col--;
          result = String.fromCharCode(65 + (col % 26)) + result;
          col = Math.floor(col / 26);
        }
        return result;
      };
      
      // Add totals row with formulas
      const totalQuantity = conditionIds.reduce((sum, id) => sum + reportData[id].grandTotal, 0);
      const totalAreaValue = Object.values(conditionAreaValues).reduce((sum, val) => sum + val, 0);
      const totalEquipmentCost = conditionIds.reduce((sum, id) => {
        const breakdown = getConditionCostBreakdown(id);
        return sum + (breakdown?.equipmentCost || 0);
      }, 0);
      
      const firstDataRow = 2; // Row 2 (after header at row 1)
      const lastDataRow = summaryData.length; // Last data row before totals
      
      const totalsRow = [
        'TOTALS', 
        '', 
        '', 
        '', 
        ...sortedPages.map((page, idx) => {
          // First page column is at index 4 (E), so idx 0 = E, idx 1 = F, etc.
          const colLetter = colIndexToLetter(4 + idx);
          return { f: `SUM(${colLetter}${firstDataRow}:${colLetter}${lastDataRow})` };
        }), 
        { f: `SUM(${colIndexToLetter(4 + sortedPages.length)}${firstDataRow}:${colIndexToLetter(4 + sortedPages.length)}${lastDataRow})` }, // Total Quantity
        totalAreaValue > 0 ? { f: `SUM(${colIndexToLetter(5 + sortedPages.length)}${firstDataRow}:${colIndexToLetter(5 + sortedPages.length)}${lastDataRow})` } : '', // Area Value
        '', // Material Cost/Unit (not summed)
        totalEquipmentCost > 0 ? totalEquipmentCost : '', // Equipment Cost (calculated value)
        costBreakdown.summary.totalCost, // Total Cost
        '' // Cost per Unit
      ];
      summaryData.push(totalsRow);
      
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      
      // Set column widths for enhanced summary
      const summaryColWidths = [
        { wch: 25 }, // Condition
        { wch: 10 }, // Type
        { wch: 8 },  // Unit
        { wch: 30 }, // Description
        ...sortedPages.map(() => ({ wch: 15 })), // Page columns
        { wch: 15 }, // Total Quantity
        { wch: 15 }, // Area Value (SF)
        { wch: 18 }, // Material Cost/Unit
        { wch: 18 }, // Equipment Cost
        { wch: 12 }, // Total Cost
        { wch: 12 }  // Cost per Unit
      ];
      summarySheet['!cols'] = summaryColWidths;
      
      // Apply styles: header row - bold text
      const headerRowIndex = 0;
      for (let col = 0; col < headerRow.length; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
        setCellProps(summarySheet, cellAddress, {
          font: { bold: true },
          fill: { fgColor: { rgb: "F3F4F6" } }
        });
      }
      
      // Apply styles: data rows with zebra striping
      for (let row = 1; row < summaryData.length - 1; row++) {
        const isEven = row % 2 === 0;
        for (let col = 0; col < headerRow.length; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
          const fillColor = isEven ? "FFFFFF" : "F9FAFB";
          setCellProps(summarySheet, cellAddress, {
            fill: { fgColor: { rgb: fillColor } }
          });
          
          // Apply number formatting for numeric columns
          const value = summaryData[row][col];
          if (typeof value === 'number') {
            // Check if it's a cost column (Material Cost/Unit, Equipment Cost, Total Cost, Cost per Unit)
            const costCols = [headerRow.length - 4, headerRow.length - 3, headerRow.length - 2, headerRow.length - 1];
            if (costCols.includes(col)) {
              if (!summarySheet[cellAddress]) summarySheet[cellAddress] = { t: 'n', v: value };
              summarySheet[cellAddress].z = '"$"#,##0.00';
            } else {
              if (!summarySheet[cellAddress]) summarySheet[cellAddress] = { t: 'n', v: value };
              summarySheet[cellAddress].z = '#,##0.00';
            }
          }
        }
      }
      
      // Apply styles: totals row - bold text, darker background
      const totalsRowIndex = summaryData.length - 1;
      for (let col = 0; col < headerRow.length; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: totalsRowIndex, c: col });
        setCellProps(summarySheet, cellAddress, {
          font: { bold: true },
          fill: { fgColor: { rgb: "E5E7EB" } }
        });
      }
      
      // Add freeze panes (freeze first row and first 4 columns)
      summarySheet['!freeze'] = { xSplit: 4, ySplit: 1, topLeftCell: 'E2', activePane: 'bottomRight', state: 'frozen' };
      
      // No auto-filter on Quantity Summary (user didn't request it)
      
      // Print settings for Quantity Summary
      summarySheet['!margins'] = { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
      summarySheet['!printOptions'] = { gridLines: true, horizontalCentered: false, verticalCentered: false };
      summarySheet['!repeatRows'] = '1:1'; // Repeat header row on each page
      
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Quantity Summary');

      onExportStatusUpdate?.('excel', 35);

      // 3. DETAILED MEASUREMENTS SHEET
      // Collect all measurements with their data, sorted by condition, then page, then timestamp
      const allMeasurements: Array<{
        conditionId: string;
        condition: TakeoffCondition;
        pageData: { pageNumber: number; sheetName: string; sheetNumber: string | null; sheetId: string };
        measurement: any;
      }> = [];
      
      conditionIds.forEach(conditionId => {
        const conditionData = reportData[conditionId];
        const condition = conditionData.condition;
        
        Object.values(conditionData.pages).forEach(pageData => {
          pageData.measurements.forEach(measurement => {
            allMeasurements.push({
              conditionId,
              condition,
              pageData,
              measurement
            });
          });
        });
      });
      
      // Sort: by condition name, then page number, then timestamp
      allMeasurements.sort((a, b) => {
        const conditionCompare = a.condition.name.localeCompare(b.condition.name);
        if (conditionCompare !== 0) return conditionCompare;
        const pageCompare = a.pageData.pageNumber - b.pageData.pageNumber;
        if (pageCompare !== 0) return pageCompare;
        const timeA = new Date(a.measurement.timestamp).getTime();
        const timeB = new Date(b.measurement.timestamp).getTime();
        return timeA - timeB;
      });
      
      const detailData = [];
      detailData.push([
        'Condition', 
        'Type',
        'Unit',
        'Sheet Number',
        'Sheet Name', 
        'Page Reference', 
        'Value', 
        'Net Value (after cutouts)',
        'Area Value (SF)',
        'Perimeter (LF)',
        'Timestamp',
        'Measurement Type',
        'Description',
        'Waste Factor (%)',
        'Material Cost/Unit',
        'Equipment Cost/Unit',
        'Field Notes/Comments'
      ]);
      
      // Track current condition for grouping
      let currentConditionId: string | null = null;
      let rowIndex = 1; // Start at 1 (0 is header)
      
      allMeasurements.forEach(({ conditionId, condition, pageData, measurement }) => {
        // Check if we need to start a new condition group
        if (currentConditionId !== conditionId) {
          currentConditionId = conditionId;
        }
        
        detailData.push([
          condition.name,
          condition.type,
          condition.unit,
          pageData.sheetNumber || '',
          pageData.sheetName,
          `P${pageData.pageNumber}`,
          measurement.calculatedValue,
          measurement.netCalculatedValue || measurement.calculatedValue,
          measurement.areaValue || null,
          measurement.perimeterValue || null,
          formatTimestamp(measurement.timestamp),
          measurement.type,
          measurement.description || '',
          condition.wasteFactor || 0,
          condition.materialCost || null,
          condition.equipmentCost || null,
          '' // Field Notes/Comments placeholder
        ]);
        rowIndex++;
      });
      
      const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
      
      // Set column widths for detailed sheet
      const detailColWidths = [
        { wch: 25 }, // Condition (A)
        { wch: 10 }, // Type
        { wch: 8 },  // Unit
        { wch: 15 }, // Sheet Number (D)
        { wch: 20 }, // Sheet Name (E)
        { wch: 12 }, // Page Reference (F)
        { wch: 12 }, // Value
        { wch: 18 }, // Net Value
        { wch: 15 }, // Area Value (SF)
        { wch: 15 }, // Perimeter
        { wch: 20 }, // Timestamp
        { wch: 15 }, // Measurement Type
        { wch: 30 }, // Description
        { wch: 15 }, // Waste Factor (%)
        { wch: 18 }, // Material Cost/Unit
        { wch: 18 }, // Equipment Cost/Unit
        { wch: 30 }  // Field Notes/Comments
      ];
      detailSheet['!cols'] = detailColWidths;
      
      // Apply styles: header row - bold text
      const detailHeaderRowIndex = 0;
      for (let col = 0; col < detailData[0].length; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: detailHeaderRowIndex, c: col });
        setCellProps(detailSheet, cellAddress, {
          font: { bold: true },
          fill: { fgColor: { rgb: "F3F4F6" } }
        });
      }
      
      // Apply styles: data rows with zebra striping and grouping
      let currentConditionId: string | null = null;
      let conditionStartRow = 1;
      const groupRows: number[] = []; // Track which rows start a new group
      
      for (let row = 1; row < detailData.length; row++) {
        const measurementIndex = row - 1;
        const { conditionId } = allMeasurements[measurementIndex];
        const isEven = row % 2 === 0;
        
        // Check if condition changed (new group)
        if (currentConditionId !== null && currentConditionId !== conditionId) {
          groupRows.push(row);
          conditionStartRow = row;
        }
        if (currentConditionId === null) {
          conditionStartRow = row;
          groupRows.push(row);
        }
        currentConditionId = conditionId;
        
        // Apply zebra striping
        for (let col = 0; col < detailData[0].length; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
          const fillColor = isEven ? "FFFFFF" : "F9FAFB";
          setCellProps(detailSheet, cellAddress, {
            fill: { fgColor: { rgb: fillColor } }
          });
          
          // Apply number formatting
          const value = detailData[row][col];
          if (typeof value === 'number') {
            // Cost columns: Material Cost/Unit (col 14), Equipment Cost/Unit (col 15)
            if (col === 14 || col === 15) {
              if (!detailSheet[cellAddress]) detailSheet[cellAddress] = { t: 'n', v: value };
              detailSheet[cellAddress].z = '"$"#,##0.00';
            } else {
              if (!detailSheet[cellAddress]) detailSheet[cellAddress] = { t: 'n', v: value };
              detailSheet[cellAddress].z = '#,##0.00';
            }
          }
        }
      }
      
      // Add grouping (outline) - Excel grouping requires setting outlineLevel on rows via !rows
      detailSheet['!outline'] = { summaryBelow: false, summaryRight: false };
      if (!detailSheet['!rows']) {
        detailSheet['!rows'] = [];
      }
      
      // Set outline level for each row (level 1 for data rows that can be grouped by condition)
      currentConditionId = null;
      for (let row = 1; row < detailData.length; row++) {
        const measurementIndex = row - 1;
        const { conditionId } = allMeasurements[measurementIndex];
        
        // Initialize row properties if not exists
        if (!detailSheet['!rows'][row]) {
          detailSheet['!rows'][row] = {};
        }
        
        // Set outline level - all data rows get level 1 for grouping
        detailSheet['!rows'][row].level = 1;
        detailSheet['!rows'][row].hidden = false;
        detailSheet['!rows'][row].collapsed = false;
        
        currentConditionId = conditionId;
      }
      
      // Add freeze panes (freeze first row and first 3 columns)
      detailSheet['!freeze'] = { xSplit: 3, ySplit: 1, topLeftCell: 'D2', activePane: 'bottomRight', state: 'frozen' };
      
      // Add auto-filter - XLSX doesn't support limiting to specific columns directly
      // The autofilter will be on all columns, but Excel allows users to hide filter dropdowns on unwanted columns
      // We set it to cover the full range, and users can customize in Excel
      if (detailData.length > 0) {
        const filterRange = {
          s: { r: 0, c: 0 }, // Start at A1 (header)
          e: { r: detailData.length - 1, c: detailData[0].length - 1 }  // End at last row, last column
        };
        detailSheet['!autofilter'] = { ref: XLSX.utils.encode_range(filterRange) };
      }
      
      // Print settings for Detailed Measurements
      detailSheet['!margins'] = { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
      detailSheet['!printOptions'] = { gridLines: true, horizontalCentered: false, verticalCentered: false };
      detailSheet['!repeatRows'] = '1:1'; // Repeat header row on each page
      
      XLSX.utils.book_append_sheet(workbook, detailSheet, 'Detailed Measurements');

      onExportStatusUpdate?.('excel', 90);

      // Generate filename with enhanced naming
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const projectName = currentProject?.name?.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-') || 'project';
      const filename = `${projectName}-Professional-Takeoff-Report-${timestamp}.xlsx`;
      
      // Save file
      XLSX.writeFile(workbook, filename);
      
      // Complete
      onExportStatusUpdate?.('excel', 100);
      
      // Reset status after a brief delay
      setTimeout(() => {
        onExportStatusUpdate?.(null, 0);
      }, 1000);
      
    } catch (error) {
      console.error('Excel export error:', error);
      onExportStatusUpdate?.(null, 0);
      throw error; // Re-throw to be caught by the button handler
    }
  };

  const exportToPDF = async () => {
    try {
      const { reportData, sortedPages } = await getQuantityReportDataAsync();
      const conditionIds = Object.keys(reportData);
      
      if (conditionIds.length === 0) {
        alert('No data to export');
        return;
      }

      // Start export progress
      onExportStatusUpdate?.('pdf', 10);

      // Get all unique pages that have measurements from the report data
      // Only include pages where the file actually exists in the documents list
      const pagesWithMeasurements = new Map<string, { pageNumber: number; sheetName: string; sheetId: string }>();
      const existingFileIds = new Set(documents.map(d => d.id));
      
      conditionIds.forEach(conditionId => {
        Object.entries(reportData[conditionId].pages).forEach(([pageKey, pageData]) => {
          // Only add if file exists and not already added
          if (existingFileIds.has(pageData.sheetId) && !pagesWithMeasurements.has(pageKey)) {
            pagesWithMeasurements.set(pageKey, {
              pageNumber: pageData.pageNumber,
              sheetName: pageData.sheetName,
              sheetId: pageData.sheetId
            });
          }
        });
      });

      // Also get all unique pages that have annotations (only if file exists)
      const annotations = useTakeoffStore.getState().annotations;
      const projectAnnotations = annotations.filter(a => a.projectId === projectId);
      
      projectAnnotations.forEach(annotation => {
        // Only add if file exists
        if (existingFileIds.has(annotation.sheetId)) {
          const pageKey = `${annotation.sheetId}-${annotation.pageNumber}`;
          if (!pagesWithMeasurements.has(pageKey)) {
            // Find sheet name from documents
            const doc = documents.find(d => d.id === annotation.sheetId);
            const sheetName = doc?.sheets?.find((s: Sheet) => s.pageNumber === annotation.pageNumber)?.name || `Page ${annotation.pageNumber}`;
            
            pagesWithMeasurements.set(pageKey, {
              pageNumber: annotation.pageNumber,
              sheetName: sheetName,
              sheetId: annotation.sheetId
            });
          }
        }
      });

      if (pagesWithMeasurements.size === 0) {
        alert('No pages with measurements or annotations found');
        return;
      }

      // Update progress
      onExportStatusUpdate?.('pdf', 10);

      // Create a new PDF document
      const pdf = new jsPDF('p', 'mm', 'a4');
      const currentProject = useTakeoffStore.getState().getCurrentProject();
      
                  // Add summary page with formatted table
                  pdf.setFontSize(20);
                  pdf.setFont('helvetica', 'bold');
                  pdf.text('Takeoff Summary Report', 20, 30);
                  
                  // Get cost breakdown for summary table
                  const costBreakdown = getProjectCostBreakdown(projectId);
                  
                  if (currentProject) {
                    pdf.setFontSize(12);
                    pdf.setFont('helvetica', 'normal');
                    pdf.text(`Project: ${currentProject.name}`, 20, 45);
                    pdf.text(`Generated: ${new Date().toLocaleString()}`, 20, 55);
                    pdf.text(`Total Conditions: ${conditionIds.length}`, 20, 65);
                    pdf.text(`Pages with Measurements: ${pagesWithMeasurements.size}`, 20, 75);
                    
                    // Add cost summary
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

                  // Create conditions legend with color swatches
                  let legendY = costBreakdown.summary.totalCost > 0 ? 170 : 90;
                  pdf.setFontSize(14);
                  pdf.setFont('helvetica', 'bold');
                  pdf.text('Conditions Legend', 20, legendY);
                  legendY += 10;
                  
                  pdf.setFontSize(9);
                  pdf.setFont('helvetica', 'normal');
                  
                  conditionIds.forEach((conditionId) => {
                    const conditionData = reportData[conditionId];
                    
                    // Check if we need a new page
                    if (legendY > 270) {
                      pdf.addPage();
                      legendY = 20;
                    }
                    
                    // Draw color swatch (rectangle)
                    const color = conditionData.condition.color;
                    const r = parseInt(color.slice(1, 3), 16) / 255;
                    const g = parseInt(color.slice(3, 5), 16) / 255;
                    const b = parseInt(color.slice(5, 7), 16) / 255;
                    pdf.setFillColor(r * 255, g * 255, b * 255);
                    pdf.rect(20, legendY - 3, 5, 4, 'F');
                    
                    // Condition info
                    const conditionName = conditionData.condition.name.length > 35 
                      ? conditionData.condition.name.substring(0, 32) + '...' 
                      : conditionData.condition.name;
                    
                    pdf.setTextColor(0, 0, 0);
                    pdf.text(`${conditionName} - ${conditionData.condition.type.toUpperCase()} (${conditionData.grandTotal.toFixed(2)} ${conditionData.condition.unit})`, 28, legendY);
                    
                    legendY += 6;
                  });
                  
                  // Add page breakdown section
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
                  
                  // Get page breakdown
                  const pageBreakdown = new Map<string, Array<{condition: any, total: number}>>();
                  conditionIds.forEach(conditionId => {
                    const conditionData = reportData[conditionId];
                    Object.entries(conditionData.pages).forEach(([pageKey, pageData]: [string, any]) => {
                      if (!pageBreakdown.has(pageKey)) {
                        pageBreakdown.set(pageKey, []);
                      }
                      pageBreakdown.get(pageKey)!.push({
                        condition: conditionData.condition,
                        total: pageData.total
                      });
                    });
                  });
                  
                  // Sort pages
                  const sortedPageKeys = Array.from(pageBreakdown.keys()).sort((a, b) => {
                    const pageA = pagesWithMeasurements.get(a);
                    const pageB = pagesWithMeasurements.get(b);
                    if (!pageA || !pageB) return 0;
                    return pageA.pageNumber - pageB.pageNumber;
                  });
                  
                  sortedPageKeys.forEach(pageKey => {
                    const pageInfo = pagesWithMeasurements.get(pageKey);
                    const conditions = pageBreakdown.get(pageKey) || [];
                    
                    if (!pageInfo) return;
                    
                    // Check if we need a new page
                    if (legendY > 260) {
                      pdf.addPage();
                      legendY = 20;
                    }
                    
                    // Page header
                    pdf.setFont('helvetica', 'bold');
                    const hasCustomName = pageInfo.sheetName && pageInfo.sheetName !== `Page ${pageInfo.pageNumber}`;
                    const pageLabel = hasCustomName ? `${pageInfo.sheetName} (P.${pageInfo.pageNumber})` : `Page ${pageInfo.pageNumber}`;
                    pdf.text(pageLabel, 20, legendY);
                    legendY += 5;
                    
                    // Conditions on this page
                    pdf.setFont('helvetica', 'normal');
                    conditions.forEach(item => {
                      // Draw small color swatch
                      const color = item.condition.color;
                      const r = parseInt(color.slice(1, 3), 16) / 255;
                      const g = parseInt(color.slice(3, 5), 16) / 255;
                      const b = parseInt(color.slice(5, 7), 16) / 255;
                      pdf.setFillColor(r * 255, g * 255, b * 255);
                      pdf.rect(25, legendY - 2.5, 3, 3, 'F');
                      
                      pdf.setTextColor(0, 0, 0);
                      const condName = item.condition.name.length > 30 
                        ? item.condition.name.substring(0, 27) + '...' 
                        : item.condition.name;
                      pdf.text(`  ${condName}: ${item.total.toFixed(2)} ${item.condition.unit}`, 28, legendY);
                      legendY += 5;
                    });
                    
                    legendY += 3; // Space between pages
                  });

      // Update progress  
      onExportStatusUpdate?.('pdf', 25);

      // Save the summary PDF
      const summaryPdfBytes = new Uint8Array(pdf.output('arraybuffer'));
      
      // Prepare pages with measurements for PDF export
      const { getConditionTakeoffMeasurements, annotations: storeAnnotations } = useTakeoffStore.getState();
      const pagesForExport = Array.from(pagesWithMeasurements.values())
        .map(pageInfo => {
          // Get all measurements for this page
          const pageMeasurements: any[] = [];
          conditionIds.forEach(conditionId => {
            const conditionMeasurements = getConditionTakeoffMeasurements(projectId, conditionId);
            const pageSpecificMeasurements = conditionMeasurements.filter(
              m => m.sheetId === pageInfo.sheetId && m.pdfPage === pageInfo.pageNumber
            );
            pageMeasurements.push(...pageSpecificMeasurements);
          });

          // Get all annotations for this page
          const pageAnnotations = storeAnnotations.filter(
            a => a.projectId === projectId && 
                 a.sheetId === pageInfo.sheetId && 
                 a.pageNumber === pageInfo.pageNumber
          );

          return {
            pageNumber: pageInfo.pageNumber,
            sheetName: pageInfo.sheetName,
            sheetId: pageInfo.sheetId,
            measurements: pageMeasurements,
            annotations: pageAnnotations
          };
        })
        // Filter out pages that have no measurements AND no annotations
        .filter(page => page.measurements.length > 0 || page.annotations.length > 0)
        .sort((a, b) => {
          // Sort by sheet ID first, then by page number
          if (a.sheetId !== b.sheetId) {
            return a.sheetId.localeCompare(b.sheetId);
          }
          return a.pageNumber - b.pageNumber;
        });

      // Export pages with measurements using pdf-lib
      onExportStatusUpdate?.('pdf', 30);
      
      // Get document rotations for coordinate transformation
      const { getDocumentRotation } = useTakeoffStore.getState();
      const documentRotations = new Map<string, number>();
      pagesForExport.forEach(page => {
        if (!documentRotations.has(page.sheetId)) {
          documentRotations.set(page.sheetId, getDocumentRotation(page.sheetId));
        }
      });
      
      const exportResult = await exportPagesWithMeasurementsToPDF(
        pagesForExport,
        currentProject?.name || 'Project',
        documentRotations,
        (progress) => {
          // Map pdf-lib progress (0-100) to our progress range (30-80)
          const mappedProgress = 30 + (progress * 0.5);
          onExportStatusUpdate?.('pdf', Math.round(mappedProgress));
        }
      );

      // Warn user if any sheets were skipped
      if (exportResult.skippedSheets.length > 0) {
        const skippedCount = exportResult.skippedSheets.length;
        const warningMessage = `Warning: ${skippedCount} sheet(s) were skipped because the files were not found. ` +
          `This may indicate files were deleted but measurements still reference them. ` +
          `Your export may be incomplete. Please check your project files.`;
        console.warn('⚠️ PDF Export Warning:', warningMessage, exportResult.skippedSheets);
        alert(warningMessage);
      }

      // Merge summary PDF with measurements PDF
      onExportStatusUpdate?.('pdf', 85);
      const summaryPdfDoc = await PDFLibDocument.load(summaryPdfBytes);
      const measurementsPdfDoc = await PDFLibDocument.load(exportResult.pdfBytes);
      
      const finalPdf = await PDFLibDocument.create();
      
      // Copy all pages from summary
      const summaryPages = await finalPdf.copyPages(summaryPdfDoc, summaryPdfDoc.getPageIndices());
      summaryPages.forEach(page => finalPdf.addPage(page));
      
      // Copy all pages from measurements
      const measurementPages = await finalPdf.copyPages(measurementsPdfDoc, measurementsPdfDoc.getPageIndices());
      measurementPages.forEach(page => finalPdf.addPage(page));
      
      onExportStatusUpdate?.('pdf', 90);
      const finalPdfBytes = await finalPdf.save();

      // Generate filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const projectName = currentProject?.name?.replace(/[^a-zA-Z0-9]/g, '-') || 'project';
      const filename = `${projectName}-takeoff-report-${timestamp}.pdf`;

      // Download the PDF
      downloadPDF(finalPdfBytes, filename);
      
      // Complete
      onExportStatusUpdate?.('pdf', 100);
      
      // Reset status after a brief delay
      setTimeout(() => {
        onExportStatusUpdate?.(null, 0);
      }, 1000);
      
    } catch (error) {
      console.error('PDF export error:', error);
      alert('Error exporting PDF. Please try again.');
      onExportStatusUpdate?.(null, 0);
      throw error; // Re-throw to be caught by the button handler
    }
  };

  const handleConditionClick = (condition: TakeoffCondition) => {
    // If the condition is already selected, deselect it
    if (selectedConditionId === condition.id) {
      setSelectedCondition(null);
      onConditionSelect(null);
      return;
    }
    
    // Otherwise, select the new condition
    onConditionSelect(condition);
    setSelectedCondition(condition.id);
  };



  const handleDeleteCondition = async (conditionId: string) => {
    try {
      // Delete condition via API and update store
      await useTakeoffStore.getState().deleteCondition(conditionId);
      setShowDeleteConfirm(null);
    } catch (error) {
      console.error('Failed to delete condition:', error);
      // You might want to show an error message to the user here
    }
  };

  const handleDuplicateCondition = (condition: TakeoffCondition) => {
    const { id, ...conditionWithoutId } = condition;
    
    // Generate a random color from a curated palette
    const colors = [
      '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57',
      '#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3', '#ff9f43',
      '#10ac84', '#ee5a24', '#0984e3', '#6c5ce7', '#a29bfe',
      '#fd79a8', '#fdcb6e', '#e17055', '#74b9ff', '#00b894'
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    const newCondition = {
      ...conditionWithoutId,
      projectId,
      name: `${condition.name} (Copy)`,
      color: randomColor
    };
    addCondition(newCondition);
  };

  const handleEditCondition = (condition: TakeoffCondition) => {
    setEditingCondition(condition);
    setShowCreateDialog(true);
  };

  const handleCutoutMode = (condition: TakeoffCondition) => {
    if (onCutoutMode) {
      // If already in cut-out mode for this condition, turn it off
      if (cutoutMode && cutoutTargetConditionId === condition.id) {
        onCutoutMode(null);
      } else {
        // Turn on cut-out mode for this condition
        onCutoutMode(condition.id);
      }
    }
  };

  const handleCloseDialog = () => {
    setShowCreateDialog(false);
    setEditingCondition(null);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'area': return <Square className="w-4 h-4" />;
      case 'volume': return <Package className="w-4 h-4" />;
      case 'linear': return <Ruler className="w-4 h-4" />;
      case 'count': return <Hash className="w-4 h-4" />;
      case 'visual-search': return <Search className="w-4 h-4" />;
      default: return <Calculator className="w-4 h-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'area': return 'bg-blue-100 text-blue-800';
      case 'volume': return 'bg-green-100 text-green-800';
      case 'linear': return 'bg-purple-100 text-purple-800';
      case 'count': return 'bg-orange-100 text-orange-800';
      case 'visual-search': return 'bg-indigo-100 text-indigo-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Helper function to check if condition has measurements
  const hasMeasurements = (condition: TakeoffCondition): boolean => {
    const measurements = getConditionTakeoffMeasurements(projectId, condition.id);
    return measurements.length > 0;
  };


  if (loadingConditions) {
    return (
      <div className="w-80 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-white border-r flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        {/* Tabs */}
        <div className="flex mb-4">
          <button
            className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'conditions'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('conditions')}
          >
            <div className="flex items-center justify-center gap-1">
              <Calculator className="w-4 h-4" />
              <span className="hidden sm:inline">Conditions</span>
            </div>
          </button>
          <button
            className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'reports'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('reports')}
          >
            <div className="flex items-center justify-center gap-1">
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Reports</span>
            </div>
          </button>
          <button
            className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'costs'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('costs')}
          >
            <div className="flex items-center justify-center gap-1">
              <DollarSign className="w-4 h-4" />
              <span className="hidden sm:inline">Costs</span>
            </div>
          </button>
        </div>

        {/* Tab Content Header */}
        {activeTab === 'conditions' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Takeoff Conditions</h2>
              <Button size="sm" variant="outline" onClick={() => setShowCreateDialog(true)}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            
            <Input
              placeholder="Search conditions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mb-4"
            />
          </>
        )}

        {activeTab === 'reports' && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Quantity Reports</h2>
            <div className="relative">
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => setShowExportDropdown(!showExportDropdown)}
              >
                <Download className="w-4 h-4 mr-1" />
                Export
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
              
              {showExportDropdown && (
                <div ref={dropdownRef} className="absolute right-0 top-full mt-1 w-48 bg-white border rounded-lg shadow-lg z-50">
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        await exportToExcel();
                        setShowExportDropdown(false);
                      } catch (error) {
                        console.error('Excel export error:', error);
                        alert('Error exporting Excel file. Please try again.');
                      }
                    }}
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    Export Excel Report
                  </button>
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        await exportToPDF();
                        setShowExportDropdown(false);
                      } catch (error) {
                        console.error('PDF export error:', error);
                        alert('Error exporting PDF file. Please try again.');
                      }
                    }}
                  >
                    <FileImage className="w-4 h-4" />
                    Export PDF Report
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'conditions' && (
          <div className="p-4 space-y-3">
            {filteredConditions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Calculator className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No takeoff conditions yet</p>
                <p className="text-sm">Click the + button to create your first condition</p>
              </div>
            ) : (
              filteredConditions.map((condition) => (
              <div
                key={condition.id}
                className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                  selectedConditionId === condition.id 
                    ? 'border-blue-500 bg-blue-50 shadow-sm' 
                    : condition.aiGenerated
                      ? 'border-blue-400 bg-blue-100/50 hover:bg-blue-100/70 shadow-sm' // Enhanced AI condition styling
                      : 'border-gray-200 hover:bg-accent/50'
                }`}
                onClick={() => handleConditionClick(condition)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    {getTypeIcon(condition.type)}
                    <div className="min-w-0 flex-1">
                      <span className="font-medium break-words">{condition.name}</span>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {condition.unit}
                        </Badge>
                        {condition.aiGenerated && (
                          <div className="flex items-center gap-1">
                            <Bot className="w-4 h-4 text-blue-600" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    {/* Cut-out button - only show for area/volume conditions */}
                    {(condition.type === 'area' || condition.type === 'volume') && onCutoutMode && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCutoutMode(condition);
                        }}
                        className={`h-6 w-6 p-0 ${cutoutMode && cutoutTargetConditionId === condition.id ? 'bg-red-100 text-red-600' : 'text-red-500 hover:text-red-600'}`}
                        title="Add cut-out to existing measurements"
                      >
                        <Scissors className="w-3 h-3" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicateCondition(condition);
                      }}
                      className="h-6 w-6 p-0"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditCondition(condition);
                      }}
                      className="h-6 w-6 p-0"
                    >
                      <Edit3 className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDeleteConfirm(condition.id);
                      }}
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                
                {/* Active indicator - moved below to save horizontal space */}
                {selectedConditionId === condition.id && (
                  <div className="mb-2">
                    <Badge variant="default" className="text-xs bg-blue-600">
                      Active
                    </Badge>
                    <div className="text-xs text-blue-600 mt-1 font-medium">
                      Click to deactivate
                    </div>
                  </div>
                )}
                
                <p className="text-sm text-muted-foreground mb-2">
                  {condition.description}
                </p>
                
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: condition.color }}
                    />
                    <span>Color</span>
                  </div>
                  {condition.type !== 'count' && (
                    <span>Waste: {condition.wasteFactor}%</span>
                  )}
                  <div className="font-medium text-blue-600">
                    {(() => {
                      const measurements = getConditionTakeoffMeasurements(projectId, condition.id);
                      // Filter measurements to only include those from currently selected document
                      const currentDocumentMeasurements = selectedDocumentId 
                        ? measurements.filter(m => m.sheetId === selectedDocumentId)
                        : measurements;
                      const totalValue = currentDocumentMeasurements.reduce((sum, m) => {
                        // Use net value if cutouts exist, otherwise use calculated value
                        const value = m.netCalculatedValue !== undefined && m.netCalculatedValue !== null 
                          ? m.netCalculatedValue 
                          : m.calculatedValue;
                        return sum + (value || 0);
                      }, 0);
                      const totalPerimeter = currentDocumentMeasurements.reduce((sum, m) => sum + (m.perimeterValue || 0), 0);
                      const totalAreaValue = currentDocumentMeasurements.reduce((sum, m) => sum + (m.areaValue || 0), 0);
                      
                      if (totalValue > 0) {
                        // For linear measurements with height, show both linear and area
                        if (condition.type === 'linear' && condition.includeHeight && totalAreaValue > 0) {
                          return (
                            <div className="space-y-1">
                              <div>{formatFeetAndInches(totalValue)} LF</div>
                              <div className="text-xs text-gray-500">
                                {totalAreaValue.toFixed(0)} SF
                              </div>
                            </div>
                          );
                        }
                        // For linear measurements (feet), use feet and inches format
                        if (condition.unit === 'ft' || condition.unit === 'feet' || (condition.type === 'linear' && (condition.unit === 'LF' || condition.unit === 'lf'))) {
                          return formatFeetAndInches(totalValue);
                        }
                        // For area measurements, show area and perimeter separately if perimeter exists
                        if (condition.unit === 'SF' || condition.unit === 'sq ft') {
                          return (
                            <div className="space-y-1">
                              <div>{totalValue.toFixed(0)} SF</div>
                              {totalPerimeter > 0 && (
                                <div className="text-xs text-gray-500">
                                  {formatFeetAndInches(totalPerimeter)} LF
                                </div>
                              )}
                            </div>
                          );
                        }
                        // For other units, keep the original format
                        return `${totalValue.toFixed(2)} ${condition.unit}`;
                      }
                      return '0';
                    })()}
                  </div>
                </div>
              </div>
            ))
          )}
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="p-4">
            {(() => {
              const { reportData } = getQuantityReportData();
              const conditionIds = Object.keys(reportData);
              const costBreakdown = getProjectCostBreakdown(projectId);
              
              if (conditionIds.length === 0) {
                return (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No quantity data yet</p>
                    <p className="text-sm">Create conditions and add measurements to see reports</p>
                  </div>
                );
              }

              return (
                <div className="space-y-4">
                  {/* Cost Summary Section */}
                  {costBreakdown.summary.totalCost > 0 && (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-lg p-4 border border-blue-200">
                      <h3 className="text-lg font-semibold text-slate-900 mb-3">Project Cost Summary</h3>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-600">Total Cost:</span>
                          <span className="font-semibold text-blue-600">${costBreakdown.summary.totalCost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Profit Margin:</span>
                          <span className="font-semibold text-green-600">{costBreakdown.summary.profitMarginPercent}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Subtotal:</span>
                          <span className="font-medium">${costBreakdown.summary.subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Conditions with Costs:</span>
                          <span className="font-medium">{costBreakdown.summary.conditionsWithCosts}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Quantity Reports */}
                  <div className="space-y-3">
                    {conditionIds.map(conditionId => {
                    const conditionData = reportData[conditionId];
                    const isExpanded = expandedConditions.has(conditionId);
                    const pageCount = Object.keys(conditionData.pages).length;
                    
                    return (
                      <div key={conditionId} className="border rounded-lg">
                        {/* Condition Row */}
                        <div 
                          className="p-3 hover:bg-gray-50 cursor-pointer"
                          onClick={() => toggleConditionExpansion(conditionId)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-gray-500" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-gray-500" />
                              )}
                              <div 
                                className="w-4 h-4 rounded-full" 
                                style={{ backgroundColor: conditionData.condition.color }}
                              />
                              <div>
                                <div className="font-medium text-sm">
                                  {conditionData.condition.name}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {pageCount} page{pageCount !== 1 ? 's' : ''} • {conditionData.condition.type} • {conditionData.condition.unit}
                                </div>
                              </div>
                            </div>
                            
                            <div className="text-right">
                              <div className="font-semibold text-sm">
                                {conditionData.condition.unit === 'ft' || conditionData.condition.unit === 'feet' 
                                  ? formatFeetAndInches(conditionData.grandTotal)
                                  : `${conditionData.grandTotal.toFixed(0)} ${conditionData.condition.unit}`
                                }
                              </div>
                              <div className="text-xs text-gray-500">
                                Total
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Expanded Measurements */}
                        {isExpanded && (
                          <div className="border-t bg-gray-50 p-3 space-y-3">
                            {Object.values(conditionData.pages).map(pageData => (
                              <div key={`${pageData.pageNumber}-${pageData.sheetName}`} className="bg-white rounded p-2">
                                <div className="flex justify-between items-center mb-2">
                                  <button
                                    className="font-medium text-sm text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-left"
                                    onClick={(e) => handlePageClick(pageData.sheetId, pageData.pageNumber, e)}
                                    title={`Go to ${pageData.sheetName}`}
                                  >
                                    {pageData.sheetName}
                                  </button>
                                  <div className="text-sm font-semibold">
                                    {conditionData.condition.unit === 'ft' || conditionData.condition.unit === 'feet' 
                                      ? formatFeetAndInches(pageData.total)
                                      : `${pageData.total.toFixed(2)} ${conditionData.condition.unit}`
                                    }
                                  </div>
                                </div>
                                
                                <div className="text-xs text-gray-500">
                                  {pageData.measurements.length} measurement{pageData.measurements.length !== 1 ? 's' : ''}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'costs' && (
          <div className="p-4">
            {(() => {
              const costBreakdown = getProjectCostBreakdown(projectId);
              const { conditions: costConditions, summary } = costBreakdown;
              
              if (costConditions.length === 0) {
                return (
                  <div className="text-center py-8 text-muted-foreground">
                    <DollarSign className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No cost data yet</p>
                    <p className="text-sm">Create conditions with cost information to see cost analysis</p>
                  </div>
                );
              }

              return (
                <div className="space-y-4">
                  {/* Project Cost Summary */}
                  <div className="bg-gradient-to-br from-purple-50 to-pink-100 rounded-lg p-4 border border-purple-200">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-semibold text-slate-900">Project Cost Summary</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // Open profit margin dialog
                          const event = new CustomEvent('openProjectSettings');
                          window.dispatchEvent(event);
                        }}
                        className="flex items-center gap-1 text-xs"
                      >
                        <Edit3 className="w-3 h-3" />
                        Profit Margin
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Material Costs</span>
                        <span className="text-sm font-medium text-slate-900">${summary.totalMaterialCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Equipment Costs</span>
                        <span className="text-sm font-medium text-slate-900">${summary.totalEquipmentCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Waste Factor Costs</span>
                        <span className="text-sm font-medium text-slate-900">${summary.totalWasteCost.toFixed(2)}</span>
                      </div>
                      <div className="border-t border-slate-200 pt-2">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-slate-900">Subtotal</span>
                          <span className="font-semibold text-slate-900">${summary.subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-slate-600">Profit Margin ({summary.profitMarginPercent}%)</span>
                          <span className="text-sm text-green-600 font-medium">${summary.profitMarginAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                          <span className="text-lg font-bold text-slate-900">Total Cost</span>
                          <span className="text-lg font-bold text-blue-600">${summary.totalCost.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>


                  {/* Condition Cost Breakdown */}
                  <div className="space-y-3">
                    <h4 className="font-semibold text-slate-900">Cost Breakdown by Condition</h4>
                    {costConditions.filter(c => c.hasCosts).length === 0 ? (
                      <div className="text-center py-6 text-slate-500 bg-slate-50 rounded-lg">
                        <DollarSign className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No conditions with cost data</p>
                        <p className="text-xs">Add material or equipment costs to conditions to see breakdown</p>
                      </div>
                    ) : (
                      costConditions.map(condition => {
                        if (!condition.hasCosts) return null;
                        
                        return (
                        <div key={condition.condition.id} className="border rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div 
                                className="w-5 h-5 rounded-full border-2 border-white shadow-sm" 
                                style={{ backgroundColor: condition.condition.color }}
                              />
                              <div>
                                <span className="font-medium text-sm text-slate-900">{condition.condition.name}</span>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant="outline" className="text-xs">
                                    {condition.condition.type}
                                  </Badge>
                                  <Badge variant="secondary" className="text-xs">
                                    {condition.condition.unit}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-lg text-blue-600">
                                ${condition.subtotal.toFixed(2)}
                              </span>
                              <div className="text-xs text-slate-500">
                                ${condition.quantity > 0 ? (condition.subtotal / condition.quantity).toFixed(2) : '0.00'}/unit
                              </div>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-slate-600">Quantity</span>
                              <div className="text-right">
                                <span className="font-medium">{condition.quantity.toFixed(2)} {condition.condition.unit}</span>
                                {condition.condition.wasteFactor > 0 && (
                                  <div className="text-xs text-slate-500">
                                    + {condition.condition.wasteFactor}% waste = {condition.adjustedQuantity.toFixed(2)} {condition.condition.unit}
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-slate-600">Material</span>
                                <span className="font-medium text-blue-600">${condition.materialCost.toFixed(2)}</span>
                              </div>
                              {condition.equipmentCost > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-slate-600">Equipment</span>
                                  <span className="font-medium text-green-600">${condition.equipmentCost.toFixed(2)}</span>
                                </div>
                              )}
                              {condition.wasteCost > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-slate-600">Waste</span>
                                  <span className="font-medium text-orange-600">${condition.wasteCost.toFixed(2)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-2">Delete Condition</h3>
            <p className="text-muted-foreground mb-4">
              Are you sure you want to delete this condition? This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDeleteCondition(showDeleteConfirm)}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Condition Dialog */}
      {showCreateDialog && (
        <CreateConditionDialog
          projectId={projectId}
          onClose={handleCloseDialog}
          onConditionCreated={(condition) => {
            refreshProjectConditions(projectId); // Force refresh conditions from API
            handleCloseDialog();
          }}
          onConditionSelect={onConditionSelect} // Pass condition select handler for auto-selection
          editingCondition={editingCondition}
        />
      )}


    </div>
  );
}
