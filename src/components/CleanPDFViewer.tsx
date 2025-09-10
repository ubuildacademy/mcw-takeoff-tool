import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { useTakeoffStore } from '../store/useTakeoffStore';
import CalibrationDialog from './CalibrationDialog';
import ScaleApplicationDialog from './ScaleApplicationDialog';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface CleanPDFViewerProps {
  file: File | string | any;
  className?: string;
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
  className = '' 
}) => {
  // Core PDF state
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // View state - single source of truth
  const [viewState, setViewState] = useState({ 
    scale: 1, 
    rotation: 0
  });
  
  // Measurement state
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measurementType, setMeasurementType] = useState<'linear' | 'area' | 'volume' | 'count'>('linear');
  const [currentMeasurement, setCurrentMeasurement] = useState<{ x: number; y: number }[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  
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
    getSheetTakeoffMeasurements
  } = useTakeoffStore();

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
        setTotalPages(pdf.numPages);
        setCurrentPage(1);
        
      } catch (error) {
        console.error('Error loading PDF:', error);
        setError('Failed to load PDF file');
      } finally {
        setIsLoading(false);
      }
    };

    loadPDF();
  }, [file]);

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
    if (!canvasRef.current || !viewportRef.current) return;
    
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;
    
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
      
      pdfPageRef.current.render(renderContext);
      
      // Draw annotations on top
      measurements.forEach(measurement => {
        renderMeasurement(context, measurement);
      });
      
      // Draw current measurement
      if (currentMeasurement.length > 0) {
        renderCurrentMeasurement(context);
      }
      
      // Draw calibration points
      if (isCalibrating && calibrationPoints.length > 0) {
        renderCalibrationPoints(context);
      }
      
      context.restore();
    }
  }, [measurements, currentMeasurement, measurementType, isCalibrating, calibrationPoints]);

  // Clean measurement rendering
  const renderMeasurement = (context: CanvasRenderingContext2D, measurement: Measurement) => {
    const points = measurement.points;
    if (points.length < 2) return;
    
    context.save();
    context.strokeStyle = measurement.color;
    context.fillStyle = measurement.color + '40';
    context.lineWidth = 2;
    
    switch (measurement.type) {
      case 'linear':
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
        break;
        
      case 'area':
        if (points.length >= 3) {
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

  // Handle canvas click for measurements and calibration
  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
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
    
    setCurrentMeasurement(prev => [...prev, { x, y }]);
    
    // Complete measurement based on type
    if (measurementType === 'count') {
      completeMeasurement([{ x, y }]);
    }
  }, [isMeasuring, isCalibrating, selectedConditionId, measurementType]);

  // Complete current measurement
  const completeMeasurement = useCallback((points: { x: number; y: number }[]) => {
    if (!selectedConditionId || points.length === 0) return;
    
    const selectedCondition = getSelectedCondition();
    if (!selectedCondition) return;
    
    let calculatedValue = 0;
    let unit = selectedCondition.unit;
    
    // Calculate value based on type
    switch (measurementType) {
      case 'linear':
        if (points.length >= 2) {
          let totalDistance = 0;
          for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i - 1].x;
            const dy = points[i].y - points[i - 1].y;
            totalDistance += Math.sqrt(dx * dx + dy * dy);
          }
          calculatedValue = totalDistance / scaleFactor;
        }
        break;
      case 'area':
        if (points.length >= 3) {
          let area = 0;
          for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
          }
          calculatedValue = Math.abs(area) / (2 * scaleFactor * scaleFactor);
        }
        break;
      case 'count':
        calculatedValue = 1;
        break;
    }
    
    // Create measurement object
    const measurement: Measurement = {
      id: Date.now().toString(),
      type: measurementType,
      points: points,
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
        points: points,
        calculatedValue,
        unit,
        pdfPage: currentPage,
        pdfCoordinates: points,
        conditionColor: selectedCondition.color,
        conditionName: selectedCondition.name
      });
    }
    
    // Clear current measurement
    setCurrentMeasurement([]);
  }, [selectedConditionId, getSelectedCondition, measurementType, scaleFactor, currentProjectId, addTakeoffMeasurement, currentPage, file.id]);

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
    
    // Clear calibration state
    setCalibrationPoints([]);
    setIsCalibrating(false);
    setCalibrationData(null);
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
        setViewState(prev => ({ ...prev, scale: newScale }));
      }
    }
    // If not Ctrl/Cmd, let the container handle normal scrolling
  }, [viewState.scale]);

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
      renderPage(currentPage);
    }
  }, [pdfDocument, currentPage, renderPage]);

  // Re-render when view state changes
  useEffect(() => {
    if (pdfDocument) {
      renderPage(currentPage);
    }
  }, [viewState, renderPage, currentPage]);

  // Start measuring when condition is selected
  useEffect(() => {
    if (selectedConditionId) {
      setIsMeasuring(true);
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

  // Calculate distance between two points
  const calculateDistance = (point1: { x: number; y: number }, point2: { x: number; y: number }) => {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    return Math.sqrt(dx * dx + dy * dy);
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
            setViewState(prev => ({
              ...prev,
              scale: Math.max(0.5, prev.scale - 0.1)
            }));
          }}
          className="px-3 py-1 bg-blue-600 text-white rounded"
        >
          -
        </button>
        <span className="px-3 py-1 bg-gray-100 rounded min-w-[60px] text-center">
          {Math.round(viewState.scale * 150)}%
        </span>
        <button
          onClick={() => {
            setViewState(prev => ({
              ...prev,
              scale: Math.min(5, prev.scale + 0.1)
            }));
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
          }}
          className="px-2 py-1 bg-gray-600 text-white rounded text-xs"
        >
          Reset
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

      {/* Canvas Container - Scrollable PDF viewing area */}
      <div 
        ref={containerRef}
        className="canvas-container flex-1 h-full"
        style={{ 
          cursor: isMeasuring ? 'crosshair' : (isCalibrating ? 'crosshair' : 'default')
        }}
      >
        <div className="flex items-center justify-center min-h-full p-4">
          <canvas
            ref={canvasRef}
            className="shadow-lg"
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

export default CleanPDFViewer;
