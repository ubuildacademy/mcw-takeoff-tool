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
import ExcelJS from 'exceljs';
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
    // Get ALL measurements for the project - no filtering by selectedDocumentId
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
      // Get ALL measurements for this condition - no filtering by selectedDocumentId
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

      // Create workbook with ExcelJS
      const workbook = new ExcelJS.Workbook();
      
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
          // Timestamps are stored as Unix milliseconds as strings (e.g., "1703123456789")
          // Convert string to number first, then create Date
          const timestampNum = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
          if (isNaN(timestampNum)) return 'N/A';
          const date = new Date(timestampNum);
          if (isNaN(date.getTime())) return 'N/A';
          return date.toLocaleString();
        } catch {
          return 'N/A';
        }
      };
      
      // Helper function to convert column number to Excel letter (1 = A, 27 = AA, etc.)
      const colIndexToLetter = (colNum: number): string => {
        let result = '';
        while (colNum > 0) {
          colNum--;
          result = String.fromCharCode(65 + (colNum % 26)) + result;
          colNum = Math.floor(colNum / 26);
        }
        return result;
      };
      
      // Define styles
      const headerStyle = {
        font: { bold: true, size: 11, color: { argb: 'FF1F2937' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } },
        border: {
          top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
        },
        alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }
      };
      
      const titleStyle = {
        font: { bold: true, size: 16, color: { argb: 'FF111827' } },
        alignment: { horizontal: 'left', vertical: 'middle', wrapText: true }
      };
      
      const sectionHeaderStyle = {
        font: { bold: true, size: 12, color: { argb: 'FF374151' } },
        alignment: { horizontal: 'left', vertical: 'middle' }
      };
      
      const totalsStyle = {
        font: { bold: true, size: 11, color: { argb: 'FF111827' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
        border: {
          top: { style: 'medium', color: { argb: 'FF9CA3AF' } },
          bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
        }
      };
      
      const dataEvenStyle = {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
        border: {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        }
      };
      
      const dataOddStyle = {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } },
        border: {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        }
      };
      
      // 1. EXECUTIVE SUMMARY SHEET - Professional Layout
      const executiveSheet = workbook.addWorksheet('Executive Summary');
      executiveSheet.getColumn(1).width = 28;
      executiveSheet.getColumn(2).width = 50;
      
      let row = 1;
      
      // Top margin spacing
      executiveSheet.getRow(row).height = 15;
      row++;
      
      // Title - Professional centered header
      executiveSheet.mergeCells(`A${row}:B${row}`);
      const titleCell = executiveSheet.getCell(`A${row}`);
      titleCell.value = 'MERIDIAN TAKEOFF - TAKEOFF REPORT';
      titleCell.style = {
        font: { bold: true, size: 18, color: { argb: 'FF1F2937' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
      };
      executiveSheet.getRow(row).height = 35;
      row += 2;
      
      // Executive Summary header with underline effect
      executiveSheet.mergeCells(`A${row}:B${row}`);
      const summaryHeaderCell = executiveSheet.getCell(`A${row}`);
      summaryHeaderCell.value = 'EXECUTIVE SUMMARY';
      summaryHeaderCell.style = {
        font: { bold: true, size: 14, color: { argb: 'FF111827' } },
        alignment: { horizontal: 'left', vertical: 'middle' },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } },
        border: {
          bottom: { style: 'medium', color: { argb: 'FF3B82F6' } }
        }
      };
      executiveSheet.getRow(row).height = 25;
      row += 2;
      
      // Project Information section - Professional table format
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
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        }
      };
      executiveSheet.getRow(row).height = 22;
      row++;
      
      const projectInfo = [
        ['Project Name', currentProject?.name || 'Unknown Project'],
        ['Client', currentProject?.client || 'N/A'],
        ['Location', currentProject?.location || 'N/A'],
        ['Project Type', currentProject?.projectType || 'N/A'],
        ['Description', currentProject?.description || 'N/A'],
        ['Contact Person', currentProject?.contactPerson || 'N/A'],
        ['Contact Email', currentProject?.contactEmail || 'N/A'],
        ['Contact Phone', currentProject?.contactPhone || 'N/A'],
        ['Estimated Value', currentProject?.estimatedValue ? `$${currentProject.estimatedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'N/A'],
        ['Start Date', formatDate(currentProject?.startDate)],
        ['Created', formatDate(currentProject?.createdAt)],
        ['Last Modified', formatDate(currentProject?.lastModified)],
        ['Report Date', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })],
        ['Generated Time', new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })]
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
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
          }
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
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
          }
        };
        
        executiveSheet.getRow(row).height = 20;
        row++;
      });
      
      row++;
      
      // Key Performance Indicators - Professional table format
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
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        }
      };
      executiveSheet.getRow(row).height = 22;
      row++;
      
      // Calculate unique pages with measurements across all conditions
      const uniquePagesSet = new Set<string>();
      conditionIds.forEach(id => {
        Object.keys(reportData[id].pages).forEach(pageKey => {
          uniquePagesSet.add(pageKey);
        });
      });
      
      const kpiData = [
        ['Total Conditions', conditionIds.length],
        ['Conditions with Costs', costBreakdown.summary.conditionsWithCosts],
        ['Total Pages with Measurements', uniquePagesSet.size],
        ['Total Measurements', conditionIds.reduce((sum, id) => sum + Object.values(reportData[id].pages).reduce((pageSum, page) => pageSum + page.measurements.length, 0), 0)]
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
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
          }
        };
        
        valueCell.value = value;
        // "Conditions with Costs" should be plain number, not currency
        if (label === 'Conditions with Costs') {
          valueCell.numFmt = '#,##0';
        }
        valueCell.style = {
          font: { size: 11, color: { argb: 'FF111827' }, bold: true },
          alignment: { horizontal: 'left', vertical: 'middle' },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF9FAFB' } },
          border: {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
          }
        };
        
        executiveSheet.getRow(row).height = 20;
        row++;
      });
      
      row++;
      
      // Cost Analysis Summary - Professional table format
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
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        }
      };
      executiveSheet.getRow(row).height = 22;
      row++;
      
      // Store row numbers for formula references
      const costStartRow = row;
      const materialCostRow = costStartRow;
      const equipmentCostRow = costStartRow + 1;
      const wasteCostRow = costStartRow + 2;
      const subtotalRow = costStartRow + 3;
      const profitMarginRow = costStartRow + 4;
      const totalCostRow = costStartRow + 5;
      
      const costInfo = [
        { label: 'Material Cost', formula: null, value: costBreakdown.summary.totalMaterialCost, row: materialCostRow },
        { label: 'Equipment Cost', formula: null, value: costBreakdown.summary.totalEquipmentCost, row: equipmentCostRow },
        { label: 'Waste Factor Cost', formula: null, value: costBreakdown.summary.totalWasteCost, row: wasteCostRow },
        { label: 'Subtotal', formula: `SUM(B${materialCostRow}:B${wasteCostRow})`, value: null, row: subtotalRow },
        { label: 'Profit Margin', formula: `B${subtotalRow}*${(costBreakdown.summary.profitMarginPercent || 0) / 100}`, value: costBreakdown.summary.profitMarginAmount, percent: costBreakdown.summary.profitMarginPercent, row: profitMarginRow },
        { label: 'Total Project Cost', formula: `B${subtotalRow}+B${profitMarginRow}`, value: null, isHighlighted: true, row: totalCostRow }
      ];
      
      costInfo.forEach((item, index) => {
        const isEven = index % 2 === 0;
        const isTotalRow = item.isHighlighted;
        const labelCell = executiveSheet.getCell(`A${row}`);
        const valueCell = executiveSheet.getCell(`B${row}`);
        
        // For Profit Margin, include percentage in the label
        const displayLabel = item.label === 'Profit Margin' && item.percent 
          ? `Profit Margin (${item.percent}%)`
          : item.label;
        
        labelCell.value = displayLabel;
        labelCell.style = {
          font: { size: 11, color: { argb: isTotalRow ? 'FF111827' : 'FF6B7280' }, bold: isTotalRow },
          alignment: { horizontal: 'left', vertical: 'middle' },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: isTotalRow ? 'FFE5E7EB' : (isEven ? 'FFFFFFFF' : 'FFF9FAFB') } },
          border: {
            top: { style: isTotalRow ? 'medium' : 'thin', color: { argb: isTotalRow ? 'FF3B82F6' : 'FFE5E7EB' } },
            bottom: { style: isTotalRow ? 'medium' : 'thin', color: { argb: isTotalRow ? 'FF3B82F6' : 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
          }
        };
        
        // Set value or formula - all currency values should be numeric
        if (item.formula) {
          valueCell.value = { formula: item.formula };
        } else if (item.value !== null && item.value !== undefined) {
          valueCell.value = item.value;
        } else {
          valueCell.value = 0;
        }
        
        valueCell.style = {
          font: { size: 11, color: { argb: isTotalRow ? 'FF111827' : 'FF111827' }, bold: isTotalRow || item.label === 'Profit Margin' },
          alignment: { horizontal: 'right', vertical: 'middle' },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: isTotalRow ? 'FFE5E7EB' : (isEven ? 'FFFFFFFF' : 'FFF9FAFB') } },
          border: {
            top: { style: isTotalRow ? 'medium' : 'thin', color: { argb: isTotalRow ? 'FF3B82F6' : 'FFE5E7EB' } },
            bottom: { style: isTotalRow ? 'medium' : 'thin', color: { argb: isTotalRow ? 'FF3B82F6' : 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
          }
        };
        
        // Apply currency formatting AFTER style to ensure it persists
        // Using Excel's standard currency format
        valueCell.numFmt = '$#,##0.00';
        
        executiveSheet.getRow(row).height = isTotalRow ? 25 : 20;
        row++;
      });
      
      // Bottom margin spacing
      executiveSheet.getRow(row).height = 15;
      
      // Add thick border around entire report
      const reportStartRow = 2; // After top margin
      const reportEndRow = row - 1; // Before bottom margin
      const reportStartCol = 1; // Column A
      const reportEndCol = 2; // Column B
      
      const thickBorderStyle = { style: 'thick' as const, color: { argb: 'FF1F2937' } };
      
      // Top border
      for (let col = reportStartCol; col <= reportEndCol; col++) {
        const cell = executiveSheet.getCell(reportStartRow, col);
        const existingBorder = cell.border || {};
        cell.border = {
          ...existingBorder,
          top: thickBorderStyle
        };
      }
      
      // Bottom border
      for (let col = reportStartCol; col <= reportEndCol; col++) {
        const cell = executiveSheet.getCell(reportEndRow, col);
        const existingBorder = cell.border || {};
        cell.border = {
          ...existingBorder,
          bottom: thickBorderStyle
        };
      }
      
      // Left border
      for (let r = reportStartRow; r <= reportEndRow; r++) {
        const cell = executiveSheet.getCell(r, reportStartCol);
        const existingBorder = cell.border || {};
        cell.border = {
          ...existingBorder,
          left: thickBorderStyle
        };
      }
      
      // Right border
      for (let r = reportStartRow; r <= reportEndRow; r++) {
        const cell = executiveSheet.getCell(r, reportEndCol);
        const existingBorder = cell.border || {};
        cell.border = {
          ...existingBorder,
          right: thickBorderStyle
        };
      }
      
      // Print settings - Professional layout
      executiveSheet.pageSetup = {
        margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
        printOptions: { gridLines: false, horizontalCentered: true, verticalCentered: false },
        paperSize: 9, // A4
        fitToPage: false,
        scale: 100
      };
      
      // Set print area to exclude excessive whitespace
      const lastRow = row - 1;
      executiveSheet.pageSetup.printArea = `A1:B${lastRow}`;

      onExportStatusUpdate?.('excel', 15);

      // 2. QUANTITIES SHEET (formerly Detailed Measurements, Quantity Summary removed)
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
      
      const detailSheet = workbook.addWorksheet('Quantities');
      
      // Set column widths - minimized for short text columns
      detailSheet.getColumn(1).width = 25; // Condition (A)
      detailSheet.getColumn(2).width = 12; // Quantity (minimized)
      detailSheet.getColumn(3).width = 6;  // Unit (minimized)
      detailSheet.getColumn(4).width = 15; // Area Value (SF)
      detailSheet.getColumn(5).width = 15; // Perimeter (LF)
      detailSheet.getColumn(6).width = 15; // Height (LF)
      detailSheet.getColumn(7).width = 12; // Sheet Number (minimized)
      detailSheet.getColumn(8).width = 35; // Sheet Name - increased width with wrap text
      detailSheet.getColumn(9).width = 10; // Page Reference (minimized)
      detailSheet.getColumn(10).width = 12; // Waste Factor (%) (minimized)
      detailSheet.getColumn(11).width = 15; // Waste Amount
      detailSheet.getColumn(12).width = 18; // Material Cost/Unit
      detailSheet.getColumn(13).width = 18; // Equipment Cost
      detailSheet.getColumn(14).width = 30; // Description
      detailSheet.getColumn(15).width = 20; // Timestamp (moved to end)
      
      // Header row - Type column removed, Value renamed to Quantity, Timestamp moved to end
      const detailHeaders = [
        'Condition', 
        'Quantity',
        'Unit',
        'Area Value (SF)',
        'Perimeter (LF)',
        'Height (LF)',
        'Sheet Number',
        'Sheet Name', 
        'Page Reference',
        'Waste Factor (%)',
        'Waste Amount',
        'Material Cost/Unit',
        'Equipment Cost',
        'Description',
        'Timestamp'
      ];
      
      const detailHeaderRowNum = 1;
      detailHeaders.forEach((header, colIdx) => {
        const cell = detailSheet.getCell(detailHeaderRowNum, colIdx + 1);
        cell.value = header;
        cell.style = headerStyle;
        // Enable wrap text for Sheet Name column (column 8, 0-indexed = 7)
        if (colIdx === 7) {
          cell.style = {
            ...headerStyle,
            alignment: { ...headerStyle.alignment, wrapText: true }
          };
        }
      });
      
      // Create hierarchical structure: Condition → Sheet → Measurements
      // Group measurements by condition, then by sheet
      const conditionGroups: Record<string, {
        condition: TakeoffCondition;
        sheets: Record<string, {
          pageData: { pageNumber: number; sheetName: string; sheetNumber: string | null; sheetId: string };
          measurements: Array<{ conditionId: string; condition: TakeoffCondition; pageData: any; measurement: any }>;
          total: number;
        }>;
        total: number;
      }> = {};
      
      allMeasurements.forEach(({ conditionId, condition, pageData, measurement }) => {
        if (!conditionGroups[conditionId]) {
          conditionGroups[conditionId] = {
            condition,
            sheets: {},
            total: 0
          };
        }
        
        const sheetKey = `${pageData.sheetId}-${pageData.pageNumber}`;
        if (!conditionGroups[conditionId].sheets[sheetKey]) {
          conditionGroups[conditionId].sheets[sheetKey] = {
            pageData,
            measurements: [],
            total: 0
          };
        }
        
        const value = measurement.netCalculatedValue || measurement.calculatedValue;
        conditionGroups[conditionId].sheets[sheetKey].measurements.push({ conditionId, condition, pageData, measurement });
        conditionGroups[conditionId].sheets[sheetKey].total += value;
        conditionGroups[conditionId].total += value;
      });
      
      // Data rows with hierarchical grouping
      let detailRowNum = 2;
      const conditionSummaryStyle = {
        font: { bold: true, size: 11, color: { argb: 'FF111827' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
        border: {
          top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
        }
      };
      
      // Helper function to write a data row
      const writeMeasurementRow = (rowNum: number, condition: TakeoffCondition, pageData: any, measurement: any) => {
        const rowStyle = rowNum % 2 === 0 ? dataEvenStyle : dataOddStyle;
        let col = 1;
        
        // Condition
        detailSheet.getCell(rowNum, col++).value = condition.name;
        
        // Quantity (renamed from Value)
        const quantityCell = detailSheet.getCell(rowNum, col++);
        quantityCell.value = measurement.netCalculatedValue || measurement.calculatedValue;
        quantityCell.numFmt = '#,##0.00';
        quantityCell.style = rowStyle;
        
        // Unit
        detailSheet.getCell(rowNum, col++).value = condition.unit;
        
        // Area Value (for linear conditions with height)
        const areaValueCell = detailSheet.getCell(rowNum, col++);
        if (measurement.areaValue) {
          areaValueCell.value = measurement.areaValue;
          areaValueCell.numFmt = '#,##0.00';
        } else if (condition.type === 'linear' && condition.includeHeight && condition.height) {
          const calculatedArea = (measurement.netCalculatedValue || measurement.calculatedValue) * condition.height;
          areaValueCell.value = calculatedArea;
          areaValueCell.numFmt = '#,##0.00';
        }
        areaValueCell.style = rowStyle;
        
        // Perimeter
        const perimeterCell = detailSheet.getCell(rowNum, col++);
        if (measurement.perimeterValue) {
          perimeterCell.value = measurement.perimeterValue;
          perimeterCell.numFmt = '#,##0.00';
        }
        perimeterCell.style = rowStyle;
        
        // Height (for linear conditions with height)
        const heightCell = detailSheet.getCell(rowNum, col++);
        if (condition.type === 'linear' && condition.includeHeight && condition.height) {
          heightCell.value = condition.height;
          heightCell.numFmt = '#,##0.00';
        }
        heightCell.style = rowStyle;
        
        // Sheet Number
        detailSheet.getCell(rowNum, col++).value = pageData.sheetNumber || '';
        
        // Sheet Name with wrap text
        const sheetNameCell = detailSheet.getCell(rowNum, col++);
        sheetNameCell.value = pageData.sheetName;
        sheetNameCell.style = {
          ...rowStyle,
          alignment: { ...rowStyle.alignment, wrapText: true, vertical: 'top' }
        };
        
        // Page Reference
        detailSheet.getCell(rowNum, col++).value = `P${pageData.pageNumber}`;
        
        // Waste Factor (%)
        const wasteFactorCell = detailSheet.getCell(rowNum, col++);
        wasteFactorCell.value = condition.wasteFactor || 0;
        wasteFactorCell.numFmt = '0.00"%"';
        wasteFactorCell.style = rowStyle;
        
        // Waste Amount (calculated waste quantity)
        const wasteAmountCell = detailSheet.getCell(rowNum, col++);
        const value = measurement.netCalculatedValue || measurement.calculatedValue;
        if (condition.wasteFactor && condition.wasteFactor > 0 && value > 0) {
          const wasteAmount = value * (condition.wasteFactor / 100);
          wasteAmountCell.value = wasteAmount;
          wasteAmountCell.numFmt = '#,##0.00';
        }
        wasteAmountCell.style = rowStyle;
        
        // Material Cost/Unit
        const materialCostCell = detailSheet.getCell(rowNum, col++);
        if (condition.materialCost) {
          materialCostCell.value = condition.materialCost;
          materialCostCell.numFmt = '"$"#,##0.00';
        }
        materialCostCell.style = rowStyle;
        
        // Equipment Cost
        const equipmentCostCell = detailSheet.getCell(rowNum, col++);
        if (condition.equipmentCost) {
          equipmentCostCell.value = condition.equipmentCost;
          equipmentCostCell.numFmt = '"$"#,##0.00';
        }
        equipmentCostCell.style = rowStyle;
        
        // Description - use condition description
        detailSheet.getCell(rowNum, col++).value = condition.description || '';
        
        // Timestamp - moved to end (last column)
        detailSheet.getCell(rowNum, col++).value = formatTimestamp(condition.createdAt);
        
        // Apply row style to all cells
        for (let c = 1; c <= detailHeaders.length; c++) {
          const cell = detailSheet.getCell(rowNum, c);
          if (!cell.style || Object.keys(cell.style).length === 0) {
            cell.style = rowStyle;
          }
        }
      };
      
      // Write simplified structure: Condition totals → Individual measurements
      Object.entries(conditionGroups).forEach(([conditionId, conditionGroup]) => {
        const condition = conditionGroup.condition;
        const conditionStartRow = detailRowNum;
        
        // Count measurements for this condition to determine formula range
        const measurementCount = Object.values(conditionGroup.sheets).reduce((sum, sheet) => sum + sheet.measurements.length, 0);
        const measurementEndRow = detailRowNum + measurementCount; // Will be updated after measurements are written
        
        // Condition summary row (Level 0) - make it clear it's a TOTAL
        let col = 1;
        detailSheet.getCell(detailRowNum, col++).value = `${condition.name} - TOTAL`;
        
        // Quantity - will be formula, set after measurements are written (Column B)
        const quantityCol = col++;
        detailSheet.getCell(detailRowNum, col++).value = condition.unit;
        
        // Area Value (SF) - formula if condition has includeHeight (Column D)
        const areaValueCol = col++;
        const areaValueCell = detailSheet.getCell(detailRowNum, areaValueCol);
        areaValueCell.style = conditionSummaryStyle;
        
        // Perimeter (LF) - formula if condition has includePerimeter (Column E)
        const perimeterCol = col++;
        const perimeterCell = detailSheet.getCell(detailRowNum, perimeterCol);
        perimeterCell.style = conditionSummaryStyle;
        
        // Height (LF) - show constant value if condition has includeHeight (Column F)
        const heightCol = col++;
        const heightCell = detailSheet.getCell(detailRowNum, heightCol);
        if (condition.type === 'linear' && condition.includeHeight && condition.height) {
          heightCell.value = condition.height;
          heightCell.numFmt = '#,##0.00';
        }
        heightCell.style = conditionSummaryStyle;
        
        // Sheet Number, Sheet Name, Page Reference (empty for totals)
        detailSheet.getCell(detailRowNum, col++).value = '';
        detailSheet.getCell(detailRowNum, col++).value = '';
        detailSheet.getCell(detailRowNum, col++).value = '';
        
        // Waste Factor (%)
        detailSheet.getCell(detailRowNum, col++).value = condition.wasteFactor || 0;
        
        // Waste Amount - will be formula, set after measurements are written
        const wasteAmountCol = col++;
        const wasteAmountCell = detailSheet.getCell(detailRowNum, wasteAmountCol);
        wasteAmountCell.style = conditionSummaryStyle;
        
        // Material Cost, Equipment Cost
        detailSheet.getCell(detailRowNum, col++).value = condition.materialCost || '';
        detailSheet.getCell(detailRowNum, col++).value = condition.equipmentCost || '';
        
        // Description (skip for totals)
        col++;
        
        // Timestamp (skip for totals, moved to end)
        col++;
        
        // Fill rest of row with condition summary style
        for (let c = 1; c <= detailHeaders.length; c++) {
          const cell = detailSheet.getCell(detailRowNum, c);
          if (!cell.style || Object.keys(cell.style).length === 0) {
            cell.style = conditionSummaryStyle;
          }
        }
        detailSheet.getRow(detailRowNum).outlineLevel = 0;
        detailRowNum++;
        
        // Individual measurement rows (Level 1) - no sheet summaries
        Object.entries(conditionGroup.sheets).forEach(([sheetKey, sheetData]) => {
          sheetData.measurements.forEach(({ measurement }) => {
            writeMeasurementRow(detailRowNum, condition, sheetData.pageData, measurement);
            detailSheet.getRow(detailRowNum).outlineLevel = 1;
            detailRowNum++;
          });
        });
        
        // Now set formulas for condition totals (after measurements are written)
        const measurementStartRow = conditionStartRow + 1;
        const measurementEndRowActual = detailRowNum - 1;
        
        // Quantity formula (Column B)
        const quantityColLetter = colIndexToLetter(quantityCol);
        const quantityFormulaCell = detailSheet.getCell(conditionStartRow, quantityCol);
        quantityFormulaCell.value = { formula: `SUM(${quantityColLetter}${measurementStartRow}:${quantityColLetter}${measurementEndRowActual})` };
        quantityFormulaCell.numFmt = '#,##0.00';
        quantityFormulaCell.style = conditionSummaryStyle;
        
        // Area Value formula (Column D) - only if condition has includeHeight
        if (condition.type === 'linear' && condition.includeHeight) {
          const areaValueColLetter = colIndexToLetter(areaValueCol);
          areaValueCell.value = { formula: `SUM(${areaValueColLetter}${measurementStartRow}:${areaValueColLetter}${measurementEndRowActual})` };
          areaValueCell.numFmt = '#,##0.00';
        }
        
        // Perimeter formula (Column E) - only if condition has includePerimeter
        if ((condition.type === 'area' || condition.type === 'volume') && condition.includePerimeter) {
          const perimeterColLetter = colIndexToLetter(perimeterCol);
          perimeterCell.value = { formula: `SUM(${perimeterColLetter}${measurementStartRow}:${perimeterColLetter}${measurementEndRowActual})` };
          perimeterCell.numFmt = '#,##0.00';
        }
        
        // Waste Amount formula - sum of waste amounts from measurements
        if (condition.wasteFactor && condition.wasteFactor > 0) {
          const wasteAmountColLetter = colIndexToLetter(wasteAmountCol);
          wasteAmountCell.value = { formula: `SUM(${wasteAmountColLetter}${measurementStartRow}:${wasteAmountColLetter}${measurementEndRowActual})` };
          wasteAmountCell.numFmt = '#,##0.00';
        }
      });
      
      // Enable grouping/outlining on the sheet
      detailSheet.properties.outlineLevelRow = 1;
      detailSheet.properties.summaryBelow = false;
      detailSheet.properties.summaryRight = false;
      
      
      // Freeze panes (freeze first row and first 3 columns: Condition, Quantity, Unit)
      // ySplit: 1 means freeze the first row (header row)
      // xSplit: 3 means freeze columns A through C
      detailSheet.views = [{
        state: 'frozen',
        xSplit: 3,
        ySplit: 1, // This freezes row 1 (header row)
        topLeftCell: 'D2',
        activeCell: 'D2'
      }];
      
      // No auto-filter (removed per user request)
      
      // Print settings
      detailSheet.pageSetup = {
        margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
        printOptions: { gridLines: true, horizontalCentered: false },
        repeatRows: '1:1'
      };
      
      onExportStatusUpdate?.('excel', 90);

      // Generate filename with enhanced naming
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const projectName = currentProject?.name?.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-') || 'project';
      const filename = `${projectName}-Professional-Takeoff-Report-${timestamp}.xlsx`;
      
      // Save file using ExcelJS
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
