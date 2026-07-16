import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery';

import { useParams, useNavigate } from 'react-router-dom';
import PDFViewer from './PDFViewer';
import { TakeoffSidebar } from './TakeoffSidebar';
import { Button } from './ui/button';
import { CommandPalette, type CommandItem } from './CommandPalette';
import { ScheduleReviewDialog, type ScheduleApplyGroup } from './ScheduleReviewDialog';
import { RevisionCompareDialog } from './RevisionCompareDialog';
import { generateDistinctColor } from '../utils/commonUtils';

import { useShallow } from 'zustand/react/shallow';
import { useProjectStore } from '../store/slices/projectSlice';
import { useConditionStore } from '../store/slices/conditionSlice';
import { useMeasurementStore } from '../store/slices/measurementSlice';
import { useCalibrationStore } from '../store/slices/calibrationSlice';
import { useAnnotationStore } from '../store/slices/annotationSlice';
import { useHyperlinkStore } from '../store/slices/hyperlinkSlice';
import { useDocumentViewStore } from '../store/slices/documentViewSlice';
import { useViewStoresHydrated } from '../store/useViewStoresHydrated';
import { useUndoStore } from '../store';
import type { TakeoffCondition, Sheet, ProjectFile, PDFDocument, SearchResult, SheetHyperlink } from '../types';
import type { DocumentOCRData } from '../services/serverOcrService';
import { toast } from 'sonner';
import { applyBatchHyperlinkResults, runBatchHyperlinks } from '../services/batchHyperlink/runBatchHyperlinks';
import { runBatchHyperlinkPreflight } from '../services/batchHyperlink/batchHyperlinkPreflight';
import { formatAutoHyperlinkToast } from '../services/batchHyperlink/formatAutoHyperlinkToast';
import { runPymupdfExtractForDocument } from '../services/batchHyperlink/runPymupdfExtractForDocument';
import { runBubbleOcrForDocument } from '../services/batchHyperlink/runBubbleOcrForDocument';
import { buildCalloutPassWordBoxes } from '../services/batchHyperlink/buildCalloutPassWordBoxes';
import type { BatchOcrWordBox } from '../services/batchHyperlink/detectSheetRefsFromWordBoxes';
import { fetchStoredOcrForDocument } from '../services/batchHyperlink/fetchStoredOcrForDocument';
import { runVectorCalloutsForDocument, type VectorCalloutClient } from '../services/batchHyperlink/runVectorCalloutsForDocument';
import { resolveTargetViews } from '../services/batchHyperlink/resolveTargetViews';
import { BatchHyperlinkReviewDialog } from './BatchHyperlinkReviewDialog';
import type { SkippedRefSample } from '../services/batchHyperlink/runBatchHyperlinks';
import { devLog } from '../lib/devLog';
import {
  triggerCalibration,
  triggerFitToWindow,
  getCurrentScrollPosition,
  centerViewportOnPoint,
  getNormalizedViewportCenter,
} from '../lib/windowBridge';
import { fileService } from '../services/apiService';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL_MB } from '../constants/deliveryLimits';
import { SidebarEdgeToggle } from './takeoff-workspace/SidebarEdgeToggle';
import { TakeoffWorkspaceHeader } from './takeoff-workspace/TakeoffWorkspaceHeader';
import { TakeoffWorkspaceStatusBar } from './takeoff-workspace/TakeoffWorkspaceStatusBar';
import { TakeoffWorkspaceRightSidebar } from './takeoff-workspace/TakeoffWorkspaceRightSidebar';
import { TakeoffWorkspaceModeBanners } from './takeoff-workspace/TakeoffWorkspaceModeBanners';
import { TakeoffFloatingToolbar } from './takeoff-workspace/TakeoffFloatingToolbar';
import { ExportProgressOverlay } from './takeoff-workspace/ExportProgressOverlay';
import { TakeoffWorkspaceDialogs } from './takeoff-workspace/TakeoffWorkspaceDialogs';
import { useTakeoffWorkspaceDocuments } from './takeoff-workspace/useTakeoffWorkspaceDocuments';
import { useTakeoffWorkspaceVisualSearch } from './takeoff-workspace/useTakeoffWorkspaceVisualSearch';
import { useTakeoffWorkspaceTitleblock } from './takeoff-workspace/useTakeoffWorkspaceTitleblock';
import { useTakeoffWorkspaceOCR } from './takeoff-workspace/useTakeoffWorkspaceOCR';
import { useTakeoffWorkspaceProjectInit } from './takeoff-workspace/useTakeoffWorkspaceProjectInit';
import { useTakeoffWorkspaceCalibration } from './takeoff-workspace/useTakeoffWorkspaceCalibration';
import { useTakeoffWorkspaceTabs, getSheetLabel } from './takeoff-workspace/useTakeoffWorkspaceTabs';
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
  /** Magic wand: click inside enclosed rooms to auto-measure (area/volume condition selected). */
  const [magicWandMode, setMagicWandMode] = useState(false);

  const handleToggleMagicWand = useCallback(() => {
    const next = !magicWandMode;
    setMagicWandMode(next);
    if (next) {
      setHyperlinkMode(false);
      setAnnotationTool(null);
      toast.info(
        'Magic wand on — select an area/volume condition, then click inside an enclosed room. Esc exits.',
        { duration: 5000 }
      );
    }
  }, [magicWandMode]);

  // Schedule→takeoff: box a schedule on the sheet → parsed table review →
  // count conditions with markers on the schedule rows. The box-draw phase
  // piggybacks the hyperlink draw path (same interaction, different callback).
  const [scheduleSelectMode, setScheduleSelectMode] = useState(false);
  const [scheduleTable, setScheduleTable] = useState<{
    documentId: string;
    pageNumber: number;
    mode: 'ruled' | 'clustered';
    rows: string[][];
    rowBoxes: Array<{ y0: number; y1: number }>;
    region: { x0: number; y0: number; x1: number; y1: number };
  } | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);

  const handleStartScheduleSelect = useCallback(() => {
    setScheduleSelectMode(true);
    setHyperlinkMode(false);
    setMagicWandMode(false);
    setAnnotationTool(null);
    toast.info('Drag a box around the schedule table (headers included).', { duration: 5000 });
  }, []);

  const handleScheduleRegionDrawn = useCallback(
    async (
      rect: { x: number; y: number; width: number; height: number },
      sourceSheetId: string,
      sourcePageNumber: number
    ) => {
      setScheduleSelectMode(false);
      if (!projectId) return;
      const parsing = toast.loading('Reading schedule…');
      try {
        const { ocrApiService } = await import('../services/apiService');
        const result = await ocrApiService.runTableExtract(
          sourceSheetId,
          projectId,
          sourcePageNumber,
          rect
        );
        toast.dismiss(parsing);
        if (!result.rows || result.rows.length === 0) {
          toast.error('No table found in that box. Include the whole schedule and try again.');
          return;
        }
        setScheduleTable({
          documentId: sourceSheetId,
          pageNumber: sourcePageNumber,
          mode: result.mode,
          rows: result.rows,
          rowBoxes: result.rowBoxes,
          region: result.region,
        });
        setScheduleDialogOpen(true);
      } catch (e) {
        toast.dismiss(parsing);
        console.error('Schedule extract failed:', e);
        // Surface the server's details field (axios wraps it) — "no vector
        // text on this page" beats "Request failed with status code 500".
        const responseData = (e as { response?: { data?: { details?: string; error?: string } } })
          .response?.data;
        toast.error(
          responseData?.details ||
            responseData?.error ||
            (e instanceof Error ? e.message : 'Schedule extraction failed')
        );
      }
    },
    [projectId]
  );

  const handleScheduleApply = useCallback(
    async (groups: ScheduleApplyGroup[]) => {
      if (!projectId || !scheduleTable) return;
      const conditionStore = useConditionStore.getState();
      const { addTakeoffMeasurement } = useMeasurementStore.getState();
      const existingColors = conditionStore
        .getProjectConditions(projectId)
        .map((c) => c.color)
        .filter((c): c is string => typeof c === 'string');
      let conditionsCreated = 0;
      let markersCreated = 0;
      try {
        for (const group of groups) {
          const color = generateDistinctColor(existingColors);
          existingColors.push(color);
          const conditionId = await conditionStore.addCondition({
            projectId,
            name: group.name,
            type: 'count',
            unit: 'EA',
            wasteFactor: 0,
            color,
            description: 'From schedule takeoff',
          });
          conditionsCreated += 1;

          // Markers sit ON the schedule rows: auditable against the printed
          // schedule, movable to real plan locations afterwards. A grouped
          // condition (door type) drops its markers beside every source row.
          let groupBudget = 200; // sanity cap per condition
          for (const markerRow of group.markerRows) {
            const rowBox = scheduleTable.rowBoxes[markerRow.rowIndex];
            const y = rowBox ? (rowBox.y0 + rowBox.y1) / 2 : scheduleTable.region.y0;
            const xStart = Math.min(0.98, scheduleTable.region.x1 + 0.006);
            const qty = Math.min(markerRow.qty, groupBudget);
            groupBudget -= qty;
            for (let i = 0; i < qty; i++) {
              const point = { x: Math.min(0.995, xStart + i * 0.007), y };
              await addTakeoffMeasurement({
                projectId,
                sheetId: scheduleTable.documentId,
                conditionId,
                type: 'count',
                points: [point],
                calculatedValue: 1,
                unit: 'EA',
                pdfPage: scheduleTable.pageNumber,
                pdfCoordinates: [point],
                conditionColor: color,
                conditionName: group.name,
              });
              markersCreated += 1;
            }
            if (groupBudget <= 0) break;
          }
        }
        toast.success(
          `Schedule applied: ${conditionsCreated} condition${conditionsCreated === 1 ? '' : 's'}, ${markersCreated} count markers`,
          { description: 'Markers sit beside their schedule rows — drag them onto the plan if needed.' }
        );
      } catch (e) {
        console.error('Schedule apply failed:', e);
        toast.error(
          `Schedule partially applied (${conditionsCreated} conditions, ${markersCreated} markers). Check connection and retry remaining rows.`
        );
      }
    },
    [projectId, scheduleTable]
  );

  // Revision compare (old rev vs new rev overlay + takeoff carry)
  const [revisionCompareOpen, setRevisionCompareOpen] = useState(false);

  // ⌘K / Ctrl+K command palette
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  
  // Annotation states
  const [annotationTool, setAnnotationTool] = useState<'text' | 'arrow' | 'rectangle' | 'circle' | 'freehand-highlight' | null>(null);
  const [annotationColor, setAnnotationColor] = useState<string>('#FF0000');
  const [annotationFilled, setAnnotationFilled] = useState<boolean>(false);
  
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

  // Below lg (1024 px) sidebars become fixed drawers that overlay the canvas.
  const isTablet = useMediaQuery('(max-width: 1023px)');
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);

  // Close left sidebar when entering tablet layout so the canvas is fully visible.
  useEffect(() => {
    if (isTablet) setLeftSidebarOpen(false);
  }, [isTablet]);
  
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

  const viewStoresHydrated = useViewStoresHydrated();
  const currentPdfFile = tabsResult.currentPdfFile;
  const currentPage = tabsResult.currentPage;
  const sheetId = tabsResult.sheetId;

  // Show sidebar page count immediately; PDFViewer refines via onPDFLoaded when the file opens.
  useEffect(() => {
    if (!currentPdfFile?.id) {
      setTotalPages(0);
      return;
    }
    const doc = documents.find((d) => d.id === currentPdfFile.id);
    const cached = Math.max(doc?.totalPages ?? 0, doc?.pages?.length ?? 0);
    if (cached > 0) {
      setTotalPages(cached);
    }
  }, [currentPdfFile?.id, documents]);

  // Sync selectedSheet/DocumentId/PageNumber from the persisted activeTab when the workspace
  // mounts (after SPA navigation) or when the active tab / document data changes.
  // The Zustand tab store survives navigation, but the parent React state resets to null on
  // every mount — leaving the sidebar and status bar blank until the user manually clicks a sheet.
  useEffect(() => {
    const { activeTab } = tabsResult;
    if (!activeTab || !currentPdfFile || projectFiles.length === 0) return;

    const label = getSheetLabel(documents, projectFiles, activeTab.documentId, activeTab.pageNumber);
    const doc = documents.find((d) => d.id === activeTab.documentId);
    const page = doc?.pages?.find((p) => p.pageNumber === activeTab.pageNumber);

    setSelectedDocumentId(activeTab.documentId);
    setSelectedPageNumber(activeTab.pageNumber);
    setSelectedSheet({
      id: activeTab.documentId,
      name: label,
      pageNumber: activeTab.pageNumber,
      isVisible: page?.isVisible ?? true,
      hasTakeoffs: page?.hasTakeoffs ?? false,
      takeoffCount: page?.takeoffCount ?? 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable; activeTab identity + data deps are the real triggers
  }, [tabsResult.activeTab, currentPdfFile, documents, projectFiles]);

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

  // Persist scroll position on browser unload/refresh AND on SPA navigation (component unmount).
  // A ref tracks the current sheetId so the cleanup can save without re-running the effect on
  // every tab switch (which would save the wrong position when switching between sheets).
  const activeSheetIdRef = useRef<string | null>(null);
  activeSheetIdRef.current = tabsResult.sheetId;
  useEffect(() => {
    const saveScroll = () => {
      const id = activeSheetIdRef.current;
      if (!id) return;
      const pos = getCurrentScrollPosition();
      if (pos) setDocumentLocationBySheet(id, pos);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saveScroll();
    };
    window.addEventListener('beforeunload', saveScroll);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', saveScroll);
    return () => {
      window.removeEventListener('beforeunload', saveScroll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', saveScroll);
      // Also persist when the user navigates within the SPA (React Router unmounts this component
      // without firing beforeunload, so the last scroll position would otherwise be lost).
      saveScroll();
    };
  }, [setDocumentLocationBySheet]);

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

  /** Floating toolbar: finish the current in-progress measurement. */
  const finishMeasurementRef = useRef<(() => void) | null>(null);

  const handleRegisterFinishMeasurement = useCallback((handler: (() => void) | null) => {
    finishMeasurementRef.current = handler;
  }, []);

  /** Floating toolbar: cancel current drawing (Escape equivalent). */
  const handleFloatingCancel = useCallback(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
    );
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

      // Shift+H: Add hyperlink (when not typing)
      if (!isTyping && event.key === 'H' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
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
    if (conditionId) {
      // Activate drawing mode so SVG pointer-events are off, cursor is crosshair,
      // and click handlers enter the cutout branch immediately (isMeasuring=true required).
      enterConditionDrawModeFromPlanRef.current?.();
    }
  }, []);

  /** Exit cut-out mode when a different condition is selected. */
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

      const invalidFiles: string[] = [];

      Array.from(files).forEach((file) => {
        if (file.size > MAX_UPLOAD_BYTES) {
          invalidFiles.push(`${file.name} (${(file.size / (1024 * 1024)).toFixed(2)}MB)`);
        }
      });

      if (invalidFiles.length > 0) {
        toast.error(`Some files are too large! Maximum size is ${MAX_UPLOAD_LABEL_MB}MB (1GB). Large files: ${invalidFiles.join(', ')}. Please contact your admin to increase the Supabase Storage file size limit.`);
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

  // Hyperlinks are DB-backed: fetch the project's links once per session
  // (also performs the one-time import of pre-migration localStorage links).
  useEffect(() => {
    if (projectId) {
      void useHyperlinkStore.getState().loadProjectHyperlinks(projectId);
    }
  }, [projectId]);

  const handleClearHyperlinks = useCallback(() => {
    if (!projectId) return;
    useHyperlinkStore.getState().clearAllHyperlinks(projectId);
    toast.success('All hyperlinks cleared');
  }, [projectId]);

  const handleClearBatchHyperlinks = useCallback(() => {
    if (!projectId) return;
    const n = useHyperlinkStore.getState().clearBatchHyperlinksForProject(projectId);
    toast.success(n > 0 ? `Removed ${n} auto-hyperlink${n === 1 ? '' : 's'}` : 'No auto-hyperlinks to remove');
  }, [projectId]);

  const handlePreflightAutoHyperlink = useCallback(
    async (opts: { scope: 'project' | 'current' }) => {
      if (!projectId) throw new Error('No project');
      const freshDocs = (await loadProjectDocuments()) ?? documents;
      return runBatchHyperlinkPreflight({
        projectId,
        documents: freshDocs,
        scope: opts.scope,
        currentDocumentId: currentPdfFile?.id ?? null,
      });
    },
    [projectId, documents, loadProjectDocuments, currentPdfFile?.id]
  );

  const handleExecuteAutoHyperlink = useCallback(
    async (opts: {
      scope: 'project' | 'current';
      mode: 'strict' | 'loose';
      ocrByDocumentId: Map<string, DocumentOCRData>;
      runPymupdfFor?: Array<{ id: string; name: string; totalPages: number; hasNoStoredOcr: boolean }>;
      runBubbleOcrFor?: Array<{ id: string; name: string; totalPages: number; hasNoStoredOcr: boolean }>;
    }) => {
      if (!projectId) return;
      const freshDocs = (await loadProjectDocuments()) ?? documents;
      let progressToast: string | number | undefined;
      try {
        // Pre-step A: re-extract text with PyMuPDF (MuPDF) for any document whose stored OCR is
        // missing PyMuPDF-sourced word boxes. PDF.js silently drops glyphs in Type-3 fonts and
        // form XObjects with broken ToUnicode CMaps (which is exactly how callout-bubble text
        // in architectural PDFs disappears); PyMuPDF reads those reliably and finishes in
        // seconds per document.
        //
        // Pre-step B: region-targeted bubble OCR. HoughCircles detects every round callout
        // shape, Tesseract OCRs the small crop, and survivors are merged as
        // `source: 'bubble_ocr'`. This recovers detail-callout bubbles whose glyphs are stroked
        // vector paths (very common on plan-view sheets) and that no direct text engine can
        // read. The bubble pass tracks its own coverage so it keeps running on subsequent
        // Auto-hyperlink invocations until each doc is marked done (sentinel word box).
        const ocrMap = new Map(opts.ocrByDocumentId);
        const pymupdfTargets = opts.runPymupdfFor ?? [];
        const bubbleOcrTargets = opts.runBubbleOcrFor ?? [];
        let pymupdfPagesExtracted = 0;
        let pymupdfDocsRan = 0;
        let bubbleOcrDocsRan = 0;
        let bubbleOcrCalloutsFound = 0;
        let calloutPassPagesMatched = 0;
        let calloutPassWordBoxCount = 0;
        const touchedDocIds = new Set<string>();

        // Pre-step 0: vector callout pass. Reads callout circles/hexagons straight
        // from the PDF drawing commands and pairs them with exact text — the
        // precision path for CAD-exported sets. Reference callouts are merged into
        // stored OCR server-side (`source: 'vector_callout'`); the returned callout
        // map powers the review table and auto target views. Seconds per document,
        // so it runs on every invocation; the raster passes below stay as fallback
        // for flattened pages.
        const calloutsByPageKey = new Map<string, VectorCalloutClient[]>();
        const vectorDocs =
          opts.scope === 'current' && currentPdfFile?.id
            ? freshDocs.filter((d) => d.id === currentPdfFile.id)
            : freshDocs;
        let vectorReferenceCallouts = 0;

        progressToast = toast.loading(`Scanning callouts 0/${vectorDocs.length}…`);
        let vectorDocsDone = 0;
        let vectorCursor = 0;
        const vectorWorker = async () => {
          while (vectorCursor < vectorDocs.length) {
            const doc = vectorDocs[vectorCursor];
            vectorCursor += 1;
            try {
              const vec = await runVectorCalloutsForDocument({
                documentId: doc.id,
                projectId,
              });
              if (vec.referenceCallouts > 0) touchedDocIds.add(doc.id);
              vectorReferenceCallouts += vec.referenceCallouts;
              for (const [k, v] of vec.calloutsByPageKey) calloutsByPageKey.set(k, v);
            } catch (err) {
              console.error(`[auto-hyperlink] Vector callout pass failed for ${doc.name}:`, err);
              // Soft fail: raster passes below still cover this document.
            } finally {
              vectorDocsDone += 1;
              toast.loading(`Scanning callouts ${vectorDocsDone}/${vectorDocs.length}…`, {
                id: progressToast,
              });
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, vectorDocs.length) }, vectorWorker));

        let pymupdfDocsDone = 0;
        for (const target of pymupdfTargets) {
          touchedDocIds.add(target.id);
          try {
            const result = await runPymupdfExtractForDocument({
              documentId: target.id,
              projectId,
            });
            pymupdfDocsRan += 1;
            pymupdfPagesExtracted += result.pagesExtracted;
          } catch (err) {
            console.error(`[auto-hyperlink] PyMuPDF extract failed for ${target.name}:`, err);
            toast.error(
              `Re-extracting text from ${target.name} failed; continuing with saved text only.`,
            );
          } finally {
            pymupdfDocsDone += 1;
            toast.loading(`Re-extracting text ${pymupdfDocsDone}/${pymupdfTargets.length}…`, {
              id: progressToast,
            });
          }
        }

        let bubbleOcrDocsDone = 0;
        for (const target of bubbleOcrTargets) {
          touchedDocIds.add(target.id);
          try {
            const bubbleResult = await runBubbleOcrForDocument({
              documentId: target.id,
              projectId,
            });
            bubbleOcrDocsRan += 1;
            bubbleOcrCalloutsFound += bubbleResult.calloutsFound;
          } catch (err) {
            console.error(`[auto-hyperlink] Bubble OCR failed for ${target.name}:`, err);
            toast.error(
              `Scanning bubbles in ${target.name} failed; continuing with text-only matches.`,
            );
          } finally {
            bubbleOcrDocsDone += 1;
            toast.loading(`Scanning bubbles ${bubbleOcrDocsDone}/${bubbleOcrTargets.length}…`, {
              id: progressToast,
            });
          }
        }

        // Refresh stored OCR for every doc touched by either pre-pass so detection sees the
        // newly merged word boxes in a single map entry.
        for (const docId of touchedDocIds) {
          const refreshed = await fetchStoredOcrForDocument(docId, projectId);
          if (refreshed) ocrMap.set(docId, refreshed);
        }

        // Vector pass is authoritative on CAD exports (exact geometry + exact text); only fall
        // back to the slow raster template-matching pass when it found nothing to work with.
        const shouldRunCalloutPass =
          (opts.scope === 'current' ||
            pymupdfTargets.length > 0 ||
            bubbleOcrTargets.length > 0) &&
          vectorReferenceCallouts === 0;
        let visualWordBoxesByPageKey: Map<string, BatchOcrWordBox[]> | undefined;
        if (shouldRunCalloutPass) {
          try {
            const callout = await buildCalloutPassWordBoxes({
              projectId,
              documents: freshDocs,
              scope: opts.scope,
              currentDocumentId: currentPdfFile?.id ?? null,
            });
            visualWordBoxesByPageKey = callout.visualWordBoxesByPageKey;
            calloutPassPagesMatched = callout.calloutPagesMatched;
            calloutPassWordBoxCount = callout.calloutWordBoxCount;
          } catch (err) {
            console.error('[auto-hyperlink] Callout template pass failed:', err);
            toast.error(
              'Scanning split-circle and cloud callouts failed; continuing with text-only matches.',
            );
          }
        }

        toast.loading('Matching sheet references…', { id: progressToast });
        const run = await runBatchHyperlinks({
          projectId,
          documents: freshDocs,
          mode: opts.mode,
          scope: opts.scope,
          currentDocumentId: currentPdfFile?.id ?? null,
          ocrByDocumentId: ocrMap,
          visualWordBoxesByPageKey,
        });

        // Auto target views: match each link's source callout (detail label) to a
        // detail-title bubble on the target page so the link lands zoomed on the
        // exact detail. Only fills confident matches; others keep page navigation.
        const targetViews = resolveTargetViews(run.created, calloutsByPageKey);
        if (targetViews.linksWithViews > 0) {
          devLog(
            `[auto-hyperlink] ${targetViews.linksWithViews}/${run.createdCount} links got auto target views`
          );
        }
        if (import.meta.env.DEV) {
          // Diag: see which refs are failing so we can fix detection / index mismatches.
          const SHEET_SHAPE = /^[A-Z]{1,3}\d{1,3}(\.\d+)?$/;
          const sheetShapedNoTarget = run.topNoTargetRefs.filter(([r]) => SHEET_SHAPE.test(r));
          const sheetIndexKeys = freshDocs.flatMap((d) =>
            (d.pages ?? []).map((p) => ({ doc: d.id, page: p.pageNumber, sheet: p.sheetNumber }))
          );
          const diag = {
            created: run.createdCount,
            skippedNoTarget: run.skippedNoTarget,
            skippedAmbiguous: run.skippedAmbiguousTarget,
            skippedSelfLink: run.skippedSelfLink,
            sheetShapedNoTarget: sheetShapedNoTarget.map(([r, d, p, c]) => ({ ref: r, doc: d, page: p, count: c })),
            topNoTargetAll: run.topNoTargetRefs.map(([r, d, p, c]) => ({ ref: r, doc: d, page: p, count: c })),
            topAmbiguous: run.topAmbiguousRefs.map(([r, d, p, c]) => ({ ref: r, doc: d, page: p, count: c })),
            ambiguousKeysInIndex: run.ambiguousKeysInIndex,
            sheetIndexA9: sheetIndexKeys.filter((k) => typeof k.sheet === 'string' && /^A9/i.test(k.sheet)),
            sheetIndexAll: sheetIndexKeys,
            createdLinks: run.created.map((h) => ({
              ref: h.detectedSheetRef,
              sourceRect: h.sourceRect,
              targetSheetId: h.targetSheetId,
              targetPageNumber: h.targetPageNumber,
            })),
          };
          (window as unknown as { __autoHyperlinkDiag?: typeof diag }).__autoHyperlinkDiag = diag;
          console.log(
            '[auto-hyperlink] diagnostic dump stored on window.__autoHyperlinkDiag. ' +
              'Run: copy(JSON.stringify(window.__autoHyperlinkDiag, null, 2)) to copy to clipboard.'
          );
          console.log(diag);
        }
        if (run.createdCount === 0) {
          // Nothing to review — surface the detection stats so the user sees why.
          const { title, description } = formatAutoHyperlinkToast(run, {
            pymupdfDocsRan,
            pymupdfPagesExtracted,
            bubbleOcrDocsRan,
            bubbleOcrCalloutsFound,
            calloutPassPagesMatched,
            calloutPassWordBoxCount,
          });
          if (progressToast !== undefined) toast.dismiss(progressToast);
          toast.success(title, description ? { description } : undefined);
        } else {
          // Nothing is written yet — the review dialog applies on confirm.
          if (progressToast !== undefined) toast.dismiss(progressToast);
          setBatchReview({
            links: run.created,
            noTargetRefs: run.topNoTargetRefs,
            ambiguousRefs: run.topAmbiguousRefs,
          });
        }
      } catch (e) {
        if (progressToast !== undefined) toast.dismiss(progressToast);
        console.error(e);
        toast.error(e instanceof Error ? e.message : 'Auto-hyperlink failed');
        throw e;
      }
    },
    [projectId, documents, loadProjectDocuments, currentPdfFile?.id]
  );

  const [hyperlinkPickerOpen, setHyperlinkPickerOpen] = useState(false);
  /** Non-null while the user positions the view on a link's target page ("Set target view"). */
  const [viewCaptureHyperlinkId, setViewCaptureHyperlinkId] = useState<string | null>(null);
  /** Auto-hyperlink results awaiting user review; nothing is written until Apply. */
  const [batchReview, setBatchReview] = useState<{
    links: SheetHyperlink[];
    noTargetRefs: SkippedRefSample[];
    ambiguousRefs: SkippedRefSample[];
  } | null>(null);

  const handleBatchReviewApply = useCallback(
    (selected: SheetHyperlink[]) => {
      if (!projectId) return;
      applyBatchHyperlinkResults(selected, projectId, useHyperlinkStore.getState());
      const withViews = selected.filter((l) => l.targetViewport).length;
      toast.success(
        `Applied ${selected.length} hyperlink${selected.length === 1 ? '' : 's'}`,
        withViews > 0
          ? { description: `${withViews} land zoomed on the exact detail` }
          : undefined
      );
      setBatchReview(null);
    },
    [projectId]
  );
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

  /** Navigate to a link's target page and enter view-capture mode for it. */
  const startViewCapture = useCallback(
    (hyperlinkId: string, targetSheetId: string, targetPageNumber: number) => {
      tabsResult.handlePageOpenInNewTab(targetSheetId, targetPageNumber);
      setViewCaptureHyperlinkId(hyperlinkId);
    },
    [tabsResult]
  );

  const handleHyperlinkTargetSelect = useCallback(
    (targetSheetId: string, targetPageNumber: number, setViewAfter?: boolean) => {
      if (!projectId || !pendingHyperlink) return;
      const { addHyperlink } = useHyperlinkStore.getState();
      const created = addHyperlink({
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
      if (setViewAfter) {
        startViewCapture(created.id, targetSheetId, targetPageNumber);
      } else {
        toast.success('Hyperlink created');
      }
    },
    [projectId, pendingHyperlink, startViewCapture]
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
    (targetSheetId: string, targetPageNumber: number, setViewAfter?: boolean) => {
      if (!editingHyperlinkId) return;
      const linkId = editingHyperlinkId;
      const previous = useHyperlinkStore.getState().getHyperlinkById(linkId);
      const targetChanged =
        previous?.targetSheetId !== targetSheetId || previous?.targetPageNumber !== targetPageNumber;
      useHyperlinkStore.getState().updateHyperlink(linkId, {
        targetSheetId,
        targetPageNumber,
        // A saved view on the old target page makes no sense on the new one.
        ...(targetChanged ? { targetViewport: undefined } : {}),
      });
      setEditingHyperlinkId(null);
      setHyperlinkPickerOpen(false);
      if (setViewAfter) {
        startViewCapture(linkId, targetSheetId, targetPageNumber);
      } else {
        toast.success('Hyperlink updated');
      }
    },
    [editingHyperlinkId, startViewCapture]
  );

  const handleHyperlinkSetTargetView = useCallback(() => {
    if (!hyperlinkContextMenu) return;
    const hyperlink = useHyperlinkStore.getState().getHyperlinkById(hyperlinkContextMenu.hyperlinkId);
    setHyperlinkContextMenu(null);
    if (hyperlink && hyperlink.targetSheetId) {
      startViewCapture(hyperlink.id, hyperlink.targetSheetId, hyperlink.targetPageNumber);
    }
  }, [hyperlinkContextMenu, startViewCapture]);

  const handleSaveTargetView = useCallback(() => {
    if (!viewCaptureHyperlinkId) return;
    const center = getNormalizedViewportCenter();
    if (!center) {
      toast.error('Could not read the current view. Is the target sheet open?');
      return;
    }
    useHyperlinkStore.getState().updateHyperlink(viewCaptureHyperlinkId, {
      targetViewport: center,
    });
    setViewCaptureHyperlinkId(null);
    toast.success('Target view saved — the link now lands exactly here');
  }, [viewCaptureHyperlinkId]);

  // Command palette items: sheets, conditions, viewer actions. Rebuilt only
  // when the underlying lists change; actions close the palette themselves.
  const allConditions = useConditionStore((s) => s.conditions);
  const paletteItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      {
        id: 'action-calibrate',
        label: calibration.isPageCalibrated ? 'Recalibrate scale' : 'Calibrate scale',
        group: 'actions',
        keywords: 'scale calibration',
        action: handleCalibrateScale,
      },
      {
        id: 'action-wand',
        label: magicWandMode ? 'Turn off magic wand' : 'Magic wand (measure rooms by click)',
        group: 'actions',
        keywords: 'wand room fill auto measure',
        action: handleToggleMagicWand,
      },
      {
        id: 'action-fit',
        label: 'Fit sheet to window',
        group: 'actions',
        keywords: 'zoom reset view',
        action: handleResetView,
      },
      // Schedule → takeoff stays dev-only while OCR extraction is dialed in
      // (reads real text + outlined bodies via Tesseract; door-number ovals and
      // vertical headers still weak). The whole-sheet "Propose rooms" sweep was
      // shelved 2026-07: it flood-filled every enclosed region (text boxes,
      // schedule cells, hatches), not just rooms, with no way to preview before
      // applying — the click-to-fill Magic Wand covers rooms reliably instead.
      ...(import.meta.env.DEV
        ? [
            {
              id: 'action-schedule',
              label: 'Schedule → takeoff (box a schedule table)',
              group: 'actions' as const,
              keywords: 'schedule table door window count import',
              action: handleStartScheduleSelect,
            },
          ]
        : []),
      {
        id: 'action-revision-compare',
        label: 'Compare sheet revisions…',
        group: 'actions',
        keywords: 'revision diff overlay slip sheet compare carry addendum',
        action: () => setRevisionCompareOpen(true),
      },
    ];

    if (projectId) {
      for (const condition of allConditions) {
        if (condition.projectId !== projectId) continue;
        items.push({
          id: `condition-${condition.id}`,
          label: condition.name,
          sublabel: `${condition.type} · ${condition.unit}`,
          keywords: condition.type,
          group: 'conditions',
          action: () => setSelectedCondition(condition.id),
        });
      }
    }

    for (const doc of documents) {
      for (const page of doc.pages ?? []) {
        const num = page.sheetNumber && page.sheetNumber !== 'Unknown' ? page.sheetNumber : null;
        const name = page.sheetName && page.sheetName !== 'Unknown' ? page.sheetName : null;
        items.push({
          id: `sheet-${doc.id}-${page.pageNumber}`,
          label: num ?? `${doc.name} p.${page.pageNumber}`,
          sublabel: name ?? doc.name,
          keywords: `${name ?? ''} ${doc.name}`,
          group: 'sheets',
          action: () => tabsResult.handlePageOpenInNewTab(doc.id, page.pageNumber),
        });
      }
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers stable enough for palette rebuild purposes
  }, [
    allConditions,
    documents,
    projectId,
    calibration.isPageCalibrated,
    magicWandMode,
    handleToggleMagicWand,
    setSelectedCondition,
  ]);

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
        magicWandMode={magicWandMode}
        onToggleMagicWand={handleToggleMagicWand}
        annotationTool={annotationTool}
        annotationColor={annotationColor}
        annotationFilled={annotationFilled}
        onAnnotationToolChange={setAnnotationTool}
        onAnnotationColorChange={setAnnotationColor}
        onAnnotationFilledChange={setAnnotationFilled}
        onClearAnnotations={() => {
          setAnnotationTool(null);
          if (projectId && currentPdfFile?.id && selectedPageNumber) {
            clearPageAnnotations(projectId, currentPdfFile.id, selectedPageNumber);
          }
        }}
        isOrthoSnapping={isOrthoSnapping}
        isMeasuring={isMeasuring}
        isCalibrating={isCalibrating}
        hasSelectedCondition={Boolean(selectedCondition)}
        measurementType={measurementType}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => undo()}
        onRedo={() => redo()}
        onAddHyperlink={handleAddHyperlink}
        onClearHyperlinks={handleClearHyperlinks}
        onPreflightAutoHyperlink={handlePreflightAutoHyperlink}
        onExecuteAutoHyperlink={handleExecuteAutoHyperlink}
        onClearBatchHyperlinks={handleClearBatchHyperlinks}
        autoHyperlinkAvailable={Boolean(projectId && documents.length > 0)}
        currentDocumentId={currentPdfFile?.id ?? null}
      />

      {/* Main Content Area - Fixed height container */}
      {/* relative: positioning context for tablet drawer overlays */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Tablet backdrop — closes both drawers when tapped */}
        {isTablet && (leftSidebarOpen || rightSidebarOpen) && (
          <div
            className="absolute inset-0 bg-black/50 z-30"
            onClick={() => { setLeftSidebarOpen(false); setRightSidebarOpen(false); }}
            aria-hidden="true"
          />
        )}

        {/* Left sidebar column */}
        <div className="flex shrink-0">
          {/* Desktop: sidebar in flex flow.  Tablet: sidebar rendered as overlay below. */}
          {!isTablet && leftSidebarOpen && (
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

        {/* Tablet left-sidebar drawer overlay — absolute, left of toggle strip */}
        {isTablet && leftSidebarOpen && (
          <div className="absolute left-10 top-0 bottom-0 z-40 shadow-2xl overflow-hidden">
            <TakeoffSidebar
              className="h-full"
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
          </div>
        )}

        {/* PDF Viewer - Fixed height container */}
        <div className="relative flex-1 flex flex-col h-full overflow-hidden">
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
              annotationFilled={annotationFilled}
              onAnnotationToolChange={setAnnotationTool}
              visualSearchMode={visualSearch.visualSearchMode}
              visualSearchCondition={visualSearch.visualSearchCondition}
              onVisualSearchComplete={visualSearch.handleVisualSearchComplete}
              // Titleblock selection uses the same box-drawing interaction as visual search
              // but sends regions back through a separate callback.
              titleblockSelectionMode={titleblock.titleblockSelectionMode}
              onTitleblockSelectionComplete={titleblock.handleTitleblockSelectionComplete}
              // Schedule box-select piggybacks the hyperlink draw interaction:
              // same drag-a-box mechanics, different completion handler.
              hyperlinkMode={hyperlinkMode || scheduleSelectMode}
              onHyperlinkRegionDrawn={(rect, sheetId, pageNumber) => {
                if (scheduleSelectMode) void handleScheduleRegionDrawn(rect, sheetId, pageNumber);
                else handleHyperlinkRegionDrawn(rect, sheetId, pageNumber);
              }}
              onHyperlinkModeChange={(active) => {
                if (scheduleSelectMode) setScheduleSelectMode(active);
                else setHyperlinkMode(active);
              }}
              magicWandMode={magicWandMode}
              onMagicWandModeChange={setMagicWandMode}
              onHyperlinkClick={(sheetId, pageNumber, targetViewport) => {
                // Link view always wins: deepLinkTarget suppresses the post-render
                // fit/scroll-restore so it can't stomp the centered view applied below.
                // No stored view → forceFit: a bare link click fits-to-window and does
                // NOT inherit this page's saved plain-navigation position/zoom.
                tabsResult.handlePageOpenInNewTab(sheetId, pageNumber, {
                  deepLinkTarget: !!targetViewport,
                  forceFit: !targetViewport,
                });
                if (targetViewport) {
                  // After the tab switch's own scroll restore (200ms one-shot); the
                  // centering call retries internally while the page renders.
                  setTimeout(() => centerViewportOnPoint(targetViewport), 400);
                }
              }}
              onHyperlinkContextMenu={handleHyperlinkContextMenu}
              onRegisterEnterConditionDrawMode={handleRegisterEnterConditionDrawMode}
              onRegisterFinishMeasurement={handleRegisterFinishMeasurement}
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
          ) : !viewStoresHydrated ? (
            <div className="flex flex-col items-center justify-center flex-1 bg-muted/30 gap-3" role="status" aria-live="polite">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <p className="text-sm text-muted-foreground">Restoring workspace…</p>
            </div>
          ) : (
            <div className="flex items-center justify-center flex-1 bg-muted/30">
              <div className="text-muted-foreground">Select a sheet</div>
            </div>
          )}
          {/* Floating toolbar: touch-friendly equivalents for keyboard-only actions.
              Tablet-only — desktop users have Esc, double-click, and ⌘Z.
              Shown for any active drawing mode so Cancel/Undo are always reachable. */}
          <TakeoffFloatingToolbar
            visible={isTablet && (isMeasuring || isCalibrating || !!annotationTool || cutoutMode || hyperlinkMode)}
            showFinish={isMeasuring && measurementType !== 'count' && measurementType !== ''}
            canUndo={canUndo}
            onUndo={() => undo()}
            onCancel={handleFloatingCancel}
            onFinish={() => finishMeasurementRef.current?.()}
          />
          <SearchResultsList results={[]} />
        </div>

        <TakeoffWorkspaceRightSidebar
          isTabletDrawer={isTablet}
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
          onSetTargetView={handleHyperlinkSetTargetView}
          onClose={() => setHyperlinkContextMenu(null)}
        />
      )}

      {batchReview && (
        <BatchHyperlinkReviewDialog
          open={!!batchReview}
          onOpenChange={(next) => {
            if (!next) setBatchReview(null);
          }}
          links={batchReview.links}
          documents={documents}
          noTargetRefs={batchReview.noTargetRefs}
          ambiguousRefs={batchReview.ambiguousRefs}
          onApply={handleBatchReviewApply}
          onCancel={() => setBatchReview(null)}
        />
      )}

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={paletteItems} />

      <ScheduleReviewDialog
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
        table={scheduleTable}
        onApply={handleScheduleApply}
      />

      {projectId && (
        <RevisionCompareDialog
          open={revisionCompareOpen}
          onOpenChange={setRevisionCompareOpen}
          projectId={projectId}
          documents={documents}
          currentDocumentId={currentPdfFile?.id ?? null}
          currentPageNumber={currentPage ?? null}
        />
      )}

      {viewCaptureHyperlinkId && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[95] flex items-center gap-3 rounded-lg border bg-popover text-popover-foreground px-4 py-3 shadow-xl">
          <span className="text-sm">
            Pan and zoom to the exact spot this link should land on.
          </span>
          <Button size="sm" onClick={handleSaveTargetView}>
            Save target view
          </Button>
          <Button size="sm" variant="outline" onClick={() => setViewCaptureHyperlinkId(null)}>
            Cancel
          </Button>
        </div>
      )}


    </div>
  );
}