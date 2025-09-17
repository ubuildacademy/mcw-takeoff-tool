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
console.log('🔧 PDF_WORKER: Worker configured with path:', pdfjsLib.GlobalWorkerOptions.workerSrc);

// SearchResult interface imported from shared types

interface PDFViewerProps {
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
  perimeterValue?: number; // Perimeter in linear feet for area measurements
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
  
  // View state - single source of truth
  const [internalViewState, setInternalViewState] = useState({ 
    scale: 1, 
    rotation: 0
  });
  
  // Track viewport dimensions for coordinate conversion dependencies
  const [viewportDimensions, setViewportDimensions] = useState<{width: number, height: number} | null>(null);
  
  // Page-specific canvas system - each page gets its own canvas for takeoffs
  const [pageCanvases, setPageCanvases] = useState<Map<number, HTMLCanvasElement>>(new Map());
  const [currentPageCanvas, setCurrentPageCanvas] = useState<HTMLCanvasElement | null>(null);

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
  
  // Scale calibration - use external props when available, fall back to internal state
  const [internalScaleFactor, setInternalScaleFactor] = useState(1);
  const [internalIsPageCalibrated, setInternalIsPageCalibrated] = useState(false);
  const [internalUnit, setInternalUnit] = useState('ft');
  
  // Use external calibration data when available
  const scaleFactor = externalScaleFactor ?? internalScaleFactor;
  const isPageCalibrated = externalIsPageCalibrated ?? internalIsPageCalibrated;
  const unit = externalUnit ?? internalUnit;
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
    getSelectedCondition,
    takeoffMeasurements
  } = useTakeoffStore();

  // Load existing takeoff measurements for the current sheet
  const [localTakeoffMeasurements, setLocalTakeoffMeasurements] = useState<any[]>([]);
  
  // OCR data for search highlighting
  const [ocrData, setOcrData] = useState<{[pageNumber: number]: any}>({});
  const [searchHighlights, setSearchHighlights] = useState<{[pageNumber: number]: any[]}>({});

  // Convert PDF coordinates to canvas coordinates
  const pdfToCanvasCoords = useCallback((pdfCoords: { x: number; y: number }[]) => {
    if (!viewportRef.current || !viewportDimensions) {
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
      currentPage,
      timestamp: new Date().toISOString()
    });
    
    return canvasCoords;
  }, [currentPage, viewportDimensions?.width, viewportDimensions?.height]);

  // Convert canvas coordinates to PDF coordinates (0-1 scale)
  const canvasToPdfCoords = useCallback((canvasCoords: { x: number; y: number }[]) => {
    if (!viewportRef.current || !viewportDimensions) {
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
  }, [viewportDimensions?.width, viewportDimensions?.height]);



  // Clear all takeoff measurements for current project
  const clearAllTakeoffMeasurements = useCallback(() => {
    if (!currentProjectId || !file?.id) return;
    
    // Clear measurements for current page (local state only - API data remains)
    setLocalTakeoffMeasurements([]);
    setMeasurements([]);
    setCurrentMeasurement([]);
    setMousePosition(null);
    
    // Force re-render of the current page to show cleared state
    setTimeout(() => {
      if (pdfDocument && currentPage) {
        renderPage(currentPage);
      }
    }, 100);
    
    console.log('All takeoff measurements cleared for current page');
  }, [currentProjectId, file?.id, currentPage]);

  // Load PDF document
  useEffect(() => {
    const loadPDF = async () => {
      console.log('🔄 PDF_LOAD: Starting PDF load', { file, fileType: typeof file, fileId: file?.id });
      
      if (!file) {
        console.log('❌ PDF_LOAD: No file provided');
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
        
        console.log('📄 PDF_LOAD: Loading PDF from URL', { pdfUrl, fileId: file?.id });
        const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
        console.log('✅ PDF_LOAD: PDF loaded successfully', { numPages: pdf.numPages, fileId: file?.id });
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
        
      } catch (error: any) {
        console.error('❌ PDF_LOAD: Error loading PDF:', error);
        console.error('❌ PDF_LOAD: Error details:', { 
          message: error?.message, 
          stack: error?.stack,
          pdfUrl: pdfUrl,
          fileId: file?.id 
        });
        setError('Failed to load PDF file');
      } finally {
        setIsLoading(false);
      }
    };

    loadPDF();
  }, [file]);

  // Project conditions are loaded by the parent TakeoffWorkspace component

  // Load measurements from API only
  useEffect(() => {
    if (!currentProjectId || !file?.id || !currentPage) {
      setLocalTakeoffMeasurements([]);
      return;
    }
    
    // Load measurements from API only
    const { getPageTakeoffMeasurements } = useTakeoffStore.getState();
    const apiMeasurements = getPageTakeoffMeasurements(currentProjectId, file.id, currentPage);
    
    console.log('🔄 LOADING_MEASUREMENTS: Loading from API only', {
      projectId: currentProjectId,
      fileId: file.id,
      currentPage,
      apiCount: apiMeasurements.length,
      apiMeasurements: apiMeasurements.map(m => ({
        id: m.id,
        type: m.type,
        pdfPage: m.pdfPage,
        conditionId: m.conditionId,
        conditionName: m.conditionName
      }))
    });
    
    // Debug: Check if measurements are being filtered correctly
    console.log('🔍 PAGE_FILTER_DEBUG: Checking page filtering', {
      currentPage,
      allMeasurements: useTakeoffStore.getState().takeoffMeasurements.map(m => ({ 
        id: m.id, 
        pdfPage: m.pdfPage, 
        projectId: m.projectId, 
        sheetId: m.sheetId 
      })),
      filteredMeasurements: apiMeasurements.map(m => ({ 
        id: m.id, 
        pdfPage: m.pdfPage 
      }))
    });
    
    // Convert API measurements to display format
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
    
    console.log('✅ LOADING_MEASUREMENTS: Setting local measurements', {
      currentPage,
      displayCount: displayMeasurements.length,
      displayMeasurements: displayMeasurements.map(m => ({
        id: m.id,
        type: m.type,
        pdfPage: m.pdfPage,
        points: m.points
      }))
    });
    
    setLocalTakeoffMeasurements(displayMeasurements);
    
    // Force a re-render to ensure measurements are displayed
    setTimeout(() => {
      if (displayMeasurements.length > 0) {
        console.log('🔄 FORCE_RERENDER: Triggering re-render after measurements loaded', {
          currentPage,
          measurementCount: displayMeasurements.length
        });
      } else {
        console.log('🔄 FORCE_RERENDER: No measurements found, clearing canvas', {
          currentPage
        });
      }
      renderAnnotations(false); // Re-render annotations without PDF background
    }, 100);
  }, [currentProjectId, file?.id, currentPage, takeoffMeasurements]);

  // Note: Measurements are cleared and loaded in the main useEffect above

  // Clear measurements when file changes to prevent cross-file rendering
  useEffect(() => {
    console.log('🔄 FILE_CHANGE_CLEAR: File changed', { fileId: file?.id });
    // Clear measurements when switching to a different file
    setLocalTakeoffMeasurements([]);
  }, [file?.id]);

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

  // Load calibration data when external props change
  useEffect(() => {
    console.log('🔄 CALIBRATION_LOAD: External calibration props changed', {
      externalScaleFactor,
      externalIsPageCalibrated,
      externalUnit,
      currentPage,
      fileId: file?.id
    });
    
    // If external calibration data is provided, use it
    if (externalScaleFactor !== undefined && externalIsPageCalibrated !== undefined && externalUnit !== undefined) {
      console.log('✅ CALIBRATION_LOAD: Using external calibration data', {
        scaleFactor: externalScaleFactor,
        isPageCalibrated: externalIsPageCalibrated,
        unit: externalUnit
      });
    } else {
      console.log('⚠️ CALIBRATION_LOAD: No external calibration data, using internal state');
    }
  }, [externalScaleFactor, externalIsPageCalibrated, externalUnit, currentPage, file?.id]);

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
      
      console.log('🔄 VIEWPORT_CHANGE: Viewport updated', {
        currentPage,
        oldViewport: viewportRef.current ? {
          width: viewportRef.current.width,
          height: viewportRef.current.height
        } : null,
        newViewport: {
          width: viewport.width,
          height: viewport.height
        },
        finalScale,
        viewState
      });
      
      viewportRef.current = viewport;
      
      // Update viewport dimensions state to trigger coordinate conversion function updates
      setViewportDimensions({
        width: viewport.width,
        height: viewport.height
      });
      
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
      
      // Re-render annotations with PDF background
      renderAnnotations(true);
      
      // Note: takeoff measurements are now loaded in the page change effect with proper timing
      
    } catch (error: any) {
      if (error.name !== 'RenderingCancelledException') {
        console.error('Error rendering page:', error);
      }
    } finally {
      isRenderingRef.current = false;
    }
  }, [pdfDocument, viewState]);

  // Get or create a canvas for a specific page
  const getOrCreatePageCanvas = useCallback((pageNumber: number, width: number, height: number): HTMLCanvasElement => {
    const existingCanvas = pageCanvases.get(pageNumber);
    if (existingCanvas) {
      // Update dimensions if they've changed
      if (existingCanvas.width !== width || existingCanvas.height !== height) {
        existingCanvas.width = width;
        existingCanvas.height = height;
      }
      return existingCanvas;
    }

    // Create new canvas for this page
    const newCanvas = document.createElement('canvas');
    newCanvas.width = width;
    newCanvas.height = height;
    newCanvas.style.position = 'absolute';
    newCanvas.style.top = '0';
    newCanvas.style.left = '0';
    newCanvas.style.pointerEvents = 'auto';
    newCanvas.style.zIndex = '10';
    
    // Store the canvas
    setPageCanvases(prev => new Map(prev).set(pageNumber, newCanvas));
    
    console.log(`🎨 PAGE_CANVAS_CREATED: Created canvas for page ${pageNumber}`, { width, height });
    return newCanvas;
  }, [pageCanvases]);

  // Optimized annotation rendering - only re-render PDF when necessary
  const renderAnnotations = useCallback((forcePdfRerender = false) => {
    if (!canvasRef.current || !viewportRef.current) {
      return;
    }
    
    // Prevent concurrent renders
    if (isRenderingRef.current) {
      console.log('🔄 RENDER_ANNOTATIONS: Skipping render - already rendering');
      return;
    }
    
    isRenderingRef.current = true;
    
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) {
      isRenderingRef.current = false;
      return;
    }
    
    // Only log when there are measurements or when forced to re-render
    if (localTakeoffMeasurements.length > 0 || forcePdfRerender) {
      console.log('🎨 RENDER_ANNOTATIONS: Starting render', {
        currentPage,
        localTakeoffCount: localTakeoffMeasurements.length,
        measurementsCount: measurements.length,
        forcePdfRerender
      });
    }
    
    const renderAnnotationsOnly = () => {
      // Draw takeoff measurements (persisted) - only for current page
      if (localTakeoffMeasurements.length > 0) {
        console.log('🎨 RENDER_ANNOTATIONS: Processing measurements', {
          currentPage,
          totalMeasurements: localTakeoffMeasurements.length
        });
      }
      
      localTakeoffMeasurements.forEach((measurement) => {
        // Only render measurements that explicitly belong to the current page
        if (measurement.pdfPage === currentPage) {
          console.log('✅ RENDER_ANNOTATIONS: Rendering measurement on page', { 
            id: measurement.id, 
            type: measurement.type, 
            pdfPage: measurement.pdfPage, 
            currentPage 
          });
          renderMeasurement(context, measurement);
        } else {
          console.log('❌ RENDER_ANNOTATIONS: Skipping measurement on wrong page', { 
            id: measurement.id, 
            pdfPage: measurement.pdfPage, 
            currentPage 
          });
        }
      });
      
      // Draw current measurement being created (only if actively measuring and has enough points)
      if (currentMeasurement.length > 0 && isMeasuring) {
        // For linear measurements, need at least 2 points to draw a line
        // For area measurements, need at least 3 points to draw a polygon
        const minPoints = measurementType === 'linear' ? 2 : measurementType === 'area' ? 3 : 1;
        console.log('🔍 RENDER_CHECK: Checking if should render current measurement', {
          currentMeasurementLength: currentMeasurement.length,
          minPoints,
          measurementType,
          shouldRender: currentMeasurement.length >= minPoints
        });
        if (currentMeasurement.length >= minPoints) {
          renderCurrentMeasurement(context);
        } else {
          console.log('🚫 RENDER_CHECK: Skipping render - not enough points');
        }
      }
      
      // Draw calibration points
      if (isCalibrating && calibrationPoints.length > 0) {
        renderCalibrationPoints(context);
      }
      
      // Draw search highlights
      if (searchHighlights[currentPage] && searchHighlights[currentPage].length > 0) {
        renderSearchHighlights(context);
      }
    };
    
    // Only re-render PDF background if forced or if this is the first render
    if (forcePdfRerender && pdfPageRef.current) {
      const viewport = viewportRef.current;
      const devicePixelRatio = window.devicePixelRatio || 1;
      
      context.save();
      context.scale(devicePixelRatio, devicePixelRatio);
      
      // Re-render PDF background
      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };
      
      // Cancel any existing render task to prevent canvas conflicts
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      
      const renderTask = pdfPageRef.current.render(renderContext);
      renderTaskRef.current = renderTask;
      
      // Wait for PDF render to complete, then draw annotations
      renderTask.promise.then(() => {
        renderAnnotationsOnly();
        context.restore();
      }).catch((error: any) => {
        if (error.name !== 'RenderingCancelledException') {
          console.error('❌ RENDER_ANNOTATIONS: Error in PDF render promise:', error);
        }
        // Reset rendering flag on error
        isRenderingRef.current = false;
        context.restore();
      });
    } else {
      // Just draw annotations on existing canvas
      renderAnnotationsOnly();
      isRenderingRef.current = false;
    }
  }, [localTakeoffMeasurements, measurements, currentMeasurement, measurementType, isCalibrating, calibrationPoints, mousePosition, currentPage]);


  // Clean measurement rendering with proper coordinate conversion
  const renderMeasurement = (context: CanvasRenderingContext2D, measurement: Measurement) => {
    const points = measurement.points;
    if (points.length < 2) {
      return;
    }
    
    if (!viewportRef.current) {
      return;
    }
    
    const viewport = viewportRef.current;
    
    context.save();
    context.lineWidth = 2;
    
    // Helper function to convert coordinates
    const convertCoords = (point: { x: number; y: number }) => {
      // Check if coordinates are already in canvas space (large values) or PDF-relative (0-1)
      if (point.x > 1 || point.y > 1) {
        // Already in canvas coordinates
        return { x: point.x, y: point.y };
      } else {
        // PDF-relative coordinates, convert to canvas
        return {
          x: point.x * viewport.width,
          y: point.y * viewport.height
        };
      }
    };
    
    switch (measurement.type) {
      case 'linear':
        context.beginPath();
        context.strokeStyle = measurement.color;
        
        // Convert first point
        const startPoint = convertCoords(points[0]);
        context.moveTo(startPoint.x, startPoint.y);
        
        // Draw line segments
        for (let i = 1; i < points.length; i++) {
          const point = convertCoords(points[i]);
          context.lineTo(point.x, point.y);
        }
        context.stroke();
        
        // Draw measurement text
        const midPoint = {
          x: (startPoint.x + convertCoords(points[points.length - 1]).x) / 2,
          y: (startPoint.y + convertCoords(points[points.length - 1]).y) / 2
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
          const startPoint = convertCoords(points[0]);
          context.moveTo(startPoint.x, startPoint.y);
          
          for (let i = 1; i < points.length; i++) {
            const point = convertCoords(points[i]);
            context.lineTo(point.x, point.y);
          }
          context.closePath();
          
          // Fill with semi-transparent color
          context.fillStyle = measurement.color + '40'; // Add 40 for 25% opacity
          context.fill();
          
          // Stroke with full opacity
          context.strokeStyle = measurement.color;
          context.lineWidth = 2;
          context.stroke();
          
          // Draw area text in center
          const centerX = points.reduce((sum, p) => {
            const converted = convertCoords(p);
            return sum + converted.x;
          }, 0) / points.length;
          const centerY = points.reduce((sum, p) => {
            const converted = convertCoords(p);
            return sum + converted.y;
          }, 0) / points.length;
          
          // Set text style
          context.fillStyle = measurement.color;
          context.font = 'bold 12px Arial';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          
          // For area measurements, show area first, then perimeter if available
          let displayValue: string;
          if (measurement.type === 'area') {
            const areaValue = `${measurement.calculatedValue.toFixed(0)} SF`;
            if (measurement.perimeterValue) {
              const perimeterValue = formatFeetAndInches(measurement.perimeterValue);
              displayValue = `${areaValue} / ${perimeterValue}`;
            } else {
              displayValue = areaValue;
            }
          } else {
            // For other measurement types, use the original logic
            displayValue = measurement.unit === 'ft' || measurement.unit === 'feet' 
              ? formatFeetAndInches(measurement.calculatedValue)
              : `${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`;
          }
          
          // Draw text with background for better visibility
          const textMetrics = context.measureText(displayValue);
          const textWidth = textMetrics.width;
          const textHeight = 16;
          const padding = 4;
          
          // Draw background rectangle
          context.fillStyle = 'rgba(255, 255, 255, 0.9)';
          context.fillRect(
            centerX - textWidth/2 - padding,
            centerY - textHeight/2 - padding,
            textWidth + padding * 2,
            textHeight + padding * 2
          );
          
          // Draw text
          context.fillStyle = measurement.color;
          context.fillText(displayValue, centerX, centerY);
        }
        break;
        
      case 'count':
        const point = convertCoords(points[0]);
        context.beginPath();
        context.strokeStyle = measurement.color;
        context.fillStyle = measurement.color + '40'; // Semi-transparent fill
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
    if (!viewportRef.current) {
      return;
    }
    
    const viewport = viewportRef.current;
    
    // Get the selected condition to use its color
    const selectedCondition = getSelectedCondition();
    const conditionColor = selectedCondition?.color || '#000000';
    
    // Check if we have enough points to render
    const minPoints = measurementType === 'linear' ? 2 : measurementType === 'area' ? 3 : 1;
    if (currentMeasurement.length < minPoints) {
      console.log('🚫 RENDER_CURRENT_MEASUREMENT: Not enough points to render', {
        currentMeasurementLength: currentMeasurement.length,
        minPoints,
        measurementType
      });
      return;
    }
    
    // Only log when actually rendering something
    if (currentMeasurement.length > 0 || mousePosition) {
      console.log('🎨 RENDER_CURRENT_MEASUREMENT: Rendering current measurement', {
        currentMeasurementLength: currentMeasurement.length,
        hasMousePosition: !!mousePosition,
        measurementType
      });
    }
    
    context.save();
    
    switch (measurementType) {
      case 'linear':
        // Draw the complete line including the preview segment in the condition's color
        if (currentMeasurement.length > 0) {
          context.strokeStyle = conditionColor;
          context.lineWidth = 3;
          context.setLineDash([]); // Solid lines
          context.beginPath();
          
          // Convert PDF-relative coordinates to canvas coordinates
          const startCanvasX = currentMeasurement[0].x * viewport.width;
          const startCanvasY = currentMeasurement[0].y * viewport.height;
          context.moveTo(startCanvasX, startCanvasY);
          
          // Draw existing segments
          for (let i = 1; i < currentMeasurement.length; i++) {
            const canvasX = currentMeasurement[i].x * viewport.width;
            const canvasY = currentMeasurement[i].y * viewport.height;
            context.lineTo(canvasX, canvasY);
          }
          
          // Draw preview segment to mouse position if available
          if (mousePosition) {
            const mouseCanvasX = mousePosition.x * viewport.width;
            const mouseCanvasY = mousePosition.y * viewport.height;
            
            // Safety check: ensure coordinates are within reasonable bounds
            if (mouseCanvasX >= 0 && mouseCanvasX <= viewport.width && 
                mouseCanvasY >= 0 && mouseCanvasY <= viewport.height) {
              context.lineTo(mouseCanvasX, mouseCanvasY);
            }
          }
          
          context.stroke();
        }
        
        // Draw crosshair at mouse position for better visual feedback (only when actively measuring)
        if (mousePosition && isMeasuring) {
          const mouseCanvasX = mousePosition.x * viewport.width;
          const mouseCanvasY = mousePosition.y * viewport.height;
          
          // Safety check: ensure coordinates are within reasonable bounds
          if (mouseCanvasX >= 0 && mouseCanvasX <= viewport.width && 
              mouseCanvasY >= 0 && mouseCanvasY <= viewport.height) {
            
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

  // Handle mouse move for preview rendering with throttling
  const handleCanvasMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMeasuring || !selectedConditionId) {
      // Clear mouse position when not measuring
      if (mousePosition) {
        console.log('🧹 MOUSE_MOVE: Clearing mouse position - not measuring');
        setMousePosition(null);
      }
      return;
    }
    
    const canvas = canvasRef.current;
    if (!canvas || !viewportRef.current) {
      return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    
    // Convert canvas coordinates to PDF-relative coordinates (0-1 scale)
    const viewport = viewportRef.current;
    const pdfX = canvasX / viewport.width;
    const pdfY = canvasY / viewport.height;
    
    // Only update if the position has changed significantly to reduce rendering
    const threshold = 0.005; // Increased threshold to prevent excessive updates
    if (mousePosition && 
        Math.abs(mousePosition.x - pdfX) < threshold && 
        Math.abs(mousePosition.y - pdfY) < threshold) {
      return;
    }
    
    console.log('🖱️ MOUSE_MOVE: Setting mouse position', {
      canvasX,
      canvasY,
      pdfX,
      pdfY,
      viewport: { width: viewport.width, height: viewport.height },
      isMeasuring,
      selectedConditionId
    });
    
    setMousePosition({ x: pdfX, y: pdfY });
  }, [isMeasuring, selectedConditionId, mousePosition]);

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
    if (!selectedConditionId) {
      console.log('❌ CLICK: No condition selected', { selectedConditionId });
      return;
    }
    
    // Start measuring if not already measuring (only when user actually clicks to add a point)
    if (!isMeasuring) {
      console.log('🖱️ CLICK: Starting measurement mode');
      setIsMeasuring(true);
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
      measurementType,
      currentPage,
      fileId: file?.id,
      projectId: currentProjectId
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
    
    // Calculate perimeter for area measurements if needed
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

    // Save to API only
    if (currentProjectId && file?.id) {
      console.log('💾 SAVING_MEASUREMENT: Saving to API only', {
        projectId: currentProjectId,
        fileId: file.id,
        currentPage,
        measurement: {
          type: measurementType,
          conditionName: selectedCondition.name
        }
      });
      
      // Save to API for persistence
      const { addTakeoffMeasurement, getPageTakeoffMeasurements } = useTakeoffStore.getState();
      addTakeoffMeasurement({
        projectId: currentProjectId,
        sheetId: file.id,
        conditionId: selectedConditionId,
        type: measurementType,
        points: points, // Use PDF-relative coordinates for storage
        calculatedValue,
        unit,
        pdfPage: currentPage,
        pdfCoordinates: points, // Same as points for consistency
        conditionColor: selectedCondition.color,
        conditionName: selectedCondition.name,
        perimeterValue
      }).then(savedMeasurementId => {
        console.log('✅ MEASUREMENT_SAVED: Measurement saved to API with ID:', savedMeasurementId);
        
        // Reload measurements from API to get the complete saved measurement
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
        
        console.log('✅ MEASUREMENT_SAVED: Reloaded measurements for current page', {
          currentPage,
          updatedCount: updatedMeasurements.length,
          displayCount: displayMeasurements.length
        });
        
        setLocalTakeoffMeasurements(displayMeasurements);
        
        // Force immediate re-render to show the new measurement
        setTimeout(() => {
          renderAnnotations(false);
        }, 50);
      }).catch(error => {
        console.error('❌ API_SAVE_FAILED: Failed to save measurement to API:', error);
        // Show error to user - measurement was not saved
      });
    } else {
      console.error('❌ SAVE_FAILED: Missing required data', {
        currentProjectId,
        fileId: file?.id
      });
    }
    
    // Clear current measurement and mouse position
    setCurrentMeasurement([]);
    setMousePosition(null);
    setMeasurements([]); // Clear any temporary measurements
    
    // Force a clean render to remove any lingering preview lines and show the completed measurement
    setTimeout(() => {
      renderAnnotations(false);
    }, 100);
  }, [selectedConditionId, getSelectedCondition, measurementType, scaleFactor, currentProjectId, currentPage, file.id, canvasToPdfCoords]);

  // Complete calibration
  const completeCalibration = useCallback((points: { x: number; y: number }[]) => {
    if (points.length !== 2 || !calibrationData) return;
    
    const pixelDistance = calculateDistance(points[0], points[1]);
    const knownDistance = calibrationData.knownDistance;
    const unit = calibrationData.unit;
    
    // Calculate scale factor (pixels per unit)
    const newScaleFactor = pixelDistance / knownDistance;
    
    // Update internal state if external props are not being used
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
    
    // Update internal state if external props are not being used
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
    console.log('🔄 PAGE_CHANGE_EFFECT: Page changed', {
      currentPage,
      pdfDocumentAvailable: !!pdfDocument,
      fileId: file?.id,
      projectId: currentProjectId
    });
    
    if (pdfDocument) {
      // Clear temporary measurements only
      setMeasurements([]);
      renderPage(currentPage);
      // Note: loadTakeoffMeasurements is called by the main useEffect when currentPage changes
    }
  }, [pdfDocument, currentPage, renderPage]);

  // Clear current measurement state when page changes
  useEffect(() => {
    console.log('🧹 CLEAR_MEASUREMENT_STATE: Clearing measurement state for page change', {
      currentPage,
      currentMeasurementLength: currentMeasurement.length,
      measurementsLength: measurements.length,
      isMeasuring
    });
    
    // Only clear temporary measurement state, not the persisted measurements
    setCurrentMeasurement([]);
    setMousePosition(null);
    setMeasurements([]); // Clear any temporary measurements
    // Don't clear isMeasuring - let the condition selection handle that
  }, [currentPage]);

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
  }, [viewState, renderPage, currentPage]);

  // Re-render annotations when measurement state changes (for live drawing) with throttling
  useEffect(() => {
    // Only log when actually rendering something
    if (currentMeasurement.length > 0 || mousePosition) {
      console.log('🔄 LIVE_RENDER: Triggering render due to state change', {
        currentMeasurementLength: currentMeasurement.length,
        mousePosition,
        isMeasuring,
        measurementType
      });
    }
    
    if (pdfDocument && (isMeasuring || currentMeasurement.length > 0)) {
      // Throttle the rendering to prevent excessive updates
      const timeoutId = setTimeout(() => {
        // Only re-render if we have a current measurement with enough points or mouse position
        const minPoints = measurementType === 'linear' ? 2 : measurementType === 'area' ? 3 : 1;
        if (currentMeasurement.length >= minPoints || mousePosition) {
          renderAnnotations(false); // Don't re-render PDF, just annotations
        }
      }, 32); // ~30fps for smoother preview
      
      return () => clearTimeout(timeoutId);
    }
  }, [currentMeasurement, mousePosition, isMeasuring, measurementType, pdfDocument]);

  // Ensure measurements are always rendered - this is critical for persistence
  useEffect(() => {
    if (pdfDocument) {
      // Only log when there are measurements to render
      if (localTakeoffMeasurements.length > 0) {
        console.log('🔄 PERSISTENT_RENDER: Ensuring measurements are rendered', {
          currentPage,
          measurementCount: localTakeoffMeasurements.length
        });
      }
      
      // Force a render to ensure measurements are visible (or cleared if empty)
      const timeoutId = setTimeout(() => {
        renderAnnotations(false);
      }, 50);
      
      return () => clearTimeout(timeoutId);
    }
  }, [localTakeoffMeasurements, currentPage, pdfDocument]);

  // Set measurement type when condition is selected, but don't start measuring until user clicks
  useEffect(() => {
    console.log('Condition selection changed:', { selectedConditionId });
    if (selectedConditionId) {
      // Don't set isMeasuring to true here - only when user actually starts drawing
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
      // Only clear current measurement being drawn, not the persisted measurements
      setCurrentMeasurement([]);
      setMousePosition(null);
      setMeasurements([]); // Clear any temporary measurements
      
      // Ensure existing measurements remain visible when condition is deselected
      setTimeout(() => {
        renderAnnotations(false);
      }, 100);
    }
  }, [selectedConditionId]);

  // Debug current state - only log when there are changes
  useEffect(() => {
    if (isMeasuring || currentMeasurement.length > 0 || mousePosition) {
      console.log('Current measurement state:', { 
        isMeasuring, 
        selectedConditionId, 
        measurementType, 
        currentMeasurement: currentMeasurement.length,
        mousePosition 
      });
    }
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


  // Set up debug function for browser console
  useEffect(() => {
    (window as any).debugTakeoffs = () => {
      console.log('🐛 DEBUG_TAKEOFFS: Manual debug triggered');
      
      // Show current state
      console.log('🐛 CURRENT_STATE:', {
        currentPage,
        currentProjectId,
        fileId: file?.id,
        localTakeoffMeasurements: localTakeoffMeasurements.length,
        viewport: viewportRef.current ? {
          width: viewportRef.current.width,
          height: viewportRef.current.height
        } : null
      });
    };
    
    return () => {
      delete (window as any).debugTakeoffs;
    };
  }, [currentPage, currentProjectId, file?.id, localTakeoffMeasurements.length]);

  // Distance calculation now imported from common utils

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
    console.log('❌ PDF_VIEWER: No PDF document loaded', { 
      file, 
      fileType: typeof file, 
      fileId: file?.id,
      isLoading,
      error 
    });
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center">
          <p className="text-gray-600 mb-2">No PDF loaded</p>
          <p className="text-sm text-gray-500">File: {file?.originalName || file?.id || 'Unknown'}</p>
          {isLoading && <p className="text-sm text-blue-600">Loading...</p>}
          {error && <p className="text-sm text-red-600">Error: {error}</p>}
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
        <div className="flex items-start justify-start min-h-full p-4 relative">
          <canvas
            ref={canvasRef}
            className="shadow-lg"
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
            onMouseMove={handleCanvasMouseMove}
            onMouseEnter={() => console.log('Mouse entered canvas')}
            onMouseLeave={() => {
              console.log('Mouse left canvas');
              // Clear mouse position when leaving canvas to prevent lingering preview lines
              setMousePosition(null);
            }}
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

export default PDFViewer;
