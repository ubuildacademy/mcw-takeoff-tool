import React, { Suspense, lazy } from 'react';

/** Lazy-loaded; calibration dialogs load when user opens calibration flow */
const CalibrationDialog = lazy(() => import('../CalibrationDialog'));
const ScaleApplicationDialog = lazy(() => import('../ScaleApplicationDialog'));

export interface PDFViewerDialogsProps {
  showCalibrationDialog: boolean;
  setShowCalibrationDialog: (open: boolean) => void;
  showScaleApplicationDialog: boolean;
  setShowScaleApplicationDialog: (open: boolean) => void;
  startCalibration: (knownDistance: number, unit: string) => void;
  applyScale: (scope: 'page' | 'document') => void;
  isPageCalibrated: boolean;
  scaleFactor: number;
  unit: string;
  pendingScaleData: { scaleFactor: number; unit: string } | null;
  isCalibrating: boolean;
  currentPage: number;
  totalPages: number;
}

/**
 * Renders Calibration and Scale Application dialogs used by PDFViewer.
 * Keeps dialog wiring in one place and shortens the main viewer return block.
 */
export const PDFViewerDialogs: React.FC<PDFViewerDialogsProps> = ({
  showCalibrationDialog,
  setShowCalibrationDialog,
  showScaleApplicationDialog,
  setShowScaleApplicationDialog,
  startCalibration,
  applyScale,
  isPageCalibrated,
  scaleFactor,
  unit,
  pendingScaleData,
  isCalibrating,
  currentPage,
  totalPages,
}) => (
  <>
    <Suspense fallback={null}>
      <CalibrationDialog
        isOpen={showCalibrationDialog}
        onClose={() => setShowCalibrationDialog(false)}
        onStartCalibration={startCalibration}
        currentScale={isPageCalibrated ? { scaleFactor, unit } : null}
        isCalibrating={isCalibrating}
      />
    </Suspense>
    <Suspense fallback={null}>
      <ScaleApplicationDialog
        isOpen={showScaleApplicationDialog}
        onClose={() => setShowScaleApplicationDialog(false)}
        onApply={applyScale}
        scaleFactor={pendingScaleData?.scaleFactor ?? 0}
        unit={pendingScaleData?.unit ?? 'ft'}
        currentPage={currentPage}
        totalPages={totalPages}
      />
    </Suspense>
  </>
);
