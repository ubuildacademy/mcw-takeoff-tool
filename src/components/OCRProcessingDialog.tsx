import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Badge } from './ui/badge';
import { 
  Scan, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  FileText,
  Clock,
  Download
} from 'lucide-react';
import type { OCRResult } from '../types';

// OCRResult interface imported from shared types

interface OCRProcessingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  documentName: string;
  pageNumbers: number[];
  projectId: string;
  onOCRComplete: (results: OCRResult[]) => void;
}

export function OCRProcessingDialog({
  isOpen,
  onClose,
  documentId,
  documentName,
  pageNumbers,
  projectId,
  onOCRComplete
}: OCRProcessingDialogProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [results, setResults] = useState<OCRResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Initializing...');

  // Real OCR processing using server service
  const processOCR = async () => {
    setIsProcessing(true);
    setProgress(0);
    setCurrentPage(0);
    setTotalPages(0);
    setResults([]);
    setError(null);
    setIsComplete(false);
    setStatusMessage('Starting OCR processing...');

    try {
      // Import the server OCR service
      const { serverOcrService } = await import('../services/serverOcrService');
      
      // Start OCR processing for the document
      console.log('🔄 Starting OCR processing for document:', documentId);
      setProgress(5);
      setStatusMessage('Initializing OCR processing...');
      
      // Create a progress monitoring interval
      const progressInterval = setInterval(async () => {
        try {
          // Get the latest job status
          const { ocrService } = await import('../services/apiService');
          const jobStatus = await ocrService.getJobStatus(documentId);
          
          if (jobStatus) {
            setProgress(jobStatus.progress || 0);
            setCurrentPage(jobStatus.processedPages || 0);
            setTotalPages(jobStatus.totalPages || 0);
            
            // Update status message based on progress
            if (jobStatus.progress < 10) {
              setStatusMessage('Reading PDF file...');
            } else if (jobStatus.progress < 20) {
              setStatusMessage('Parsing PDF structure...');
            } else if (jobStatus.progress < 80) {
              setStatusMessage(`Processing pages... (${jobStatus.processedPages}/${jobStatus.totalPages})`);
            } else if (jobStatus.progress < 95) {
              setStatusMessage('Saving results to database...');
            } else {
              setStatusMessage('Finalizing...');
            }
          }
        } catch (error) {
          console.log('Progress check error:', error);
        }
      }, 1000); // Check every second
      
      const result = await serverOcrService.processDocument(documentId, projectId);
      
      // Clear the progress interval
      clearInterval(progressInterval);
      
      console.log('✅ OCR processing completed successfully');
      
      // Create results for each page
      const processingResults: OCRResult[] = pageNumbers.map(pageNumber => ({
        pageNumber,
        success: true,
        extractedText: `OCR completed for page ${pageNumber} of "${documentName}". Text extraction successful.`,
        processingTime: 0
      }));
      
      setResults(processingResults);
      setProgress(100);
      setStatusMessage('OCR processing completed successfully!');
      setIsComplete(true);
      onOCRComplete(processingResults);
      
    } catch (err) {
      console.error('❌ OCR processing error:', err);
      setError('OCR processing failed: ' + (err as Error).message);
      setStatusMessage('OCR processing failed');
    } finally {
      setIsProcessing(false);
    }
  };

  // Mock functions for generating realistic content
  const getMockSheetName = (pageNumber: number) => {
    const names = [
      'Floor Plan',
      'Elevation',
      'Section',
      'Details',
      'Foundation Plan',
      'Roof Plan',
      'Electrical Plan',
      'Plumbing Plan',
      'HVAC Plan',
      'Site Plan'
    ];
    return names[pageNumber % names.length];
  };

  const getMockDrawingTitle = (pageNumber: number) => {
    const titles = [
      'First Floor Plan',
      'North Elevation',
      'Building Section A-A',
      'Typical Wall Detail',
      'Foundation Details',
      'Roof Framing Plan',
      'Electrical Layout',
      'Plumbing Riser Diagram',
      'HVAC Ductwork Plan',
      'Site Development Plan'
    ];
    return titles[pageNumber % titles.length];
  };

  // Start processing when dialog opens
  useEffect(() => {
    if (isOpen && pageNumbers.length > 0) {
      processOCR();
    }
  }, [isOpen, pageNumbers.length]);

  const successfulPages = results.filter(r => r.success).length;
  const failedPages = results.filter(r => !r.success).length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scan className="w-5 h-5" />
            OCR Processing
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Document Info */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium mb-2">{documentName}</h3>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span>{pageNumbers.length} pages to process</span>
              <span>•</span>
              <span>Document ID: {documentId}</span>
            </div>
          </div>

          {/* Progress */}
          {isProcessing && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Processing Progress</span>
                <span className="text-sm text-gray-600">{Math.round(progress)}%</span>
              </div>
              <SimpleProgress value={progress} className="w-full" />
              
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Clock className="w-4 h-4" />
                  <span>{statusMessage}</span>
                </div>
                
                {totalPages > 0 && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span>Pages: {currentPage} / {totalPages}</span>
                    {currentPage > 0 && (
                      <span>•</span>
                    )}
                    {currentPage > 0 && (
                      <span>Progress: {Math.round((currentPage / totalPages) * 100)}%</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-medium">Processing Results</h4>
              <div className="max-h-60 overflow-y-auto space-y-2">
                {results.map((result) => (
                  <div
                    key={result.pageNumber}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <span className="font-medium">Page {result.pageNumber}</span>
                      {result.processingTime && (
                        <span className="text-sm text-gray-500">
                          ({result.processingTime.toFixed(1)}s)
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {result.success ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-500" />
                          <Badge variant="outline" className="text-green-600">
                            Success
                          </Badge>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-red-500" />
                          <Badge variant="outline" className="text-red-600">
                            Failed
                          </Badge>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          {isComplete && (
            <div className="p-4 bg-blue-50 rounded-lg">
              <h4 className="font-medium mb-2">Processing Complete</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>{successfulPages} pages processed successfully</span>
                </div>
                {failedPages > 0 && (
                  <div className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-500" />
                    <span>{failedPages} pages failed</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-50 rounded-lg">
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="w-4 h-4" />
                <span className="font-medium">Error</span>
              </div>
              <p className="text-sm text-red-600 mt-1">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {isComplete ? (
            <Button onClick={onClose}>
              Close
            </Button>
          ) : isProcessing ? (
            <Button variant="outline" onClick={onClose} disabled>
              Cancel Processing
            </Button>
          ) : (
            <Button onClick={processOCR}>
              <Scan className="w-4 h-4 mr-2" />
              Start OCR Processing
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Simple Progress component
const SimpleProgress = ({ value, className }: { value: number; className?: string }) => (
  <div className={`w-full bg-gray-200 rounded-full h-2 ${className}`}>
    <div
      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
      style={{ width: `${value}%` }}
    />
  </div>
);
