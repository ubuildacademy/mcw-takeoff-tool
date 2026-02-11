import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { 
  FileText, 
  Trash2,
  Settings,
  ChevronDown,
  ChevronRight,
  Edit2,
  Check,
  X,
  Tag
} from 'lucide-react';
import { toast } from 'sonner';
import { useSheetSidebarFilter, useSheetSidebarSheetEditing, SheetSidebarHeader, SheetSidebarDialogs } from './sheet-sidebar';
import { fileService, sheetService } from '../services/apiService';
import { useMeasurementStore } from '../store/slices/measurementSlice';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocument, SearchResult } from '../types';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// PDFPage and PDFDocument interfaces imported from shared types

interface SheetSidebarProps {
  projectId: string;
  documents: PDFDocument[];
  documentsLoading?: boolean;
  onPageSelect: (documentId: string, pageNumber: number) => void;
  selectedDocumentId?: string;
  selectedPageNumber?: number;
  onOCRRequest?: (documentId: string, pageNumbers: number[]) => void;
  onOcrSearchResults?: (results: SearchResult[], query: string) => void;
  onDocumentsUpdate?: (documents: PDFDocument[]) => void;
  onReloadDocuments?: () => void | Promise<void>;
  onPdfUpload?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  uploading?: boolean;
  // Titleblock extraction flows
  onExtractTitleblockForDocument?: (documentId: string) => void;
  onBulkExtractTitleblock?: () => void;
}

