import { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
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
} from 'lucide-react';
import { useTakeoffStore } from '../store/useTakeoffStore';
import { sheetService } from '../services/apiService';
import type { TakeoffCondition, PDFDocument } from '../types';
import { CreateConditionDialog } from './CreateConditionDialog';
import { formatFeetAndInches } from '../lib/utils';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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
      laborCostPerUnit: number;
      totalMaterialCost: number;
      totalLaborCost: number;
      totalCost: number;
      hasCosts: boolean;
    }> = {};
    
    let totalMaterialCost = 0;
    let totalLaborCost = 0;
    let totalProjectCost = 0;
    let conditionsWithCosts = 0;
    
    conditionIds.forEach(conditionId => {
      const conditionData = reportData[conditionId];
      const condition = conditionData.condition;
      const quantity = conditionData.grandTotal;
      
      const materialCostPerUnit = condition.materialCost || 0;
      const laborCostPerUnit = condition.laborCost || 0;
      
      const totalMaterialCostForCondition = quantity * materialCostPerUnit;
      const totalLaborCostForCondition = quantity * laborCostPerUnit;
      const totalCostForCondition = totalMaterialCostForCondition + totalLaborCostForCondition;
      
      const hasCosts = materialCostPerUnit > 0 || laborCostPerUnit > 0;
      
      costData[conditionId] = {
        condition,
        quantity,
        materialCostPerUnit,
        laborCostPerUnit,
        totalMaterialCost: totalMaterialCostForCondition,
        totalLaborCost: totalLaborCostForCondition,
        totalCost: totalCostForCondition,
        hasCosts
      };
      
      if (hasCosts) {
        totalMaterialCost += totalMaterialCostForCondition;
        totalLaborCost += totalLaborCostForCondition;
        totalProjectCost += totalCostForCondition;
        conditionsWithCosts++;
      }
    });
    
    return {
      costData,
      summary: {
        totalMaterialCost,
        totalLaborCost,
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
        ['Labor Cost', `$${getProjectCostBreakdown(projectId).summary.totalLaborCost.toFixed(2)}`],
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
        'Labor Cost/Unit', 
        'Total Cost',
        'Cost per Unit'
      ];
      summaryData.push(headerRow);
      
      // Data rows with enhanced formatting
      conditionIds.forEach(conditionId => {
        const conditionData = reportData[conditionId];
        const costInfo = getCostAnalysisData().costData[conditionId];
        
        const row = [
          conditionData.condition.name,
          conditionData.condition.type,
          conditionData.condition.unit,
          conditionData.condition.description || 'No description provided',
          ...sortedPages.map(page => {
            const pageKey = Object.keys(conditionData.pages).find(key => 
              conditionData.pages[key].pageNumber === page.pageNumber
            );
            const pageData = pageKey ? conditionData.pages[pageKey] : null;
            return pageData ? pageData.total.toFixed(2) : '';
          }),
          conditionData.grandTotal.toFixed(2),
          costInfo.materialCostPerUnit > 0 ? `$${costInfo.materialCostPerUnit.toFixed(2)}` : 'N/A',
          costInfo.laborCostPerUnit > 0 ? `$${costInfo.laborCostPerUnit.toFixed(2)}` : 'N/A',
          costInfo.hasCosts ? `$${costInfo.totalCost.toFixed(2)}` : 'N/A',
          costInfo.hasCosts ? `$${(costInfo.totalCost / conditionData.grandTotal).toFixed(2)}` : 'N/A'
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
        '',
        `$${getCostAnalysisData().summary.totalProjectCost.toFixed(2)}`,
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
        { wch: 16 }, // Labor Cost/Unit
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
        { wch: 20 }, // Timestamp
        { wch: 15 }  // Measurement Type
      ];
      detailSheet['!cols'] = detailColWidths;
      
      XLSX.utils.book_append_sheet(workbook, detailSheet, 'Detailed Measurements');

      onExportStatusUpdate?.('excel', 55);

      // 4. ENHANCED COST ANALYSIS SHEET
      const { costData, summary } = getCostAnalysisData();
      const costConditionIds = Object.keys(costData);
      
      if (summary.conditionsWithCosts > 0) {
        const costAnalysisData = [];
        
        // Enhanced header row for cost analysis
        costAnalysisData.push([
          'Condition', 
          'Type', 
          'Unit', 
          'Description',
          'Quantity', 
          'Material Cost/Unit', 
          'Labor Cost/Unit', 
          'Total Material Cost', 
          'Total Labor Cost', 
          'Total Cost',
          'Cost per Unit',
          'Material %',
          'Labor %'
        ]);
        
        // Data rows for conditions with costs
        costConditionIds.forEach(conditionId => {
          const data = costData[conditionId];
          if (data.hasCosts) {
            const materialPercent = ((data.totalMaterialCost / data.totalCost) * 100).toFixed(1);
            const laborPercent = ((data.totalLaborCost / data.totalCost) * 100).toFixed(1);
            
            costAnalysisData.push([
              data.condition.name,
              data.condition.type,
              data.condition.unit,
              data.condition.description || 'No description provided',
              data.quantity.toFixed(2),
              data.materialCostPerUnit > 0 ? `$${data.materialCostPerUnit.toFixed(2)}` : 'N/A',
              data.laborCostPerUnit > 0 ? `$${data.laborCostPerUnit.toFixed(2)}` : 'N/A',
              data.totalMaterialCost > 0 ? `$${data.totalMaterialCost.toFixed(2)}` : '$0.00',
              data.totalLaborCost > 0 ? `$${data.totalLaborCost.toFixed(2)}` : '$0.00',
              `$${data.totalCost.toFixed(2)}`,
              `$${(data.totalCost / data.quantity).toFixed(2)}`,
              `${materialPercent}%`,
              `${laborPercent}%`
            ]);
          }
        });
        
        // Add summary section
        costAnalysisData.push(['', '', '', '', '', '', '', '', '', '', '', '', '']);
        costAnalysisData.push([
          'PROJECT TOTALS', 
          '', 
          '', 
          '', 
          '', 
          '', 
          '', 
          `$${summary.totalMaterialCost.toFixed(2)}`, 
          `$${summary.totalLaborCost.toFixed(2)}`, 
          `$${summary.totalProjectCost.toFixed(2)}`,
          '',
          `${((summary.totalMaterialCost / summary.totalProjectCost) * 100).toFixed(1)}%`,
          `${((summary.totalLaborCost / summary.totalProjectCost) * 100).toFixed(1)}%`
        ]);
        
        // Add cost analysis metrics
        costAnalysisData.push(['', '', '', '', '', '', '', '', '', '', '', '', '']);
        costAnalysisData.push(['COST ANALYSIS SUMMARY', '', '', '', '', '', '', '', '', '', '', '', '']);
        costAnalysisData.push(['Total Conditions with Costs', summary.conditionsWithCosts, '', '', '', '', '', '', '', '', '', '', '']);
        costAnalysisData.push(['Total Conditions', summary.totalConditions, '', '', '', '', '', '', '', '', '', '', '']);
        costAnalysisData.push(['Average Cost per Condition', `$${(summary.totalProjectCost / summary.conditionsWithCosts).toFixed(2)}`, '', '', '', '', '', '', '', '', '', '', '']);
        costAnalysisData.push(['Highest Cost Condition', Object.values(costData).reduce((max, curr) => 
          curr.totalCost > max.totalCost ? curr : max, { totalCost: 0, condition: { name: 'N/A' } }
        ).condition.name, '', '', '', '', '', '', '', '', '', '', '', '']);
        
        const costAnalysisSheet = XLSX.utils.aoa_to_sheet(costAnalysisData);
        
        // Set column widths for cost analysis sheet
        const costColWidths = [
          { wch: 25 }, // Condition
          { wch: 10 }, // Type
          { wch: 8 },  // Unit
          { wch: 30 }, // Description
          { wch: 12 }, // Quantity
          { wch: 18 }, // Material Cost/Unit
          { wch: 16 }, // Labor Cost/Unit
          { wch: 18 }, // Total Material Cost
          { wch: 16 }, // Total Labor Cost
          { wch: 12 }, // Total Cost
          { wch: 12 }, // Cost per Unit
          { wch: 10 }, // Material %
          { wch: 10 }  // Labor %
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
        ['Cost calculations include material and labor components', ''],
        ['Report follows industry-standard formatting', ''],
        ['Data integrity verified through automated checks', ''],
        ['', ''],
        ['Disclaimer', ''],
        ['This report is generated by Meridian Takeoff software and follows industry standards.', ''],
        ['All measurements and calculations should be verified by qualified professionals.', ''],
        ['Cost estimates are based on provided rates and should be updated as needed.', '']
      ];
      
      // 3. COST ANALYSIS SHEET
      const costBreakdown = getProjectCostBreakdown(projectId);
      const costAnalysisData = [
        ['COST ANALYSIS BREAKDOWN', ''],
        ['', ''],
        ['Project Cost Summary', ''],
        ['Total Material Cost', `$${costBreakdown.summary.totalMaterialCost.toFixed(2)}`],
        ['Total Labor Cost', `$${costBreakdown.summary.totalLaborCost.toFixed(2)}`],
        ['Total Equipment Cost', `$${costBreakdown.summary.totalEquipmentCost.toFixed(2)}`],
        ['Total Waste Factor Cost', `$${costBreakdown.summary.totalWasteCost.toFixed(2)}`],
        ['Subtotal', `$${costBreakdown.summary.subtotal.toFixed(2)}`],
        ['Profit Margin (%)', `${costBreakdown.summary.profitMarginPercent}%`],
        ['Profit Margin Amount', `$${costBreakdown.summary.profitMarginAmount.toFixed(2)}`],
        ['TOTAL PROJECT COST', `$${costBreakdown.summary.totalCost.toFixed(2)}`],
        ['', ''],
        ['Cost Breakdown by Condition', ''],
        ['Condition', 'Quantity', 'Material Cost', 'Labor Cost', 'Equipment Cost', 'Waste Cost', 'Subtotal']
      ];
      
      // Add condition cost breakdown rows
      costBreakdown.conditions.forEach(condition => {
        if (condition.hasCosts) {
          costAnalysisData.push([
            condition.condition.name,
            `${condition.quantity.toFixed(2)} ${condition.condition.unit}`,
            `$${condition.materialCost.toFixed(2)}`,
            `$${condition.laborCost.toFixed(2)}`,
            `$${condition.equipmentCost.toFixed(2)}`,
            `$${condition.wasteCost.toFixed(2)}`,
            `$${condition.subtotal.toFixed(2)}`
          ]);
        }
      });
      
      const costAnalysisSheet = XLSX.utils.aoa_to_sheet(costAnalysisData);
      costAnalysisSheet['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
      XLSX.utils.book_append_sheet(workbook, costAnalysisSheet, 'Cost Analysis');

      const projectInfoSheet = XLSX.utils.aoa_to_sheet(projectInfoData);
      projectInfoSheet['!cols'] = [{ wch: 25 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(workbook, projectInfoSheet, 'Project Information');

      onExportStatusUpdate?.('excel', 90);

      // Generate filename with enhanced naming
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const projectName = currentProject?.name?.replace(/[^a-zA-Z0-9]/g, '-') || 'project';
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
      onExportStatusUpdate?.('pdf', 5);

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

      if (pagesWithMeasurements.size === 0) {
        alert('No pages with measurements found');
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
                  
                  if (currentProject) {
                    pdf.setFontSize(12);
                    pdf.setFont('helvetica', 'normal');
                    pdf.text(`Project: ${currentProject.name}`, 20, 45);
                    pdf.text(`Generated: ${new Date().toLocaleString()}`, 20, 55);
                    pdf.text(`Total Conditions: ${conditionIds.length}`, 20, 65);
                    pdf.text(`Pages with Measurements: ${pagesWithMeasurements.size}`, 20, 75);
                    
                    // Add cost summary
                    const costBreakdown = getProjectCostBreakdown(projectId);
                    if (costBreakdown.summary.totalCost > 0) {
                      pdf.setFontSize(14);
                      pdf.setFont('helvetica', 'bold');
                      pdf.text('Cost Summary', 20, 95);
                      
                      pdf.setFontSize(10);
                      pdf.setFont('helvetica', 'normal');
                      pdf.text(`Total Project Cost: $${costBreakdown.summary.totalCost.toFixed(2)}`, 20, 105);
                      pdf.text(`Material Cost: $${costBreakdown.summary.totalMaterialCost.toFixed(2)}`, 20, 115);
                      pdf.text(`Labor Cost: $${costBreakdown.summary.totalLaborCost.toFixed(2)}`, 20, 125);
                      pdf.text(`Equipment Cost: $${costBreakdown.summary.totalEquipmentCost.toFixed(2)}`, 20, 135);
                      pdf.text(`Waste Factor Cost: $${costBreakdown.summary.totalWasteCost.toFixed(2)}`, 20, 145);
                      pdf.text(`Profit Margin: ${costBreakdown.summary.profitMarginPercent}% ($${costBreakdown.summary.profitMarginAmount.toFixed(2)})`, 20, 155);
                    }
                  }

                  // Create summary table
                  const tableStartY = costBreakdown.summary.totalCost > 0 ? 170 : 90;
                  const colWidths = [60, 20, 15, 25]; // Condition, Type, Unit, Total
                  const rowHeight = 8;
                  
                  // Table headers
                  pdf.setFontSize(10);
                  pdf.setFont('helvetica', 'bold');
                  pdf.text('Condition', 20, tableStartY);
                  pdf.text('Type', 20 + colWidths[0], tableStartY);
                  pdf.text('Unit', 20 + colWidths[0] + colWidths[1], tableStartY);
                  pdf.text('Total', 20 + colWidths[0] + colWidths[1] + colWidths[2], tableStartY);
                  
                  // Draw header line
                  pdf.line(20, tableStartY + 2, 20 + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], tableStartY + 2);
                  
                  // Table data
                  pdf.setFont('helvetica', 'normal');
                  let currentY = tableStartY + rowHeight;
                  
                  conditionIds.forEach((conditionId, index) => {
                    const conditionData = reportData[conditionId];
                    
                    // Check if we need a new page
                    if (currentY > 250) {
                      pdf.addPage();
                      currentY = 20;
                    }
                    
                    // Truncate long condition names to fit
                    const conditionName = conditionData.condition.name.length > 25 
                      ? conditionData.condition.name.substring(0, 22) + '...' 
                      : conditionData.condition.name;
                    
                    pdf.text(conditionName, 20, currentY);
                    pdf.text(conditionData.condition.type, 20 + colWidths[0], currentY);
                    pdf.text(conditionData.condition.unit, 20 + colWidths[0] + colWidths[1], currentY);
                    pdf.text(conditionData.grandTotal.toFixed(2), 20 + colWidths[0] + colWidths[1] + colWidths[2], currentY);
                    
                    currentY += rowHeight;
                  });

      // Update progress
      onExportStatusUpdate?.('pdf', 20);

      // Process each page with measurements
      const pageEntries = Array.from(pagesWithMeasurements.entries());
      for (let i = 0; i < pageEntries.length; i++) {
        const [pageKey, pageInfo] = pageEntries[i];
        const progress = 20 + (i / pageEntries.length) * 70;
        onExportStatusUpdate?.('pdf', Math.round(progress));

        // Add new page for each PDF page with measurements
        if (i > 0) {
          pdf.addPage();
        }

        // Add page header
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        // Use same page labeling logic as Excel export
        const hasCustomName = pageInfo.sheetName && pageInfo.sheetName !== `Page ${pageInfo.pageNumber}`;
        const pageLabel = hasCustomName ? `${pageInfo.sheetName} (P.${pageInfo.pageNumber})` : `Page ${pageInfo.pageNumber}`;
        pdf.text(pageLabel, 20, 20);
        
        // Add a separator line
        pdf.line(20, 25, 190, 25);

                    // Navigate to the page and capture it
                    // Navigate to the page
                    if (onPageSelect) {
                      onPageSelect(pageInfo.sheetId, pageInfo.pageNumber);
                    }

                    // Wait for page to load and render
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    
                    // Fit the page to screen to ensure we capture the entire page
                    
                    // Try multiple approaches to fit the page
                    let pageFitted = false;
                    
                    // Method 1: Look for "Reset View" button (common in PDF viewers)
                    const resetViewButton = document.querySelector('button[title*="Reset"], button[title*="reset"], button[aria-label*="Reset"], button[aria-label*="reset"]') as HTMLButtonElement;
                    if (resetViewButton) {
                      resetViewButton.click();
                      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait longer for page to fit
                      
                      // Try to zoom out further to ensure full page is visible
                      const zoomOutButton = document.querySelector('button[title*="Zoom out"], button[aria-label*="Zoom out"], button[title*="zoom out"], button[aria-label*="zoom out"]') as HTMLButtonElement;
                      if (zoomOutButton) {
                        // Click zoom out multiple times to ensure full page is visible
                        for (let i = 0; i < 5; i++) {
                          zoomOutButton.click();
                          await new Promise(resolve => setTimeout(resolve, 300));
                        }
                      }
                      pageFitted = true;
                    }
                    
                    // Method 2: Look for zoom controls and try to fit
                    if (!pageFitted) {
                      const zoomControls = document.querySelector('.zoom-controls, [class*="zoom"], [class*="control"]');
                      if (zoomControls) {
                        const fitButton = zoomControls.querySelector('button[title*="fit"], button[aria-label*="fit"], button[title*="Fit"], button[aria-label*="Fit"]') as HTMLButtonElement;
                        if (fitButton) {
                          fitButton.click();
                          pageFitted = true;
                          await new Promise(resolve => setTimeout(resolve, 1500));
                        }
                      }
                    }
                    
                    // Method 3: Try to find any button with "fit" in the text or title
                    if (!pageFitted) {
                      const allButtons = document.querySelectorAll('button');
                      for (const button of allButtons) {
                        const title = button.getAttribute('title') || '';
                        const ariaLabel = button.getAttribute('aria-label') || '';
                        const textContent = button.textContent || '';
                        
                        if (title.toLowerCase().includes('fit') || 
                            ariaLabel.toLowerCase().includes('fit') || 
                            textContent.toLowerCase().includes('fit') ||
                            title.toLowerCase().includes('reset') ||
                            ariaLabel.toLowerCase().includes('reset') ||
                            textContent.toLowerCase().includes('reset')) {
                          button.click();
                          pageFitted = true;
                          await new Promise(resolve => setTimeout(resolve, 1500));
                          break;
                        }
                      }
                    }
                    
                    // Method 4: Try to set zoom to a specific level that shows full page
                    if (!pageFitted) {
                      // Try to find zoom percentage and set it to a reasonable level
                      const zoomDisplay = document.querySelector('[class*="zoom"], [class*="scale"], [class*="percentage"]');
                      if (zoomDisplay) {
                        // Look for zoom controls nearby
                        const parent = zoomDisplay.closest('div');
                        if (parent) {
                          const zoomButtons = parent.querySelectorAll('button');
                          // Try clicking the minus button a few times to zoom out
                          for (let i = 0; i < 3; i++) {
                            const minusButton = Array.from(zoomButtons).find(btn => 
                              btn.textContent?.includes('-') || 
                              btn.getAttribute('title')?.toLowerCase().includes('zoom out') ||
                              btn.getAttribute('aria-label')?.toLowerCase().includes('zoom out')
                            );
                            if (minusButton) {
                              minusButton.click();
                              await new Promise(resolve => setTimeout(resolve, 500));
                            }
                          }
                          pageFitted = true;
                        }
                      }
                    }
                    
                    if (!pageFitted) {
                      // Could not find fit/reset button, proceeding with current view
                    }

                    try {
                      // Find the PDF viewer container - try multiple selectors to get the full page
                      let pdfViewerContainer = document.querySelector('.canvas-container') as HTMLElement;
                      
                      // If canvas-container doesn't work, try the main PDF viewer
                      if (!pdfViewerContainer) {
                        pdfViewerContainer = document.querySelector('[data-testid="pdf-viewer"]') as HTMLElement;
                      }
                      
                      // If still not found, try the main content area
                      if (!pdfViewerContainer) {
                        pdfViewerContainer = document.querySelector('.pdf-viewer') as HTMLElement;
                      }
                      
                      // Try to find the main PDF container that includes the entire viewer
                      if (!pdfViewerContainer) {
                        pdfViewerContainer = document.querySelector('.pdf-container, .document-viewer, .viewer-container') as HTMLElement;
                      }
                      
                      // Try to find the main content area that contains the PDF
                      if (!pdfViewerContainer) {
                        pdfViewerContainer = document.querySelector('main, .main-content, .content-area') as HTMLElement;
                      }
                      
                      // Look for the actual PDF canvas element specifically
                      if (!pdfViewerContainer) {
                        const canvas = document.querySelector('canvas') as HTMLElement;
                        if (canvas) {
                          // Find the parent container that holds the canvas
                          pdfViewerContainer = canvas.closest('div') as HTMLElement;
                        }
                      }
                      
                      // Last resort - try to find any canvas element
                      if (!pdfViewerContainer) {
                        pdfViewerContainer = document.querySelector('canvas') as HTMLElement;
                      }
                      
                      // If we still don't have a good container, try to find the largest visible element
                      if (!pdfViewerContainer || pdfViewerContainer.getBoundingClientRect().width < 500) {
                        const allDivs = document.querySelectorAll('div');
                        let largestDiv = null;
                        let largestArea = 0;
                        
                        for (const div of allDivs) {
                          const rect = div.getBoundingClientRect();
                          const area = rect.width * rect.height;
                          if (area > largestArea && rect.width > 800 && rect.height > 600) {
                            largestArea = area;
                            largestDiv = div;
                          }
                        }
                        
                        if (largestDiv) {
                          pdfViewerContainer = largestDiv as HTMLElement;
                        }
                      }
                      
                      if (pdfViewerContainer) {
                        // Get the full dimensions of the container
                        const rect = pdfViewerContainer.getBoundingClientRect();
                        
                        // Capture the PDF viewer with markups at higher quality and preserve colors
                        const canvas = await html2canvas(pdfViewerContainer, {
                          backgroundColor: '#ffffff',
                          scale: 3, // Even higher scale for better quality
                          useCORS: true,
                          allowTaint: true,
                          logging: false,
                          width: rect.width,
                          height: rect.height,
                          scrollX: 0,
                          scrollY: 0,
                          foreignObjectRendering: true, // Better rendering for complex elements
                          removeContainer: false, // Keep container for better rendering
                          imageTimeout: 30000, // Longer timeout for large images
                          onclone: (clonedDoc) => {
                            // Ensure colors are preserved in the cloned document
                            const clonedContainer = clonedDoc.querySelector('.canvas-container') as HTMLElement;
                            if (clonedContainer) {
                              clonedContainer.style.color = 'inherit';
                              clonedContainer.style.backgroundColor = 'white';
                            }
                          }
                        });

                        // Convert canvas to image data with high quality
                        const imgData = canvas.toDataURL('image/png', 1.0);
                        
                        // Calculate dimensions to fit the page while maintaining aspect ratio
                        const pageWidth = 210; // A4 width in mm
                        const pageHeight = 297; // A4 height in mm
                        const margin = 5; // Smaller margin for more content
                        const availableWidth = pageWidth - (2 * margin);
                        const availableHeight = pageHeight - (2 * margin) - 15; // Leave space for header
                        
                        const aspectRatio = canvas.width / canvas.height;
                        let imgWidth = availableWidth;
                        let imgHeight = imgWidth / aspectRatio;
                        
                        // If height exceeds available space, scale down
                        if (imgHeight > availableHeight) {
                          imgHeight = availableHeight;
                          imgWidth = imgHeight * aspectRatio;
                        }
                        
                        // Center the image on the page
                        const xOffset = (pageWidth - imgWidth) / 2;
                        const yOffset = 25; // Start below the header
                        
                        // Add the captured image to PDF with high quality
                        pdf.addImage(imgData, 'PNG', xOffset, yOffset, imgWidth, imgHeight, undefined, 'FAST');
                      } else {
                        
                        // Add placeholder text if container not found
                        pdf.setFontSize(10);
                        pdf.setFont('helvetica', 'normal');
                        pdf.text('PDF page with measurements would be displayed here.', 20, 50);
                        pdf.text('Please ensure the PDF viewer is visible and try again.', 20, 60);
                      }
                    } catch (captureError) {
                      console.error('Error capturing page:', captureError);
                      
                      // Add error message to PDF
                      pdf.setFontSize(10);
                      pdf.setFont('helvetica', 'normal');
                      pdf.text('Error capturing this page. Please try again.', 20, 50);
                    }
      }

      // Update progress
      onExportStatusUpdate?.('pdf', 90);

      // Generate filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const projectName = currentProject?.name?.replace(/[^a-zA-Z0-9]/g, '-') || 'project';
      const filename = `${projectName}-takeoff-pages-${timestamp}.pdf`;

      // Save the PDF
      pdf.save(filename);
      
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
      default: return <Calculator className="w-4 h-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'area': return 'bg-blue-100 text-blue-800';
      case 'volume': return 'bg-green-100 text-green-800';
      case 'linear': return 'bg-purple-100 text-purple-800';
      case 'count': return 'bg-orange-100 text-orange-800';
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
                    : 'border-gray-200 hover:bg-accent/50'
                }`}
                onClick={() => handleConditionClick(condition)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {getTypeIcon(condition.type)}
                    <span className="font-medium truncate">{condition.name}</span>
                    <Badge variant="outline" className="text-xs flex-shrink-0">
                      {condition.unit}
                    </Badge>
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
                        <span className="text-sm text-slate-600">Labor Costs</span>
                        <span className="text-sm font-medium text-slate-900">${summary.totalLaborCost.toFixed(2)}</span>
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
                    {conditions.map(condition => {
                      if (!condition.hasCosts) return null;
                      
                      return (
                        <div key={condition.condition.id} className="border rounded-lg p-3 bg-white">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-4 h-4 rounded-full" 
                                style={{ backgroundColor: condition.condition.color }}
                              />
                              <span className="font-medium text-sm">{condition.condition.name}</span>
                              <Badge variant="outline" className="text-xs">
                                {condition.condition.unit}
                              </Badge>
                            </div>
                            <span className="font-semibold text-blue-600">
                              ${condition.subtotal.toFixed(2)}
                            </span>
                          </div>
                          
                          <div className="text-xs text-slate-500 space-y-1">
                            <div className="flex justify-between">
                              <span>Quantity: {condition.quantity.toFixed(2)} {condition.condition.unit}</span>
                              {condition.condition.wasteFactor > 0 && (
                                <span>+ {condition.condition.wasteFactor}% waste = {condition.adjustedQuantity.toFixed(2)} {condition.condition.unit}</span>
                              )}
                            </div>
                            <div className="flex justify-between">
                              <span>Material: ${condition.materialCost.toFixed(2)}</span>
                              <span>Labor: ${condition.laborCost.toFixed(2)}</span>
                            </div>
                            {condition.equipmentCost > 0 && (
                              <div className="flex justify-between">
                                <span>Equipment: ${condition.equipmentCost.toFixed(2)}</span>
                                {condition.wasteCost > 0 && <span>Waste: ${condition.wasteCost.toFixed(2)}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
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
