/**
 * Hook that holds PDFViewer measurement/annotation/selection and related UI state,
 * plus pure helpers (calculateRunningLength, applyOrthoSnapping). Event handlers
 * remain in PDFViewer and use this state. Used by PDFViewer.
 */
import { useState, useRef, useCallback, type RefObject } from 'react';
import type { Annotation } from '../../types';
import type { Measurement } from '../PDFViewer.types';

export interface UsePDFViewerMeasurementsOptions {
  currentViewport: { width: number; height: number; rotation?: number } | null;
  scaleFactor: number;
  calibrationViewportRef: RefObject<{
    viewportWidth: number;
    viewportHeight: number;
  } | null>;
}

export interface UsePDFViewerMeasurementsResult {
  // Measurement state
  isMeasuring: boolean;
  setIsMeasuring: React.Dispatch<React.SetStateAction<boolean>>;
  measurementType: 'linear' | 'area' | 'volume' | 'count';
  setMeasurementType: React.Dispatch<React.SetStateAction<'linear' | 'area' | 'volume' | 'count'>>;
  currentMeasurement: { x: number; y: number }[];
  setCurrentMeasurement: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>>;
  measurements: Measurement[];
  setMeasurements: React.Dispatch<React.SetStateAction<Measurement[]>>;
  isCompletingMeasurement: boolean;
  setIsCompletingMeasurement: React.Dispatch<React.SetStateAction<boolean>>;
  lastClickTime: number;
  setLastClickTime: React.Dispatch<React.SetStateAction<number>>;
  lastClickPosition: { x: number; y: number } | null;
  setLastClickPosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  isCompletingMeasurementRef: React.MutableRefObject<boolean>;
  lastCompletionTimeRef: React.MutableRefObject<number>;
  // Annotation state
  isAnnotating: boolean;
  setIsAnnotating: React.Dispatch<React.SetStateAction<boolean>>;
  localAnnotations: Annotation[];
  setLocalAnnotations: React.Dispatch<React.SetStateAction<Annotation[]>>;
  currentAnnotation: { x: number; y: number }[];
  setCurrentAnnotation: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>>;
  showTextInput: boolean;
  setShowTextInput: React.Dispatch<React.SetStateAction<boolean>>;
  textInputPosition: { x: number; y: number } | null;
  setTextInputPosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  textInputValue: string;
  setTextInputValue: React.Dispatch<React.SetStateAction<string>>;
  // Shared UI state
  mousePosition: { x: number; y: number } | null;
  setMousePosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  // Cut-out state
  currentCutout: { x: number; y: number }[];
  setCurrentCutout: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>>;
  // Visual search state
  isSelectingSymbol: boolean;
  setIsSelectingSymbol: React.Dispatch<React.SetStateAction<boolean>>;
  selectionBox: { x: number; y: number; width: number; height: number } | null;
  setSelectionBox: React.Dispatch<React.SetStateAction<{ x: number; y: number; width: number; height: number } | null>>;
  selectionStart: { x: number; y: number } | null;
  setSelectionStart: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  // Selection state (markups)
  selectedMarkupId: string | null;
  setSelectedMarkupId: React.Dispatch<React.SetStateAction<string | null>>;
  isSelectionMode: boolean;
  setIsSelectionMode: React.Dispatch<React.SetStateAction<boolean>>;
  // Continuous linear drawing state
  isContinuousDrawing: boolean;
  setIsContinuousDrawing: React.Dispatch<React.SetStateAction<boolean>>;
  activePoints: { x: number; y: number }[];
  setActivePoints: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>>;
  rubberBandElement: SVGLineElement | null;
  setRubberBandElement: React.Dispatch<React.SetStateAction<SVGLineElement | null>>;
  runningLength: number;
  setRunningLength: React.Dispatch<React.SetStateAction<number>>;
  pageRubberBandRefs: React.MutableRefObject<Record<number, SVGLineElement | null>>;
  pageCommittedPolylineRefs: React.MutableRefObject<Record<number, SVGPolylineElement | null>>;
  // Ortho snapping state
  isOrthoSnapping: boolean;
  setIsOrthoSnapping: React.Dispatch<React.SetStateAction<boolean>>;
  // Pure helpers
  calculateRunningLength: (points: { x: number; y: number }[], currentMousePos?: { x: number; y: number }) => number;
  applyOrthoSnapping: (currentPos: { x: number; y: number }, referencePoints: { x: number; y: number }[]) => { x: number; y: number };
}

