import { useEffect, useState, useCallback } from 'react';

import { useParams, useNavigate } from 'react-router-dom';
import PDFViewer from './PDFViewer';
import { TakeoffSidebar } from './TakeoffSidebar';

import { useProjectStore } from '../store/slices/projectSlice';
import { useConditionStore } from '../store/slices/conditionSlice';
import { useMeasurementStore } from '../store/slices/measurementSlice';
import { useCalibrationStore } from '../store/slices/calibrationSlice';
import { useAnnotationStore } from '../store/slices/annotationSlice';
import { useDocumentViewStore } from '../store/slices/documentViewSlice';
import { useUndoStore } from '../store/slices/undoSlice';
import type { TakeoffCondition, Sheet, ProjectFile, PDFDocument, SearchResult } from '../types';
import { toast } from 'sonner';
import { triggerCalibration, triggerFitToWindow, getCurrentScrollPosition } from '../lib/windowBridge';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
import { Button } from "./ui/button";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { fileService } from '../services/apiService';
import { TakeoffWorkspaceHeader } from './takeoff-workspace/TakeoffWorkspaceHeader';
import { TakeoffWorkspaceStatusBar } from './takeoff-workspace/TakeoffWorkspaceStatusBar';
import { TakeoffWorkspaceRightSidebar } from './takeoff-workspace/TakeoffWorkspaceRightSidebar';
import { TakeoffWorkspaceModeBanners } from './takeoff-workspace/TakeoffWorkspaceModeBanners';
import { ExportProgressOverlay } from './takeoff-workspace/ExportProgressOverlay';
import { TakeoffWorkspaceDialogs } from './takeoff-workspace/TakeoffWorkspaceDialogs';
import { useTakeoffWorkspaceDocuments } from './takeoff-workspace/useTakeoffWorkspaceDocuments';
import { useTakeoffWorkspaceVisualSearch } from './takeoff-workspace/useTakeoffWorkspaceVisualSearch';
import { useTakeoffWorkspaceTitleblock } from './takeoff-workspace/useTakeoffWorkspaceTitleblock';
import { useTakeoffWorkspaceOCR } from './takeoff-workspace/useTakeoffWorkspaceOCR';
import { useTakeoffWorkspaceProjectInit } from './takeoff-workspace/useTakeoffWorkspaceProjectInit';
import { useTakeoffWorkspaceCalibration } from './takeoff-workspace/useTakeoffWorkspaceCalibration';
import { useTakeoffWorkspaceDocumentView } from './takeoff-workspace/useTakeoffWorkspaceDocumentView';
import { SearchResultsList } from './takeoff-workspace/SearchResultsList';

// All interfaces now imported from shared types

function getErrorMessage(error: unknown): string {
  const fallback = 'Failed to upload PDF file.';
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    if (err.response && typeof err.response === 'object') {
      const data = (err.response as Record<string, unknown>).data;
      if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        if (typeof d.message === 'string') return d.message;
        if (typeof d.error === 'string') return d.error;
      }
      if (typeof data === 'string') return data;
    }
    if (typeof err.message === 'string') return err.message;
  }
  if (typeof error === 'string') return error;
  return fallback;
}

