import React, { useState, useRef, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Badge } from './ui/badge';
import { 
  MousePointer, 
  Square, 
  Check, 
  X, 
  RotateCcw,
  Save,
  Eye,
  EyeOff
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface TitleblockField {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

interface TitleblockConfig {
  sheetNumberField: TitleblockField;
  sheetNameField: TitleblockField;
}

interface TitleblockConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: TitleblockConfig) => void;
  documentId: string;
  pageNumber?: number;
  existingConfig?: TitleblockConfig;
}

export function TitleblockConfigDialog({
  isOpen,
  onClose,
  onSave,
  documentId,
  pageNumber = 1,
  existingConfig
}: TitleblockConfigDialogProps) {
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(pageNumber);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Canvas and viewport refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<any>(null);
  
  // Configuration state
  const [config, setConfig] = useState<TitleblockConfig>(() => 
    existingConfig || {
      sheetNumberField: {
        name: 'Sheet Number',
        x: 0.1,
        y: 0.05,
        width: 0.15,
        height: 0.03,
        color: '#3B82F6'
      },
      sheetNameField: {
        name: 'Sheet Name',
        x: 0.3,
        y: 0.05,
        width: 0.4,
        height: 0.03,
        color: '#10B981'
      }
    }
  );
  
  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingField, setDrawingField] = useState<'sheetNumberField' | 'sheetNameField' | null>(null);
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number } | null>(null);
  const [previewRect, setPreviewRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  
  // View state
  const [scale, setScale] = useState(1);
  const [showFields, setShowFields] = useState(true);

  // Load PDF document
  useEffect(() => {
    const loadPDF = async () => {
      if (!documentId || !isOpen) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        const pdfUrl = `http://localhost:4000/api/files/${documentId}`;
        const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
        setPdfDocument(pdf);
        setTotalPages(pdf.numPages);
        setCurrentPage(Math.min(pageNumber, pdf.numPages));
      } catch (error) {
        console.error('Error loading PDF:', error);
        setError('Failed to load PDF file');
      } finally {
        setIsLoading(false);
      }
    };

    loadPDF();
  }, [documentId, isOpen, pageNumber]);

  // Render PDF page
  const renderPage = async (pageNum: number) => {
    if (!pdfDocument || !canvasRef.current) return;
    
    try {
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      viewportRef.current = viewport;
      
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      if (context) {
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;
        
        // Draw field rectangles
        if (showFields) {
          drawFieldRectangles(context, viewport);
        }
      }
    } catch (error) {
      console.error('Error rendering page:', error);
    }
  };

  // Draw field rectangles on canvas
  const drawFieldRectangles = (context: CanvasRenderingContext2D, viewport: any) => {
    const fields = [config.sheetNumberField, config.sheetNameField];
    
    fields.forEach(field => {
      const x = field.x * viewport.width;
      const y = field.y * viewport.height;
      const width = field.width * viewport.width;
      const height = field.height * viewport.height;
      
      // Draw rectangle
      context.strokeStyle = field.color;
      context.lineWidth = 2;
      context.setLineDash([5, 5]);
      context.strokeRect(x, y, width, height);
      
      // Draw label
      context.fillStyle = field.color;
      context.font = '12px Arial';
      context.setLineDash([]);
      context.fillText(field.name, x, y - 5);
    });
  };

  // Handle canvas mouse events
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawingField || !viewportRef.current) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    
    setIsDrawing(true);
    setDrawingStart({ x, y });
    setPreviewRect({ x, y, width: 0, height: 0 });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !drawingStart || !viewportRef.current) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    
    const width = x - drawingStart.x;
    const height = y - drawingStart.y;
    
    setPreviewRect({
      x: Math.min(drawingStart.x, x),
      y: Math.min(drawingStart.y, y),
      width: Math.abs(width),
      height: Math.abs(height)
    });
  };

  const handleCanvasMouseUp = () => {
    if (!isDrawing || !drawingStart || !previewRect || !drawingField || !viewportRef.current) return;
    
    // Convert canvas coordinates to normalized coordinates (0-1)
    const viewport = viewportRef.current;
    const normalizedRect = {
      x: previewRect.x / viewport.width,
      y: previewRect.y / viewport.height,
      width: previewRect.width / viewport.width,
      height: previewRect.height / viewport.height
    };
    
    // Update config
    setConfig(prev => ({
      ...prev,
      [drawingField]: {
        ...prev[drawingField],
        x: normalizedRect.x,
        y: normalizedRect.y,
        width: normalizedRect.width,
        height: normalizedRect.height
      }
    }));
    
    // Reset drawing state
    setIsDrawing(false);
    setDrawingStart(null);
    setPreviewRect(null);
    setDrawingField(null);
  };

  // Handle page navigation
  const goToPage = (pageNum: number) => {
    if (pageNum >= 1 && pageNum <= totalPages) {
      setCurrentPage(pageNum);
    }
  };

  // Handle field selection
  const selectField = (fieldName: 'sheetNumberField' | 'sheetNameField') => {
    setDrawingField(fieldName);
  };

  // Handle save
  const handleSave = () => {
    onSave(config);
    onClose();
  };

  // Render page when dependencies change
  useEffect(() => {
    if (pdfDocument && currentPage) {
      renderPage(currentPage);
    }
  }, [pdfDocument, currentPage, scale, config, showFields]);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Configure Titleblock Fields</DialogTitle>
        </DialogHeader>
        
        <div className="flex gap-4 h-[600px]">
          {/* Left Panel - Controls */}
          <div className="w-80 space-y-4 overflow-y-auto">
            {/* Page Navigation */}
            <div className="space-y-2">
              <Label>Page</Label>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                >
                  ←
                </Button>
                <span className="text-sm">
                  {currentPage} of {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                >
                  →
                </Button>
              </div>
            </div>

            {/* Field Configuration */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Field Configuration</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowFields(!showFields)}
                >
                  {showFields ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>

              {/* Sheet Number Field */}
              <div className="space-y-2 p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <div 
                    className="w-4 h-4 rounded border-2 cursor-pointer"
                    style={{ backgroundColor: config.sheetNumberField.color }}
                    onClick={() => selectField('sheetNumberField')}
                  />
                  <Label className="text-sm font-medium">Sheet Number Field</Label>
                  {drawingField === 'sheetNumberField' && (
                    <Badge variant="outline" className="text-xs">Drawing</Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <Label className="text-xs">X: {Math.round(config.sheetNumberField.x * 100)}%</Label>
                  </div>
                  <div>
                    <Label className="text-xs">Y: {Math.round(config.sheetNumberField.y * 100)}%</Label>
                  </div>
                  <div>
                    <Label className="text-xs">W: {Math.round(config.sheetNumberField.width * 100)}%</Label>
                  </div>
                  <div>
                    <Label className="text-xs">H: {Math.round(config.sheetNumberField.height * 100)}%</Label>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => selectField('sheetNumberField')}
                  className="w-full"
                >
                  <MousePointer className="w-3 h-3 mr-1" />
                  Draw Sheet Number Field
                </Button>
              </div>

              {/* Sheet Name Field */}
              <div className="space-y-2 p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <div 
                    className="w-4 h-4 rounded border-2 cursor-pointer"
                    style={{ backgroundColor: config.sheetNameField.color }}
                    onClick={() => selectField('sheetNameField')}
                  />
                  <Label className="text-sm font-medium">Sheet Name Field</Label>
                  {drawingField === 'sheetNameField' && (
                    <Badge variant="outline" className="text-xs">Drawing</Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <Label className="text-xs">X: {Math.round(config.sheetNameField.x * 100)}%</Label>
                  </div>
                  <div>
                    <Label className="text-xs">Y: {Math.round(config.sheetNameField.y * 100)}%</Label>
                  </div>
                  <div>
                    <Label className="text-xs">W: {Math.round(config.sheetNameField.width * 100)}%</Label>
                  </div>
                  <div>
                    <Label className="text-xs">H: {Math.round(config.sheetNameField.height * 100)}%</Label>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => selectField('sheetNameField')}
                  className="w-full"
                >
                  <MousePointer className="w-3 h-3 mr-1" />
                  Draw Sheet Name Field
                </Button>
              </div>
            </div>

            {/* Instructions */}
            <div className="p-3 bg-blue-50 rounded-lg">
              <h4 className="font-medium text-sm mb-2">Instructions:</h4>
              <ol className="text-xs space-y-1 text-blue-800">
                <li>1. Select a field to configure</li>
                <li>2. Click and drag on the PDF to draw the field area</li>
                <li>3. The field will be used to extract sheet numbers and names</li>
                <li>4. Navigate through pages to ensure consistency</li>
              </ol>
            </div>
          </div>

          {/* Right Panel - PDF Viewer */}
          <div className="flex-1 flex flex-col">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                  <p className="text-gray-600">Loading PDF...</p>
                </div>
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-red-600">
                  <p className="text-lg font-semibold mb-2">Error Loading PDF</p>
                  <p className="text-sm">{error}</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                {/* PDF Controls */}
                <div className="flex items-center justify-between p-2 border-b">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Scale:</Label>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setScale(Math.max(0.5, scale - 0.1))}
                    >
                      -
                    </Button>
                    <span className="text-sm w-12 text-center">{Math.round(scale * 100)}%</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setScale(Math.min(2, scale + 0.1))}
                    >
                      +
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setScale(1)}
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </div>

                {/* PDF Canvas */}
                <div 
                  ref={containerRef}
                  className="flex-1 overflow-auto bg-gray-100 p-4"
                >
                  <div className="inline-block">
                    <canvas
                      ref={canvasRef}
                      className="border shadow-lg bg-white"
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      onMouseLeave={() => {
                        setIsDrawing(false);
                        setDrawingStart(null);
                        setPreviewRect(null);
                      }}
                      style={{ cursor: drawingField ? 'crosshair' : 'default' }}
                    />
                    
                    {/* Preview Rectangle */}
                    {previewRect && (
                      <div
                        className="absolute border-2 border-dashed border-blue-500 pointer-events-none"
                        style={{
                          left: previewRect.x * scale + 16,
                          top: previewRect.y * scale + 16,
                          width: previewRect.width * scale,
                          height: previewRect.height * scale,
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
