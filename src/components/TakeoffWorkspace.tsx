import { useEffect, useState, useCallback } from 'react';

import { useParams, useNavigate } from 'react-router-dom';
import PDFViewer from './PDFViewer';
import { TakeoffSidebar } from './TakeoffSidebar';
import { SheetSidebar } from './SheetSidebar';
import { ChatTab } from './ChatTab';
import { SearchTab } from './SearchTab';
import { OCRProcessingDialog } from './OCRProcessingDialog';
import { ProfitMarginDialog } from './ProfitMarginDialog';
import { AITakeoffAgent } from './AITakeoffAgent';

import { useTakeoffStore } from '../store/useTakeoffStore';
import type { TakeoffCondition, Sheet, ProjectFile, PDFDocument } from '../types';
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { 
  ArrowLeft, 
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Upload,
  FileText,
  Search,
  MessageSquare,
  BarChart3,
  Pencil,
  Type,
  Square,
  Circle,
  ArrowRight,
  Palette,
  Trash2,
  ChevronDown,
  Bot,
  Highlighter
} from "lucide-react";
import { fileService, sheetService } from '../services/apiService';

// All interfaces now imported from shared types

export function TakeoffWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const isDev = import.meta.env.DEV;
  
  // Debug logging (dev only)
  if (isDev) {
    console.log('🔍 TakeoffWorkspace: projectId from useParams:', projectId);
    console.log('🔍 TakeoffWorkspace: current URL:', window.location.href);
  }
  
  
  const [selectedSheet, setSelectedSheet] = useState<Sheet | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedPageNumber, setSelectedPageNumber] = useState<number | null>(null);
  
  // Dialog states
  const [showProfitMarginDialog, setShowProfitMarginDialog] = useState(false);
  const [showAITakeoffAgent, setShowAITakeoffAgent] = useState(false);
  
  // Cut-out states
  const [cutoutMode, setCutoutMode] = useState(false);
  const [cutoutTargetConditionId, setCutoutTargetConditionId] = useState<string | null>(null);
  
  // Annotation states
  const [annotationTool, setAnnotationTool] = useState<'text' | 'freehand' | 'arrow' | 'rectangle' | 'circle' | null>(null);
  const [annotationColor, setAnnotationColor] = useState<string>('#FF0000');
  
  // Visual search states
  const [visualSearchMode, setVisualSearchMode] = useState(false);
  const [visualSearchCondition, setVisualSearchCondition] = useState<TakeoffCondition | null>(null);
  const [selectionBox, setSelectionBox] = useState<{x: number, y: number, width: number, height: number} | null>(null);
  
  // Store integration
  const { 
    setCurrentProject, 
    setSelectedCondition, 
    getSelectedCondition,
    getCurrentProject,
    getProjectTakeoffSummary,
    loadProjectConditions,
    loadProjectTakeoffMeasurements,
    setCalibration,
    getCalibration,
    clearPageAnnotations,
    setDocumentRotation,
    getDocumentRotation,
    setDocumentPage,
    getDocumentPage,
    setDocumentScale,
    getDocumentScale,
    setDocumentLocation,
    getDocumentLocation,
    getLastViewedDocumentId,
    setLastViewedDocumentId
  } = useTakeoffStore();
  
  const selectedCondition = getSelectedCondition();

  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  
  // Measurement state from PDFViewer
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [measurementType, setMeasurementType] = useState<string>('');
  const [isOrthoSnapping, setIsOrthoSnapping] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<'documents' | 'search' | 'ai-chat'>('documents');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [ocrSearchResults, setOcrSearchResults] = useState<any[]>([]);
  const [currentSearchQuery, setCurrentSearchQuery] = useState<string>('');
  const [currentPdfFile, setCurrentPdfFile] = useState<ProjectFile | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [uploading, setUploading] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<PDFDocument[]>([]);
  const [exportStatus, setExportStatus] = useState<{type: 'excel' | 'pdf' | null, progress: number}>({type: null, progress: 0});
  
  // PDF viewer controls state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  
  // Scale is now managed by the store
  
  // Current calibration state for the active document/page
  const getCurrentCalibration = () => {
    if (!currentPdfFile || !projectId) {
      return null;
    }
    const calibration = getCalibration(projectId, currentPdfFile.id);
    return calibration;
  };
  
  const currentCalibration = getCurrentCalibration();
  const isPageCalibrated = !!currentCalibration;
  const scaleFactor = currentCalibration?.scaleFactor || 1;
  const unit = currentCalibration?.unit || 'ft';

  // Handle measurement state changes from PDFViewer
  const handleMeasurementStateChange = (measuring: boolean, calibrating: boolean, type: string, orthoSnapping: boolean) => {
    setIsMeasuring(measuring);
    setIsCalibrating(calibrating);
    setMeasurementType(type);
    setIsOrthoSnapping(orthoSnapping);
  };

  useEffect(() => {
    async function loadFiles() {
      if (!projectId) {
        return;
      }
      try {
        const res = await fileService.getProjectFiles(projectId);
        const files = res.files || [];
        setProjectFiles(files);
        
        // Restore last viewed document if available
        if (files.length > 0) {
          const pdfFiles = files.filter((file: any) => file.mimetype === 'application/pdf');
          let target = pdfFiles[0];
          const lastViewedId = getLastViewedDocumentId?.();
          if (lastViewedId) {
            const match = pdfFiles.find((f: any) => f.id === lastViewedId);
            if (match) target = match;
          }
          if (target) {
            setCurrentPdfFile(target);
            setSelectedDocumentId(target.id);
            // Page restored in downstream effect from store
          }
        }
      } catch (e: any) {
        if (isDev) console.error('Error loading project files:', e);
      }
    }
    loadFiles();
  }, [projectId]);

  // Set current project in store and load its data
  useEffect(() => {
    if (projectId) {
      setCurrentProject(projectId);
      // Load measurements for this project (conditions will be loaded by TakeoffSidebar)
      loadProjectTakeoffMeasurements(projectId);
    }
  }, [projectId]); // Only depend on projectId to prevent infinite loops

  // Listen for profit margin dialog open event
  useEffect(() => {
    const handleOpenProfitMarginDialog = () => {
      setShowProfitMarginDialog(true);
    };

    window.addEventListener('openProjectSettings', handleOpenProfitMarginDialog);
    return () => {
      window.removeEventListener('openProjectSettings', handleOpenProfitMarginDialog);
    };
  }, []);

  const handleConditionSelect = (condition: TakeoffCondition | null) => {
    if (condition === null) {
      setSelectedCondition(null);
      // Also clear in the store
      useTakeoffStore.getState().setSelectedCondition(null);
      setVisualSearchMode(false);
      setVisualSearchCondition(null);
    } else {
      setSelectedCondition(condition.id);
      // Also set in the store
      useTakeoffStore.getState().setSelectedCondition(condition.id);
      
      // Check if this is a visual search condition
      if (condition.type === 'visual-search') {
        setVisualSearchMode(true);
        setVisualSearchCondition(condition);
      } else {
        setVisualSearchMode(false);
        setVisualSearchCondition(null);
      }
    }
  };

  // Global Spacebar handler to deselect current condition
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSpace = event.code === 'Space' || event.key === ' ';
      if (!isSpace) return;

      const currentlySelected = getSelectedCondition();
      if (currentlySelected) {
        event.preventDefault();
        handleConditionSelect(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [getSelectedCondition]);

  const handleToolSelect = (tool: string) => {
    // Tool selection handled by PDF viewer
  };

  const handleVisualSearchComplete = async (selectionBox: {x: number, y: number, width: number, height: number}) => {
    if (visualSearchCondition && currentPdfFile && selectedSheet && projectId) {
      if (isDev) console.log('Visual search selection completed:', selectionBox);
      
      try {
        // Import the visual search service
        const { visualSearchService } = await import('../services/visualSearchService');
        
        // Complete the visual search workflow
        const result = await visualSearchService.completeSearch(
          visualSearchCondition.id,
          currentPdfFile.id,
          selectedSheet.pageNumber,
          selectionBox,
          projectId,
          selectedSheet.id,
          {
            confidenceThreshold: visualSearchCondition.searchThreshold || 0.7,
            maxMatches: 100
          }
        );
        
        if (isDev) console.log(`✅ Visual search complete: ${result.measurementsCreated} matches found and marked`);
        
        // Refresh the takeoff measurements to show the new count measurements
        await loadProjectTakeoffMeasurements(projectId);
        
        // Exit visual search mode
        setVisualSearchMode(false);
        setVisualSearchCondition(null);
        setSelectionBox(null);
        
      } catch (error) {
        if (isDev) console.error('❌ Visual search failed:', error);
        alert('Visual search failed. Please try again.');
      }
    }
  };

  const rotatePage = (direction: 'clockwise' | 'counterclockwise') => {
    const rotationStep = direction === 'clockwise' ? 90 : -90;
    const newRotation = (rotation + rotationStep) % 360;
    handleRotationChange(newRotation);
  };

  const handleSheetSelect = (sheet: Sheet) => {
    setSelectedSheet(sheet);
    
    // Find the corresponding PDF file and set it as current
    const selectedFile = projectFiles.find(file => file.id === sheet.id);
    if (selectedFile) {
      setCurrentPdfFile(selectedFile);
      
      // Restore scale, rotation, page, and location for this document if they exist
      const savedScale = getDocumentScale(selectedFile.id);
      const savedRotation = getDocumentRotation(selectedFile.id);
      const savedPage = getDocumentPage(selectedFile.id);
      const savedLocation = getDocumentLocation(selectedFile.id);
      setScale(savedScale);
      setRotation(savedRotation);
      setCurrentPage(savedPage);
      
      // Restore scroll position after a short delay
      if (savedLocation.x !== 0 || savedLocation.y !== 0) {
        setTimeout(() => {
          if ((window as any).restoreScrollPosition) {
            (window as any).restoreScrollPosition(savedLocation.x, savedLocation.y);
          }
        }, 200);
      }
    }
  };

  // Enhanced page selection handler
  const handlePageSelect = (documentId: string, pageNumber: number) => {
    setSelectedDocumentId(documentId);
    setSelectedPageNumber(pageNumber);
    
    // Find the corresponding PDF file and set it as current
    const selectedFile = projectFiles.find(file => file.id === documentId);
    if (selectedFile) {
      setCurrentPdfFile(selectedFile);
      setCurrentPage(pageNumber);
      
      // Restore scale, rotation, and location for this document if they exist
      const savedScale = getDocumentScale(selectedFile.id);
      const savedRotation = getDocumentRotation(selectedFile.id);
      const savedLocation = getDocumentLocation(selectedFile.id);
      setScale(savedScale);
      setRotation(savedRotation);
      
      // Restore scroll position after a short delay
      if (savedLocation.x !== 0 || savedLocation.y !== 0) {
        setTimeout(() => {
          if ((window as any).restoreScrollPosition) {
            (window as any).restoreScrollPosition(savedLocation.x, savedLocation.y);
          }
        }, 200);
      }
    }
  };


  // OCR processing handler
  const [showOCRDialog, setShowOCRDialog] = useState(false);
  const [ocrDocumentId, setOcrDocumentId] = useState<string>('');
  const [ocrPageNumbers, setOcrPageNumbers] = useState<number[]>([]);
  const [ocrDocumentName, setOcrDocumentName] = useState<string>('');

  const handleOCRRequest = (documentId: string, pageNumbers?: number[]) => {
    // Find the document name
    const document = projectFiles.find(file => file.id === documentId);
    const documentName = document?.originalName || 'Unknown Document';
    
    setOcrDocumentId(documentId);
    setOcrPageNumbers(pageNumbers || []);
    setOcrDocumentName(documentName);
    setShowOCRDialog(true);
  };

  const handleSearchInDocument = (query: string) => {
    const mockResults = [
      `Found "${query}" in note at coordinates (150, 200)`,
      `Found "${query}" in dimension at coordinates (300, 350)`,
      `Found "${query}" in title block at coordinates (600, 50)`
    ];
    setSearchResults(mockResults);
  };

  const handleOcrSearchResults = (results: any[], query: string) => {
    setOcrSearchResults(results);
    setCurrentSearchQuery(query);
  };

  const handleDocumentsUpdate = (updatedDocuments: PDFDocument[]) => {
    setDocuments(updatedDocuments);
  };


  // Load project documents directly
  const loadProjectDocuments = useCallback(async () => {
    if (!projectId) return;
    
    try {
      const filesRes = await fileService.getProjectFiles(projectId);
      const files = filesRes.files || [];
      
      const pdfFiles = files.filter((file: any) => file.mimetype === 'application/pdf');
      
      const documents: PDFDocument[] = await Promise.all(
        pdfFiles.map(async (file: any) => {
          try {
            // Check if document has OCR data
            const { serverOcrService } = await import('../services/serverOcrService');
            const ocrData = await serverOcrService.getDocumentData(file.id, projectId);
            const hasOCRData = ocrData && ocrData.results.length > 0;
            
            // Get actual page count from OCR data or file metadata
            let totalPages = 1;
            if (ocrData && ocrData.results.length > 0) {
              // Use the highest page number from OCR data
              const pageNumbers = ocrData.results.map(r => r.pageNumber).filter(num => !isNaN(num) && num > 0);
              console.log(`Document ${file.originalName} OCR data:`, {
                resultsCount: ocrData.results.length,
                pageNumbers: pageNumbers,
                maxPage: pageNumbers.length > 0 ? Math.max(...pageNumbers) : 'none',
                sampleResults: ocrData.results.slice(0, 3).map(r => ({ pageNumber: r.pageNumber, textLength: r.text?.length || 0 }))
              });
              if (pageNumbers.length > 0) {
                totalPages = Math.max(...pageNumbers);
              }
            } else if (file.pageCount && !isNaN(file.pageCount) && file.pageCount > 0) {
              // Use page count from file metadata if available
              totalPages = file.pageCount;
              console.log(`Document ${file.originalName} using file metadata page count:`, file.pageCount);
            } else {
              console.log(`Document ${file.originalName} using default page count: 1 (no OCR data or file metadata)`);
            }
            
            // Ensure totalPages is always a valid number
            const finalPageCount = isNaN(totalPages) || totalPages <= 0 ? 1 : totalPages;
            
            return {
              id: file.id,
              name: file.originalName.replace('.pdf', ''),
              totalPages: finalPageCount,
              pages: [], // We don't need the full page data here
              isExpanded: false,
              ocrEnabled: hasOCRData
            };
          } catch (error) {
            console.error(`Error checking OCR status for ${file.originalName}:`, error);
            // Ensure page count is valid in error case too
            const errorPageCount = (file.pageCount && !isNaN(file.pageCount) && file.pageCount > 0) ? file.pageCount : 1;
            
            return {
              id: file.id,
              name: file.originalName.replace('.pdf', ''),
              totalPages: errorPageCount,
              pages: [],
              isExpanded: false,
              ocrEnabled: false
            };
          }
        })
      );
      
      setDocuments(documents);
    } catch (error) {
      console.error('Error loading project documents:', error);
    }
  }, [projectId]);

  // Load documents when project changes
  useEffect(() => {
    if (projectId) {
      loadProjectDocuments();
    }
  }, [projectId, loadProjectDocuments]);

  // Initialize rotation, page, scale, and location from store when currentPdfFile changes
  useEffect(() => {
    if (currentPdfFile) {
      const savedRotation = getDocumentRotation(currentPdfFile.id);
      const savedPage = getDocumentPage(currentPdfFile.id);
      const savedScale = getDocumentScale(currentPdfFile.id);
      const savedLocation = getDocumentLocation(currentPdfFile.id);
      
      if (isDev) console.log('🔄 Restoring document state:', {
        documentId: currentPdfFile.id,
        savedRotation,
        savedPage,
        savedScale,
        savedLocation
      });
      
      setRotation(savedRotation);
      setCurrentPage(savedPage);
      setScale(savedScale);
      
      // Scroll position will be restored when PDF is fully rendered via handlePDFRendered
    }
  }, [currentPdfFile, getDocumentRotation, getDocumentPage, getDocumentScale, getDocumentLocation]);

  const handleExportStatusUpdate = (type: 'excel' | 'pdf' | null, progress: number) => {
    setExportStatus({type, progress});
  };

  const handleCutoutMode = (conditionId: string | null) => {
    setCutoutMode(!!conditionId);
    setCutoutTargetConditionId(conditionId);
  };

  // PDF viewer control handlers
  const handlePageChange = (page: number) => {
    if (isDev) console.log('📄 Page change:', { from: currentPage, to: page, documentId: currentPdfFile?.id });
    setCurrentPage(page);
    // Save page to store for persistence
    if (currentPdfFile) {
      setDocumentPage(currentPdfFile.id, page);
      setLastViewedDocumentId?.(currentPdfFile.id);
      if (isDev) console.log('💾 Saved page to store:', { documentId: currentPdfFile.id, page });
    }
    // Calibration state is now managed per page, no need to reset
  };

  const handleScaleChange = (newScale: number) => {
    setScale(newScale);
    // Store scale for current document in the store
    if (currentPdfFile) {
      setDocumentScale(currentPdfFile.id, newScale);
    }
  };

  const handleRotationChange = (newRotation: number) => {
    setRotation(newRotation);
    // Store rotation for current document in the store
    if (currentPdfFile) {
      setDocumentRotation(currentPdfFile.id, newRotation);
    }
  };

  const handleLocationChange = (x: number, y: number) => {
    // Store location for current document in the store
    if (currentPdfFile) {
      setDocumentLocation(currentPdfFile.id, { x, y });
    }
  };

  const handlePDFRendered = () => {
    // Restore scroll position after PDF is fully rendered
    if (currentPdfFile) {
      const savedLocation = getDocumentLocation(currentPdfFile.id);
      if (savedLocation.x !== 0 || savedLocation.y !== 0) {
        if (isDev) console.log('🔄 Restoring scroll position after PDF render:', savedLocation);
        // Use a minimal delay to ensure the container is ready
        setTimeout(() => {
          if ((window as any).restoreScrollPosition) {
            (window as any).restoreScrollPosition(savedLocation.x, savedLocation.y);
          }
        }, 25);
      }
    }
  };

  const handleCalibrateScale = () => {
    // Trigger the PDF viewer's calibration dialog
    // If already calibrated, clear the current calibration first
    if (isPageCalibrated && currentPdfFile && projectId) {
      setCalibration(projectId, currentPdfFile.id, 1, 'ft');
    }
    
    // Use the global trigger function set up by the PDF viewer
    if ((window as any).triggerCalibration) {
      (window as any).triggerCalibration();
    }
  };


  const handleResetView = () => {
    // Trigger the PDF viewer's fit to window function
    // Use the global trigger function set up by the PDF viewer
    if ((window as any).triggerFitToWindow) {
      (window as any).triggerFitToWindow();
    } else {
      // Fallback to setting scale to 1 if fit to window is not available
      handleScaleChange(1);
    }
  };

  const handlePDFLoaded = (totalPages: number) => {
    setTotalPages(totalPages);
    // Don't reset page here - let the useEffect handle it from store
  };

  const handleCalibrationComplete = (isCalibrated: boolean, scaleFactor: number, unit: string) => {
    if (currentPdfFile && projectId) {
      setCalibration(projectId, currentPdfFile.id, scaleFactor, unit);
    }
  };

  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    
    if (!file || !projectId) {
      return;
    }
    
    // Check file size before uploading (50MB = 50 * 1024 * 1024 bytes)
    const maxSizeMB = 50;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      alert(`File too large! Maximum size is ${maxSizeMB}MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB.\n\nPlease contact your admin to increase the Supabase Storage file size limit.`);
      return;
    }
    
    try {
      setUploading(true);
      
      const uploadRes = await fileService.uploadPDF(file, projectId);
      
      // Refresh project files
      const filesRes = await fileService.getProjectFiles(projectId);
      const files = filesRes.files || [];
      setProjectFiles(files);
      
      // Set the newly uploaded file as current
      if (uploadRes.file) {
        setCurrentPdfFile(uploadRes.file);
      }
      
    } catch (error: any) {
      console.error('Upload failed:', error);
      
      // Extract error message from API response
      let errorMessage = 'Failed to upload PDF file.';
      
      if (error.response?.data) {
        const errorData = error.response.data;
        if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.error) {
          errorMessage = errorData.error;
        } else if (typeof errorData === 'string') {
          errorMessage = errorData;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      alert(`Upload Error: ${errorMessage}`);
    } finally {
      setUploading(false);
    }
  };

  const handleBackToProjects = () => {
    navigate('/app');
  };


  const storeCurrentProject = getCurrentProject();
  const currentProject = storeCurrentProject || {
    name: 'Tru Hilton', // Use actual project name instead of generic format
    client: 'ABC', // Use actual client name
    lastSaved: new Date().toLocaleString()
  };

  return (
    <div className="app-shell h-screen flex flex-col bg-background">
      {/* Top Navigation Bar */}
      <div className="flex items-center justify-between p-4 border-b bg-muted/30">
        {/* Left side - Navigation and Project Info */}
        <div className="flex items-center gap-6">
          <Button variant="ghost" onClick={handleBackToProjects} className="flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Projects
          </Button>
          
          <Separator orientation="vertical" className="h-8" />
          
        </div>

        {/* Center - PDF Controls */}
        <div className="flex items-center gap-4">
          {/* Navigation Controls - always visible */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1 || !currentPdfFile}
            >
              Previous
            </Button>
            <span className="px-3 py-1 bg-gray-100 rounded text-sm">
              {currentPdfFile ? `${currentPage} / ${totalPages}` : 'No PDF'}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages || !currentPdfFile}
            >
              Next
            </Button>
          </div>

          <Separator orientation="vertical" className="h-8" />

          {/* Scale Controls - only show when PDF is loaded */}
          {currentPdfFile && (
            <>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleScaleChange(Math.max(0.5, scale - 0.1))}
                >
                  -
                </Button>
                <span className="px-3 py-1 bg-gray-100 rounded text-sm min-w-[60px] text-center">
                  {Math.round(scale * 100)}%
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleScaleChange(Math.min(5, scale + 0.1))}
                >
                  +
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleResetView}
                >
                  Reset View
                </Button>
              </div>

              <Separator orientation="vertical" className="h-8" />

              {/* Rotation Controls */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => rotatePage('counterclockwise')}
                  title="Rotate counterclockwise"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <path d="M3 3v5h5"/>
                  </svg>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => rotatePage('clockwise')}
                  title="Rotate clockwise"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                    <path d="M21 3v5h-5"/>
                  </svg>
                </Button>
              </div>

              <Separator orientation="vertical" className="h-8" />
            </>
          )}

          {/* Calibration Controls - always visible */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={isPageCalibrated ? "default" : "secondary"}
              onClick={handleCalibrateScale}
              className={isPageCalibrated ? "bg-green-600 hover:bg-green-700 text-white" : "bg-orange-600 hover:bg-orange-700 text-white"}
            >
              {isPageCalibrated ? 'Recalibrate' : 'Calibrate Scale'}
            </Button>
          </div>

          <Separator orientation="vertical" className="h-8" />

          {/* AI Takeoff Button */}
          <Button
            size="sm"
            variant="outline"
            className="flex items-center gap-2"
            onClick={() => setShowAITakeoffAgent(true)}
          >
            <Bot className="w-4 h-4" />
            AI Takeoff
          </Button>

          <Separator orientation="vertical" className="h-8" />

          {/* Annotations Dropdown - always visible */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant={annotationTool ? "default" : "outline"}
                className={annotationTool ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}
              >
                <Pencil className="w-4 h-4 mr-1" />
                Annotations
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Annotation Tools</DropdownMenuLabel>
              <DropdownMenuSeparator />
              
              <DropdownMenuItem
                onClick={() => setAnnotationTool(annotationTool === 'text' ? null : 'text')}
                className={annotationTool === 'text' ? 'bg-accent' : ''}
              >
                <Type className="w-4 h-4 mr-2" />
                Text Annotation
              </DropdownMenuItem>
              
              <DropdownMenuItem
                onClick={() => setAnnotationTool(annotationTool === 'freehand' ? null : 'freehand')}
                className={annotationTool === 'freehand' ? 'bg-accent' : ''}
              >
                <Pencil className="w-4 h-4 mr-2" />
                Freehand Drawing
              </DropdownMenuItem>
              
              
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs">Shapes</DropdownMenuLabel>
              
              <DropdownMenuItem
                onClick={() => setAnnotationTool(annotationTool === 'arrow' ? null : 'arrow')}
                className={annotationTool === 'arrow' ? 'bg-accent' : ''}
              >
                <ArrowRight className="w-4 h-4 mr-2" />
                Arrow
              </DropdownMenuItem>
              
              <DropdownMenuItem
                onClick={() => setAnnotationTool(annotationTool === 'rectangle' ? null : 'rectangle')}
                className={annotationTool === 'rectangle' ? 'bg-accent' : ''}
              >
                <Square className="w-4 h-4 mr-2" />
                Rectangle
              </DropdownMenuItem>
              
              <DropdownMenuItem
                onClick={() => setAnnotationTool(annotationTool === 'circle' ? null : 'circle')}
                className={annotationTool === 'circle' ? 'bg-accent' : ''}
              >
                <Circle className="w-4 h-4 mr-2" />
                Circle
              </DropdownMenuItem>
              
              <DropdownMenuSeparator />
              
              <DropdownMenuItem className="flex items-center justify-between">
                <div className="flex items-center">
                  <Palette className="w-4 h-4 mr-2" />
                  Color
                </div>
                <input
                  type="color"
                  value={annotationColor}
                  onChange={(e) => setAnnotationColor(e.target.value)}
                  className="w-8 h-6 rounded cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                />
              </DropdownMenuItem>
              
              <DropdownMenuSeparator />
              
              <DropdownMenuItem 
                onClick={() => {
                  setAnnotationTool(null);
                  // Clear all annotations for current page
                  if (projectId && currentPdfFile?.id && selectedPageNumber) {
                    clearPageAnnotations(projectId, currentPdfFile.id, selectedPageNumber);
                  }
                }}
                className="text-red-600 focus:text-red-600"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Annotations
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Ortho Snapping Indicator */}
        {((isOrthoSnapping && isMeasuring) || (isCalibrating && isOrthoSnapping)) && (
          <div className="flex items-center gap-1 bg-green-600 text-white px-2 py-1 rounded text-xs">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h18"/>
              <path d="M12 3v18"/>
            </svg>
            <span>Ortho</span>
          </div>
        )}

        {/* Right side - Actions */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span>All changes saved</span>
          </div>
        </div>
      </div>

      {/* Main Content Area - Fixed height container */}
      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar Toggle */}
        <div className="flex">
          {leftSidebarOpen && (
                        <TakeoffSidebar
              projectId={storeCurrentProject?.id || projectId!}
              onConditionSelect={handleConditionSelect}
              onToolSelect={handleToolSelect}
              documents={documents}
              onPageSelect={handlePageSelect}
              onExportStatusUpdate={handleExportStatusUpdate}
              onCutoutMode={handleCutoutMode}
              cutoutMode={cutoutMode}
              cutoutTargetConditionId={cutoutTargetConditionId}
              selectedDocumentId={selectedDocumentId}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-full w-8 rounded-none border-r"
            onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
          >
            {leftSidebarOpen ? 
              <PanelLeftClose className="w-4 h-4" /> : 
              <PanelLeftOpen className="w-4 h-4" />
            }
          </Button>
        </div>

        {/* PDF Viewer - Fixed height container */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Visual Search Mode Indicator */}
          {visualSearchMode && visualSearchCondition && (
            <div className="bg-indigo-100 border-b border-indigo-200 p-3 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium text-indigo-900">
                  Visual Search Mode: {visualSearchCondition.name}
                </span>
              </div>
              <div className="text-xs text-indigo-700">
                Draw a box around a symbol to find and count similar items
              </div>
            </div>
          )}
          
          {currentPdfFile ? (
            <PDFViewer 
              file={currentPdfFile}
              className="h-full"
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              scale={scale}
              onScaleChange={handleScaleChange}
              rotation={rotation}
              onCalibrationRequest={handleCalibrateScale}
              isPageCalibrated={isPageCalibrated}
              scaleFactor={scaleFactor}
              unit={unit}
              onPDFLoaded={handlePDFLoaded}
              onCalibrationComplete={handleCalibrationComplete}
              searchResults={ocrSearchResults}
              currentSearchQuery={currentSearchQuery}
              cutoutMode={cutoutMode}
              cutoutTargetConditionId={cutoutTargetConditionId}
              onCutoutModeChange={handleCutoutMode}
              onMeasurementStateChange={handleMeasurementStateChange}
              onLocationChange={handleLocationChange}
              onPDFRendered={handlePDFRendered}
              annotationTool={annotationTool}
              annotationColor={annotationColor}
              onAnnotationToolChange={setAnnotationTool}
              visualSearchMode={visualSearchMode}
              visualSearchCondition={visualSearchCondition}
              onVisualSearchComplete={handleVisualSearchComplete}
            />
          ) : (
            <div className="flex items-center justify-center flex-1 bg-gray-100">
              <div className="text-gray-500">No PDF file selected</div>
            </div>
          )}
          {searchResults.length > 0 && (
            <div className="border-t bg-muted/30 p-3">
              <h3 className="font-medium mb-2">Search Results ({searchResults.length})</h3>
              <div className="space-y-1">
                {searchResults.map((result, index) => (
                  <div key={index} className="text-sm p-2 bg-background rounded border cursor-pointer hover:bg-accent">
                    {result}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar Toggle */}
        <div className="flex">
          <Button
            variant="ghost"
            size="sm"
            className="h-full w-8 rounded-none border-l"
            onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
          >
            {rightSidebarOpen ? 
              <PanelRightClose className="w-4 h-4" /> : 
              <PanelRightOpen className="w-4 h-4" />
            }
          </Button>
          {rightSidebarOpen && (
            <div className="w-96 bg-white border-l flex flex-col h-full">
              {/* Right Sidebar Tabs */}
              <div className="flex border-b">
                <button
                  className={`flex-1 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
                    rightSidebarTab === 'documents'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                  onClick={() => setRightSidebarTab('documents')}
                >
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="w-4 h-4" />
                    Documents
                  </div>
                </button>
                <button
                  className={`flex-1 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
                    rightSidebarTab === 'search'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                  onClick={() => setRightSidebarTab('search')}
                >
                  <div className="flex items-center justify-center gap-2">
                    <Search className="w-4 h-4" />
                    Search
                  </div>
                </button>
                <button
                  className={`flex-1 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
                    rightSidebarTab === 'ai-chat'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                  onClick={() => setRightSidebarTab('ai-chat')}
                >
                  <div className="flex items-center justify-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    AI Chat
                  </div>
                </button>
              </div>

              {/* Tab Content */}
              {rightSidebarTab === 'documents' && (
                <SheetSidebar 
                  projectId={storeCurrentProject?.id || projectId!}
                  documents={documents}
                  onPageSelect={handlePageSelect}
                  selectedDocumentId={selectedDocumentId || undefined}
                  selectedPageNumber={selectedPageNumber || undefined}
                  onOCRRequest={handleOCRRequest}
                  onOcrSearchResults={handleOcrSearchResults}
                  onDocumentsUpdate={handleDocumentsUpdate}
                  onPdfUpload={handlePdfUpload}
                  uploading={uploading}
                />
              )}
              
              {rightSidebarTab === 'search' && (
                <SearchTab
                  projectId={storeCurrentProject?.id || projectId!}
                  documents={documents}
                  onPageSelect={handlePageSelect}
                  selectedDocumentId={selectedDocumentId || undefined}
                  selectedPageNumber={selectedPageNumber || undefined}
                />
              )}
              
              {rightSidebarTab === 'ai-chat' && (
                <ChatTab
                  projectId={storeCurrentProject?.id || projectId!}
                  documents={documents}
                  onPageSelect={handlePageSelect}
                  onOCRRequest={handleOCRRequest}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30 text-sm">
        <div className="flex items-center gap-4">
          {selectedSheet && (
            <>
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <span>{selectedSheet.name}</span>
                <Badge variant="outline" className="text-xs">
                  Page {selectedSheet.pageNumber}
                </Badge>
              </div>
              <Separator orientation="vertical" className="h-4" />
            </>
          )}
          <span>Project: {currentProject.name}</span>
        </div>
        
        {/* Center - Minimal Status */}
        <div className="flex-1 flex justify-center">
          {selectedCondition ? (
            <div className="text-center text-sm text-gray-600">
              {selectedCondition.name} - {selectedCondition.type} takeoff
            </div>
          ) : (
            <div className="text-center text-sm text-gray-600">
              Select a condition to start drawing
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {exportStatus.type ? (
            <div className="flex items-center gap-3 bg-blue-50 px-3 py-2 rounded-lg border border-blue-200">
              <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-blue-700">
                  Exporting {exportStatus.type.toUpperCase()} report...
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-32 h-2 bg-blue-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all duration-300 ease-out rounded-full"
                      style={{ width: `${exportStatus.progress}%` }}
                    ></div>
                  </div>
                  <span className="text-xs text-blue-600 font-medium">
                    {exportStatus.progress}%
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <span className="text-sm text-gray-600">
              {uploading ? 'Uploading…' : 
               (isMeasuring || isCalibrating) ? (
                 <span className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm">
                   {isCalibrating ? 'Calibrating: Click two points to set scale' : `Measuring: ${measurementType} - Click to add points`}
                 </span>
               ) : 'Ready'
              }
            </span>
          )}
        </div>
      </div>

      {/* Export Progress Overlay */}
      {exportStatus.type && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-4 mb-4">
              <div className="animate-spin w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full"></div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Exporting {exportStatus.type.toUpperCase()} Report
                </h3>
                <p className="text-sm text-gray-600">
                  Please wait while we process your data...
                </p>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Progress</span>
                <span>{exportStatus.progress}%</span>
              </div>
              <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-500 ease-out rounded-full"
                  style={{ width: `${exportStatus.progress}%` }}
                ></div>
              </div>
            </div>
            
            {exportStatus.type === 'pdf' && exportStatus.progress > 20 && (
              <div className="mt-4 text-xs text-gray-500">
                <p>📄 Capturing PDF pages with measurements...</p>
                <p>This may take a moment for large projects.</p>
              </div>
            )}
          </div>
        </div>
      )}


      {/* OCR Processing Dialog */}
      <OCRProcessingDialog
        isOpen={showOCRDialog}
        onClose={() => {
          setShowOCRDialog(false);
          setOcrDocumentId('');
          setOcrPageNumbers([]);
          setOcrDocumentName('');
        }}
        documentId={ocrDocumentId}
        documentName={ocrDocumentName}
        pageNumbers={ocrPageNumbers}
        projectId={projectId!}
        onOCRComplete={(results) => {
          console.log('OCR processing completed:', results);
          setShowOCRDialog(false);
          
          // Reload documents to get updated OCR status
          loadProjectDocuments();
        }}
      />

      {/* Profit Margin Dialog */}
      {projectId && (
        <ProfitMarginDialog
          open={showProfitMarginDialog}
          onOpenChange={setShowProfitMarginDialog}
          projectId={projectId}
        />
      )}

      {/* AI Takeoff Agent */}
      <AITakeoffAgent
        isOpen={showAITakeoffAgent}
        onClose={() => setShowAITakeoffAgent(false)}
        projectId={projectId!}
        documents={documents}
        onPageSelect={handlePageSelect}
      />


    </div>
  );
}
