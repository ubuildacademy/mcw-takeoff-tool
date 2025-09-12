import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface SimplePDFViewerProps {
  file: any;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  scale: number;
  onScaleChange: (scale: number) => void;
  onCalibrateScale: () => void;
  onClearAll: () => void;
}

interface SimpleMeasurement {
  id: string;
  type: 'linear' | 'area';
  points: Array<{ x: number; y: number }>;
  value: number;
  unit: string;
  color: string;
  conditionName: string;
  page: number;
}

const SimplePDFViewer: React.FC<SimplePDFViewerProps> = ({
  file,
  currentPage,
  totalPages,
  onPageChange,
  scale,
  onScaleChange,
  onCalibrateScale,
  onClearAll
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Simple local storage for measurements - keyed by file and page
  const [measurements, setMeasurements] = useState<SimpleMeasurement[]>([]);
  
  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [selectedCondition, setSelectedCondition] = useState({
    id: 'default',
    name: 'Test Condition',
    color: '#ff0000',
    unit: 'ft'
  });

  // Load PDF
  useEffect(() => {
    if (!file?.url) return;
    
    setIsLoading(true);
    setError(null);
    
    pdfjsLib.getDocument(file.url).promise
      .then((doc) => {
        setPdfDocument(doc);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setIsLoading(false);
      });
  }, [file?.url]);

  // Load measurements for current page
  useEffect(() => {
    if (!file?.id) return;
    
    const key = `${file.id}_${currentPage}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const pageMeasurements = JSON.parse(saved);
        setMeasurements(pageMeasurements);
      } catch (e) {
        console.error('Error loading measurements:', e);
        setMeasurements([]);
      }
    } else {
      setMeasurements([]);
    }
  }, [file?.id, currentPage]);

  // Save measurements for current page
  const saveMeasurements = useCallback((newMeasurements: SimpleMeasurement[]) => {
    if (!file?.id) return;
    
    const key = `${file.id}_${currentPage}`;
    localStorage.setItem(key, JSON.stringify(newMeasurements));
    setMeasurements(newMeasurements);
  }, [file?.id, currentPage]);

  // Render PDF page
  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDocument || !canvasRef.current) return;
    
    const page = await pdfDocument.getPage(pageNum);
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    
    if (!context) return;
    
    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    const renderContext = {
      canvasContext: context,
      viewport: viewport
    };
    
    await page.render(renderContext).promise;
    
    // Draw measurements for this page
    measurements.forEach(measurement => {
      if (measurement.page === pageNum) {
        drawMeasurement(context, measurement);
      }
    });
  }, [pdfDocument, scale, measurements]);

  // Draw a measurement
  const drawMeasurement = (context: CanvasRenderingContext2D, measurement: SimpleMeasurement) => {
    context.strokeStyle = measurement.color;
    context.lineWidth = 2;
    context.setLineDash([]);
    
    if (measurement.type === 'linear' && measurement.points.length >= 2) {
      context.beginPath();
      context.moveTo(measurement.points[0].x, measurement.points[0].y);
      context.lineTo(measurement.points[1].x, measurement.points[1].y);
      context.stroke();
      
      // Draw value
      const midX = (measurement.points[0].x + measurement.points[1].x) / 2;
      const midY = (measurement.points[0].y + measurement.points[1].y) / 2;
      context.fillStyle = measurement.color;
      context.font = '12px Arial';
      context.fillText(`${measurement.value} ${measurement.unit}`, midX, midY - 5);
    } else if (measurement.type === 'area' && measurement.points.length >= 3) {
      context.beginPath();
      context.moveTo(measurement.points[0].x, measurement.points[0].y);
      for (let i = 1; i < measurement.points.length; i++) {
        context.lineTo(measurement.points[i].x, measurement.points[i].y);
      }
      context.closePath();
      context.stroke();
      
      // Draw value
      const centerX = measurement.points.reduce((sum, p) => sum + p.x, 0) / measurement.points.length;
      const centerY = measurement.points.reduce((sum, p) => sum + p.y, 0) / measurement.points.length;
      context.fillStyle = measurement.color;
      context.font = '12px Arial';
      context.fillText(`${measurement.value} ${measurement.unit}²`, centerX, centerY);
    }
  };

  // Render page when dependencies change
  useEffect(() => {
    if (pdfDocument && currentPage) {
      renderPage(currentPage);
    }
  }, [pdfDocument, currentPage, renderPage]);

  // Mouse event handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setIsDrawing(true);
    setCurrentPoints([{ x, y }]);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setCurrentPoints(prev => [...prev, { x, y }]);
  };

  const handleMouseUp = () => {
    if (!isDrawing || currentPoints.length < 2) {
      setIsDrawing(false);
      setCurrentPoints([]);
      return;
    }
    
    // Calculate measurement
    let value = 0;
    let type: 'linear' | 'area' = 'linear';
    
    if (currentPoints.length === 2) {
      // Linear measurement
      const dx = currentPoints[1].x - currentPoints[0].x;
      const dy = currentPoints[1].y - currentPoints[0].y;
      value = Math.sqrt(dx * dx + dy * dy) / 10; // Simple scale
      type = 'linear';
    } else {
      // Area measurement (simple approximation)
      value = currentPoints.length * 10; // Simple approximation
      type = 'area';
    }
    
    // Create new measurement
    const newMeasurement: SimpleMeasurement = {
      id: Date.now().toString(),
      type,
      points: [...currentPoints],
      value: Math.round(value * 100) / 100,
      unit: selectedCondition.unit,
      color: selectedCondition.color,
      conditionName: selectedCondition.name,
      page: currentPage
    };
    
    // Save measurement
    const newMeasurements = [...measurements, newMeasurement];
    saveMeasurements(newMeasurements);
    
    // Re-render page
    renderPage(currentPage);
    
    setIsDrawing(false);
    setCurrentPoints([]);
  };

  // Clear all measurements for current page
  const clearAll = () => {
    saveMeasurements([]);
    renderPage(currentPage);
    onClearAll();
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-full">Loading PDF...</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center h-full text-red-500">Error: {error}</div>;
  }

  if (!pdfDocument) {
    return <div className="flex items-center justify-center h-full">No PDF loaded</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center justify-between p-4 bg-gray-100 border-b">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="px-3 py-1 bg-blue-500 text-white rounded disabled:bg-gray-300"
          >
            Previous
          </button>
          <span className="text-sm">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="px-3 py-1 bg-blue-500 text-white rounded disabled:bg-gray-300"
          >
            Next
          </button>
        </div>
        
        <div className="flex items-center space-x-4">
          <button
            onClick={() => onScaleChange(scale * 0.8)}
            className="px-3 py-1 bg-gray-500 text-white rounded"
          >
            Zoom Out
          </button>
          <span className="text-sm">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => onScaleChange(scale * 1.25)}
            className="px-3 py-1 bg-gray-500 text-white rounded"
          >
            Zoom In
          </button>
          <button
            onClick={onCalibrateScale}
            className="px-3 py-1 bg-green-500 text-white rounded"
          >
            Calibrate
          </button>
          <button
            onClick={clearAll}
            className="px-3 py-1 bg-red-500 text-white rounded"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* PDF Canvas */}
      <div className="flex-1 overflow-auto bg-gray-200 p-4">
        <div className="inline-block">
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            className="border border-gray-300 cursor-crosshair"
          />
        </div>
      </div>

      {/* Status */}
      <div className="p-2 bg-gray-100 border-t text-sm text-gray-600">
        {isDrawing ? 'Drawing...' : 'Click and drag to measure'}
        {measurements.length > 0 && ` | ${measurements.length} measurements on this page`}
      </div>
    </div>
  );
};

export default SimplePDFViewer;
