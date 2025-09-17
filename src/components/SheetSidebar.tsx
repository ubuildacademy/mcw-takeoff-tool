import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { 
  FileText, 
  Search, 
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
  SortAsc,
  SortDesc,
  RefreshCw,
  Edit2,
  Check,
  X
} from 'lucide-react';
import { fileService, sheetService } from '../services/apiService';
import { ocrService } from '../services/ocrService';
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
}

export function SheetSidebar({ 
  projectId, 
  onPageSelect, 
  selectedDocumentId,
  selectedPageNumber,
  onOCRRequest,
  onTitleblockConfig,
  onOcrSearchResults
}: SheetSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list'>('list');
  const [sortBy, setSortBy] = useState<'page' | 'name' | 'sheetNumber'>('page');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filterBy, setFilterBy] = useState<'all' | 'withTakeoffs' | 'withoutTakeoffs'>('all');
  const [documents, setDocuments] = useState<PDFDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingOCR, setProcessingOCR] = useState<string[]>([]);
  const [ocrSearchResults, setOcrSearchResults] = useState<any[]>([]);
  const [isSearchingOCR, setIsSearchingOCR] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{[documentId: string]: {current: number, total: number}}>({});
  const [showOcrProgress, setShowOcrProgress] = useState(false);
  
  // Sheet name editing state
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [editingSheetName, setEditingSheetName] = useState<string>('');
  const [editingPageNumber, setEditingPageNumber] = useState<number | null>(null);

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
            
            // Create pages array
            const pages: PDFPage[] = Array.from({ length: totalPages }, (_, index) => ({
              pageNumber: index + 1,
              hasTakeoffs: false, // Will be updated from takeoff data
              takeoffCount: 0,
              isVisible: true,
              ocrProcessed: false
            }));
            
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
      
      setDocuments(documents);
      
    } catch (error) {
      console.error('Error loading project documents:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadProjectDocuments();
  }, [loadProjectDocuments]);

  // Listen for OCR progress events
  useEffect(() => {
    const handleOcrProgress = (event: CustomEvent) => {
      const { documentId, current, total } = event.detail;
      setOcrProgress(prev => ({
        ...prev,
        [documentId]: { current, total }
      }));
    };

    window.addEventListener('ocr-progress', handleOcrProgress as EventListener);
    return () => window.removeEventListener('ocr-progress', handleOcrProgress as EventListener);
  }, []);

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
    setEditingSheetId(documentId);
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
      // Update the sheet name in the backend
      await sheetService.updateSheet(editingSheetId, {
        sheetName: editingSheetName.trim()
      });

      // Update the local state
      setDocuments(prev => prev.map(doc => 
        doc.id === editingSheetId 
          ? {
              ...doc,
              pages: doc.pages.map(page => 
                page.pageNumber === editingPageNumber 
                  ? { ...page, sheetName: editingSheetName.trim() }
                  : page
              )
            }
          : doc
      ));

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

  // Perform OCR search with automatic processing
  const performOCRSearch = useCallback(async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setOcrSearchResults([]);
      // Clear highlights when search is cleared
      if (onOcrSearchResults) {
        onOcrSearchResults([], '');
      }
      return;
    }

    console.log('🔍 Performing OCR search for:', query);
    setIsSearchingOCR(true);
    setShowOcrProgress(true);
    
    try {
      // Check if any documents need OCR processing
      const documentsNeedingOCR = documents.filter(doc => 
        doc.id && !ocrService.isComplete(doc.id) && !ocrService.isProcessing(doc.id)
      );

      if (documentsNeedingOCR.length > 0) {
        console.log(`🔄 Starting OCR processing for ${documentsNeedingOCR.length} documents...`);
        
        // Process all documents that need OCR
        const processingPromises = documentsNeedingOCR.map(async (doc) => {
          if (doc.id) {
            const pdfUrl = `http://localhost:4000/api/files/${doc.id}`;
            console.log(`🔄 Processing OCR for: ${doc.name}`);
            
            try {
              const result = await ocrService.processDocument(doc.id, pdfUrl);
              console.log(`✅ OCR completed for: ${doc.name}`);
              return result;
            } catch (error) {
              console.error(`❌ OCR failed for: ${doc.name}`, error);
              return null;
            }
          }
        });

        // Wait for all OCR processing to complete
        await Promise.all(processingPromises);
        console.log('✅ All OCR processing completed');
      }

      // Now perform the search
      const results = ocrService.searchText(query);
      console.log('🎯 OCR search results:', results);
      setOcrSearchResults(results);
      
      // Notify parent component of search results
      if (onOcrSearchResults) {
        onOcrSearchResults(results, query);
      }
      
      if (results.length === 0) {
        console.log('ℹ️ No results found for the search query');
      }
    } catch (error) {
      console.error('❌ OCR search error:', error);
      setOcrSearchResults([]);
    } finally {
      setIsSearchingOCR(false);
      setShowOcrProgress(false);
    }
  }, [documents]);

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    
    // Debounce OCR search
    const timeoutId = setTimeout(() => {
      performOCRSearch(query);
    }, 300);

    return () => clearTimeout(timeoutId);
  };

  // Filter and sort pages
  const getFilteredAndSortedPages = () => {
    let allPages: Array<{ document: PDFDocument; page: PDFPage }> = [];
    
    documents.forEach(doc => {
      doc.pages.forEach(page => {
        allPages.push({ document: doc, page });
      });
    });
    
    // Apply search filter
    if (searchQuery) {
      allPages = allPages.filter(({ document, page }) => 
        document.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        page.extractedText?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        page.sheetName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        page.sheetNumber?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Apply takeoff filter
    if (filterBy === 'withTakeoffs') {
      allPages = allPages.filter(({ page }) => page.hasTakeoffs);
    } else if (filterBy === 'withoutTakeoffs') {
      allPages = allPages.filter(({ page }) => !page.hasTakeoffs);
    }
    
    // Apply sorting
    allPages.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'page':
          comparison = a.page.pageNumber - b.page.pageNumber;
          break;
        case 'name':
          comparison = (a.page.sheetName || `Page ${a.page.pageNumber}`).localeCompare(
            b.page.sheetName || `Page ${b.page.pageNumber}`
          );
          break;
        case 'sheetNumber':
          comparison = (a.page.sheetNumber || '').localeCompare(b.page.sheetNumber || '');
          break;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    
    return allPages;
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

  const filteredPages = getFilteredAndSortedPages();

  return (
    <div className="w-96 bg-white border-l flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Project Sheets</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => loadProjectDocuments()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Search text in documents (OCR will process automatically)..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="pl-10"
          />
          {isSearchingOCR && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="space-y-3">

          {/* Sort and Filter */}
          <div className="flex gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="flex-1 px-2 py-1 text-sm border rounded"
            >
              <option value="page">Sort by Page</option>
              <option value="name">Sort by Name</option>
              <option value="sheetNumber">Sort by Sheet #</option>
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            >
              {sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
            </Button>
          </div>

          {/* Filter */}
          <select
            value={filterBy}
            onChange={(e) => setFilterBy(e.target.value as any)}
            className="w-full px-2 py-1 text-sm border rounded"
          >
            <option value="all">All Pages</option>
            <option value="withTakeoffs">With Takeoffs</option>
            <option value="withoutTakeoffs">Without Takeoffs</option>
          </select>
        </div>
      </div>

      {/* OCR Progress Bar */}
        {showOcrProgress && (
          <div className="border-b bg-blue-50 p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
              <h3 className="text-sm font-medium text-blue-800">
                Processing documents for search...
              </h3>
            </div>
            <div className="space-y-3">
              {Object.entries(ocrProgress).map(([documentId, progress]) => {
                const doc = documents.find(d => d.id === documentId);
                const percentage = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
                return (
                  <div key={documentId} className="space-y-2">
                    <div className="flex justify-between text-xs text-blue-700">
                      <span className="font-medium">{doc?.name || 'Document'}</span>
                      <span className="text-blue-600">{progress.current}/{progress.total} pages ({percentage}%)</span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                    {percentage === 100 && (
                      <div className="text-xs text-green-600 font-medium flex items-center gap-1">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        Complete
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {/* OCR Search Results */}
      {searchQuery && !showOcrProgress && (
        <div className="border-b bg-blue-50 p-4">
          {ocrSearchResults.length > 0 ? (
            <>
              <h3 className="text-sm font-medium text-blue-800 mb-2">
                OCR Search Results ({ocrSearchResults.length})
              </h3>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {ocrSearchResults.map((result, index) => (
                  <div
                    key={`${result.documentId}-${result.pageNumber}-${index}`}
                    className="p-2 bg-white rounded border cursor-pointer hover:bg-blue-100"
                    onClick={() => onPageSelect(result.documentId, result.pageNumber)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3 h-3 text-blue-600" />
                        <span className="text-sm font-medium">
                          Page {result.pageNumber}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {result.matches.length} match{result.matches.length !== 1 ? 'es' : ''}
                        </Badge>
                      </div>
                    </div>
                    {result.matches.slice(0, 1).map((match: any, matchIndex: number) => (
                      <div key={matchIndex} className="text-xs text-gray-600 mt-1">
                        <span className="bg-yellow-200 px-1 rounded font-medium">
                          {match.text}
                        </span>
                        <span className="text-gray-500 ml-1">
                          {match.context}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-4">
              <div className="text-sm text-gray-600 mb-2">
                {isSearchingOCR ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                    Searching...
                  </div>
                ) : (
                  <>
                    <p>No results found for "{searchQuery}"</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Documents may still be processing. Try again in a moment.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

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
            {documents.map((document) => (
              <div key={document.id} className="border rounded-lg">
                {/* Document Header */}
                <div
                  className="p-3 cursor-pointer hover:bg-accent/50"
                  onClick={() => toggleDocumentExpansion(document.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {document.isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
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
                              {editingSheetId === document.id && editingPageNumber === page.pageNumber ? (
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
          {documents.length} document{documents.length !== 1 ? 's' : ''} • {filteredPages.length} page{filteredPages.length !== 1 ? 's' : ''} shown
        </div>
      </div>
    </div>
  );
}
