import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { useProjectStore } from '../store/slices/projectSlice';
import { useConditionStore } from '../store/slices/conditionSlice';
import { useMeasurementStore } from '../store/slices/measurementSlice';
import { useAnnotationStore } from '../store/slices/annotationSlice';
import type { Annotation } from '../types';
import type { PDFViewerProps, Measurement } from './PDFViewer.types';
import { usePDFLoad } from './pdf-viewer/usePDFLoad';
import { usePDFViewerCalibration } from './pdf-viewer/usePDFViewerCalibration';
import { usePDFViewerData } from './pdf-viewer/usePDFViewerData';
import { usePDFViewerMeasurements } from './pdf-viewer/usePDFViewerMeasurements';
import {
  renderSVGSelectionBox,
  renderSVGCurrentCutout,
  renderSVGCrosshair,
} from './pdf-viewer/pdfViewerRenderers';
import { PDFViewerCanvasOverlay } from './pdf-viewer/PDFViewerCanvasOverlay';
import { PDFViewerDialogs } from './pdf-viewer/PDFViewerDialogs';
import { PDFViewerStatusView } from './pdf-viewer/PDFViewerStatusView';
import { formatFeetAndInches } from '../lib/utils';
import { setRestoreScrollPosition, setTriggerCalibration, setTriggerFitToWindow } from '../lib/windowBridge';
import { calculateDistance } from '../utils/commonUtils';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerPort = null;

