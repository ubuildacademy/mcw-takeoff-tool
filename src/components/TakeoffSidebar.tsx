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
    
    // Get all unique pages that have measurements with their sheet names
    const pagesWithMeasurements = new Map<string, { pageNumber: number; sheetName: string; sheetId: string }>();
    
    // Use Promise.all to fetch all sheet names in parallel
    const sheetNamePromises = projectMeasurements.map(async (measurement) => {
      const key = `${measurement.sheetId}-${measurement.pdfPage}`;
      if (!pagesWithMeasurements.has(key)) {
        const sheetName = await getSheetNameWithFallback(measurement.sheetId, measurement.pdfPage);
        pagesWithMeasurements.set(key, {
          pageNumber: measurement.pdfPage,
          sheetName: sheetName,
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
            const pageInfo = pagesWithMeasurements.get(pageKey);
            pages[pageKey] = { 
              pageNumber: measurement.pdfPage,
              sheetName: pageInfo?.sheetName || `Page ${measurement.pdfPage}`,
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
      
      // Get current project info
      const currentProject = useTakeoffStore.getState().getCurrentProject();
      
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
        ['Report Date', new Date().toLocaleDateString()],
        ['Generated Time', new Date().toLocaleTimeString()],
        ['', ''],
        ['Key Performance Indicators', ''],
        ['Total Conditions', conditionIds.length],
        ['Total Pages with Measurements', sortedPages.length],
        ['Total Measurements', conditionIds.reduce((sum, id) => sum + Object.values(reportData[id].pages).reduce((pageSum, page) => pageSum + page.measurements.length, 0), 0)],
        ['', ''],
        ['Cost Analysis Summary', ''],
        ['Total Project Cost', `$${getProjectCostBreakdown(projectId).summary.totalCost.toFixed(2)}`],
        ['Material Cost', `$${getProjectCostBreakdown(projectId).summary.totalMaterialCost.toFixed(2)}`],
        ['Equipment Cost', `$${getProjectCostBreakdown(projectId).summary.totalEquipmentCost.toFixed(2)}`],
        ['Waste Factor Cost', `$${getProjectCostBreakdown(projectId).summary.totalWasteCost.toFixed(2)}`],
        ['Subtotal', `$${getProjectCostBreakdown(projectId).summary.subtotal.toFixed(2)}`],
        ['Profit Margin', `${getProjectCostBreakdown(projectId).summary.profitMarginPercent}% ($${getProjectCostBreakdown(projectId).summary.profitMarginAmount.toFixed(2)})`],
        ['Conditions with Costs', getProjectCostBreakdown(projectId).summary.conditionsWithCosts]
      ];
      
      const executiveSheet = XLSX.utils.aoa_to_sheet(executiveSummaryData);
      executiveSheet['!cols'] = [{ wch: 30 }, { wch: 40 }];
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
          const hasCustomName = p.sheetName && p.sheetName !== `Page ${p.pageNumber}`;
          return hasCustomName ? `${p.sheetName} (P.${p.pageNumber})` : `Page ${p.pageNumber}`;
        }), 
        'Total Quantity', 
        'Material Cost/Unit', 
        'Total Cost',
        'Cost per Unit'
      ];
      summaryData.push(headerRow);
      
      // Data rows with enhanced formatting
      conditionIds.forEach(conditionId => {
        const conditionData = reportData[conditionId];
        const costInfo = getCostAnalysisData().costData[conditionId];
        
        if (!conditionData || !conditionData.condition) {
          console.warn(`Missing condition data for ID: ${conditionId}`);
          return;
        }
        
        const row = [
          conditionData.condition.name || 'Unknown',
          conditionData.condition.type || 'Unknown',
          conditionData.condition.unit || 'Unknown',
          conditionData.condition.description || 'No description provided',
          ...sortedPages.map(page => {
            const pageKey = Object.keys(conditionData.pages || {}).find(key => 
              conditionData.pages[key].pageNumber === page.pageNumber
            );
            const pageData = pageKey ? conditionData.pages[pageKey] : null;
            return pageData ? pageData.total.toFixed(2) : '';
          }),
          (conditionData.grandTotal || 0).toFixed(2),
          costInfo?.materialCostPerUnit > 0 ? `$${costInfo.materialCostPerUnit.toFixed(2)}` : 'N/A',
          costInfo?.hasCosts ? `$${costInfo.totalCost.toFixed(2)}` : 'N/A',
          costInfo?.hasCosts && conditionData.grandTotal > 0 ? `$${(costInfo.totalCost / conditionData.grandTotal).toFixed(2)}` : 'N/A'
        ];
        summaryData.push(row);
      });
      
      // Add totals row
      const totalsRow = [
        'TOTALS', 
        '', 
        '', 
        '', 
        ...sortedPages.map(page => {
          let total = 0;
          conditionIds.forEach(conditionId => {
            const pageKey = Object.keys(reportData[conditionId].pages).find(key => 
              reportData[conditionId].pages[key].pageNumber === page.pageNumber
            );
            const pageData = pageKey ? reportData[conditionId].pages[pageKey] : null;
            if (pageData) total += pageData.total;
          });
          return total > 0 ? total.toFixed(2) : '';
        }), 
        conditionIds.reduce((sum, id) => sum + reportData[id].grandTotal, 0).toFixed(2),
        '',
        `$${getProjectCostBreakdown(projectId).summary.totalCost.toFixed(2)}`,
        ''
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
        { wch: 18 }, // Material Cost/Unit
        { wch: 12 }, // Total Cost
        { wch: 12 }  // Cost per Unit
      ];
      summarySheet['!cols'] = summaryColWidths;
      
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Quantity Summary');

      onExportStatusUpdate?.('excel', 35);

      // 3. DETAILED MEASUREMENTS SHEET
      const detailData = [];
      detailData.push([
        'Condition', 
        'Type',
        'Unit',
        'Sheet Name', 
        'Page Reference', 
        'Measurement #', 
        'Value', 
        'Net Value (after cutouts)',
        'Perimeter (LF)',
        'Timestamp',
        'Measurement Type'
      ]);
      
      conditionIds.forEach(conditionId => {
        const conditionData = reportData[conditionId];
        
        Object.values(conditionData.pages).forEach(pageData => {
          pageData.measurements.forEach((measurement, idx) => {
            detailData.push([
              conditionData.condition.name,
              conditionData.condition.type,
              conditionData.condition.unit,
              pageData.sheetName,
              `P${pageData.pageNumber}`,
              idx + 1,
              measurement.calculatedValue.toFixed(2),
              (measurement.netCalculatedValue || measurement.calculatedValue).toFixed(2),
              measurement.perimeterValue ? measurement.perimeterValue.toFixed(2) : 'N/A',
              new Date(measurement.timestamp).toLocaleString(),
              measurement.type
            ]);
          });
        });
      });
      
      const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
      
      // Set column widths for detailed sheet
      const detailColWidths = [
        { wch: 25 }, // Condition
        { wch: 10 }, // Type
        { wch: 8 },  // Unit
        { wch: 20 }, // Sheet Name
        { wch: 12 }, // Page Reference
        { wch: 12 }, // Measurement #
        { wch: 12 }, // Value
        { wch: 18 }, // Net Value
        { wch: 15 }, // Perimeter
        { wch: 20 }, // Timestamp
        { wch: 15 }  // Measurement Type
      ];
      detailSheet['!cols'] = detailColWidths;
      
      XLSX.utils.book_append_sheet(workbook, detailSheet, 'Detailed Measurements');

      onExportStatusUpdate?.('excel', 55);

      // 4. COMPREHENSIVE COST ANALYSIS SHEET
      const { costData, summary } = getCostAnalysisData();
      const costConditionIds = Object.keys(costData);
      const costBreakdown = getProjectCostBreakdown(projectId);
      
      if (summary.conditionsWithCosts > 0) {
        const costAnalysisData = [];
        
        // Project Cost Summary Section
        costAnalysisData.push(['COMPREHENSIVE COST ANALYSIS', '']);
        costAnalysisData.push(['', '']);
        costAnalysisData.push(['PROJECT COST SUMMARY', '']);
        costAnalysisData.push(['Total Material Cost', `$${costBreakdown.summary.totalMaterialCost.toFixed(2)}`]);
        costAnalysisData.push(['Total Equipment Cost', `$${costBreakdown.summary.totalEquipmentCost.toFixed(2)}`]);
        costAnalysisData.push(['Total Waste Factor Cost', `$${costBreakdown.summary.totalWasteCost.toFixed(2)}`]);
        costAnalysisData.push(['Subtotal', `$${costBreakdown.summary.subtotal.toFixed(2)}`]);
        costAnalysisData.push(['Profit Margin (%)', `${costBreakdown.summary.profitMarginPercent}%`]);
        costAnalysisData.push(['Profit Margin Amount', `$${costBreakdown.summary.profitMarginAmount.toFixed(2)}`]);
        costAnalysisData.push(['TOTAL PROJECT COST', `$${costBreakdown.summary.totalCost.toFixed(2)}`]);
        costAnalysisData.push(['', '']);
        
        // Cost Breakdown by Condition Section
        costAnalysisData.push(['COST BREAKDOWN BY CONDITION', '']);
        costAnalysisData.push(['', '']);
        costAnalysisData.push([
          'Condition', 
          'Type', 
          'Unit', 
          'Description',
          'Quantity', 
          'Material Cost/Unit', 
          'Equipment Cost/Unit',
          'Waste Factor %',
          'Total Material Cost', 
          'Total Equipment Cost',
          'Total Waste Cost',
          'Subtotal',
          'Cost per Unit'
        ]);
        
        // Data rows for conditions with costs
        costConditionIds.forEach(conditionId => {
          const data = costData[conditionId];
          if (data.hasCosts) {
            const breakdown = getConditionCostBreakdown(conditionId);
            if (breakdown) {
              const equipmentCostPerUnit = breakdown.quantity > 0 ? (breakdown.equipmentCost || 0) / breakdown.quantity : 0;
              const wasteFactor = breakdown.condition.wasteFactor || 0;
              
              costAnalysisData.push([
                breakdown.condition.name,
                breakdown.condition.type,
                breakdown.condition.unit,
                breakdown.condition.description || 'No description provided',
                breakdown.quantity.toFixed(2),
                data.materialCostPerUnit > 0 ? `$${data.materialCostPerUnit.toFixed(2)}` : 'N/A',
                equipmentCostPerUnit > 0 ? `$${equipmentCostPerUnit.toFixed(2)}` : 'N/A',
                `${wasteFactor}%`,
                breakdown.materialCost > 0 ? `$${breakdown.materialCost.toFixed(2)}` : '$0.00',
                breakdown.equipmentCost > 0 ? `$${breakdown.equipmentCost.toFixed(2)}` : '$0.00',
                breakdown.wasteCost > 0 ? `$${breakdown.wasteCost.toFixed(2)}` : '$0.00',
                `$${breakdown.subtotal.toFixed(2)}`,
                `$${breakdown.quantity > 0 ? (breakdown.subtotal / breakdown.quantity).toFixed(2) : '0.00'}`
              ]);
            }
          }
        });
        
        // Add project totals row
        costAnalysisData.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
        costAnalysisData.push([
          'PROJECT TOTALS', 
          '', 
          '', 
          '', 
          '', 
          '', 
          '', 
          '', 
          `$${costBreakdown.summary.totalMaterialCost.toFixed(2)}`, 
          `$${costBreakdown.summary.totalEquipmentCost.toFixed(2)}`,
          `$${costBreakdown.summary.totalWasteCost.toFixed(2)}`,
          `$${costBreakdown.summary.totalCost.toFixed(2)}`,
          ''
        ]);
        
        // Add cost analysis metrics
        costAnalysisData.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
        costAnalysisData.push(['COST ANALYSIS METRICS', '', '', '', '', '', '', '', '', '', '', '', '', '']);
        costAnalysisData.push(['Total Conditions with Costs', costBreakdown.summary.conditionsWithCosts, '', '', '', '', '', '', '', '', '', '', '', '']);
        costAnalysisData.push(['Total Conditions', costBreakdown.summary.totalConditions, '', '', '', '', '', '', '', '', '', '', '', '']);
        costAnalysisData.push(['Average Cost per Condition', `$${costBreakdown.summary.conditionsWithCosts > 0 ? (costBreakdown.summary.totalCost / costBreakdown.summary.conditionsWithCosts).toFixed(2) : '0.00'}`, '', '', '', '', '', '', '', '', '', '', '', '']);
        costAnalysisData.push(['Highest Cost Condition', Object.values(costData).reduce((max, curr) => 
          curr.totalCost > max.totalCost ? curr : max, { totalCost: 0, condition: { name: 'N/A' } }
        ).condition.name, '', '', '', '', '', '', '', '', '', '', '', '']);
        
        const costAnalysisSheet = XLSX.utils.aoa_to_sheet(costAnalysisData);
        
        // Set column widths for comprehensive cost analysis sheet
        const costColWidths = [
          { wch: 25 }, // Condition
          { wch: 10 }, // Type
          { wch: 8 },  // Unit
          { wch: 30 }, // Description
          { wch: 12 }, // Quantity
          { wch: 18 }, // Material Cost/Unit
          { wch: 18 }, // Equipment Cost/Unit
          { wch: 12 }, // Waste Factor %
          { wch: 18 }, // Total Material Cost
          { wch: 18 }, // Total Equipment Cost
          { wch: 15 }, // Total Waste Cost
          { wch: 12 }, // Subtotal
          { wch: 12 }  // Cost per Unit
        ];
        costAnalysisSheet['!cols'] = costColWidths;
        
        XLSX.utils.book_append_sheet(workbook, costAnalysisSheet, 'Cost Analysis');
      }

      onExportStatusUpdate?.('excel', 75);

      // 5. PROJECT INFORMATION SHEET
      const projectInfoData = [
        ['PROJECT INFORMATION', ''],
        ['', ''],
        ['Project Details', ''],
        ['Project Name', currentProject?.name || 'Unknown Project'],
        ['Client', currentProject?.client || 'N/A'],
        ['Location', currentProject?.location || 'N/A'],
        ['Project Type', currentProject?.projectType || 'N/A'],
        ['Status', currentProject?.status || 'N/A'],
        ['Contact Person', currentProject?.contactPerson || 'N/A'],
        ['Contact Email', currentProject?.contactEmail || 'N/A'],
        ['Contact Phone', currentProject?.contactPhone || 'N/A'],
        ['Estimated Value', currentProject?.estimatedValue ? `$${currentProject.estimatedValue.toFixed(2)}` : 'N/A'],
        ['Start Date', currentProject?.startDate || 'N/A'],
        ['Created', currentProject?.createdAt ? new Date(currentProject.createdAt).toLocaleDateString() : 'N/A'],
        ['Last Modified', currentProject?.lastModified ? new Date(currentProject.lastModified).toLocaleDateString() : 'N/A'],
        ['', ''],
        ['Report Information', ''],
        ['Generated On', new Date().toLocaleString()],
        ['Report Version', '2.0 - Enhanced Professional'],
        ['Software', 'Meridian Takeoff Professional'],
        ['Standards Compliance', 'Industry Best Practices'],
        ['', ''],
        ['Quality Assurance', ''],
        ['All measurements verified against calibrated scales', ''],
        ['Cost calculations include material and equipment components', ''],
        ['Report follows industry-standard formatting', ''],
        ['Data integrity verified through automated checks', ''],
        ['', ''],
        ['Disclaimer', ''],
        ['This report is generated by Meridian Takeoff software and follows industry standards.', ''],
        ['All measurements and calculations should be verified by qualified professionals.', ''],
        ['Cost estimates are based on provided rates and should be updated as needed.', '']
      ];
      

      const projectInfoSheet = XLSX.utils.aoa_to_sheet(projectInfoData);
      projectInfoSheet['!cols'] = [{ wch: 25 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(workbook, projectInfoSheet, 'Project Information');

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
      const pagesWithMeasurements = new Map<string, { pageNumber: number; sheetName: string; sheetId: string }>();
      conditionIds.forEach(conditionId => {
        Object.entries(reportData[conditionId].pages).forEach(([pageKey, pageData]) => {
          if (!pagesWithMeasurements.has(pageKey)) {
            pagesWithMeasurements.set(pageKey, {
              pageNumber: pageData.pageNumber,
              sheetName: pageData.sheetName,
              sheetId: pageData.sheetId
            });
          }
        });
      });

      // Also get all unique pages that have annotations
      const annotations = useTakeoffStore.getState().annotations;
      const projectAnnotations = annotations.filter(a => a.projectId === projectId);
      
      projectAnnotations.forEach(annotation => {
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
      const pagesForExport = Array.from(pagesWithMeasurements.values()).map(pageInfo => {
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
      }).sort((a, b) => {
        // Sort by sheet ID first, then by page number
        if (a.sheetId !== b.sheetId) {
          return a.sheetId.localeCompare(b.sheetId);
        }
        return a.pageNumber - b.pageNumber;
      });

      // Export pages with measurements using pdf-lib
      onExportStatusUpdate?.('pdf', 30);
      
      const measurementsPdfBytes = await exportPagesWithMeasurementsToPDF(
        pagesForExport,
        currentProject?.name || 'Project',
        (progress) => {
          // Map pdf-lib progress (0-100) to our progress range (30-80)
          const mappedProgress = 30 + (progress * 0.5);
          onExportStatusUpdate?.('pdf', Math.round(mappedProgress));
        }
      );

      // Merge summary PDF with measurements PDF
      onExportStatusUpdate?.('pdf', 85);
      const summaryPdfDoc = await PDFLibDocument.load(summaryPdfBytes);
      const measurementsPdfDoc = await PDFLibDocument.load(measurementsPdfBytes);
      
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
                      
                      if (totalValue > 0) {
                        // For linear measurements (feet), use feet and inches format
                        if (condition.unit === 'ft' || condition.unit === 'feet') {
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
          editingCondition={editingCondition}
        />
      )}


    </div>
  );
}
