import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { sheetService } from '../../services/apiService';
import type { PDFDocument } from '../../types';

export interface UseSheetSidebarSheetEditingOptions {
  documents: PDFDocument[];
  onDocumentsUpdate?: (documents: PDFDocument[]) => void;
}

export interface UseSheetSidebarSheetEditingResult {
  // Sheet name
  editingSheetId: string | null;
  editingSheetName: string;
  editingPageNumber: number | null;
  setEditingSheetName: (value: string | ((prev: string) => string)) => void;
  startEditingSheetName: (documentId: string, pageNumber: number, currentName: string) => void;
  cancelEditingSheetName: () => void;
  saveSheetName: () => Promise<void>;
  handleSheetNameKeyDown: (e: React.KeyboardEvent) => void;
  // Sheet number
  editingSheetNumberId: string | null;
  editingSheetNumber: string;
  editingSheetNumberPageNumber: number | null;
  setEditingSheetNumber: (value: string | ((prev: string) => string)) => void;
  startEditingSheetNumber: (documentId: string, pageNumber: number, currentSheetNumber: string) => void;
  cancelEditingSheetNumber: () => void;
  saveSheetNumber: () => Promise<void>;
  handleSheetNumberKeyDown: (e: React.KeyboardEvent) => void;
}

export function useSheetSidebarSheetEditing({
  documents,
  onDocumentsUpdate,
}: UseSheetSidebarSheetEditingOptions): UseSheetSidebarSheetEditingResult {
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [editingSheetName, setEditingSheetName] = useState<string>('');
  const [editingPageNumber, setEditingPageNumber] = useState<number | null>(null);

  const [editingSheetNumberId, setEditingSheetNumberId] = useState<string | null>(null);
  const [editingSheetNumber, setEditingSheetNumber] = useState<string>('');
  const [editingSheetNumberPageNumber, setEditingSheetNumberPageNumber] = useState<number | null>(null);

  const startEditingSheetName = useCallback((documentId: string, pageNumber: number, currentName: string) => {
    setEditingSheetId(`${documentId}-${pageNumber}`);
    setEditingPageNumber(pageNumber);
    setEditingSheetName(currentName || `Page ${pageNumber}`);
  }, []);

  const cancelEditingSheetName = useCallback(() => {
    setEditingSheetId(null);
    setEditingPageNumber(null);
    setEditingSheetName('');
  }, []);

  const saveSheetName = useCallback(async () => {
    if (!editingSheetId || !editingPageNumber || !editingSheetName.trim()) {
      cancelEditingSheetName();
      return;
    }
    try {
      const documentId = editingSheetId.split('-').slice(0, -1).join('-');
      await sheetService.updateSheet(editingSheetId, {
        documentId,
        pageNumber: editingPageNumber,
        sheetName: editingSheetName.trim(),
      });
      const updatedDocuments = documents.map((doc) =>
        doc.id === documentId
          ? {
              ...doc,
              pages: (Array.isArray(doc.pages) ? doc.pages : [])
                .filter((page) => page != null)
                .map((page) =>
                  page.pageNumber === editingPageNumber
                    ? { ...page, sheetName: editingSheetName.trim() }
                    : page
                ),
            }
          : doc
      );
      onDocumentsUpdate?.(updatedDocuments);
      cancelEditingSheetName();
    } catch (error) {
      console.error('Error updating sheet name:', error);
      toast.error('Failed to update sheet name. Please try again.');
    }
  }, [
    editingSheetId,
    editingPageNumber,
    editingSheetName,
    documents,
    onDocumentsUpdate,
    cancelEditingSheetName,
  ]);

  const handleSheetNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        saveSheetName();
      } else if (e.key === 'Escape') {
        cancelEditingSheetName();
      }
    },
    [saveSheetName, cancelEditingSheetName]
  );

  const startEditingSheetNumber = useCallback((documentId: string, pageNumber: number, currentSheetNumber: string) => {
    setEditingSheetNumberId(`${documentId}-${pageNumber}`);
    setEditingSheetNumber(currentSheetNumber || '');
    setEditingSheetNumberPageNumber(pageNumber);
  }, []);

  const cancelEditingSheetNumber = useCallback(() => {
    setEditingSheetNumberId(null);
    setEditingSheetNumber('');
    setEditingSheetNumberPageNumber(null);
  }, []);

  const saveSheetNumber = useCallback(async () => {
    if (!editingSheetNumberId || !editingSheetNumberPageNumber) {
      cancelEditingSheetNumber();
      return;
    }
    try {
      const documentId = editingSheetNumberId.split('-').slice(0, -1).join('-');
      const updateData = {
        documentId,
        pageNumber: editingSheetNumberPageNumber,
        sheetNumber: editingSheetNumber.trim() ? editingSheetNumber.trim() : null,
      };
      await sheetService.updateSheet(editingSheetNumberId, updateData);
      const updatedDocuments = documents.map((doc) =>
        doc.id === documentId
          ? {
              ...doc,
              pages: (Array.isArray(doc.pages) ? doc.pages : [])
                .filter((page) => page != null)
                .map((page) =>
                  page.pageNumber === editingSheetNumberPageNumber
                    ? { ...page, sheetNumber: editingSheetNumber.trim() || undefined }
                    : page
                ),
            }
          : doc
      );
      onDocumentsUpdate?.(updatedDocuments);
      cancelEditingSheetNumber();
    } catch (error) {
      console.error('Error updating sheet number:', error);
      toast.error('Failed to update sheet number. Please try again.');
    }
  }, [
    editingSheetNumberId,
    editingSheetNumberPageNumber,
    editingSheetNumber,
    documents,
    onDocumentsUpdate,
    cancelEditingSheetNumber,
  ]);

  const handleSheetNumberKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        saveSheetNumber();
      } else if (e.key === 'Escape') {
        cancelEditingSheetNumber();
      }
    },
    [saveSheetNumber, cancelEditingSheetNumber]
  );

  return {
    editingSheetId,
    editingSheetName,
    editingPageNumber,
    setEditingSheetName,
    startEditingSheetName,
    cancelEditingSheetName,
    saveSheetName,
    handleSheetNameKeyDown,
    editingSheetNumberId,
    editingSheetNumber,
    editingSheetNumberPageNumber,
    setEditingSheetNumber,
    startEditingSheetNumber,
    cancelEditingSheetNumber,
    saveSheetNumber,
    handleSheetNumberKeyDown,
  };
}