export function usePDFViewerMeasurements({
  currentViewport,
  scaleFactor,
  calibrationViewportRef,
}: UsePDFViewerMeasurementsOptions): UsePDFViewerMeasurementsResult {
  // Measurement state
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [measurementType, setMeasurementType] = useState<'linear' | 'area' | 'volume' | 'count'>('linear');
  const [currentMeasurement, setCurrentMeasurement] = useState<{ x: number; y: number }[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [isCompletingMeasurement, setIsCompletingMeasurement] = useState(false);
  const [lastClickTime, setLastClickTime] = useState<number>(0);
  const [lastClickPosition, setLastClickPosition] = useState<{ x: number; y: number } | null>(null);
  const isCompletingMeasurementRef = useRef(false);
  const lastCompletionTimeRef = useRef<number>(0);

  // Annotation state
  const [localAnnotations, setLocalAnnotations] = useState<Annotation[]>([]);
  const [currentAnnotation, setCurrentAnnotation] = useState<{ x: number; y: number }[]>([]);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInputPosition, setTextInputPosition] = useState<{ x: number; y: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState('');
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);

  // Cut-out state
  const [currentCutout, setCurrentCutout] = useState<{ x: number; y: number }[]>([]);

  // Visual search state
  const [isSelectingSymbol, setIsSelectingSymbol] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);

  // Selection state for deleting markups
  const [selectedMarkupId, setSelectedMarkupId] = useState<string | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(true);

  // Continuous linear drawing state
  const [isContinuousDrawing, setIsContinuousDrawing] = useState(false);
  const [activePoints, setActivePoints] = useState<{ x: number; y: number }[]>([]);
  const [rubberBandElement, setRubberBandElement] = useState<SVGLineElement | null>(null);
  const [runningLength, setRunningLength] = useState<number>(0);
  const pageRubberBandRefs = useRef<Record<number, SVGLineElement | null>>({});
  const pageCommittedPolylineRefs = useRef<Record<number, SVGPolylineElement | null>>({});

  // Ortho snapping state
  const [isOrthoSnapping, setIsOrthoSnapping] = useState(false);

  const calculateRunningLength = useCallback(
    (points: { x: number; y: number }[], currentMousePos?: { x: number; y: number }) => {
      if (!currentViewport || points.length === 0) return 0;
      const allPoints = currentMousePos ? [...points, currentMousePos] : points;
      if (allPoints.length < 2) return 0;
      const calibBase = calibrationViewportRef.current;
      const viewportWidth = calibBase?.viewportWidth ?? currentViewport.width;
      const viewportHeight = calibBase?.viewportHeight ?? currentViewport.height;
      let totalDistance = 0;
      for (let i = 1; i < allPoints.length; i++) {
        const dx = (allPoints[i].x - allPoints[i - 1].x) * viewportWidth;
        const dy = (allPoints[i].y - allPoints[i - 1].y) * viewportHeight;
        totalDistance += Math.sqrt(dx * dx + dy * dy);
      }
      return totalDistance * scaleFactor;
    },
    [currentViewport, scaleFactor, calibrationViewportRef]
  );

  const applyOrthoSnapping = useCallback(
    (currentPos: { x: number; y: number }, referencePoints: { x: number; y: number }[]) => {
      if (!isOrthoSnapping || referencePoints.length === 0) return currentPos;
      const lastPoint = referencePoints[referencePoints.length - 1];
      const dx = currentPos.x - lastPoint.x;
      const dy = currentPos.y - lastPoint.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        return { x: currentPos.x, y: lastPoint.y };
      }
      return { x: lastPoint.x, y: currentPos.y };
    },
    [isOrthoSnapping]
  );

  return {
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
  };
}
