import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';

import { useParams, useNavigate } from 'react-router-dom';
import PDFViewer from './PDFViewer';
import { TakeoffSidebar } from './TakeoffSidebar';

import { useShallow } from 'zustand/react/shallow';
import { useProjectStore } from '../store/slices/projectSlice';
import { useConditionStore } from '../store/slices/conditionSlice';
import { useMeasurementStore } from '../store/slices/measurementSlice';
import { useCalibrationStore } from '../store/slices/calibrationSlice';
import { useAnnotationStore } from '../store/slices/annotationSlice';
import { useHyperlinkStore } from '../store/slices/hyperlinkSlice';
import { useDocumentViewStore } from '../store/slices/documentViewSlice';
import { useUndoStore } from '../store';
import type { TakeoffCondition, Sheet, ProjectFile, PDFDocument, SearchResult } from '../types';
import { toast } from 'sonner';
import { triggerCalibration, triggerFitToWindow, getCurrentScrollPosition } from '../lib/windowBridge';
import { fileService } from '../services/apiService';
import { SidebarEdgeToggle } from './takeoff-workspace/SidebarEdgeToggle';
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
import { useTakeoffWorkspaceTabs } from './takeoff-workspace/useTakeoffWorkspaceTabs';
import { PDFViewerTabBar } from './pdf-viewer/PDFViewerTabBar';
import { SearchResultsList } from './takeoff-workspace/SearchResultsList';
import { HyperlinkSheetPickerDialog } from './HyperlinkSheetPickerDialog';
import { HyperlinkContextMenu } from './HyperlinkContextMenu';
import { extractErrorMessage } from '../utils/commonUtils';
import { isEditableKeyboardTarget } from '../utils/keyboardUtils';
import { EmptyDocumentsPlaceholder } from './takeoff-workspace/EmptyDocumentsPlaceholder';

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
  
  // Cut-out states
  const [cutoutMode, setCutoutMode] = useState(false);
  const [cutoutTargetConditionId, setCutoutTargetConditionId] = useState<string | null>(null);

  // Hyperlink mode (H to add manual link; Extract creates from OCR)
  const [hyperlinkMode, setHyperlinkMode] = useState(false);
  
  // Annotation states
  const [annotationTool, setAnnotationTool] = useState<'text' | 'arrow' | 'rectangle' | 'circle' | null>(null);
  const [annotationColor, setAnnotationColor] = useState<string>('#FF0000');
  
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const setSelectedCondition = useConditionStore((s) => s.setSelectedCondition);
  useLayoutEffect(() => {
    if (!projectId) return;
    setCurrentProject(projectId);
    setSelectedCondition(null);
  }, [projectId, setCurrentProject, setSelectedCondition]);
  const selectedConditionId = useConditionStore((s) => s.selectedConditionId);
  const getSelectedCondition = useConditionStore((s) => s.getSelectedCondition);
  const getCurrentProject = useProjectStore((s) => s.getCurrentProject);
  const loadProjectTakeoffMeasurements = useMeasurementStore((s) => s.loadProjectTakeoffMeasurements);
  const setCalibration = useCalibrationStore((s) => s.setCalibration);
  const clearProjectCalibrations = useCalibrationStore((s) => s.clearProjectCalibrations);
  const clearPageAnnotations = useAnnotationStore((s) => s.clearPageAnnotations);
  const setDocumentLocationBySheet = useDocumentViewStore((s) => s.setDocumentLocationBySheet);

  const selectedCondition = getSelectedCondition();

  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  
  // Measurement state from PDFViewer
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [measurementType, setMeasurementType] = useState<string>('');
  const [isOrthoSnapping, setIsOrthoSnapping] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<'documents' | 'search' | 'ai-chat'>('documents');
  const [ocrSearchResults, setOcrSearchResults] = useState<SearchResult[]>([]);
  const [currentSearchQuery, setCurrentSearchQuery] = useState<string>('');
  const [ocrHighlightRequest, setOcrHighlightRequest] = useState<{
    documentId: string;
    pageNumber: number;
    query: string;
  } | null>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  /** Which project the file list fetch completed for (avoids a stale "ready" flag on the first render after switching projects). */
  const [filesLoadedForProjectId, setFilesLoadedForProjectId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);

  const projectFilesListReady = Boolean(projectId && filesLoadedForProjectId === projectId);

  useEffect(() => {
    if (!projectId) return;
    setProjectFiles([]);
    setFilesLoadedForProjectId(null);
  }, [projectId]);

  const onProjectFilesLoaded = useCallback(() => {
    setFilesLoadedForProjectId(projectId ?? null);
  }, [projectId]);

  const { documents, documentsLoading, loadProjectDocuments, setDocuments } = useTakeoffWorkspaceDocuments({
    projectId: projectId ?? undefined,
    projectFiles,
    projectFilesListReady,
  });
  const [exportStatus, setExportStatus] = useState<{type: 'excel' | 'pdf' | null, progress: number}>({type: null, progress: 0});

  // PDF viewer controls state
  const [totalPages, setTotalPages] = useState(0);

  const tabsResult = useTakeoffWorkspaceTabs({
    projectId: projectId ?? undefined,
    projectFiles,
    documents,
    setSelectedDocumentId,
    setSelectedPageNumber,
    setSelectedSheet: (s) =>
      setSelectedSheet(
        s
          ? {
              ...s,
              isVisible: s.isVisible ?? true,
              hasTakeoffs: s.hasTakeoffs ?? false,
              takeoffCount: s.takeoffCount ?? 0,
            }
          : null
      ),
  });

  const currentPdfFile = tabsResult.currentPdfFile;
  const currentPage = tabsResult.currentPage;
  const sheetId = tabsResult.sheetId;

  // Derive scale/rotation from store so they stay in sync when switching tabs (no useEffect timing issues)
  const scale = useDocumentViewStore((s) =>
    sheetId ? s.getDocumentScaleBySheet(sheetId) : 1
  );
  const rotation = useDocumentViewStore((s) =>
    sheetId ? s.getDocumentRotationBySheet(sheetId) : 0
  );

  useTakeoffWorkspaceProjectInit({
    projectId: projectId ?? undefined,
    isDev,
    onProjectFilesLoaded,
    setProjectFiles,
    setCurrentProject,
    clearProjectCalibrations,
    setCalibration,
    loadProjectTakeoffMeasurements,
    setShowProfitMarginDialog,
  });

  // Narrow selector: only current page calibration (avoids re-render when other pages' calibrations change)
  const currentCalibration = useCalibrationStore(useShallow((s) =>
    s.getCalibration(projectId ?? '', currentPdfFile?.id ?? '', currentPage ?? 1)
  ));

  const visualSearch = useTakeoffWorkspaceVisualSearch({
    projectId: projectId ?? undefined,
    currentPdfFile,
    currentPage,
    selectedSheet,
    isDev,
  });

  // Current calibration for the active document/page (narrow selector in parent)
  const calibration = useTakeoffWorkspaceCalibration({
    currentCalibration,
    isDev,
  });

  // Persist scroll position on unload/refresh so viewport restores to same spot (per-tab)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!tabsResult.sheetId) return;
      const pos = getCurrentScrollPosition();
      if (pos) setDocumentLocationBySheet(tabsResult.sheetId, pos);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [tabsResult.sheetId, setDocumentLocationBySheet]);

  // Handle measurement state changes from PDFViewer
  // CRITICAL: Wrapped in useCallback to prevent infinite re-render loops
  const handleMeasurementStateChange = useCallback((measuring: boolean, calibrating: boolean, type: string, orthoSnapping: boolean) => {
    setIsMeasuring(measuring);
    setIsCalibrating(calibrating);
    setMeasurementType(type);
    setIsOrthoSnapping(orthoSnapping);
  }, []);

  // CRITICAL: Wrapped in useCallback to prevent re-render loops
  const handleToolSelect = useCallback((_tool: string) => {
    // Tool selection handled by TakeoffSidebar internally; no-op for now
  }, []);

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

  const handleAddHyperlink = useCallback(() => {
    setAnnotationTool(null); // Exit annotation mode if active
    setHyperlinkMode(true);
  }, []);

  const titleblock = useTakeoffWorkspaceTitleblock({
    projectId: projectId ?? undefined,
    documents,
    projectFiles,
    loadProjectDocuments,
    setDocuments,
    handlePageSelect: tabsResult.handlePageSelect,
    isDev,
  });

  /** Invoked by PDFViewer when mounted: Space uses this to enter draw mode from plan-only selection. */
  const enterConditionDrawModeFromPlanRef = useRef<(() => void) | null>(null);

  const handleRegisterEnterConditionDrawMode = useCallback((handler: (() => void) | null) => {
    enterConditionDrawModeFromPlanRef.current = handler;
  }, []);

  /** Condition id last cleared via Space — next Space re-selects it (toggle). */
  const lastSpaceDeselectedConditionIdRef = useRef<string | null>(null);

  useEffect(() => {
    lastSpaceDeselectedConditionIdRef.current = null;
  }, [projectId]);

  // Global keydown: Space (toggle selection off/on), H (add hyperlink), Cmd/Ctrl+Z (undo), Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y (redo)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isTyping = isEditableKeyboardTarget(event.target);

      if (event.code === 'Space') {
        if (isTyping) return;

        const currentlySelected = getSelectedCondition();
        if (currentlySelected) {
          // Condition highlighted from the plan (selection-only) — Space enters draw mode for that condition instead of clearing it.
          const canEnterDrawFromPlanSelection =
            !isMeasuring &&
            !isCalibrating &&
            !cutoutMode &&
            !hyperlinkMode &&
            !annotationTool &&
            !titleblock.titleblockSelectionMode &&
            !visualSearch.visualSearchMode &&
            currentlySelected.type !== 'auto-count';

          if (canEnterDrawFromPlanSelection) {
            event.preventDefault();
            enterConditionDrawModeFromPlanRef.current?.();
            return;
          }

          event.preventDefault();
          lastSpaceDeselectedConditionIdRef.current = currentlySelected.id;
          handleConditionSelect(null);
          return;
        }

        const lastId = lastSpaceDeselectedConditionIdRef.current;
        if (lastId) {
          const condition = useConditionStore.getState().getConditionById(lastId);
          if (condition) {
            event.preventDefault();
            handleConditionSelect(condition);
          } else {
            lastSpaceDeselectedConditionIdRef.current = null;
          }
        }
        return;
      }

      // H: Add hyperlink (when not typing)
      if (!isTyping && (event.key === 'h' || event.key === 'H') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        handleAddHyperlink();
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
  }, [
    getSelectedCondition,
    handleConditionSelect,
    handleAddHyperlink,
    undo,
    redo,
    isMeasuring,
    isCalibrating,
    cutoutMode,
    hyperlinkMode,
    annotationTool,
    titleblock.titleblockSelectionMode,
    visualSearch.visualSearchMode,
  ]);

  const rotatePage = (direction: 'clockwise' | 'counterclockwise') => {
    const rotationStep = direction === 'clockwise' ? 90 : -90;
    const newRotation = (rotation + rotationStep) % 360;
    tabsResult.handleRotationChange(newRotation);
  };

  const ocr = useTakeoffWorkspaceOCR({
    projectId: projectId ?? undefined,
    projectFiles,
    loadProjectDocuments,
  });

  // CRITICAL: Wrapped in useCallback to prevent re-render loops in SheetSidebar
  const handleOcrSearchResults = useCallback((results: SearchResult[], query: string) => {
    setOcrSearchResults(results);
    setCurrentSearchQuery(query);
  }, []);

  const handleSearchResultSelect = useCallback((documentId: string, pageNumber: number, query: string) => {
    const trimmed = query.trim();
    setCurrentSearchQuery(trimmed);
    setOcrHighlightRequest({
      documentId,
      pageNumber,
      query: trimmed,
    });
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

  /** Cut-out mode is invalid without the matching condition selected (e.g. deselect, auto-count completion). */
  useEffect(() => {
    if (!cutoutMode || cutoutTargetConditionId == null) return;
    if (selectedConditionId !== cutoutTargetConditionId) {
      setCutoutMode(false);
      setCutoutTargetConditionId(null);
    }
  }, [selectedConditionId, cutoutMode, cutoutTargetConditionId]);

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
      tabsResult.handleScaleChange(1);
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
      const currentPageToPreserve = currentPage;
      
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
      
      // If page changed during calibration, restore via tab replace
      if (currentPdfFile && currentPage !== currentPageToPreserve) {
        if (isDev) console.warn('⚠️ Page changed during calibration, restoring:', { from: currentPage, to: currentPageToPreserve });
        tabsResult.handlePageSelect(currentPdfFile.id, currentPageToPreserve);
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
  }, [currentPdfFile, projectId, currentPage, tabsResult, setCalibration, isDev]);

  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    try {
      const files = input.files;

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

      setUploading(true);
      try {
        // Process files sequentially to avoid overwhelming the server
        const uploadedFiles: ProjectFile[] = [];
        const failedFiles: Array<{ name: string; error: string }> = [];

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
            const errorMessage = extractErrorMessage(error, 'Failed to upload PDF file.');
            failedFiles.push({ name: file.name, error: errorMessage });
          }
        }

        // Refresh project files
        const filesRes = await fileService.getProjectFiles(projectId);
        const projectFilesList = (filesRes.files || []) as ProjectFile[];
        setProjectFiles(projectFilesList);

        // Refresh documents list to show newly uploaded files in sidebar
        // Pass fresh files so we use them immediately (setState is async)
        if (uploadedFiles.length > 0) {
          await loadProjectDocuments(projectFilesList);
        }

        // Open the first successfully uploaded file in a tab
        if (uploadedFiles.length > 0) {
          const file = uploadedFiles[0] as ProjectFile & { originalName?: string };
          tabsResult.handlePageSelect(file.id, 1);
        }

        // Show summary if there were failures
        if (failedFiles.length > 0) {
          const successCount = uploadedFiles.length;
          const failCount = failedFiles.length;
          const failMessages = failedFiles.map((f) => `${f.name}: ${f.error}`).join('; ');
          toast.warning(`Upload: ${successCount} succeeded, ${failCount} failed. ${failMessages}`);
        } else if (uploadedFiles.length > 1) {
          toast.success(`Successfully uploaded ${uploadedFiles.length} files! OCR processing has started automatically in the background.`);
        }
      } catch (error: unknown) {
        console.error('Upload failed:', error);
        const errorMessage = extractErrorMessage(error, 'Failed to upload PDF file.');

        toast.error(`Upload Error: ${errorMessage}`);
      } finally {
        setUploading(false);
      }
    } finally {
      input.value = '';
    }
  };

  const handleBackToProjects = () => {
    navigate('/app');
  };

  const handleClearHyperlinks = useCallback(() => {
    useHyperlinkStore.getState().clearAllHyperlinks();
    toast.success('All hyperlinks cleared');
  }, []);

  const [hyperlinkPickerOpen, setHyperlinkPickerOpen] = useState(false);
  const [hyperlinkContextMenu, setHyperlinkContextMenu] = useState<{
    hyperlinkId: string;
    x: number;
    y: number;
  } | null>(null);
  const [editingHyperlinkId, setEditingHyperlinkId] = useState<string | null>(null);
  const [pendingHyperlink, setPendingHyperlink] = useState<{
    rect: { x: number; y: number; width: number; height: number };
    sourceSheetId: string;
    sourcePageNumber: number;
  } | null>(null);

  const handleHyperlinkRegionDrawn = useCallback(
    (rect: { x: number; y: number; width: number; height: number }, sourceSheetId: string, sourcePageNumber: number) => {
      setPendingHyperlink({ rect, sourceSheetId, sourcePageNumber });
      setHyperlinkPickerOpen(true);
    },
    []
  );

  const handleHyperlinkTargetSelect = useCallback(
    (targetSheetId: string, targetPageNumber: number) => {
      if (!projectId || !pendingHyperlink) return;
      const { addHyperlink } = useHyperlinkStore.getState();
      addHyperlink({
        projectId,
        sourceSheetId: pendingHyperlink.sourceSheetId,
        sourcePageNumber: pendingHyperlink.sourcePageNumber,
        sourceRect: pendingHyperlink.rect,
        targetSheetId,
        targetPageNumber,
      });
      setHyperlinkMode(false);
      setPendingHyperlink(null);
      setHyperlinkPickerOpen(false);
      toast.success('Hyperlink created');
    },
    [projectId, pendingHyperlink]
  );

  const handleHyperlinkPickerCancel = useCallback(() => {
    setHyperlinkMode(false);
    setPendingHyperlink(null);
    setEditingHyperlinkId(null);
    setHyperlinkPickerOpen(false);
  }, []);

  const handleHyperlinkContextMenu = useCallback((hyperlinkId: string, clientX: number, clientY: number) => {
    setHyperlinkContextMenu({ hyperlinkId, x: clientX, y: clientY });
  }, []);

  const handleHyperlinkEdit = useCallback(() => {
    if (!hyperlinkContextMenu) return;
    const hyperlink = useHyperlinkStore.getState().getHyperlinkById(hyperlinkContextMenu.hyperlinkId);
    if (hyperlink) {
      setPendingHyperlink(null);
      setEditingHyperlinkId(hyperlink.id);
      setHyperlinkPickerOpen(true);
    }
    setHyperlinkContextMenu(null);
  }, [hyperlinkContextMenu]);

  const handleHyperlinkDelete = useCallback(() => {
    if (!hyperlinkContextMenu) return;
    useHyperlinkStore.getState().deleteHyperlink(hyperlinkContextMenu.hyperlinkId);
    toast.success('Hyperlink removed');
    setHyperlinkContextMenu(null);
  }, [hyperlinkContextMenu]);

  const handleHyperlinkDeleteFromDialog = useCallback(() => {
    if (!editingHyperlinkId) return;
    useHyperlinkStore.getState().deleteHyperlink(editingHyperlinkId);
    setEditingHyperlinkId(null);
    setHyperlinkPickerOpen(false);
    toast.success('Hyperlink removed');
  }, [editingHyperlinkId]);

  const handleHyperlinkUpdate = useCallback(
    (targetSheetId: string, targetPageNumber: number) => {
      if (!editingHyperlinkId) return;
      useHyperlinkStore.getState().updateHyperlink(editingHyperlinkId, {
        targetSheetId,
        targetPageNumber,
      });
      setEditingHyperlinkId(null);
      setHyperlinkPickerOpen(false);
      toast.success('Hyperlink updated');
    },
    [editingHyperlinkId]
  );

  const storeCurrentProject = getCurrentProject();
  const currentProject = storeCurrentProject || {
    name: '—',
    client: '—',
    lastSaved: '—'
  };

  return (
    <div className="app-shell h-screen flex flex-col bg-background">
      <TakeoffWorkspaceHeader
        onBackToProjects={handleBackToProjects}
        currentPage={currentPage}
        totalPages={totalPages}
        currentPdfFile={currentPdfFile}
        onPageChange={tabsResult.handlePageChange}
        scale={scale}
        onScaleChange={tabsResult.handleScaleChange}
        onResetView={handleResetView}
        onRotatePage={rotatePage}
        isPageCalibrated={calibration.isPageCalibrated}
        onCalibrateScale={handleCalibrateScale}
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
        onAddHyperlink={handleAddHyperlink}
        onClearHyperlinks={handleClearHyperlinks}
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
              onPageSelect={tabsResult.handlePageSelect}
              onPageOpenInNewTab={tabsResult.handlePageOpenInNewTab}
              onExportStatusUpdate={handleExportStatusUpdate}
              onCutoutMode={handleCutoutMode}
              cutoutMode={cutoutMode}
              cutoutTargetConditionId={cutoutTargetConditionId}
              viewerDocumentId={currentPdfFile?.id ?? null}
              currentPage={currentPage}
            />
          )}
          <SidebarEdgeToggle
            side="left"
            open={leftSidebarOpen}
            onOpenChange={setLeftSidebarOpen}
          />
        </div>

        {/* PDF Viewer - Fixed height container */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {tabsResult.hasTabs && (
            <PDFViewerTabBar
              projectId={projectId ?? ''}
              tabs={tabsResult.openTabs}
              activeTabId={tabsResult.activeTabId}
              onTabSelect={tabsResult.handleTabSelect}
              onTabClose={tabsResult.handleTabClose}
              onCloseAllOtherTabs={tabsResult.handleCloseAllOtherTabs}
            />
          )}
          <TakeoffWorkspaceModeBanners
            visualSearchMode={visualSearch.visualSearchMode}
            visualSearchCondition={visualSearch.visualSearchCondition}
            titleblockSelectionMode={titleblock.titleblockSelectionMode}
          />
          {currentPdfFile ? (
            <PDFViewer 
              file={currentPdfFile}
              projectId={projectId ?? undefined}
              className="h-full"
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={tabsResult.handlePageChange}
              scale={scale}
              onScaleChange={tabsResult.handleScaleChange}
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
              ocrHighlightRequest={ocrHighlightRequest}
              cutoutMode={cutoutMode}
              cutoutTargetConditionId={cutoutTargetConditionId}
              onCutoutModeChange={handleCutoutMode}
              onMeasurementStateChange={handleMeasurementStateChange}
              onLocationChange={tabsResult.handleLocationChange}
              onPDFRendered={tabsResult.handlePDFRendered}
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
              hyperlinkMode={hyperlinkMode}
              onHyperlinkRegionDrawn={handleHyperlinkRegionDrawn}
              onHyperlinkModeChange={setHyperlinkMode}
              onHyperlinkClick={(sheetId, pageNumber) => tabsResult.handlePageOpenInNewTab(sheetId, pageNumber)}
              onHyperlinkContextMenu={handleHyperlinkContextMenu}
              onRegisterEnterConditionDrawMode={handleRegisterEnterConditionDrawMode}
            />
          ) : !projectFilesListReady ? (
            <div className="flex flex-col items-center justify-center flex-1 bg-muted/30 gap-3" role="status" aria-live="polite">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <p className="text-sm text-muted-foreground">Loading project…</p>
            </div>
          ) : documentsLoading ? (
            <div className="flex flex-col items-center justify-center flex-1 bg-muted/30 gap-3" role="status" aria-live="polite">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <p className="text-sm text-muted-foreground">Loading documents…</p>
            </div>
          ) : documents.length === 0 ? (
            <EmptyDocumentsPlaceholder onPdfUpload={handlePdfUpload} uploading={uploading} />
          ) : (
            <div className="flex items-center justify-center flex-1 bg-muted/30">
              <div className="text-muted-foreground">Select a sheet</div>
            </div>
          )}
          <SearchResultsList results={[]} />
        </div>

        <TakeoffWorkspaceRightSidebar
          rightSidebarOpen={rightSidebarOpen}
          onRightSidebarOpenChange={setRightSidebarOpen}
          rightSidebarTab={rightSidebarTab}
          onRightSidebarTabChange={setRightSidebarTab}
          projectId={storeCurrentProject?.id ?? projectId ?? ''}
          documents={documents}
          documentsLoading={!projectFilesListReady || documentsLoading}
          onPageSelect={tabsResult.handlePageSelect}
          onSearchResultSelect={handleSearchResultSelect}
          onPageOpenInNewTab={tabsResult.handlePageOpenInNewTab}
          selectedDocumentId={selectedDocumentId || undefined}
          selectedPageNumber={selectedPageNumber || undefined}
          onOCRRequest={ocr.handleOCRRequest}
          onOcrSearchResults={handleOcrSearchResults}
          onDocumentsUpdate={handleDocumentsUpdate}
          onReloadDocuments={loadProjectDocuments}
          onStartOcrTracking={ocr.startOcrTracking}
          onPdfUpload={handlePdfUpload}
          uploading={uploading}
          onExtractTitleblockForDocument={titleblock.handleExtractTitleblockForDocument}
          onBulkExtractTitleblock={titleblock.handleBulkExtractTitleblock}
          onRotateAllSheetsInDocument={tabsResult.handleRotateAllSheetsInDocument}
        />
      </div>

      <TakeoffWorkspaceStatusBar
        selectedSheet={selectedSheet}
        currentProject={currentProject}
        selectedCondition={selectedCondition}
        exportStatus={exportStatus}
        titleblockExtractionStatus={titleblock.titleblockExtractionStatus}
        onCancelTitleblockExtraction={titleblock.cancelTitleblockExtraction}
        ocrJobs={ocr.ocrJobs}
        uploading={uploading}
        isMeasuring={isMeasuring}
        isCalibrating={isCalibrating}
        measurementType={measurementType}
      />

      <ExportProgressOverlay exportStatus={exportStatus} />

      <TakeoffWorkspaceDialogs
        projectId={projectId ?? null}
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
      />

      <HyperlinkSheetPickerDialog
        open={hyperlinkPickerOpen}
        onOpenChange={setHyperlinkPickerOpen}
        documents={documents}
        projectFiles={projectFiles}
        excludeSheetId={editingHyperlinkId ? undefined : currentPdfFile?.id}
        excludePageNumber={editingHyperlinkId ? undefined : (currentPage ?? undefined)}
        initialTargetSheetId={
          editingHyperlinkId
            ? useHyperlinkStore.getState().getHyperlinkById(editingHyperlinkId)?.targetSheetId
            : undefined
        }
        initialTargetPageNumber={
          editingHyperlinkId
            ? useHyperlinkStore.getState().getHyperlinkById(editingHyperlinkId)?.targetPageNumber
            : undefined
        }
        onSelect={editingHyperlinkId ? handleHyperlinkUpdate : handleHyperlinkTargetSelect}
        isEditMode={!!editingHyperlinkId}
        onDeleteLink={editingHyperlinkId ? handleHyperlinkDeleteFromDialog : undefined}
        onCancel={handleHyperlinkPickerCancel}
      />

      {hyperlinkContextMenu && (
        <HyperlinkContextMenu
          x={hyperlinkContextMenu.x}
          y={hyperlinkContextMenu.y}
          hyperlinkId={hyperlinkContextMenu.hyperlinkId}
          onEdit={handleHyperlinkEdit}
          onDelete={handleHyperlinkDelete}
          onClose={() => setHyperlinkContextMenu(null)}
        />
      )}

    </div>
  );
}