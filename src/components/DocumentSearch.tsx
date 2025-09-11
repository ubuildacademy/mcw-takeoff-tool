import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { 
  Search, 
  X, 
  FileText, 
  ArrowRight,
  Loader2,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { ocrService, OCRResult } from '../services/ocrService';

interface SearchResult {
  documentId: string;
  pageNumber: number;
  matches: Array<{
    text: string;
    context: string;
    confidence: number;
  }>;
}

interface DocumentSearchProps {
  projectId: string;
  onPageSelect: (documentId: string, pageNumber: number) => void;
  className?: string;
}

export function DocumentSearch({ projectId, onPageSelect, className = '' }: DocumentSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<Map<string, { current: number; total: number }>>(new Map());
  const [showResults, setShowResults] = useState(false);

  // Listen for OCR progress updates
  useEffect(() => {
    const handleOcrProgress = (event: CustomEvent) => {
      const { documentId, current, total } = event.detail;
      setOcrProgress(prev => new Map(prev).set(documentId, { current, total }));
    };

    window.addEventListener('ocr-progress', handleOcrProgress as EventListener);
    return () => window.removeEventListener('ocr-progress', handleOcrProgress as EventListener);
  }, []);

  // Perform search
  const performSearch = useCallback(async (query: string) => {
    console.log('🔍 performSearch called with:', query);
    console.log('📊 OCR Service state:');
    console.log('- Completed OCR documents:', Array.from(ocrService['completedOCR']?.keys() || []));
    console.log('- Processing queue:', Array.from(ocrService['processingQueue']?.keys() || []));
    
    if (!query.trim() || query.length < 2) {
      console.log('❌ Query too short or empty');
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    console.log('✅ Starting search for:', query);
    setIsSearching(true);
    try {
      // Search across all documents in the project
      const results = ocrService.searchText(query);
      console.log('🎯 Search results:', results);
      setSearchResults(results);
      setShowResults(true);
    } catch (error) {
      console.error('❌ Search error:', error);
      setSearchResults([]);
      setShowResults(true);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Handle search input
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    
    // Debounce search
    const timeoutId = setTimeout(() => {
      performSearch(query);
    }, 300);

    return () => clearTimeout(timeoutId);
  };

  // Handle Enter key press
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    console.log('⌨️ Key pressed:', e.key);
    if (e.key === 'Enter') {
      console.log('🚀 Enter key pressed, searching for:', searchQuery);
      e.preventDefault();
      performSearch(searchQuery);
    }
  };

  // Handle result click
  const handleResultClick = (result: SearchResult) => {
    onPageSelect(result.documentId, result.pageNumber);
    setShowResults(false);
  };

  // Clear search
  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
  };



  // Get OCR status for a document
  const getOcrStatus = (documentId: string) => {
    if (ocrService.isComplete(documentId)) {
      return { status: 'complete', icon: CheckCircle, color: 'text-green-500' };
    } else if (ocrService.isProcessing(documentId)) {
      return { status: 'processing', icon: Loader2, color: 'text-blue-500' };
    } else {
      return { status: 'pending', icon: AlertCircle, color: 'text-gray-400' };
    }
  };

  // Check if any documents are ready for search
  const hasProcessedDocuments = ocrProgress.size > 0 && 
    Array.from(ocrProgress.keys()).some(docId => ocrService.isComplete(docId));

  // Debug: Log OCR service state
  useEffect(() => {
    console.log('📊 OCR Service Debug:');
    console.log('- OCR Progress size:', ocrProgress.size);
    console.log('- OCR Progress keys:', Array.from(ocrProgress.keys()));
    console.log('- Has processed documents:', hasProcessedDocuments);
    
    // Check OCR service internal state
    const completedDocs = Array.from(ocrService['completedOCR']?.keys() || []);
    const processingDocs = Array.from(ocrService['processingQueue']?.keys() || []);
    console.log('- Completed OCR documents:', completedDocs);
    console.log('- Processing queue:', processingDocs);
    
    // Test search functionality
    if (completedDocs.length > 0) {
      console.log('🧪 Testing search with "elevator"...');
      const testResults = ocrService.searchText('elevator');
      console.log('🧪 Test search results:', testResults);
    }
  }, [ocrProgress, hasProcessedDocuments]);

  return (
    <div className={`relative ${className}`}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <Input
          placeholder="Search for text like 'concrete', 'steel', 'electrical'..."
          value={searchQuery}
          onChange={handleSearchChange}
          onKeyPress={handleKeyPress}
          className="pl-10 pr-10"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearSearch}
            className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
          >
            <X className="w-3 h-3" />
          </Button>
        )}
      </div>


      {/* Search Results */}
      {showResults && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          {isSearching ? (
            <div className="p-4 text-center">
              <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" />
              <p className="text-sm text-gray-600">Searching...</p>
            </div>
          ) : searchResults.length > 0 ? (
            <div className="p-2">
              <div className="text-xs text-gray-500 mb-2 px-2">
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
              </div>
              {searchResults.map((result, index) => (
                <div
                  key={`${result.documentId}-${result.pageNumber}-${index}`}
                  className="p-3 hover:bg-gray-50 cursor-pointer border-b last:border-b-0"
                  onClick={() => handleResultClick(result)}
                >
                  <div className="flex items-start gap-3">
                    {/* Page Thumbnail */}
                    <div className="w-12 h-16 bg-gray-100 rounded border flex-shrink-0 flex items-center justify-center">
                      <div className="text-center">
                        <FileText className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                        <span className="text-xs text-gray-400">{result.pageNumber}</span>
                      </div>
                    </div>

                    {/* Result Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            Page {result.pageNumber}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {result.matches.length} match{result.matches.length !== 1 ? 'es' : ''}
                          </Badge>
                        </div>
                        <ArrowRight className="w-4 h-4 text-gray-400" />
                      </div>
                      
                      {/* Match Contexts */}
                      <div className="space-y-1">
                        {result.matches.slice(0, 2).map((match, matchIndex) => (
                          <div key={matchIndex} className="text-sm text-gray-700">
                            <span className="bg-yellow-200 px-1 rounded font-medium">
                              {match.text}
                            </span>
                            <span className="text-gray-500 ml-1">
                              {match.context}
                            </span>
                          </div>
                        ))}
                        {result.matches.length > 2 && (
                          <div className="text-xs text-gray-500">
                            +{result.matches.length - 2} more matches on this page
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : searchQuery.length >= 2 ? (
            <div className="p-4 text-center text-gray-500">
              <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No results found for "{searchQuery}"</p>
              {!hasProcessedDocuments ? (
                <p className="text-xs mt-1">Upload a PDF to start OCR processing</p>
              ) : (
                <p className="text-xs mt-1">Try different keywords or check if OCR is still processing</p>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* OCR Status Indicator */}
      {ocrProgress.size > 0 && (
        <div className="mt-2 space-y-1">
          {Array.from(ocrProgress.entries()).map(([documentId, progress]) => {
            const status = getOcrStatus(documentId);
            const Icon = status.icon;
            
            return (
              <div key={documentId} className="flex items-center gap-2 text-xs">
                <Icon className={`w-3 h-3 ${status.color} ${status.status === 'processing' ? 'animate-spin' : ''}`} />
                <span className="text-gray-600">
                  OCR: {progress.current}/{progress.total} pages
                </span>
                <div className="flex-1 bg-gray-200 rounded-full h-1">
                  <div
                    className="bg-blue-600 h-1 rounded-full transition-all duration-300"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
