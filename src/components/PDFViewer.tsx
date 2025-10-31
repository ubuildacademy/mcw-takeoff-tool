import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { useTakeoffStore } from '../store/useTakeoffStore';
import type { SearchResult, Annotation } from '../types';
import CalibrationDialog from './CalibrationDialog';
import ScaleApplicationDialog from './ScaleApplicationDialog';
import { formatFeetAndInches } from '../lib/utils';
import { calculateDistance } from '../utils/commonUtils';

// Configure PDF.js worker with performance optimizations
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// Configure PDF.js for better performance
pdfjsLib.GlobalWorkerOptions.workerPort = null; // Use default port

interface PDFViewerProps {
  file: File | string | any;
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
  onPDFLoaded?: (totalPages: number) => void;
  onCalibrationRequest?: () => void;
  onCalibrationComplete?: (isCalibrated: boolean, scaleFactor: number, unit: string) => void;
  searchResults?: SearchResult[];
  currentSearchQuery?: string;
  cutoutMode?: boolean;
  cutoutTargetConditionId?: string | null;
  onCutoutModeChange?: (conditionId: string | null) => void;
  onMeasurementStateChange?: (isMeasuring: boolean, isCalibrating: boolean, measurementType: string, isOrthoSnapping: boolean) => void;
  annotationTool?: 'text' | 'freehand' | 'arrow' | 'rectangle' | 'circle' | null;
  annotationColor?: string;
  onAnnotationToolChange?: (tool: 'text' | 'freehand' | 'arrow' | 'rectangle' | 'circle' | null) => void;
  onLocationChange?: (x: number, y: number) => void;
  onPDFRendered?: () => void;
  // Visual search props
  visualSearchMode?: boolean;
  visualSearchCondition?: any;
  onVisualSearchComplete?: (selectionBox: {x: number, y: number, width: number, height: number}) => void;
}

interface Measurement {
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
  cutouts?: Array<{
    id: string;
    points: Array<{ x: number; y: number }>;
    pdfCoordinates: Array<{ x: number; y: number }>;
    calculatedValue: number;
  }>;
  netCalculatedValue?: number;
  // Legacy support
  color?: string;
}

