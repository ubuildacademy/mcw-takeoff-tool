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
  const viewportRef = useRef<any>(null);
  const outputScaleRef = useRef<number>(1);
  const renderTaskRef = useRef<any>(null);
  const isRenderingRef = useRef<boolean>(false);

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

  // Load measurements for current page
  useEffect(() => {
    console.log(`🔄 MEASUREMENT LOADING EFFECT: currentPage=${currentPage}, currentProjectId=${currentProjectId}, fileId=${file?.id}`);
    
    if (!currentProjectId || !file?.id || !currentPage) {
      console.log(`❌ Missing required data - clearing measurements`);
      setLocalTakeoffMeasurements([]);
      return;
    }
    
    const { getPageTakeoffMeasurements, takeoffMeasurements } = useTakeoffStore.getState();
    
    // Debug: Check what measurements exist and their page numbers
    const allMeasurements = takeoffMeasurements.filter(m => m.projectId === currentProjectId && m.sheetId === file.id);
    console.log(`🔍 DEBUG: Looking for page ${currentPage} (type: ${typeof currentPage})`);
    console.log(`📊 All measurements for this project/sheet:`, allMeasurements.map(m => ({ id: m.id, pdfPage: m.pdfPage, pageType: typeof m.pdfPage })));
    
    const apiMeasurements = getPageTakeoffMeasurements(currentProjectId, file.id, currentPage);
    console.log(`🎯 Found ${apiMeasurements.length} measurements for page ${currentPage}`);
    console.log(`🎯 API measurements:`, apiMeasurements.map(m => ({ id: m.id, pdfPage: m.pdfPage })));
    
    const displayMeasurements = apiMeasurements.map(apiMeasurement => ({
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
  }, [currentProjectId, file?.id, currentPage, takeoffMeasurements]);

  // Clear measurements and cleanup when file changes
  useEffect(() => {
    setLocalTakeoffMeasurements([]);
    
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

  // Proper canvas sizing with outputScale for crisp rendering
  const updateCanvasDimensions = useCallback((viewport: any, outputScale: number) => {
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
    
    // Set SVG overlay to match viewport dimensions exactly
    svgOverlay.setAttribute('width', viewport.width.toString());
    svgOverlay.setAttribute('height', viewport.height.toString());
    svgOverlay.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
    
    console.log(`📐 CANVAS SIZING: Bitmap=${canvasWidth}x${canvasHeight}, CSS=${viewport.width}x${viewport.height}, OutputScale=${outputScale}`);
  }, []);

  // PDF render function with proper outputScale
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

      // Create viewport with current scale
      const viewport = page.getViewport({ 
        scale: viewState.scale,
        rotation: 0
      });
      
      // Calculate outputScale for crisp rendering
      const outputScale = window.devicePixelRatio || 1;
      
      // Store viewport and outputScale for coordinate calculations
      viewportRef.current = viewport;
      outputScaleRef.current = outputScale;
      
      // Update canvas and SVG dimensions
      updateCanvasDimensions(viewport, outputScale);
      
      // Clear canvas
      pdfContext.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
      pdfContext.setTransform(1, 0, 0, 1, 0, 0);
      
      // Clear SVG overlay
      if (svgOverlayRef.current) {
        svgOverlayRef.current.innerHTML = '';
      }
      
      // Render with proper transform for outputScale
      const renderContext = {
        canvasContext: pdfContext,
        viewport: viewport,
        transform: [outputScale, 0, 0, outputScale, 0, 0]
      };
      
      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      
      // After PDF is rendered, render takeoff annotations on SVG
      renderTakeoffAnnotations();
      
    } catch (error: any) {
      if (error.name !== 'RenderingCancelledException') {
        console.error('Error rendering PDF page:', error);
      }
    } finally {
      isRenderingRef.current = false;
    }
  }, [pdfDocument, viewState, updateCanvasDimensions]);

  // SVG-based takeoff annotation renderer
  const renderTakeoffAnnotations = useCallback(() => {
    if (!viewportRef.current || !svgOverlayRef.current) return;
    
    const svgOverlay = svgOverlayRef.current;
    const viewport = viewportRef.current;
    
    // Clear existing annotations
    svgOverlay.innerHTML = '';
    
    // Draw takeoff measurements
    console.log(`🎨 RENDERING: ${localTakeoffMeasurements.length} measurements on SVG overlay`);
    localTakeoffMeasurements.forEach((measurement) => {
      renderSVGMeasurement(svgOverlay, measurement, viewport);
    });
    
    // Draw current measurement being created
    if (currentMeasurement.length > 0 && isMeasuring) {
      const minPoints = measurementType === 'linear' ? 2 : measurementType === 'area' ? 3 : 1;
      if (currentMeasurement.length >= minPoints) {
        renderSVGCurrentMeasurement(svgOverlay, viewport);
      }
    }
    
    // Draw calibration points
    if (isCalibrating && calibrationPoints.length > 0) {
      renderSVGCalibrationPoints(svgOverlay);
    }
    
    // Draw crosshair if measuring
    if (mousePosition && isMeasuring) {
      renderSVGCrosshair(svgOverlay, mousePosition, viewport);
    }
  }, [localTakeoffMeasurements, currentMeasurement, measurementType, isMeasuring, isCalibrating, calibrationPoints, mousePosition]);

  // No coordinate conversions needed - SVG viewBox matches viewport exactly
  // CSS pixels = SVG pixels = viewport pixels (1:1 mapping)

  // Render individual measurement as SVG
  const renderSVGMeasurement = (svg: SVGSVGElement, measurement: Measurement, viewport: any) => {
    if (!measurement || !measurement.points || !viewport) {
      console.warn('renderSVGMeasurement: Missing measurement or viewport');
      return;
    }
    
    const points = measurement.points;
    if (points.length < 2) return;
    
    switch (measurement.type) {
      case 'linear':
        // Create polyline for linear measurement
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        const pointString = points.map(p => {
          // Points are stored in PDF coordinates (0-1), convert to viewport pixels
          return `${p.x * viewport.width},${p.y * viewport.height}`;
        }).join(' ');
        polyline.setAttribute('points', pointString);
        polyline.setAttribute('stroke', measurement.color);
        polyline.setAttribute('stroke-width', '2');
        polyline.setAttribute('fill', 'none');
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
        text.setAttribute('fill', measurement.color);
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
          polygon.setAttribute('stroke', measurement.color);
          polygon.setAttribute('stroke-width', '2');
          svg.appendChild(polygon);
          
          // Add area text
          const centerX = points.reduce((sum, p) => sum + p.x * viewport.width, 0) / points.length;
          const centerY = points.reduce((sum, p) => sum + p.y * viewport.height, 0) / points.length;
          
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', centerX.toString());
          text.setAttribute('y', centerY.toString());
          text.setAttribute('fill', measurement.color);
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
        
      case 'count':
        const point = { x: points[0].x * viewport.width, y: points[0].y * viewport.height };
        
        // Create circle for count measurement
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', point.x.toString());
        circle.setAttribute('cy', point.y.toString());
        circle.setAttribute('r', '10');
        circle.setAttribute('fill', measurement.color + '40');
        circle.setAttribute('stroke', measurement.color);
        circle.setAttribute('stroke-width', '2');
        svg.appendChild(circle);
        
        // Add count text
        const countText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        countText.setAttribute('x', point.x.toString());
        countText.setAttribute('y', (point.y + 4).toString());
        countText.setAttribute('fill', 'white');
        countText.setAttribute('font-size', '12');
        countText.setAttribute('font-family', 'Arial');
        countText.setAttribute('font-weight', 'bold');
        countText.setAttribute('text-anchor', 'middle');
        countText.setAttribute('dominant-baseline', 'middle');
        countText.textContent = '1';
        svg.appendChild(countText);
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
        if (currentMeasurement.length > 0) {
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
        }
        break;
        
      case 'area':
        if (currentMeasurement.length >= 3) {
          const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          const pointString = currentMeasurement.map(p => {
            // Points are stored in PDF coordinates (0-1), convert to viewport pixels
            return `${p.x * viewport.width},${p.y * viewport.height}`;
          }).join(' ');
          
          polygon.setAttribute('points', pointString);
          polygon.setAttribute('fill', conditionColor + '40');
          polygon.setAttribute('stroke', conditionColor);
          polygon.setAttribute('stroke-width', '3');
          polygon.setAttribute('stroke-dasharray', '5,5');
          svg.appendChild(polygon);
        }
        break;
        
      case 'count':
        if (currentMeasurement.length >= 1) {
          const point = { x: currentMeasurement[0].x * viewport.width, y: currentMeasurement[0].y * viewport.height };
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', point.x.toString());
          circle.setAttribute('cy', point.y.toString());
          circle.setAttribute('r', '10');
          circle.setAttribute('fill', conditionColor + '40');
          circle.setAttribute('stroke', conditionColor);
          circle.setAttribute('stroke-width', '3');
          circle.setAttribute('stroke-dasharray', '5,5');
          svg.appendChild(circle);
        }
        break;
    }
  };

  // Render calibration points as SVG
  const renderSVGCalibrationPoints = (svg: SVGSVGElement) => {
    if (!viewportRef.current) return;
    
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

  // Handle mouse move - direct coordinate conversion
  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    if (!isMeasuring || !selectedConditionId) {
      if (mousePosition) {
        setMousePosition(null);
      }
      return;
    }
    
    if (!pdfCanvasRef.current || !viewportRef.current) {
      return;
    }
    
    // Get CSS pixel coordinates relative to the canvas/SVG
    const rect = pdfCanvasRef.current.getBoundingClientRect();
    const cssX = event.clientX - rect.left;
    const cssY = event.clientY - rect.top;
    
    // Convert CSS coordinates to PDF coordinates (0-1) for storage
    const pdfCoords = {
      x: cssX / viewportRef.current.width,
      y: cssY / viewportRef.current.height
    };
    
    const threshold = 0.005;
    if (mousePosition && 
        Math.abs(mousePosition.x - pdfCoords.x) < threshold && 
        Math.abs(mousePosition.y - pdfCoords.y) < threshold) {
      return;
    }
    
    setMousePosition(pdfCoords);
  }, [isMeasuring, selectedConditionId, mousePosition]);

  // Handle click - direct coordinate conversion
  const handleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    const currentStoreState = useTakeoffStore.getState();
    const currentSelectedConditionId = currentStoreState.selectedConditionId;
    
    if (!pdfCanvasRef.current || !viewportRef.current) return;
    
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
    
    // Convert CSS coordinates to PDF coordinates (0-1) for storage
    const pdfCoords = {
      x: cssX / viewportRef.current.width,
      y: cssY / viewportRef.current.height
    };
    
    setCurrentMeasurement(prev => {
      const newMeasurement = [...prev, pdfCoords];
      
      // Complete measurement based on type
      if (measurementType === 'count') {
        completeMeasurement([pdfCoords]);
      } else if (measurementType === 'linear' && newMeasurement.length >= 2) {
        // Auto-complete linear measurements after 2 points
        requestAnimationFrame(() => {
          completeMeasurement(newMeasurement);
        });
      } else if (measurementType === 'area' && newMeasurement.length >= 3) {
        // Auto-complete area measurements after 3 points
        requestAnimationFrame(() => {
          completeMeasurement(newMeasurement);
        });
      }
      
      return newMeasurement;
    });
  }, [isCalibrating, measurementType, currentMeasurement]);

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
    
    if (!viewportRef.current) {
      return;
    }
    
    const viewport = viewportRef.current;
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
          calculatedValue = totalDistance / scaleFactor;
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
          calculatedValue = Math.abs(area) / (2 * scaleFactor * scaleFactor);
        }
        break;
      case 'count':
        calculatedValue = 1;
        break;
    }
    
    // Calculate perimeter for area measurements
    let perimeterValue: number | undefined;
    if (measurementType === 'area' && selectedCondition.includePerimeter && viewportPoints.length >= 3) {
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
        pdfPageType: typeof currentPage
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
        
        // Re-render the page using queued rendering
        requestAnimationFrame(() => {
          renderPDFPage(currentPage);
        });
      }).catch(error => {
        console.error('Failed to save measurement:', error);
      });
    }
    
    // Clear current measurement
    setCurrentMeasurement([]);
    setMousePosition(null);
  }, [getSelectedCondition, measurementType, scaleFactor, currentProjectId, currentPage, file.id, renderPDFPage]);

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

  // Re-render when page changes
  useEffect(() => {
    if (pdfDocument) {
      setMeasurements([]);
      renderPDFPage(currentPage);
    }
  }, [pdfDocument, currentPage, renderPDFPage]);

  // Clear current measurement state when page changes
  useEffect(() => {
    setCurrentMeasurement([]);
    setMousePosition(null);
    setMeasurements([]);
  }, [currentPage]);

  // Re-render when view state changes
  useEffect(() => {
    if (pdfDocument) {
      renderPDFPage(currentPage);
    }
  }, [viewState, renderPDFPage, currentPage]);

  // Re-render annotations when measurements or interaction state changes
  useEffect(() => {
    if (pdfDocument && viewportRef.current && !isRenderingRef.current) {
      renderTakeoffAnnotations();
    }
  }, [localTakeoffMeasurements, currentMeasurement, isMeasuring, isCalibrating, calibrationPoints, mousePosition, renderTakeoffAnnotations]);

  // Set measurement type when condition is selected
  useEffect(() => {
    if (selectedConditionId) {
      const condition = getSelectedCondition();
      if (condition) {
        setIsMeasuring(true);
        
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
      viewportRef.current = null;
      outputScaleRef.current = 1;
      isRenderingRef.current = false;
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
          cursor: isMeasuring ? 'crosshair' : (isCalibrating ? 'crosshair' : 'default')
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
                cursor: isMeasuring ? 'crosshair' : 'default',
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
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setMousePosition(null)}
            />
            
            {/* SVG Overlay (Foreground Layer) */}
            <svg
              ref={svgOverlayRef}
              className="shadow-lg"
              style={{
                cursor: isMeasuring ? 'crosshair' : 'default',
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
                pointerEvents: 'none' // Let clicks pass through to PDF canvas
              }}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setMousePosition(null)}
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