import type { Calibration } from '../../types';

export interface UseTakeoffWorkspaceCalibrationOptions {
  /** Current calibration for the active document/page (from store getCalibration). */
  currentCalibration: Calibration | null;
  isDev?: boolean;
}

export interface UseTakeoffWorkspaceCalibrationResult {
  currentCalibration: Calibration | null;
  isPageCalibrated: boolean;
  scaleFactor: number;
  unit: string;
  calibrationViewportWidth: number | null;
  calibrationViewportHeight: number | null;
  calibrationRotation: number | null;
}

/**
 * Maps the active calibration (from store) to view props.
 * Caller subscribes to getCalibration(projectId, sheetId, pageNumber) so only current page changes trigger re-renders.
 */
export function useTakeoffWorkspaceCalibration({
  currentCalibration,
  isDev: _isDev = false,
}: UseTakeoffWorkspaceCalibrationOptions): UseTakeoffWorkspaceCalibrationResult {
  return {
    currentCalibration,
    isPageCalibrated: !!currentCalibration,
    scaleFactor: currentCalibration?.scaleFactor ?? 1,
    unit: currentCalibration?.unit ?? 'ft',
    calibrationViewportWidth: currentCalibration?.viewportWidth ?? null,
    calibrationViewportHeight: currentCalibration?.viewportHeight ?? null,
    calibrationRotation: currentCalibration?.rotation ?? null,
  };
}
