import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import CalibrationDialog from './CalibrationDialog';
import ScaleApplicationDialog from './ScaleApplicationDialog';
import { useTakeoffStore } from '../store/useTakeoffStore';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface CanvasPDFViewerProps {
  file: File | string | { 
    id: string; 
    projectId: string;
    originalName: string; 
    filename: string;
    path: string;
    size: number;
    mimetype: string;
    uploadedAt: string;
  };
  onCalibrationRequest?: () => void;
  onMeasurementRequest?: () => void;
  scaleFactor?: number;
  className?: string;
}

interface Point {
  x: number;
  y: number;
}

interface Measurement {
  id: string;
  type: 'area' | 'linear' | 'count';
  points: Point[];
  value?: number;
  unit?: string;
}

const CanvasPDFViewer: React.FC<CanvasPDFViewerProps> = ({
  file,
  onCalibrationRequest,
  onMeasurementRequest,
  scaleFactor = 1,
  className = ''
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [currentCalibrationPoint, setCurrentCalibrationPoint] = useState<Point | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const renderTaskRef = useRef<any>(null);
  const [calibrationData, setCalibrationData] = useState<{knownDistance: number, unit: string} | null>(null);
  const [showCalibrationDialog, setShowCalibrationDialog] = useState(false);
  const [calibrationSuccess, setCalibrationSuccess] = useState<string | null>(null);
  const [isPageCalibrated, setIsPageCalibrated] = useState(false);
  const [showScaleApplicationDialog, setShowScaleApplicationDialog] = useState(false);
  const [pendingScaleData, setPendingScaleData] = useState<{scaleFactor: number, unit: string} | null>(null);
  const [internalScaleFactor, setInternalScaleFactor] = useState(scaleFactor);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measurementType, setMeasurementType] = useState<'area' | 'linear' | 'count'>('linear');
  const [currentMeasurement, setCurrentMeasurement] = useState<Point[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);

  // Store methods for calibration persistence
  const { setCalibration, getCalibration } = useTakeoffStore();

  // Helper function to get projectId and sheetId from file
  const getFileIdentifiers = useCallback(() => {
    if (typeof file === 'object' && 'projectId' in file && 'id' in file) {
      return {
        projectId: (file as any).projectId,
        sheetId: (file as any).id
      };
    }
    return null;
  }, [file]);

  // Load PDF
  useEffect(() => {
    const loadPDF = async () => {
      try {
        setIsLoading(true);
        console.log('Loading PDF, file object:', file);
        console.log('File type:', typeof file);
        console.log('File keys:', file && typeof file === 'object' ? Object.keys(file) : 'N/A');
        
        let pdfData: ArrayBuffer | string;
        
        if (typeof file === 'string') {
          pdfData = file;
        } else if ('arrayBuffer' in file) {
          pdfData = await file.arrayBuffer();
        } else if ('id' in file) {
          // Use the API endpoint to get the file
          const baseUrl = 'http://localhost:4000';
          pdfData = `${baseUrl}/api/files/${(file as any).id}`;
          console.log('Loading PDF from API endpoint:', pdfData);
        } else {
          throw new Error('Unsupported file type');
        }
        
        console.log('Creating PDF loading task...');
        const loadingTask = pdfjsLib.getDocument(pdfData);
        
        // Add progress tracking
        loadingTask.onProgress = (progress) => {
          console.log('PDF loading progress:', progress);
        };
        
        console.log('Waiting for PDF to load...');
        const pdf = await loadingTask.promise;
        console.log('PDF loaded successfully:', pdf);
        console.log('PDF numPages:', pdf.numPages);
        
        setPdfDocument(pdf);
        setTotalPages(pdf.numPages);
        setCurrentPage(1);
        
        // Initialize with fit-to-screen
        setTimeout(() => fitToScreen(), 100);
      } catch (error) {
        console.error('Error loading PDF:', error);
        console.error('Error details:', {
          name: error.name,
          message: error.message,
          stack: error.stack
        });
        setPdfDocument(null);
      } finally {
        setIsLoading(false);
      }
    };

    if (file) {
      loadPDF();
    }
  }, [file]);

  // Load saved calibration when PDF is loaded
  useEffect(() => {
    if (pdfDocument && currentPage) {
      const identifiers = getFileIdentifiers();
      if (identifiers) {
        const savedCalibration = getCalibration(identifiers.projectId, identifiers.sheetId);
        if (savedCalibration) {
          console.log('Loading saved calibration:', savedCalibration);
          setInternalScaleFactor(savedCalibration.scaleFactor);
          setIsPageCalibrated(true);
        }
      }
    }
  }, [pdfDocument, currentPage, getFileIdentifiers, getCalibration]);

  // Fit PDF to screen
  const fitToScreen = useCallback(() => {
    if (!containerRef.current || !pdfDocument) return;
    
    const container = containerRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    pdfDocument.getPage(currentPage).then(page => {
      const viewport = page.getViewport({ scale: 1 });
      const pdfWidth = viewport.width;
      const pdfHeight = viewport.height;
      
      // Calculate zoom to fit PDF in container with padding
      const padding = 40;
      const scaleX = (containerWidth - padding) / pdfWidth;
      const scaleY = (containerHeight - padding) / pdfHeight;
      const newZoom = Math.min(scaleX, scaleY, 5); // Max zoom 500%
      
      setZoom(newZoom);
      
      // Center the PDF
      const centeredPanX = (containerWidth - pdfWidth * newZoom) / 2;
      const centeredPanY = (containerHeight - pdfHeight * newZoom) / 2;
      
      setPan({ x: centeredPanX, y: centeredPanY });
    });
  }, [pdfDocument, currentPage, scaleFactor]);

  // Render PDF page
  useEffect(() => {
    if (!pdfDocument || !currentPage || !canvasRef.current) return;
    
    let isCancelled = false;
    
    const renderPage = async () => {
      try {
        // Cancel any existing render task
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }
        
        const page = await pdfDocument.getPage(currentPage);
        const viewport = page.getViewport({ scale: zoom });
        
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d')!;
        
        // Check if we've been cancelled
        if (isCancelled) return;
        
        // Set canvas size to a reasonable size for display
        // Use a moderate scale factor for crisp rendering without being too large
        const displayScale = 3; // 3x scale for crisp rendering
        const maxCanvasSize = 4000; // Maximum canvas dimension to prevent performance issues
        
        let canvasWidth = viewport.width * displayScale;
        let canvasHeight = viewport.height * displayScale;
        
        // Scale down if canvas is too large
        if (canvasWidth > maxCanvasSize || canvasHeight > maxCanvasSize) {
          const scaleDown = Math.min(maxCanvasSize / canvasWidth, maxCanvasSize / canvasHeight);
          canvasWidth *= scaleDown;
          canvasHeight *= scaleDown;
        }
        
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        
        const actualScale = canvasWidth / viewport.width;
        
        
        // Set CSS size to fit within container (zoom handled by CSS transform)
        const container = containerRef.current;
        if (container) {
          const containerWidth = container.clientWidth;
          const containerHeight = container.clientHeight - 64; // Account for toolbar
          
          // Calculate initial scale to fit within container
          const scaleX = containerWidth / canvas.width;
          const scaleY = containerHeight / canvas.height;
          const initialScale = Math.min(scaleX, scaleY);
          
          // Set canvas size to initial fit (zoom will be handled by CSS transform)
          canvas.style.width = `${canvas.width * initialScale}px`;
          canvas.style.height = `${canvas.height * initialScale}px`;
          
          
        } else {
          // Fallback if container not available
          canvas.style.width = `${canvas.width}px`;
          canvas.style.height = `${canvas.height}px`;
        }
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Scale the context for crisp rendering
        ctx.scale(actualScale, actualScale);
        
        // Apply rotation
        if (rotation !== 0) {
          ctx.save();
          ctx.translate(viewport.width / 2, viewport.height / 2);
          ctx.rotate((rotation * Math.PI) / 180);
          ctx.translate(-viewport.width / 2, -viewport.height / 2);
        }
        
        // Render PDF page
        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
          canvas: canvas
        };
        
        // Check again if we've been cancelled before starting render
        if (isCancelled) {
          ctx.restore();
          return;
        }
        
        console.log('Starting PDF page render...');
        renderTaskRef.current = page.render(renderContext);
        
        // Add progress tracking for rendering
        renderTaskRef.current.onProgress = (progress: any) => {
          console.log('PDF render progress:', progress);
        };
        
        await renderTaskRef.current.promise;
        console.log('PDF page rendered successfully');
        
        // Verify canvas has content by checking if it's not blank
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hasContent = imageData.data.some((value, index) => index % 4 !== 3 && value !== 0); // Check RGB channels, ignore alpha
        console.log('Canvas content verification:', { hasContent, canvasSize: `${canvas.width}x${canvas.height}` });
        
        ctx.restore();
        
      } catch (error: any) {
        if (error.name !== 'RenderingCancelled' && !isCancelled) {
          console.error('Error rendering page:', error);
          console.error('Render error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
          });
        }
      } finally {
        renderTaskRef.current = null;
      }
    };

    renderPage();

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdfDocument, currentPage, zoom, scaleFactor, rotation]);

  // Reset calibration status when page changes
  useEffect(() => {
    setIsPageCalibrated(false);
  }, [currentPage]);

  // Cleanup animation frame and render task on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, []);



  // Wheel event handler
  const handleWheelEvent = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    
    if (e.ctrlKey || e.metaKey) {
      // Zoom towards mouse position
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(5, zoom * delta));
      
      // Get mouse position relative to container
      const rect = containerRef.current!.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Calculate new pan to zoom towards mouse position
      const scaleChange = newZoom / zoom;
      const newPanX = mouseX - (mouseX - pan.x) * scaleChange;
      const newPanY = mouseY - (mouseY - pan.y) * scaleChange;
      
      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    } else {
      // Pan with scroll wheel
      
      if (isShiftPressed) {
        // Shift + scroll = horizontal panning
        setPan(prev => ({ ...prev, x: prev.x - e.deltaY }));
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Natural horizontal scroll = horizontal panning
        setPan(prev => ({ ...prev, x: prev.x - e.deltaX }));
      } else {
        // Regular scroll = vertical panning
        setPan(prev => ({ ...prev, y: prev.y - e.deltaY }));
      }
    }
  }, [zoom, pan.x, pan.y, isShiftPressed]);

  // Fix passive event listener warnings for wheel events
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheelNonPassive = (e: WheelEvent) => {
      e.preventDefault();
      handleWheelEvent(e as any);
    };

    container.addEventListener('wheel', handleWheelNonPassive, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheelNonPassive);
    };
  }, [handleWheelEvent]);

  // Measurement handlers (moved before handleMouseDown to avoid hoisting issues)
  const completeMeasurement = useCallback((points: Point[]) => {
    const measurement: Measurement = {
      id: Date.now().toString(),
      type: measurementType,
      points: [...points],
      unit: 'ft'
    };
    
    if (measurementType === 'linear' && points.length === 2) {
      const dx = points[1].x - points[0].x;
      const dy = points[1].y - points[0].y;
      measurement.value = Math.sqrt(dx * dx + dy * dy) * scaleFactor;
    } else if (measurementType === 'area' && points.length >= 3) {
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
      }
      measurement.value = Math.abs(area) * 0.5 * scaleFactor * scaleFactor;
    }
    
    setMeasurements(prev => [...prev, measurement]);
    setCurrentMeasurement([]);
    setIsMeasuring(false);
  }, [measurementType, internalScaleFactor]);

  const handleMeasurementClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    const canvas = canvasRef.current!;
    
    // Account for CSS scaling and zoom transform
    const cssScale = canvas.getBoundingClientRect().width / canvas.width;
    const x = (e.clientX - rect.left - pan.x) / (zoom * cssScale);
    const y = (e.clientY - rect.top - pan.y) / (zoom * cssScale);
    
    const newPoint = { x, y };
    const newPoints = [...currentMeasurement, newPoint];
    
    setCurrentMeasurement(newPoints);
    
    if (measurementType === 'linear' && newPoints.length === 2) {
      completeMeasurement(newPoints);
    }
  }, [currentMeasurement, pan, zoom, measurementType, completeMeasurement]);

  // Calibration handlers
  const handleCalibrationClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current || !calibrationData) {
      return;
    }
    
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    const canvas = canvasRef.current;
    
    // Account for CSS scaling and zoom transform
    const cssScale = canvas.getBoundingClientRect().width / canvas.width;
    const x = (e.clientX - rect.left - pan.x) / (zoom * cssScale);
    const y = (e.clientY - rect.top - pan.y) / (zoom * cssScale);
    
    const newPoint = { x, y };
    const newPoints = [...calibrationPoints, newPoint];
    
    setCalibrationPoints(newPoints);
    setCurrentCalibrationPoint(null);
    
    if (newPoints.length === 2) {
      // Calculate the actual scale factor based on pixel distance and known distance
      const pixelDistance = Math.sqrt(
        Math.pow(newPoints[1].x - newPoints[0].x, 2) + 
        Math.pow(newPoints[1].y - newPoints[0].y, 2)
      );
      
      // Validate that the points are far enough apart (at least 10 pixels)
      if (pixelDistance < 10) {
        console.warn('Calibration points too close together, please select points further apart');
        setCalibrationPoints([]);
        return;
      }
      
      const newScaleFactor = calibrationData.knownDistance / pixelDistance;
      
      // Validate that the scale factor is reasonable (between 0.001 and 1000)
      if (newScaleFactor < 0.001 || newScaleFactor > 1000) {
        console.warn('Calibration resulted in unreasonable scale factor:', newScaleFactor);
        setCalibrationPoints([]);
        return;
      }
      
      console.log('Calibration complete:', { 
        newScaleFactor, 
        unit: calibrationData.unit, 
        knownDistance: calibrationData.knownDistance, 
        pixelDistance 
      });
      
      // Store the scale data for the application dialog
      setPendingScaleData({ scaleFactor: newScaleFactor, unit: calibrationData.unit });
      
      // Reset calibration state
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      setCalibrationPoints([]);
      setCurrentCalibrationPoint(null);
      setIsCalibrating(false);
      setCalibrationData(null);
      setShowCalibrationDialog(false);
      
      // Show scale application dialog
      setShowScaleApplicationDialog(true);
    }
  }, [calibrationPoints, pan.x, pan.y, zoom, calibrationData, onCalibrationRequest]);

  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isCalibrating || isMeasuring) {
      e.preventDefault();
      e.stopPropagation();
      
      if (isCalibrating) {
        handleCalibrationClick(e);
      } else if (isMeasuring) {
        handleMeasurementClick(e);
      }
    } else {
      setIsDragging(true);
      setDragStart({ 
        x: e.clientX, 
        y: e.clientY 
      });
    }
  }, [isCalibrating, isMeasuring, pan.x, pan.y, handleCalibrationClick, handleMeasurementClick]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) {
      // Calculate pan delta and apply it to current pan position
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      
      setPan(prevPan => ({ 
        x: prevPan.x + deltaX, 
        y: prevPan.y + deltaY 
      }));
      
      // Update drag start to current position for smooth dragging
      setDragStart({ x: e.clientX, y: e.clientY });
    } else if (isMeasuring && currentMeasurement.length > 0) {
      const container = containerRef.current!;
      const rect = container.getBoundingClientRect();
      const canvas = canvasRef.current!;
      
      // Account for CSS scaling and zoom transform
      const cssScale = canvas.getBoundingClientRect().width / canvas.width;
      const x = (e.clientX - rect.left - pan.x) / (zoom * cssScale);
      const y = (e.clientY - rect.top - pan.y) / (zoom * cssScale);
      
      setCurrentMeasurement([...currentMeasurement.slice(0, -1), { x, y }]);
    } else if (isCalibrating && calibrationPoints.length > 0) {
      // Cancel any pending animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      // Use requestAnimationFrame for smooth updates
      animationFrameRef.current = requestAnimationFrame(() => {
        const container = containerRef.current!;
        const rect = container.getBoundingClientRect();
        const canvas = canvasRef.current!;
        
        // Account for CSS scaling
        const cssScale = canvas.getBoundingClientRect().width / canvas.width;
        const x = (e.clientX - rect.left - pan.x) / (zoom * cssScale);
        const y = (e.clientY - rect.top - pan.y) / (zoom * cssScale);
        
        setCurrentCalibrationPoint({ x, y });
        animationFrameRef.current = null;
      });
    }
  }, [isDragging, dragStart, isMeasuring, currentMeasurement, isCalibrating, calibrationPoints, pan.x, pan.y, zoom, internalScaleFactor]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Shift') {
      setIsShiftPressed(true);
    } else if (e.key === 'Escape') {
      // Cancel current operation
      if (isCalibrating) {
        // Cancel any pending animation frame
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        setCalibrationPoints([]);
        setCurrentCalibrationPoint(null);
        setIsCalibrating(false);
        setCalibrationData(null);
        setShowCalibrationDialog(false);
      } else if (isMeasuring) {
        setCurrentMeasurement([]);
        setIsMeasuring(false);
      }
    }
  }, [isCalibrating, isMeasuring]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Shift') {
      setIsShiftPressed(false);
    }
  }, []);

  // Measurement handlers

  // Drawing functions
  const drawMeasurements = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.save();
    
    measurements.forEach(measurement => {
      if (measurement.type === 'linear' && measurement.points.length === 2) {
        drawLinearMeasurement(ctx, measurement);
      } else if (measurement.type === 'area' && measurement.points.length >= 3) {
        drawAreaMeasurement(ctx, measurement);
      } else if (measurement.type === 'count' && measurement.points.length === 1) {
        drawCountMarker(ctx, measurement);
      }
    });
    
    ctx.restore();
  }, [measurements]);

  const drawLinearMeasurement = useCallback((ctx: CanvasRenderingContext2D, measurement: Measurement) => {
    const [p1, p2] = measurement.points;
    
    // Get CSS scale factor
    const canvas = canvasRef.current;
    const cssScale = canvas ? canvas.getBoundingClientRect().width / canvas.width : 1;
    
    // Convert PDF coordinates to canvas coordinates
    const screenP1 = {
      x: p1.x * cssScale,
      y: p1.y * cssScale
    };
    const screenP2 = {
      x: p2.x * cssScale,
      y: p2.y * cssScale
    };
    
    ctx.strokeStyle = '#0000ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(screenP1.x, screenP1.y);
    ctx.lineTo(screenP2.x, screenP2.y);
    ctx.stroke();
    
    if (measurement.value !== undefined) {
      const midX = (screenP1.x + screenP2.x) / 2;
      const midY = (screenP1.y + screenP2.y) / 2;
      
      ctx.fillStyle = '#000000';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`${measurement.value.toFixed(2)} ft`, midX, midY - 10);
    }
  }, [zoom, scaleFactor, pan]);

  const drawAreaMeasurement = useCallback((ctx: CanvasRenderingContext2D, measurement: Measurement) => {
    if (measurement.points.length < 3) return;
    
    // Account for the buffer offset in canvas coordinates
    const bufferSize = 100;
    
    const screenPoints = measurement.points.map(p => ({
      x: p.x * zoom * scaleFactor + pan.x + bufferSize,
      y: p.y * zoom * scaleFactor + pan.y + bufferSize
    }));
    
    ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    screenPoints.forEach(point => {
      ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    if (measurement.value !== undefined) {
      const centerX = screenPoints.reduce((sum, p) => sum + p.x, 0) / screenPoints.length;
      const centerY = screenPoints.reduce((sum, p) => sum + p.y, 0) / screenPoints.length;
      
      ctx.fillStyle = '#000000';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`${measurement.value.toFixed(2)} sq ft`, centerX, centerY);
    }
  }, [zoom, scaleFactor, pan]);

  const drawCountMarker = useCallback((ctx: CanvasRenderingContext2D, measurement: Measurement) => {
    const point = measurement.points[0];
    
    // Account for the buffer offset in canvas coordinates
    const bufferSize = 100;
    
    const screenX = point.x * zoom * scaleFactor + pan.x + bufferSize;
    const screenY = point.y * zoom * scaleFactor + pan.y + bufferSize;
    
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(screenX, screenY, 8, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('1', screenX, screenY + 4);
  }, [zoom, scaleFactor, pan]);

  const drawCalibrationPoints = useCallback((ctx: CanvasRenderingContext2D) => {
    if (calibrationPoints.length === 0) return;
    
    ctx.save();
    
    // Account for the buffer offset in canvas coordinates
    const bufferSize = 100;
    
    // Draw calibration points with better styling
    calibrationPoints.forEach((point, index) => {
      const screenX = point.x * zoom * scaleFactor + pan.x + bufferSize;
      const screenY = point.y * zoom * scaleFactor + pan.y + bufferSize;
      
      // Draw point with orange color for calibration
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(screenX, screenY, 6, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw white border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Draw point number
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((index + 1).toString(), screenX, screenY);
    });
    
    // Draw line between points and to current mouse position
    if (calibrationPoints.length >= 1) {
      const lastPoint = calibrationPoints[calibrationPoints.length - 1];
      const screenP1 = {
        x: lastPoint.x * cssScale,
        y: lastPoint.y * cssScale
      };
      const screenP2 = {
        x: currentCalibrationPoint.x * cssScale,
        y: currentCalibrationPoint.y * cssScale
      };
      
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 5]);
      ctx.beginPath();
      ctx.moveTo(screenP1.x, screenP1.y);
      
      if (calibrationPoints.length === 2) {
        // Draw line to second point
        const p2 = calibrationPoints[1];
        const screenP2 = {
          x: p2.x * zoom * internalScaleFactor + pan.x + bufferSize,
          y: p2.y * zoom * internalScaleFactor + pan.y + bufferSize
        };
        ctx.lineTo(screenP2.x, screenP2.y);
      } else if (currentCalibrationPoint) {
        // Draw line to current mouse position
        const screenP2 = {
          x: currentCalibrationPoint.x * zoom * internalScaleFactor + pan.x + bufferSize,
          y: currentCalibrationPoint.y * zoom * internalScaleFactor + pan.y + bufferSize
        };
        ctx.lineTo(screenP2.x, screenP2.y);
      }
      
      ctx.stroke();
    }
    
    ctx.restore();
  }, [calibrationPoints, currentCalibrationPoint, zoom, internalScaleFactor, pan]);

  const drawCurrentMeasurement = useCallback((ctx: CanvasRenderingContext2D) => {
    if (currentMeasurement.length === 0) return;
    
    ctx.save();
    
    // Account for the buffer offset in canvas coordinates
    const bufferSize = 100;
    
    currentMeasurement.forEach((point, index) => {
      const screenX = point.x * zoom * scaleFactor + pan.x + bufferSize;
      const screenY = point.y * zoom * scaleFactor + pan.y + bufferSize;
      
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.arc(screenX, screenY, 4, 0, 2 * Math.PI);
      ctx.fill();
    });
    
    if (currentMeasurement.length > 1) {
      const screenPoints = currentMeasurement.map(p => ({
        x: p.x * zoom * scaleFactor + pan.x,
        y: p.y * zoom * scaleFactor + pan.y
      }));
      
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      
      ctx.beginPath();
      ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      screenPoints.forEach(point => {
        ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      
      ctx.setLineDash([]);
    }
    
    ctx.restore();
  }, [currentMeasurement, zoom, scaleFactor, pan]);

  // Separate effect for drawing overlay elements without interfering with PDF rendering
  useEffect(() => {
    if (!canvasRef.current || !pdfDocument) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Only draw overlays if PDF is already rendered
    const drawOverlays = () => {
      // Check if canvas has content (PDF has been rendered)
      if (canvas.width === 0 || canvas.height === 0) return;
      
      drawMeasurements(ctx);
      if (isCalibrating) {
        drawCalibrationPoints(ctx);
      }
      if (isMeasuring && currentMeasurement.length > 0) {
        drawCurrentMeasurement(ctx);
      }
    };
    
    // Use a small delay to ensure PDF rendering is complete
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(drawOverlays);
    }, 50);
    
    return () => clearTimeout(timeoutId);
  }, [calibrationPoints, currentCalibrationPoint, isCalibrating, measurements, currentMeasurement, isMeasuring, pdfDocument, drawMeasurements, drawCalibrationPoints, drawCurrentMeasurement]);

  // Public methods
  const startCalibration = useCallback((knownDistance: number, unit: string) => {
    // Ensure knownDistance is a number
    const numericDistance = Number(knownDistance);
    if (isNaN(numericDistance) || numericDistance <= 0) {
      console.error('Invalid knownDistance:', knownDistance);
      return;
    }
    
    setIsCalibrating(true);
    setCalibrationPoints([]);
    setCalibrationData({ knownDistance: numericDistance, unit });
    setShowCalibrationDialog(false);
    setIsPageCalibrated(false); // Reset calibration status when starting new calibration
  }, []);

  const startMeasurement = useCallback((type: 'area' | 'linear' | 'count') => {
    setIsMeasuring(true);
    setMeasurementType(type);
    setCurrentMeasurement([]);
  }, []);

  const handleScaleApplication = useCallback((scope: 'page' | 'document') => {
    if (!pendingScaleData) return;
    
    // Store the current pan position before applying scale
    const oldScaleFactor = internalScaleFactor;
    const newScaleFactor = pendingScaleData.scaleFactor;
    
    // Calculate the scale change ratio
    const scaleRatio = newScaleFactor / oldScaleFactor;
    
    // Adjust pan position to maintain the same visual position
    const adjustedPanX = pan.x * scaleRatio;
    const adjustedPanY = pan.y * scaleRatio;
    
    // Apply the scale factor and adjusted pan position
      setInternalScaleFactor(newScaleFactor);
      setPan({ x: adjustedPanX, y: adjustedPanY });
    
    // Mark page as calibrated
    setIsPageCalibrated(true);
    
    // Save calibration to store for persistence
    const identifiers = getFileIdentifiers();
    if (identifiers) {
      setCalibration(identifiers.projectId, identifiers.sheetId, newScaleFactor, pendingScaleData.unit);
      console.log('Saved calibration to store:', {
        projectId: identifiers.projectId,
        sheetId: identifiers.sheetId,
        scaleFactor: newScaleFactor,
        unit: pendingScaleData.unit
      });
    }
    
    // Show success message
    const scaleInInches = (pendingScaleData.scaleFactor * 0.0833).toFixed(4);
    setCalibrationSuccess(`Scale applied to ${scope === 'page' ? 'current page' : 'entire document'}: 1 pixel = ${scaleInInches} ${pendingScaleData.unit}`);
    
    // Clear success message after 3 seconds
    setTimeout(() => setCalibrationSuccess(null), 3000);
    
    // Notify parent component of successful calibration
    onCalibrationRequest?.();
    
    // Reset pending data
    setPendingScaleData(null);
  }, [pendingScaleData, internalScaleFactor, pan.x, pan.y, onCalibrationRequest, getFileIdentifiers, setCalibration]);

  const clearMeasurements = useCallback(() => {
    setMeasurements([]);
  }, []);

  const getCalibrationPoints = useCallback(() => {
    return calibrationPoints;
  }, [calibrationPoints]);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-64 bg-gray-100 ${className}`}>
        <div className="text-center">
          <div className="text-gray-500 mb-2">Loading PDF...</div>
        </div>
      </div>
    );
  }

  if (!pdfDocument) {
    return (
      <div className={`flex items-center justify-center h-64 bg-gray-100 ${className}`}>
        <div className="text-center">
          <div className="text-gray-500 mb-2">Failed to load PDF</div>
        </div>
      </div>
    );
  }


  return (
    <div className={`relative ${className}`} ref={containerRef} style={{ overflow: 'hidden' }}>
      {/* Professional Menu Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shadow-sm">
        {/* Left side - Navigation */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage <= 1}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="px-3 py-1.5 bg-gray-50 text-gray-600 rounded text-sm font-medium">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage >= totalPages}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>

        {/* Center - Zoom and Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setZoom(prev => Math.max(0.1, prev * 0.8))}
            className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
            title="Zoom Out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM7 10h6" />
            </svg>
          </button>
          
          <span className="px-3 py-1.5 bg-gray-50 text-gray-600 rounded text-sm font-medium min-w-[60px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          
          <button
            onClick={() => setZoom(prev => Math.min(5, prev * 1.2))}
            className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
            title="Zoom In"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
            </svg>
          </button>

          <div className="w-px h-6 bg-gray-300 mx-2"></div>

          <button
            onClick={fitToScreen}
            className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
            title="Fit to Screen"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>

          <div className="w-px h-6 bg-gray-300 mx-2"></div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowCalibrationDialog(true)}
              className={`p-2 rounded transition-colors ${
                isCalibrating 
                  ? 'bg-yellow-100 hover:bg-yellow-200 text-yellow-700' 
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
              title="Calibrate Scale"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
              </svg>
            </button>
            
            {/* Scale Status Indicator */}
            <div 
              className={`w-2 h-2 rounded-full transition-colors ${
                isPageCalibrated 
                  ? 'bg-green-500' 
                  : 'bg-red-500'
              }`}
              title={isPageCalibrated ? 'Page is calibrated' : 'Page needs calibration'}
            />
          </div>

          <div className="w-px h-6 bg-gray-300 mx-2"></div>

          <button
            onClick={() => setRotation(prev => (prev + 90) % 360)}
            className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
            title="Rotate 90° Clockwise"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {scaleFactor !== 1 && (
            <div className="px-3 py-1.5 bg-green-50 border border-green-200 rounded text-sm text-green-700">
              Scale: {scaleFactor.toFixed(4)}
            </div>
          )}
        </div>
      </div>

      {/* Canvas Container */}
      <div 
        className="pt-16 flex-1 overflow-hidden relative"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onDoubleClick={(e) => {
          e.preventDefault();
          if (isMeasuring && measurementType === 'area' && currentMeasurement.length >= 3) {
            completeMeasurement(currentMeasurement);
          }
        }}
        style={{ 
          cursor: isCalibrating ? 'crosshair' : isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none'
        }}
        tabIndex={0}
      >
        <div 
          className="relative"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            transition: isDragging ? 'none' : 'transform 0.1s ease-out'
          }}
        >
          <canvas
            ref={canvasRef}
            className="block border border-gray-200"
            style={{ 
              display: 'block',
              maxWidth: '100%',
              maxHeight: '100%',
              imageRendering: 'crisp-edges'
            }}
          />
          
        </div>
      </div>

      {/* Success Message */}
      {calibrationSuccess && (
        <div className="absolute top-4 right-4 bg-green-500 text-white px-4 py-2 rounded shadow-lg">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium">{calibrationSuccess}</span>
          </div>
        </div>
      )}

      {/* Status Bar */}
      {(isCalibrating || isMeasuring) && (
        <div className="absolute bottom-4 left-4 bg-white border border-gray-200 px-3 py-2 rounded shadow-sm">
          <div className="text-sm text-gray-600">
            {isCalibrating && (
              <div className="text-yellow-600 font-medium">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                  <span>
                    Calibrating: {calibrationPoints.length}/2 points
                    {calibrationData && ` (${Number(calibrationData.knownDistance).toFixed(3)} ${calibrationData.unit})`}
                  </span>
                </div>
                {calibrationPoints.length === 0 && (
                  <div className="text-xs text-yellow-500 mt-1">
                    Click the first point on the known distance
                  </div>
                )}
                {calibrationPoints.length === 1 && (
                  <div className="text-xs text-yellow-500 mt-1">
                    Click the second point to complete calibration
                  </div>
                )}
              </div>
            )}
            {isMeasuring && (
              <div className="text-blue-600 font-medium">
                Measuring ({measurementType}): {currentMeasurement.length} points
                {measurementType === 'linear' && currentMeasurement.length === 1 && ' - Click for second point'}
                {measurementType === 'area' && currentMeasurement.length >= 3 && ' - Double-click to complete'}
                {measurementType === 'count' && currentMeasurement.length === 1 && ' - Count marker placed'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Measurements Summary */}
      {measurements.length > 0 && (
        <div className="absolute top-20 right-4 bg-white border border-gray-200 p-3 rounded shadow-sm max-w-xs">
          <div className="text-sm font-semibold mb-2 text-gray-700">Measurements</div>
          {measurements.map(measurement => (
            <div key={measurement.id} className="text-xs mb-1 text-gray-600">
              {measurement.type}: {measurement.value?.toFixed(2)} {measurement.unit}
            </div>
          ))}
        </div>
      )}

      {/* Calibration Dialog */}
      <CalibrationDialog
        isOpen={showCalibrationDialog}
        onClose={() => {
          setShowCalibrationDialog(false);
          setCalibrationPoints([]);
          setIsCalibrating(false);
          setCalibrationData(null);
        }}
        onStartCalibration={startCalibration}
        currentScale={internalScaleFactor !== 1 ? { scaleFactor: internalScaleFactor, unit: 'ft' } : null}
        isCalibrating={isCalibrating}
      />

      <ScaleApplicationDialog
        isOpen={showScaleApplicationDialog}
        onClose={() => {
          setShowScaleApplicationDialog(false);
          setPendingScaleData(null);
        }}
        onApply={handleScaleApplication}
        scaleFactor={pendingScaleData?.scaleFactor || 1}
        unit={pendingScaleData?.unit || 'ft'}
        currentPage={currentPage}
        totalPages={pdfDocument?.numPages || 1}
      />
    </div>
  );
};

export default CanvasPDFViewer;
