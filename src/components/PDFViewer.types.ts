/**
 * Types for PDFViewer and related components.
 */

import type { SearchResult, ProjectFile } from '../types';

/** Annotation type is imported from shared types where defined */
export type { Annotation } from '../types';

/** Props for the main PDFViewer component */
export interface PDFViewerProps {
  /** Project file (id, originalName, etc.). Passed from TakeoffWorkspace. */
  file: ProjectFile;
  className?: string;
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  scale?: number;
  onScaleChange?: (scale: number) => void;
  rotation?: number;
  onCalibrateScale?: () => void;
  onClearAll?: () => void;
  isPageCalibrated?: boolean;
  scaleFactor?: number;
  unit?: string;
  calibrationViewportWidth?: number | null;
  calibrationViewportHeight?: number | null;
  calibrationRotation?: number | null;
  onPDFLoaded?: (totalPages: number) => void;
  onCalibrationRequest?: () => void;
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
  searchResults?: SearchResult[];
  currentSearchQuery?: string;
  cutoutMode?: boolean;
  cutoutTargetConditionId?: string | null;
  onCutoutModeChange?: (conditionId: string | null) => void;
  onMeasurementStateChange?: (
    isMeasuring: boolean,
    isCalibrating: boolean,
    measurementType: string,
    isOrthoSnapping: boolean
  ) => void;
  annotationTool?: 'text' | 'arrow' | 'rectangle' | 'circle' | null;
  annotationColor?: string;
  onAnnotationToolChange?: (tool: 'text' | 'arrow' | 'rectangle' | 'circle' | null) => void;
  onLocationChange?: (x: number, y: number) => void;
  onPDFRendered?: () => void;
  visualSearchMode?: boolean;
  visualSearchCondition?: unknown;
  onVisualSearchComplete?: (selectionBox: { x: number; y: number; width: number; height: number }) => void;
  titleblockSelectionMode?: 'sheetNumber' | 'sheetName' | null;
  onTitleblockSelectionComplete?: (
    field: 'sheetNumber' | 'sheetName',
    selectionBox: { x: number; y: number; width: number; height: number }
  ) => void;
}

/** Measurement shape used by PDFViewer for rendering (aligned with TakeoffMeasurement + legacy) */
export interface PDFViewerMeasurement {
  id: string;
  projectId: string;
  sheetId: string;
  conditionId: string;
  type: 'linear' | 'area' | 'volume' | 'count';
  points: { x: number; y: number }[];
  calculatedValue: number;
  unit: string;
  timestamp: string;
  pdfPage: number;
  pdfCoordinates: Array<{ x: number; y: number }>;
  conditionColor: string;
  conditionName: string;
  perimeterValue?: number;
  areaValue?: number;
  cutouts?: Array<{
    id: string;
    points: Array<{ x: number; y: number }>;
    pdfCoordinates: Array<{ x: number; y: number }>;
    calculatedValue: number;
  }>;
  netCalculatedValue?: number;
  color?: string;
}

/** Alias for use inside PDFViewer (backward compatible) */
export type Measurement = PDFViewerMeasurement;
