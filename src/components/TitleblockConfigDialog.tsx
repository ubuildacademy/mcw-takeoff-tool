import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  EyeOff,
  Play,
  Loader2
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import type { TitleblockField, TitleblockConfig } from '../types';
import { ocrService } from '../services/ocrService';
import { enhancedOcrService } from '../services/enhancedOcrService';
import { ocrTrainingService } from '../services/ocrTrainingService';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// TitleblockField and TitleblockConfig interfaces imported from shared types

interface TitleblockConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: TitleblockConfig) => void;
  documentId: string;
  pageNumber?: number;
  existingConfig?: TitleblockConfig;
  onExtractSheetNames?: (sheetNames: Array<{ pageNumber: number; sheetNumber: string; sheetName: string }>) => void;
  projectId?: string;
}

export function TitleblockConfigDialog({
  isOpen,
  onClose,
  onSave,
  documentId,
  pageNumber = 1,
  existingConfig,
  onExtractSheetNames,
  projectId
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
  const renderTaskRef = useRef<any>(null);
  
  // Configuration state - start with no field positions, require manual positioning
  const [config, setConfig] = useState<TitleblockConfig>(() => 
    existingConfig || {
      sheetNumberField: {
        name: 'Sheet Number',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        color: '#3B82F6'
      },
      sheetNameField: {
        name: 'Sheet Name',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        color: '#10B981'
      }
    }
  );
  
  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingField, setDrawingField] = useState<'sheetNumberField' | 'sheetNameField' | null>(null);
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number } | null>(null);
  const [previewRect, setPreviewRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  
  // Field editing state
  const [editingField, setEditingField] = useState<'sheetNumberField' | 'sheetNameField' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; fieldX: number; fieldY: number; fieldWidth: number; fieldHeight: number } | null>(null);
  
  // View state
  const [scale, setScale] = useState(1);
  const [showFields, setShowFields] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  
  // Panning state
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);
  
  // OCR extraction state
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState({ current: 0, total: 0 });
  const [extractedSheetNames, setExtractedSheetNames] = useState<Array<{ pageNumber: number; sheetNumber: string; sheetName: string }>>([]);
  

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

  // Fit PDF to window function
  const fitToWindow = useCallback(async () => {
    if (!pdfDocument || !containerRef.current) {
      return;
    }

    try {
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      
      // Get available space in container (accounting for padding and controls)
      const availableWidth = containerRect.width - 32; // 16px padding on each side
      const availableHeight = containerRect.height - 80; // Account for controls and padding
      
      // Get the current page to calculate its dimensions
      const page = await pdfDocument.getPage(currentPage);
      const viewport = page.getViewport({ scale: 1.0 });
      
      // Calculate scale to fit both width and height, ensuring entire page is visible
      const scaleX = availableWidth / viewport.width;
      const scaleY = availableHeight / viewport.height;
      const optimalScale = Math.min(scaleX, scaleY, 1.5); // Cap at 1.5x zoom for dialog
      
      // Ensure minimum scale for readability
      const finalScale = Math.max(optimalScale, 0.3);
      
      setScale(finalScale);
      setIsInitialized(true);
      
      console.log(`Fit to window: container=${containerRect.width}x${containerRect.height}, page=${viewport.width}x${viewport.height}, scale=${finalScale}`);
    } catch (error) {
      console.error('Error fitting to window:', error);
    }
  }, [pdfDocument, currentPage]);

  // Render PDF page
  const renderPage = async (pageNum: number) => {
    if (!pdfDocument || !canvasRef.current) return;
    
    try {
      // Cancel any existing render task
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      
      const page = await pdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      viewportRef.current = viewport;
      
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      if (context) {
        // Clear the canvas first
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Start new render task
        const renderTask = page.render({
          canvasContext: context,
          viewport: viewport
        });
        
        renderTaskRef.current = renderTask;
        
        await renderTask.promise;
        
        // Draw field rectangles
        if (showFields) {
          drawFieldRectangles(context, viewport);
        }
        
        renderTaskRef.current = null;
      }
    } catch (error) {
      console.error('Error rendering page:', error);
      renderTaskRef.current = null;
    }
  };

  // Draw field rectangles on canvas
  const drawFieldRectangles = (context: CanvasRenderingContext2D, viewport: any) => {
    const fields = [
      { field: config.sheetNumberField, key: 'sheetNumberField' as const },
      { field: config.sheetNameField, key: 'sheetNameField' as const }
    ];
    
    fields.forEach(({ field, key }) => {
      const x = field.x * viewport.width;
      const y = field.y * viewport.height;
      const width = field.width * viewport.width;
      const height = field.height * viewport.height;
      
      // Different styles for editing vs normal
      const isEditing = editingField === key;
      const isDrawing = drawingField === key;
      
      // Draw rectangle with different styles
      context.strokeStyle = isEditing ? '#FF6B35' : (isDrawing ? '#FFD700' : field.color);
      context.lineWidth = isEditing ? 4 : 3;
      context.setLineDash(isEditing ? [] : [8, 4]);
      context.strokeRect(x, y, width, height);
      
      // Draw label background
      context.fillStyle = isEditing ? 'rgba(255, 107, 53, 0.9)' : 'rgba(255, 255, 255, 0.9)';
      context.fillRect(x, y - 20, Math.max(80, field.name.length * 8), 18);
      
      // Draw label
      context.fillStyle = isEditing ? '#FFFFFF' : field.color;
      context.font = 'bold 12px Arial';
      context.setLineDash([]);
      context.fillText(field.name + (isEditing ? ' (editing)' : ''), x + 4, y - 6);
    });
  };

  // Handle canvas mouse events for drawing and editing
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !viewportRef.current) return;
    
    // Prevent event from bubbling to container
    e.stopPropagation();
    
    // Get precise canvas coordinates accounting for device pixel ratio
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    const viewport = viewportRef.current;
    
    // Check if clicking on an existing field for editing
    if (isPointInField(x, y, config.sheetNumberField, viewport)) {
      console.log('Clicked on Sheet Number field - starting drag');
      setEditingField('sheetNumberField');
      setIsDragging(true);
      setDragStart({
        x, y,
        fieldX: config.sheetNumberField.x,
        fieldY: config.sheetNumberField.y,
        fieldWidth: config.sheetNumberField.width,
        fieldHeight: config.sheetNumberField.height
      });
      return;
    }
    
    if (isPointInField(x, y, config.sheetNameField, viewport)) {
      console.log('Clicked on Sheet Name field - starting drag');
      setEditingField('sheetNameField');
      setIsDragging(true);
      setDragStart({
        x, y,
        fieldX: config.sheetNameField.x,
        fieldY: config.sheetNameField.y,
        fieldWidth: config.sheetNameField.width,
        fieldHeight: config.sheetNameField.height
      });
      return;
    }
    
    // If in drawing mode and not clicking on existing field, start drawing
    if (drawingField) {
      console.log('Starting drawing mode - precise coordinates:', {
        drawingField,
        finalX: x,
        finalY: y
      });
      
      setIsDrawing(true);
      setDrawingStart({ x, y });
      setPreviewRect({ x, y, width: 0, height: 0 });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !viewportRef.current) return;

    // Prevent event from bubbling to container
    e.stopPropagation();

    // Get precise canvas coordinates accounting for device pixel ratio
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    const viewport = viewportRef.current;
    
    // Handle dragging existing field
    if (isDragging && dragStart && editingField) {
      const deltaX = (x - dragStart.x) / viewport.width;
      const deltaY = (y - dragStart.y) / viewport.height;
      
      const newX = Math.max(0, Math.min(1 - dragStart.fieldWidth, dragStart.fieldX + deltaX));
      const newY = Math.max(0, Math.min(1 - dragStart.fieldHeight, dragStart.fieldY + deltaY));
      
      setConfig(prev => ({
        ...prev,
        [editingField]: {
          ...prev[editingField],
          x: newX,
          y: newY
        }
      }));
      return;
    }
    
    // Handle drawing new field
    if (isDrawing && drawingStart) {
      const width = x - drawingStart.x;
      const height = y - drawingStart.y;
      
      setPreviewRect({
        x: Math.min(drawingStart.x, x),
        y: Math.min(drawingStart.y, y),
        width: Math.abs(width),
        height: Math.abs(height)
      });
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    console.log('Canvas mouse up event:', {
      isDrawing,
      isDragging,
      hasDrawingStart: !!drawingStart,
      hasPreviewRect: !!previewRect,
      drawingField,
      editingField
    });
    
    // Prevent event from bubbling to container
    e.stopPropagation();
    
    // Handle dragging completion
    if (isDragging && editingField) {
      console.log(`Finished dragging ${editingField}`);
      setIsDragging(false);
      setEditingField(null);
      setDragStart(null);
      return;
    }
    
    // Handle drawing completion
    if (isDrawing && drawingStart && previewRect && drawingField && viewportRef.current) {
      const viewport = viewportRef.current;
      const normalizedRect = {
        x: previewRect.x / viewport.width,
        y: previewRect.y / viewport.height,
        width: previewRect.width / viewport.width,
        height: previewRect.height / viewport.height
      };
      
      console.log(`Drawing ${drawingField}:`, {
        canvas: previewRect,
        viewport: { width: viewport.width, height: viewport.height },
        normalized: normalizedRect
      });
      
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
    }
  };

  // Container mouse events for drag-to-pan
  const handleContainerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only start panning if not in drawing mode
    if (drawingField) return;
    
    console.log('Container mouse down - starting pan mode', {
      drawingField,
      target: e.target,
      isCanvas: e.target === canvasRef.current
    });
    
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY });
  };

  const handleContainerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning || !panStart) return;
    
    const container = containerRef.current;
    if (!container) return;
    
    const deltaX = e.clientX - panStart.x;
    const deltaY = e.clientY - panStart.y;
    
    console.log('Panning:', { deltaX, deltaY });
    
    container.scrollLeft -= deltaX;
    container.scrollTop -= deltaY;
    
    setPanStart({ x: e.clientX, y: e.clientY });
  };

  const handleContainerMouseUp = () => {
    if (isPanning) {
      console.log('Container mouse up - stopping pan mode');
      setIsPanning(false);
      setPanStart(null);
    }
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
    setEditingField(null);
  };

  // Check if a point is within a field rectangle
  const isPointInField = (x: number, y: number, field: TitleblockField, viewport: any): boolean => {
    const fieldX = field.x * viewport.width;
    const fieldY = field.y * viewport.height;
    const fieldWidth = field.width * viewport.width;
    const fieldHeight = field.height * viewport.height;
    
    return x >= fieldX && x <= fieldX + fieldWidth && y >= fieldY && y <= fieldY + fieldHeight;
  };

  // Handle save
  const handleSave = () => {
    onSave(config);
    onClose();
  };

  // Handle wheel events for zoom only (let browser handle scrolling naturally)
  const handleWheel = useCallback((event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      // Zoom with Ctrl/Cmd + scroll
      event.preventDefault();
      
      const ZOOM_STEP = 1.2;
      const MIN_SCALE = 0.1;
      const MAX_SCALE = 3;
      
      const zoomFactor = event.deltaY < 0 ? ZOOM_STEP : 1/ZOOM_STEP;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * zoomFactor));
      
      setScale(newScale);
    }
    // Let browser handle regular scrolling naturally - don't prevent default
  }, [scale]);

  // Add wheel event listener to container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);


  // Extract sheet names and numbers from all pages using OCR
  const extractSheetNames = async () => {
    if (!pdfDocument || !config) {
      console.error('PDF document or config not available');
      return;
    }

    // Validate that both fields are positioned
    if (config.sheetNumberField.width === 0 || config.sheetNameField.width === 0) {
      alert('Please position both the Sheet Number and Sheet Name fields before extracting. Click "Draw" buttons to position each field on the PDF.');
      return;
    }

    setIsExtracting(true);
    setExtractionProgress({ current: 0, total: totalPages });
    setExtractedSheetNames([]);

    try {
      const results: Array<{ pageNumber: number; sheetNumber: string; sheetName: string }> = [];

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        setExtractionProgress({ current: pageNum, total: totalPages });
        
        try {
          // Get the page
          const page = await pdfDocument.getPage(pageNum);
          const viewport = page.getViewport({ scale: 4.0 }); // High resolution for OCR
          
          // Create canvas for this page
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.width = viewport.width;
          canvas.height = viewport.height;

          if (context) {
            // Render the page
            await page.render({
              canvasContext: context,
              viewport: viewport
            }).promise;

            // Extract text from configured regions
            const sheetNumber = await extractTextFromRegion(canvas, config.sheetNumberField, viewport);
            const sheetName = await extractTextFromRegion(canvas, config.sheetNameField, viewport);

            const result = {
              pageNumber: pageNum,
              sheetNumber: sheetNumber.trim(),
              sheetName: sheetName.trim()
            };
            
            results.push(result);

            // Save training data for future improvements
            if (sheetNumber.trim() && projectId) {
              console.log(`💾 Saving sheet number training data for projectId: ${projectId}, documentId: ${documentId}, page: ${pageNum}`);
              await ocrTrainingService.saveTrainingData({
                projectId: projectId,
                documentId: documentId,
                pageNumber: pageNum,
                fieldType: 'sheet_number',
                originalText: sheetNumber.trim(),
                correctedText: sheetNumber.trim(),
                confidence: 85, // Default confidence for successful extraction
                corrections: [],
                userValidated: false,
                fieldCoordinates: {
                  x: config.sheetNumberField.x,
                  y: config.sheetNumberField.y,
                  width: config.sheetNumberField.width,
                  height: config.sheetNumberField.height
                }
              });
            } else {
              console.log(`⚠️ Skipping sheet number save - sheetNumber: "${sheetNumber.trim()}", projectId: "${projectId}"`);
            }

            if (sheetName.trim() && projectId) {
              console.log(`💾 Saving sheet name training data for projectId: ${projectId}, documentId: ${documentId}, page: ${pageNum}`);
              await ocrTrainingService.saveTrainingData({
                projectId: projectId,
                documentId: documentId,
                pageNumber: pageNum,
                fieldType: 'sheet_name',
                originalText: sheetName.trim(),
                correctedText: sheetName.trim(),
                confidence: 85, // Default confidence for successful extraction
                corrections: [],
                userValidated: false,
                fieldCoordinates: {
                  x: config.sheetNameField.x,
                  y: config.sheetNameField.y,
                  width: config.sheetNameField.width,
                  height: config.sheetNameField.height
                }
              });
            } else {
              console.log(`⚠️ Skipping sheet name save - sheetName: "${sheetName.trim()}", projectId: "${projectId}"`);
            }

            console.log(`Page ${pageNum}: Sheet Number="${sheetNumber}", Sheet Name="${sheetName}"`);
            
            // Add detailed logging for debugging
            if (sheetNumber.trim() === '' && sheetName.trim() === '') {
              console.warn(`⚠️ No text extracted from page ${pageNum} - this might indicate the fields are not positioned correctly or the text is not OCR-readable`);
            } else {
              console.log(`✅ Successfully extracted from page ${pageNum}`);
            }
          }

          // Clean up canvas
          canvas.remove();
        } catch (error) {
          console.error(`Error processing page ${pageNum}:`, error);
          results.push({
            pageNumber: pageNum,
            sheetNumber: '',
            sheetName: ''
          });
        }
      }

      setExtractedSheetNames(results);
      
      // Call the callback if provided
      if (onExtractSheetNames) {
        onExtractSheetNames(results);
      }

      console.log('Sheet name extraction completed:', results);
    } catch (error) {
      console.error('Error extracting sheet names:', error);
    } finally {
      setIsExtracting(false);
    }
  };

  // Extract text from a specific region using OCR
  const extractTextFromRegion = async (canvas: HTMLCanvasElement, field: TitleblockField, viewport: any): Promise<string> => {
    try {
      // Calculate the region coordinates in canvas pixels
      const regionX = field.x * viewport.width;
      const regionY = field.y * viewport.height;
      const regionWidth = field.width * viewport.width;
      const regionHeight = field.height * viewport.height;

      // Create a new canvas for just this region
      const regionCanvas = document.createElement('canvas');
      const regionContext = regionCanvas.getContext('2d');
      regionCanvas.width = regionWidth;
      regionCanvas.height = regionHeight;

      if (regionContext) {
        // Copy the region from the main canvas
        regionContext.drawImage(
          canvas,
          regionX, regionY, regionWidth, regionHeight,
          0, 0, regionWidth, regionHeight
        );

        // First, try to extract text directly from the PDF using the region coordinates
        // This works well for vector PDFs with embedded text
        let extractedText = await tryDirectTextExtraction(field, viewport);
        
        // If direct extraction didn't work or returned empty, use Tesseract OCR
        if (!extractedText || extractedText.trim().length === 0) {
          console.log(`Direct extraction failed for ${field.name}, trying Tesseract OCR...`);
          extractedText = await performTesseractOCR(regionCanvas);
        }
        
        // If Tesseract also failed, try with enhanced image preprocessing
        if (!extractedText || extractedText.trim().length === 0) {
          console.log(`Standard Tesseract failed for ${field.name}, trying enhanced preprocessing...`);
          extractedText = await performEnhancedOCR(regionCanvas);
        }
        
        // Clean up region canvas
        regionCanvas.remove();
        
        return extractedText || '';
      }

      return '';
    } catch (error) {
      console.error('Error extracting text from region:', error);
      return '';
    }
  };

  // Try to extract text directly from PDF using region coordinates
  const tryDirectTextExtraction = async (field: TitleblockField, viewport: any): Promise<string> => {
    try {
      if (!pdfDocument || !currentPage) {
        return '';
      }

      // Get the current page
      const page = await pdfDocument.getPage(currentPage);
      
      // Get text content from the page
      const textContent = await page.getTextContent();
      
      if (!textContent || !textContent.items || textContent.items.length === 0) {
        console.log('No text content found in PDF page');
        return '';
      }

      // Calculate region bounds in PDF coordinates
      const regionX = field.x * viewport.width;
      const regionY = field.y * viewport.height;
      const regionWidth = field.width * viewport.width;
      const regionHeight = field.height * viewport.height;

      // Filter text items that fall within the region
      const textInRegion: string[] = [];
      
      for (const item of textContent.items) {
        if ('transform' in item && 'str' in item) {
          const textItem = item as any;
          const x = textItem.transform[4];
          const y = textItem.transform[5];
          
          // Check if text item is within the region bounds
          if (x >= regionX && x <= regionX + regionWidth &&
              y >= regionY && y <= regionY + regionHeight) {
            textInRegion.push(textItem.str);
          }
        }
      }

      const extractedText = textInRegion.join(' ').trim();
      console.log(`Direct extraction for ${field.name}: "${extractedText}"`);
      
      return extractedText;
    } catch (error) {
      console.error('Direct text extraction failed:', error);
      return '';
    }
  };

  // Perform enhanced Tesseract OCR on a canvas region
  const performTesseractOCR = async (canvas: HTMLCanvasElement): Promise<string> => {
    try {
      // Ensure the OCR service is initialized
      await ocrService.initialize();
      
      // Process the canvas with enhanced OCR
      const result = await enhancedOcrService.processWithEnhancement(canvas, 1, projectId);
      
      console.log(`Enhanced OCR result:`, {
        original: result.originalText,
        corrected: result.correctedText,
        confidence: result.confidence,
        corrections: result.corrections
      });
      
      // Return corrected text if confidence is reasonable
      if (result.confidence > 30) {
        return result.correctedText.trim();
      } else {
        console.log(`Low confidence OCR result (${result.confidence}%), returning empty string`);
        return '';
      }
    } catch (error) {
      console.error('Enhanced OCR failed:', error);
      return '';
    }
  };

  // Perform enhanced OCR with image preprocessing for difficult cases
  const performEnhancedOCR = async (canvas: HTMLCanvasElement): Promise<string> => {
    try {
      // Create a new canvas for preprocessing
      const enhancedCanvas = document.createElement('canvas');
      const enhancedContext = enhancedCanvas.getContext('2d');
      
      if (!enhancedContext) {
        return '';
      }

      // Set canvas size (scale up for better OCR)
      const scale = 2;
      enhancedCanvas.width = canvas.width * scale;
      enhancedCanvas.height = canvas.height * scale;

      // Apply image preprocessing
      enhancedContext.imageSmoothingEnabled = false;
      enhancedContext.scale(scale, scale);
      
      // Draw original image
      enhancedContext.drawImage(canvas, 0, 0);
      
      // Get image data for processing
      const imageData = enhancedContext.getImageData(0, 0, enhancedCanvas.width, enhancedCanvas.height);
      const data = imageData.data;
      
      // Apply contrast enhancement and binarization
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Convert to grayscale
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        
        // Apply threshold (binarization)
        const threshold = 128;
        const binary = gray > threshold ? 255 : 0;
        
        data[i] = binary;     // Red
        data[i + 1] = binary; // Green
        data[i + 2] = binary; // Blue
        // Alpha stays the same
      }
      
      // Put processed image data back
      enhancedContext.putImageData(imageData, 0, 0);
      
      // Try enhanced OCR on the enhanced image
      const result = await enhancedOcrService.processWithEnhancement(enhancedCanvas, 1, projectId);
      
      console.log(`Enhanced OCR result:`, {
        original: result.originalText,
        corrected: result.correctedText,
        confidence: result.confidence,
        corrections: result.corrections
      });
      
      // Clean up
      enhancedCanvas.remove();
      
      // Return corrected text if confidence is reasonable
      if (result.confidence > 20) { // Lower threshold for enhanced processing
        return result.correctedText.trim();
      } else {
        console.log(`Enhanced OCR also had low confidence (${result.confidence}%)`);
        return '';
      }
    } catch (error) {
      console.error('Enhanced OCR failed:', error);
      return '';
    }
  };

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setIsInitialized(false);
      setScale(1);
    }
  }, [isOpen]);

  // Auto-fit to window when PDF loads or dialog opens
  useEffect(() => {
    if (pdfDocument && isOpen && !isInitialized) {
      // Longer delay to ensure dialog and container are fully rendered
      const timer = setTimeout(() => {
        fitToWindow();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [pdfDocument, isOpen, isInitialized, fitToWindow]);

  // Render page when dependencies change
  useEffect(() => {
    if (pdfDocument && currentPage) {
      renderPage(currentPage);
    }
  }, [pdfDocument, currentPage, scale, config, showFields]);

  // Force re-render when config changes
  useEffect(() => {
    if (pdfDocument && currentPage && showFields) {
      // Small delay to ensure canvas is ready
      const timer = setTimeout(() => {
        renderPage(currentPage);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [config.sheetNumberField, config.sheetNameField]);

  // Cleanup render task on unmount
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, []);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] h-[95vh] max-w-none max-h-none overflow-hidden flex flex-col p-0">
        {/* Fixed Header */}
        <div className="flex-shrink-0 p-6 border-b bg-white">
          <DialogTitle className="text-xl font-semibold">Configure Titleblock Fields</DialogTitle>
        </div>
        
        {/* Main Content Area */}
        <div className="flex-1 flex min-h-0">
          {/* Fixed Left Panel - Controls */}
          <div className="w-96 flex-shrink-0 border-r bg-gray-50 overflow-y-auto">
            <div className="p-4 space-y-4">
              {/* Page Navigation */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Page Navigation</Label>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage <= 1}
                  >
                    ←
                  </Button>
                  <span className="text-sm font-medium">
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

              {/* PDF Controls */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">PDF Controls</Label>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setScale(Math.max(0.1, scale - 0.1))}
                  >
                    -
                  </Button>
                  <span className="text-sm w-16 text-center font-medium">{Math.round(scale * 100)}%</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setScale(Math.min(2, scale + 0.1))}
                  >
                    +
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setScale(1)}
                    title="Reset to 100%"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={fitToWindow}
                  >
                    Fit to Window
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setScale(0.25)}
                  >
                    Show Full Page
                  </Button>
                </div>
              </div>

              {/* Field Configuration */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Field Configuration</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowFields(!showFields)}
                  >
                    {showFields ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>

                {/* Sheet Number Field */}
                <div className="space-y-2 p-3 border rounded-lg bg-white">
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
                    {config.sheetNumberField.width > 0 ? (
                      <>
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
                      </>
                    ) : (
                      <div className="col-span-2">
                        <Label className="text-xs text-muted-foreground">Not positioned - Click "Draw" to position field</Label>
                      </div>
                    )}
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
                <div className="space-y-2 p-3 border rounded-lg bg-white">
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
                    {config.sheetNameField.width > 0 ? (
                      <>
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
                      </>
                    ) : (
                      <div className="col-span-2">
                        <Label className="text-xs text-muted-foreground">Not positioned - Click "Draw" to position field</Label>
                      </div>
                    )}
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

              {/* OCR Extraction */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">OCR Extraction</Label>
                <Button
                  onClick={extractSheetNames}
                  disabled={isExtracting || config.sheetNumberField.width === 0 || config.sheetNameField.width === 0}
                  className="w-full"
                  variant="outline"
                >
                  {isExtracting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Extracting... ({extractionProgress.current}/{extractionProgress.total})
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Extract Sheet Names
                    </>
                  )}
                </Button>
                
                {extractedSheetNames.length > 0 && (
                  <div className="p-3 bg-green-50 rounded-lg">
                    <h4 className="font-medium text-sm mb-2 text-green-800">Extracted Results:</h4>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {extractedSheetNames.map((result, index) => (
                        <div key={index} className="text-xs text-green-700">
                          Page {result.pageNumber}: {result.sheetNumber} - {result.sheetName}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Instructions */}
              <div className="p-3 bg-blue-50 rounded-lg">
                <h4 className="font-medium text-sm mb-2">Instructions:</h4>
                <ol className="text-xs space-y-1 text-blue-800">
                  <li>1. Navigate to a typical page with the titleblock layout</li>
                  <li>2. Click "Draw Sheet Number Field" and drag to position the field</li>
                  <li>3. Click "Draw Sheet Name Field" and drag to position the field</li>
                  <li>4. Navigate through pages to verify field positions are correct</li>
                  <li>5. Click "Extract Sheet Names" to process all pages</li>
                </ol>
              </div>

              {/* Navigation Help */}
              <div className="p-3 bg-gray-50 rounded-lg">
                <h4 className="font-medium text-sm mb-2">Navigation:</h4>
                <ul className="text-xs space-y-1 text-gray-700">
                  <li>• <strong>Ctrl/Cmd + Scroll:</strong> Zoom in/out</li>
                  <li>• <strong>Drag:</strong> Pan in any direction</li>
                  <li>• <strong>Scroll:</strong> Pan vertically</li>
                  <li>• <strong>Shift + Scroll:</strong> Pan horizontally</li>
                </ul>
              </div>
            </div>
          </div>

          {/* PDF Viewer Area */}
          <div className="flex-1 flex flex-col bg-white min-w-0">
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
                {/* PDF Canvas Container */}
                <div 
                  ref={containerRef}
                  className="flex-1 overflow-auto bg-gray-100"
                  style={{ 
                    height: '100%',
                    width: '100%',
                    maxHeight: '80vh',
                    maxWidth: '100%',
                    cursor: drawingField ? 'crosshair' : (editingField ? 'move' : (isPanning ? 'grabbing' : 'grab'))
                  }}
                  onMouseDown={handleContainerMouseDown}
                  onMouseMove={handleContainerMouseMove}
                  onMouseUp={handleContainerMouseUp}
                  onMouseLeave={() => {
                    setIsPanning(false);
                    setPanStart(null);
                  }}
                >
                  <div className="relative inline-block p-4">
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
                      style={{ 
                        cursor: drawingField ? 'crosshair' : (editingField ? 'move' : 'default')
                      }}
                    />
                    
                    {/* Preview Rectangle */}
                    {previewRect && (
                      <div
                        className="absolute border-2 border-dashed border-blue-500 pointer-events-none bg-blue-100 bg-opacity-20"
                        style={{
                          left: previewRect.x,
                          top: previewRect.y,
                          width: previewRect.width,
                          height: previewRect.height,
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Fixed Footer */}
        <div className="flex-shrink-0 p-6 border-t bg-white">
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              <Save className="w-4 h-4 mr-2" />
              Save Configuration
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