const PDFViewer: React.FC<PDFViewerProps> = ({ 
  file, 
  className = '',
  currentPage: externalCurrentPage,
  totalPages: externalTotalPages,
  onPageChange,
  scale: externalScale,
  onScaleChange,
  rotation: externalRotation,
  onCalibrateScale,
  onClearAll,
  isPageCalibrated: externalIsPageCalibrated,
  scaleFactor: externalScaleFactor,
  unit: externalUnit,
  onPDFLoaded,
  onCalibrationRequest,
  onCalibrationComplete,
  searchResults = [],
  currentSearchQuery = '',
  cutoutMode = false,
  cutoutTargetConditionId = null,
  onCutoutModeChange,
  onMeasurementStateChange,
  annotationTool = null,
  annotationColor = '#FF0000',
  onAnnotationToolChange,
  onLocationChange,
  onPDFRendered,
  // Visual search props
  visualSearchMode = false,
  visualSearchCondition = null,
  onVisualSearchComplete
}) => {
  // Core PDF state
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [internalCurrentPage, setInternalCurrentPage] = useState(1);
  const [internalTotalPages, setInternalTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // View state
  const [internalViewState, setInternalViewState] = useState({ 
    scale: 1.0, 
    rotation: 0
  });
  
  // Use external props when available, fall back to internal state
  const currentPage = externalCurrentPage ?? internalCurrentPage;
  const totalPages = externalTotalPages ?? internalTotalPages;
  
  const viewState = useMemo(() => ({ 
    scale: externalScale ?? internalViewState.scale, 
    rotation: externalRotation ?? internalViewState.rotation
  }), [externalScale, internalViewState.scale, externalRotation, internalViewState.rotation]);

  // Measurement state
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [measurementType, setMeasurementType] = useState<'linear' | 'area' | 'volume' | 'count'>('linear');
  const [currentMeasurement, setCurrentMeasurement] = useState<{ x: number; y: number }[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  
  // Annotation state
  const [localAnnotations, setLocalAnnotations] = useState<Annotation[]>([]);
  const [currentAnnotation, setCurrentAnnotation] = useState<{ x: number; y: number }[]>([]);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInputPosition, setTextInputPosition] = useState<{ x: number; y: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState('');
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [isCompletingMeasurement, setIsCompletingMeasurement] = useState(false);
  
  // Double-click detection for freehand annotations
  const [lastClickTime, setLastClickTime] = useState<number>(0);
  const [lastClickPosition, setLastClickPosition] = useState<{ x: number; y: number } | null>(null);
  
  // PDF loading state
  const [isPDFLoading, setIsPDFLoading] = useState(false);
  
  // Cut-out state (using external props)
  const [currentCutout, setCurrentCutout] = useState<{ x: number; y: number }[]>([]);
  
  // Visual search state
  const [isSelectingSymbol, setIsSelectingSymbol] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  
  // Selection state for deleting markups
  const [selectedMarkupId, setSelectedMarkupId] = useState<string | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  
  // Continuous linear drawing state
  const [isContinuousDrawing, setIsContinuousDrawing] = useState(false);
  const [activePoints, setActivePoints] = useState<{ x: number; y: number }[]>([]);
  const [rubberBandElement, setRubberBandElement] = useState<SVGLineElement | null>(null);
  const [runningLength, setRunningLength] = useState<number>(0);
  
  // Ortho snapping state
  const [isOrthoSnapping, setIsOrthoSnapping] = useState(false);
  
  // Track last fully rendered PDF scale to support interactive CSS zoom while blocking renders
  const lastRenderedScaleRef = useRef(1.0);
  
  // Helper to apply/remove interactive CSS zoom transforms when renders are blocked
  const applyInteractiveZoomTransforms = useCallback(() => {
    const canvas = pdfCanvasRef.current as HTMLCanvasElement | null;
    const svg = svgOverlayRef.current as SVGSVGElement | null;
    if (!canvas || !svg || !pdfPageRef.current) return;
    
    const renderedScale = lastRenderedScaleRef.current || 1.0;
    const targetScale = (viewState.scale || 1.0) / renderedScale;
    
    // If targetScale is ~1, clear transforms
    if (Math.abs(targetScale - 1) < 0.0001) {
      canvas.style.transform = '';
      svg.style.transform = '';
      canvas.style.transformOrigin = '';
      svg.style.transformOrigin = '';
      return;
    }
    
    // Apply transform to both canvas and overlay to keep them in sync visually
    canvas.style.transformOrigin = '0 0';
    svg.style.transformOrigin = '0 0';
    canvas.style.transform = `scale(${targetScale})`;
    svg.style.transform = `scale(${targetScale})`;
  }, [viewState.scale]);
  
  // Page-scoped refs to prevent cross-page DOM issues
  const pageRubberBandRefs = useRef<Record<number, SVGLineElement | null>>({});
  const pageCommittedPolylineRefs = useRef<Record<number, SVGPolylineElement | null>>({});
  
  // Scale calibration
  const [internalScaleFactor, setInternalScaleFactor] = useState(1);
  const [internalIsPageCalibrated, setInternalIsPageCalibrated] = useState(false);
  const [internalUnit, setInternalUnit] = useState('ft');
  
  const scaleFactor = externalScaleFactor ?? internalScaleFactor;
  const isPageCalibrated = externalIsPageCalibrated ?? internalIsPageCalibrated;
  const unit = externalUnit ?? internalUnit;
  
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [isDeselecting, setIsDeselecting] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<{ x: number; y: number }[]>([]);
  const [showCalibrationDialog, setShowCalibrationDialog] = useState(false);
  const [showScaleApplicationDialog, setShowScaleApplicationDialog] = useState(false);
  const [pendingScaleData, setPendingScaleData] = useState<{scaleFactor: number, unit: string} | null>(null);
  const [calibrationData, setCalibrationData] = useState<{knownDistance: number, unit: string} | null>(null);
  // Temporary calibration validation overlay state
  const [calibrationValidation, setCalibrationValidation] = useState<{
    points: { x: number; y: number }[];
    display: string;
    page: number;
  } | null>(null);
  // Temporary measurement debug overlay (compare calc paths)
  const [measurementDebug, setMeasurementDebug] = useState<{
    page: number;
    mid: { x: number; y: number };
    dxNorm: number; dyNorm: number;
    baseW: number; baseH: number;
    pixelDistanceValidator: number;
    pixelDistanceMeasure: number;
    scaleFactorUsed: number;
    distanceValidatorFt: number;
    distanceMeasureFt: number;
  } | null>(null);
  
  // Refs - Single Canvas + SVG Overlay System
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const svgOverlayRef = useRef<SVGSVGElement>(null);
  const pdfPageRef = useRef<any>(null);
  const calibrationViewportRef = useRef<{
    scaleFactor: number;
    unit: string;
    viewportWidth: number;
    viewportHeight: number;
    scale: number;
    rotation: number;
  } | null>(null);
  const renderTaskRef = useRef<any>(null);
  const isRenderingRef = useRef<boolean>(false);
  const [isComponentMounted, setIsComponentMounted] = useState(false);
  
  // Notify parent component of measurement state changes
  useEffect(() => {
    if (onMeasurementStateChange) {
      onMeasurementStateChange(isMeasuring, isCalibrating, measurementType, isOrthoSnapping);
    }
  }, [isMeasuring, isCalibrating, measurementType, isOrthoSnapping, onMeasurementStateChange]);

  // Page-specific viewport and transform state for proper isolation
  const [pageViewports, setPageViewports] = useState<Record<number, any>>({});
  const [pageOutputScales, setPageOutputScales] = useState<Record<number, number>>({});
  
  // Performance optimization: track if initial render is complete
  const [isInitialRenderComplete, setIsInitialRenderComplete] = useState(false);
  
  // Current page viewport (computed from page-specific state)
  const currentViewport = useMemo(() => {
    return pageViewports[currentPage] || null;
  }, [pageViewports, currentPage]);
  
  const currentOutputScale = useMemo(() => {
    return pageOutputScales[currentPage] || 1;
  }, [pageOutputScales, currentPage]);


  // Calculate running length for continuous linear drawing
  const calculateRunningLength = useCallback((points: { x: number; y: number }[], currentMousePos?: { x: number; y: number }) => {
    if (!currentViewport || points.length === 0) return 0;
    
    const allPoints = currentMousePos ? [...points, currentMousePos] : points;
    if (allPoints.length < 2) return 0;
    
    let totalDistance = 0;
    for (let i = 1; i < allPoints.length; i++) {
      const dx = (allPoints[i].x - allPoints[i - 1].x) * currentViewport.width;
      const dy = (allPoints[i].y - allPoints[i - 1].y) * currentViewport.height;
      totalDistance += Math.sqrt(dx * dx + dy * dy);
    }
    
    // Convert pixels to real-world units. Scale factor is units per pixel.
    return totalDistance * scaleFactor;
  }, [currentViewport, scaleFactor]);

  // Ortho snapping function - snaps to horizontal or vertical lines
  const applyOrthoSnapping = useCallback((currentPos: { x: number; y: number }, referencePoints: { x: number; y: number }[]) => {
    if (!isOrthoSnapping || referencePoints.length === 0) {
      return currentPos;
    }

    // Get the last reference point (most recent point in the measurement)
    const lastPoint = referencePoints[referencePoints.length - 1];
    
    // Calculate the distance from current position to the last point
    const dx = currentPos.x - lastPoint.x;
    const dy = currentPos.y - lastPoint.y;
    
    // Determine if we should snap to horizontal or vertical
    // If the horizontal distance is greater, snap to horizontal (keep Y, adjust X)
    // If the vertical distance is greater, snap to vertical (keep X, adjust Y)
    if (Math.abs(dx) > Math.abs(dy)) {
      // Snap to horizontal line (keep Y coordinate of last point)
      return { x: currentPos.x, y: lastPoint.y };
    } else {
      // Snap to vertical line (keep X coordinate of last point)
      return { x: lastPoint.x, y: currentPos.y };
    }
  }, [isOrthoSnapping]);

  // Store integration
  const { 
    currentProjectId, 
    selectedConditionId,
    getSelectedCondition,
    annotations: storeAnnotations,
    addAnnotation,
    getPageAnnotations
  } = useTakeoffStore();
  
  // Get takeoff measurements with a specific selector to ensure proper subscription
  const takeoffMeasurements = useTakeoffStore(state => state.takeoffMeasurements);
  
  // Load existing takeoff measurements for the current sheet - reactive to store changes
  const [localTakeoffMeasurements, setLocalTakeoffMeasurements] = useState<any[]>([]);
  
  // Load annotations for the entire sheet - reactive to store changes
  useEffect(() => {
    if (currentProjectId && file?.id) {
      // Get all annotations for this sheet, we'll filter by page during render
      const sheetAnnotations = storeAnnotations.filter(
        a => a.projectId === currentProjectId && a.sheetId === file.id
      );
      setLocalAnnotations(sheetAnnotations);
    } else {
      setLocalAnnotations([]);
    }
  }, [currentProjectId, file?.id, storeAnnotations]);

  // Load measurements for current page using direct filtering (like annotations)
  useEffect(() => {
    if (!currentProjectId || !file?.id || !currentPage) {
      setLocalTakeoffMeasurements([]);
      return;
    }
    
    // Filter measurements directly like annotations do - bypass the complex key system
    const pageMeasurements = takeoffMeasurements.filter(measurement => 
      measurement.projectId === currentProjectId && 
      measurement.sheetId === file.id && 
      measurement.pdfPage === currentPage
    );
    
    // Debug logging to help troubleshoot
    if (takeoffMeasurements.length > 0) {
      console.log('🔍 PDFViewer: Measurement filtering debug', {
        totalMeasurements: takeoffMeasurements.length,
        currentProjectId,
        fileId: file.id,
        currentPage,
        pageMeasurementsCount: pageMeasurements.length,
        sampleMeasurement: takeoffMeasurements[0] ? {
          projectId: takeoffMeasurements[0].projectId,
          sheetId: takeoffMeasurements[0].sheetId,
          pdfPage: takeoffMeasurements[0].pdfPage
        } : null,
        allMeasurements: takeoffMeasurements.map(m => ({
          id: m.id,
          projectId: m.projectId,
          sheetId: m.sheetId,
          pdfPage: m.pdfPage,
          type: m.type
        }))
      });
    }
    
    // Convert API measurements to display format
    const displayMeasurements = pageMeasurements.map(apiMeasurement => {
      try {
        return {
          id: apiMeasurement.id,
          type: apiMeasurement.type,
          points: apiMeasurement.points,
          calculatedValue: apiMeasurement.calculatedValue,
          unit: apiMeasurement.unit,
          conditionId: apiMeasurement.conditionId,
          conditionName: apiMeasurement.conditionName,
          color: apiMeasurement.conditionColor,
          timestamp: new Date(apiMeasurement.timestamp).getTime(),
          pdfPage: apiMeasurement.pdfPage,
          pdfCoordinates: apiMeasurement.pdfCoordinates,
          perimeterValue: apiMeasurement.perimeterValue || null,
          cutouts: apiMeasurement.cutouts || null,
          netCalculatedValue: apiMeasurement.netCalculatedValue || null
        };
      } catch (error) {
        console.error('Error processing measurement:', error, apiMeasurement);
        return null;
      }
    }).filter(Boolean);
    
    setLocalTakeoffMeasurements(displayMeasurements);
    
    // If we have measurements and a viewport is available, trigger a re-render
    if (displayMeasurements.length > 0 && currentViewport) {
      // Use setTimeout to ensure state is updated before re-rendering
      setTimeout(() => {
        renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
      }, 0);
    }
  }, [currentProjectId, file?.id, currentPage, takeoffMeasurements, currentViewport]);

  // Ensure component is mounted before rendering
  useEffect(() => {
    setIsComponentMounted(true);
    return () => setIsComponentMounted(false);
  }, []);

  // Additional effect to ensure measurements are rendered when added
  useEffect(() => {
    if (localTakeoffMeasurements.length > 0 && pdfDocument && currentViewport && !isRenderingRef.current) {
      console.log('🔄 PDFViewer: Additional effect - rendering measurements', {
        localTakeoffMeasurementsCount: localTakeoffMeasurements.length,
        currentPage,
        hasPdfDocument: !!pdfDocument,
        hasCurrentViewport: !!currentViewport
      });
      // Note: renderTakeoffAnnotations will be called by the existing useEffect that watches localTakeoffMeasurements
    }
  }, [localTakeoffMeasurements, currentPage, pdfDocument, currentViewport]);

  // Handle visual search mode
  useEffect(() => {
    if (visualSearchMode) {
      setIsSelectingSymbol(true);
      setSelectionBox(null);
      setSelectionStart(null);
    } else {
      setIsSelectingSymbol(false);
      setSelectionBox(null);
      setSelectionStart(null);
    }
  }, [visualSearchMode]);

  // Load PDF document
  useEffect(() => {
    const loadPDF = async () => {
      if (!file) {
        return;
      }
      
      setIsLoading(true);
      setError(null);
      
      let pdfUrl: string | undefined;
      try {
        if (typeof file === 'string') {
          pdfUrl = file;
        } else if (file instanceof File) {
          pdfUrl = URL.createObjectURL(file);
        } else if (file && file.id) {
          pdfUrl = `http://localhost:4000/api/files/${file.id}`;
        } else {
          throw new Error('Invalid file object provided');
        }
        
        const pdf = await pdfjsLib.getDocument({
          url: pdfUrl,
          // Performance optimizations
          disableAutoFetch: false,
          disableStream: false,
          disableRange: false,
          // Enable caching for better performance
          cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
          cMapPacked: true,
          // Optimize for faster loading
          maxImageSize: 1024 * 1024, // 1MB max image size
          isEvalSupported: false, // Disable eval for security and performance
        }).promise;
        setPdfDocument(pdf);
        
        if (externalTotalPages === undefined) {
          setInternalTotalPages(pdf.numPages);
        }
        if (externalCurrentPage === undefined) {
          setInternalCurrentPage(1);
        }
        
        if (onPDFLoaded) {
          onPDFLoaded(pdf.numPages);
        }
        
      } catch (error: any) {
        console.error('Error loading PDF:', error);
        setError('Failed to load PDF file');
      } finally {
        setIsLoading(false);
      }
    };

    loadPDF();
  }, [file]);


  // Sync external cut-out state with internal state
  useEffect(() => {
    if (!cutoutMode) {
      // Clear current cut-out when cut-out mode is turned off
      setCurrentCutout([]);
    }
  }, [cutoutMode]);

  // Track previous file ID to prevent unnecessary clearing
  const prevFileIdRef = useRef<string | undefined>(undefined);
  
  // Clear measurements and cleanup when file changes
  useEffect(() => {
    const currentFileId = file?.id;
    const prevFileId = prevFileIdRef.current;
    
    // Only clear if the file ID actually changed
    if (currentFileId !== prevFileId) {
      setLocalTakeoffMeasurements([]);
      prevFileIdRef.current = currentFileId;
    }
    
    // Cancel any pending operations
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }
    
    // Clear canvas context
    if (pdfCanvasRef.current) {
      const context = pdfCanvasRef.current.getContext('2d');
      if (context) {
        context.clearRect(0, 0, pdfCanvasRef.current.width, pdfCanvasRef.current.height);
        context.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    
    // Clear SVG overlay
    if (svgOverlayRef.current) {
      svgOverlayRef.current.innerHTML = '';
    }
    
    // Reset rendering flags
    isRenderingRef.current = false;
  }, [file?.id]);

  // Page-specific canvas sizing with outputScale for crisp rendering
  const updateCanvasDimensions = useCallback((pageNum: number, viewport: any, outputScale: number, page?: any) => {
    if (!pdfCanvasRef.current || !svgOverlayRef.current) return;
    
    const pdfCanvas = pdfCanvasRef.current;
    const svgOverlay = svgOverlayRef.current;
    
    // Set canvas bitmap size to viewport * outputScale for crisp rendering
    const canvasWidth = Math.round(viewport.width * outputScale);
    const canvasHeight = Math.round(viewport.height * outputScale);
    
    // Set canvas CSS size to viewport logical size
    pdfCanvas.width = canvasWidth;
    pdfCanvas.height = canvasHeight;
    pdfCanvas.style.width = `${viewport.width}px`;
    pdfCanvas.style.height = `${viewport.height}px`;
    
    // Set SVG overlay to match viewport dimensions exactly for this specific page
    svgOverlay.setAttribute('width', viewport.width.toString());
    svgOverlay.setAttribute('height', viewport.height.toString());
    svgOverlay.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
    
    // Store page-specific viewport and output scale
    setPageViewports(prev => ({ ...prev, [pageNum]: viewport }));
    setPageOutputScales(prev => ({ ...prev, [pageNum]: outputScale }));
    
    
  }, []);


  // SVG-based takeoff annotation renderer - Page-specific with viewport isolation
  const renderTakeoffAnnotations = useCallback((pageNum: number, viewport: any, page?: any) => {
    if (!viewport || !svgOverlayRef.current) return;
    
    const svgOverlay = svgOverlayRef.current;
    
    // Ensure SVG overlay coordinate system matches the provided viewport
    // This prevents drift when re-rendering overlay without a full PDF re-render
    if (
      svgOverlay.getAttribute('width') !== String(viewport.width) ||
      svgOverlay.getAttribute('height') !== String(viewport.height)
    ) {
      svgOverlay.setAttribute('width', viewport.width.toString());
      svgOverlay.setAttribute('height', viewport.height.toString());
      svgOverlay.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
    }
    
    console.log('🎨 PDFViewer: renderTakeoffAnnotations called', {
      pageNum,
      localTakeoffMeasurementsCount: localTakeoffMeasurements.length,
      localTakeoffMeasurements: localTakeoffMeasurements
    });
    
    // Clear existing annotations completely - this ensures no cross-page contamination
    svgOverlay.innerHTML = '';
    
    // Only render measurements for the specific page being rendered
    localTakeoffMeasurements.forEach((measurement) => {
      // Double-check that this measurement belongs to the page being rendered
      if (measurement.pdfPage === pageNum) {
        console.log('🎨 PDFViewer: Rendering measurement for page', {
          measurementId: measurement.id,
          measurementType: measurement.type,
          measurementPage: measurement.pdfPage,
          currentPage: pageNum
        });
        renderSVGMeasurement(svgOverlay, measurement, viewport, page);
      }
    });

    // Draw calibration validator overlay if present for this page
    if (calibrationValidation && calibrationValidation.page === pageNum && calibrationValidation.points.length === 2) {
      const p1 = calibrationValidation.points[0];
      const p2 = calibrationValidation.points[1];
      const x1 = p1.x * viewport.width;
      const y1 = p1.y * viewport.height;
      const x2 = p2.x * viewport.width;
      const y2 = p2.y * viewport.height;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1.toString());
      line.setAttribute('y1', y1.toString());
      line.setAttribute('x2', x2.toString());
      line.setAttribute('y2', y2.toString());
      line.setAttribute('stroke', '#22c55e');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', '6,4');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      svgOverlay.appendChild(line);

      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', midX.toString());
      text.setAttribute('y', (midY - 8).toString());
      text.setAttribute('fill', '#16a34a');
      text.setAttribute('font-size', '12');
      text.setAttribute('font-family', 'Arial');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('vector-effect', 'non-scaling-stroke');
      text.textContent = calibrationValidation.display;
      svgOverlay.appendChild(text);
    }

    // Draw measurement debug overlay if present
    if (measurementDebug && measurementDebug.page === pageNum) {
      const { mid, dxNorm, dyNorm, baseW, baseH, pixelDistanceValidator, pixelDistanceMeasure, scaleFactorUsed, distanceValidatorFt, distanceMeasureFt } = measurementDebug;
      const midX = mid.x * viewport.width;
      const midY = mid.y * viewport.height;
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', (midX - 140).toString());
      bg.setAttribute('y', (midY - 60).toString());
      bg.setAttribute('width', '280');
      bg.setAttribute('height', '54');
      bg.setAttribute('fill', 'rgba(0,0,0,0.65)');
      bg.setAttribute('rx', '6');
      svgOverlay.appendChild(bg);
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', midX.toString());
      t.setAttribute('y', (midY - 42).toString());
      t.setAttribute('fill', '#fff');
      t.setAttribute('font-size', '12');
      t.setAttribute('font-family', 'Arial');
      t.setAttribute('text-anchor', 'middle');
      t.textContent = `dx=${dxNorm.toFixed(4)} dy=${dyNorm.toFixed(4)} base=(${baseW.toFixed(1)},${baseH.toFixed(1)})`;
      svgOverlay.appendChild(t);
      const t2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t2.setAttribute('x', midX.toString());
      t2.setAttribute('y', (midY - 26).toString());
      t2.setAttribute('fill', '#fff');
      t2.setAttribute('font-size', '12');
      t2.setAttribute('font-family', 'Arial');
      t2.setAttribute('text-anchor', 'middle');
      t2.textContent = `px(valid)=${pixelDistanceValidator.toFixed(2)} px(meas)=${pixelDistanceMeasure.toFixed(2)} sf=${scaleFactorUsed.toExponential(6)}`;
      svgOverlay.appendChild(t2);
      const t3 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t3.setAttribute('x', midX.toString());
      t3.setAttribute('y', (midY - 10).toString());
      t3.setAttribute('fill', '#fff');
      t3.setAttribute('font-size', '12');
      t3.setAttribute('font-family', 'Arial');
      t3.setAttribute('text-anchor', 'middle');
      t3.textContent = `${formatFeetAndInches(distanceValidatorFt)} vs ${formatFeetAndInches(distanceMeasureFt)}`;
      svgOverlay.appendChild(t3);
    }
    
    // Draw current measurement being created (only if on the page being rendered)
    if (isMeasuring && pageNum === currentPage) {
      // For linear measurements in continuous mode, check activePoints
      // For other measurements, check currentMeasurement
      const hasMeasurementPoints = (measurementType === 'linear' && isContinuousDrawing && activePoints.length > 0) || 
                                   (measurementType !== 'linear' && currentMeasurement.length > 0) ||
                                   (measurementType === 'linear' && !isContinuousDrawing && currentMeasurement.length > 0);
      
      if (hasMeasurementPoints) {
        // Always render preview for linear, area, and volume from first point
        // Only count measurements need to wait for completion
        if (measurementType !== 'count') {
          renderSVGCurrentMeasurement(svgOverlay, viewport);
        }
      }
    }
    
    // Draw current cut-out being created (only if on the page being rendered)
    if (cutoutMode && currentCutout.length > 0 && pageNum === currentPage) {
      renderSVGCurrentCutout(svgOverlay, viewport);
    }
    
    // Draw visual search selection box (only if on the page being rendered)
    if (visualSearchMode && isSelectingSymbol && selectionBox && pageNum === currentPage) {
      renderSVGSelectionBox(svgOverlay, selectionBox, viewport);
    }
    
    // Render completed annotations for this page
    localAnnotations.forEach(annotation => {
      // Double-check that this annotation belongs to the page being rendered
      if (annotation.pageNumber === pageNum) {
        renderSVGAnnotation(svgOverlay, annotation, viewport);
      }
    });
    
    // Draw current annotation being created (only if on the page being rendered)
    // Show preview even with no points yet (for initial mouse tracking)
    if (annotationTool && pageNum === currentPage) {
      renderSVGCurrentAnnotation(svgOverlay, viewport);
    }
    
    // Draw calibration points (only if on the page being rendered)
    if (isCalibrating && calibrationPoints.length > 0 && pageNum === currentPage) {
      renderSVGCalibrationPoints(svgOverlay);
    }
    
    // Draw crosshair if measuring, calibrating, or annotating (only if on the page being rendered)
    if (mousePosition && (isMeasuring || isCalibrating || annotationTool) && pageNum === currentPage) {
      renderSVGCrosshair(svgOverlay, mousePosition, viewport, isCalibrating);
    }
    
    // Draw running length display for continuous linear drawing
    if (isContinuousDrawing && activePoints.length > 0 && pageNum === currentPage) {
      renderRunningLengthDisplay(svgOverlay, viewport);
    }
    
  }, [localTakeoffMeasurements, currentMeasurement, measurementType, isMeasuring, isCalibrating, calibrationPoints, mousePosition, selectedMarkupId, isSelectionMode, currentPage, isContinuousDrawing, activePoints, runningLength, localAnnotations, annotationTool, currentAnnotation, cutoutMode, currentCutout, visualSearchMode, isSelectingSymbol, selectionBox]);

  // Re-render annotations when measurements or interaction state changes
  useEffect(() => {
    console.log('🔄 PDFViewer: Re-render useEffect triggered', {
      pdfDocument: !!pdfDocument,
      currentViewport: !!currentViewport,
      isRendering: isRenderingRef.current,
      localTakeoffMeasurementsCount: localTakeoffMeasurements.length,
      isMeasuring,
      isCalibrating,
      currentMeasurementLength: currentMeasurement.length,
      isAnnotating,
      localAnnotationsLength: localAnnotations.length,
      visualSearchMode,
      isSelectingSymbol,
      currentPage
    });
    
    if (pdfDocument && currentViewport && !isRenderingRef.current) {
      // Only render if we have measurements, annotations, or if we're in measuring/annotation/visual search mode
      if (localTakeoffMeasurements.length > 0 || isMeasuring || isCalibrating || currentMeasurement.length > 0 || isAnnotating || localAnnotations.length > 0 || (visualSearchMode && isSelectingSymbol)) {
        console.log('🎨 PDFViewer: Triggering renderTakeoffAnnotations');
        renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
      } else {
        console.log('🎨 PDFViewer: Skipping render - no measurements or active modes');
      }
    }
  }, [localTakeoffMeasurements, currentMeasurement, isMeasuring, isCalibrating, calibrationPoints, mousePosition, selectedMarkupId, isSelectionMode, renderTakeoffAnnotations, currentPage, currentViewport, isAnnotating, localAnnotations, visualSearchMode, isSelectingSymbol, currentAnnotation]);

  // Force immediate re-render of markups when viewport changes
  const forceMarkupReRender = useCallback(() => {
    if (pdfDocument && pdfPageRef.current && localTakeoffMeasurements.length > 0) {
      // Create fresh viewport with current parameters
      const freshViewport = pdfPageRef.current.getViewport({ 
        scale: viewState.scale, 
        rotation: viewState.rotation 
      });
      
      // Update the page viewports to trigger re-render
      setPageViewports(prev => ({
        ...prev,
        [currentPage]: freshViewport
      }));
      
      // Immediately re-render all markups
      requestAnimationFrame(() => {
        renderTakeoffAnnotations(currentPage, freshViewport, pdfPageRef.current);
      });
    }
  }, [pdfDocument, viewState.scale, viewState.rotation, localTakeoffMeasurements, currentPage, renderTakeoffAnnotations]);

  // Force re-render measurements when viewport state changes (zoom, rotation)
  useEffect(() => {
    const rendersBlocked = (isMeasuring || isCalibrating || currentMeasurement.length > 0 || isDeselecting || (isAnnotating && !showTextInput));
    if (rendersBlocked) {
      // During interactive zoom/draw, rely solely on CSS transforms to keep overlay in sync
      return;
    }
    if (pdfDocument && currentViewport && localTakeoffMeasurements.length > 0) {
      // Use requestAnimationFrame to ensure the viewport state is fully updated
      requestAnimationFrame(() => {
        renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
      });
    }
  }, [viewState.scale, viewState.rotation, pdfDocument, currentViewport, localTakeoffMeasurements, currentPage, renderTakeoffAnnotations]);

  // Page visibility handler - ensures overlay is properly initialized when page becomes visible
  const onPageShown = useCallback((pageNum: number, viewport: any) => {
    if (!viewport || !svgOverlayRef.current) return;
    
    const svgOverlay = svgOverlayRef.current;
    
    // Ensure SVG overlay has correct dimensions and viewBox for this page
    svgOverlay.setAttribute('width', viewport.width.toString());
    svgOverlay.setAttribute('height', viewport.height.toString());
    svgOverlay.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
    svgOverlay.setAttribute('overflow', 'visible');
    
    // Add a transparent hit area for pointer events
    const existingHitArea = svgOverlay.querySelector('#hit-area');
    if (!existingHitArea) {
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hitArea.setAttribute('id', 'hit-area');
      hitArea.setAttribute('width', '100%');
      hitArea.setAttribute('height', '100%');
      hitArea.setAttribute('fill', 'transparent');
      hitArea.setAttribute('pointer-events', 'all');
      svgOverlay.appendChild(hitArea);
    }
    
    // Always re-render all annotations for this page, regardless of current state
    // This ensures takeoffs are visible immediately when the page loads
    renderTakeoffAnnotations(pageNum, viewport, pdfPageRef.current);
  }, [renderTakeoffAnnotations, localTakeoffMeasurements]);

  // PDF render function with page-specific viewport isolation
  const renderPDFPage = useCallback(async (pageNum: number) => {
    // ANTI-FLICKER: Block PDF renders during interactive operations or deselection cooldown
    // Allow PDF renders during text annotation input (showTextInput = true)
    // Allow initial renders even if in deselection mode (for page loads)
    // Block renders during interactive operations to prevent flicker
    if (isMeasuring || isCalibrating || currentMeasurement.length > 0 || (isDeselecting && isInitialRenderComplete) || (isAnnotating && !showTextInput)) {
      return;
    }
    
    // Show loading indicator for initial renders
    if (!isInitialRenderComplete) {
      setIsPDFLoading(true);
    }
    
    // Reduced delay for better performance
    await new Promise(resolve => setTimeout(resolve, 5));
    
    if (!isComponentMounted || !pdfDocument || !pdfCanvasRef.current || !containerRef.current) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('PDF render skipped: missing dependencies', { pageNum });
      }
      return;
    }
    
    if (isRenderingRef.current) {
      if (process.env.NODE_ENV === 'development') {
        // console.log('🚫 PDF RENDER BLOCKED: Already rendering');
      }
      return;
    }
    isRenderingRef.current = true;

    try {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      const page = await pdfDocument.getPage(pageNum);
      pdfPageRef.current = page;
      
      // Double-check canvas is still mounted after async operation
      const pdfCanvas = pdfCanvasRef.current;
      if (!pdfCanvas || !containerRef.current) {
        console.warn('PDF canvas or container unmounted during render, skipping');
        return;
      }
      
      const pdfContext = pdfCanvas.getContext('2d');
      if (!pdfContext) {
        console.warn('PDF canvas context is null, skipping render');
        return;
      }

      // Create page-specific viewport with current scale and rotation
      const viewport = page.getViewport({ 
        scale: viewState.scale,
        rotation: viewState.rotation
      });
      
      // Calculate outputScale for crisp rendering
      const outputScale = window.devicePixelRatio || 1;
      
      // Update canvas and SVG dimensions with page-specific data
      updateCanvasDimensions(pageNum, viewport, outputScale, page);
      
      // Clear canvas
      pdfContext.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
      pdfContext.setTransform(1, 0, 0, 1, 0, 0);
      
      // Clear SVG overlay completely to prevent cross-page contamination
      if (svgOverlayRef.current) {
        svgOverlayRef.current.innerHTML = '';
      }
      
      // Render with page-specific transform for outputScale - optimized for performance
      const renderContext = {
        canvasContext: pdfContext,
        viewport: viewport,
        transform: [outputScale, 0, 0, outputScale, 0, 0],
        // Performance optimizations
        enableWebGL: false, // Disable WebGL for better compatibility and performance
        renderInteractiveForms: false, // Disable interactive forms for better performance
      };
      
      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      
      // After PDF is rendered, ensure overlay is properly initialized and render takeoff annotations
      onPageShown(pageNum, viewport);
      
      // Record the scale at which the PDF canvas was actually rendered
      lastRenderedScaleRef.current = viewState.scale;
      
      // Clear any interactive CSS transforms (no longer needed after full render)
      if (pdfCanvasRef.current) {
        pdfCanvasRef.current.style.transform = '';
        pdfCanvasRef.current.style.transformOrigin = '';
      }
      if (svgOverlayRef.current) {
        svgOverlayRef.current.style.transform = '';
        svgOverlayRef.current.style.transformOrigin = '';
      }
      // Post-zoom settle: ensure overlay is refreshed immediately after canvas render
      try {
        renderTakeoffAnnotations(pageNum, viewport, page);
        // And one more pass on next frame to catch late layout
        requestAnimationFrame(() => {
          renderTakeoffAnnotations(pageNum, viewport, page);
        });
      } catch {}
      
      // Reduced logging for better performance
      if (process.env.NODE_ENV === 'development') {
        console.log('✅ PDF RENDER COMPLETE:', { pageNum, timestamp: Date.now() });
      }
      
      // Mark initial render as complete and notify parent
      if (pageNum === currentPage) {
        setIsInitialRenderComplete(true);
        setIsPDFLoading(false); // Hide loading indicator
        if (onPDFRendered) {
          onPDFRendered();
        }
      }
      
    } catch (error: any) {
      if (error.name !== 'RenderingCancelledException') {
        console.error('Error rendering PDF page:', error);
      }
    } finally {
      isRenderingRef.current = false;
    }
  }, [pdfDocument, viewState, updateCanvasDimensions, onPageShown, isComponentMounted, isMeasuring, isCalibrating, currentMeasurement, isDeselecting, isAnnotating]);

  // No coordinate conversions needed - SVG viewBox matches viewport exactly
  // CSS pixels = SVG pixels = viewport pixels (1:1 mapping)

  // Render individual measurement as SVG
  const renderSVGMeasurement = (svg: SVGSVGElement, measurement: Measurement, viewport: any, page?: any) => {
    console.log('🎨 renderSVGMeasurement called', {
      measurementId: measurement.id,
      measurementType: measurement.type,
      pointsCount: measurement.points?.length,
      points: measurement.points,
      viewport: viewport,
      svgElement: svg
    });
    
    if (!measurement || !measurement.points || !viewport) {
      console.log('❌ renderSVGMeasurement: Missing required data', {
        hasMeasurement: !!measurement,
        hasPoints: !!measurement?.points,
        hasViewport: !!viewport
      });
      return;
    }
    
    const points = measurement.points;
    if (points.length < 1) {
      console.log('❌ renderSVGMeasurement: Not enough points', { pointsLength: points.length });
      return;
    }
    
    // For count measurements, we only need 1 point
    if (measurement.type === 'count' && points.length < 1) return;
    // For other measurements, we need at least 2 points
    if (measurement.type !== 'count' && points.length < 2) {
      console.log('❌ renderSVGMeasurement: Not enough points for non-count measurement', { 
        type: measurement.type, 
        pointsLength: points.length 
      });
      return;
    }
    
    // Transform points to match current viewport
    // Points are stored in PDF coordinates - convert to viewport coordinates for rendering
    const pdfPage = pdfPageRef.current;
    if (!pdfPage) return;
    
    // Use baseline scale during interactive zoom to avoid double scaling
    const interactiveBlocked = (isMeasuring || isCalibrating || currentMeasurement.length > 0 || isDeselecting || (isAnnotating && !showTextInput));
    const baselineScale = interactiveBlocked ? (lastRenderedScaleRef.current || viewState.scale) : viewState.scale;
    const currentViewport = pdfPage.getViewport({ scale: baselineScale, rotation: viewState.rotation });
    
    // Debug logging for rendering
    console.log('🎨 RENDERING:', {
      measurementId: measurement.id,
      currentScale: viewState.scale,
      currentRotation: viewState.rotation,
      viewport: { width: currentViewport.width, height: currentViewport.height, scale: currentViewport.scale, rotation: currentViewport.rotation },
      originalPoints: points.slice(0, 2) // First 2 points for debugging
    });
    
    // Convert normalized coordinates to current viewport coordinates for rendering
    // Simple and reliable approach
    const transformedPoints = points.map((point, index) => {
      // Convert normalized coordinates to current viewport coordinates
      const canvasX = point.x * currentViewport.width;
      const canvasY = point.y * currentViewport.height;
      
      // Debug logging for first 2 points
      if (index < 2) {
        console.log(`🎨 POINT ${index}:`, {
          normalizedPoint: { x: point.x, y: point.y },
          canvasPoint: { x: canvasX, y: canvasY },
          currentViewport: { width: currentViewport.width, height: currentViewport.height, scale: currentViewport.scale }
        });
      }
      
      return {
        x: canvasX,
        y: canvasY
      };
    });
    
    const isSelected = selectedMarkupId === measurement.id;
    const strokeColor = isSelected ? '#ff0000' : (measurement.color || measurement.conditionColor || '#000000');
    const strokeWidth = isSelected ? '4' : '2';
    
    switch (measurement.type) {
      case 'linear':
        console.log('🎨 Rendering linear measurement', {
          measurementId: measurement.id,
          transformedPoints: transformedPoints,
          viewport: { width: viewport.width, height: viewport.height },
          strokeColor,
          strokeWidth
        });
        
        // Create polyline for linear measurement
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        const pointString = transformedPoints.map(p => {
          // Points are already in viewport pixels after scaling
          return `${p.x},${p.y}`;
        }).join(' ');
        
        console.log('🎨 Linear measurement pointString', { 
          pointString,
          originalPoints: points,
          transformedPoints: transformedPoints,
          viewportDimensions: { width: viewport.width, height: viewport.height }
        });
        
        polyline.setAttribute('points', pointString);
        polyline.setAttribute('stroke', strokeColor);
        polyline.setAttribute('stroke-width', strokeWidth);
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('data-measurement-id', measurement.id);
        
        // Add click handler for selection
        if (isSelectionMode) {
          polyline.style.cursor = 'pointer';
          polyline.addEventListener('click', (e) => {
            e.stopPropagation();
            setSelectedMarkupId(measurement.id);
          });
          
          // Add invisible hit area for easier selection
          const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          hitArea.setAttribute('points', pointString);
          hitArea.setAttribute('stroke', 'transparent');
          hitArea.setAttribute('stroke-width', '20'); // Much larger hit area
          hitArea.setAttribute('fill', 'none');
          hitArea.style.cursor = 'pointer';
          hitArea.addEventListener('click', (e) => {
            e.stopPropagation();
            setSelectedMarkupId(measurement.id);
          });
          svg.appendChild(hitArea);
        }
        
        svg.appendChild(polyline);
        console.log('🎨 Linear measurement polyline appended to SVG', {
          svgChildrenCount: svg.children.length,
          polylineElement: polyline
        });
        
        // Add measurement text
        const startPoint = { x: transformedPoints[0].x, y: transformedPoints[0].y };
        const endPoint = { x: transformedPoints[transformedPoints.length - 1].x, y: transformedPoints[transformedPoints.length - 1].y };
        const midPoint = {
          x: (startPoint.x + endPoint.x) / 2,
          y: (startPoint.y + endPoint.y) / 2
        };
        
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', midPoint.x.toString());
        text.setAttribute('y', (midPoint.y - 5).toString());
        text.setAttribute('fill', strokeColor);
        text.setAttribute('font-size', '12');
        text.setAttribute('font-family', 'Arial');
        text.setAttribute('text-anchor', 'middle');
        
        const displayValue = (measurement.unit === 'ft' || measurement.unit === 'feet' || measurement.unit === 'LF' || measurement.unit === 'lf') 
          ? formatFeetAndInches(measurement.calculatedValue)
          : `${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`;
        text.textContent = displayValue;
        svg.appendChild(text);
        break;
        
      case 'area':
        if (transformedPoints.length >= 3) {
          const pointString = transformedPoints.map(p => {
            // Points are already in viewport pixels after scaling
            return `${p.x},${p.y}`;
          }).join(' ');
          
          // If there are cutouts, create a compound path to show holes
          if (measurement.cutouts && Array.isArray(measurement.cutouts) && measurement.cutouts.length > 0) {
            // Create a compound path using a single path element with evenodd fill rule
            const compoundPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            
            // Start with the main area
            let pathData = `M ${pointString.split(' ')[0]} L ${pointString.split(' ').slice(1).join(' L ')} Z`;
            
            // Add each cutout as a hole
            measurement.cutouts.forEach((cutout) => {
              if (cutout && cutout.points && Array.isArray(cutout.points) && cutout.points.length >= 3) {
                const cutoutPointString = cutout.points.map(p => {
                  const canvasX = p.x * currentViewport.width;
                  const canvasY = p.y * currentViewport.height;
                  return `${canvasX},${canvasY}`;
                }).join(' ');
                pathData += ` M ${cutoutPointString.split(' ')[0]} L ${cutoutPointString.split(' ').slice(1).join(' L ')} Z`;
              }
            });
            
            compoundPath.setAttribute('d', pathData);
            compoundPath.setAttribute('fill-rule', 'evenodd');
            compoundPath.setAttribute('fill', (measurement.color || measurement.conditionColor || '#000000') + '40');
            compoundPath.setAttribute('stroke', strokeColor);
            compoundPath.setAttribute('stroke-width', strokeWidth);
            
            // Add click handler for selection
            if (isSelectionMode) {
              compoundPath.style.cursor = 'pointer';
              compoundPath.addEventListener('click', (e) => {
                e.stopPropagation();
                setSelectedMarkupId(measurement.id);
              });
            }
            
            svg.appendChild(compoundPath);
          } else {
            // Create polygon for area measurement without cutouts
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', pointString);
            polygon.setAttribute('fill', (measurement.color || measurement.conditionColor || '#000000') + '40');
            polygon.setAttribute('stroke', strokeColor);
            polygon.setAttribute('stroke-width', strokeWidth);
            
            // Add click handler for selection
            if (isSelectionMode) {
              polygon.style.cursor = 'pointer';
              polygon.addEventListener('click', (e) => {
                e.stopPropagation();
                setSelectedMarkupId(measurement.id);
              });
              
              // Add invisible hit area for easier selection
              const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
              hitArea.setAttribute('points', pointString);
              hitArea.setAttribute('fill', 'transparent');
              hitArea.setAttribute('stroke', 'transparent');
              hitArea.setAttribute('stroke-width', '10');
              hitArea.style.cursor = 'pointer';
              hitArea.addEventListener('click', (e) => {
                e.stopPropagation();
                setSelectedMarkupId(measurement.id);
              });
              svg.appendChild(hitArea);
            }
            
            svg.appendChild(polygon);
          }
          
          // Add area text
          const centerX = transformedPoints.reduce((sum, p) => sum + p.x, 0) / transformedPoints.length;
          const centerY = transformedPoints.reduce((sum, p) => sum + p.y, 0) / transformedPoints.length;
          
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', centerX.toString());
          text.setAttribute('y', centerY.toString());
          text.setAttribute('fill', strokeColor);
          text.setAttribute('font-size', '12');
          text.setAttribute('font-family', 'Arial');
          text.setAttribute('font-weight', 'bold');
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          
          // Use net value if cutouts exist, otherwise use calculated value
          const displayValue = measurement.netCalculatedValue !== undefined && measurement.netCalculatedValue !== null
            ? measurement.netCalculatedValue 
            : measurement.calculatedValue;
          const areaValue = `${displayValue.toFixed(0)} SF`;
          const finalDisplayValue = measurement.perimeterValue 
            ? `${areaValue} / ${formatFeetAndInches(measurement.perimeterValue)} LF`
            : areaValue;
          text.textContent = finalDisplayValue;
          svg.appendChild(text);
          
          // Cutout outlines are now handled by the clipping path above
        }
        break;
        
      case 'volume':
        if (transformedPoints.length >= 3) {
          const pointString = transformedPoints.map(p => {
            // Points are already in viewport pixels after scaling
            return `${p.x},${p.y}`;
          }).join(' ');
          
          // If there are cutouts, create a compound path to show holes
          if (measurement.cutouts && Array.isArray(measurement.cutouts) && measurement.cutouts.length > 0) {
            // Create a compound path using a single path element with evenodd fill rule
            const compoundPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            
            // Start with the main area
            let pathData = `M ${pointString.split(' ')[0]} L ${pointString.split(' ').slice(1).join(' L ')} Z`;
            
            // Add each cutout as a hole
            measurement.cutouts.forEach((cutout) => {
              if (cutout && cutout.points && Array.isArray(cutout.points) && cutout.points.length >= 3) {
                const cutoutPointString = cutout.points.map(p => {
                  // Convert normalized coordinates to current viewport coordinates
                  const canvasX = p.x * currentViewport.width;
                  const canvasY = p.y * currentViewport.height;
                  return `${canvasX},${canvasY}`;
                }).join(' ');
                pathData += ` M ${cutoutPointString.split(' ')[0]} L ${cutoutPointString.split(' ').slice(1).join(' L ')} Z`;
              }
            });
            
            compoundPath.setAttribute('d', pathData);
            compoundPath.setAttribute('fill-rule', 'evenodd');
            compoundPath.setAttribute('fill', (measurement.color || measurement.conditionColor || '#000000') + '40');
            compoundPath.setAttribute('stroke', strokeColor);
            compoundPath.setAttribute('stroke-width', strokeWidth);
            
            // Add click handler for selection
            if (isSelectionMode) {
              compoundPath.style.cursor = 'pointer';
              compoundPath.addEventListener('click', (e) => {
                e.stopPropagation();
                setSelectedMarkupId(measurement.id);
              });
            }
            
            svg.appendChild(compoundPath);
          } else {
            // Create polygon for volume measurement without cutouts
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', pointString);
            polygon.setAttribute('fill', (measurement.color || measurement.conditionColor || '#000000') + '40');
            polygon.setAttribute('stroke', strokeColor);
            polygon.setAttribute('stroke-width', strokeWidth);
            
            // Add click handler for selection
            if (isSelectionMode) {
              polygon.style.cursor = 'pointer';
              polygon.addEventListener('click', (e) => {
                e.stopPropagation();
                setSelectedMarkupId(measurement.id);
              });
              
              // Add invisible hit area for easier selection
              const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
              hitArea.setAttribute('points', pointString);
              hitArea.setAttribute('fill', 'transparent');
              hitArea.setAttribute('stroke', 'transparent');
              hitArea.setAttribute('stroke-width', '10');
              hitArea.style.cursor = 'pointer';
              hitArea.addEventListener('click', (e) => {
                e.stopPropagation();
                setSelectedMarkupId(measurement.id);
              });
              svg.appendChild(hitArea);
            }
            
            svg.appendChild(polygon);
          }
          
          // Add volume text
          const centerX = transformedPoints.reduce((sum, p) => sum + p.x, 0) / transformedPoints.length;
          const centerY = transformedPoints.reduce((sum, p) => sum + p.y, 0) / transformedPoints.length;
          
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', centerX.toString());
          text.setAttribute('y', centerY.toString());
          text.setAttribute('fill', strokeColor);
          text.setAttribute('font-size', '12');
          text.setAttribute('font-family', 'Arial');
          text.setAttribute('font-weight', 'bold');
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          
          // Use net value if cutouts exist, otherwise use calculated value
          const displayValue = measurement.netCalculatedValue !== undefined && measurement.netCalculatedValue !== null
            ? measurement.netCalculatedValue 
            : measurement.calculatedValue;
          const volumeValue = `${displayValue.toFixed(0)} CY`;
          const finalDisplayValue = measurement.perimeterValue 
            ? `${volumeValue} / ${formatFeetAndInches(measurement.perimeterValue)} LF`
            : volumeValue;
          text.textContent = finalDisplayValue;
          svg.appendChild(text);
          
          // Cutout outlines are now handled by the clipping path above
        }
        break;
        
      case 'count':
        const point = { x: transformedPoints[0].x, y: transformedPoints[0].y };
        
        // Create circle for count measurement
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', point.x.toString());
        circle.setAttribute('cy', point.y.toString());
        circle.setAttribute('r', '8');
        circle.setAttribute('fill', measurement.color || measurement.conditionColor || '#74b9ff');
        circle.setAttribute('stroke', isSelected ? '#ff0000' : '#ffffff');
        circle.setAttribute('stroke-width', isSelected ? '3' : '2');
        
        // Add click handler for selection
        if (isSelectionMode) {
          circle.style.cursor = 'pointer';
          circle.addEventListener('click', (e) => {
            e.stopPropagation();
            setSelectedMarkupId(measurement.id);
          });
          
          // Add invisible hit area for easier selection (larger circle)
          const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          hitArea.setAttribute('cx', point.x.toString());
          hitArea.setAttribute('cy', point.y.toString());
          hitArea.setAttribute('r', '20'); // Much larger hit area
          hitArea.setAttribute('fill', 'transparent');
          hitArea.setAttribute('stroke', 'transparent');
          hitArea.style.cursor = 'pointer';
          hitArea.addEventListener('click', (e) => {
            e.stopPropagation();
            setSelectedMarkupId(measurement.id);
          });
          svg.appendChild(hitArea);
        }
        
        svg.appendChild(circle);
        break;
    }
  };

  // Render current measurement being drawn as SVG
  const renderSVGCurrentMeasurement = (svg: SVGSVGElement, viewport: any) => {
    if (!viewport) return;

    const selectedCondition = getSelectedCondition();
    const conditionColor = selectedCondition?.color || '#000000';
    // Use red for cut-out mode, condition color for normal measurements
    const strokeColor = cutoutMode ? '#ff0000' : conditionColor;
    
    switch (measurementType) {
      case 'linear':
        if (isContinuousDrawing && activePoints.length > 0) {
          // Render committed segments for continuous linear drawing
          if (activePoints.length > 1) {
            // Remove existing committed polyline for this page if it exists
            const existingPolyline = pageCommittedPolylineRefs.current[currentPage];
            if (existingPolyline && existingPolyline.parentNode === svg) {
              svg.removeChild(existingPolyline);
            }
            
            const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            const pointString = activePoints.map(p => {
              // Points are stored in normalized coordinates (0-1), convert to viewport pixels
              return `${p.x * viewport.width},${p.y * viewport.height}`;
            }).join(' ');
            
            polyline.setAttribute('points', pointString);
            polyline.setAttribute('stroke', strokeColor);
            polyline.setAttribute('stroke-width', '2');
            polyline.setAttribute('stroke-linecap', 'round');
            polyline.setAttribute('stroke-linejoin', 'round');
            polyline.setAttribute('fill', 'none');
            polyline.setAttribute('vector-effect', 'non-scaling-stroke');
            polyline.setAttribute('id', `committed-segments-${currentPage}`);
            svg.appendChild(polyline);
            
            // Store in page-scoped refs
            pageCommittedPolylineRefs.current[currentPage] = polyline;
          }
          
          // Always show preview line from first click (similar to area/volume)
          if (activePoints.length > 0) {
            const previewPolyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            let pointString = activePoints.map(p => {
              // Points are stored in normalized coordinates (0-1), convert to viewport pixels
              return `${p.x * viewport.width},${p.y * viewport.height}`;
            }).join(' ');
            
            if (mousePosition) {
              const mousePoint = { x: mousePosition.x * viewport.width, y: mousePosition.y * viewport.height };
              pointString += ` ${mousePoint.x},${mousePoint.y}`;
            }
            
            previewPolyline.setAttribute('points', pointString);
            previewPolyline.setAttribute('stroke', conditionColor);
            previewPolyline.setAttribute('stroke-width', '2');
            previewPolyline.setAttribute('stroke-linecap', 'round');
            previewPolyline.setAttribute('stroke-linejoin', 'round');
            previewPolyline.setAttribute('fill', 'none');
            previewPolyline.setAttribute('stroke-dasharray', '5,5');
            previewPolyline.setAttribute('vector-effect', 'non-scaling-stroke');
            previewPolyline.setAttribute('id', `linear-preview-${currentPage}`);
            svg.appendChild(previewPolyline);
          }
        } else if (currentMeasurement.length > 0) {
          // Render traditional linear measurement (non-continuous) with preview line
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          let pointString = currentMeasurement.map(p => {
            // Points are stored in normalized coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
          }).join(' ');
          
          if (mousePosition) {
            const mousePoint = { x: mousePosition.x * viewport.width, y: mousePosition.y * viewport.height };
            pointString += ` ${mousePoint.x},${mousePoint.y}`;
          }
          
          polyline.setAttribute('points', pointString);
          polyline.setAttribute('stroke', strokeColor);
          polyline.setAttribute('stroke-width', '2');
          polyline.setAttribute('stroke-linecap', 'round');
          polyline.setAttribute('stroke-linejoin', 'round');
          polyline.setAttribute('fill', 'none');
          polyline.setAttribute('stroke-dasharray', '5,5');
          polyline.setAttribute('vector-effect', 'non-scaling-stroke');
          svg.appendChild(polyline);
        }
        break;
        
      case 'area':
        if (currentMeasurement.length > 0) {
          // Create a polyline for the preview (including mouse position)
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          let pointString = currentMeasurement.map(p => {
            // Points are stored in normalized coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
          }).join(' ');
          
          if (mousePosition) {
            const mousePoint = { x: mousePosition.x * viewport.width, y: mousePosition.y * viewport.height };
            pointString += ` ${mousePoint.x},${mousePoint.y}`;
          }
          
          polyline.setAttribute('points', pointString);
          polyline.setAttribute('stroke', strokeColor);
          polyline.setAttribute('stroke-width', '3');
          polyline.setAttribute('fill', 'none');
          polyline.setAttribute('stroke-dasharray', '5,5');
          svg.appendChild(polyline);
          
          // If we have 3+ points, also show the filled polygon preview
          if (currentMeasurement.length >= 3) {
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            const polygonPointString = currentMeasurement.map(p => {
              return `${p.x * viewport.width},${p.y * viewport.height}`;
            }).join(' ');
            
            polygon.setAttribute('points', polygonPointString);
            polygon.setAttribute('fill', cutoutMode ? 'none' : (conditionColor + '40'));
            polygon.setAttribute('stroke', 'none');
            svg.appendChild(polygon);
          }
        }
        break;
        
      case 'volume':
        if (currentMeasurement.length > 0) {
          // Create a polyline for the preview (including mouse position)
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          let pointString = currentMeasurement.map(p => {
            // Points are stored in normalized coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
          }).join(' ');
          
          if (mousePosition) {
            const mousePoint = { x: mousePosition.x * viewport.width, y: mousePosition.y * viewport.height };
            pointString += ` ${mousePoint.x},${mousePoint.y}`;
          }
          
          polyline.setAttribute('points', pointString);
          polyline.setAttribute('stroke', strokeColor);
          polyline.setAttribute('stroke-width', '3');
          polyline.setAttribute('fill', 'none');
          polyline.setAttribute('stroke-dasharray', '5,5');
          svg.appendChild(polyline);
          
          // If we have 3+ points, also show the filled polygon preview
          if (currentMeasurement.length >= 3) {
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            const polygonPointString = currentMeasurement.map(p => {
              return `${p.x * viewport.width},${p.y * viewport.height}`;
            }).join(' ');
            
            polygon.setAttribute('points', polygonPointString);
            polygon.setAttribute('fill', cutoutMode ? 'none' : (conditionColor + '40'));
            polygon.setAttribute('stroke', 'none');
            svg.appendChild(polygon);
          }
        }
        break;
        
      case 'count':
        if (currentMeasurement.length >= 1) {
          const point = { x: currentMeasurement[0].x * viewport.width, y: currentMeasurement[0].y * viewport.height };
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', point.x.toString());
          circle.setAttribute('cy', point.y.toString());
          circle.setAttribute('r', '12'); // Match the final size
          circle.setAttribute('fill', conditionColor + '80'); // More opaque
          circle.setAttribute('stroke', 'white');
          circle.setAttribute('stroke-width', '3'); // Thicker stroke for preview
          circle.setAttribute('stroke-dasharray', '5,5'); // More visible dash pattern
          svg.appendChild(circle);
          
          // Add preview text
          const previewText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          previewText.setAttribute('x', point.x.toString());
          previewText.setAttribute('y', (point.y + 4).toString());
          previewText.setAttribute('fill', 'white');
          previewText.setAttribute('font-size', '14');
          previewText.setAttribute('font-family', 'Arial');
          previewText.setAttribute('font-weight', 'bold');
          previewText.setAttribute('text-anchor', 'middle');
          previewText.setAttribute('dominant-baseline', 'middle');
          previewText.setAttribute('stroke', 'black');
          previewText.setAttribute('stroke-width', '0.5');
          previewText.textContent = '1';
          svg.appendChild(previewText);
        }
        break;
    }
  };

  // Helper function to check if a point is inside a polygon
  const isPointInPolygon = (point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean => {
    if (polygon.length < 3) return false;
    
    
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      
      const condition1 = (yi > point.y) !== (yj > point.y);
      const condition2 = point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi;
      
      if (condition1 && condition2) {
        inside = !inside;
      }
    }
    
    return inside;
  };

  // Render current cut-out being created
  const renderSVGCurrentCutout = (svg: SVGSVGElement, viewport: any) => {
    if (!viewport || currentCutout.length === 0) return;

    // Create a polyline for the preview (including mouse position)
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    let pointString = currentCutout.map(p => {
      // Points are stored in normalized coordinates (0-1), convert to viewport pixels
      return `${p.x * viewport.width},${p.y * viewport.height}`;
    }).join(' ');
    
    if (mousePosition) {
      const mousePoint = { x: mousePosition.x * viewport.width, y: mousePosition.y * viewport.height };
      pointString += ` ${mousePoint.x},${mousePoint.y}`;
    }
    
    polyline.setAttribute('points', pointString);
    polyline.setAttribute('stroke', '#ff0000'); // Red outline
    polyline.setAttribute('stroke-width', '2');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(polyline);
    
    // If we have 3+ points, also show the filled polygon preview (but blank)
    if (currentCutout.length >= 3) {
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      const polygonPointString = currentCutout.map(p => {
        return `${p.x * viewport.width},${p.y * viewport.height}`;
      }).join(' ');
      
      polygon.setAttribute('points', polygonPointString);
      polygon.setAttribute('fill', 'none'); // No fill - blank
      polygon.setAttribute('stroke', '#ff0000'); // Red outline
      polygon.setAttribute('stroke-width', '2');
      svg.appendChild(polygon);
    }
  };

  // Render visual search selection box
  const renderSVGSelectionBox = (svg: SVGSVGElement, selectionBox: {x: number, y: number, width: number, height: number}, viewport: any) => {
    if (!viewport || !selectionBox) return;

    // Create rectangle for the selection box
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', selectionBox.x.toString());
    rect.setAttribute('y', selectionBox.y.toString());
    rect.setAttribute('width', selectionBox.width.toString());
    rect.setAttribute('height', selectionBox.height.toString());
    rect.setAttribute('fill', 'rgba(59, 130, 246, 0.1)'); // Light blue fill
    rect.setAttribute('stroke', '#3B82F6'); // Blue border
    rect.setAttribute('stroke-width', '2');
    rect.setAttribute('stroke-dasharray', '5,5'); // Dashed border
    rect.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(rect);
  };

  // Render completed annotation
  const renderSVGAnnotation = (svg: SVGSVGElement, annotation: Annotation, viewport: any) => {
    if (!viewport || annotation.points.length === 0) return;
    
    // Use baseline scale during interactive zoom to avoid double scaling
    const interactiveBlocked = (isMeasuring || isCalibrating || currentMeasurement.length > 0 || isDeselecting || (isAnnotating && !showTextInput));
    const baselineScale = interactiveBlocked ? (lastRenderedScaleRef.current || viewState.scale) : viewState.scale;
    const page = pdfPageRef.current;
    const vp = page ? page.getViewport({ scale: baselineScale, rotation: viewState.rotation }) : viewport;
    
    const points = annotation.points.map(p => ({
      x: p.x * vp.width,
      y: p.y * vp.height
    }));
    
    const isSelected = selectedMarkupId === annotation.id;
    const strokeWidth = isSelected ? '5' : '3';
    const strokeColor = isSelected ? '#00ff00' : annotation.color; // Green when selected
    
    if (annotation.type === 'text' && annotation.text) {
      const point = points[0];
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', point.x.toString());
      text.setAttribute('y', point.y.toString());
      text.setAttribute('fill', strokeColor);
      text.setAttribute('font-size', '14');
      text.setAttribute('font-weight', 'bold');
      text.textContent = annotation.text;
      text.setAttribute('data-annotation-id', annotation.id);
      
      // Add click handler for selection
      if (isSelectionMode) {
        text.style.cursor = 'pointer';
        text.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelectedMarkupId(annotation.id);
        });
      }
      
      svg.appendChild(text);
    } else if (annotation.type === 'freehand') {
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      const pointString = points.map(p => `${p.x},${p.y}`).join(' ');
      polyline.setAttribute('points', pointString);
      polyline.setAttribute('stroke', strokeColor);
      polyline.setAttribute('stroke-width', strokeWidth);
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('stroke-linecap', 'round');
      polyline.setAttribute('stroke-linejoin', 'round');
      polyline.setAttribute('data-annotation-id', annotation.id);
      
      // Add click handler for selection
      if (isSelectionMode) {
        polyline.style.cursor = 'pointer';
        polyline.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelectedMarkupId(annotation.id);
        });
        
        // Add invisible hit area for easier selection
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        hitArea.setAttribute('points', pointString);
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('stroke-width', '20');
        hitArea.setAttribute('fill', 'none');
        hitArea.style.cursor = 'pointer';
        hitArea.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelectedMarkupId(annotation.id);
        });
        svg.appendChild(hitArea);
      }
      
      svg.appendChild(polyline);
    } else if (annotation.type === 'arrow' && points.length === 2) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', points[0].x.toString());
      line.setAttribute('y1', points[0].y.toString());
      line.setAttribute('x2', points[1].x.toString());
      line.setAttribute('y2', points[1].y.toString());
      line.setAttribute('stroke', strokeColor);
      line.setAttribute('stroke-width', strokeWidth);
      line.setAttribute('marker-end', 'url(#arrowhead)');
      line.setAttribute('data-annotation-id', annotation.id);
      
      // Add click handler for selection
      if (isSelectionMode) {
        line.style.cursor = 'pointer';
        line.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelectedMarkupId(annotation.id);
        });
      }
      
      svg.appendChild(line);
      
      // Create arrowhead marker if it doesn't exist
      if (!svg.querySelector('#arrowhead')) {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'arrowhead');
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '10');
        marker.setAttribute('refX', '9');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', '0 0, 10 3, 0 6');
        polygon.setAttribute('fill', strokeColor);
        marker.appendChild(polygon);
        defs.appendChild(marker);
        svg.appendChild(defs);
      }
    } else if (annotation.type === 'rectangle' && points.length === 2) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const x = Math.min(points[0].x, points[1].x);
      const y = Math.min(points[0].y, points[1].y);
      const width = Math.abs(points[1].x - points[0].x);
      const height = Math.abs(points[1].y - points[0].y);
      rect.setAttribute('x', x.toString());
      rect.setAttribute('y', y.toString());
      rect.setAttribute('width', width.toString());
      rect.setAttribute('height', height.toString());
      rect.setAttribute('stroke', strokeColor);
      rect.setAttribute('stroke-width', strokeWidth);
      rect.setAttribute('fill', 'none');
      rect.setAttribute('data-annotation-id', annotation.id);
      
      // Add click handler for selection
      if (isSelectionMode) {
        rect.style.cursor = 'pointer';
        rect.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelectedMarkupId(annotation.id);
        });
      }
      
      svg.appendChild(rect);
    } else if (annotation.type === 'circle' && points.length === 2) {
      const cx = (points[0].x + points[1].x) / 2;
      const cy = (points[0].y + points[1].y) / 2;
      const rx = Math.abs(points[1].x - points[0].x) / 2;
      const ry = Math.abs(points[1].y - points[0].y) / 2;
      const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      ellipse.setAttribute('cx', cx.toString());
      ellipse.setAttribute('cy', cy.toString());
      ellipse.setAttribute('rx', rx.toString());
      ellipse.setAttribute('ry', ry.toString());
      ellipse.setAttribute('stroke', strokeColor);
      ellipse.setAttribute('stroke-width', strokeWidth);
      ellipse.setAttribute('fill', 'none');
      ellipse.setAttribute('data-annotation-id', annotation.id);
      
      // Add click handler for selection
      if (isSelectionMode) {
        ellipse.style.cursor = 'pointer';
        ellipse.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelectedMarkupId(annotation.id);
        });
      }
      
      svg.appendChild(ellipse);
    } else if (annotation.type === 'highlight' && points.length >= 2) {
      // For highlight, we'll create a rectangle with semi-transparent fill
      const x = Math.min(...points.map(p => p.x));
      const y = Math.min(...points.map(p => p.y));
      const width = Math.max(...points.map(p => p.x)) - x;
      const height = Math.max(...points.map(p => p.y)) - y;
      
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x.toString());
      rect.setAttribute('y', y.toString());
      rect.setAttribute('width', width.toString());
      rect.setAttribute('height', height.toString());
      rect.setAttribute('fill', annotation.color);
      rect.setAttribute('fill-opacity', '0.3');
      rect.setAttribute('stroke', annotation.color);
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('data-annotation-id', annotation.id);
      
      // Add click handler for selection
      if (isSelectionMode) {
        rect.style.cursor = 'pointer';
        rect.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelectedMarkupId(annotation.id);
        });
      }
      
      svg.appendChild(rect);
    }
  };

  // Render current annotation being created with rubber banding preview
  const renderSVGCurrentAnnotation = (svg: SVGSVGElement, viewport: any) => {
    if (!viewport || !annotationTool) return;
    
    const points = currentAnnotation.map(p => ({
      x: p.x * viewport.width,
      y: p.y * viewport.height
    }));
    
    if (annotationTool === 'freehand') {
      // Draw completed segments
      if (points.length > 0) {
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        let pointString = points.map(p => `${p.x},${p.y}`).join(' ');
        polyline.setAttribute('points', pointString);
        polyline.setAttribute('stroke', annotationColor);
        polyline.setAttribute('stroke-width', '3');
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke-linecap', 'round');
        polyline.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(polyline);
      }
      
      // Draw rubber band line from last point to mouse (preview)
      if (points.length > 0 && mousePosition) {
        const rubberBand = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        const lastPoint = points[points.length - 1];
        rubberBand.setAttribute('x1', lastPoint.x.toString());
        rubberBand.setAttribute('y1', lastPoint.y.toString());
        rubberBand.setAttribute('x2', (mousePosition.x * viewport.width).toString());
        rubberBand.setAttribute('y2', (mousePosition.y * viewport.height).toString());
        rubberBand.setAttribute('stroke', annotationColor);
        rubberBand.setAttribute('stroke-width', '3');
        rubberBand.setAttribute('stroke-dasharray', '5,5');
        rubberBand.setAttribute('stroke-linecap', 'round');
        rubberBand.setAttribute('opacity', '0.7');
        svg.appendChild(rubberBand);
      }
    } else if (['arrow', 'rectangle', 'circle'].includes(annotationTool)) {
      if (points.length === 0 && mousePosition) {
        // Show a small dot at mouse position to indicate where first point will be
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', (mousePosition.x * viewport.width).toString());
        dot.setAttribute('cy', (mousePosition.y * viewport.height).toString());
        dot.setAttribute('r', '4');
        dot.setAttribute('fill', annotationColor);
        dot.setAttribute('opacity', '0.7');
        svg.appendChild(dot);
      } else if (points.length === 1 && mousePosition) {
        const endPoint = {
          x: mousePosition.x * viewport.width,
          y: mousePosition.y * viewport.height
        };
        
        // Draw first point
        const startDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        startDot.setAttribute('cx', points[0].x.toString());
        startDot.setAttribute('cy', points[0].y.toString());
        startDot.setAttribute('r', '4');
        startDot.setAttribute('fill', annotationColor);
        svg.appendChild(startDot);
        
        if (annotationTool === 'arrow') {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', points[0].x.toString());
          line.setAttribute('y1', points[0].y.toString());
          line.setAttribute('x2', endPoint.x.toString());
          line.setAttribute('y2', endPoint.y.toString());
          line.setAttribute('stroke', annotationColor);
          line.setAttribute('stroke-width', '3');
          line.setAttribute('stroke-dasharray', '5,5');
          line.setAttribute('opacity', '0.7');
          svg.appendChild(line);
        } else if (annotationTool === 'rectangle') {
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          const x = Math.min(points[0].x, endPoint.x);
          const y = Math.min(points[0].y, endPoint.y);
          const width = Math.abs(endPoint.x - points[0].x);
          const height = Math.abs(endPoint.y - points[0].y);
          rect.setAttribute('x', x.toString());
          rect.setAttribute('y', y.toString());
          rect.setAttribute('width', width.toString());
          rect.setAttribute('height', height.toString());
          rect.setAttribute('stroke', annotationColor);
          rect.setAttribute('stroke-width', '3');
          rect.setAttribute('fill', 'none');
          rect.setAttribute('stroke-dasharray', '5,5');
          rect.setAttribute('opacity', '0.7');
          svg.appendChild(rect);
        } else if (annotationTool === 'circle') {
          const cx = (points[0].x + endPoint.x) / 2;
          const cy = (points[0].y + endPoint.y) / 2;
          const rx = Math.abs(endPoint.x - points[0].x) / 2;
          const ry = Math.abs(endPoint.y - points[0].y) / 2;
          const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
          ellipse.setAttribute('cx', cx.toString());
          ellipse.setAttribute('cy', cy.toString());
          ellipse.setAttribute('rx', rx.toString());
          ellipse.setAttribute('ry', ry.toString());
          ellipse.setAttribute('stroke', annotationColor);
          ellipse.setAttribute('stroke-width', '3');
          ellipse.setAttribute('fill', 'none');
          ellipse.setAttribute('stroke-dasharray', '5,5');
          ellipse.setAttribute('opacity', '0.7');
          svg.appendChild(ellipse);
        }
      }
    }
  };

  // Render calibration points as SVG
  const renderSVGCalibrationPoints = (svg: SVGSVGElement) => {
    if (!currentViewport) return;
    
    calibrationPoints.forEach((point, index) => {
      // Convert PDF coordinates (0-1) to viewport pixels for rendering
      const viewportPoint = {
        x: point.x * currentViewport.width,
        y: point.y * currentViewport.height
      };
      
      // Create calibration point circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', viewportPoint.x.toString());
      circle.setAttribute('cy', viewportPoint.y.toString());
      circle.setAttribute('r', '8');
      circle.setAttribute('fill', '#ff0000');
      circle.setAttribute('stroke', '#ffffff');
      circle.setAttribute('stroke-width', '2');
      svg.appendChild(circle);
      
      // Add point number
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', viewportPoint.x.toString());
      text.setAttribute('y', (viewportPoint.y + 4).toString());
      text.setAttribute('fill', 'white');
      text.setAttribute('font-size', '12');
      text.setAttribute('font-family', 'Arial');
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.textContent = (index + 1).toString();
      svg.appendChild(text);
    });
    
    // Draw preview line from first point to mouse position (if only one point)
    if (calibrationPoints.length === 1 && mousePosition) {
      const firstPoint = {
        x: calibrationPoints[0].x * currentViewport.width,
        y: calibrationPoints[0].y * currentViewport.height
      };
      const mousePoint = {
        x: mousePosition.x * currentViewport.width,
        y: mousePosition.y * currentViewport.height
      };
      
      // Apply ortho snapping to the preview line only if enabled
      const snappedMousePoint = isOrthoSnapping ? applyOrthoSnapping(mousePosition, calibrationPoints) : mousePosition;
      const snappedViewportPoint = {
        x: snappedMousePoint.x * currentViewport.width,
        y: snappedMousePoint.y * currentViewport.height
      };
      
      const previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      previewLine.setAttribute('x1', firstPoint.x.toString());
      previewLine.setAttribute('y1', firstPoint.y.toString());
      previewLine.setAttribute('x2', snappedViewportPoint.x.toString());
      previewLine.setAttribute('y2', snappedViewportPoint.y.toString());
      previewLine.setAttribute('stroke', '#ff0000');
      previewLine.setAttribute('stroke-width', '2');
      previewLine.setAttribute('stroke-dasharray', '5,5');
      previewLine.setAttribute('opacity', '0.7');
      svg.appendChild(previewLine);
      
      // Add distance preview text
      const midX = (firstPoint.x + snappedViewportPoint.x) / 2;
      const midY = (firstPoint.y + snappedViewportPoint.y) / 2;
      const distance = calculateDistance(
        { x: firstPoint.x, y: firstPoint.y },
        { x: snappedViewportPoint.x, y: snappedViewportPoint.y }
      );
      
      const distanceText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      distanceText.setAttribute('x', midX.toString());
      distanceText.setAttribute('y', (midY - 10).toString());
      distanceText.setAttribute('fill', '#ff0000');
      distanceText.setAttribute('font-size', '12');
      distanceText.setAttribute('font-family', 'Arial');
      distanceText.setAttribute('font-weight', 'bold');
      distanceText.setAttribute('text-anchor', 'middle');
      distanceText.textContent = `${distance.toFixed(1)} px`;
      svg.appendChild(distanceText);
    }
    
    // Draw final line between calibration points (if two points)
    if (calibrationPoints.length === 2) {
      const firstPoint = {
        x: calibrationPoints[0].x * currentViewport.width,
        y: calibrationPoints[0].y * currentViewport.height
      };
      const secondPoint = {
        x: calibrationPoints[1].x * currentViewport.width,
        y: calibrationPoints[1].y * currentViewport.height
      };
      
      // Draw line between calibration points
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', firstPoint.x.toString());
      line.setAttribute('y1', firstPoint.y.toString());
      line.setAttribute('x2', secondPoint.x.toString());
      line.setAttribute('y2', secondPoint.y.toString());
      line.setAttribute('stroke', '#ff0000');
      line.setAttribute('stroke-width', '3');
      svg.appendChild(line);
      
      // Add distance text
      const midX = (firstPoint.x + secondPoint.x) / 2;
      const midY = (firstPoint.y + secondPoint.y) / 2;
      const distance = calculateDistance(firstPoint, secondPoint);
      
      const distanceText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      distanceText.setAttribute('x', midX.toString());
      distanceText.setAttribute('y', (midY - 10).toString());
      distanceText.setAttribute('fill', '#ff0000');
      distanceText.setAttribute('font-size', '14');
      distanceText.setAttribute('font-family', 'Arial');
      distanceText.setAttribute('font-weight', 'bold');
      distanceText.setAttribute('text-anchor', 'middle');
      distanceText.textContent = `${distance.toFixed(1)} px`;
      svg.appendChild(distanceText);
    }
  };

  // Render crosshair as SVG
  const renderSVGCrosshair = (svg: SVGSVGElement, position: { x: number; y: number }, viewport: any, isCalibrating: boolean = false) => {
    if (!position || !viewport) {
      console.warn('renderSVGCrosshair: Missing position or viewport');
      return;
    }
    
    // Position is in PDF coordinates (0-1), convert to viewport pixels
    const viewportPoint = { x: position.x * viewport.width, y: position.y * viewport.height };
    
    if (typeof viewportPoint.x !== 'number' || typeof viewportPoint.y !== 'number') {
      console.warn('renderSVGCrosshair: Invalid viewport point', viewportPoint);
      return;
    }
    
    // Create crosshair lines with different styling for calibration
    const crosshairSize = isCalibrating ? 30 : 35;
    const strokeColor = isCalibrating ? 'rgba(255, 0, 0, 0.9)' : 'rgba(0, 0, 0, 0.8)';
    const strokeWidth = isCalibrating ? '2' : '1';
    const dotColor = isCalibrating ? 'rgba(255, 0, 0, 1)' : 'rgba(0, 0, 0, 0.9)';
    const dotRadius = isCalibrating ? '3' : '2';
    
    // Horizontal line
    const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hLine.setAttribute('x1', (viewportPoint.x - crosshairSize).toString());
    hLine.setAttribute('y1', viewportPoint.y.toString());
    hLine.setAttribute('x2', (viewportPoint.x + crosshairSize).toString());
    hLine.setAttribute('y2', viewportPoint.y.toString());
    hLine.setAttribute('stroke', strokeColor);
    hLine.setAttribute('stroke-width', strokeWidth);
    hLine.setAttribute('stroke-linecap', 'round');
    svg.appendChild(hLine);
    
    // Vertical line
    const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    vLine.setAttribute('x1', viewportPoint.x.toString());
    vLine.setAttribute('y1', (viewportPoint.y - crosshairSize).toString());
    vLine.setAttribute('x2', viewportPoint.x.toString());
    vLine.setAttribute('y2', (viewportPoint.y + crosshairSize).toString());
    vLine.setAttribute('stroke', strokeColor);
    vLine.setAttribute('stroke-width', strokeWidth);
    vLine.setAttribute('stroke-linecap', 'round');
    svg.appendChild(vLine);
    
    // Center dot
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', viewportPoint.x.toString());
    dot.setAttribute('cy', viewportPoint.y.toString());
    dot.setAttribute('r', dotRadius);
    dot.setAttribute('fill', dotColor);
    dot.setAttribute('stroke', isCalibrating ? 'rgba(255, 255, 255, 0.8)' : 'none');
    dot.setAttribute('stroke-width', '1');
    svg.appendChild(dot);
  };

  // Render running length display for continuous linear drawing
  const renderRunningLengthDisplay = (svg: SVGSVGElement, viewport: any) => {
    if (!viewport || !isContinuousDrawing || activePoints.length === 0) return;
    
    const selectedCondition = getSelectedCondition();
    const conditionColor = selectedCondition?.color || '#000000';
    const unit = selectedCondition?.unit || 'ft';
    
    // Position the text near the last point
    const lastPoint = activePoints[activePoints.length - 1];
    const textX = lastPoint.x * viewport.width + 10;
    const textY = lastPoint.y * viewport.height - 10;
    
    // Create background rectangle for better visibility
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', (textX - 5).toString());
    rect.setAttribute('y', (textY - 20).toString());
    rect.setAttribute('width', '120');
    rect.setAttribute('height', '20');
    rect.setAttribute('fill', 'rgba(255, 255, 255, 0.9)');
    rect.setAttribute('stroke', conditionColor);
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('rx', '3');
    svg.appendChild(rect);
    
    // Create text element
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', textX.toString());
    text.setAttribute('y', (textY - 5).toString());
    text.setAttribute('fill', conditionColor);
    text.setAttribute('font-size', '12');
    text.setAttribute('font-family', 'Arial');
    text.setAttribute('font-weight', 'bold');
    
    const displayValue = (unit === 'ft' || unit === 'feet' || unit === 'LF' || unit === 'lf') 
      ? formatFeetAndInches(runningLength)
      : `${runningLength.toFixed(2)} ${unit}`;
    text.textContent = `Length: ${displayValue}`;
    svg.appendChild(text);
  };

  // Handle mouse move - direct coordinate conversion
  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    // ANTI-FLICKER: Clear deselection state on any user interaction
    if (isDeselecting) {
      console.log('✅ USER INTERACTION: Clearing deselection cooldown');
      setIsDeselecting(false);
    }
    
    // Handle visual search selection box drawing
    if (visualSearchMode && isSelectingSymbol && selectionStart) {
      if (!pdfCanvasRef.current || !currentViewport) return;
      
      const rect = pdfCanvasRef.current.getBoundingClientRect();
      let cssX = event.clientX - rect.left;
      let cssY = event.clientY - rect.top;
      // If interactive CSS zoom is active, adjust pointer coords back to rendered scale space
      const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
      if (Math.abs(interactiveScale - 1) > 0.0001) {
        cssX = cssX / interactiveScale;
        cssY = cssY / interactiveScale;
      }
      
      const width = Math.abs(cssX - selectionStart.x);
      const height = Math.abs(cssY - selectionStart.y);
      const x = Math.min(cssX, selectionStart.x);
      const y = Math.min(cssY, selectionStart.y);
      
      setSelectionBox({ x, y, width, height });
      return;
    }
    
    // Handle mouse move for calibration mode
    if (isCalibrating) {
      if (!pdfCanvasRef.current || !currentViewport) {
        return;
      }
      
      // Get CSS pixel coordinates relative to the canvas/SVG
      const rect = pdfCanvasRef.current.getBoundingClientRect();
      let cssX = event.clientX - rect.left;
      let cssY = event.clientY - rect.top;
      const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
      if (Math.abs(interactiveScale - 1) > 0.0001) {
        cssX = cssX / interactiveScale;
        cssY = cssY / interactiveScale;
      }
      
      // Convert CSS coordinates to PDF coordinates (0-1)
      let pdfCoords = {
        x: cssX / currentViewport.width,
        y: cssY / currentViewport.height
      };
      
      // Apply ortho snapping for calibration only if explicitly enabled
      if (calibrationPoints.length > 0 && isOrthoSnapping) {
        pdfCoords = applyOrthoSnapping(pdfCoords, calibrationPoints);
      }
      
      // For calibration, always update mouse position to follow cursor exactly
      // No threshold check to prevent lagging/snapping to grid
      setMousePosition(pdfCoords);
      return;
    }
    
    // Handle mouse move for annotation mode
    if (annotationTool) {
      if (!pdfCanvasRef.current || !currentViewport) {
        return;
      }
      
      // Get CSS pixel coordinates relative to the canvas/SVG
      const rect = pdfCanvasRef.current.getBoundingClientRect();
      const cssX = event.clientX - rect.left;
      const cssY = event.clientY - rect.top;
      
      // Convert CSS coordinates to PDF coordinates (0-1)
      const pdfCoords = {
        x: cssX / currentViewport.width,
        y: cssY / currentViewport.height
      };
      
      // Always update mouse position for annotation preview
      setMousePosition(pdfCoords);
      return;
    }
    
    // Handle mouse move for measurement mode
    if (!isMeasuring || !selectedConditionId) {
      if (mousePosition) {
        setMousePosition(null);
      }
      return;
    }
    
    if (!pdfCanvasRef.current || !currentViewport) {
      return;
    }
    
    // Get CSS pixel coordinates relative to the canvas/SVG
    const rect = pdfCanvasRef.current.getBoundingClientRect();
    let cssX = event.clientX - rect.left;
    let cssY = event.clientY - rect.top;
    const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
    if (Math.abs(interactiveScale - 1) > 0.0001) {
      cssX = cssX / interactiveScale;
      cssY = cssY / interactiveScale;
    }
    
    // Convert CSS coordinates to PDF coordinates (0-1) for storage using current page viewport
    let pdfCoords = {
      x: cssX / currentViewport.width,
      y: cssY / currentViewport.height
    };
    
    // Apply ortho snapping if enabled and we have reference points
    if (isOrthoSnapping) {
      const referencePoints = isContinuousDrawing ? activePoints : currentMeasurement;
      pdfCoords = applyOrthoSnapping(pdfCoords, referencePoints);
    }
    
    // For measurements, always update mouse position to follow cursor exactly
    // No threshold check to prevent lagging/snapping to grid
    setMousePosition(pdfCoords);
    
    // Hover detection removed - using manual cut-out toggle instead
    
    // Update rubber band preview for continuous linear drawing
    if (isContinuousDrawing && activePoints.length > 0) {
      // Always compute running length from active points to current cursor
      const newLength = calculateRunningLength(activePoints, pdfCoords);
      setRunningLength(newLength);
      
      // Update on-screen rubber band line when present
      if (svgOverlayRef.current) {
        const currentRubberBand = pageRubberBandRefs.current[currentPage];
        if (currentRubberBand && currentRubberBand.parentNode === svgOverlayRef.current) {
          const lastPoint = activePoints[activePoints.length - 1];
          const lastPointPixels = {
            x: lastPoint.x * currentViewport.width,
            y: lastPoint.y * currentViewport.height
          };
          const currentPointPixels = {
            x: pdfCoords.x * currentViewport.width,
            y: pdfCoords.y * currentViewport.height
          };
          currentRubberBand.setAttribute('x1', lastPointPixels.x.toString());
          currentRubberBand.setAttribute('y1', lastPointPixels.y.toString());
          currentRubberBand.setAttribute('x2', currentPointPixels.x.toString());
          currentRubberBand.setAttribute('y2', currentPointPixels.y.toString());
        }
      }
    }
  }, [annotationTool, isCalibrating, calibrationPoints, isMeasuring, selectedConditionId, mousePosition, isContinuousDrawing, activePoints, rubberBandElement, currentViewport, calculateRunningLength, isDeselecting]);

  // Handle click - direct coordinate conversion
  const handleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    // ANTI-FLICKER: Clear deselection state on any user interaction
    if (isDeselecting) {
      console.log('✅ USER INTERACTION: Clearing deselection cooldown');
      setIsDeselecting(false);
    }
    
    const currentStoreState = useTakeoffStore.getState();
    const currentSelectedConditionId = currentStoreState.selectedConditionId;
    
    if (!pdfCanvasRef.current || !currentViewport) return;
    
    // Get CSS pixel coordinates relative to the canvas/SVG
    const rect = pdfCanvasRef.current.getBoundingClientRect();
    let cssX = event.clientX - rect.left;
    let cssY = event.clientY - rect.top;
    const interactiveScale = (viewState.scale || 1) / (lastRenderedScaleRef.current || 1);
    if (Math.abs(interactiveScale - 1) > 0.0001) {
      cssX = cssX / interactiveScale;
      cssY = cssY / interactiveScale;
    }

    // Handle visual search symbol selection
    if (visualSearchMode && isSelectingSymbol) {
      if (!selectionStart) {
        // Start selection
        setSelectionStart({ x: cssX, y: cssY });
        setSelectionBox(null);
      } else {
        // Complete selection
        const width = Math.abs(cssX - selectionStart.x);
        const height = Math.abs(cssY - selectionStart.y);
        const x = Math.min(cssX, selectionStart.x);
        const y = Math.min(cssY, selectionStart.y);
        
        const finalSelectionBox = { x, y, width, height };
        setSelectionBox(finalSelectionBox);
        setIsSelectingSymbol(false);
        
        // Convert to PDF coordinates (0-1 scale)
        const pdfSelectionBox = {
          x: x / currentViewport.width,
          y: y / currentViewport.height,
          width: width / currentViewport.width,
          height: height / currentViewport.height
        };
        
        // Call the completion handler
        if (onVisualSearchComplete) {
          onVisualSearchComplete(pdfSelectionBox);
        }
      }
      return;
    }
    
    // Handle deselection in selection mode when clicking on blank space
    if (isSelectionMode && selectedMarkupId) {
      // If we're in selection mode and have a selected markup, deselect it
      setSelectedMarkupId(null);
      return;
    }
    
    // Handle calibration clicks
    if (isCalibrating) {
      setCalibrationPoints(prev => {
        // Convert CSS coordinates to PDF coordinates (0-1) for consistency
        let pdfCoords = {
          x: cssX / currentViewport.width,
          y: cssY / currentViewport.height
        };
        
        // Apply ortho snapping for calibration only if explicitly enabled
        // For calibration, we want precise point placement without automatic snapping
        if (prev.length > 0 && isOrthoSnapping) {
          pdfCoords = applyOrthoSnapping(pdfCoords, prev);
        }
        
        // Store points in PDF coordinates (0-1) for consistency with measurement system
        const newPoints = [...prev, pdfCoords];
        
        if (newPoints.length === 2) {
          completeCalibration(newPoints);
        }
        
        return newPoints;
      });
      return;
    }
    
    // Handle cut-out mode clicks
    if (cutoutMode) {
      // Convert CSS coordinates to PDF coordinates (0-1) for storage using current page viewport
      let pdfCoords = {
        x: cssX / currentViewport.width,
        y: cssY / currentViewport.height
      };
      
      // Disable ortho snapping for cut-outs to avoid interference
      // if (isOrthoSnapping) {
      //   pdfCoords = applyOrthoSnapping(pdfCoords, currentCutout);
      // }
      
      setCurrentCutout(prev => {
        const newCutout = [...prev, pdfCoords];
        return newCutout;
      });
      
      return;
    }
    
    // Handle annotation tool clicks
    if (annotationTool) {
      const pdfCoords = {
        x: cssX / currentViewport.width,
        y: cssY / currentViewport.height
      };
      
      if (annotationTool === 'text') {
        // Show text input at clicked position
        setTextInputPosition({ x: cssX, y: cssY });
        setShowTextInput(true);
        // Don't set currentAnnotation yet - wait until text is saved
        // Store the position for when we save the annotation
        setCurrentAnnotation([pdfCoords]);
        return;
      } else if (annotationTool === 'freehand') {
        // Add point to freehand drawing
        setCurrentAnnotation(prev => [...prev, pdfCoords]);
        return;
      } else if (['arrow', 'rectangle', 'circle'].includes(annotationTool)) {
        // For shapes, we need 2 points (start and end)
        setCurrentAnnotation(prev => {
          const newPoints = [...prev, pdfCoords];
          if (newPoints.length === 2 && currentProjectId && file?.id) {
            // Complete the annotation
            addAnnotation({
              projectId: currentProjectId,
              sheetId: file.id,
              type: annotationTool,
              points: newPoints,
              color: annotationColor,
              pageNumber: currentPage
            });
            setCurrentAnnotation([]);
            onAnnotationToolChange?.(null);
          }
          return newPoints;
        });
        return;
      }
    }
    
    // Handle measurement clicks
    if (!currentSelectedConditionId) {
      return;
    }
    
    // Convert CSS coordinates to PDF coordinates (0-1) for storage using current page viewport
    let pdfCoords = {
      x: cssX / currentViewport.width,
      y: cssY / currentViewport.height
    };
    
    // Smart cut-out mode entry removed - using manual toggle instead
    
    // Apply ortho snapping if enabled and we have reference points
    if (isOrthoSnapping) {
      const referencePoints = cutoutMode ? currentCutout : (isContinuousDrawing ? activePoints : currentMeasurement);
      pdfCoords = applyOrthoSnapping(pdfCoords, referencePoints);
    }
    
    // Handle continuous linear drawing mode
    if (measurementType === 'linear') {
      if (!isContinuousDrawing) {
        // Start continuous drawing mode
        setIsContinuousDrawing(true);
        setActivePoints([pdfCoords]);
        createRubberBandElement();
      } else {
        // Add point to active measurement
        setActivePoints(prev => {
          const newPoints = [...prev, pdfCoords];
          // Update running length after adding point
          const newLength = calculateRunningLength(newPoints);
          setRunningLength(newLength);
          return newPoints;
        });
      }
    } else {
      // Handle other measurement types (existing behavior)
      setCurrentMeasurement(prev => {
        const newMeasurement = [...prev, pdfCoords];
        return newMeasurement;
      });
      
      // Complete measurement based on type
      if (measurementType === 'count') {
        completeMeasurement([pdfCoords]);
      }
      // Area and volume measurements will be completed on double-click
    }
  }, [isCalibrating, calibrationPoints, measurementType, currentMeasurement, isContinuousDrawing, activePoints, calculateRunningLength, currentViewport, isSelectionMode, selectedMarkupId]);

  // Create rubber band element for continuous linear drawing
  const createRubberBandElement = useCallback(() => {
    if (!svgOverlayRef.current || !currentViewport) return;
    
    const svgOverlay = svgOverlayRef.current;
    
    // Ensure SVG has correct dimensions and viewBox
    svgOverlay.setAttribute('width', currentViewport.width.toString());
    svgOverlay.setAttribute('height', currentViewport.height.toString());
    svgOverlay.setAttribute('viewBox', `0 0 ${currentViewport.width} ${currentViewport.height}`);
    svgOverlay.setAttribute('overflow', 'visible');
    
    const selectedCondition = getSelectedCondition();
    const conditionColor = selectedCondition?.color || '#000000';
    
    // Remove existing rubber band for this page if it exists
    const existingRubberBand = pageRubberBandRefs.current[currentPage];
    if (existingRubberBand && existingRubberBand.parentNode === svgOverlay) {
      svgOverlay.removeChild(existingRubberBand);
    }
    
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', conditionColor);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '5,5');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('fill', 'none');
    line.setAttribute('opacity', '0.8');
    line.setAttribute('id', `rubber-band-line-${currentPage}`);
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    line.setAttribute('pointer-events', 'none');
    
    // Set initial coordinates (will be updated on mouse move)
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', '0');
    line.setAttribute('y2', '0');
    
    svgOverlay.appendChild(line);
    
    // Store in page-scoped refs
    pageRubberBandRefs.current[currentPage] = line;
    setRubberBandElement(line);
  }, [currentViewport, currentPage]);
  // Complete current measurement
  const completeMeasurement = useCallback(async (points: { x: number; y: number }[]) => {
    const currentStoreState = useTakeoffStore.getState();
    const currentSelectedConditionId = currentStoreState.selectedConditionId;
    
    if (!currentSelectedConditionId || points.length === 0) {
      return;
    }
    
    const selectedCondition = getSelectedCondition();
    if (!selectedCondition) {
      return;
    }
    
    let calculatedValue = 0;
    let unit = selectedCondition.unit;
    
    if (!currentViewport) {
      return;
    }
    
    // Store measurements in normalized coordinates (0-1) - simple and reliable
    const viewportPoints = points.map((point, index) => {
      // Debug logging for first 2 points
      if (index < 2) {
        console.log(`💾 STORAGE POINT ${index}:`, {
          normalizedPoint: { x: point.x, y: point.y }
        });
      }
      
      return {
        x: point.x,
        y: point.y
      };
    });
    
    // Import the measurement calculator
    const { MeasurementCalculator } = await import('../utils/measurementCalculation');
    
    // Create scale info object using the calibration base viewport
    const calibBase = calibrationViewportRef.current;
    const scaleInfo = {
      scaleFactor,
      unit: 'ft',
      scaleText: 'calibrated',
      confidence: 0.95, // High confidence for manual calibration
      viewportWidth: (calibBase?.viewportWidth) || currentViewport.width,
      viewportHeight: (calibBase?.viewportHeight) || currentViewport.height
    };
    
    // TEMP DEBUG: Compare validator path vs measurement path on the same span
    if (points.length === 2 && calibBase) {
      const dxNorm = points[1].x - points[0].x;
      const dyNorm = points[1].y - points[0].y;
      const pixelDistanceValidator = Math.hypot(dxNorm * calibBase.viewportWidth, dyNorm * calibBase.viewportHeight);
      const pixelDistanceMeasure = Math.hypot(dxNorm * scaleInfo.viewportWidth!, dyNorm * scaleInfo.viewportHeight!);
      const distanceValidatorFt = pixelDistanceValidator * scaleInfo.scaleFactor;
      const distanceMeasureFt = pixelDistanceMeasure * scaleInfo.scaleFactor;
      const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      console.log('📐 DEBUG MEASURE VS VALIDATOR', {
        dxNorm, dyNorm,
        calibBase,
        scaleInfo,
        pixelDistanceValidator,
        pixelDistanceMeasure,
        distanceValidatorFt,
        distanceMeasureFt
      });
      setMeasurementDebug({
        page: currentPage,
        mid,
        dxNorm, dyNorm,
        baseW: calibBase.viewportWidth,
        baseH: calibBase.viewportHeight,
        pixelDistanceValidator,
        pixelDistanceMeasure,
        scaleFactorUsed: scaleInfo.scaleFactor,
        distanceValidatorFt,
        distanceMeasureFt
      });
      // Auto clear after a few seconds
      setTimeout(() => setMeasurementDebug(null), 4000);
    }
    
    // Debug logging
    console.log('📏 MEASUREMENT CREATED:', {
      measurementType: measurementType,
      scaleFactor: scaleFactor,
      unit: 'ft',
      viewportWidth: currentViewport.width,
      normalizedPoints: viewportPoints,
      // Show the actual measurement points
      firstPoint: viewportPoints[0],
      lastPoint: viewportPoints[viewportPoints.length - 1],
      // Calculate normalized distance for debugging
      normalizedDistance: viewportPoints.length > 1 ? Math.sqrt((viewportPoints[1].x - viewportPoints[0].x) ** 2 + (viewportPoints[1].y - viewportPoints[0].y) ** 2) : 0
    });
    
    let measurementResult;
    let perimeterValue: number | undefined;
    
    switch (measurementType) {
      case 'linear':
        measurementResult = MeasurementCalculator.calculateLinear(viewportPoints, scaleInfo, 1.0);
        calculatedValue = measurementResult.calculatedValue;
        unit = measurementResult.unit;
        break;
      case 'area':
        measurementResult = MeasurementCalculator.calculateArea(viewportPoints, scaleInfo, 1.0);
        calculatedValue = measurementResult.calculatedValue;
        unit = measurementResult.unit;
        perimeterValue = measurementResult.perimeterValue;
        break;
      case 'volume':
        const depth = selectedCondition.depth || 1; // Default to 1 foot if no depth specified
        measurementResult = MeasurementCalculator.calculateVolume(viewportPoints, scaleInfo, depth, 1.0);
        calculatedValue = measurementResult.calculatedValue;
        unit = measurementResult.unit;
        perimeterValue = measurementResult.perimeterValue;
        break;
      case 'count':
        measurementResult = MeasurementCalculator.calculateCount();
        calculatedValue = measurementResult.calculatedValue;
        unit = measurementResult.unit;
        break;
    }
    
    // Log validation warnings/errors for debugging
    if (measurementResult && !measurementResult.validation.isValid) {
      console.warn('Measurement validation failed:', measurementResult.validation.errors);
    }
    if (measurementResult && measurementResult.validation.warnings.length > 0) {
      console.warn('Measurement warnings:', measurementResult.validation.warnings);
    }
    
    // Override perimeter calculation if condition requires it
    if ((measurementType === 'area' || measurementType === 'volume') && selectedCondition.includePerimeter && !perimeterValue) {
      // Fallback to manual calculation if enhanced calculator didn't provide perimeter
      let perimeter = 0;
      for (let i = 0; i < viewportPoints.length; i++) {
        const j = (i + 1) % viewportPoints.length;
        const dx = viewportPoints[j].x - viewportPoints[i].x;
        const dy = viewportPoints[j].y - viewportPoints[i].y;
        perimeter += Math.sqrt(dx * dx + dy * dy);
      }
      perimeterValue = perimeter / scaleFactor;
    }

    // Save to API
    if (currentProjectId && file?.id) {
      const { addTakeoffMeasurement, getPageTakeoffMeasurements } = useTakeoffStore.getState();
      
      addTakeoffMeasurement({
        projectId: currentProjectId,
        sheetId: file.id,
        conditionId: currentSelectedConditionId,
        type: measurementType,
        points: viewportPoints,
        calculatedValue,
        unit,
        pdfPage: currentPage,
        pdfCoordinates: points,
        conditionColor: selectedCondition.color,
        conditionName: selectedCondition.name,
        perimeterValue
      }).then(savedMeasurementId => {
        // The new measurement will automatically appear via the useEffect that watches takeoffMeasurements
        // No need for complex manual state management - just like annotations!
      }).catch(error => {
        console.error(`Failed to save ${measurementType.toUpperCase()} measurement:`, error);
      });
    }
    
    // Clear current measurement
    setCurrentMeasurement([]);
    setMousePosition(null);
  }, [getSelectedCondition, measurementType, scaleFactor, currentProjectId, currentPage, file.id, renderPDFPage]);

  // Complete cut-out measurement
  const completeCutout = useCallback(async (points: { x: number; y: number }[]) => {
    if (!cutoutTargetConditionId || points.length < 3) {
      return;
    }

    const currentStoreState = useTakeoffStore.getState();
    const { getPageTakeoffMeasurements, updateTakeoffMeasurement } = currentStoreState;
    
    // Get existing measurements for the target condition
    if (!file?.id || !currentProjectId) return;
    const existingMeasurements = getPageTakeoffMeasurements(currentProjectId, file.id, currentPage);
    const targetMeasurement = existingMeasurements.find(m => m.conditionId === cutoutTargetConditionId);
    
    if (!targetMeasurement) {
      console.error('Target measurement not found for cut-out');
      return;
    }

    // Calculate cut-out area/volume using enhanced calculator
    const viewport = currentViewport;
    if (!viewport) return;

    // Keep points in normalized coordinates for calculator consistency
    const viewportPoints = points.map(point => ({
      x: point.x,
      y: point.y
    }));

    // Import the enhanced measurement calculator
    const { MeasurementCalculator } = await import('../utils/measurementCalculation');
    
    // Create scale info object using calibration base viewport
    const calibBase2 = calibrationViewportRef.current;
    const scaleInfo = {
      scaleFactor,
      unit: 'ft',
      scaleText: 'detected',
      confidence: 0.9,
      viewportWidth: (calibBase2?.viewportWidth) || viewport.width,
      viewportHeight: (calibBase2?.viewportHeight) || viewport.height
    };
    
    let cutoutValue = 0;
    
    // Calculate area for cut-out
    const areaResult = MeasurementCalculator.calculateArea(viewportPoints, scaleInfo, viewState.scale);
    
    if (areaResult.validation.isValid) {
      // For volume measurements, multiply by depth
      if (targetMeasurement.type === 'volume') {
        const selectedCondition = getSelectedCondition();
        const depth = selectedCondition?.depth || 1;
        cutoutValue = areaResult.calculatedValue * depth;
      } else {
        cutoutValue = areaResult.calculatedValue;
      }
    } else {
      console.warn('Cutout area calculation failed:', areaResult.validation.errors);
      // Fallback to simple calculation
      let area = 0;
      for (let i = 0; i < viewportPoints.length; i++) {
        const j = (i + 1) % viewportPoints.length;
        area += viewportPoints[i].x * viewportPoints[j].y;
        area -= viewportPoints[j].x * viewportPoints[i].y;
      }
      
      const baseW = (calibrationViewportRef.current?.viewportWidth) || viewport.width;
      const baseH = (calibrationViewportRef.current?.viewportHeight) || viewport.height;
      // Convert normalized polygon area to pixel area using base viewport, then to units
      const pixelArea = Math.abs(area) * (baseW * baseH) / 2;
      const areaInSquareFeet = pixelArea * (scaleFactor * scaleFactor);
      
      if (targetMeasurement.type === 'volume') {
        const selectedCondition = getSelectedCondition();
        const depth = selectedCondition?.depth || 1;
        cutoutValue = areaInSquareFeet * depth;
      } else {
        cutoutValue = areaInSquareFeet;
      }
    }

    // Create cut-out object
    const cutout = {
      id: `cutout_${Date.now()}`,
      points: points, // Store in PDF coordinates (0-1 scale) for rendering
      pdfCoordinates: points, // Store in PDF coordinates (0-1 scale) for persistence
      calculatedValue: cutoutValue
    };

    // Add cut-out to existing measurement
    const existingCutouts = targetMeasurement.cutouts || [];
    const totalCutoutValue = existingCutouts.reduce((sum, c) => sum + c.calculatedValue, 0) + cutoutValue;
    
    const updatedMeasurement = {
      ...targetMeasurement,
      cutouts: [...existingCutouts, cutout],
      netCalculatedValue: targetMeasurement.calculatedValue - totalCutoutValue
    };

    // Update the measurement
    try {
      await updateTakeoffMeasurement(targetMeasurement.id, updatedMeasurement);
      
      // Update local measurements immediately with the new data
      setLocalTakeoffMeasurements(prevMeasurements => 
        prevMeasurements.map(measurement => 
          measurement.id === targetMeasurement.id 
            ? { ...measurement, ...updatedMeasurement }
            : measurement
        )
      );
      
      // Exit cut-out mode
      if (onCutoutModeChange) {
        onCutoutModeChange(null);
      }
      setCurrentCutout([]);
      
      // Re-render the page
      console.log('✂️ PDF RENDER TRIGGER: Cutout completion');
      requestAnimationFrame(() => {
        renderPDFPage(currentPage);
      });
      
    } catch (error) {
      console.error('❌ Failed to add cut-out:', error);
    }
  }, [cutoutTargetConditionId, currentProjectId, file.id, currentPage, scaleFactor, viewState.scale, currentViewport, getSelectedCondition, renderPDFPage, onCutoutModeChange]);

  // Complete continuous linear measurement
  const completeContinuousLinearMeasurement = useCallback(async () => {
    if (activePoints.length < 2) return;
    
    // Remove rubber band element with guarded removal
    const currentRubberBand = pageRubberBandRefs.current[currentPage];
    if (currentRubberBand && svgOverlayRef.current && currentRubberBand.parentNode === svgOverlayRef.current) {
      svgOverlayRef.current.removeChild(currentRubberBand);
    }
    
    // Clear page-scoped refs
    pageRubberBandRefs.current[currentPage] = null;
    setRubberBandElement(null);
    
    // Complete the measurement with all active points
    completeMeasurement(activePoints);
    
    // Reset continuous drawing state
    setIsContinuousDrawing(false);
    setActivePoints([]);
    setRunningLength(0);
  }, [activePoints, currentPage, completeMeasurement]);

  // Handle double-click to complete measurements
  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    // Prevent default behavior
    event.preventDefault();
    event.stopPropagation();
    
    // Handle freehand annotation completion
    if (annotationTool === 'freehand' && currentAnnotation.length >= 1 && currentProjectId && file?.id) {
      try {
        addAnnotation({
          projectId: currentProjectId,
          sheetId: file.id,
          type: 'freehand',
          points: currentAnnotation,
          color: annotationColor,
          pageNumber: currentPage
        });
        setCurrentAnnotation([]);
        onAnnotationToolChange?.(null);
      } catch (error) {
        console.error('Failed to save freehand annotation:', error);
      }
      return;
    }
    
    // Handle cut-out completion
    if (cutoutMode && currentCutout.length >= 3) {
      completeCutout(currentCutout);
      return;
    }
    
    if (isContinuousDrawing && activePoints.length >= 2) {
      // Complete the continuous linear measurement
      completeContinuousLinearMeasurement();
    } else if ((measurementType === 'area' || measurementType === 'volume') && currentMeasurement.length >= 3) {
      // Complete area or volume measurement
      completeMeasurement(currentMeasurement);
    }
  }, [annotationTool, currentAnnotation, annotationColor, currentPage, onAnnotationToolChange, isContinuousDrawing, activePoints, measurementType, currentMeasurement, completeContinuousLinearMeasurement, completeMeasurement, cutoutMode, currentCutout, completeCutout]);

  // Cleanup continuous drawing state
  const cleanupContinuousDrawing = useCallback(() => {
    // Clean up rubber band for current page
    const currentRubberBand = pageRubberBandRefs.current[currentPage];
    if (currentRubberBand && svgOverlayRef.current && currentRubberBand.parentNode === svgOverlayRef.current) {
      try {
        svgOverlayRef.current.removeChild(currentRubberBand);
      } catch (e) {
        console.warn('🎯 Failed to remove rubber band:', e);
      }
    }
    
    // Clear page-scoped refs
    pageRubberBandRefs.current[currentPage] = null;
    setRubberBandElement(null);
    setIsContinuousDrawing(false);
    setActivePoints([]);
    setRunningLength(0);
  }, [currentPage]);

  // Reset continuous drawing when measurement type changes
  useEffect(() => {
    if (measurementType !== 'linear') {
      cleanupContinuousDrawing();
    }
  }, [measurementType, cleanupContinuousDrawing]);

  // Clean up page-scoped refs when page changes
  useEffect(() => {
    // Clean up any existing rubber band elements from previous pages
    Object.keys(pageRubberBandRefs.current).forEach(pageNum => {
      const pageNumInt = parseInt(pageNum);
      if (pageNumInt !== currentPage) {
        const rubberBand = pageRubberBandRefs.current[pageNumInt];
        if (rubberBand && rubberBand.parentNode) {
          try {
            rubberBand.parentNode.removeChild(rubberBand);
          } catch (e) {
            console.warn('🎯 Failed to clean up rubber band from page', pageNumInt, e);
          }
        }
        pageRubberBandRefs.current[pageNumInt] = null;
      }
    });
    
    // Clean up any existing committed polylines from previous pages
    Object.keys(pageCommittedPolylineRefs.current).forEach(pageNum => {
      const pageNumInt = parseInt(pageNum);
      if (pageNumInt !== currentPage) {
        const polyline = pageCommittedPolylineRefs.current[pageNumInt];
        if (polyline && polyline.parentNode) {
          try {
            polyline.parentNode.removeChild(polyline);
          } catch (e) {
            console.warn('🎯 Failed to clean up committed polyline from page', pageNumInt, e);
          }
        }
        pageCommittedPolylineRefs.current[pageNumInt] = null;
      }
    });
  }, [currentPage]);

  // Complete calibration
  const completeCalibration = useCallback((points: { x: number; y: number }[]) => {
    if (points.length !== 2 || !calibrationData || !currentViewport) return;
    
    const knownDistance = calibrationData.knownDistance;
    const unit = calibrationData.unit;
    
    // Get the PDF page dimensions for accurate scale calculations
    const pdfPage = pdfPageRef.current;
    if (!pdfPage) {
      console.error('PDF page is not available for calibration');
      return;
    }
    
    // Use a base viewport for calibration (rotation applied, scale = 1)
    const baseViewport = pdfPage.getViewport({ scale: 1, rotation: viewState.rotation });
    
    // Calculate distance in base viewport pixels (CSS space)
    const dx = (points[1].x - points[0].x) * baseViewport.width;
    const dy = (points[1].y - points[0].y) * baseViewport.height;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    
    // Calculate scale: real-world distance / pixel distance
    // This gives us the scale factor in units per pixel
    const newScaleFactor = knownDistance / pixelDistance;
    
    // Store the calibration base viewport info for consistent measurements
    const calibrationInfo = {
      viewportWidth: baseViewport.width,
      viewportHeight: baseViewport.height,
      scale: 1,
      rotation: baseViewport.rotation
    };
    
    // Validate the scale factor calculation
    const testDistance = pixelDistance * newScaleFactor;
    const accuracy = 1 - Math.abs(testDistance - knownDistance) / knownDistance;
    
    // Debug logging for calibration
    console.log('🔧 CALIBRATION:', {
      knownDistance: knownDistance,
      pixelDistance: pixelDistance,
      calculatedScaleFactor: newScaleFactor,
      accuracy: (accuracy * 100).toFixed(2) + '%',
      unit: unit,
      viewport: { width: baseViewport.width, height: baseViewport.height, scale: 1, rotation: baseViewport.rotation },
      normalizedPoints: points,
      // Test calculation
      testCalculation: pixelDistance * newScaleFactor,
      expectedResult: knownDistance,
      // Show the actual calculation step by step
      step1_normalizedDistance: Math.sqrt((points[1].x - points[0].x) ** 2 + (points[1].y - points[0].y) ** 2),
      step2_pixelDistance: pixelDistance,
      step3_scaleFactor: newScaleFactor,
      step4_finalResult: pixelDistance * newScaleFactor
    });
    
    // Validate scale factor reasonableness with more comprehensive checks
    const warnings: string[] = [];
    const errors: string[] = [];
    
    // Check for extremely small scale factors (likely measurement error)
    if (newScaleFactor < 0.0001) {
      errors.push('Scale factor is extremely small - check if calibration points are too close together');
    } else if (newScaleFactor < 0.001) {
      warnings.push('Scale factor is very small - verify calibration points are far enough apart');
    }
    
    // Check for extremely large scale factors (likely measurement error)
    if (newScaleFactor > 10000) {
      errors.push('Scale factor is extremely large - check if calibration points are too far apart');
    } else if (newScaleFactor > 1000) {
      warnings.push('Scale factor is very large - verify calibration points are close enough together');
    }
    
    // Check calibration accuracy
    if (accuracy < 0.90) {
      errors.push('Calibration accuracy is very low - please re-calibrate with more precise points');
    } else if (accuracy < 0.95) {
      warnings.push('Calibration accuracy is low - consider re-calibrating for better precision');
    }
    
    // Check if the known distance seems reasonable for the pixel distance
    const pixelsPerFoot = 1 / newScaleFactor;
    if (pixelsPerFoot < 1) {
      warnings.push('Very high resolution detected - verify the known distance is correct');
    } else if (pixelsPerFoot > 1000) {
      warnings.push('Very low resolution detected - verify the known distance is correct');
    }
    
    // Check for reasonable scale ranges based on typical architectural drawings
    // Typical scales: 1/8" = 1', 1/4" = 1', 1/2" = 1', 1" = 1', etc.
    // This translates to scale factors roughly between 0.01 and 0.1 feet per pixel
    if (newScaleFactor < 0.005 || newScaleFactor > 0.2) {
      warnings.push('Scale factor outside typical architectural drawing range - verify known distance');
    }
    
    if (errors.length > 0) {
      console.error('❌ CALIBRATION ERRORS:', errors);
      // Don't proceed with calibration if there are errors
      setCalibrationPoints([]);
      setCalibrationData(null);
      setIsCalibrating(false);
      alert(`Calibration failed: ${errors.join(', ')}`);
      return;
    }
    
    if (warnings.length > 0) {
      console.warn('⚠️ CALIBRATION WARNINGS:', warnings);
      // Show warnings but allow calibration to proceed
      const warningMessage = warnings.join('\n');
      if (confirm(`Calibration warnings:\n\n${warningMessage}\n\nDo you want to proceed with this calibration?`)) {
        // User confirmed, continue with calibration
      } else {
        // User cancelled, reset calibration
        setCalibrationPoints([]);
        setCalibrationData(null);
        setIsCalibrating(false);
        return;
      }
    }
    
    if (externalScaleFactor === undefined) {
      setInternalScaleFactor(newScaleFactor);
    }
    if (externalUnit === undefined) {
      setInternalUnit(unit);
    }
    if (externalIsPageCalibrated === undefined) {
      setInternalIsPageCalibrated(true);
    }
    setPendingScaleData({ scaleFactor: newScaleFactor, unit });
    setShowScaleApplicationDialog(true);
    // Show a brief on-canvas validator with the computed distance
    try {
      const measured = pixelDistance * newScaleFactor; // in unit
      const display = unit === 'ft' 
        ? `${formatFeetAndInches(measured)}` 
        : `${measured.toFixed(2)} ${unit}`;
      setCalibrationValidation({ points, display, page: currentPage });
      // Auto-clear after 3 seconds
      setTimeout(() => setCalibrationValidation(null), 3000);
    } catch {}
    
    // Store calibration viewport info for consistent measurements
    if (currentViewport) {
      calibrationViewportRef.current = {
        scaleFactor: newScaleFactor,
        unit: unit,
        viewportWidth: currentViewport.width,
        viewportHeight: currentViewport.height,
        scale: currentViewport.scale,
        rotation: currentViewport.rotation
      };
    }
    
    if (onCalibrationComplete) {
      onCalibrationComplete(true, newScaleFactor, unit);
    }
    
    setCalibrationPoints([]);
    setIsCalibrating(false);
    setCalibrationData(null);
  }, [calibrationData, onCalibrationComplete, currentViewport, viewState.rotation]);

  // Start calibration
  const startCalibration = useCallback((knownDistance: number, unit: string) => {
    setCalibrationData({ knownDistance, unit });
    setIsCalibrating(true);
    setCalibrationPoints([]);
    setShowCalibrationDialog(false);
  }, []);

  // Apply scale
  const applyScale = useCallback((scope: 'page' | 'document') => {
    if (!pendingScaleData) return;
    
    if (externalScaleFactor === undefined) {
      setInternalScaleFactor(pendingScaleData.scaleFactor);
    }
    if (externalUnit === undefined) {
      setInternalUnit(pendingScaleData.unit);
    }
    if (externalIsPageCalibrated === undefined) {
      setInternalIsPageCalibrated(true);
    }
    
    setPendingScaleData(null);
    setShowScaleApplicationDialog(false);
  }, [pendingScaleData, externalScaleFactor, externalUnit, externalIsPageCalibrated]);

  // Handle wheel events for zoom
  const handleWheel = useCallback((event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      
      const ZOOM_STEP = 1.2;
      const MIN_SCALE = 0.5;
      const MAX_SCALE = 3;
      
      const zoomFactor = event.deltaY < 0 ? ZOOM_STEP : 1/ZOOM_STEP;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, 
        viewState.scale * zoomFactor
      ));
      
      // Update internal state and notify parent
      setInternalViewState(prev => ({ ...prev, scale: newScale }));
      if (onScaleChange) onScaleChange(newScale);

      // If renders are currently blocked (interactive drawing/calibration/etc),
      // apply CSS transform to simulate zoom without re-rendering the PDF canvas.
      const rendersBlocked = (isMeasuring || isCalibrating || currentMeasurement.length > 0 || isDeselecting || (isAnnotating && !showTextInput));
      if (rendersBlocked) {
        requestAnimationFrame(() => {
          // Only apply synchronized CSS transform to both canvas and SVG.
          // Do NOT re-render overlay during blocked zoom to avoid double-scaling drift.
          applyInteractiveZoomTransforms();
        });
        // Zoom toward cursor by adjusting scroll to keep cursor-anchored point stable
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const offsetX = event.clientX - rect.left;
          const offsetY = event.clientY - rect.top;
          const r = newScale / (viewState.scale || 1);
          container.scrollLeft = (container.scrollLeft + offsetX) * r - offsetX;
          container.scrollTop = (container.scrollTop + offsetY) * r - offsetY;
        }
        return;
      }
      
      // Otherwise, do not redraw overlay immediately; wait for the debounced full PDF render
      // to keep canvas and overlay perfectly in lockstep.
      // Zoom toward cursor for normal renders as well
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;
        const r = newScale / (viewState.scale || 1);
        container.scrollLeft = (container.scrollLeft + offsetX) * r - offsetX;
        container.scrollTop = (container.scrollTop + offsetY) * r - offsetY;
      }
    }
  }, [viewState.scale, viewState.rotation, onScaleChange, pdfDocument, localTakeoffMeasurements, isMeasuring, isCalibrating, currentMeasurement.length, isDeselecting, isAnnotating, showTextInput, applyInteractiveZoomTransforms]);

  // Fit PDF to window function
  const fitToWindow = useCallback(async () => {
    if (!pdfDocument || !containerRef.current || !pdfPageRef.current) {
      return;
    }

    try {
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      
      // Get available space in container (accounting for any padding/margins)
      const availableWidth = containerRect.width - 20; // 10px padding on each side
      const availableHeight = containerRect.height - 20; // 10px padding on each side
      

      // Get the current page to calculate its dimensions
      const page = pdfPageRef.current;
      const viewport = page.getViewport({ scale: 1.0, rotation: viewState.rotation });
      

      // Calculate scale to fit both width and height
      const scaleX = availableWidth / viewport.width;
      const scaleY = availableHeight / viewport.height;
      const optimalScale = Math.min(scaleX, scaleY, 5); // Cap at 5x zoom
      

      // Apply the new scale
      if (onScaleChange) {
        onScaleChange(optimalScale);
      } else {
        setInternalViewState(prev => ({ ...prev, scale: optimalScale }));
      }

      // Immediately re-render markups with new scale - bypass anti-flicker
      if (localTakeoffMeasurements.length > 0) {
        requestAnimationFrame(() => {
          if (pdfPageRef.current) {
            const freshViewport = pdfPageRef.current.getViewport({ 
              scale: optimalScale, 
              rotation: viewState.rotation 
            });
            renderTakeoffAnnotations(currentPage, freshViewport, pdfPageRef.current);
          }
        });
      }

    } catch (error) {
      console.error('❌ FIT_TO_WINDOW: Error fitting to window', error);
    }
  }, [pdfDocument, viewState.rotation, onScaleChange, localTakeoffMeasurements, forceMarkupReRender]);

  // Handle rotation

  // Add scroll position tracking
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (onLocationChange) {
        onLocationChange(container.scrollLeft, container.scrollTop);
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [onLocationChange]);

  // Add global function to restore scroll position
  useEffect(() => {
    (window as any).restoreScrollPosition = (x: number, y: number) => {
      const container = containerRef.current;
      if (container) {
        container.scrollLeft = x;
        container.scrollTop = y;
      }
    };

    return () => {
      delete (window as any).restoreScrollPosition;
    };
  }, []);

  // Add wheel event listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Apply or clear interactive CSS zoom when external scale changes while renders are blocked
  useEffect(() => {
    const rendersBlocked = (isMeasuring || isCalibrating || currentMeasurement.length > 0 || isDeselecting || (isAnnotating && !showTextInput));
    if (rendersBlocked) {
      applyInteractiveZoomTransforms();
    } else {
      // Clear transforms if any
      if (pdfCanvasRef.current) {
        pdfCanvasRef.current.style.transform = '';
        pdfCanvasRef.current.style.transformOrigin = '';
      }
      if (svgOverlayRef.current) {
        svgOverlayRef.current.style.transform = '';
        svgOverlayRef.current.style.transformOrigin = '';
      }
    }
  }, [viewState.scale, isMeasuring, isCalibrating, currentMeasurement.length, isDeselecting, isAnnotating, showTextInput, applyInteractiveZoomTransforms]);

  // Handle escape key to back out vertices one-by-one and delete key to delete selected markup
  const handleKeyDown = useCallback(async (event: KeyboardEvent) => {
    // Handle escape for annotation mode
    if (event.key === 'Escape' && annotationTool) {
      event.preventDefault();
      
      if (currentAnnotation.length > 0) {
        // Remove the last point (like linear measurements)
        setCurrentAnnotation(prev => {
          const newPoints = [...prev];
          newPoints.pop(); // Remove the last vertex
          
          // If no vertices remain, exit annotation mode
          if (newPoints.length === 0) {
            onAnnotationToolChange?.(null);
          }
          return newPoints;
        });
      } else {
        // Exit annotation mode if no points
        onAnnotationToolChange?.(null);
      }
      return;
    }
    
    // Handle Enter key to complete freehand annotation (fallback for double-click)
    if (event.key === 'Enter' && annotationTool === 'freehand' && currentAnnotation.length >= 1 && currentProjectId && file?.id) {
      event.preventDefault();
      
      try {
        addAnnotation({
          projectId: currentProjectId,
          sheetId: file.id,
          type: 'freehand',
          points: currentAnnotation,
          color: annotationColor,
          pageNumber: currentPage
        });
        setCurrentAnnotation([]);
        onAnnotationToolChange?.(null);
      } catch (error) {
        console.error('Failed to save freehand annotation via Enter key:', error);
      }
      return;
    }
    
    if (event.key === 'Escape' && (isMeasuring || isCalibrating)) {
      event.preventDefault();
      
      // Handle escape for calibration mode
      if (isCalibrating) {
        if (calibrationPoints.length > 0) {
          // Remove the last calibration point
          setCalibrationPoints(prev => {
            const newPoints = [...prev];
            newPoints.pop();
            
            // If no points remain, exit calibration mode
            if (newPoints.length === 0) {
              setIsCalibrating(false);
              setMousePosition(null);
              setCalibrationData(null);
            }
            
            return newPoints;
          });
        } else {
          // Exit calibration mode completely
          setIsCalibrating(false);
          setMousePosition(null);
          setCalibrationData(null);
        }
        return;
      }
      
      // Handle escape for continuous linear drawing
      if (measurementType === 'linear' && isContinuousDrawing && activePoints.length > 0) {
        setActivePoints(prev => {
          const newPoints = [...prev];
          newPoints.pop(); // Remove the last vertex
          
          // If no vertices remain, exit measurement mode
          if (newPoints.length === 0) {
            setIsMeasuring(false);
            setMousePosition(null);
            setIsContinuousDrawing(false);
            setRunningLength(0);
            // Clean up rubber band element
            const currentRubberBand = pageRubberBandRefs.current[currentPage];
            if (currentRubberBand && svgOverlayRef.current && currentRubberBand.parentNode === svgOverlayRef.current) {
              svgOverlayRef.current.removeChild(currentRubberBand);
            }
            pageRubberBandRefs.current[currentPage] = null;
            setRubberBandElement(null);
          }
          
          return newPoints;
        });
      } else if (currentMeasurement.length > 0) {
        // Handle escape for other measurement types
        setCurrentMeasurement(prev => {
          const newMeasurement = [...prev];
          newMeasurement.pop(); // Remove the last vertex
          
          // If no vertices remain, exit measurement mode
          if (newMeasurement.length === 0) {
            setIsMeasuring(false);
            setMousePosition(null);
          }
          
          return newMeasurement;
        });
      }
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedMarkupId && isSelectionMode) {
      event.preventDefault();
      
      // Check if it's an annotation or a measurement
      const isAnnotation = localAnnotations.some(a => a.id === selectedMarkupId);
      
      if (isAnnotation) {
        console.log('🗑️ DELETING ANNOTATION:', {
          selectedMarkupId,
          currentLocalAnnotations: localAnnotations.length,
          annotationToDelete: localAnnotations.find(a => a.id === selectedMarkupId)
        });
        
        // Delete annotation from store
        const { deleteAnnotation } = useTakeoffStore.getState();
        deleteAnnotation(selectedMarkupId);
        
        // Get updated annotations from store after deletion
        const { annotations: updatedAnnotations } = useTakeoffStore.getState();
        
        // Immediately update local annotations to reflect the deletion
        const filteredAnnotations = updatedAnnotations.filter(
          a => a.projectId === currentProjectId && a.sheetId === file.id
        );
        setLocalAnnotations(filteredAnnotations);
        setSelectedMarkupId(null);
        
        console.log('🗑️ ANNOTATION DELETED:', {
          selectedMarkupId,
          remainingAnnotations: filteredAnnotations.length,
          allStoreAnnotations: updatedAnnotations.length,
          deletedSuccessfully: !updatedAnnotations.some(a => a.id === selectedMarkupId)
        });
        
        // Force a re-render after a small delay to ensure state updates are processed
        setTimeout(() => {
          // Immediately re-render the SVG overlay to show the deletion
          if (currentViewport) {
            renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
          }
          
          // Also re-render the PDF page
          console.log('🗑️ PDF RENDER TRIGGER: Annotation deletion');
          requestAnimationFrame(() => {
            renderPDFPage(currentPage);
          });
        }, 10);
      } else if (currentProjectId && file?.id) {
        // Delete measurement
        const { deleteTakeoffMeasurement, getPageTakeoffMeasurements } = useTakeoffStore.getState();
        
        try {
          await deleteTakeoffMeasurement(selectedMarkupId);
          // Reload measurements from API
          const updatedMeasurements = getPageTakeoffMeasurements(currentProjectId, file.id, currentPage);
          
          const displayMeasurements = updatedMeasurements.map(apiMeasurement => ({
            id: apiMeasurement.id,
            type: apiMeasurement.type,
            points: apiMeasurement.points,
            calculatedValue: apiMeasurement.calculatedValue,
            unit: apiMeasurement.unit,
            conditionId: apiMeasurement.conditionId,
            conditionName: apiMeasurement.conditionName,
            color: apiMeasurement.conditionColor,
            timestamp: new Date(apiMeasurement.timestamp).getTime(),
            pdfPage: apiMeasurement.pdfPage,
            pdfCoordinates: apiMeasurement.pdfCoordinates,
            perimeterValue: apiMeasurement.perimeterValue
          }));
          
          setLocalTakeoffMeasurements(displayMeasurements);
          setSelectedMarkupId(null);
          
          console.log('🗑️ MEASUREMENT DELETED:', {
            selectedMarkupId,
            remainingMeasurements: displayMeasurements.length
          });
          
          // Force a re-render after a small delay to ensure state updates are processed
          setTimeout(() => {
            // Immediately re-render the SVG overlay to show the deletion
            if (currentViewport) {
              renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
            }
            
            // Also re-render the PDF page
            console.log('🗑️ PDF RENDER TRIGGER: Measurement deletion');
            requestAnimationFrame(() => {
              renderPDFPage(currentPage);
            });
          }, 10);
        } catch (error: any) {
          console.error(`Failed to delete markup:`, error);
        }
      }
    } else if (event.key === 'Control' && (isMeasuring || isCalibrating)) {
      // Toggle ortho snapping when Ctrl is pressed during measurement or calibration
      event.preventDefault();
      setIsOrthoSnapping(prev => !prev);
    }
  }, [annotationTool, currentAnnotation, onAnnotationToolChange, localAnnotations, isMeasuring, isCalibrating, calibrationPoints.length, currentMeasurement.length, selectedMarkupId, isSelectionMode, currentProjectId, file?.id, currentPage, renderPDFPage, measurementType, isContinuousDrawing, activePoints.length, isOrthoSnapping]);

  // Add keyboard event listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Re-render when page changes
  useEffect(() => {
    if (pdfDocument && isComponentMounted) {
      setMeasurements([]);
      
      // Optimized retry mechanism if canvas is not ready
      const attemptRender = async (retries = 3) => {
        if (pdfCanvasRef.current && containerRef.current) {
          if (process.env.NODE_ENV === 'development') {
            // console.log('🔄 PDF RENDER TRIGGER: Initial render attempt');
          }
          await renderPDFPage(currentPage);
        } else if (retries > 0) {
          setTimeout(() => attemptRender(retries - 1), 50); // Reduced retry delay
        } else {
          if (process.env.NODE_ENV === 'development') {
            console.warn('Canvas not ready after retries, skipping render');
          }
        }
      };
      
      attemptRender();
    }
  }, [pdfDocument, currentPage, renderPDFPage, isComponentMounted]);

  // Page visibility handler - ensures overlays are rendered when returning to a page
  useEffect(() => {
    if (pdfDocument && currentViewport && !isRenderingRef.current) {
      // Use the dedicated page shown handler to ensure proper overlay initialization
      onPageShown(currentPage, currentViewport);
    }
  }, [currentPage, currentViewport, onPageShown]);

  // Clear current measurement state when page changes
  useEffect(() => {
    setCurrentMeasurement([]);
    setMousePosition(null);
    setMeasurements([]);
  }, [currentPage]);

  // Optimized re-render when view state changes (zoom/rotation)
  useEffect(() => {
    if (pdfDocument && isComponentMounted && isInitialRenderComplete) {
      if (process.env.NODE_ENV === 'development') {
        // console.log('🔍 PDF RENDER TRIGGER: View state change (zoom/rotation)');
      }
      
      // ANTI-FLICKER: Skip PDF re-render during interactive operations or deselection cooldown
      // Allow PDF renders during text annotation input (showTextInput = true)
      // Allow initial renders even if in deselection mode (for page loads)
      if (isMeasuring || isCalibrating || currentMeasurement.length > 0 || (isDeselecting && isInitialRenderComplete) || (isAnnotating && !showTextInput)) {
        if (process.env.NODE_ENV === 'development') {
          // console.log('🚫 PDF RENDER BLOCKED: Interactive/deselection mode - NO PDF render calls');
        }
        // When blocked, simulate zoom via CSS transform so the user sees immediate zoom
        // without re-rendering the PDF canvas (prevents flicker while drawing)
        applyInteractiveZoomTransforms();
        return;
      }
      
      // ANTI-FLICKER: Block ALL renders during deselection period
      if (isDeselecting) {
        if (process.env.NODE_ENV === 'development') {
          // console.log('🚫 PDF RENDER BLOCKED: Deselection cooldown active');
        }
        return;
      }
      
      // Optimized debounce for non-interactive mode
      if (process.env.NODE_ENV === 'development') {
        console.log('✅ PDF RENDER ALLOWED: Non-interactive mode');
      }
      const timeoutId = setTimeout(() => {
        renderPDFPage(currentPage);
      }, 30); // Further reduced debounce for better responsiveness
      
      return () => clearTimeout(timeoutId);
    }
  }, [viewState, renderPDFPage, currentPage, isComponentMounted, isMeasuring, isCalibrating, currentMeasurement, currentViewport, renderTakeoffAnnotations, isDeselecting, isInitialRenderComplete, isAnnotating, showTextInput]);


  // Set measurement type when condition is selected
  useEffect(() => {
    if (selectedConditionId) {
      const condition = getSelectedCondition();
      if (condition) {
        console.log('📋 CONDITION SELECTED: Starting measurement mode');
        setIsMeasuring(true);
        setIsSelectionMode(false);
        setSelectedMarkupId(null);
        setIsDeselecting(false); // Clear deselection state
        
        if (condition.unit === 'EA' || condition.unit === 'each') {
          setMeasurementType('count');
        } else if (condition.unit === 'SF' || condition.unit === 'sq ft') {
          setMeasurementType('area');
        } else if (condition.unit === 'CY' || condition.unit === 'cu yd') {
          setMeasurementType('volume');
        } else {
          setMeasurementType('linear');
        }
      }
    } else {
      console.log('📋 CONDITION DESELECTED: Switching to selection mode');
      setIsMeasuring(false);
      setIsSelectionMode(true);
      setCurrentMeasurement([]);
      setMousePosition(null);
      setMeasurements([]);
      
      // ANTI-FLICKER: Extended cooldown after deselection to prevent flicker storm
      console.log('🚫 STARTING DESELECTION COOLDOWN: 5 seconds');
      setIsDeselecting(true);
      
      // Store timeout ID so we can clear it if needed
      const timeoutId = setTimeout(() => {
        console.log('✅ DESELECTION COOLDOWN COMPLETE: Normal operation resumed');
        setIsDeselecting(false);
      }, 5000); // 5 second cooldown after deselection
      
      // Clear timeout if component unmounts or condition changes
      return () => {
        clearTimeout(timeoutId);
        setIsDeselecting(false);
      };
    }
  }, [selectedConditionId]);

  // Set annotation mode when annotation tool is selected
  useEffect(() => {
    if (annotationTool) {
      console.log('📝 ANNOTATION TOOL SELECTED: Starting annotation mode');
      setIsAnnotating(true);
      setIsSelectionMode(false);
      setSelectedMarkupId(null);
      setIsDeselecting(false); // Clear deselection state
    } else {
      console.log('📝 ANNOTATION TOOL DESELECTED: Switching to selection mode');
      setIsAnnotating(false);
      setIsSelectionMode(true);
      setCurrentAnnotation([]);
      setMousePosition(null);
    }
  }, [annotationTool]);

  // Listen for calibration requests
  useEffect(() => {
    if (onCalibrationRequest) {
      const handleCalibrationRequest = () => {
        setShowCalibrationDialog(true);
      };
      
      (window as any).triggerCalibration = handleCalibrationRequest;
      
      return () => {
        delete (window as any).triggerCalibration;
      };
    }
  }, [onCalibrationRequest]);

  // Expose fitToWindow function globally
  useEffect(() => {
    (window as any).triggerFitToWindow = fitToWindow;
    
    return () => {
      delete (window as any).triggerFitToWindow;
    };
  }, [fitToWindow]);

  // Cleanup effect for memory management
  useEffect(() => {
    return () => {
      // Cancel any pending render tasks
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      
      // Clear and reset canvas context
      if (pdfCanvasRef.current) {
        const context = pdfCanvasRef.current.getContext('2d');
        if (context) {
          context.clearRect(0, 0, pdfCanvasRef.current.width, pdfCanvasRef.current.height);
          context.setTransform(1, 0, 0, 1, 0, 0);
        }
        // Reset canvas dimensions to free memory
        pdfCanvasRef.current.width = 0;
        pdfCanvasRef.current.height = 0;
      }
      
      // Clear SVG overlay
      if (svgOverlayRef.current) {
        svgOverlayRef.current.innerHTML = '';
      }
      
      // Clear refs to prevent memory leaks
      pdfPageRef.current = null;
      isRenderingRef.current = false;
      
      // Clear page-specific viewport data
      setPageViewports({});
      setPageOutputScales({});
    };
  }, []);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center text-red-600">
          <p className="text-lg font-semibold mb-2">Error Loading PDF</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!pdfDocument) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center">
          <p className="text-gray-600 mb-2">No PDF loaded</p>
          <p className="text-sm text-gray-500">File: {file?.originalName || file?.id || 'Unknown'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`pdf-viewer-container h-full flex flex-col relative ${className}`}>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>


      {/* Single Canvas + SVG Overlay Container */}
      <div 
        ref={containerRef}
        className="canvas-container flex-1 h-full overflow-auto"
        style={{ 
          cursor: cutoutMode 
            ? 'crosshair' 
            : (isCalibrating ? 'crosshair' : (isMeasuring ? 'crosshair' : (isSelectionMode ? 'pointer' : 'default')))
        }}
      >
        <div className="flex justify-start p-6 relative">
          {/* Canvas Container - Ensures perfect alignment */}
          <div 
            className="relative inline-block"
            style={{
              // Ensure container has no extra spacing or borders
              margin: 0,
              padding: 0,
              border: 'none',
              outline: 'none'
            }}
          >
            {/* PDF Canvas (Background Layer) */}
            <canvas
              ref={pdfCanvasRef}
              className="shadow-lg"
              style={{
                cursor: cutoutMode 
                  ? 'crosshair' 
                  : (isCalibrating ? 'crosshair' : (isMeasuring ? 'crosshair' : (isSelectionMode ? 'pointer' : 'default'))),
                display: 'block',
                position: 'relative',
                zIndex: 1,
                // Ensure no extra spacing
                margin: 0,
                padding: 0,
                border: 'none',
                outline: 'none'
              }}
              onClick={handleClick}
              onDoubleClick={(e) => {
                // Only handle double-click for non-annotation cases
                if (!annotationTool) {
                  handleDoubleClick(e);
                } else {
                  // For annotations, prevent the canvas from handling the event
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setMousePosition(null)}
            />
            
            {/* SVG Overlay (Foreground Layer) - Page-specific with stable key */}
            <svg
              key={`overlay-${currentPage}-${file?.id || 'default'}`}
              ref={svgOverlayRef}
              id={`overlay-page-${currentPage}`}
              className="shadow-lg"
              style={{
                cursor: cutoutMode 
                  ? 'crosshair' 
                  : (visualSearchMode && isSelectingSymbol)
                  ? 'crosshair'
                  : (annotationTool ? 'crosshair' : (isCalibrating ? 'crosshair' : (isMeasuring ? 'crosshair' : (isSelectionMode ? 'pointer' : 'default')))),
                display: 'block',
                position: 'absolute',
                top: 0,
                left: 0,
                zIndex: 2,
                // Ensure perfect overlay alignment
                margin: 0,
                padding: 0,
                border: 'none',
                outline: 'none',
                pointerEvents: (isSelectionMode || isCalibrating || annotationTool || (visualSearchMode && isSelectingSymbol)) ? 'auto' : 'none' // Allow clicks in selection, calibration, annotation, or visual search mode
              }}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setMousePosition(null)}
              onClick={(e) => {
                // Handle clicks in selection mode, calibration mode, annotation mode, or visual search mode
                if (isSelectionMode || isCalibrating || annotationTool || (visualSearchMode && isSelectingSymbol)) {
                  e.stopPropagation();
                  
                  // Check for double-click on freehand annotations
                  if (annotationTool === 'freehand' && currentAnnotation.length >= 1) {
                    const currentTime = Date.now();
                    const timeDiff = currentTime - lastClickTime;
                    const clickPosition = { x: e.clientX, y: e.clientY };
                    
                    // Check if this is a double-click (within 500ms and similar position)
                    if (timeDiff < 500 && lastClickPosition && 
                        Math.abs(clickPosition.x - lastClickPosition.x) < 10 && 
                        Math.abs(clickPosition.y - lastClickPosition.y) < 10) {
                      e.preventDefault();
                      e.stopPropagation();
                      
                      // Complete the freehand annotation
                      if (currentProjectId && file?.id) {
                        try {
                          addAnnotation({
                            projectId: currentProjectId,
                            sheetId: file.id,
                            type: 'freehand',
                            points: currentAnnotation,
                            color: annotationColor,
                            pageNumber: currentPage
                          });
                          setCurrentAnnotation([]);
                          onAnnotationToolChange?.(null);
                          setLastClickTime(0);
                          setLastClickPosition(null);
                          return;
                        } catch (error) {
                          console.error('Failed to save freehand annotation:', error);
                        }
                      }
                    } else {
                      // Store click info for double-click detection
                      setLastClickTime(currentTime);
                      setLastClickPosition(clickPosition);
                    }
                  }
                  
                  handleClick(e);
                }
              }}
              onContextMenu={(e) => {
                // Handle right-click to complete freehand annotation (fallback)
                if (annotationTool === 'freehand' && currentAnnotation.length >= 1 && currentProjectId && file?.id) {
                  e.preventDefault();
                  e.stopPropagation();
                  
                  try {
                    addAnnotation({
                      projectId: currentProjectId,
                      sheetId: file.id,
                      type: 'freehand',
                      points: currentAnnotation,
                      color: annotationColor,
                      pageNumber: currentPage
                    });
                    setCurrentAnnotation([]);
                    onAnnotationToolChange?.(null);
                  } catch (error) {
                    console.error('Failed to save freehand annotation via right-click:', error);
                  }
                }
              }}
              onDoubleClick={(e) => {
                // Handle double-click in annotation mode
                if (annotationTool) {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDoubleClick(e);
                }
              }}
            />

            {/* PDF Loading Indicator */}
            {isPDFLoading && (
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 1000,
                  background: 'rgba(255, 255, 255, 0.9)',
                  padding: '20px',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    border: '3px solid #f3f3f3',
                    borderTop: '3px solid #3498db',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }}
                />
                <div style={{ fontSize: '14px', color: '#666', fontWeight: '500' }}>
                  Loading PDF...
                </div>
              </div>
            )}

            {/* Text Annotation Input - Positioned relative to canvas */}
            {showTextInput && textInputPosition && (
              <div
                style={{
                  position: 'absolute',
                  left: textInputPosition.x + 'px',
                  top: textInputPosition.y + 'px',
                  zIndex: 1000,
                  pointerEvents: 'auto',
                }}
              >
                <input
                  type="text"
                  autoFocus
                  value={textInputValue}
                  onChange={(e) => setTextInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && textInputValue.trim() && currentProjectId && file?.id) {
                      // Save text annotation
                      addAnnotation({
                        projectId: currentProjectId,
                        sheetId: file.id,
                        type: 'text',
                        points: currentAnnotation,
                        color: annotationColor,
                        text: textInputValue,
                        pageNumber: currentPage
                      });
                      setCurrentAnnotation([]);
                      setTextInputValue('');
                      setShowTextInput(false);
                      setTextInputPosition(null);
                      onAnnotationToolChange?.(null);
                    } else if (e.key === 'Escape') {
                      // Cancel text annotation
                      setCurrentAnnotation([]);
                      setTextInputValue('');
                      setShowTextInput(false);
                      setTextInputPosition(null);
                      onAnnotationToolChange?.(null);
                    }
                  }}
                  className="border-2 border-blue-500 rounded px-2 py-1 text-sm shadow-lg bg-white"
                  placeholder="Enter text..."
                  style={{
                    minWidth: '120px',
                    fontSize: '14px',
                    fontFamily: 'Arial, sans-serif',
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Calibration Dialog */}
      <CalibrationDialog
        isOpen={showCalibrationDialog}
        onClose={() => setShowCalibrationDialog(false)}
        onStartCalibration={startCalibration}
        currentScale={isPageCalibrated ? { scaleFactor, unit } : null}
        isCalibrating={isCalibrating}
      />

      {/* Scale Application Dialog */}
      <ScaleApplicationDialog
        isOpen={showScaleApplicationDialog}
        onClose={() => setShowScaleApplicationDialog(false)}
        onApply={applyScale}
        scaleFactor={pendingScaleData?.scaleFactor || 0}
        unit={pendingScaleData?.unit || 'ft'}
        currentPage={currentPage}
        totalPages={totalPages}
      />

    </div>
  );
};

export default PDFViewer;