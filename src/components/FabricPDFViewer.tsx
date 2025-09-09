import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Canvas, Circle, Line, Polygon, Text, Image, Point, Rect } from 'fabric';
import * as fabric from 'fabric';
import * as pdfjsLib from 'pdfjs-dist';
import { useTakeoffStore } from '../store/useTakeoffStore';
import CalibrationDialog from './CalibrationDialog';
import ScaleApplicationDialog from './ScaleApplicationDialog';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
console.log('PDF.js worker configured:', pdfjsLib.GlobalWorkerOptions.workerSrc);

interface FabricPDFViewerProps {
  file: File | string | any;
  className?: string;
  onCalibrationRequest?: () => void;
}

interface Measurement {
  id: string;
  type: 'linear' | 'area' | 'count';
  points: { x: number; y: number }[];
  value?: number;
  unit?: string;
  conditionId?: string;
}

const FabricPDFViewer: React.FC<FabricPDFViewerProps> = ({ 
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
  
  // Navigation state
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // Measurement state
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measurementType, setMeasurementType] = useState<'linear' | 'area' | 'volume' | 'count'>('linear');
  const [currentMeasurement, setCurrentMeasurement] = useState<{ x: number; y: number }[]>([]);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<{ x: number; y: number }[]>([]);
  const [currentCalibrationPoint, setCurrentCalibrationPoint] = useState<{ x: number; y: number } | null>(null);
  
  // Scale and calibration
  const [internalScaleFactor, setInternalScaleFactor] = useState(1);
  const [isPageCalibrated, setIsPageCalibrated] = useState(false);
  const [calibrationSuccess, setCalibrationSuccess] = useState<string | null>(null);
  const [showCalibrationDialog, setShowCalibrationDialog] = useState(false);
  const [showScaleApplicationDialog, setShowScaleApplicationDialog] = useState(false);
  const [pendingScaleData, setPendingScaleData] = useState<{scaleFactor: number, unit: string} | null>(null);
  const [calibrationData, setCalibrationData] = useState<{knownDistance: number, unit: string} | null>(null);
  
  // Selection state
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<Canvas | null>(null);
  
  // Refs for current state to avoid stale closures
  const isCalibratingRef = useRef(false);
  const isMeasuringRef = useRef(false);
  const calibrationPointsRef = useRef<{ x: number; y: number }[]>([]);
  const calibrationDataRef = useRef<{knownDistance: number, unit: string} | null>(null);
  const currentMeasurementRef = useRef<{ x: number; y: number }[]>([]);
  const selectedConditionIdRef = useRef<string | null>(null);
  
  // Store methods
  const { 
    setCalibration, 
    getCalibration, 
    addTakeoffMeasurement, 
    deleteTakeoffMeasurement,
    getSheetTakeoffMeasurements,
    selectedConditionId,
    conditions
  } = useTakeoffStore();

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

  // Load PDF using PDF.js
  useEffect(() => {
    const loadPDF = async () => {
      try {
        setIsLoading(true);
        setError(null);
        console.log('=== STARTING PDF LOAD ===');
        console.log('Loading PDF with PDF.js for Fabric.js viewer, file object:', file);
        
        let pdfData: ArrayBuffer | string;
        
        if (typeof file === 'string') {
          // Handle URL
          pdfData = file;
        } else if ('arrayBuffer' in file) {
          // Handle File object
          pdfData = await file.arrayBuffer();
        } else if ('id' in file) {
          // Handle API file object
          const baseUrl = 'http://localhost:4000';
          console.log('Fetching PDF from API:', `${baseUrl}/api/files/${(file as any).id}`);
          const response = await fetch(`${baseUrl}/api/files/${(file as any).id}`);
          if (!response.ok) {
            throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
          }
          pdfData = await response.arrayBuffer();
          console.log('PDF fetched successfully, size:', pdfData.byteLength);
        } else {
          throw new Error('Unsupported file type');
        }
        
        // Load with PDF.js
        console.log('Loading PDF with PDF.js...');
        const loadingTask = pdfjsLib.getDocument(pdfData);
        
        // Add progress tracking
        loadingTask.onProgress = (progress: any) => {
          console.log('PDF loading progress:', progress);
        };
        
        const pdfjs = await loadingTask.promise;
        console.log('=== PDF LOADED SUCCESSFULLY ===');
        console.log('PDF loaded successfully with PDF.js:', pdfjs);
        console.log('PDF pages:', pdfjs.numPages);
        
        setPdfjsDocument(pdfjs);
        setTotalPages(pdfjs.numPages);
        setCurrentPage(1);
        
        console.log('PDF document state set, triggering render...');
        
        // Initialize with fit-to-screen
        setTimeout(() => fitToScreen(), 100);
        
      } catch (error) {
        console.error('Error loading PDF:', error);
        console.error('Error details:', {
          name: (error as any).name,
          message: (error as any).message,
          stack: (error as any).stack
        });
        setError(`Failed to load PDF: ${(error as any).message || 'Unknown error'}`);
        setPdfjsDocument(null);
      } finally {
        setIsLoading(false);
      }
    };

    if (file) {
      loadPDF();
    }
  }, [file]);

  // Function to reload measurements when viewport changes
  const reloadMeasurements = useCallback(() => {
    if (!pdfjsDocument || !currentPage || !fabricCanvasRef.current) return;
    
    const identifiers = getFileIdentifiers();
    if (!identifiers) return;
    
    const existingMeasurements = getSheetTakeoffMeasurements(identifiers.projectId, identifiers.sheetId);
    console.log('Reloading measurements for viewport change:', existingMeasurements);
    
    // Clear existing measurement objects from canvas
    const fabricCanvas = fabricCanvasRef.current;
    const measurementObjects = fabricCanvas.getObjects().filter(obj => (obj as any).data?.measurementId);
    measurementObjects.forEach(obj => fabricCanvas.remove(obj));
    
    // Re-render all measurements with current viewport
    existingMeasurements.forEach(takeoffMeasurement => {
      if (takeoffMeasurement.pdfPage === currentPage) {
        const condition = conditions.find(c => c.id === takeoffMeasurement.conditionId);
        if (condition) {
          const conditionColor = condition.color || '#0000ff';
          
          // Convert PDF-relative coordinates back to canvas coordinates
          const pdfImage = fabricCanvas.getObjects().find(obj => (obj as any).isPDF);
          let points = takeoffMeasurement.points;
          
          if (pdfImage && takeoffMeasurement.pdfCoordinates) {
            // Get PDF dimensions and viewport transform
            const pdfWidth = pdfImage.width!;
            const pdfHeight = pdfImage.height!;
            const vpt = fabricCanvas.viewportTransform;
            
            if (vpt && vpt.length >= 6) {
              // Convert PDF-relative coordinates back to canvas coordinates
              const scaleX = vpt[0];
              const scaleY = vpt[3];
              const translateX = vpt[4];
              const translateY = vpt[5];
              
              points = takeoffMeasurement.pdfCoordinates.map(pdfPoint => {
                const canvasX = pdfPoint.x * scaleX * pdfWidth + translateX;
                const canvasY = pdfPoint.y * scaleY * pdfHeight + translateY;
                return { x: canvasX, y: canvasY };
              });
            }
          }
          
          // Re-render the measurement (same logic as in the existing measurements loading)
          if (takeoffMeasurement.type === 'count' && points.length >= 1) {
            const point = points[0];
            
            const circle = new Circle({
              left: point.x - 8,
              top: point.y - 8,
              radius: 8,
              fill: conditionColor,
              stroke: conditionColor,
              strokeWidth: 2,
              selectable: false,
              evented: false,
              excludeFromExport: true
            });
            (circle as any).data = { measurementId: takeoffMeasurement.id, type: 'count' };
            
            const text = new Text('1', {
              left: point.x - 3,
              top: point.y - 3,
              fontSize: 12,
              fill: 'white',
              selectable: false,
              evented: false,
              excludeFromExport: true
            });
            (text as any).data = { measurementId: takeoffMeasurement.id, type: 'count' };
            
            fabricCanvas.add(circle, text);
            
          } else if (takeoffMeasurement.type === 'linear' && points.length >= 2) {
            const lineSegments: any[] = [];
            for (let i = 0; i < points.length - 1; i++) {
              const line = new Line([points[i].x, points[i].y, points[i + 1].x, points[i + 1].y], {
                stroke: conditionColor,
                strokeWidth: 4,
                selectable: true,  // Allow selection for deletion
                evented: true,     // Allow events for selection
                excludeFromExport: true,
                // Lock transformations to prevent accidental modification
                lockMovementX: true,
                lockMovementY: true,
                lockRotation: true,
                lockScalingX: true,
                lockScalingY: true
              });
              (line as any).data = { measurementId: takeoffMeasurement.id, type: 'linear', segmentIndex: i };
              lineSegments.push(line);
            }
            
            const lastPoint = points[points.length - 1];
            const label = new Text(`${takeoffMeasurement.calculatedValue?.toFixed(2) || '0.00'} ${takeoffMeasurement.unit || 'ft'}`, {
              left: lastPoint.x + 10,
              top: lastPoint.y - 10,
              fontSize: 12,
              fill: '#000000',
              selectable: true,
              evented: true,
              excludeFromExport: true,
              lockMovementX: true,
              lockMovementY: true,
              lockRotation: true,
              lockScalingX: true,
              lockScalingY: true
            });
            (label as any).data = { measurementId: takeoffMeasurement.id, type: 'linear' };
            
            fabricCanvas.add(...lineSegments, label);
            
          } else if (takeoffMeasurement.type === 'area' && points.length >= 3) {
            const polygonPoints = points.map(p => ({ x: p.x, y: p.y }));
            
            const polygon = new Polygon(polygonPoints, {
              fill: `${conditionColor}40`, // Increased transparency for better visibility
              stroke: conditionColor,
              strokeWidth: 3,  // Increased stroke width for better visibility
              selectable: true,
              evented: true,
              excludeFromExport: true,
              lockMovementX: true,
              lockMovementY: true,
              lockRotation: true,
              lockScalingX: true,
              lockScalingY: true,
              // Ensure polygon is filled properly
              fillRule: 'nonzero'
            });
            (polygon as any).data = { measurementId: takeoffMeasurement.id, type: 'area' };
            
            const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
            const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
            
            let labelText = `${takeoffMeasurement.calculatedValue?.toFixed(2) || '0.00'} ${takeoffMeasurement.unit || 'sq ft'}`;
            if (takeoffMeasurement.perimeterValue && takeoffMeasurement.perimeterValue > 0) {
              labelText += `\n${takeoffMeasurement.perimeterValue.toFixed(2)} LF`;
            }
            
            const label = new Text(labelText, {
              left: centerX,
              top: centerY,
              fontSize: 12,
              fill: '#000000',
              selectable: false,
              evented: false,
              excludeFromExport: true
            });
            (label as any).data = { measurementId: takeoffMeasurement.id, type: 'area' };
            
            fabricCanvas.add(polygon, label);
          }
        }
      }
    });
    
    fabricCanvas.renderAll();
  }, [pdfjsDocument, currentPage, getFileIdentifiers, getSheetTakeoffMeasurements, conditions]);

  // Wheel handler for zoom and pan
  const handleWheel = useCallback((e: WheelEvent) => {
    console.log('Wheel event:', { 
      deltaY: e.deltaY, 
      deltaX: e.deltaX, 
      shiftKey: e.shiftKey, 
      ctrlKey: e.ctrlKey, 
      metaKey: e.metaKey 
    });
    
    e.preventDefault();
    e.stopPropagation();
    
    if (!fabricCanvasRef.current) return;
    
    const fabricCanvas = fabricCanvasRef.current;
    
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd + Wheel: Zoom
      console.log('Zooming with Ctrl/Cmd + wheel');
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const currentZoom = fabricCanvas.getZoom();
      const newZoom = Math.max(0.1, Math.min(5, currentZoom * delta));
      
      // Get mouse position relative to canvas
      const rect = fabricCanvas.getElement().getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Zoom towards mouse position
      const zoomPoint = new fabric.Point(mouseX, mouseY);
      fabricCanvas.zoomToPoint(zoomPoint, newZoom);
      
      setZoom(newZoom);
      fabricCanvas.renderAll();
      
      // Reload measurements to update their positions
      setTimeout(() => reloadMeasurements(), 50);
      
    } else if (e.shiftKey) {
      // Shift + Wheel: Pan horizontally
      console.log('Horizontal panning with Shift + wheel');
      const panDelta = e.deltaY * 0.5;
      const vpt = fabricCanvas.viewportTransform;
      if (vpt && vpt.length >= 6) {
        const newVpt: [number, number, number, number, number, number] = [
          vpt[0], vpt[1], vpt[2], vpt[3], vpt[4] - panDelta, vpt[5]
        ];
        fabricCanvas.setViewportTransform(newVpt);
        fabricCanvas.renderAll();
        
        // Reload measurements to update their positions
        setTimeout(() => reloadMeasurements(), 50);
      }
    } else {
      // Regular Wheel: Pan vertically (up/down)
      console.log('Vertical panning with regular wheel');
      const panDelta = e.deltaY * 0.5;
      const vpt = fabricCanvas.viewportTransform;
      if (vpt && vpt.length >= 6) {
        const newVpt: [number, number, number, number, number, number] = [
          vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5] - panDelta
        ];
        fabricCanvas.setViewportTransform(newVpt);
        fabricCanvas.renderAll();
        
        // Reload measurements to update their positions
        setTimeout(() => reloadMeasurements(), 50);
      }
    }
  }, [reloadMeasurements]);

  // Global wheel event listener for debugging
  useEffect(() => {
    const handleGlobalWheel = (e: WheelEvent) => {
      console.log('=== GLOBAL WHEEL EVENT ===');
      console.log('Global wheel event:', { 
        deltaY: e.deltaY, 
        deltaX: e.deltaX, 
        shiftKey: e.shiftKey, 
        ctrlKey: e.ctrlKey, 
        metaKey: e.metaKey,
        target: e.target,
        currentTarget: e.currentTarget
      });
    };

    // Add global wheel event listener
    document.addEventListener('wheel', handleGlobalWheel, { passive: false });

    return () => {
      document.removeEventListener('wheel', handleGlobalWheel);
    };
  }, []);

  // Container wheel event listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContainerWheel = (e: WheelEvent) => {
      console.log('=== CONTAINER WHEEL EVENT ===');
      console.log('Container wheel event:', { 
        deltaY: e.deltaY, 
        deltaX: e.deltaX, 
        shiftKey: e.shiftKey, 
        ctrlKey: e.ctrlKey, 
        metaKey: e.metaKey,
        target: e.target
      });

      // Only handle if not measuring or calibrating
      if (!isMeasuring && !isCalibrating) {
        e.preventDefault();
        e.stopPropagation();
        
        if (!fabricCanvasRef.current) return;
        
        const fabricCanvas = fabricCanvasRef.current;
        
        if (e.ctrlKey || e.metaKey) {
          // Ctrl/Cmd + Wheel: Zoom
          console.log('Container: Zooming with Ctrl/Cmd + wheel');
          const delta = e.deltaY > 0 ? 0.9 : 1.1;
          const currentZoom = fabricCanvas.getZoom();
          const newZoom = Math.max(0.1, Math.min(5, currentZoom * delta));
          
          // Get mouse position relative to canvas
          const rect = fabricCanvas.getElement().getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          
          // Zoom towards mouse position
          const zoomPoint = new fabric.Point(mouseX, mouseY);
          fabricCanvas.zoomToPoint(zoomPoint, newZoom);
          
          setZoom(newZoom);
          fabricCanvas.renderAll();
          
          // Reload measurements to update their positions
          setTimeout(() => reloadMeasurements(), 50);
          
        } else if (e.shiftKey) {
          // Shift + Wheel: Pan horizontally
          console.log('Container: Horizontal panning with Shift + wheel, deltaY:', e.deltaY);
          const panDelta = e.deltaY * 0.5;
          console.log('Container: Calculated panDelta:', panDelta);
          
          const vpt = fabricCanvas.viewportTransform;
          console.log('Container: Current viewport transform:', vpt);
          
          if (vpt && vpt.length >= 6) {
            const newVpt: [number, number, number, number, number, number] = [
              vpt[0], vpt[1], vpt[2], vpt[3], vpt[4] - panDelta, vpt[5]
            ];
            console.log('Container: New viewport transform:', newVpt);
            
            fabricCanvas.setViewportTransform(newVpt);
            fabricCanvas.renderAll();
            
            // Reload measurements to update their positions
            setTimeout(() => reloadMeasurements(), 50);
            
            console.log('Container: Horizontal pan applied successfully');
          } else {
            console.log('Container: Invalid viewport transform');
          }
        } else {
          // Regular Wheel: Pan vertically (up/down)
          console.log('Container: Vertical panning with regular wheel');
          const panDelta = e.deltaY * 0.5;
          const vpt = fabricCanvas.viewportTransform;
          if (vpt && vpt.length >= 6) {
            const newVpt: [number, number, number, number, number, number] = [
              vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5] - panDelta
            ];
            fabricCanvas.setViewportTransform(newVpt);
            fabricCanvas.renderAll();
            
            // Reload measurements to update their positions
            setTimeout(() => reloadMeasurements(), 50);
          }
        }
      }
    };

    // Add container wheel event listener
    container.addEventListener('wheel', handleContainerWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleContainerWheel);
    };
  }, [isMeasuring, isCalibrating, reloadMeasurements]);

  // Initialize Fabric.js canvas
  useEffect(() => {
    const initializeCanvas = () => {
      console.log('=== CANVAS INITIALIZATION DEBUG ===');
      console.log('canvasRef.current:', !!canvasRef.current);
      console.log('containerRef.current:', !!containerRef.current);
      
      if (!canvasRef.current || !containerRef.current) {
        console.log('Canvas or container not ready yet, retrying in 100ms...');
        setTimeout(initializeCanvas, 100);
        return;
      }
      
      const canvas = canvasRef.current;
      const container = containerRef.current;
      
      console.log('Initializing Fabric.js canvas...');
      console.log('Container size:', container.clientWidth, 'x', container.clientHeight);
      console.log('Canvas element:', canvas);
      
      try {
        // Create Fabric.js canvas with proper settings for PDF manipulation
        const fabricCanvas = new Canvas(canvas, {
          width: container.clientWidth,
          height: container.clientHeight, // Use full container height
          selection: false, // Disable selection by default
          preserveObjectStacking: true,
          allowTouchScrolling: false,
          fireRightClick: true,
          stopContextMenu: false,
          // Enable object manipulation
          uniScaleTransform: false,
          centeredScaling: false,
          centeredRotation: false,
          backgroundColor: 'white', // Clean white background
          // Enable proper event handling
          enablePointerEvents: false, // Disable pointer events by default
          skipTargetFind: true, // Skip target finding by default
        });
        
        console.log('Fabric.js canvas created:', fabricCanvas);
        console.log('Canvas element:', canvas);
        console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);
        console.log('Fabric canvas dimensions:', fabricCanvas.width, 'x', fabricCanvas.height);
        fabricCanvasRef.current = fabricCanvas;
        
        console.log('=== CANVAS INITIALIZATION SUCCESS ===');
        console.log('fabricCanvasRef.current set to:', !!fabricCanvasRef.current);
      
        // Set up event handlers - only for measurement objects, not for panning
        fabricCanvas.on('mouse:dblclick', handleFabricDoubleClick);
        fabricCanvas.on('selection:created', handleObjectSelection);
        fabricCanvas.on('selection:updated', handleObjectSelection);
        fabricCanvas.on('selection:cleared', handleObjectDeselection);
        
        // Only add mouse events for measuring/calibration mode
        const handleFabricMouseDownWrapper = (options: any) => {
          const currentIsCalibrating = isCalibratingRef.current;
          const currentIsMeasuring = isMeasuringRef.current;
          
          // Only handle Fabric.js mouse events when in measuring or calibration mode
          if (currentIsCalibrating || currentIsMeasuring) {
            handleFabricMouseDown(options);
          } else {
            // Prevent Fabric.js from handling mouse events when not measuring
            options.e.preventDefault();
            options.e.stopPropagation();
          }
        };
        
        const handleFabricMouseMoveWrapper = (options: any) => {
          const currentIsCalibrating = isCalibratingRef.current;
          const currentIsMeasuring = isMeasuringRef.current;
          
          // Only handle Fabric.js mouse events when in measuring or calibration mode
          if (currentIsCalibrating || currentIsMeasuring) {
            handleFabricMouseMove(options);
          } else {
            // Prevent Fabric.js from handling mouse events when not measuring
            options.e.preventDefault();
            options.e.stopPropagation();
          }
        };
        
        fabricCanvas.on('mouse:down', handleFabricMouseDownWrapper);
        fabricCanvas.on('mouse:move', handleFabricMouseMoveWrapper);
        fabricCanvas.on('mouse:up', handleFabricMouseUp);
        
        // Add wheel event for zoom and pan
        const canvasElement = fabricCanvas.getElement();
        canvasElement.addEventListener('wheel', handleWheel, { passive: false });
        
        // Also add wheel event to the container for better coverage
        container.addEventListener('wheel', handleWheel, { passive: false });
        
        // Simple mouse event handlers for middle mouse button
        const handleMiddleMouseDown = (e: MouseEvent) => {
          if (e.button === 1) { // Middle mouse button
            e.preventDefault();
            setIsDragging(true);
            setDragStart({ x: e.clientX, y: e.clientY });
          }
        };
        
        const handleMiddleMouseUp = (e: MouseEvent) => {
          if (e.button === 1) { // Middle mouse button
            e.preventDefault();
            setIsDragging(false);
          }
        };
        
        canvasElement.addEventListener('mousedown', handleMiddleMouseDown);
        canvasElement.addEventListener('mouseup', handleMiddleMouseUp);
        container.addEventListener('mousedown', handleMiddleMouseDown);
        container.addEventListener('mouseup', handleMiddleMouseUp);
      
        return () => {
          // Remove event listeners
          const canvasElement = fabricCanvas.getElement();
          canvasElement.removeEventListener('wheel', handleWheel);
          container.removeEventListener('wheel', handleWheel);
          canvasElement.removeEventListener('mousedown', handleMiddleMouseDown);
          canvasElement.removeEventListener('mouseup', handleMiddleMouseUp);
          container.removeEventListener('mousedown', handleMiddleMouseDown);
          container.removeEventListener('mouseup', handleMiddleMouseUp);
          fabricCanvas.dispose();
        };
      } catch (error) {
        console.error('Error creating Fabric.js canvas:', error);
        console.error('Error details:', {
          name: (error as any).name,
          message: (error as any).message,
          stack: (error as any).stack
        });
      }
    };
    
    // Add a small delay to ensure container is fully rendered
    const timeoutId = setTimeout(initializeCanvas, 100);
    
    return () => {
      clearTimeout(timeoutId);
    };
  }, [handleWheel]);


  // Separate effect to handle PDF rendering when canvas becomes ready
  useEffect(() => {
    if (!pdfjsDocument || !currentPage || !fabricCanvasRef.current) {
      return;
    }

    console.log('Canvas is now ready, triggering PDF render...');
    
    const renderPage = async () => {
      try {
        console.log('Starting PDF page render (canvas ready)...');
        const page = await pdfjsDocument.getPage(currentPage);
        
        // Render at high resolution (3x) for crisp display at any zoom level
        const renderScale = 3.0;
        const viewport = page.getViewport({ scale: renderScale });
        
        console.log('PDF page viewport (high-res):', viewport);
        
        const fabricCanvas = fabricCanvasRef.current!;
        
        // Create a temporary canvas to render PDF
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d')!;
        
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;
        
        console.log('Temporary canvas size:', tempCanvas.width, 'x', tempCanvas.height);
        
        // Render PDF to temporary canvas
        const renderContext = {
          canvasContext: tempCtx,
          viewport: viewport,
        };
        
        await page.render(renderContext).promise;
        console.log('PDF rendered to temporary canvas');
        
        // Convert to data URL and create Fabric.js image
        const dataURL = tempCanvas.toDataURL();
        console.log('Data URL length:', dataURL.length);
        
        // Don't render directly to canvas - let Fabric.js handle it
        
        // Create a fabric image from the data URL
        const htmlImage = new window.Image();
        htmlImage.onload = () => {
          console.log('PDF image loaded successfully!');
          console.log('HTML image dimensions:', htmlImage.width, 'x', htmlImage.height);
          console.log('HTML image src length:', htmlImage.src.length);
          try {
            // Clear any existing PDF images
            const existingImages = fabricCanvas.getObjects().filter(obj => (obj as any).isPDF);
            console.log('Clearing existing PDF images:', existingImages.length);
            existingImages.forEach(img => fabricCanvas.remove(img));
            
            // Create fabric image object as PDF background (fixed position)
            const fabricImage = new Image(htmlImage, {
              left: 0,
              top: 0,
              selectable: false,   // Disable selection to allow canvas panning
              evented: false,      // Disable events to allow canvas panning
              excludeFromExport: false,
              // Lock movement - PDF should not move, canvas viewport should move instead
              lockMovementX: true,
              lockMovementY: true,
              lockRotation: true,
              lockScalingX: true,
              lockScalingY: true,
              // Ensure it's visible
              opacity: 1,
              visible: true,
              // Add a custom property to identify this as the PDF
              isPDF: true,
              // Ensure PDF is behind all other objects
              moveTo: 0
            });
            
            console.log('Fabric image created:', fabricImage);
            console.log('Fabric image dimensions:', fabricImage.width, 'x', fabricImage.height);
            
            // Add the new PDF image
            fabricCanvas.add(fabricImage);
            console.log('PDF image added to canvas, total objects:', fabricCanvas.getObjects().length);
            
            // Test rectangle removed - focusing on PDF rendering
            
            // Set canvas size to match container
            const container = containerRef.current;
            if (container) {
              const containerWidth = container.clientWidth;
              const containerHeight = container.clientHeight; // Use full container height
              
              console.log('Container dimensions:', containerWidth, 'x', containerHeight);
              console.log('PDF viewport dimensions:', viewport.width, 'x', viewport.height);
              
              // Update canvas size
              fabricCanvas.setWidth(containerWidth);
              fabricCanvas.setHeight(containerHeight);
              
              // Calculate scale to fit PDF in container with padding
              const padding = 20; // Add padding to prevent cutoff
              const availableWidth = containerWidth - padding;
              const availableHeight = containerHeight - padding;
              
              // Since we rendered at 3x scale, we need to account for that
              const actualPdfWidth = viewport.width / renderScale;
              const actualPdfHeight = viewport.height / renderScale;
              
              const scaleX = availableWidth / actualPdfWidth;
              const scaleY = availableHeight / actualPdfHeight;
              const scale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 100%
              
              console.log('Calculated scale:', scale);
              
              // Reset PDF to original size and position
              fabricImage.set({
                left: 0,
                top: 0,
                scaleX: 1,
                scaleY: 1
              });
              
              // Center the PDF in the canvas using viewport transform
              const centerX = (containerWidth - actualPdfWidth * scale) / 2;
              const centerY = (containerHeight - actualPdfHeight * scale) / 2;
              
              console.log('PDF position:', centerX, centerY);
              
              // Set viewport transform to center and scale
              fabricCanvas.setViewportTransform([scale, 0, 0, scale, centerX, centerY]);
              setZoom(scale);
              
              // Force a re-render
              fabricCanvas.renderAll();
            }
            
            fabricCanvas.renderAll();
            
            console.log('PDF image added to Fabric.js canvas successfully');
            console.log('Total objects on canvas:', fabricCanvas.getObjects().length);
            console.log('PDF image final position:', fabricImage.left, fabricImage.top);
            console.log('PDF image final scale:', fabricImage.scaleX, fabricImage.scaleY);
          } catch (error) {
            console.error('Error adding PDF image to canvas:', error);
          }
        };
        htmlImage.onerror = (error) => {
          console.error('Error loading PDF image:', error);
          console.error('Image src:', htmlImage.src.substring(0, 100) + '...');
        };
        htmlImage.src = dataURL;
        
        console.log('PDF page rendered to Fabric.js canvas successfully');
        
      } catch (error) {
        console.error('Error rendering page to Fabric.js:', error);
      }
    };

    renderPage();
  }, [fabricCanvasRef.current, pdfjsDocument, currentPage]);

  // Debug: Log when PDF document changes
  useEffect(() => {
    console.log('PDF document state changed:', {
      pdfjsDocument: !!pdfjsDocument,
      currentPage,
      totalPages
    });
  }, [pdfjsDocument, currentPage, totalPages]);

  // Load existing measurements from store when PDF is loaded
  useEffect(() => {
    if (!pdfjsDocument || !currentPage || !fabricCanvasRef.current) return;
    
    const identifiers = getFileIdentifiers();
    if (!identifiers) return;
    
    const existingMeasurements = getSheetTakeoffMeasurements(identifiers.projectId, identifiers.sheetId);
    console.log('Loading existing measurements for Fabric viewer:', existingMeasurements);
    console.log('Current page:', currentPage, 'Total pages:', totalPages);
    
    // Clear existing measurement objects from canvas
    const fabricCanvas = fabricCanvasRef.current;
    const measurementObjects = fabricCanvas.getObjects().filter(obj => (obj as any).data?.measurementId);
    measurementObjects.forEach(obj => fabricCanvas.remove(obj));
    
    // Render existing measurements
    existingMeasurements.forEach(takeoffMeasurement => {
      console.log('Processing measurement:', { 
        id: takeoffMeasurement.id, 
        type: takeoffMeasurement.type, 
        pdfPage: takeoffMeasurement.pdfPage, 
        currentPage,
        points: takeoffMeasurement.points.length 
      });
      if (takeoffMeasurement.pdfPage === currentPage) {
        console.log('Measurement matches current page, rendering...');
        const condition = conditions.find(c => c.id === takeoffMeasurement.conditionId);
        if (condition) {
          const conditionColor = condition.color || '#0000ff';
          
          // Convert PDF-relative coordinates back to canvas coordinates
          const pdfImage = fabricCanvas.getObjects().find(obj => (obj as any).isPDF);
          let points = takeoffMeasurement.points;
          
          if (pdfImage && takeoffMeasurement.pdfCoordinates) {
            // Get PDF dimensions and viewport transform
            const pdfWidth = pdfImage.width!;
            const pdfHeight = pdfImage.height!;
            const vpt = fabricCanvas.viewportTransform;
            
            if (vpt && vpt.length >= 6) {
              // Convert PDF-relative coordinates back to canvas coordinates
              const scaleX = vpt[0];
              const scaleY = vpt[3];
              const translateX = vpt[4];
              const translateY = vpt[5];
              
              points = takeoffMeasurement.pdfCoordinates.map(pdfPoint => {
                const canvasX = pdfPoint.x * scaleX * pdfWidth + translateX;
                const canvasY = pdfPoint.y * scaleY * pdfHeight + translateY;
                return { x: canvasX, y: canvasY };
              });
            }
          }
          
          if (takeoffMeasurement.type === 'count' && points.length >= 1) {
            const point = points[0];
            
            // Add circle for count measurement
            const circle = new Circle({
              left: point.x - 8,
              top: point.y - 8,
              radius: 8,
              fill: conditionColor,
              stroke: conditionColor,
              strokeWidth: 2,
              selectable: false,
              evented: false,
              excludeFromExport: true
            });
            (circle as any).data = { measurementId: takeoffMeasurement.id, type: 'count' };
            
            // Add text
            const text = new Text('1', {
              left: point.x - 3,
              top: point.y - 3,
              fontSize: 12,
              fill: 'white',
              selectable: false,
              evented: false,
              excludeFromExport: true
            });
            (text as any).data = { measurementId: takeoffMeasurement.id, type: 'count' };
            
            fabricCanvas.add(circle, text);
            
          } else if (takeoffMeasurement.type === 'linear' && points.length >= 2) {
            
            // Create individual line segments for each pair of consecutive points (same as addMeasurementToFabric)
            const lineSegments: any[] = [];
            for (let i = 0; i < points.length - 1; i++) {
              const line = new Line([points[i].x, points[i].y, points[i + 1].x, points[i + 1].y], {
                stroke: conditionColor,
                strokeWidth: 4,
                selectable: false,
                evented: false,
                excludeFromExport: true
              });
              (line as any).data = { measurementId: takeoffMeasurement.id, type: 'linear', segmentIndex: i };
              lineSegments.push(line);
            }
            
            // Add measurement label at the end of the line
            const lastPoint = points[points.length - 1];
            const label = new Text(`${takeoffMeasurement.calculatedValue?.toFixed(2) || '0.00'} ${takeoffMeasurement.unit || 'ft'}`, {
              left: lastPoint.x + 10,
              top: lastPoint.y - 10,
              fontSize: 12,
              fill: '#000000',
              selectable: false,
              evented: false,
              excludeFromExport: true
            });
            (label as any).data = { measurementId: takeoffMeasurement.id, type: 'linear' };
            
            // Add all line segments and label to canvas
            fabricCanvas.add(...lineSegments, label);
            
          } else if (takeoffMeasurement.type === 'area' && points.length >= 3) {
            const polygonPoints = points.map(p => ({ x: p.x, y: p.y }));
            
            // Add polygon for area measurement
            const polygon = new Polygon(polygonPoints, {
              fill: `${conditionColor}40`, // Increased transparency for better visibility
              stroke: conditionColor,
              strokeWidth: 3,  // Increased stroke width for better visibility
              selectable: true,
              evented: true,
              excludeFromExport: true,
              lockMovementX: true,
              lockMovementY: true,
              lockRotation: true,
              lockScalingX: true,
              lockScalingY: true,
              // Ensure polygon is filled properly
              fillRule: 'nonzero'
            });
            (polygon as any).data = { measurementId: takeoffMeasurement.id, type: 'area' };
            
            // Add measurement label
            const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
            const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
            
            // Create label text with area and perimeter if available
            let labelText = `${takeoffMeasurement.calculatedValue?.toFixed(2) || '0.00'} ${takeoffMeasurement.unit || 'sq ft'}`;
            if (takeoffMeasurement.perimeterValue && takeoffMeasurement.perimeterValue > 0) {
              labelText += `\n${takeoffMeasurement.perimeterValue.toFixed(2)} LF`;
            }
            
            const label = new Text(labelText, {
              left: centerX,
              top: centerY,
              fontSize: 12,
              fill: '#000000',
              selectable: false,
              evented: false,
              excludeFromExport: true
            });
            (label as any).data = { measurementId: takeoffMeasurement.id, type: 'area' };
            
            fabricCanvas.add(polygon, label);
          }
        }
      }
    });
    
    fabricCanvas.renderAll();
  }, [pdfjsDocument, currentPage, getFileIdentifiers, conditions]);

  // Update measurement type when condition is selected
  useEffect(() => {
    console.log('Condition selection useEffect triggered:', { selectedConditionId, conditionsCount: conditions.length });
    if (selectedConditionId) {
      const selectedCondition = conditions.find(c => c.id === selectedConditionId);
      console.log('Found selected condition:', selectedCondition);
      if (selectedCondition) {
        const conditionType = selectedCondition.type;
        console.log('Setting measurement type from condition:', conditionType);
        setMeasurementType(conditionType as 'linear' | 'area' | 'volume' | 'count');
        setIsMeasuring(true);
        isMeasuringRef.current = true;
        console.log('Condition selected, entering measuring mode:', selectedCondition);
        
        // PDF is now fixed position, no need to disable interaction
      }
    } else {
      setIsMeasuring(false);
      isMeasuringRef.current = false;
      console.log('No condition selected, exiting measuring mode');
      
      // Re-enable PDF object interaction
      // PDF is now fixed position, no need to re-enable interaction
    }
  }, [selectedConditionId, conditions]);
  
  // Update calibration ref when state changes
  useEffect(() => {
    isCalibratingRef.current = isCalibrating;
  }, [isCalibrating]);
  
  // Update measuring ref when state changes
  useEffect(() => {
    isMeasuringRef.current = isMeasuring;
    
    // Enable/disable Fabric.js interaction based on measuring state
    if (fabricCanvasRef.current) {
      const fabricCanvas = fabricCanvasRef.current;
      if (isMeasuring || isCalibrating) {
        // Enable Fabric.js interaction for measuring
        fabricCanvas.selection = true;
        fabricCanvas.enablePointerEvents = true;
        fabricCanvas.skipTargetFind = false;
      } else {
        // Disable Fabric.js interaction for panning
        fabricCanvas.selection = false;
        fabricCanvas.enablePointerEvents = false;
        fabricCanvas.skipTargetFind = true;
      }
    }
  }, [isMeasuring, isCalibrating]);
  
  // Update calibration points ref when state changes
  useEffect(() => {
    calibrationPointsRef.current = calibrationPoints;
  }, [calibrationPoints]);
  
  // Update calibration data ref when state changes
  useEffect(() => {
    calibrationDataRef.current = calibrationData;
  }, [calibrationData]);
  
  // Update current measurement ref when state changes
  useEffect(() => {
    currentMeasurementRef.current = currentMeasurement;
  }, [currentMeasurement]);

  // Update selected condition ID ref when state changes
  useEffect(() => {
    selectedConditionIdRef.current = selectedConditionId;
  }, [selectedConditionId]);

  // Fit PDF to screen
  const fitToScreen = useCallback(() => {
    if (!containerRef.current || !fabricCanvasRef.current) {
      console.log('fitToScreen: Missing dependencies', {
        container: !!containerRef.current,
        fabricCanvas: !!fabricCanvasRef.current
      });
      return;
    }
    
    const container = containerRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight; // Use full container height
    
    console.log('fitToScreen: Container dimensions', containerWidth, 'x', containerHeight);
    
    const fabricCanvas = fabricCanvasRef.current;
    
    // Find the PDF image object
    const pdfImage = fabricCanvas.getObjects().find(obj => (obj as any).isPDF);
    
    if (pdfImage) {
      // Get the original PDF dimensions (these are the high-res dimensions)
      const originalWidth = pdfImage.width!;
      const originalHeight = pdfImage.height!;
      
      console.log('fitToScreen: PDF original dimensions', originalWidth, 'x', originalHeight);
      
      // Calculate scale to fit in container with some padding
      const padding = 20; // Add padding to prevent cutoff
      const availableWidth = containerWidth - padding;
      const availableHeight = containerHeight - padding;
      
      // Since we rendered at 3x scale, we need to account for that
      const actualPdfWidth = originalWidth / 3.0;
      const actualPdfHeight = originalHeight / 3.0;
      
      const scaleX = availableWidth / actualPdfWidth;
      const scaleY = availableHeight / actualPdfHeight;
      const scale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 100%
      
      console.log('fitToScreen: Calculated scale', scale);
      
      // Reset PDF to original size and position
      pdfImage.set({
        left: 0,
        top: 0,
        scaleX: 1,
        scaleY: 1
      });
      
      // Center the PDF in the canvas using viewport transform
      const centerX = (containerWidth - actualPdfWidth * scale) / 2;
      const centerY = (containerHeight - actualPdfHeight * scale) / 2;
      
      // Set viewport transform to center and scale
      fabricCanvas.setViewportTransform([scale, 0, 0, scale, centerX, centerY]);
      setZoom(scale);
      fabricCanvas.renderAll();
      
      // Reload measurements to update their positions
      setTimeout(() => reloadMeasurements(), 50);
      
      console.log('fitToScreen: PDF repositioned and scaled using viewport transform');
    } else {
      console.log('fitToScreen: No PDF image found on canvas');
    }
  }, [reloadMeasurements]);

  // Helper function to update zoom state from canvas
  const updateZoomState = useCallback(() => {
    if (fabricCanvasRef.current) {
      const currentZoom = fabricCanvasRef.current.getZoom();
      setZoom(currentZoom);
    }
  }, []);




  // Measurement handlers
  const handleMeasurementClick = useCallback((x: number, y: number) => {
    const currentIsCalibrating = isCalibratingRef.current;
    const currentIsMeasuring = isMeasuringRef.current;
    console.log('handleMeasurementClick called with:', { x, y, isCalibrating: currentIsCalibrating, isMeasuring: currentIsMeasuring });
    
    if (!currentIsMeasuring && !currentIsCalibrating) {
      console.log('Not in measuring or calibrating mode, returning');
      return;
    }
    
    if (currentIsCalibrating) {
      console.log('In calibration mode, adding point:', { x, y });
      const currentPoints = calibrationPointsRef.current;
      const newPoints = [...currentPoints, { x, y }];
      console.log('New calibration points:', newPoints);
      console.log('Current calibrationPoints state:', currentPoints);
      setCalibrationPoints(newPoints);
      
      // Clear any existing calibration visual elements
      if (fabricCanvasRef.current) {
        const fabricCanvas = fabricCanvasRef.current;
        const calibrationObjects = fabricCanvas.getObjects().filter(obj => (obj as any).data?.isCalibration);
        calibrationObjects.forEach(obj => fabricCanvas.remove(obj));
        
        // Also remove temporary calibration line
        const tempLine = fabricCanvas.getObjects().find(obj => (obj as any).data?.isTempCalibrationLine);
        if (tempLine) {
          fabricCanvas.remove(tempLine);
        }
      }
      
      // Add visual feedback for calibration points
      if (fabricCanvasRef.current) {
        const fabricCanvas = fabricCanvasRef.current;
        
        // Add point markers
        newPoints.forEach((point, index) => {
          const circle = new Circle({
            left: point.x - 6,
            top: point.y - 6,
            radius: 6,
            fill: '#ff6b6b',
            stroke: '#ffffff',
            strokeWidth: 2,
            selectable: false,
            evented: false,
            excludeFromExport: true
          });
          (circle as any).data = { isCalibration: true };
          fabricCanvas.add(circle);
          
          // Add point labels
          const label = new Text(`${index + 1}`, {
            left: point.x - 3,
            top: point.y - 3,
            fontSize: 10,
            fill: '#ffffff',
            fontWeight: 'bold',
            selectable: false,
            evented: false,
            excludeFromExport: true
          });
          (label as any).data = { isCalibration: true };
          fabricCanvas.add(label);
        });
        
        // Draw line between points if we have 2 points
        if (newPoints.length === 2) {
          const line = new Line([newPoints[0].x, newPoints[0].y, newPoints[1].x, newPoints[1].y], {
            stroke: '#ff6b6b',
            strokeWidth: 3,
            selectable: false,
            evented: false,
            excludeFromExport: true
          });
          (line as any).data = { isCalibration: true };
          fabricCanvas.add(line);
          
          // Add distance label
          const midX = (newPoints[0].x + newPoints[1].x) / 2;
          const midY = (newPoints[0].y + newPoints[1].y) / 2;
          const pixelDistance = Math.sqrt(
            Math.pow(newPoints[1].x - newPoints[0].x, 2) + 
            Math.pow(newPoints[1].y - newPoints[0].y, 2)
          );
          
          const distanceLabel = new Text(`${pixelDistance.toFixed(1)}px`, {
            left: midX,
            top: midY - 20,
            fontSize: 12,
            fill: '#ff6b6b',
            fontWeight: 'bold',
            selectable: false,
            evented: false,
            excludeFromExport: true
          });
          (distanceLabel as any).data = { isCalibration: true };
          fabricCanvas.add(distanceLabel);
        }
        
        fabricCanvas.renderAll();
      }
      
      const currentCalibrationData = calibrationDataRef.current;
      console.log('Checking calibration completion:', { 
        newPointsLength: newPoints.length, 
        hasCalibrationData: !!currentCalibrationData,
        calibrationData: currentCalibrationData 
      });
      
      if (newPoints.length >= 2 && currentCalibrationData) {
        console.log('Calibration completion condition met, proceeding with scale calculation');
        // Calculate the actual scale factor based on pixel distance and known distance
        const pixelDistance = Math.sqrt(
          Math.pow(newPoints[1].x - newPoints[0].x, 2) + 
          Math.pow(newPoints[1].y - newPoints[0].y, 2)
        );
        
        // Validate that the points are far enough apart (at least 10 pixels)
        if (pixelDistance < 10) {
          console.warn('Calibration points too close together, please select points further apart');
          setCalibrationPoints([]);
          // Clear calibration visuals
          if (fabricCanvasRef.current) {
            const fabricCanvas = fabricCanvasRef.current;
            const calibrationObjects = fabricCanvas.getObjects().filter(obj => (obj as any).data?.isCalibration);
            calibrationObjects.forEach(obj => fabricCanvas.remove(obj));
            fabricCanvas.renderAll();
          }
          return;
        }
        
        const newScaleFactor = currentCalibrationData.knownDistance / pixelDistance;
        
        // Validate that the scale factor is reasonable (between 0.001 and 1000)
        if (newScaleFactor < 0.001 || newScaleFactor > 1000) {
          console.warn('Calibration resulted in unreasonable scale factor:', newScaleFactor);
          setCalibrationPoints([]);
          // Clear calibration visuals
          if (fabricCanvasRef.current) {
            const fabricCanvas = fabricCanvasRef.current;
            const calibrationObjects = fabricCanvas.getObjects().filter(obj => (obj as any).data?.isCalibration);
            calibrationObjects.forEach(obj => fabricCanvas.remove(obj));
            fabricCanvas.renderAll();
          }
          return;
        }
        
        console.log('Calibration complete:', { 
          newScaleFactor, 
          unit: currentCalibrationData.unit, 
          knownDistance: currentCalibrationData.knownDistance, 
          pixelDistance 
        });
        
        // Store the scale data for the application dialog
        setPendingScaleData({ scaleFactor: newScaleFactor, unit: currentCalibrationData.unit });
        
        // Reset calibration state
        setCalibrationPoints([]);
        setCurrentCalibrationPoint(null);
        setIsCalibrating(false);
        isCalibratingRef.current = false;
        setCalibrationData(null);
        
        // Re-enable PDF object interaction
        if (fabricCanvasRef.current) {
          const fabricCanvas = fabricCanvasRef.current;
          const pdfImage = fabricCanvas.getObjects().find(obj => (obj as any).isPDF);
          if (pdfImage) {
            pdfImage.set({
              selectable: true,
              evented: true
            });
            fabricCanvas.renderAll();
          }
        }
        
        // Show scale application dialog
        setShowScaleApplicationDialog(true);
      }
    } else if (currentIsMeasuring) {
      const currentPoints = currentMeasurementRef.current;
      const newPoints = [...currentPoints, { x, y }];
      console.log('Adding measurement point:', { x, y, newPointsLength: newPoints.length, measurementType });
      setCurrentMeasurement(newPoints);
      
      if (measurementType === 'count') {
        // Count measurements are single-click - add individual marker
        console.log('Adding count measurement marker');
        addMeasurementToFabric([{ x, y }], 'count');
        // Don't clear currentMeasurement or exit measuring mode for count
      } else {
        // For linear, area, and volume - just add the point, don't complete yet
        console.log('Added point to measurement:', { 
          measurementType, 
          currentPoints: newPoints.length,
          points: newPoints
        });
        
        // Add visual feedback for the current measurement points
        if (fabricCanvasRef.current) {
          const fabricCanvas = fabricCanvasRef.current;
          
          // Clear any existing temporary measurement visuals
          const tempObjects = fabricCanvas.getObjects().filter(obj => (obj as any).data?.isTempMeasurement);
          tempObjects.forEach(obj => fabricCanvas.remove(obj));
          
          // Add point markers for all current points (no labels)
          newPoints.forEach((point, index) => {
            const circle = new Circle({
              left: point.x - 4,
              top: point.y - 4,
              radius: 4,
              fill: '#ff6b6b',
              stroke: '#ffffff',
              strokeWidth: 2,
              selectable: false,
              evented: false,
              excludeFromExport: true
            });
            (circle as any).data = { isTempMeasurement: true };
            fabricCanvas.add(circle);
          });
          
          // Draw lines between points for linear measurements
          if (measurementType === 'linear' && newPoints.length > 1) {
            for (let i = 0; i < newPoints.length - 1; i++) {
              const line = new Line([newPoints[i].x, newPoints[i].y, newPoints[i + 1].x, newPoints[i + 1].y], {
                stroke: '#ff6b6b',
                strokeWidth: 2,
                strokeDashArray: [5, 5],
                selectable: false,
                evented: false,
                excludeFromExport: true
              });
              (line as any).data = { isTempMeasurement: true };
              fabricCanvas.add(line);
            }
          }
          
          fabricCanvas.renderAll();
        }
      }
    }
  }, [isMeasuring, isCalibrating, measurementType, currentMeasurement, calibrationData, addTakeoffMeasurement]);

  // Add measurement to Fabric.js canvas
  const addMeasurementToFabric = useCallback((points: { x: number; y: number }[], type: 'linear' | 'area' | 'volume' | 'count') => {
    console.log('addMeasurementToFabric called with:', { points, type });
    
    if (!fabricCanvasRef.current) {
      console.warn('Cannot add measurement: fabricCanvasRef.current is null');
      return;
    }
    
    const fabricCanvas = fabricCanvasRef.current;
    const identifiers = getFileIdentifiers();
    
    const currentSelectedConditionId = selectedConditionIdRef.current;
    console.log('File identifiers:', identifiers);
    console.log('Selected condition ID (from ref):', currentSelectedConditionId);
    console.log('All conditions:', conditions);
    console.log('Current store state:', useTakeoffStore.getState());
    
    if (!identifiers || !currentSelectedConditionId) {
      console.warn('Cannot add measurement: missing project/sheet ID or selected condition');
      console.warn('Identifiers:', identifiers);
      console.warn('Selected condition ID:', currentSelectedConditionId);
      return;
    }

    // Get current conditions from store to avoid stale closure
    const currentConditions = useTakeoffStore.getState().conditions;
    const selectedCondition = currentConditions.find(c => c.id === currentSelectedConditionId);
    console.log('Selected condition:', selectedCondition);
    console.log('Current conditions from store:', currentConditions);
    
    if (!selectedCondition) {
      console.warn('Cannot add measurement: selected condition not found');
      console.warn('Available condition IDs:', currentConditions.map(c => c.id));
      console.warn('Looking for condition ID:', currentSelectedConditionId);
      return;
    }

    // Calculate measurement value
    let calculatedValue = 0;
    let perimeterValue = 0;
    
    console.log('Calculating measurement value:', { type, points, internalScaleFactor });
    
    if (type === 'linear' && points.length >= 2) {
      // Calculate total length of multi-segment line in PDF-relative coordinates
      // This ensures the measurement is accurate regardless of zoom level
      let totalLength = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const dx = points[i + 1].x - points[i].x;
        const dy = points[i + 1].y - points[i].y;
        const segmentLength = Math.sqrt(dx * dx + dy * dy);
        totalLength += segmentLength;
        console.log(`Segment ${i}: dx=${dx}, dy=${dy}, length=${segmentLength}`);
      }
      
      // Convert to real-world units using the scale factor
      // The scale factor converts pixels to real-world units (e.g., feet)
      calculatedValue = totalLength * internalScaleFactor;
      console.log('Linear measurement calculation:', { 
        totalLength, 
        internalScaleFactor, 
        calculatedValue,
        points: points.length,
        pointsData: points
      });
    } else if (type === 'area' && points.length >= 3) {
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
      }
      calculatedValue = Math.abs(area) * 0.5 * internalScaleFactor * internalScaleFactor;
      
      // Calculate perimeter if condition includes it
      if (selectedCondition.includePerimeter) {
        let totalPerimeter = 0;
        for (let i = 0; i < points.length; i++) {
          const j = (i + 1) % points.length;
          const dx = points[j].x - points[i].x;
          const dy = points[j].y - points[i].y;
          const segmentLength = Math.sqrt(dx * dx + dy * dy);
          totalPerimeter += segmentLength;
        }
        perimeterValue = totalPerimeter * internalScaleFactor;
      }
    } else if (type === 'volume' && points.length >= 3) {
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
      }
      calculatedValue = Math.abs(area) * 0.5 * internalScaleFactor * internalScaleFactor;
    } else if (type === 'count') {
      calculatedValue = 1; // Each count marker represents 1 unit
    }

    // Store measurements in PDF-relative coordinates (0-1 scale) for persistence
    // This ensures measurements stay in the correct position relative to the PDF content
    const pdfImage = fabricCanvas.getObjects().find(obj => (obj as any).isPDF);
    let pdfCoordinates = points.map(point => ({ x: point.x, y: point.y }));
    
    if (pdfImage) {
      // Get PDF dimensions and viewport transform
      const pdfWidth = pdfImage.width!;
      const pdfHeight = pdfImage.height!;
      const vpt = fabricCanvas.viewportTransform;
      
      if (vpt && vpt.length >= 6) {
        // Convert canvas coordinates to PDF-relative coordinates (0-1 scale)
        pdfCoordinates = points.map(point => {
          const scaleX = vpt[0];
          const scaleY = vpt[3];
          const translateX = vpt[4];
          const translateY = vpt[5];
          
          // Convert to PDF-relative coordinates (0-1 scale)
          const pdfX = (point.x - translateX) / (scaleX * pdfWidth);
          const pdfY = (point.y - translateY) / (scaleY * pdfHeight);
          
          return { x: pdfX, y: pdfY };
        });
        
        console.log('Converting canvas to PDF coordinates:', {
          canvasPoints: points,
          pdfCoordinates: pdfCoordinates,
          viewportTransform: vpt,
          pdfDimensions: { width: pdfWidth, height: pdfHeight }
        });
      }
    }

    // Create takeoff measurement for the store
    // Store both canvas coordinates (for immediate rendering) and PDF-relative coordinates (for persistence)
    const takeoffMeasurement = {
      projectId: identifiers.projectId,
      sheetId: identifiers.sheetId,
      conditionId: currentSelectedConditionId,
      type: type,
      points: points, // Canvas coordinates for immediate rendering
      calculatedValue: calculatedValue,
      unit: selectedCondition.unit,
      pdfPage: currentPage,
      pdfCoordinates: pdfCoordinates, // PDF-relative coordinates for persistence
      conditionColor: selectedCondition.color,
      conditionName: selectedCondition.name,
      perimeterValue: perimeterValue > 0 ? perimeterValue : undefined
    };

    console.log('Saving takeoff measurement:', takeoffMeasurement);
    const measurementId = addTakeoffMeasurement(takeoffMeasurement);
    console.log('Measurement saved to store with ID:', measurementId);
    
    // Get condition color
    const conditionColor = selectedCondition.color || '#0000ff';
    
    if (type === 'count') {
      // Add circle for count measurement
      const circle = new Circle({
        left: points[0].x - 8,
        top: points[0].y - 8,
        radius: 8,
        fill: conditionColor,
        stroke: conditionColor,
        strokeWidth: 2,
        selectable: true,
        evented: true,
        excludeFromExport: true,
        lockMovementX: true,
        lockMovementY: true,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true
      });
      (circle as any).data = { measurementId, type: 'count' };
      
      // Add text
      const text = new Text('1', {
        left: points[0].x - 3,
        top: points[0].y - 3,
        fontSize: 12,
        fill: 'white',
        selectable: true,
        evented: true,
        excludeFromExport: true,
        lockMovementX: true,
        lockMovementY: true,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true
      });
      (text as any).data = { measurementId, type: 'count' };
      
      fabricCanvas.add(circle, text);
      
    } else if (type === 'linear' && points.length >= 2) {
      // Add multi-segment line for linear measurement
      console.log('Creating linear measurement with points:', points);
      
      // Create individual line segments for each pair of consecutive points
      const lineSegments: any[] = [];
      for (let i = 0; i < points.length - 1; i++) {
        const line = new Line([points[i].x, points[i].y, points[i + 1].x, points[i + 1].y], {
          stroke: conditionColor,
          strokeWidth: 4,
          selectable: true,  // Allow selection for deletion
          evented: true,     // Allow events for selection
          excludeFromExport: true,
          // Lock transformations to prevent accidental modification
          lockMovementX: true,
          lockMovementY: true,
          lockRotation: true,
          lockScalingX: true,
          lockScalingY: true
        });
        (line as any).data = { measurementId, type: 'linear', segmentIndex: i };
        lineSegments.push(line);
        console.log(`Created line segment ${i}:`, line);
      }
      
      // Add measurement label at the end of the line
      const lastPoint = points[points.length - 1];
      const label = new Text(`${calculatedValue.toFixed(2)} ${selectedCondition.unit}`, {
        left: lastPoint.x + 10,
        top: lastPoint.y - 10,
        fontSize: 12,
        fill: '#000000',
        selectable: true,
        evented: true,
        excludeFromExport: true,
        lockMovementX: true,
        lockMovementY: true,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true
      });
      (label as any).data = { measurementId, type: 'linear' };
      
      // Add all line segments and label to canvas
      fabricCanvas.add(...lineSegments, label);
      console.log(`Added ${lineSegments.length} line segments and label to canvas. Canvas objects:`, fabricCanvas.getObjects().length);
      console.log('Canvas objects after adding measurement:', fabricCanvas.getObjects().map(obj => ({ 
        type: obj.type, 
        measurementId: (obj as any).data?.measurementId,
        segmentIndex: (obj as any).data?.segmentIndex 
      })));
      
    } else if (type === 'area' && points.length >= 3) {
      // Add polygon for area measurement - Fabric.js automatically closes polygons
      const polygonPoints = points.map(p => ({ x: p.x, y: p.y }));
      
      const polygon = new Polygon(polygonPoints, {
        fill: `${conditionColor}40`, // Increased transparency for better visibility
        stroke: conditionColor,
        strokeWidth: 3,  // Increased stroke width for better visibility
        selectable: true,
        evented: true,
        excludeFromExport: true,
        lockMovementX: true,
        lockMovementY: true,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true,
        // Ensure polygon is filled properly
        fillRule: 'nonzero'
      });
      (polygon as any).data = { measurementId, type: 'area' };
      
      // Add measurement label
      const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
      
      // Create label text with area and perimeter if available
      let labelText = `${calculatedValue.toFixed(2)} ${selectedCondition.unit}`;
      if (perimeterValue > 0) {
        labelText += `\n${perimeterValue.toFixed(2)} LF`;
      }
      
      const label = new Text(labelText, {
        left: centerX,
        top: centerY,
        fontSize: 12,
        fill: '#000000',
        selectable: true,
        evented: true,
        excludeFromExport: true,
        lockMovementX: true,
        lockMovementY: true,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true
      });
      (label as any).data = { measurementId, type: 'area' };
      
      fabricCanvas.add(polygon, label);
      
    } else if (type === 'volume' && points.length >= 3) {
      // Add polygon for volume measurement (same as area but with different label)
      const polygonPoints = points.map(p => ({ x: p.x, y: p.y }));
      const polygon = new Polygon(polygonPoints, {
        fill: `${conditionColor}20`, // Less transparency for volume
        stroke: conditionColor,
        strokeWidth: 2,
        selectable: true,
        evented: true,
        excludeFromExport: true // Mark as measurement object
      });
      (polygon as any).data = { measurementId, type: 'volume' };
      
      // Add measurement label
      const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
      const label = new Text(`${calculatedValue.toFixed(2)} ${selectedCondition.unit}`, {
        left: centerX,
        top: centerY,
        fontSize: 12,
        fill: '#000000',
        selectable: true,
        evented: true,
        excludeFromExport: true,
        lockMovementX: true,
        lockMovementY: true,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true
      });
      (label as any).data = { measurementId, type: 'volume' };
      
      fabricCanvas.add(polygon, label);
    }
    
    console.log('Fabric objects added, total objects on canvas:', fabricCanvas.getObjects().length);
    console.log('Measurement objects on canvas:', fabricCanvas.getObjects().filter(obj => (obj as any).data?.measurementId));
    fabricCanvas.renderAll();
    console.log('Canvas rendered after adding measurement');
    
    return measurementId;
  }, [selectedConditionId, conditions, internalScaleFactor, currentPage, getFileIdentifiers, addTakeoffMeasurement]);

  // Double-click handler for completing measurements
  const handleFabricDoubleClick = useCallback((options: any) => {
    const currentIsMeasuring = isMeasuringRef.current;
    const currentPoints = currentMeasurementRef.current;
    
    if (currentIsMeasuring && currentPoints.length > 0) {
      console.log('Double-click detected, completing measurement with points:', currentPoints);
      
      if (measurementType === 'linear' && currentPoints.length >= 2) {
        console.log('Completing linear measurement with points:', currentPoints);
        const measurementId = addMeasurementToFabric(currentPoints, 'linear');
        console.log('Linear measurement created with ID:', measurementId);
        
        // For linear measurements, complete the entire continuous line and exit measuring mode
        setCurrentMeasurement([]);
        setIsMeasuring(false);
        isMeasuringRef.current = false;
        console.log('Linear measurement completed, exiting measuring mode');
      } else if (measurementType === 'area' && currentPoints.length >= 3) {
        console.log('Completing area measurement with points:', currentPoints);
        addMeasurementToFabric(currentPoints, 'area');
        
        // Clear current measurement and exit measuring mode for area/volume
        setCurrentMeasurement([]);
        setIsMeasuring(false);
        isMeasuringRef.current = false;
      } else if (measurementType === 'volume' && currentPoints.length >= 3) {
        console.log('Completing volume measurement with points:', currentPoints);
        addMeasurementToFabric(currentPoints, 'volume');
        
        // Clear current measurement and exit measuring mode for area/volume
        setCurrentMeasurement([]);
        setIsMeasuring(false);
        isMeasuringRef.current = false;
      } else {
        console.warn('Cannot complete measurement: insufficient points', {
          measurementType,
          pointCount: currentPoints.length,
          requiredPoints: measurementType === 'linear' ? 2 : 3
        });
        
        // Clear current measurement and exit measuring mode on error
        setCurrentMeasurement([]);
        setIsMeasuring(false);
        isMeasuringRef.current = false;
      }
      
      // Clear temporary measurement visuals
      if (fabricCanvasRef.current) {
        const fabricCanvas = fabricCanvasRef.current;
        const tempObjects = fabricCanvas.getObjects().filter(obj => (obj as any).data?.isTempMeasurement);
        tempObjects.forEach(obj => fabricCanvas.remove(obj));
        
        // Also clear temporary line
        const tempLine = fabricCanvas.getObjects().find(obj => (obj as any).data?.isTempLine);
        if (tempLine) {
          fabricCanvas.remove(tempLine);
        }
        
        // PDF is now fixed position, no need to re-enable interaction
        
        fabricCanvas.renderAll();
      }
    }
  }, [currentMeasurement, measurementType, addMeasurementToFabric]);

  // Fabric.js event handlers
  const handleFabricMouseDown = useCallback((options: any) => {
    const fabricCanvas = fabricCanvasRef.current!;
    const activeObject = fabricCanvas.findTarget(options.e);
    
    // Get current state values from refs to avoid stale closures
    const currentIsCalibrating = isCalibratingRef.current;
    const currentIsMeasuring = isMeasuringRef.current;
    
    console.log('Mouse down event:', {
      isCalibrating: currentIsCalibrating,
      isMeasuring: currentIsMeasuring,
      activeObject: activeObject ? { type: activeObject.type, isPDF: (activeObject as any).isPDF } : null
    });
    
    // If we're in calibration or measuring mode, always handle the click
    if (currentIsCalibrating || currentIsMeasuring) {
      const pointer = fabricCanvas.getPointer(options.e);
      // getPointer() already returns coordinates relative to the canvas, no need to transform
      console.log('In calibration/measuring mode, handling click at:', {
        pointer: pointer
      });
      handleMeasurementClick(pointer.x, pointer.y);
      return;
    }
    
    // Check if we clicked on a measurement object (only when not calibrating/measuring)
    if (activeObject && (activeObject as any).data?.measurementId) {
      // Clicked on a measurement - let Fabric.js handle selection
      console.log('Clicked on measurement object');
      return;
    }
    
    // Always start panning when clicking on empty space or PDF (since PDF is non-interactive)
    console.log('Starting canvas panning');
    setIsDragging(true);
    setDragStart({ 
      x: options.e.clientX, 
      y: options.e.clientY 
    });
    
    // Prevent default behavior to ensure panning works
    options.e.preventDefault();
  }, [handleMeasurementClick]);

  const handleFabricMouseMove = useCallback((options: any) => {
    if (isDragging) {
      // Handle canvas viewport panning with smooth movement
      const deltaX = options.e.clientX - dragStart.x;
      const deltaY = options.e.clientY - dragStart.y;
      
      const fabricCanvas = fabricCanvasRef.current!;
      const vpt = fabricCanvas.viewportTransform;
      if (vpt && vpt.length >= 6) {
        // Apply smooth panning with proper viewport transform
        const newVpt: [number, number, number, number, number, number] = [
          vpt[0], vpt[1], vpt[2], vpt[3], vpt[4] + deltaX, vpt[5] + deltaY
        ];
        fabricCanvas.setViewportTransform(newVpt);
        fabricCanvas.renderAll();
        
        // Reload measurements to update their positions
        setTimeout(() => reloadMeasurements(), 50);
      }
      
      setDragStart({ x: options.e.clientX, y: options.e.clientY });
    } else if (isMeasuring && currentMeasurementRef.current.length > 0) {
      const pointer = fabricCanvasRef.current!.getPointer(options.e);
      // Simple temporary line preview - just draw a line from last point to mouse position
      if (fabricCanvasRef.current) {
        const fabricCanvas = fabricCanvasRef.current;
        
        // Clear existing temporary line
        const tempLine = fabricCanvas.getObjects().find(obj => (obj as any).data?.isTempLine);
        if (tempLine) {
          fabricCanvas.remove(tempLine);
        }
        
        // Draw temporary line from last point to current mouse position
        const lastPoint = currentMeasurementRef.current[currentMeasurementRef.current.length - 1];
        const tempPreviewLine = new Line([lastPoint.x, lastPoint.y, pointer.x, pointer.y], {
          stroke: '#ff6b6b',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
          excludeFromExport: true
        });
        (tempPreviewLine as any).data = { isTempLine: true };
        fabricCanvas.add(tempPreviewLine);
        fabricCanvas.renderAll();
      }
    } else if (isCalibrating && calibrationPointsRef.current.length > 0) {
      const pointer = fabricCanvasRef.current!.getPointer(options.e);
      setCurrentCalibrationPoint({ x: pointer.x, y: pointer.y });
      
      // Draw temporary line from first point to current mouse position
      if (fabricCanvasRef.current && calibrationPointsRef.current.length === 1) {
        const fabricCanvas = fabricCanvasRef.current;
        
        // Remove any existing temporary calibration line
        const tempLine = fabricCanvas.getObjects().find(obj => (obj as any).data?.isTempCalibrationLine);
        if (tempLine) {
          fabricCanvas.remove(tempLine);
        }
        
        // Create temporary line from first point to current mouse position
        const firstPoint = calibrationPointsRef.current[0];
        const tempCalibrationLine = new Line([firstPoint.x, firstPoint.y, pointer.x, pointer.y], {
          stroke: '#ff6b6b',
          strokeWidth: 2,
          strokeDashArray: [5, 5], // Dashed line to indicate it's temporary
          selectable: false,
          evented: false,
          excludeFromExport: true
        });
        (tempCalibrationLine as any).data = { isTempCalibrationLine: true };
        fabricCanvas.add(tempCalibrationLine);
        fabricCanvas.renderAll();
      }
    }
  }, [isDragging, dragStart, isMeasuring, currentMeasurement, isCalibrating]);

  const handleFabricMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Object selection handlers
  const handleObjectSelection = useCallback((options: any) => {
    const activeObject = options.selected?.[0];
    if (activeObject && (activeObject as any).data?.measurementId) {
      setSelectedMeasurementId((activeObject as any).data.measurementId);
      console.log('Measurement selected:', (activeObject as any).data.measurementId);
    }
  }, []);

  const handleObjectDeselection = useCallback(() => {
    setSelectedMeasurementId(null);
    console.log('Measurement deselected');
  }, []);

  // Delete selected measurement
  const deleteSelectedMeasurement = useCallback(() => {
    if (!selectedMeasurementId || !fabricCanvasRef.current) return;
    
    const fabricCanvas = fabricCanvasRef.current;
    
    // Remove measurement objects from canvas
    const measurementObjects = fabricCanvas.getObjects().filter(obj => 
      (obj as any).data?.measurementId === selectedMeasurementId
    );
    measurementObjects.forEach(obj => fabricCanvas.remove(obj));
    
    // Remove from store
    console.log('Deleting measurement from store:', selectedMeasurementId);
    deleteTakeoffMeasurement(selectedMeasurementId);
    
    fabricCanvas.renderAll();
    setSelectedMeasurementId(null);
  }, [selectedMeasurementId, deleteTakeoffMeasurement]);


  // Start measurement
  const startMeasurement = useCallback((type: 'linear' | 'area' | 'volume' | 'count') => {
    setIsMeasuring(true);
    setMeasurementType(type);
    setCurrentMeasurement([]);
    setIsCalibrating(false);
  }, []);

  // Start calibration
  const startCalibration = useCallback((knownDistance: number, unit: string) => {
    // Ensure knownDistance is a number
    const numericDistance = Number(knownDistance);
    if (isNaN(numericDistance) || numericDistance <= 0) {
      console.error('Invalid knownDistance:', knownDistance);
      return;
    }
    
    // Clear any existing calibration visuals
    if (fabricCanvasRef.current) {
      const fabricCanvas = fabricCanvasRef.current;
      const calibrationObjects = fabricCanvas.getObjects().filter(obj => (obj as any).data?.isCalibration);
      calibrationObjects.forEach(obj => fabricCanvas.remove(obj));
      fabricCanvas.renderAll();
    }
    
    // Disable PDF object interaction during calibration
    if (fabricCanvasRef.current) {
      const fabricCanvas = fabricCanvasRef.current;
      const pdfImage = fabricCanvas.getObjects().find(obj => (obj as any).isPDF);
      console.log('PDF image found for calibration:', !!pdfImage);
      if (pdfImage) {
        console.log('Disabling PDF object interaction for calibration');
        pdfImage.set({
          selectable: false,
          evented: false
        });
        fabricCanvas.renderAll();
      } else {
        console.warn('No PDF image found on canvas during calibration start');
      }
    }
    
    setIsCalibrating(true);
    isCalibratingRef.current = true;
    setCalibrationPoints([]);
    setCalibrationData({ knownDistance: numericDistance, unit });
    setShowCalibrationDialog(false);
    setIsPageCalibrated(false); // Reset calibration status when starting new calibration
    setIsMeasuring(false);
    isMeasuringRef.current = false;
  }, []);

  // Load saved calibration when PDF is loaded
  useEffect(() => {
    if (pdfjsDocument && currentPage) {
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
  }, [pdfjsDocument, currentPage, getFileIdentifiers, getCalibration]);

  // Handle scale application
  const handleScaleApplication = useCallback((scope: 'page' | 'document') => {
    if (!pendingScaleData) return;
    
    const newScaleFactor = pendingScaleData.scaleFactor;
    
    // Apply the scale factor
    setInternalScaleFactor(newScaleFactor);
    
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
  }, [pendingScaleData, onCalibrationRequest, getFileIdentifiers, setCalibration]);

  // Keyboard handlers
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsMeasuring(false);
      isMeasuringRef.current = false;
      setIsCalibrating(false);
      isCalibratingRef.current = false;
      setCurrentMeasurement([]);
      setCalibrationPoints([]);
      setSelectedMeasurementId(null);
      
      // Clear all temporary visuals
      if (fabricCanvasRef.current) {
        const fabricCanvas = fabricCanvasRef.current;
        const calibrationObjects = fabricCanvas.getObjects().filter(obj => (obj as any).data?.isCalibration);
        calibrationObjects.forEach(obj => fabricCanvas.remove(obj));
        
        const tempMeasurementObjects = fabricCanvas.getObjects().filter(obj => (obj as any).data?.isTempMeasurement);
        tempMeasurementObjects.forEach(obj => fabricCanvas.remove(obj));
        
        // Also remove temporary calibration line
        const tempCalibrationLine = fabricCanvas.getObjects().find(obj => (obj as any).data?.isTempCalibrationLine);
        if (tempCalibrationLine) {
          fabricCanvas.remove(tempCalibrationLine);
        }
        
        // Also remove temporary measurement line
        const tempLine = fabricCanvas.getObjects().find(obj => (obj as any).data?.isTempLine);
        if (tempLine) {
          fabricCanvas.remove(tempLine);
        }
        
        // Re-enable PDF object interaction
        const pdfImage = fabricCanvas.getObjects().find(obj => (obj as any).isPDF);
        if (pdfImage) {
          pdfImage.set({
            selectable: true,
            evented: true
          });
        }
        
        fabricCanvas.renderAll();
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      // Delete selected measurement
      if (selectedMeasurementId) {
        deleteSelectedMeasurement();
      }
    } else if (e.key === 'f' || e.key === 'F') {
      fitToScreen();
    } else if (e.key === '+' || e.key === '=') {
      // Zoom in using viewport transform
      if (fabricCanvasRef.current) {
        const fabricCanvas = fabricCanvasRef.current;
        const currentZoom = fabricCanvas.getZoom();
        const newZoom = Math.min(5, currentZoom * 1.1);
        
        // Zoom towards center
        const centerX = fabricCanvas.width / 2;
        const centerY = fabricCanvas.height / 2;
        const zoomPoint = new fabric.Point(centerX, centerY);
        fabricCanvas.zoomToPoint(zoomPoint, newZoom);
        
        setZoom(newZoom);
        fabricCanvas.renderAll();
        
        // Reload measurements to update their positions
        setTimeout(() => reloadMeasurements(), 50);
      }
    } else if (e.key === '-') {
      // Zoom out using viewport transform
      if (fabricCanvasRef.current) {
        const fabricCanvas = fabricCanvasRef.current;
        const currentZoom = fabricCanvas.getZoom();
        const newZoom = Math.max(0.1, currentZoom * 0.9);
        
        // Zoom towards center
        const centerX = fabricCanvas.width / 2;
        const centerY = fabricCanvas.height / 2;
        const zoomPoint = new fabric.Point(centerX, centerY);
        fabricCanvas.zoomToPoint(zoomPoint, newZoom);
        
        setZoom(newZoom);
        fabricCanvas.renderAll();
        
        // Reload measurements to update their positions
        setTimeout(() => reloadMeasurements(), 50);
      }
    } else if (e.key === '0') {
      // Reset zoom to fit screen
      fitToScreen();
    }
  }, [fitToScreen, zoom, selectedMeasurementId, deleteSelectedMeasurement, reloadMeasurements]);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-64 bg-gray-100 ${className}`}>
        <div className="text-center">
          <div className="text-gray-500 mb-2">Loading PDF...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-64 bg-red-50 ${className}`}>
        <div className="text-center">
          <div className="text-red-500 mb-2">Error: {error}</div>
        </div>
      </div>
    );
  }

  if (!pdfjsDocument) {
    return (
      <div className={`flex items-center justify-center h-64 bg-gray-100 ${className}`}>
        <div className="text-center">
          <div className="text-gray-500 mb-2">No PDF loaded</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-white ${className}`} ref={containerRef}>
      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 bg-gray-50 border-b">
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
        </div>
        
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-600">Zoom: {Math.round(zoom * 100)}%</span>
          
          {/* Zoom Controls */}
          <div className="flex items-center space-x-1">
            <button
              onClick={() => {
                if (fabricCanvasRef.current) {
                  const fabricCanvas = fabricCanvasRef.current;
                  const currentZoom = fabricCanvas.getZoom();
                  const newZoom = Math.max(0.1, currentZoom * 0.9);
                  const centerX = fabricCanvas.width / 2;
                  const centerY = fabricCanvas.height / 2;
                  const zoomPoint = new fabric.Point(centerX, centerY);
                  fabricCanvas.zoomToPoint(zoomPoint, newZoom);
                  setZoom(newZoom);
                  fabricCanvas.renderAll();
                  
                  // Reload measurements to update their positions
                  setTimeout(() => reloadMeasurements(), 50);
                }
              }}
              className="px-2 py-1 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
              title="Zoom Out (-)"
            >
              −
            </button>
            <button
              onClick={() => {
                if (fabricCanvasRef.current) {
                  const fabricCanvas = fabricCanvasRef.current;
                  const currentZoom = fabricCanvas.getZoom();
                  const newZoom = Math.min(5, currentZoom * 1.1);
                  const centerX = fabricCanvas.width / 2;
                  const centerY = fabricCanvas.height / 2;
                  const zoomPoint = new fabric.Point(centerX, centerY);
                  fabricCanvas.zoomToPoint(zoomPoint, newZoom);
                  setZoom(newZoom);
                  fabricCanvas.renderAll();
                  
                  // Reload measurements to update their positions
                  setTimeout(() => reloadMeasurements(), 50);
                }
              }}
              className="px-2 py-1 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
              title="Zoom In (+)"
            >
              +
            </button>
          </div>
          
          <button
            onClick={fitToScreen}
            className="px-3 py-1 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300"
            title="Fit to Screen (F)"
          >
            Fit to Screen
          </button>
          <button
            onClick={() => setShowCalibrationDialog(true)}
            className={`px-3 py-1 rounded text-sm ${
              isCalibrating
                ? 'bg-green-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Calibrate
          </button>
          
          {/* Scale Status Indicator */}
          <div 
            className={`w-2 h-2 rounded-full ${
              isPageCalibrated 
                ? 'bg-green-500' 
                : 'bg-red-500'
            }`}
            title={isPageCalibrated ? 'Page is calibrated' : 'Page needs calibration'}
          />
          
          {/* Delete Button */}
          {selectedMeasurementId && (
            <button
              onClick={deleteSelectedMeasurement}
              className="px-3 py-1 rounded text-sm bg-red-500 text-white hover:bg-red-600"
              title="Delete Selected Measurement (Delete)"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* PDF Display Container */}
      <div 
        className="flex-1 overflow-hidden relative"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        style={{ 
          cursor: isCalibrating ? 'crosshair' : 
                  isMeasuring ? 'crosshair' : 
                  isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
          minHeight: '400px' // Ensure minimum height
        }}
      >
        {/* Fabric.js Canvas */}
        <canvas
          ref={canvasRef}
          className="block"
          style={{
            display: 'block',
            maxWidth: 'none',
            maxHeight: 'none'
          }}
        />
        
        {/* Transparent overlay for panning when not measuring */}
        {!isMeasuring && !isCalibrating && (
          <div
            className="absolute inset-0 z-10"
            onMouseDown={(e) => {
              console.log('Overlay mouse down:', e.button, e.clientX, e.clientY);
              if (e.button === 0) {
                console.log('Overlay: Starting pan');
                setIsDragging(true);
                setDragStart({ x: e.clientX, y: e.clientY });
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onMouseUp={(e) => {
              console.log('Overlay mouse up:', e.button);
              if (e.button === 0) {
                console.log('Overlay: Stopping pan');
                setIsDragging(false);
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onMouseMove={(e) => {
              if (isDragging) {
                console.log('Overlay mouse move - panning');
                const deltaX = e.clientX - dragStart.x;
                const deltaY = e.clientY - dragStart.y;
                
                if (fabricCanvasRef.current) {
                  const fabricCanvas = fabricCanvasRef.current;
                  const vpt = fabricCanvas.viewportTransform;
                  if (vpt && vpt.length >= 6) {
                    const newVpt: [number, number, number, number, number, number] = [
                      vpt[0], vpt[1], vpt[2], vpt[3], vpt[4] + deltaX, vpt[5] + deltaY
                    ];
                    fabricCanvas.setViewportTransform(newVpt);
                    fabricCanvas.renderAll();
                    
                    // Reload measurements to update their positions
                    setTimeout(() => reloadMeasurements(), 50);
                  }
                }
                
                setDragStart({ x: e.clientX, y: e.clientY });
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onWheel={(e) => {
              console.log('=== OVERLAY WHEEL EVENT ===');
              console.log('Event details:', { 
                deltaY: e.deltaY, 
                deltaX: e.deltaX, 
                shiftKey: e.shiftKey, 
                ctrlKey: e.ctrlKey, 
                metaKey: e.metaKey,
                type: e.type,
                target: e.target
              });
              
              e.preventDefault();
              e.stopPropagation();
              
              if (!fabricCanvasRef.current) {
                console.log('No fabric canvas ref available');
                return;
              }
              
              const fabricCanvas = fabricCanvasRef.current;
              console.log('Fabric canvas available, current zoom:', fabricCanvas.getZoom());
              
              if (e.ctrlKey || e.metaKey) {
                // Ctrl/Cmd + Wheel: Zoom
                console.log('Overlay: Zooming with Ctrl/Cmd + wheel');
                const delta = e.deltaY > 0 ? 0.9 : 1.1;
                const currentZoom = fabricCanvas.getZoom();
                const newZoom = Math.max(0.1, Math.min(5, currentZoom * delta));
                
                // Get mouse position relative to canvas
                const rect = fabricCanvas.getElement().getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                // Zoom towards mouse position
                const zoomPoint = new fabric.Point(mouseX, mouseY);
                fabricCanvas.zoomToPoint(zoomPoint, newZoom);
                
                setZoom(newZoom);
                fabricCanvas.renderAll();
                
                // Reload measurements to update their positions
                setTimeout(() => reloadMeasurements(), 50);
                
              } else if (e.shiftKey) {
                // Shift + Wheel: Pan horizontally
                console.log('Overlay: Horizontal panning with Shift + wheel, deltaY:', e.deltaY);
                const panDelta = e.deltaY * 0.5;
                console.log('Calculated panDelta:', panDelta);
                
                const vpt = fabricCanvas.viewportTransform;
                console.log('Current viewport transform:', vpt);
                
                if (vpt && vpt.length >= 6) {
                  const newVpt: [number, number, number, number, number, number] = [
                    vpt[0], vpt[1], vpt[2], vpt[3], vpt[4] - panDelta, vpt[5]
                  ];
                  console.log('New viewport transform:', newVpt);
                  
                  fabricCanvas.setViewportTransform(newVpt);
                  fabricCanvas.renderAll();
                  
                  // Reload measurements to update their positions
                  setTimeout(() => reloadMeasurements(), 50);
                  
                  console.log('Horizontal pan applied successfully');
                } else {
                  console.log('Invalid viewport transform');
                }
              } else {
                // Regular Wheel: Pan vertically (up/down)
                console.log('Overlay: Vertical panning with regular wheel');
                const panDelta = e.deltaY * 0.5;
                const vpt = fabricCanvas.viewportTransform;
                if (vpt && vpt.length >= 6) {
                  const newVpt: [number, number, number, number, number, number] = [
                    vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5] - panDelta
                  ];
                  fabricCanvas.setViewportTransform(newVpt);
                  fabricCanvas.renderAll();
                  
                  // Reload measurements to update their positions
                  setTimeout(() => reloadMeasurements(), 50);
                }
              }
            }}
            style={{
              cursor: isDragging ? 'grabbing' : 'grab',
              pointerEvents: 'auto',
              backgroundColor: 'transparent'
            }}
          />
        )}
      </div>
      
      {/* Status messages */}
      {calibrationSuccess && (
        <div className="absolute top-20 left-4 bg-green-100 text-green-800 px-3 py-2 rounded text-sm">
          {calibrationSuccess}
        </div>
      )}
      
      {isMeasuring && (
        <div className="absolute bottom-4 left-4 bg-blue-100 text-blue-800 px-3 py-2 rounded text-sm">
          {measurementType === 'count' ? 'Click to place count markers (each click adds one)' :
           measurementType === 'linear' ? 'Click to place line vertices, double-click to complete the continuous line' :
           measurementType === 'area' ? 'Click to place area points, double-click to complete' :
           measurementType === 'volume' ? 'Click to place volume points, double-click to complete' :
           'Click to place measurement points'}
        </div>
      )}
      
      
      {isCalibrating && (
        <div className="absolute bottom-4 left-4 bg-green-100 text-green-800 px-3 py-2 rounded text-sm">
          <div className="font-medium">Calibration Mode</div>
          <div className="text-xs mt-1">
            Click two points to measure {calibrationData?.knownDistance?.toFixed(3)} {calibrationData?.unit}
          </div>
          <div className="text-xs mt-1">
            Points: {calibrationPoints.length}/2 • Press Escape to cancel
          </div>
        </div>
      )}
      
      {isMeasuring && selectedConditionId && (
        <div className="absolute bottom-4 right-4 bg-blue-100 text-blue-800 px-3 py-2 rounded text-sm">
          {(() => {
            const condition = conditions.find(c => c.id === selectedConditionId);
            return condition ? `${condition.name} (${condition.type})` : 'Measuring';
          })()}
        </div>
      )}
      
      
      {selectedMeasurementId && (
        <div className="absolute top-20 right-4 bg-red-100 text-red-800 px-3 py-2 rounded text-sm">
          Measurement Selected - Press Delete to remove
        </div>
      )}

      {/* Calibration Dialog */}
      <CalibrationDialog
        isOpen={showCalibrationDialog}
        onClose={() => {
          setShowCalibrationDialog(false);
          setCalibrationPoints([]);
          setIsCalibrating(false);
          isCalibratingRef.current = false;
          setCalibrationData(null);
          
          // Clear calibration visuals and re-enable PDF interaction
          if (fabricCanvasRef.current) {
            const fabricCanvas = fabricCanvasRef.current;
            const calibrationObjects = fabricCanvas.getObjects().filter(obj => (obj as any).data?.isCalibration);
            calibrationObjects.forEach(obj => fabricCanvas.remove(obj));
            
            // Also remove temporary calibration line
            const tempLine = fabricCanvas.getObjects().find(obj => (obj as any).data?.isTempCalibrationLine);
            if (tempLine) {
              fabricCanvas.remove(tempLine);
            }
            
            // PDF is now fixed position, no need to re-enable interaction
            
            fabricCanvas.renderAll();
          }
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
        totalPages={totalPages}
      />
    </div>
  );
};

export default FabricPDFViewer;
