import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { useProjectStore } from '../store/slices/projectSlice';
import { useConditionStore } from '../store/slices/conditionSlice';
import { useMeasurementStore } from '../store/slices/measurementSlice';
import { useAnnotationStore } from '../store/slices/annotationSlice';
import { useUndoStore } from '../store/slices/undoSlice';
import type { Annotation } from '../types';
import type { PDFViewerProps, Measurement } from './PDFViewer.types';
import { usePDFLoad } from './pdf-viewer/usePDFLoad';
import { usePDFViewerCalibration } from './pdf-viewer/usePDFViewerCalibration';
import { usePDFViewerData } from './pdf-viewer/usePDFViewerData';
import { usePDFViewerMeasurements } from './pdf-viewer/usePDFViewerMeasurements';
import { usePDFViewerInteractions, PDF_VIEWER_MAX_SCALE } from './pdf-viewer/usePDFViewerInteractions';
import {
  renderSVGSelectionBox,
  renderSVGAnnotationDragBox,
  renderSVGCurrentCutout,
  renderSVGCrosshair,
  renderSVGMeasurement,
  renderSVGAnnotation,
  renderSVGCalibrationPoints,
  renderRunningLengthDisplay,
  renderSVGCurrentAnnotation,
  renderSVGCurrentMeasurement,
} from './pdf-viewer/pdfViewerRenderers';
import { PDFViewerCanvasOverlay } from './pdf-viewer/PDFViewerCanvasOverlay';
import { PDFViewerDialogs } from './pdf-viewer/PDFViewerDialogs';
import { PDFViewerStatusView } from './pdf-viewer/PDFViewerStatusView';
import { formatFeetAndInches } from '../lib/utils';
import { setRestoreScrollPosition, setGetCurrentScrollPosition, setTriggerCalibration, setTriggerFitToWindow } from '../lib/windowBridge';
import { calculateDistance } from '../utils/commonUtils';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerPort = null;

