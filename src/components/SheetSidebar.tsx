import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { 
  FileText, 
  Plus, 
  Upload, 
  Download,
  Trash2,
  MoreVertical,
  Settings,
  Scan,
  ChevronDown,
  ChevronRight,
  Filter,
  RefreshCw,
  Edit2,
  Check,
  X,
  Tag,
  ChevronDown as ChevronDownIcon,
  BarChart3,
  Search,
  Brain
} from 'lucide-react';
import { fileService, sheetService, aiAnalysisService } from '../services/apiService';
import { useTakeoffStore } from '../store/useTakeoffStore';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPage, PDFDocument } from '../types';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// PDFPage and PDFDocument interfaces imported from shared types

interface SheetSidebarProps {
  projectId: string;
  documents: PDFDocument[];
  onPageSelect: (documentId: string, pageNumber: number) => void;
  selectedDocumentId?: string;
  selectedPageNumber?: number;
  onOCRRequest?: (documentId: string, pageNumbers: number[]) => void;
  onOcrSearchResults?: (results: any[], query: string) => void;
  onDocumentsUpdate?: (documents: PDFDocument[]) => void;
  onPdfUpload?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  uploading?: boolean;
}

export function SheetSidebar({ 
  projectId, 
  documents,
  onPageSelect, 
  selectedDocumentId,
  selectedPageNumber,
  onOCRRequest,
  onOcrSearchResults,
  onDocumentsUpdate,
  onPdfUpload,
  uploading
}: SheetSidebarProps) {
  const [viewMode, setViewMode] = useState<'list'>('list');
  const [filterBy, setFilterBy] = useState<'all' | 'withTakeoffs' | 'withoutTakeoffs'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [processingOCR, setProcessingOCR] = useState<string[]>([]);
  const [showLabelingDialog, setShowLabelingDialog] = useState(false);
  const [labelingProgress, setLabelingProgress] = useState('');
  const [labelingProgressPercent, setLabelingProgressPercent] = useState(0);
  
  // Local expansion state to prevent parent from resetting it
  const [expandedDocuments, setExpandedDocuments] = useState<Set<string>>(new Set());
  
  // Use documents from parent component but with local expansion state
  const currentDocuments = documents.map(doc => ({
    ...doc,
    isExpanded: expandedDocuments.has(doc.id)
  }));
  
  // Sheet name editing state
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [editingSheetName, setEditingSheetName] = useState<string>('');
  const [editingPageNumber, setEditingPageNumber] = useState<number | null>(null);
  
  // Sheet number editing state
  const [editingSheetNumberId, setEditingSheetNumberId] = useState<string | null>(null);
  const [editingSheetNumber, setEditingSheetNumber] = useState<string>('');
  const [editingSheetNumberPageNumber, setEditingSheetNumberPageNumber] = useState<number | null>(null);
  
  // Document menu dropdown state
  const [openDocumentMenu, setOpenDocumentMenu] = useState<string | null>(null);
  
  // Ref to track if we're currently updating documents to prevent infinite loops
  const isUpdatingDocuments = useRef(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDocumentMenu) {
        setOpenDocumentMenu(null);
      }
    };

    if (openDocumentMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openDocumentMenu]);

  // Store integration
  const { getProjectTakeoffMeasurements } = useTakeoffStore();

  // Check if document has OCR data
  const checkDocumentOCRStatus = async (documentId: string): Promise<boolean> => {
    try {
      const { serverOcrService } = await import('../services/serverOcrService');
      const ocrData = await serverOcrService.getDocumentData(documentId, projectId);
      return !!(ocrData && ocrData.results.length > 0);
    } catch (error) {
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
  }, [projectId]); // Remove getProjectTakeoffMeasurements from dependencies to prevent unnecessary recreations

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
            // Load PDF to get page count - use correct API base URL
            const { getApiBaseUrl } = await import('../lib/apiConfig');
            const API_BASE_URL = getApiBaseUrl();
            const pdfUrl = `${API_BASE_URL}/files/${file.id}`;
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
                      sheetName: sheetData.sheet.sheetName,
                      sheetNumber: sheetData.sheet.sheetNumber,
                      ocrProcessed: false // Default to false, will be updated when OCR is processed
                    };
                  }
                } catch (error) {
                  // Sheet doesn't exist in database yet, use defaults
                  // This is expected for new documents, so we don't log it as an error
                  if (!(error as any).isExpected404 && (error as any).response?.status !== 404) {
                    console.warn(`Unexpected error loading sheet ${sheetId}:`, error);
                  }
                }
                
                // Default page data
                return {
                  ocrProcessed: false, // Default to false
                  pageNumber,
                  hasTakeoffs: false,
                  takeoffCount: 0,
                  isVisible: true,
                };
              })
            );
            
            // Check if document has OCR data
            const hasOCRData = await checkDocumentOCRStatus(file.id);
            
            return {
              id: file.id,
              name: file.originalName.replace('.pdf', ''),
              totalPages,
              pages,
              ocrEnabled: hasOCRData
            };
          } catch (error) {
            console.error(`Error loading PDF ${file.originalName}:`, error);
            // Return a basic document structure even if PDF loading fails
            // Check if document has OCR data even if PDF loading failed
            const hasOCRData = await checkDocumentOCRStatus(file.id);
            
            return {
              id: file.id,
              name: file.originalName.replace('.pdf', ''),
              totalPages: 1,
              pages: [{
                pageNumber: 1,
                hasTakeoffs: false,
                takeoffCount: 0,
                isVisible: true,
              }],
              ocrEnabled: hasOCRData
            };
          }
        })
      );
      
      // Update hasTakeoffs based on actual measurements
      const finalDocuments = updateHasTakeoffs(documents);
      
      // Update documents through parent callback (without expansion state)
      if (onDocumentsUpdate) {
        onDocumentsUpdate(finalDocuments);
      }
      
    } catch (error) {
      console.error('Error loading project documents:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]); // Remove updateHasTakeoffs from dependencies to prevent unnecessary recreations

  useEffect(() => {
    loadProjectDocuments();
  }, [projectId, loadProjectDocuments]); // Include loadProjectDocuments in dependencies

  // Update hasTakeoffs when takeoff measurements change (but preserve expansion state)
  // This effect only runs when the takeoff measurements actually change, not on every render
  useEffect(() => {
    if (documents.length > 0) {
      const takeoffMeasurements = getProjectTakeoffMeasurements(projectId);
      // Update documents through parent callback
      if (onDocumentsUpdate) {
        const updatedDocuments = updateHasTakeoffs(documents);
        onDocumentsUpdate(updatedDocuments);
      }
    }
  }, [projectId]); // Only depend on projectId to avoid infinite loops



  // Process OCR for a specific page
  const processOCR = useCallback(async (documentId: string, pageNumber: number) => {
    try {
      setProcessingOCR(prev => [...prev, `${documentId}-${pageNumber}`]);
      
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
                  pages: doc.pages.map(page => 
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
    } finally {
      setProcessingOCR(prev => prev.filter(id => id !== `${documentId}-${pageNumber}`));
    }
  }, [projectId]);

  // Handle page selection
  const handlePageClick = (documentId: string, pageNumber: number) => {
    onPageSelect(documentId, pageNumber);
  };

  // Toggle document expansion
  const toggleDocumentExpansion = (documentId: string) => {
    setExpandedDocuments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(documentId)) {
        newSet.delete(documentId);
      } else {
        newSet.add(documentId);
      }
      return newSet;
    });
  };


  // Delete document
  const handleDeleteDocument = async (documentId: string) => {
    try {
      await fileService.deletePDF(documentId);
      if (onDocumentsUpdate) {
        const updatedDocuments = documents.filter(doc => doc.id !== documentId);
        onDocumentsUpdate(updatedDocuments);
      }
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

      // Update the local state immediately for better UX
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
      if (onDocumentsUpdate) {
        onDocumentsUpdate(updatedDocuments);
      }
      
      // Show success feedback
      console.log(`✅ Sheet name saved: "${editingSheetName.trim()}" for page ${editingPageNumber}`);
      
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

  // Start editing sheet number
  const startEditingSheetNumber = (documentId: string, pageNumber: number, currentSheetNumber: string) => {
    const sheetId = `${documentId}-${pageNumber}`;
    setEditingSheetNumberId(sheetId);
    setEditingSheetNumber(currentSheetNumber || '');
    setEditingSheetNumberPageNumber(pageNumber);
  };

  // Cancel editing sheet number
  const cancelEditingSheetNumber = () => {
    setEditingSheetNumberId(null);
    setEditingSheetNumber('');
    setEditingSheetNumberPageNumber(null);
  };

  // Save sheet number with OCR training data
  const saveSheetNumber = async () => {
    if (!editingSheetNumberId || !editingSheetNumberPageNumber) {
      cancelEditingSheetNumber();
      return;
    }

    try {
      // Extract document ID from the sheet ID (format: documentId-pageNumber)
      const documentId = editingSheetNumberId.split('-').slice(0, -1).join('-');
      
      // Get the original sheet number for training data
      const originalDocument = currentDocuments.find(doc => doc.id === documentId);
      const originalPage = originalDocument?.pages.find(page => page.pageNumber === editingSheetNumberPageNumber);
      const originalSheetNumber = originalPage?.sheetNumber || '';
      
      // Prepare the update data - use null if empty string to clear the field
      const updateData: any = {
        documentId: documentId,
        pageNumber: editingSheetNumberPageNumber
      };
      
      if (editingSheetNumber.trim()) {
        updateData.sheetNumber = editingSheetNumber.trim();
      } else {
        updateData.sheetNumber = null; // Clear the sheet number
      }
      
      // Update the sheet number in the backend
      await sheetService.updateSheet(editingSheetNumberId, updateData);


      // Update the local state immediately for better UX
      const updatedDocuments = documents.map(doc => 
        doc.id === documentId 
          ? {
              ...doc,
              pages: doc.pages.map(page => 
                page.pageNumber === editingSheetNumberPageNumber 
                  ? { ...page, sheetNumber: editingSheetNumber.trim() || undefined }
                  : page
              )
            }
          : doc
      );
      if (onDocumentsUpdate) {
        onDocumentsUpdate(updatedDocuments);
      }
      
      // Show success feedback
      console.log(`✅ Sheet number saved: "${editingSheetNumber.trim()}" for page ${editingSheetNumberPageNumber}`);
      
      cancelEditingSheetNumber();
    } catch (error) {
      console.error('Error updating sheet number:', error);
      alert('Failed to update sheet number. Please try again.');
    }
  };

  // Handle Enter key to save sheet number
  const handleSheetNumberKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveSheetNumber();
    } else if (e.key === 'Escape') {
      cancelEditingSheetNumber();
    }
  };

  // Handle extracted sheet names from titleblock configuration
  const handleExtractedSheetNames = async (extractedData: Array<{ pageNumber: number; sheetNumber: string; sheetName: string }>) => {
    if (!selectedDocumentId) {
      console.error('No document selected for sheet name extraction');
      return;
    }

  };

  // Handle unified document analysis using AI
  const handleAnalyzeDocument = async (documentId: string) => {
    try {
      console.log('Starting unified document analysis for document:', documentId);
      
      // Check if document exists
      const document = documents.find(doc => doc.id === documentId);
      if (!document) {
        console.error('Document not found:', documentId);
        alert('Document not found. Please try again.');
        return;
      }

      // Show loading state and dialog
      setProcessingOCR(prev => [...prev, documentId]);
      setShowLabelingDialog(true);
      setLabelingProgress('Starting OCR and AI analysis...');
      setLabelingProgressPercent(0);

      // Call the unified document analysis service
      const response = await aiAnalysisService.analyzeDocumentComplete(documentId, projectId);

      // Handle Server-Sent Events for real-time progress
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let result: any = null;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.error) {
                  throw new Error(data.error);
                }
                
                if (data.progress !== undefined && data.message) {
                  setLabelingProgress(data.message);
                  setLabelingProgressPercent(data.progress);
                }
                
                if (data.success) {
                  result = data;
                }
              } catch (parseError) {
                console.warn('Failed to parse SSE data:', parseError);
              }
            }
          }
        }
      }

      if (!result) {
        throw new Error('No result received from AI analysis');
      }
      
      if (result.success && result.sheets && result.sheets.length > 0) {
        setLabelingProgress('Updating sheet labels...');
        setLabelingProgressPercent(95);
        
        // Save each sheet's information to the database
        let savedCount = 0;
        for (const sheet of result.sheets) {
          try {
            const sheetId = `${documentId}-${sheet.pageNumber}`;
            
            // Only save if we have meaningful data (not "Unknown")
            if (sheet.sheetNumber && sheet.sheetNumber !== 'Unknown' && 
                sheet.sheetName && sheet.sheetName !== 'Unknown') {
              
              await sheetService.updateSheet(sheetId, {
                documentId: documentId,
                pageNumber: sheet.pageNumber,
                sheetNumber: sheet.sheetNumber,
                sheetName: sheet.sheetName
              });
              
              savedCount++;
            }
          } catch (error) {
            console.error(`Failed to save sheet ${sheet.pageNumber}:`, error);
          }
        }
        
        setLabelingProgress('Complete!');
        setLabelingProgressPercent(100);
        console.log(`Successfully saved ${savedCount} sheet labels to database`);
        
        // Reload documents to show updated labels
        if (onDocumentsUpdate) {
          // Trigger a reload of documents to show the new labels
          setTimeout(() => {
            window.location.reload(); // Simple reload to show updated data
          }, 1000);
        }
        
        // Wait a moment to show completion
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        alert(`Successfully labeled ${savedCount} out of ${result.totalPages} sheets automatically! The AI processed all pages in your document.`);
      } else {
        console.warn('No sheet information could be extracted:', result);
        alert('Could not automatically extract sheet information. The AI may need more context or the document structure may be unclear.');
      }

    } catch (error) {
      console.error('Error in automatic sheet labeling:', error);
      alert('Failed to perform automatic sheet labeling. Please try again or use manual labeling.');
    } finally {
      // Remove loading state and close dialog
      setProcessingOCR(prev => prev.filter(id => id !== documentId));
      setShowLabelingDialog(false);
      setLabelingProgress('');
      setLabelingProgressPercent(0);
    }
  };


  // Filter and sort documents
  const getFilteredAndSortedDocuments = () => {
    let filteredDocuments = [...currentDocuments];
    
    // Apply search filter first
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filteredDocuments = filteredDocuments.map(doc => ({
        ...doc,
        pages: doc.pages.filter(page => {
          // Search in page number
          if (page.pageNumber.toString().includes(query)) return true;
          
          // Search in sheet name
          if (page.sheetName && page.sheetName.toLowerCase().includes(query)) return true;
          
          // Search in sheet number
          if (page.sheetNumber && page.sheetNumber.toLowerCase().includes(query)) return true;
          
          // Search in extracted text
          // OCR text search removed - keeping it simple and clean
          
          return false;
        })
      })).filter(doc => doc.pages.length > 0); // Only show documents that have matching pages
    }
    
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
            {onPdfUpload && (
              <label htmlFor="pdf-upload" className="cursor-pointer">
                <Button 
                  size="sm" 
                  variant="outline" 
                  asChild
                  title="Upload new PDF document"
                >
                  <span className="flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    {uploading ? 'Uploading…' : 'Upload PDF'}
                  </span>
                </Button>
              </label>
            )}
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => loadProjectDocuments()}
              title="Refresh documents list"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Hidden file input for PDF upload */}
        {onPdfUpload && (
          <input
            type="file"
            accept=".pdf,application/pdf"
            onChange={onPdfUpload}
            className="hidden"
            id="pdf-upload"
          />
        )}
        

        {/* Controls */}
        <div className="space-y-3">
          {/* Search */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Search className="w-4 h-4" />
              Search Pages
            </label>
            <Input
              type="text"
              placeholder="Search by page number, sheet name, or sheet number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>
          
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
        {currentDocuments.length === 0 ? (
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
                          <button
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleAnalyzeDocument(document.id);
                              setOpenDocumentMenu(null);
                            }}
                            disabled={processingOCR.includes(document.id)}
                          >
                            {processingOCR.includes(document.id) ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Brain className="w-4 h-4" />
                            )}
                            <span className="font-medium">Analyze Document</span>
                            <span className="text-xs text-gray-500 ml-auto">AI Analysis</span>
                          </button>
                          
                          <div className="border-t border-gray-200"></div>
                          
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
          {currentDocuments.length} document{currentDocuments.length !== 1 ? 's' : ''} • {filteredDocuments.length} shown
          {searchQuery.trim() && (
            <span className="ml-2 text-blue-600">
              • Searching for "{searchQuery}"
            </span>
          )}
        </div>
      </div>

      {/* Loading Dialog for AI Document Analysis */}
      {showLabelingDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex flex-col items-center space-y-4">
              <div className="relative">
                <Brain className="w-12 h-12 text-blue-600 animate-pulse" />
                <div className="absolute inset-0">
                  <Brain className="w-12 h-12 text-blue-300 animate-spin" style={{animationDuration: '2s'}} />
                </div>
              </div>
              <h3 className="text-lg font-semibold text-center">AI Analyzing Document</h3>
              <p className="text-gray-600 text-center text-sm">{labelingProgress}</p>
              <div className="flex items-center space-x-2 text-blue-600">
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-4 text-center">Extracting text and analyzing sheets with AI...</p>
          </div>
        </div>
      )}
    </div>
  );
}
