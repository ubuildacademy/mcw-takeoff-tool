/**
 * Types for usePDFViewerInteractions hook.
 * Context passed from PDFViewer so the hook can build event handlers without closure over all state.
 */
import type { RefObject } from 'react';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import type { SelectionBox } from '../PDFViewer.types';
import type { UsePDFViewerMeasurementsResult } from './usePDFViewerMeasurements';

export interface PDFViewerInteractionsRefs {
  pdfPageRef: RefObject<PDFPageProxy | null>;
  pdfCanvasRef: RefObject<HTMLCanvasElement | null>;
  svgOverlayRef: RefObject<SVGSVGElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  renderPDFPageRef: RefObject<((pageNum: number) => Promise<void>) | null>;
  completeMeasurementRef: RefObject<(points: { x: number; y: number }[]) => Promise<void>>;
  isSelectionModeRef: RefObject<boolean>;
  lastRenderedScaleRef: RefObject<number>;
}

export interface PDFViewerInteractionsView {
  viewState: { scale: number; rotation: number };
  currentPage: number;
  totalPages: number;
  currentViewport: PageViewport | null;
  pageViewports: Record<number, PageViewport>;
  setPageViewports: React.Dispatch<React.SetStateAction<Record<number, PageViewport>>>;
  setInternalViewState: React.Dispatch<React.SetStateAction<{ scale: number; rotation: number }>>;
}

export interface PDFViewerInteractionsFile {
  file: { id: string; originalName?: string };
}

export interface PDFViewerInteractionsCalibration {
  isCalibrating: boolean;
  calibrationPoints: { x: number; y: number }[];
  setCalibrationPoints: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>>;
  setIsCalibrating: React.Dispatch<React.SetStateAction<boolean>>;
  setCalibrationData: React.Dispatch<React.SetStateAction<{ knownDistance: number; unit: string } | null>>;
  completeCalibration: (points: { x: number; y: number }[]) => void;
}

export interface PDFViewerInteractionsCallbacks {
  onScaleChange?: (scale: number) => void;
  onPageChange?: (page: number) => void;
  onAnnotationToolChange?: (tool: 'text' | 'arrow' | 'rectangle' | 'circle' | null) => void;
  onVisualSearchComplete?: (selectionBox: SelectionBox) => void;
  onTitleblockSelectionComplete?: (field: 'sheetNumber' | 'sheetName', selectionBox: SelectionBox) => void;
  onPageShown?: (pageNum: number, viewport: PageViewport) => void;
}

export interface PDFViewerInteractionsOptions
  extends PDFViewerInteractionsRefs,
    PDFViewerInteractionsView,
    PDFViewerInteractionsFile,
    Partial<PDFViewerInteractionsCalibration>,
    PDFViewerInteractionsCallbacks {
  /** Measurement/annotation state and setters from usePDFViewerMeasurements */
  measurements: UsePDFViewerMeasurementsResult;
  /** Computed: selectedMeasurementIds, selectedAnnotationIds */
  selectedMeasurementIds: string[];
  selectedAnnotationIds: string[];
  /** Store selectors / actions (hook can also use stores directly) */
  currentProjectId: string | null;
  getConditionColor: (conditionId: string, fallback?: string) => string;
  /** Render helpers called by handlers */
  renderMarkupsWithPointerEvents: (
    pageNum: number,
    viewport: PageViewport,
    page?: PDFPageProxy,
    forceImmediate?: boolean
  ) => Promise<void>;
  updateMarkupPointerEvents: (selectionMode: boolean) => void;
  /** Apply CSS zoom when PDF render is blocked; pass overrideScale when called from wheel so transform uses new scale before state updates */
  applyInteractiveZoomTransforms: (overrideScale?: number) => void;
  /** Completion handlers (defined in PDFViewer, passed in) */
  completeMeasurement: (points: { x: number; y: number }[]) => Promise<void>;
  completeCutout: (points: { x: number; y: number }[]) => Promise<void>;
  completeContinuousLinearMeasurement: () => Promise<void>;
  /** Props */
  cutoutMode?: boolean;
  annotationTool?: 'text' | 'arrow' | 'rectangle' | 'circle' | null;
  annotationColor?: string;
  visualSearchMode?: boolean;
  titleblockSelectionMode?: 'sheetNumber' | 'sheetName' | null;
  pdfDocument: unknown;
}

export interface UsePDFViewerInteractionsResult {
  getCssCoordsFromEvent: (ev: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => { x: number; y: number } | null;
  handleMouseDown: (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => void;
  handleMouseUp: (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => Promise<void>;
  handleMouseMove: (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => void;
  handleClick: (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => Promise<void>;
  handleDoubleClick: (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => void;
  handleWheel: (event: WheelEvent) => void;
  handleKeyDown: (event: KeyboardEvent) => Promise<void>;
  handleCanvasDoubleClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleSvgClick: (e: React.MouseEvent<SVGSVGElement>) => void;
  handleSvgDoubleClick: (e: React.MouseEvent<SVGSVGElement>) => void;
}
