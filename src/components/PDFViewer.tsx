import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { useTakeoffStore } from '../store/useTakeoffStore';
import type { SearchResult } from '../types';
import CalibrationDialog from './CalibrationDialog';
import ScaleApplicationDialog from './ScaleApplicationDialog';
import { formatFeetAndInches } from '../lib/utils';
import { calculateDistance } from '../utils/commonUtils';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

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
}

interface Measurement {
  id: string;
  type: 'linear' | 'area' | 'volume' | 'count';
  points: { x: number; y: number }[];
  calculatedValue: number;
  unit: string;
  conditionId?: string;
  color: string;
  conditionName: string;
  perimeterValue?: number;
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
  onCutoutModeChange
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
  const [measurementType, setMeasurementType] = useState<'linear' | 'area' | 'volume' | 'count'>('linear');
  const [currentMeasurement, setCurrentMeasurement] = useState<{ x: number; y: number }[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [isCompletingMeasurement, setIsCompletingMeasurement] = useState(false);
  
  // Cut-out state (using external props)
  const [currentCutout, setCurrentCutout] = useState<{ x: number; y: number }[]>([]);
  
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
  const [calibrationPoints, setCalibrationPoints] = useState<{ x: number; y: number }[]>([]);
  const [showCalibrationDialog, setShowCalibrationDialog] = useState(false);
  const [showScaleApplicationDialog, setShowScaleApplicationDialog] = useState(false);
  const [pendingScaleData, setPendingScaleData] = useState<{scaleFactor: number, unit: string} | null>(null);
  const [calibrationData, setCalibrationData] = useState<{knownDistance: number, unit: string} | null>(null);
  
  // Refs - Single Canvas + SVG Overlay System
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const svgOverlayRef = useRef<SVGSVGElement>(null);
  const pdfPageRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);
  const isRenderingRef = useRef<boolean>(false);
  const [isComponentMounted, setIsComponentMounted] = useState(false);
  
  // Page-specific viewport and transform state for proper isolation
  const [pageViewports, setPageViewports] = useState<Record<number, any>>({});
  const [pageOutputScales, setPageOutputScales] = useState<Record<number, number>>({});
  
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
    
