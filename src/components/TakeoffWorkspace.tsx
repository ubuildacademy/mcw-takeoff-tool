import { useEffect, useState, useCallback, useMemo, useRef } from 'react';

import { useParams, useNavigate } from 'react-router-dom';
import PDFViewer from './PDFViewer';
import { TakeoffSidebar } from './TakeoffSidebar';
import { SheetSidebar } from './SheetSidebar';
import { ChatTab } from './ChatTab';
import { SearchTab } from './SearchTab';
import { OCRProcessingDialog } from './OCRProcessingDialog';
import { ProfitMarginDialog } from './ProfitMarginDialog';
import { CVTakeoffAgent } from './CVTakeoffAgent';

import { useTakeoffStore } from '../store/useTakeoffStore';
import type { TakeoffCondition, Sheet, ProjectFile, PDFDocument, Calibration, PDFPage } from '../types';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
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
  Highlighter,
  Scan
} from "lucide-react";
import { fileService, sheetService, ocrService, titleblockService } from '../services/apiService';

// All interfaces now imported from shared types

export function TakeoffWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const isDev = import.meta.env.DEV;
  
  // Debug logging (dev only)
  if (isDev) {
  }
  
  // Redirect if projectId is missing or invalid
  useEffect(() => {
    if (!projectId) {
      console.error('❌ TakeoffWorkspace: projectId is missing, redirecting to /app');
      navigate('/app', { replace: true });
      return;
    }
  }, [projectId, navigate]);
  
  const [selectedSheet, setSelectedSheet] = useState<Sheet | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedPageNumber, setSelectedPageNumber] = useState<number | null>(null);
  
  // Dialog states
  const [showProfitMarginDialog, setShowProfitMarginDialog] = useState(false);
  const [showCVTakeoffAgent, setShowCVTakeoffAgent] = useState(false);
  
  // Cut-out states
  const [cutoutMode, setCutoutMode] = useState(false);
  const [cutoutTargetConditionId, setCutoutTargetConditionId] = useState<string | null>(null);
  
  // Annotation states
  const [annotationTool, setAnnotationTool] = useState<'text' | 'arrow' | 'rectangle' | 'circle' | null>(null);
  const [annotationColor, setAnnotationColor] = useState<string>('#FF0000');
  
  // Visual search states
  const [visualSearchMode, setVisualSearchMode] = useState(false);
  const [visualSearchCondition, setVisualSearchCondition] = useState<TakeoffCondition | null>(null);
  const [selectionBox, setSelectionBox] = useState<{x: number, y: number, width: number, height: number} | null>(null);

  // Titleblock selection state (user-taught regions for sheet number/name)
  type TitleblockField = 'sheetNumber' | 'sheetName';
  type NormalizedBox = { x: number; y: number; width: number; height: number };
  const [titleblockSelectionMode, setTitleblockSelectionMode] = useState<TitleblockField | null>(null);
  const [titleblockSelectionContext, setTitleblockSelectionContext] = useState<{
    documentId: string;
    scope: 'single' | 'bulk';
  } | null>(null);
  const [pendingTitleblockConfig, setPendingTitleblockConfig] = useState<{
    sheetNumberField?: NormalizedBox;
    sheetNameField?: NormalizedBox;
  } | null>(null);
  
  // Titleblock extraction status
  const [titleblockExtractionStatus, setTitleblockExtractionStatus] = useState<{
    status: 'idle' | 'processing' | 'completed' | 'failed';
    currentDocument?: string;
    processedPages?: number;
    totalPages?: number;
    progress?: number;
    error?: string;
  } | null>(null);
  
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
    clearProjectCalibrations,
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
  
  // Subscribe to calibrations array to make calibration retrieval reactive
  const calibrations = useTakeoffStore((state) => state.calibrations);
  
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
  const [documentsLoading, setDocumentsLoading] = useState<boolean>(true);
  const [exportStatus, setExportStatus] = useState<{type: 'excel' | 'pdf' | null, progress: number}>({type: null, progress: 0});
  
  // OCR processing state - track active OCR jobs
  const [ocrJobs, setOcrJobs] = useState<Map<string, {
    documentId: string;
    documentName: string;
    progress: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    processedPages?: number;
    totalPages?: number;
  }>>(new Map());

  // Labeling job state - track active page labeling jobs
  const [labelingJob, setLabelingJob] = useState<{
    totalDocuments: number;
    completedDocuments: number;
    failedDocuments: number;
    progress: number;
    status: 'idle' | 'processing' | 'completed' | 'failed';
    currentDocument?: string;
    processedPages?: number;
    totalPages?: number;
    failedDocumentsList?: Array<{id: string, name: string}>;
  } | null>(null);
  
  // PDF viewer controls state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  
  // Scale is now managed by the store
  
  // Current calibration state for the active document/page - reactive to calibrations array changes
  // CRITICAL: Page-specific calibrations take precedence over document-level calibrations
  // This allows users to override document-level calibration for specific pages
  const currentCalibration = useMemo(() => {
    if (!currentPdfFile || !projectId) {
      return null;
    }
    // First try to get page-specific calibration (pageNumber is a number)
    // This takes precedence over document-level calibration
    const pageCalibration = calibrations.find(
      c => c.projectId === projectId && 
           c.sheetId === currentPdfFile.id && 
           c.pageNumber === currentPage &&
           c.pageNumber !== null &&
           c.pageNumber !== undefined
    );
    if (pageCalibration) {
      if (isDev) console.log('📏 Using page-specific calibration:', { pageNumber: currentPage, scaleFactor: pageCalibration.scaleFactor, unit: pageCalibration.unit });
      return pageCalibration;
    }
    
    // Fall back to document-level calibration (pageNumber is null/undefined)
    // This applies to all pages of the sheet unless overridden by page-specific calibration
    const docCalibration = calibrations.find(
      c => c.projectId === projectId && 
           c.sheetId === currentPdfFile.id && 
           (c.pageNumber === null || c.pageNumber === undefined)
    );
    if (docCalibration) {
      if (isDev) console.log('📏 Using document-level calibration:', { scaleFactor: docCalibration.scaleFactor, unit: docCalibration.unit });
    } else {
      if (isDev) console.log('⚠️ No calibration found for:', { projectId, sheetId: currentPdfFile.id, pageNumber: currentPage, totalCalibrations: calibrations.length });
    }
    return docCalibration || null;
  }, [calibrations, projectId, currentPdfFile?.id, currentPage, isDev]);
  
  const isPageCalibrated = !!currentCalibration;
  const scaleFactor = currentCalibration?.scaleFactor || 1;
  const unit = currentCalibration?.unit || 'ft';
  const calibrationViewportWidth = currentCalibration?.viewportWidth ?? null;
  const calibrationViewportHeight = currentCalibration?.viewportHeight ?? null;
  const calibrationRotation = currentCalibration?.rotation ?? null;

  // Handle measurement state changes from PDFViewer
  const handleMeasurementStateChange = (measuring: boolean, calibrating: boolean, type: string, orthoSnapping: boolean) => {
    setIsMeasuring(measuring);
    setIsCalibrating(calibrating);
    setMeasurementType(type);
    setIsOrthoSnapping(orthoSnapping);
  };

  // Poll OCR status for a document
  const pollOcrStatus = useCallback(async (documentId: string, documentName: string) => {
    // Wait a moment for OCR job to be created
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    let attempts = 0;
    const maxAttempts = 300; // 5 minutes max (1 second intervals)
    
    const pollInterval = setInterval(async () => {
      try {
        // Try to get OCR job status - we need to find the job ID first
        // For now, we'll check if OCR results exist, which indicates completion
        const results = await ocrService.getDocumentResults(documentId, projectId!);
        
        if (results && results.results && results.results.length > 0) {
          // OCR completed
          setOcrJobs(prev => {
            const newMap = new Map(prev);
            const job = newMap.get(documentId);
            if (job) {
              newMap.set(documentId, {
                ...job,
                status: 'completed',
                progress: 100,
                processedPages: results.totalPages,
                totalPages: results.totalPages
              });
            }
            return newMap;
          });
          clearInterval(pollInterval);
          
          // CRITICAL FIX: Reload documents to update OCR status
          // This ensures ChatTab and other components see the updated OCR status
          // Use a small delay to ensure OCR results are fully saved to database
          setTimeout(() => {
            loadProjectDocuments();
          }, 500);
          
          // Remove from tracking after 3 seconds
          setTimeout(() => {
            setOcrJobs(prev => {
              const newMap = new Map(prev);
              newMap.delete(documentId);
              return newMap;
            });
          }, 3000);
          return;
        }
        
        // Update progress (simulate progress since we don't have job ID)
        attempts++;
        if (attempts < maxAttempts) {
          setOcrJobs(prev => {
            const newMap = new Map(prev);
            const job = newMap.get(documentId);
            if (job) {
              // Estimate progress based on time (rough approximation)
              const estimatedProgress = Math.min(95, Math.floor((attempts / maxAttempts) * 100));
              newMap.set(documentId, {
                ...job,
                status: 'processing',
                progress: estimatedProgress
              });
            }
            return newMap;
          });
        } else {
          // Timeout - mark as failed or remove
          setOcrJobs(prev => {
            const newMap = new Map(prev);
            newMap.delete(documentId);
            return newMap;
          });
          clearInterval(pollInterval);
        }
      } catch (error) {
        // OCR might not be started yet or job doesn't exist - continue polling
        attempts++;
        if (attempts >= maxAttempts) {
          setOcrJobs(prev => {
            const newMap = new Map(prev);
            newMap.delete(documentId);
            return newMap;
          });
          clearInterval(pollInterval);
        }
      }
    }, 1000); // Poll every second
  }, [projectId]);

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
            // Restore page, scale, rotation, and location immediately before setting currentPdfFile
            // This ensures the correct page is set before the PDF viewer initializes
            const savedPage = getDocumentPage(target.id);
            const savedScale = getDocumentScale(target.id);
            const savedRotation = getDocumentRotation(target.id);
            const savedLocation = getDocumentLocation(target.id);
            
            if (isDev) console.log('🔄 Restoring document state immediately:', {
              documentId: target.id,
              savedPage,
              savedScale,
              savedRotation,
              savedLocation
            });
            
            // Set file first, then restore state
            setCurrentPdfFile(target);
            setSelectedDocumentId(target.id);
            
            // Restore state - use handlePageChange for page to ensure proper validation
            setScale(savedScale);
            setRotation(savedRotation);
            // Note: We'll set the page after currentPdfFile is set, but use direct setCurrentPage
            // here since this is initial load and we want to ensure it's set before PDF viewer initializes
            setCurrentPage(savedPage);
            setSelectedPageNumber(savedPage); // Keep selectedPageNumber in sync
            
            // Restore scroll position after a short delay (once PDF is rendered)
            if (savedLocation.x !== 0 || savedLocation.y !== 0) {
              setTimeout(() => {
                if ((window as any).restoreScrollPosition) {
                  (window as any).restoreScrollPosition(savedLocation.x, savedLocation.y);
                }
              }, 200);
            }
          }
        }
      } catch (e: any) {
        if (isDev) console.error('Error loading project files:', e);
        // Set empty array to prevent undefined state
        setProjectFiles([]);
      }
    }
    loadFiles();
  }, [projectId]);

  // Set current project in store and load its data
  useEffect(() => {
    if (projectId) {
      // Set current project first (this clears old measurements)
      setCurrentProject(projectId);
      
      // Load calibrations from database and sync to store
      const loadCalibrations = async () => {
        try {
          const { calibrationService } = await import('../services/apiService');
          const calibrations = await calibrationService.getCalibrationsByProject(projectId);
          
          // Clear any existing calibrations for this project first (in case of stale localStorage data from before)
          // Note: Going forward, calibrations are NOT persisted to localStorage - database is the only source of truth
          clearProjectCalibrations(projectId);
          
          // Sync each calibration from database to the Zustand store (for reactive UI)
          // The store is just a cache - database is authoritative
          // CRITICAL: Pass all calibration fields including viewport dimensions and rotation
          calibrations.forEach((cal: Calibration) => {
            setCalibration(
              cal.projectId, 
              cal.sheetId, 
              cal.scaleFactor, 
              cal.unit, 
              cal.pageNumber ?? null,
              cal.viewportWidth ?? null,
              cal.viewportHeight ?? null,
              cal.rotation ?? null
            );
          });
          
          if (calibrations.length > 0) {
            // Calibrations loaded from database
          } else {
            console.log(`ℹ️ No calibrations found in database for project ${projectId}`);
          }
        } catch (error) {
          console.error('❌ Failed to load calibrations from database:', error);
          // No localStorage fallback - calibrations must come from database
          // If database fails, user will need to recalibrate
        }
      };
      
      // Load all project measurements upfront so reports always have complete data
      // This ensures the reports tab shows all pages with markups immediately
      const loadMeasurements = async () => {
        try {
          await loadProjectTakeoffMeasurements(projectId);
        } catch (error) {
          console.error('❌ Failed to load project measurements:', error);
        }
      };
      
      // Load both calibrations and measurements in parallel
      loadCalibrations();
      loadMeasurements();
    }
  }, [projectId, loadProjectTakeoffMeasurements]); // Include loadProjectTakeoffMeasurements in dependencies

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

  /**
   * Handle completion of a titleblock region selection from the PDF viewer.
   * The selectionBox is normalized PDF coordinates (0-1).
   */
  const handleTitleblockSelectionComplete = async (
    field: TitleblockField,
    selectionBox: NormalizedBox
  ) => {
    console.log('[Titleblock] Selection complete:', { field, selectionBox, hasContext: !!titleblockSelectionContext });
    
    if (!titleblockSelectionContext) {
      console.error('[Titleblock] No selection context available - extraction cannot proceed');
      alert('Titleblock selection context is missing. Please try again.');
      return;
    }

    // Merge into pending config
    const nextConfig = {
      ...(pendingTitleblockConfig || {}),
      ...(field === 'sheetNumber'
        ? { sheetNumberField: selectionBox }
        : { sheetNameField: selectionBox }),
    };
    setPendingTitleblockConfig(nextConfig);
    console.log('[Titleblock] Updated config:', nextConfig);

    if (field === 'sheetNumber') {
      // Step 1 complete - prompt user for sheet name region next
      console.log('[Titleblock] Sheet number selected, prompting for sheet name');
      setTitleblockSelectionMode('sheetName');
      return;
    }

    // Step 2 complete - we have both regions (or at least the name region now)
    console.log('[Titleblock] Sheet name selected, starting extraction');
    setTitleblockSelectionMode(null);

    const finalConfig = {
      sheetNumberField: nextConfig.sheetNumberField || selectionBox,
      sheetNameField: nextConfig.sheetNameField || selectionBox,
    };
    
    // Validate that we have both fields
    if (!finalConfig.sheetNumberField || !finalConfig.sheetNameField) {
      console.error('[Titleblock] Missing required fields:', finalConfig);
      alert('Both sheet number and sheet name regions must be selected. Please try again.');
      setTitleblockSelectionContext(null);
      setPendingTitleblockConfig(null);
      return;
    }
    
    const targetDocumentIds =
      titleblockSelectionContext.scope === 'single'
        ? [titleblockSelectionContext.documentId]
        : documents.map((d) => d.id);

    console.log('[Titleblock] Starting extraction:', {
      projectId,
      documentIds: targetDocumentIds,
      config: finalConfig,
      scope: titleblockSelectionContext.scope,
    });

    // Calculate total pages for progress tracking
    const totalPages = targetDocumentIds.reduce((sum, docId) => {
      const doc = documents.find(d => d.id === docId);
      return sum + (doc?.pages?.length || 0);
    }, 0);

    // Initialize extraction status
    setTitleblockExtractionStatus({
      status: 'processing',
      currentDocument: documents.find(d => d.id === targetDocumentIds[0])?.filename || 'Unknown',
      processedPages: 0,
      totalPages,
      progress: 0,
    });

    try {
      if (!projectId) {
        throw new Error('Project ID is missing');
      }

      console.log('[Titleblock] Calling backend extraction API...');
      
      // Start progress estimation timer
      const startTime = Date.now();
      const estimatedDuration = totalPages * 2000; // Estimate 2 seconds per page
      let progressInterval: NodeJS.Timeout | null = null;
      
      // Update progress estimate while waiting
      progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const estimatedProgress = Math.min(90, Math.round((elapsed / estimatedDuration) * 90)); // Cap at 90% until done
        const processedPages = Math.max(1, Math.round((estimatedProgress / 100) * totalPages)); // At least 1 to show progress
        
        console.log('[Titleblock] Progress update:', {
          elapsed,
          estimatedProgress,
          processedPages,
          totalPages
        });
        
        setTitleblockExtractionStatus(prev => {
          if (!prev) return null;
          return {
            ...prev,
            progress: estimatedProgress,
            processedPages: processedPages,
          };
        });
      }, 500); // Update every 500ms
      
      const result = await titleblockService.extractTitleblock(projectId, targetDocumentIds, finalConfig);
      
      // Clear progress interval
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      
      console.log('[Titleblock] Backend extraction response:', result);

      // Update status based on results
      if (result.success && result.results) {
        const totalProcessed = result.results.reduce((sum: number, r: any) => sum + (r.sheets?.length || 0), 0);
        const successfulLabels = result.results.reduce((sum: number, r: any) => {
          return sum + (r.sheets?.filter((s: any) => s.sheetNumber !== 'Unknown' || s.sheetName !== 'Unknown').length || 0);
        }, 0);
        
        console.log('[Titleblock] Extraction completed:', {
          totalProcessed,
          successfulLabels,
          totalPages,
          results: result.results.map((r: any) => ({
            documentId: r.documentId,
            sheetsCount: r.sheets?.length || 0,
            successful: r.sheets?.filter((s: any) => s.sheetNumber !== 'Unknown' || s.sheetName !== 'Unknown').length || 0,
            sampleSheets: r.sheets?.slice(0, 3)
          }))
        });
        
        setTitleblockExtractionStatus({
          status: 'completed',
          processedPages: totalProcessed,
          totalPages,
          progress: 100,
        });

        // Wait a moment to ensure all database saves have completed
        console.log('[Titleblock] Waiting 2 seconds for database saves to complete...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Reload documents to pick up updated sheet labels
        console.log('[Titleblock] Reloading documents to display updated labels...');
        await loadProjectDocuments();
        console.log('[Titleblock] Documents reloaded successfully, labels should now be visible');

        // Clear status after a delay
        setTimeout(() => {
          setTitleblockExtractionStatus(null);
        }, 3000);
      } else {
        throw new Error(result.error || 'Extraction returned unsuccessful result');
      }
    } catch (error) {
      console.error('[Titleblock] Extraction failed with error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Titleblock] Error details:', {
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      setTitleblockExtractionStatus({
        status: 'failed',
        error: errorMessage,
        processedPages: 0,
        totalPages,
        progress: 0,
      });

      // Clear failed status after a delay
      setTimeout(() => {
        setTitleblockExtractionStatus(null);
      }, 5000);
    } finally {
      // Clear context after selection flow completes
      console.log('[Titleblock] Clearing selection context');
      setTitleblockSelectionContext(null);
      setPendingTitleblockConfig(null);
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
      
      // Use handlePageChange to ensure proper validation and persistence
      handlePageChange(savedPage);
      
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
  // CRITICAL: User-initiated page selection - use handlePageChange for consistency
  const handlePageSelect = (documentId: string, pageNumber: number) => {
    setSelectedDocumentId(documentId);
    setSelectedPageNumber(pageNumber);
    
    // Find the corresponding PDF file and set it as current
    const selectedFile = projectFiles.find(file => file.id === documentId);
    if (selectedFile) {
      setCurrentPdfFile(selectedFile);
      
      // Restore scale, rotation, and location for this document if they exist
      const savedScale = getDocumentScale(selectedFile.id);
      const savedRotation = getDocumentRotation(selectedFile.id);
      const savedLocation = getDocumentLocation(selectedFile.id);
      setScale(savedScale);
      setRotation(savedRotation);
      
      // Use handlePageChange to ensure proper validation and persistence
      handlePageChange(pageNumber);
      
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

  /**
   * Start per-document titleblock extraction by prompting the user
   * to draw regions for sheet number and sheet name on the selected document.
   */
  const handleExtractTitleblockForDocument = (documentId: string) => {
    const targetDocument = documents.find(doc => doc.id === documentId);
    if (!targetDocument || !projectFiles.length) {
      alert('Document not found or project files not loaded yet.');
      return;
    }

    const firstPage = (Array.isArray(targetDocument.pages) && targetDocument.pages[0])
      ? targetDocument.pages[0].pageNumber
      : 1;

    // Bring the target document/page into view
    handlePageSelect(documentId, firstPage);

    // Initialize titleblock selection flow
    setTitleblockSelectionContext({ documentId, scope: 'single' });
    setPendingTitleblockConfig(null);
    setTitleblockSelectionMode('sheetNumber');

    if (isDev) {
      console.log('[Titleblock] Starting per-document titleblock selection', {
        documentId,
        pageNumber: firstPage,
      });
    }
  };

  /**
   * Start bulk titleblock extraction using a single reference document.
   * For now we use the first document as the reference.
   */
  const handleBulkExtractTitleblock = () => {
    if (!documents.length) {
      alert('No documents available to extract titleblock info from.');
      return;
    }

    const referenceDocument = documents[0];
    const firstPage = (Array.isArray(referenceDocument.pages) && referenceDocument.pages[0])
      ? referenceDocument.pages[0].pageNumber
      : 1;

    // Bring the reference document/page into view
    handlePageSelect(referenceDocument.id, firstPage);

    setTitleblockSelectionContext({ documentId: referenceDocument.id, scope: 'bulk' });
    setPendingTitleblockConfig(null);
    setTitleblockSelectionMode('sheetNumber');

    if (isDev) {
      console.log('[Titleblock] Starting bulk titleblock selection (reference document)', {
        documentId: referenceDocument.id,
        pageNumber: firstPage,
        totalDocuments: documents.length,
      });
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
      setDocumentsLoading(true);
      // Use projectFiles state instead of calling API again to avoid duplicate requests
      const files = projectFiles.length > 0 ? projectFiles : (await fileService.getProjectFiles(projectId)).files || [];
      
      const pdfFiles = files.filter((file: any) => file.mimetype === 'application/pdf');
      
      // CRITICAL FIX: Use Promise.allSettled instead of Promise.all to prevent one failure from breaking everything
      // This ensures that even if one document fails to load, others can still load successfully
      const documentResults = await Promise.allSettled(
        pdfFiles.map(async (file: any) => {
          try {
            // Load PDF to get actual page count - use correct API base URL
            const { getApiBaseUrl } = await import('../lib/apiConfig');
            const API_BASE_URL = getApiBaseUrl();
            const pdfUrl = `${API_BASE_URL}/files/${file.id}`;
            
            // Get authentication token for PDF requests
            const { supabase } = await import('../lib/supabase');
            const { data: { session } } = await supabase.auth.getSession();
            const httpHeaders: Record<string, string> = {
              'Accept': 'application/pdf'
            };
            if (session?.access_token) {
              httpHeaders['Authorization'] = `Bearer ${session.access_token}`;
            }
            
            const pdf = await pdfjsLib.getDocument({
              url: pdfUrl,
              httpHeaders
            }).promise;
            const totalPages = pdf.numPages;
            
            // CRITICAL FIX: Create pages array and load existing sheet data from database
            // This ensures documents have proper page data from the start, preventing null page errors
            // Use Promise.allSettled to handle individual page loading failures gracefully
            const pageResults = await Promise.allSettled(
              Array.from({ length: totalPages }, async (_, index) => {
                const pageNumber = index + 1;
                const sheetId = `${file.id}-${pageNumber}`;
                
                try {
                  // Try to load existing sheet data from database
                  const { sheetService } = await import('../services/apiService');
                  const sheetData = await sheetService.getSheet(sheetId);
                  if (sheetData && sheetData.sheet) {
                    const pageData = {
                      pageNumber,
                      hasTakeoffs: sheetData.sheet.hasTakeoffs || false,
                      takeoffCount: sheetData.sheet.takeoffCount || 0,
                      isVisible: sheetData.sheet.isVisible !== false,
                      sheetName: sheetData.sheet.sheetName,
                      sheetNumber: sheetData.sheet.sheetNumber,
                      ocrProcessed: false
                    };
                    // Log when we find sheet labels (for debugging)
                    if (sheetData.sheet.sheetName || sheetData.sheet.sheetNumber) {
                      console.log(`[LoadDocuments] Found sheet data for ${sheetId}:`, {
                        sheetNumber: sheetData.sheet.sheetNumber,
                        sheetName: sheetData.sheet.sheetName
                      });
                    }
                    return pageData;
                  }
                } catch (error) {
                  // Sheet doesn't exist in database yet, use defaults
                  // This is expected for new documents, so we don't log it as an error
                  if (!(error as any).isExpected404 && (error as any).response?.status !== 404) {
                    console.warn(`Unexpected error loading sheet ${sheetId}:`, error);
                  }
                }
                
                // Default page data - always return a valid page object
                return {
                  ocrProcessed: false,
                  pageNumber,
                  hasTakeoffs: false,
                  takeoffCount: 0,
                  isVisible: true,
                };
              })
            );
            
            // CRITICAL FIX: Filter out failed page results and ensure all pages are valid
            // This prevents null/undefined entries in the pages array
            const pages = pageResults
              .map((result, index) => {
                if (result.status === 'fulfilled' && result.value != null) {
                  return result.value;
                } else {
                  // If page loading failed, return a default page structure
                  console.warn(`Failed to load page ${index + 1} for ${file.originalName}, using defaults`);
                  return {
                    ocrProcessed: false,
                    pageNumber: index + 1,
                    hasTakeoffs: false,
                    takeoffCount: 0,
                    isVisible: true,
                  };
                }
              })
              .filter((page): page is PDFPage => page != null && page.pageNumber != null);
            
            // Check if document has OCR data
            const { serverOcrService } = await import('../services/serverOcrService');
            const ocrData = await serverOcrService.getDocumentData(file.id, projectId);
            // CRITICAL FIX: Ensure results array exists and is valid before checking length
            const hasOCRData = ocrData && Array.isArray(ocrData.results) && ocrData.results.length > 0;
            
            return {
              id: file.id,
              name: file.originalName.replace('.pdf', ''),
              totalPages,
              pages, // Now includes actual page data
              isExpanded: false,
              ocrEnabled: hasOCRData
            };
          } catch (error) {
            console.error(`Error loading PDF ${file.originalName}:`, error);
            // Return a basic document structure even if PDF loading fails
            // Check if document has OCR data even if PDF loading failed
            try {
              const { serverOcrService } = await import('../services/serverOcrService');
              const ocrData = await serverOcrService.getDocumentData(file.id, projectId);
              const hasOCRData = ocrData && Array.isArray(ocrData.results) && ocrData.results.length > 0;
              
              return {
                id: file.id,
                name: file.originalName.replace('.pdf', ''),
                totalPages: 1,
                pages: [{
                  pageNumber: 1,
                  hasTakeoffs: false,
                  takeoffCount: 0,
                  isVisible: true,
                  ocrProcessed: false,
                }],
                isExpanded: false,
                ocrEnabled: hasOCRData
              };
            } catch (ocrError) {
              return {
                id: file.id,
                name: file.originalName.replace('.pdf', ''),
                totalPages: 1,
                pages: [{
                  pageNumber: 1,
                  hasTakeoffs: false,
                  takeoffCount: 0,
                  isVisible: true,
                  ocrProcessed: false,
                }],
                isExpanded: false,
                ocrEnabled: false
              };
            }
          }
        })
      );
      
      // CRITICAL FIX: Process Promise.allSettled results - extract successful documents and log failures
      // This prevents one document failure from causing a blank screen
      const documents: PDFDocument[] = documentResults
        .map((result, index) => {
          if (result.status === 'fulfilled') {
            return result.value;
          } else {
            // Log the error but don't crash - return a basic document structure
            const file = pdfFiles[index];
            console.error(`Failed to load document ${file?.originalName || 'unknown'}:`, result.reason);
            return {
              id: file?.id || `error-${index}`,
              name: (file?.originalName || 'Unknown').replace('.pdf', ''),
              totalPages: 1,
              pages: [{
                pageNumber: 1,
                hasTakeoffs: false,
                takeoffCount: 0,
                isVisible: true,
                ocrProcessed: false,
              }],
              isExpanded: false,
              ocrEnabled: false
            };
          }
        })
        .filter((doc): doc is PDFDocument => doc !== null && doc !== undefined);
      
      // Log summary of loaded documents and labels
      const totalPagesWithLabels = documents.reduce((sum, doc) => {
        return sum + (doc.pages?.filter(p => p.sheetName || p.sheetNumber).length || 0);
      }, 0);
      const totalPages = documents.reduce((sum, doc) => sum + (doc.pages?.length || 0), 0);
      console.log(`[LoadDocuments] Loaded ${documents.length} documents, ${totalPagesWithLabels}/${totalPages} pages have labels`);
      
      setDocuments(documents);
      setDocumentsLoading(false);
    } catch (error) {
      console.error('Error loading project documents:', error);
      setDocumentsLoading(false);
    }
  }, [projectId, projectFiles]);

  // Load documents when project changes
  useEffect(() => {
    if (projectId) {
      loadProjectDocuments();
    }
  }, [projectId, loadProjectDocuments]);

  // Track the last file ID we restored state for to prevent multiple restorations
  const lastRestoredFileIdRef = useRef<string | null>(null);
  
  // Initialize rotation, page, scale, and location from store when currentPdfFile changes
  // Note: This is a backup restoration - the main restoration happens in loadFiles() before setting currentPdfFile
  // This ensures state is restored even if currentPdfFile is set from other sources (e.g., sheet selection)
  // CRITICAL: Only restore once per file change, and only if the file actually changed
  // This prevents overriding user's current page/zoom/position during operations like calibration or zoom
  // Store getter functions are stable and don't need to be in dependencies
  useEffect(() => {
    // Only restore if file actually changed (not just a re-render)
    if (currentPdfFile && currentPdfFile.id !== lastRestoredFileIdRef.current) {
      const savedRotation = getDocumentRotation(currentPdfFile.id);
      const savedPage = getDocumentPage(currentPdfFile.id);
      const savedScale = getDocumentScale(currentPdfFile.id);
      const savedLocation = getDocumentLocation(currentPdfFile.id);
      
      if (isDev) console.log('🔄 Restoring document state (backup):', {
        documentId: currentPdfFile.id,
        savedRotation,
        savedPage,
        savedScale,
        savedLocation,
        currentPage, // Log current to see if it needs updating
        currentRotation: rotation,
        currentScale: scale
      });
      
      // CRITICAL: Only restore page if it's different from current to avoid unnecessary updates
      // This prevents page resets during operations
      if (savedPage !== currentPage) {
        setCurrentPage(savedPage);
        setSelectedPageNumber(savedPage); // Keep selectedPageNumber in sync
      }
      
      // Only restore rotation/scale if different to avoid unnecessary updates
      if (savedRotation !== rotation) {
        setRotation(savedRotation);
      }
      if (savedScale !== scale) {
        setScale(savedScale);
      }
      
      // Mark this file as restored
      lastRestoredFileIdRef.current = currentPdfFile.id;
      
      // Scroll position will be restored when PDF is fully rendered via handlePDFRendered
    }
    // CRITICAL: Only depend on currentPdfFile?.id - store getters are stable and don't need to be dependencies
    // This prevents the effect from running on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPdfFile?.id]);

  const handleExportStatusUpdate = (type: 'excel' | 'pdf' | null, progress: number) => {
    setExportStatus({type, progress});
  };

  const handleCutoutMode = (conditionId: string | null) => {
    setCutoutMode(!!conditionId);
    setCutoutTargetConditionId(conditionId);
  };

  // PDF viewer control handlers
  // CRITICAL: This is the ONLY function that should change the page when called by the user
  // All other page changes should go through this handler to ensure proper persistence
  const handlePageChange = (page: number) => {
    // Validate page number
    if (page < 1 || (totalPages > 0 && page > totalPages)) {
      if (isDev) console.warn('⚠️ Invalid page number requested:', { page, totalPages, currentPage });
      return;
    }
    
    // Only update if page actually changed
    if (page !== currentPage) {
      if (isDev) console.log('📄 Page change:', { from: currentPage, to: page, documentId: currentPdfFile?.id });
      setCurrentPage(page);
      setSelectedPageNumber(page); // Keep selectedPageNumber in sync
      
      // Save page to store for persistence
      if (currentPdfFile) {
        setDocumentPage(currentPdfFile.id, page);
        setLastViewedDocumentId?.(currentPdfFile.id);
        if (isDev) console.log('💾 Saved page to store:', { documentId: currentPdfFile.id, page });
      }
    } else if (isDev) {
      console.log('⏭️ Page change skipped - already on page', page);
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

  // Track if this is the initial render to prevent scroll restoration during zoom
  const isInitialRenderRef = useRef(true);
  
  const handlePDFRendered = () => {
    // Only restore scroll position on initial render, not during zoom/scale changes
    // During zoom, the scroll position should be maintained naturally by the browser
    if (currentPdfFile && isInitialRenderRef.current) {
      const savedLocation = getDocumentLocation(currentPdfFile.id);
      if (savedLocation.x !== 0 || savedLocation.y !== 0) {
        if (isDev) console.log('🔄 Restoring scroll position after initial PDF render:', savedLocation);
        // Use a minimal delay to ensure the container is ready
        setTimeout(() => {
          if ((window as any).restoreScrollPosition) {
            (window as any).restoreScrollPosition(savedLocation.x, savedLocation.y);
          }
        }, 25);
      }
      // Mark initial render as complete
      isInitialRenderRef.current = false;
    } else if (isDev && !isInitialRenderRef.current) {
      // Log that we're skipping scroll restoration during zoom
      if (isDev) console.log('⏭️ Skipping scroll restoration - not initial render (likely zoom operation)');
    }
  };
  
  // Reset initial render flag when file changes
  useEffect(() => {
    if (currentPdfFile) {
      isInitialRenderRef.current = true;
    }
  }, [currentPdfFile?.id]);

  const handleCalibrateScale = () => {
    // Trigger the PDF viewer's calibration dialog
    // If already calibrated, clear the current calibration first
    if (isPageCalibrated && currentPdfFile && projectId) {
      setCalibration(projectId, currentPdfFile.id, 1, 'ft', null, null, null, null);
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

  const handleCalibrationComplete = async (
    isCalibrated: boolean, 
    scaleFactor: number, 
    unit: string,
    scope?: 'page' | 'document',
    pageNumber?: number | null,
    viewportWidth?: number | null,
    viewportHeight?: number | null,
    rotation?: number | null
  ) => {
    if (currentPdfFile && projectId) {
      // CRITICAL: Save current page state before any calibration operations
      // This ensures the page doesn't get reset during calibration save operations
      const currentPageToPreserve = currentPage;
      if (currentPdfFile) {
        setDocumentPage(currentPdfFile.id, currentPageToPreserve);
        if (isDev) console.log('💾 Preserving page state before calibration save:', { documentId: currentPdfFile.id, page: currentPageToPreserve });
      }
      
      try {
        const { calibrationService } = await import('../services/apiService');
        
        if (scope === 'document') {
          // "Entire document" = save calibration for ALL sheets/files in the project
          // Get all PDF files in the project
          const filesRes = await fileService.getProjectFiles(projectId);
          const pdfFiles = (filesRes.files || []).filter((file: any) => file.mimetype === 'application/pdf');
          
          // Save calibration for each sheet with pageNumber = null (document-level for that sheet)
          const savePromises = pdfFiles.map((file: any) => {
            // Save to Zustand store (for immediate UI updates)
            setCalibration(projectId, file.id, scaleFactor, unit, null, viewportWidth, viewportHeight, rotation);
            
            // Save to database
            return calibrationService.saveCalibration(
              projectId, 
              file.id, 
              scaleFactor, 
              unit,
              'document',
              null,
              viewportWidth,
              viewportHeight,
              rotation
            );
          });
          
          await Promise.all(savePromises);
          // Calibration saved to database for entire project
        } else {
          // "This sheet only" = save calibration for just the current sheet
          // scope = 'page' -> pageNumber = currentPage or provided pageNumber (page-specific)
          const calibrationPageNumber = pageNumber ?? currentPage;
          
          // Save to Zustand store (for immediate UI updates)
          setCalibration(projectId, currentPdfFile.id, scaleFactor, unit, calibrationPageNumber, viewportWidth, viewportHeight, rotation);
          
          // Save to database
          await calibrationService.saveCalibration(
            projectId, 
            currentPdfFile.id, 
            scaleFactor, 
            unit,
            'page',
            calibrationPageNumber,
            viewportWidth,
            viewportHeight,
            rotation
          );
          // Calibration saved to database for this sheet only
        }
      } catch (error) {
        console.error('❌ Failed to save calibration to database:', error);
        // If database save fails, still update the store for immediate UI feedback
        // but user will need to recalibrate if they refresh
        if (scope === 'document') {
          // If document scope failed, at least save for current sheet
          setCalibration(projectId, currentPdfFile.id, scaleFactor, unit, null, viewportWidth, viewportHeight, rotation);
        } else {
          const calibrationPageNumber = pageNumber ?? currentPage;
          setCalibration(projectId, currentPdfFile.id, scaleFactor, unit, calibrationPageNumber, viewportWidth, viewportHeight, rotation);
        }
      }
      
      // CRITICAL: Ensure page state is preserved after calibration operations
      // Restore the page if it somehow got changed during the operation
      if (currentPdfFile && currentPage !== currentPageToPreserve) {
        if (isDev) console.warn('⚠️ Page changed during calibration, restoring:', { from: currentPage, to: currentPageToPreserve });
        setCurrentPage(currentPageToPreserve);
        setSelectedPageNumber(currentPageToPreserve);
        setDocumentPage(currentPdfFile.id, currentPageToPreserve);
      }
    }
  };

  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    
    if (!files || files.length === 0 || !projectId) {
      return;
    }
    
    // Check file sizes before uploading (1GB = 1024 * 1024 * 1024 bytes)
    const maxSizeMB = 1024;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    const invalidFiles: string[] = [];
    
    Array.from(files).forEach((file) => {
      if (file.size > maxSizeBytes) {
        invalidFiles.push(`${file.name} (${(file.size / (1024 * 1024)).toFixed(2)}MB)`);
      }
    });
    
    if (invalidFiles.length > 0) {
      alert(`Some files are too large! Maximum size is ${maxSizeMB}MB (1GB).\n\nLarge files:\n${invalidFiles.join('\n')}\n\nPlease contact your admin to increase the Supabase Storage file size limit.`);
      return;
    }
    
    try {
      setUploading(true);
      
      // Process files sequentially to avoid overwhelming the server
      const uploadedFiles: any[] = [];
      const failedFiles: Array<{name: string, error: string}> = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const uploadRes = await fileService.uploadPDF(file, projectId);
          
          if (uploadRes.file) {
            uploadedFiles.push(uploadRes.file);
            
            // Track OCR job for this document
            // OCR starts automatically after upload, so we'll poll for status
            setOcrJobs(prev => {
              const newMap = new Map(prev);
              newMap.set(uploadRes.file.id, {
                documentId: uploadRes.file.id,
                documentName: uploadRes.file.originalName || file.name,
                progress: 0,
                status: 'pending',
                processedPages: 0,
                totalPages: 0
              });
              return newMap;
            });
            
            // Start polling for OCR status
            pollOcrStatus(uploadRes.file.id, uploadRes.file.originalName || file.name);
          }
        } catch (error: any) {
          console.error(`Upload failed for ${file.name}:`, error);
          
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
          
          failedFiles.push({ name: file.name, error: errorMessage });
        }
      }
      
      // Refresh project files
      const filesRes = await fileService.getProjectFiles(projectId);
      const projectFilesList = filesRes.files || [];
      setProjectFiles(projectFilesList);
      
      // Refresh documents list to show newly uploaded files in sidebar
      if (uploadedFiles.length > 0) {
        await loadProjectDocuments();
      }
      
      // Set the first successfully uploaded file as current
      if (uploadedFiles.length > 0) {
        setCurrentPdfFile(uploadedFiles[0]);
      }
      
      // Show summary if there were failures
      if (failedFiles.length > 0) {
        const successCount = uploadedFiles.length;
        const failCount = failedFiles.length;
        const failMessages = failedFiles.map(f => `  • ${f.name}: ${f.error}`).join('\n');
        alert(`Upload Summary:\n\n✅ Successfully uploaded: ${successCount} file(s)\n❌ Failed: ${failCount} file(s)\n\nFailed files:\n${failMessages}`);
      } else if (uploadedFiles.length > 1) {
        alert(`Successfully uploaded ${uploadedFiles.length} files! OCR processing has started automatically in the background.`);
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

          {/* CV Takeoff Button */}
          <Button
            size="sm"
            variant="outline"
            className="flex items-center gap-2"
            onClick={() => setShowCVTakeoffAgent(true)}
          >
            <Scan className="w-4 h-4" />
            CV Takeoff
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
          {/* Mode indicator banner */}
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
          {titleblockSelectionMode && (
            <div className="bg-blue-100 border-b border-blue-200 p-3 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium text-blue-900">
                  Titleblock Selection: Draw a box around the{' '}
                  {titleblockSelectionMode === 'sheetNumber' ? 'sheet number' : 'sheet name'} field
                </span>
              </div>
              <div className="text-xs text-blue-800">
                This configuration will be used to extract sheet titles and numbers automatically.
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
              calibrationViewportWidth={calibrationViewportWidth}
              calibrationViewportHeight={calibrationViewportHeight}
              calibrationRotation={calibrationRotation}
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
              // Titleblock selection uses the same box-drawing interaction as visual search
              // but sends regions back through a separate callback.
              titleblockSelectionMode={titleblockSelectionMode}
              onTitleblockSelectionComplete={handleTitleblockSelectionComplete}
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
                  documentsLoading={documentsLoading}
                  onPageSelect={handlePageSelect}
                  selectedDocumentId={selectedDocumentId || undefined}
                  selectedPageNumber={selectedPageNumber || undefined}
                  onOCRRequest={handleOCRRequest}
                  onOcrSearchResults={handleOcrSearchResults}
                  onDocumentsUpdate={handleDocumentsUpdate}
                  onReloadDocuments={loadProjectDocuments}
                  onPdfUpload={handlePdfUpload}
                  uploading={uploading}
                  onLabelingJobUpdate={setLabelingJob}
                  onExtractTitleblockForDocument={handleExtractTitleblockForDocument}
                  onBulkExtractTitleblock={handleBulkExtractTitleblock}
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
          ) : titleblockExtractionStatus && titleblockExtractionStatus.status === 'processing' ? (
            <div className="flex items-center gap-3 bg-blue-50 px-3 py-2 rounded-lg border border-blue-200">
              <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-blue-700">
                  Extracting Titleblocks
                  {titleblockExtractionStatus.currentDocument && `: ${titleblockExtractionStatus.currentDocument}`}
                  {titleblockExtractionStatus.processedPages !== undefined && titleblockExtractionStatus.totalPages !== undefined 
                    ? ` (${titleblockExtractionStatus.processedPages}/${titleblockExtractionStatus.totalPages} pages)`
                    : titleblockExtractionStatus.totalPages !== undefined 
                      ? ` (0/${titleblockExtractionStatus.totalPages} pages)`
                      : ''}
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-32 h-2 bg-blue-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all duration-300 ease-out rounded-full"
                      style={{ width: `${titleblockExtractionStatus.progress || 0}%` }}
                    ></div>
                  </div>
                  <span className="text-xs text-blue-600 font-medium">
                    {titleblockExtractionStatus.progress || 0}%
                  </span>
                </div>
              </div>
            </div>
          ) : titleblockExtractionStatus && titleblockExtractionStatus.status === 'completed' ? (
            <div className="flex items-center gap-3 bg-green-50 px-3 py-2 rounded-lg border border-green-200">
              <div className="w-5 h-5 border-2 border-green-500 rounded-full flex items-center justify-center">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-green-700">
                  Titleblock Extraction Complete
                  {titleblockExtractionStatus.processedPages !== undefined && titleblockExtractionStatus.totalPages !== undefined 
                    ? ` (${titleblockExtractionStatus.processedPages}/${titleblockExtractionStatus.totalPages} pages)`
                    : ''}
                </span>
              </div>
            </div>
          ) : titleblockExtractionStatus && titleblockExtractionStatus.status === 'failed' ? (
            <div className="flex items-center gap-3 bg-red-50 px-3 py-2 rounded-lg border border-red-200">
              <div className="w-5 h-5 border-2 border-red-500 rounded-full flex items-center justify-center">
                <span className="text-red-500 text-xs font-bold">×</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-red-700">
                  Titleblock Extraction Failed
                </span>
                {titleblockExtractionStatus.error && (
                  <span className="text-xs text-red-600 mt-1">
                    {titleblockExtractionStatus.error}
                  </span>
                )}
              </div>
            </div>
          ) : labelingJob && labelingJob.status === 'processing' ? (
            <div className="flex items-center gap-3 bg-green-50 px-3 py-2 rounded-lg border border-green-200">
              <div className="animate-spin w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full"></div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-green-700">
                  Labeling Pages
                  {labelingJob.currentDocument && `: ${labelingJob.currentDocument}`}
                  {labelingJob.processedPages !== undefined && labelingJob.totalPages !== undefined 
                    ? ` (${labelingJob.processedPages}/${labelingJob.totalPages} pages)`
                    : labelingJob.totalPages !== undefined 
                      ? ` (0/${labelingJob.totalPages} pages)`
                      : ''}
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-32 h-2 bg-green-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-green-500 transition-all duration-300 ease-out rounded-full"
                      style={{ width: `${labelingJob.progress}%` }}
                    ></div>
                  </div>
                  <span className="text-xs text-green-600 font-medium">
                    {labelingJob.progress}%
                  </span>
                </div>
              </div>
            </div>
          ) : ocrJobs.size > 0 ? (
            <div className="flex items-center gap-3 bg-purple-50 px-3 py-2 rounded-lg border border-purple-200">
              <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full"></div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-purple-700">
                  {ocrJobs.size === 1 
                    ? `OCR Processing: ${Array.from(ocrJobs.values())[0].documentName}`
                    : `OCR Processing ${ocrJobs.size} documents...`}
                </span>
                {ocrJobs.size === 1 && (() => {
                  const job = Array.from(ocrJobs.values())[0];
                  return (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-32 h-2 bg-purple-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-purple-500 transition-all duration-300 ease-out rounded-full"
                          style={{ width: `${job.progress}%` }}
                        ></div>
                      </div>
                      <span className="text-xs text-purple-600 font-medium">
                        {job.progress}%
                        {job.processedPages && job.totalPages ? ` (${job.processedPages}/${job.totalPages})` : ''}
                      </span>
                    </div>
                  );
                })()}
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

      {/* CV Takeoff Agent */}
      {projectId && (
        <CVTakeoffAgent
          isOpen={showCVTakeoffAgent}
          onClose={() => setShowCVTakeoffAgent(false)}
          projectId={projectId}
          documentId={currentPdfFile?.id || null}
          pageNumber={currentPage || null}
        />
      )}

    </div>
  );
}