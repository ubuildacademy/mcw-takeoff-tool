import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Progress } from './ui/progress';
import { Badge } from './ui/badge';
import { 
  Search, 
  FileText, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  Play,
  RefreshCw,
  ExternalLink,
  Filter
} from 'lucide-react';
import { ocrService } from '../services/ocrService';
import type { PDFDocument } from '../types';

interface SearchResult {
  documentId: string;
  pageNumber: number;
  matches: Array<{
    text: string;
    context: string;
    confidence: number;
  }>;
}

interface SearchTabProps {
  projectId: string;
  documents: PDFDocument[];
  onPageSelect: (documentId: string, pageNumber: number) => void;
  onOcrSearchResults?: (results: any[], query: string) => void;
}

export function SearchTab({ 
  projectId, 
  documents, 
  onPageSelect,
  onOcrSearchResults
}: SearchTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showOcrProgress, setShowOcrProgress] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{[documentId: string]: {current: number, total: number}}>({});
  const [filterBy, setFilterBy] = useState<'all' | 'withTakeoffs' | 'withoutTakeoffs'>('all');

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

  // Perform OCR search with automatic processing
  const performOCRSearch = useCallback(async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([]);
      // Clear highlights when search is cleared
      if (onOcrSearchResults) {
        onOcrSearchResults([], '');
      }
      return;
    }

    setIsSearching(true);
    setShowOcrProgress(true);
    
    try {
      // Check if any documents need OCR processing
      const documentsNeedingOCR = documents.filter(doc => 
        doc.id && !ocrService.isComplete(doc.id) && !ocrService.isProcessing(doc.id)
      );

      if (documentsNeedingOCR.length > 0) {
        // Process all documents that need OCR
        const processingPromises = documentsNeedingOCR.map(async (doc) => {
          if (doc.id) {
            const pdfUrl = `http://localhost:4000/api/files/${doc.id}`;
            
            try {
              const result = await ocrService.processDocument(doc.id, pdfUrl);
              return result;
            } catch (error) {
              console.error(`❌ OCR failed for: ${doc.name}`, error);
              return null;
            }
          }
        });

        // Wait for all OCR processing to complete
        await Promise.all(processingPromises);
      }

      // Now perform the search
      const results = ocrService.searchText(query);
      setSearchResults(results);
      
      // Notify parent component of search results
      if (onOcrSearchResults) {
        onOcrSearchResults(results, query);
      }
      
      if (results.length === 0) {
      }
    } catch (error) {
      console.error('❌ OCR search error:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
      setShowOcrProgress(false);
    }
  }, [documents, onOcrSearchResults]);

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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      performOCRSearch(searchQuery);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <h3 className="text-lg font-semibold mb-4">Search Documents</h3>
        
        {/* Search Input */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Search text in documents (OCR will process automatically)..."
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyPress={handleKeyPress}
            className="pl-10"
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
            </div>
          )}
        </div>

        {/* Filter */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filter Results
          </label>
          <select
            value={filterBy}
            onChange={(e) => setFilterBy(e.target.value as any)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
          >
            <option value="all">All Results</option>
            <option value="withTakeoffs">Pages with Takeoffs</option>
            <option value="withoutTakeoffs">Pages without Takeoffs</option>
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

      {/* Search Results */}
      <div className="flex-1 overflow-y-auto p-4">
        {searchQuery && !showOcrProgress ? (
          searchResults.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Search Results</h4>
                <Badge variant="secondary">
                  {searchResults.reduce((sum, result) => sum + result.matches.length, 0)} matches
                </Badge>
              </div>
              
              {searchResults.map((result, index) => {
                const doc = documents.find(d => d.id === result.documentId);
                const page = doc?.pages.find(p => p.pageNumber === result.pageNumber);
                
                // Apply filter
                if (filterBy === 'withTakeoffs' && !page?.hasTakeoffs) return null;
                if (filterBy === 'withoutTakeoffs' && page?.hasTakeoffs) return null;
                
                return (
                  <div
                    key={`${result.documentId}-${result.pageNumber}-${index}`}
                    className="p-3 bg-white rounded border cursor-pointer hover:bg-blue-100"
                    onClick={() => onPageSelect(result.documentId, result.pageNumber)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3 h-3 text-blue-600" />
                        <span className="text-sm font-medium">
                          {doc?.name || 'Document'} - Page {result.pageNumber}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {result.matches.length} match{result.matches.length !== 1 ? 'es' : ''}
                        </Badge>
                        {page?.hasTakeoffs && (
                          <Badge variant="secondary" className="text-xs">
                            {page.takeoffCount} takeoffs
                          </Badge>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPageSelect(result.documentId, result.pageNumber);
                        }}
                      >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Go to Page
                      </Button>
                    </div>
                    
                    <div className="space-y-2">
                      {result.matches.slice(0, 2).map((match, matchIndex) => (
                        <div key={matchIndex} className="text-sm text-gray-700 bg-gray-100 p-2 rounded">
                          <span className="bg-yellow-200 px-1 rounded font-medium">
                            {match.text}
                          </span>
                          <span className="text-gray-500 ml-1">
                            {match.context}
                          </span>
                        </div>
                      ))}
                      {result.matches.length > 2 && (
                        <p className="text-xs text-gray-500">
                          +{result.matches.length - 2} more matches on this page
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              {isSearching ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                  Searching...
                </div>
              ) : (
                <>
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No results found for "{searchQuery}"</p>
                  <p className="text-sm">Documents may still be processing. Try again in a moment.</p>
                </>
              )}
            </div>
          )
        ) : (
          <div className="text-center py-8 text-gray-500">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>Search through your documents</p>
            <p className="text-sm">Enter a search term to find text in your PDFs</p>
          </div>
        )}
      </div>
    </div>
  );
}
