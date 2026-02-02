/**
 * Hook that provides PDFViewer mouse/keyboard event handlers.
 * Accepts context from PDFViewer so handlers don't close over all state inline.
 */
import { useCallback, useEffect } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { useAnnotationStore } from '../../store/slices/annotationSlice';
import { useConditionStore } from '../../store/slices/conditionSlice';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import { useUndoStore } from '../../store/slices/undoSlice';

const PASTE_OFFSET = 0.02;

/** Max zoom scale to avoid slow/frozen PDF (canvas size = viewport × devicePixelRatio; ~265%+ becomes very heavy). */
export const PDF_VIEWER_MAX_SCALE = 2.5;

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
  isSelectionMode: boolean;
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
    selectionBox: { x: number; y: number; width: number; height: number }
  ) => void;
  onVisualSearchComplete?: (selectionBox: { x: number; y: number; width: number; height: number }) => void;
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
  annotationDragJustCompletedRef: MutableRefObject<boolean>;
  isSelectionModeRef: MutableRefObject<boolean>;
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
  mousePosition: { x: number; y: number } | null;
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
  } = options;

  const copyMarkupsByIds = useMeasurementStore((s) => s.copyMarkupsByIds);
  const copiedMarkups = useMeasurementStore((s) => s.copiedMarkups);
  const addTakeoffMeasurement = useMeasurementStore((s) => s.addTakeoffMeasurement);
  const getSelectedCondition = useConditionStore((s) => s.getSelectedCondition);
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
        const MIN_SCALE = 0.5;

        const zoomFactor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const newScale = Math.min(
          PDF_VIEWER_MAX_SCALE,
          Math.max(MIN_SCALE, viewState.scale * zoomFactor)
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
          // Pass newScale so transform uses it immediately (viewState not updated yet)
          requestAnimationFrame(() => {
            applyInteractiveZoomTransforms(newScale);
          });
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
      setPageViewports,
      setInternalViewState,
      lastRenderedScaleRef,
      containerRef,
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
                setCalibrationData(null);
              }
              return newPoints;
            });
          } else {
            setIsCalibrating(false);
            setMousePosition(null);
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
              setIsContinuousDrawing(false);
              setRunningLength(0);
              const refs = pageRubberBandRefs.current;
              if (refs) {
                const currentRubberBand = refs[currentPage];
                if (
                  currentRubberBand &&
                  svgOverlayRef.current &&
                  currentRubberBand.parentNode === svgOverlayRef.current
                ) {
                  svgOverlayRef.current.removeChild(currentRubberBand);
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
            }
            return newMeasurement;
          });
        }
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
    [
      annotationTool,
      currentAnnotation.length,
      onAnnotationToolChange,
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
    ]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
      if (!pdfCanvasRef.current) return;
      const isShapeTool = ['arrow', 'rectangle', 'circle'].includes(annotationTool ?? '');
      const isVisualSearchOrTitleblock = (visualSearchMode || !!titleblockSelectionMode) && isSelectingSymbol;
      const currentSelectedConditionId = useConditionStore.getState().selectedConditionId;

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
      setAnnotationDragStart,
      setAnnotationDragBox,
      setSelectionStart,
      setSelectionBox,
      localAnnotations,
    ]
  );

  const handleMouseUp = useCallback(
    async (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
      if (!pdfCanvasRef.current) return;

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
                const newPoints = m.pdfCoordinates.map((p) => ({
                  x: p.x + deltaPdf.x,
                  y: p.y + deltaPdf.y,
                }));
                const previous = { pdfCoordinates: m.pdfCoordinates, points: m.points };
                const next = { pdfCoordinates: newPoints, points: newPoints };
                updateTakeoffMeasurement(id, next).then(() => {
                  useUndoStore.getState().push({ type: 'measurement_update', id, previous, next });
                }).catch(() => {});
              }
            }
            setLocalTakeoffMeasurements((prev) =>
              prev.map((m) => {
                if (!idsToMove.includes(m.id) || !m.pdfCoordinates?.length) return m;
                const newPoints = m.pdfCoordinates.map((p) => ({
                  x: p.x + deltaPdf.x,
                  y: p.y + deltaPdf.y,
                }));
                return { ...m, pdfCoordinates: newPoints, points: newPoints };
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

      if (measurementDragStart && (measurementType === 'area' || measurementType === 'volume')) {
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
            if (width >= 5 && height >= 5) {
              const p1 = { x: x / viewport.width, y: y / viewport.height };
              const p2 = { x: (x + width) / viewport.width, y: y / viewport.height };
              const p3 = { x: (x + width) / viewport.width, y: (y + height) / viewport.height };
              const p4 = { x: x / viewport.width, y: (y + height) / viewport.height };
              completeMeasurementRef.current([p1, p2, p3, p4]);
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
            const p1 = { x: x / viewport.width, y: y / viewport.height };
            const p2 = { x: (x + width) / viewport.width, y: (y + height) / viewport.height };
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
      const pdfSelectionBox = {
        x: x / viewport.width,
        y: y / viewport.height,
        width: width / viewport.width,
        height: height / viewport.height,
      };
      setSelectionStart(null);
      setIsSelectingSymbol(false);
      if (titleblockSelectionMode && onTitleblockSelectionComplete) {
        onTitleblockSelectionComplete(titleblockSelectionMode, pdfSelectionBox);
      } else if (visualSearchMode && onVisualSearchComplete) {
        onVisualSearchComplete(pdfSelectionBox);
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [
      measurementMoveId,
      measurementMoveIds,
      measurementMoveStart,
      measurementMoveOriginalPoints,
      measurementDragStart,
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
    ]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
      if (!pdfCanvasRef.current) return;
      let viewport = currentViewport;
      if (!viewport && pdfPageRef.current) {
        const newViewport = pdfPageRef.current.getViewport({
          scale: viewState.scale,
          rotation: viewState.rotation,
        });
        viewport = newViewport;
        setPageViewports((prev) => ({ ...prev, [currentPage]: newViewport }));
      }
      if (!viewport) return;
      if (isDeselecting) setIsDeselecting(false);
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
      if (measurementDragStart && (measurementType === 'area' || measurementType === 'volume')) {
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
        return;
      }
      if (!isMeasuring || !selectedConditionId) {
        if (mousePosition) setMousePosition(null);
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
        const referencePoints = isContinuousDrawing ? activePoints : currentMeasurement;
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
            currentRubberBand.parentNode === svgOverlayRef.current &&
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
    },
    [
      annotationTool,
      annotationDragStart,
      annotationMoveId,
      annotationMoveStart,
      measurementMoveId,
      measurementMoveStart,
      measurementDragStart,
      measurementType,
      isCalibrating,
      calibrationPoints,
      isMeasuring,
      selectedConditionId,
      mousePosition,
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
    ]
  );

  const handleClick = useCallback(
    async (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
      if (!pdfCanvasRef.current) return;
      let viewport = currentViewport;
      if (!viewport && pdfPageRef.current) {
        const newViewport = pdfPageRef.current.getViewport({
          scale: viewState.scale,
          rotation: viewState.rotation,
        });
        viewport = newViewport;
        setPageViewports((prev) => ({ ...prev, [currentPage]: newViewport }));
      } else if (!viewport && pdfDocument) {
        try {
          const page = await (pdfDocument as { getPage: (n: number) => Promise<PDFPageProxy> }).getPage(currentPage);
          (pdfPageRef as MutableRefObject<PDFPageProxy | null>).current = page;
          const newViewport = page.getViewport({
            scale: viewState.scale,
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
      const rect = pdfCanvasRef.current.getBoundingClientRect();
      let cssX = event.clientX - rect.left;
      let cssY = event.clientY - rect.top;
      const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
      if (Math.abs(interactiveScale - 1) > 0.0001) {
        cssX = cssX / interactiveScale;
        cssY = cssY / interactiveScale;
      }
      const currentSelectedConditionId = useConditionStore.getState().selectedConditionId;
      if (visualSearchMode || !!titleblockSelectionMode) {
        if (isSelectingSymbol) return;
        if (visualSearchMode) return;
      }
      if (isSelectionMode && selectedMarkupIds.length > 0 && !isMeasuring && !isCalibrating && !annotationTool) {
        setSelectedMarkupIds([]);
        return;
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
            pdfCoords = mousePosition ? mousePosition : applyOrthoSnapping(pdfCoords, prev);
          }
          const newPoints = [...prev, pdfCoords];
          if (newPoints.length === 2) completeCalibration(newPoints);
          return newPoints;
        });
        return;
      }
      if (cutoutMode) {
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
            setCurrentAnnotation([]);
            onAnnotationToolChange?.(null);
          }
          return;
        }
      }
      if (!currentSelectedConditionId && !isSelectionMode) return;
      if (isSelectionMode && !currentSelectedConditionId) return;
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
      if (isOrthoSnapping && isMeasuring && mousePosition) {
        pdfCoords = mousePosition;
      } else if (isOrthoSnapping) {
        const referencePoints = cutoutMode ? currentCutout : isContinuousDrawing ? activePoints : currentMeasurement;
        pdfCoords = applyOrthoSnapping(pdfCoords, referencePoints);
      }
      if (measurementType === 'linear') {
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
        if (measurementType === 'count') completeMeasurementRef.current?.([pdfCoords]);
      }
    },
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
      isOrthoSnapping,
      isMeasuring,
      mousePosition,
      cutoutMode,
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
      if (cutoutMode && currentCutout.length >= 3) {
        completeCutoutRef.current?.(currentCutout);
        return;
      }
      if (isMeasuring) {
        if (isContinuousDrawing && activePoints.length >= 2) {
          completeContinuousLinearMeasurementRef.current?.();
          return;
        }
        if (measurementType === 'linear' && !isContinuousDrawing && currentMeasurement.length >= 2) {
          completeMeasurementRef.current?.(currentMeasurement);
          return;
        }
        if ((measurementType === 'area' || measurementType === 'volume') && currentMeasurement.length >= 3) {
          completeMeasurementRef.current?.(currentMeasurement);
          return;
        }
      }
    },
    [
      isContinuousDrawing,
      activePoints,
      measurementType,
      currentMeasurement,
      cutoutMode,
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
      const currentIsSelectionMode = isSelectionModeRef.current;
      if (
        currentIsSelectionMode ||
        isCalibrating ||
        annotationTool ||
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
        if (annotationId && currentIsSelectionMode) {
          e.stopPropagation();
          const meta = e.metaKey || e.ctrlKey;
          setSelectedMarkupIds((prev) =>
            meta
              ? prev.includes(annotationId) ? prev.filter((id) => id !== annotationId) : [...prev, annotationId]
              : prev.includes(annotationId) && prev.length === 1 ? [] : [annotationId]
          );
          return;
        }
        if (measurementId && currentIsSelectionMode) {
          e.stopPropagation();
          const meta = e.metaKey || e.ctrlKey;
          setSelectedMarkupIds((prev) =>
            meta
              ? prev.includes(measurementId) ? prev.filter((id) => id !== measurementId) : [...prev, measurementId]
              : prev.includes(measurementId) && prev.length === 1 ? [] : [measurementId]
          );
          return;
        }
        e.stopPropagation();
        handleClick(e as React.MouseEvent<HTMLCanvasElement | SVGSVGElement>);
      }
    },
    [
      isCalibrating,
      annotationTool,
      visualSearchMode,
      isSelectingSymbol,
      titleblockSelectionMode,
      setSelectedMarkupIds,
      handleClick,
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
