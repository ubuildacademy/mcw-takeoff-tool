import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { useTakeoffStore } from '../store/useTakeoffStore';
import CalibrationDialog from './CalibrationDialog';
import ScaleApplicationDialog from './ScaleApplicationDialog';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface PDFViewerWithAnnotationsProps {
  file: File | string | any;
  className?: string;
  onCalibrationRequest?: () => void;
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

const PDFViewerWithAnnotations: React.FC<PDFViewerWithAnnotationsProps> = ({ 
  file, 
  className = '', 
  onCalibrationRequest 
}) => {
  // State
  const [pdfjsDocument, setPdfjsDocument] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Single source of truth - view state (scroll container owns pan)
  const [viewState, setViewState] = useState({ 
    scale: 1, 
    rotation: 0 
  });
  
  // Interaction state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOriginScroll, setDragOriginScroll] = useState({ left: 0, top: 0 });
  
  // Measurement state
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measurementType, setMeasurementType] = useState<'linear' | 'area' | 'volume' | 'count'>('linear');
  const [currentMeasurement, setCurrentMeasurement] = useState<{ x: number; y: number }[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  
  // Scale and calibration
  const [scaleFactor, setScaleFactor] = useState(1); // pixels per unit
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
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null);
  const pdfPageRef = useRef<any>(null);
  const viewportRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);
  const isRenderingRef = useRef<boolean>(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const renderCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // Store integration
  const { 
    currentProjectId, 
    selectedConditionId,
    conditions,
    addTakeoffMeasurement,
    getSelectedCondition,
    getSheetTakeoffMeasurements
  } = useTakeoffStore();

  // Debounced render function
  const debouncedRender = useCallback(() => {
    let timeoutId: NodeJS.Timeout;
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        if (pdfjsDocument && currentPage) {
          await renderPage(currentPage);
        }
      }, 150);
    };
  }, [pdfjsDocument, currentPage]);

  const rerender = useCallback(debouncedRender(), [debouncedRender]);


  // Load PDF document
  useEffect(() => {
    const loadPDF = async () => {
      if (!file) return;
      
      setIsLoading(true);
      setError(null);
      
      let objectUrl: string | null = null;
      
      try {
        let pdfUrl;
        
        // Handle different file object types
        if (typeof file === 'string') {
          // Direct URL string
          pdfUrl = file;
        } else if (file instanceof File) {
          // File object from input
          objectUrl = URL.createObjectURL(file);
          pdfUrl = objectUrl;
        } else if (file && file.id) {
          // File object from backend API
          pdfUrl = `http://localhost:4000/api/files/${file.id}`;
        } else {
          throw new Error('Invalid file object provided');
        }
        
        console.log('Loading PDF from URL:', pdfUrl);
        
        const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
        setPdfjsDocument(pdf);
        setTotalPages(pdf.numPages);
        setCurrentPage(1);
        
        console.log('PDF loaded successfully:', pdf.numPages, 'pages');
      } catch (error) {
        console.error('Error loading PDF:', error);
        setError('Failed to load PDF file');
      } finally {
        setIsLoading(false);
        // Clean up object URL if we created one
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
      }
    };

    loadPDF();
  }, [file]);


  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);


  // Add non-passive wheel event listener to the container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheelNonPassive = (event: WheelEvent) => {
      if (isMeasuring || isCalibrating) return;
      
      console.log('Wheel event:', { 
        ctrlKey: event.ctrlKey, 
        metaKey: event.metaKey, 
        shiftKey: event.shiftKey, 
        deltaY: event.deltaY, 
        deltaX: event.deltaX,
        target: event.target,
        currentTarget: event.currentTarget
      });
      
      // Zoom with Ctrl/Cmd + wheel
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        console.log('Handling zoom wheel event');
        
        const rect = container.getBoundingClientRect();
        const anchorX = event.clientX - rect.left + container.scrollLeft;
        const anchorY = event.clientY - rect.top + container.scrollTop;
        
        const ZOOM_STEP = 1.1;
        const MIN_SCALE = 0.25;
        const MAX_SCALE = 8;
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewState.scale * (event.deltaY < 0 ? ZOOM_STEP : 1/ZOOM_STEP)));
        
        if (next === viewState.scale) return;
        
        const k = next / viewState.scale;
        // Keep cursor point anchored by adjusting scroll offsets
        container.scrollLeft = (container.scrollLeft + anchorX) * k - anchorX;
        container.scrollTop = (container.scrollTop + anchorY) * k - anchorY;
        
        console.log('Zoom update:', { from: viewState.scale, to: next, k, scrollLeft: container.scrollLeft, scrollTop: container.scrollTop });
        setViewState(prev => ({ ...prev, scale: next }));
        rerender();
        return;
      }
      
      // Horizontal pan with Shift+wheel
      if (event.shiftKey) {
        event.preventDefault();
        console.log('Handling horizontal pan wheel event');
        const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
        container.scrollLeft += delta;
        console.log('Horizontal scroll:', { delta, newScrollLeft: container.scrollLeft });
        return;
      }
      
      // Default: vertical scroll - DO NOT preventDefault, let browser handle it natively
      console.log('Allowing native vertical scroll - no preventDefault');
    };

    container.addEventListener('wheel', handleWheelNonPassive, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheelNonPassive);
    };
  }, [isMeasuring, isCalibrating]);

  // Render PDF page with HiDPI support and caching
  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfjsDocument || !canvasRef.current || !containerRef.current) return;
    
    // Prevent multiple simultaneous renders
    if (isRenderingRef.current) {
      return;
    }
    
    isRenderingRef.current = true;

    try {
      // Cancel any previous render task
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await pdfjsDocument.getPage(pageNum);
      pdfPageRef.current = page;
      
      const container = containerRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      if (!context) {
        isRenderingRef.current = false;
        return;
      }

      // Get device pixel ratio for HiDPI support
      const devicePixelRatio = window.devicePixelRatio || 1;
      
      // Get container dimensions using clientWidth/clientHeight for accurate sizing
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      
      console.log('=== CONTAINER DEBUG ===');
      console.log('Container client dimensions:', { containerWidth, containerHeight });
      console.log('Container offset dimensions:', { offsetWidth: container.offsetWidth, offsetHeight: container.offsetHeight });
      console.log('Container scroll dimensions:', { scrollWidth: container.scrollWidth, scrollHeight: container.scrollHeight });
      console.log('Container computed styles:', {
        height: getComputedStyle(container).height,
        minHeight: getComputedStyle(container).minHeight,
        maxHeight: getComputedStyle(container).maxHeight,
        overflow: getComputedStyle(container).overflow
      });
      
      // Get the base viewport at scale 1
      const baseViewport = page.getViewport({ scale: 1 });
      console.log('Base viewport:', { width: baseViewport.width, height: baseViewport.height });
      
      // Calculate scale to fit the container width (allow height to overflow for scrolling)
      const scaleX = containerWidth / baseViewport.width;
      const scaleY = containerHeight / baseViewport.height;
      // Use width-based scaling to allow vertical scrolling
      const fitScale = scaleX;
      
      // Apply user zoom on top of the fit scale
      const finalScale = fitScale * viewState.scale;
      
      console.log('Scale calculation (width-based for scrolling):', { 
        baseViewport: { width: baseViewport.width, height: baseViewport.height },
        container: { width: containerWidth, height: containerHeight },
        scaleX, scaleY, fitScale, finalScale,
        note: 'Using width-based scaling to allow vertical scrolling'
      });
      
      // Calculate viewport with the final scale - this determines the actual PDF content size
      const viewport = page.getViewport({ 
        scale: finalScale
      });
      
      console.log('Viewport after scale:', { 
        width: viewport.width, 
        height: viewport.height,
        originalBase: { width: baseViewport.width, height: baseViewport.height }
      });
      
      console.log('Final viewport:', { width: viewport.width, height: viewport.height });
      
      viewportRef.current = viewport;
      
      // Set canvas to match PDF content size exactly - this is the key fix
      const cssWidth = Math.floor(viewport.width);
      const cssHeight = Math.floor(viewport.height);
      
      console.log('Canvas sizing:', { 
        viewport: { width: viewport.width, height: viewport.height },
        css: { width: cssWidth, height: cssHeight },
        container: { width: containerWidth, height: containerHeight },
        shouldScroll: cssWidth > containerWidth || cssHeight > containerHeight
      });
      
      // CRITICAL: Ensure we're using the scaled viewport dimensions
      console.log('Using scaled viewport for canvas:', { 
        scaledWidth: viewport.width, 
        scaledHeight: viewport.height,
        baseWidth: baseViewport.width,
        baseHeight: baseViewport.height
      });
      
      // Set canvas pixel dimensions (for HiDPI)
      const pixelWidth = cssWidth * devicePixelRatio;
      const pixelHeight = cssHeight * devicePixelRatio;
      
      // Check for maximum canvas size (GPU texture limits)
      const maxCanvasSize = 16384; // Conservative limit
      if (pixelWidth > maxCanvasSize || pixelHeight > maxCanvasSize) {
        console.warn('Canvas size exceeds GPU limits, capping zoom');
        const scaleLimit = Math.min(maxCanvasSize / cssWidth, maxCanvasSize / cssHeight);
        const limitedCssWidth = cssWidth * scaleLimit;
        const limitedCssHeight = cssHeight * scaleLimit;
        
        canvas.style.width = `${limitedCssWidth}px`;
        canvas.style.height = `${limitedCssHeight}px`;
        canvas.style.transform = 'none'; // CRITICAL: Ensure idle transform is identity
        canvas.width = limitedCssWidth * devicePixelRatio;
        canvas.height = limitedCssHeight * devicePixelRatio;
      } else {
        // Set CSS dimensions to match PDF content exactly
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        canvas.style.transform = 'none'; // CRITICAL: Ensure idle transform is identity
        
        // Then set pixel dimensions for HiDPI
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        
        console.log('Canvas set to:', { 
          cssWidth, cssHeight, pixelWidth, pixelHeight,
          actualCanvasWidth: canvas.style.width,
          actualCanvasHeight: canvas.style.height
        });
        
        // CRITICAL: Force the canvas to the correct size if it was overridden
        if (parseFloat(canvas.style.height) !== cssHeight) {
          console.warn('Canvas height was overridden, forcing correct size');
          canvas.style.height = `${cssHeight}px`;
        }
      }
      
      // CRITICAL: Reset any leftover transforms - scroll container owns pan at idle
      canvas.style.transform = 'none';
      
      // Verify canvas dimensions after setting
      console.log('Canvas dimensions after setting:', {
        styleWidth: canvas.style.width,
        styleHeight: canvas.style.height,
        offsetWidth: canvas.offsetWidth,
        offsetHeight: canvas.offsetHeight
      });
      
      console.log('Canvas dimensions:', { 
        container: `${containerWidth}x${containerHeight}`,
        viewport: `${cssWidth}x${cssHeight}`,
        shouldScroll: cssWidth > containerWidth || cssHeight > containerHeight
      });
      
      // Set annotation canvas size to match
      if (annotationCanvasRef.current) {
        annotationCanvasRef.current.width = canvas.width;
        annotationCanvasRef.current.height = canvas.height;
        annotationCanvasRef.current.style.width = canvas.style.width;
        annotationCanvasRef.current.style.height = canvas.style.height;
      }
      
      // Scale context for HiDPI
      context.scale(devicePixelRatio, devicePixelRatio);
      
      // No pan offset - scroll container handles panning
      context.save();
      
      // Render PDF page with HiDPI transform
      const renderContext = {
        canvasContext: context,
        viewport: viewportRef.current,
        transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0]
      };
      
      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;
      
      await renderTask.promise;
      
      // Restore context
      context.restore();
      
      // Set page wrap size to match canvas for proper scrolling
      if (containerRef.current) {
        const pageWrap = containerRef.current.querySelector('.pdf-page-wrap') as HTMLElement;
        if (pageWrap) {
          pageWrap.style.width = `${cssWidth}px`;
          pageWrap.style.height = `${cssHeight}px`;
          console.log('Page wrap set to:', { width: pageWrap.style.width, height: pageWrap.style.height });
        }
      }
      
      // Re-render annotations after PDF is rendered
      renderAnnotations();
      
      // Diagnostic: Check canvas transform at idle
      const computedTransform = getComputedStyle(canvas).transform;
      console.log('Canvas transform at idle:', computedTransform);
      if (computedTransform !== 'none' && computedTransform !== 'matrix(1, 0, 0, 1, 0, 0)') {
        console.error('WARNING: Canvas transform is not identity at idle!', computedTransform);
        // Force reset
        canvas.style.transform = 'none';
      }
      console.log('Container scroll state:', { 
        scrollLeft: container.scrollLeft, 
        scrollTop: container.scrollTop,
        scrollWidth: container.scrollWidth,
        scrollHeight: container.scrollHeight,
        clientWidth: container.clientWidth,
        clientHeight: container.clientHeight,
        canScroll: container.scrollWidth > container.clientWidth || container.scrollHeight > container.clientHeight
      });
      
      // Check if scrollbars should be visible
      const hasVerticalScroll = container.scrollHeight > container.clientHeight;
      const hasHorizontalScroll = container.scrollWidth > container.clientWidth;
      console.log('Scrollbar status:', { hasVerticalScroll, hasHorizontalScroll });
      
    } catch (error: any) {
      if (error.name !== 'RenderingCancelledException') {
        console.error('Error rendering page:', error);
      }
    } finally {
      isRenderingRef.current = false;
    }
  }, [pdfjsDocument, viewState]);

  // Handle container resize to recalculate scale
  useEffect(() => {
    if (!containerRef.current) return;

    const handleResize = () => {
      if (pdfjsDocument && currentPage) {
        // Trigger a re-render when container is resized
        renderPage(currentPage);
      }
    };

    // Use ResizeObserver for more accurate container size detection
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    // Also listen to window resize as fallback
    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [pdfjsDocument, currentPage, renderPage]);

  // Render annotations on the annotation canvas
  const renderAnnotations = useCallback(() => {
    if (!annotationCanvasRef.current || !viewportRef.current) return;
    
    const canvas = annotationCanvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;
    
    // Clear canvas
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    // Get device pixel ratio for HiDPI support
    const devicePixelRatio = window.devicePixelRatio || 1;
    
    // Scale context for HiDPI
    context.save();
    context.scale(devicePixelRatio, devicePixelRatio);
    
    // No pan offset - scroll container handles panning
    
    console.log('Rendering annotations, measurements count:', measurements.length);
    
    // Render each measurement
    measurements.forEach(measurement => {
      console.log('Rendering measurement:', measurement);
      renderMeasurement(context, measurement);
    });
    
    // Render current measurement being drawn
    if (currentMeasurement.length > 0) {
      renderCurrentMeasurement(context);
    }
    
    // Render calibration points if calibrating
    if (isCalibrating && calibrationPoints.length > 0) {
      renderCalibrationPoints(context);
    }
    
    // Restore context
    context.restore();
  }, [measurements, currentMeasurement, measurementType, isCalibrating, calibrationPoints, viewState]);


  // Render linear measurement
  const renderLinearMeasurement = (context: CanvasRenderingContext2D, measurement: Measurement) => {
    const points = measurement.points;
    console.log('Rendering linear measurement with points:', points);
    
    if (points.length < 2) {
      console.log('Not enough points for linear measurement:', points.length);
      return;
    }
    
    // Check if points have valid coordinates
    const validPoints = points.filter(p => !isNaN(p.x) && !isNaN(p.y) && isFinite(p.x) && isFinite(p.y));
    if (validPoints.length !== points.length) {
      console.log('Invalid points found:', points, 'valid points:', validPoints);
      return;
    }
    
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    
    for (let i = 1; i < points.length; i++) {
      context.lineTo(points[i].x, points[i].y);
    }
    
    context.stroke();
    
    // Draw measurement text
    const midPoint = {
      x: (points[0].x + points[points.length - 1].x) / 2,
      y: (points[0].y + points[points.length - 1].y) / 2
    };
    
    context.fillStyle = measurement.color;
    context.font = '12px Arial';
    context.fillText(`${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`, midPoint.x, midPoint.y - 5);
    
    console.log('Linear measurement rendered successfully');
  };

  // Render area measurement
  const renderAreaMeasurement = (context: CanvasRenderingContext2D, measurement: Measurement) => {
    const points = measurement.points;
    if (points.length < 3) return;
    
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    
    for (let i = 1; i < points.length; i++) {
      context.lineTo(points[i].x, points[i].y);
    }
    
    context.closePath();
    context.fill();
    context.stroke();
    
    // Draw area text
    const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    
    context.fillStyle = measurement.color;
    context.font = '12px Arial';
    context.fillText(`${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`, centerX, centerY);
  };

  // Render volume measurement
  const renderVolumeMeasurement = (context: CanvasRenderingContext2D, measurement: Measurement) => {
    // Same as area but with volume calculation
    renderAreaMeasurement(context, measurement);
    
    const points = measurement.points;
    const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    
    context.fillStyle = measurement.color;
    context.font = '10px Arial';
    context.fillText(`Vol: ${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`, centerX, centerY + 15);
  };

  // Render count measurement
  const renderCountMeasurement = (context: CanvasRenderingContext2D, measurement: Measurement) => {
    const point = measurement.points[0];
    if (!point) return;
    
    // Draw circle
    context.beginPath();
    context.arc(point.x, point.y, 10, 0, 2 * Math.PI);
    context.fill();
    context.stroke();
    
    // Draw count text
    context.fillStyle = 'white';
    context.font = 'bold 12px Arial';
    context.textAlign = 'center';
    context.fillText('1', point.x, point.y + 4);
    context.textAlign = 'left';
  };

  // Render current measurement being drawn
  const renderCurrentMeasurement = (context: CanvasRenderingContext2D) => {
    if (currentMeasurement.length === 0) return;
    
    context.save();
    context.strokeStyle = '#007bff';
    context.fillStyle = '#007bff40';
    context.lineWidth = 2;
    context.setLineDash([5, 5]);
    
    switch (measurementType) {
      case 'linear':
        if (currentMeasurement.length >= 2) {
          context.beginPath();
          context.moveTo(currentMeasurement[0].x, currentMeasurement[0].y);
          for (let i = 1; i < currentMeasurement.length; i++) {
            context.lineTo(currentMeasurement[i].x, currentMeasurement[i].y);
          }
          context.stroke();
        }
        break;
      case 'area':
      case 'volume':
        if (currentMeasurement.length >= 3) {
          context.beginPath();
          context.moveTo(currentMeasurement[0].x, currentMeasurement[0].y);
          for (let i = 1; i < currentMeasurement.length; i++) {
            context.lineTo(currentMeasurement[i].x, currentMeasurement[i].y);
          }
          context.closePath();
          context.fill();
          context.stroke();
        }
        break;
      case 'count':
        if (currentMeasurement.length >= 1) {
          const point = currentMeasurement[0];
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

  // Convert screen coordinates to PDF coordinates
  const screenToPDFCoords = useCallback((screenX: number, screenY: number) => {
    if (!viewportRef.current) return { x: 0, y: 0 };
    
    // PDF.js provides this conversion directly!
    const pdfPoint = viewportRef.current.convertToPdfPoint(screenX, screenY);
    return pdfPoint;
  }, []);

  // Convert PDF coordinates to screen coordinates
  const pdfToScreenCoords = useCallback((pdfX: number, pdfY: number) => {
    if (!viewportRef.current) return { x: 0, y: 0 };
    
    // PDF.js provides this conversion directly!
    const screenPoint = viewportRef.current.convertToViewportPoint(pdfX, pdfY);
    return screenPoint;
  }, []);

  // Render a single measurement
  const renderMeasurement = (context: CanvasRenderingContext2D, measurement: Measurement) => {
    console.log('Rendering measurement:', measurement.type, 'with PDF points:', measurement.points);
    
    // Convert PDF coordinates to screen coordinates for rendering
    const screenPoints = measurement.points.map(pdfPoint => {
      const screenPoint = pdfToScreenCoords(pdfPoint.x, pdfPoint.y);
      console.log('PDF coord:', pdfPoint, '-> Screen coord:', screenPoint);
      return screenPoint;
    });
    
    console.log('Rendering with screen points:', screenPoints);
    
    context.save();
    context.strokeStyle = measurement.color;
    context.fillStyle = measurement.color + '40'; // Add transparency
    context.lineWidth = 2;
    
    // Create a measurement object with screen coordinates for rendering
    const screenMeasurement = {
      ...measurement,
      points: screenPoints
    };
    
    switch (measurement.type) {
      case 'linear':
        renderLinearMeasurement(context, screenMeasurement);
        break;
      case 'area':
        renderAreaMeasurement(context, screenMeasurement);
        break;
      case 'volume':
        renderVolumeMeasurement(context, screenMeasurement);
        break;
      case 'count':
        renderCountMeasurement(context, screenMeasurement);
        break;
    }
    
    context.restore();
  };

  // Load existing measurements from store
  const loadExistingMeasurements = useCallback(() => {
    if (!currentProjectId || !file?.id) {
      console.log('Cannot load measurements - missing projectId or file.id:', { currentProjectId, fileId: file?.id });
      return;
    }
    
    console.log('Loading existing measurements for project:', currentProjectId, 'sheet:', file.id);
    const storeMeasurements = getSheetTakeoffMeasurements(currentProjectId, file.id);
    console.log('Store measurements found:', storeMeasurements);
    
    if (storeMeasurements.length === 0) {
      console.log('No existing measurements found for this sheet');
      setMeasurements([]);
      return;
    }
    
    // Convert store measurements to local format
    const localMeasurements: Measurement[] = storeMeasurements.map(storeMeasurement => {
      console.log('Converting store measurement:', storeMeasurement);
      
      // Store measurements should already be in PDF coordinates, so we keep them as PDF coordinates
      // The rendering functions will convert them to screen coordinates as needed
      return {
        id: storeMeasurement.id,
        type: storeMeasurement.type,
        points: storeMeasurement.pdfCoordinates, // Keep as PDF coordinates
        calculatedValue: storeMeasurement.calculatedValue,
        unit: storeMeasurement.unit,
        conditionId: storeMeasurement.conditionId,
        color: storeMeasurement.conditionColor,
        conditionName: storeMeasurement.conditionName
      };
    });
    
    console.log('Converted local measurements:', localMeasurements);
    setMeasurements(localMeasurements);
  }, [currentProjectId, file?.id, getSheetTakeoffMeasurements]);

  // Load existing measurements when PDF is loaded and viewport is ready
  useEffect(() => {
    if (pdfjsDocument && viewportRef.current) {
      // Small delay to ensure viewport is fully set up
      const timer = setTimeout(() => {
        loadExistingMeasurements();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [pdfjsDocument, loadExistingMeasurements]);

  // Calculate distance between two points
  const calculateDistance = (point1: { x: number; y: number }, point2: { x: number; y: number }) => {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Calculate area of polygon using shoelace formula
  const calculateArea = (points: { x: number; y: number }[]) => {
    if (points.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
  };

  // Handle canvas click for measurements and calibration
  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = annotationCanvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
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
    if (!isMeasuring || !selectedConditionId) return;
    
    // Convert to PDF coordinates for storage
    const pdfCoords = screenToPDFCoords(x, y);
    
    setCurrentMeasurement(prev => [...prev, { x, y }]);
    
    // Complete measurement based on type
    if (measurementType === 'count') {
      completeMeasurement([{ x, y }]);
    }
  }, [isMeasuring, isCalibrating, selectedConditionId, measurementType, screenToPDFCoords]);

  // Complete current measurement
  const completeMeasurement = useCallback((points: { x: number; y: number }[]) => {
    if (!selectedConditionId || points.length === 0) return;
    
    const selectedCondition = getSelectedCondition();
    if (!selectedCondition) return;
    
    // Convert screen coordinates to PDF coordinates for storage
    const pdfPoints = points.map(p => screenToPDFCoords(p.x, p.y));
    
    let calculatedValue = 0;
    let unit = selectedCondition.unit;
    
    // Calculate value based on type using PDF coordinates
    switch (measurementType) {
      case 'linear':
        if (points.length >= 2) {
          let totalDistance = 0;
          for (let i = 1; i < points.length; i++) {
            totalDistance += calculateDistance(points[i - 1], points[i]);
          }
          calculatedValue = (totalDistance / scaleFactor) * (isPageCalibrated ? 1 : 1);
        }
        break;
      case 'area':
        if (points.length >= 3) {
          const area = calculateArea(points);
          calculatedValue = (area / (scaleFactor * scaleFactor)) * (isPageCalibrated ? 1 : 1);
        }
        break;
      case 'volume':
        if (points.length >= 3) {
          const area = calculateArea(points);
          calculatedValue = (area / (scaleFactor * scaleFactor)) * (isPageCalibrated ? 1 : 1); // Assuming 1 unit depth
        }
        break;
      case 'count':
        calculatedValue = 1;
        break;
    }
    
    // Create measurement object with PDF coordinates
    const measurement: Measurement = {
      id: Date.now().toString(),
      type: measurementType,
      points: pdfPoints, // Store PDF coordinates
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
        sheetId: file.id || 'default', // Use file ID as sheet ID
        conditionId: selectedConditionId,
        type: measurementType,
        points: pdfPoints, // Store as PDF coordinates
        calculatedValue,
        unit,
        pdfPage: currentPage,
        pdfCoordinates: pdfPoints,
        conditionColor: selectedCondition.color,
        conditionName: selectedCondition.name
      });
    }
    
    // Clear current measurement
    setCurrentMeasurement([]);
  }, [selectedConditionId, getSelectedCondition, measurementType, scaleFactor, isPageCalibrated, currentProjectId, addTakeoffMeasurement, screenToPDFCoords, currentPage, file.id]);

  // Complete calibration
  const completeCalibration = useCallback((points: { x: number; y: number }[]) => {
    if (points.length !== 2 || !calibrationData) return;
    
    const pixelDistance = calculateDistance(points[0], points[1]);
    const knownDistance = calibrationData.knownDistance;
    const unit = calibrationData.unit;
    
    // Calculate scale factor (pixels per unit)
    const newScaleFactor = pixelDistance / knownDistance;
    
    // Validate scale factor
    if (newScaleFactor < 0.001 || newScaleFactor > 1000) {
      console.warn('Calibration resulted in unreasonable scale factor:', newScaleFactor);
      setCalibrationPoints([]);
      setIsCalibrating(false);
      return;
    }
    
    setScaleFactor(newScaleFactor);
    setUnit(unit);
    setIsPageCalibrated(true);
    setPendingScaleData({ scaleFactor: newScaleFactor, unit });
    setShowScaleApplicationDialog(true);
    
    // Clear calibration state
    setCalibrationPoints([]);
    setIsCalibrating(false);
    setCalibrationData(null);
    
    console.log('Calibration completed:', { newScaleFactor, unit, pixelDistance, knownDistance });
  }, [calibrationData]);

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
    
    // For now, just apply to current page
    // In a full implementation, you'd apply to all pages if scope is 'document'
    setScaleFactor(pendingScaleData.scaleFactor);
    setUnit(pendingScaleData.unit);
    setIsPageCalibrated(true);
    
    setPendingScaleData(null);
    setShowScaleApplicationDialog(false);
    
    console.log('Scale applied:', pendingScaleData, 'scope:', scope);
  }, [pendingScaleData]);

  // Handle double-click to complete measurement
  const handleCanvasDoubleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (measurementType === 'count') return; // Count is completed on single click
    
    if (currentMeasurement.length >= (measurementType === 'linear' ? 2 : 3)) {
      completeMeasurement(currentMeasurement);
    }
  }, [measurementType, currentMeasurement, completeMeasurement]);

  // Re-render when page changes
  useEffect(() => {
    if (pdfjsDocument) {
      // Add a small delay to ensure container is properly sized
      const timer = setTimeout(() => {
        renderPage(currentPage);
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [pdfjsDocument, currentPage, renderPage]);

  // Re-render when view state changes
  useEffect(() => {
    if (pdfjsDocument) {
      renderPage(currentPage);
    }
  }, [viewState, renderPage, currentPage]);

  // Re-render annotations when measurements change
  useEffect(() => {
    if (pdfjsDocument && viewportRef.current) {
      renderAnnotations();
    }
  }, [measurements, renderAnnotations]);

  // Handle pointer events for panning - simplified to use scroll directly
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isMeasuring || isCalibrating || event.button !== 0) return;
    
    setIsDragging(true);
    setDragStart({ x: event.clientX, y: event.clientY });
    
    const container = containerRef.current;
    if (container) {
      container.setPointerCapture(event.pointerId);
      setDragOriginScroll({ 
        left: container.scrollLeft, 
        top: container.scrollTop 
      });
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || isMeasuring || isCalibrating) return;
    
    const container = containerRef.current;
    if (!container) return;
    
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    
    // Update scroll position directly - scroll container owns pan
    container.scrollLeft = dragOriginScroll.left - dx;
    container.scrollTop = dragOriginScroll.top - dy;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    
    setIsDragging(false);
    const container = containerRef.current;
    if (container) {
      container.releasePointerCapture(event.pointerId);
    }
  };


  // Navigation functions
  const goToPreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(prev => prev - 1);
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(prev => prev + 1);
    }
  };

  // Start measuring when condition is selected
  useEffect(() => {
    if (selectedConditionId) {
      setIsMeasuring(true);
      // Set measurement type based on condition
      const condition = getSelectedCondition();
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
      }
    } else {
      setIsMeasuring(false);
      setCurrentMeasurement([]);
    }
  }, [selectedConditionId, getSelectedCondition]);

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

  if (!pdfjsDocument) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <p className="text-gray-600">No PDF loaded</p>
      </div>
    );
  }

  return (
    <div className={`viewer-pane flex flex-col h-full ${className}`} style={{ overflow: 'hidden', height: '100%' }}>
      {/* Navigation Controls */}
      <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg p-2 flex items-center gap-2">
        <button
          onClick={goToPreviousPage}
          disabled={currentPage <= 1}
          className="px-3 py-1 bg-blue-600 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        <span className="px-3 py-1 bg-gray-100 rounded">
          {currentPage} / {totalPages}
        </span>
        <button
          onClick={goToNextPage}
          disabled={currentPage >= totalPages}
          className="px-3 py-1 bg-blue-600 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>

      {/* Zoom Controls */}
      <div className="absolute top-4 right-4 z-10 bg-white rounded-lg shadow-lg p-2 flex items-center gap-2">
        <button
          onClick={() => {
            const container = containerRef.current;
            const canvas = canvasRef.current;
            if (container && canvas) {
              console.log('=== NAVIGATION DIAGNOSTIC ===');
              console.log('Container scroll state:', { 
                scrollLeft: container.scrollLeft, 
                scrollTop: container.scrollTop,
                scrollWidth: container.scrollWidth,
                scrollHeight: container.scrollHeight,
                clientWidth: container.clientWidth,
                clientHeight: container.clientHeight
              });
              console.log('Canvas transform:', getComputedStyle(canvas).transform);
              console.log('Canvas dimensions:', {
                width: canvas.style.width,
                height: canvas.style.height,
                offsetWidth: canvas.offsetWidth,
                offsetHeight: canvas.offsetHeight
              });
              console.log('View state:', viewState);
            }
          }}
          className="px-2 py-1 bg-gray-600 text-white rounded text-xs"
        >
          Debug
        </button>
        <button
          onClick={() => {
            const container = containerRef.current;
            const canvas = canvasRef.current;
            if (container && canvas) {
              // Force canvas to be much larger to test scrolling
              const newWidth = container.clientWidth * 1.5;
              const newHeight = container.clientHeight * 2;
              canvas.style.width = `${newWidth}px`;
              canvas.style.height = `${newHeight}px`;
              const pageWrap = container.querySelector('.pdf-page-wrap') as HTMLElement;
              if (pageWrap) {
                pageWrap.style.width = `${newWidth}px`;
                pageWrap.style.height = `${newHeight}px`;
              }
              console.log('Forced canvas to be larger for testing:', { newWidth, newHeight });
              console.log('Container scroll state after force:', {
                scrollWidth: container.scrollWidth,
                scrollHeight: container.scrollHeight,
                clientWidth: container.clientWidth,
                clientHeight: container.clientHeight,
                canScroll: container.scrollWidth > container.clientWidth || container.scrollHeight > container.clientHeight
              });
            }
          }}
          className="px-2 py-1 bg-red-600 text-white rounded text-xs"
        >
          Force Scroll
        </button>
        <button
          onClick={() => {
            const container = containerRef.current;
            if (container) {
              console.log('=== SCROLL TEST ===');
              console.log('Container element:', container);
              console.log('Container classes:', container.className);
              console.log('Container computed styles:', {
                overflow: getComputedStyle(container).overflow,
                height: getComputedStyle(container).height,
                position: getComputedStyle(container).position,
                width: getComputedStyle(container).width
              });
              console.log('Container dimensions:', {
                scrollWidth: container.scrollWidth,
                scrollHeight: container.scrollHeight,
                clientWidth: container.clientWidth,
                clientHeight: container.clientHeight,
                canScroll: container.scrollWidth > container.clientWidth || container.scrollHeight > container.clientHeight
              });
              
              // Test scrolling
              console.log('Testing scroll...');
              console.log('Before scroll:', { scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight });
              container.scrollTop = 100;
              setTimeout(() => {
                console.log('After scroll test:', { scrollTop: container.scrollTop });
                // Test if we can scroll to bottom
                container.scrollTop = container.scrollHeight - container.clientHeight;
                setTimeout(() => {
                  console.log('After scroll to bottom:', { scrollTop: container.scrollTop, maxScroll: container.scrollHeight - container.clientHeight });
                }, 100);
              }, 100);
            }
          }}
          className="px-2 py-1 bg-green-600 text-white rounded text-xs"
        >
          Test Scroll
        </button>
        <button
          onClick={() => {
            setViewState(prev => ({
              ...prev,
              scale: Math.max(0.25, prev.scale - 0.1)
            }));
            rerender();
          }}
          className="px-3 py-1 bg-blue-600 text-white rounded"
        >
          -
        </button>
        <span className="px-3 py-1 bg-gray-100 rounded min-w-[60px] text-center">
          {Math.round(viewState.scale * 100)}%
        </span>
        <button
          onClick={() => {
            setViewState(prev => ({
              ...prev,
              scale: Math.min(8, prev.scale + 0.1)
            }));
            rerender();
          }}
          className="px-3 py-1 bg-blue-600 text-white rounded"
        >
          +
        </button>
        <button
          onClick={() => {
            setViewState(prev => ({
              ...prev,
              scale: 1
            }));
            rerender();
          }}
          className="px-2 py-1 bg-gray-600 text-white rounded text-xs"
        >
          Fit
        </button>
      </div>

      {/* Calibration Controls */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-white rounded-lg shadow-lg p-2 flex items-center gap-2">
        <button
          onClick={() => setShowCalibrationDialog(true)}
          className={`px-3 py-1 rounded text-sm ${
            isPageCalibrated 
              ? 'bg-green-600 text-white' 
              : 'bg-yellow-600 text-white'
          }`}
        >
          {isPageCalibrated ? 'Recalibrate' : 'Calibrate Scale'}
        </button>
        {isPageCalibrated && (
          <span className="text-xs text-gray-600">
            1px = {(scaleFactor * 0.0833).toFixed(4)} {unit}
          </span>
        )}
      </div>

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
      

      {/* Canvas Container */}
      <div 
        ref={containerRef}
        className="pdf-viewer-container"
        style={{ 
          cursor: isDragging ? 'grabbing' : (isMeasuring ? 'crosshair' : (isCalibrating ? 'crosshair' : 'grab')),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0,
          minHeight: 0,
          scrollSnapType: 'none',
          overflow: 'auto', // CRITICAL: Force overflow auto
          width: '100%',
          height: '100%',
          maxHeight: '100%', // CRITICAL: Constrain height to prevent expansion
          flex: '1 1 0' // CRITICAL: Take available space but don't grow beyond it
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* PDF Page Wrap */}
        <div className="pdf-page-wrap" style={{ position: 'relative', display: 'inline-block' }}>
          {/* PDF Canvas */}
          <canvas
            ref={canvasRef}
            className="pdf-canvas"
            style={{
              display: 'block',
              willChange: 'transform'
            }}
          />
          
          {/* Annotation Canvas */}
          <canvas
            ref={annotationCanvasRef}
            className={isMeasuring || isCalibrating ? "pointer-events-auto" : "pointer-events-none"}
            style={{
              position: 'absolute',
              top: 0,
              left: 0
            }}
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
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

export default PDFViewerWithAnnotations;
