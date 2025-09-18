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
  
  // Refs - Dual Canvas System
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null);
  const pdfPageRef = useRef<any>(null);
  const viewportRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);
  const isRenderingRef = useRef<boolean>(false);
  const isAnnotationRenderingRef = useRef<boolean>(false);
  const annotationRenderFrameRef = useRef<number | null>(null);

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
    
    if (annotationRenderFrameRef.current) {
      cancelAnimationFrame(annotationRenderFrameRef.current);
      annotationRenderFrameRef.current = null;
    }
    
    // Clear canvas contexts
    if (pdfCanvasRef.current) {
      const context = pdfCanvasRef.current.getContext('2d');
      if (context) {
        context.clearRect(0, 0, pdfCanvasRef.current.width, pdfCanvasRef.current.height);
        context.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    
    if (annotationCanvasRef.current) {
      const context = annotationCanvasRef.current.getContext('2d');
      if (context) {
        context.clearRect(0, 0, annotationCanvasRef.current.width, annotationCanvasRef.current.height);
        context.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    
    // Reset rendering flags
    isRenderingRef.current = false;
    isAnnotationRenderingRef.current = false;
  }, [file?.id]);

  // Synchronized canvas dimension update function
  const updateCanvasDimensions = useCallback((viewport: any) => {
    if (!pdfCanvasRef.current || !annotationCanvasRef.current) return;
    
    const pdfCanvas = pdfCanvasRef.current;
    const annotationCanvas = annotationCanvasRef.current;
    
    // Round viewport dimensions to integers to prevent floating-point precision issues
    const canvasWidth = Math.round(viewport.width);
    const canvasHeight = Math.round(viewport.height);
    
    // Update PDF canvas dimensions (only set actual canvas dimensions, not CSS styles)
    pdfCanvas.width = canvasWidth;
    pdfCanvas.height = canvasHeight;
    
    // Update annotation canvas dimensions to match exactly (only set actual canvas dimensions, not CSS styles)
    annotationCanvas.width = canvasWidth;
    annotationCanvas.height = canvasHeight;
    
    // Verify synchronization and positioning
    if (pdfCanvas.width !== annotationCanvas.width || pdfCanvas.height !== annotationCanvas.height) {
      console.warn('Canvas dimension mismatch detected, forcing synchronization');
      console.warn(`PDF: ${pdfCanvas.width}x${pdfCanvas.height}, Annotation: ${annotationCanvas.width}x${annotationCanvas.height}`);
      annotationCanvas.width = pdfCanvas.width;
      annotationCanvas.height = pdfCanvas.height;
    }
    
    console.log(`📐 CANVAS DIMENSIONS: PDF=${pdfCanvas.width}x${pdfCanvas.height}, Annotation=${annotationCanvas.width}x${annotationCanvas.height}, Viewport=${viewport.width}x${viewport.height} (rounded to ${canvasWidth}x${canvasHeight})`);
    
    // Don't set CSS styles - let the canvas handle its own dimensions
    
    // Ensure perfect positioning alignment
    const pdfRect = pdfCanvas.getBoundingClientRect();
    const annotationRect = annotationCanvas.getBoundingClientRect();
    
    if (Math.abs(pdfRect.left - annotationRect.left) > 1 || 
        Math.abs(pdfRect.top - annotationRect.top) > 1) {
      console.warn('Canvas positioning mismatch detected, forcing alignment');
      // Force re-positioning by temporarily removing and re-adding the absolute positioning
      annotationCanvas.style.position = 'static';
      requestAnimationFrame(() => {
        annotationCanvas.style.position = 'absolute';
        annotationCanvas.style.top = '0px';
        annotationCanvas.style.left = '0px';
      });
    }
  }, []);

  // PDF-only render function
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

      const viewport = page.getViewport({ 
        scale: viewState.scale,
        rotation: 0
      });
      
      viewportRef.current = viewport;
      
      // Synchronize both canvas dimensions
      updateCanvasDimensions(viewport);
      
      // Round viewport dimensions to prevent floating-point precision issues
      const canvasWidth = Math.round(viewport.width);
      const canvasHeight = Math.round(viewport.height);
      
      // Clear and reset PDF canvas
      pdfContext.clearRect(0, 0, canvasWidth, canvasHeight);
      pdfContext.setTransform(1, 0, 0, 1, 0, 0);
      
      // Also clear annotation canvas immediately to prevent sync issues
      if (annotationCanvasRef.current) {
        const annotationContext = annotationCanvasRef.current.getContext('2d');
        if (annotationContext) {
          annotationContext.clearRect(0, 0, canvasWidth, canvasHeight);
          annotationContext.setTransform(1, 0, 0, 1, 0, 0);
        }
      }
      
      const renderContext = {
        canvasContext: pdfContext,
        viewport: viewport
      };
      
      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      
      // After PDF is rendered, render annotations on separate canvas
      // Use queued rendering to prevent race conditions
      queueAnnotationRender();
      
    } catch (error: any) {
      if (error.name !== 'RenderingCancelledException') {
        console.error('Error rendering PDF page:', error);
      }
    } finally {
      isRenderingRef.current = false;
    }
  }, [pdfDocument, viewState, updateCanvasDimensions, currentProjectId, file?.id]);

  // Annotation-only renderer for separate canvas
  const renderAnnotations = useCallback(() => {
    if (!viewportRef.current || !annotationCanvasRef.current) return;
    
    if (isAnnotationRenderingRef.current) return;
    isAnnotationRenderingRef.current = true;
    
    try {
      const annotationCanvas = annotationCanvasRef.current;
      const annotationContext = annotationCanvas.getContext('2d');
      if (!annotationContext) return;
      
      const viewport = viewportRef.current;
      
      // Canvas dimensions should already be synchronized by updateCanvasDimensions
      // Just verify they match and clear the canvas
      if (annotationCanvas.width !== viewport.width || annotationCanvas.height !== viewport.height) {
        console.warn('Annotation canvas dimensions out of sync, forcing update');
        updateCanvasDimensions(viewport);
      }
      
      // Clear annotation canvas using rounded dimensions
      const canvasWidth = Math.round(viewport.width);
      const canvasHeight = Math.round(viewport.height);
      annotationContext.clearRect(0, 0, canvasWidth, canvasHeight);
      annotationContext.setTransform(1, 0, 0, 1, 0, 0);
      
      // Draw takeoff measurements
      console.log(`🎨 RENDERING: ${localTakeoffMeasurements.length} measurements on annotation canvas`);
      console.log(`🎨 MEASUREMENTS TO RENDER:`, localTakeoffMeasurements.map(m => ({ id: m.id, pdfPage: m.pdfPage, type: m.type })));
      localTakeoffMeasurements.forEach((measurement) => {
        renderMeasurement(annotationContext, measurement, viewport);
      });
      
      // Draw current measurement being created
      if (currentMeasurement.length > 0 && isMeasuring) {
        const minPoints = measurementType === 'linear' ? 2 : measurementType === 'area' ? 3 : 1;
        if (currentMeasurement.length >= minPoints) {
          renderCurrentMeasurement(annotationContext, viewport);
        }
      }
      
      // Draw calibration points
      if (isCalibrating && calibrationPoints.length > 0) {
        renderCalibrationPoints(annotationContext);
      }
      
      // Draw crosshair if measuring
      if (mousePosition && isMeasuring) {
        renderCrosshair(annotationContext, mousePosition, viewport);
      }
    } catch (error) {
      console.error('Error rendering annotations:', error);
    } finally {
      isAnnotationRenderingRef.current = false;
    }
  }, [localTakeoffMeasurements, currentMeasurement, measurementType, isMeasuring, isCalibrating, calibrationPoints, mousePosition, updateCanvasDimensions]);

  // Queued annotation rendering to prevent race conditions
  const queueAnnotationRender = useCallback(() => {
    // Cancel any pending render
    if (annotationRenderFrameRef.current) {
      cancelAnimationFrame(annotationRenderFrameRef.current);
    }
    
    // Queue new render
    annotationRenderFrameRef.current = requestAnimationFrame(() => {
      renderAnnotations();
      annotationRenderFrameRef.current = null;
    });
  }, [renderAnnotations]);


  // Immediate annotation rendering when measurements are loaded and PDF is ready
  useEffect(() => {
    if (localTakeoffMeasurements.length > 0 && pdfDocument && viewportRef.current && !isRenderingRef.current) {
      // Use queued rendering to prevent race conditions
      queueAnnotationRender();
    }
  }, [localTakeoffMeasurements, pdfDocument, queueAnnotationRender]);

  // Re-render annotations when viewState (zoom) changes
  useEffect(() => {
    if (localTakeoffMeasurements.length > 0 && pdfDocument && viewportRef.current && !isRenderingRef.current) {
      // Use queued rendering to prevent race conditions
      queueAnnotationRender();
    }
  }, [viewState, queueAnnotationRender, localTakeoffMeasurements, pdfDocument]);

  // Unified coordinate conversion system
  const convertToCanvasCoords = useCallback((point: { x: number; y: number }, viewport: any) => {
    // All stored coordinates should be in normalized PDF space (0-1)
    // Convert to canvas pixel coordinates
    return {
      x: point.x * viewport.width,
      y: point.y * viewport.height
    };
  }, []);

  const convertToPDFCoords = useCallback((canvasX: number, canvasY: number, viewport: any) => {
    // Convert canvas pixel coordinates to normalized PDF coordinates (0-1)
    return {
      x: canvasX / viewport.width,
      y: canvasY / viewport.height
    };
  }, []);

  // Render individual measurement
  const renderMeasurement = (context: CanvasRenderingContext2D, measurement: Measurement, viewport: any) => {
    const points = measurement.points;
    if (points.length < 2) return;
    
    context.save();
    context.lineWidth = 2;
    
    switch (measurement.type) {
      case 'linear':
        context.beginPath();
        context.strokeStyle = measurement.color;
        
        const startPoint = convertToCanvasCoords(points[0], viewport);
        context.moveTo(startPoint.x, startPoint.y);
        
        for (let i = 1; i < points.length; i++) {
          const point = convertToCanvasCoords(points[i], viewport);
          context.lineTo(point.x, point.y);
        }
        context.stroke();
        
        const endPoint = convertToCanvasCoords(points[points.length - 1], viewport);
        const midPoint = {
          x: (startPoint.x + endPoint.x) / 2,
          y: (startPoint.y + endPoint.y) / 2
        };
        context.fillStyle = measurement.color;
        context.font = '12px Arial';
        const displayValue = measurement.unit === 'ft' || measurement.unit === 'feet' 
          ? formatFeetAndInches(measurement.calculatedValue)
          : `${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`;
        context.fillText(displayValue, midPoint.x, midPoint.y - 5);
        break;
        
      case 'area':
        if (points.length >= 3) {
          context.beginPath();
          const startPoint = convertToCanvasCoords(points[0], viewport);
          context.moveTo(startPoint.x, startPoint.y);
          
          for (let i = 1; i < points.length; i++) {
            const point = convertToCanvasCoords(points[i], viewport);
            context.lineTo(point.x, point.y);
          }
          context.closePath();
          
          context.fillStyle = measurement.color + '40';
          context.fill();
          
          context.strokeStyle = measurement.color;
          context.lineWidth = 2;
          context.stroke();
          
          const centerX = points.reduce((sum, p) => {
            const converted = convertToCanvasCoords(p, viewport);
            return sum + converted.x;
          }, 0) / points.length;
          const centerY = points.reduce((sum, p) => {
            const converted = convertToCanvasCoords(p, viewport);
            return sum + converted.y;
          }, 0) / points.length;
          
          context.fillStyle = measurement.color;
          context.font = 'bold 12px Arial';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          
          const areaValue = `${measurement.calculatedValue.toFixed(0)} SF`;
          const displayValue = measurement.perimeterValue 
            ? `${areaValue} / ${formatFeetAndInches(measurement.perimeterValue)}`
            : areaValue;
          
          context.fillText(displayValue, centerX, centerY);
        }
        break;
        
      case 'count':
        const point = convertToCanvasCoords(points[0], viewport);
        context.beginPath();
        context.strokeStyle = measurement.color;
        context.fillStyle = measurement.color + '40';
        context.arc(point.x, point.y, 10, 0, 2 * Math.PI);
        context.fill();
        context.stroke();
        
        context.fillStyle = 'white';
        context.font = 'bold 12px Arial';
        context.textAlign = 'center';
        context.fillText('1', point.x, point.y + 4);
        context.textAlign = 'left';
        break;
    }
    
    context.restore();
  };

  // Render current measurement being drawn
  const renderCurrentMeasurement = (context: CanvasRenderingContext2D, viewport: any) => {
    if (!viewport) return;

    const selectedCondition = getSelectedCondition();
    const conditionColor = selectedCondition?.color || '#000000';
    
    context.save();
    
    switch (measurementType) {
      case 'linear':
        if (currentMeasurement.length > 0) {
          context.strokeStyle = conditionColor;
          context.lineWidth = 3;
          context.setLineDash([]);
          context.beginPath();
          
          const startPoint = convertToCanvasCoords(currentMeasurement[0], viewport);
          context.moveTo(startPoint.x, startPoint.y);
          
          for (let i = 1; i < currentMeasurement.length; i++) {
            const point = convertToCanvasCoords(currentMeasurement[i], viewport);
            context.lineTo(point.x, point.y);
          }
          
          if (mousePosition) {
            const mousePoint = convertToCanvasCoords(mousePosition, viewport);
            context.lineTo(mousePoint.x, mousePoint.y);
          }
          
          context.stroke();
        }
        break;
        
      case 'area':
        if (currentMeasurement.length >= 3) {
          context.beginPath();
          const startPoint = convertToCanvasCoords(currentMeasurement[0], viewport);
          context.moveTo(startPoint.x, startPoint.y);
          
          for (let i = 1; i < currentMeasurement.length; i++) {
            const point = convertToCanvasCoords(currentMeasurement[i], viewport);
            context.lineTo(point.x, point.y);
          }
          context.closePath();
          context.fill();
          context.stroke();
        }
        break;
        
      case 'count':
        if (currentMeasurement.length >= 1) {
          const point = convertToCanvasCoords(currentMeasurement[0], viewport);
          context.beginPath();
          context.arc(point.x, point.y, 10, 0, 2 * Math.PI);
          context.fill();
          context.stroke();
        }
        break;
    }
    
    context.restore();
  };

  // Render calibration points
  const renderCalibrationPoints = (context: CanvasRenderingContext2D) => {
    if (!viewportRef.current) return;
    
    context.save();
    context.strokeStyle = '#ff0000';
    context.fillStyle = '#ff0000';
    context.lineWidth = 3;
    
    const viewport = viewportRef.current;
    
    calibrationPoints.forEach((point, index) => {
      // Convert canvas coordinates to proper position
      const canvasX = point.x;
      const canvasY = point.y;
      
      context.beginPath();
      context.arc(canvasX, canvasY, 8, 0, 2 * Math.PI);
      context.fill();
      
      context.fillStyle = 'white';
      context.font = 'bold 12px Arial';
      context.textAlign = 'center';
      context.fillText((index + 1).toString(), canvasX, canvasY + 4);
      context.fillStyle = '#ff0000';
    });
    
    if (calibrationPoints.length === 2) {
      context.beginPath();
      context.moveTo(calibrationPoints[0].x, calibrationPoints[0].y);
      context.lineTo(calibrationPoints[1].x, calibrationPoints[1].y);
      context.stroke();
      
      const midX = (calibrationPoints[0].x + calibrationPoints[1].x) / 2;
      const midY = (calibrationPoints[0].y + calibrationPoints[1].y) / 2;
      const distance = calculateDistance(calibrationPoints[0], calibrationPoints[1]);
      
      context.fillStyle = '#ff0000';
      context.font = 'bold 14px Arial';
      context.fillText(`${distance.toFixed(1)} px`, midX, midY - 10);
    }
    
    context.restore();
  };

  // Render crosshair
  const renderCrosshair = (context: CanvasRenderingContext2D, position: { x: number; y: number }, viewport: any) => {
    const canvasPoint = convertToCanvasCoords(position, viewport);
    
    context.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    context.lineWidth = 1;
    context.setLineDash([]);
    
    const crosshairSize = 20;
    context.beginPath();
    context.moveTo(canvasPoint.x - crosshairSize, canvasPoint.y);
    context.lineTo(canvasPoint.x + crosshairSize, canvasPoint.y);
    context.moveTo(canvasPoint.x, canvasPoint.y - crosshairSize);
    context.lineTo(canvasPoint.x, canvasPoint.y + crosshairSize);
    context.stroke();
    
    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.beginPath();
    context.arc(canvasPoint.x, canvasPoint.y, 2, 0, 2 * Math.PI);
    context.fill();
  };

  // Handle mouse move - works with either canvas
  const handleCanvasMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMeasuring || !selectedConditionId) {
      if (mousePosition) {
        setMousePosition(null);
      }
      return;
    }
    
    // Use the PDF canvas for coordinate calculations (both canvases should have same dimensions)
    if (!pdfCanvasRef.current || !viewportRef.current) {
      return;
    }
    
    const rect = pdfCanvasRef.current.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    
    const viewport = viewportRef.current;
    const pdfCoords = convertToPDFCoords(canvasX, canvasY, viewport);
    
    const threshold = 0.005;
    if (mousePosition && 
        Math.abs(mousePosition.x - pdfCoords.x) < threshold && 
        Math.abs(mousePosition.y - pdfCoords.y) < threshold) {
      return;
    }
    
    setMousePosition(pdfCoords);
  }, [isMeasuring, selectedConditionId, mousePosition, convertToPDFCoords]);

  // Handle canvas click - works with either canvas
  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const currentStoreState = useTakeoffStore.getState();
    const currentSelectedConditionId = currentStoreState.selectedConditionId;
    
    // Use the PDF canvas for coordinate calculations (both canvases should have same dimensions)
    if (!pdfCanvasRef.current) return;
    
    const canvasRect = pdfCanvasRef.current.getBoundingClientRect();
    const x = event.clientX - canvasRect.left;
    const y = event.clientY - canvasRect.top;
    
    // Handle calibration clicks
    if (isCalibrating) {
      setCalibrationPoints(prev => {
        const newPoints = [...prev, { x, y }];
        
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
    
    if (!viewportRef.current) {
      return;
    }
    
    const viewport = viewportRef.current;
    const pdfCoords = convertToPDFCoords(x, y, viewport);
    
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
  }, [isCalibrating, measurementType, currentMeasurement, convertToPDFCoords]);

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
    const canvasPoints = points.map(point => convertToCanvasCoords(point, viewport));
    
    switch (measurementType) {
      case 'linear':
        if (canvasPoints.length >= 2) {
          let totalDistance = 0;
          for (let i = 1; i < canvasPoints.length; i++) {
            const dx = canvasPoints[i].x - canvasPoints[i - 1].x;
            const dy = canvasPoints[i].y - canvasPoints[i - 1].y;
            totalDistance += Math.sqrt(dx * dx + dy * dy);
          }
          calculatedValue = totalDistance / scaleFactor;
        }
        break;
      case 'area':
        if (canvasPoints.length >= 3) {
          let area = 0;
          for (let i = 0; i < canvasPoints.length; i++) {
            const j = (i + 1) % canvasPoints.length;
            area += canvasPoints[i].x * canvasPoints[j].y;
            area -= canvasPoints[j].x * canvasPoints[i].y;
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
    if (measurementType === 'area' && selectedCondition.includePerimeter && canvasPoints.length >= 3) {
      let perimeter = 0;
      for (let i = 0; i < canvasPoints.length; i++) {
        const j = (i + 1) % canvasPoints.length;
        const dx = canvasPoints[j].x - canvasPoints[i].x;
        const dy = canvasPoints[j].y - canvasPoints[i].y;
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
  }, [getSelectedCondition, measurementType, scaleFactor, currentProjectId, currentPage, file.id, renderPDFPage, convertToCanvasCoords]);

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
      // Use queued rendering to prevent race conditions
      queueAnnotationRender();
    }
  }, [localTakeoffMeasurements, currentMeasurement, isMeasuring, isCalibrating, calibrationPoints, mousePosition, queueAnnotationRender]);

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
      
      // Cancel any pending animation frames
      if (annotationRenderFrameRef.current) {
        cancelAnimationFrame(annotationRenderFrameRef.current);
        annotationRenderFrameRef.current = null;
      }
      
      // Clear and reset canvas contexts
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
      
      if (annotationCanvasRef.current) {
        const context = annotationCanvasRef.current.getContext('2d');
        if (context) {
          context.clearRect(0, 0, annotationCanvasRef.current.width, annotationCanvasRef.current.height);
          context.setTransform(1, 0, 0, 1, 0, 0);
        }
        // Reset canvas dimensions to free memory
        annotationCanvasRef.current.width = 0;
        annotationCanvasRef.current.height = 0;
      }
      
      // Clear refs to prevent memory leaks
      pdfPageRef.current = null;
      viewportRef.current = null;
      isRenderingRef.current = false;
      isAnnotationRenderingRef.current = false;
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

      {/* Dual Canvas Container */}
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
                // Ensure no extra spacing and no CSS scaling
                margin: 0,
                padding: 0,
                border: 'none',
                outline: 'none'
                // Don't set width/height - let canvas handle its own dimensions
              }}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasMouseMove}
              onMouseLeave={() => setMousePosition(null)}
            />
            
            {/* Annotation Canvas (Foreground Layer) */}
            <canvas
              ref={annotationCanvasRef}
              className="shadow-lg"
              style={{
                cursor: isMeasuring ? 'crosshair' : 'default',
                display: 'block',
                position: 'absolute',
                top: 0,
                left: 0,
                zIndex: 2,
                // Ensure perfect overlay alignment and no CSS scaling
                margin: 0,
                padding: 0,
                border: 'none',
                outline: 'none',
                // Don't set width/height - let canvas handle its own dimensions
                pointerEvents: 'none' // Always let clicks pass through to PDF canvas for consistent behavior
              }}
              onMouseMove={handleCanvasMouseMove}
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