/**
 * Hook that encapsulates PDFViewer calibration flow: state, dialogs, and
 * complete/start/apply scale logic. Used by PDFViewer.
 */
import { useState, useCallback, useEffect, useRef, type RefObject } from 'react';
import { toast } from 'sonner';
import { formatFeetAndInches } from '../../lib/utils';

export interface UsePDFViewerCalibrationOptions {
  externalScaleFactor?: number | null;
  externalIsPageCalibrated?: boolean | null;
  externalUnit?: string | null;
  externalCalibrationViewportWidth?: number | null;
  externalCalibrationViewportHeight?: number | null;
  externalCalibrationRotation?: number | null;
  onCalibrationComplete?: (
    isCalibrated: boolean,
    scaleFactor: number,
    unit: string,
    scope?: 'page' | 'document',
    pageNumber?: number | null,
    viewportWidth?: number | null,
    viewportHeight?: number | null,
    rotation?: number | null
  ) => void;
  currentPage: number;
  currentViewport: { width: number; height: number; rotation?: number } | null;
  viewStateRotation: number;
  fileId?: string;
  currentProjectId?: string | null;
  /** Ref to the PDF.js page (PDFPageProxy) for getViewport() during calibration */
  pdfPageRef: RefObject<{ getViewport: (opts: { scale: number; rotation: number }) => { width: number; height: number; scale: number; rotation: number } } | null>;
}

export interface UsePDFViewerCalibrationResult {
  isCalibrating: boolean;
  calibrationPoints: { x: number; y: number }[];
  setCalibrationPoints: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>>;
  setIsCalibrating: React.Dispatch<React.SetStateAction<boolean>>;
  showCalibrationDialog: boolean;
  setShowCalibrationDialog: React.Dispatch<React.SetStateAction<boolean>>;
  showScaleApplicationDialog: boolean;
  setShowScaleApplicationDialog: React.Dispatch<React.SetStateAction<boolean>>;
  pendingScaleData: { scaleFactor: number; unit: string } | null;
  calibrationData: { knownDistance: number; unit: string } | null;
  setCalibrationData: React.Dispatch<React.SetStateAction<{ knownDistance: number; unit: string } | null>>;
  calibrationValidation: { points: { x: number; y: number }[]; display: string; page: number } | null;
  setCalibrationValidation: React.Dispatch<React.SetStateAction<UsePDFViewerCalibrationResult['calibrationValidation']>>;
  scaleFactor: number;
  isPageCalibrated: boolean;
  unit: string;
  calibrationViewportRef: React.MutableRefObject<{
    scaleFactor: number;
    unit: string;
    viewportWidth: number;
    viewportHeight: number;
    scale: number;
    rotation: number;
  } | null>;
  completeCalibration: (points: { x: number; y: number }[]) => void;
  startCalibration: (knownDistance: number, unit: string) => void;
  applyScale: (scope: 'page' | 'document') => void;
}

