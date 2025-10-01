import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { 
  Search, 
  FileText, 
  Clock, 
  Eye,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle,
  X
} from 'lucide-react';
import { ocrService } from '../services/apiService';
import type { PDFDocument } from '../types';

interface SearchResult {
  pageNumber: number;
  matches: Array<{
    snippet: string;
    position: number;
    confidence: number;
  }>;
  totalMatches: number;
  method: string;
  processingTime: number;
}

interface SearchTabProps {
  projectId: string;
  documents: PDFDocument[];
  onPageSelect: (documentId: string, pageNumber: number) => void;
  selectedDocumentId?: string;
  selectedPageNumber?: number;
}

export function SearchTab({ 
  projectId, 
  documents, 
  onPageSelect,
  selectedDocumentId,
  selectedPageNumber
}: SearchTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Record<string, SearchResult[]>>({});
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());

  // Get documents that have OCR processing enabled or completed
  const ocrEnabledDocuments = documents.filter(doc => 
    doc.ocrEnabled || doc.pages.some(page => page.ocrProcessed)
  );


  // Search function
  const performSearch = useCallback(async (query: string, documentId?: string) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults({});
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      const results: Record<string, SearchResult[]> = {};

      if (documentId) {
        // Search specific document
        try {
          const response = await ocrService.searchDocument(documentId, query, projectId);
          if (response.results && response.results.length > 0) {
            results[documentId] = response.results;
          }
        } catch (error) {
          console.warn(`Search failed for document ${documentId}:`, error);
        }
      } else {
        // Search all OCR-enabled documents
        for (const doc of ocrEnabledDocuments) {
          try {
            const response = await ocrService.searchDocument(doc.id, query, projectId);
            if (response.results && response.results.length > 0) {
              results[doc.id] = response.results;
            }
          } catch (error) {
            console.warn(`Search failed for document ${doc.id}:`, error);
          }
        }
      }

      setSearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
      setSearchError('Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }, [projectId, ocrEnabledDocuments]);

  // Handle search input
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (query.trim().length >= 2) {
      performSearch(query, selectedDocument || undefined);
    } else {
      setSearchResults({});
    }
  }, [performSearch, selectedDocument]);

  // Handle document selection
  const handleDocumentSelect = (documentId: string) => {
    setSelectedDocument(documentId);
    if (searchQuery.trim().length >= 2) {
      performSearch(searchQuery, documentId);
    }
  };

  // Toggle result expansion
  const toggleResultExpansion = (resultKey: string) => {
    setExpandedResults(prev => {
      const newSet = new Set(prev);
      if (newSet.has(resultKey)) {
        newSet.delete(resultKey);
      } else {
        newSet.add(resultKey);
      }
      return newSet;
    });
  };

  // Clear search
  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults({});
    setSearchError(null);
    setSelectedDocument(null);
  };

  // Get total results count
  const getTotalResultsCount = () => {
    return Object.values(searchResults).reduce((total, results) => 
      total + results.reduce((sum, result) => sum + result.totalMatches, 0), 0
    );
  };

  // Get document name by ID
  const getDocumentName = (documentId: string) => {
    const doc = documents.find(d => d.id === documentId);
    return doc?.name || 'Unknown Document';
  };

  return (
    <div className="w-96 bg-white border-l flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Document Search</h2>
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSearch}
              className="h-6 w-6 p-0"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Search Input */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search in documents..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Document Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Search in:</label>
            <select
              value={selectedDocument || ''}
              onChange={(e) => handleDocumentSelect(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
            >
              <option value="">All Documents</option>
              {ocrEnabledDocuments.map(doc => (
                <option key={doc.id} value={doc.id}>
                  {doc.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Search Results */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {searchError && (
          <div className="p-4">
            <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{searchError}</span>
            </div>
          </div>
        )}

        {isSearching && (
          <div className="p-4">
            <div className="flex items-center gap-2 text-blue-600 bg-blue-50 p-3 rounded-lg">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Searching documents...</span>
            </div>
          </div>
        )}

        {!isSearching && !searchError && searchQuery && Object.keys(searchResults).length === 0 && (
          <div className="p-4">
            <div className="text-center py-8 text-muted-foreground">
              <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No results found</p>
              <p className="text-sm">Try a different search term</p>
            </div>
          </div>
        )}

        {!isSearching && !searchError && Object.keys(searchResults).length > 0 && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                {getTotalResultsCount()} result{getTotalResultsCount() !== 1 ? 's' : ''} found
              </span>
            </div>

            {Object.entries(searchResults).map(([documentId, results]) => (
              <div key={documentId} className="border rounded-lg">
                {/* Document Header */}
                <div className="p-3 bg-gray-50 border-b">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{getDocumentName(documentId)}</span>
                    <Badge variant="outline" className="text-xs">
                      {results.length} page{results.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                </div>

                {/* Results */}
                <div className="divide-y">
                  {results.map((result, index) => {
                    const resultKey = `${documentId}-${result.pageNumber}`;
                    const isExpanded = expandedResults.has(resultKey);
                    const isSelected = selectedDocumentId === documentId && selectedPageNumber === result.pageNumber;

                    return (
                      <div
                        key={resultKey}
                        className={`p-3 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-primary/10 border-l-4 border-primary'
                            : 'hover:bg-accent/30'
                        }`}
                        onClick={() => onPageSelect(documentId, result.pageNumber)}
                      >
                        <div className="flex items-start gap-3">
                          {/* Page Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="font-medium text-sm">Page {result.pageNumber}</span>
                              <Badge variant="outline" className="text-xs">
                                {result.totalMatches} match{result.totalMatches !== 1 ? 'es' : ''}
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {result.method}
                              </Badge>
                            </div>

                            {/* Match Preview */}
                            {result.matches.length > 0 && (
                              <div className="space-y-1">
                                {result.matches.slice(0, isExpanded ? result.matches.length : 1).map((match, matchIndex) => (
                                  <div key={matchIndex} className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
                                    <span className="font-medium text-blue-600">
                                      {match.confidence}% confidence
                                    </span>
                                    <div className="mt-1">
                                      ...{match.snippet}...
                                    </div>
                                  </div>
                                ))}
                                
                                {result.matches.length > 1 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleResultExpansion(resultKey);
                                    }}
                                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                                  >
                                    {isExpanded ? (
                                      <>
                                        <span>Show less</span>
                                      </>
                                    ) : (
                                      <>
                                        <span>Show {result.matches.length - 1} more match{result.matches.length - 1 !== 1 ? 'es' : ''}</span>
                                        <ChevronRight className="w-3 h-3" />
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Processing Info */}
                            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              <span>{result.processingTime}ms</span>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                onPageSelect(documentId, result.pageNumber);
                              }}
                              className="h-6 w-6 p-0"
                              title="Go to page"
                            >
                              <Eye className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {!searchQuery && (
          <div className="p-4">
            <div className="text-center py-8 text-muted-foreground">
              <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Search in your documents</p>
              <p className="text-sm">Enter a search term to find text in OCR-processed documents</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t bg-muted/30">
        <div className="text-center text-sm text-muted-foreground">
          {ocrEnabledDocuments.length} document{ocrEnabledDocuments.length !== 1 ? 's' : ''} with OCR
        </div>
      </div>
    </div>
  );
}