export function SheetSidebar({ 
  projectId, 
  documents,
  documentsLoading = false,
  onPageSelect, 
  selectedDocumentId,
  selectedPageNumber,
  onOCRRequest: _onOCRRequest,
  onOcrSearchResults: _onOcrSearchResults,
  onDocumentsUpdate,
  onReloadDocuments,
  onPdfUpload,
  uploading,
  onExtractTitleblockForDocument,
  onBulkExtractTitleblock,
}: SheetSidebarProps) {
  const {
    filterBy,
    setFilterBy,
    searchQuery,
    setSearchQuery,
    currentDocuments,
    getFilteredAndSortedDocuments,
    toggleDocumentExpansion,
  } = useSheetSidebarFilter({ documents });

  const {
    editingSheetId,
    editingSheetName,
    setEditingSheetName,
    startEditingSheetName,
    cancelEditingSheetName,
    saveSheetName,
    handleSheetNameKeyDown,
    editingSheetNumberId,
    editingSheetNumber,
    setEditingSheetNumber,
    startEditingSheetNumber,
    cancelEditingSheetNumber,
    saveSheetNumber,
    handleSheetNumberKeyDown,
  } = useSheetSidebarSheetEditing({
    documents,
    onDocumentsUpdate,
  });

  // Use documentsLoading from parent if provided, otherwise use local loading state
  const [localLoading, setLocalLoading] = useState(true);
  const loading = documentsLoading !== undefined ? documentsLoading : localLoading;
  
  // Page menu state (for gear icon on pages)
  const [openPageMenu, setOpenPageMenu] = useState<string | null>(null);
  
  // Bulk actions menu state (for gear icon in header)
  const [openBulkActionsMenu, setOpenBulkActionsMenu] = useState(false);
  
  // Rename dialog state
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renamingPage, setRenamingPage] = useState<{documentId: string, pageNumber: number, currentName: string} | null>(null);
  const [renameInput, setRenameInput] = useState('');
  
  // Document menu dropdown state
  const [openDocumentMenu, setOpenDocumentMenu] = useState<string | null>(null);
  
  // Ref to track if we're currently updating documents to prevent infinite loops
  const _isUpdatingDocuments = useRef(false);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (_event: MouseEvent) => {
      if (openDocumentMenu) {
        setOpenDocumentMenu(null);
      }
      if (openPageMenu) {
        setOpenPageMenu(null);
      }
      if (openBulkActionsMenu) {
        setOpenBulkActionsMenu(false);
      }
    };

    if (openDocumentMenu || openPageMenu || openBulkActionsMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openDocumentMenu, openPageMenu, openBulkActionsMenu]);

  const getProjectTakeoffMeasurements = useMeasurementStore((s) => s.getProjectTakeoffMeasurements);

  // Check if document has OCR data
  const _checkDocumentOCRStatus = async (documentId: string): Promise<boolean> => {
    try {
      const { serverOcrService } = await import('../services/serverOcrService');
      const ocrData = await serverOcrService.getDocumentData(documentId, projectId);
      // CRITICAL FIX: Ensure results is an array before accessing length
      return !!(ocrData && Array.isArray(ocrData.results) && ocrData.results.length > 0);
    } catch {
      return false;
    }
  };

  // Update hasTakeoffs property based on actual takeoff measurements
  const updateHasTakeoffs = useCallback((docs: PDFDocument[]) => {
    const takeoffMeasurements = getProjectTakeoffMeasurements(projectId);
    
    return docs.map(doc => ({
      ...doc,
      // Preserve isExpanded and other document-level properties
      isExpanded: doc.isExpanded,
      ocrEnabled: doc.ocrEnabled,
      // CRITICAL FIX: Filter out null/undefined pages before mapping to prevent TypeError
      pages: (Array.isArray(doc.pages) ? doc.pages : [])
        .filter(page => page != null && page.pageNumber != null)
        .map(page => {
          const _pageKey = `${projectId}-${doc.id}-${page.pageNumber}`;
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
  }, [projectId, getProjectTakeoffMeasurements]); // Include getProjectTakeoffMeasurements to ensure fresh data

  // CRITICAL FIX: Removed independent document loading to prevent race conditions
  // TakeoffWorkspace is now the single source of truth for document loading
  // Documents are passed as props and should already have full page data
  // The loadProjectDocuments function has been removed - use onReloadDocuments callback instead

  // CRITICAL FIX: Clear local loading state when documentsLoading prop is false
  // If documentsLoading is not provided, fall back to clearing when documents are available
  useEffect(() => {
    if (documentsLoading !== undefined) {
      // Parent is managing loading state, no need to manage locally
      return;
    }
    // Fallback: clear local loading state once we have a projectId and documents prop is available
    if (projectId && Array.isArray(documents)) {
      setLocalLoading(false);
    }
  }, [projectId, documents, documentsLoading]);

  // Update hasTakeoffs when takeoff measurements change (but preserve expansion state)
  // Narrow selector: project measurement count only (avoids subscribing to full takeoffMeasurements array)
  const projectMeasurementsCount = useMeasurementStore((state) => state.getProjectTakeoffMeasurements(projectId).length);

  useEffect(() => {
    if (documents.length > 0 && onDocumentsUpdate) {
      const updatedDocuments = updateHasTakeoffs(documents);
      onDocumentsUpdate(updatedDocuments);
    }
    // Only run when measurement count for this project changes (not when documents reference changes, to avoid loops)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Run when project measurement count changes; omit documents to avoid loops
  }, [projectId, projectMeasurementsCount, onDocumentsUpdate, updateHasTakeoffs]);



  // Process OCR for a specific page
  const _processOCR = useCallback(async (documentId: string, pageNumber: number) => {
    try {
      // Use the server-side OCR service for OCR processing
      const { serverOcrService } = await import('../services/serverOcrService');
      const result = await serverOcrService.processDocument(documentId, projectId);
      
      if (result && result.results && result.results.length > 0) {
        // Update the page with OCR processing status
        if (onDocumentsUpdate) {
          const updatedDocuments = documents.map(doc => 
            doc.id === documentId 
              ? {
                  ...doc,
                  pages: (Array.isArray(doc.pages) ? doc.pages : [])
                    .filter(page => page != null)
                    .map(page => 
                      page.pageNumber === pageNumber 
                        ? { 
                            ...page, 
                          }
                        : page
                    )
                }
              : doc
          );
          onDocumentsUpdate(updatedDocuments);
        }
      }
      
    } catch (error) {
      console.error(`Error processing OCR for page ${pageNumber}:`, error);
    }
  }, [projectId, documents, onDocumentsUpdate]);

  // Handle page selection
  const handlePageClick = (documentId: string, pageNumber: number) => {
    onPageSelect(documentId, pageNumber);
  };

  // Delete document
  const handleDeleteDocument = async (documentId: string) => {
    try {
      await fileService.deletePDF(documentId);
      // Reload documents from server to ensure list is up to date
      if (onReloadDocuments) {
        await onReloadDocuments();
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error('Failed to delete document. Please try again.');
    }
  };

  // Delete all documents
  const handleDeleteAllDocuments = async () => {
    if (!documents || documents.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete all ${documents.length} document(s)? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    try {
      // Delete all documents in parallel
      await Promise.all(documents.map(doc => fileService.deletePDF(doc.id)));
      
      // Reload documents from server to ensure list is up to date
      if (onReloadDocuments) {
        await onReloadDocuments();
      }
      
      setOpenBulkActionsMenu(false);
    } catch (error) {
      console.error('Error deleting all documents:', error);
      toast.error('Failed to delete some documents. Please try again.');
    }
  };

  // Handle rename page
  const handleRenamePage = async () => {
    if (!renamingPage || !renameInput.trim()) {
      setShowRenameDialog(false);
      setRenamingPage(null);
      setRenameInput('');
      return;
    }
    
    try {
      const sheetId = `${renamingPage.documentId}-${renamingPage.pageNumber}`;
      await sheetService.updateSheet(sheetId, {
        documentId: renamingPage.documentId,
        pageNumber: renamingPage.pageNumber,
        sheetName: renameInput.trim()
      });
      
      // Update local state
      if (onDocumentsUpdate) {
        const updatedDocuments = documents.map(doc => 
          doc.id === renamingPage.documentId 
            ? {
                ...doc,
                pages: (Array.isArray(doc.pages) ? doc.pages : [])
                  .filter(page => page != null)
                  .map(page => 
                    page.pageNumber === renamingPage.pageNumber 
                      ? { ...page, sheetName: renameInput.trim() }
                      : page
                  )
              }
            : doc
        );
        onDocumentsUpdate(updatedDocuments);
      }
      
      setShowRenameDialog(false);
      setRenamingPage(null);
      setRenameInput('');
    } catch (error) {
      console.error('Error renaming page:', error);
      toast.error('Failed to rename page. Please try again.');
    }
  };

  // Handle delete page (for single-page documents)
  const handleDeletePage = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this document? This action cannot be undone.')) {
      return;
    }
    
    try {
      await fileService.deletePDF(documentId);
      // Reload documents from server to ensure list is up to date
      if (onReloadDocuments) {
        await onReloadDocuments();
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error('Failed to delete document. Please try again.');
    }
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
      <SheetSidebarHeader
        filterBy={filterBy}
        onFilterByChange={setFilterBy}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        openBulkActionsMenu={openBulkActionsMenu}
        onBulkActionsMenuToggle={setOpenBulkActionsMenu}
        documentsCount={documents.length}
        onBulkExtractTitleblock={onBulkExtractTitleblock}
        onDeleteAllDocuments={handleDeleteAllDocuments}
        onPdfUpload={onPdfUpload}
        uploading={uploading}
      />

      {/* Documents and Pages List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {currentDocuments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No PDF documents found</p>
            <p className="text-sm">Upload PDF files to see them here</p>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {filteredDocuments.map((document) => {
              // Single-page PDFs: show with document header and page content
              if (document.totalPages === 1) {
                const page = document.pages[0];
                return (
                  <div key={document.id} className="border rounded-lg">
                    {/* Document Header */}
                    <div
                      className="p-3 cursor-pointer hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium text-sm">{document.name}</span>
                          <Badge variant="outline" className="text-xs">
                            1 page
                          </Badge>
                        </div>
                        <div className="relative">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDocumentMenu(openDocumentMenu === document.id ? null : document.id);
                            }}
                            className="h-6 w-6 p-0"
                            title="Document Options"
                          >
                            <Settings className="w-3 h-3" />
                          </Button>
                          
                          {openDocumentMenu === document.id && (
                            <div className="absolute right-0 top-full mt-1 w-56 bg-white border rounded-lg shadow-lg z-50 py-1">
                              {/* Extract Titleblock Info option */}
                              <button
                                className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 text-blue-600 flex items-center gap-2"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (onExtractTitleblockForDocument) {
                                    onExtractTitleblockForDocument(document.id);
                                  }
                                  setOpenDocumentMenu(null);
                                }}
                              >
                                <Tag className="w-4 h-4" />
                                Extract Titleblock Info
                              </button>
                              <button
                                className="w-full px-3 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeleteDocument(document.id);
                                  setOpenDocumentMenu(null);
                                }}
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete Document
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Page Content */}
                    <div
                      className={`border-t p-3 cursor-pointer transition-colors ${
                        selectedDocumentId === document.id && selectedPageNumber === page.pageNumber
                          ? 'bg-primary/10 border-l-4 border-primary'
                          : 'hover:bg-accent/30'
                      }`}
                      onClick={() => handlePageClick(document.id, page.pageNumber)}
                    >
                      <div className="flex items-start gap-3">
                        <FileText className="w-4 h-4 text-muted-foreground mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between mb-1">
                            <div className="flex-1 min-w-0 pr-2">
                              {editingSheetId === `${document.id}-${page.pageNumber}` ? (
                                <div className="flex items-center gap-1">
                                  <Input
                                    value={editingSheetName}
                                    onChange={(e) => setEditingSheetName(e.target.value)}
                                    onKeyDown={handleSheetNameKeyDown}
                                    className="h-6 text-sm px-2 py-1"
                                    autoFocus
                                    onBlur={(e) => {
                                      e.stopPropagation();
                                      saveSheetName();
                                    }}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      saveSheetName();
                                    }}
                                    className="h-6 w-6 p-0 text-green-600 hover:text-green-700"
                                    title="Save"
                                  >
                                    <Check className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cancelEditingSheetName();
                                    }}
                                    className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                                    title="Cancel"
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-start gap-2">
                                  <span className="font-medium text-sm break-words leading-tight">
                                    {page.sheetName || document.name || `Page ${page.pageNumber}`}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startEditingSheetName(document.id, page.pageNumber, page.sheetName || '');
                                    }}
                                    className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5"
                                    title="Edit sheet name"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {editingSheetNumberId === `${document.id}-${page.pageNumber}` ? (
                                <div className="flex items-center gap-1">
                                  <Input
                                    value={editingSheetNumber}
                                    onChange={(e) => setEditingSheetNumber(e.target.value)}
                                    onKeyDown={handleSheetNumberKeyDown}
                                    className="h-5 text-xs w-16"
                                    autoFocus
                                    placeholder="Sheet #"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      saveSheetNumber();
                                    }}
                                    className="h-5 w-5 p-0 text-green-600 hover:text-green-700"
                                    title="Save sheet number"
                                  >
                                    <Check className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cancelEditingSheetNumber();
                                    }}
                                    className="h-5 w-5 p-0 text-red-600 hover:text-red-700"
                                    title="Cancel editing"
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  {page.sheetNumber ? (
                                    <Badge variant="secondary" className="text-xs">
                                      {page.sheetNumber}
                                    </Badge>
                                  ) : (
                                    <span className="text-xs text-gray-400 italic">No sheet #</span>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startEditingSheetNumber(document.id, page.pageNumber, page.sheetNumber || '');
                                    }}
                                    className="h-5 w-5 p-0 text-gray-400 hover:text-gray-600"
                                    title={page.sheetNumber ? "Edit sheet number" : "Add sheet number"}
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {page.hasTakeoffs && (
                              <Badge variant="outline" className="text-xs">
                                {page.takeoffCount} takeoffs
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="relative">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              const menuKey = `${document.id}-${page.pageNumber}`;
                              setOpenPageMenu(openPageMenu === menuKey ? null : menuKey);
                            }}
                            className="h-6 w-6 p-0"
                            title="Page Options"
                          >
                            <Settings className="w-3 h-3" />
                          </Button>
                          
                          {openPageMenu === `${document.id}-${page.pageNumber}` && (
                            <div className="absolute right-0 top-full mt-1 w-48 bg-white border rounded-lg shadow-lg z-50 py-1">
                              <button
                                className="w-full px-3 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeletePage(document.id);
                                  setOpenPageMenu(null);
                                }}
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }
              
              // Multi-page PDFs: show with expandable structure
              return (
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
                      <div className="relative">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenDocumentMenu(openDocumentMenu === document.id ? null : document.id);
                          }}
                          className="h-6 w-6 p-0"
                          title="Document Options"
                        >
                          <Settings className="w-3 h-3" />
                        </Button>
                        
                        {openDocumentMenu === document.id && (
                          <div className="absolute right-0 top-full mt-1 w-56 bg-white border rounded-lg shadow-lg z-50 py-1">
                            {/* Extract Titleblock Info option */}
                            <button
                              className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 text-blue-600 flex items-center gap-2"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (onExtractTitleblockForDocument) {
                                  onExtractTitleblockForDocument(document.id);
                                }
                                setOpenDocumentMenu(null);
                              }}
                            >
                              <Tag className="w-4 h-4" />
                              Extract Titleblock Info
                            </button>
                            <button
                              className="w-full px-3 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleDeleteDocument(document.id);
                                setOpenDocumentMenu(null);
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete Document
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Pages List */}
                  {document.isExpanded && (
                    <div className="border-t">
                    {(Array.isArray(document.pages) ? document.pages : [])
                      .filter(page => page != null && page.pageNumber != null)
                      .map((page) => (
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
                          {/* Page Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between mb-1">
                              <div className="flex-1 min-w-0 pr-2">
                                {editingSheetId === `${document.id}-${page.pageNumber}` ? (
                                  <div className="flex items-center gap-1">
                                    <Input
                                      value={editingSheetName}
                                      onChange={(e) => setEditingSheetName(e.target.value)}
                                      onKeyDown={handleSheetNameKeyDown}
                                      className="h-6 text-sm px-2 py-1"
                                      autoFocus
                                      onBlur={(e) => {
                                        e.stopPropagation();
                                        saveSheetName();
                                      }}
                                    />
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        saveSheetName();
                                      }}
                                      className="h-6 w-6 p-0 text-green-600 hover:text-green-700"
                                      title="Save"
                                    >
                                      <Check className="w-3 h-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        cancelEditingSheetName();
                                      }}
                                      className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                                      title="Cancel"
                                    >
                                      <X className="w-3 h-3" />
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-start gap-2">
                                    <span className="font-medium text-sm break-words leading-tight">
                                      {page.sheetName || `Page ${page.pageNumber}`}
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        startEditingSheetName(document.id, page.pageNumber, page.sheetName || '');
                                      }}
                                      className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5"
                                      title="Edit sheet name"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {editingSheetNumberId === `${document.id}-${page.pageNumber}` ? (
                                  <div className="flex items-center gap-1">
                                    <Input
                                      value={editingSheetNumber}
                                      onChange={(e) => setEditingSheetNumber(e.target.value)}
                                      onKeyDown={handleSheetNumberKeyDown}
                                      className="h-5 text-xs w-16"
                                      autoFocus
                                      placeholder="Sheet #"
                                    />
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        saveSheetNumber();
                                      }}
                                      className="h-5 w-5 p-0 text-green-600 hover:text-green-700"
                                      title="Save sheet number"
                                    >
                                      <Check className="w-3 h-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        cancelEditingSheetNumber();
                                      }}
                                      className="h-5 w-5 p-0 text-red-600 hover:text-red-700"
                                      title="Cancel editing"
                                    >
                                      <X className="w-3 h-3" />
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    {page.sheetNumber ? (
                                      <Badge variant="secondary" className="text-xs">
                                        {page.sheetNumber}
                                      </Badge>
                                    ) : (
                                      <span className="text-xs text-gray-400 italic">No sheet #</span>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        startEditingSheetNumber(document.id, page.pageNumber, page.sheetNumber || '');
                                      }}
                                      className="h-5 w-5 p-0 text-gray-400 hover:text-gray-600"
                                      title={page.sheetNumber ? "Edit sheet number" : "Add sheet number"}
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                              <span>Page {page.pageNumber}</span>
                              {page.hasTakeoffs && (
                                <Badge variant="outline" className="text-xs">
                                  {page.takeoffCount} takeoffs
                                </Badge>
                              )}
                            </div>
                          </div>
                          
                          {/* Page Gear Icon */}
                          <div className="relative">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                const menuKey = `${document.id}-${page.pageNumber}`;
                                setOpenPageMenu(openPageMenu === menuKey ? null : menuKey);
                              }}
                              className="h-6 w-6 p-0"
                              title="Page Options"
                            >
                              <Settings className="w-3 h-3" />
                            </Button>
                            
                            {openPageMenu === `${document.id}-${page.pageNumber}` && (
                              <div className="absolute right-0 top-full mt-1 w-48 bg-white border rounded-lg shadow-lg z-50 py-1">
                                <button
                                  className="w-full px-3 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (document.totalPages === 1) {
                                      handleDeletePage(document.id);
                                    } else {
                                      // For multi-page documents, we'd need a different delete handler
                                      // For now, just show a message
                                      toast.info('To delete a page from a multi-page document, please delete the entire document.');
                                    }
                                    setOpenPageMenu(null);
                                  }}
                                >
                                  <Trash2 className="w-4 h-4" />
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t bg-muted/30">
        <div className="text-center text-sm text-muted-foreground">
          {currentDocuments.length} document{currentDocuments.length !== 1 ? 's' : ''} • {filteredDocuments.length} shown
          {searchQuery.trim() && (
            <span className="ml-2 text-blue-600">
              • Searching for "{searchQuery}"
            </span>
          )}
        </div>
      </div>

      <SheetSidebarDialogs
        showRenameDialog={showRenameDialog}
        renamingPage={renamingPage}
        renameInput={renameInput}
        onRenameInputChange={setRenameInput}
        onRenameCancel={() => {
          setShowRenameDialog(false);
          setRenamingPage(null);
          setRenameInput('');
        }}
        onRenameSave={handleRenamePage}
        isRenameSaveDisabled={!renameInput.trim()}
      />
    </div>
  );
}