/** Safely convert API timestamp to ISO string; avoids RangeError for invalid dates */
function safeTimestampToISO(ts: string | number | undefined | null): string {
  if (ts == null || ts === '') return new Date().toISOString();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

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
    scale: externalScale ?? internalViewState.scale, 
    rotation: externalRotation ?? internalViewState.rotation
  }), [externalScale, internalViewState.scale, externalRotation, internalViewState.rotation]);

  // PDF loading state
  const [isPDFLoading, setIsPDFLoading] = useState(false);
  
  // Track last fully rendered PDF scale to support interactive CSS zoom while blocking renders
  const lastRenderedScaleRef = useRef(1.0);
  
  // Helper to apply/remove interactive CSS zoom transforms when renders are blocked
  const applyInteractiveZoomTransforms = useCallback(() => {
    const canvas = pdfCanvasRef.current as HTMLCanvasElement | null;
    const svg = svgOverlayRef.current as SVGSVGElement | null;
    if (!canvas || !svg || !pdfPageRef.current) return;
    
    const renderedScale = lastRenderedScaleRef.current || 1.0;
    const targetScale = (viewState.scale || 1.0) / renderedScale;
    
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
    selectedMarkupId,
    setSelectedMarkupId,
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
  const getPageAnnotations = useAnnotationStore((s) => s.getPageAnnotations);
  const getPageTakeoffMeasurements = useMeasurementStore((s) => s.getPageTakeoffMeasurements);
  
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
    if (visualSearchMode || !!titleblockSelectionMode) {
      setIsSelectingSymbol(true);
      setSelectionBox(null);
      setSelectionStart(null);
    } else {
      setIsSelectingSymbol(false);
      setSelectionBox(null);
      setSelectionStart(null);
    }
  }, [visualSearchMode, titleblockSelectionMode]);

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
        const shouldReceiveClicks = isSelectionMode || isCalibrating || annotationTool || (visualSearchMode && isSelectingSymbol) || (!!titleblockSelectionMode && isSelectingSymbol);
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
  }, [updateMarkupPointerEvents, isSelectionMode, isCalibrating, annotationTool, visualSearchMode, isSelectingSymbol, titleblockSelectionMode]);

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
    
    // CRITICAL: Only clear overlay if we're sure there are no markups AND measurements have finished loading
    // This prevents race conditions where measurements are loading but overlay gets cleared
    if (!hasAnyMarkups && !measurementsLoading) {
      // Only clear if we're certain there are no markups
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
      const shouldCaptureClicks = isCalibrating || annotationTool || (visualSearchMode && isSelectingSymbol) || (!!titleblockSelectionMode && isSelectingSymbol);
      hitArea.setAttribute('pointer-events', shouldCaptureClicks ? 'all' : 'none');
    }
    svgOverlay.appendChild(hitArea);
    
    // Render measurements for this page
    pageMeasurements.forEach((measurement) => {
      // Removed verbose logging - was causing console spam
      renderSVGMeasurement(svgOverlay, measurement, viewport, page, isSelectionMode);
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
          renderSVGCurrentMeasurement(svgOverlay, viewport);
        }
      }
    }
    
    // Draw current cut-out being created (only if on the page being rendered)
    if (cutoutMode && currentCutout.length > 0 && pageNum === currentPage) {
      renderSVGCurrentCutout(svgOverlay, viewport, currentCutout, mousePosition);
    }
    
    // Draw visual search or titleblock selection box (only if on the page being rendered)
    if ((visualSearchMode || !!titleblockSelectionMode) && isSelectingSymbol && selectionBox && pageNum === currentPage) {
      renderSVGSelectionBox(svgOverlay, selectionBox, viewport);
    }
    
    // Render completed annotations for this page
    localAnnotations.forEach(annotation => {
      // Double-check that this annotation belongs to the page being rendered
      if (annotation.pageNumber === pageNum) {
        renderSVGAnnotation(svgOverlay, annotation, viewport);
      }
    });
    
    // Draw current annotation being created (only if on the page being rendered)
    // Show preview even with no points yet (for initial mouse tracking)
    if (annotationTool && pageNum === currentPage) {
      renderSVGCurrentAnnotation(svgOverlay, viewport);
    }
    
    // Draw calibration points (only if on the page being rendered)
    if (isCalibrating && calibrationPoints.length > 0 && pageNum === currentPage) {
      renderSVGCalibrationPoints(svgOverlay);
    }
    
    // Draw crosshair if measuring, calibrating, or annotating (only if on the page being rendered)
    if (mousePosition && (isMeasuring || isCalibrating || annotationTool) && pageNum === currentPage) {
      renderSVGCrosshair(svgOverlay, mousePosition, viewport, isCalibrating);
    }
    
    // Draw running length display for continuous linear drawing
    if (isContinuousDrawing && activePoints.length > 0 && pageNum === currentPage) {
      renderRunningLengthDisplay(svgOverlay, viewport);
    }
    
  }, [localTakeoffMeasurements, currentMeasurement, measurementType, isMeasuring, isCalibrating, calibrationPoints, mousePosition, isSelectionMode, currentPage, isContinuousDrawing, activePoints, runningLength, localAnnotations, annotationTool, currentAnnotation, cutoutMode, currentCutout, visualSearchMode, titleblockSelectionMode, isSelectingSymbol, selectionBox, currentProjectId, file.id, getPageTakeoffMeasurements, measurementsLoading, getConditionColor]);

  // OPTIMIZED: Update only visual styling of markups when selection changes (no full re-render)
  const updateMarkupSelection = useCallback((newSelectedId: string | null, previousSelectedId: string | null) => {
    if (!svgOverlayRef.current) return;
    
    const svg = svgOverlayRef.current;
    
    // Update previously selected markup (deselect)
    if (previousSelectedId) {
      // Find measurement elements (main shape elements, not hit areas)
      // CRITICAL: Exclude hit areas by checking if element has transparent fill/stroke
      const prevMeasurementElements = svg.querySelectorAll(`[data-measurement-id="${previousSelectedId}"]`);
      prevMeasurementElements.forEach((el) => {
        const element = el as SVGElement;
        
        // Skip hit areas - they have transparent fill or are much larger than the main element
        const fill = element.getAttribute('fill');
        const stroke = element.getAttribute('stroke');
        const isHitArea = fill === 'transparent' || stroke === 'transparent';
        
        // For circles, also check radius - hit areas are much larger (r=20 vs r=8)
        if (element.tagName === 'circle') {
          const r = parseFloat(element.getAttribute('r') || '0');
          if (r > 15) { // Hit area circles have r=20, main circles have r=8
            return; // Skip this element - it's a hit area
          }
        }
        
        // Skip if this is a hit area
        if (isHitArea) {
          return;
        }
        
        const measurement = localTakeoffMeasurements.find(m => m.id === previousSelectedId);
        if (measurement) {
          const defaultColor = getConditionColor(measurement.conditionId, measurement.conditionColor);
          const defaultStrokeWidth = '2';
          
          // Update stroke color and width for shape elements
          if (element.tagName === 'polyline' || element.tagName === 'polygon' || element.tagName === 'path') {
            element.setAttribute('stroke', defaultColor);
            element.setAttribute('stroke-width', defaultStrokeWidth);
          } else if (element.tagName === 'circle') {
            // Count markups: no stroke when not selected (only red stroke when selected)
            element.setAttribute('stroke', 'none');
            element.removeAttribute('stroke-width');
          }
        }
      });
      
      // Find and update text elements for measurements (search by traversing siblings)
      const prevMeasurement = localTakeoffMeasurements.find(m => m.id === previousSelectedId);
      if (prevMeasurement) {
        const defaultColor = getConditionColor(prevMeasurement.conditionId, prevMeasurement.conditionColor);
        // Find text elements that follow measurement shapes
        const allTextElements = svg.querySelectorAll('text');
        allTextElements.forEach((textEl) => {
          // Check if this text is associated with the measurement by checking nearby elements
          const prevSibling = textEl.previousElementSibling;
          if (prevSibling && prevSibling.getAttribute('data-measurement-id') === previousSelectedId) {
            textEl.setAttribute('fill', defaultColor);
          }
        });
      }
      
      // Find annotation elements
      const prevAnnotationElements = svg.querySelectorAll(`[data-annotation-id="${previousSelectedId}"]`);
      prevAnnotationElements.forEach((el) => {
        const element = el as SVGElement;
        const annotation = localAnnotations.find(a => a.id === previousSelectedId);
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
    }
    
    // Update newly selected markup (select)
    if (newSelectedId) {
      // Find measurement elements (main shape elements, not hit areas)
      // CRITICAL: Exclude hit areas by checking if element has transparent fill/stroke (hit areas are always transparent)
      const newMeasurementElements = svg.querySelectorAll(`[data-measurement-id="${newSelectedId}"]`);
      newMeasurementElements.forEach((el) => {
        const element = el as SVGElement;
        
        // Skip hit areas - they have transparent fill or are much larger than the main element
        const fill = element.getAttribute('fill');
        const stroke = element.getAttribute('stroke');
        const isHitArea = fill === 'transparent' || stroke === 'transparent';
        
        // For circles, also check radius - hit areas are much larger (r=20 vs r=8)
        if (element.tagName === 'circle') {
          const r = parseFloat(element.getAttribute('r') || '0');
          if (r > 15) { // Hit area circles have r=20, main circles have r=8
            return; // Skip this element - it's a hit area
          }
        }
        
        // Skip if this is a hit area
        if (isHitArea) {
          return;
        }
        
        // Update stroke color and width for selected state
        if (element.tagName === 'polyline' || element.tagName === 'polygon' || element.tagName === 'path') {
          element.setAttribute('stroke', '#ff0000');
          element.setAttribute('stroke-width', '4');
        } else if (element.tagName === 'circle') {
          element.setAttribute('stroke', '#ff0000');
          element.setAttribute('stroke-width', '3');
        }
      });
      
      // Find and update text elements for measurements
      const allTextElements = svg.querySelectorAll('text');
      allTextElements.forEach((textEl) => {
        const prevSibling = textEl.previousElementSibling;
        if (prevSibling && prevSibling.getAttribute('data-measurement-id') === newSelectedId) {
          textEl.setAttribute('fill', '#ff0000');
        }
      });
      
      // Find annotation elements
      const newAnnotationElements = svg.querySelectorAll(`[data-annotation-id="${newSelectedId}"]`);
      newAnnotationElements.forEach((el) => {
        const element = el as SVGElement;
        
        if (element.tagName === 'line' || element.tagName === 'rect' || element.tagName === 'ellipse') {
          element.setAttribute('stroke', '#00ff00');
          element.setAttribute('stroke-width', '5');
        } else if (element.tagName === 'text') {
          element.setAttribute('fill', '#00ff00');
        }
      });
    }
  }, [localTakeoffMeasurements, localAnnotations, getConditionColor]);

  // Re-render annotations when measurements or interaction state changes
  // NOTE: selectedMarkupId is removed from dependencies to prevent full re-renders on selection changes
  // CRITICAL: Allow markup rendering even when isDeselecting is true - we need markups to be selectable
  // isDeselecting only blocks PDF canvas renders, not markup overlay renders
  useEffect(() => {
    if (pdfDocument && currentViewport && !isRenderingRef.current) {
      // Only render if we have measurements, annotations, or if we're in measuring/annotation/visual search mode
      // CRITICAL FIX: Include activePoints.length check to ensure continuous linear preview renders
      // CRITICAL: Always render if we have markups OR are in an interactive mode
      const hasActivePoints = isContinuousDrawing && activePoints.length > 0;
      const isInteractiveMode = isMeasuring || isCalibrating || currentMeasurement.length > 0 || hasActivePoints || isAnnotating || (visualSearchMode && isSelectingSymbol) || (!!titleblockSelectionMode && isSelectingSymbol);
      
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
  }, [localTakeoffMeasurements, currentMeasurement, isMeasuring, isCalibrating, calibrationPoints, mousePosition, renderMarkupsWithPointerEvents, currentPage, currentViewport, isAnnotating, localAnnotations, visualSearchMode, titleblockSelectionMode, isSelectingSymbol, selectionBox, currentAnnotation, isContinuousDrawing, activePoints, pdfDocument, measurementsLoading, currentProjectId, file.id, getPageTakeoffMeasurements, isSelectionMode, totalPages, conditions]);

  // Track previous measurements for comparison (used by other logic)
  const prevLocalTakeoffMeasurementsRef = useRef<Measurement[]>([]);
  useEffect(() => {
    prevLocalTakeoffMeasurementsRef.current = localTakeoffMeasurements;
  }, [localTakeoffMeasurements]);
  
  // NOTE: Measurement rendering is handled by the main render effect above (line 1216)
  // No additional effect needed here to avoid duplicate renders and flicker

  // OPTIMIZED: Update only visual styling when selection changes (no full re-render)
  const prevSelectedMarkupIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Only update if selection actually changed
    if (selectedMarkupId !== prevSelectedMarkupIdRef.current) {
      const previousId = prevSelectedMarkupIdRef.current;
      prevSelectedMarkupIdRef.current = selectedMarkupId;
      
      // SIMPLIFIED: Direct update, no retries needed
      if (svgOverlayRef.current && svgOverlayRef.current.children.length > 0) {
        updateMarkupSelection(selectedMarkupId, previousId);
      }
    }
  }, [selectedMarkupId, updateMarkupSelection]);
  
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
    const shouldSVGReceiveClicks = isSelectionMode || isCalibrating || annotationTool || (visualSearchMode && isSelectingSymbol) || (!!titleblockSelectionMode && isSelectingSymbol);
    svgOverlayRef.current.style.pointerEvents = shouldSVGReceiveClicks ? 'auto' : 'none';
    
    // Update hit-area pointer-events
    const hitArea = svgOverlayRef.current.querySelector('#hit-area') as SVGRectElement;
    if (hitArea) {
      if (isSelectionMode) {
        hitArea.setAttribute('pointer-events', 'none');
      } else {
        const shouldCaptureClicks = isCalibrating || annotationTool || (visualSearchMode && isSelectingSymbol) || (!!titleblockSelectionMode && isSelectingSymbol);
        hitArea.setAttribute('pointer-events', shouldCaptureClicks ? 'all' : 'none');
      }
    }
    
    // CRITICAL: Update markup pointer-events directly when mode changes
    // This is much more efficient than re-rendering the entire overlay
    updateMarkupPointerEvents(isSelectionMode);
    
    // Track mode changes
    prevIsSelectionModeRef.current = isSelectionMode;
  }, [isSelectionMode, isCalibrating, annotationTool, visualSearchMode, titleblockSelectionMode, isSelectingSymbol, updateMarkupPointerEvents]);

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
        const shouldCaptureClicks = isCalibrating || annotationTool || (visualSearchMode && isSelectingSymbol) || (!!titleblockSelectionMode && isSelectingSymbol);
        hitArea.setAttribute('pointer-events', shouldCaptureClicks ? 'all' : 'none');
      }
    }
    
    // Always re-render all annotations for this page, regardless of current state
    // This ensures takeoffs are visible immediately when the page loads
    // Use current state values, not captured values
    const currentMeasurements = useMeasurementStore.getState().takeoffMeasurements.filter(
      (m) => m.projectId === currentProjectId && m.sheetId === file.id && m.pdfPage === pageNum
    );
    
    // Render immediately if we have measurements
    // CRITICAL FIX: Force immediate render if in selection mode to ensure pointer-events are updated
    if (currentMeasurements.length > 0 || localTakeoffMeasurements.length > 0) {
      renderMarkupsWithPointerEvents(pageNum, viewport, pdfPageRef.current ?? undefined, isSelectionMode);
    }
    // Note: If no measurements, the reactive useEffect will handle rendering when they load
    // The reactive useEffect watches allTakeoffMeasurements and will trigger render when measurements arrive
  }, [renderMarkupsWithPointerEvents, localTakeoffMeasurements, currentProjectId, file.id, isSelectionMode, isCalibrating, annotationTool, visualSearchMode, titleblockSelectionMode, isSelectingSymbol]);


  // PDF render function with page-specific viewport isolation
  const renderPDFPage = useCallback(async (pageNum: number) => {
    // ANTI-FLICKER: Block PDF renders during interactive operations or deselection cooldown
    // Allow PDF renders during text annotation input (showTextInput = true)
    // Allow initial renders even if in deselection mode (for page loads)
    // CRITICAL FIX: Allow initial render even if isMeasuring is true - this ensures the viewport
    // is set so clicks can work. Only block re-renders during measurement to prevent flicker.
    // Block renders during interactive operations to prevent flicker
    const isInitialRender = !isInitialRenderComplete;
    if (!isInitialRender && (isMeasuring || isCalibrating || currentMeasurement.length > 0 || (isDeselecting && isInitialRenderComplete) || (isAnnotating && !showTextInput))) {
      return;
    }
    
    // Show loading indicator for initial renders
    if (!isInitialRenderComplete) {
      setIsPDFLoading(true);
    }
    
    // Reduced delay for better performance
    await new Promise(resolve => setTimeout(resolve, 5));
    
    if (!isComponentMounted || !pdfDocument || !pdfCanvasRef.current || !containerRef.current) {
      // Silently skip - this is normal during initial mount
      return;
    }
    
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
      
      // Record the scale at which the PDF canvas was actually rendered
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
      // CRITICAL: Also check if measurements are loaded and render them
      // This handles the case where measurements load after the PDF renders
      try {
        // Get current measurements for this page from store (may have loaded after PDF render started)
        const currentMeasurements = useMeasurementStore.getState().takeoffMeasurements.filter(
          (m) => m.projectId === currentProjectId && m.sheetId === file.id && m.pdfPage === pageNum
        );
        
        // CRITICAL FIX: Get current selection mode state (may have changed since callback was created)
        // Force immediate render if in selection mode to ensure pointer-events are updated
        const currentSelectionMode = isSelectionMode; // Capture from closure - will be current value
        if (currentMeasurements.length > 0 || localTakeoffMeasurements.length > 0) {
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
    }
  }, [pdfDocument, viewState, updateCanvasDimensions, onPageShown, isComponentMounted, isMeasuring, isCalibrating, currentMeasurement, isDeselecting, isAnnotating, isSelectionMode, localTakeoffMeasurements, currentProjectId, file.id, currentPage, renderMarkupsWithPointerEvents]);

  // Keep renderPDFPage ref in sync (runs synchronously during render)
  renderPDFPageRef.current = renderPDFPage;

  // No coordinate conversions needed - SVG viewBox matches viewport exactly
  // CSS pixels = SVG pixels = viewport pixels (1:1 mapping)

  // Render individual measurement as SVG
  // CRITICAL: Accept isSelectionMode as parameter to avoid stale closure values
  const renderSVGMeasurement = (svg: SVGSVGElement, measurement: Measurement, viewport: PageViewport, page: PDFPageProxy | undefined, selectionMode: boolean) => {
    if (!measurement || !measurement.points || !viewport) {
      return;
    }
    
    const points = measurement.points;
    if (points.length < 1) {
      return;
    }
    
    // For count measurements, we only need 1 point
    if (measurement.type === 'count' && points.length < 1) return;
    // For other measurements, we need at least 2 points
    if (measurement.type !== 'count' && points.length < 2) {
      return;
    }
    
    // Transform points to match current viewport
    // Points are stored normalized to BASE viewport (rotation 0), but we need to render on ROTATED viewport
    const pdfPage = pdfPageRef.current;
    if (!pdfPage) return;
    
    // Use the passed viewport directly - caller already calculated the correct one
    const currentViewport = viewport;
    
    // Get base viewport (rotation 0) to transform coordinates correctly
    const baseViewport = pdfPage.getViewport({ scale: 1, rotation: 0 });
    const rotation = viewState.rotation || 0;
    
    // Convert normalized coordinates (base viewport) to current viewport coordinates (rotated)
    // This is the INVERSE of the transformation we do when storing coordinates
    const transformedPoints = points.map((point, idx) => {
      // Coordinates are normalized to base viewport (rotation 0)
      const normalizedX = point.x;
      const normalizedY = point.y;
      
      // Transform from base normalized coordinates to rotated viewport coordinates
      let canvasX: number, canvasY: number;
      
      if (rotation === 0) {
        // No rotation: direct mapping
        canvasX = normalizedX * currentViewport.width;
        canvasY = normalizedY * currentViewport.height;
      } else if (rotation === 90) {
        // 90° clockwise rotation
        // Storage: (cssX/RW, cssY/RH) rotated → (cssY/RH, 1 - cssX/RW) base normalized
        // So: normalizedX = cssY/RH, normalizedY = 1 - cssX/RW
        // Rendering inverse: cssX = RW * (1 - normalizedY), cssY = RH * normalizedX
        canvasX = currentViewport.width * (1 - normalizedY);
        canvasY = currentViewport.height * normalizedX;
      } else if (rotation === 180) {
        // 180° rotation
        // Storage: (cssX/RW, cssY/RH) rotated → (1 - cssX/RW, 1 - cssY/RH) base normalized
        // So: normalizedX = 1 - cssX/RW, normalizedY = 1 - cssY/RH
        // Rendering inverse: cssX = RW * (1 - normalizedX), cssY = RH * (1 - normalizedY)
        canvasX = currentViewport.width * (1 - normalizedX);
        canvasY = currentViewport.height * (1 - normalizedY);
      } else if (rotation === 270) {
        // 270° clockwise rotation (or -90°)
        // Storage: (cssX/RW, cssY/RH) rotated → (1 - cssY/RH, cssX/RW) base normalized
        // So: normalizedX = 1 - cssY/RH, normalizedY = cssX/RW
        // Rendering inverse: cssX = RW * normalizedY, cssY = RH * (1 - normalizedX)
        canvasX = currentViewport.width * normalizedY;
        canvasY = currentViewport.height * (1 - normalizedX);
      } else {
        // Fallback: direct mapping
        canvasX = normalizedX * currentViewport.width;
        canvasY = normalizedY * currentViewport.height;
      }
      
      return {
        x: canvasX,
        y: canvasY
      };
    });
    
    const isSelected = selectedMarkupId === measurement.id;
    // Use live condition color instead of stored color so updates reflect immediately
    const liveColor = getConditionColor(measurement.conditionId, measurement.conditionColor);
    const strokeColor = isSelected ? '#ff0000' : liveColor;
    const strokeWidth = isSelected ? '4' : '2';
    
    switch (measurement.type) {
      case 'linear': {
        // Create polyline for linear measurement
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        const pointString = transformedPoints.map(p => {
          // Points are already in viewport pixels after scaling
          return `${p.x},${p.y}`;
        }).join(' ');
        
        polyline.setAttribute('points', pointString);
        polyline.setAttribute('stroke', strokeColor);
        polyline.setAttribute('stroke-width', strokeWidth);
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('data-measurement-id', measurement.id);
        
        // Set pointer-events and cursor for selection (event delegation handles clicks)
        polyline.style.pointerEvents = selectionMode ? 'auto' : 'none';
        polyline.style.cursor = selectionMode ? 'pointer' : 'default';
        
        // Add invisible hit area for easier selection
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        hitArea.setAttribute('points', pointString);
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('stroke-width', '20'); // Much larger hit area
        hitArea.setAttribute('fill', 'none');
        hitArea.setAttribute('data-measurement-id', measurement.id);
        hitArea.style.pointerEvents = selectionMode ? 'auto' : 'none';
        hitArea.style.cursor = selectionMode ? 'pointer' : 'default';
        svg.appendChild(hitArea);
        
        svg.appendChild(polyline);
        
        // Add measurement text
        const startPoint = { x: transformedPoints[0].x, y: transformedPoints[0].y };
        const endPoint = { x: transformedPoints[transformedPoints.length - 1].x, y: transformedPoints[transformedPoints.length - 1].y };
        const midPoint = {
          x: (startPoint.x + endPoint.x) / 2,
          y: (startPoint.y + endPoint.y) / 2
        };
        
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', midPoint.x.toString());
        text.setAttribute('y', (midPoint.y - 5).toString());
        text.setAttribute('fill', strokeColor);
        text.setAttribute('font-size', '12');
        text.setAttribute('font-family', 'Arial');
        text.setAttribute('text-anchor', 'middle');
        
        const linearValue = (measurement.unit === 'ft' || measurement.unit === 'feet' || measurement.unit === 'LF' || measurement.unit === 'lf') 
          ? formatFeetAndInches(measurement.calculatedValue)
          : `${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`;
        
        // Show both linear and area if areaValue is present
        const displayValue = measurement.areaValue
          ? `${linearValue} LF / ${measurement.areaValue.toFixed(0)} SF`
          : linearValue;
        text.textContent = displayValue;
        svg.appendChild(text);
        break;
      }
        
      case 'area':
        if (transformedPoints.length >= 3) {
          const pointString = transformedPoints.map(p => {
            // Points are already in viewport pixels after scaling
            return `${p.x},${p.y}`;
          }).join(' ');
          
          // If there are cutouts, create a compound path to show holes
          if (measurement.cutouts && Array.isArray(measurement.cutouts) && measurement.cutouts.length > 0) {
            // Create a compound path using a single path element with evenodd fill rule
            const compoundPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            
            // Start with the main area
            let pathData = `M ${pointString.split(' ')[0]} L ${pointString.split(' ').slice(1).join(' L ')} Z`;
            
            // Add each cutout as a hole
            measurement.cutouts.forEach((cutout) => {
              if (cutout && cutout.points && Array.isArray(cutout.points) && cutout.points.length >= 3) {
                const cutoutPointString = cutout.points.map(p => {
                  const canvasX = p.x * currentViewport.width;
                  const canvasY = p.y * currentViewport.height;
                  return `${canvasX},${canvasY}`;
                }).join(' ');
                pathData += ` M ${cutoutPointString.split(' ')[0]} L ${cutoutPointString.split(' ').slice(1).join(' L ')} Z`;
              }
            });
            
            compoundPath.setAttribute('d', pathData);
            compoundPath.setAttribute('fill-rule', 'evenodd');
            compoundPath.setAttribute('fill', liveColor + '40');
            compoundPath.setAttribute('stroke', strokeColor);
            compoundPath.setAttribute('stroke-width', strokeWidth);
            compoundPath.setAttribute('data-measurement-id', measurement.id);
            
            // Set pointer-events and cursor for selection (event delegation handles clicks)
            compoundPath.style.pointerEvents = selectionMode ? 'auto' : 'none';
            compoundPath.style.cursor = selectionMode ? 'pointer' : 'default';
            
            svg.appendChild(compoundPath);
          } else {
            // Create polygon for area measurement without cutouts
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', pointString);
            polygon.setAttribute('fill', liveColor + '40');
            polygon.setAttribute('stroke', strokeColor);
            polygon.setAttribute('stroke-width', strokeWidth);
            polygon.setAttribute('data-measurement-id', measurement.id);
            
            // Set pointer-events and cursor for selection (event delegation handles clicks)
            polygon.style.pointerEvents = selectionMode ? 'auto' : 'none';
            polygon.style.cursor = selectionMode ? 'pointer' : 'default';
            
            // Add invisible hit area for easier selection
            const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            hitArea.setAttribute('points', pointString);
            hitArea.setAttribute('fill', 'transparent');
            hitArea.setAttribute('stroke', 'transparent');
            hitArea.setAttribute('stroke-width', '10');
            hitArea.setAttribute('data-measurement-id', measurement.id);
            hitArea.style.pointerEvents = selectionMode ? 'auto' : 'none';
            hitArea.style.cursor = selectionMode ? 'pointer' : 'default';
            svg.appendChild(hitArea);
            
            svg.appendChild(polygon);
          }
          
          // Add area text
          const centerX = transformedPoints.reduce((sum, p) => sum + p.x, 0) / transformedPoints.length;
          const centerY = transformedPoints.reduce((sum, p) => sum + p.y, 0) / transformedPoints.length;
          
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', centerX.toString());
          text.setAttribute('y', centerY.toString());
          text.setAttribute('fill', strokeColor);
          text.setAttribute('font-size', '12');
          text.setAttribute('font-family', 'Arial');
          text.setAttribute('font-weight', 'bold');
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          
          // Use net value if cutouts exist, otherwise use calculated value
          const displayValue = measurement.netCalculatedValue !== undefined && measurement.netCalculatedValue !== null
            ? measurement.netCalculatedValue 
            : measurement.calculatedValue;
          const areaValue = `${displayValue.toFixed(0)} SF`;
          const finalDisplayValue = measurement.perimeterValue 
            ? `${areaValue} / ${formatFeetAndInches(measurement.perimeterValue)} LF`
            : areaValue;
          text.textContent = finalDisplayValue;
          svg.appendChild(text);
          
          // Cutout outlines are now handled by the clipping path above
        }
        break;
        
      case 'volume':
        if (transformedPoints.length >= 3) {
          const pointString = transformedPoints.map(p => {
            // Points are already in viewport pixels after scaling
            return `${p.x},${p.y}`;
          }).join(' ');
          
          // If there are cutouts, create a compound path to show holes
          if (measurement.cutouts && Array.isArray(measurement.cutouts) && measurement.cutouts.length > 0) {
            // Create a compound path using a single path element with evenodd fill rule
            const compoundPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            
            // Start with the main area
            let pathData = `M ${pointString.split(' ')[0]} L ${pointString.split(' ').slice(1).join(' L ')} Z`;
            
            // Add each cutout as a hole
            measurement.cutouts.forEach((cutout) => {
              if (cutout && cutout.points && Array.isArray(cutout.points) && cutout.points.length >= 3) {
                const cutoutPointString = cutout.points.map(p => {
                  // Convert normalized coordinates to current viewport coordinates
                  const canvasX = p.x * currentViewport.width;
                  const canvasY = p.y * currentViewport.height;
                  return `${canvasX},${canvasY}`;
                }).join(' ');
                pathData += ` M ${cutoutPointString.split(' ')[0]} L ${cutoutPointString.split(' ').slice(1).join(' L ')} Z`;
              }
            });
            
            compoundPath.setAttribute('d', pathData);
            compoundPath.setAttribute('fill-rule', 'evenodd');
            compoundPath.setAttribute('fill', liveColor + '40');
            compoundPath.setAttribute('stroke', strokeColor);
            compoundPath.setAttribute('stroke-width', strokeWidth);
            compoundPath.setAttribute('data-measurement-id', measurement.id);
            
            // Set pointer-events and cursor for selection (event delegation handles clicks)
            compoundPath.style.pointerEvents = selectionMode ? 'auto' : 'none';
            compoundPath.style.cursor = selectionMode ? 'pointer' : 'default';
            
            svg.appendChild(compoundPath);
          } else {
            // Create polygon for volume measurement without cutouts
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', pointString);
            polygon.setAttribute('fill', liveColor + '40');
            polygon.setAttribute('stroke', strokeColor);
            polygon.setAttribute('stroke-width', strokeWidth);
            polygon.setAttribute('data-measurement-id', measurement.id);
            
            // Set pointer-events and cursor for selection (event delegation handles clicks)
            polygon.style.pointerEvents = selectionMode ? 'auto' : 'none';
            polygon.style.cursor = selectionMode ? 'pointer' : 'default';
            
            // Add invisible hit area for easier selection
            const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            hitArea.setAttribute('points', pointString);
            hitArea.setAttribute('fill', 'transparent');
            hitArea.setAttribute('stroke', 'transparent');
            hitArea.setAttribute('stroke-width', '10');
            hitArea.setAttribute('data-measurement-id', measurement.id);
            hitArea.style.pointerEvents = selectionMode ? 'auto' : 'none';
            hitArea.style.cursor = selectionMode ? 'pointer' : 'default';
            svg.appendChild(hitArea);
            
            svg.appendChild(polygon);
          }
          
          // Add volume text
          const centerX = transformedPoints.reduce((sum, p) => sum + p.x, 0) / transformedPoints.length;
          const centerY = transformedPoints.reduce((sum, p) => sum + p.y, 0) / transformedPoints.length;
          
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', centerX.toString());
          text.setAttribute('y', centerY.toString());
          text.setAttribute('fill', strokeColor);
          text.setAttribute('font-size', '12');
          text.setAttribute('font-family', 'Arial');
          text.setAttribute('font-weight', 'bold');
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          
          // Use net value if cutouts exist, otherwise use calculated value
          const displayValue = measurement.netCalculatedValue !== undefined && measurement.netCalculatedValue !== null
            ? measurement.netCalculatedValue 
            : measurement.calculatedValue;
          const volumeValue = `${displayValue.toFixed(0)} CY`;
          const finalDisplayValue = measurement.perimeterValue 
            ? `${volumeValue} / ${formatFeetAndInches(measurement.perimeterValue)} LF`
            : volumeValue;
          text.textContent = finalDisplayValue;
          svg.appendChild(text);
          
          // Cutout outlines are now handled by the clipping path above
        }
        break;
        
      case 'count': {
        const point = { x: transformedPoints[0].x, y: transformedPoints[0].y };
        
        // Create circle for count measurement
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', point.x.toString());
        circle.setAttribute('cy', point.y.toString());
        circle.setAttribute('r', '8');
        circle.setAttribute('fill', liveColor);
        // Only show red stroke when selected, no stroke when not selected
        if (isSelected) {
          circle.setAttribute('stroke', '#ff0000');
          circle.setAttribute('stroke-width', '3');
        } else {
          circle.setAttribute('stroke', 'none');
        }
        circle.setAttribute('data-measurement-id', measurement.id);
        
        // Set pointer-events and cursor for selection (event delegation handles clicks)
        circle.style.pointerEvents = selectionMode ? 'auto' : 'none';
        circle.style.cursor = selectionMode ? 'pointer' : 'default';
        
        // Add invisible hit area for easier selection (larger circle)
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hitArea.setAttribute('cx', point.x.toString());
        hitArea.setAttribute('cy', point.y.toString());
        hitArea.setAttribute('r', '20'); // Much larger hit area
        hitArea.setAttribute('fill', 'transparent');
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('data-measurement-id', measurement.id);
        hitArea.style.pointerEvents = selectionMode ? 'auto' : 'none';
        hitArea.style.cursor = selectionMode ? 'pointer' : 'default';
        svg.appendChild(hitArea);
        
        svg.appendChild(circle);
        break;
      }
    }
  };

  // Render current measurement being drawn as SVG
  const renderSVGCurrentMeasurement = (svg: SVGSVGElement, viewport: PageViewport) => {
    if (!viewport) return;

    const selectedCondition = getSelectedCondition();
    const conditionColor = selectedCondition?.color || '#000000';
    // Use red for cut-out mode, condition color for normal measurements
    const strokeColor = cutoutMode ? '#ff0000' : conditionColor;
    
    // CRITICAL FIX: Remove any existing preview elements before creating new ones
    // This prevents duplicate preview lines and ensures clean state
    const previewId = `linear-preview-${currentPage}`;
    const existingPreview = svg.querySelector(`#${previewId}`);
    if (existingPreview && existingPreview.parentNode === svg) {
      svg.removeChild(existingPreview);
    }
    
    // Also remove any preview polylines without IDs (legacy cleanup)
    const allPolylines = svg.querySelectorAll('polyline');
    allPolylines.forEach((polyline) => {
      const id = polyline.getAttribute('id');
      // Remove preview polylines that match our pattern but might not have been cleaned up
      if (id && id.startsWith('linear-preview-') && id !== previewId) {
        if (polyline.parentNode === svg) {
          svg.removeChild(polyline);
        }
      }
    });
    
    switch (measurementType) {
      case 'linear':
        if (isContinuousDrawing && activePoints.length > 0) {
          // Render committed segments for continuous linear drawing
          if (activePoints.length > 1) {
            // Remove existing committed polyline for this page if it exists
            const existingPolyline = pageCommittedPolylineRefs.current[currentPage];
            if (existingPolyline && existingPolyline.parentNode === svg) {
              svg.removeChild(existingPolyline);
            }
            
            const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            const pointString = activePoints.map(p => {
              // Points are stored in normalized coordinates (0-1), convert to viewport pixels
              return `${p.x * viewport.width},${p.y * viewport.height}`;
            }).join(' ');
            
            polyline.setAttribute('points', pointString);
            polyline.setAttribute('stroke', strokeColor);
            polyline.setAttribute('stroke-width', '2');
            polyline.setAttribute('stroke-linecap', 'round');
            polyline.setAttribute('stroke-linejoin', 'round');
            polyline.setAttribute('fill', 'none');
            polyline.setAttribute('vector-effect', 'non-scaling-stroke');
            polyline.setAttribute('id', `committed-segments-${currentPage}`);
            svg.appendChild(polyline);
            
            // Store in page-scoped refs
            pageCommittedPolylineRefs.current[currentPage] = polyline;
          }
          
          // Always show preview line from first click (similar to area/volume)
          if (activePoints.length > 0) {
            const previewPolyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            let pointString = activePoints.map(p => {
              // Points are stored in normalized coordinates (0-1), convert to viewport pixels
              return `${p.x * viewport.width},${p.y * viewport.height}`;
            }).join(' ');
            
            if (mousePosition) {
              const mousePoint = { x: mousePosition.x * viewport.width, y: mousePosition.y * viewport.height };
              pointString += ` ${mousePoint.x},${mousePoint.y}`;
            }
            
            previewPolyline.setAttribute('points', pointString);
            previewPolyline.setAttribute('stroke', conditionColor);
            previewPolyline.setAttribute('stroke-width', '2');
            previewPolyline.setAttribute('stroke-linecap', 'round');
            previewPolyline.setAttribute('stroke-linejoin', 'round');
            previewPolyline.setAttribute('fill', 'none');
            previewPolyline.setAttribute('stroke-dasharray', '5,5');
            previewPolyline.setAttribute('vector-effect', 'non-scaling-stroke');
            previewPolyline.setAttribute('id', previewId);
            previewPolyline.setAttribute('pointer-events', 'none');
            svg.appendChild(previewPolyline);
          }
        } else if (currentMeasurement.length > 0) {
          // Render traditional linear measurement (non-continuous) with preview line
          // Remove any existing preview for non-continuous linear measurements
          const nonContinuousPreviewId = `linear-noncontinuous-preview-${currentPage}`;
          const existingNonContinuousPreview = svg.querySelector(`#${nonContinuousPreviewId}`);
          if (existingNonContinuousPreview && existingNonContinuousPreview.parentNode === svg) {
            svg.removeChild(existingNonContinuousPreview);
          }
          
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          let pointString = currentMeasurement.map(p => {
            // Points are stored in normalized coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
          }).join(' ');
          
          if (mousePosition) {
            const mousePoint = { x: mousePosition.x * viewport.width, y: mousePosition.y * viewport.height };
            pointString += ` ${mousePoint.x},${mousePoint.y}`;
          }
          
          polyline.setAttribute('points', pointString);
          polyline.setAttribute('stroke', strokeColor);
          polyline.setAttribute('stroke-width', '2');
          polyline.setAttribute('stroke-linecap', 'round');
          polyline.setAttribute('stroke-linejoin', 'round');
          polyline.setAttribute('fill', 'none');
          polyline.setAttribute('stroke-dasharray', '5,5');
          polyline.setAttribute('vector-effect', 'non-scaling-stroke');
          polyline.setAttribute('id', nonContinuousPreviewId);
          polyline.setAttribute('pointer-events', 'none');
          svg.appendChild(polyline);
        }
        break;
        
      case 'area':
        if (currentMeasurement.length > 0) {
          // Remove any existing area preview elements
          const areaPreviewId = `area-preview-${currentPage}`;
          const areaPolygonId = `area-polygon-${currentPage}`;
          const existingAreaPreview = svg.querySelector(`#${areaPreviewId}`);
          const existingAreaPolygon = svg.querySelector(`#${areaPolygonId}`);
          if (existingAreaPreview && existingAreaPreview.parentNode === svg) {
            svg.removeChild(existingAreaPreview);
          }
          if (existingAreaPolygon && existingAreaPolygon.parentNode === svg) {
            svg.removeChild(existingAreaPolygon);
          }
          
          // Create a polyline for the preview (including mouse position)
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          let pointString = currentMeasurement.map(p => {
            // Points are stored in normalized coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
          }).join(' ');
          
          if (mousePosition) {
            const mousePoint = { x: mousePosition.x * viewport.width, y: mousePosition.y * viewport.height };
            pointString += ` ${mousePoint.x},${mousePoint.y}`;
          }
          
          polyline.setAttribute('points', pointString);
          polyline.setAttribute('stroke', strokeColor);
          polyline.setAttribute('stroke-width', '3');
          polyline.setAttribute('fill', 'none');
          polyline.setAttribute('stroke-dasharray', '5,5');
          polyline.setAttribute('id', areaPreviewId);
          polyline.setAttribute('pointer-events', 'none');
          polyline.setAttribute('vector-effect', 'non-scaling-stroke');
          svg.appendChild(polyline);
          
          // If we have 3+ points, also show the filled polygon preview
          if (currentMeasurement.length >= 3) {
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            const polygonPointString = currentMeasurement.map(p => {
              return `${p.x * viewport.width},${p.y * viewport.height}`;
            }).join(' ');
            
            polygon.setAttribute('points', polygonPointString);
            polygon.setAttribute('fill', cutoutMode ? 'none' : (conditionColor + '40'));
            polygon.setAttribute('stroke', 'none');
            polygon.setAttribute('id', areaPolygonId);
            polygon.setAttribute('pointer-events', 'none');
            svg.appendChild(polygon);
          }
        }
        break;
        
      case 'volume':
        if (currentMeasurement.length > 0) {
          // Remove any existing volume preview elements
          const volumePreviewId = `volume-preview-${currentPage}`;
          const volumePolygonId = `volume-polygon-${currentPage}`;
          const existingVolumePreview = svg.querySelector(`#${volumePreviewId}`);
          const existingVolumePolygon = svg.querySelector(`#${volumePolygonId}`);
          if (existingVolumePreview && existingVolumePreview.parentNode === svg) {
            svg.removeChild(existingVolumePreview);
          }
          if (existingVolumePolygon && existingVolumePolygon.parentNode === svg) {
            svg.removeChild(existingVolumePolygon);
          }
          
          // Create a polyline for the preview (including mouse position)
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          let pointString = currentMeasurement.map(p => {
            // Points are stored in normalized coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
          }).join(' ');
          
          if (mousePosition) {
            const mousePoint = { x: mousePosition.x * viewport.width, y: mousePosition.y * viewport.height };
            pointString += ` ${mousePoint.x},${mousePoint.y}`;
          }
          
          polyline.setAttribute('points', pointString);
          polyline.setAttribute('stroke', strokeColor);
          polyline.setAttribute('stroke-width', '3');
          polyline.setAttribute('fill', 'none');
          polyline.setAttribute('stroke-dasharray', '5,5');
          polyline.setAttribute('id', volumePreviewId);
          polyline.setAttribute('pointer-events', 'none');
          polyline.setAttribute('vector-effect', 'non-scaling-stroke');
          svg.appendChild(polyline);
          
          // If we have 3+ points, also show the filled polygon preview
          if (currentMeasurement.length >= 3) {
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            const polygonPointString = currentMeasurement.map(p => {
              return `${p.x * viewport.width},${p.y * viewport.height}`;
            }).join(' ');
            
            polygon.setAttribute('points', polygonPointString);
            polygon.setAttribute('fill', cutoutMode ? 'none' : (conditionColor + '40'));
            polygon.setAttribute('stroke', 'none');
            polygon.setAttribute('id', volumePolygonId);
            polygon.setAttribute('pointer-events', 'none');
            svg.appendChild(polygon);
          }
        }
        break;
        
      case 'count':
        if (currentMeasurement.length >= 1) {
          const point = { x: currentMeasurement[0].x * viewport.width, y: currentMeasurement[0].y * viewport.height };
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', point.x.toString());
          circle.setAttribute('cy', point.y.toString());
          circle.setAttribute('r', '12'); // Match the final size
          circle.setAttribute('fill', conditionColor + '80'); // More opaque
          circle.setAttribute('stroke', 'white');
          circle.setAttribute('stroke-width', '3'); // Thicker stroke for preview
          circle.setAttribute('stroke-dasharray', '5,5'); // More visible dash pattern
          svg.appendChild(circle);
          
          // Add preview text
          const previewText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          previewText.setAttribute('x', point.x.toString());
          previewText.setAttribute('y', (point.y + 4).toString());
          previewText.setAttribute('fill', 'white');
          previewText.setAttribute('font-size', '14');
          previewText.setAttribute('font-family', 'Arial');
          previewText.setAttribute('font-weight', 'bold');
          previewText.setAttribute('text-anchor', 'middle');
          previewText.setAttribute('dominant-baseline', 'middle');
          previewText.setAttribute('stroke', 'black');
          previewText.setAttribute('stroke-width', '0.5');
          previewText.textContent = '1';
          svg.appendChild(previewText);
        }
        break;
    }
  };

  // Render completed annotation
  const renderSVGAnnotation = (svg: SVGSVGElement, annotation: Annotation, viewport: PageViewport) => {
    if (!viewport || annotation.points.length === 0) return;
    
    // Use the passed viewport directly - caller already calculated the correct one
    const currentViewport = viewport;
    
    // Get base viewport (rotation 0) to transform coordinates correctly
    const pdfPage = pdfPageRef.current;
    if (!pdfPage) return;
    const baseViewport = pdfPage.getViewport({ scale: 1, rotation: 0 });
    const rotation = viewState.rotation || 0;
    
    // Transform coordinates from base viewport to rotated viewport (same as measurements)
    const points = annotation.points.map((p, idx) => {
      // Coordinates are normalized to base viewport (rotation 0)
      const normalizedX = p.x;
      const normalizedY = p.y;
      
      // Transform from base coordinates to rotated viewport coordinates
      let canvasX: number, canvasY: number;
      
      if (rotation === 0) {
        canvasX = normalizedX * currentViewport.width;
        canvasY = normalizedY * currentViewport.height;
      } else if (rotation === 90) {
        canvasX = currentViewport.width * (1 - normalizedY);
        canvasY = currentViewport.height * normalizedX;
      } else if (rotation === 180) {
        canvasX = currentViewport.width * (1 - normalizedX);
        canvasY = currentViewport.height * (1 - normalizedY);
      } else if (rotation === 270) {
        canvasX = currentViewport.width * normalizedY;
        canvasY = currentViewport.height * (1 - normalizedX);
      } else {
        canvasX = normalizedX * currentViewport.width;
        canvasY = normalizedY * currentViewport.height;
      }
      
      return { x: canvasX, y: canvasY };
    });
    
    const isSelected = selectedMarkupId === annotation.id;
    const strokeWidth = isSelected ? '5' : '3';
    const strokeColor = isSelected ? '#00ff00' : annotation.color; // Green when selected
    
    if (annotation.type === 'text' && annotation.text) {
      const point = points[0];
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', point.x.toString());
      text.setAttribute('y', point.y.toString());
      text.setAttribute('fill', strokeColor);
      text.setAttribute('font-size', '14');
      text.setAttribute('font-weight', 'bold');
      text.textContent = annotation.text;
      text.setAttribute('data-annotation-id', annotation.id);
      
      // Set pointer-events and cursor for selection (event delegation handles clicks)
      text.style.pointerEvents = isSelectionMode ? 'auto' : 'none';
      text.style.cursor = isSelectionMode ? 'pointer' : 'default';
      
      svg.appendChild(text);
      
      // Add invisible hit area for text annotations (rectangle around text)
      // Estimate text bounds (approximate)
      const textWidth = annotation.text ? annotation.text.length * 8 : 50;
      const textHeight = 16;
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hitArea.setAttribute('x', (point.x - 5).toString());
      hitArea.setAttribute('y', (point.y - textHeight - 5).toString());
      hitArea.setAttribute('width', (textWidth + 10).toString());
      hitArea.setAttribute('height', (textHeight + 10).toString());
      hitArea.setAttribute('fill', 'transparent');
      hitArea.setAttribute('stroke', 'transparent');
      hitArea.setAttribute('data-annotation-id', annotation.id);
      hitArea.style.pointerEvents = isSelectionMode ? 'auto' : 'none';
      hitArea.style.cursor = isSelectionMode ? 'pointer' : 'default';
      svg.appendChild(hitArea);
    } else if (annotation.type === 'arrow' && points.length === 2) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', points[0].x.toString());
      line.setAttribute('y1', points[0].y.toString());
      line.setAttribute('x2', points[1].x.toString());
      line.setAttribute('y2', points[1].y.toString());
      line.setAttribute('stroke', strokeColor);
      line.setAttribute('stroke-width', strokeWidth);
      line.setAttribute('marker-end', 'url(#arrowhead)');
      line.setAttribute('data-annotation-id', annotation.id);
      
      // Set pointer-events and cursor for selection (event delegation handles clicks)
      line.style.pointerEvents = isSelectionMode ? 'auto' : 'none';
      line.style.cursor = isSelectionMode ? 'pointer' : 'default';
      
      svg.appendChild(line);
      
      // Add invisible hit area for easier selection (like measurements have)
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hitArea.setAttribute('x1', points[0].x.toString());
      hitArea.setAttribute('y1', points[0].y.toString());
      hitArea.setAttribute('x2', points[1].x.toString());
      hitArea.setAttribute('y2', points[1].y.toString());
      hitArea.setAttribute('stroke', 'transparent');
      hitArea.setAttribute('stroke-width', '20'); // Much larger hit area
      hitArea.setAttribute('fill', 'none');
      hitArea.setAttribute('data-annotation-id', annotation.id);
      hitArea.style.pointerEvents = isSelectionMode ? 'auto' : 'none';
      hitArea.style.cursor = isSelectionMode ? 'pointer' : 'default';
      svg.appendChild(hitArea);
      
      // Create arrowhead marker if it doesn't exist
      if (!svg.querySelector('#arrowhead')) {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'arrowhead');
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '10');
        marker.setAttribute('refX', '9');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', '0 0, 10 3, 0 6');
        polygon.setAttribute('fill', strokeColor);
        marker.appendChild(polygon);
        defs.appendChild(marker);
        svg.appendChild(defs);
      }
    } else if (annotation.type === 'rectangle' && points.length === 2) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const x = Math.min(points[0].x, points[1].x);
      const y = Math.min(points[0].y, points[1].y);
      const width = Math.abs(points[1].x - points[0].x);
      const height = Math.abs(points[1].y - points[0].y);
      rect.setAttribute('x', x.toString());
      rect.setAttribute('y', y.toString());
      rect.setAttribute('width', width.toString());
      rect.setAttribute('height', height.toString());
      rect.setAttribute('stroke', strokeColor);
      rect.setAttribute('stroke-width', strokeWidth);
      rect.setAttribute('fill', 'none');
      rect.setAttribute('data-annotation-id', annotation.id);
      
      // Set pointer-events and cursor for selection (event delegation handles clicks)
      rect.style.pointerEvents = isSelectionMode ? 'auto' : 'none';
      rect.style.cursor = isSelectionMode ? 'pointer' : 'default';
      
      svg.appendChild(rect);
      
      // Add invisible hit area for easier selection (extends beyond stroke)
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hitArea.setAttribute('x', (x - 5).toString()); // Extend hit area
      hitArea.setAttribute('y', (y - 5).toString());
      hitArea.setAttribute('width', (width + 10).toString());
      hitArea.setAttribute('height', (height + 10).toString());
      hitArea.setAttribute('fill', 'transparent');
      hitArea.setAttribute('stroke', 'transparent');
      hitArea.setAttribute('data-annotation-id', annotation.id);
      hitArea.style.pointerEvents = isSelectionMode ? 'auto' : 'none';
      hitArea.style.cursor = isSelectionMode ? 'pointer' : 'default';
      svg.appendChild(hitArea);
    } else if (annotation.type === 'circle' && points.length === 2) {
      const cx = (points[0].x + points[1].x) / 2;
      const cy = (points[0].y + points[1].y) / 2;
      const rx = Math.abs(points[1].x - points[0].x) / 2;
      const ry = Math.abs(points[1].y - points[0].y) / 2;
      const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      ellipse.setAttribute('cx', cx.toString());
      ellipse.setAttribute('cy', cy.toString());
      ellipse.setAttribute('rx', rx.toString());
      ellipse.setAttribute('ry', ry.toString());
      ellipse.setAttribute('stroke', strokeColor);
      ellipse.setAttribute('stroke-width', strokeWidth);
      ellipse.setAttribute('fill', 'none');
      ellipse.setAttribute('data-annotation-id', annotation.id);
      
      // Set pointer-events and cursor for selection (event delegation handles clicks)
      ellipse.style.pointerEvents = isSelectionMode ? 'auto' : 'none';
      ellipse.style.cursor = isSelectionMode ? 'pointer' : 'default';
      
      svg.appendChild(ellipse);
      
      // Add invisible hit area for easier selection
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      hitArea.setAttribute('cx', cx.toString());
      hitArea.setAttribute('cy', cy.toString());
      hitArea.setAttribute('rx', (rx + 10).toString()); // Extend hit area
      hitArea.setAttribute('ry', (ry + 10).toString());
      hitArea.setAttribute('fill', 'transparent');
      hitArea.setAttribute('stroke', 'transparent');
      hitArea.setAttribute('data-annotation-id', annotation.id);
      hitArea.style.pointerEvents = isSelectionMode ? 'auto' : 'none';
      hitArea.style.cursor = isSelectionMode ? 'pointer' : 'default';
      svg.appendChild(hitArea);
    } else if (annotation.type === 'highlight' && points.length >= 2) {
      // For highlight, we'll create a rectangle with semi-transparent fill
      const x = Math.min(...points.map(p => p.x));
      const y = Math.min(...points.map(p => p.y));
      const width = Math.max(...points.map(p => p.x)) - x;
      const height = Math.max(...points.map(p => p.y)) - y;
      
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x.toString());
      rect.setAttribute('y', y.toString());
      rect.setAttribute('width', width.toString());
      rect.setAttribute('height', height.toString());
      rect.setAttribute('fill', annotation.color);
      rect.setAttribute('fill-opacity', '0.3');
      rect.setAttribute('stroke', annotation.color);
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('data-annotation-id', annotation.id);
      
      // Set pointer-events and cursor for selection (event delegation handles clicks)
      rect.style.pointerEvents = isSelectionMode ? 'auto' : 'none';
      rect.style.cursor = isSelectionMode ? 'pointer' : 'default';
      
      svg.appendChild(rect);
    }
  };

  // Render current annotation being created with rubber banding preview
  const renderSVGCurrentAnnotation = (svg: SVGSVGElement, viewport: PageViewport) => {
    if (!viewport || !annotationTool) return;
    
    const points = currentAnnotation.map(p => ({
      x: p.x * viewport.width,
      y: p.y * viewport.height
    }));
    
    if (['arrow', 'rectangle', 'circle'].includes(annotationTool)) {
      if (points.length === 0 && mousePosition) {
        // Show a small dot at mouse position to indicate where first point will be
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', (mousePosition.x * viewport.width).toString());
        dot.setAttribute('cy', (mousePosition.y * viewport.height).toString());
        dot.setAttribute('r', '4');
        dot.setAttribute('fill', annotationColor);
        dot.setAttribute('opacity', '0.7');
        svg.appendChild(dot);
      } else if (points.length === 1 && mousePosition) {
        const endPoint = {
          x: mousePosition.x * viewport.width,
          y: mousePosition.y * viewport.height
        };
        
        // Draw first point
        const startDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        startDot.setAttribute('cx', points[0].x.toString());
        startDot.setAttribute('cy', points[0].y.toString());
        startDot.setAttribute('r', '4');
        startDot.setAttribute('fill', annotationColor);
        svg.appendChild(startDot);
        
        if (annotationTool === 'arrow') {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', points[0].x.toString());
          line.setAttribute('y1', points[0].y.toString());
          line.setAttribute('x2', endPoint.x.toString());
          line.setAttribute('y2', endPoint.y.toString());
          line.setAttribute('stroke', annotationColor);
          line.setAttribute('stroke-width', '3');
          line.setAttribute('stroke-dasharray', '5,5');
          line.setAttribute('opacity', '0.7');
          svg.appendChild(line);
        } else if (annotationTool === 'rectangle') {
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          const x = Math.min(points[0].x, endPoint.x);
          const y = Math.min(points[0].y, endPoint.y);
          const width = Math.abs(endPoint.x - points[0].x);
          const height = Math.abs(endPoint.y - points[0].y);
          rect.setAttribute('x', x.toString());
          rect.setAttribute('y', y.toString());
          rect.setAttribute('width', width.toString());
          rect.setAttribute('height', height.toString());
          rect.setAttribute('stroke', annotationColor);
          rect.setAttribute('stroke-width', '3');
          rect.setAttribute('fill', 'none');
          rect.setAttribute('stroke-dasharray', '5,5');
          rect.setAttribute('opacity', '0.7');
          svg.appendChild(rect);
        } else if (annotationTool === 'circle') {
          const cx = (points[0].x + endPoint.x) / 2;
          const cy = (points[0].y + endPoint.y) / 2;
          const rx = Math.abs(endPoint.x - points[0].x) / 2;
          const ry = Math.abs(endPoint.y - points[0].y) / 2;
          const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
          ellipse.setAttribute('cx', cx.toString());
          ellipse.setAttribute('cy', cy.toString());
          ellipse.setAttribute('rx', rx.toString());
          ellipse.setAttribute('ry', ry.toString());
          ellipse.setAttribute('stroke', annotationColor);
          ellipse.setAttribute('stroke-width', '3');
          ellipse.setAttribute('fill', 'none');
          ellipse.setAttribute('stroke-dasharray', '5,5');
          ellipse.setAttribute('opacity', '0.7');
          svg.appendChild(ellipse);
        }
      }
    }
  };

  // Render calibration points as SVG (uses currentViewport, calibrationPoints, etc. from closure)
  const renderSVGCalibrationPoints = (svg: SVGSVGElement) => {
    if (!currentViewport) return;
    
    calibrationPoints.forEach((point, index) => {
      // Convert PDF coordinates (0-1) to viewport pixels for rendering
      const viewportPoint = {
        x: point.x * currentViewport.width,
        y: point.y * currentViewport.height
      };
      
      // Create calibration point circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', viewportPoint.x.toString());
      circle.setAttribute('cy', viewportPoint.y.toString());
      circle.setAttribute('r', '8');
      circle.setAttribute('fill', '#ff0000');
      circle.setAttribute('stroke', '#ffffff');
      circle.setAttribute('stroke-width', '2');
      svg.appendChild(circle);
      
      // Add point number
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', viewportPoint.x.toString());
      text.setAttribute('y', (viewportPoint.y + 4).toString());
      text.setAttribute('fill', 'white');
      text.setAttribute('font-size', '12');
      text.setAttribute('font-family', 'Arial');
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.textContent = (index + 1).toString();
      svg.appendChild(text);
    });
    
    // Draw preview line from first point to mouse position (if only one point)
    if (calibrationPoints.length === 1 && mousePosition) {
      const firstPoint = {
        x: calibrationPoints[0].x * currentViewport.width,
        y: calibrationPoints[0].y * currentViewport.height
      };
      const mousePoint = {
        x: mousePosition.x * currentViewport.width,
        y: mousePosition.y * currentViewport.height
      };
      
      // Apply ortho snapping to the preview line only if enabled
      const snappedMousePoint = isOrthoSnapping ? applyOrthoSnapping(mousePosition, calibrationPoints) : mousePosition;
      const snappedViewportPoint = {
        x: snappedMousePoint.x * currentViewport.width,
        y: snappedMousePoint.y * currentViewport.height
      };
      
      const previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      previewLine.setAttribute('x1', firstPoint.x.toString());
      previewLine.setAttribute('y1', firstPoint.y.toString());
      previewLine.setAttribute('x2', snappedViewportPoint.x.toString());
      previewLine.setAttribute('y2', snappedViewportPoint.y.toString());
      previewLine.setAttribute('stroke', '#ff0000');
      previewLine.setAttribute('stroke-width', '2');
      previewLine.setAttribute('stroke-dasharray', '5,5');
      previewLine.setAttribute('opacity', '0.7');
      svg.appendChild(previewLine);
      
      // Add distance preview text
      const midX = (firstPoint.x + snappedViewportPoint.x) / 2;
      const midY = (firstPoint.y + snappedViewportPoint.y) / 2;
      const distance = calculateDistance(
        { x: firstPoint.x, y: firstPoint.y },
        { x: snappedViewportPoint.x, y: snappedViewportPoint.y }
      );
      
      const distanceText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      distanceText.setAttribute('x', midX.toString());
      distanceText.setAttribute('y', (midY - 10).toString());
      distanceText.setAttribute('fill', '#ff0000');
      distanceText.setAttribute('font-size', '12');
      distanceText.setAttribute('font-family', 'Arial');
      distanceText.setAttribute('font-weight', 'bold');
      distanceText.setAttribute('text-anchor', 'middle');
      distanceText.textContent = `${distance.toFixed(1)} px`;
      svg.appendChild(distanceText);
    }
    
    // Draw final line between calibration points (if two points)
    if (calibrationPoints.length === 2) {
      const firstPoint = {
        x: calibrationPoints[0].x * currentViewport.width,
        y: calibrationPoints[0].y * currentViewport.height
      };
      const secondPoint = {
        x: calibrationPoints[1].x * currentViewport.width,
        y: calibrationPoints[1].y * currentViewport.height
      };
      
      // Draw line between calibration points
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', firstPoint.x.toString());
      line.setAttribute('y1', firstPoint.y.toString());
      line.setAttribute('x2', secondPoint.x.toString());
      line.setAttribute('y2', secondPoint.y.toString());
      line.setAttribute('stroke', '#ff0000');
      line.setAttribute('stroke-width', '3');
      svg.appendChild(line);
      
      // Add distance text
      const midX = (firstPoint.x + secondPoint.x) / 2;
      const midY = (firstPoint.y + secondPoint.y) / 2;
      const distance = calculateDistance(firstPoint, secondPoint);
      
      const distanceText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      distanceText.setAttribute('x', midX.toString());
      distanceText.setAttribute('y', (midY - 10).toString());
      distanceText.setAttribute('fill', '#ff0000');
      distanceText.setAttribute('font-size', '14');
      distanceText.setAttribute('font-family', 'Arial');
      distanceText.setAttribute('font-weight', 'bold');
      distanceText.setAttribute('text-anchor', 'middle');
      distanceText.textContent = `${distance.toFixed(1)} px`;
      svg.appendChild(distanceText);
    }
  };

  // Render running length display for continuous linear drawing
  const renderRunningLengthDisplay = (svg: SVGSVGElement, viewport: PageViewport) => {
    if (!viewport || !isContinuousDrawing || activePoints.length === 0) return;
    
    const selectedCondition = getSelectedCondition();
    const conditionColor = selectedCondition?.color || '#000000';
    const unit = selectedCondition?.unit || 'ft';
    
    // Position the text near the last point
    const lastPoint = activePoints[activePoints.length - 1];
    const textX = lastPoint.x * viewport.width + 10;
    const textY = lastPoint.y * viewport.height - 10;
    
    // Create background rectangle for better visibility
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', (textX - 5).toString());
    rect.setAttribute('y', (textY - 20).toString());
    rect.setAttribute('width', '120');
    rect.setAttribute('height', '20');
    rect.setAttribute('fill', 'rgba(255, 255, 255, 0.9)');
    rect.setAttribute('stroke', conditionColor);
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('rx', '3');
    svg.appendChild(rect);
    
    // Create text element
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', textX.toString());
    text.setAttribute('y', (textY - 5).toString());
    text.setAttribute('fill', conditionColor);
    text.setAttribute('font-size', '12');
    text.setAttribute('font-family', 'Arial');
    text.setAttribute('font-weight', 'bold');
    
    const displayValue = (unit === 'ft' || unit === 'feet' || unit === 'LF' || unit === 'lf') 
      ? formatFeetAndInches(runningLength)
      : `${runningLength.toFixed(2)} ${unit}`;
    text.textContent = `Length: ${displayValue}`;
    svg.appendChild(text);
  };

  // Handle mouse move - direct coordinate conversion
  // Handle mouse down for titleblock/visual search selection (start selection)
  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    if (!pdfCanvasRef.current) return;
    
    // Only handle mousedown for titleblock/visual search selection
    if (!(visualSearchMode || !!titleblockSelectionMode) || !isSelectingSymbol) {
      return;
    }
    
    // Get CSS pixel coordinates
    const rect = pdfCanvasRef.current.getBoundingClientRect();
    let cssX = event.clientX - rect.left;
    let cssY = event.clientY - rect.top;
    const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
    if (Math.abs(interactiveScale - 1) > 0.0001) {
      cssX = cssX / interactiveScale;
      cssY = cssY / interactiveScale;
    }
    
    // Start selection
    setSelectionStart({ x: cssX, y: cssY });
    setSelectionBox(null);
    event.preventDefault();
    event.stopPropagation();
  }, [visualSearchMode, titleblockSelectionMode, isSelectingSymbol, viewState.scale]);

  // Handle mouse up for titleblock/visual search selection (complete selection)
  const handleMouseUp = useCallback(async (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    if (!pdfCanvasRef.current) return;
    
    // Only handle mouseup for titleblock/visual search selection
    if (!(visualSearchMode || !!titleblockSelectionMode) || !isSelectingSymbol || !selectionStart) {
      return;
    }
    
    // Get viewport
    let viewport = currentViewport;
    if (!viewport && pdfPageRef.current) {
      viewport = pdfPageRef.current.getViewport({ 
        scale: viewState.scale, 
        rotation: viewState.rotation 
      });
    }
    
    if (!viewport) {
      console.warn('[PDFViewer] No viewport available for selection completion');
      setSelectionStart(null);
      setSelectionBox(null);
      return;
    }
    
    // Get CSS pixel coordinates
    const rect = pdfCanvasRef.current.getBoundingClientRect();
    let cssX = event.clientX - rect.left;
    let cssY = event.clientY - rect.top;
    const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
    if (Math.abs(interactiveScale - 1) > 0.0001) {
      cssX = cssX / interactiveScale;
      cssY = cssY / interactiveScale;
    }
    
    // Complete selection
    const width = Math.abs(cssX - selectionStart.x);
    const height = Math.abs(cssY - selectionStart.y);
    const x = Math.min(cssX, selectionStart.x);
    const y = Math.min(cssY, selectionStart.y);
    
    // Only complete if the box has minimum size (to avoid accidental clicks)
    if (width < 5 && height < 5) {
      // Too small, treat as click - reset
      setSelectionStart(null);
      setSelectionBox(null);
      return;
    }
    
    const finalSelectionBox = { x, y, width, height };
    setSelectionBox(finalSelectionBox);
    
    // Convert to PDF coordinates (0-1 scale)
    const pdfSelectionBox = {
      x: x / viewport.width,
      y: y / viewport.height,
      width: width / viewport.width,
      height: height / viewport.height
    };
    
    // Reset selection state
    setSelectionStart(null);
    setIsSelectingSymbol(false);
    
    // Call the appropriate completion handler
    if (titleblockSelectionMode && onTitleblockSelectionComplete) {
      onTitleblockSelectionComplete(titleblockSelectionMode, pdfSelectionBox);
    } else if (visualSearchMode && onVisualSearchComplete) {
      onVisualSearchComplete(pdfSelectionBox);
    }
    
    event.preventDefault();
    event.stopPropagation();
  }, [visualSearchMode, titleblockSelectionMode, isSelectingSymbol, selectionStart, currentViewport, viewState.scale, viewState.rotation, onTitleblockSelectionComplete, onVisualSearchComplete]);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    // Basic checks - allow interactions even during loading
    if (!pdfCanvasRef.current) {
      return;
    }
    
    // CRITICAL FIX: Compute viewport on-the-fly if not cached (for newly uploaded PDFs)
    // This allows interactions to work even before the page has fully rendered and cached the viewport
    let viewport = currentViewport;
    if (!viewport && pdfPageRef.current) {
      // Compute viewport on-the-fly using current scale and rotation
      viewport = pdfPageRef.current.getViewport({ 
        scale: viewState.scale, 
        rotation: viewState.rotation 
      });
      // Cache it for future use
      setPageViewports(prev => ({
        ...prev,
        [currentPage]: viewport
      }));
    }
    
    if (!viewport) {
      // Still no viewport - PDF page not ready yet
      return;
    }
    
    // ANTI-FLICKER: Clear deselection state on any user interaction
    if (isDeselecting) {
      setIsDeselecting(false);
    }
    
    // Handle visual search or titleblock selection box drawing
    if ((visualSearchMode || !!titleblockSelectionMode) && isSelectingSymbol && selectionStart) {
      if (!pdfCanvasRef.current) return;
      
      const rect = pdfCanvasRef.current.getBoundingClientRect();
      let cssX = event.clientX - rect.left;
      let cssY = event.clientY - rect.top;
      // If interactive CSS zoom is active, adjust pointer coords back to rendered scale space
      const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
      if (Math.abs(interactiveScale - 1) > 0.0001) {
        cssX = cssX / interactiveScale;
        cssY = cssY / interactiveScale;
      }
      
      const width = Math.abs(cssX - selectionStart.x);
      const height = Math.abs(cssY - selectionStart.y);
      const x = Math.min(cssX, selectionStart.x);
      const y = Math.min(cssY, selectionStart.y);
      
      setSelectionBox({ x, y, width, height });
      return;
    }
    
    // Handle mouse move for calibration mode
    if (isCalibrating) {
      if (!pdfCanvasRef.current || !currentViewport) {
        return;
      }
      
      // Get CSS pixel coordinates relative to the canvas/SVG
      const rect = pdfCanvasRef.current.getBoundingClientRect();
      let cssX = event.clientX - rect.left;
      let cssY = event.clientY - rect.top;
      const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
      if (Math.abs(interactiveScale - 1) > 0.0001) {
        cssX = cssX / interactiveScale;
        cssY = cssY / interactiveScale;
      }
      
      // Convert CSS coordinates to normalized PDF coordinates (0-1)
      // Normalized coordinates represent PDF-relative position, independent of zoom level
      let pdfCoords = {
        x: cssX / viewport.width,
        y: cssY / viewport.height
      };
      
      // Apply ortho snapping for calibration only if explicitly enabled
      if (calibrationPoints.length > 0 && isOrthoSnapping) {
        pdfCoords = applyOrthoSnapping(pdfCoords, calibrationPoints);
      }
      
      // For calibration, always update mouse position to follow cursor exactly
      // No threshold check to prevent lagging/snapping to grid
      setMousePosition(pdfCoords);
      return;
    }
    
    // Handle mouse move for annotation mode
    if (annotationTool) {
      if (!pdfCanvasRef.current) {
        return;
      }
      
      // Get CSS pixel coordinates relative to the canvas/SVG
      const rect = pdfCanvasRef.current.getBoundingClientRect();
      const cssX = event.clientX - rect.left;
      const cssY = event.clientY - rect.top;
      
      // Convert CSS coordinates to PDF coordinates (0-1)
      const pdfCoords = {
        x: cssX / viewport.width,
        y: cssY / viewport.height
      };
      
      // Always update mouse position for annotation preview
      setMousePosition(pdfCoords);
      return;
    }
    
    // Handle mouse move for measurement mode
    if (!isMeasuring || !selectedConditionId) {
      if (mousePosition) {
        setMousePosition(null);
      }
      return;
    }
    
    if (!pdfCanvasRef.current) {
      return;
    }
    
    // Get CSS pixel coordinates relative to the canvas/SVG
    const rect = pdfCanvasRef.current.getBoundingClientRect();
    let cssX = event.clientX - rect.left;
    let cssY = event.clientY - rect.top;
    const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
    if (Math.abs(interactiveScale - 1) > 0.0001) {
      cssX = cssX / interactiveScale;
      cssY = cssY / interactiveScale;
    }
    
    // Convert CSS coordinates to PDF coordinates (0-1) for storage using current page viewport
    let pdfCoords = {
      x: cssX / viewport.width,
      y: cssY / viewport.height
    };
    
    // Apply ortho snapping if enabled and we have reference points
    if (isOrthoSnapping) {
      const referencePoints = isContinuousDrawing ? activePoints : currentMeasurement;
      pdfCoords = applyOrthoSnapping(pdfCoords, referencePoints);
    }
    
    // For measurements, always update mouse position to follow cursor exactly
    // No threshold check to prevent lagging/snapping to grid
    setMousePosition(pdfCoords);
    
    // Hover detection removed - using manual cut-out toggle instead
    
    // Update rubber band preview for continuous linear drawing
    if (isContinuousDrawing && activePoints.length > 0) {
      // Always compute running length from active points to current cursor
      const newLength = calculateRunningLength(activePoints, pdfCoords);
      setRunningLength(newLength);
      
      // Update on-screen rubber band line when present
      if (svgOverlayRef.current) {
        const currentRubberBand = pageRubberBandRefs.current[currentPage];
        if (currentRubberBand && currentRubberBand.parentNode === svgOverlayRef.current) {
          const lastPoint = activePoints[activePoints.length - 1];
          const lastPointPixels = {
            x: lastPoint.x * currentViewport.width,
            y: lastPoint.y * currentViewport.height
          };
          const currentPointPixels = {
            x: pdfCoords.x * currentViewport.width,
            y: pdfCoords.y * currentViewport.height
          };
          currentRubberBand.setAttribute('x1', lastPointPixels.x.toString());
          currentRubberBand.setAttribute('y1', lastPointPixels.y.toString());
          currentRubberBand.setAttribute('x2', currentPointPixels.x.toString());
          currentRubberBand.setAttribute('y2', currentPointPixels.y.toString());
        }
      }
    }
  }, [annotationTool, isCalibrating, calibrationPoints, isMeasuring, selectedConditionId, mousePosition, isContinuousDrawing, activePoints, rubberBandElement, currentViewport, calculateRunningLength, isDeselecting, visualSearchMode, titleblockSelectionMode, isSelectingSymbol, selectionStart, viewState, setPageViewports, currentPage, pdfPageRef]);

  // Handle click - direct coordinate conversion
  const handleClick = useCallback(async (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    // Basic checks - allow interactions even during loading
    if (!pdfCanvasRef.current) {
      return;
    }
    
    // CRITICAL FIX: Compute viewport on-the-fly if not cached (for newly uploaded PDFs)
    // This allows interactions to work even before the page has fully rendered and cached the viewport
    let viewport = currentViewport;
    
    if (!viewport) {
      // Try to get viewport from cached page ref first
      if (pdfPageRef.current) {
        viewport = pdfPageRef.current.getViewport({ 
          scale: viewState.scale, 
          rotation: viewState.rotation 
        });
        // Cache it for future use
        setPageViewports(prev => ({
          ...prev,
          [currentPage]: viewport
        }));
      } else if (pdfDocument) {
        // For new documents, page might not be loaded yet - load it on-demand
        try {
          const page = await pdfDocument.getPage(currentPage);
          pdfPageRef.current = page; // Cache the page for future use
          viewport = page.getViewport({ 
            scale: viewState.scale, 
            rotation: viewState.rotation 
          });
          // Cache viewport for future use
          setPageViewports(prev => ({
            ...prev,
            [currentPage]: viewport
          }));
        } catch (error) {
          console.error('Failed to load PDF page for click handler:', error);
          return;
        }
      }
    }
    
    if (!viewport) {
      // Still no viewport - PDF page not ready yet
      return;
    }
    
    // ANTI-FLICKER: Clear deselection state on any user interaction
    if (isDeselecting) {
      setIsDeselecting(false);
    }
    
    const currentSelectedConditionId = useConditionStore.getState().selectedConditionId;
    
    // Get CSS pixel coordinates relative to the canvas/SVG
    const rect = pdfCanvasRef.current.getBoundingClientRect();
    let cssX = event.clientX - rect.left;
    let cssY = event.clientY - rect.top;
    const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
    if (Math.abs(interactiveScale - 1) > 0.0001) {
      cssX = cssX / interactiveScale;
      cssY = cssY / interactiveScale;
    }

    // Note: Auto-count and titleblock selection now use mousedown/mouseup instead of click
    // Skip click handling for these modes to avoid conflicts
    // IMPORTANT: Also prevent measurement clicks when auto-count mode is active (even if not currently selecting)
    // This prevents manual count measurements from being created while waiting for auto-count to complete
    if (visualSearchMode || !!titleblockSelectionMode) {
      if (isSelectingSymbol) {
        return; // Currently drawing selection box - let mousedown/mouseup handle it
      }
      // Auto-count mode active but not selecting - prevent measurement clicks
      // User should wait for auto-count to complete or exit auto-count mode
      if (visualSearchMode) {
        return; // Don't allow manual measurements during auto-count mode
      }
    }
    
    // Handle deselection in selection mode when clicking on blank space
    // NOTE: This only applies to blank space clicks, not markup clicks
    // Markup clicks are handled by their own click handlers and won't reach here
    if (isSelectionMode && selectedMarkupId && !isMeasuring && !isCalibrating && !annotationTool) {
      // If we're in selection mode and have a selected markup, deselect it when clicking blank space
      setSelectedMarkupId(null);
      return;
    }
    
    // Handle calibration clicks
    if (isCalibrating) {
      setCalibrationPoints(prev => {
        // CRITICAL FIX: Normalize using base viewport (rotation 0, scale 1) to get PDF-relative coordinates (0-1)
        // Normalized coordinates represent position in PDF space, independent of zoom level and rotation
        // The calibration calculation will use these normalized coords with baseViewport dimensions
        const baseViewport = pdfPageRef.current?.getViewport({ scale: 1, rotation: 0 }) || viewport;
        const rotation = viewState.rotation || 0;
        
        let baseX: number, baseY: number;
        if (rotation === 0) {
          baseX = (cssX / viewport.width) * baseViewport.width;
          baseY = (cssY / viewport.height) * baseViewport.height;
        } else if (rotation === 90) {
          baseX = (cssY / viewport.height) * baseViewport.width;
          baseY = (1 - cssX / viewport.width) * baseViewport.height;
        } else if (rotation === 180) {
          baseX = (1 - cssX / viewport.width) * baseViewport.width;
          baseY = (1 - cssY / viewport.height) * baseViewport.height;
        } else if (rotation === 270) {
          baseX = (1 - cssY / viewport.height) * baseViewport.width;
          baseY = (cssX / viewport.width) * baseViewport.height;
        } else {
          baseX = (cssX / viewport.width) * baseViewport.width;
          baseY = (cssY / viewport.height) * baseViewport.height;
        }
        
        let pdfCoords = {
          x: baseX / baseViewport.width,
          y: baseY / baseViewport.height
        };
        
        // Apply ortho snapping for calibration only if explicitly enabled
        // IMPORTANT: When ortho snapping is enabled, use mousePosition which already has the snapped coordinates
        // that match the crosshair position. This ensures points are created exactly where the crosshair is.
        if (prev.length > 0 && isOrthoSnapping) {
          if (mousePosition) {
            // Use the snapped position from mousePosition (which matches the crosshair)
            pdfCoords = mousePosition;
          } else {
            // Fallback: recalculate snapping if mousePosition is not available
            pdfCoords = applyOrthoSnapping(pdfCoords, prev);
          }
        }
        
        // Store points in normalized PDF coordinates (0-1) - these represent PDF-relative position
        const newPoints = [...prev, pdfCoords];
        
        if (newPoints.length === 2) {
          completeCalibration(newPoints);
        }
        
        return newPoints;
      });
      return;
    }
    
    // Handle cut-out mode clicks
    if (cutoutMode) {
      // Convert CSS coordinates to PDF coordinates (0-1) for storage
      // CRITICAL: Always normalize based on rotation 0, scale 1 viewport for consistency
      const baseViewport = pdfPageRef.current?.getViewport({ scale: 1, rotation: 0 }) || viewport;
      const rotation = viewState.rotation || 0;
      
      let baseX: number, baseY: number;
      if (rotation === 0) {
        baseX = (cssX / viewport.width) * baseViewport.width;
        baseY = (cssY / viewport.height) * baseViewport.height;
      } else if (rotation === 90) {
        baseX = (cssY / viewport.height) * baseViewport.width;
        baseY = (1 - cssX / viewport.width) * baseViewport.height;
      } else if (rotation === 180) {
        baseX = (1 - cssX / viewport.width) * baseViewport.width;
        baseY = (1 - cssY / viewport.height) * baseViewport.height;
      } else if (rotation === 270) {
        baseX = (1 - cssY / viewport.height) * baseViewport.width;
        baseY = (cssX / viewport.width) * baseViewport.height;
      } else {
        baseX = (cssX / viewport.width) * baseViewport.width;
        baseY = (cssY / viewport.height) * baseViewport.height;
      }
      
      let pdfCoords = {
        x: baseX / baseViewport.width,
        y: baseY / baseViewport.height
      };
      
      // Disable ortho snapping for cut-outs to avoid interference
      // if (isOrthoSnapping) {
      //   pdfCoords = applyOrthoSnapping(pdfCoords, currentCutout);
      // }
      
      setCurrentCutout(prev => {
        const newCutout = [...prev, pdfCoords];
        return newCutout;
      });
      
      return;
    }
    
    // Handle annotation tool clicks
    if (annotationTool) {
      // CRITICAL: Always normalize based on rotation 0, scale 1 viewport for consistency
      const baseViewport = pdfPageRef.current?.getViewport({ scale: 1, rotation: 0 }) || viewport;
      const rotation = viewState.rotation || 0;
      
      let baseX: number, baseY: number;
      if (rotation === 0) {
        baseX = (cssX / viewport.width) * baseViewport.width;
        baseY = (cssY / viewport.height) * baseViewport.height;
      } else if (rotation === 90) {
        baseX = (cssY / viewport.height) * baseViewport.width;
        baseY = (1 - cssX / viewport.width) * baseViewport.height;
      } else if (rotation === 180) {
        baseX = (1 - cssX / viewport.width) * baseViewport.width;
        baseY = (1 - cssY / viewport.height) * baseViewport.height;
      } else if (rotation === 270) {
        baseX = (1 - cssY / viewport.height) * baseViewport.width;
        baseY = (cssX / viewport.width) * baseViewport.height;
      } else {
        baseX = (cssX / viewport.width) * baseViewport.width;
        baseY = (cssY / viewport.height) * baseViewport.height;
      }
      
      const pdfCoords = {
        x: baseX / baseViewport.width,
        y: baseY / baseViewport.height
      };
      
      if (annotationTool === 'text') {
        // Show text input at clicked position
        setTextInputPosition({ x: cssX, y: cssY });
        setShowTextInput(true);
        // Don't set currentAnnotation yet - wait until text is saved
        // Store the position for when we save the annotation
        setCurrentAnnotation([pdfCoords]);
        return;
      } else if (['arrow', 'rectangle', 'circle'].includes(annotationTool)) {
        // For shapes, we need 2 points (start and end)
        setCurrentAnnotation(prev => {
          const newPoints = [...prev, pdfCoords];
          if (newPoints.length === 2 && currentProjectId && file.id) {
            // Complete the annotation
            addAnnotation({
              projectId: currentProjectId,
              sheetId: file.id,
              type: annotationTool,
              points: newPoints,
              color: annotationColor,
              pageNumber: currentPage
            });
            setCurrentAnnotation([]);
            onAnnotationToolChange?.(null);
          }
          return newPoints;
        });
        return;
      }
    }
    
    // Handle measurement clicks
    // CRITICAL FIX: Allow clicks in selection mode even without a condition selected
    // This allows users to select existing markups for deletion without needing a condition
    if (!currentSelectedConditionId && !isSelectionMode) {
      return;
    }
    
    // If we're in selection mode without a condition, we're just selecting markups, not creating measurements
    // The markup click handlers will handle selection, so we can return early here
    if (isSelectionMode && !currentSelectedConditionId) {
      // Allow the click to pass through - markup handlers will process it
      // If it's a blank space click, the deselection logic above already handled it
      return;
    }
    
    // Removed verbose logging - was causing console spam
    
    // Convert CSS coordinates to PDF coordinates (0-1) for storage
    // CRITICAL: Always normalize based on rotation 0, scale 1 viewport for consistency
    // This ensures coordinates match the actual PDF page dimensions regardless of current rotation
    const baseViewport = pdfPageRef.current?.getViewport({ scale: 1, rotation: 0 }) || viewport;
    
    // Transform CSS coordinates from rotated viewport to base viewport coordinates
    // pdf.js rotates by swapping dimensions and rotating the coordinate system
    let baseX: number, baseY: number;
    const rotation = viewState.rotation || 0;
    
    if (rotation === 0) {
      // No rotation: direct mapping
      baseX = (cssX / viewport.width) * baseViewport.width;
      baseY = (cssY / viewport.height) * baseViewport.height;
    } else if (rotation === 90) {
      // 90° clockwise: (x, y) in rotated → (y, width - x) in base
      baseX = (cssY / viewport.height) * baseViewport.width;
      baseY = (1 - cssX / viewport.width) * baseViewport.height;
    } else if (rotation === 180) {
      // 180°: (x, y) in rotated → (width - x, height - y) in base
      baseX = (1 - cssX / viewport.width) * baseViewport.width;
      baseY = (1 - cssY / viewport.height) * baseViewport.height;
    } else if (rotation === 270) {
      // 270° clockwise (90° counter-clockwise): (x, y) in rotated → (height - y, x) in base
      baseX = (1 - cssY / viewport.height) * baseViewport.width;
      baseY = (cssX / viewport.width) * baseViewport.height;
    } else {
      // Fallback: use direct mapping (shouldn't happen with standard rotations)
      baseX = (cssX / viewport.width) * baseViewport.width;
      baseY = (cssY / viewport.height) * baseViewport.height;
    }
    
    // Normalize to 0-1 range based on base viewport
    let pdfCoords = {
      x: baseX / baseViewport.width,
      y: baseY / baseViewport.height
    };
    
    // Smart cut-out mode entry removed - using manual toggle instead
    
    // Apply ortho snapping if enabled and we have reference points
    // IMPORTANT: When ortho snapping is enabled, use mousePosition which already has the snapped coordinates
    // that match the crosshair position. This ensures points are created exactly where the crosshair is.
    if (isOrthoSnapping && isMeasuring && mousePosition) {
      // Use the snapped position from mousePosition (which matches the crosshair)
      pdfCoords = mousePosition;
    } else if (isOrthoSnapping) {
      // Fallback: recalculate snapping if mousePosition is not available
      const referencePoints = cutoutMode ? currentCutout : (isContinuousDrawing ? activePoints : currentMeasurement);
      pdfCoords = applyOrthoSnapping(pdfCoords, referencePoints);
    }
    
    // Handle continuous linear drawing mode
    if (measurementType === 'linear') {
      if (!isContinuousDrawing) {
        // Start continuous drawing mode
        setIsContinuousDrawing(true);
        setActivePoints([pdfCoords]);
        createRubberBandElement();
      } else {
        // Add point to active measurement
        setActivePoints(prev => {
          const newPoints = [...prev, pdfCoords];
          // Update running length after adding point
          const newLength = calculateRunningLength(newPoints);
          setRunningLength(newLength);
          return newPoints;
        });
      }
    } else {
      // Handle other measurement types (existing behavior)
      setCurrentMeasurement(prev => {
        const newMeasurement = [...prev, pdfCoords];
        return newMeasurement;
      });
      
      // Complete measurement based on type
      if (measurementType === 'count') {
        completeMeasurement([pdfCoords]);
      }
      // Area and volume measurements will be completed on double-click
    }
  }, [isCalibrating, calibrationPoints, measurementType, currentMeasurement, isContinuousDrawing, activePoints, calculateRunningLength, currentViewport, isSelectionMode, selectedMarkupId, isOrthoSnapping, isMeasuring, mousePosition, cutoutMode, currentCutout, isDeselecting, visualSearchMode, titleblockSelectionMode, isSelectingSymbol, selectionStart, annotationTool, currentProjectId, file, currentPage, addAnnotation, annotationColor, onAnnotationToolChange, viewState, setPageViewports, pdfDocument]);

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
          console.log('📐 Linear with height calculation:', {
            linearValue: calculatedValue,
            height: selectedCondition.height,
            areaValue: areaValue,
            conditionName: selectedCondition.name
          });
        } else {
          console.log('⚠️ Linear condition without height:', {
            includeHeight: selectedCondition.includeHeight,
            height: selectedCondition.height,
            conditionName: selectedCondition.name
          });
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
      addTakeoffMeasurement({
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
      }).then(savedMeasurementId => {
        // The new measurement will automatically appear via the useEffect that watches takeoffMeasurements
        // No need for complex manual state management - just like annotations!
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

  // Handle double-click to complete measurements
  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    // Prevent default behavior
    event.preventDefault();
    event.stopPropagation();
    
    // Handle cut-out completion
    if (cutoutMode && currentCutout.length >= 3) {
      completeCutout(currentCutout);
      return;
    }
    
    // Handle measurement completion when in measurement mode
    if (isMeasuring) {
      // Handle continuous linear measurements
      if (isContinuousDrawing && activePoints.length >= 2) {
        // Complete the continuous linear measurement
        completeContinuousLinearMeasurement();
        return;
      }
      
      // Handle non-continuous linear measurements (at least 2 points required)
      if (measurementType === 'linear' && !isContinuousDrawing && currentMeasurement.length >= 2) {
        // Complete non-continuous linear measurement
        completeMeasurement(currentMeasurement);
        return;
      }
      
      // For area or volume measurements, require at least 3 points (as required by the calculator)
      if ((measurementType === 'area' || measurementType === 'volume') && currentMeasurement.length >= 3) {
        // Complete area or volume measurement
        completeMeasurement(currentMeasurement);
        return;
      }
    }
  }, [annotationTool, currentAnnotation, annotationColor, currentPage, onAnnotationToolChange, isContinuousDrawing, activePoints, measurementType, currentMeasurement, completeContinuousLinearMeasurement, completeMeasurement, cutoutMode, currentCutout, completeCutout, isMeasuring]);

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

  // Handle wheel events for zoom
  const handleWheel = useCallback((event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      
      const ZOOM_STEP = 1.2;
      const MIN_SCALE = 0.5;
      const MAX_SCALE = 3;
      
      const zoomFactor = event.deltaY < 0 ? ZOOM_STEP : 1/ZOOM_STEP;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, 
        viewState.scale * zoomFactor
      ));
      
      // FIX: Update viewport IMMEDIATELY before any rendering to prevent drift
      // This ensures currentViewport is fresh before state updates trigger re-renders
      if (pdfPageRef.current) {
        const freshViewport = pdfPageRef.current.getViewport({ 
          scale: newScale, 
          rotation: viewState.rotation 
        });
        
        // Synchronously update pageViewports so currentViewport memo recalculates
        setPageViewports(prev => ({
          ...prev,
          [currentPage]: freshViewport
        }));
        
        // Update lastRenderedScaleRef so baseline scale logic uses correct value
        lastRenderedScaleRef.current = newScale;
      }
      
      // Update internal state and notify parent
      setInternalViewState(prev => ({ ...prev, scale: newScale }));
      if (onScaleChange) onScaleChange(newScale);

      // If renders are currently blocked (interactive drawing/calibration/etc),
      // apply CSS transform to simulate zoom without re-rendering the PDF canvas.
      const rendersBlocked = (isMeasuring || isCalibrating || currentMeasurement.length > 0 || isDeselecting || (isAnnotating && !showTextInput));
      if (rendersBlocked) {
        requestAnimationFrame(() => {
          // Only apply synchronized CSS transform to both canvas and SVG.
          // Do NOT re-render overlay during blocked zoom to avoid double-scaling drift.
          applyInteractiveZoomTransforms();
        });
        // Zoom toward cursor by adjusting scroll to keep cursor-anchored point stable
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const offsetX = event.clientX - rect.left;
          const offsetY = event.clientY - rect.top;
          const r = newScale / (viewState.scale || 1);
          container.scrollLeft = (container.scrollLeft + offsetX) * r - offsetX;
          container.scrollTop = (container.scrollTop + offsetY) * r - offsetY;
        }
        return;
      }
      
      // Otherwise, do not redraw overlay immediately; wait for the debounced full PDF render
      // to keep canvas and overlay perfectly in lockstep.
      // Zoom toward cursor for normal renders as well
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;
        const r = newScale / (viewState.scale || 1);
        container.scrollLeft = (container.scrollLeft + offsetX) * r - offsetX;
        container.scrollTop = (container.scrollTop + offsetY) * r - offsetY;
      }
    }
  }, [viewState.scale, viewState.rotation, onScaleChange, pdfDocument, localTakeoffMeasurements, isMeasuring, isCalibrating, currentMeasurement.length, isDeselecting, isAnnotating, showTextInput, applyInteractiveZoomTransforms]);

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
      const optimalScale = Math.min(scaleX, scaleY, 5); // Cap at 5x zoom
      

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

  // Handle rotation

  // Add scroll position tracking
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (onLocationChange) {
        onLocationChange(container.scrollLeft, container.scrollTop);
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [onLocationChange]);

  // Add global function to restore scroll position
  useEffect(() => {
    setRestoreScrollPosition((x: number, y: number) => {
      const container = containerRef.current;
      if (container) {
        container.scrollLeft = x;
        container.scrollTop = y;
      }
    });

    return () => {
      setRestoreScrollPosition(undefined);
    };
  }, []);

  // Add wheel event listener to container, canvas, and SVG to ensure zoom works during markup placement
  useEffect(() => {
    const container = containerRef.current;
    const canvas = pdfCanvasRef.current;
    const svg = svgOverlayRef.current;
    
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    if (canvas) {
      canvas.addEventListener('wheel', handleWheel, { passive: false });
    }
    if (svg) {
      svg.addEventListener('wheel', handleWheel, { passive: false });
    }
    
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (canvas) {
        canvas.removeEventListener('wheel', handleWheel);
      }
      if (svg) {
        svg.removeEventListener('wheel', handleWheel);
      }
    };
  }, [handleWheel]);

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

  // Handle escape key to back out vertices one-by-one and delete key to delete selected markup
  const handleKeyDown = useCallback(async (event: KeyboardEvent) => {
    // Handle escape for annotation mode
    if (event.key === 'Escape' && annotationTool) {
      event.preventDefault();
      
      if (currentAnnotation.length > 0) {
        // Remove the last point (like linear measurements)
        setCurrentAnnotation(prev => {
          const newPoints = [...prev];
          newPoints.pop(); // Remove the last vertex
          
          // If no vertices remain, exit annotation mode
          if (newPoints.length === 0) {
            onAnnotationToolChange?.(null);
          }
          return newPoints;
        });
      } else {
        // Exit annotation mode if no points
        onAnnotationToolChange?.(null);
      }
      return;
    }
    
    if (event.key === 'Escape' && (isMeasuring || isCalibrating)) {
      event.preventDefault();
      
      // Handle escape for calibration mode
      if (isCalibrating) {
        if (calibrationPoints.length > 0) {
          // Remove the last calibration point
          setCalibrationPoints(prev => {
            const newPoints = [...prev];
            newPoints.pop();
            
            // If no points remain, exit calibration mode
            if (newPoints.length === 0) {
              setIsCalibrating(false);
              setMousePosition(null);
              setCalibrationData(null);
            }
            
            return newPoints;
          });
        } else {
          // Exit calibration mode completely
          setIsCalibrating(false);
          setMousePosition(null);
          setCalibrationData(null);
        }
        return;
      }
      
      // Handle escape for continuous linear drawing
      if (measurementType === 'linear' && isContinuousDrawing && activePoints.length > 0) {
        setActivePoints(prev => {
          const newPoints = [...prev];
          newPoints.pop(); // Remove the last vertex
          
          // If no vertices remain, exit measurement mode
          if (newPoints.length === 0) {
            setIsMeasuring(false);
            setMousePosition(null);
            setIsContinuousDrawing(false);
            setRunningLength(0);
            // Clean up rubber band element
            const currentRubberBand = pageRubberBandRefs.current[currentPage];
            if (currentRubberBand && svgOverlayRef.current && currentRubberBand.parentNode === svgOverlayRef.current) {
              svgOverlayRef.current.removeChild(currentRubberBand);
            }
            pageRubberBandRefs.current[currentPage] = null;
            setRubberBandElement(null);
          }
          
          return newPoints;
        });
      } else if (currentMeasurement.length > 0) {
        // Handle escape for other measurement types
        setCurrentMeasurement(prev => {
          const newMeasurement = [...prev];
          newMeasurement.pop(); // Remove the last vertex
          
          // If no vertices remain, exit measurement mode
          if (newMeasurement.length === 0) {
            setIsMeasuring(false);
            setMousePosition(null);
          }
          
          return newMeasurement;
        });
      }
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedMarkupId && isSelectionMode) {
      event.preventDefault();
      
      // Check if it's an annotation or a measurement
      const isAnnotation = localAnnotations.some(a => a.id === selectedMarkupId);
      
      if (isAnnotation) {
        // Delete annotation
        
        // Clear selection immediately
        const deletedId = selectedMarkupId;
        setSelectedMarkupId(null);
        
        const deleteAnnotation = useAnnotationStore.getState().deleteAnnotation;
        deleteAnnotation(deletedId);
        const updatedAnnotations = useAnnotationStore.getState().annotations;
        
        // Immediately update local annotations to reflect the deletion
        const filteredAnnotations = updatedAnnotations.filter(
          a => a.projectId === currentProjectId && a.sheetId === file.id
        );
        setLocalAnnotations(filteredAnnotations);
        
        // CRITICAL FIX: Force immediate re-render (bypass debouncing) to ensure pointer-events are updated
        // State is already updated synchronously above, so we can render immediately
        if (currentViewport) {
          renderMarkupsWithPointerEvents(currentPage, currentViewport, pdfPageRef.current ?? undefined, true);
        }
      } else if (currentProjectId && file.id) {
        const deleteTakeoffMeasurement = useMeasurementStore.getState().deleteTakeoffMeasurement;
        try {
          // Clear selection immediately
          const deletedId = selectedMarkupId;
          setSelectedMarkupId(null);
          
          // Delete from store (async operation)
          await deleteTakeoffMeasurement(deletedId);
          
          // CRITICAL FIX: Wait for localTakeoffMeasurements to update before rendering
          // The reactive useEffect (line 506) will update localTakeoffMeasurements asynchronously
          // We need to wait for that update to complete before re-rendering
          // Use a polling approach that checks the store (which updates synchronously) and waits for React to process
          const waitForStateUpdate = (retries = 30): Promise<void> => {
            return new Promise((resolve) => {
              let attemptCount = 0;
              const checkState = () => {
                attemptCount++;
                // Check if the deleted measurement is gone from store
                // Store updates synchronously, but React state updates asynchronously
                const storeMeasurements = getPageTakeoffMeasurements(currentProjectId, file.id, currentPage);
                const stillExistsInStore = storeMeasurements.some(m => m.id === deletedId);
                
                // If it's gone from store, wait a bit more for React to process the state update
                // then resolve
                if (!stillExistsInStore) {
                  // Give React time to process the state update (useTakeoffMeasurements change triggers useEffect)
                  setTimeout(() => resolve(), 50);
                } else if (attemptCount >= retries) {
                  // Timeout - proceed anyway
                  resolve();
                } else {
                  // Check again soon
                  setTimeout(checkState, 10);
                }
              };
              // Start checking after a brief delay to allow store update to propagate
              setTimeout(checkState, 10);
            });
          };
          
          // Wait for state update, then re-render
          await waitForStateUpdate();
          
          // SIMPLIFIED: Call onPageShown and update pointer-events
          if (currentViewport && pdfPageRef.current) {
            onPageShown(currentPage, currentViewport);
            // Update pointer-events after a small delay to ensure DOM is updated
            setTimeout(() => {
              if (svgOverlayRef.current && isSelectionMode) {
                updateMarkupPointerEvents(true); // Force selection mode
              }
            }, 100);
          }
    } catch (error: unknown) {
        console.error(`Failed to delete markup:`, error);
        }
      }
    } else if (event.key === 'Control' && (isMeasuring || isCalibrating)) {
      // Toggle ortho snapping when Ctrl is pressed during measurement or calibration
      event.preventDefault();
      setIsOrthoSnapping(prev => !prev);
    }
  }, [annotationTool, currentAnnotation, onAnnotationToolChange, localAnnotations, isMeasuring, isCalibrating, calibrationPoints.length, currentMeasurement.length, selectedMarkupId, isSelectionMode, currentProjectId, file.id, currentPage, measurementType, isContinuousDrawing, activePoints.length, isOrthoSnapping, renderMarkupsWithPointerEvents, currentViewport, getPageTakeoffMeasurements, localTakeoffMeasurements, updateMarkupPointerEvents, totalPages, onPageShown]);

  // Add keyboard event listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Re-render when page changes
  useEffect(() => {
    if (pdfDocument && isComponentMounted) {
      setMeasurements([]);
      
      // Optimized retry mechanism if canvas is not ready
      // CRITICAL: Use ref to avoid dependency on renderPDFPage which changes frequently
      const attemptRender = async (retries = 3) => {
        if (pdfCanvasRef.current && containerRef.current && renderPDFPageRef.current) {
          await renderPDFPageRef.current(currentPage);
        } else if (retries > 0) {
          setTimeout(() => attemptRender(retries - 1), 50); // Reduced retry delay
        } else {
          if (process.env.NODE_ENV === 'development') {
            console.warn('Canvas not ready after retries, skipping render');
          }
        }
      };
      
      attemptRender();
    }
  // NOTE: Using renderPDFPageRef instead of renderPDFPage to prevent cascading re-renders
  }, [pdfDocument, currentPage, isComponentMounted]);

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
          setSelectedMarkupId(null);
          setIsDeselecting(false);
          setMeasurementType('count'); // Set type but don't enable measuring
          // Auto-count box selection is handled by visualSearchMode prop and isSelectingSymbol state
          return; // Exit early - don't enable measurement mode
        }
        
        // All other condition types use measurement mode
        setIsMeasuring(true);
        setIsSelectionMode(false);
        setSelectedMarkupId(null);
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
        setSelectedMarkupId(null);
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
      setSelectedMarkupId(null);
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

  // Must be declared before any conditional return (Rules of Hooks)
  const handleCanvasDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!annotationTool) {
        handleDoubleClick(e as React.MouseEvent<HTMLCanvasElement | SVGSVGElement>);
      } else {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [annotationTool, handleDoubleClick]
  );

  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const currentIsSelectionMode = isSelectionModeRef.current;
      if (currentIsSelectionMode || isCalibrating || annotationTool || (visualSearchMode && isSelectingSymbol) || (!!titleblockSelectionMode && isSelectingSymbol)) {
        const target = e.target as SVGElement;
        let annotationId: string | null = null;
        let measurementId: string | null = null;
        if (target.hasAttribute('data-annotation-id')) {
          annotationId = target.getAttribute('data-annotation-id');
        } else {
          const annotationParent = target.closest('[data-annotation-id]');
          if (annotationParent) {
            annotationId = annotationParent.getAttribute('data-annotation-id');
          } else if (target.parentElement?.hasAttribute('data-annotation-id')) {
            annotationId = target.parentElement.getAttribute('data-annotation-id');
          }
        }
        if (target.hasAttribute('data-measurement-id')) {
          measurementId = target.getAttribute('data-measurement-id');
        } else {
          const measurementParent = target.closest('[data-measurement-id]');
          if (measurementParent) {
            measurementId = measurementParent.getAttribute('data-measurement-id');
          } else {
            let parent = target.parentElement;
            while (parent && !measurementId) {
              if (parent.hasAttribute('data-measurement-id')) {
                measurementId = parent.getAttribute('data-measurement-id');
                break;
              }
              parent = parent.parentElement;
            }
          }
        }
        if (annotationId && currentIsSelectionMode) {
          e.stopPropagation();
          setSelectedMarkupId(annotationId);
          return;
        }
        if (measurementId && currentIsSelectionMode) {
          e.stopPropagation();
          setSelectedMarkupId(measurementId);
          return;
        }
        e.stopPropagation();
        handleClick(e as React.MouseEvent<HTMLCanvasElement | SVGSVGElement>);
      }
    },
    [isCalibrating, annotationTool, visualSearchMode, isSelectingSymbol, titleblockSelectionMode, setSelectedMarkupId, handleClick]
  );

  const handleSvgDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (annotationTool || isMeasuring || cutoutMode) {
        e.preventDefault();
        e.stopPropagation();
        handleDoubleClick(e as React.MouseEvent<HTMLCanvasElement | SVGSVGElement>);
      }
    },
    [annotationTool, isMeasuring, cutoutMode, handleDoubleClick]
  );

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
    : (isCalibrating ? 'crosshair' : (isMeasuring ? 'crosshair' : (isSelectionMode ? 'pointer' : 'default')));
  const svgPointerEvents = (isSelectionMode || isCalibrating || annotationTool || (visualSearchMode && isSelectingSymbol) || (!!titleblockSelectionMode && isSelectingSymbol)) ? 'auto' : 'none';
  const overlayKey = `overlay-${currentPage}-${file.id}`;
  const textAnnotationProps = showTextInput && textInputPosition
    ? {
        show: true,
        position: textInputPosition,
        value: textInputValue,
        onChange: setTextInputValue,
        onSave: () => {
          if (textInputValue.trim() && currentProjectId) {
            addAnnotation({
              projectId: currentProjectId,
              sheetId: file.id,
              type: 'text',
              points: currentAnnotation,
              color: annotationColor,
              text: textInputValue,
              pageNumber: currentPage,
            });
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
            : (isCalibrating ? 'crosshair' : (isMeasuring ? 'crosshair' : (isSelectionMode ? 'pointer' : 'default')))
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