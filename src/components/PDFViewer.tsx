import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { 
  Search, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Download,
  Layers,
  Eye,
  EyeOff,
  Move,
  Maximize2
} from 'lucide-react';
import { fileService } from '../services/apiService';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface PDFViewerProps {
  fileId: string;
  fileName: string;
  onSearch: (query: string) => void;
  searchResults?: string[];
}

interface MarkupLayer {
  id: string;
  name: string;
  visible: boolean;
  color: string;
  elements: MarkupElement[];
}

interface MarkupElement {
  id: string;
  type: 'line' | 'rectangle' | 'circle' | 'polygon' | 'text';
  points: { x: number; y: number }[];
  color: string;
  strokeWidth: number;
  fill?: string;
  text?: string;
  measurements?: {
    length?: number;
    area?: number;
    volume?: number;
  };
}

export function PDFViewer({ fileId, fileName, onSearch, searchResults }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  
  // Panning and scrolling state
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [isMiddleClickDragging, setIsMiddleClickDragging] = useState<boolean>(false);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [lastMousePos, setLastMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [drawingTool, setDrawingTool] = useState<string>('select');
  const [currentPath, setCurrentPath] = useState<{ x: number; y: number }[]>([]);
  const [layers, setLayers] = useState<MarkupLayer[]>([
    {
      id: 'default',
      name: 'Default Layer',
      visible: true,
      color: '#ff0000',
      elements: []
    }
  ]);

  // Load PDF file when component mounts
  useEffect(() => {
    async function loadPDF() {
      if (!fileId) return;
      
      try {
        setIsLoading(true);
        setError(null);
        
        // Get the PDF blob from the backend
        const pdfBlob = await fileService.getPDF(fileId);
        const url = URL.createObjectURL(pdfBlob);
        setPdfUrl(url);
        
      } catch (error) {
        console.error('Error loading PDF:', error);
        setError('Failed to load PDF file');
      } finally {
        setIsLoading(false);
      }
    }
    
    loadPDF();
    
    // Cleanup function to revoke object URL
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [fileId]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    console.log('PDF loaded successfully with', numPages, 'pages');
    setNumPages(numPages);
    setIsLoading(false);
  };

  const onDocumentLoadError = (error: Error) => {
    setError(error.message);
    setIsLoading(false);
  };

  const handleZoomIn = () => {
    setScale(prev => Math.min(prev + 0.25, 3.0));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(prev - 0.25, 0.25));
  };

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const handleSearch = () => {
    if (searchQuery.trim()) {
      onSearch(searchQuery);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // Panning handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.button === 0 && isPanning) || e.button === 1) { // Left click + panning mode OR middle click
      e.preventDefault();
      e.stopPropagation();
      setLastMousePos({ x: e.clientX, y: e.clientY });
      if (e.button === 1) {
        setIsMiddleClickDragging(true);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if ((isPanning && e.buttons === 1) || e.buttons === 4) { // Left button + panning mode OR middle button
      e.preventDefault();
      e.stopPropagation();
      
      const deltaX = e.clientX - lastMousePos.x;
      const deltaY = e.clientY - lastMousePos.y;
      
      setPanOffset(prev => ({
        x: prev.x + deltaX,
        y: prev.y + deltaY
      }));
      
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isPanning || e.button === 1) { // Middle click or panning mode
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 1) {
        setIsMiddleClickDragging(false);
      }
    }
  };

  const togglePanning = () => {
    setIsPanning(!isPanning);
  };

  const resetView = () => {
    setPanOffset({ x: 0, y: 0 });
    setScale(1.0);
    setRotation(0);
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Always prevent default to stop page scrolling
    e.preventDefault();
    e.stopPropagation();
    
    if (e.ctrlKey || e.metaKey) {
      // Zoom with Ctrl/Cmd + wheel
      const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale(prev => Math.max(0.25, Math.min(3.0, prev + zoomDelta)));
    } else {
      // Pan with regular wheel
      setPanOffset(prev => ({
        x: prev.x - e.deltaX * 0.5,
        y: prev.y - e.deltaY * 0.5
      }));
    }
  };

  const handleDownload = () => {
    if (pdfUrl) {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">{error}</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (!pdfUrl) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">No PDF file loaded</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50">
      {/* Toolbar */}
      <div className="bg-white border-b p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search in document..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              className="w-64"
            />
            <Button size="sm" onClick={handleSearch}>
              <Search className="w-4 h-4" />
            </Button>
          </div>
          
          {searchResults && searchResults.length > 0 && (
            <div className="text-sm text-muted-foreground">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
            </div>
          )}
          
          <div className="text-xs text-muted-foreground">
            {isPanning ? 'Panning mode: Click and drag to move' : 'Scroll to pan • Ctrl+Scroll to zoom • Middle-click drag to pan'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button 
            variant={isPanning ? "default" : "outline"} 
            size="sm" 
            onClick={togglePanning}
            title="Toggle panning mode"
          >
            <Move className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleZoomOut}>
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-sm min-w-[60px] text-center">{Math.round(scale * 100)}%</span>
          <Button variant="outline" size="sm" onClick={handleZoomIn}>
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleRotate}>
            <RotateCw className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={resetView} title="Reset view">
            <Maximize2 className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* PDF Content */}
      <div 
        className="flex-1 overflow-hidden relative select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        style={{ cursor: (isPanning || isMiddleClickDragging) ? 'grab' : 'default' }}
      >
        <div 
          className="absolute inset-0 flex justify-center items-start p-4"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
            transition: isPanning ? 'none' : 'transform 0.1s ease-out'
          }}
        >
          <Document
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            }
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              rotate={rotation}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          </Document>
        </div>
      </div>

      {/* Page Navigation */}
      {numPages > 1 && (
        <div className="bg-white border-t p-3 flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageNumber(prev => Math.max(prev - 1, 1))}
            disabled={pageNumber <= 1}
          >
            Previous
          </Button>
          
          <span className="text-sm">
            Page {pageNumber} of {numPages}
          </span>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageNumber(prev => Math.min(prev + 1, numPages))}
            disabled={pageNumber >= numPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
