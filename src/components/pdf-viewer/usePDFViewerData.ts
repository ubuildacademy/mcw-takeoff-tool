import { useState, useEffect, useLayoutEffect } from 'react';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import { useAnnotationStore } from '../../store/slices/annotationSlice';
import type { Annotation } from '../../types';
import type { Measurement } from '../PDFViewer.types';
import { takeoffMeasurementToPdfViewerMeasurement } from '../../utils/takeoffMeasurementDisplay';

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clear when deps invalid
      setLocalTakeoffMeasurements([]);
      return;
    }

    const pageMeasurements = getPageTakeoffMeasurements(currentProjectId, fileId, currentPage);
    const displayMeasurements = pageMeasurements
      .map((apiMeasurement) => takeoffMeasurementToPdfViewerMeasurement(apiMeasurement))
      .filter((m): m is Measurement => m != null);

    // Always mirror the store for this page. Do not skip updates when ids are unchanged —
    // coordinates (e.g. after move undo/redo) must refresh local state for the canvas.
    // Order matches getPageTakeoffMeasurements (sorted by stackOrder); PDFViewer draws in this order.
    setLocalTakeoffMeasurements(displayMeasurements);
  }, [allTakeoffMeasurements, currentProjectId, fileId, currentPage, getPageTakeoffMeasurements]);

  return {
    localTakeoffMeasurements,
    setLocalTakeoffMeasurements,
    measurementsLoading,
  };
}
