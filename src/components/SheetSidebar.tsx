import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { 
  FileText, 
  Plus, 
  Upload, 
  Download,
  Trash2,
  Eye,
  EyeOff,
  MoreVertical,
  Settings,
  Scan,
  FileImage,
  ChevronDown,
  ChevronRight,
  Filter,
  RefreshCw,
  Edit2,
  Check,
  X
} from 'lucide-react';
import { fileService, sheetService } from '../services/apiService';
import { useTakeoffStore } from '../store/useTakeoffStore';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPage, PDFDocument } from '../types';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// PDFPage and PDFDocument interfaces imported from shared types

interface SheetSidebarProps {
  projectId: string;
  onPageSelect: (documentId: string, pageNumber: number) => void;
  selectedDocumentId?: string;
  selectedPageNumber?: number;
  onOCRRequest?: (documentId: string, pageNumbers: number[]) => void;
  onTitleblockConfig?: (documentId: string) => void;
  onOcrSearchResults?: (results: any[], query: string) => void;
  onDocumentsUpdate?: (documents: PDFDocument[]) => void;
}

export function SheetSidebar({ 
  projectId, 
  onPageSelect, 
  selectedDocumentId,
  selectedPageNumber,
  onOCRRequest,
  onTitleblockConfig,
  onOcrSearchResults,
  onDocumentsUpdate
}: SheetSidebarProps) {
  const [viewMode, setViewMode] = useState<'list'>('list');
  const [filterBy, setFilterBy] = useState<'all' | 'withTakeoffs' | 'withoutTakeoffs'>('all');
  const [documents, setDocuments] = useState<PDFDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingOCR, setProcessingOCR] = useState<string[]>([]);
  
  // Sheet name editing state
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [editingSheetName, setEditingSheetName] = useState<string>('');
  const [editingPageNumber, setEditingPageNumber] = useState<number | null>(null);

  // Store integration
  const { getProjectTakeoffMeasurements } = useTakeoffStore();

  // Update hasTakeoffs property based on actual takeoff measurements
  const updateHasTakeoffs = useCallback((docs: PDFDocument[]) => {
    const takeoffMeasurements = getProjectTakeoffMeasurements(projectId);
    
    return docs.map(doc => ({
      ...doc,
      // Preserve isExpanded and other document-level properties
      isExpanded: doc.isExpanded,
      ocrEnabled: doc.ocrEnabled,
      pages: doc.pages.map(page => {
        const pageKey = `${projectId}-${doc.id}-${page.pageNumber}`;
        const hasMeasurements = takeoffMeasurements.some(measurement => 
          measurement.sheetId === doc.id && measurement.pdfPage === page.pageNumber
        );
        const measurementCount = takeoffMeasurements.filter(measurement => 
          measurement.sheetId === doc.id && measurement.pdfPage === page.pageNumber
        ).length;
        
        return {
          ...page,
          hasTakeoffs: hasMeasurements,
          takeoffCount: measurementCount
        };
      })
    }));
  }, [projectId, getProjectTakeoffMeasurements]);

  // Load project files and convert to enhanced document structure
  const loadProjectDocuments = useCallback(async () => {
    if (!projectId) return;
    
    try {
      setLoading(true);
      
      const filesRes = await fileService.getProjectFiles(projectId);
      const files = filesRes.files || [];
      
      const pdfFiles = files.filter((file: any) => file.mimetype === 'application/pdf');
      
      const documents: PDFDocument[] = await Promise.all(
        pdfFiles.map(async (file: any) => {
          try {
            // Load PDF to get page count
            const pdfUrl = `http://localhost:4000/api/files/${file.id}`;
            const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
            const totalPages = pdf.numPages;
            
            // Create pages array and load existing sheet data from database
            const pages: PDFPage[] = await Promise.all(
              Array.from({ length: totalPages }, async (_, index) => {
                const pageNumber = index + 1;
                const sheetId = `${file.id}-${pageNumber}`;
                
                try {
                  // Try to load existing sheet data from database
                  const sheetData = await sheetService.getSheet(sheetId);
                  if (sheetData && sheetData.sheet) {
                    return {
                      pageNumber,
                      hasTakeoffs: sheetData.sheet.hasTakeoffs || false,
                      takeoffCount: sheetData.sheet.takeoffCount || 0,
                      isVisible: sheetData.sheet.isVisible !== false,
                      ocrProcessed: sheetData.sheet.ocrProcessed || false,
                      sheetName: sheetData.sheet.sheetName,
                      sheetNumber: sheetData.sheet.sheetNumber,
                      extractedText: sheetData.sheet.extractedText,
                      thumbnail: sheetData.sheet.thumbnail
                    };
                  }
                } catch (error) {
                  // Sheet doesn't exist in database yet, use defaults
                  console.log(`No existing sheet data for ${sheetId}, using defaults`);
                }
                
                // Default page data
                return {
                  pageNumber,
                  hasTakeoffs: false,
                  takeoffCount: 0,
                  isVisible: true,
                  ocrProcessed: false
                };
              })
            );
            
            return {
              id: file.id,
              name: file.originalName.replace('.pdf', ''),
              totalPages,
              pages,
              isExpanded: false,
              ocrEnabled: false
            };
          } catch (error) {
            console.error(`Error loading PDF ${file.originalName}:`, error);
            // Return a basic document structure even if PDF loading fails
            return {
              id: file.id,
              name: file.originalName.replace('.pdf', ''),
              totalPages: 1,
              pages: [{
                pageNumber: 1,
                hasTakeoffs: false,
                takeoffCount: 0,
                isVisible: true,
                ocrProcessed: false
              }],
              isExpanded: false,
              ocrEnabled: false
            };
          }
        })
      );
      
      // Update hasTakeoffs based on actual measurements and preserve expansion state
      setDocuments(prevDocuments => {
        const documentsWithUpdatedTakeoffs = updateHasTakeoffs(documents);
        const documentsWithPreservedState = documentsWithUpdatedTakeoffs.map(newDoc => {
          const existingDoc = prevDocuments.find(prevDoc => prevDoc.id === newDoc.id);
          return {
            ...newDoc,
            isExpanded: existingDoc?.isExpanded || false
          };
        });
        return documentsWithPreservedState;
      });
      
      // Notify parent component of documents update
      if (onDocumentsUpdate) {
        onDocumentsUpdate(updateHasTakeoffs(documents));
      }
      
    } catch (error) {
      console.error('Error loading project documents:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadProjectDocuments();
  }, [loadProjectDocuments]);

  // Update hasTakeoffs when takeoff measurements change (but preserve expansion state)
  useEffect(() => {
    if (documents.length > 0) {
      setDocuments(prevDocuments => {
        const updatedDocuments = updateHasTakeoffs(prevDocuments);
        
        // Notify parent component of the update
        if (onDocumentsUpdate) {
          onDocumentsUpdate(updatedDocuments);
        }
        
        return updatedDocuments;
      });
    }
  }, [getProjectTakeoffMeasurements, updateHasTakeoffs, onDocumentsUpdate]);


  // Generate thumbnail for a specific page
  const generateThumbnail = useCallback(async (documentId: string, pageNumber: number) => {
    try {
      const pdfUrl = `http://localhost:4000/api/files/${documentId}`;
      const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
      const page = await pdf.getPage(pageNumber);
      
      const viewport = page.getViewport({ scale: 0.2 }); // Small scale for thumbnail
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      if (context) {
        await page.render({
          canvasContext: context,
          viewport: viewport,
          canvas: canvas
        }).promise;
        
        const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
        
        // Update the document with the thumbnail
        setDocuments(prev => prev.map(doc => 
          doc.id === documentId 
            ? {
                ...doc,
                pages: doc.pages.map(page => 
                  page.pageNumber === pageNumber 
                    ? { ...page, thumbnail }
                    : page
                )
              }
            : doc
        ));
      }
    } catch (error) {
      console.error(`Error generating thumbnail for page ${pageNumber}:`, error);
    }
  }, []);

  // Process OCR for a specific page
  const processOCR = useCallback(async (documentId: string, pageNumber: number) => {
    try {
      setProcessingOCR(prev => [...prev, `${documentId}-${pageNumber}`]);
      
      // Call the backend OCR service
      const result = await sheetService.processOCR(documentId, [pageNumber]);
      
      if (result.success && result.results.length > 0) {
        const ocrResult = result.results[0];
        
        setDocuments(prev => prev.map(doc => 
          doc.id === documentId 
            ? {
                ...doc,
                pages: doc.pages.map(page => 
                  page.pageNumber === pageNumber 
                    ? { 
                        ...page, 
                        extractedText: ocrResult.extractedText, 
                        ocrProcessed: ocrResult.success 
                      }
                    : page
                )
              }
            : doc
        ));
      }
      
    } catch (error) {
      console.error(`Error processing OCR for page ${pageNumber}:`, error);
    } finally {
      setProcessingOCR(prev => prev.filter(id => id !== `${documentId}-${pageNumber}`));
    }
  }, []);

  // Handle page selection
  const handlePageClick = (documentId: string, pageNumber: number) => {
    onPageSelect(documentId, pageNumber);
  };

  // Toggle document expansion
  const toggleDocumentExpansion = (documentId: string) => {
    setDocuments(prev => prev.map(doc => 
      doc.id === documentId 
        ? { ...doc, isExpanded: !doc.isExpanded }
        : doc
    ));
  };

  // Toggle page visibility
  const togglePageVisibility = (documentId: string, pageNumber: number) => {
    setDocuments(prev => prev.map(doc => 
      doc.id === documentId 
        ? {
            ...doc,
            pages: doc.pages.map(page => 
              page.pageNumber === pageNumber 
                ? { ...page, isVisible: !page.isVisible }
                : page
            )
          }
        : doc
    ));
  };

  // Delete document
  const handleDeleteDocument = async (documentId: string) => {
    try {
      await fileService.deletePDF(documentId);
      setDocuments(prev => prev.filter(doc => doc.id !== documentId));
    } catch (error) {
      console.error('Error deleting document:', error);
      alert('Failed to delete document. Please try again.');
    }
  };

  // Start editing sheet name
  const startEditingSheetName = (documentId: string, pageNumber: number, currentName: string) => {
    const sheetId = `${documentId}-${pageNumber}`;
    setEditingSheetId(sheetId);
    setEditingPageNumber(pageNumber);
    setEditingSheetName(currentName || `Page ${pageNumber}`);
  };

  // Cancel editing sheet name
  const cancelEditingSheetName = () => {
    setEditingSheetId(null);
    setEditingPageNumber(null);
    setEditingSheetName('');
  };

  // Save sheet name
  const saveSheetName = async () => {
    if (!editingSheetId || !editingPageNumber || !editingSheetName.trim()) {
      cancelEditingSheetName();
      return;
    }

    try {
      // Extract document ID from the sheet ID (format: documentId-pageNumber)
      const documentId = editingSheetId.split('-').slice(0, -1).join('-');
      
      // Update the sheet name in the backend
      await sheetService.updateSheet(editingSheetId, {
        documentId: documentId,
        pageNumber: editingPageNumber,
        sheetName: editingSheetName.trim()
      });

      // Update the local state
      const updatedDocuments = documents.map(doc => 
        doc.id === documentId 
          ? {
              ...doc,
              pages: doc.pages.map(page => 
                page.pageNumber === editingPageNumber 
                  ? { ...page, sheetName: editingSheetName.trim() }
                  : page
              )
            }
          : doc
      );
      
      setDocuments(updatedDocuments);
      
      // Notify parent component of documents update
      if (onDocumentsUpdate) {
        onDocumentsUpdate(updatedDocuments);
      }

      cancelEditingSheetName();
    } catch (error) {
      console.error('Error updating sheet name:', error);
      alert('Failed to update sheet name. Please try again.');
    }
  };

  // Handle Enter key to save
  const handleSheetNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveSheetName();
    } else if (e.key === 'Escape') {
      cancelEditingSheetName();
    }
  };


  // Filter and sort documents
  const getFilteredAndSortedDocuments = () => {
    let filteredDocuments = [...documents];
    
    // Apply takeoff filter - filter documents but also filter pages within documents
    if (filterBy === 'withTakeoffs') {
      filteredDocuments = filteredDocuments.map(doc => ({
        ...doc,
        pages: doc.pages.filter(page => page.hasTakeoffs)
      })).filter(doc => doc.pages.length > 0); // Only show documents that have pages with takeoffs
    } else if (filterBy === 'withoutTakeoffs') {
      filteredDocuments = filteredDocuments.map(doc => ({
        ...doc,
        pages: doc.pages.filter(page => !page.hasTakeoffs)
      })).filter(doc => doc.pages.length > 0); // Only show documents that have pages without takeoffs
    }
    
    // Sort by document name (simple alphabetical sorting)
    filteredDocuments.sort((a, b) => a.name.localeCompare(b.name));
    
    return filteredDocuments;
  };

  if (loading) {
    return (
      <div className="w-96 bg-white border-l flex flex-col">
        <div className="p-4 border-b">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  const filteredDocuments = getFilteredAndSortedDocuments();

  return (
    <div className="w-96 bg-white border-l flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Project Documents</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => loadProjectDocuments()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
        

        {/* Controls */}
        <div className="space-y-3">
          {/* Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Filter Pages
            </label>
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as any)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
            >
              <option value="all">All Pages</option>
              <option value="withTakeoffs">With Takeoffs</option>
              <option value="withoutTakeoffs">Without Takeoffs</option>
            </select>
          </div>
        </div>
      </div>


      {/* Documents and Pages List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {documents.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No PDF documents found</p>
            <p className="text-sm">Upload PDF files to see them here</p>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {filteredDocuments.map((document) => (
              <div key={document.id} className="border rounded-lg">
                {/* Document Header */}
                <div
                  className="p-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => toggleDocumentExpansion(document.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center w-6 h-6 rounded hover:bg-gray-200 transition-colors">
                        {document.isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-gray-600" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-600" />
                        )}
                      </div>
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{document.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {document.totalPages} pages
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTitleblockConfig?.(document.id);
                        }}
                        className="h-6 w-6 p-0"
                        title="Configure Titleblock"
                      >
                        <Settings className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDocument(document.id);
                        }}
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                        title="Delete Document"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Pages List */}
                {document.isExpanded && (
                  <div className="border-t">
                    {document.pages.map((page) => (
                      <div
                        key={page.pageNumber}
                        className={`p-3 cursor-pointer transition-colors ${
                          selectedDocumentId === document.id && selectedPageNumber === page.pageNumber
                            ? 'bg-primary/10 border-l-4 border-primary'
                            : 'hover:bg-accent/30'
                        }`}
                        onClick={() => handlePageClick(document.id, page.pageNumber)}
                      >
                        <div className="flex items-start gap-3">
                          {/* Thumbnail */}
                          <div className="w-12 h-16 bg-gray-100 rounded border flex-shrink-0 flex items-center justify-center">
                            {page.thumbnail ? (
                              <img
                                src={page.thumbnail}
                                alt={`Page ${page.pageNumber}`}
                                className="w-full h-full object-cover rounded"
                              />
                            ) : (
                              <div className="text-center">
                                <FileImage className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                                <span className="text-xs text-gray-400">{page.pageNumber}</span>
                              </div>
                            )}
                          </div>

                          {/* Page Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {editingSheetId === `${document.id}-${page.pageNumber}` ? (
                                <div className="flex items-center gap-1 flex-1">
                                  <Input
                                    value={editingSheetName}
                                    onChange={(e) => setEditingSheetName(e.target.value)}
                                    onKeyDown={handleSheetNameKeyDown}
                                    className="h-6 text-sm px-2 py-1"
                                    autoFocus
                                    onBlur={saveSheetName}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={saveSheetName}
                                    className="h-6 w-6 p-0 text-green-600 hover:text-green-700"
                                    title="Save"
                                  >
                                    <Check className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={cancelEditingSheetName}
                                    className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                                    title="Cancel"
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </div>
                              ) : (
                                <>
                                  <span className="font-medium text-sm">
                                    {page.sheetName || `Page ${page.pageNumber}`}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startEditingSheetName(document.id, page.pageNumber, page.sheetName || '');
                                    }}
                                    className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600"
                                    title="Edit sheet name"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </Button>
                                </>
                              )}
                              {page.sheetNumber && (
                                <Badge variant="secondary" className="text-xs">
                                  {page.sheetNumber}
                                </Badge>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                              <span>Page {page.pageNumber}</span>
                              {page.hasTakeoffs && (
                                <Badge variant="outline" className="text-xs">
                                  {page.takeoffCount} takeoffs
                                </Badge>
                              )}
                              {page.ocrProcessed && (
                                <Badge variant="outline" className="text-xs">
                                  OCR
                                </Badge>
                              )}
                            </div>

                            {/* Extracted Text Preview */}
                            {page.extractedText && (
                              <p className="text-xs text-gray-600 line-clamp-2">
                                {page.extractedText.substring(0, 100)}...
                              </p>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1">
                            {!page.thumbnail && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  generateThumbnail(document.id, page.pageNumber);
                                }}
                                className="h-6 w-6 p-0"
                                title="Generate Thumbnail"
                              >
                                <FileImage className="w-3 h-3" />
                              </Button>
                            )}
                            
                            
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePageVisibility(document.id, page.pageNumber);
                              }}
                              className="h-6 w-6 p-0"
                              title={page.isVisible ? "Hide Page" : "Show Page"}
                            >
                              {page.isVisible ? (
                                <Eye className="w-3 h-3" />
                              ) : (
                                <EyeOff className="w-3 h-3" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t bg-muted/30">
        <div className="text-center text-sm text-muted-foreground">
          {documents.length} document{documents.length !== 1 ? 's' : ''} • {filteredDocuments.length} shown
        </div>
      </div>
    </div>
  );
}
