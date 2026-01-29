import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { 
  FileText, 
  Upload, 
  Trash2,
  Settings,
  ChevronDown,
  ChevronRight,
  Filter,
  Edit2,
  Check,
  X,
  Tag,
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
  documentsLoading?: boolean;
  onPageSelect: (documentId: string, pageNumber: number) => void;
  selectedDocumentId?: string;
  selectedPageNumber?: number;
  onOCRRequest?: (documentId: string, pageNumbers: number[]) => void;
  onOcrSearchResults?: (results: any[], query: string) => void;
  onDocumentsUpdate?: (documents: PDFDocument[]) => void;
  onReloadDocuments?: () => Promise<void>;
  onPdfUpload?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  uploading?: boolean;
  onLabelingJobUpdate?: (job: {
    totalDocuments: number;
    completedDocuments: number;
    failedDocuments: number;
    progress: number;
    status: 'idle' | 'processing' | 'completed' | 'failed';
    currentDocument?: string;
    processedPages?: number;
    totalPages?: number;
    failedDocumentsList?: Array<{id: string, name: string}>;
  } | null) => void;
  // New titleblock extraction flows
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
  onOCRRequest,
  onOcrSearchResults,
  onDocumentsUpdate,
  onReloadDocuments,
  onPdfUpload,
  uploading,
  onLabelingJobUpdate,
  onExtractTitleblockForDocument,
  onBulkExtractTitleblock,
}: SheetSidebarProps) {
  const [filterBy, setFilterBy] = useState<'all' | 'withTakeoffs' | 'withoutTakeoffs'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  // Use documentsLoading from parent if provided, otherwise use local loading state
  const [localLoading, setLocalLoading] = useState(true);
  const loading = documentsLoading !== undefined ? documentsLoading : localLoading;
  const [processingOCR, setProcessingOCR] = useState<string[]>([]);
  const [showLabelingDialog, setShowLabelingDialog] = useState(false);
  const [labelingProgress, setLabelingProgress] = useState('');
  const [labelingProgressPercent, setLabelingProgressPercent] = useState(0);
  
  // Bulk analysis state
  const [showBulkAnalysisDialog, setShowBulkAnalysisDialog] = useState(false);
  const [showBulkAnalysisConfirmation, setShowBulkAnalysisConfirmation] = useState(false);
  const [pendingBulkAnalysis, setPendingBulkAnalysis] = useState<{onlyUnlabeled: boolean} | null>(null);
  const [bulkAnalysisProgress, setBulkAnalysisProgress] = useState<{
    total: number;
    completed: number;
    failed: number;
    current?: string;
    status: string;
    completedDocuments: Array<{id: string, name: string, success: boolean}>;
  }>({
    total: 0,
    completed: 0,
    failed: 0,
    status: '',
    completedDocuments: []
  });
  
  // Local expansion state to prevent parent from resetting it
  const [expandedDocuments, setExpandedDocuments] = useState<Set<string>>(new Set());
  
  // Page menu state (for gear icon on pages)
  const [openPageMenu, setOpenPageMenu] = useState<string | null>(null);
  
  // Bulk actions menu state (for gear icon in header)
  const [openBulkActionsMenu, setOpenBulkActionsMenu] = useState(false);
  
  // Rename dialog state
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renamingPage, setRenamingPage] = useState<{documentId: string, pageNumber: number, currentName: string} | null>(null);
  const [renameInput, setRenameInput] = useState('');
  
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

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
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

  // Store integration
  const { getProjectTakeoffMeasurements } = useTakeoffStore();

  // Check if document has OCR data
  const checkDocumentOCRStatus = async (documentId: string): Promise<boolean> => {
    try {
      const { serverOcrService } = await import('../services/serverOcrService');
      const ocrData = await serverOcrService.getDocumentData(documentId, projectId);
      // CRITICAL FIX: Ensure results is an array before accessing length
      return !!(ocrData && Array.isArray(ocrData.results) && ocrData.results.length > 0);
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
      // CRITICAL FIX: Filter out null/undefined pages before mapping to prevent TypeError
      pages: (Array.isArray(doc.pages) ? doc.pages : [])
        .filter(page => page != null && page.pageNumber != null)
        .map(page => {
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
  // Subscribe to takeoffMeasurements changes from store to update counts when measurements are added/deleted
  const takeoffMeasurements = useTakeoffStore((state) => state.takeoffMeasurements);
  
  // Track the last measurements count to prevent update loops
  // Only update documents when takeoffMeasurements actually changes, not when documents changes
  const lastMeasurementsCountRef = useRef<number>(-1);
  const lastMeasurementsHashRef = useRef<string>('');
  
  useEffect(() => {
    if (documents.length > 0 && onDocumentsUpdate) {
      // Create a simple hash of measurements to detect actual changes
      const measurementsHash = takeoffMeasurements.map(m => `${m.id}-${m.sheetId}-${m.pdfPage}`).join(',');
      
      // Only update if measurements actually changed (not just documents)
      if (measurementsHash !== lastMeasurementsHashRef.current) {
        lastMeasurementsHashRef.current = measurementsHash;
        lastMeasurementsCountRef.current = takeoffMeasurements.length;
        
        const updatedDocuments = updateHasTakeoffs(documents);
        onDocumentsUpdate(updatedDocuments);
      }
    }
  // CRITICAL: Remove 'documents' from deps to prevent update loop
  // We only want to run when takeoffMeasurements changes, not when documents changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, takeoffMeasurements, onDocumentsUpdate, updateHasTakeoffs]);



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
      // Reload documents from server to ensure list is up to date
      if (onReloadDocuments) {
        await onReloadDocuments();
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      alert('Failed to delete document. Please try again.');
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
      alert('Failed to delete some documents. Please try again.');
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
              pages: (Array.isArray(doc.pages) ? doc.pages : [])
                .filter(page => page != null)
                .map(page => 
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
      
      // Sheet name saved successfully
      
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
              pages: (Array.isArray(doc.pages) ? doc.pages : [])
                .filter(page => page != null)
                .map(page => 
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
      // Sheet number saved successfully
      
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
      // Starting unified document analysis
      
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
        
        // Type for sheet analysis result
        interface SheetAnalysisResult {
          pageNumber: number;
          sheetNumber: string;
          sheetName: string;
        }
        
        // Derive a safe page range based on both the frontend document metadata
        // and the backend's notion of total pages. This prevents filtering out
        // valid AI results when document.totalPages/pages isn't populated yet.
        const docPageCount = Math.max(
          document.totalPages || 0,
          Array.isArray(document.pages) ? document.pages.length : 0
        );
        const serverTotalPages = typeof result.totalPages === 'number' ? result.totalPages : 0;
        let effectiveMaxPageNumber = Math.max(docPageCount, serverTotalPages);
        if (!effectiveMaxPageNumber || effectiveMaxPageNumber < 1) {
          // If we still don't have a reliable max, skip the upper-bound check
          effectiveMaxPageNumber = 0;
        }
        
        // Filter sheets to save - accept partial results (either sheetNumber OR sheetName is valid)
        // This allows us to save what we can extract even if one field is missing
        const sheetsToSave = (result.sheets as SheetAnalysisResult[])
          .filter((sheet: SheetAnalysisResult) => {
            if (!sheet || typeof sheet.pageNumber !== 'number' || sheet.pageNumber <= 0) {
              return false;
            }
            
            // Accept if EITHER sheetNumber OR sheetName is non-Unknown
            const hasValidNumber = sheet.sheetNumber && sheet.sheetNumber !== 'Unknown';
            const hasValidName = sheet.sheetName && sheet.sheetName !== 'Unknown';
            
            if (!hasValidNumber && !hasValidName) {
              // Both are Unknown, skip this sheet
              return false;
            }
            
            // If we have a reliable max page number, enforce it; otherwise trust the backend.
            if (effectiveMaxPageNumber > 0 && sheet.pageNumber > effectiveMaxPageNumber) {
              console.warn(
                '[Labeling] (single document) Skipping sheet with out-of-range pageNumber',
                { pageNumber: sheet.pageNumber, effectiveMaxPageNumber, docPageCount, serverTotalPages }
              );
              return false;
            }
            return true;
          })
          // Sort by pageNumber to ensure deterministic ordering
          .sort((a, b) => a.pageNumber - b.pageNumber);
        
        console.log('[Labeling] (single document) Valid sheets to save for', document.name, 
          'pages:', sheetsToSave.map(s => s.pageNumber).join(', '));
        
        // Saving sheet labels to database
        
        // Save sheets in batches to avoid overwhelming the API
        const BATCH_SIZE = 10; // Save 10 sheets at a time
        let savedCount = 0;
        let failedCount = 0;
        
        for (let i = 0; i < sheetsToSave.length; i += BATCH_SIZE) {
          const batch = sheetsToSave.slice(i, i + BATCH_SIZE);
          const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
          const totalBatches = Math.ceil(sheetsToSave.length / BATCH_SIZE);
          
          setLabelingProgress(`Saving sheet labels (batch ${batchNumber}/${totalBatches})...`);
          
          // Process batch in parallel
          const batchPromises = batch.map(async (sheet: SheetAnalysisResult) => {
            try {
              const sheetId = `${documentId}-${sheet.pageNumber}`;
              
              // Check if sheet already exists to preserve existing sheetName
              let existingSheetName: string | undefined = undefined;
              try {
                const existingSheet = await sheetService.getSheet(sheetId);
                if (existingSheet?.sheet?.sheetName) {
                  existingSheetName = existingSheet.sheet.sheetName;
                }
              } catch (error) {
                // Sheet doesn't exist yet, which is fine
              }
              
              // Preserve existing sheetName if it exists, otherwise use AI-generated name
              const finalSheetName = existingSheetName || sheet.sheetName;
              
              await sheetService.updateSheet(sheetId, {
                documentId: documentId,
                pageNumber: sheet.pageNumber,
                sheetNumber: sheet.sheetNumber,
                sheetName: finalSheetName
              });
              return { success: true, pageNumber: sheet.pageNumber };
            } catch (error: any) {
              // Handle expected 404s gracefully (they're normal for new sheets)
              if (error.isExpected404) {
                // Sheet not found, creating new entry
                // Try again - the PUT endpoint should create it
                try {
                  const sheetId = `${documentId}-${sheet.pageNumber}`;
                  
                  // Check if sheet already exists to preserve existing sheetName
                  let existingSheetName: string | undefined = undefined;
                  try {
                    const existingSheet = await sheetService.getSheet(sheetId);
                    if (existingSheet?.sheet?.sheetName) {
                      existingSheetName = existingSheet.sheet.sheetName;
                    }
                  } catch (error) {
                    // Sheet doesn't exist yet, which is fine
                  }
                  
                  // Preserve existing sheetName if it exists, otherwise use AI-generated name
                  const finalSheetName = existingSheetName || sheet.sheetName;
                  
                  await sheetService.updateSheet(sheetId, {
                    documentId: documentId,
                    pageNumber: sheet.pageNumber,
                    sheetNumber: sheet.sheetNumber,
                    sheetName: finalSheetName
                  });
                  return { success: true, pageNumber: sheet.pageNumber };
                } catch (retryError) {
                  console.error(`Failed to save sheet ${sheet.pageNumber} after retry:`, retryError);
                  return { success: false, pageNumber: sheet.pageNumber };
                }
              } else {
                console.error(`Failed to save sheet ${sheet.pageNumber}:`, error);
                return { success: false, pageNumber: sheet.pageNumber };
              }
            }
          });
          
          const batchResults = await Promise.all(batchPromises);
          savedCount += batchResults.filter(r => r.success).length;
          failedCount += batchResults.filter(r => !r.success).length;
          
          // Small delay between batches to avoid overwhelming the API
          if (i + BATCH_SIZE < sheetsToSave.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        setLabelingProgress('Complete!');
        setLabelingProgressPercent(100);
        // Sheet labels saved to database
        
        // Show success message first
        const successMessage = failedCount > 0 
          ? `Successfully labeled ${savedCount} out of ${result.totalPages} sheets (${failedCount} failed to save). The AI processed all pages in your document.`
          : `Successfully labeled ${savedCount} out of ${result.totalPages} sheets automatically! The AI processed all pages in your document.`;
        
        // Reload documents to show updated labels without full page reload
        // This prevents the 404 error and keeps the user signed in
        if (onReloadDocuments) {
          // Reload project documents to get updated sheet labels
          await onReloadDocuments();
        }
        
        // Show success message after data is reloaded
        alert(successMessage);
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

  // Check if a page has a meaningful label (not just default names like "Page X" or "Sheet X")
  const hasMeaningfulLabel = (page: PDFPage): boolean => {
    // Check if sheetNumber exists (always meaningful if present)
    if (page.sheetNumber) {
      return true;
    }
    
    // Check if sheetName exists and is not a default pattern
    if (page.sheetName) {
      const name = page.sheetName.trim();
      // Exclude default patterns like "Page X", "Sheet X", "Page X of Y", etc.
      const defaultPatterns = [
        /^Page\s+\d+$/i,           // "Page 1", "Page 2", etc.
        /^Sheet\s+\d+$/i,          // "Sheet 1", "Sheet 2", etc.
        /^Page\s+\d+\s+of\s+\d+$/i, // "Page 1 of 10"
        /^Sheet\s+\d+\s+of\s+\d+$/i // "Sheet 1 of 10"
      ];
      
      // If it matches a default pattern, it's not meaningful
      if (defaultPatterns.some(pattern => pattern.test(name))) {
        return false;
      }
      
      // Otherwise, it's a meaningful label
      return true;
    }
    
    return false;
  };

  // Check if a document is unlabeled (no pages have meaningful sheetName or sheetNumber)
  const isDocumentUnlabeled = (document: PDFDocument): boolean => {
    return document.pages.every(page => !hasMeaningfulLabel(page));
  };

  // Check if a document has any unlabeled pages
  const hasUnlabeledPages = (document: PDFDocument): boolean => {
    return document.pages.some(page => !hasMeaningfulLabel(page));
  };

  // Process all documents for page labeling (skip OCR, use existing OCR data)
  // TEMPORARY: Overwrites ALL pages for testing (will revert to unlabeled-only later)
  const handleLabelAllUnlabeledPages = async () => {
    // TEMPORARY: Process ALL documents (not just unlabeled) for testing
    const documentsToProcess = documents.filter(doc => doc.pages && doc.pages.length > 0);
    
    if (documentsToProcess.length === 0) {
      alert('No documents found to label.');
      return;
    }

    // Initialize labeling job
    if (onLabelingJobUpdate) {
      onLabelingJobUpdate({
        totalDocuments: documentsToProcess.length,
        completedDocuments: 0,
        failedDocuments: 0,
        progress: 0,
        status: 'processing',
        failedDocumentsList: []
      });
    }

    const failedDocumentsList: Array<{id: string, name: string}> = [];
    let totalPagesProcessed = 0;
    let totalPages = 0;

    // Calculate total pages across all documents (TEMPORARY: all pages, not just unlabeled)
    for (const doc of documentsToProcess) {
      totalPages += doc.pages.length;
    }

    // Helper function to update labeling job state
    const updateLabelingJob = (updates: Partial<{
      completedDocuments: number;
      failedDocuments: number;
      progress: number;
      currentDocument?: string;
      processedPages?: number;
      status: 'idle' | 'processing' | 'completed' | 'failed';
    }>) => {
      if (onLabelingJobUpdate) {
        onLabelingJobUpdate({
          totalDocuments: documentsToProcess.length,
          completedDocuments: updates.completedDocuments ?? 0,
          failedDocuments: updates.failedDocuments ?? failedDocumentsList.length,
          progress: updates.progress ?? 0,
          status: updates.status ?? 'processing',
          currentDocument: updates.currentDocument,
          processedPages: updates.processedPages ?? totalPagesProcessed,
          totalPages: totalPages,
          failedDocumentsList: failedDocumentsList
        });
      }
    };

    // Process documents sequentially
    for (let i = 0; i < documentsToProcess.length; i++) {
      const document = documentsToProcess[i];
      
      try {
        // Update current document
        updateLabelingJob({
          completedDocuments: i,
          failedDocuments: failedDocumentsList.length,
          progress: Math.round((i / documentsToProcess.length) * 100),
          currentDocument: document.name,
          processedPages: totalPagesProcessed,
          status: 'processing'
        });

        // Call analyze-sheets endpoint directly (skip OCR)
        const response = await aiAnalysisService.analyzeSheetsOnly(document.id, projectId);

        // Handle Server-Sent Events for real-time progress
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let result: any = null;
        let lastProgress = 0;

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
                  
                  // Update progress from SSE
                  if (data.progress !== undefined && data.message) {
                    lastProgress = data.progress;
                    // Calculate overall progress: document progress + completed documents
                    const documentProgress = (lastProgress / 100) * (1 / documentsToProcess.length) * 100;
                    const completedProgress = (i / documentsToProcess.length) * 100;
                    const overallProgress = completedProgress + documentProgress;
                    
                    updateLabelingJob({
                      progress: Math.round(overallProgress),
                      processedPages: totalPagesProcessed + Math.round((lastProgress / 100) * document.totalPages),
                      status: 'processing'
                    });
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

        if (!result || !result.success) {
          throw new Error('No result received from AI analysis');
        }

        if (result.sheets && result.sheets.length > 0) {
          // Save sheets per page as they're processed
          interface SheetAnalysisResult {
            pageNumber: number;
            sheetNumber: string;
            sheetName: string;
          }

          // Get max page number for validation
          const maxPageNumber = Math.max(document.totalPages || 0, document.pages.length || 0);
          
          // Accept partial results (either sheetNumber OR sheetName is valid)
          const sheetsToSave = (result.sheets as SheetAnalysisResult[])
            .filter((sheet: SheetAnalysisResult) => {
              if (!sheet || typeof sheet.pageNumber !== 'number' || sheet.pageNumber <= 0) {
                return false;
              }
              
              // Accept if EITHER sheetNumber OR sheetName is non-Unknown (also check for empty strings)
              const hasValidNumber = sheet.sheetNumber && 
                                     sheet.sheetNumber !== 'Unknown' && 
                                     sheet.sheetNumber.trim() !== '';
              const hasValidName = sheet.sheetName && 
                                   sheet.sheetName !== 'Unknown' && 
                                   sheet.sheetName.trim() !== '';
              
              if (!hasValidNumber && !hasValidName) {
                return false; // Both Unknown or empty, skip
              }
              
              // Validate page number is within document bounds
              if (sheet.pageNumber > maxPageNumber) {
                console.warn(`[Labeling] Invalid page number ${sheet.pageNumber} for document ${document.name} (total pages: ${maxPageNumber})`);
                return false;
              }
              
              return true;
            })
            // CRITICAL: Sort by pageNumber to ensure correct order and prevent lag accumulation
            .sort((a, b) => a.pageNumber - b.pageNumber);

          console.log(`[Labeling] Received ${result.sheets?.length || 0} sheets from backend, filtered to ${sheetsToSave.length} valid sheets for ${document.name}`);
          if (sheetsToSave.length > 0) {
            console.log(`[Labeling] Processing ${sheetsToSave.length} sheets for ${document.name}, pages:`, 
              sheetsToSave.map(s => s.pageNumber).join(', '));
            // Log sample of what we're saving
            const sample = sheetsToSave.slice(0, 3);
            console.log(`[Labeling] Sample sheets to save:`, sample.map(s => ({
              page: s.pageNumber,
              number: s.sheetNumber,
              name: s.sheetName?.substring(0, 40)
            })));
          } else {
            console.warn(`[Labeling] No valid sheets to save for ${document.name}. Sample of received sheets:`, 
              result.sheets?.slice(0, 3).map((s: any) => ({
                page: s.pageNumber,
                number: s.sheetNumber,
                name: s.sheetName
              })));
          }

          // Save sheets sequentially without debounced reloads to prevent race conditions
          // TEMPORARY: Overwrite ALL pages (removed check for existing labels)
          for (const sheet of sheetsToSave) {
            try {
              // Validate page number is within document bounds
              if (sheet.pageNumber < 1 || sheet.pageNumber > maxPageNumber) {
                console.warn(`[Labeling] Invalid page number ${sheet.pageNumber} for document ${document.name} (total pages: ${maxPageNumber})`);
                continue;
              }
              
              const sheetId = `${document.id}-${sheet.pageNumber}`;
              
              console.log(`[Labeling] Overwriting page ${sheet.pageNumber}: "${sheet.sheetNumber}" - "${sheet.sheetName}"`);
              
              await sheetService.updateSheet(sheetId, {
                documentId: document.id,
                pageNumber: sheet.pageNumber,
                sheetNumber: sheet.sheetNumber,
                sheetName: sheet.sheetName
              });

              // Update progress
              totalPagesProcessed++;
              updateLabelingJob({
                processedPages: totalPagesProcessed,
                progress: Math.round(((i + 1) / documentsToProcess.length) * 100),
                status: 'processing'
              });
            } catch (error) {
              console.error(`[Labeling] Failed to save sheet ${sheet.pageNumber} for ${document.name}:`, error);
            }
          }
          
          console.log(`[Labeling] Completed processing ${sheetsToSave.length} sheets for ${document.name}`);
        }

        // Mark document as completed
        updateLabelingJob({
          completedDocuments: i + 1,
          progress: Math.round(((i + 1) / documentsToProcess.length) * 100),
          currentDocument: undefined,
          status: 'processing'
        });

      } catch (error) {
        console.error(`Failed to label pages for document ${document.name}:`, error);
        failedDocumentsList.push({ id: document.id, name: document.name });
        
        updateLabelingJob({
          failedDocuments: failedDocumentsList.length,
          completedDocuments: i + 1,
          progress: Math.round(((i + 1) / documentsToProcess.length) * 100),
          currentDocument: undefined,
          status: 'processing'
        });
      }
    }

    // Final reload
    if (onReloadDocuments) {
      await onReloadDocuments();
    }

    // Mark as completed and show report
    if (onLabelingJobUpdate) {
      onLabelingJobUpdate({
        totalDocuments: documentsToProcess.length,
        completedDocuments: documentsToProcess.length,
        failedDocuments: failedDocumentsList.length,
        progress: 100,
        status: 'completed',
        processedPages: totalPagesProcessed,
        totalPages: totalPages,
        failedDocumentsList: failedDocumentsList
      });
    }

    // Show completion report
    const successCount = documentsToProcess.length - failedDocumentsList.length;
    const failCount = failedDocumentsList.length;
    
    let reportMessage = `Page labeling complete!\n\n✅ Successfully labeled: ${successCount} document(s)`;
    if (failCount > 0) {
      reportMessage += `\n❌ Failed: ${failCount} document(s)`;
      reportMessage += `\n\nFailed documents:\n${failedDocumentsList.map(d => `- ${d.name}`).join('\n')}`;
    }
    alert(reportMessage);

    // Clear job after 3 seconds
    setTimeout(() => {
      if (onLabelingJobUpdate) {
        onLabelingJobUpdate(null);
      }
    }, 3000);
  };

  // Bulk analyze documents - show confirmation first
  const handleBulkAnalyzeDocumentsClick = (onlyUnlabeled: boolean = false) => {
    // Filter documents based on option
    let documentsToAnalyze = documents;
    if (onlyUnlabeled) {
      documentsToAnalyze = documents.filter(doc => isDocumentUnlabeled(doc));
    }
    
    if (documentsToAnalyze.length === 0) {
      alert(onlyUnlabeled 
        ? 'No unlabeled documents found. All documents already have sheet names or numbers.'
        : 'No documents found to analyze.');
      return;
    }
    
    // Show confirmation dialog
    setPendingBulkAnalysis({ onlyUnlabeled });
    setShowBulkAnalysisConfirmation(true);
  };
  
  // Actually start the bulk analysis after confirmation
  const handleBulkAnalyzeDocuments = async (onlyUnlabeled: boolean = false) => {
    setShowBulkAnalysisConfirmation(false);
    setPendingBulkAnalysis(null);
    
    // Filter documents based on option
    let documentsToAnalyze = documents;
    if (onlyUnlabeled) {
      documentsToAnalyze = documents.filter(doc => isDocumentUnlabeled(doc));
    }
    
    if (documentsToAnalyze.length === 0) {
      alert(onlyUnlabeled 
        ? 'No unlabeled documents found. All documents already have sheet names or numbers.'
        : 'No documents found to analyze.');
      return;
    }
    
    // Initialize progress
    setBulkAnalysisProgress({
      total: documentsToAnalyze.length,
      completed: 0,
      failed: 0,
      status: 'Starting bulk analysis...',
      completedDocuments: []
    });
    setShowBulkAnalysisDialog(true);
    
    // Process documents in parallel batches of 5
    const PARALLEL_LIMIT = 5;
    const completedDocs: Array<{id: string, name: string, success: boolean}> = [];
    
    for (let i = 0; i < documentsToAnalyze.length; i += PARALLEL_LIMIT) {
      const batch = documentsToAnalyze.slice(i, i + PARALLEL_LIMIT);
      
      setBulkAnalysisProgress(prev => ({
        ...prev,
        status: `Processing batch ${Math.floor(i / PARALLEL_LIMIT) + 1} of ${Math.ceil(documentsToAnalyze.length / PARALLEL_LIMIT)}...`
      }));
      
      // Process batch in parallel
      const batchPromises = batch.map(async (document) => {
        try {
          setBulkAnalysisProgress(prev => ({
            ...prev,
            current: document.name
          }));
          
          // Use the existing handleAnalyzeDocument logic but without the dialog
          const response = await aiAnalysisService.analyzeDocumentComplete(document.id, projectId);
          
          // Handle Server-Sent Events
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
                    if (data.success) {
                      result = data;
                    }
                  } catch (parseError) {
                    // Ignore parse errors
                  }
                }
              }
            }
          }
          
        if (result && result.success && result.sheets && result.sheets.length > 0) {
          // Save sheets (reuse logic from handleAnalyzeDocument)
          interface SheetAnalysisResult {
            pageNumber: number;
            sheetNumber: string;
            sheetName: string;
          }
          
          // Derive safe page bounds for this document, taking into account
          // both frontend metadata and the backend-reported total page count.
          const docPageCount = Math.max(
            document.totalPages || 0,
            Array.isArray(document.pages) ? document.pages.length : 0
          );
          const serverTotalPages = typeof result.totalPages === 'number' ? result.totalPages : 0;
          let effectiveMaxPageNumber = Math.max(docPageCount, serverTotalPages);
          if (!effectiveMaxPageNumber || effectiveMaxPageNumber < 1) {
            effectiveMaxPageNumber = 0;
          }
          
          // Accept partial results (either sheetNumber OR sheetName is valid)
          const sheetsToSave = (result.sheets as SheetAnalysisResult[])
            .filter((sheet: SheetAnalysisResult) => {
              if (!sheet || typeof sheet.pageNumber !== 'number' || sheet.pageNumber <= 0) {
                return false;
              }
              
              // Accept if EITHER sheetNumber OR sheetName is non-Unknown
              const hasValidNumber = sheet.sheetNumber && sheet.sheetNumber !== 'Unknown';
              const hasValidName = sheet.sheetName && sheet.sheetName !== 'Unknown';
              
              if (!hasValidNumber && !hasValidName) {
                return false; // Both Unknown, skip
              }
              
              if (effectiveMaxPageNumber > 0 && sheet.pageNumber > effectiveMaxPageNumber) {
                console.warn(
                  '[Labeling] (bulk) Skipping sheet with out-of-range pageNumber',
                  { pageNumber: sheet.pageNumber, effectiveMaxPageNumber, docPageCount, serverTotalPages }
                );
                return false;
              }
              
              return true;
            })
            // Ensure we always process in ascending page order
            .sort((a, b) => a.pageNumber - b.pageNumber);
          
          console.log('[Labeling] (bulk) Valid sheets to save for', document.name, 
            'pages:', sheetsToSave.map(s => s.pageNumber).join(', '));
            
            // Save sheets in parallel
            await Promise.all(sheetsToSave.map(async (sheet: SheetAnalysisResult) => {
              try {
                const sheetId = `${document.id}-${sheet.pageNumber}`;
                
                // Check if sheet already exists to preserve existing sheetName
                let existingSheetName: string | undefined = undefined;
                try {
                  const existingSheet = await sheetService.getSheet(sheetId);
                  if (existingSheet?.sheet?.sheetName) {
                    existingSheetName = existingSheet.sheet.sheetName;
                  }
                } catch (error) {
                  // Sheet doesn't exist yet
                }
                
                const finalSheetName = existingSheetName || sheet.sheetName;
                
                await sheetService.updateSheet(sheetId, {
                  documentId: document.id,
                  pageNumber: sheet.pageNumber,
                  sheetNumber: sheet.sheetNumber,
                  sheetName: finalSheetName
                });
              } catch (error) {
                console.error(`Failed to save sheet ${sheet.pageNumber} for ${document.name}:`, error);
              }
            }));
          }
          
          return { id: document.id, name: document.name, success: true };
        } catch (error) {
          console.error(`Failed to analyze document ${document.name}:`, error);
          return { id: document.id, name: document.name, success: false };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      completedDocs.push(...batchResults);
      
      // Update progress
      const successCount = batchResults.filter(r => r.success).length;
      const failCount = batchResults.filter(r => !r.success).length;
      
      setBulkAnalysisProgress(prev => ({
        ...prev,
        completed: prev.completed + successCount,
        failed: prev.failed + failCount,
        completedDocuments: [...prev.completedDocuments, ...batchResults],
        current: undefined
      }));
    }
    
    // Reload documents
    if (onReloadDocuments) {
      await onReloadDocuments();
    }
    
    // Show completion message
    const successCount = completedDocs.filter(d => d.success).length;
    const failCount = completedDocs.filter(d => !d.success).length;
    
    setBulkAnalysisProgress(prev => ({
      ...prev,
      status: `Complete! ${successCount} succeeded, ${failCount} failed.`
    }));
    
    // Auto-close after 3 seconds
    setTimeout(() => {
      setShowBulkAnalysisDialog(false);
      if (successCount > 0) {
        alert(`Bulk analysis complete!\n\n✅ Successfully analyzed: ${successCount} document(s)\n${failCount > 0 ? `❌ Failed: ${failCount} document(s)` : ''}`);
      }
    }, 3000);
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
      alert('Failed to rename page. Please try again.');
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
      alert('Failed to delete document. Please try again.');
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
      <div className="p-4 border-b relative">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Project Documents</h2>
          <div className="flex gap-2 relative">
            {onPdfUpload && (
              <label htmlFor="pdf-upload" className="cursor-pointer">
                <Button 
                  size="sm" 
                  variant="outline" 
                  asChild
                  title="Upload new PDF document(s)"
                >
                  <span className="flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    {uploading ? 'Uploading…' : 'Upload PDF'}
                  </span>
                </Button>
              </label>
            )}
            <div className="relative">
              <Button 
                size="sm" 
                variant="outline" 
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenBulkActionsMenu(!openBulkActionsMenu);
                }}
                title="Document Actions"
              >
                <Settings className="w-4 h-4" />
              </Button>
              
              {openBulkActionsMenu && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white border rounded-lg shadow-lg z-50 py-1">
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 text-blue-600 flex items-center gap-2"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenBulkActionsMenu(false);
                      
                      const confirmed = window.confirm(
                        `Extract titleblock information for all ${documents.length} document(s)? This will process all pages.`
                      );
                      
                      if (!confirmed) {
                        return;
                      }
                      
                      if (onBulkExtractTitleblock) {
                        onBulkExtractTitleblock();
                      } else {
                        handleLabelAllUnlabeledPages();
                      }
                    }}
                  >
                    <Tag className="w-4 h-4" />
                    Extract Titleblock Info (All)
                  </button>
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDeleteAllDocuments();
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete All Documents
                  </button>
                </div>
              )}
            </div>
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
            multiple
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
                                      alert('To delete a page from a multi-page document, please delete the entire document.');
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

      {/* Bulk Analysis Confirmation Dialog */}
      {showBulkAnalysisConfirmation && pendingBulkAnalysis && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex flex-col space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Confirm Document Analysis</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowBulkAnalysisConfirmation(false);
                    setPendingBulkAnalysis(null);
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  {pendingBulkAnalysis.onlyUnlabeled 
                    ? 'This will analyze all unlabeled documents to extract sheet names and numbers using AI.'
                    : 'This will analyze all documents to extract sheet names and numbers using AI.'}
                </p>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-blue-900 mb-2">What will happen:</p>
                  <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                    <li>OCR processing will extract text from each document</li>
                    <li>AI will analyze title blocks to identify sheet numbers and names</li>
                    <li>Sheet information will be automatically saved</li>
                    <li>This process may take several minutes for large documents</li>
                  </ul>
                </div>
                
                <div className="text-sm text-gray-600">
                  <p className="font-medium mb-1">Documents to analyze:</p>
                  <p>
                    {pendingBulkAnalysis.onlyUnlabeled
                      ? `${documents.filter(doc => isDocumentUnlabeled(doc)).length} unlabeled document(s)`
                      : `${documents.length} document(s)`}
                  </p>
                </div>
              </div>
              
              <div className="flex gap-2 justify-end pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowBulkAnalysisConfirmation(false);
                    setPendingBulkAnalysis(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (pendingBulkAnalysis) {
                      handleBulkAnalyzeDocuments(pendingBulkAnalysis.onlyUnlabeled);
                    }
                  }}
                >
                  <Brain className="w-4 h-4 mr-2" />
                  Start Analysis
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Analysis Progress Modal */}
      {showBulkAnalysisDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex flex-col space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Bulk Document Analysis</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowBulkAnalysisDialog(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Progress:</span>
                  <span className="font-medium">
                    {bulkAnalysisProgress.completed + bulkAnalysisProgress.failed} / {bulkAnalysisProgress.total}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${((bulkAnalysisProgress.completed + bulkAnalysisProgress.failed) / bulkAnalysisProgress.total) * 100}%`
                    }}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">{bulkAnalysisProgress.status}</p>
                {bulkAnalysisProgress.current && (
                  <p className="text-sm text-gray-600">Currently processing: {bulkAnalysisProgress.current}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <p className="text-sm font-medium">Completed Documents:</p>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {bulkAnalysisProgress.completedDocuments.map((doc, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center gap-2 text-sm p-2 rounded ${
                        doc.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {doc.success ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <X className="w-4 h-4" />
                      )}
                      <span>{doc.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rename Dialog */}
      {showRenameDialog && renamingPage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Rename Page</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Page Name
                </label>
                <Input
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleRenamePage();
                    } else if (e.key === 'Escape') {
                      setShowRenameDialog(false);
                      setRenamingPage(null);
                      setRenameInput('');
                    }
                  }}
                  autoFocus
                  placeholder="Enter page name"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowRenameDialog(false);
                    setRenamingPage(null);
                    setRenameInput('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRenamePage}
                  disabled={!renameInput.trim()}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
