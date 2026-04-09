/**
 * Hook that provides PDFViewer mouse/keyboard event handlers.
 * Accepts context from PDFViewer so handlers don't close over all state inline.
 */
import { useCallback, useEffect, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { useAnnotationStore } from '../../store/slices/annotationSlice';
import { useConditionStore } from '../../store/slices/conditionSlice';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import { useUndoStore } from '../../store';
import {
  shiftTakeoffMeasurementGeometry,
  cssDragRectToPdfQuad,
  MIN_DRAG_RECT_PX,
} from '../../utils/measurementGeometry';
import { isEditableKeyboardTarget } from '../../utils/keyboardUtils';
import { getMarkupIdsFromElementsFromPoint } from '../../utils/markupHitTest';
import {
  clearCanvasConditionSelection,
  measurementDrawModeForCondition,
  syncStoreConditionFromMeasurementId,
} from '../../utils/takeoffMeasurementLookup';

const PASTE_OFFSET = 0.02;

/**
 * Transform a selection rect from rotated viewport coordinates (0-1) to native PDF page coordinates (0-1).
 * The server expects native coords; when the user draws on a rotated page, we must convert.
 * Same inverse transform as calibration/cutout point conversion (viewport -> baseViewport).
 */
function transformSelectionRectToNative(
  rect: { x: number; y: number; width: number; height: number },
  rotation: number
): { x: number; y: number; width: number; height: number } {
  const { x: nx, y: ny, width: nw, height: nh } = rect;
  const r = rotation % 360;
  if (r === 0) return rect;

  // Transform 4 corners to native, then take AABB
  const px = (qx: number, qy: number) => {
    if (r === 90) return { x: qy, y: 1 - qx };
    if (r === 180) return { x: 1 - qx, y: 1 - qy };
    if (r === 270) return { x: 1 - qy, y: qx };
    return { x: qx, y: qy };
  };
  const c1 = px(nx, ny);
  const c2 = px(nx + nw, ny);
  const c3 = px(nx + nw, ny + nh);
  const c4 = px(nx, ny + nh);
  const xMin = Math.min(c1.x, c2.x, c3.x, c4.x);
  const xMax = Math.max(c1.x, c2.x, c3.x, c4.x);
  const yMin = Math.min(c1.y, c2.y, c3.y, c4.y);
  const yMax = Math.max(c1.y, c2.y, c3.y, c4.y);
  const out = {
    x: Math.max(0, Math.min(1, xMin)),
    y: Math.max(0, Math.min(1, yMin)),
    width: Math.max(0.001, Math.min(1, xMax - xMin)),
    height: Math.max(0.001, Math.min(1, yMax - yMin)),
  };
  return out;
}

const ANNOTATION_SHORTCUTS: Record<string, 'rectangle' | 'text' | 'circle' | 'arrow'> = {
  r: 'rectangle',
  t: 'text',
  c: 'circle',
  a: 'arrow',
};

/** Max zoom scale to avoid slow/frozen PDF (canvas size = viewport × devicePixelRatio; ~265%+ becomes very heavy). */
export const PDF_VIEWER_MAX_SCALE = 2.5;
/** Min zoom scale; allows zooming out to match fit-to-window on large drawings. */
export const PDF_VIEWER_MIN_SCALE = 0.25;

export interface UsePDFViewerInteractionsOptions {
  pdfCanvasRef: RefObject<HTMLCanvasElement | null>;
  pdfPageRef: RefObject<PDFPageProxy | null>;
  svgOverlayRef: RefObject<SVGSVGElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  lastRenderedScaleRef: MutableRefObject<number>;
  viewState: { scale: number; rotation: number };
  currentPage: number;
  totalPages: number;
  setPageViewports: React.Dispatch<React.SetStateAction<Record<number, PageViewport>>>;
  setInternalViewState: React.Dispatch<React.SetStateAction<{ scale: number; rotation: number }>>;
  onScaleChange?: (scale: number) => void;
  isMeasuring: boolean;
  isCalibrating: boolean;
  currentMeasurement: { x: number; y: number }[];
  isDeselecting: boolean;
  setIsDeselecting: React.Dispatch<React.SetStateAction<boolean>>;
  isAnnotating: boolean;
  showTextInput: boolean;
  applyInteractiveZoomTransforms: (overrideScale?: number) => void;
  // Keyboard handler options
  annotationTool: 'text' | 'arrow' | 'rectangle' | 'circle' | null;
  currentAnnotation: { x: number; y: number }[];
  setCurrentAnnotation: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>>;
  onAnnotationToolChange?: (tool: 'text' | 'arrow' | 'rectangle' | 'circle' | null) => void;
  calibrationPoints: { x: number; y: number }[];
  setCalibrationPoints: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>>;
  setIsCalibrating: React.Dispatch<React.SetStateAction<boolean>>;
  setCalibrationData: React.Dispatch<React.SetStateAction<{ knownDistance: number; unit: string } | null>>;
  setMousePosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  measurementType: 'linear' | 'area' | 'volume' | 'count';
  isContinuousDrawing: boolean;
  setIsContinuousDrawing: React.Dispatch<React.SetStateAction<boolean>>;
  /** Synced in useLayoutEffect in usePDFViewerMeasurements — use for dblclick completion (state lags behind the 2nd click). */
  activePointsRef: MutableRefObject<{ x: number; y: number }[]>;
  currentMeasurementRef: MutableRefObject<{ x: number; y: number }[]>;
  isContinuousDrawingRef: MutableRefObject<boolean>;
  activePoints: { x: number; y: number }[];
  pageRubberBandRefs: MutableRefObject<Record<number, SVGLineElement | null>>;
  setActivePoints: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>>;
  setIsMeasuring: React.Dispatch<React.SetStateAction<boolean>>;
  setRunningLength: React.Dispatch<React.SetStateAction<number>>;
  setRubberBandElement: React.Dispatch<React.SetStateAction<SVGLineElement | null>>;
  setCurrentMeasurement: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>>;
  selectedMarkupIds: string[];
  setSelectedMarkupIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedMeasurementIds: string[];
  selectedAnnotationIds: string[];
  /** True when plan selection is only measurements and matches the sidebar condition (draw mode stays off until user draws or presses Space). */
  canvasSelectionMatchesCondition: boolean;
  isSelectionMode: boolean;
  setIsSelectionMode: React.Dispatch<React.SetStateAction<boolean>>;
  /** Align measurement tool with the currently selected condition (same logic as PDFViewer condition effect). */
  syncMeasurementTypeFromSelectedCondition: () => void;
  currentProjectId: string | null;
  file: { id: string };
  currentViewport: PageViewport | null;
  renderMarkupsWithPointerEventsRef: MutableRefObject<
    ((pageNum: number, viewport: PageViewport, page?: PDFPageProxy, forceImmediate?: boolean) => Promise<void>) | null
  >;
  onPageShownRef: MutableRefObject<((pageNum: number, viewport: PageViewport) => void) | null>;
  updateMarkupPointerEventsRef: MutableRefObject<((selectionMode: boolean) => void) | null>;
  setLocalAnnotations: React.Dispatch<React.SetStateAction<import('../../types').Annotation[]>>;
  isOrthoSnapping: boolean;
  setIsOrthoSnapping: React.Dispatch<React.SetStateAction<boolean>>;
  // Mouse handler options: visual search / titleblock
  visualSearchMode: boolean;
  titleblockSelectionMode: 'sheetNumber' | 'sheetName' | null;
  isSelectingSymbol: boolean;
  selectionStart: { x: number; y: number } | null;
  setSelectionStart: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  setSelectionBox: React.Dispatch<React.SetStateAction<{ x: number; y: number; width: number; height: number } | null>>;
  setIsSelectingSymbol: React.Dispatch<React.SetStateAction<boolean>>;
  onTitleblockSelectionComplete?: (
    field: 'sheetNumber' | 'sheetName',
    selectionBox: { x: number; y: number; width: number; height: number },
    pageNumber: number
  ) => void;
  onVisualSearchComplete?: (selectionBox: { x: number; y: number; width: number; height: number }) => void;
  // Hyperlink mode
  hyperlinkMode?: boolean;
  hyperlinkDrawStart?: { x: number; y: number } | null;
  setHyperlinkDrawStart?: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  setHyperlinkDrawBox?: React.Dispatch<React.SetStateAction<{ x: number; y: number; width: number; height: number } | null>>;
  onHyperlinkRegionDrawn?: (
    rect: { x: number; y: number; width: number; height: number },
    sheetId: string,
    pageNumber: number
  ) => void;
  onHyperlinkModeChange?: (active: boolean) => void;
  onHyperlinkClick?: (targetSheetId: string, targetPageNumber: number) => void;
  // Move/drag state (from usePDFViewerMeasurements)
  measurementMoveId: string | null;
  setMeasurementMoveId: React.Dispatch<React.SetStateAction<string | null>>;
  measurementMoveIds: string[];
  setMeasurementMoveIds: React.Dispatch<React.SetStateAction<string[]>>;
  measurementMoveStart: { x: number; y: number } | null;
  setMeasurementMoveStart: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  measurementMoveOriginalPoints: { x: number; y: number }[] | null;
  setMeasurementMoveOriginalPoints: React.Dispatch<React.SetStateAction<{ x: number; y: number }[] | null>>;
  measurementMoveDelta: { x: number; y: number } | null;
  setMeasurementMoveDelta: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  measurementDragStart: { x: number; y: number } | null;
  setMeasurementDragStart: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  measurementDragBox: { x: number; y: number; width: number; height: number } | null;
  setMeasurementDragBox: React.Dispatch<React.SetStateAction<{ x: number; y: number; width: number; height: number } | null>>;
  cutoutDragStart: { x: number; y: number } | null;
  setCutoutDragStart: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  cutoutDragBox: { x: number; y: number; width: number; height: number } | null;
  setCutoutDragBox: React.Dispatch<React.SetStateAction<{ x: number; y: number; width: number; height: number } | null>>;
  annotationMoveId: string | null;
  setAnnotationMoveId: React.Dispatch<React.SetStateAction<string | null>>;
  annotationMoveIds: string[];
  setAnnotationMoveIds: React.Dispatch<React.SetStateAction<string[]>>;
  annotationMoveStart: { x: number; y: number } | null;
  setAnnotationMoveStart: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  annotationMoveOriginalPoints: { x: number; y: number }[] | null;
  setAnnotationMoveOriginalPoints: React.Dispatch<React.SetStateAction<{ x: number; y: number }[] | null>>;
  annotationMoveDelta: { x: number; y: number } | null;
  setAnnotationMoveDelta: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  annotationDragStart: { x: number; y: number } | null;
  setAnnotationDragStart: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  annotationDragBox: { x: number; y: number; width: number; height: number } | null;
  setAnnotationDragBox: React.Dispatch<React.SetStateAction<{ x: number; y: number; width: number; height: number } | null>>;
  // Cut-out
  cutoutMode: boolean;
  currentCutout: { x: number; y: number }[];
  setCurrentCutout: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>>;
  cutoutTargetConditionId: string | null;
  onCutoutModeChange?: (mode: string | null) => void;
  // Completion callbacks (completeCalibration from hook; others via refs because defined after hook in PDFViewer)
  completeCalibration: (points: { x: number; y: number }[]) => void;
  createRubberBandElementRef: MutableRefObject<(() => void) | null>;
  completeCutoutRef: MutableRefObject<((points: { x: number; y: number }[]) => Promise<void>) | null>;
  completeContinuousLinearMeasurementRef: MutableRefObject<(() => Promise<void>) | null>;
  // Refs for "just completed" and selection mode (so SVG click can skip)
  measurementMoveJustCompletedRef: MutableRefObject<boolean>;
  annotationMoveJustCompletedRef: MutableRefObject<boolean>;
  measurementDragJustCompletedRef: MutableRefObject<boolean>;
  cutoutDragJustCompletedRef: MutableRefObject<boolean>;
  annotationDragJustCompletedRef: MutableRefObject<boolean>;
  isSelectionModeRef: MutableRefObject<boolean>;
  isMeasuringRef: MutableRefObject<boolean>;
  completeMeasurementRef: MutableRefObject<(points: { x: number; y: number }[]) => Promise<void>>;
  // Store-derived / callbacks
  annotationColor: string;
  setTextInputPosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  setShowTextInput: React.Dispatch<React.SetStateAction<boolean>>;
  localTakeoffMeasurements: import('../../types').TakeoffMeasurement[];
  localAnnotations: import('../../types').Annotation[];
  setLocalTakeoffMeasurements: React.Dispatch<React.SetStateAction<import('../../types').TakeoffMeasurement[]>>;
  updateTakeoffMeasurement: (id: string, update: Partial<import('../../types').TakeoffMeasurement>) => Promise<void>;
  updateAnnotation: (id: string, update: Partial<import('../../types').Annotation>) => void;
  addAnnotation: (annotation: Omit<import('../../types').Annotation, 'id' | 'timestamp'>) => import('../../types').Annotation;
  applyOrthoSnapping: (pos: { x: number; y: number }, refPoints: { x: number; y: number }[]) => { x: number; y: number };
  calculateRunningLength: (points: { x: number; y: number }[], currentMousePos?: { x: number; y: number }) => number;
  mousePositionRef: MutableRefObject<{ x: number; y: number } | null>;
  /** Batched rAF repaint of crosshair / preview (reads mousePositionRef). */
  scheduleEphemeralPaintRef: MutableRefObject<(() => void) | null>;
  pdfDocument: unknown;
}

export interface UsePDFViewerInteractionsResult {
  getCssCoordsFromEvent: (
    ev: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>
  ) => { x: number; y: number } | null;
  handleWheel: (event: WheelEvent) => void;
  handleKeyDown: (event: KeyboardEvent) => Promise<void>;
  handleMouseDown: (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => void;
  handleMouseUp: (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => Promise<void>;
  handleMouseMove: (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => void;
  handleClick: (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => Promise<void>;
  handleDoubleClick: (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => void;
  handleCanvasDoubleClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleSvgClick: (e: React.MouseEvent<SVGSVGElement>) => void;
  handleSvgDoubleClick: (e: React.MouseEvent<SVGSVGElement>) => void;
}

export function usePDFViewerInteractions(
  options: UsePDFViewerInteractionsOptions
): UsePDFViewerInteractionsResult {
  const {
    pdfCanvasRef,
    pdfPageRef,
    svgOverlayRef,
    containerRef,
    lastRenderedScaleRef,
    viewState,
    currentPage,
    totalPages: _totalPages,
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
    activePointsRef,
    currentMeasurementRef,
    isContinuousDrawingRef,
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
    canvasSelectionMatchesCondition,
    isSelectionMode,
    setIsSelectionMode,
    syncMeasurementTypeFromSelectedCondition,
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
    hyperlinkMode = false,
    hyperlinkDrawStart = null,
    setHyperlinkDrawStart = () => {},
    setHyperlinkDrawBox = () => {},
    onHyperlinkRegionDrawn,
    onHyperlinkModeChange,
    onHyperlinkClick,
    measurementMoveId,
    setMeasurementMoveId,
    measurementMoveIds,
    setMeasurementMoveIds,
    measurementMoveStart,
    setMeasurementMoveStart,
    measurementMoveOriginalPoints,
    setMeasurementMoveOriginalPoints,
    measurementMoveDelta: _measurementMoveDelta,
    setMeasurementMoveDelta,
    measurementDragStart,
    setMeasurementDragStart,
    setMeasurementDragBox,
    cutoutDragStart,
    setCutoutDragStart,
    setCutoutDragBox,
    annotationMoveId,
    setAnnotationMoveId,
    annotationMoveIds,
    setAnnotationMoveIds,
    annotationMoveStart,
    setAnnotationMoveStart,
    annotationMoveOriginalPoints,
    setAnnotationMoveOriginalPoints,
    annotationMoveDelta: _annotationMoveDelta,
    setAnnotationMoveDelta,
    annotationDragStart,
    setAnnotationDragStart,
    annotationDragBox: _annotationDragBox,
    setAnnotationDragBox,
    cutoutMode,
    currentCutout,
    setCurrentCutout,
    cutoutTargetConditionId,
    onCutoutModeChange: _onCutoutModeChange,
    completeCalibration,
    createRubberBandElementRef,
    completeCutoutRef,
    completeContinuousLinearMeasurementRef,
    measurementMoveJustCompletedRef,
    annotationMoveJustCompletedRef,
    measurementDragJustCompletedRef,
    cutoutDragJustCompletedRef,
    annotationDragJustCompletedRef,
    isSelectionModeRef,
    isMeasuringRef,
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
    mousePositionRef,
    scheduleEphemeralPaintRef,
    pdfDocument,
  } = options;

  const queueEphemeralPaint = useCallback(() => {
    scheduleEphemeralPaintRef.current?.();
  }, [scheduleEphemeralPaintRef]);

  const copyMarkupsByIds = useMeasurementStore((s) => s.copyMarkupsByIds);
  const copiedMarkups = useMeasurementStore((s) => s.copiedMarkups);
  const addTakeoffMeasurement = useMeasurementStore((s) => s.addTakeoffMeasurement);
  const getPageTakeoffMeasurements = useMeasurementStore((s) => s.getPageTakeoffMeasurements);
  const _getSelectedCondition = useConditionStore((s) => s.getSelectedCondition);
  const selectedConditionId = useConditionStore((s) => s.selectedConditionId);

  const getCssCoordsFromEvent = useCallback(
    (ev: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>): { x: number; y: number } | null => {
      if (!pdfCanvasRef.current) return null;
      const rect = pdfCanvasRef.current.getBoundingClientRect();
      let x = ev.clientX - rect.left;
      let y = ev.clientY - rect.top;
      const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
      if (Math.abs(interactiveScale - 1) > 0.0001) {
        x /= interactiveScale;
        y /= interactiveScale;
      }
      return { x, y };
    },
    [viewState.scale, pdfCanvasRef, lastRenderedScaleRef]
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();

        const ZOOM_STEP = 1.2;
        const zoomFactor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const newScale = Math.min(
          PDF_VIEWER_MAX_SCALE,
          Math.max(PDF_VIEWER_MIN_SCALE, viewState.scale * zoomFactor)
        );

        const rendersBlocked =
          isMeasuring ||
          isCalibrating ||
          currentMeasurement.length > 0 ||
          isDeselecting ||
          (isAnnotating && !showTextInput);

        // When renders are blocked we only apply CSS zoom; canvas/SVG keep last-rendered dimensions.
        // Do NOT update pageViewports or lastRenderedScale so overlay drawing (preview, crosshair)
        // keeps using the correct viewport and doesn't get wrong coordinates or huge crosshair.
        if (pdfPageRef.current && !rendersBlocked) {
          const freshViewport = pdfPageRef.current.getViewport({
            scale: newScale,
            rotation: viewState.rotation,
          });
          setPageViewports((prev) => ({
            ...prev,
            [currentPage]: freshViewport,
          }));
          lastRenderedScaleRef.current = newScale;
        }

        setInternalViewState((prev) => ({ ...prev, scale: newScale }));
        if (onScaleChange) onScaleChange(newScale);

        if (rendersBlocked) {
          // Scroll adjustment FIRST (sync) — before CSS transform so layout is settled
          const container = containerRef.current;
          if (container) {
            const rect = container.getBoundingClientRect();
            const offsetX = event.clientX - rect.left;
            const offsetY = event.clientY - rect.top;
            const r = newScale / (viewState.scale || 1);
            container.scrollLeft = (container.scrollLeft + offsetX) * r - offsetX;
            container.scrollTop = (container.scrollTop + offsetY) * r - offsetY;
          }

          // Apply CSS transform, then recalculate mousePosition so crosshair
          // stays at the cursor. Without this, the crosshair drifts because the
          // old normalised coords × CSS transform produce a different screen
          // position than the actual cursor (due to canvas offset in the container).
          requestAnimationFrame(() => {
            applyInteractiveZoomTransforms(newScale);

            if ((isMeasuring || isCalibrating) && pdfCanvasRef.current && pdfPageRef.current) {
              const postRect = pdfCanvasRef.current.getBoundingClientRect();
              const newIS = newScale / (lastRenderedScaleRef.current || 1);
              let mx = event.clientX - postRect.left;
              let my = event.clientY - postRect.top;
              if (Math.abs(newIS - 1) > 0.0001) {
                mx /= newIS;
                my /= newIS;
              }
              const normVP = pdfPageRef.current.getViewport({
                scale: lastRenderedScaleRef.current || 1,
                rotation: viewState.rotation,
              });
              setMousePosition({
                x: mx / normVP.width,
                y: my / normVP.height,
              });
              queueEphemeralPaint();
            }
          });
          return;
        }

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
    },
    [
      viewState.scale,
      viewState.rotation,
      onScaleChange,
      currentPage,
      isMeasuring,
      isCalibrating,
      currentMeasurement.length,
      isDeselecting,
      isAnnotating,
      showTextInput,
      applyInteractiveZoomTransforms,
      pdfPageRef,
      pdfCanvasRef,
      setPageViewports,
      setMousePosition,
      setInternalViewState,
      lastRenderedScaleRef,
      containerRef,
      queueEphemeralPaint,
    ]
  );

  const handleKeyDown = useCallback(
    async (event: KeyboardEvent) => {
      const isCopy = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c';
      const isPaste = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v';
      let handled = false;

      if (isCopy && isSelectionMode && selectedMeasurementIds.length > 0 && currentProjectId && file.id) {
        event.preventDefault();
        copyMarkupsByIds(selectedMeasurementIds);
        handled = true;
      }

      if (isPaste && copiedMarkups.length > 0 && currentProjectId && file.id) {
        event.preventDefault();
        const offsetPoint = (p: { x: number; y: number }) => ({ x: p.x + PASTE_OFFSET, y: p.y + PASTE_OFFSET });
        for (const m of copiedMarkups) {
          const payload = {
            projectId: currentProjectId,
            sheetId: file.id,
            pdfPage: currentPage,
            conditionId: m.conditionId,
            type: m.type,
            points: m.points.map(offsetPoint),
            pdfCoordinates: m.pdfCoordinates.map(offsetPoint),
            calculatedValue: m.calculatedValue,
            unit: m.unit,
            conditionColor: m.conditionColor,
            conditionName: m.conditionName,
            ...(m.perimeterValue != null && { perimeterValue: m.perimeterValue }),
            ...(m.areaValue != null && { areaValue: m.areaValue }),
            ...(m.cutouts && m.cutouts.length > 0 && {
              cutouts: m.cutouts.map((c) => ({
                ...c,
                points: c.points.map(offsetPoint),
                pdfCoordinates: c.pdfCoordinates.map(offsetPoint),
              })),
            }),
            ...(m.netCalculatedValue != null && { netCalculatedValue: m.netCalculatedValue }),
            ...(m.description != null && { description: m.description }),
          };
          addTakeoffMeasurement(payload)
            .then((id) => {
              useUndoStore.getState().push({ type: 'measurement_add', id, createPayload: payload });
            })
            .catch((err) => console.error('Paste measurement failed:', err));
        }
        handled = true;
      }

      if (handled) return;

      // Annotation shortcuts R/T/C/A: only when no condition selected and not typing in input
      const isTyping = isEditableKeyboardTarget(event.target);
      const key = event.key.toLowerCase();
      if (
        !isTyping &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !selectedConditionId &&
        onAnnotationToolChange &&
        key in ANNOTATION_SHORTCUTS
      ) {
        const tool = ANNOTATION_SHORTCUTS[key as keyof typeof ANNOTATION_SHORTCUTS];
        event.preventDefault();
        onAnnotationToolChange(annotationTool === tool ? null : tool);
        return;
      }

      if (event.key === 'Escape' && hyperlinkMode) {
        event.preventDefault();
        onHyperlinkModeChange?.(false);
        setHyperlinkDrawStart(null);
        setHyperlinkDrawBox(null);
        return;
      }

      if (event.key === 'Escape' && cutoutDragStart) {
        event.preventDefault();
        setCutoutDragStart(null);
        setCutoutDragBox(null);
        return;
      }

      if (event.key === 'Escape' && annotationTool) {
        event.preventDefault();
        if (currentAnnotation.length > 0) {
          setCurrentAnnotation((prev) => {
            const newPoints = [...prev];
            newPoints.pop();
            if (newPoints.length === 0) {
              onAnnotationToolChange?.(null);
            }
            return newPoints;
          });
        } else {
          onAnnotationToolChange?.(null);
        }
        return;
      }

      if (event.key === 'Escape' && (isMeasuring || isCalibrating)) {
        event.preventDefault();
        if (isCalibrating) {
          if (calibrationPoints.length > 0) {
            setCalibrationPoints((prev) => {
              const newPoints = [...prev];
              newPoints.pop();
              if (newPoints.length === 0) {
                setIsCalibrating(false);
                setMousePosition(null);
                queueEphemeralPaint();
                setCalibrationData(null);
              }
              return newPoints;
            });
          } else {
            setIsCalibrating(false);
            setMousePosition(null);
            queueEphemeralPaint();
            setCalibrationData(null);
          }
          return;
        }
        if (measurementType === 'linear' && isContinuousDrawing && activePoints.length > 0) {
          setActivePoints((prev) => {
            const newPoints = [...prev];
            newPoints.pop();
            if (newPoints.length === 0) {
              setIsMeasuring(false);
              setMousePosition(null);
              queueEphemeralPaint();
              setIsContinuousDrawing(false);
              setRunningLength(0);
              const refs = pageRubberBandRefs.current;
              if (refs) {
                const currentRubberBand = refs[currentPage];
                if (currentRubberBand?.parentNode) {
                  currentRubberBand.parentNode.removeChild(currentRubberBand);
                }
                refs[currentPage] = null;
              }
              setRubberBandElement(null);
            }
            return newPoints;
          });
        } else if (currentMeasurement.length > 0) {
          setCurrentMeasurement((prev) => {
            const newMeasurement = [...prev];
            newMeasurement.pop();
            if (newMeasurement.length === 0) {
              setIsMeasuring(false);
              setMousePosition(null);
              queueEphemeralPaint();
            }
            return newMeasurement;
          });
        }
      } else if (
        event.key === 'Escape' &&
        !isTyping &&
        isSelectionMode &&
        selectedMarkupIds.length > 0 &&
        !isMeasuring &&
        !isCalibrating &&
        !annotationTool
      ) {
        event.preventDefault();
        setSelectedMarkupIds([]);
        clearCanvasConditionSelection();
      } else if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedMarkupIds.length > 0 &&
        isSelectionMode
      ) {
        event.preventDefault();
        setSelectedMarkupIds([]);
        const annotationStore = useAnnotationStore.getState();
        const measurementStore = useMeasurementStore.getState();
        const deleteAnnotation = annotationStore.deleteAnnotation;
        const deleteTakeoffMeasurement = measurementStore.deleteTakeoffMeasurement;
        const getAnnotationById = annotationStore.getAnnotationById;
        selectedAnnotationIds.forEach((id) => {
          const ann = getAnnotationById(id);
          if (ann) {
            useUndoStore.getState().push({ type: 'annotation_delete', annotation: ann });
            deleteAnnotation(id);
          }
        });
        const measurements = measurementStore.takeoffMeasurements;
        selectedMeasurementIds.forEach((id) => {
          const m = measurements.find((mm) => mm.id === id);
          if (m) useUndoStore.getState().push({ type: 'measurement_delete', measurement: m });
        });
        const measurementDeletes =
          currentProjectId && file.id
            ? selectedMeasurementIds.map((id) =>
                deleteTakeoffMeasurement(id).catch((err) => console.error('Failed to delete measurement:', err))
              )
            : [];
        await Promise.all(measurementDeletes);
        // Same as Escape on selection: drop sidebar condition that was only synced from canvas
        // markup. Otherwise selectedConditionId stays set with no selection and PDFViewer's effect
        // enters draw mode for that condition (user did not press Space or activate the condition).
        if (selectedMeasurementIds.length > 0) {
          clearCanvasConditionSelection();
        }
        const updatedAnnotations = useAnnotationStore.getState().annotations;
        setLocalAnnotations(updatedAnnotations.filter((a) => a.projectId === currentProjectId && a.sheetId === file.id));
        if (currentViewport) {
          renderMarkupsWithPointerEventsRef.current?.(currentPage, currentViewport, pdfPageRef.current ?? undefined, true);
        }
        if (currentViewport && pdfPageRef.current) {
          onPageShownRef.current?.(currentPage, currentViewport);
          setTimeout(() => {
            if (svgOverlayRef.current && isSelectionMode) {
              updateMarkupPointerEventsRef.current?.(true);
            }
          }, 100);
        }
      } else if (event.key === 'Control' && (isMeasuring || isCalibrating)) {
        event.preventDefault();
        setIsOrthoSnapping((prev) => !prev);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refs and setter stable; omit
    [
      annotationTool,
      currentAnnotation.length,
      onAnnotationToolChange,
      selectedConditionId,
      isMeasuring,
      isCalibrating,
      calibrationPoints.length,
      currentMeasurement.length,
      selectedMeasurementIds,
      selectedAnnotationIds,
      selectedMarkupIds,
      isSelectionMode,
      currentProjectId,
      file.id,
      currentPage,
      measurementType,
      isContinuousDrawing,
      activePoints.length,
      currentViewport,
      copyMarkupsByIds,
      copiedMarkups,
      addTakeoffMeasurement,
      setCurrentAnnotation,
      setCalibrationPoints,
      setIsCalibrating,
      setMousePosition,
      setCalibrationData,
      setActivePoints,
      setIsMeasuring,
      setRunningLength,
      pageRubberBandRefs,
      setRubberBandElement,
      setCurrentMeasurement,
      setSelectedMarkupIds,
      setLocalAnnotations,
      pdfPageRef,
      setIsOrthoSnapping,
      hyperlinkMode,
      onHyperlinkModeChange,
      setHyperlinkDrawStart,
      setHyperlinkDrawBox,
      cutoutDragStart,
      setCutoutDragStart,
      setCutoutDragBox,
      queueEphemeralPaint,
    ]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Middle-click (scroll wheel) drag-to-pan - uses document listeners so drag continues
  // even when cursor leaves the PDF area. Does not affect left-click mappings.
  const [middleClickPanStart, setMiddleClickPanStart] = useState<{
    clientX: number;
    clientY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  useEffect(() => {
    if (!middleClickPanStart) return;
    const container = containerRef.current;
    if (!container) {
      setMiddleClickPanStart(null);
      return;
    }
    const onMove = (e: MouseEvent) => {
      e.preventDefault();
      const dx = e.clientX - middleClickPanStart.clientX;
      const dy = e.clientY - middleClickPanStart.clientY;
      container.scrollLeft = middleClickPanStart.scrollLeft - dx;
      container.scrollTop = middleClickPanStart.scrollTop - dy;
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        setMiddleClickPanStart(null);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp, { passive: false });
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [middleClickPanStart, containerRef]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
      if (!pdfCanvasRef.current) return;

      // Middle-click (scroll wheel) drag-to-pan - check first, does not affect left-click
      if (event.button === 1) {
        const container = containerRef.current;
        if (container) {
          setMiddleClickPanStart({
            clientX: event.clientX,
            clientY: event.clientY,
            scrollLeft: container.scrollLeft,
            scrollTop: container.scrollTop,
          });
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      const isShapeTool = ['arrow', 'rectangle', 'circle'].includes(annotationTool ?? '');
      const isVisualSearchOrTitleblock = (visualSearchMode || !!titleblockSelectionMode) && isSelectingSymbol;
      const currentSelectedConditionId = useConditionStore.getState().selectedConditionId;

      // Hyperlink mode: start drawing region on left-click
      if (hyperlinkMode && event.button === 0) {
        const coords = getCssCoordsFromEvent(event);
        if (coords) {
          setHyperlinkDrawStart(coords);
          setHyperlinkDrawBox(null);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      if (isSelectionMode && selectedMarkupIds.length > 0) {
        const target = event.target as HTMLElement;
        const measurementId =
          target.getAttribute?.('data-measurement-id') ??
          target.closest?.('[data-measurement-id]')?.getAttribute?.('data-measurement-id') ??
          target.parentElement?.getAttribute?.('data-measurement-id');
        if (measurementId && selectedMarkupIds.includes(measurementId)) {
          const measurement = localTakeoffMeasurements.find((m) => m.id === measurementId);
          if (measurement && measurement.pdfCoordinates?.length > 0) {
            const coords = getCssCoordsFromEvent(event);
            if (coords) {
              setMeasurementMoveId(measurementId);
              setMeasurementMoveIds(selectedMeasurementIds);
              setMeasurementMoveStart(coords);
              setMeasurementMoveOriginalPoints(measurement.pdfCoordinates.map((p) => ({ ...p })));
              setMeasurementMoveDelta(null);
              event.preventDefault();
              event.stopPropagation();
              return;
            }
          }
        }
      }

      if (isSelectionMode && selectedMarkupIds.length > 0) {
        const target = event.target as HTMLElement;
        const annotationId =
          target.getAttribute?.('data-annotation-id') ??
          target.closest?.('[data-annotation-id]')?.getAttribute?.('data-annotation-id') ??
          target.parentElement?.getAttribute?.('data-annotation-id');
        if (annotationId && selectedMarkupIds.includes(annotationId)) {
          const annotation = localAnnotations.find((a) => a.id === annotationId);
          if (annotation && annotation.points.length > 0) {
            const coords = getCssCoordsFromEvent(event);
            if (coords) {
              setAnnotationMoveId(annotationId);
              setAnnotationMoveIds(selectedAnnotationIds);
              setAnnotationMoveStart(coords);
              setAnnotationMoveOriginalPoints(annotation.points.map((p) => ({ ...p })));
              setAnnotationMoveDelta(null);
              event.preventDefault();
              event.stopPropagation();
              return;
            }
          }
        }
      }

      if (
        isMeasuring &&
        !cutoutMode &&
        (measurementType === 'area' || measurementType === 'volume') &&
        currentSelectedConditionId &&
        !annotationTool &&
        !(visualSearchMode || !!titleblockSelectionMode)
      ) {
        const coords = getCssCoordsFromEvent(event);
        if (coords) {
          setMeasurementDragStart(coords);
          setMeasurementDragBox(null);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      if (
        cutoutMode &&
        cutoutTargetConditionId &&
        !annotationTool &&
        !(visualSearchMode || !!titleblockSelectionMode)
      ) {
        const coords = getCssCoordsFromEvent(event);
        if (coords) {
          setCutoutDragStart(coords);
          setCutoutDragBox(null);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      if (isShapeTool && !(visualSearchMode || !!titleblockSelectionMode)) {
        const coords = getCssCoordsFromEvent(event);
        if (coords) {
          setAnnotationDragStart(coords);
          setAnnotationDragBox(null);
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (!isVisualSearchOrTitleblock) return;
      const coords = getCssCoordsFromEvent(event);
      if (!coords) return;
      setSelectionStart(coords);
      setSelectionBox(null);
      event.preventDefault();
      event.stopPropagation();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Ref used for guard only; omit
    [
      annotationTool,
      visualSearchMode,
      titleblockSelectionMode,
      isSelectingSymbol,
      isSelectionMode,
      selectedMarkupIds,
      selectedMeasurementIds,
      selectedAnnotationIds,
      localTakeoffMeasurements,
      measurementType,
      isMeasuring,
      getCssCoordsFromEvent,
      setMeasurementMoveId,
      setMeasurementMoveIds,
      setMeasurementMoveStart,
      setMeasurementMoveOriginalPoints,
      setMeasurementMoveDelta,
      setAnnotationMoveId,
      setAnnotationMoveIds,
      setAnnotationMoveStart,
      setAnnotationMoveOriginalPoints,
      setAnnotationMoveDelta,
      setMeasurementDragStart,
      setMeasurementDragBox,
      cutoutMode,
      cutoutTargetConditionId,
      setCutoutDragStart,
      setCutoutDragBox,
      setAnnotationDragStart,
      setAnnotationDragBox,
      setSelectionStart,
      setSelectionBox,
      localAnnotations,
      hyperlinkMode,
      setHyperlinkDrawStart,
      setHyperlinkDrawBox,
    ]
  );

  const handleMouseUp = useCallback(
    async (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
      if (!pdfCanvasRef.current) return;

      if (hyperlinkMode && hyperlinkDrawStart && event.button === 0) {
        let viewport = currentViewport;
        if (!viewport && pdfPageRef.current) {
          viewport = pdfPageRef.current.getViewport({ scale: viewState.scale, rotation: viewState.rotation });
        }
        if (viewport) {
          const coords = getCssCoordsFromEvent(event);
          if (coords) {
            const width = Math.abs(coords.x - hyperlinkDrawStart.x);
            const height = Math.abs(coords.y - hyperlinkDrawStart.y);
            const x = Math.min(coords.x, hyperlinkDrawStart.x);
            const y = Math.min(coords.y, hyperlinkDrawStart.y);
            if (width >= 3 && height >= 3 && onHyperlinkRegionDrawn) {
              const normRect = {
                x: x / viewport.width,
                y: y / viewport.height,
                width: width / viewport.width,
                height: height / viewport.height,
              };
              onHyperlinkRegionDrawn(normRect, file.id, currentPage);
            }
          }
        }
        setHyperlinkDrawStart(null);
        setHyperlinkDrawBox(null);
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (measurementMoveId && measurementMoveStart && measurementMoveOriginalPoints) {
        let viewport = currentViewport;
        if (!viewport && pdfPageRef.current) {
          viewport = pdfPageRef.current.getViewport({ scale: viewState.scale, rotation: viewState.rotation });
        }
        if (viewport) {
          const coords = getCssCoordsFromEvent(event);
          if (coords) {
            const deltaCssX = coords.x - measurementMoveStart.x;
            const deltaCssY = coords.y - measurementMoveStart.y;
            const deltaPdf = { x: deltaCssX / viewport.width, y: deltaCssY / viewport.height };
            const idsToMove = measurementMoveIds.length > 0 ? measurementMoveIds : [measurementMoveId];
            for (const id of idsToMove) {
              const m = localTakeoffMeasurements.find((meas) => meas.id === id);
              if (m && m.pdfCoordinates?.length) {
                const shifted = shiftTakeoffMeasurementGeometry(m, deltaPdf);
                const previous = {
                  pdfCoordinates: m.pdfCoordinates,
                  points: m.points,
                  ...(m.cutouts != null && { cutouts: m.cutouts }),
                };
                const next = {
                  pdfCoordinates: shifted.pdfCoordinates,
                  points: shifted.points,
                  ...(shifted.cutouts != null && { cutouts: shifted.cutouts }),
                };
                updateTakeoffMeasurement(id, next).then(() => {
                  useUndoStore.getState().push({ type: 'measurement_update', id, previous, next });
                }).catch(() => {});
              }
            }
            setLocalTakeoffMeasurements((prev) =>
              prev.map((m) => {
                if (!idsToMove.includes(m.id) || !m.pdfCoordinates?.length) return m;
                return { ...m, ...shiftTakeoffMeasurementGeometry(m, deltaPdf) };
              })
            );
            measurementMoveJustCompletedRef.current = true;
            event.preventDefault();
            event.stopPropagation();
          }
        }
        setMeasurementMoveId(null);
        setMeasurementMoveIds([]);
        setMeasurementMoveStart(null);
        setMeasurementMoveOriginalPoints(null);
        setMeasurementMoveDelta(null);
        return;
      }

      if (
        measurementDragStart &&
        !cutoutMode &&
        (measurementType === 'area' || measurementType === 'volume')
      ) {
        let viewport = currentViewport;
        if (!viewport && pdfPageRef.current) {
          viewport = pdfPageRef.current.getViewport({ scale: viewState.scale, rotation: viewState.rotation });
        }
        if (viewport) {
          const coords = getCssCoordsFromEvent(event);
          if (coords) {
            const width = Math.abs(coords.x - measurementDragStart.x);
            const height = Math.abs(coords.y - measurementDragStart.y);
            const x = Math.min(coords.x, measurementDragStart.x);
            const y = Math.min(coords.y, measurementDragStart.y);
            if (width >= MIN_DRAG_RECT_PX && height >= MIN_DRAG_RECT_PX) {
              completeMeasurementRef.current(cssDragRectToPdfQuad(viewport, x, y, width, height));
              measurementDragJustCompletedRef.current = true;
              event.preventDefault();
              event.stopPropagation();
            }
          }
        }
        setMeasurementDragStart(null);
        setMeasurementDragBox(null);
        return;
      }

      if (cutoutDragStart && cutoutTargetConditionId) {
        let viewport = currentViewport;
        if (!viewport && pdfPageRef.current) {
          viewport = pdfPageRef.current.getViewport({ scale: viewState.scale, rotation: viewState.rotation });
        }
        if (viewport) {
          const coords = getCssCoordsFromEvent(event);
          if (coords) {
            const width = Math.abs(coords.x - cutoutDragStart.x);
            const height = Math.abs(coords.y - cutoutDragStart.y);
            const x = Math.min(coords.x, cutoutDragStart.x);
            const y = Math.min(coords.y, cutoutDragStart.y);
            if (width >= MIN_DRAG_RECT_PX && height >= MIN_DRAG_RECT_PX) {
              void completeCutoutRef.current?.(cssDragRectToPdfQuad(viewport, x, y, width, height));
              cutoutDragJustCompletedRef.current = true;
              event.preventDefault();
              event.stopPropagation();
            }
          }
        }
        setCutoutDragStart(null);
        setCutoutDragBox(null);
        return;
      }

      if (annotationMoveId && annotationMoveStart && annotationMoveOriginalPoints) {
        let viewport = currentViewport;
        if (!viewport && pdfPageRef.current) {
          viewport = pdfPageRef.current.getViewport({ scale: viewState.scale, rotation: viewState.rotation });
        }
        if (viewport) {
          const coords = getCssCoordsFromEvent(event);
          if (!coords) {
            setAnnotationMoveId(null);
            setAnnotationMoveIds([]);
            setAnnotationMoveStart(null);
            setAnnotationMoveOriginalPoints(null);
            setAnnotationMoveDelta(null);
            return;
          }
          const deltaCssX = coords.x - annotationMoveStart.x;
          const deltaCssY = coords.y - annotationMoveStart.y;
          const deltaPdf = { x: deltaCssX / viewport.width, y: deltaCssY / viewport.height };
          const idsToMove = annotationMoveIds.length > 0 ? annotationMoveIds : [annotationMoveId];
          for (const id of idsToMove) {
            const a = localAnnotations.find((ann) => ann.id === id);
            if (a && a.points.length) {
              const newPoints = a.points.map((p) => ({
                x: p.x + deltaPdf.x,
                y: p.y + deltaPdf.y,
              }));
              updateAnnotation(id, { points: newPoints });
              useUndoStore.getState().push({
                type: 'annotation_update',
                id,
                previous: { points: a.points },
                next: { points: newPoints },
              });
            }
          }
          setLocalAnnotations((prev) =>
            prev.map((a) => {
              if (!idsToMove.includes(a.id) || !a.points.length) return a;
              const newPoints = a.points.map((p) => ({
                x: p.x + deltaPdf.x,
                y: p.y + deltaPdf.y,
              }));
              return { ...a, points: newPoints };
            })
          );
          annotationMoveJustCompletedRef.current = true;
          event.preventDefault();
          event.stopPropagation();
        }
        setAnnotationMoveId(null);
        setAnnotationMoveIds([]);
        setAnnotationMoveStart(null);
        setAnnotationMoveOriginalPoints(null);
        setAnnotationMoveDelta(null);
        return;
      }

      if (annotationDragStart && ['arrow', 'rectangle', 'circle'].includes(annotationTool ?? '')) {
        let viewport = currentViewport;
        if (!viewport && pdfPageRef.current) {
          viewport = pdfPageRef.current.getViewport({ scale: viewState.scale, rotation: viewState.rotation });
        }
        if (viewport) {
          const coords = getCssCoordsFromEvent(event);
          if (!coords) {
            setAnnotationDragStart(null);
            setAnnotationDragBox(null);
            return;
          }
          const width = Math.abs(coords.x - annotationDragStart.x);
          const height = Math.abs(coords.y - annotationDragStart.y);
          const x = Math.min(coords.x, annotationDragStart.x);
          const y = Math.min(coords.y, annotationDragStart.y);
          if (width >= 5 || height >= 5) {
            const p1 =
              annotationTool === 'arrow'
                ? { x: annotationDragStart.x / viewport.width, y: annotationDragStart.y / viewport.height }
                : { x: x / viewport.width, y: y / viewport.height };
            const p2 =
              annotationTool === 'arrow'
                ? { x: coords.x / viewport.width, y: coords.y / viewport.height }
                : { x: (x + width) / viewport.width, y: (y + height) / viewport.height };
            if (currentProjectId && file.id) {
              const created = addAnnotation({
                projectId: currentProjectId,
                sheetId: file.id,
                type: annotationTool as 'arrow' | 'rectangle' | 'circle',
                points: [p1, p2],
                color: annotationColor,
                pageNumber: currentPage,
              });
              useUndoStore.getState().push({ type: 'annotation_add', id: created.id, annotation: created });
              setLocalAnnotations((prev) => [...prev, created]);
            }
            setCurrentAnnotation([]);
            onAnnotationToolChange?.(null);
            annotationDragJustCompletedRef.current = true;
            event.preventDefault();
            event.stopPropagation();
          }
        }
        setAnnotationDragStart(null);
        setAnnotationDragBox(null);
        return;
      }

      if (!(visualSearchMode || !!titleblockSelectionMode) || !isSelectingSymbol || !selectionStart) {
        return;
      }
      let viewport = currentViewport;
      if (!viewport && pdfPageRef.current) {
        viewport = pdfPageRef.current.getViewport({
          scale: viewState.scale,
          rotation: viewState.rotation,
        });
      }
      if (!viewport) {
        setSelectionStart(null);
        setSelectionBox(null);
        return;
      }
      const coords = getCssCoordsFromEvent(event);
      if (!coords) return;
      const width = Math.abs(coords.x - selectionStart.x);
      const height = Math.abs(coords.y - selectionStart.y);
      const x = Math.min(coords.x, selectionStart.x);
      const y = Math.min(coords.y, selectionStart.y);
      if (width < 5 && height < 5) {
        setSelectionStart(null);
        setSelectionBox(null);
        return;
      }
      const finalSelectionBox = { x, y, width, height };
      setSelectionBox(finalSelectionBox);
      let pdfSelectionBox = {
        x: x / viewport.width,
        y: y / viewport.height,
        width: width / viewport.width,
        height: height / viewport.height,
      };
      // Transform from rotated viewport space to native page space for server extraction
      const rotation = viewState.rotation || 0;
      if (rotation !== 0) {
        pdfSelectionBox = transformSelectionRectToNative(pdfSelectionBox, rotation);
      }
      setSelectionStart(null);
      setIsSelectingSymbol(false);
      if (titleblockSelectionMode && onTitleblockSelectionComplete) {
        onTitleblockSelectionComplete(titleblockSelectionMode, pdfSelectionBox, currentPage);
      } else if (visualSearchMode && onVisualSearchComplete) {
        onVisualSearchComplete(pdfSelectionBox);
      }
      event.preventDefault();
      event.stopPropagation();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refs and setter stable; omit
    [
      measurementMoveId,
      measurementMoveIds,
      measurementMoveStart,
      measurementMoveOriginalPoints,
      measurementDragStart,
      cutoutDragStart,
      cutoutTargetConditionId,
      cutoutMode,
      measurementType,
      currentViewport,
      viewState,
      updateTakeoffMeasurement,
      setLocalTakeoffMeasurements,
      localTakeoffMeasurements,
      annotationMoveId,
      annotationMoveIds,
      annotationMoveStart,
      annotationMoveOriginalPoints,
      updateAnnotation,
      localAnnotations,
      annotationDragStart,
      annotationTool,
      addAnnotation,
      annotationColor,
      currentPage,
      currentProjectId,
      file.id,
      getCssCoordsFromEvent,
      onAnnotationToolChange,
      visualSearchMode,
      titleblockSelectionMode,
      isSelectingSymbol,
      selectionStart,
      onTitleblockSelectionComplete,
      onVisualSearchComplete,
      setMeasurementMoveId,
      setMeasurementMoveIds,
      setMeasurementMoveStart,
      setMeasurementMoveOriginalPoints,
      setMeasurementMoveDelta,
      setMeasurementDragStart,
      setMeasurementDragBox,
      setCutoutDragStart,
      setCutoutDragBox,
      completeCutoutRef,
      setAnnotationMoveId,
      setAnnotationMoveIds,
      setAnnotationMoveStart,
      setAnnotationMoveOriginalPoints,
      setAnnotationMoveDelta,
      setAnnotationDragStart,
      setAnnotationDragBox,
      setCurrentAnnotation,
      setSelectionStart,
      setSelectionBox,
      setIsSelectingSymbol,
      pdfPageRef,
      hyperlinkMode,
      hyperlinkDrawStart,
      onHyperlinkRegionDrawn,
      setHyperlinkDrawStart,
      setHyperlinkDrawBox,
    ]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
      if (!pdfCanvasRef.current) return;
      let viewport = currentViewport;
      if (!viewport && pdfPageRef.current) {
        const newViewport = pdfPageRef.current.getViewport({
          scale: lastRenderedScaleRef.current || viewState.scale,
          rotation: viewState.rotation,
        });
        viewport = newViewport;
        setPageViewports((prev) => ({ ...prev, [currentPage]: newViewport }));
      }
      if (!viewport) return;

      // CRITICAL: When interactive zoom is active (CSS transforms providing visual zoom),
      // the interactiveScale compensation converts screen coords to old-viewport pixel space.
      // We MUST use a viewport at lastRenderedScale for normalization so the division gives
      // correct 0-1 coordinates. Without this, zooming mid-draw produces misplaced markups.
      const mmInteractiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
      if (Math.abs(mmInteractiveScale - 1) > 0.0001 && pdfPageRef.current) {
        viewport = pdfPageRef.current.getViewport({
          scale: lastRenderedScaleRef.current,
          rotation: viewState.rotation,
        });
      }

      if (isDeselecting) setIsDeselecting(false);
      if (hyperlinkMode && hyperlinkDrawStart) {
        const coords = getCssCoordsFromEvent(event);
        if (coords && viewport) {
          const width = Math.abs(coords.x - hyperlinkDrawStart.x);
          const height = Math.abs(coords.y - hyperlinkDrawStart.y);
          const x = Math.min(coords.x, hyperlinkDrawStart.x);
          const y = Math.min(coords.y, hyperlinkDrawStart.y);
          setHyperlinkDrawBox({ x, y, width, height });
        }
        return;
      }
      if (measurementMoveId && measurementMoveStart && viewport) {
        const coords = getCssCoordsFromEvent(event);
        if (coords) {
          setMeasurementMoveDelta({
            x: (coords.x - measurementMoveStart.x) / viewport.width,
            y: (coords.y - measurementMoveStart.y) / viewport.height,
          });
        }
        return;
      }
      if (cutoutDragStart && viewport) {
        const coords = getCssCoordsFromEvent(event);
        if (coords) {
          const width = Math.abs(coords.x - cutoutDragStart.x);
          const height = Math.abs(coords.y - cutoutDragStart.y);
          const x = Math.min(coords.x, cutoutDragStart.x);
          const y = Math.min(coords.y, cutoutDragStart.y);
          setCutoutDragBox({ x, y, width, height });
          setMousePosition({
            x: coords.x / viewport.width,
            y: coords.y / viewport.height,
          });
          queueEphemeralPaint();
        }
        return;
      }
      if (
        measurementDragStart &&
        !cutoutMode &&
        (measurementType === 'area' || measurementType === 'volume')
      ) {
        const coords = getCssCoordsFromEvent(event);
        if (coords) {
          const width = Math.abs(coords.x - measurementDragStart.x);
          const height = Math.abs(coords.y - measurementDragStart.y);
          const x = Math.min(coords.x, measurementDragStart.x);
          const y = Math.min(coords.y, measurementDragStart.y);
          setMeasurementDragBox({ x, y, width, height });
        }
        return;
      }
      if (annotationMoveId && annotationMoveStart && viewport) {
        const coords = getCssCoordsFromEvent(event);
        if (coords) {
          setAnnotationMoveDelta({
            x: (coords.x - annotationMoveStart.x) / viewport.width,
            y: (coords.y - annotationMoveStart.y) / viewport.height,
          });
        }
        return;
      }
      if (annotationDragStart && ['arrow', 'rectangle', 'circle'].includes(annotationTool ?? '')) {
        const coords = getCssCoordsFromEvent(event);
        if (coords) {
          const width = Math.abs(coords.x - annotationDragStart.x);
          const height = Math.abs(coords.y - annotationDragStart.y);
          const x = Math.min(coords.x, annotationDragStart.x);
          const y = Math.min(coords.y, annotationDragStart.y);
          setAnnotationDragBox({ x, y, width, height });
        }
        return;
      }
      if ((visualSearchMode || !!titleblockSelectionMode) && isSelectingSymbol && selectionStart) {
        if (!pdfCanvasRef.current) return;
        const rect = pdfCanvasRef.current.getBoundingClientRect();
        let cssX = event.clientX - rect.left;
        let cssY = event.clientY - rect.top;
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
      if (isCalibrating) {
        if (!pdfCanvasRef.current || !currentViewport) return;
        const rect = pdfCanvasRef.current.getBoundingClientRect();
        let cssX = event.clientX - rect.left;
        let cssY = event.clientY - rect.top;
        const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
        if (Math.abs(interactiveScale - 1) > 0.0001) {
          cssX = cssX / interactiveScale;
          cssY = cssY / interactiveScale;
        }
        let pdfCoords = {
          x: cssX / viewport.width,
          y: cssY / viewport.height,
        };
        if (calibrationPoints.length > 0 && isOrthoSnapping) {
          pdfCoords = applyOrthoSnapping(pdfCoords, calibrationPoints);
        }
        setMousePosition(pdfCoords);
        queueEphemeralPaint();
        return;
      }
      if (annotationTool) {
        if (!pdfCanvasRef.current) return;
        const rect = pdfCanvasRef.current.getBoundingClientRect();
        const cssX = event.clientX - rect.left;
        const cssY = event.clientY - rect.top;
        const pdfCoords = {
          x: cssX / viewport.width,
          y: cssY / viewport.height,
        };
        setMousePosition(pdfCoords);
        queueEphemeralPaint();
        return;
      }
      if (!isMeasuring || !selectedConditionId) {
        if (mousePositionRef.current) {
          setMousePosition(null);
          queueEphemeralPaint();
        }
        return;
      }
      if (!pdfCanvasRef.current) return;
      const rect = pdfCanvasRef.current.getBoundingClientRect();
      let cssX = event.clientX - rect.left;
      let cssY = event.clientY - rect.top;
      const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
      if (Math.abs(interactiveScale - 1) > 0.0001) {
        cssX = cssX / interactiveScale;
        cssY = cssY / interactiveScale;
      }
      let pdfCoords = {
        x: cssX / viewport.width,
        y: cssY / viewport.height,
      };
      if (isOrthoSnapping) {
        const referencePoints = cutoutMode ? currentCutout : isContinuousDrawing ? activePoints : currentMeasurement;
        pdfCoords = applyOrthoSnapping(pdfCoords, referencePoints);
      }
      setMousePosition(pdfCoords);
      if (isContinuousDrawing && activePoints.length > 0) {
        const newLength = calculateRunningLength(activePoints, pdfCoords);
        setRunningLength(newLength);
        const refs = pageRubberBandRefs.current;
        if (svgOverlayRef.current && refs) {
          const currentRubberBand = refs[currentPage];
          if (
            currentRubberBand &&
            svgOverlayRef.current.contains(currentRubberBand) &&
            currentViewport
          ) {
            const lastPoint = activePoints[activePoints.length - 1];
            const lastPointPixels = {
              x: lastPoint.x * currentViewport.width,
              y: lastPoint.y * currentViewport.height,
            };
            const currentPointPixels = {
              x: pdfCoords.x * currentViewport.width,
              y: pdfCoords.y * currentViewport.height,
            };
            currentRubberBand.setAttribute('x1', lastPointPixels.x.toString());
            currentRubberBand.setAttribute('y1', lastPointPixels.y.toString());
            currentRubberBand.setAttribute('x2', currentPointPixels.x.toString());
            currentRubberBand.setAttribute('y2', currentPointPixels.y.toString());
          }
        }
      }
      queueEphemeralPaint();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pdfCanvasRef omit; added isOrthoSnapping, cutoutMode, currentCutout
    [
      annotationTool,
      annotationDragStart,
      annotationMoveId,
      annotationMoveStart,
      measurementMoveId,
      measurementMoveStart,
      measurementDragStart,
      cutoutDragStart,
      measurementType,
      isCalibrating,
      calibrationPoints,
      isMeasuring,
      isOrthoSnapping,
      selectedConditionId,
      mousePositionRef,
      isContinuousDrawing,
      activePoints,
      currentViewport,
      calculateRunningLength,
      isDeselecting,
      visualSearchMode,
      titleblockSelectionMode,
      isSelectingSymbol,
      selectionStart,
      viewState,
      setPageViewports,
      getCssCoordsFromEvent,
      currentPage,
      pdfPageRef,
      setMeasurementMoveDelta,
      setMeasurementDragBox,
      setCutoutDragBox,
      setAnnotationMoveDelta,
      setAnnotationDragBox,
      setSelectionBox,
      setMousePosition,
      setRunningLength,
      applyOrthoSnapping,
      lastRenderedScaleRef,
      svgOverlayRef,
      pageRubberBandRefs,
      currentMeasurement,
      setIsDeselecting,
      cutoutMode,
      currentCutout,
      hyperlinkMode,
      hyperlinkDrawStart,
      setHyperlinkDrawBox,
      queueEphemeralPaint,
    ]
  );

  const handleClick = useCallback(
    async (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
      if (!pdfCanvasRef.current) return;
      let viewport = currentViewport;
      if (!viewport && pdfPageRef.current) {
        const newViewport = pdfPageRef.current.getViewport({
          scale: lastRenderedScaleRef.current || viewState.scale,
          rotation: viewState.rotation,
        });
        viewport = newViewport;
        setPageViewports((prev) => ({ ...prev, [currentPage]: newViewport }));
      } else if (!viewport && pdfDocument) {
        try {
          const page = await (pdfDocument as { getPage: (n: number) => Promise<PDFPageProxy> }).getPage(currentPage);
          (pdfPageRef as MutableRefObject<PDFPageProxy | null>).current = page;
          const newViewport = page.getViewport({
            scale: lastRenderedScaleRef.current || viewState.scale,
            rotation: viewState.rotation,
          });
          viewport = newViewport;
          setPageViewports((prev) => ({ ...prev, [currentPage]: newViewport }));
        } catch (err) {
          console.error('Failed to load PDF page for click handler:', err);
          return;
        }
      }
      if (!viewport) return;
      if (isDeselecting) setIsDeselecting(false);

      // Hyperlink click: navigate to target sheet
      const targetEl = (event.target as Element)?.closest?.('[data-hyperlink-id]');
      if (targetEl && onHyperlinkClick) {
        const sheetId = targetEl.getAttribute('data-target-sheet');
        const pageStr = targetEl.getAttribute('data-target-page');
        if (sheetId && pageStr) {
          const pageNumber = parseInt(pageStr, 10);
          if (!Number.isNaN(pageNumber)) {
            event.preventDefault();
            event.stopPropagation();
            onHyperlinkClick(sheetId, pageNumber);
            return;
          }
        }
      }
      const rect = pdfCanvasRef.current.getBoundingClientRect();
      let cssX = event.clientX - rect.left;
      let cssY = event.clientY - rect.top;
      const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);

      // CRITICAL: When interactive zoom is active, override viewport to one at lastRenderedScale.
      // The interactiveScale compensation above converts screen coords to old-viewport pixel space,
      // so we MUST normalize by old viewport dimensions to get correct 0-1 coordinates.
      if (Math.abs(interactiveScale - 1) > 0.0001 && pdfPageRef.current) {
        viewport = pdfPageRef.current.getViewport({
          scale: lastRenderedScaleRef.current,
          rotation: viewState.rotation,
        });
      }
      if (Math.abs(interactiveScale - 1) > 0.0001) {
        cssX = cssX / interactiveScale;
        cssY = cssY / interactiveScale;
      }
      const currentSelectedConditionId = useConditionStore.getState().selectedConditionId;
      let effectiveMeasurementType = measurementType;
      let enteredDrawFromCanvasMatch = false;
      if (visualSearchMode || !!titleblockSelectionMode) {
        if (isSelectingSymbol) return;
        if (visualSearchMode) return;
      }
      if (isSelectionMode && selectedMarkupIds.length > 0 && !isMeasuring && !isCalibrating && !annotationTool) {
        if (canvasSelectionMatchesCondition) {
          // Plan-only selection matched the sidebar condition — enter draw mode and keep this click
          // as the first vertex (otherwise we'd clear the condition and block new markups).
          enteredDrawFromCanvasMatch = true;
          setSelectedMarkupIds([]);
          setIsMeasuring(true);
          setIsSelectionMode(false);
          syncMeasurementTypeFromSelectedCondition();
          const drawCond = useConditionStore.getState().getSelectedCondition();
          if (drawCond && drawCond.type !== 'auto-count') {
            effectiveMeasurementType = measurementDrawModeForCondition(drawCond);
          }
        } else {
          setSelectedMarkupIds([]);
          clearCanvasConditionSelection();
          return;
        }
      }
      if (isCalibrating) {
        setCalibrationPoints((prev) => {
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
          let pdfCoords = { x: baseX / baseViewport.width, y: baseY / baseViewport.height };
          if (prev.length > 0 && isOrthoSnapping) {
            pdfCoords = mousePositionRef.current
              ? mousePositionRef.current
              : applyOrthoSnapping(pdfCoords, prev);
          }
          const newPoints = [...prev, pdfCoords];
          if (newPoints.length === 2) completeCalibration(newPoints);
          return newPoints;
        });
        return;
      }
      if (cutoutMode && cutoutTargetConditionId) {
        if (cutoutDragJustCompletedRef.current) {
          cutoutDragJustCompletedRef.current = false;
          return;
        }
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
        let pdfCoords = { x: baseX / baseViewport.width, y: baseY / baseViewport.height };
        // Apply ortho snapping to cutout points (use snapped mouse position when available)
        if (isOrthoSnapping && mousePositionRef.current) {
          pdfCoords = mousePositionRef.current;
        } else if (isOrthoSnapping) {
          pdfCoords = applyOrthoSnapping(pdfCoords, currentCutout);
        }
        setCurrentCutout((prev) => [...prev, pdfCoords]);
        return;
      }
      if (annotationTool) {
        if (annotationDragJustCompletedRef.current) {
          annotationDragJustCompletedRef.current = false;
          return;
        }
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
        const pdfCoords = { x: baseX / baseViewport.width, y: baseY / baseViewport.height };
        if (annotationTool === 'text') {
          setTextInputPosition({ x: cssX, y: cssY });
          setShowTextInput(true);
          setCurrentAnnotation([pdfCoords]);
          return;
        }
        if (['arrow', 'rectangle', 'circle'].includes(annotationTool)) {
          const newPoints = [...currentAnnotation, pdfCoords];
          setCurrentAnnotation(newPoints);
          if (newPoints.length === 2 && currentProjectId && file.id) {
            const created = addAnnotation({
              projectId: currentProjectId,
              sheetId: file.id,
              type: annotationTool,
              points: newPoints,
              color: annotationColor,
              pageNumber: currentPage,
            });
            useUndoStore.getState().push({ type: 'annotation_add', id: created.id, annotation: created });
            setLocalAnnotations((prev) => [...prev, created]);
            setCurrentAnnotation([]);
            onAnnotationToolChange?.(null);
          }
          return;
        }
      }
      if (!currentSelectedConditionId && !isSelectionMode) return;
      if (isSelectionMode && !currentSelectedConditionId) return;
      // Sidebar-highlighted condition only: blank click deselects (no draw) until Space toggles draw mode.
      // Use refs so we don't treat stale isMeasuring from a pre-layout closure as "draw mode".
      if (
        isSelectionModeRef.current &&
        currentSelectedConditionId &&
        !isMeasuringRef.current &&
        !isCalibrating &&
        !annotationTool &&
        selectedMarkupIds.length === 0 &&
        !titleblockSelectionMode
      ) {
        clearCanvasConditionSelection();
        return;
      }
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
      let pdfCoords = { x: baseX / baseViewport.width, y: baseY / baseViewport.height };
      if (isOrthoSnapping && (isMeasuring || enteredDrawFromCanvasMatch) && mousePositionRef.current) {
        pdfCoords = mousePositionRef.current;
      } else if (isOrthoSnapping) {
        const referencePoints = cutoutMode ? currentCutout : isContinuousDrawing ? activePoints : currentMeasurement;
        pdfCoords = applyOrthoSnapping(pdfCoords, referencePoints);
      }
      if (effectiveMeasurementType === 'linear') {
        if (!isContinuousDrawing) {
          setIsContinuousDrawing(true);
          setActivePoints([pdfCoords]);
          createRubberBandElementRef.current?.();
        } else {
          setActivePoints((prev) => {
            const newPoints = [...prev, pdfCoords];
            const newLength = calculateRunningLength(newPoints);
            setRunningLength(newLength);
            return newPoints;
          });
        }
      } else {
        setCurrentMeasurement((prev) => [...prev, pdfCoords]);
        if (effectiveMeasurementType === 'count') completeMeasurementRef.current?.([pdfCoords]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refs and setter stable; omit
    [
      isCalibrating,
      calibrationPoints,
      measurementType,
      currentMeasurement,
      isContinuousDrawing,
      activePoints,
      calculateRunningLength,
      currentViewport,
      isSelectionMode,
      selectedMarkupIds,
      canvasSelectionMatchesCondition,
      setIsMeasuring,
      setIsSelectionMode,
      syncMeasurementTypeFromSelectedCondition,
      isOrthoSnapping,
      isMeasuring,
      mousePositionRef,
      cutoutMode,
      cutoutTargetConditionId,
      currentCutout,
      isDeselecting,
      visualSearchMode,
      titleblockSelectionMode,
      isSelectingSymbol,
      annotationTool,
      currentAnnotation,
      currentProjectId,
      file,
      currentPage,
      addAnnotation,
      annotationColor,
      onAnnotationToolChange,
      viewState,
      setPageViewports,
      pdfDocument,
      setCalibrationPoints,
      completeCalibration,
      setCurrentCutout,
      setTextInputPosition,
      setShowTextInput,
      setCurrentAnnotation,
      createRubberBandElementRef,
      setActivePoints,
      setIsContinuousDrawing,
      setRunningLength,
      setCurrentMeasurement,
      completeMeasurementRef,
      setSelectedMarkupIds,
      applyOrthoSnapping,
      lastRenderedScaleRef,
      annotationDragJustCompletedRef,
    ]
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const ap = activePointsRef.current;
      const cm = currentMeasurementRef.current;
      const icd = isContinuousDrawingRef.current;

      if (cutoutMode && cutoutTargetConditionId && currentCutout.length >= 3) {
        completeCutoutRef.current?.(currentCutout);
        return;
      }
      if (isMeasuring) {
        // Refs hold the latest points — React state in this closure can still be one click behind
        // when the 2nd click of a double-click updates state and dblclick fires in the same gesture.
        if (icd && ap.length >= 2) {
          completeContinuousLinearMeasurementRef.current?.();
          return;
        }
        if (measurementType === 'linear' && !icd && cm.length >= 2) {
          completeMeasurementRef.current?.(cm);
          return;
        }
        if ((measurementType === 'area' || measurementType === 'volume') && cm.length >= 3) {
          completeMeasurementRef.current?.(cm);
          return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Completion callbacks via refs; omit
    [
      measurementType,
      cutoutMode,
      cutoutTargetConditionId,
      currentCutout,
      isMeasuring,
    ]
  );

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
      const targetEl = (e.target as Element)?.closest?.('[data-hyperlink-id]');
      if (targetEl && onHyperlinkClick) {
        const sheetId = targetEl.getAttribute('data-target-sheet');
        const pageStr = targetEl.getAttribute('data-target-page');
        if (sheetId && pageStr) {
          const pageNumber = parseInt(pageStr, 10);
          if (!Number.isNaN(pageNumber)) {
            e.preventDefault();
            e.stopPropagation();
            onHyperlinkClick(sheetId, pageNumber);
            return;
          }
        }
      }
      if (annotationMoveJustCompletedRef.current) {
        annotationMoveJustCompletedRef.current = false;
        e.stopPropagation();
        return;
      }
      if (measurementMoveJustCompletedRef.current) {
        measurementMoveJustCompletedRef.current = false;
        e.stopPropagation();
        return;
      }
      if (measurementDragJustCompletedRef.current) {
        measurementDragJustCompletedRef.current = false;
        e.stopPropagation();
        return;
      }
      if (cutoutDragJustCompletedRef.current) {
        cutoutDragJustCompletedRef.current = false;
        e.stopPropagation();
        return;
      }
      const currentIsSelectionMode = isSelectionModeRef.current;
      if (
        currentIsSelectionMode ||
        isCalibrating ||
        annotationTool ||
        isMeasuring ||
        cutoutMode ||
        (visualSearchMode && isSelectingSymbol) ||
        (!!titleblockSelectionMode && isSelectingSymbol)
      ) {
        const target = e.target as SVGElement;
        let annotationId: string | null = null;
        let measurementId: string | null = null;
        if (target.hasAttribute('data-annotation-id')) {
          annotationId = target.getAttribute('data-annotation-id');
        } else {
          const annotationParent = target.closest('[data-annotation-id]');
          if (annotationParent) annotationId = annotationParent.getAttribute('data-annotation-id');
          else if (target.parentElement?.hasAttribute('data-annotation-id'))
            annotationId = target.parentElement.getAttribute('data-annotation-id');
        }
        if (target.hasAttribute('data-measurement-id')) {
          measurementId = target.getAttribute('data-measurement-id');
        } else {
          const measurementParent = target.closest('[data-measurement-id]');
          if (measurementParent) measurementId = measurementParent.getAttribute('data-measurement-id');
          else {
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
        // Label <text> nodes sit on top of shapes but often had no data-measurement-id; target is then
        // plain text with no ancestor carrying the id. Resolve from hit-test stack instead.
        if (
          !measurementId &&
          !annotationId &&
          currentIsSelectionMode &&
          svgOverlayRef.current
        ) {
          const { measurementIdsInOrder, annotationIdsInOrder } = getMarkupIdsFromElementsFromPoint(
            svgOverlayRef.current,
            e.clientX,
            e.clientY
          );
          if (measurementIdsInOrder.length > 0) {
            measurementId = measurementIdsInOrder[0];
          } else if (annotationIdsInOrder.length > 0) {
            annotationId = annotationIdsInOrder[0];
          }
        }
        if ((annotationId || measurementId) && currentIsSelectionMode) {
          e.stopPropagation();
          const meta = e.metaKey || e.ctrlKey;

          const id = annotationId ?? measurementId ?? '';
          const prev = selectedMarkupIds;
          const next = meta
            ? prev.includes(id)
              ? prev.filter((x) => x !== id)
              : [...prev, id]
            : prev.includes(id) && prev.length === 1
              ? []
              : [id];
          setSelectedMarkupIds(next);
          if (next.length === 0) {
            clearCanvasConditionSelection();
          } else if (
            !titleblockSelectionMode &&
            !meta &&
            measurementId &&
            !annotationId &&
            next.length === 1
          ) {
            syncStoreConditionFromMeasurementId(
              measurementId,
              localTakeoffMeasurements,
              currentProjectId,
              file.id,
              currentPage,
              getPageTakeoffMeasurements
            );
          }
          return;
        }
        e.stopPropagation();
        handleClick(e as React.MouseEvent<HTMLCanvasElement | SVGSVGElement>);
      } else {
        // If every OR above was false, SVG onClick used to do nothing while the canvas path still
        // called handleClick — drawing broke whenever the overlay (not the canvas) received the click.
        e.stopPropagation();
        handleClick(e as React.MouseEvent<HTMLCanvasElement | SVGSVGElement>);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Refs for completion/selection state; omit
    [
      isCalibrating,
      annotationTool,
      isMeasuring,
      cutoutMode,
      visualSearchMode,
      isSelectingSymbol,
      titleblockSelectionMode,
      selectedMarkupIds,
      setSelectedMarkupIds,
      handleClick,
      onHyperlinkClick,
      localTakeoffMeasurements,
      currentPage,
      getPageTakeoffMeasurements,
      currentProjectId,
      file,
    ]
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

  return {
    getCssCoordsFromEvent,
    handleWheel,
    handleKeyDown,
    handleMouseDown,
    handleMouseUp,
    handleMouseMove,
    handleClick,
    handleDoubleClick,
    handleCanvasDoubleClick,
    handleSvgClick,
    handleSvgDoubleClick,
  };
}
