import { useState, useMemo, useCallback } from 'react';
import type { PDFDocument } from '../../types';

export type SheetSidebarFilterBy = 'all' | 'withTakeoffs' | 'withoutTakeoffs';

export interface UseSheetSidebarFilterOptions {
  documents: PDFDocument[];
}

export interface UseSheetSidebarFilterResult {
  filterBy: SheetSidebarFilterBy;
  setFilterBy: (value: SheetSidebarFilterBy | ((prev: SheetSidebarFilterBy) => SheetSidebarFilterBy)) => void;
  searchQuery: string;
  setSearchQuery: (value: string | ((prev: string) => string)) => void;
  expandedDocuments: Set<string>;
  setExpandedDocuments: React.Dispatch<React.SetStateAction<Set<string>>>;
  currentDocuments: PDFDocument[];
  getFilteredAndSortedDocuments: () => PDFDocument[];
  toggleDocumentExpansion: (documentId: string) => void;
}

export function useSheetSidebarFilter({
  documents,
}: UseSheetSidebarFilterOptions): UseSheetSidebarFilterResult {
  const [filterBy, setFilterBy] = useState<SheetSidebarFilterBy>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedDocuments, setExpandedDocuments] = useState<Set<string>>(new Set());

  const currentDocuments = useMemo(
    () =>
      documents.map((doc) => ({
        ...doc,
        isExpanded: expandedDocuments.has(doc.id),
      })),
    [documents, expandedDocuments]
  );

  const getFilteredAndSortedDocuments = useCallback(() => {
    let filteredDocuments = [...currentDocuments];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filteredDocuments = filteredDocuments
        .map((doc) => ({
          ...doc,
          pages: doc.pages.filter((page) => {
            if (page.pageNumber.toString().includes(query)) return true;
            if (page.sheetName && page.sheetName.toLowerCase().includes(query)) return true;
            if (page.sheetNumber && page.sheetNumber.toLowerCase().includes(query)) return true;
            return false;
          }),
        }))
        .filter((doc) => doc.pages.length > 0);
    }

    if (filterBy === 'withTakeoffs') {
      filteredDocuments = filteredDocuments
        .map((doc) => ({
          ...doc,
          pages: doc.pages.filter((page) => page.hasTakeoffs),
        }))
        .filter((doc) => doc.pages.length > 0);
    } else if (filterBy === 'withoutTakeoffs') {
      filteredDocuments = filteredDocuments
        .map((doc) => ({
          ...doc,
          pages: doc.pages.filter((page) => !page.hasTakeoffs),
        }))
        .filter((doc) => doc.pages.length > 0);
    }

    filteredDocuments.sort((a, b) => a.name.localeCompare(b.name));
    return filteredDocuments;
  }, [currentDocuments, searchQuery, filterBy]);

  const toggleDocumentExpansion = useCallback((documentId: string) => {
    setExpandedDocuments((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(documentId)) {
        newSet.delete(documentId);
      } else {
        newSet.add(documentId);
      }
      return newSet;
    });
  }, []);

  return {
    filterBy,
    setFilterBy,
    searchQuery,
    setSearchQuery,
    expandedDocuments,
    setExpandedDocuments,
    currentDocuments,
    getFilteredAndSortedDocuments,
    toggleDocumentExpansion,
  };
}