    // Apply zoom-independent scale factor: scale factor is calibrated for base scale (1.0)
    // Current viewport is scaled by viewState.scale, so we need to adjust accordingly
    return totalDistance / (scaleFactor * viewState.scale);
  }, [currentViewport, scaleFactor, viewState.scale]);

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
    takeoffMeasurements
  } = useTakeoffStore();
  
  // Load existing takeoff measurements for the current sheet
  const [localTakeoffMeasurements, setLocalTakeoffMeasurements] = useState<any[]>([]);

  // Ensure component is mounted before rendering
  useEffect(() => {
    setIsComponentMounted(true);
    return () => setIsComponentMounted(false);
  }, []);

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
        
        const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
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

  // Load measurements for current page using new page-based system
  useEffect(() => {
    
    if (!currentProjectId || !file?.id || !currentPage) {
      console.log(`❌ Missing required data - clearing measurements`);
      setLocalTakeoffMeasurements([]);
      return;
    }
    
    const { getPageMarkups, updateMarkupsByPage } = useTakeoffStore.getState();
    
    // Ensure markupsByPage is up to date
    updateMarkupsByPage();
    
    // Use the new page-based markup system
    const pageMarkups = getPageMarkups(currentProjectId, file.id, currentPage);
    
    const displayMeasurements = pageMarkups.map(apiMeasurement => {
      try {
        return {
          id: apiMeasurement.id,
          type: apiMeasurement.type,
          points: apiMeasurement.points || [],
          calculatedValue: apiMeasurement.calculatedValue || 0,
          unit: apiMeasurement.unit || 'SF',
          conditionId: apiMeasurement.conditionId,
          conditionName: apiMeasurement.conditionName || 'Unknown',
          color: apiMeasurement.conditionColor || '#000000',
          timestamp: new Date(apiMeasurement.timestamp).getTime(),
          pdfPage: apiMeasurement.pdfPage || 1,
          pdfCoordinates: apiMeasurement.pdfCoordinates || [],
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
    console.log(`📝 SET LOCAL MEASUREMENTS: ${displayMeasurements.length} measurements for page ${currentPage}`);
    console.log(`📝 MEASUREMENT DETAILS:`, displayMeasurements.map(m => ({ 
      id: m.id, 
      type: m.type, 
      pdfPage: m.pdfPage, 
      conditionId: m.conditionId 
    })));
    console.log(`📝 VIEWPORT STATUS:`, {
      hasCurrentViewport: !!currentViewport,
      viewportSize: currentViewport ? `${currentViewport.width}x${currentViewport.height}` : 'null',
      currentPage
    });
    
    // If we have measurements and a viewport is available, trigger a re-render
    if (displayMeasurements.length > 0 && currentViewport) {
      // Use setTimeout to ensure state is updated before re-rendering
      setTimeout(() => {
        renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
      }, 0);
    }
  }, [currentProjectId, file?.id, currentPage, takeoffMeasurements, currentViewport]);

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
      console.log(`🧹 CLEARING MEASUREMENTS: File ID changed from ${prevFileId} to ${currentFileId}`);
      setLocalTakeoffMeasurements([]);
      prevFileIdRef.current = currentFileId;
    } else {
      console.log(`🧹 SKIPPING CLEAR: File ID unchanged (${currentFileId})`);
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
    
    
    console.log(`📐 PAGE ${pageNum} CANVAS SIZING: Bitmap=${canvasWidth}x${canvasHeight}, CSS=${viewport.width}x${viewport.height}, OutputScale=${outputScale}`);
  }, []);


  // SVG-based takeoff annotation renderer - Page-specific with viewport isolation
  const renderTakeoffAnnotations = useCallback((pageNum: number, viewport: any, page?: any) => {
    if (!viewport || !svgOverlayRef.current) return;
    
    const svgOverlay = svgOverlayRef.current;
    
    // Clear existing annotations completely - this ensures no cross-page contamination
    svgOverlay.innerHTML = '';
    
    // Only render measurements for the specific page being rendered
    
    localTakeoffMeasurements.forEach((measurement) => {
      // Double-check that this measurement belongs to the page being rendered
      if (measurement.pdfPage === pageNum) {
        renderSVGMeasurement(svgOverlay, measurement, viewport, page);
      } else {
        console.warn(`🚨 SKIPPING measurement ${measurement.id} - belongs to page ${measurement.pdfPage}, rendering page ${pageNum}`);
      }
    });
    
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
    
    // Draw calibration points (only if on the page being rendered)
    if (isCalibrating && calibrationPoints.length > 0 && pageNum === currentPage) {
      renderSVGCalibrationPoints(svgOverlay);
    }
    
    // Draw crosshair if measuring or calibrating (only if on the page being rendered)
    if (mousePosition && (isMeasuring || isCalibrating) && pageNum === currentPage) {
      renderSVGCrosshair(svgOverlay, mousePosition, viewport, isCalibrating);
    }
    
    // Draw running length display for continuous linear drawing
    if (isContinuousDrawing && activePoints.length > 0 && pageNum === currentPage) {
      renderRunningLengthDisplay(svgOverlay, viewport);
    }
    
  }, [localTakeoffMeasurements, currentMeasurement, measurementType, isMeasuring, isCalibrating, calibrationPoints, mousePosition, selectedMarkupId, isSelectionMode, currentPage, isContinuousDrawing, activePoints, runningLength]);

  // Re-render annotations when measurements or interaction state changes
  useEffect(() => {
    if (pdfDocument && currentViewport && !isRenderingRef.current) {
      // Only render if we have measurements or if we're in measuring mode
      if (localTakeoffMeasurements.length > 0 || isMeasuring || isCalibrating || currentMeasurement.length > 0) {
        renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
      }
    }
  }, [localTakeoffMeasurements, currentMeasurement, isMeasuring, isCalibrating, calibrationPoints, mousePosition, selectedMarkupId, isSelectionMode, renderTakeoffAnnotations, currentPage, currentViewport]);

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
    // Add a small delay to ensure DOM is fully mounted
    await new Promise(resolve => setTimeout(resolve, 10));
    
    if (!isComponentMounted || !pdfDocument || !pdfCanvasRef.current || !containerRef.current) {
      console.warn('PDF render skipped: missing dependencies', {
        isComponentMounted,
        pdfDocument: !!pdfDocument,
        canvas: !!pdfCanvasRef.current,
        container: !!containerRef.current,
        pageNum
      });
      return;
    }
    
    if (isRenderingRef.current) return;
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
      
      // Render with page-specific transform for outputScale
      const renderContext = {
        canvasContext: pdfContext,
        viewport: viewport,
        transform: [outputScale, 0, 0, outputScale, 0, 0]
      };
      
      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      
      // After PDF is rendered, ensure overlay is properly initialized and render takeoff annotations
      onPageShown(pageNum, viewport);
      
    } catch (error: any) {
      if (error.name !== 'RenderingCancelledException') {
        console.error('Error rendering PDF page:', error);
      }
    } finally {
      isRenderingRef.current = false;
    }
  }, [pdfDocument, viewState, updateCanvasDimensions, onPageShown, isComponentMounted]);

  // No coordinate conversions needed - SVG viewBox matches viewport exactly
  // CSS pixels = SVG pixels = viewport pixels (1:1 mapping)

  // Render individual measurement as SVG
  const renderSVGMeasurement = (svg: SVGSVGElement, measurement: Measurement, viewport: any, page?: any) => {
    if (!measurement || !measurement.points || !viewport) {
      return;
    }
    
    const points = measurement.points;
    if (points.length < 1) return;
    
    // For count measurements, we only need 1 point
    if (measurement.type === 'count' && points.length < 1) return;
    // For other measurements, we need at least 2 points
    if (measurement.type !== 'count' && points.length < 2) return;
    
    // Transform points to match current viewport if needed
    // Points are stored in normalized coordinates (0-1) relative to the viewport they were created in
    // We need to map them to the current viewport
    const transformedPoints = points.map(point => {
      // For now, use points as-is since we're storing them in the current viewport coordinate system
      // This ensures that when the page is rotated, the markups stay in the same relative position
      return {
        x: point.x,
        y: point.y
      };
    });
    
    const isSelected = selectedMarkupId === measurement.id;
    const strokeColor = isSelected ? '#ff0000' : measurement.color;
    const strokeWidth = isSelected ? '4' : '2';
    
    switch (measurement.type) {
      case 'linear':
        // Create polyline for linear measurement
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        const pointString = transformedPoints.map(p => {
          // Points are stored in PDF coordinates (0-1), convert to viewport pixels
          return `${p.x * viewport.width},${p.y * viewport.height}`;
        }).join(' ');
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
        
        // Add measurement text
        const startPoint = { x: transformedPoints[0].x * viewport.width, y: transformedPoints[0].y * viewport.height };
        const endPoint = { x: transformedPoints[transformedPoints.length - 1].x * viewport.width, y: transformedPoints[transformedPoints.length - 1].y * viewport.height };
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
        
        const displayValue = measurement.unit === 'ft' || measurement.unit === 'feet' 
          ? formatFeetAndInches(measurement.calculatedValue)
          : `${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`;
        text.textContent = displayValue;
        svg.appendChild(text);
        break;
        
      case 'area':
        if (transformedPoints.length >= 3) {
          const pointString = transformedPoints.map(p => {
            // Points are stored in PDF coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
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
                  return `${p.x * viewport.width},${p.y * viewport.height}`;
                }).join(' ');
                pathData += ` M ${cutoutPointString.split(' ')[0]} L ${cutoutPointString.split(' ').slice(1).join(' L ')} Z`;
              }
            });
            
            compoundPath.setAttribute('d', pathData);
            compoundPath.setAttribute('fill-rule', 'evenodd');
            compoundPath.setAttribute('fill', measurement.color + '40');
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
            polygon.setAttribute('fill', measurement.color + '40');
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
          const centerX = transformedPoints.reduce((sum, p) => sum + p.x * viewport.width, 0) / transformedPoints.length;
          const centerY = transformedPoints.reduce((sum, p) => sum + p.y * viewport.height, 0) / transformedPoints.length;
          
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
            ? `${areaValue} / ${formatFeetAndInches(measurement.perimeterValue)}`
            : areaValue;
          text.textContent = finalDisplayValue;
          svg.appendChild(text);
          
          // Cutout outlines are now handled by the clipping path above
        }
        break;
        
      case 'volume':
        if (transformedPoints.length >= 3) {
          const pointString = transformedPoints.map(p => {
            // Points are stored in PDF coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
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
                  return `${p.x * viewport.width},${p.y * viewport.height}`;
                }).join(' ');
                pathData += ` M ${cutoutPointString.split(' ')[0]} L ${cutoutPointString.split(' ').slice(1).join(' L ')} Z`;
              }
            });
            
            compoundPath.setAttribute('d', pathData);
            compoundPath.setAttribute('fill-rule', 'evenodd');
            compoundPath.setAttribute('fill', measurement.color + '40');
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
            polygon.setAttribute('fill', measurement.color + '40');
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
          const centerX = transformedPoints.reduce((sum, p) => sum + p.x * viewport.width, 0) / transformedPoints.length;
          const centerY = transformedPoints.reduce((sum, p) => sum + p.y * viewport.height, 0) / transformedPoints.length;
          
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
            ? `${volumeValue} / ${formatFeetAndInches(measurement.perimeterValue)}`
            : volumeValue;
          text.textContent = finalDisplayValue;
          svg.appendChild(text);
          
          // Cutout outlines are now handled by the clipping path above
        }
        break;
        
      case 'count':
        const point = { x: transformedPoints[0].x * viewport.width, y: transformedPoints[0].y * viewport.height };
        
        // Create circle for count measurement
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', point.x.toString());
        circle.setAttribute('cy', point.y.toString());
        circle.setAttribute('r', '8');
        circle.setAttribute('fill', measurement.color || '#74b9ff');
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
            
            console.log('🎯 Rendered committed segments for page', currentPage, ':', {
              points: pointString,
              color: conditionColor,
              element: polyline,
              parentNode: polyline.parentNode
            });
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
    const strokeColor = isCalibrating ? 'rgba(255, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.8)';
    const strokeWidth = isCalibrating ? '2' : '1';
    const dotColor = isCalibrating ? 'rgba(255, 0, 0, 1)' : 'rgba(255, 255, 255, 0.9)';
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
    
    const displayValue = unit === 'ft' || unit === 'feet' 
      ? formatFeetAndInches(runningLength)
      : `${runningLength.toFixed(2)} ${unit}`;
    text.textContent = `Length: ${displayValue}`;
    svg.appendChild(text);
  };

  // Handle mouse move - direct coordinate conversion
  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    // Handle mouse move for calibration mode
    if (isCalibrating) {
      if (!pdfCanvasRef.current || !currentViewport) {
        return;
      }
      
      // Get CSS pixel coordinates relative to the canvas/SVG
      const rect = pdfCanvasRef.current.getBoundingClientRect();
      const cssX = event.clientX - rect.left;
      const cssY = event.clientY - rect.top;
      
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
    const cssX = event.clientX - rect.left;
    const cssY = event.clientY - rect.top;
    
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
    if (isContinuousDrawing && activePoints.length > 0 && svgOverlayRef.current) {
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
        
        // Update running length calculation
        const newLength = calculateRunningLength(activePoints, pdfCoords);
        setRunningLength(newLength);
        
        console.log('🎯 Rubber band update:', {
          lastPoint: lastPointPixels,
          currentPoint: currentPointPixels,
          length: newLength,
          activePoints: activePoints.length,
          element: currentRubberBand
        });
      }
    }
  }, [isCalibrating, calibrationPoints, isMeasuring, selectedConditionId, mousePosition, isContinuousDrawing, activePoints, rubberBandElement, currentViewport, calculateRunningLength]);

  // Handle click - direct coordinate conversion
  const handleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    const currentStoreState = useTakeoffStore.getState();
    const currentSelectedConditionId = currentStoreState.selectedConditionId;
    
    if (!pdfCanvasRef.current || !currentViewport) return;
    
    // Get CSS pixel coordinates relative to the canvas/SVG
    const rect = pdfCanvasRef.current.getBoundingClientRect();
    const cssX = event.clientX - rect.left;
    const cssY = event.clientY - rect.top;
    
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
        
        console.log('🎯 Calibration point added:', {
          pointIndex: newPoints.length,
          pdfCoords,
          cssCoords: { x: cssX, y: cssY },
          viewport: { width: currentViewport.width, height: currentViewport.height }
        });
        
        if (newPoints.length === 2) {
          console.log('🎯 Completing calibration with points:', newPoints);
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
        console.log('🎯 Starting continuous linear drawing mode');
        setIsContinuousDrawing(true);
        setActivePoints([pdfCoords]);
        createRubberBandElement();
      } else {
        // Add point to active measurement
        console.log('🎯 Adding point to continuous measurement');
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
    
    console.log('🎯 Created rubber band element for page', currentPage, ':', {
      svgWidth: currentViewport.width,
      svgHeight: currentViewport.height,
      viewBox: `0 0 ${currentViewport.width} ${currentViewport.height}`,
      color: conditionColor,
      element: line,
      parentNode: line.parentNode
    });
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
    
    const viewport = currentViewport;
    
    // Store points as-is in the current viewport coordinate system
    // The rendering system will handle coordinate transformation when needed
    const transformedPoints = points;
    
    const viewportPoints = transformedPoints.map(point => ({
      x: point.x * viewport.width,
      y: point.y * viewport.height
    }));
    
    switch (measurementType) {
      case 'linear':
        if (viewportPoints.length >= 2) {
          let totalDistance = 0;
          for (let i = 1; i < viewportPoints.length; i++) {
            const dx = viewportPoints[i].x - viewportPoints[i - 1].x;
            const dy = viewportPoints[i].y - viewportPoints[i - 1].y;
            totalDistance += Math.sqrt(dx * dx + dy * dy);
          }
          // Apply zoom-independent scale factor: scale factor is calibrated for base scale (1.0)
          // Current viewport is scaled by viewState.scale, so we need to adjust accordingly
          calculatedValue = totalDistance / (scaleFactor * viewState.scale);
        }
        break;
      case 'area':
        if (viewportPoints.length >= 3) {
          let area = 0;
          for (let i = 0; i < viewportPoints.length; i++) {
            const j = (i + 1) % viewportPoints.length;
            area += viewportPoints[i].x * viewportPoints[j].y;
            area -= viewportPoints[j].x * viewportPoints[i].y;
          }
          // Apply zoom-independent scale factor: scale factor is calibrated for base scale (1.0)
          // Current viewport is scaled by viewState.scale, so we need to adjust accordingly
          const adjustedScaleFactor = scaleFactor * viewState.scale;
          calculatedValue = Math.abs(area) / (2 * adjustedScaleFactor * adjustedScaleFactor);
        }
        break;
      case 'volume':
        if (viewportPoints.length >= 3) {
          let area = 0;
          for (let i = 0; i < viewportPoints.length; i++) {
            const j = (i + 1) % viewportPoints.length;
            area += viewportPoints[i].x * viewportPoints[j].y;
            area -= viewportPoints[j].x * viewportPoints[i].y;
          }
          // Apply zoom-independent scale factor: scale factor is calibrated for base scale (1.0)
          // Current viewport is scaled by viewState.scale, so we need to adjust accordingly
          const adjustedScaleFactor = scaleFactor * viewState.scale;
          // Calculate area in square feet
          const areaInSquareFeet = Math.abs(area) / (2 * adjustedScaleFactor * adjustedScaleFactor);
          // Volume calculation: area × depth
          const depth = selectedCondition.depth || 1; // Default to 1 foot if no depth specified
          calculatedValue = areaInSquareFeet * depth;
        }
        break;
      case 'count':
        calculatedValue = 1;
        break;
    }
    
    // Calculate perimeter for area and volume measurements
    let perimeterValue: number | undefined;
    if ((measurementType === 'area' || measurementType === 'volume') && selectedCondition.includePerimeter && viewportPoints.length >= 3) {
      let perimeter = 0;
      for (let i = 0; i < viewportPoints.length; i++) {
        const j = (i + 1) % viewportPoints.length;
        const dx = viewportPoints[j].x - viewportPoints[i].x;
        const dy = viewportPoints[j].y - viewportPoints[i].y;
        perimeter += Math.sqrt(dx * dx + dy * dy);
      }
      // Apply zoom-independent scale factor: scale factor is calibrated for base scale (1.0)
      // Current viewport is scaled by viewState.scale, so we need to adjust accordingly
      perimeterValue = perimeter / (scaleFactor * viewState.scale);
    }

    // Save to API
    if (currentProjectId && file?.id) {
      const { addTakeoffMeasurement, getPageTakeoffMeasurements } = useTakeoffStore.getState();
      
      console.log(`💾 SAVING: Page ${currentPage} (type: ${typeof currentPage}) for project ${currentProjectId}, sheet ${file.id}`);
      console.log(`💾 MEASUREMENT DATA:`, {
        projectId: currentProjectId,
        sheetId: file.id,
        conditionId: currentSelectedConditionId,
        type: measurementType,
        points: points.length,
        calculatedValue,
        unit,
        pdfPage: currentPage,
        pdfPageType: typeof currentPage,
        conditionDepth: selectedCondition.depth,
        conditionIncludePerimeter: selectedCondition.includePerimeter,
        perimeterValue
      });
      
      addTakeoffMeasurement({
        projectId: currentProjectId,
        sheetId: file.id,
        conditionId: currentSelectedConditionId,
        type: measurementType,
        points: transformedPoints,
        calculatedValue,
        unit,
        pdfPage: currentPage,
        pdfCoordinates: points,
        conditionColor: selectedCondition.color,
        conditionName: selectedCondition.name,
        perimeterValue
      }).then(savedMeasurementId => {
        console.log(`✅ SAVED ${measurementType.toUpperCase()} measurement with ID:`, savedMeasurementId);
        
        // Reload measurements from API
        const updatedMeasurements = getPageTakeoffMeasurements(currentProjectId, file.id, currentPage);
        console.log(`📊 RELOADED measurements for page ${currentPage}:`, updatedMeasurements.length, 'total');
        
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
        
        // Re-render the page using queued rendering
        requestAnimationFrame(() => {
          renderPDFPage(currentPage);
        });
      }).catch(error => {
        console.error(`❌ FAILED to save ${measurementType.toUpperCase()} measurement:`, error);
        console.error('Error details:', {
          errorMessage: error.message,
          errorStack: error.stack,
          measurementType,
          calculatedValue,
          points: points.length
        });
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
    const existingMeasurements = getPageTakeoffMeasurements(currentProjectId, file.id, currentPage);
    const targetMeasurement = existingMeasurements.find(m => m.conditionId === cutoutTargetConditionId);
    
    if (!targetMeasurement) {
      console.error('Target measurement not found for cut-out');
      return;
    }

    // Calculate cut-out area/volume
    const viewport = currentViewport;
    if (!viewport) return;

    const viewportPoints = points.map(point => ({
      x: point.x * viewport.width,
      y: point.y * viewport.height
    }));

    let cutoutValue = 0;
    
    // Calculate area for cut-out
    let area = 0;
    for (let i = 0; i < viewportPoints.length; i++) {
      const j = (i + 1) % viewportPoints.length;
      area += viewportPoints[i].x * viewportPoints[j].y;
      area -= viewportPoints[j].x * viewportPoints[i].y;
    }
    
    const adjustedScaleFactor = scaleFactor * viewState.scale;
    const areaInSquareFeet = Math.abs(area) / (2 * adjustedScaleFactor * adjustedScaleFactor);
    
    // For volume measurements, multiply by depth
    if (targetMeasurement.type === 'volume') {
      const selectedCondition = getSelectedCondition();
      const depth = selectedCondition?.depth || 1;
      cutoutValue = areaInSquareFeet * depth;
    } else {
      cutoutValue = areaInSquareFeet;
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
      console.log('✅ Cut-out added successfully');
      
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
      console.log('🎯 Removed rubber band element for page', currentPage);
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
    console.log('🎯 Double-click detected:', { 
      isContinuousDrawing, 
      activePointsLength: activePoints.length,
      measurementType,
      currentMeasurementLength: currentMeasurement.length,
      cutoutMode,
      currentCutoutLength: currentCutout.length
    });
    
    // Handle cut-out completion
    if (cutoutMode && currentCutout.length >= 3) {
      console.log('🎯 Completing cut-out');
      completeCutout(currentCutout);
      return;
    }
    
    if (isContinuousDrawing && activePoints.length >= 2) {
      // Complete the continuous linear measurement
      console.log('🎯 Completing continuous linear measurement');
      completeContinuousLinearMeasurement();
    } else if ((measurementType === 'area' || measurementType === 'volume') && currentMeasurement.length >= 3) {
      // Complete area or volume measurement
      console.log('🎯 Completing area/volume measurement');
      completeMeasurement(currentMeasurement);
    }
  }, [isContinuousDrawing, activePoints, measurementType, currentMeasurement, completeContinuousLinearMeasurement, completeMeasurement, cutoutMode, currentCutout, completeCutout]);

  // Cleanup continuous drawing state
  const cleanupContinuousDrawing = useCallback(() => {
    // Clean up rubber band for current page
    const currentRubberBand = pageRubberBandRefs.current[currentPage];
    if (currentRubberBand && svgOverlayRef.current && currentRubberBand.parentNode === svgOverlayRef.current) {
      try {
        svgOverlayRef.current.removeChild(currentRubberBand);
        console.log('🎯 Cleaned up rubber band for page', currentPage);
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
            console.log('🎯 Cleaned up rubber band from page', pageNumInt);
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
            console.log('🎯 Cleaned up committed polyline from page', pageNumInt);
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
    
    // Convert PDF coordinates (0-1) to viewport pixels for distance calculation
    const point1 = {
      x: points[0].x * currentViewport.width,
      y: points[0].y * currentViewport.height
    };
    const point2 = {
      x: points[1].x * currentViewport.width,
      y: points[1].y * currentViewport.height
    };
    
    const pixelDistance = calculateDistance(point1, point2);
    const knownDistance = calibrationData.knownDistance;
    const unit = calibrationData.unit;
    
    // Calculate zoom-independent scale factor by normalizing to base scale (1.0)
    // This ensures the scale factor remains consistent across all zoom levels
    const baseViewport = pdfPageRef.current?.getViewport({ scale: 1.0, rotation: viewState.rotation });
    if (!baseViewport) return;
    
    // Calculate the distance in base viewport coordinates (scale = 1.0)
    const basePoint1 = {
      x: points[0].x * baseViewport.width,
      y: points[0].y * baseViewport.height
    };
    const basePoint2 = {
      x: points[1].x * baseViewport.width,
      y: points[1].y * baseViewport.height
    };
    
    const basePixelDistance = calculateDistance(basePoint1, basePoint2);
    const newScaleFactor = basePixelDistance / knownDistance;
    
    console.log('🎯 Calibration completed:', {
      point1: { pdf: points[0], viewport: point1 },
      point2: { pdf: points[1], viewport: point2 },
      pixelDistance,
      basePixelDistance,
      knownDistance,
      unit,
      newScaleFactor,
      currentViewport: { width: currentViewport.width, height: currentViewport.height },
      baseViewport: { width: baseViewport.width, height: baseViewport.height },
      currentScale: viewState.scale
    });
    
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
    
    if (onCalibrationComplete) {
      onCalibrationComplete(true, newScaleFactor, unit);
    }
    
    setCalibrationPoints([]);
    setIsCalibrating(false);
    setCalibrationData(null);
  }, [calibrationData, onCalibrationComplete, currentViewport]);

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
      
      if (onScaleChange) {
        onScaleChange(newScale);
      } else {
        setInternalViewState(prev => ({ ...prev, scale: newScale }));
      }
    }
  }, [viewState.scale, onScaleChange]);

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

      console.log('✅ FIT_TO_WINDOW: Successfully applied scale', optimalScale);
    } catch (error) {
      console.error('❌ FIT_TO_WINDOW: Error fitting to window', error);
    }
  }, [pdfDocument, viewState.rotation, onScaleChange]);

  // Handle rotation

  // Add wheel event listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Handle escape key to back out vertices one-by-one and delete key to delete selected markup
  const handleKeyDown = useCallback(async (event: KeyboardEvent) => {
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
      
      // Delete the selected markup
      if (currentProjectId && file?.id) {
        const { deleteTakeoffMeasurement, getPageTakeoffMeasurements } = useTakeoffStore.getState();
        
        try {
          await deleteTakeoffMeasurement(selectedMarkupId);
          console.log(`🗑️ DELETED markup with ID:`, selectedMarkupId);
          
          // Reload measurements from API
          const updatedMeasurements = getPageTakeoffMeasurements(currentProjectId, file.id, currentPage);
          console.log(`📊 RELOADED measurements for page ${currentPage}:`, updatedMeasurements.length, 'total');
          
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
          
          // Immediately re-render the SVG overlay to show the deletion
          if (currentViewport) {
            renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
          }
          
          // Also re-render the PDF page
          requestAnimationFrame(() => {
            renderPDFPage(currentPage);
          });
        } catch (error: any) {
          console.error(`❌ FAILED to delete markup:`, error);
        }
      }
    } else if (event.key === 'Control' && (isMeasuring || isCalibrating)) {
      // Toggle ortho snapping when Ctrl is pressed during measurement or calibration
      event.preventDefault();
      setIsOrthoSnapping(prev => !prev);
      console.log(`🎯 Ortho snapping ${!isOrthoSnapping ? 'enabled' : 'disabled'}`);
    }
  }, [isMeasuring, isCalibrating, calibrationPoints.length, currentMeasurement.length, selectedMarkupId, isSelectionMode, currentProjectId, file?.id, currentPage, renderPDFPage, measurementType, isContinuousDrawing, activePoints.length, isOrthoSnapping]);

  // Add keyboard event listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Re-render when page changes
  useEffect(() => {
    if (pdfDocument && isComponentMounted) {
      setMeasurements([]);
      
      // Retry mechanism if canvas is not ready
      const attemptRender = async (retries = 3) => {
        if (pdfCanvasRef.current && containerRef.current) {
          await renderPDFPage(currentPage);
        } else if (retries > 0) {
          console.log(`Canvas not ready, retrying in 100ms... (${retries} retries left)`);
          setTimeout(() => attemptRender(retries - 1), 100);
        } else {
          console.warn('Canvas not ready after retries, skipping render');
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

  // Re-render when view state changes (zoom/rotation)
  useEffect(() => {
    if (pdfDocument && isComponentMounted) {
      renderPDFPage(currentPage);
    }
  }, [viewState, renderPDFPage, currentPage, isComponentMounted]);


  // Set measurement type when condition is selected
  useEffect(() => {
    if (selectedConditionId) {
      const condition = getSelectedCondition();
      if (condition) {
        setIsMeasuring(true);
        setIsSelectionMode(false);
        setSelectedMarkupId(null);
        
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
      setIsMeasuring(false);
      setIsSelectionMode(true);
      setCurrentMeasurement([]);
      setMousePosition(null);
      setMeasurements([]);
    }
  }, [selectedConditionId]);


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

      {/* Interaction Status */}
      {(isMeasuring || isCalibrating) && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-blue-600 text-white px-4 py-2 rounded-lg">
          {isCalibrating ? (
            'Calibrating: Click two points to set scale'
          ) : (
            `Measuring: ${measurementType} - Click to add points`
          )}
        </div>
      )}

      {/* Ortho Snapping Indicator */}
      {(isOrthoSnapping && isMeasuring) || (isCalibrating && calibrationPoints.length > 0) ? (
        <div className="absolute top-16 left-1/2 transform -translate-x-1/2 z-10 bg-green-600 text-white px-3 py-1 rounded-lg text-sm flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h18"/>
            <path d="M12 3v18"/>
          </svg>
          {isCalibrating ? 'Calibration Ortho Snapping ON' : 'Ortho Snapping ON'}
        </div>
      ) : null}

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
              onDoubleClick={handleDoubleClick}
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
                  : (isCalibrating ? 'crosshair' : (isMeasuring ? 'crosshair' : (isSelectionMode ? 'pointer' : 'default'))),
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
                pointerEvents: (isSelectionMode || isCalibrating) ? 'auto' : 'none' // Allow clicks in selection mode or calibration mode
              }}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setMousePosition(null)}
              onClick={(e) => {
                // Handle clicks in selection mode or calibration mode
                if (isSelectionMode || isCalibrating) {
                  e.stopPropagation();
                  handleClick(e);
                }
              }}
            />
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