/** Safely convert API timestamp to ISO string; avoids RangeError for invalid dates */
function safeTimestampToISO(ts: string | number | undefined | null): string {
  if (ts == null || ts === '') return new Date().toISOString();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Normalized offset for pasted markups (~2% of page) so pasted markup is visible next to original */
const PASTE_OFFSET = 0.02;

/** Debounce (ms) for saving scroll position so we persist final position on reload */
const SCROLL_SAVE_DEBOUNCE_MS = 150;

const PDFViewer: React.FC<PDFViewerProps> = ({ 
  file, 
  className = '',
  currentPage: externalCurrentPage,
  totalPages: externalTotalPages,
  onPageChange,
  scale: externalScale,
  onScaleChange,
  rotation: externalRotation,
  onCalibrateScale,
  onClearAll,
  isPageCalibrated: externalIsPageCalibrated,
  scaleFactor: externalScaleFactor,
  unit: externalUnit,
  calibrationViewportWidth: externalCalibrationViewportWidth,
  calibrationViewportHeight: externalCalibrationViewportHeight,
  calibrationRotation: externalCalibrationRotation,
  onPDFLoaded,
  onCalibrationRequest,
  onCalibrationComplete,
  searchResults = [],
  currentSearchQuery = '',
  cutoutMode = false,
  cutoutTargetConditionId = null,
  onCutoutModeChange,
  onMeasurementStateChange,
  annotationTool = null,
  annotationColor = '#FF0000',
  onAnnotationToolChange,
  onLocationChange,
  onPDFRendered,
  // Visual search props
  visualSearchMode = false,
  visualSearchCondition = null,
  onVisualSearchComplete,
  // Titleblock selection props
  titleblockSelectionMode = null,
  onTitleblockSelectionComplete
}) => {
  const {
    pdfDocument,
    isLoading,
    error,
    internalTotalPages,
    setInternalTotalPages,
    internalCurrentPage,
    setInternalCurrentPage,
  } = usePDFLoad(file, {
    externalTotalPages,
    externalCurrentPage,
    onPDFLoaded,
  });

  // View state
  const [internalViewState, setInternalViewState] = useState({ 
    scale: 1.0, 
    rotation: 0
  });
  
  // Use external props when available, fall back to internal state
  const currentPage = externalCurrentPage ?? internalCurrentPage;
  const totalPages = externalTotalPages ?? internalTotalPages;
  
  const viewState = useMemo(() => ({ 
    scale: Math.min(PDF_VIEWER_MAX_SCALE, externalScale ?? internalViewState.scale), 
    rotation: externalRotation ?? internalViewState.rotation
  }), [externalScale, internalViewState.scale, externalRotation, internalViewState.rotation]);

  // PDF loading state
  const [isPDFLoading, setIsPDFLoading] = useState(false);
  
  // Track last fully rendered PDF scale to support interactive CSS zoom while blocking renders
  const lastRenderedScaleRef = useRef(1.0);
  
  // Helper to apply/remove interactive CSS zoom transforms when renders are blocked.
  // When called from wheel handler while renders are blocked, pass overrideScale so the
  // transform uses the new scale immediately (viewState hasn't updated yet).
  const applyInteractiveZoomTransforms = useCallback((overrideScale?: number) => {
    const canvas = pdfCanvasRef.current as HTMLCanvasElement | null;
    const svg = svgOverlayRef.current as SVGSVGElement | null;
    if (!canvas || !svg || !pdfPageRef.current) return;
    
    const renderedScale = lastRenderedScaleRef.current || 1.0;
    const effectiveScale = overrideScale ?? viewState.scale ?? 1.0;
    const targetScale = effectiveScale / renderedScale;
    
    // If targetScale is ~1, clear transforms
    if (Math.abs(targetScale - 1) < 0.0001) {
      canvas.style.transform = '';
      svg.style.transform = '';
      canvas.style.transformOrigin = '';
      svg.style.transformOrigin = '';
      return;
    }
    
    // Apply transform to both canvas and overlay to keep them in sync visually
    canvas.style.transformOrigin = '0 0';
    svg.style.transformOrigin = '0 0';
    canvas.style.transform = `scale(${targetScale})`;
    svg.style.transform = `scale(${targetScale})`;
  }, [viewState.scale]);
  
  // Refs - must be declared before calibration hook (hook needs pdfPageRef)
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const svgOverlayRef = useRef<SVGSVGElement>(null);
  const pdfPageRef = useRef<PDFPageProxy | null>(null);

  const [isDeselecting, setIsDeselecting] = useState(false);
  // Temporary measurement debug overlay (compare calc paths)
  const [measurementDebug, setMeasurementDebug] = useState<{
    page: number;
    mid: { x: number; y: number };
    dxNorm: number; dyNorm: number;
    baseW: number; baseH: number;
    pixelDistanceValidator: number;
    pixelDistanceMeasure: number;
    scaleFactorUsed: number;
    distanceValidatorFt: number;
    distanceMeasureFt: number;
  } | null>(null);
  
  // Ref for Cmd+scroll zoom: always call latest handleWheel so we can register document listener once
  const handleWheelRef = useRef<((e: WheelEvent) => void) | null>(null);

  // Refs - Single Canvas + SVG Overlay System (containerRef, pdfCanvasRef, svgOverlayRef, pdfPageRef declared above for calibration hook)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const isRenderingRef = useRef<boolean>(false);
  const isMarkupRenderingRef = useRef<boolean>(false);
  const pendingMarkupRenderRef = useRef<{ pageNum: number; viewport: PageViewport; page?: PDFPageProxy } | null>(null);
  const renderTakeoffAnnotationsRef = useRef<((pageNum: number, viewport: PageViewport, page?: PDFPageProxy) => void) | null>(null);
  const renderPDFPageRef = useRef<((pageNum: number) => Promise<void>) | null>(null);
  const [isComponentMounted, setIsComponentMounted] = useState(false);
  const prevIsSelectionModeRef = useRef<boolean>(false);
  // CRITICAL FIX: Ref to always hold current isSelectionMode value for click handlers
  // This ensures the click handler always uses the latest state, even if React hasn't re-rendered
  const isSelectionModeRef = useRef<boolean>(true);
  const prevCalibratingRef = useRef(false);
  const annotationDragJustCompletedRef = useRef(false);
  const annotationMoveJustCompletedRef = useRef(false);
  const measurementMoveJustCompletedRef = useRef(false);
  const measurementDragJustCompletedRef = useRef(false);
  const completeMeasurementRef = useRef<(points: { x: number; y: number }[]) => Promise<void>>(() => Promise.resolve());
  const createRubberBandElementRef = useRef<(() => void) | null>(null);
  const completeCutoutRef = useRef<((points: { x: number; y: number }[]) => Promise<void>) | null>(null);
  const completeContinuousLinearMeasurementRef = useRef<(() => Promise<void>) | null>(null);
  const renderMarkupsWithPointerEventsRef = useRef<
    ((pageNum: number, viewport: PageViewport, page?: PDFPageProxy, forceImmediate?: boolean) => Promise<void>) | null
  >(null);
  const onPageShownRef = useRef<((pageNum: number, viewport: PageViewport) => void) | null>(null);
  const updateMarkupPointerEventsRef = useRef<((selectionMode: boolean) => void) | null>(null);
  /** Page number last fully rendered; used to allow re-render when user changes page in measuring mode */
  const lastRenderedPageRef = useRef<number | null>(null);
  /** Current page (ref) so we can re-trigger render in finally when user navigated during render */
  const currentPageRef = useRef<number>(1);

  // Page-specific viewport and transform state for proper isolation
  const [pageViewports, setPageViewports] = useState<Record<number, PageViewport>>({});
  const [pageOutputScales, setPageOutputScales] = useState<Record<number, number>>({});
  
  // Performance optimization: track if initial render is complete
  const [isInitialRenderComplete, setIsInitialRenderComplete] = useState(false);
  
  // Current page viewport (computed from page-specific state)
  const currentViewport = useMemo(() => {
    return pageViewports[currentPage] || null;
  }, [pageViewports, currentPage]);
  
  const currentOutputScale = useMemo(() => {
    return pageOutputScales[currentPage] || 1;
  }, [pageOutputScales, currentPage]);

  // Required by calibration hook - must be declared before usePDFViewerCalibration
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  // Scale calibration (state and handlers from hook) - after currentViewport so hook can use it
  const calibration = usePDFViewerCalibration({
    externalScaleFactor: externalScaleFactor ?? undefined,
    externalIsPageCalibrated: externalIsPageCalibrated ?? undefined,
    externalUnit: externalUnit ?? undefined,
    externalCalibrationViewportWidth: externalCalibrationViewportWidth ?? undefined,
    externalCalibrationViewportHeight: externalCalibrationViewportHeight ?? undefined,
    externalCalibrationRotation: externalCalibrationRotation ?? undefined,
    onCalibrationComplete,
    currentPage,
    currentViewport,
    viewStateRotation: viewState.rotation,
    fileId: file.id,
    currentProjectId: currentProjectId ?? undefined,
    pdfPageRef,
  });
  const {
    isCalibrating,
    calibrationPoints,
    setCalibrationPoints,
    setIsCalibrating,
    showCalibrationDialog,
    setShowCalibrationDialog,
    showScaleApplicationDialog,
    setShowScaleApplicationDialog,
    pendingScaleData,
    calibrationData,
    setCalibrationData,
    calibrationValidation,
    setCalibrationValidation,
    scaleFactor,
    isPageCalibrated,
    unit,
    calibrationViewportRef,
    completeCalibration,
    startCalibration,
    applyScale,
  } = calibration;

  // Measurement/annotation/selection state and helpers (after calibration so we have scaleFactor + calibrationViewportRef)
  const measurementsState = usePDFViewerMeasurements({
    currentViewport,
    scaleFactor,
    calibrationViewportRef,
  });
  const {
    isMeasuring,
    setIsMeasuring,
    measurementType,
    setMeasurementType,
    currentMeasurement,
    setCurrentMeasurement,
    measurements,
    setMeasurements,
    isCompletingMeasurement,
    setIsCompletingMeasurement,
    lastClickTime,
    setLastClickTime,
    lastClickPosition,
    setLastClickPosition,
    isCompletingMeasurementRef,
    lastCompletionTimeRef,
    isAnnotating,
    setIsAnnotating,
    localAnnotations,
    setLocalAnnotations,
    currentAnnotation,
    setCurrentAnnotation,
    showTextInput,
    setShowTextInput,
    textInputPosition,
    setTextInputPosition,
    textInputValue,
    setTextInputValue,
    mousePosition,
    setMousePosition,
    currentCutout,
    setCurrentCutout,
    isSelectingSymbol,
    setIsSelectingSymbol,
    selectionBox,
    setSelectionBox,
    selectionStart,
    setSelectionStart,
    annotationDragStart,
    setAnnotationDragStart,
    annotationDragBox,
    setAnnotationDragBox,
    annotationMoveId,
    setAnnotationMoveId,
    annotationMoveIds,
    setAnnotationMoveIds,
    annotationMoveStart,
    setAnnotationMoveStart,
    annotationMoveOriginalPoints,
    setAnnotationMoveOriginalPoints,
    annotationMoveDelta,
    setAnnotationMoveDelta,
    measurementDragStart,
    setMeasurementDragStart,
    measurementDragBox,
    setMeasurementDragBox,
    measurementMoveId,
    setMeasurementMoveId,
    measurementMoveIds,
    setMeasurementMoveIds,
    measurementMoveStart,
    setMeasurementMoveStart,
    measurementMoveOriginalPoints,
    setMeasurementMoveOriginalPoints,
    measurementMoveDelta,
    setMeasurementMoveDelta,
    selectedMarkupIds,
    setSelectedMarkupIds,
    isSelectionMode,
    setIsSelectionMode,
    isContinuousDrawing,
    setIsContinuousDrawing,
    activePoints,
    setActivePoints,
    rubberBandElement,
    setRubberBandElement,
    runningLength,
    setRunningLength,
    pageRubberBandRefs,
    pageCommittedPolylineRefs,
    isOrthoSnapping,
    setIsOrthoSnapping,
    calculateRunningLength,
    applyOrthoSnapping,
  } = measurementsState;

  // Annotations + per-page measurements loading (effects live in hook)
  const { localTakeoffMeasurements, setLocalTakeoffMeasurements, measurementsLoading } = usePDFViewerData({
    currentProjectId,
    fileId: file.id,
    currentPage,
    setLocalAnnotations,
  });

  // Keep ref in sync with state (runs synchronously during render)
  isSelectionModeRef.current = isSelectionMode;

  // Notify parent component of measurement state changes (must be after calibration hook so isCalibrating is defined)
  useEffect(() => {
    if (onMeasurementStateChange) {
      onMeasurementStateChange(isMeasuring, isCalibrating, measurementType, isOrthoSnapping);
    }
  }, [isMeasuring, isCalibrating, measurementType, isOrthoSnapping, onMeasurementStateChange]);

  // Enable ortho snapping by default when calibration mode starts
  useEffect(() => {
    if (isCalibrating && !prevCalibratingRef.current && !isOrthoSnapping) {
      setIsOrthoSnapping(true);
    }
    prevCalibratingRef.current = isCalibrating;
  }, [isCalibrating, isOrthoSnapping]);

  // Calibration viewport ref is restored inside usePDFViewerCalibration. Warn if rotation mismatch.
  useEffect(() => {
    if (externalIsPageCalibrated && externalCalibrationRotation != null && viewState.rotation !== externalCalibrationRotation) {
      console.warn('⚠️ Calibration rotation mismatch:', {
        calibrationRotation: externalCalibrationRotation,
        currentRotation: viewState.rotation,
        message: 'Page was rotated after calibration. Measurements may be inaccurate. Consider recalibrating.'
      });
    }
  }, [externalIsPageCalibrated, externalCalibrationRotation, viewState.rotation]);

  const selectedConditionId = useConditionStore((s) => s.selectedConditionId);
  const getSelectedCondition = useConditionStore((s) => s.getSelectedCondition);
  const conditions = useConditionStore((s) => s.conditions);
  const addAnnotation = useAnnotationStore((s) => s.addAnnotation);
  const updateAnnotation = useAnnotationStore((s) => s.updateAnnotation);
  const getPageTakeoffMeasurements = useMeasurementStore((s) => s.getPageTakeoffMeasurements);
  const updateTakeoffMeasurement = useMeasurementStore((s) => s.updateTakeoffMeasurement);

  /** Split selection into measurement vs annotation IDs (computed once, reused for copy/paste/move/delete) */
  const { selectedMeasurementIds, selectedAnnotationIds } = useMemo(() => {
    const annotationIdSet = new Set(localAnnotations.map((a) => a.id));
    const measurementIds: string[] = [];
    const annotationIds: string[] = [];
    for (const id of selectedMarkupIds) {
      if (annotationIdSet.has(id)) annotationIds.push(id);
      else measurementIds.push(id);
    }
    return { selectedMeasurementIds: measurementIds, selectedAnnotationIds: annotationIds };
  }, [selectedMarkupIds, localAnnotations]);

  const {
    getCssCoordsFromEvent,
    handleWheel,
    handleMouseDown,
    handleMouseUp,
    handleMouseMove,
    handleClick,
    handleDoubleClick,
    handleCanvasDoubleClick,
    handleSvgClick,
    handleSvgDoubleClick,
  } = usePDFViewerInteractions({
    pdfCanvasRef,
    pdfPageRef,
    svgOverlayRef,
    containerRef,
    lastRenderedScaleRef,
    viewState,
    currentPage,
    totalPages,
    setPageViewports,
    setInternalViewState,
    onScaleChange,
    isMeasuring,
    isCalibrating,
    currentMeasurement,
    isDeselecting,
    setIsDeselecting,
    isAnnotating,
    showTextInput,
    applyInteractiveZoomTransforms,
    annotationTool,
    currentAnnotation,
    setCurrentAnnotation,
    onAnnotationToolChange,
    calibrationPoints,
    setCalibrationPoints,
    setIsCalibrating,
    setCalibrationData,
    setMousePosition,
    measurementType,
    isContinuousDrawing,
    setIsContinuousDrawing,
    activePoints,
    pageRubberBandRefs,
    setActivePoints,
    setIsMeasuring,
    setRunningLength,
    setRubberBandElement,
    setCurrentMeasurement,
    selectedMarkupIds,
    setSelectedMarkupIds,
    selectedMeasurementIds,
    selectedAnnotationIds,
    isSelectionMode,
    currentProjectId,
    file,
    currentViewport,
    renderMarkupsWithPointerEventsRef,
    onPageShownRef,
    updateMarkupPointerEventsRef,
    setLocalAnnotations,
    isOrthoSnapping,
    setIsOrthoSnapping,
    visualSearchMode,
    titleblockSelectionMode,
    isSelectingSymbol,
    selectionStart,
    setSelectionStart,
    setSelectionBox,
    setIsSelectingSymbol,
    onTitleblockSelectionComplete,
    onVisualSearchComplete,
    measurementMoveId,
    setMeasurementMoveId,
    measurementMoveIds,
    setMeasurementMoveIds,
    measurementMoveStart,
    setMeasurementMoveStart,
    measurementMoveOriginalPoints,
    setMeasurementMoveOriginalPoints,
    measurementMoveDelta,
    setMeasurementMoveDelta,
    measurementDragStart,
    setMeasurementDragStart,
    measurementDragBox,
    setMeasurementDragBox,
    annotationMoveId,
    setAnnotationMoveId,
    annotationMoveIds,
    setAnnotationMoveIds,
    annotationMoveStart,
    setAnnotationMoveStart,
    annotationMoveOriginalPoints,
    setAnnotationMoveOriginalPoints,
    annotationMoveDelta,
    setAnnotationMoveDelta,
    annotationDragStart,
    setAnnotationDragStart,
    annotationDragBox,
    setAnnotationDragBox,
    cutoutMode,
    currentCutout,
    setCurrentCutout,
    cutoutTargetConditionId,
    onCutoutModeChange,
    completeCalibration,
    createRubberBandElementRef,
    completeCutoutRef,
    completeContinuousLinearMeasurementRef,
    measurementMoveJustCompletedRef,
    annotationMoveJustCompletedRef,
    measurementDragJustCompletedRef,
    annotationDragJustCompletedRef,
    isSelectionModeRef,
    completeMeasurementRef,
    annotationColor,
    setTextInputPosition,
    setShowTextInput,
    localTakeoffMeasurements,
    localAnnotations,
    setLocalTakeoffMeasurements,
    updateTakeoffMeasurement,
    updateAnnotation,
    addAnnotation,
    applyOrthoSnapping,
    calculateRunningLength,
    mousePosition,
    pdfDocument,
  });

  const isBoxSelectionMode = visualSearchMode || !!titleblockSelectionMode;
  const isDrawingBoxSelection = isBoxSelectionMode && isSelectingSymbol;

  // Helper to get current condition color by ID (uses live condition data, not stored measurement color)
  const getConditionColor = useCallback((conditionId: string, fallbackColor?: string): string => {
    const condition = conditions.find(c => c.id === conditionId);
    return condition?.color || fallbackColor || '#000000';
  }, [conditions]);

  // Ensure component is mounted before rendering
  useEffect(() => {
    setIsComponentMounted(true);
    return () => setIsComponentMounted(false);
  }, []);

  // Additional effect to ensure measurements are rendered when added
  useEffect(() => {
    if (localTakeoffMeasurements.length > 0 && pdfDocument && currentViewport && !isRenderingRef.current) {
      // Removed verbose logging - was causing console spam
      // Note: renderTakeoffAnnotations will be called by the existing useEffect that watches localTakeoffMeasurements
    }
  }, [localTakeoffMeasurements, currentPage, pdfDocument, currentViewport]);

  // Handle visual search mode
  useEffect(() => {
    if (isBoxSelectionMode) {
      setIsSelectingSymbol(true);
      setSelectionBox(null);
      setSelectionStart(null);
    } else {
      setIsSelectingSymbol(false);
      setSelectionBox(null);
      setSelectionStart(null);
    }
  }, [isBoxSelectionMode]);

  // Sync external cut-out state with internal state
  useEffect(() => {
    if (!cutoutMode) {
      // Clear current cut-out when cut-out mode is turned off
      setCurrentCutout([]);
    }
  }, [cutoutMode]);

  // Track previous file ID to prevent unnecessary clearing
  const prevFileIdRef = useRef<string | undefined>(undefined);
  
  // Clear measurements and cleanup when file changes
  useEffect(() => {
    const currentFileId = file.id;
    const prevFileId = prevFileIdRef.current;
    
    // Only clear if the file ID actually changed
    if (currentFileId !== prevFileId) {
      setLocalTakeoffMeasurements([]);
      prevFileIdRef.current = currentFileId;
      // CRITICAL: Reset viewport state so we never use the previous document's viewports.
      // Otherwise currentViewport can be from the other doc (wrong dimensions) and the
      // overlay (preview, crosshair, markups) won't draw correctly on this document.
      setPageViewports({});
      setPageOutputScales({});
      lastRenderedPageRef.current = null;
      lastRenderedScaleRef.current = 1;
      setIsInitialRenderComplete(false);
    }
    
    // Cancel any pending operations
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }
    
    // Clear canvas context
    if (pdfCanvasRef.current) {
      const context = pdfCanvasRef.current.getContext('2d');
      if (context) {
        context.clearRect(0, 0, pdfCanvasRef.current.width, pdfCanvasRef.current.height);
        context.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    
    // Clear SVG overlay
    if (svgOverlayRef.current) {
      svgOverlayRef.current.innerHTML = '';
    }
    
    // Reset rendering flags
    isRenderingRef.current = false;
  }, [file.id]);

  // Page-specific canvas sizing with outputScale for crisp rendering
  const updateCanvasDimensions = useCallback((pageNum: number, viewport: PageViewport, outputScale: number, page?: PDFPageProxy) => {
    if (!pdfCanvasRef.current || !svgOverlayRef.current) {
      return;
    }
    
    const pdfCanvas = pdfCanvasRef.current;
    const svgOverlay = svgOverlayRef.current;
    
    // Set canvas bitmap size to viewport * outputScale for crisp rendering
    const canvasWidth = Math.round(viewport.width * outputScale);
    const canvasHeight = Math.round(viewport.height * outputScale);
    
    // Set canvas CSS size to viewport logical size
    pdfCanvas.width = canvasWidth;
    pdfCanvas.height = canvasHeight;
    pdfCanvas.style.width = `${viewport.width}px`;
    pdfCanvas.style.height = `${viewport.height}px`;
    
    // Set SVG overlay to match viewport dimensions exactly for this specific page
    svgOverlay.setAttribute('width', viewport.width.toString());
    svgOverlay.setAttribute('height', viewport.height.toString());
    svgOverlay.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
    
    // Store page-specific viewport and output scale
    setPageViewports(prev => ({ ...prev, [pageNum]: viewport }));
    setPageOutputScales(prev => ({ ...prev, [pageNum]: outputScale }));
    
    
  }, [file.id]);

  // Helper function to update pointer-events on all markup elements
  // This is called synchronously after rendering to ensure markups are selectable
  // CRITICAL FIX: Accept currentSelectionMode parameter to avoid stale closure values
  const updateMarkupPointerEvents = useCallback((currentSelectionMode?: boolean) => {
    if (!svgOverlayRef.current) return;
    
    // Use provided value or fall back to current state (for backward compatibility)
    const selectionMode = currentSelectionMode !== undefined ? currentSelectionMode : isSelectionMode;
    
    // Update ALL measurement elements including hit areas
    // Hit areas need pointer-events: auto too so they can capture clicks for selection
    const measurementElements = svgOverlayRef.current.querySelectorAll('[data-measurement-id]');
    measurementElements.forEach((el) => {
      const element = el as SVGElement;
      element.style.pointerEvents = selectionMode ? 'auto' : 'none';
      element.style.cursor = selectionMode ? 'pointer' : 'default';
    });
    
    // Update ALL annotation elements including hit areas
    const annotationElements = svgOverlayRef.current.querySelectorAll('[data-annotation-id]');
    annotationElements.forEach((el) => {
      const element = el as SVGElement;
      element.style.pointerEvents = selectionMode ? 'auto' : 'none';
      element.style.cursor = selectionMode ? 'pointer' : 'default';
    });
    
    // Also ensure the hit-area rect has correct pointer-events
    // In selection mode: 'none' so clicks pass through to markup elements
    // In other modes: 'none' so clicks pass through to canvas (for measurement double-clicks)
    // The hit-area is only needed for drawing modes (calibration, annotation, visual search)
    const hitArea = svgOverlayRef.current.querySelector('#hit-area') as SVGRectElement;
    if (hitArea) {
      hitArea.setAttribute('pointer-events', 'none');
    }
  }, [isSelectionMode]);

  useEffect(() => {
    updateMarkupPointerEventsRef.current = updateMarkupPointerEvents;
  }, [updateMarkupPointerEvents]);

  // Unified renderer with debounce pattern - coordinates rendering and pointer-events updates
  // Prevents cascading renders while ensuring eventual consistency
  // NOTE: renderTakeoffAnnotations is passed via ref to avoid circular dependency, but we 
  // also capture isSelectionMode directly to ensure it's always current
  const renderMarkupsWithPointerEvents = useCallback(async (
    pageNum: number, 
    viewport: PageViewport, 
    page?: PDFPageProxy,
    forceImmediate: boolean = false
  ): Promise<void> => {
    // CRITICAL FIX: Allow bypassing debouncing for critical state transitions
    // (e.g., after deletion or condition deactivation)
    if (!forceImmediate && isMarkupRenderingRef.current) {
      pendingMarkupRenderRef.current = { pageNum, viewport, page };
      return;
    }
    
    if (!svgOverlayRef.current || !viewport || !renderTakeoffAnnotationsRef.current) return;
    
    isMarkupRenderingRef.current = true;
    
    try {
      // Perform synchronous DOM operations
      renderTakeoffAnnotationsRef.current(pageNum, viewport, page);
      
      // CRITICAL: Always update pointer-events synchronously after render
      // This ensures markups are immediately selectable after state changes
      // Pass current isSelectionMode value explicitly to avoid stale closure
      updateMarkupPointerEvents(isSelectionMode);
      
      // CRITICAL FIX: Also ensure SVG element has correct pointer-events
      // This must be done after rendering in case rendering reset it
      if (svgOverlayRef.current) {
        const shouldReceiveClicks = isSelectionMode || isCalibrating || annotationTool || isDrawingBoxSelection;
        svgOverlayRef.current.style.pointerEvents = shouldReceiveClicks ? 'auto' : 'none';
      }
    } finally {
      isMarkupRenderingRef.current = false;
      
      // Process any pending render if one was requested during this render
      if (pendingMarkupRenderRef.current) {
        const nextParams = pendingMarkupRenderRef.current;
        pendingMarkupRenderRef.current = null;
        // Schedule next render on next tick to avoid blocking
        setTimeout(() => renderMarkupsWithPointerEvents(
          nextParams.pageNum, 
          nextParams.viewport, 
          nextParams.page,
          false // Don't force immediate for pending renders
        ), 0);
      }
    }
  }, [updateMarkupPointerEvents, isSelectionMode, isCalibrating, annotationTool, isDrawingBoxSelection]);

  useEffect(() => {
    renderMarkupsWithPointerEventsRef.current = renderMarkupsWithPointerEvents;
  }, [renderMarkupsWithPointerEvents]);

  // SVG-based takeoff annotation renderer - Page-specific with viewport isolation
  const renderTakeoffAnnotations = useCallback((pageNum: number, viewport: PageViewport, page?: PDFPageProxy) => {
    if (!viewport || !svgOverlayRef.current) return;
    
    const svgOverlay = svgOverlayRef.current;
    
    // Ensure SVG overlay coordinate system matches the provided viewport
    // This prevents drift when re-rendering overlay without a full PDF re-render
    if (
      svgOverlay.getAttribute('width') !== String(viewport.width) ||
      svgOverlay.getAttribute('height') !== String(viewport.height)
    ) {
      svgOverlay.setAttribute('width', viewport.width.toString());
      svgOverlay.setAttribute('height', viewport.height.toString());
      svgOverlay.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
    }
    
    // CRITICAL: Check store directly for measurements that might not be in localTakeoffMeasurements yet
    // This prevents clearing markups during initial load race conditions
    const storeMeasurements = getPageTakeoffMeasurements(currentProjectId || '', file.id || '', pageNum);
    
    // CRITICAL: Only render measurements for the specific page being rendered
    // Filter by page BEFORE iterating to prevent any cross-page contamination
    // Use local measurements if available, otherwise fall back to store measurements
    let pageMeasurements = localTakeoffMeasurements.filter(
      (measurement) => measurement.pdfPage === pageNum
    );
    
    // If local measurements are empty but store has measurements, convert store measurements to display format
    if (pageMeasurements.length === 0 && storeMeasurements.length > 0) {
      pageMeasurements = storeMeasurements.map(apiMeasurement => {
        try {
          const m: Measurement = {
            id: apiMeasurement.id,
            projectId: apiMeasurement.projectId,
            sheetId: apiMeasurement.sheetId,
            conditionId: apiMeasurement.conditionId,
            type: apiMeasurement.type,
            points: apiMeasurement.points,
            calculatedValue: apiMeasurement.calculatedValue,
            unit: apiMeasurement.unit,
            timestamp: safeTimestampToISO(apiMeasurement.timestamp),
            pdfPage: apiMeasurement.pdfPage,
            pdfCoordinates: apiMeasurement.pdfCoordinates,
            conditionColor: apiMeasurement.conditionColor,
            conditionName: apiMeasurement.conditionName,
            perimeterValue: apiMeasurement.perimeterValue,
            areaValue: apiMeasurement.areaValue,
            cutouts: apiMeasurement.cutouts,
            netCalculatedValue: apiMeasurement.netCalculatedValue,
          };
          return m;
        } catch (error) {
          console.error('Error processing measurement:', error, apiMeasurement);
          return null;
        }
      }).filter((m): m is Measurement => m != null);
    }
    
    const hasLocalMeasurements = pageMeasurements.length > 0;
    const hasAnnotations = localAnnotations.filter(a => a.pageNumber === pageNum).length > 0;
    const hasAnyMarkups = hasLocalMeasurements || hasAnnotations;
    
    // Check if we're in any interactive mode that requires rendering crosshairs/previews
    const hasActivePoints = isContinuousDrawing && activePoints.length > 0;
    const isInteractiveMode = isMeasuring || isCalibrating || currentMeasurement.length > 0 || hasActivePoints || isAnnotating || annotationTool || isDrawingBoxSelection;
    
    // CRITICAL: Only clear overlay and return early if:
    // 1. We're sure there are no markups AND measurements have finished loading
    // 2. AND we're NOT in an interactive mode (need to render crosshairs/previews)
    if (!hasAnyMarkups && !measurementsLoading && !isInteractiveMode) {
      svgOverlay.innerHTML = '';
      return; // Early return - nothing to render
    }
    
    // Clear existing annotations completely - this ensures no cross-page contamination
    // We only reach here if we have markups to render
    svgOverlay.innerHTML = '';
    
    // CRITICAL: Add hit-area FIRST so it's behind markups in z-order
    // This ensures markups can receive clicks even if hit-area is present
    const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hitArea.setAttribute('id', 'hit-area');
    hitArea.setAttribute('width', '100%');
    hitArea.setAttribute('height', '100%');
    hitArea.setAttribute('fill', 'transparent');
    // In selection mode, hit-area must have pointer-events: 'none' so clicks pass through to markup elements
    if (isSelectionMode) {
      hitArea.setAttribute('pointer-events', 'none');
    } else {
      const shouldCaptureClicks = isCalibrating || annotationTool || isDrawingBoxSelection;
      hitArea.setAttribute('pointer-events', shouldCaptureClicks ? 'all' : 'none');
    }
    svgOverlay.appendChild(hitArea);
    
    // Render measurements for this page (apply move offset when dragging; all selected move together)
    const measurementIdsMoving = measurementMoveDelta
      ? (measurementMoveIds.length > 0 ? measurementMoveIds : (measurementMoveId ? [measurementMoveId] : []))
      : [];
    pageMeasurements.forEach((measurement) => {
      const isMoving = measurementMoveDelta && measurementIdsMoving.includes(measurement.id);
      const measurementToRender = isMoving && measurement.pdfCoordinates
        ? {
            ...measurement,
            points: measurement.pdfCoordinates.map(p => ({
              x: p.x + measurementMoveDelta!.x,
              y: p.y + measurementMoveDelta!.y
            })),
            pdfCoordinates: measurement.pdfCoordinates.map(p => ({
              x: p.x + measurementMoveDelta!.x,
              y: p.y + measurementMoveDelta!.y
            }))
          }
        : measurement;
      renderSVGMeasurement(svgOverlay, measurementToRender, viewport, page, {
        rotation: viewState.rotation || 0,
        selectedMarkupIds,
        getConditionColor,
        selectionMode: isSelectionMode,
      });
    });

    // Draw calibration validator overlay if present for this page
    if (calibrationValidation && calibrationValidation.page === pageNum && calibrationValidation.points.length === 2) {
      const p1 = calibrationValidation.points[0];
      const p2 = calibrationValidation.points[1];
      const x1 = p1.x * viewport.width;
      const y1 = p1.y * viewport.height;
      const x2 = p2.x * viewport.width;
      const y2 = p2.y * viewport.height;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1.toString());
      line.setAttribute('y1', y1.toString());
      line.setAttribute('x2', x2.toString());
      line.setAttribute('y2', y2.toString());
      line.setAttribute('stroke', '#22c55e');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', '6,4');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      svgOverlay.appendChild(line);

      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', midX.toString());
      text.setAttribute('y', (midY - 8).toString());
      text.setAttribute('fill', '#16a34a');
      text.setAttribute('font-size', '12');
      text.setAttribute('font-family', 'Arial');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('vector-effect', 'non-scaling-stroke');
      text.textContent = calibrationValidation.display;
      svgOverlay.appendChild(text);
    }

    // Draw measurement debug overlay if present
    if (measurementDebug && measurementDebug.page === pageNum) {
      const { mid, dxNorm, dyNorm, baseW, baseH, pixelDistanceValidator, pixelDistanceMeasure, scaleFactorUsed, distanceValidatorFt, distanceMeasureFt } = measurementDebug;
      const midX = mid.x * viewport.width;
      const midY = mid.y * viewport.height;
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', (midX - 140).toString());
      bg.setAttribute('y', (midY - 60).toString());
      bg.setAttribute('width', '280');
      bg.setAttribute('height', '54');
      bg.setAttribute('fill', 'rgba(0,0,0,0.65)');
      bg.setAttribute('rx', '6');
      svgOverlay.appendChild(bg);
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', midX.toString());
      t.setAttribute('y', (midY - 42).toString());
      t.setAttribute('fill', '#fff');
      t.setAttribute('font-size', '12');
      t.setAttribute('font-family', 'Arial');
      t.setAttribute('text-anchor', 'middle');
      t.textContent = `dx=${dxNorm.toFixed(4)} dy=${dyNorm.toFixed(4)} base=(${baseW.toFixed(1)},${baseH.toFixed(1)})`;
      svgOverlay.appendChild(t);
      const t2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t2.setAttribute('x', midX.toString());
      t2.setAttribute('y', (midY - 26).toString());
      t2.setAttribute('fill', '#fff');
      t2.setAttribute('font-size', '12');
      t2.setAttribute('font-family', 'Arial');
      t2.setAttribute('text-anchor', 'middle');
      t2.textContent = `px(valid)=${pixelDistanceValidator.toFixed(2)} px(meas)=${pixelDistanceMeasure.toFixed(2)} sf=${scaleFactorUsed.toExponential(6)}`;
      svgOverlay.appendChild(t2);
      const t3 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t3.setAttribute('x', midX.toString());
      t3.setAttribute('y', (midY - 10).toString());
      t3.setAttribute('fill', '#fff');
      t3.setAttribute('font-size', '12');
      t3.setAttribute('font-family', 'Arial');
      t3.setAttribute('text-anchor', 'middle');
      t3.textContent = `${formatFeetAndInches(distanceValidatorFt)} vs ${formatFeetAndInches(distanceMeasureFt)}`;
      svgOverlay.appendChild(t3);
    }
    
    // Draw current measurement being created (only if on the page being rendered)
    if (isMeasuring && pageNum === currentPage) {
      // For linear measurements in continuous mode, check activePoints
      // For other measurements, check currentMeasurement
      const hasMeasurementPoints = (measurementType === 'linear' && isContinuousDrawing && activePoints.length > 0) || 
                                   (measurementType !== 'linear' && currentMeasurement.length > 0) ||
                                   (measurementType === 'linear' && !isContinuousDrawing && currentMeasurement.length > 0);
      
      if (hasMeasurementPoints) {
        // Always render preview for linear, area, and volume from first point
        // Only count measurements need to wait for completion
        if (measurementType !== 'count') {
          renderSVGCurrentMeasurement(svgOverlay, viewport, {
            currentPage,
            measurementType,
            isContinuousDrawing,
            activePoints,
            pageCommittedPolylineRefs,
            mousePosition,
            currentMeasurement,
            cutoutMode,
            conditionColor: getSelectedCondition()?.color || '#000000',
          });
        }
      }
    }
    
    // Draw current cut-out being created (only if on the page being rendered)
    if (cutoutMode && currentCutout.length > 0 && pageNum === currentPage) {
      renderSVGCurrentCutout(svgOverlay, viewport, currentCutout, mousePosition);
    }
    
    // Draw visual search or titleblock selection box (only if on the page being rendered)
    if (isDrawingBoxSelection && selectionBox && pageNum === currentPage) {
      renderSVGSelectionBox(svgOverlay, selectionBox, viewport);
    }
    
    // Draw annotation drag-to-draw box (rectangle/circle/arrow) while dragging
    if (annotationDragBox && ['arrow', 'rectangle', 'circle'].includes(annotationTool ?? '') && pageNum === currentPage) {
      renderSVGAnnotationDragBox(svgOverlay, annotationDragBox, viewport, annotationColor);
    }
    
    // Draw measurement drag-to-draw box (area/volume) while dragging
    if (measurementDragBox && (measurementType === 'area' || measurementType === 'volume') && pageNum === currentPage) {
      const selectedCondition = getSelectedCondition();
      const conditionColor = selectedCondition?.color || '#000000';
      renderSVGAnnotationDragBox(svgOverlay, measurementDragBox, viewport, conditionColor);
    }
    
    // Render completed annotations for this page (apply move offset when dragging)
    localAnnotations.forEach(annotation => {
      if (annotation.pageNumber !== pageNum) return;
      const annotationIdsMoving = annotationMoveDelta
        ? (annotationMoveIds.length > 0 ? annotationMoveIds : (annotationMoveId ? [annotationMoveId] : []))
        : [];
      const isMoving = annotationMoveDelta && annotationIdsMoving.includes(annotation.id);
      const pointsToRender = isMoving
        ? annotation.points.map(p => ({ x: p.x + annotationMoveDelta!.x, y: p.y + annotationMoveDelta!.y }))
        : annotation.points;
      const annotationToRender = isMoving ? { ...annotation, points: pointsToRender } : annotation;
      renderSVGAnnotation(svgOverlay, annotationToRender, viewport, {
        rotation: viewState.rotation || 0,
        selectedMarkupIds,
        selectionMode: isSelectionMode,
      });
    });
    
    // Draw current annotation being created (only if on the page being rendered)
    // Show preview even with no points yet (for initial mouse tracking)
    if (annotationTool && pageNum === currentPage) {
      renderSVGCurrentAnnotation(svgOverlay, viewport, {
        annotationTool,
        currentAnnotation,
        mousePosition,
        annotationColor,
      });
    }
    
    // Draw calibration points (only if on the page being rendered)
    if (isCalibrating && calibrationPoints.length > 0 && pageNum === currentPage) {
      renderSVGCalibrationPoints(svgOverlay, {
        calibrationPoints,
        viewport,
        mousePosition,
        isOrthoSnapping,
        applyOrthoSnapping,
      });
    }
    
    // Draw crosshair if measuring, calibrating, annotating, or drawing search/titleblock selection box (only if on the page being rendered)
    if (mousePosition && (isMeasuring || isCalibrating || annotationTool || isBoxSelectionMode) && pageNum === currentPage) {
      renderSVGCrosshair(svgOverlay, mousePosition, viewport, isCalibrating);
    }
    
    // Draw running length display for continuous linear drawing
    if (isContinuousDrawing && activePoints.length > 0 && pageNum === currentPage) {
      renderRunningLengthDisplay(svgOverlay, viewport, {
        runningLength,
        conditionColor: getSelectedCondition()?.color || '#000000',
        unit: getSelectedCondition()?.unit || 'ft',
        lastPoint: activePoints[activePoints.length - 1] ?? { x: 0, y: 0 },
      });
    }
    
  }, [localTakeoffMeasurements, currentMeasurement, measurementType, isMeasuring, isCalibrating, calibrationPoints, mousePosition, isSelectionMode, currentPage, isContinuousDrawing, activePoints, runningLength, localAnnotations, annotationTool, currentAnnotation, annotationDragBox, annotationMoveId, annotationMoveIds, annotationMoveDelta, annotationColor, measurementDragBox, measurementMoveId, measurementMoveIds, measurementMoveDelta, cutoutMode, currentCutout, isBoxSelectionMode, isDrawingBoxSelection, selectionBox, currentProjectId, file.id, getPageTakeoffMeasurements, getSelectedCondition, measurementsLoading, getConditionColor]);

  // OPTIMIZED: Update only visual styling of markups when selection changes (no full re-render)
  const updateMarkupSelection = useCallback((newSelectedIds: string[], previousSelectedIds: string[]) => {
    if (!svgOverlayRef.current) return;
    const svg = svgOverlayRef.current;
    const idsToDeselect = previousSelectedIds.filter((id) => !newSelectedIds.includes(id));
    const idsToSelect = newSelectedIds.filter((id) => !previousSelectedIds.includes(id));

    const deselectId = (previousSelectedId: string) => {
      const prevMeasurementElements = svg.querySelectorAll(`[data-measurement-id="${previousSelectedId}"]`);
      prevMeasurementElements.forEach((el) => {
        const element = el as SVGElement;
        const fill = element.getAttribute('fill');
        const stroke = element.getAttribute('stroke');
        const isHitArea = fill === 'transparent' || stroke === 'transparent';
        if (element.tagName === 'circle') {
          const r = parseFloat(element.getAttribute('r') || '0');
          if (r > 15) return;
        }
        if (isHitArea) return;
        const measurement = localTakeoffMeasurements.find((m) => m.id === previousSelectedId);
        if (measurement) {
          const defaultColor = getConditionColor(measurement.conditionId, measurement.conditionColor);
          const defaultStrokeWidth = '2';
          if (element.tagName === 'polyline' || element.tagName === 'polygon' || element.tagName === 'path') {
            element.setAttribute('stroke', defaultColor);
            element.setAttribute('stroke-width', defaultStrokeWidth);
          } else if (element.tagName === 'circle') {
            element.setAttribute('stroke', 'none');
            element.removeAttribute('stroke-width');
          }
        }
      });
      const prevMeasurement = localTakeoffMeasurements.find((m) => m.id === previousSelectedId);
      if (prevMeasurement) {
        const defaultColor = getConditionColor(prevMeasurement.conditionId, prevMeasurement.conditionColor);
        svg.querySelectorAll('text').forEach((textEl) => {
          const prevSibling = textEl.previousElementSibling;
          if (prevSibling && prevSibling.getAttribute('data-measurement-id') === previousSelectedId) {
            textEl.setAttribute('fill', defaultColor);
          }
        });
      }
      const prevAnnotationElements = svg.querySelectorAll(`[data-annotation-id="${previousSelectedId}"]`);
      prevAnnotationElements.forEach((el) => {
        const element = el as SVGElement;
        if (element.getAttribute('stroke') === 'transparent') return;
        const annotation = localAnnotations.find((a) => a.id === previousSelectedId);
        if (annotation) {
          const defaultColor = annotation.color;
          const defaultStrokeWidth = '3';
          if (element.tagName === 'line' || element.tagName === 'rect' || element.tagName === 'ellipse') {
            element.setAttribute('stroke', defaultColor);
            element.setAttribute('stroke-width', defaultStrokeWidth);
          } else if (element.tagName === 'text') {
            element.setAttribute('fill', defaultColor);
          }
        }
      });
    };

    const selectId = (newSelectedId: string) => {
      const newMeasurementElements = svg.querySelectorAll(`[data-measurement-id="${newSelectedId}"]`);
      newMeasurementElements.forEach((el) => {
        const element = el as SVGElement;
        const fill = element.getAttribute('fill');
        const stroke = element.getAttribute('stroke');
        const isHitArea = fill === 'transparent' || stroke === 'transparent';
        if (element.tagName === 'circle') {
          const r = parseFloat(element.getAttribute('r') || '0');
          if (r > 15) return;
        }
        if (isHitArea) return;
        if (element.tagName === 'polyline' || element.tagName === 'polygon' || element.tagName === 'path') {
          element.setAttribute('stroke', '#ff0000');
          element.setAttribute('stroke-width', '4');
        } else if (element.tagName === 'circle') {
          element.setAttribute('stroke', '#ff0000');
          element.setAttribute('stroke-width', '3');
        }
      });
      svg.querySelectorAll('text').forEach((textEl) => {
        const prevSibling = textEl.previousElementSibling;
        if (prevSibling && prevSibling.getAttribute('data-measurement-id') === newSelectedId) {
          textEl.setAttribute('fill', '#ff0000');
        }
      });
      const newAnnotationElements = svg.querySelectorAll(`[data-annotation-id="${newSelectedId}"]`);
      newAnnotationElements.forEach((el) => {
        const element = el as SVGElement;
        if (element.getAttribute('stroke') === 'transparent') return;
        if (element.tagName === 'line' || element.tagName === 'rect' || element.tagName === 'ellipse') {
          element.setAttribute('stroke', '#00ff00');
          element.setAttribute('stroke-width', '5');
        } else if (element.tagName === 'text') {
          element.setAttribute('fill', '#00ff00');
        }
      });
    };

    idsToDeselect.forEach(deselectId);
    idsToSelect.forEach(selectId);
  }, [localTakeoffMeasurements, localAnnotations, getConditionColor]);

  // Re-render annotations when measurements or interaction state changes
  // NOTE: selectedMarkupIds is used in the effect below to update only visual styling on selection change
  // CRITICAL: Allow markup rendering even when isDeselecting is true - we need markups to be selectable
  // isDeselecting only blocks PDF canvas renders, not markup overlay renders
  useEffect(() => {
    if (pdfDocument && currentViewport && !isRenderingRef.current) {
      // Only render if we have measurements, annotations, or if we're in measuring/annotation/visual search mode
      // CRITICAL FIX: Include activePoints.length check to ensure continuous linear preview renders
      // CRITICAL: Always render if we have markups OR are in an interactive mode
      const hasActivePoints = isContinuousDrawing && activePoints.length > 0;
      const isInteractiveMode = isMeasuring || isCalibrating || currentMeasurement.length > 0 || hasActivePoints || isAnnotating || isDrawingBoxSelection;
      
      // CRITICAL: Check both local measurements AND store to handle race conditions
      const storeMeasurements = getPageTakeoffMeasurements(currentProjectId || '', file.id || '', currentPage);
      const hasLocalMarkups = localTakeoffMeasurements.length > 0 || localAnnotations.length > 0;
      const hasStoreMarkups = storeMeasurements.length > 0;
      const hasMarkups = hasLocalMarkups || hasStoreMarkups;
      const shouldRender = hasMarkups || isInteractiveMode;
      
      if (shouldRender) {
        // CRITICAL: Always render markups if they exist (in local state or store), regardless of selection mode
        // This ensures markups are visible on initial load and persist correctly
        // Force immediate render in selection mode to ensure pointer-events are updated
        const forceImmediate = isSelectionMode && hasMarkups;
        renderMarkupsWithPointerEvents(currentPage, currentViewport, pdfPageRef.current ?? undefined, forceImmediate);
      } else {
        // LAYER THRASH PREVENTION: Clear overlay when measurements are empty to prevent stale renderings
        // CRITICAL: Don't clear if measurements are still loading - this prevents race conditions
        // Only clear if we're absolutely sure there are no markups AND measurements have finished loading
        // AND we've double-checked the store
        if (svgOverlayRef.current && pdfDocument && !measurementsLoading) {
          // Triple-check: local state, store, and annotations - all must be empty
          if (localTakeoffMeasurements.length === 0 && 
              storeMeasurements.length === 0 && 
              localAnnotations.length === 0) {
            svgOverlayRef.current.innerHTML = '';
          }
        }
      }
    }
  }, [localTakeoffMeasurements, currentMeasurement, isMeasuring, isCalibrating, calibrationPoints, mousePosition, renderMarkupsWithPointerEvents, currentPage, currentViewport, isAnnotating, localAnnotations, annotationDragBox, annotationMoveId, annotationMoveIds, annotationMoveDelta, measurementDragBox, measurementMoveId, measurementMoveIds, measurementMoveDelta, isDrawingBoxSelection, selectionBox, currentAnnotation, isContinuousDrawing, activePoints, pdfDocument, measurementsLoading, currentProjectId, file.id, getPageTakeoffMeasurements, isSelectionMode, totalPages, conditions]);

  // Track previous measurements for comparison (used by other logic)
  const prevLocalTakeoffMeasurementsRef = useRef<Measurement[]>([]);
  useEffect(() => {
    prevLocalTakeoffMeasurementsRef.current = localTakeoffMeasurements;
  }, [localTakeoffMeasurements]);
  
  // NOTE: Measurement rendering is handled by the main render effect above (line 1216)
  // No additional effect needed here to avoid duplicate renders and flicker

  // OPTIMIZED: Update only visual styling when selection changes (no full re-render)
  const prevSelectedMarkupIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevSelectedMarkupIdsRef.current;
    const same = prev.length === selectedMarkupIds.length && selectedMarkupIds.every((id, i) => id === prev[i]);
    if (!same) {
      prevSelectedMarkupIdsRef.current = selectedMarkupIds;
      if (svgOverlayRef.current && svgOverlayRef.current.children.length > 0) {
        updateMarkupSelection(selectedMarkupIds, prev);
      }
    }
  }, [selectedMarkupIds, updateMarkupSelection]);
  
  // NOTE: Initial markup rendering is handled by the main render effect (line 1216)
  // and the page visibility effect. No additional effect needed here.

  // CRITICAL: Update the ref synchronously during render, not in useEffect
  // This ensures the ref always has the current function immediately, avoiding stale closure issues
  // useEffect runs after paint, which can cause timing issues with requestAnimationFrame callbacks
  renderTakeoffAnnotationsRef.current = renderTakeoffAnnotations;

  // Update pageViewports immediately when scale/rotation changes
  // This ensures currentViewport is always current even when PDF rendering is blocked
  useEffect(() => {
    if (pdfDocument && pdfPageRef.current) {
      // Create fresh viewport with current scale and rotation
      const freshViewport = pdfPageRef.current.getViewport({ 
        scale: viewState.scale, 
        rotation: viewState.rotation 
      });
      
      // Update pageViewports immediately so currentViewport memo recalculates
      setPageViewports(prev => {
        // Only update if the viewport actually changed to avoid unnecessary re-renders
        const existing = prev[currentPage];
        if (existing && 
            existing.width === freshViewport.width && 
            existing.height === freshViewport.height &&
            existing.scale === freshViewport.scale &&
            existing.rotation === freshViewport.rotation) {
          return prev; // No change
        }
        
        return {
          ...prev,
          [currentPage]: freshViewport
        };
      });
      
      // Trigger immediate re-render of markups with new viewport, even if PDF rendering is blocked
      // This ensures annotations stay aligned during zoom
      const hasMarkups = localTakeoffMeasurements.length > 0 || localAnnotations.length > 0;
      if (hasMarkups) {
        renderMarkupsWithPointerEvents(currentPage, freshViewport, pdfPageRef.current ?? undefined);
      }
    }
  }, [pdfDocument, viewState.scale, viewState.rotation, currentPage, localTakeoffMeasurements, localAnnotations, renderMarkupsWithPointerEvents]);

  // Force immediate re-render of markups when viewport changes
  const forceMarkupReRender = useCallback(() => {
    const hasMarkups = localTakeoffMeasurements.length > 0 || localAnnotations.length > 0;
    if (pdfDocument && pdfPageRef.current && hasMarkups) {
      // Create fresh viewport with current parameters
      const freshViewport = pdfPageRef.current.getViewport({ 
        scale: viewState.scale, 
        rotation: viewState.rotation 
      });
      
      // Update the page viewports to trigger re-render
      setPageViewports(prev => ({
        ...prev,
        [currentPage]: freshViewport
      }));
      
      // Immediately re-render all markups
      renderMarkupsWithPointerEvents(currentPage, freshViewport, pdfPageRef.current ?? undefined);
    }
  }, [pdfDocument, viewState.scale, viewState.rotation, localTakeoffMeasurements, localAnnotations, currentPage, renderTakeoffAnnotations]);

  // Force re-render measurements and annotations when viewport state changes (zoom, rotation)
  // NOTE: isDeselecting removed from blocking - markup rendering should always work in selection mode
  useEffect(() => {
    const rendersBlocked = (isMeasuring || isCalibrating || currentMeasurement.length > 0 || (isAnnotating && !showTextInput));
    if (rendersBlocked) {
      // During interactive zoom/draw, rely solely on CSS transforms to keep overlay in sync
      return;
    }
    const hasMarkups = localTakeoffMeasurements.length > 0 || localAnnotations.length > 0;
    if (pdfDocument && currentViewport && hasMarkups) {
      // Render markups with updated viewport state
      renderMarkupsWithPointerEvents(currentPage, currentViewport, pdfPageRef.current ?? undefined);
    }
  }, [viewState.scale, viewState.rotation, pdfDocument, currentViewport, localTakeoffMeasurements, localAnnotations, currentPage, renderMarkupsWithPointerEvents]);

  // SIMPLIFIED: Update pointer-events when mode changes (no re-rendering needed)
  // This handles SVG element, hit-area, and individual markup elements
  useEffect(() => {
    if (!svgOverlayRef.current) return;
    
    // CRITICAL FIX: Update SVG element's pointer-events directly
    // This ensures the SVG receives clicks even if React hasn't re-rendered
    const shouldSVGReceiveClicks = isSelectionMode || isCalibrating || annotationTool || isDrawingBoxSelection;
    svgOverlayRef.current.style.pointerEvents = shouldSVGReceiveClicks ? 'auto' : 'none';
    
    // Update hit-area pointer-events
    const hitArea = svgOverlayRef.current.querySelector('#hit-area') as SVGRectElement;
    if (hitArea) {
      if (isSelectionMode) {
        hitArea.setAttribute('pointer-events', 'none');
      } else {
        const shouldCaptureClicks = isCalibrating || annotationTool || isDrawingBoxSelection;
        hitArea.setAttribute('pointer-events', shouldCaptureClicks ? 'all' : 'none');
      }
    }
    
    // CRITICAL: Update markup pointer-events directly when mode changes
    // This is much more efficient than re-rendering the entire overlay
    updateMarkupPointerEvents(isSelectionMode);
    
    // Track mode changes
    prevIsSelectionModeRef.current = isSelectionMode;
  }, [isSelectionMode, isCalibrating, annotationTool, isDrawingBoxSelection, updateMarkupPointerEvents]);

  // Page visibility handler - ensures overlay is properly initialized when page becomes visible
  const onPageShown = useCallback((pageNum: number, viewport: PageViewport) => {
    if (!viewport || !svgOverlayRef.current) {
      return;
    }
    
    const svgOverlay = svgOverlayRef.current;
    
    // Ensure SVG overlay has correct dimensions and viewBox for this page
    svgOverlay.setAttribute('width', viewport.width.toString());
    svgOverlay.setAttribute('height', viewport.height.toString());
    svgOverlay.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
    svgOverlay.setAttribute('overflow', 'visible');
    
    // Add a transparent hit area for pointer events
    // CRITICAL FIX: Set hit-area pointer-events based on current mode
    // When measuring, set to 'none' so clicks pass through to canvas for proper double-click handling
    // For other modes (selection, calibration, annotation, visual search), set to 'all' to capture clicks
    const existingHitArea = svgOverlay.querySelector('#hit-area');
    if (!existingHitArea) {
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hitArea.setAttribute('id', 'hit-area');
      hitArea.setAttribute('width', '100%');
      hitArea.setAttribute('height', '100%');
      hitArea.setAttribute('fill', 'transparent');
      svgOverlay.appendChild(hitArea);
    }
    
    // Update hit-area pointer-events based on current mode
    // CRITICAL: In selection mode, hit-area must have pointer-events: 'none' so clicks pass through to markup elements
    // When measuring, hit-area has pointer-events: 'none' so clicks pass through to canvas for double-click support
    // For annotation/calibration/visual search modes, hit-area captures clicks for drawing
    const hitArea = svgOverlay.querySelector('#hit-area') as SVGRectElement;
    if (hitArea) {
      // In selection mode, we want clicks to reach markup elements, so hit-area should not intercept
      // In other interactive modes (calibration, annotation, visual search), hit-area captures clicks for drawing
      if (isSelectionMode) {
        hitArea.setAttribute('pointer-events', 'none');
      } else {
        const shouldCaptureClicks = isCalibrating || annotationTool || isDrawingBoxSelection;
        hitArea.setAttribute('pointer-events', shouldCaptureClicks ? 'all' : 'none');
      }
    }
    
    // Always re-render overlay when we have markups OR we're in interactive mode (measuring, calibrating, etc.)
    // so crosshairs and preview appear on every page after a full render
    const currentMeasurements = useMeasurementStore.getState().takeoffMeasurements.filter(
      (m) => m.projectId === currentProjectId && m.sheetId === file.id && m.pdfPage === pageNum
    );
    const hasMarkups = currentMeasurements.length > 0 || localTakeoffMeasurements.length > 0;
    const isInteractiveMode = isMeasuring || isCalibrating || isAnnotating || isDrawingBoxSelection;
    if (hasMarkups || isInteractiveMode) {
      renderMarkupsWithPointerEvents(pageNum, viewport, pdfPageRef.current ?? undefined, isSelectionMode);
    }
  }, [renderMarkupsWithPointerEvents, localTakeoffMeasurements, currentProjectId, file.id, isSelectionMode, isCalibrating, isMeasuring, isAnnotating, isDrawingBoxSelection, annotationTool]);

  useEffect(() => {
    onPageShownRef.current = onPageShown;
  }, [onPageShown]);

  // PDF render function with page-specific viewport isolation
  const renderPDFPage = useCallback(async (pageNum: number) => {
    // ANTI-FLICKER: Block PDF re-renders during interactive operations on the SAME page.
    // Allow PDF render when user changes page so overlay (preview, crosshair) has correct viewport on every page.
    const isInitialRender = !isInitialRenderComplete;
    const samePageAsLastRender = lastRenderedPageRef.current === pageNum;
    const blockRenders =
      !isInitialRender &&
      samePageAsLastRender &&
      (isMeasuring || isCalibrating || currentMeasurement.length > 0 || (isDeselecting && isInitialRenderComplete) || (isAnnotating && !showTextInput));
    
    if (blockRenders) {
      return;
    }
    
    // Show loading indicator for initial renders
    if (!isInitialRenderComplete) {
      setIsPDFLoading(true);
    }
    
    // Reduced delay for better performance
    await new Promise(resolve => setTimeout(resolve, 5));
    
    if (!isComponentMounted || !pdfDocument || !pdfCanvasRef.current || !containerRef.current) {
      return;
    }
    
    // If we're already rendering a different page, let that finish; finally will re-trigger for pageNum.
    // If we're already rendering this page, skip.
    if (isRenderingRef.current) {
      return;
    }
    isRenderingRef.current = true;

    try {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      const page = await pdfDocument.getPage(pageNum);
      pdfPageRef.current = page;
      
      // Double-check canvas is still mounted after async operation
      const pdfCanvas = pdfCanvasRef.current;
      if (!pdfCanvas || !containerRef.current) {
        console.warn('PDF canvas or container unmounted during render, skipping');
        return;
      }
      
      const pdfContext = pdfCanvas.getContext('2d');
      if (!pdfContext) {
        console.warn('PDF canvas context is null, skipping render');
        return;
      }

      // Create page-specific viewport with current scale and rotation
      const viewport = page.getViewport({ 
        scale: viewState.scale,
        rotation: viewState.rotation
      });
      
      // Calculate outputScale for crisp rendering
      const outputScale = window.devicePixelRatio || 1;
      
      // Update canvas and SVG dimensions with page-specific data
      updateCanvasDimensions(pageNum, viewport, outputScale, page);
      
      // Clear canvas
      pdfContext.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
      pdfContext.setTransform(1, 0, 0, 1, 0, 0);
      
      // Clear SVG overlay completely to prevent cross-page contamination
      if (svgOverlayRef.current) {
        svgOverlayRef.current.innerHTML = '';
      }
      
      // Render with page-specific transform for outputScale - optimized for performance
      const renderContext = {
        canvasContext: pdfContext,
        viewport: viewport,
        transform: [outputScale, 0, 0, outputScale, 0, 0],
        // Performance optimizations
        enableWebGL: false, // Disable WebGL for better compatibility and performance
        renderInteractiveForms: false, // Disable interactive forms for better performance
      };
      
      const renderTask = page.render(renderContext as unknown as Parameters<PDFPageProxy['render']>[0]);
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      
      // After PDF is rendered, ensure overlay is properly initialized and render takeoff annotations
      onPageShown(pageNum, viewport);
      
      // Record the page and scale at which the PDF canvas was actually rendered
      lastRenderedPageRef.current = pageNum;
      lastRenderedScaleRef.current = viewState.scale;
      
      // Clear any interactive CSS transforms (no longer needed after full render)
      if (pdfCanvasRef.current) {
        pdfCanvasRef.current.style.transform = '';
        pdfCanvasRef.current.style.transformOrigin = '';
      }
      if (svgOverlayRef.current) {
        svgOverlayRef.current.style.transform = '';
        svgOverlayRef.current.style.transformOrigin = '';
      }
      // Post-zoom settle: ensure overlay is refreshed immediately after canvas render
      // CRITICAL: Always redraw overlay after clearing SVG so crosshairs/preview show on every page
      // (when in measuring/calibrating/annotating mode there are no measurements yet, but we need the overlay)
      try {
        const currentMeasurements = useMeasurementStore.getState().takeoffMeasurements.filter(
          (m) => m.projectId === currentProjectId && m.sheetId === file.id && m.pdfPage === pageNum
        );
        const hasMarkups = currentMeasurements.length > 0 || localTakeoffMeasurements.length > 0;
        const isInteractiveMode = isMeasuring || isCalibrating || isAnnotating || isDrawingBoxSelection;
        const currentSelectionMode = isSelectionMode;
        if (hasMarkups || isInteractiveMode) {
          renderMarkupsWithPointerEvents(pageNum, viewport, page, currentSelectionMode);
        }
      } catch {}
      
      // Removed verbose logging - was causing console spam
      
      // Mark initial render as complete and notify parent
      if (pageNum === currentPage) {
        setIsInitialRenderComplete(true);
        setIsPDFLoading(false); // Hide loading indicator
        if (onPDFRendered) {
          onPDFRendered();
        }
      }
      
    } catch (error: unknown) {
      if (!(error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'RenderingCancelledException')) {
        console.error('Error rendering PDF page:', error);
      }
    } finally {
      isRenderingRef.current = false;
      // If user navigated to a different page while we were rendering, render that page now.
      const requestedPage = currentPageRef.current;
      if (requestedPage !== pageNum && renderPDFPageRef.current) {
        requestAnimationFrame(() => {
          if (currentPageRef.current === requestedPage && renderPDFPageRef.current) {
            renderPDFPageRef.current(requestedPage);
          }
        });
      }
    }
  }, [pdfDocument, viewState, updateCanvasDimensions, onPageShown, isComponentMounted, isMeasuring, isCalibrating, currentMeasurement, isDeselecting, isAnnotating, isSelectionMode, localTakeoffMeasurements, currentProjectId, file.id, currentPage, renderMarkupsWithPointerEvents]);

  // Keep renderPDFPage ref in sync (runs synchronously during render)
  renderPDFPageRef.current = renderPDFPage;

  // Create rubber band element for continuous linear drawing
  const createRubberBandElement = useCallback(() => {
    if (!svgOverlayRef.current || !currentViewport) return;
    
    const svgOverlay = svgOverlayRef.current;
    
    // Ensure SVG has correct dimensions and viewBox
    svgOverlay.setAttribute('width', currentViewport.width.toString());
    svgOverlay.setAttribute('height', currentViewport.height.toString());
    svgOverlay.setAttribute('viewBox', `0 0 ${currentViewport.width} ${currentViewport.height}`);
    svgOverlay.setAttribute('overflow', 'visible');
    
    const selectedCondition = getSelectedCondition();
    const conditionColor = selectedCondition?.color || '#000000';
    
    // Remove existing rubber band for this page if it exists
    const existingRubberBand = pageRubberBandRefs.current[currentPage];
    if (existingRubberBand && existingRubberBand.parentNode === svgOverlay) {
      svgOverlay.removeChild(existingRubberBand);
    }
    
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', conditionColor);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '5,5');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('fill', 'none');
    line.setAttribute('opacity', '0.8');
    line.setAttribute('id', `rubber-band-line-${currentPage}`);
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    line.setAttribute('pointer-events', 'none');
    
    // Set initial coordinates (will be updated on mouse move)
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', '0');
    line.setAttribute('y2', '0');
    
    svgOverlay.appendChild(line);
    
    // Store in page-scoped refs
    pageRubberBandRefs.current[currentPage] = line;
    setRubberBandElement(line);
  }, [currentViewport, currentPage]);
  // Complete current measurement
  const completeMeasurement = useCallback(async (points: { x: number; y: number }[]) => {
    // Prevent duplicate calls within a very short window (100ms) - allows legitimate double-clicks
    const now = Date.now();
    if (isCompletingMeasurementRef.current && (now - lastCompletionTimeRef.current) < 100) {
      // Block duplicate measurement completion calls
      return;
    }
    
    const currentSelectedConditionId = useConditionStore.getState().selectedConditionId;

    if (!currentSelectedConditionId || points.length === 0) {
      return;
    }
    
    // Set flag and timestamp to prevent duplicate calls
    isCompletingMeasurementRef.current = true;
    lastCompletionTimeRef.current = now;
    
    const selectedCondition = getSelectedCondition();
    if (!selectedCondition) {
      // Reset flag if condition not found
      isCompletingMeasurementRef.current = false;
      return;
    }
    
    let calculatedValue = 0;
    let unit = selectedCondition.unit;
    
    if (!currentViewport) {
      // Reset flag if no viewport
      isCompletingMeasurementRef.current = false;
      return;
    }
    
    // Store measurements in normalized coordinates (0-1) - simple and reliable
    const viewportPoints = points.map((point) => ({
      x: point.x,
      y: point.y
    }));
    
    // Import the measurement calculator
    const { MeasurementCalculator } = await import('../utils/measurementCalculation');
    
    // Create scale info object using the calibration base viewport
    const calibBase = calibrationViewportRef.current;
    const scaleInfo = {
      scaleFactor,
      unit: 'ft',
      scaleText: 'calibrated',
      confidence: 0.95, // High confidence for manual calibration
      viewportWidth: (calibBase?.viewportWidth) || currentViewport.width,
      viewportHeight: (calibBase?.viewportHeight) || currentViewport.height
    };
    
    // TEMP DEBUG: Compare validator path vs measurement path on the same span
    if (points.length === 2 && calibBase) {
      const dxNorm = points[1].x - points[0].x;
      const dyNorm = points[1].y - points[0].y;
      const pixelDistanceValidator = Math.hypot(dxNorm * calibBase.viewportWidth, dyNorm * calibBase.viewportHeight);
      const pixelDistanceMeasure = Math.hypot(dxNorm * scaleInfo.viewportWidth!, dyNorm * scaleInfo.viewportHeight!);
      const distanceValidatorFt = pixelDistanceValidator * scaleInfo.scaleFactor;
      const distanceMeasureFt = pixelDistanceMeasure * scaleInfo.scaleFactor;
      const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      setMeasurementDebug({
        page: currentPage,
        mid,
        dxNorm, dyNorm,
        baseW: calibBase.viewportWidth,
        baseH: calibBase.viewportHeight,
        pixelDistanceValidator,
        pixelDistanceMeasure,
        scaleFactorUsed: scaleInfo.scaleFactor,
        distanceValidatorFt,
        distanceMeasureFt
      });
      // Auto clear after a few seconds
      setTimeout(() => setMeasurementDebug(null), 4000);
    }
    
    let measurementResult;
    let perimeterValue: number | undefined;
    let areaValue: number | undefined;
    
    switch (measurementType) {
      case 'linear':
        measurementResult = MeasurementCalculator.calculateLinear(viewportPoints, scaleInfo, 1.0);
        calculatedValue = measurementResult.calculatedValue;
        unit = measurementResult.unit;
        // Calculate area if height is provided
        if (selectedCondition.includeHeight && selectedCondition.height) {
          areaValue = calculatedValue * selectedCondition.height;
        }
        break;
      case 'area':
        measurementResult = MeasurementCalculator.calculateArea(viewportPoints, scaleInfo, 1.0);
        calculatedValue = measurementResult.calculatedValue;
        unit = measurementResult.unit;
        // Only assign perimeter if the condition requires it
        if (selectedCondition.includePerimeter) {
          perimeterValue = measurementResult.perimeterValue;
        }
        break;
      case 'volume':
        const depth = selectedCondition.depth || 1; // Default to 1 foot if no depth specified
        measurementResult = MeasurementCalculator.calculateVolume(viewportPoints, scaleInfo, depth, 1.0);
        calculatedValue = measurementResult.calculatedValue;
        unit = measurementResult.unit;
        // Only assign perimeter if the condition requires it
        if (selectedCondition.includePerimeter) {
          perimeterValue = measurementResult.perimeterValue;
        }
        break;
      case 'count':
        measurementResult = MeasurementCalculator.calculateCount();
        calculatedValue = measurementResult.calculatedValue;
        unit = measurementResult.unit;
        break;
    }
    
    // Log validation warnings/errors for debugging
    if (measurementResult && !measurementResult.validation.isValid) {
      console.warn('Measurement validation failed:', measurementResult.validation.errors);
    }
    if (measurementResult && measurementResult.validation.warnings.length > 0) {
      console.warn('Measurement warnings:', measurementResult.validation.warnings);
    }
    
    // Override perimeter calculation if condition requires it and perimeter wasn't calculated
    if ((measurementType === 'area' || measurementType === 'volume') && selectedCondition.includePerimeter && !perimeterValue) {
      // Fallback to manual calculation if enhanced calculator didn't provide perimeter
      let perimeter = 0;
      for (let i = 0; i < viewportPoints.length; i++) {
        const j = (i + 1) % viewportPoints.length;
        const dx = viewportPoints[j].x - viewportPoints[i].x;
        const dy = viewportPoints[j].y - viewportPoints[i].y;
        perimeter += Math.sqrt(dx * dx + dy * dy);
      }
      perimeterValue = perimeter / scaleFactor;
    }

    if (currentProjectId && file.id) {
      const addTakeoffMeasurement = useMeasurementStore.getState().addTakeoffMeasurement;
      const createPayload = {
        projectId: currentProjectId,
        sheetId: file.id,
        conditionId: currentSelectedConditionId,
        type: measurementType,
        points: viewportPoints,
        calculatedValue,
        unit,
        pdfPage: currentPage,
        pdfCoordinates: points,
        conditionColor: selectedCondition.color,
        conditionName: selectedCondition.name,
        // Only include perimeterValue if the condition requires it
        ...(selectedCondition.includePerimeter && { perimeterValue }),
        // Only include areaValue if the condition requires it (linear with height)
        ...(selectedCondition.includeHeight && areaValue !== undefined && { areaValue })
      };
      addTakeoffMeasurement(createPayload).then(savedMeasurementId => {
        useUndoStore.getState().push({ type: 'measurement_add', id: savedMeasurementId, createPayload });
      }).catch(error => {
        console.error(`Failed to save ${measurementType.toUpperCase()} measurement:`, error);
        // Reset flag on error
        isCompletingMeasurementRef.current = false;
      });
    } else {
      // Reset flag if no project/file
      isCompletingMeasurementRef.current = false;
    }
    
    // Clear current measurement
    setCurrentMeasurement([]);
    setMousePosition(null);
    
    // Reset flag after a short delay to allow the measurement to be saved
    // Only reset if we haven't already reset due to error
    setTimeout(() => {
      isCompletingMeasurementRef.current = false;
    }, 500);
  }, [getSelectedCondition, measurementType, scaleFactor, currentProjectId, currentPage, file.id]);

  useEffect(() => {
    completeMeasurementRef.current = completeMeasurement;
  }, [completeMeasurement]);

  // Complete cut-out measurement
  const completeCutout = useCallback(async (points: { x: number; y: number }[]) => {
    if (!cutoutTargetConditionId || points.length < 3) {
      return;
    }

    const getPageTakeoffMeasurements = useMeasurementStore.getState().getPageTakeoffMeasurements;
    const updateTakeoffMeasurement = useMeasurementStore.getState().updateTakeoffMeasurement;

    // Get existing measurements for the target condition
    if (!file.id || !currentProjectId) return;
    const existingMeasurements = getPageTakeoffMeasurements(currentProjectId, file.id, currentPage);
    const targetMeasurement = existingMeasurements.find(m => m.conditionId === cutoutTargetConditionId);
    
    if (!targetMeasurement) {
      console.error('Target measurement not found for cut-out');
      return;
    }

    // Calculate cut-out area/volume using enhanced calculator
    const viewport = currentViewport;
    if (!viewport) return;

    // Keep points in normalized coordinates for calculator consistency
    const viewportPoints = points.map(point => ({
      x: point.x,
      y: point.y
    }));

    // Import the enhanced measurement calculator
    const { MeasurementCalculator } = await import('../utils/measurementCalculation');
    
    // Create scale info object using calibration base viewport
    const calibBase2 = calibrationViewportRef.current;
    const scaleInfo = {
      scaleFactor,
      unit: 'ft',
      scaleText: 'detected',
      confidence: 0.9,
      viewportWidth: (calibBase2?.viewportWidth) || viewport.width,
      viewportHeight: (calibBase2?.viewportHeight) || viewport.height
    };
    
    let cutoutValue = 0;
    
    // Calculate area for cut-out
    const areaResult = MeasurementCalculator.calculateArea(viewportPoints, scaleInfo, viewState.scale);
    
    if (areaResult.validation.isValid) {
      // For volume measurements, multiply by depth
      if (targetMeasurement.type === 'volume') {
        const selectedCondition = getSelectedCondition();
        const depth = selectedCondition?.depth || 1;
        cutoutValue = areaResult.calculatedValue * depth;
      } else {
        cutoutValue = areaResult.calculatedValue;
      }
    } else {
      console.warn('Cutout area calculation failed:', areaResult.validation.errors);
      // Fallback to simple calculation
      let area = 0;
      for (let i = 0; i < viewportPoints.length; i++) {
        const j = (i + 1) % viewportPoints.length;
        area += viewportPoints[i].x * viewportPoints[j].y;
        area -= viewportPoints[j].x * viewportPoints[i].y;
      }
      
      const baseW = (calibrationViewportRef.current?.viewportWidth) || viewport.width;
      const baseH = (calibrationViewportRef.current?.viewportHeight) || viewport.height;
      // Convert normalized polygon area to pixel area using base viewport, then to units
      const pixelArea = Math.abs(area) * (baseW * baseH) / 2;
      const areaInSquareFeet = pixelArea * (scaleFactor * scaleFactor);
      
      if (targetMeasurement.type === 'volume') {
        const selectedCondition = getSelectedCondition();
        const depth = selectedCondition?.depth || 1;
        cutoutValue = areaInSquareFeet * depth;
      } else {
        cutoutValue = areaInSquareFeet;
      }
    }

    // Create cut-out object
    const cutout = {
      id: `cutout_${Date.now()}`,
      points: points, // Store in PDF coordinates (0-1 scale) for rendering
      pdfCoordinates: points, // Store in PDF coordinates (0-1 scale) for persistence
      calculatedValue: cutoutValue
    };

    // Add cut-out to existing measurement
    const existingCutouts = targetMeasurement.cutouts || [];
    const totalCutoutValue = existingCutouts.reduce((sum, c) => sum + c.calculatedValue, 0) + cutoutValue;
    
    const updatedMeasurement = {
      ...targetMeasurement,
      cutouts: [...existingCutouts, cutout],
      netCalculatedValue: targetMeasurement.calculatedValue - totalCutoutValue
    };

    // Update the measurement
    try {
      useUndoStore.getState().push({
        type: 'measurement_update',
        id: targetMeasurement.id,
        previous: { cutouts: targetMeasurement.cutouts, netCalculatedValue: targetMeasurement.netCalculatedValue },
        next: { cutouts: updatedMeasurement.cutouts, netCalculatedValue: updatedMeasurement.netCalculatedValue },
      });
      await updateTakeoffMeasurement(targetMeasurement.id, updatedMeasurement);
      
      // Update local measurements immediately with the new data
      setLocalTakeoffMeasurements(prevMeasurements => 
        prevMeasurements.map(measurement => 
          measurement.id === targetMeasurement.id 
            ? { ...measurement, ...updatedMeasurement }
            : measurement
        )
      );
      
      // Exit cut-out mode
      if (onCutoutModeChange) {
        onCutoutModeChange(null);
      }
      setCurrentCutout([]);
      
      // Re-render the page using ref to avoid stale callback
      requestAnimationFrame(() => {
        if (renderPDFPageRef.current) {
          renderPDFPageRef.current(currentPage);
        }
      });
      
    } catch (error) {
      console.error('❌ Failed to add cut-out:', error);
    }
  }, [cutoutTargetConditionId, currentProjectId, file.id, currentPage, scaleFactor, viewState.scale, currentViewport, getSelectedCondition, onCutoutModeChange]);

  // Complete continuous linear measurement
  const completeContinuousLinearMeasurement = useCallback(async () => {
    if (activePoints.length < 2) return;
    
    // Remove rubber band element with guarded removal
    const currentRubberBand = pageRubberBandRefs.current[currentPage];
    if (currentRubberBand && svgOverlayRef.current && currentRubberBand.parentNode === svgOverlayRef.current) {
      svgOverlayRef.current.removeChild(currentRubberBand);
    }
    
    // Clear page-scoped refs
    pageRubberBandRefs.current[currentPage] = null;
    setRubberBandElement(null);
    
    // Complete the measurement with all active points
    completeMeasurement(activePoints);
    
    // Reset continuous drawing state
    setIsContinuousDrawing(false);
    setActivePoints([]);
    setRunningLength(0);
  }, [activePoints, currentPage, completeMeasurement]);

  useEffect(() => {
    createRubberBandElementRef.current = createRubberBandElement;
  }, [createRubberBandElement]);
  useEffect(() => {
    completeCutoutRef.current = completeCutout;
  }, [completeCutout]);
  useEffect(() => {
    completeContinuousLinearMeasurementRef.current = completeContinuousLinearMeasurement;
  }, [completeContinuousLinearMeasurement]);

  // Cleanup continuous drawing state
  const cleanupContinuousDrawing = useCallback(() => {
    // Clean up rubber band for current page
    const currentRubberBand = pageRubberBandRefs.current[currentPage];
    if (currentRubberBand && svgOverlayRef.current && currentRubberBand.parentNode === svgOverlayRef.current) {
      try {
        svgOverlayRef.current.removeChild(currentRubberBand);
      } catch (e) {
        console.warn('🎯 Failed to remove rubber band:', e);
      }
    }
    
    // Clear page-scoped refs
    pageRubberBandRefs.current[currentPage] = null;
    setRubberBandElement(null);
    setIsContinuousDrawing(false);
    setActivePoints([]);
    setRunningLength(0);
  }, [currentPage]);

  // Reset continuous drawing when measurement type changes
  useEffect(() => {
    if (measurementType !== 'linear') {
      cleanupContinuousDrawing();
    }
  }, [measurementType, cleanupContinuousDrawing]);

  // Clean up page-scoped refs when page changes
  useEffect(() => {
    // Clean up any existing rubber band elements from previous pages
    Object.keys(pageRubberBandRefs.current).forEach(pageNum => {
      const pageNumInt = parseInt(pageNum);
      if (pageNumInt !== currentPage) {
        const rubberBand = pageRubberBandRefs.current[pageNumInt];
        if (rubberBand && rubberBand.parentNode) {
          try {
            rubberBand.parentNode.removeChild(rubberBand);
          } catch (e) {
            console.warn('🎯 Failed to clean up rubber band from page', pageNumInt, e);
          }
        }
        pageRubberBandRefs.current[pageNumInt] = null;
      }
    });
    
    // Clean up any existing committed polylines from previous pages
    Object.keys(pageCommittedPolylineRefs.current).forEach(pageNum => {
      const pageNumInt = parseInt(pageNum);
      if (pageNumInt !== currentPage) {
        const polyline = pageCommittedPolylineRefs.current[pageNumInt];
        if (polyline && polyline.parentNode) {
          try {
            polyline.parentNode.removeChild(polyline);
          } catch (e) {
            console.warn('🎯 Failed to clean up committed polyline from page', pageNumInt, e);
          }
        }
        pageCommittedPolylineRefs.current[pageNumInt] = null;
      }
    });
  }, [currentPage]);

  // Fit PDF to window function
  const fitToWindow = useCallback(async () => {
    if (!pdfDocument || !containerRef.current || !pdfPageRef.current) {
      return;
    }

    try {
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      
      // Get available space in container (accounting for any padding/margins)
      const availableWidth = containerRect.width - 20; // 10px padding on each side
      const availableHeight = containerRect.height - 20; // 10px padding on each side
      

      // Get the current page to calculate its dimensions
      const page = pdfPageRef.current;
      const viewport = page.getViewport({ scale: 1.0, rotation: viewState.rotation });
      

      // Calculate scale to fit both width and height
      const scaleX = availableWidth / viewport.width;
      const scaleY = availableHeight / viewport.height;
      const optimalScale = Math.min(scaleX, scaleY, PDF_VIEWER_MAX_SCALE); // Cap for performance (see PDF_VIEWER_MAX_SCALE)
      

      // FIX: Update viewport IMMEDIATELY before state changes to prevent drift
      // This ensures currentViewport is fresh before state updates trigger re-renders
      if (pdfPageRef.current) {
        const freshViewport = pdfPageRef.current.getViewport({ 
          scale: optimalScale, 
          rotation: viewState.rotation 
        });
        
        // Synchronously update pageViewports so currentViewport memo recalculates
        setPageViewports(prev => ({
          ...prev,
          [currentPage]: freshViewport
        }));
        
        // Update lastRenderedScaleRef so baseline scale logic uses correct value
        lastRenderedScaleRef.current = optimalScale;
      }

      // Apply the new scale
      if (onScaleChange) {
        onScaleChange(optimalScale);
      } else {
        setInternalViewState(prev => ({ ...prev, scale: optimalScale }));
      }

      // Note: No manual renderTakeoffAnnotations call needed - the useEffect
      // watching viewState.scale will handle re-rendering with the fresh viewport

    } catch (error) {
      console.error('❌ FIT_TO_WINDOW: Error fitting to window', error);
    }
  }, [pdfDocument, viewState.rotation, onScaleChange, localTakeoffMeasurements, forceMarkupReRender]);

  // Add scroll position tracking (debounced so we persist final position on reload)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onLocationChange) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        timeoutId = null;
        onLocationChange(container.scrollLeft, container.scrollTop);
      }, SCROLL_SAVE_DEBOUNCE_MS);
    };

    container.addEventListener('scroll', handleScroll);
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      container.removeEventListener('scroll', handleScroll);
    };
  }, [onLocationChange]);

  // Add global functions to restore scroll position and read current scroll (for beforeunload save)
  useEffect(() => {
    setRestoreScrollPosition((x: number, y: number) => {
      const container = containerRef.current;
      if (container) {
        container.scrollLeft = x;
        container.scrollTop = y;
      }
    });
    setGetCurrentScrollPosition(() => {
      const container = containerRef.current;
      if (!container) return null;
      return { x: container.scrollLeft, y: container.scrollTop };
    });

    return () => {
      setRestoreScrollPosition(undefined);
      setGetCurrentScrollPosition(undefined);
    };
  }, []);

  // Keep ref updated so document listener always calls latest handler
  handleWheelRef.current = handleWheel;

  // Cmd+scroll zoom: document-level capture listener so we receive the event regardless of
  // which child is the target. Registered once; handler uses ref to avoid effect churn.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const container = containerRef.current;
      if (!container || !container.contains(e.target as Node)) return;
      handleWheelRef.current?.(e);
    };
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => document.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  // Apply or clear interactive CSS zoom when external scale changes while renders are blocked
  useEffect(() => {
    const rendersBlocked = (isMeasuring || isCalibrating || currentMeasurement.length > 0 || isDeselecting || (isAnnotating && !showTextInput));
    if (rendersBlocked) {
      applyInteractiveZoomTransforms();
    } else {
      // Clear transforms if any
      if (pdfCanvasRef.current) {
        pdfCanvasRef.current.style.transform = '';
        pdfCanvasRef.current.style.transformOrigin = '';
      }
      if (svgOverlayRef.current) {
        svgOverlayRef.current.style.transform = '';
        svgOverlayRef.current.style.transformOrigin = '';
      }
      
      // CRITICAL: After clearing CSS transforms, re-render annotations with correct viewport
      // This fixes the issue where annotations disappear after zoom completes
      const hasMarkups = localTakeoffMeasurements.length > 0 || localAnnotations.length > 0;
      if (pdfDocument && pdfPageRef.current && hasMarkups) {
        const freshViewport = pdfPageRef.current.getViewport({ 
          scale: viewState.scale, 
          rotation: viewState.rotation 
        });
        renderMarkupsWithPointerEvents(currentPage, freshViewport, pdfPageRef.current ?? undefined);
      }
    }
  }, [viewState.scale, isMeasuring, isCalibrating, currentMeasurement.length, isDeselecting, isAnnotating, showTextInput, applyInteractiveZoomTransforms, pdfDocument, localTakeoffMeasurements, localAnnotations, currentPage, renderMarkupsWithPointerEvents]);

  // Keep currentPageRef in sync so renderPDFPage's finally block can re-trigger for the right page
  currentPageRef.current = currentPage;

  // Re-render when page changes
  // CRITICAL: Set viewport FIRST (before render) so overlay can draw immediately.
  // This ensures crosshairs and markup preview work on every page, even when canvas render is blocked.
  useEffect(() => {
    if (!pdfDocument || !isComponentMounted) return;

    let cancelled = false;
    
    (async () => {
      try {
        // STEP 1: Always get page and set viewport FIRST - this is never blocked
        const page = await pdfDocument.getPage(currentPage);
        if (cancelled) return;
        // Don't apply if user navigated to a different page while we were fetching
        if (currentPageRef.current !== currentPage) return;

        const viewport = page.getViewport({
          scale: viewState.scale,
          rotation: viewState.rotation,
        });
        
        // Set viewport and page ref immediately so overlay can draw
        pdfPageRef.current = page;
        const outputScale = window.devicePixelRatio || 1;
        
        // Update canvas/SVG dimensions and viewport state
        if (pdfCanvasRef.current && svgOverlayRef.current) {
          svgOverlayRef.current.setAttribute('width', viewport.width.toString());
          svgOverlayRef.current.setAttribute('height', viewport.height.toString());
          svgOverlayRef.current.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
          
          setPageViewports(prev => ({ ...prev, [currentPage]: viewport }));
          setPageOutputScales(prev => ({ ...prev, [currentPage]: outputScale }));
          
          // Immediately render overlay so crosshairs/preview appear without waiting for effect cycle
          if (renderMarkupsWithPointerEventsRef.current) {
            renderMarkupsWithPointerEventsRef.current(currentPage, viewport, page, false);
          }
        }
        
        if (cancelled) return;
        
        // STEP 2: Now try to render PDF canvas (this may be blocked by measuring mode, that's OK)
        setMeasurements([]);
        
        const attemptRender = async (retries = 3) => {
          if (cancelled) return;
          if (pdfCanvasRef.current && containerRef.current && renderPDFPageRef.current) {
            await renderPDFPageRef.current(currentPage);
          } else if (retries > 0) {
            setTimeout(() => attemptRender(retries - 1), 50);
          }
        };
        
        await attemptRender();
      } catch (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Error in page change effect:', err);
        }
      }
    })();
    
    return () => {
      cancelled = true;
    };
  }, [pdfDocument, currentPage, isComponentMounted, viewState.scale, viewState.rotation]);

  // VIEWPORT FALLBACK: Safety net in case page-change effect didn't set viewport (e.g., due to race condition).
  useEffect(() => {
    if (!pdfDocument || !currentPage || currentViewport != null) return;
    if (!pdfCanvasRef.current || !svgOverlayRef.current) return;

    const pageToFetch = currentPage;
    let cancelled = false;
    
    (async () => {
      try {
        const page = await pdfDocument.getPage(pageToFetch);
        if (cancelled || currentPageRef.current !== pageToFetch) return;
        
        const viewport = page.getViewport({
          scale: viewState.scale,
          rotation: viewState.rotation,
        });
        if (cancelled || currentPageRef.current !== pageToFetch) return;
        
        pdfPageRef.current = page;
        const outputScale = window.devicePixelRatio || 1;
        
        if (svgOverlayRef.current) {
          svgOverlayRef.current.setAttribute('width', viewport.width.toString());
          svgOverlayRef.current.setAttribute('height', viewport.height.toString());
          svgOverlayRef.current.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
        }
        
        setPageViewports(prev => ({ ...prev, [pageToFetch]: viewport }));
        setPageOutputScales(prev => ({ ...prev, [pageToFetch]: outputScale }));
      } catch {
        // Silently ignore - page-change effect will handle this
      }
    })();
    
    return () => {
      cancelled = true;
    };
  }, [pdfDocument, currentPage, currentViewport, viewState.scale, viewState.rotation]);

  // Page visibility handler - ensures overlays are rendered when returning to a page
  // SIMPLIFIED: Single render call, no cascading timeouts
  useEffect(() => {
    if (pdfDocument && currentViewport && !isRenderingRef.current && pdfPageRef.current) {
      // Call onPageShown to initialize overlay
      onPageShown(currentPage, currentViewport);
    }
  }, [currentPage, currentViewport, onPageShown, pdfDocument]);


  // Clear current measurement state when page changes
  useEffect(() => {
    setCurrentMeasurement([]);
    setMousePosition(null);
    setMeasurements([]);
  }, [currentPage]);

  // Optimized re-render when view state changes (zoom/rotation)
  useEffect(() => {
    if (pdfDocument && isComponentMounted && isInitialRenderComplete) {
      // ANTI-FLICKER: Skip PDF re-render during interactive operations or deselection cooldown
      // Allow PDF renders during text annotation input (showTextInput = true)
      // Allow initial renders even if in deselection mode (for page loads)
      if (isMeasuring || isCalibrating || currentMeasurement.length > 0 || (isDeselecting && isInitialRenderComplete) || (isAnnotating && !showTextInput)) {
        // When blocked, simulate zoom via CSS transform so the user sees immediate zoom
        // without re-rendering the PDF canvas (prevents flicker while drawing)
        applyInteractiveZoomTransforms();
        return;
      }
      
      // NOTE: Removed redundant isDeselecting block - the check above already handles it
      // Allowing renders during deselection enables proper markup selection
      
      // Optimized debounce for non-interactive mode
      // CRITICAL: Use ref to avoid dependency on renderPDFPage which changes frequently
      const timeoutId = setTimeout(() => {
        if (renderPDFPageRef.current) {
          renderPDFPageRef.current(currentPage);
        }
      }, 30); // Further reduced debounce for better responsiveness
      
      return () => clearTimeout(timeoutId);
    }
  // NOTE: Using renderPDFPageRef instead of renderPDFPage to prevent cascading re-renders
  }, [pdfDocument, viewState, currentPage, isComponentMounted, isMeasuring, isCalibrating, currentMeasurement, isDeselecting, isInitialRenderComplete, isAnnotating, showTextInput]);


  // Set measurement type when condition is selected
  useEffect(() => {
    if (selectedConditionId) {
      const condition = getSelectedCondition();
      if (condition) {
        // Auto-count conditions use box selection, NOT measurement mode
        // Check this FIRST before enabling measurement mode
        if (condition.type === 'auto-count') {
          setIsMeasuring(false); // Disable measuring mode - auto-count uses box selection
          setIsSelectionMode(false);
          setSelectedMarkupIds([]);
          setIsDeselecting(false);
          setMeasurementType('count'); // Set type but don't enable measuring
          // Auto-count box selection is handled by visualSearchMode prop and isSelectingSymbol state
          return; // Exit early - don't enable measurement mode
        }
        
        // All other condition types use measurement mode
        setIsMeasuring(true);
        setIsSelectionMode(false);
        setSelectedMarkupIds([]);
        setIsDeselecting(false); // Clear deselection state
        
        // Always use condition.type first - linear conditions with height stay as linear
        // (auto-count already handled above with early return)
        if (condition.type === 'count') {
          setMeasurementType('count');
        } else if (condition.type === 'volume') {
          setMeasurementType('volume');
        } else if (condition.type === 'area') {
          setMeasurementType('area');
        } else if (condition.type === 'linear') {
          // Linear conditions always stay as linear, even with height enabled
          setMeasurementType('linear');
        } else {
          // Fallback to unit-based detection for legacy conditions
          if (condition.unit === 'EA' || condition.unit === 'each') {
            setMeasurementType('count');
          } else if (condition.unit === 'SF' || condition.unit === 'sq ft') {
            setMeasurementType('area');
          } else if (condition.unit === 'CY' || condition.unit === 'cu yd') {
            setMeasurementType('volume');
          } else {
            setMeasurementType('linear');
          }
        }
      } else {
        // VALIDATION FIX: Condition ID exists but condition object is missing
        // This can happen during condition reload or if condition was deleted
        // Clear measurement mode to prevent stale state and silent click failures
        console.warn('Condition not found: selectedConditionId exists but condition object missing', {
          selectedConditionId,
          conditionsCount: useConditionStore.getState().conditions.length
        });
        
        // Clear measurement state to prevent clicks from failing silently
        // This doesn't trigger renders (just state updates) and respects guard logic
        setIsMeasuring(false);
        setIsSelectionMode(true);
        setSelectedMarkupIds([]);
        // DON'T set isDeselecting here - that's only for explicit deselection
        // DON'T clear selectedConditionId in store - let the UI handle that
        // This prevents flicker while allowing the UI to show the selection state
      }
    } else {
      setIsMeasuring(false);
      setIsSelectionMode(true);
      setCurrentMeasurement([]);
      setMousePosition(null);
      setMeasurements([]);
      
      // ANTI-FLICKER: Brief cooldown after deselection to prevent flicker
      // Reduced from 5 seconds to 500ms for better responsiveness
      setIsDeselecting(true);
      
      // Store timeout ID so we can clear it if needed
      const timeoutId = setTimeout(() => {
        setIsDeselecting(false);
      }, 500); // 500ms cooldown after deselection
      
      // Clear timeout if component unmounts or condition changes
      return () => {
        clearTimeout(timeoutId);
        setIsDeselecting(false);
      };
    }
  }, [selectedConditionId, getSelectedCondition]);

  // Set annotation mode when annotation tool is selected
  useEffect(() => {
    if (annotationTool) {
      setIsAnnotating(true);
      setIsSelectionMode(false);
      setSelectedMarkupIds([]);
      setIsDeselecting(false); // Clear deselection state
    } else {
      setIsAnnotating(false);
      setIsSelectionMode(true);
      setCurrentAnnotation([]);
      setMousePosition(null);
    }
  }, [annotationTool]);

  // Listen for calibration requests
  useEffect(() => {
    if (onCalibrationRequest) {
      const handleCalibrationRequest = () => {
        setShowCalibrationDialog(true);
      };
      setTriggerCalibration(handleCalibrationRequest);
      return () => setTriggerCalibration(undefined);
    }
  }, [onCalibrationRequest]);

  // Expose fitToWindow function globally
  useEffect(() => {
    setTriggerFitToWindow(fitToWindow);
    return () => setTriggerFitToWindow(undefined);
  }, [fitToWindow]);

  // Cleanup effect for memory management
  useEffect(() => {
    return () => {
      // Cancel any pending render tasks
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      
      // Clear and reset canvas context
      if (pdfCanvasRef.current) {
        const context = pdfCanvasRef.current.getContext('2d');
        if (context) {
          context.clearRect(0, 0, pdfCanvasRef.current.width, pdfCanvasRef.current.height);
          context.setTransform(1, 0, 0, 1, 0, 0);
        }
        // Reset canvas dimensions to free memory
        pdfCanvasRef.current.width = 0;
        pdfCanvasRef.current.height = 0;
      }
      
      // Clear SVG overlay
      if (svgOverlayRef.current) {
        svgOverlayRef.current.innerHTML = '';
      }
      
      // Clear refs to prevent memory leaks
      pdfPageRef.current = null;
      isRenderingRef.current = false;
      
      // Clear page-specific viewport data
      setPageViewports({});
      setPageOutputScales({});
    };
  }, []);

  if (isLoading) {
    return <PDFViewerStatusView status="loading" className={className} />;
  }

  if (error) {
    return <PDFViewerStatusView status="error" className={className} message={error} />;
  }

  if (!pdfDocument) {
    return (
      <PDFViewerStatusView
        status="no-document"
        className={className}
        fileLabel={file.originalName || file.id || 'Unknown'}
      />
    );
  }

  const overlayCursor = cutoutMode
    ? 'crosshair'
    : (isCalibrating ? 'crosshair' : (isMeasuring ? 'crosshair' : (isBoxSelectionMode ? 'crosshair' : (isSelectionMode ? 'pointer' : 'default'))));
  const svgPointerEvents = (isSelectionMode || isCalibrating || annotationTool || isDrawingBoxSelection) ? 'auto' : 'none';
  const overlayKey = `overlay-${currentPage}-${file.id}`;
  const textAnnotationProps = showTextInput && textInputPosition
    ? {
        show: true,
        position: textInputPosition,
        value: textInputValue,
        onChange: setTextInputValue,
        onSave: () => {
          if (textInputValue.trim() && currentProjectId) {
            const created = addAnnotation({
              projectId: currentProjectId,
              sheetId: file.id,
              type: 'text',
              points: currentAnnotation,
              color: annotationColor,
              text: textInputValue,
              pageNumber: currentPage,
            });
            useUndoStore.getState().push({ type: 'annotation_add', id: created.id, annotation: created });
            setCurrentAnnotation([]);
            setTextInputValue('');
            setShowTextInput(false);
            setTextInputPosition(null);
            onAnnotationToolChange?.(null);
          }
        },
        onCancel: () => {
          setCurrentAnnotation([]);
          setTextInputValue('');
          setShowTextInput(false);
          setTextInputPosition(null);
          onAnnotationToolChange?.(null);
        },
      }
    : null;

  return (
    <div className={`pdf-viewer-container h-full flex flex-col relative ${className}`}>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>


      {/* Single Canvas + SVG Overlay Container */}
      <div 
        ref={containerRef}
        className="canvas-container flex-1 h-full overflow-auto"
        style={{ 
          cursor: cutoutMode 
            ? 'crosshair' 
            : (isCalibrating ? 'crosshair' : (isMeasuring ? 'crosshair' : (isBoxSelectionMode ? 'crosshair' : (isSelectionMode ? 'pointer' : 'default'))))
        }}
      >
        <div className="flex justify-start p-6 relative">
          <PDFViewerCanvasOverlay
            pdfCanvasRef={pdfCanvasRef}
            svgOverlayRef={svgOverlayRef}
            overlayKey={overlayKey}
            currentPage={currentPage}
            cursor={overlayCursor}
            svgPointerEvents={svgPointerEvents}
            onCanvasClick={handleClick as (e: React.MouseEvent<HTMLCanvasElement>) => void}
            onCanvasMouseDown={handleMouseDown as (e: React.MouseEvent<HTMLCanvasElement>) => void}
            onCanvasMouseUp={handleMouseUp as (e: React.MouseEvent<HTMLCanvasElement>) => void}
            onCanvasDoubleClick={handleCanvasDoubleClick}
            onCanvasMouseMove={handleMouseMove as (e: React.MouseEvent<HTMLCanvasElement>) => void}
            onCanvasMouseLeave={() => setMousePosition(null)}
            onSvgMouseMove={handleMouseMove as (e: React.MouseEvent<SVGSVGElement>) => void}
            onSvgMouseDown={handleMouseDown as (e: React.MouseEvent<SVGSVGElement>) => void}
            onSvgMouseUp={handleMouseUp as (e: React.MouseEvent<SVGSVGElement>) => void}
            onSvgMouseLeave={() => setMousePosition(null)}
            onSvgClick={handleSvgClick}
            onSvgDoubleClick={handleSvgDoubleClick}
            isPDFLoading={isPDFLoading}
            textAnnotation={textAnnotationProps}
          />
        </div>
      </div>

      <PDFViewerDialogs
        showCalibrationDialog={showCalibrationDialog}
        setShowCalibrationDialog={setShowCalibrationDialog}
        showScaleApplicationDialog={showScaleApplicationDialog}
        setShowScaleApplicationDialog={setShowScaleApplicationDialog}
        startCalibration={startCalibration}
        applyScale={applyScale}
        isPageCalibrated={isPageCalibrated}
        scaleFactor={scaleFactor}
        unit={unit}
        pendingScaleData={pendingScaleData}
        isCalibrating={isCalibrating}
        currentPage={currentPage}
        totalPages={totalPages}
      />
    </div>
  );
};

export default PDFViewer;