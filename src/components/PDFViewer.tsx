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
  calibrationViewportWidth?: number | null;
  calibrationViewportHeight?: number | null;
  calibrationRotation?: number | null;
  onPDFLoaded?: (totalPages: number) => void;
  onCalibrationRequest?: () => void;
  onCalibrationComplete?: (isCalibrated: boolean, scaleFactor: number, unit: string, scope?: 'page' | 'document', pageNumber?: number | null, viewportWidth?: number | null, viewportHeight?: number | null, rotation?: number | null) => void;
  searchResults?: SearchResult[];
  currentSearchQuery?: string;
  cutoutMode?: boolean;
  cutoutTargetConditionId?: string | null;
  onCutoutModeChange?: (conditionId: string | null) => void;
  onMeasurementStateChange?: (isMeasuring: boolean, isCalibrating: boolean, measurementType: string, isOrthoSnapping: boolean) => void;
  annotationTool?: 'text' | 'arrow' | 'rectangle' | 'circle' | null;
  annotationColor?: string;
  onAnnotationToolChange?: (tool: 'text' | 'arrow' | 'rectangle' | 'circle' | null) => void;
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
  calibrationViewportWidth: externalCalibrationViewportWidth,
  calibrationViewportHeight: externalCalibrationViewportHeight,
  calibrationRotation: externalCalibrationRotation,
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
  
  // Double-click detection for measurements
  const [lastClickTime, setLastClickTime] = useState<number>(0);
  const [lastClickPosition, setLastClickPosition] = useState<{ x: number; y: number } | null>(null);
  const isCompletingMeasurementRef = useRef(false);
  const lastCompletionTimeRef = useRef<number>(0);
  
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
  const prevCalibratingRef = useRef(false);
  
  // Notify parent component of measurement state changes
  useEffect(() => {
    if (onMeasurementStateChange) {
      onMeasurementStateChange(isMeasuring, isCalibrating, measurementType, isOrthoSnapping);
    }
  }, [isMeasuring, isCalibrating, measurementType, isOrthoSnapping, onMeasurementStateChange]);

  // Enable ortho snapping by default when calibration mode starts
  useEffect(() => {
    // Only enable ortho snapping when entering calibration mode (transition from false to true)
    if (isCalibrating && !prevCalibratingRef.current && !isOrthoSnapping) {
      setIsOrthoSnapping(true);
    }
    prevCalibratingRef.current = isCalibrating;
  }, [isCalibrating, isOrthoSnapping]);

  // Restore calibration viewport ref when calibration is loaded from database
  // This is critical for accurate measurements after re-entering a project
  useEffect(() => {
    if (externalIsPageCalibrated && externalScaleFactor && externalCalibrationViewportWidth && externalCalibrationViewportHeight) {
      // Restore the calibration viewport ref with the stored dimensions and rotation
      // CRITICAL: Use the stored rotation, not the current rotation, because viewport dimensions
      // are specific to the rotation that was used during calibration
      const storedRotation = externalCalibrationRotation ?? 0;
      calibrationViewportRef.current = {
        scaleFactor: externalScaleFactor,
        unit: externalUnit || 'ft',
        viewportWidth: externalCalibrationViewportWidth,
        viewportHeight: externalCalibrationViewportHeight,
        scale: 1, // Calibration viewport is always at scale=1
        rotation: storedRotation // Use stored rotation, not current rotation
      };
      
      // Warn if rotation doesn't match (user rotated page after calibrating)
      if (storedRotation !== viewState.rotation) {
        console.warn('⚠️ Calibration rotation mismatch:', {
          calibrationRotation: storedRotation,
          currentRotation: viewState.rotation,
          message: 'Page was rotated after calibration. Measurements may be inaccurate. Consider recalibrating.'
        });
      }
    } else if (!externalIsPageCalibrated) {
      // Clear the ref if calibration is removed
      calibrationViewportRef.current = null;
    }
  }, [externalIsPageCalibrated, externalScaleFactor, externalUnit, externalCalibrationViewportWidth, externalCalibrationViewportHeight, externalCalibrationRotation, viewState.rotation]);

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
    
    // CRITICAL FIX: Use calibration base viewport dimensions for consistency with actual measurements
    // The calibration viewport ref stores the base viewport (scale=1) dimensions used during calibration
    const calibBase = calibrationViewportRef.current;
    const viewportWidth = calibBase?.viewportWidth || currentViewport.width;
    const viewportHeight = calibBase?.viewportHeight || currentViewport.height;
    
    let totalDistance = 0;
    for (let i = 1; i < allPoints.length; i++) {
      // Use base viewport dimensions to convert normalized coordinates to pixels
      const dx = (allPoints[i].x - allPoints[i - 1].x) * viewportWidth;
      const dy = (allPoints[i].y - allPoints[i - 1].y) * viewportHeight;
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
    getPageAnnotations,
    loadPageTakeoffMeasurements,
    getPageTakeoffMeasurements
  } = useTakeoffStore();
  
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

  // Subscribe to store changes for takeoffMeasurements to reactively update when measurements are added/updated
  const allTakeoffMeasurements = useTakeoffStore(state => state.takeoffMeasurements);
  
  // PER-PAGE LOADING: Load measurements for current page when page changes
  useEffect(() => {
    // CRITICAL: Clear measurements immediately when page changes to prevent cross-page contamination
    setLocalTakeoffMeasurements([]);
    
    if (!currentProjectId || !file?.id || !currentPage) {
      return;
    }
    
    let isCancelled = false; // Flag to prevent state updates if page changes during async load
    
    // Load measurements for this specific page from API
    const loadPageMeasurements = async () => {
      try {
        // Load from API if not already loaded (method handles caching)
        await loadPageTakeoffMeasurements(currentProjectId, file.id, currentPage);
        
        // Check if page changed during async load
        if (isCancelled) return;
        
        // Get from store (now guaranteed to be loaded)
        const pageMeasurements = getPageTakeoffMeasurements(currentProjectId, file.id, currentPage);
        
        // Double-check page hasn't changed
        if (isCancelled) return;
        
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
        
        // Final check before setting state
        if (!isCancelled) {
          setLocalTakeoffMeasurements(displayMeasurements);
        }
      } catch (error) {
        if (!isCancelled) {
          console.error('Error loading page measurements:', error);
          setLocalTakeoffMeasurements([]);
        }
      }
    };
    
    loadPageMeasurements();
    
    // Cleanup: mark as cancelled if page changes
    return () => {
      isCancelled = true;
    };
  }, [currentProjectId, file?.id, currentPage, loadPageTakeoffMeasurements, getPageTakeoffMeasurements]);
  
  // REACTIVE UPDATE: Update localTakeoffMeasurements when store changes (e.g., new measurement created)
  // This ensures newly created measurements appear immediately without page reload
  // OPTIMIZATION: Only update if measurements actually changed to prevent unnecessary re-renders
  useEffect(() => {
    if (!currentProjectId || !file?.id || !currentPage) {
      setLocalTakeoffMeasurements([]);
      return;
    }
    
    // Get current page measurements from store (reactively updates when store changes)
    // getPageTakeoffMeasurements already filters by projectId, sheetId, and pageNumber
    const pageMeasurements = getPageTakeoffMeasurements(currentProjectId, file.id, currentPage);
    
    // Convert to display format
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
    
    // OPTIMIZATION: Only update if measurements actually changed (by ID count and content)
    setLocalTakeoffMeasurements(prev => {
      const prevIds = new Set(prev.map((m: any) => m.id));
      const newIds = new Set(displayMeasurements.map((m: any) => m.id));
      
      // Check if measurements changed
      if (prev.length !== displayMeasurements.length || 
          ![...prevIds].every(id => newIds.has(id)) ||
          ![...newIds].every(id => prevIds.has(id))) {
        return displayMeasurements;
      }
      return prev; // No change, return previous to prevent re-render
    });
  }, [allTakeoffMeasurements, currentProjectId, file?.id, currentPage, getPageTakeoffMeasurements]);

  // Ensure component is mounted before rendering
  useEffect(() => {
    setIsComponentMounted(true);
    return () => setIsComponentMounted(false);
  }, []);

  // Additional effect to ensure measurements are rendered when added
  useEffect(() => {
    if (localTakeoffMeasurements.length > 0 && pdfDocument && currentViewport && !isRenderingRef.current) {
      // Removed verbose logging - was causing console spam
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
          // Use the correct API base URL instead of hardcoded localhost
          const { getApiBaseUrl } = await import('../lib/apiConfig');
          const API_BASE_URL = getApiBaseUrl();
          pdfUrl = `${API_BASE_URL}/files/${file.id}`;
        } else {
          throw new Error('Invalid file object provided');
        }
        
        // Get authentication token for PDF requests
        let httpHeaders: Record<string, string> | undefined;
        if (file && file.id) {
          // Only add auth headers for API requests (not File objects or direct URLs)
          const { supabase } = await import('../lib/supabase');
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            httpHeaders = {
              'Authorization': `Bearer ${session.access_token}`,
              'Accept': 'application/pdf'
            };
          }
        }
        
        const pdf = await pdfjsLib.getDocument({
          url: pdfUrl,
          httpHeaders, // Include auth headers for authenticated requests
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
        // CRITICAL: Only reset to page 1 if externalCurrentPage is undefined AND we don't have a saved page
        // This prevents resetting the page when the PDF reloads if we have a saved state
        if (externalCurrentPage === undefined) {
          // Only set to 1 if we don't already have a page set (preserve existing state)
          setInternalCurrentPage(prev => prev || 1);
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
    if (!pdfCanvasRef.current || !svgOverlayRef.current) {
      return;
    }
    
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
    
    
  }, [file?.id]);


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
    
    
    // Clear existing annotations completely - this ensures no cross-page contamination
    svgOverlay.innerHTML = '';
    
    // CRITICAL: Only render measurements for the specific page being rendered
    // Filter by page BEFORE iterating to prevent any cross-page contamination
    const pageMeasurements = localTakeoffMeasurements.filter(
      (measurement) => measurement.pdfPage === pageNum
    );
    
    pageMeasurements.forEach((measurement) => {
      // Removed verbose logging - was causing console spam
      renderSVGMeasurement(svgOverlay, measurement, viewport, page);
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
    if (pdfDocument && currentViewport && !isRenderingRef.current) {
      // Only render if we have measurements, annotations, or if we're in measuring/annotation/visual search mode
      if (localTakeoffMeasurements.length > 0 || isMeasuring || isCalibrating || currentMeasurement.length > 0 || isAnnotating || localAnnotations.length > 0 || (visualSearchMode && isSelectingSymbol)) {
        renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
      } else {
        // LAYER THRASH PREVENTION: Clear overlay when measurements are empty to prevent stale renderings
        // This ensures clean state when switching projects or when measurements are cleared
        if (svgOverlayRef.current) {
          svgOverlayRef.current.innerHTML = '';
        }
      }
    }
  }, [localTakeoffMeasurements, currentMeasurement, isMeasuring, isCalibrating, calibrationPoints, mousePosition, selectedMarkupId, isSelectionMode, renderTakeoffAnnotations, currentPage, currentViewport, isAnnotating, localAnnotations, visualSearchMode, isSelectingSymbol, currentAnnotation]);
  
  // CRITICAL: Trigger re-render of annotations after measurements are loaded
  // This ensures markups appear immediately when returning to a page
  // Must be after renderTakeoffAnnotations is defined
  useEffect(() => {
    if (localTakeoffMeasurements.length > 0 && pdfDocument && !isRenderingRef.current) {
      // Wait for viewport to be ready, then render
      let timeoutId: NodeJS.Timeout | null = null;
      let retryCount = 0;
      const maxRetries = 20; // Max 1 second of retries (20 * 50ms)
      
      const renderWhenReady = () => {
        // Check if we're still on the same page and viewport is ready
        if (pdfPageRef.current && currentViewport) {
          renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        } else if (retryCount < maxRetries) {
          // If viewport not ready yet, try again after a short delay
          retryCount++;
          timeoutId = setTimeout(renderWhenReady, 50);
        }
      };
      
      // Use requestAnimationFrame for immediate render, with fallback retry
      requestAnimationFrame(() => {
        renderWhenReady();
      });
      
      // Cleanup timeout on unmount or when dependencies change
      return () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };
    }
  }, [localTakeoffMeasurements, pdfDocument, currentViewport, currentPage, renderTakeoffAnnotations]);

  // Update pageViewports immediately when scale/rotation changes
  // This ensures currentViewport is always current even when PDF rendering is blocked
  useEffect(() => {
    if (pdfDocument && pdfPageRef.current) {
      // Create fresh viewport with current scale and rotation
      const freshViewport = pdfPageRef.current.getViewport({ 
        scale: viewState.scale, 
        rotation: viewState.rotation 
      });
      
      // Update pageViewports immediately so currentViewport memo recalculates
      setPageViewports(prev => {
        // Only update if the viewport actually changed to avoid unnecessary re-renders
        const existing = prev[currentPage];
        if (existing && 
            existing.width === freshViewport.width && 
            existing.height === freshViewport.height &&
            existing.scale === freshViewport.scale &&
            existing.rotation === freshViewport.rotation) {
          return prev; // No change
        }
        
        return {
          ...prev,
          [currentPage]: freshViewport
        };
      });
      
      // Trigger immediate re-render of markups with new viewport, even if PDF rendering is blocked
      // This ensures annotations stay aligned during zoom
      const hasMarkups = localTakeoffMeasurements.length > 0 || localAnnotations.length > 0;
      if (hasMarkups) {
        requestAnimationFrame(() => {
          renderTakeoffAnnotations(currentPage, freshViewport, pdfPageRef.current);
        });
      }
    }
  }, [pdfDocument, viewState.scale, viewState.rotation, currentPage, localTakeoffMeasurements, localAnnotations, renderTakeoffAnnotations]);

  // Force immediate re-render of markups when viewport changes
  const forceMarkupReRender = useCallback(() => {
    const hasMarkups = localTakeoffMeasurements.length > 0 || localAnnotations.length > 0;
    if (pdfDocument && pdfPageRef.current && hasMarkups) {
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
  }, [pdfDocument, viewState.scale, viewState.rotation, localTakeoffMeasurements, localAnnotations, currentPage, renderTakeoffAnnotations]);

  // Force re-render measurements and annotations when viewport state changes (zoom, rotation)
  useEffect(() => {
    const rendersBlocked = (isMeasuring || isCalibrating || currentMeasurement.length > 0 || isDeselecting || (isAnnotating && !showTextInput));
    if (rendersBlocked) {
      // During interactive zoom/draw, rely solely on CSS transforms to keep overlay in sync
      return;
    }
    const hasMarkups = localTakeoffMeasurements.length > 0 || localAnnotations.length > 0;
    if (pdfDocument && currentViewport && hasMarkups) {
      // Use requestAnimationFrame to ensure the viewport state is fully updated
      requestAnimationFrame(() => {
        renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
      });
    }
  }, [viewState.scale, viewState.rotation, pdfDocument, currentViewport, localTakeoffMeasurements, localAnnotations, currentPage, renderTakeoffAnnotations]);

  // Update hit-area pointer-events when mode changes
  useEffect(() => {
    if (!svgOverlayRef.current) return;
    
    const hitArea = svgOverlayRef.current.querySelector('#hit-area') as SVGRectElement;
    if (hitArea) {
      // When measuring, set pointer-events to 'none' so clicks pass through to canvas
      // This allows proper double-click detection on the canvas
      // For other modes, set to 'all' to capture clicks for selection/annotation/etc.
      const shouldCaptureClicks = isSelectionMode || isCalibrating || annotationTool || (visualSearchMode && isSelectingSymbol);
      hitArea.setAttribute('pointer-events', shouldCaptureClicks ? 'all' : 'none');
    }
    
    // CRITICAL FIX: Re-render markups when selection mode changes
    // This ensures markups get click handlers when entering selection mode
    // Markups rendered while isSelectionMode was false won't have click handlers
    if (isSelectionMode && currentViewport && pdfPageRef.current) {
      renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
    }
  }, [isMeasuring, isSelectionMode, isCalibrating, annotationTool, visualSearchMode, isSelectingSymbol, currentViewport, currentPage, renderTakeoffAnnotations]);

  // Page visibility handler - ensures overlay is properly initialized when page becomes visible
  const onPageShown = useCallback((pageNum: number, viewport: any) => {
    if (!viewport || !svgOverlayRef.current) {
      return;
    }
    
    const svgOverlay = svgOverlayRef.current;
    
    // Ensure SVG overlay has correct dimensions and viewBox for this page
    svgOverlay.setAttribute('width', viewport.width.toString());
    svgOverlay.setAttribute('height', viewport.height.toString());
    svgOverlay.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
    svgOverlay.setAttribute('overflow', 'visible');
    
    // Add a transparent hit area for pointer events
    // CRITICAL FIX: Set hit-area pointer-events based on current mode
    // When measuring, set to 'none' so clicks pass through to canvas for proper double-click handling
    // For other modes (selection, calibration, annotation, visual search), set to 'all' to capture clicks
    const existingHitArea = svgOverlay.querySelector('#hit-area');
    if (!existingHitArea) {
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hitArea.setAttribute('id', 'hit-area');
      hitArea.setAttribute('width', '100%');
      hitArea.setAttribute('height', '100%');
      hitArea.setAttribute('fill', 'transparent');
      svgOverlay.appendChild(hitArea);
    }
    
    // Update hit-area pointer-events based on current mode
    // This ensures clicks pass through to canvas when measuring (for double-click support)
    const hitArea = svgOverlay.querySelector('#hit-area') as SVGRectElement;
    if (hitArea) {
      const shouldCaptureClicks = isSelectionMode || isCalibrating || annotationTool || (visualSearchMode && isSelectingSymbol);
      hitArea.setAttribute('pointer-events', shouldCaptureClicks ? 'all' : 'none');
    }
    
    // Always re-render all annotations for this page, regardless of current state
    // This ensures takeoffs are visible immediately when the page loads
    // Use current state values, not captured values
    const currentMeasurements = useTakeoffStore.getState().takeoffMeasurements.filter(
      (m) => m.projectId === currentProjectId && m.sheetId === file?.id && m.pdfPage === pageNum
    );
    
    // Render immediately if we have measurements
    if (currentMeasurements.length > 0 || localTakeoffMeasurements.length > 0) {
      renderTakeoffAnnotations(pageNum, viewport, pdfPageRef.current);
    }
    // Note: If no measurements, the reactive useEffect will handle rendering when they load
    // The reactive useEffect watches allTakeoffMeasurements and will trigger render when measurements arrive
  }, [renderTakeoffAnnotations, localTakeoffMeasurements, currentProjectId, file?.id, isSelectionMode, isCalibrating, annotationTool, visualSearchMode, isSelectingSymbol]);

  // PDF render function with page-specific viewport isolation
  const renderPDFPage = useCallback(async (pageNum: number) => {
    // ANTI-FLICKER: Block PDF renders during interactive operations or deselection cooldown
    // Allow PDF renders during text annotation input (showTextInput = true)
    // Allow initial renders even if in deselection mode (for page loads)
    // CRITICAL FIX: Allow initial render even if isMeasuring is true - this ensures the viewport
    // is set so clicks can work. Only block re-renders during measurement to prevent flicker.
    // Block renders during interactive operations to prevent flicker
    const isInitialRender = !isInitialRenderComplete;
    if (!isInitialRender && (isMeasuring || isCalibrating || currentMeasurement.length > 0 || (isDeselecting && isInitialRenderComplete) || (isAnnotating && !showTextInput))) {
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
      // CRITICAL: Also check if measurements are loaded and render them
      // This handles the case where measurements load after the PDF renders
      try {
        // Get current measurements for this page from store (may have loaded after PDF render started)
        const currentMeasurements = useTakeoffStore.getState().takeoffMeasurements.filter(
          (m) => m.projectId === currentProjectId && m.sheetId === file?.id && m.pdfPage === pageNum
        );
        
        if (currentMeasurements.length > 0 || localTakeoffMeasurements.length > 0) {
          renderTakeoffAnnotations(pageNum, viewport, page);
          // And one more pass on next frame to catch late layout and ensure measurements are visible
          requestAnimationFrame(() => {
            renderTakeoffAnnotations(pageNum, viewport, page);
          });
        }
      } catch {}
      
      // Removed verbose logging - was causing console spam
      
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

  // Helper function to normalize rotation values to 0-360 range, then round to nearest 90° increment
  // Handles negative rotations: -90 → 270, -180 → 180, -270 → 90
  const normalizeRotation = (rotation: number): number => {
    // Normalize to 0-360 range (handle negative values: -90 → 270, -180 → 180, -270 → 90)
    let normalized = (rotation % 360);
    if (normalized < 0) normalized += 360;
    // Round to nearest 90° increment (0, 90, 180, 270)
    return Math.round(normalized / 90) * 90;
  };

  // Render individual measurement as SVG
  const renderSVGMeasurement = (svg: SVGSVGElement, measurement: Measurement, viewport: any, page?: any) => {
    if (!measurement || !measurement.points || !viewport) {
      return;
    }
    
    const points = measurement.points;
    if (points.length < 1) {
      return;
    }
    
    // For count measurements, we only need 1 point
    if (measurement.type === 'count' && points.length < 1) return;
    // For other measurements, we need at least 2 points
    if (measurement.type !== 'count' && points.length < 2) {
      return;
    }
    
    // Transform points to match current viewport
    // Points are stored normalized to BASE viewport (rotation 0), but we need to render on ROTATED viewport
    const pdfPage = pdfPageRef.current;
    if (!pdfPage) return;
    
    // Use the passed viewport directly - caller already calculated the correct one
    const currentViewport = viewport;
    
    // Get base viewport (rotation 0) to transform coordinates correctly
    const baseViewport = pdfPage.getViewport({ scale: 1, rotation: 0 });
    const rawRotation = viewState.rotation || 0;
    const rotation = normalizeRotation(rawRotation);
    
    // Convert normalized coordinates (base viewport) to current viewport coordinates (rotated)
    // This is the INVERSE of the transformation we do when storing coordinates
    const transformedPoints = points.map((point, idx) => {
      // Coordinates are normalized to base viewport (rotation 0)
      const normalizedX = point.x;
      const normalizedY = point.y;
      
      // DETAILED LOGGING: Render coordinate transformation (first point only)
      if (idx === 0) {
        console.log('📤 RENDERING COORDINATE:', {
          step: 'Input (normalized base)',
          normalized: { x: normalizedX, y: normalizedY },
          rawRotation,
          normalizedRotation: rotation,
          baseViewport: { width: baseViewport.width, height: baseViewport.height },
          currentViewport: { width: currentViewport.width, height: currentViewport.height },
          dimensionSwap: rotation === 90 || rotation === 270 ?
            `Swapped: currentWidth(${currentViewport.width}) === baseHeight(${baseViewport.height})? ${Math.abs(currentViewport.width - baseViewport.height) < 1}` :
            'No swap'
        });
      }
      
      // Transform from base normalized coordinates to rotated viewport coordinates
      let canvasX: number, canvasY: number;
      
      if (rotation === 0) {
        // No rotation: direct mapping
        canvasX = normalizedX * currentViewport.width;
        canvasY = normalizedY * currentViewport.height;
      } else if (rotation === 90) {
        // 90° clockwise rotation
        // Storage: (cssX/RW, cssY/RH) rotated → (cssY/RH, 1 - cssX/RW) base normalized
        // So: normalizedX = cssY/RH, normalizedY = 1 - cssX/RW
        // Rendering inverse: cssX = RW * (1 - normalizedY), cssY = RH * normalizedX
        canvasX = currentViewport.width * (1 - normalizedY);
        canvasY = currentViewport.height * normalizedX;
      } else if (rotation === 180) {
        // 180° rotation
        // Storage: (cssX/RW, cssY/RH) rotated → (1 - cssX/RW, 1 - cssY/RH) base normalized
        // So: normalizedX = 1 - cssX/RW, normalizedY = 1 - cssY/RH
        // Rendering inverse: cssX = RW * (1 - normalizedX), cssY = RH * (1 - normalizedY)
        canvasX = currentViewport.width * (1 - normalizedX);
        canvasY = currentViewport.height * (1 - normalizedY);
      } else if (rotation === 270) {
        // 270° clockwise rotation (or -90°)
        // Storage: (cssX/RW, cssY/RH) rotated → (1 - cssY/RH, cssX/RW) base normalized
        // So: normalizedX = 1 - cssY/RH, normalizedY = cssX/RW
        // Rendering inverse: cssX = RW * normalizedY, cssY = RH * (1 - normalizedX)
        canvasX = currentViewport.width * normalizedY;
        canvasY = currentViewport.height * (1 - normalizedX);
      } else {
        // Fallback: direct mapping
        canvasX = normalizedX * currentViewport.width;
        canvasY = normalizedY * currentViewport.height;
      }
      
      // DETAILED LOGGING: Render result (first point only)
      if (idx === 0) {
        console.log('📤 RENDERING COORDINATE:', {
          step: 'Output (CSS in rotated viewport)',
          rendered: { x: canvasX, y: canvasY },
          formula: rotation === 90 ? 'canvasX = RW*(1-y), canvasY = RH*x' :
                   rotation === 180 ? 'canvasX = RW*(1-x), canvasY = RH*(1-y)' :
                   rotation === 270 ? 'canvasX = RW*y, canvasY = RH*(1-x)' :
                   'direct mapping',
          roundTripCheck: rotation !== 0 ? 'Compare rendered coords to original click position' : 'N/A'
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
        // Create polyline for linear measurement
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        const pointString = transformedPoints.map(p => {
          // Points are already in viewport pixels after scaling
          return `${p.x},${p.y}`;
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
    
    // Use the passed viewport directly - caller already calculated the correct one
    const currentViewport = viewport;
    
    // Get base viewport (rotation 0) to transform coordinates correctly
    const pdfPage = pdfPageRef.current;
    if (!pdfPage) return;
    const baseViewport = pdfPage.getViewport({ scale: 1, rotation: 0 });
    const rotation = viewState.rotation || 0;
    
    // Transform coordinates from base viewport to rotated viewport (same as measurements)
    const points = annotation.points.map((p, idx) => {
      // Coordinates are normalized to base viewport (rotation 0)
      const normalizedX = p.x;
      const normalizedY = p.y;
      
      // DETAILED LOGGING: Annotation rendering (first point only)
      if (idx === 0 && rotation !== 0) {
        console.log('📤 RENDERING ANNOTATION:', {
          step: 'Input (normalized base)',
          normalized: { x: normalizedX, y: normalizedY },
          rotation,
          baseViewport: { width: baseViewport.width, height: baseViewport.height },
          currentViewport: { width: currentViewport.width, height: currentViewport.height }
        });
      }
      
      // Transform from base coordinates to rotated viewport coordinates
      const normalizedRotation = normalizeRotation(rotation);
      let canvasX: number, canvasY: number;
      
      if (normalizedRotation === 0) {
        canvasX = normalizedX * currentViewport.width;
        canvasY = normalizedY * currentViewport.height;
      } else if (normalizedRotation === 90) {
        canvasX = currentViewport.width * (1 - normalizedY);
        canvasY = currentViewport.height * normalizedX;
      } else if (normalizedRotation === 180) {
        canvasX = currentViewport.width * (1 - normalizedX);
        canvasY = currentViewport.height * (1 - normalizedY);
      } else if (normalizedRotation === 270) {
        canvasX = currentViewport.width * normalizedY;
        canvasY = currentViewport.height * (1 - normalizedX);
      } else {
        canvasX = normalizedX * currentViewport.width;
        canvasY = normalizedY * currentViewport.height;
      }
      
      // DETAILED LOGGING: Annotation rendering result (first point only)
      if (idx === 0 && rotation !== 0) {
        console.log('📤 RENDERING ANNOTATION:', {
          step: 'Output (CSS in rotated viewport)',
          rendered: { x: canvasX, y: canvasY }
        });
      }
      
      return { x: canvasX, y: canvasY };
    });
    
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
        text.style.pointerEvents = 'auto';
      }
      
      svg.appendChild(text);
      
      // Add invisible hit area for text annotations (rectangle around text)
      if (isSelectionMode) {
        // Estimate text bounds (approximate)
        const textWidth = annotation.text ? annotation.text.length * 8 : 50;
        const textHeight = 16;
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        hitArea.setAttribute('x', (point.x - 5).toString());
        hitArea.setAttribute('y', (point.y - textHeight - 5).toString());
        hitArea.setAttribute('width', (textWidth + 10).toString());
        hitArea.setAttribute('height', (textHeight + 10).toString());
        hitArea.setAttribute('fill', 'transparent');
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('data-annotation-id', annotation.id);
        hitArea.style.cursor = 'pointer';
        hitArea.style.pointerEvents = 'auto';
        svg.appendChild(hitArea);
      }
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
        line.style.pointerEvents = 'auto';
      }
      
      svg.appendChild(line);
      
      // Add invisible hit area for easier selection (like measurements have)
      if (isSelectionMode) {
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hitArea.setAttribute('x1', points[0].x.toString());
        hitArea.setAttribute('y1', points[0].y.toString());
        hitArea.setAttribute('x2', points[1].x.toString());
        hitArea.setAttribute('y2', points[1].y.toString());
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('stroke-width', '20'); // Much larger hit area
        hitArea.setAttribute('fill', 'none');
        hitArea.setAttribute('data-annotation-id', annotation.id);
        hitArea.style.cursor = 'pointer';
        hitArea.style.pointerEvents = 'auto';
        svg.appendChild(hitArea);
      }
      
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
        rect.style.pointerEvents = 'auto';
      }
      
      svg.appendChild(rect);
      
      // Add invisible hit area for easier selection (extends beyond stroke)
      if (isSelectionMode) {
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        hitArea.setAttribute('x', (x - 5).toString()); // Extend hit area
        hitArea.setAttribute('y', (y - 5).toString());
        hitArea.setAttribute('width', (width + 10).toString());
        hitArea.setAttribute('height', (height + 10).toString());
        hitArea.setAttribute('fill', 'transparent');
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('data-annotation-id', annotation.id);
        hitArea.style.cursor = 'pointer';
        hitArea.style.pointerEvents = 'auto';
        svg.appendChild(hitArea);
      }
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
        ellipse.style.pointerEvents = 'auto';
      }
      
      svg.appendChild(ellipse);
      
      // Add invisible hit area for easier selection
      if (isSelectionMode) {
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        hitArea.setAttribute('cx', cx.toString());
        hitArea.setAttribute('cy', cy.toString());
        hitArea.setAttribute('rx', (rx + 10).toString()); // Extend hit area
        hitArea.setAttribute('ry', (ry + 10).toString());
        hitArea.setAttribute('fill', 'transparent');
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('data-annotation-id', annotation.id);
        hitArea.style.cursor = 'pointer';
        hitArea.style.pointerEvents = 'auto';
        svg.appendChild(hitArea);
      }
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
        rect.style.pointerEvents = 'auto';
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
    
    if (['arrow', 'rectangle', 'circle'].includes(annotationTool)) {
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
    // Basic checks - allow interactions even during loading
    if (!pdfCanvasRef.current) {
      return;
    }
    
    // CRITICAL FIX: Compute viewport on-the-fly if not cached (for newly uploaded PDFs)
    // This allows interactions to work even before the page has fully rendered and cached the viewport
    let viewport = currentViewport;
    if (!viewport && pdfPageRef.current) {
      // Compute viewport on-the-fly using current scale and rotation
      viewport = pdfPageRef.current.getViewport({ 
        scale: viewState.scale, 
        rotation: viewState.rotation 
      });
      // Cache it for future use
      setPageViewports(prev => ({
        ...prev,
        [currentPage]: viewport
      }));
    }
    
    if (!viewport) {
      // Still no viewport - PDF page not ready yet
      return;
    }
    
    // ANTI-FLICKER: Clear deselection state on any user interaction
    if (isDeselecting) {
      setIsDeselecting(false);
    }
    
    // Handle visual search selection box drawing
    if (visualSearchMode && isSelectingSymbol && selectionStart) {
      if (!pdfCanvasRef.current) return;
      
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
      
      // Convert CSS coordinates to normalized PDF coordinates (0-1)
      // Normalized coordinates represent PDF-relative position, independent of zoom level
      let pdfCoords = {
        x: cssX / viewport.width,
        y: cssY / viewport.height
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
      if (!pdfCanvasRef.current) {
        return;
      }
      
      // Get CSS pixel coordinates relative to the canvas/SVG
      const rect = pdfCanvasRef.current.getBoundingClientRect();
      const cssX = event.clientX - rect.left;
      const cssY = event.clientY - rect.top;
      
      // Convert CSS coordinates to PDF coordinates (0-1)
      const pdfCoords = {
        x: cssX / viewport.width,
        y: cssY / viewport.height
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
    
    if (!pdfCanvasRef.current) {
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
      x: cssX / viewport.width,
      y: cssY / viewport.height
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
  }, [annotationTool, isCalibrating, calibrationPoints, isMeasuring, selectedConditionId, mousePosition, isContinuousDrawing, activePoints, rubberBandElement, currentViewport, calculateRunningLength, isDeselecting, visualSearchMode, isSelectingSymbol, selectionStart, viewState, setPageViewports, currentPage]);

  // Handle click - direct coordinate conversion
  const handleClick = useCallback(async (event: React.MouseEvent<HTMLCanvasElement | SVGSVGElement>) => {
    // Basic checks - allow interactions even during loading
    if (!pdfCanvasRef.current) {
      return;
    }
    
    // CRITICAL FIX: Compute viewport on-the-fly if not cached (for newly uploaded PDFs)
    // This allows interactions to work even before the page has fully rendered and cached the viewport
    let viewport = currentViewport;
    
    if (!viewport) {
      // Try to get viewport from cached page ref first
      if (pdfPageRef.current) {
        viewport = pdfPageRef.current.getViewport({ 
          scale: viewState.scale, 
          rotation: viewState.rotation 
        });
        // Cache it for future use
        setPageViewports(prev => ({
          ...prev,
          [currentPage]: viewport
        }));
      } else if (pdfDocument) {
        // For new documents, page might not be loaded yet - load it on-demand
        try {
          const page = await pdfDocument.getPage(currentPage);
          pdfPageRef.current = page; // Cache the page for future use
          viewport = page.getViewport({ 
            scale: viewState.scale, 
            rotation: viewState.rotation 
          });
          // Cache viewport for future use
          setPageViewports(prev => ({
            ...prev,
            [currentPage]: viewport
          }));
        } catch (error) {
          console.error('Failed to load PDF page for click handler:', error);
          return;
        }
      }
    }
    
    if (!viewport) {
      // Still no viewport - PDF page not ready yet
      return;
    }
    
    // ANTI-FLICKER: Clear deselection state on any user interaction
    if (isDeselecting) {
      setIsDeselecting(false);
    }
    
    const currentStoreState = useTakeoffStore.getState();
    const currentSelectedConditionId = currentStoreState.selectedConditionId;
    // Removed verbose logging - was causing console spam
    
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
          x: x / viewport.width,
          y: y / viewport.height,
          width: width / viewport.width,
          height: height / viewport.height
        };
        
        // Call the completion handler
        if (onVisualSearchComplete) {
          onVisualSearchComplete(pdfSelectionBox);
        }
      }
      return;
    }
    
    // Handle deselection in selection mode when clicking on blank space
    // NOTE: This only applies to blank space clicks, not markup clicks
    // Markup clicks are handled by their own click handlers and won't reach here
    if (isSelectionMode && selectedMarkupId && !isMeasuring && !isCalibrating && !annotationTool) {
      // If we're in selection mode and have a selected markup, deselect it when clicking blank space
      setSelectedMarkupId(null);
      return;
    }
    
    // Handle calibration clicks
    if (isCalibrating) {
      setCalibrationPoints(prev => {
        // CRITICAL FIX: Normalize using base viewport (rotation 0, scale 1) to get PDF-relative coordinates (0-1)
        // Normalized coordinates represent position in PDF space, independent of zoom level and rotation
        // The calibration calculation will use these normalized coords with baseViewport dimensions
        const baseViewport = pdfPageRef.current?.getViewport({ scale: 1, rotation: 0 }) || viewport;
        const rawRotation = viewState.rotation || 0;
        const rotation = normalizeRotation(rawRotation);
        
        let baseX: number, baseY: number;
        if (rotation === 0) {
          baseX = (cssX / viewport.width) * baseViewport.width;
          baseY = (cssY / viewport.height) * baseViewport.height;
        } else if (rotation === 90) {
          baseX = (cssY / viewport.height) * baseViewport.width;
          baseY = (1 - cssX / viewport.width) * baseViewport.height;
        } else if (rotation === 180) {
          baseX = (1 - cssX / viewport.width) * baseViewport.width;
          baseY = (1 - cssY / viewport.height) * baseViewport.height;
        } else if (rotation === 270) {
          baseX = (1 - cssY / viewport.height) * baseViewport.width;
          baseY = (cssX / viewport.width) * baseViewport.height;
        } else {
          baseX = (cssX / viewport.width) * baseViewport.width;
          baseY = (cssY / viewport.height) * baseViewport.height;
        }
        
        let pdfCoords = {
          x: baseX / baseViewport.width,
          y: baseY / baseViewport.height
        };
        
        // Apply ortho snapping for calibration only if explicitly enabled
        // IMPORTANT: When ortho snapping is enabled, use mousePosition which already has the snapped coordinates
        // that match the crosshair position. This ensures points are created exactly where the crosshair is.
        if (prev.length > 0 && isOrthoSnapping) {
          if (mousePosition) {
            // Use the snapped position from mousePosition (which matches the crosshair)
            pdfCoords = mousePosition;
          } else {
            // Fallback: recalculate snapping if mousePosition is not available
            pdfCoords = applyOrthoSnapping(pdfCoords, prev);
          }
        }
        
        // Store points in normalized PDF coordinates (0-1) - these represent PDF-relative position
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
      // Convert CSS coordinates to PDF coordinates (0-1) for storage
      // CRITICAL: Always normalize based on rotation 0, scale 1 viewport for consistency
      const baseViewport = pdfPageRef.current?.getViewport({ scale: 1, rotation: 0 }) || viewport;
      const rawRotation = viewState.rotation || 0;
      const rotation = normalizeRotation(rawRotation);
      
      let baseX: number, baseY: number;
      if (rotation === 0) {
        baseX = (cssX / viewport.width) * baseViewport.width;
        baseY = (cssY / viewport.height) * baseViewport.height;
      } else if (rotation === 90) {
        baseX = (cssY / viewport.height) * baseViewport.width;
        baseY = (1 - cssX / viewport.width) * baseViewport.height;
      } else if (rotation === 180) {
        baseX = (1 - cssX / viewport.width) * baseViewport.width;
        baseY = (1 - cssY / viewport.height) * baseViewport.height;
      } else if (rotation === 270) {
        baseX = (1 - cssY / viewport.height) * baseViewport.width;
        baseY = (cssX / viewport.width) * baseViewport.height;
      } else {
        baseX = (cssX / viewport.width) * baseViewport.width;
        baseY = (cssY / viewport.height) * baseViewport.height;
      }
      
      let pdfCoords = {
        x: baseX / baseViewport.width,
        y: baseY / baseViewport.height
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
      // CRITICAL: Always normalize based on rotation 0, scale 1 viewport for consistency
      const baseViewport = pdfPageRef.current?.getViewport({ scale: 1, rotation: 0 }) || viewport;
      const rawRotation = viewState.rotation || 0;
      const rotation = normalizeRotation(rawRotation);
      
      let baseX: number, baseY: number;
      if (rotation === 0) {
        baseX = (cssX / viewport.width) * baseViewport.width;
        baseY = (cssY / viewport.height) * baseViewport.height;
      } else if (rotation === 90) {
        baseX = (cssY / viewport.height) * baseViewport.width;
        baseY = (1 - cssX / viewport.width) * baseViewport.height;
      } else if (rotation === 180) {
        baseX = (1 - cssX / viewport.width) * baseViewport.width;
        baseY = (1 - cssY / viewport.height) * baseViewport.height;
      } else if (rotation === 270) {
        baseX = (1 - cssY / viewport.height) * baseViewport.width;
        baseY = (cssX / viewport.width) * baseViewport.height;
      } else {
        baseX = (cssX / viewport.width) * baseViewport.width;
        baseY = (cssY / viewport.height) * baseViewport.height;
      }
      
      const pdfCoords = {
        x: baseX / baseViewport.width,
        y: baseY / baseViewport.height
      };
      
      if (annotationTool === 'text') {
        // Show text input at clicked position
        setTextInputPosition({ x: cssX, y: cssY });
        setShowTextInput(true);
        // Don't set currentAnnotation yet - wait until text is saved
        // Store the position for when we save the annotation
        setCurrentAnnotation([pdfCoords]);
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
    // CRITICAL FIX: Allow clicks in selection mode even without a condition selected
    // This allows users to select existing markups for deletion without needing a condition
    if (!currentSelectedConditionId && !isSelectionMode) {
      return;
    }
    
    // If we're in selection mode without a condition, we're just selecting markups, not creating measurements
    // The markup click handlers will handle selection, so we can return early here
    if (isSelectionMode && !currentSelectedConditionId) {
      // Allow the click to pass through - markup handlers will process it
      // If it's a blank space click, the deselection logic above already handled it
      return;
    }
    
    // Removed verbose logging - was causing console spam
    
    // Convert CSS coordinates to PDF coordinates (0-1) for storage
    // CRITICAL: Always normalize based on rotation 0, scale 1 viewport for consistency
    // This ensures coordinates match the actual PDF page dimensions regardless of current rotation
    const baseViewport = pdfPageRef.current?.getViewport({ scale: 1, rotation: 0 }) || viewport;
    
    // Transform CSS coordinates from rotated viewport to base viewport coordinates
    // pdf.js rotates by swapping dimensions and rotating the coordinate system
    let baseX: number, baseY: number;
    const rawRotation = viewState.rotation || 0;
    const rotation = normalizeRotation(rawRotation);
    
    // DETAILED LOGGING: Store coordinate transformation
    console.log('📥 STORING COORDINATE:', {
      step: 'Input (CSS in rotated viewport)',
      cssCoords: { x: cssX, y: cssY },
      rawRotation,
      normalizedRotation: rotation,
      rotatedViewport: { width: viewport.width, height: viewport.height },
      baseViewport: { width: baseViewport.width, height: baseViewport.height },
      dimensionSwap: rotation === 90 || rotation === 270 ? 
        `Swapped: rotatedWidth(${viewport.width}) === baseHeight(${baseViewport.height})? ${Math.abs(viewport.width - baseViewport.height) < 1}` : 
        'No swap'
    });
    
    if (rotation === 0) {
      // No rotation: direct mapping
      baseX = (cssX / viewport.width) * baseViewport.width;
      baseY = (cssY / viewport.height) * baseViewport.height;
    } else if (rotation === 90) {
      // 90° clockwise: (x, y) in rotated → (y, width - x) in base
      baseX = (cssY / viewport.height) * baseViewport.width;
      baseY = (1 - cssX / viewport.width) * baseViewport.height;
    } else if (rotation === 180) {
      // 180°: (x, y) in rotated → (width - x, height - y) in base
      baseX = (1 - cssX / viewport.width) * baseViewport.width;
      baseY = (1 - cssY / viewport.height) * baseViewport.height;
    } else if (rotation === 270) {
      // 270° clockwise (90° counter-clockwise): (x, y) in rotated → (height - y, x) in base
      baseX = (1 - cssY / viewport.height) * baseViewport.width;
      baseY = (cssX / viewport.width) * baseViewport.height;
    } else {
      // Fallback: use direct mapping (shouldn't happen with standard rotations)
      baseX = (cssX / viewport.width) * baseViewport.width;
      baseY = (cssY / viewport.height) * baseViewport.height;
    }
    
    // Normalize to 0-1 range based on base viewport
    let pdfCoords = {
      x: baseX / baseViewport.width,
      y: baseY / baseViewport.height
    };
    
    // DETAILED LOGGING: Storage result
    console.log('📥 STORING COORDINATE:', {
      step: 'Output (normalized base)',
      basePixels: { x: baseX, y: baseY },
      normalized: pdfCoords,
      formula: rotation === 90 ? 'normalizedX = cssY/RH, normalizedY = 1 - cssX/RW' :
               rotation === 180 ? 'normalizedX = 1 - cssX/RW, normalizedY = 1 - cssY/RH' :
               rotation === 270 ? 'normalizedX = 1 - cssY/RH, normalizedY = cssX/RW' :
               'direct mapping'
    });
    
    // Smart cut-out mode entry removed - using manual toggle instead
    
    // Apply ortho snapping if enabled and we have reference points
    // IMPORTANT: When ortho snapping is enabled, use mousePosition which already has the snapped coordinates
    // that match the crosshair position. This ensures points are created exactly where the crosshair is.
    if (isOrthoSnapping && isMeasuring && mousePosition) {
      // Use the snapped position from mousePosition (which matches the crosshair)
      pdfCoords = mousePosition;
    } else if (isOrthoSnapping) {
      // Fallback: recalculate snapping if mousePosition is not available
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
  }, [isCalibrating, calibrationPoints, measurementType, currentMeasurement, isContinuousDrawing, activePoints, calculateRunningLength, currentViewport, isSelectionMode, selectedMarkupId, isOrthoSnapping, isMeasuring, mousePosition, cutoutMode, currentCutout, isDeselecting, visualSearchMode, isSelectingSymbol, selectionStart, annotationTool, currentProjectId, file, currentPage, addAnnotation, annotationColor, onAnnotationToolChange, viewState, setPageViewports, pdfDocument]);

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
    // Prevent duplicate calls within a very short window (100ms) - allows legitimate double-clicks
    const now = Date.now();
    if (isCompletingMeasurementRef.current && (now - lastCompletionTimeRef.current) < 100) {
      // Block duplicate measurement completion calls
      return;
    }
    
    const currentStoreState = useTakeoffStore.getState();
    const currentSelectedConditionId = currentStoreState.selectedConditionId;
    
    if (!currentSelectedConditionId || points.length === 0) {
      return;
    }
    
    // Set flag and timestamp to prevent duplicate calls
    isCompletingMeasurementRef.current = true;
    lastCompletionTimeRef.current = now;
    
    const selectedCondition = getSelectedCondition();
    if (!selectedCondition) {
      // Reset flag if condition not found
      isCompletingMeasurementRef.current = false;
      return;
    }
    
    let calculatedValue = 0;
    let unit = selectedCondition.unit;
    
    if (!currentViewport) {
      // Reset flag if no viewport
      isCompletingMeasurementRef.current = false;
      return;
    }
    
    // Store measurements in normalized coordinates (0-1) - simple and reliable
    const viewportPoints = points.map((point) => ({
      x: point.x,
      y: point.y
    }));
    
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
        // Only assign perimeter if the condition requires it
        if (selectedCondition.includePerimeter) {
          perimeterValue = measurementResult.perimeterValue;
        }
        break;
      case 'volume':
        const depth = selectedCondition.depth || 1; // Default to 1 foot if no depth specified
        measurementResult = MeasurementCalculator.calculateVolume(viewportPoints, scaleInfo, depth, 1.0);
        calculatedValue = measurementResult.calculatedValue;
        unit = measurementResult.unit;
        // Only assign perimeter if the condition requires it
        if (selectedCondition.includePerimeter) {
          perimeterValue = measurementResult.perimeterValue;
        }
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
    
    // Override perimeter calculation if condition requires it and perimeter wasn't calculated
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
        // Only include perimeterValue if the condition requires it
        ...(selectedCondition.includePerimeter && { perimeterValue })
      }).then(savedMeasurementId => {
        // The new measurement will automatically appear via the useEffect that watches takeoffMeasurements
        // No need for complex manual state management - just like annotations!
      }).catch(error => {
        console.error(`Failed to save ${measurementType.toUpperCase()} measurement:`, error);
        // Reset flag on error
        isCompletingMeasurementRef.current = false;
      });
    } else {
      // Reset flag if no project/file
      isCompletingMeasurementRef.current = false;
    }
    
    // Clear current measurement
    setCurrentMeasurement([]);
    setMousePosition(null);
    
    // Reset flag after a short delay to allow the measurement to be saved
    // Only reset if we haven't already reset due to error
    setTimeout(() => {
      isCompletingMeasurementRef.current = false;
    }, 500);
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
    
    // Handle cut-out completion
    if (cutoutMode && currentCutout.length >= 3) {
      completeCutout(currentCutout);
      return;
    }
    
    // Handle measurement completion when in measurement mode
    if (isMeasuring) {
      // Handle continuous linear measurements
      if (isContinuousDrawing && activePoints.length >= 2) {
        // Complete the continuous linear measurement
        completeContinuousLinearMeasurement();
        return;
      }
      
      // Handle non-continuous linear measurements (at least 2 points required)
      if (measurementType === 'linear' && !isContinuousDrawing && currentMeasurement.length >= 2) {
        // Complete non-continuous linear measurement
        completeMeasurement(currentMeasurement);
        return;
      }
      
      // For area or volume measurements, require at least 3 points (as required by the calculator)
      if ((measurementType === 'area' || measurementType === 'volume') && currentMeasurement.length >= 3) {
        // Complete area or volume measurement
        completeMeasurement(currentMeasurement);
        return;
      }
    }
  }, [annotationTool, currentAnnotation, annotationColor, currentPage, onAnnotationToolChange, isContinuousDrawing, activePoints, measurementType, currentMeasurement, completeContinuousLinearMeasurement, completeMeasurement, cutoutMode, currentCutout, completeCutout, isMeasuring]);

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
    // This ensures scale factor is calculated at PDF's native scale, independent of zoom level
    const baseViewport = pdfPage.getViewport({ scale: 1, rotation: viewState.rotation });
    
    // Calculate distance in base viewport pixels
    // Points are in normalized coordinates (0-1), representing PDF-relative position
    // Normalized coordinates are independent of zoom level - they represent the same PDF position
    // regardless of which viewport was used to normalize them
    // Multiply normalized delta by baseViewport dimensions to get pixel distance
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
    // CRITICAL FIX: Store baseViewport dimensions, not currentViewport dimensions
    // The calibration was calculated using baseViewport (scale=1), so measurements
    // must also use baseViewport dimensions for accurate calculations
    calibrationViewportRef.current = {
      scaleFactor: newScaleFactor,
      unit: unit,
      viewportWidth: baseViewport.width,
      viewportHeight: baseViewport.height,
      scale: baseViewport.scale, // This should be 1
      rotation: baseViewport.rotation
    };
    
    if (onCalibrationComplete) {
      // Default to 'page' scope for initial calibration (user will choose scope in dialog)
      // pageNumber will be set when user clicks Apply in the dialog
      // Pass viewport dimensions and rotation so they can be saved to the database
      onCalibrationComplete(true, newScaleFactor, unit, 'page', currentPage, baseViewport.width, baseViewport.height, baseViewport.rotation);
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
    
    // Ensure calibration is saved when user clicks Apply
    // This is important because onCalibrationComplete is called before the dialog,
    // but we want to make sure it's persisted when user explicitly clicks Apply
    if (onCalibrationComplete && file?.id && currentProjectId) {
      // Pass scope and pageNumber so the handler can save with correct pageNumber
      // scope = 'document' -> pageNumber = null (applies to all pages)
      // scope = 'page' -> pageNumber = currentPage (page-specific, overwrites document-level for this page)
      // Use viewport dimensions and rotation from calibrationViewportRef which was set during calibration
      const pageNumber = scope === 'page' ? currentPage : null;
      const viewportWidth = calibrationViewportRef.current?.viewportWidth ?? null;
      const viewportHeight = calibrationViewportRef.current?.viewportHeight ?? null;
      const rotation = calibrationViewportRef.current?.rotation ?? null;
      onCalibrationComplete(true, pendingScaleData.scaleFactor, pendingScaleData.unit, scope, pageNumber, viewportWidth, viewportHeight, rotation);
    }
    
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
  }, [pendingScaleData, externalScaleFactor, externalUnit, externalIsPageCalibrated, onCalibrationComplete, file?.id, currentProjectId]);

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
      
      // FIX: Update viewport IMMEDIATELY before any rendering to prevent drift
      // This ensures currentViewport is fresh before state updates trigger re-renders
      if (pdfPageRef.current) {
        const freshViewport = pdfPageRef.current.getViewport({ 
          scale: newScale, 
          rotation: viewState.rotation 
        });
        
        // Synchronously update pageViewports so currentViewport memo recalculates
        setPageViewports(prev => ({
          ...prev,
          [currentPage]: freshViewport
        }));
        
        // Update lastRenderedScaleRef so baseline scale logic uses correct value
        lastRenderedScaleRef.current = newScale;
      }
      
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
      

      // FIX: Update viewport IMMEDIATELY before state changes to prevent drift
      // This ensures currentViewport is fresh before state updates trigger re-renders
      if (pdfPageRef.current) {
        const freshViewport = pdfPageRef.current.getViewport({ 
          scale: optimalScale, 
          rotation: viewState.rotation 
        });
        
        // Synchronously update pageViewports so currentViewport memo recalculates
        setPageViewports(prev => ({
          ...prev,
          [currentPage]: freshViewport
        }));
        
        // Update lastRenderedScaleRef so baseline scale logic uses correct value
        lastRenderedScaleRef.current = optimalScale;
      }

      // Apply the new scale
      if (onScaleChange) {
        onScaleChange(optimalScale);
      } else {
        setInternalViewState(prev => ({ ...prev, scale: optimalScale }));
      }

      // Note: No manual renderTakeoffAnnotations call needed - the useEffect
      // watching viewState.scale will handle re-rendering with the fresh viewport

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

  // Add wheel event listener to container, canvas, and SVG to ensure zoom works during markup placement
  useEffect(() => {
    const container = containerRef.current;
    const canvas = pdfCanvasRef.current;
    const svg = svgOverlayRef.current;
    
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    if (canvas) {
      canvas.addEventListener('wheel', handleWheel, { passive: false });
    }
    if (svg) {
      svg.addEventListener('wheel', handleWheel, { passive: false });
    }
    
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (canvas) {
        canvas.removeEventListener('wheel', handleWheel);
      }
      if (svg) {
        svg.removeEventListener('wheel', handleWheel);
      }
    };
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
      
      // CRITICAL: After clearing CSS transforms, re-render annotations with correct viewport
      // This fixes the issue where annotations disappear after zoom completes
      const hasMarkups = localTakeoffMeasurements.length > 0 || localAnnotations.length > 0;
      if (pdfDocument && pdfPageRef.current && hasMarkups) {
        const freshViewport = pdfPageRef.current.getViewport({ 
          scale: viewState.scale, 
          rotation: viewState.rotation 
        });
        requestAnimationFrame(() => {
          renderTakeoffAnnotations(currentPage, freshViewport, pdfPageRef.current);
        });
      }
    }
  }, [viewState.scale, isMeasuring, isCalibrating, currentMeasurement.length, isDeselecting, isAnnotating, showTextInput, applyInteractiveZoomTransforms, pdfDocument, localTakeoffMeasurements, localAnnotations, currentPage, renderTakeoffAnnotations]);

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
        // Delete annotation
        
        // Clear selection immediately
        const deletedId = selectedMarkupId;
        setSelectedMarkupId(null);
        
        // Delete annotation from store
        const { deleteAnnotation } = useTakeoffStore.getState();
        deleteAnnotation(deletedId);
        
        // Get updated annotations from store after deletion
        const { annotations: updatedAnnotations } = useTakeoffStore.getState();
        
        // Immediately update local annotations to reflect the deletion
        const filteredAnnotations = updatedAnnotations.filter(
          a => a.projectId === currentProjectId && a.sheetId === file.id
        );
        setLocalAnnotations(filteredAnnotations);
        
        // Force immediate re-render using requestAnimationFrame to ensure state is processed
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // Immediately re-render the SVG overlay to show the deletion
            if (currentViewport) {
              renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
            }
            
            // Trigger PDF render after annotation deletion
          });
        });
      } else if (currentProjectId && file?.id) {
        // Delete measurement
        const { deleteTakeoffMeasurement } = useTakeoffStore.getState();
        
        try {
          // Clear selection immediately
          const deletedId = selectedMarkupId;
          setSelectedMarkupId(null);
          
          // Delete from store (async operation)
          await deleteTakeoffMeasurement(deletedId);
          
          // The reactive useEffect (line 493) will automatically update localTakeoffMeasurements
          // when allTakeoffMeasurements changes, so we don't need to manually update here
          // Just force a re-render after a brief delay to ensure store state has updated
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              // Re-render the SVG overlay to show the deletion
              if (currentViewport) {
                renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
              }
              
              // Trigger PDF render after measurement deletion
            });
          });
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
      
      // CRITICAL: Also render annotations after measurements load
      // This handles the case where we return to a page and measurements load asynchronously
      // Use a small delay to allow measurements to load, then render
      const renderTimer = setTimeout(() => {
        if (localTakeoffMeasurements.length > 0 && pdfPageRef.current && currentViewport) {
          renderTakeoffAnnotations(currentPage, currentViewport, pdfPageRef.current);
        }
      }, 100); // Small delay to allow async measurement loading
      
      return () => clearTimeout(renderTimer);
    }
  }, [currentPage, currentViewport, onPageShown, localTakeoffMeasurements, renderTakeoffAnnotations, pdfDocument]);

  // Clear current measurement state when page changes
  useEffect(() => {
    setCurrentMeasurement([]);
    setMousePosition(null);
    setMeasurements([]);
  }, [currentPage]);

  // Optimized re-render when view state changes (zoom/rotation)
  useEffect(() => {
    if (pdfDocument && isComponentMounted && isInitialRenderComplete) {
      // ANTI-FLICKER: Skip PDF re-render during interactive operations or deselection cooldown
      // Allow PDF renders during text annotation input (showTextInput = true)
      // Allow initial renders even if in deselection mode (for page loads)
      if (isMeasuring || isCalibrating || currentMeasurement.length > 0 || (isDeselecting && isInitialRenderComplete) || (isAnnotating && !showTextInput)) {
        // When blocked, simulate zoom via CSS transform so the user sees immediate zoom
        // without re-rendering the PDF canvas (prevents flicker while drawing)
        applyInteractiveZoomTransforms();
        return;
      }
      
      // ANTI-FLICKER: Block ALL renders during deselection period
      if (isDeselecting) {
        return;
      }
      
      // Optimized debounce for non-interactive mode
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
      } else {
        // VALIDATION FIX: Condition ID exists but condition object is missing
        // This can happen during condition reload or if condition was deleted
        // Clear measurement mode to prevent stale state and silent click failures
        console.warn('Condition not found: selectedConditionId exists but condition object missing', {
          selectedConditionId,
          conditionsCount: useTakeoffStore.getState().conditions.length
        });
        
        // Clear measurement state to prevent clicks from failing silently
        // This doesn't trigger renders (just state updates) and respects guard logic
        setIsMeasuring(false);
        setIsSelectionMode(true);
        setSelectedMarkupId(null);
        // DON'T set isDeselecting here - that's only for explicit deselection
        // DON'T clear selectedConditionId in store - let the UI handle that
        // This prevents flicker while allowing the UI to show the selection state
      }
    } else {
      setIsMeasuring(false);
      setIsSelectionMode(true);
      setCurrentMeasurement([]);
      setMousePosition(null);
      setMeasurements([]);
      
      // ANTI-FLICKER: Extended cooldown after deselection to prevent flicker storm
      setIsDeselecting(true);
      
      // Store timeout ID so we can clear it if needed
      const timeoutId = setTimeout(() => {
        setIsDeselecting(false);
      }, 5000); // 5 second cooldown after deselection
      
      // Clear timeout if component unmounts or condition changes
      return () => {
        clearTimeout(timeoutId);
        setIsDeselecting(false);
      };
    }
  }, [selectedConditionId, getSelectedCondition]);

  // Set annotation mode when annotation tool is selected
  useEffect(() => {
    if (annotationTool) {
      setIsAnnotating(true);
      setIsSelectionMode(false);
      setSelectedMarkupId(null);
      setIsDeselecting(false); // Clear deselection state
    } else {
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
                pointerEvents: (isSelectionMode || isCalibrating || annotationTool || (visualSearchMode && isSelectingSymbol)) ? 'auto' : 'none' // Allow clicks in selection, calibration, annotation, or visual search mode (measurements handled by canvas)
              }}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setMousePosition(null)}
              onClick={(e) => {
                // Handle clicks in selection mode, calibration mode, annotation mode, or visual search mode
                // Note: Measurement clicks pass through to canvas (hit-area has pointer-events: 'none')
                // This allows proper double-click detection on the canvas
                if (isSelectionMode || isCalibrating || annotationTool || (visualSearchMode && isSelectingSymbol)) {
                  const target = e.target as SVGElement;
                  
                  // Check if target or any parent has markup data attributes
                  // Also check if target is part of a markup (hit areas, text, etc.)
                  let annotationId: string | null = null;
                  let measurementId: string | null = null;
                  
                  // Try to get annotation ID from target or closest parent
                  if (target.hasAttribute('data-annotation-id')) {
                    annotationId = target.getAttribute('data-annotation-id');
                  } else {
                    const annotationParent = target.closest('[data-annotation-id]');
                    if (annotationParent) {
                      annotationId = annotationParent.getAttribute('data-annotation-id');
                    } else if (target.parentElement?.hasAttribute('data-annotation-id')) {
                      annotationId = target.parentElement.getAttribute('data-annotation-id');
                    }
                  }
                  
                  // Try to get measurement ID from target or closest parent
                  if (target.hasAttribute('data-measurement-id')) {
                    measurementId = target.getAttribute('data-measurement-id');
                  } else {
                    const measurementParent = target.closest('[data-measurement-id]');
                    if (measurementParent) {
                      measurementId = measurementParent.getAttribute('data-measurement-id');
                    } else if (target.parentElement?.hasAttribute('data-measurement-id')) {
                      measurementId = target.parentElement.getAttribute('data-measurement-id');
                    }
                  }
                  
                  // Handle annotation selection
                  if (annotationId && isSelectionMode) {
                    e.stopPropagation();
                    setSelectedMarkupId(annotationId);
                    return;
                  }
                  
                  // Handle measurement selection (measurements have their own click handlers via addEventListener)
                  // But we can also handle it here as a fallback
                  if (measurementId && isSelectionMode) {
                    e.stopPropagation();
                    setSelectedMarkupId(measurementId);
                    return;
                  }
                  
                  // For non-markup clicks, stop propagation and process normally
                  e.stopPropagation();
                  
                  // Note: Double-click detection removed - using native onDoubleClick handler instead
                  // This prevents duplicate calls to handleDoubleClick
                  
                  handleClick(e);
                }
              }}
              onContextMenu={(e) => {
                // Right-click context menu (currently unused)
              }}
              onDoubleClick={(e) => {
                // Handle double-click in annotation mode, measurement mode, or cutout mode
                if (annotationTool || isMeasuring || cutoutMode) {
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