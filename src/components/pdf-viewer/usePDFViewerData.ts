import { useState, useEffect } from 'react';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import { useAnnotationStore } from '../../store/slices/annotationSlice';
import type { Annotation } from '../../types';
import type { Measurement } from '../PDFViewer.types';

/** Safely convert API timestamp to ISO string; avoids RangeError for invalid dates */
function safeTimestampToISO(ts: string | number | undefined | null): string {
  if (ts == null || ts === '') return new Date().toISOString();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function apiMeasurementToDisplay(m: {
  id: string;
  projectId: string;
  sheetId: string;
  conditionId: string;
  type: 'linear' | 'area' | 'volume' | 'count';
  points: Array<{ x: number; y: number }>;
  calculatedValue: number;
  unit: string;
  timestamp: string | number | undefined | null;
  pdfPage: number;
  pdfCoordinates: Array<{ x: number; y: number }>;
  conditionColor: string;
  conditionName: string;
  perimeterValue?: number | null;
  areaValue?: number | null;
  cutouts?: unknown;
  netCalculatedValue?: number | null;
}): Measurement | null {
  try {
    return {
      id: m.id,
      projectId: m.projectId,
      sheetId: m.sheetId,
      conditionId: m.conditionId,
      type: m.type,
      points: m.points,
      calculatedValue: m.calculatedValue,
      unit: m.unit,
      timestamp: safeTimestampToISO(m.timestamp),
      pdfPage: m.pdfPage,
      pdfCoordinates: m.pdfCoordinates,
      conditionColor: m.conditionColor,
      conditionName: m.conditionName,
      perimeterValue: m.perimeterValue ?? undefined,
      areaValue: m.areaValue ?? undefined,
      cutouts: m.cutouts as Measurement['cutouts'],
      netCalculatedValue: m.netCalculatedValue ?? undefined,
    };
  } catch {
    return null;
  }
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

        const pageMeasurements = getPageTakeoffMeasurements(currentProjectId, fileId, currentPage);
        if (isCancelled) return;

        const displayMeasurements = pageMeasurements
          .map((apiMeasurement) => apiMeasurementToDisplay(apiMeasurement))
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
  }, [currentProjectId, fileId, currentPage, loadPageTakeoffMeasurements, getPageTakeoffMeasurements]);

  // REACTIVE UPDATE: Update localTakeoffMeasurements when store changes
  useEffect(() => {
    if (!currentProjectId || !fileId || !currentPage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clear when deps invalid
      setLocalTakeoffMeasurements([]);
      return;
    }

    const pageMeasurements = getPageTakeoffMeasurements(currentProjectId, fileId, currentPage);
    const displayMeasurements = pageMeasurements
      .map((apiMeasurement) => apiMeasurementToDisplay(apiMeasurement))
      .filter((m): m is Measurement => m != null);

    setLocalTakeoffMeasurements((prev) => {
      const prevIds = new Set(prev.map((m) => m.id));
      const newIds = new Set(displayMeasurements.map((m) => m.id));
      if (
        prev.length !== displayMeasurements.length ||
        ![...prevIds].every((id) => newIds.has(id)) ||
        ![...newIds].every((id) => prevIds.has(id))
      ) {
        return displayMeasurements;
      }
      return prev;
    });
  }, [allTakeoffMeasurements, currentProjectId, fileId, currentPage, getPageTakeoffMeasurements]);

  return {
    localTakeoffMeasurements,
    setLocalTakeoffMeasurements,
    measurementsLoading,
  };
}
