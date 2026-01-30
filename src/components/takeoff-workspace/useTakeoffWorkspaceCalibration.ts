import { useMemo } from 'react';
import type { Calibration, ProjectFile } from '../../types';

export interface UseTakeoffWorkspaceCalibrationOptions {
  projectId: string | undefined;
  currentPdfFile: ProjectFile | null;
  currentPage: number;
  calibrations: Calibration[];
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
 * Derives the active calibration for the current document/page.
 * Page-specific calibrations take precedence over document-level calibrations.
 */
export function useTakeoffWorkspaceCalibration({
  projectId,
  currentPdfFile,
  currentPage,
  calibrations,
  isDev = false,
}: UseTakeoffWorkspaceCalibrationOptions): UseTakeoffWorkspaceCalibrationResult {
  const currentCalibration = useMemo(() => {
    if (!currentPdfFile || !projectId) {
      return null;
    }
    const pageCalibration = calibrations.find(
      (c) =>
        c.projectId === projectId &&
        c.sheetId === currentPdfFile.id &&
        c.pageNumber === currentPage &&
        c.pageNumber != null
    );
    if (pageCalibration) {
      if (isDev) {
        console.log('📏 Using page-specific calibration:', {
          pageNumber: currentPage,
          scaleFactor: pageCalibration.scaleFactor,
          unit: pageCalibration.unit,
        });
      }
      return pageCalibration;
    }

    const docCalibration = calibrations.find(
      (c) =>
        c.projectId === projectId &&
        c.sheetId === currentPdfFile.id &&
        (c.pageNumber == null || c.pageNumber === undefined)
    );
    if (docCalibration && isDev) {
      console.log('📏 Using document-level calibration:', {
        scaleFactor: docCalibration.scaleFactor,
        unit: docCalibration.unit,
      });
    }
    if (!docCalibration && isDev) {
      console.log('⚠️ No calibration found for:', {
        projectId,
        sheetId: currentPdfFile.id,
        pageNumber: currentPage,
        totalCalibrations: calibrations.length,
      });
    }
    return docCalibration ?? null;
  }, [calibrations, projectId, currentPdfFile?.id, currentPage, isDev]);

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
