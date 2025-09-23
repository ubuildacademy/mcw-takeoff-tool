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
  onCalibrateScale,
  onClearAll,
  isPageCalibrated: externalIsPageCalibrated,
  scaleFactor: externalScaleFactor,
  unit: externalUnit,
  onPDFLoaded,
  onCalibrationRequest,
  onCalibrationComplete,
  searchResults = [],
  currentSearchQuery = ''
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
    rotation: 0
  }), [externalScale, internalViewState.scale]);

  // Measurement state
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measurementType, setMeasurementType] = useState<'linear' | 'area' | 'volume' | 'count'>('linear');
  const [currentMeasurement, setCurrentMeasurement] = useState<{ x: number; y: number }[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [isCompletingMeasurement, setIsCompletingMeasurement] = useState(false);
  
  // Selection state for deleting markups
  const [selectedMarkupId, setSelectedMarkupId] = useState<string | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  
  // Continuous linear drawing state
  const [isContinuousDrawing, setIsContinuousDrawing] = useState(false);
  const [activePoints, setActivePoints] = useState<{ x: number; y: number }[]>([]);
  const [rubberBandElement, setRubberBandElement] = useState<SVGLineElement | null>(null);
  const [runningLength, setRunningLength] = useState<number>(0);
  
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
    
    return totalDistance / scaleFactor;
  }, [currentViewport, scaleFactor]);

  // Store integration
  const { 
    currentProjectId, 
    selectedConditionId,
    getSelectedCondition,
    takeoffMeasurements
  } = useTakeoffStore();
  
  // Load existing takeoff measurements for the current sheet
  const [localTakeoffMeasurements, setLocalTakeoffMeasurements] = useState<any[]>([]);

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
    console.log(`🔄 MEASUREMENT LOADING EFFECT: currentPage=${currentPage}, currentProjectId=${currentProjectId}, fileId=${file?.id}`);
    
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
    
    const displayMeasurements = pageMarkups.map(apiMeasurement => ({
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
    console.log(`📝 SET LOCAL MEASUREMENTS: ${displayMeasurements.length} measurements for page ${currentPage}`);
    console.log(`📝 MEASUREMENT DETAILS:`, displayMeasurements.map(m => ({ 
      id: m.id, 
      type: m.type, 
      pdfPage: m.pdfPage, 
      conditionId: m.conditionId 
    })));
  }, [currentProjectId, file?.id, currentPage, takeoffMeasurements]);

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
  const updateCanvasDimensions = useCallback((pageNum: number, viewport: any, outputScale: number) => {
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
  const renderTakeoffAnnotations = useCallback((pageNum: number, viewport: any) => {
    if (!viewport || !svgOverlayRef.current) return;
    
    const svgOverlay = svgOverlayRef.current;
    
    // Clear existing annotations completely - this ensures no cross-page contamination
    svgOverlay.innerHTML = '';
    
    // Only render measurements for the specific page being rendered
    console.log(`🎨 RENDERING PAGE ${pageNum}: ${localTakeoffMeasurements.length} measurements on SVG overlay`);
    console.log(`🔍 LOCAL MEASUREMENTS DEBUG:`, localTakeoffMeasurements.map(m => ({ 
      id: m.id, 
      type: m.type, 
      pdfPage: m.pdfPage, 
      conditionId: m.conditionId 
    })));
    const countMeasurements = localTakeoffMeasurements.filter(m => m.type === 'count');
    console.log(`🎯 COUNT MEASUREMENTS: ${countMeasurements.length} count measurements found for page ${pageNum}`);
    
    localTakeoffMeasurements.forEach((measurement) => {
      // Double-check that this measurement belongs to the page being rendered
      if (measurement.pdfPage === pageNum) {
        console.log(`🎯 RENDERING MEASUREMENT: ${measurement.type} measurement ${measurement.id} on page ${pageNum}`);
        renderSVGMeasurement(svgOverlay, measurement, viewport);
      } else {
        console.warn(`🚨 SKIPPING measurement ${measurement.id} - belongs to page ${measurement.pdfPage}, rendering page ${pageNum}`);
      }
    });
    
    // Draw current measurement being created (only if on the page being rendered)
    if (currentMeasurement.length > 0 && isMeasuring && pageNum === currentPage) {
      // Always render preview for linear, area, and volume from first point
      // Only count measurements need to wait for completion
      if (measurementType !== 'count') {
        renderSVGCurrentMeasurement(svgOverlay, viewport);
      }
    }
    
    // Draw calibration points (only if on the page being rendered)
    if (isCalibrating && calibrationPoints.length > 0 && pageNum === currentPage) {
      renderSVGCalibrationPoints(svgOverlay);
    }
    
    // Draw crosshair if measuring (only if on the page being rendered)
    if (mousePosition && isMeasuring && pageNum === currentPage) {
      renderSVGCrosshair(svgOverlay, mousePosition, viewport);
    }
    
    // Draw running length display for continuous linear drawing
    if (isContinuousDrawing && activePoints.length > 0 && pageNum === currentPage) {
      renderRunningLengthDisplay(svgOverlay, viewport);
    }
    
    // Debug: Log SVG element count after rendering
    const elementCount = svgOverlay.children.length;
    console.log(`🎯 SVG overlay now has ${elementCount} elements:`, {
      pageNum,
      isContinuousDrawing,
      activePointsLength: activePoints.length,
      currentMeasurementLength: currentMeasurement.length,
      isMeasuring,
      mousePosition: !!mousePosition
    });
  }, [localTakeoffMeasurements, currentMeasurement, measurementType, isMeasuring, isCalibrating, calibrationPoints, mousePosition, selectedMarkupId, isSelectionMode, currentPage, isContinuousDrawing, activePoints, runningLength]);

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
    
    console.log(`🔄 PAGE_SHOWN: Initializing overlay for page ${pageNum} with viewport ${viewport.width}x${viewport.height}`);
    console.log(`🔄 SVG OVERLAY: width=${svgOverlay.getAttribute('width')}, height=${svgOverlay.getAttribute('height')}, viewBox=${svgOverlay.getAttribute('viewBox')}`);
    
    // Re-render all annotations for this page
    renderTakeoffAnnotations(pageNum, viewport);
  }, [renderTakeoffAnnotations]);

  // PDF render function with page-specific viewport isolation
  const renderPDFPage = useCallback(async (pageNum: number) => {
    if (!pdfDocument || !pdfCanvasRef.current) return;
    
    if (isRenderingRef.current) return;
    isRenderingRef.current = true;

    try {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      const page = await pdfDocument.getPage(pageNum);
      pdfPageRef.current = page;
      
      const pdfCanvas = pdfCanvasRef.current;
      const pdfContext = pdfCanvas.getContext('2d');
      if (!pdfContext) return;

      // Create page-specific viewport with current scale
      const viewport = page.getViewport({ 
        scale: viewState.scale,
        rotation: 0
      });
      
      // Calculate outputScale for crisp rendering
      const outputScale = window.devicePixelRatio || 1;
      
      // Update canvas and SVG dimensions with page-specific data
      updateCanvasDimensions(pageNum, viewport, outputScale);
      
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
  }, [pdfDocument, viewState, updateCanvasDimensions, onPageShown]);

  // No coordinate conversions needed - SVG viewBox matches viewport exactly
  // CSS pixels = SVG pixels = viewport pixels (1:1 mapping)

  // Render individual measurement as SVG
  const renderSVGMeasurement = (svg: SVGSVGElement, measurement: Measurement, viewport: any) => {
    if (!measurement || !measurement.points || !viewport) {
      return;
    }
    
    const points = measurement.points;
    if (points.length < 1) return;
    
    // For count measurements, we only need 1 point
    if (measurement.type === 'count' && points.length < 1) return;
    // For other measurements, we need at least 2 points
    if (measurement.type !== 'count' && points.length < 2) return;
    
    const isSelected = selectedMarkupId === measurement.id;
    const strokeColor = isSelected ? '#ff0000' : measurement.color;
    const strokeWidth = isSelected ? '4' : '2';
    
    switch (measurement.type) {
      case 'linear':
        // Create polyline for linear measurement
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        const pointString = points.map(p => {
          // Points are stored in PDF coordinates (0-1), convert to viewport pixels
          return `${p.x * viewport.width},${p.y * viewport.height}`;
        }).join(' ');
        polyline.setAttribute('points', pointString);
        polyline.setAttribute('stroke', strokeColor);
        polyline.setAttribute('stroke-width', strokeWidth);
        polyline.setAttribute('fill', 'none');
        
        // Add click handler for selection
        if (isSelectionMode) {
          polyline.style.cursor = 'pointer';
          polyline.addEventListener('click', (e) => {
            e.stopPropagation();
            setSelectedMarkupId(measurement.id);
          });
        }
        
        svg.appendChild(polyline);
        
        // Add measurement text
        const startPoint = { x: points[0].x * viewport.width, y: points[0].y * viewport.height };
        const endPoint = { x: points[points.length - 1].x * viewport.width, y: points[points.length - 1].y * viewport.height };
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
        if (points.length >= 3) {
          // Create polygon for area measurement
          const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          const pointString = points.map(p => {
            // Points are stored in PDF coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
          }).join(' ');
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
          }
          
          svg.appendChild(polygon);
          
          // Add area text
          const centerX = points.reduce((sum, p) => sum + p.x * viewport.width, 0) / points.length;
          const centerY = points.reduce((sum, p) => sum + p.y * viewport.height, 0) / points.length;
          
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', centerX.toString());
          text.setAttribute('y', centerY.toString());
          text.setAttribute('fill', strokeColor);
          text.setAttribute('font-size', '12');
          text.setAttribute('font-family', 'Arial');
          text.setAttribute('font-weight', 'bold');
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          
          const areaValue = `${measurement.calculatedValue.toFixed(0)} SF`;
          const displayValue = measurement.perimeterValue 
            ? `${areaValue} / ${formatFeetAndInches(measurement.perimeterValue)}`
            : areaValue;
          text.textContent = displayValue;
          svg.appendChild(text);
        }
        break;
        
      case 'volume':
        if (points.length >= 3) {
          // Create polygon for volume measurement (same as area)
          const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          const pointString = points.map(p => {
            // Points are stored in PDF coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
          }).join(' ');
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
          }
          
          svg.appendChild(polygon);
          
          // Add volume text
          const centerX = points.reduce((sum, p) => sum + p.x * viewport.width, 0) / points.length;
          const centerY = points.reduce((sum, p) => sum + p.y * viewport.height, 0) / points.length;
          
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', centerX.toString());
          text.setAttribute('y', centerY.toString());
          text.setAttribute('fill', strokeColor);
          text.setAttribute('font-size', '12');
          text.setAttribute('font-family', 'Arial');
          text.setAttribute('font-weight', 'bold');
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          
          const volumeValue = `${measurement.calculatedValue.toFixed(0)} CY`;
          const displayValue = measurement.perimeterValue 
            ? `${volumeValue} / ${formatFeetAndInches(measurement.perimeterValue)}`
            : volumeValue;
          text.textContent = displayValue;
          svg.appendChild(text);
        }
        break;
        
      case 'count':
        const point = { x: points[0].x * viewport.width, y: points[0].y * viewport.height };
        
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
              // Points are stored in PDF coordinates (0-1), convert to viewport pixels
              return `${p.x * viewport.width},${p.y * viewport.height}`;
            }).join(' ');
            
            polyline.setAttribute('points', pointString);
            polyline.setAttribute('stroke', conditionColor);
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
        } else if (currentMeasurement.length > 0) {
          // Render traditional linear measurement (non-continuous)
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          let pointString = currentMeasurement.map(p => {
            // Points are stored in PDF coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
          }).join(' ');
          
          if (mousePosition) {
            const mousePoint = { x: mousePosition.x * viewport.width, y: mousePosition.y * viewport.height };
            pointString += ` ${mousePoint.x},${mousePoint.y}`;
          }
          
          polyline.setAttribute('points', pointString);
          polyline.setAttribute('stroke', conditionColor);
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
            // Points are stored in PDF coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
          }).join(' ');
          
          if (mousePosition) {
            const mousePoint = { x: mousePosition.x * viewport.width, y: mousePosition.y * viewport.height };
            pointString += ` ${mousePoint.x},${mousePoint.y}`;
          }
          
          polyline.setAttribute('points', pointString);
          polyline.setAttribute('stroke', conditionColor);
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
            polygon.setAttribute('fill', conditionColor + '40');
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
            // Points are stored in PDF coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
          }).join(' ');
          
          if (mousePosition) {
            const mousePoint = { x: mousePosition.x * viewport.width, y: mousePosition.y * viewport.height };
            pointString += ` ${mousePoint.x},${mousePoint.y}`;
          }
          
          polyline.setAttribute('points', pointString);
          polyline.setAttribute('stroke', conditionColor);
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
            polygon.setAttribute('fill', conditionColor + '40');
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

  // Render calibration points as SVG
  const renderSVGCalibrationPoints = (svg: SVGSVGElement) => {
    if (!currentViewport) return;
    
    calibrationPoints.forEach((point, index) => {
      // Create calibration point circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', point.x.toString());
      circle.setAttribute('cy', point.y.toString());
      circle.setAttribute('r', '8');
      circle.setAttribute('fill', '#ff0000');
      circle.setAttribute('stroke', '#ff0000');
      circle.setAttribute('stroke-width', '3');
      svg.appendChild(circle);
      
      // Add point number
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', point.x.toString());
      text.setAttribute('y', (point.y + 4).toString());
      text.setAttribute('fill', 'white');
      text.setAttribute('font-size', '12');
      text.setAttribute('font-family', 'Arial');
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.textContent = (index + 1).toString();
      svg.appendChild(text);
    });
    
    if (calibrationPoints.length === 2) {
      // Draw line between calibration points
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', calibrationPoints[0].x.toString());
      line.setAttribute('y1', calibrationPoints[0].y.toString());
      line.setAttribute('x2', calibrationPoints[1].x.toString());
      line.setAttribute('y2', calibrationPoints[1].y.toString());
      line.setAttribute('stroke', '#ff0000');
      line.setAttribute('stroke-width', '3');
      svg.appendChild(line);
      
      // Add distance text
      const midX = (calibrationPoints[0].x + calibrationPoints[1].x) / 2;
      const midY = (calibrationPoints[0].y + calibrationPoints[1].y) / 2;
      const distance = calculateDistance(calibrationPoints[0], calibrationPoints[1]);
      
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
  const renderSVGCrosshair = (svg: SVGSVGElement, position: { x: number; y: number }, viewport: any) => {
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
    
    // Create crosshair lines
    const crosshairSize = 20;
    
    // Horizontal line
    const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hLine.setAttribute('x1', (viewportPoint.x - crosshairSize).toString());
    hLine.setAttribute('y1', viewportPoint.y.toString());
    hLine.setAttribute('x2', (viewportPoint.x + crosshairSize).toString());
    hLine.setAttribute('y2', viewportPoint.y.toString());
    hLine.setAttribute('stroke', 'rgba(255, 255, 255, 0.8)');
    hLine.setAttribute('stroke-width', '1');
    svg.appendChild(hLine);
    
    // Vertical line
    const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    vLine.setAttribute('x1', viewportPoint.x.toString());
    vLine.setAttribute('y1', (viewportPoint.y - crosshairSize).toString());
    vLine.setAttribute('x2', viewportPoint.x.toString());
    vLine.setAttribute('y2', (viewportPoint.y + crosshairSize).toString());
    vLine.setAttribute('stroke', 'rgba(255, 255, 255, 0.8)');
    vLine.setAttribute('stroke-width', '1');
    svg.appendChild(vLine);
    
    // Center dot
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', viewportPoint.x.toString());
    dot.setAttribute('cy', viewportPoint.y.toString());
    dot.setAttribute('r', '2');
    dot.setAttribute('fill', 'rgba(255, 255, 255, 0.9)');
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
    const pdfCoords = {
      x: cssX / currentViewport.width,
      y: cssY / currentViewport.height
    };
    
    const threshold = 0.005;
    if (mousePosition && 
        Math.abs(mousePosition.x - pdfCoords.x) < threshold && 
        Math.abs(mousePosition.y - pdfCoords.y) < threshold) {
      return;
    }
    
    setMousePosition(pdfCoords);
    
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
          x: cssX,
          y: cssY
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
  }, [isMeasuring, selectedConditionId, mousePosition, isContinuousDrawing, activePoints, rubberBandElement, currentViewport, calculateRunningLength]);

  // Handle click - direct coordinate conversion
  const handleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    const currentStoreState = useTakeoffStore.getState();
    const currentSelectedConditionId = currentStoreState.selectedConditionId;
    
    if (!pdfCanvasRef.current || !currentViewport) return;
    
    // Get CSS pixel coordinates relative to the canvas/SVG
    const rect = pdfCanvasRef.current.getBoundingClientRect();
    const cssX = event.clientX - rect.left;
    const cssY = event.clientY - rect.top;
    
    // Handle calibration clicks
    if (isCalibrating) {
      setCalibrationPoints(prev => {
        const newPoints = [...prev, { x: cssX, y: cssY }];
        
        if (newPoints.length === 2) {
          completeCalibration(newPoints);
        }
        
        return newPoints;
      });
      return;
    }
    
    // Handle measurement clicks
    if (!currentSelectedConditionId) {
      return;
    }
    
    // Convert CSS coordinates to PDF coordinates (0-1) for storage using current page viewport
    const pdfCoords = {
      x: cssX / currentViewport.width,
      y: cssY / currentViewport.height
    };
    
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
        
        // Complete measurement based on type
        if (measurementType === 'count') {
          completeMeasurement([pdfCoords]);
        }
        // Area and volume measurements will be completed on double-click
        
        return newMeasurement;
      });
    }
  }, [isCalibrating, measurementType, currentMeasurement, isContinuousDrawing, activePoints, calculateRunningLength]);

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
  const completeMeasurement = useCallback((points: { x: number; y: number }[]) => {
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
    const viewportPoints = points.map(point => ({
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
          // Calculate zoom-adjusted scale factor for accurate measurements at any zoom level
          const zoomAdjustedScaleFactor = scaleFactor * viewState.scale;
          calculatedValue = totalDistance / zoomAdjustedScaleFactor;
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
          // Calculate zoom-adjusted scale factor for accurate measurements at any zoom level
          const zoomAdjustedScaleFactor = scaleFactor * viewState.scale;
          calculatedValue = Math.abs(area) / (2 * zoomAdjustedScaleFactor * zoomAdjustedScaleFactor);
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
          // Calculate zoom-adjusted scale factor for accurate measurements at any zoom level
          const zoomAdjustedScaleFactor = scaleFactor * viewState.scale;
          // Calculate area in square feet
          const areaInSquareFeet = Math.abs(area) / (2 * zoomAdjustedScaleFactor * zoomAdjustedScaleFactor);
          // Volume calculation: area × depth
          const depth = selectedCondition.depth || 1; // Default to 1 foot if no depth specified
          calculatedValue = areaInSquareFeet * depth;
          console.log('🔍 VOLUME CALCULATION:', {
            area: Math.abs(area),
            zoomAdjustedScaleFactor,
            areaInSquareFeet,
            depth,
            calculatedValue,
            scaleFactor,
            viewStateScale: viewState.scale
          });
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
      // Calculate zoom-adjusted scale factor for accurate measurements at any zoom level
      const zoomAdjustedScaleFactor = scaleFactor * viewState.scale;
      perimeterValue = perimeter / zoomAdjustedScaleFactor;
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
        points: points,
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

  // Complete continuous linear measurement
  const completeContinuousLinearMeasurement = useCallback(() => {
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
      currentMeasurementLength: currentMeasurement.length
    });
    
    if (isContinuousDrawing && activePoints.length >= 2) {
      // Complete the continuous linear measurement
      console.log('🎯 Completing continuous linear measurement');
      completeContinuousLinearMeasurement();
    } else if ((measurementType === 'area' || measurementType === 'volume') && currentMeasurement.length >= 3) {
      // Complete area or volume measurement
      console.log('🎯 Completing area/volume measurement');
      completeMeasurement(currentMeasurement);
    }
  }, [isContinuousDrawing, activePoints, measurementType, currentMeasurement, completeContinuousLinearMeasurement, completeMeasurement]);

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
    if (points.length !== 2 || !calibrationData) return;
    
    const pixelDistance = calculateDistance(points[0], points[1]);
    const knownDistance = calibrationData.knownDistance;
    const unit = calibrationData.unit;
    
    const newScaleFactor = pixelDistance / knownDistance;
    
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
  }, [calibrationData, onCalibrationComplete]);

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

  // Add wheel event listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Handle escape key to back out vertices one-by-one and delete key to delete selected markup
  const handleKeyDown = useCallback(async (event: KeyboardEvent) => {
    if (event.key === 'Escape' && isMeasuring && currentMeasurement.length > 0) {
      event.preventDefault();
      
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
    } else if (event.key === 'Delete' && selectedMarkupId && isSelectionMode) {
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
          
          // Re-render the page
          requestAnimationFrame(() => {
            renderPDFPage(currentPage);
          });
        } catch (error: any) {
          console.error(`❌ FAILED to delete markup:`, error);
        }
      }
    }
  }, [isMeasuring, currentMeasurement.length, selectedMarkupId, isSelectionMode, currentProjectId, file?.id, currentPage, renderPDFPage]);

  // Add keyboard event listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Re-render when page changes
  useEffect(() => {
    if (pdfDocument) {
      setMeasurements([]);
      renderPDFPage(currentPage);
    }
  }, [pdfDocument, currentPage, renderPDFPage]);

  // Page visibility handler - ensures overlays are rendered when returning to a page
  useEffect(() => {
    if (pdfDocument && currentViewport && !isRenderingRef.current) {
      // Use the dedicated page shown handler to ensure proper overlay initialization
      console.log(`🔄 PAGE_VISIBILITY: Calling onPageShown for page ${currentPage}`);
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
    if (pdfDocument) {
      renderPDFPage(currentPage);
    }
  }, [viewState, renderPDFPage, currentPage]);

  // Re-render annotations when measurements or interaction state changes
  useEffect(() => {
    if (pdfDocument && currentViewport && !isRenderingRef.current) {
      // Only render if we have measurements or if we're in measuring mode
      if (localTakeoffMeasurements.length > 0 || isMeasuring || isCalibrating || currentMeasurement.length > 0) {
        // Add a small delay to ensure measurements are loaded before rendering
        const timeoutId = setTimeout(() => {
          renderTakeoffAnnotations(currentPage, currentViewport);
        }, 10);
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [localTakeoffMeasurements, currentMeasurement, isMeasuring, isCalibrating, calibrationPoints, mousePosition, selectedMarkupId, isSelectionMode, renderTakeoffAnnotations, currentPage, currentViewport]);

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

      {/* Single Canvas + SVG Overlay Container */}
      <div 
        ref={containerRef}
        className="canvas-container flex-1 h-full overflow-auto"
        style={{ 
          cursor: isMeasuring ? 'crosshair' : (isCalibrating ? 'crosshair' : (isSelectionMode ? 'pointer' : 'default'))
        }}
      >
        <div className="flex items-center justify-center min-h-full p-6 relative">
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
                cursor: isMeasuring ? 'crosshair' : (isSelectionMode ? 'pointer' : 'default'),
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
                cursor: isMeasuring ? 'crosshair' : (isSelectionMode ? 'pointer' : 'default'),
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
                pointerEvents: isSelectionMode ? 'auto' : 'none' // Allow clicks in selection mode
              }}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setMousePosition(null)}
              onClick={(e) => {
                // Only handle clicks in selection mode, let measuring clicks go to canvas
                if (isSelectionMode) {
                  e.stopPropagation();
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