export function usePDFViewerCalibration({
  externalScaleFactor,
  externalIsPageCalibrated,
  externalUnit,
  externalCalibrationViewportWidth,
  externalCalibrationViewportHeight,
  externalCalibrationRotation,
  onCalibrationComplete,
  currentPage,
  currentViewport,
  viewStateRotation,
  fileId,
  currentProjectId,
  pdfPageRef,
}: UsePDFViewerCalibrationOptions): UsePDFViewerCalibrationResult {
  const [internalScaleFactor, setInternalScaleFactor] = useState(1);
  const [internalIsPageCalibrated, setInternalIsPageCalibrated] = useState(false);
  const [internalUnit, setInternalUnit] = useState('ft');
  const scaleFactor = externalScaleFactor ?? internalScaleFactor;
  const isPageCalibrated = externalIsPageCalibrated ?? internalIsPageCalibrated;
  const unit = externalUnit ?? internalUnit;

  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<{ x: number; y: number }[]>([]);
  const [showCalibrationDialog, setShowCalibrationDialog] = useState(false);
  const [showScaleApplicationDialog, setShowScaleApplicationDialog] = useState(false);
  const [pendingScaleData, setPendingScaleData] = useState<{ scaleFactor: number; unit: string } | null>(null);
  const [calibrationData, setCalibrationData] = useState<{ knownDistance: number; unit: string } | null>(null);
  const [calibrationValidation, setCalibrationValidation] = useState<{
    points: { x: number; y: number }[];
    display: string;
    page: number;
  } | null>(null);

  const calibrationViewportRef = useRef<{
    scaleFactor: number;
    unit: string;
    viewportWidth: number;
    viewportHeight: number;
    scale: number;
    rotation: number;
  } | null>(null);

  useEffect(() => {
    if (externalIsPageCalibrated && externalScaleFactor && externalCalibrationViewportWidth != null && externalCalibrationViewportHeight != null) {
      const storedRotation = externalCalibrationRotation ?? 0;
      calibrationViewportRef.current = {
        scaleFactor: externalScaleFactor,
        unit: externalUnit || 'ft',
        viewportWidth: externalCalibrationViewportWidth,
        viewportHeight: externalCalibrationViewportHeight,
        scale: 1,
        rotation: storedRotation,
      };
    } else if (!externalIsPageCalibrated) {
      calibrationViewportRef.current = null;
    }
  }, [
    externalIsPageCalibrated,
    externalScaleFactor,
    externalUnit,
    externalCalibrationViewportWidth,
    externalCalibrationViewportHeight,
    externalCalibrationRotation,
  ]);

  const completeCalibration = useCallback(
    (points: { x: number; y: number }[]) => {
      if (points.length !== 2 || !calibrationData || !currentViewport) return;
      const knownDistance = calibrationData.knownDistance;
      const unitVal = calibrationData.unit;
      const pdfPage = pdfPageRef.current;
      if (!pdfPage) {
        console.error('PDF page is not available for calibration');
        return;
      }
      const baseViewport = pdfPage.getViewport({ scale: 1, rotation: viewStateRotation });
      const dx = (points[1].x - points[0].x) * baseViewport.width;
      const dy = (points[1].y - points[0].y) * baseViewport.height;
      const pixelDistance = Math.sqrt(dx * dx + dy * dy);
      const newScaleFactor = knownDistance / pixelDistance;
      const testDistance = pixelDistance * newScaleFactor;
      const accuracy = 1 - Math.abs(testDistance - knownDistance) / knownDistance;
      const warnings: string[] = [];
      const errors: string[] = [];
      if (newScaleFactor < 0.0001) {
        errors.push('Scale factor is extremely small - check if calibration points are too close together');
      } else if (newScaleFactor < 0.001) {
        warnings.push('Scale factor is very small - verify calibration points are far enough apart');
      }
      if (newScaleFactor > 10000) {
        errors.push('Scale factor is extremely large - check if calibration points are too far apart');
      } else if (newScaleFactor > 1000) {
        warnings.push('Scale factor is very large - verify calibration points are close enough together');
      }
      if (accuracy < 0.9) {
        errors.push('Calibration accuracy is very low - please re-calibrate with more precise points');
      } else if (accuracy < 0.95) {
        warnings.push('Calibration accuracy is low - consider re-calibrating for better precision');
      }
      const pixelsPerFoot = 1 / newScaleFactor;
      if (pixelsPerFoot < 1) warnings.push('Very high resolution detected - verify the known distance is correct');
      else if (pixelsPerFoot > 1000) warnings.push('Very low resolution detected - verify the known distance is correct');
      // Allow wider range so 18' and similar calibrations on various zoom/viewport sizes don't trigger
      if (newScaleFactor < 0.001 || newScaleFactor > 0.5) {
        warnings.push('Scale factor outside typical architectural drawing range - verify known distance');
      }
      if (errors.length > 0) {
        console.error('❌ CALIBRATION ERRORS:', errors);
        setCalibrationPoints([]);
        setCalibrationData(null);
        setIsCalibrating(false);
        toast.error(`Calibration failed: ${errors.join(', ')}`);
        return;
      }
      if (warnings.length > 0) {
        const warningMessage = warnings.join('\n');
        if (!confirm(`Calibration warnings:\n\n${warningMessage}\n\nDo you want to proceed with this calibration?`)) {
          setCalibrationPoints([]);
          setCalibrationData(null);
          setIsCalibrating(false);
          return;
        }
      }
      if (externalScaleFactor === undefined) setInternalScaleFactor(newScaleFactor);
      if (externalUnit === undefined) setInternalUnit(unitVal);
      if (externalIsPageCalibrated === undefined) setInternalIsPageCalibrated(true);
      setPendingScaleData({ scaleFactor: newScaleFactor, unit: unitVal });
      setShowScaleApplicationDialog(true);
      try {
        const measured = pixelDistance * newScaleFactor;
        const display =
          unitVal === 'ft' ? `${formatFeetAndInches(measured)}` : `${measured.toFixed(2)} ${unitVal}`;
        setCalibrationValidation({ points, display, page: currentPage });
        setTimeout(() => setCalibrationValidation(null), 3000);
      } catch {
        // ignore
      }
      calibrationViewportRef.current = {
        scaleFactor: newScaleFactor,
        unit: unitVal,
        viewportWidth: baseViewport.width,
        viewportHeight: baseViewport.height,
        scale: baseViewport.scale,
        rotation: baseViewport.rotation,
      };
      if (onCalibrationComplete) {
        onCalibrationComplete(true, newScaleFactor, unitVal, 'page', currentPage, baseViewport.width, baseViewport.height, baseViewport.rotation);
      }
      setCalibrationPoints([]);
      setIsCalibrating(false);
      setCalibrationData(null);
    },
    [
      calibrationData,
      onCalibrationComplete,
      currentViewport,
      viewStateRotation,
      currentPage,
      pdfPageRef,
      externalScaleFactor,
      externalUnit,
      externalIsPageCalibrated,
    ]
  );

  const startCalibration = useCallback((knownDistance: number, unitVal: string) => {
    setCalibrationData({ knownDistance, unit: unitVal });
    setIsCalibrating(true);
    setCalibrationPoints([]);
    setShowCalibrationDialog(false);
  }, []);

  const applyScale = useCallback(
    (scope: 'page' | 'document') => {
      if (!pendingScaleData) return;
      if (onCalibrationComplete && fileId && currentProjectId) {
        const pageNumber = scope === 'page' ? currentPage : null;
        const viewportWidth = calibrationViewportRef.current?.viewportWidth ?? null;
        const viewportHeight = calibrationViewportRef.current?.viewportHeight ?? null;
        const rotation = calibrationViewportRef.current?.rotation ?? null;
        onCalibrationComplete(true, pendingScaleData.scaleFactor, pendingScaleData.unit, scope, pageNumber, viewportWidth, viewportHeight, rotation);
      }
      if (externalScaleFactor === undefined) setInternalScaleFactor(pendingScaleData.scaleFactor);
      if (externalUnit === undefined) setInternalUnit(pendingScaleData.unit);
      if (externalIsPageCalibrated === undefined) setInternalIsPageCalibrated(true);
      setPendingScaleData(null);
      setShowScaleApplicationDialog(false);
    },
    [
      pendingScaleData,
      externalScaleFactor,
      externalUnit,
      externalIsPageCalibrated,
      onCalibrationComplete,
      fileId,
      currentProjectId,
      currentPage,
    ]
  );

  return {
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
  };
}
