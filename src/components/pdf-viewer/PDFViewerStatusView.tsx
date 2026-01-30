import React from 'react';

export type PDFViewerStatus = 'loading' | 'error' | 'no-document';

export interface PDFViewerStatusViewProps {
  status: PDFViewerStatus;
  className?: string;
  /** Shown for error (error message) or no-document (file label) */
  message?: string;
  /** Optional file label for no-document state */
  fileLabel?: string;
}

/**
 * Renders loading, error, or no-document state for PDFViewer.
 * Used for early returns before the main canvas/overlay.
 */
export const PDFViewerStatusView: React.FC<PDFViewerStatusViewProps> = ({
  status,
  className = '',
  message,
  fileLabel,
}) => {
  if (status === 'loading') {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center text-red-600">
          <p className="text-lg font-semibold mb-2">Error Loading PDF</p>
          <p className="text-sm">{message ?? 'An error occurred'}</p>
        </div>
      </div>
    );
  }

  // no-document
  return (
    <div className={`flex items-center justify-center h-full ${className}`}>
      <div className="text-center">
        <p className="text-gray-600 mb-2">No PDF loaded</p>
        <p className="text-sm text-gray-500">File: {fileLabel ?? message ?? 'Unknown'}</p>
      </div>
    </div>
  );
};