export function TakeoffWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const isDev = import.meta.env.DEV;

  // Redirect if projectId is missing or invalid
  useEffect(() => {
    if (!projectId) {
      console.error('❌ TakeoffWorkspace: projectId is missing, redirecting to /app');
      navigate('/app', { replace: true });
      return;
    }
  }, [projectId, navigate]);

  // Clear undo history when switching projects
  useEffect(() => {
    if (projectId) useUndoStore.getState().clear();
  }, [projectId]);
  
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
  
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const setSelectedCondition = useConditionStore((s) => s.setSelectedCondition);
  const getSelectedCondition = useConditionStore((s) => s.getSelectedCondition);
  const getCurrentProject = useProjectStore((s) => s.getCurrentProject);
  const loadProjectTakeoffMeasurements = useMeasurementStore((s) => s.loadProjectTakeoffMeasurements);
  const setCalibration = useCalibrationStore((s) => s.setCalibration);
  const _getCalibration = useCalibrationStore((s) => s.getCalibration);
  const clearProjectCalibrations = useCalibrationStore((s) => s.clearProjectCalibrations);
  const clearPageAnnotations = useAnnotationStore((s) => s.clearPageAnnotations);
  const setDocumentRotation = useDocumentViewStore((s) => s.setDocumentRotation);
  const getDocumentRotation = useDocumentViewStore((s) => s.getDocumentRotation);
  const setDocumentPage = useDocumentViewStore((s) => s.setDocumentPage);
  const getDocumentPage = useDocumentViewStore((s) => s.getDocumentPage);
  const setDocumentScale = useDocumentViewStore((s) => s.setDocumentScale);
  const getDocumentScale = useDocumentViewStore((s) => s.getDocumentScale);
  const setDocumentLocation = useDocumentViewStore((s) => s.setDocumentLocation);
  const getDocumentLocation = useDocumentViewStore((s) => s.getDocumentLocation);
  const getLastViewedDocumentId = useDocumentViewStore((s) => s.getLastViewedDocumentId);
  const setLastViewedDocumentId = useDocumentViewStore((s) => s.setLastViewedDocumentId);

  // Track when document view store has rehydrated from localStorage so we apply saved view state
  const [documentViewRehydrated, setDocumentViewRehydrated] = useState(false);
  useEffect(() => {
    const unsub = useDocumentViewStore.persist?.onFinishHydration?.(() => setDocumentViewRehydrated(true));
    if (useDocumentViewStore.persist?.hasHydrated?.()) setDocumentViewRehydrated(true);
    return () => { unsub?.(); };
  }, []);

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
  const [ocrSearchResults, setOcrSearchResults] = useState<SearchResult[]>([]);
  const [currentSearchQuery, setCurrentSearchQuery] = useState<string>('');
  const [currentPdfFile, setCurrentPdfFile] = useState<ProjectFile | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [uploading, setUploading] = useState<boolean>(false);
  const [_loading, _setLoading] = useState(true);
  const { documents, documentsLoading, loadProjectDocuments, setDocuments } = useTakeoffWorkspaceDocuments({
    projectId: projectId ?? undefined,
    projectFiles,
  });
  const [exportStatus, setExportStatus] = useState<{type: 'excel' | 'pdf' | null, progress: number}>({type: null, progress: 0});

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

  // Narrow selector: only current page calibration (avoids re-render when other pages' calibrations change)
  const currentCalibration = useCalibrationStore((s) =>
    s.getCalibration(projectId ?? '', currentPdfFile?.id ?? '', currentPage ?? 1)
  );

  const visualSearch = useTakeoffWorkspaceVisualSearch({
    projectId: projectId ?? undefined,
    currentPdfFile,
    currentPage,
    selectedSheet,
    isDev,
  });
  
  // Scale is now managed by the store
  
  // Current calibration for the active document/page (narrow selector in parent)
  const calibration = useTakeoffWorkspaceCalibration({
    currentCalibration,
    isDev,
  });

  const documentView = useTakeoffWorkspaceDocumentView({
    projectId: projectId ?? undefined,
    projectFiles,
    currentPdfFile,
    currentPage,
    totalPages,
    scale,
    rotation,
    isDev,
    setCurrentPdfFile,
    setSelectedDocumentId,
    setSelectedPageNumber,
    setScale,
    setRotation,
    setCurrentPage,
    setSelectedSheet,
    getDocumentPage,
    getDocumentScale,
    getDocumentRotation,
    getDocumentLocation,
    setDocumentPage,
    setLastViewedDocumentId,
    setDocumentScale,
    setDocumentRotation,
    setDocumentLocation,
  });

  useTakeoffWorkspaceProjectInit({
    projectId: projectId ?? undefined,
    isDev,
    documentViewRehydrated,
    currentPdfFile,
    setProjectFiles,
    setCurrentPdfFile,
    setSelectedDocumentId,
    setScale,
    setRotation,
    setCurrentPage,
    setSelectedPageNumber,
    getLastViewedDocumentId: (pid: string) => getLastViewedDocumentId(pid) ?? undefined,
    getDocumentPage,
    getDocumentScale,
    getDocumentRotation,
    setCurrentProject,
    clearProjectCalibrations,
    setCalibration,
    loadProjectTakeoffMeasurements,
    setShowProfitMarginDialog,
  });

  // Persist scroll position on unload/refresh so viewport restores to same spot
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!currentPdfFile) return;
      const pos = getCurrentScrollPosition();
      if (pos) setDocumentLocation(currentPdfFile.id, pos);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Only need file id for persist; omit full currentPdfFile
  }, [currentPdfFile?.id, setDocumentLocation]);

  // Handle measurement state changes from PDFViewer
  // CRITICAL: Wrapped in useCallback to prevent infinite re-render loops
  const handleMeasurementStateChange = useCallback((measuring: boolean, calibrating: boolean, type: string, orthoSnapping: boolean) => {
    setIsMeasuring(measuring);
    setIsCalibrating(calibrating);
    setMeasurementType(type);
    setIsOrthoSnapping(orthoSnapping);
  }, []);

  // CRITICAL: Wrapped in useCallback to prevent re-render loops
  const handleConditionSelect = useCallback((condition: TakeoffCondition | null) => {
    if (condition === null) {
      setSelectedCondition(null);
      visualSearch.setVisualSearchMode(false);
      visualSearch.setVisualSearchCondition(null);
    } else {
      setSelectedCondition(condition.id);
      
      if (condition.type === 'auto-count') {
        const takeoffMeasurements = useMeasurementStore.getState().takeoffMeasurements;
        const existingMeasurements = takeoffMeasurements.filter(m => m.conditionId === condition.id);
        
        if (existingMeasurements.length > 0) {
          toast.warning(`This auto-count condition already has ${existingMeasurements.length} measurements. Please delete the condition and recreate it to run a new search.`);
          visualSearch.setVisualSearchMode(false);
          visualSearch.setVisualSearchCondition(null);
        } else {
          visualSearch.setVisualSearchMode(true);
          visualSearch.setVisualSearchCondition(condition);
        }
      } else {
        visualSearch.setVisualSearchMode(false);
        visualSearch.setVisualSearchCondition(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Setters stable; omit
  }, [visualSearch]);

  // Undo/redo for header buttons and shortcuts
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const canUndo = useUndoStore((s) => s.past.length > 0);
  const canRedo = useUndoStore((s) => s.future.length > 0);

  // Global keydown: Space (deselect condition), Cmd/Ctrl+Z (undo), Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y (redo)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSpace = event.code === 'Space' || event.key === ' ';
      if (isSpace) {
        const currentlySelected = getSelectedCondition();
        if (currentlySelected) {
          event.preventDefault();
          handleConditionSelect(null);
        }
        return;
      }
      const isUndo = (event.metaKey || event.ctrlKey) && event.key === 'z' && !event.shiftKey;
      const isRedo = (event.metaKey || event.ctrlKey) && (event.key === 'y' || (event.key === 'z' && event.shiftKey));
      if (isUndo) {
        const { past } = useUndoStore.getState();
        if (past.length > 0) {
          event.preventDefault();
          undo();
        }
      } else if (isRedo) {
        const { future } = useUndoStore.getState();
        if (future.length > 0) {
          event.preventDefault();
          redo();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [getSelectedCondition, handleConditionSelect, undo, redo]);

  const handleToolSelect = (_tool: string) => {
    // Tool selection handled by PDF viewer
  };

  const rotatePage = (direction: 'clockwise' | 'counterclockwise') => {
    const rotationStep = direction === 'clockwise' ? 90 : -90;
    const newRotation = (rotation + rotationStep) % 360;
    documentView.handleRotationChange(newRotation);
  };

  const titleblock = useTakeoffWorkspaceTitleblock({
    projectId: projectId ?? undefined,
    documents,
    projectFiles,
    loadProjectDocuments,
    handlePageSelect: documentView.handlePageSelect,
    isDev,
  });

  const ocr = useTakeoffWorkspaceOCR({
    projectId: projectId ?? undefined,
    projectFiles,
    loadProjectDocuments,
  });

  const _handleSearchInDocument = useCallback((query: string) => {
    const mockResults = [
      `Found "${query}" in note at coordinates (150, 200)`,
      `Found "${query}" in dimension at coordinates (300, 350)`,
      `Found "${query}" in title block at coordinates (600, 50)`
    ];
    setSearchResults(mockResults);
  }, []);

  // CRITICAL: Wrapped in useCallback to prevent re-render loops in SheetSidebar
  const handleOcrSearchResults = useCallback((results: SearchResult[], query: string) => {
    setOcrSearchResults(results);
    setCurrentSearchQuery(query);
  }, []);

  // CRITICAL: Wrapped in useCallback to prevent re-render loops in SheetSidebar
  // This is called from a useEffect in SheetSidebar that watches takeoffMeasurements
  const handleDocumentsUpdate = useCallback((updatedDocuments: PDFDocument[]) => {
    setDocuments(updatedDocuments);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Setter stable; omit
  }, []);


  // CRITICAL: Wrapped in useCallback to prevent re-render loops
  const handleExportStatusUpdate = useCallback((type: 'excel' | 'pdf' | null, progress: number) => {
    setExportStatus({type, progress});
  }, []);

  // CRITICAL: Wrapped in useCallback to prevent infinite re-render loops
  const handleCutoutMode = useCallback((conditionId: string | null) => {
    setCutoutMode(!!conditionId);
    setCutoutTargetConditionId(conditionId);
  }, []);

  const handleCalibrateScale = () => {
    // Trigger the PDF viewer's calibration dialog
    // If already calibrated, clear the current calibration first
    if (calibration.isPageCalibrated && currentPdfFile && projectId) {
      setCalibration(projectId, currentPdfFile.id, 1, 'ft', null, null, null, null);
    }
    
    triggerCalibration();
  };


  const handleResetView = () => {
    triggerFitToWindow();
    // Fallback when PDF viewer hasn't registered the global yet (e.g. before PDF loads)
    if (typeof window.triggerFitToWindow !== 'function') {
      documentView.handleScaleChange(1);
    }
  };

  // CRITICAL: Wrapped in useCallback to prevent infinite re-render loops
  const handlePDFLoaded = useCallback((totalPages: number) => {
    setTotalPages(totalPages);
    // Don't reset page here - let the useEffect handle it from store
  }, []);

  // CRITICAL: Wrapped in useCallback to prevent infinite re-render loops
  const handleCalibrationComplete = useCallback(async (
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
          const pdfFiles = (filesRes.files || []).filter((file: ProjectFile) => file.mimetype === 'application/pdf');
          
          // Save calibration for each sheet with pageNumber = null (document-level for that sheet)
          const savePromises = pdfFiles.map((file: ProjectFile) => {
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

      // Recalculate existing measurements for the calibrated scope so values use the new scale
      const recalculateMeasurementsForCalibration = useMeasurementStore.getState().recalculateMeasurementsForCalibration;
      const vw = viewportWidth ?? null;
      const vh = viewportHeight ?? null;
      if (scope === 'document') {
        const filesRes = await fileService.getProjectFiles(projectId);
        const pdfFiles = (filesRes.files || []).filter((file: ProjectFile) => file.mimetype === 'application/pdf');
        for (const file of pdfFiles) {
          await recalculateMeasurementsForCalibration(projectId, file.id, null, scaleFactor, unit, vw, vh);
        }
      } else {
        const calibrationPageNumber = pageNumber ?? currentPage;
        await recalculateMeasurementsForCalibration(projectId, currentPdfFile.id, calibrationPageNumber, scaleFactor, unit, vw, vh);
      }
    }
  }, [currentPdfFile, projectId, currentPage, setDocumentPage, setCalibration, isDev]);

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
      toast.error(`Some files are too large! Maximum size is ${maxSizeMB}MB (1GB). Large files: ${invalidFiles.join(', ')}. Please contact your admin to increase the Supabase Storage file size limit.`);
      return;
    }
    
    try {
      setUploading(true);
      
      // Process files sequentially to avoid overwhelming the server
      const uploadedFiles: ProjectFile[] = [];
      const failedFiles: Array<{name: string, error: string}> = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const uploadRes = await fileService.uploadPDF(file, projectId);
          
          if (uploadRes.file) {
            uploadedFiles.push(uploadRes.file);
            ocr.startOcrTracking(uploadRes.file.id, uploadRes.file.originalName || file.name);
          }
        } catch (error: unknown) {
          console.error(`Upload failed for ${file.name}:`, error);
          const errorMessage = getErrorMessage(error);
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
        const failMessages = failedFiles.map(f => `${f.name}: ${f.error}`).join('; ');
        toast.warning(`Upload: ${successCount} succeeded, ${failCount} failed. ${failMessages}`);
      } else if (uploadedFiles.length > 1) {
        toast.success(`Successfully uploaded ${uploadedFiles.length} files! OCR processing has started automatically in the background.`);
      }
      
    } catch (error: unknown) {
      console.error('Upload failed:', error);
      const errorMessage = getErrorMessage(error);
      
      toast.error(`Upload Error: ${errorMessage}`);
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
      <TakeoffWorkspaceHeader
        onBackToProjects={handleBackToProjects}
        currentPage={currentPage}
        totalPages={totalPages}
        currentPdfFile={currentPdfFile}
        onPageChange={documentView.handlePageChange}
        scale={scale}
        onScaleChange={documentView.handleScaleChange}
        onResetView={handleResetView}
        onRotatePage={rotatePage}
        isPageCalibrated={calibration.isPageCalibrated}
        onCalibrateScale={handleCalibrateScale}
        onOpenCVTakeoffAgent={() => setShowCVTakeoffAgent(true)}
        annotationTool={annotationTool}
        annotationColor={annotationColor}
        onAnnotationToolChange={setAnnotationTool}
        onAnnotationColorChange={setAnnotationColor}
        onClearAnnotations={() => {
          setAnnotationTool(null);
          if (projectId && currentPdfFile?.id && selectedPageNumber) {
            clearPageAnnotations(projectId, currentPdfFile.id, selectedPageNumber);
          }
        }}
        isOrthoSnapping={isOrthoSnapping}
        isMeasuring={isMeasuring}
        isCalibrating={isCalibrating}
        measurementType={measurementType}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => undo()}
        onRedo={() => redo()}
      />

      {/* Main Content Area - Fixed height container */}
      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar Toggle */}
        <div className="flex">
          {leftSidebarOpen && (
                        <TakeoffSidebar
              projectId={storeCurrentProject?.id ?? projectId ?? ''}
              onConditionSelect={handleConditionSelect}
              onToolSelect={handleToolSelect}
              documents={documents}
              onPageSelect={documentView.handlePageSelect}
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
          <TakeoffWorkspaceModeBanners
            visualSearchMode={visualSearch.visualSearchMode}
            visualSearchCondition={visualSearch.visualSearchCondition}
            titleblockSelectionMode={titleblock.titleblockSelectionMode}
          />
          {currentPdfFile ? (
            <PDFViewer 
              file={currentPdfFile}
              className="h-full"
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={documentView.handlePageChange}
              scale={scale}
              onScaleChange={documentView.handleScaleChange}
              rotation={rotation}
              onCalibrationRequest={handleCalibrateScale}
              isPageCalibrated={calibration.isPageCalibrated}
              scaleFactor={calibration.scaleFactor}
              unit={calibration.unit}
              calibrationViewportWidth={calibration.calibrationViewportWidth}
              calibrationViewportHeight={calibration.calibrationViewportHeight}
              calibrationRotation={calibration.calibrationRotation}
              onPDFLoaded={handlePDFLoaded}
              onCalibrationComplete={handleCalibrationComplete}
              searchResults={ocrSearchResults}
              currentSearchQuery={currentSearchQuery}
              cutoutMode={cutoutMode}
              cutoutTargetConditionId={cutoutTargetConditionId}
              onCutoutModeChange={handleCutoutMode}
              onMeasurementStateChange={handleMeasurementStateChange}
              onLocationChange={documentView.handleLocationChange}
              onPDFRendered={documentView.handlePDFRendered}
              annotationTool={annotationTool}
              annotationColor={annotationColor}
              onAnnotationToolChange={setAnnotationTool}
              visualSearchMode={visualSearch.visualSearchMode}
              visualSearchCondition={visualSearch.visualSearchCondition}
              onVisualSearchComplete={visualSearch.handleVisualSearchComplete}
              // Titleblock selection uses the same box-drawing interaction as visual search
              // but sends regions back through a separate callback.
              titleblockSelectionMode={titleblock.titleblockSelectionMode}
              onTitleblockSelectionComplete={titleblock.handleTitleblockSelectionComplete}
            />
          ) : (
            <div className="flex items-center justify-center flex-1 bg-gray-100">
              <div className="text-gray-500">No PDF file selected</div>
            </div>
          )}
          <SearchResultsList results={searchResults} />
        </div>

        <TakeoffWorkspaceRightSidebar
          rightSidebarOpen={rightSidebarOpen}
          onRightSidebarOpenChange={setRightSidebarOpen}
          rightSidebarTab={rightSidebarTab}
          onRightSidebarTabChange={setRightSidebarTab}
          projectId={storeCurrentProject?.id ?? projectId ?? ''}
          documents={documents}
          documentsLoading={documentsLoading}
          onPageSelect={documentView.handlePageSelect}
          selectedDocumentId={selectedDocumentId || undefined}
          selectedPageNumber={selectedPageNumber || undefined}
          onOCRRequest={ocr.handleOCRRequest}
          onOcrSearchResults={handleOcrSearchResults}
          onDocumentsUpdate={handleDocumentsUpdate}
          onReloadDocuments={loadProjectDocuments}
          onPdfUpload={handlePdfUpload}
          uploading={uploading}
          onLabelingJobUpdate={(job) => setLabelingJob(job === null ? null : { totalDocuments: 0, completedDocuments: 0, failedDocuments: 0, progress: job.progress ?? 0, status: (job.status as 'idle' | 'processing' | 'completed' | 'failed') || 'idle', currentDocument: job.currentDocument, processedPages: job.processedPages, totalPages: job.totalPages })}
          onExtractTitleblockForDocument={titleblock.handleExtractTitleblockForDocument}
          onBulkExtractTitleblock={titleblock.handleBulkExtractTitleblock}
        />
      </div>

      <TakeoffWorkspaceStatusBar
        selectedSheet={selectedSheet}
        currentProject={currentProject}
        selectedCondition={selectedCondition}
        exportStatus={exportStatus}
        titleblockExtractionStatus={titleblock.titleblockExtractionStatus}
        labelingJob={labelingJob}
        ocrJobs={ocr.ocrJobs}
        uploading={uploading}
        isMeasuring={isMeasuring}
        isCalibrating={isCalibrating}
        measurementType={measurementType}
      />

      <ExportProgressOverlay exportStatus={exportStatus} />

      <TakeoffWorkspaceDialogs
        projectId={projectId ?? null}
        currentPdfFileId={currentPdfFile ? currentPdfFile.id : null}
        currentPage={currentPage ?? null}
        ocrShowDialog={ocr.showOCRDialog}
        ocrDocumentId={ocr.ocrDocumentId}
        ocrDocumentName={ocr.ocrDocumentName}
        ocrPageNumbers={ocr.ocrPageNumbers}
        ocrOnClose={ocr.closeOCRDialog}
        ocrOnComplete={ocr.onOCRComplete}
        autoCountCondition={visualSearch.visualSearchCondition}
        autoCountShowProgress={visualSearch.showAutoCountProgress}
        autoCountProgress={visualSearch.autoCountProgress}
        autoCountCompletionResult={visualSearch.autoCountCompletionResult}
        autoCountIsCancelling={visualSearch.isCancellingAutoCount}
        autoCountOnClose={() => {
          const wasComplete = visualSearch.autoCountCompletionResult !== null;
          visualSearch.setShowAutoCountProgress(false);
          visualSearch.setAutoCountProgress(null);
          visualSearch.setAutoCountCompletionResult(null);
          if (wasComplete) {
            visualSearch.setVisualSearchMode(false);
            visualSearch.setVisualSearchCondition(null);
            visualSearch.setSelectionBox(null);
          }
        }}
        autoCountOnCancel={() => {
          if (visualSearch.autoCountAbortControllerRef.current) {
            visualSearch.setIsCancellingAutoCount(true);
            visualSearch.autoCountAbortControllerRef.current.abort();
          }
        }}
        showProfitMarginDialog={showProfitMarginDialog}
        setShowProfitMarginDialog={setShowProfitMarginDialog}
        showCVTakeoffAgent={showCVTakeoffAgent}
        setShowCVTakeoffAgent={setShowCVTakeoffAgent}
      />

    </div>
  );
}