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

  // Debug logging
  useEffect(() => {
    console.log('🔍 SearchTab Debug Info:');
    console.log('📚 Total documents:', documents.length);
    console.log('📋 Documents with OCR:', ocrEnabledDocuments.length);
    console.log('📄 Document details:', documents.map(doc => ({
      id: doc.id,
      name: doc.name,
      ocrEnabled: doc.ocrEnabled,
      pagesWithOCR: doc.pages.filter(p => p.ocrProcessed).length,
      totalPages: doc.pages.length
    })));
  }, [documents, ocrEnabledDocuments]);


  // Search function
  const performSearch = useCallback(async (query: string, documentId?: string) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults({});
      return;
    }

    console.log('🔍 Starting search for:', query);
    console.log('📋 OCR enabled documents:', ocrEnabledDocuments.length);
    console.log('🎯 Target document:', documentId || 'all documents');

    setIsSearching(true);
    setSearchError(null);

    try {
      const results: Record<string, SearchResult[]> = {};

      if (documentId) {
        // Search specific document
        console.log(`🔍 Searching document ${documentId} for "${query}"`);
        try {
          const response = await ocrService.searchDocument(documentId, query, projectId);
          console.log('📊 Search response:', response);
          if (response.results && response.results.length > 0) {
            results[documentId] = response.results;
            console.log(`✅ Found ${response.results.length} results in document ${documentId}`);
          } else {
            console.log(`❌ No results found in document ${documentId}`);
          }
        } catch (error) {
          console.error(`❌ Search failed for document ${documentId}:`, error);
        }
      } else {
        // Search all OCR-enabled documents
        console.log(`🔍 Searching ${ocrEnabledDocuments.length} documents for "${query}"`);
        for (const doc of ocrEnabledDocuments) {
          console.log(`🔍 Searching document ${doc.id} (${doc.name})`);
          try {
            const response = await ocrService.searchDocument(doc.id, query, projectId);
            console.log(`📊 Search response for ${doc.id}:`, response);
            if (response.results && response.results.length > 0) {
              // Debug: Log page numbers from backend
              // CRITICAL FIX: Filter out null/undefined results before accessing pageNumber
              type SearchResultItem = { pageNumber: number };
              const validResults = response.results.filter((r: unknown): r is SearchResultItem => r != null && typeof r === 'object' && (r as SearchResultItem).pageNumber != null);
              console.log(`🔍 Page numbers from backend:`, validResults.map((r: SearchResultItem) => r.pageNumber));
              results[doc.id] = validResults;
              console.log(`✅ Found ${response.results.length} results in document ${doc.id}`);
            } else {
              console.log(`❌ No results found in document ${doc.id}`);
            }
          } catch (error) {
            console.error(`❌ Search failed for document ${doc.id}:`, error);
          }
        }
      }

      console.log('📊 Final search results:', results);
      setSearchResults(results);
    } catch (error) {
      console.error('❌ Search error:', error);
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

        {/* OCR Status */}
        {ocrEnabledDocuments.length === 0 && documents.length > 0 && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center gap-2 text-yellow-700">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">
                No documents have been OCR processed yet. Run OCR processing on your documents first to enable search.
              </span>
            </div>
          </div>
        )}

        {/* Page Number Info */}
        {ocrEnabledDocuments.length > 0 && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2 text-blue-700">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">
                If search results show incorrect page numbers, re-run OCR processing to get accurate page-by-page results.
              </span>
            </div>
          </div>
        )}

        {/* Search Input */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search in documents..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-10"
              disabled={ocrEnabledDocuments.length === 0}
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
            
            {/* Helpful instruction */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-blue-700">
                <Eye className="w-4 h-4" />
                <span className="text-sm">
                  Click on any result to navigate to that page
                </span>
              </div>
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
                        className={`p-3 cursor-pointer transition-all duration-200 ${
                          isSelected
                            ? 'bg-primary/10 border-l-4 border-primary shadow-sm'
                            : 'hover:bg-accent/30 hover:shadow-sm'
                        }`}
                        onClick={() => {
                          console.log(`🔍 Navigating to document ${documentId}, page ${result.pageNumber}`);
                          onPageSelect(documentId, result.pageNumber);
                          
                          // Show a brief success message
                          const docName = getDocumentName(documentId);
                          console.log(`✅ Navigated to ${docName} - Page ${result.pageNumber}`);
                        }}
                        title={`Click to go to page ${result.pageNumber}`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Page Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline" className="text-xs">
                                {result.totalMatches} match{result.totalMatches !== 1 ? 'es' : ''}
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {result.method}
                              </Badge>
                              <ChevronRight className="w-3 h-3 text-muted-foreground ml-auto" />
                            </div>

                            {/* Match Preview */}
                            {result.matches.length > 0 && (
                              <div className="space-y-1">
                                {result.matches.slice(0, isExpanded ? result.matches.length : 1).map((match, matchIndex) => (
                                  <div key={matchIndex} className="text-sm text-gray-700 bg-gray-50 p-3 rounded border">
                                    <div className="font-mono text-xs text-gray-500 mb-1">
                                      Page {result.pageNumber}
                                    </div>
                                    <div className="text-gray-800">
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