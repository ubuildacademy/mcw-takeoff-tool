import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import { useAnnotationStore } from '../../store/slices/annotationSlice';
import type { Annotation } from '../../types';
import type { Measurement } from '../PDFViewer.types';
import { takeoffMeasurementToPdfViewerMeasurement } from '../../utils/takeoffMeasurementDisplay';

function sameXY(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

function samePointList(
  a: Array<{ x: number; y: number }>,
  b: Array<{ x: number; y: number }>
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!sameXY(a[i], b[i])) return false;
  }
  return true;
}

function sameCutout(
  a: NonNullable<Measurement['cutouts']>[number],
  b: NonNullable<Measurement['cutouts']>[number]
): boolean {
  if (a.id !== b.id) return false;
  if (a.calculatedValue !== b.calculatedValue) return false;
  return samePointList(a.points, b.points) && samePointList(a.pdfCoordinates, b.pdfCoordinates);
}

/** True if PDFViewer would render the same markup for this page (ids, order, geometry, display fields). */
function measurementEqualForViewer(a: Measurement, b: Measurement): boolean {
  if (a.id !== b.id) return false;
  if (a.type !== b.type) return false;
  if (a.conditionId !== b.conditionId) return false;
  if (a.conditionColor !== b.conditionColor) return false;
  if (a.pdfPage !== b.pdfPage) return false;
  if (a.stackOrder !== b.stackOrder) return false;
  if (a.calculatedValue !== b.calculatedValue) return false;
  if (a.netCalculatedValue !== b.netCalculatedValue) return false;
  if (a.perimeterValue !== b.perimeterValue) return false;
  if (a.areaValue !== b.areaValue) return false;
  if (a.color !== b.color) return false;
  if (!samePointList(a.points, b.points)) return false;
  if (!samePointList(a.pdfCoordinates, b.pdfCoordinates)) return false;
  const ac = a.cutouts;
  const bc = b.cutouts;
  if ((ac?.length ?? 0) !== (bc?.length ?? 0)) return false;
  if (ac && bc) {
    for (let i = 0; i < ac.length; i++) {
      if (!sameCutout(ac[i], bc[i])) return false;
    }
  }
  return true;
}

function measurementListEqualForViewer(a: Measurement[] | null, b: Measurement[]): boolean {
  if (a === null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!measurementEqualForViewer(a[i], b[i])) return false;
  }
  return true;
}

export interface UsePDFViewerDataOptions {
  currentProjectId: string | null | undefined;
  fileId: string;
  currentPage: number;
  setLocalAnnotations: (annotations: Annotation[]) => void;
}

export interface UsePDFViewerDataResult {
  localTakeoffMeasurements: Measurement[];
  setLocalTakeoffMeasurements: React.Dispatch<React.SetStateAction<Measurement[]>>;
  measurementsLoading: boolean;
}

/**
 * Loads annotations for the sheet and measurements for the current page.
 * Keeps PDFViewer free of the per-page loading and reactive-update effects.
 */
export function usePDFViewerData({
  currentProjectId,
  fileId,
  currentPage,
  setLocalAnnotations,
}: UsePDFViewerDataOptions): UsePDFViewerDataResult {
  const [localTakeoffMeasurements, setLocalTakeoffMeasurements] = useState<Measurement[]>([]);
  const [measurementsLoading, setMeasurementsLoading] = useState(false);
  const lastMirroredViewerMeasurementsRef = useRef<Measurement[] | null>(null);

  const storeAnnotations = useAnnotationStore((s) => s.annotations);
  const loadPageTakeoffMeasurements = useMeasurementStore((s) => s.loadPageTakeoffMeasurements);
  const getPageTakeoffMeasurements = useMeasurementStore((s) => s.getPageTakeoffMeasurements);
  const allTakeoffMeasurements = useMeasurementStore((s) => s.takeoffMeasurements);

  // Load annotations for the entire sheet - reactive to store changes
  useEffect(() => {
    if (currentProjectId && fileId) {
      const sheetAnnotations = storeAnnotations.filter(
        (a) => a.projectId === currentProjectId && a.sheetId === fileId
      );
      setLocalAnnotations(sheetAnnotations);
    } else {
      setLocalAnnotations([]);
    }
  }, [currentProjectId, fileId, storeAnnotations, setLocalAnnotations]);

  // PER-PAGE LOADING: Load measurements for current page when page changes
  useEffect(() => {
    lastMirroredViewerMeasurementsRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset local state when deps change
    setLocalTakeoffMeasurements([]);
    setMeasurementsLoading(true);

    if (!currentProjectId || !fileId || !currentPage) {
      setMeasurementsLoading(false);
      return;
    }

    let isCancelled = false;

    const loadPageMeasurements = async () => {
      try {
        await loadPageTakeoffMeasurements(currentProjectId, fileId, currentPage);
        if (isCancelled) return;

        const pageMeasurements = useMeasurementStore
          .getState()
          .getPageTakeoffMeasurements(currentProjectId, fileId, currentPage);
        if (isCancelled) return;

        const displayMeasurements = pageMeasurements
          .map((apiMeasurement) => takeoffMeasurementToPdfViewerMeasurement(apiMeasurement))
          .filter((m): m is Measurement => m != null);

        if (!isCancelled) {
          setLocalTakeoffMeasurements(displayMeasurements);
          setMeasurementsLoading(false);
        }
      } catch (error) {
        if (!isCancelled) {
          console.error('Error loading page measurements:', error);
          setLocalTakeoffMeasurements([]);
          setMeasurementsLoading(false);
        }
      }
    };

    loadPageMeasurements();

    return () => {
      isCancelled = true;
      setMeasurementsLoading(false);
    };
  }, [currentProjectId, fileId, currentPage, loadPageTakeoffMeasurements]);

  // REACTIVE UPDATE: mirror store → local before paint so layer/order changes feel instant (useEffect was one frame late).
  useLayoutEffect(() => {
    if (!currentProjectId || !fileId || !currentPage) {
      lastMirroredViewerMeasurementsRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clear when deps invalid
      setLocalTakeoffMeasurements([]);
      return;
    }

    const pageMeasurements = getPageTakeoffMeasurements(currentProjectId, fileId, currentPage);
    const displayMeasurements = pageMeasurements
      .map((apiMeasurement) => takeoffMeasurementToPdfViewerMeasurement(apiMeasurement))
      .filter((m): m is Measurement => m != null);

    // Skip setState when the derived page list is viewer-equivalent to the last mirror (avoids re-renders on store churn).
    // Still update when ids, order, coordinates, cutouts, or display fields change.
    if (measurementListEqualForViewer(lastMirroredViewerMeasurementsRef.current, displayMeasurements)) {
      return;
    }
    lastMirroredViewerMeasurementsRef.current = displayMeasurements;
    setLocalTakeoffMeasurements(displayMeasurements);
  }, [allTakeoffMeasurements, currentProjectId, fileId, currentPage, getPageTakeoffMeasurements]);

  return {
    localTakeoffMeasurements,
    setLocalTakeoffMeasurements,
    measurementsLoading,
  };
}
