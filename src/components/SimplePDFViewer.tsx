import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import CalibrationDialog from './CalibrationDialog';
import ScaleApplicationDialog from './ScaleApplicationDialog';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface SimplePDFViewerProps {
  file: File | string | any;
  className?: string;
  onCalibrationRequest?: () => void;
}

const SimplePDFViewer: React.FC<SimplePDFViewerProps> = ({ file, className = '', onCalibrationRequest }) => {
  const [pdf, setPdf] = useState<any>(null);
  const [page, setPage] = useState<any>(null);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Calibration state
  const [isPageCalibrated, setIsPageCalibrated] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<{ x: number; y: number }[]>([]);
  const [showCalibrationDialog, setShowCalibrationDialog] = useState(false);
  const [showScaleApplicationDialog, setShowScaleApplicationDialog] = useState(false);
  const [pendingScaleData, setPendingScaleData] = useState<{scaleFactor: number, unit: string} | null>(null);
  const [calibrationData, setCalibrationData] = useState<{knownDistance: number, unit: string} | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const pageWrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);
  const isRenderingRef = useRef(false);

  const ZOOM_STEP = 1.1;
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 8;

  // Debounce function
  const debounce = (fn: Function, ms = 150) => {
    let timeoutId: NodeJS.Timeout;
    return (...args: any[]) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), ms);
    };
  };

  // Load PDF
  useEffect(() => {
    const loadPDF = async () => {
      if (!file) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        let pdfUrl;
        let objectUrl: string | null = null;
        
        if (typeof file === 'string') {
          pdfUrl = file;
        } else if (file instanceof File) {
          objectUrl = URL.createObjectURL(file);
          pdfUrl = objectUrl;
        } else if (file && file.id) {
          pdfUrl = `http://localhost:4000/api/files/${file.id}`;
        } else {
          throw new Error('Invalid file object provided');
        }
        
        const doc = await pdfjsLib.getDocument(pdfUrl).promise;
        setPdf(doc);
        const firstPage = await doc.getPage(1);
        setPage(firstPage);
        
        // Calculate initial scale to fit container
        if (containerRef.current) {
          const container = containerRef.current;
          const containerWidth = container.clientWidth;
          const containerHeight = container.clientHeight;
          const viewport = firstPage.getViewport({ scale: 1, rotation });
          const scaleX = containerWidth / viewport.width;
          const scaleY = containerHeight / viewport.height;
          const fitScale = Math.min(scaleX, scaleY);
          setScale(fitScale);
        }
        
      } catch (error) {
        console.error('Error loading PDF:', error);
        setError('Failed to load PDF file');
      } finally {
        setIsLoading(false);
      }
    };

    loadPDF();
  }, [file, rotation]);

  // Render function
  const renderAt = useCallback(async (renderScale: number, renderRotation: number) => {
    if (!page || !canvasRef.current || !containerRef.current || !pageWrapRef.current) return;
    
    if (isRenderingRef.current) return;
    isRenderingRef.current = true;

    try {
      // Cancel previous render
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const viewport = page.getViewport({ scale: renderScale, rotation: renderRotation });
      
      // Set canvas CSS size
      const cssWidth = Math.floor(viewport.width);
      const cssHeight = Math.floor(viewport.height);
      
      canvas.style.width = cssWidth + 'px';
      canvas.style.height = cssHeight + 'px';
      canvas.style.transform = 'none'; // Critical: identity transform
      
      // Set canvas pixel size for HiDPI
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(cssWidth * dpr);
      canvas.height = Math.floor(cssHeight * dpr);
      
      // Reset and set transform for HiDPI
      if (ctx.resetTransform) ctx.resetTransform();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      
      // Render PDF
      const renderContext = {
        canvasContext: ctx,
        viewport: viewport
      };
      
      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      
      // Set page wrap size to match canvas for scroll bounds
      pageWrapRef.current.style.width = cssWidth + 'px';
      pageWrapRef.current.style.height = cssHeight + 'px';
      
      console.log('Rendered at scale:', renderScale, 'Canvas size:', cssWidth, 'x', cssHeight);
      
    } catch (error: any) {
      if (error.name !== 'RenderingCancelledException') {
        console.error('Error rendering page:', error);
      }
    } finally {
      isRenderingRef.current = false;
    }
  }, [page]);

  const rerender = useCallback(debounce(() => renderAt(scale, rotation), 150), [renderAt, scale, rotation]);

  // Render when scale or rotation changes
  useEffect(() => {
    if (page) {
      renderAt(scale, rotation);
    }
  }, [page, scale, rotation, renderAt]);

  // Debug: Log when scale changes
  useEffect(() => {
    console.log('Scale changed to:', scale);
  }, [scale]);

  // Zoom at cursor
  const zoomAtCursor = useCallback((deltaY: number, anchorClientX: number, anchorClientY: number) => {
    const container = containerRef.current;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const anchorX = anchorClientX - rect.left + container.scrollLeft;
    const anchorY = anchorClientY - rect.top + container.scrollTop;
    
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (deltaY < 0 ? ZOOM_STEP : 1/ZOOM_STEP)));
    if (next === scale) return;
    
    const k = next / scale;
    container.scrollLeft = (container.scrollLeft + anchorX) * k - anchorX;
    container.scrollTop = (container.scrollTop + anchorY) * k - anchorY;
    
    setScale(next);
    rerender();
  }, [scale, rerender]);

  // Wheel event handler
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAtCursor(e.deltaY, e.clientX, e.clientY);
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        container.scrollLeft += delta;
        return;
      }
      // Default: vertical scroll (do not preventDefault)
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomAtCursor]);

  // Drag to pan
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      container.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      startScrollLeft = container.scrollLeft;
      startScrollTop = container.scrollTop;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      container.scrollLeft = startScrollLeft - (e.clientX - startX);
      container.scrollTop = startScrollTop - (e.clientY - startY);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      container.releasePointerCapture(e.pointerId);
    };

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerUp);

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerUp);
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

  if (!pdf) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <p className="text-gray-600">No PDF loaded</p>
      </div>
    );
  }

  return (
    <div className={`relative h-full ${className}`}>
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
      </div>

      {/* Simple controls */}
      <div className="absolute top-4 right-4 z-10 bg-white rounded-lg shadow-lg p-2 flex items-center gap-2">
        <button
          onClick={() => {
            const newScale = Math.max(MIN_SCALE, scale - 0.1);
            console.log('Zoom out:', scale, '->', newScale);
            setScale(newScale);
          }}
          className="px-3 py-1 bg-blue-600 text-white rounded"
        >
          -
        </button>
        <span className="px-3 py-1 bg-gray-100 rounded min-w-[60px] text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={() => {
            const newScale = Math.min(MAX_SCALE, scale + 0.1);
            console.log('Zoom in:', scale, '->', newScale);
            setScale(newScale);
          }}
          className="px-3 py-1 bg-blue-600 text-white rounded"
        >
          +
        </button>
        <button
          onClick={() => {
            // Fit to container
            if (containerRef.current && page) {
              const container = containerRef.current;
              const containerWidth = container.clientWidth;
              const containerHeight = container.clientHeight;
              const viewport = page.getViewport({ scale: 1, rotation });
              const scaleX = containerWidth / viewport.width;
              const scaleY = containerHeight / viewport.height;
              const fitScale = Math.min(scaleX, scaleY);
              console.log('Fit to container:', fitScale);
              setScale(fitScale);
            }
          }}
          className="px-2 py-1 bg-gray-600 text-white rounded text-xs"
        >
          Fit
        </button>
      </div>

      {/* PDF Container - This is the scroll container */}
      <div 
        ref={containerRef}
        className="w-full h-full overflow-auto bg-gray-100 flex items-center justify-center"
        style={{ 
          minWidth: 0,
          minHeight: 0,
          scrollSnapType: 'none'
        }}
      >
        {/* PDF Page Wrap */}
        <div 
          ref={pageWrapRef}
          className="relative inline-block"
        >
          {/* PDF Canvas */}
          <canvas
            ref={canvasRef}
            className="block"
            style={{ willChange: 'transform' }}
          />
        </div>
      </div>

      {/* Calibration Dialog */}
      <CalibrationDialog
        isOpen={showCalibrationDialog}
        onClose={() => setShowCalibrationDialog(false)}
        onStartCalibration={(knownDistance: number, unit: string) => {
          setCalibrationData({ knownDistance, unit });
          setIsCalibrating(true);
          setCalibrationPoints([]);
          setShowCalibrationDialog(false);
        }}
        currentScale={isPageCalibrated ? { scaleFactor: 1, unit: 'ft' } : null}
        isCalibrating={isCalibrating}
      />

      {/* Scale Application Dialog */}
      <ScaleApplicationDialog
        isOpen={showScaleApplicationDialog}
        onClose={() => setShowScaleApplicationDialog(false)}
        onApply={(scope: 'page' | 'document') => {
          if (pendingScaleData) {
            setIsPageCalibrated(true);
            setPendingScaleData(null);
            setShowScaleApplicationDialog(false);
            console.log('Scale applied:', pendingScaleData, 'scope:', scope);
          }
        }}
        scaleFactor={pendingScaleData?.scaleFactor || 0}
        unit={pendingScaleData?.unit || 'ft'}
        currentPage={1}
        totalPages={1}
      />
    </div>
  );
};

export default SimplePDFViewer;
