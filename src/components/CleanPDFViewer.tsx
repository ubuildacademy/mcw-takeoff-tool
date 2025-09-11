import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { useTakeoffStore } from '../store/useTakeoffStore';
import CalibrationDialog from './CalibrationDialog';
import ScaleApplicationDialog from './ScaleApplicationDialog';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface SearchResult {
  documentId: string;
  pageNumber: number;
  matches: Array<{
    text: string;
    context: string;
    confidence: number;
  }>;
}

interface CleanPDFViewerProps {
  file: File | string | any;
  className?: string;
  // Control props
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
  // Expose calibration trigger
  onCalibrationRequest?: () => void;
  // Callback for calibration completion
  onCalibrationComplete?: (isCalibrated: boolean, scaleFactor: number, unit: string) => void;
  // Search results for highlighting
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
}

const CleanPDFViewer: React.FC<CleanPDFViewerProps> = ({ 
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
  
  // View state - single source of truth
  const [internalViewState, setInternalViewState] = useState({ 
    scale: 1, 
    rotation: 0
  });

  // Use external props when available, fall back to internal state
  const currentPage = externalCurrentPage ?? internalCurrentPage;
  const totalPages = externalTotalPages ?? internalTotalPages;
  
  // Memoize viewState to prevent unnecessary re-renders
  const viewState = useMemo(() => ({ 
    scale: externalScale ?? internalViewState.scale, 
    rotation: internalViewState.rotation 
  }), [externalScale, internalViewState.scale, internalViewState.rotation]);

  // No need to sync internal state with external props - just use them directly
  
  // Measurement state
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measurementType, setMeasurementType] = useState<'linear' | 'area' | 'volume' | 'count'>('linear');
  const [currentMeasurement, setCurrentMeasurement] = useState<{ x: number; y: number }[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  
  // Scale calibration
  const [scaleFactor, setScaleFactor] = useState(1);
  const [isPageCalibrated, setIsPageCalibrated] = useState(false);
  const [unit, setUnit] = useState('ft');
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<{ x: number; y: number }[]>([]);
  const [showCalibrationDialog, setShowCalibrationDialog] = useState(false);
  const [showScaleApplicationDialog, setShowScaleApplicationDialog] = useState(false);
  const [pendingScaleData, setPendingScaleData] = useState<{scaleFactor: number, unit: string} | null>(null);
  const [calibrationData, setCalibrationData] = useState<{knownDistance: number, unit: string} | null>(null);
  
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfPageRef = useRef<any>(null);
  const viewportRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);
  const isRenderingRef = useRef<boolean>(false);

  // Store integration
  const { 
    currentProjectId, 
    selectedConditionId,
    addTakeoffMeasurement,
    getSelectedCondition,
    getSheetTakeoffMeasurements,
    deleteTakeoffMeasurement
  } = useTakeoffStore();

  // Load existing takeoff measurements for the current sheet
  const [localTakeoffMeasurements, setLocalTakeoffMeasurements] = useState<any[]>([]);
  
  // OCR data for search highlighting
  const [ocrData, setOcrData] = useState<{[pageNumber: number]: any}>({});
  const [searchHighlights, setSearchHighlights] = useState<{[pageNumber: number]: any[]}>({});

  // Convert PDF coordinates to canvas coordinates
  const pdfToCanvasCoords = useCallback((pdfCoords: { x: number; y: number }[]) => {
    if (!viewportRef.current) {
      console.log('No viewport available for coordinate conversion');
      return pdfCoords;
    }
    
    const viewport = viewportRef.current;
    const canvasCoords = pdfCoords.map(coord => ({
      x: coord.x * viewport.width,
      y: coord.y * viewport.height
    }));
    
    console.log('🔄 PDF_TO_CANVAS: Converting coordinates', {
      pdfCoords,
      viewport: { width: viewport.width, height: viewport.height },
      canvasCoords,
      timestamp: new Date().toISOString()
    });
    
    return canvasCoords;
  }, []);

  // Convert canvas coordinates to PDF coordinates (0-1 scale)
  const canvasToPdfCoords = useCallback((canvasCoords: { x: number; y: number }[]) => {
    if (!viewportRef.current) {
      console.log('No viewport available for coordinate conversion');
      return canvasCoords;
    }
    
    const viewport = viewportRef.current;
    const pdfCoords = canvasCoords.map(coord => ({
      x: coord.x / viewport.width,
      y: coord.y / viewport.height
    }));
    
    console.log('Canvas to PDF conversion:', {
      canvasCoords,
      viewport: { width: viewport.width, height: viewport.height },
      pdfCoords
    });
    
    return pdfCoords;
  }, []);

  // Load takeoff measurements for current sheet and page
  const loadTakeoffMeasurements = useCallback(() => {
    console.log('🔍 LOAD_TAKEOFF_MEASUREMENTS: Starting...', { 
      currentProjectId, 
      fileId: file?.id, 
      currentPage,
      viewportAvailable: !!viewportRef.current,
      viewport: viewportRef.current ? { width: viewportRef.current.width, height: viewportRef.current.height } : null
    });
    
    if (!currentProjectId || !file?.id) {
      console.log('❌ LOAD_TAKEOFF_MEASUREMENTS: Missing required data', { currentProjectId, fileId: file?.id });
      return;
    }
    
    const sheetMeasurements = getSheetTakeoffMeasurements(currentProjectId, file.id);
    console.log('📊 LOAD_TAKEOFF_MEASUREMENTS: Sheet measurements found', { 
      totalMeasurements: sheetMeasurements.length,
      measurements: sheetMeasurements.map(m => ({
        id: m.id,
        type: m.type,
        pdfPage: m.pdfPage,
        hasPdfCoords: !!m.pdfCoordinates,
        hasPoints: !!m.points,
        pdfCoords: m.pdfCoordinates,
        points: m.points
      }))
    });
    
    // Filter measurements for current page
    const pageMeasurements = sheetMeasurements.filter(m => m.pdfPage === currentPage);
    console.log('📄 LOAD_TAKEOFF_MEASUREMENTS: Page measurements', { 
      currentPage,
      pageMeasurements: pageMeasurements.length,
      measurements: pageMeasurements.map(m => ({
        id: m.id,
        type: m.type,
        pdfCoords: m.pdfCoordinates,
        points: m.points
      }))
    });
    
    // Convert takeoff measurements to renderable format
    const renderableMeasurements = pageMeasurements.map(measurement => {
      // Use PDF coordinates if available, otherwise use points
      const coords = measurement.pdfCoordinates || measurement.points;
      console.log('🔄 LOAD_TAKEOFF_MEASUREMENTS: Converting measurement', { 
        id: measurement.id,
        type: measurement.type,
        usingPdfCoords: !!measurement.pdfCoordinates,
        originalCoords: coords,
        viewport: viewportRef.current ? { width: viewportRef.current.width, height: viewportRef.current.height } : null
      });
      
      const canvasCoords = pdfToCanvasCoords(coords);
      
      console.log('✅ LOAD_TAKEOFF_MEASUREMENTS: Conversion result', { 
        id: measurement.id, 
        originalCoords: coords, 
        canvasCoords 
      });
      
      return {
        id: measurement.id,
        type: measurement.type,
        points: canvasCoords,
        calculatedValue: measurement.calculatedValue,
        unit: measurement.unit,
        conditionId: measurement.conditionId,
        color: measurement.conditionColor,
        conditionName: measurement.conditionName
      };
    });
    
    console.log('🎯 LOAD_TAKEOFF_MEASUREMENTS: Final renderable measurements', { 
      count: renderableMeasurements.length,
      measurements: renderableMeasurements.map(m => ({
        id: m.id,
        type: m.type,
        points: m.points,
        color: m.color
      }))
    });
    
    setLocalTakeoffMeasurements(renderableMeasurements);
  }, [currentProjectId, file?.id, currentPage, getSheetTakeoffMeasurements, pdfToCanvasCoords]);

  // Clear all takeoff measurements for current project
  const clearAllTakeoffMeasurements = useCallback(() => {
    if (!currentProjectId) return;
    
    // Get all measurements for this project
    const { takeoffMeasurements: allMeasurements } = useTakeoffStore.getState();
    const projectMeasurements = allMeasurements.filter(m => m.projectId === currentProjectId);
    
    console.log('Clearing all takeoff measurements:', projectMeasurements.length);
    
    // Delete each measurement
    projectMeasurements.forEach(measurement => {
      deleteTakeoffMeasurement(measurement.id);
    });
    
    // Clear local state
    setLocalTakeoffMeasurements([]);
    setMeasurements([]);
    setCurrentMeasurement([]);
    setMousePosition(null);
    
    console.log('All takeoff measurements cleared');
  }, [currentProjectId, deleteTakeoffMeasurement]);

  // Load PDF document
  useEffect(() => {
    const loadPDF = async () => {
      if (!file) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        let pdfUrl;
        
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
        
        // Only update internal state if external props are not provided
        if (externalTotalPages === undefined) {
          setInternalTotalPages(pdf.numPages);
        }
        if (externalCurrentPage === undefined) {
          setInternalCurrentPage(1);
        }
        
        // Notify parent component of PDF loaded
        if (onPDFLoaded) {
          onPDFLoaded(pdf.numPages);
        }
        
      } catch (error) {
        console.error('Error loading PDF:', error);
        setError('Failed to load PDF file');
      } finally {
        setIsLoading(false);
      }
    };

    loadPDF();
  }, [file]);

  // Load takeoff measurements when component mounts or dependencies change
  useEffect(() => {
    loadTakeoffMeasurements();
  }, [loadTakeoffMeasurements]);

  // Process search results and create highlights
  const processSearchResults = useCallback(() => {
    if (!searchResults.length || !currentSearchQuery) {
      setSearchHighlights({});
      return;
    }

    console.log('🎯 Processing search results for highlighting:', searchResults);
    
    const highlights: {[pageNumber: number]: any[]} = {};
    
    searchResults.forEach(result => {
      if (result.pageNumber === currentPage && result.matches.length > 0) {
        // For now, we'll create simple highlight rectangles
        // In a full implementation, you'd use the OCR word bounding boxes
        highlights[result.pageNumber] = result.matches.map((match, index) => ({
          id: `highlight-${index}`,
          text: match.text,
          context: match.context,
          // Placeholder coordinates - in real implementation, use OCR word bboxes
          x: 0.1 + (index * 0.1), // Spread highlights across page
          y: 0.1 + (index * 0.05),
          width: 0.3,
          height: 0.02
        }));
      }
    });
    
    setSearchHighlights(highlights);
  }, [searchResults, currentSearchQuery, currentPage]);

  // Update highlights when search results change
  useEffect(() => {
    processSearchResults();
  }, [processSearchResults]);

  // Clean render function - no complex coordinate transformations
  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDocument || !canvasRef.current || !containerRef.current) return;
    
    if (isRenderingRef.current) return;
    isRenderingRef.current = true;

    try {
      // Cancel previous render
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      const page = await pdfDocument.getPage(pageNum);
      pdfPageRef.current = page;
      
      const container = containerRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      if (!context) return;

      // Get base viewport for PDF
      const baseViewport = page.getViewport({ scale: 1 });
      
      // Use a reasonable default scale that allows scrolling
      const defaultScale = 1.5; // Start at 150% for good readability
      
      // Apply user zoom
      const finalScale = defaultScale * viewState.scale;
      
      // Get viewport with final scale
      const viewport = page.getViewport({ 
        scale: finalScale,
        rotation: viewState.rotation
      });
      
      viewportRef.current = viewport;
      
      // Set canvas size to match viewport
      const cssWidth = Math.floor(viewport.width);
      const cssHeight = Math.floor(viewport.height);
      
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.style.transform = 'none';
      
      // Set pixel dimensions for HiDPI
      const devicePixelRatio = window.devicePixelRatio || 1;
      canvas.width = cssWidth * devicePixelRatio;
      canvas.height = cssHeight * devicePixelRatio;
      
      // Scale context for HiDPI
      context.scale(devicePixelRatio, devicePixelRatio);
      
      // Render PDF
      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };
      
      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      
      // Re-render annotations
      renderAnnotations();
      
      // Reload takeoff measurements with updated viewport
      console.log('🔄 RENDER_PAGE: PDF render complete, reloading takeoff measurements');
      loadTakeoffMeasurements();
      
    } catch (error: any) {
      if (error.name !== 'RenderingCancelledException') {
        console.error('Error rendering page:', error);
      }
    } finally {
      isRenderingRef.current = false;
    }
  }, [pdfDocument, viewState]);

  // Clean annotation rendering
  const renderAnnotations = useCallback(() => {
    console.log('🎨 RENDER_ANNOTATIONS: Starting render...', {
      canvasAvailable: !!canvasRef.current,
      viewportAvailable: !!viewportRef.current,
      pdfPageAvailable: !!pdfPageRef.current,
      localTakeoffCount: localTakeoffMeasurements.length,
      localMeasurementsCount: measurements.length,
      currentMeasurementLength: currentMeasurement.length,
      mousePosition,
      isCalibrating,
      calibrationPointsCount: calibrationPoints.length
    });
    
    if (!canvasRef.current || !viewportRef.current) {
      console.log('❌ RENDER_ANNOTATIONS: Missing canvas or viewport');
      return;
    }
    
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) {
      console.log('❌ RENDER_ANNOTATIONS: No canvas context found!');
      return;
    }
    
    console.log('✅ RENDER_ANNOTATIONS: Canvas context found', { 
      canvasWidth: canvas.width, 
      canvasHeight: canvas.height,
      styleWidth: canvas.style.width,
      styleHeight: canvas.style.height,
      viewport: {
        width: viewportRef.current.width,
        height: viewportRef.current.height
      }
    });
    
    // Clear previous annotations by re-rendering PDF
    if (pdfPageRef.current) {
      const viewport = viewportRef.current;
      const devicePixelRatio = window.devicePixelRatio || 1;
      
      context.save();
      context.scale(devicePixelRatio, devicePixelRatio);
      
      // Re-render PDF background
      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };
      
      const renderTask = pdfPageRef.current.render(renderContext);
      renderTaskRef.current = renderTask;
      
      // Wait for PDF render to complete, then draw annotations
      renderTask.promise.then(() => {
        console.log('📄 RENDER_ANNOTATIONS: PDF render complete, drawing annotations...');
        
        // Draw takeoff measurements (persisted)
        console.log('🎯 RENDER_ANNOTATIONS: Drawing persisted takeoff measurements', {
          count: localTakeoffMeasurements.length,
          measurements: localTakeoffMeasurements.map(m => ({
            id: m.id,
            type: m.type,
            points: m.points,
            color: m.color
          }))
        });
        
        localTakeoffMeasurements.forEach((measurement, index) => {
          console.log(`📏 RENDER_ANNOTATIONS: Drawing measurement ${index + 1}/${localTakeoffMeasurements.length}`, {
            id: measurement.id,
            type: measurement.type,
            points: measurement.points,
            color: measurement.color
          });
          renderMeasurement(context, measurement);
        });
        
        // Draw local measurements (temporary)
        console.log('🎯 RENDER_ANNOTATIONS: Drawing local measurements', {
          count: measurements.length
        });
        measurements.forEach(measurement => {
          renderMeasurement(context, measurement);
        });
        
        // Draw current measurement
        if (currentMeasurement.length > 0) {
          console.log('🎯 RENDER_ANNOTATIONS: Drawing current measurement', {
            length: currentMeasurement.length,
            points: currentMeasurement,
            mousePosition
          });
          renderCurrentMeasurement(context);
        }
        
        // Draw calibration points
        if (isCalibrating && calibrationPoints.length > 0) {
          console.log('🎯 RENDER_ANNOTATIONS: Drawing calibration points', {
            count: calibrationPoints.length
          });
          renderCalibrationPoints(context);
        }
        
        // Draw search highlights
        if (searchHighlights[currentPage] && searchHighlights[currentPage].length > 0) {
          console.log('🎯 RENDER_ANNOTATIONS: Drawing search highlights', {
            count: searchHighlights[currentPage].length
          });
          renderSearchHighlights(context);
        }
        
        console.log('✅ RENDER_ANNOTATIONS: All annotations drawn');
      }).catch((error: any) => {
        if (error.name !== 'RenderingCancelledException') {
          console.error('❌ RENDER_ANNOTATIONS: Error in PDF render promise:', error);
        }
      });
      
      context.restore();
    }
  }, [localTakeoffMeasurements, measurements, currentMeasurement, measurementType, isCalibrating, calibrationPoints, mousePosition]);

  // Clean measurement rendering
  const renderMeasurement = (context: CanvasRenderingContext2D, measurement: Measurement) => {
    console.log('🎨 RENDER_MEASUREMENT: Drawing measurement', {
      id: measurement.id,
      type: measurement.type,
      points: measurement.points,
      color: measurement.color,
      calculatedValue: measurement.calculatedValue,
      unit: measurement.unit
    });
    
    const points = measurement.points;
    if (points.length < 2) {
      console.log('❌ RENDER_MEASUREMENT: Not enough points', { pointsLength: points.length });
      return;
    }
    
    if (!viewportRef.current) {
      console.log('❌ RENDER_MEASUREMENT: No viewport available');
      return;
    }
    
    const viewport = viewportRef.current;
    
    context.save();
    context.strokeStyle = measurement.color;
    context.fillStyle = measurement.color + '40';
    context.lineWidth = 2;
    
    console.log('🎨 RENDER_MEASUREMENT: Canvas context set', {
      strokeStyle: measurement.color,
      fillStyle: measurement.color + '40',
      lineWidth: 2,
      viewport: { width: viewport.width, height: viewport.height }
    });
    
    switch (measurement.type) {
      case 'linear':
        context.beginPath();
        
        // Convert PDF-relative coordinates to canvas coordinates
        const startCanvasX = points[0].x * viewport.width;
        const startCanvasY = points[0].y * viewport.height;
        context.moveTo(startCanvasX, startCanvasY);
        
        for (let i = 1; i < points.length; i++) {
          const canvasX = points[i].x * viewport.width;
          const canvasY = points[i].y * viewport.height;
          context.lineTo(canvasX, canvasY);
        }
        context.stroke();
        
        console.log('🎨 RENDER_MEASUREMENT: Linear line drawn', {
          points: points.map(p => ({ pdf: p, canvas: { x: p.x * viewport.width, y: p.y * viewport.height } }))
        });
        
        // Draw measurement text
        const midPoint = {
          x: (points[0].x + points[points.length - 1].x) / 2 * viewport.width,
          y: (points[0].y + points[points.length - 1].y) / 2 * viewport.height
        };
        context.fillStyle = measurement.color;
        context.font = '12px Arial';
        context.fillText(`${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`, midPoint.x, midPoint.y - 5);
        break;
        
      case 'area':
        if (points.length >= 3) {
          context.beginPath();
          const startCanvasX = points[0].x * viewport.width;
          const startCanvasY = points[0].y * viewport.height;
          context.moveTo(startCanvasX, startCanvasY);
          
          for (let i = 1; i < points.length; i++) {
            const canvasX = points[i].x * viewport.width;
            const canvasY = points[i].y * viewport.height;
            context.lineTo(canvasX, canvasY);
          }
          context.closePath();
          context.fill();
          context.stroke();
          
          // Draw area text
          const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length * viewport.width;
          const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length * viewport.height;
          context.fillStyle = measurement.color;
          context.font = '12px Arial';
          context.fillText(`${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`, centerX, centerY);
        }
        break;
        
      case 'count':
        const point = points[0];
        context.beginPath();
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
  const renderCurrentMeasurement = (context: CanvasRenderingContext2D) => {
    console.log('renderCurrentMeasurement called:', { 
      currentMeasurementLength: currentMeasurement.length, 
      mousePosition, 
      measurementType 
    });
    
    if (currentMeasurement.length === 0) return;
    
    if (!viewportRef.current) {
      console.log('No viewport available for rendering');
      return;
    }
    
    const viewport = viewportRef.current;
    
    context.save();
    
    switch (measurementType) {
      case 'linear':
        console.log('Drawing linear measurement:', { 
          currentMeasurement, 
          length: currentMeasurement.length 
        });
        
        // Draw existing line segments with bright magenta color
        if (currentMeasurement.length >= 2) {
          console.log('Drawing line between points:', currentMeasurement[0], currentMeasurement[1]);
          context.strokeStyle = 'magenta';
          context.lineWidth = 4;
          context.setLineDash([]); // Solid lines for existing segments
          context.beginPath();
          
          // Convert PDF-relative coordinates to canvas coordinates
          const startCanvasX = currentMeasurement[0].x * viewport.width;
          const startCanvasY = currentMeasurement[0].y * viewport.height;
          context.moveTo(startCanvasX, startCanvasY);
          
          for (let i = 1; i < currentMeasurement.length; i++) {
            const canvasX = currentMeasurement[i].x * viewport.width;
            const canvasY = currentMeasurement[i].y * viewport.height;
            context.lineTo(canvasX, canvasY);
          }
          context.stroke();
          console.log('Line drawn');
        }
        
        // Draw preview line from last point to mouse position
        if (currentMeasurement.length > 0 && mousePosition) {
          const lastPoint = currentMeasurement[currentMeasurement.length - 1];
          
          // Convert PDF-relative coordinates to canvas coordinates
          const lastCanvasX = lastPoint.x * viewport.width;
          const lastCanvasY = lastPoint.y * viewport.height;
          const mouseCanvasX = mousePosition.x * viewport.width;
          const mouseCanvasY = mousePosition.y * viewport.height;
          
          console.log('Drawing preview line:', { 
            lastPoint: { x: lastCanvasX, y: lastCanvasY }, 
            mousePosition: { x: mouseCanvasX, y: mouseCanvasY } 
          });
          
          context.strokeStyle = 'lime';
          context.lineWidth = 3;
          context.setLineDash([8, 4]); // Dashed line for preview
          context.beginPath();
          context.moveTo(lastCanvasX, lastCanvasY);
          context.lineTo(mouseCanvasX, mouseCanvasY);
          context.stroke();
          console.log('Preview line drawn');
        } else {
          console.log('Not drawing preview line:', { 
            currentMeasurementLength: currentMeasurement.length, 
            mousePosition 
          });
        }
        
        // Draw crosshair at mouse position for better visual feedback
        if (mousePosition) {
          const mouseCanvasX = mousePosition.x * viewport.width;
          const mouseCanvasY = mousePosition.y * viewport.height;
          
          context.strokeStyle = 'rgba(255, 255, 255, 0.8)';
          context.lineWidth = 1;
          context.setLineDash([]);
          
          // Draw crosshair
          const crosshairSize = 20;
          context.beginPath();
          context.moveTo(mouseCanvasX - crosshairSize, mouseCanvasY);
          context.lineTo(mouseCanvasX + crosshairSize, mouseCanvasY);
          context.moveTo(mouseCanvasX, mouseCanvasY - crosshairSize);
          context.lineTo(mouseCanvasX, mouseCanvasY + crosshairSize);
          context.stroke();
          
          // Draw center dot
          context.fillStyle = 'rgba(255, 255, 255, 0.9)';
          context.beginPath();
          context.arc(mouseCanvasX, mouseCanvasY, 2, 0, 2 * Math.PI);
          context.fill();
        }
        break;
      case 'area':
        if (currentMeasurement.length >= 3) {
          context.beginPath();
          const startCanvasX = currentMeasurement[0].x * viewport.width;
          const startCanvasY = currentMeasurement[0].y * viewport.height;
          context.moveTo(startCanvasX, startCanvasY);
          
          for (let i = 1; i < currentMeasurement.length; i++) {
            const canvasX = currentMeasurement[i].x * viewport.width;
            const canvasY = currentMeasurement[i].y * viewport.height;
            context.lineTo(canvasX, canvasY);
          }
          context.closePath();
          context.fill();
          context.stroke();
        }
        break;
      case 'count':
        if (currentMeasurement.length >= 1) {
          const point = currentMeasurement[0];
          const canvasX = point.x * viewport.width;
          const canvasY = point.y * viewport.height;
          context.beginPath();
          context.arc(canvasX, canvasY, 10, 0, 2 * Math.PI);
          context.fill();
          context.stroke();
        }
        break;
    }
    
    context.restore();
  };

  // Render calibration points
  const renderCalibrationPoints = (context: CanvasRenderingContext2D) => {
    context.save();
    context.strokeStyle = '#ff0000';
    context.fillStyle = '#ff0000';
    context.lineWidth = 3;
    
    calibrationPoints.forEach((point, index) => {
      // Draw point
      context.beginPath();
      context.arc(point.x, point.y, 8, 0, 2 * Math.PI);
      context.fill();
      
      // Draw point number
      context.fillStyle = 'white';
      context.font = 'bold 12px Arial';
      context.textAlign = 'center';
      context.fillText((index + 1).toString(), point.x, point.y + 4);
      context.fillStyle = '#ff0000';
    });
    
    // Draw line between points if we have 2
    if (calibrationPoints.length === 2) {
      context.beginPath();
      context.moveTo(calibrationPoints[0].x, calibrationPoints[0].y);
      context.lineTo(calibrationPoints[1].x, calibrationPoints[1].y);
      context.stroke();
      
      // Draw distance text
      const midX = (calibrationPoints[0].x + calibrationPoints[1].x) / 2;
      const midY = (calibrationPoints[0].y + calibrationPoints[1].y) / 2;
      const distance = calculateDistance(calibrationPoints[0], calibrationPoints[1]);
      
      context.fillStyle = '#ff0000';
      context.font = 'bold 14px Arial';
      context.fillText(`${distance.toFixed(1)} px`, midX, midY - 10);
    }
    
    context.restore();
  };

  // Render search highlights
  const renderSearchHighlights = (context: CanvasRenderingContext2D) => {
    if (!viewportRef.current || !searchHighlights[currentPage]) return;
    
    const viewport = viewportRef.current;
    const highlights = searchHighlights[currentPage];
    
    context.save();
    context.fillStyle = 'rgba(255, 255, 0, 0.3)'; // Semi-transparent yellow
    context.strokeStyle = '#ffd700'; // Gold border
    context.lineWidth = 2;
    
    highlights.forEach((highlight, index) => {
      // Convert PDF-relative coordinates to canvas coordinates
      const x = highlight.x * viewport.width;
      const y = highlight.y * viewport.height;
      const width = highlight.width * viewport.width;
      const height = highlight.height * viewport.height;
      
      // Draw highlight rectangle
      context.fillRect(x, y, width, height);
      context.strokeRect(x, y, width, height);
      
      // Draw highlight number
      context.fillStyle = '#ffd700';
      context.font = 'bold 12px Arial';
      context.textAlign = 'center';
      context.fillText((index + 1).toString(), x + width/2, y + height/2 + 4);
      context.fillStyle = 'rgba(255, 255, 0, 0.3)';
    });
    
    context.restore();
  };

  // Handle mouse move for preview rendering
  const handleCanvasMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    console.log('🖱️ MOUSE_MOVE: Mouse move on canvas', { 
      isMeasuring, 
      currentMeasurementLength: currentMeasurement.length,
      selectedConditionId,
      measurementType
    });
    
    if (!isMeasuring) {
      console.log('🖱️ MOUSE_MOVE: Not measuring, ignoring');
      return;
    }
    
    const canvas = canvasRef.current;
    if (!canvas || !viewportRef.current) {
      console.log('❌ MOUSE_MOVE: Missing canvas or viewport');
      return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    
    // Convert canvas coordinates to PDF-relative coordinates (0-1 scale)
    const viewport = viewportRef.current;
    const pdfX = canvasX / viewport.width;
    const pdfY = canvasY / viewport.height;
    
    console.log('🖱️ MOUSE_MOVE: Setting mouse position', { 
      canvasCoords: { x: canvasX, y: canvasY }, 
      pdfCoords: { x: pdfX, y: pdfY },
      viewport: { width: viewport.width, height: viewport.height }
    });
    
    setMousePosition({ x: pdfX, y: pdfY });
  }, [isMeasuring, currentMeasurement.length, selectedConditionId, measurementType]);

  // Handle canvas click for measurements and calibration
  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    console.log('🖱️ CLICK: Canvas clicked!', { 
      event, 
      isMeasuring, 
      selectedConditionId,
      measurementType,
      currentMeasurementLength: currentMeasurement.length
    });
    
    const canvas = canvasRef.current;
    if (!canvas) {
      console.log('❌ CLICK: No canvas ref found');
      return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    console.log('🖱️ CLICK: Click coordinates', { 
      x, 
      y, 
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      }
    });
    
    // Handle calibration clicks
    if (isCalibrating) {
      setCalibrationPoints(prev => {
        const newPoints = [...prev, { x, y }];
        
        // If we have 2 points, complete calibration
        if (newPoints.length === 2) {
          completeCalibration(newPoints);
        }
        
        return newPoints;
      });
      return;
    }
    
    // Handle measurement clicks
    if (!isMeasuring || !selectedConditionId) {
      console.log('❌ CLICK: Not measuring or no condition selected', { isMeasuring, selectedConditionId });
      return;
    }
    
    // Convert canvas coordinates to PDF-relative coordinates (0-1 scale)
    if (!viewportRef.current) {
      console.log('❌ CLICK: No viewport available for coordinate conversion');
      return;
    }
    
    const viewport = viewportRef.current;
    const pdfX = x / viewport.width;
    const pdfY = y / viewport.height;
    
    console.log('🖱️ CLICK: Adding measurement point', { 
      canvasCoords: { x, y }, 
      pdfCoords: { x: pdfX, y: pdfY },
      measurementType, 
      currentMeasurementLength: currentMeasurement.length,
      viewport: { width: viewport.width, height: viewport.height }
    });
    
    setCurrentMeasurement(prev => {
      const newMeasurement = [...prev, { x: pdfX, y: pdfY }];
      console.log('✅ CLICK: New measurement points (PDF-relative)', newMeasurement);
      return newMeasurement;
    });
    
    // Complete measurement based on type
    if (measurementType === 'count') {
      completeMeasurement([{ x: pdfX, y: pdfY }]);
    }
  }, [isMeasuring, isCalibrating, selectedConditionId, measurementType, currentMeasurement]);

  // Complete current measurement
  const completeMeasurement = useCallback((points: { x: number; y: number }[]) => {
    console.log('✅ COMPLETE_MEASUREMENT: Starting completion', {
      selectedConditionId,
      pointsLength: points.length,
      points,
      measurementType
    });
    
    if (!selectedConditionId || points.length === 0) {
      console.log('❌ COMPLETE_MEASUREMENT: Missing condition or points', { selectedConditionId, pointsLength: points.length });
      return;
    }
    
    const selectedCondition = getSelectedCondition();
    if (!selectedCondition) {
      console.log('❌ COMPLETE_MEASUREMENT: No selected condition found');
      return;
    }
    
    console.log('✅ COMPLETE_MEASUREMENT: Selected condition found', {
      id: selectedCondition.id,
      name: selectedCondition.name,
      unit: selectedCondition.unit,
      color: selectedCondition.color
    });
    
    let calculatedValue = 0;
    let unit = selectedCondition.unit;
    
    // Calculate value based on type
    // Convert PDF-relative coordinates to canvas coordinates for calculation
    if (!viewportRef.current) {
      console.log('No viewport available for calculation');
      return;
    }
    
    const viewport = viewportRef.current;
    const canvasPoints = points.map(point => ({
      x: point.x * viewport.width,
      y: point.y * viewport.height
    }));
    
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
    
    // Create measurement object for local state (use PDF-relative coordinates for consistency)
    const measurement: Measurement = {
      id: Date.now().toString(),
      type: measurementType,
      points: points, // Use PDF-relative coordinates for consistency
      calculatedValue,
      unit,
      conditionId: selectedConditionId,
      color: selectedCondition.color,
      conditionName: selectedCondition.name
    };
    
    // Add to local state
    setMeasurements(prev => [...prev, measurement]);
    
    // Add to store
    if (currentProjectId) {
      addTakeoffMeasurement({
        projectId: currentProjectId,
        sheetId: file.id || 'default',
        conditionId: selectedConditionId,
        type: measurementType,
        points: canvasPoints, // Canvas coordinates for backward compatibility
        calculatedValue,
        unit,
        pdfPage: currentPage,
        pdfCoordinates: points, // Store PDF-relative coordinates (already in 0-1 scale)
        conditionColor: selectedCondition.color,
        conditionName: selectedCondition.name
      });
    }
    
    // Clear current measurement and mouse position
    setCurrentMeasurement([]);
    setMousePosition(null);
    
    // Refresh takeoff measurements to show the new one
    loadTakeoffMeasurements();
  }, [selectedConditionId, getSelectedCondition, measurementType, scaleFactor, currentProjectId, addTakeoffMeasurement, currentPage, file.id, loadTakeoffMeasurements, canvasToPdfCoords]);

  // Complete calibration
  const completeCalibration = useCallback((points: { x: number; y: number }[]) => {
    if (points.length !== 2 || !calibrationData) return;
    
    const pixelDistance = calculateDistance(points[0], points[1]);
    const knownDistance = calibrationData.knownDistance;
    const unit = calibrationData.unit;
    
    // Calculate scale factor (pixels per unit)
    const newScaleFactor = pixelDistance / knownDistance;
    
    setScaleFactor(newScaleFactor);
    setUnit(unit);
    setIsPageCalibrated(true);
    setPendingScaleData({ scaleFactor: newScaleFactor, unit });
    setShowScaleApplicationDialog(true);
    
    // Notify parent component of calibration completion
    if (onCalibrationComplete) {
      onCalibrationComplete(true, newScaleFactor, unit);
    }
    
    // Clear calibration state
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
    
    setScaleFactor(pendingScaleData.scaleFactor);
    setUnit(pendingScaleData.unit);
    setIsPageCalibrated(true);
    
    setPendingScaleData(null);
    setShowScaleApplicationDialog(false);
  }, [pendingScaleData]);

  // Handle double-click to complete measurement
  const handleCanvasDoubleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (measurementType === 'count') return;
    
    if (currentMeasurement.length >= (measurementType === 'linear' ? 2 : 3)) {
      completeMeasurement(currentMeasurement);
    }
  }, [measurementType, currentMeasurement, completeMeasurement]);

  // Handle wheel events for zoom
  const handleWheel = useCallback((event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      
      const ZOOM_STEP = 1.1;
      const MIN_SCALE = 0.5;
      const MAX_SCALE = 5;
      
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, 
        viewState.scale * (event.deltaY < 0 ? ZOOM_STEP : 1/ZOOM_STEP)
      ));
      
      if (newScale !== viewState.scale) {
        // Use external scale change handler if available, otherwise update internal state
        if (onScaleChange) {
          onScaleChange(newScale);
        } else {
          setInternalViewState(prev => ({ ...prev, scale: newScale }));
        }
      }
    }
    // If not Ctrl/Cmd, let the container handle normal scrolling
  }, [viewState.scale, onScaleChange]);

  // Add wheel event listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Also add wheel event listener to canvas for zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleCanvasWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        handleWheel(event);
      }
    };

    canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleCanvasWheel);
  }, [handleWheel, pdfDocument]); // Re-add when PDF loads

  // Re-render when page changes
  useEffect(() => {
    if (pdfDocument) {
      renderPage(currentPage);
      // Load takeoff measurements for the new page
      loadTakeoffMeasurements();
    }
  }, [pdfDocument, currentPage, renderPage, loadTakeoffMeasurements]);

  // Re-render when view state changes
  useEffect(() => {
    console.log('🔄 VIEW_STATE_CHANGE: View state changed', {
      viewState,
      currentPage,
      pdfDocumentAvailable: !!pdfDocument,
      viewportAvailable: !!viewportRef.current,
      viewport: viewportRef.current ? { width: viewportRef.current.width, height: viewportRef.current.height } : null
    });
    
    if (pdfDocument) {
      renderPage(currentPage);
      // Note: loadTakeoffMeasurements is now called from renderPage after PDF render completes
    }
  }, [viewState, renderPage, currentPage, loadTakeoffMeasurements]);

  // Re-render annotations when measurement state changes (for live drawing)
  useEffect(() => {
    console.log('🔄 LIVE_RENDER: Triggering render due to state change', {
      currentMeasurementLength: currentMeasurement.length,
      mousePosition,
      isMeasuring,
      measurementType
    });
    
    if (pdfDocument && (isMeasuring || currentMeasurement.length > 0)) {
      renderAnnotations();
    }
  }, [currentMeasurement, mousePosition, isMeasuring, measurementType, pdfDocument, renderAnnotations]);

  // Start measuring when condition is selected
  useEffect(() => {
    console.log('Condition selection changed:', { selectedConditionId });
    if (selectedConditionId) {
      setIsMeasuring(true);
      const condition = getSelectedCondition();
      console.log('Selected condition:', condition);
      if (condition) {
        if (condition.unit === 'EA' || condition.unit === 'each') {
          setMeasurementType('count');
        } else if (condition.unit === 'SF' || condition.unit === 'sq ft') {
          setMeasurementType('area');
        } else if (condition.unit === 'CY' || condition.unit === 'cu yd') {
          setMeasurementType('volume');
        } else {
          setMeasurementType('linear');
        }
        console.log('Set measurement type to:', condition.unit === 'EA' || condition.unit === 'each' ? 'count' : 
                   condition.unit === 'SF' || condition.unit === 'sq ft' ? 'area' :
                   condition.unit === 'CY' || condition.unit === 'cu yd' ? 'volume' : 'linear');
      }
    } else {
      setIsMeasuring(false);
      setCurrentMeasurement([]);
      setMousePosition(null);
    }
  }, [selectedConditionId, getSelectedCondition]);

  // Debug current state
  useEffect(() => {
    console.log('Current measurement state:', { 
      isMeasuring, 
      selectedConditionId, 
      measurementType, 
      currentMeasurement: currentMeasurement.length,
      mousePosition 
    });
  }, [isMeasuring, selectedConditionId, measurementType, currentMeasurement.length, mousePosition]);

  // Debug canvas setup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      console.log('Canvas setup:', {
        width: canvas.width,
        height: canvas.height,
        styleWidth: canvas.style.width,
        styleHeight: canvas.style.height,
        offsetWidth: canvas.offsetWidth,
        offsetHeight: canvas.offsetHeight,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        getBoundingClientRect: canvas.getBoundingClientRect()
      });
    } else {
      console.log('Canvas ref is null');
    }
  }, [pdfDocument, currentPage]);

  // Listen for calibration requests from parent component
  useEffect(() => {
    if (onCalibrationRequest) {
      // Set up a way for the parent to trigger calibration
      // We'll use a custom event or callback mechanism
      const handleCalibrationRequest = () => {
        console.log('Calibration requested from parent component');
        setShowCalibrationDialog(true);
      };
      
      // Store the handler so parent can call it
      (window as any).triggerCalibration = handleCalibrationRequest;
      
      return () => {
        delete (window as any).triggerCalibration;
      };
    }
  }, [onCalibrationRequest]);

  // Set up Clear All trigger for parent component
  useEffect(() => {
    const handleClearAllRequest = () => {
      console.log('Clear all requested from parent component');
      clearAllTakeoffMeasurements();
    };
    
    // Store the handler so parent can call it
    (window as any).triggerClearAll = handleClearAllRequest;
    
    return () => {
      delete (window as any).triggerClearAll;
    };
  }, [clearAllTakeoffMeasurements]);

  // Calculate distance between two points
  const calculateDistance = (point1: { x: number; y: number }, point2: { x: number; y: number }) => {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Calculate scale to fit PDF in container
  const calculateFitToWindowScale = useCallback(() => {
    if (!pdfDocument || !containerRef.current) return 1;
    
    const container = containerRef.current;
    const containerWidth = container.clientWidth - 32; // Account for padding
    const containerHeight = container.clientHeight - 32; // Account for padding
    
    // Get the current page to calculate its dimensions
    pdfDocument.getPage(currentPage).then((page: any) => {
      const viewport = page.getViewport({ scale: 1 });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;
      
      // Calculate scale to fit both width and height
      const scaleX = containerWidth / pageWidth;
      const scaleY = containerHeight / pageHeight;
      const fitScale = Math.min(scaleX, scaleY);
      
      // Apply the fit scale, but keep it within reasonable bounds
      const finalScale = Math.max(0.1, Math.min(5, fitScale));
      
      // Use external scale change handler if available, otherwise update internal state
      if (onScaleChange) {
        onScaleChange(finalScale);
      } else {
        setInternalViewState(prev => ({ ...prev, scale: finalScale }));
      }
    }).catch((error: any) => {
      console.error('Error calculating fit scale:', error);
    });
  }, [pdfDocument, currentPage, onScaleChange]);

  // Set up Fit to Window trigger for parent component
  useEffect(() => {
    const handleFitToWindowRequest = () => {
      console.log('Fit to window requested from parent component');
      calculateFitToWindowScale();
    };
    
    // Store the handler so parent can call it
    (window as any).triggerFitToWindow = handleFitToWindowRequest;
    
    return () => {
      delete (window as any).triggerFitToWindow;
    };
  }, [calculateFitToWindowScale]);

  // Navigation functions
  const goToPreviousPage = () => {
    if (currentPage > 1) {
      if (onPageChange) {
        onPageChange(currentPage - 1);
      } else {
        setInternalCurrentPage(prev => prev - 1);
      }
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      if (onPageChange) {
        onPageChange(currentPage + 1);
      } else {
        setInternalCurrentPage(prev => prev + 1);
      }
    }
  };

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
        <p className="text-gray-600">No PDF loaded</p>
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
            `Measuring: ${measurementType} - Click to add points, double-click to complete`
          )}
        </div>
      )}

      {/* Canvas Container - Scrollable PDF viewing area */}
      <div 
        ref={containerRef}
        className="canvas-container flex-1 h-full overflow-auto"
        style={{ 
          cursor: isMeasuring ? 'crosshair' : (isCalibrating ? 'crosshair' : 'default')
        }}
      >
        <div className="flex items-start justify-start min-h-full p-4">
          <canvas
            ref={canvasRef}
            className="shadow-lg"
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
            onMouseMove={handleCanvasMouseMove}
            onMouseEnter={() => console.log('Mouse entered canvas')}
            onMouseLeave={() => console.log('Mouse left canvas')}
            style={{ 
              cursor: isMeasuring ? 'crosshair' : 'default',
              position: 'relative',
              zIndex: 1,
              pointerEvents: 'auto'
            }}
          />
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

export default CleanPDFViewer;
