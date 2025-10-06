import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
// import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { 
  BarChart3, 
  TrendingUp, 
  CheckCircle, 
  XCircle, 
  Edit3,
  Download,
  Trash2,
  RefreshCw,
  Eye
} from 'lucide-react';
import { ocrTrainingService } from '../services/ocrTrainingService';
import type { OCRTrainingData } from '../services/ocrTrainingService';

interface OCRTrainingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

export function OCRTrainingDialog({ isOpen, onClose, projectId }: OCRTrainingDialogProps) {
  const [trainingData, setTrainingData] = useState<OCRTrainingData[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editingEntry, setEditingEntry] = useState<OCRTrainingData | null>(null);
  const [editText, setEditText] = useState('');
  const [editHasTitleblock, setEditHasTitleblock] = useState(true);

  // Load training data when dialog opens
  useEffect(() => {
    if (isOpen && projectId) {
      loadTrainingData();
    }
  }, [isOpen, projectId]);

  const loadTrainingData = async () => {
    setIsLoading(true);
    try {
      console.log('🔍 OCRTrainingDialog: Loading training data for projectId:', projectId);
      
      // First try loading ALL data (no project filter) to see if any exists
      console.log('🔍 Loading ALL training data first...');
      await ocrTrainingService.loadTrainingData(); // No projectId = load all
      const allData = ocrTrainingService.getTrainingData();
      console.log('📊 All training data found:', allData.length, 'entries');
      
      // If we have data but no project-specific data, show all data
      if (allData.length > 0) {
        // Try to load project-specific data
        console.log('🔍 Loading project-specific data...');
        await ocrTrainingService.loadTrainingData(projectId);
        const projectData = ocrTrainingService.getTrainingData();
        console.log('📊 Project-specific data found:', projectData.length, 'entries');
        
        // If no project-specific data found, use all data
        if (projectData.length === 0 && allData.length > 0) {
          console.log('📊 No project-specific data found, showing all training data');
          setTrainingData(allData);
          const stats = await ocrTrainingService.getTrainingStats(); // No projectId = all data stats
          console.log('📊 Stats for all data:', stats);
          setStats(stats);
        } else {
          setTrainingData(projectData);
          const stats = await ocrTrainingService.getTrainingStats(projectId);
          console.log('📊 Stats for project data:', stats);
          setStats(stats);
        }
      } else {
        setTrainingData([]);
        const stats = await ocrTrainingService.getTrainingStats(projectId);
        console.log('📊 Stats for empty data:', stats);
        setStats(stats);
      }
    } catch (error) {
      console.error('Failed to load training data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleValidateCorrection = async (entry: OCRTrainingData, isValid: boolean) => {
    try {
      if (isValid) {
        // Mark as user validated
        await ocrTrainingService.validateCorrection(
          entry.projectId,
          entry.documentId,
          entry.pageNumber,
          entry.fieldType,
          entry.originalText,
          entry.correctedText,
          entry.confidence,
          entry.hasTitleblock ?? true
        );
      } else {
        // User says correction is wrong, allow editing
        setEditingEntry(entry);
        setEditText(entry.correctedText);
        setEditHasTitleblock(entry.hasTitleblock ?? true);
      }
      
      // Reload data
      await loadTrainingData();
    } catch (error) {
      console.error('Failed to validate correction:', error);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingEntry) return;

    try {
      await ocrTrainingService.validateCorrection(
        editingEntry.projectId,
        editingEntry.documentId,
        editingEntry.pageNumber,
        editingEntry.fieldType,
        editingEntry.originalText,
        editText,
        editingEntry.confidence,
        editHasTitleblock
      );
      
      setEditingEntry(null);
      setEditText('');
      setEditHasTitleblock(true);
      await loadTrainingData();
    } catch (error) {
      console.error('Failed to save edit:', error);
    }
  };

  const handleExportData = () => {
    const exportData = ocrTrainingService.exportTrainingData();
    const blob = new Blob([exportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocr-training-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClearData = async () => {
    if (confirm('Are you sure you want to clear all training data? This action cannot be undone.')) {
      try {
        await ocrTrainingService.clearTrainingData();
        await loadTrainingData();
      } catch (error) {
        console.error('Failed to clear training data:', error);
      }
    }
  };

  const handleViewPDFPage = async (entry: OCRTrainingData) => {
    try {
      // Show the full PDF page instead of cropping to a specific region
      showFullPageModal(entry);
    } catch (error) {
      console.error('Error loading PDF page:', error);
    }
  };

  const getDefaultFieldConfig = (fieldType: 'sheet_number' | 'sheet_name') => {
    // Default titleblock regions based on common architectural drawing layouts
    if (fieldType === 'sheet_number') {
      // Sheet numbers are typically in the bottom right corner
      return {
        x: 0.75,  // 75% from left
        y: 0.9,   // 90% from top
        width: 0.2,  // 20% width
        height: 0.05 // 5% height
      };
    } else {
      // Sheet names are typically in the bottom right corner, above the sheet number
      return {
        x: 0.6,   // 60% from left
        y: 0.85,  // 85% from top
        width: 0.35, // 35% width
        height: 0.05 // 5% height
      };
    }
  };

  const showFullPageModal = async (entry: OCRTrainingData) => {
    // Create a modal dialog to show the full PDF page
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.id = `modal-${entry.id}`;
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.zIndex = '9999';
    
    // Create a unique close function for this modal
    const modalId = `modal-${entry.id}`;
    const closeModal = () => {
      const modalElement = document.getElementById(modalId);
      if (modalElement && modalElement.parentNode) {
        modalElement.parentNode.removeChild(modalElement);
      }
      // Re-enable body scrolling
      document.body.style.overflow = '';
    };
    
    // Disable body scrolling when modal is open
    document.body.style.overflow = 'hidden';
    
    // Create the modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'bg-white rounded-lg p-6 max-w-6xl max-h-[95vh] overflow-hidden relative';
    modalContent.style.position = 'relative';
    modalContent.style.zIndex = '10000';
    
    // Prevent scroll events from bubbling up to parent, but allow canvas events
    const preventScroll = (e: Event) => {
      // Don't prevent events on the canvas or its container - let it handle its own zoom/pan
      const target = e.target as Element;
      if (target && (target.tagName === 'CANVAS' || target.closest('[id^="pdf-page-"]'))) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    };
    
    // Only add scroll prevention to modal, not modalContent to avoid interfering with canvas
    modal.addEventListener('wheel', preventScroll, { passive: false, capture: true });
    modal.addEventListener('scroll', preventScroll, { passive: false, capture: true });
    modalContent.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold">PDF Page ${entry.pageNumber} - ${entry.fieldType.replace('_', ' ').toUpperCase()}</h3>
        <button class="close-modal-btn text-gray-500 hover:text-gray-700 text-2xl font-bold cursor-pointer">&times;</button>
      </div>
      <div class="overflow-y-auto max-h-[calc(95vh-120px)]">
        <div class="mb-4">
          <p class="text-sm text-gray-600">Document: ${entry.documentId}</p>
          <p class="text-sm text-gray-600">Original OCR: "${entry.originalText}"</p>
          <p class="text-sm text-gray-600">Corrected: "${entry.correctedText}"</p>
          <p class="text-xs text-blue-600 mt-1">Use <strong>Ctrl/Cmd + scroll</strong> to zoom in/out, or <strong>scroll</strong> to pan around the page</p>
          <p class="text-xs text-gray-500 mt-1">Zoom range: 20% - 500% | Current zoom: <span id="zoom-level-${entry.id}">100%</span></p>
        </div>
        <div class="border rounded-lg p-4 bg-gray-50">
          <div id="pdf-page-${entry.id}" class="flex items-center justify-center min-h-[400px] overflow-hidden" style="touch-action: none;">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span class="ml-2">Loading PDF page...</span>
          </div>
        </div>
        <div class="mt-4 text-sm text-gray-500">
          <p>This shows the full PDF page where the text was extracted. Look for the text in the titleblock area (usually bottom right corner).</p>
          <div class="mt-4 flex justify-end gap-2">
            <button class="backup-close-btn px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 cursor-pointer">
              Close
            </button>
          </div>
        </div>
      </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Add event listeners for close buttons
    const closeButton = modalContent.querySelector('.close-modal-btn');
    const backupCloseButton = modalContent.querySelector('.backup-close-btn');
    
    if (closeButton) {
      closeButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      });
    }
    
    if (backupCloseButton) {
      backupCloseButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      });
    }
    
    // Add event listener to close modal when clicking outside
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });
    
    // Add escape key listener
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
    
    // Load and render the full PDF page
    try {
      await renderFullPage(entry, `pdf-page-${entry.id}`);
    } catch (error) {
      const pageDiv = document.getElementById(`pdf-page-${entry.id}`);
      if (pageDiv) {
        pageDiv.innerHTML = `
          <div class="text-center text-red-600 p-4">
            <p class="font-medium">Error loading PDF page</p>
            <p class="text-sm mt-2">${error instanceof Error ? error.message : 'Unknown error'}</p>
            <button 
              class="error-close-btn mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 cursor-pointer"
            >
              Close
            </button>
          </div>
        `;
        
        // Add event listener for error close button
        const errorCloseButton = pageDiv.querySelector('.error-close-btn');
        if (errorCloseButton) {
          errorCloseButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
          });
        }
      }
    }
  };

  const renderFullPage = async (entry: OCRTrainingData, containerId: string) => {
    try {
      // Get the PDF document using the correct endpoint
      console.log('Loading PDF from:', `http://localhost:4000/api/files/${entry.documentId}`);
      
      const pdfResponse = await fetch(`http://localhost:4000/api/files/${entry.documentId}`);
      if (!pdfResponse.ok) {
        throw new Error(`Failed to load PDF document: ${pdfResponse.status} ${pdfResponse.statusText}`);
      }
      
      const pdfBlob = await pdfResponse.blob();
      if (pdfBlob.size === 0) {
        throw new Error('PDF file is empty or corrupted');
      }
      
      const pdfArrayBuffer = await pdfBlob.arrayBuffer();
      
      // Load PDF.js
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      
      const pdf = await pdfjsLib.getDocument({ data: pdfArrayBuffer }).promise;
      
      if (entry.pageNumber > pdf.numPages) {
        throw new Error(`Page ${entry.pageNumber} does not exist. PDF has ${pdf.numPages} pages.`);
      }
      
      const page = await pdf.getPage(entry.pageNumber);
      
      // Render the full page at a reasonable scale for viewing
      const scale = 1.5;
      const viewport = page.getViewport({ scale });
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
      
      // Display the full page
      const container = document.getElementById(containerId);
      if (container) {
        container.innerHTML = '';
        container.appendChild(canvas);
        
        // Add some styling and make it zoomable
        canvas.style.border = '2px solid #3B82F6';
        canvas.style.borderRadius = '4px';
        canvas.style.maxWidth = '100%';
        canvas.style.height = 'auto';
        canvas.style.cursor = 'grab';
        canvas.style.touchAction = 'none';
        canvas.style.userSelect = 'none';
        
        // Add zoom functionality
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let currentScale = 1;
        let currentX = 0;
        let currentY = 0;
        
        const updateTransform = () => {
          canvas.style.transform = `translate(${currentX}px, ${currentY}px) scale(${currentScale})`;
          canvas.style.transformOrigin = '0 0';
          
          // Update zoom level display
          const zoomLevelElement = document.getElementById(`zoom-level-${entry.id}`);
          if (zoomLevelElement) {
            zoomLevelElement.textContent = `${Math.round(currentScale * 100)}%`;
          }
        };
        
        // Mouse wheel zoom with better handling - more aggressive event prevention
        const handleCanvasWheel = (e: WheelEvent) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          const rect = canvas.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          
          // Use Ctrl/Cmd + wheel for zoom, regular wheel for pan
          if (e.ctrlKey || e.metaKey) {
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(0.2, Math.min(5, currentScale * zoomFactor));
            
            // Adjust position to zoom towards mouse
            const scaleChange = newScale / currentScale;
            currentX = mouseX - (mouseX - currentX) * scaleChange;
            currentY = mouseY - (mouseY - currentY) * scaleChange;
            
            currentScale = newScale;
            updateTransform();
          } else {
            // Pan with regular wheel
            currentX -= e.deltaX * 0.5;
            currentY -= e.deltaY * 0.5;
            updateTransform();
          }
          
          return false;
        };
        
        // Add wheel event listener with capture to ensure it runs before modal's preventScroll
        canvas.addEventListener('wheel', handleCanvasWheel, { passive: false, capture: true });
        
        // Mouse drag to pan
        canvas.addEventListener('mousedown', (e) => {
          isDragging = true;
          startX = e.clientX - currentX;
          startY = e.clientY - currentY;
          canvas.style.cursor = 'grabbing';
        });
        
        canvas.addEventListener('mousemove', (e) => {
          if (isDragging) {
            currentX = e.clientX - startX;
            currentY = e.clientY - startY;
            updateTransform();
          }
        });
        
        canvas.addEventListener('mouseup', () => {
          isDragging = false;
          canvas.style.cursor = 'grab';
        });
        
        canvas.addEventListener('mouseleave', () => {
          isDragging = false;
          canvas.style.cursor = 'grab';
        });
      }
      
    } catch (error) {
      console.error('Error rendering full page:', error);
      throw error;
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[90vw] h-[90vh] max-w-none max-h-none overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            OCR Training Data & Statistics
            {trainingData.length > 0 && (
              <Badge variant="outline" className="ml-2">
                {trainingData.length} entries
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6">
          {/* Statistics Cards */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="border rounded-lg p-4">
                <div className="pb-2">
                  <h3 className="text-sm font-medium">Total Entries</h3>
                </div>
                <div>
                  <div className="text-2xl font-bold">{stats.totalEntries}</div>
                </div>
              </div>

              <div className="border rounded-lg p-4">
                <div className="pb-2">
                  <h3 className="text-sm font-medium">Average Confidence</h3>
                </div>
                <div>
                  <div className="text-2xl font-bold">
                    {Math.round(stats.confidenceStats.average)}%
                  </div>
                </div>
              </div>

              <div className="border rounded-lg p-4">
                <div className="pb-2">
                  <h3 className="text-sm font-medium">High Confidence</h3>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-600">
                    {stats.confidenceStats.high}
                  </div>
                </div>
              </div>

              <div className="border rounded-lg p-4">
                <div className="pb-2">
                  <h3 className="text-sm font-medium">Recent Activity</h3>
                </div>
                <div>
                  <div className="text-2xl font-bold text-blue-600">
                    {stats.recentActivity}
                  </div>
                  <p className="text-xs text-gray-500">Last 7 days</p>
                </div>
              </div>
            </div>
          )}

          {/* Field Type Statistics */}
          {stats && (
            <div className="border rounded-lg p-4">
              <div className="pb-4">
                <h3 className="text-lg font-medium">Field Type Distribution</h3>
              </div>
              <div>
                <div className="flex gap-4">
                  {Object.entries(stats.fieldTypeStats).map(([type, count]) => (
                    <div key={type} className="flex items-center gap-2">
                      <Badge variant="outline">
                        {type.replace('_', ' ').toUpperCase()}
                      </Badge>
                      <span className="font-medium">{count as number}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Training Data Table */}
          <div className="border rounded-lg p-4">
            <div className="flex flex-row items-center justify-between pb-4">
              <div>
                <h3 className="text-lg font-medium">Training Data Entries</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Click "View Page" to see the full PDF page where the text was extracted to verify correct spelling
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadTrainingData}
                  disabled={isLoading}
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportData}
                >
                  <Download className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleClearData}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : trainingData.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No training data available yet. Start using the titleblock extraction to build training data.
                </div>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {trainingData.slice(0, 50).map((entry, index) => (
                    <div key={entry.id || index} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {entry.fieldType.replace('_', ' ').toUpperCase()}
                          </Badge>
                          <Badge variant={entry.confidence > 80 ? 'default' : entry.confidence > 50 ? 'secondary' : 'destructive'}>
                            {Math.round(entry.confidence)}%
                          </Badge>
                          {entry.userValidated && (
                            <Badge variant="outline" className="text-green-600">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Validated
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500">Page {entry.pageNumber}</span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewPDFPage(entry)}
                            className="text-xs"
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            View Page
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs text-gray-500">Original OCR Text</Label>
                          <div className="p-2 bg-gray-100 rounded text-sm font-mono">
                            {entry.originalText}
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500">Corrected Text</Label>
                          {editingEntry?.id === entry.id ? (
                            <div className="space-y-2">
                              <Input
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                className="text-sm"
                              />
                              <div className="flex items-center space-x-2">
                                <Checkbox
                                  id={`has-titleblock-${entry.id}`}
                                  checked={editHasTitleblock}
                                  onCheckedChange={(checked) => setEditHasTitleblock(checked === true)}
                                />
                                <Label htmlFor={`has-titleblock-${entry.id}`} className="text-xs text-gray-600">
                                  Sheet has titleblock
                                </Label>
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" onClick={handleSaveEdit}>
                                  Save
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={() => {
                                    setEditingEntry(null);
                                    setEditText('');
                                    setEditHasTitleblock(true);
                                  }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="p-2 bg-green-50 rounded text-sm font-mono">
                                {entry.correctedText}
                              </div>
                              <div className="flex items-center space-x-2">
                                <div className={`w-2 h-2 rounded-full ${(entry.hasTitleblock ?? true) ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                <span className="text-xs text-gray-600">
                                  {(entry.hasTitleblock ?? true) ? 'Has titleblock' : 'No titleblock'}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {entry.corrections.length > 0 && (
                        <div>
                          <Label className="text-xs text-gray-500">Corrections Applied</Label>
                          <div className="space-y-1">
                            {entry.corrections.map((correction, idx) => (
                              <div key={idx} className="text-xs text-gray-600">
                                <span className="font-mono bg-red-100 px-1 rounded">{correction.original}</span>
                                {' → '}
                                <span className="font-mono bg-green-100 px-1 rounded">{correction.corrected}</span>
                                <span className="text-gray-400 ml-2">({correction.reason})</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {editingEntry?.id !== entry.id && (
                        <div className="flex gap-2 pt-2">
                          {!entry.userValidated && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleValidateCorrection(entry, true)}
                                className="text-green-600"
                              >
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Correct
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleValidateCorrection(entry, false)}
                                className="text-red-600"
                              >
                                <XCircle className="w-4 h-4 mr-1" />
                                Incorrect
                              </Button>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingEntry(entry);
                              setEditText(entry.correctedText);
                              setEditHasTitleblock(entry.hasTitleblock ?? true);
                            }}
                          >
                            <Edit3 className="w-4 h-4 mr-1" />
                            Edit
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  
                  {trainingData.length > 50 && (
                    <div className="text-center text-sm text-gray-500 py-4">
                      Showing first 50 entries of {trainingData.length} total
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
