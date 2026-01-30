import React from 'react';

export interface PDFViewerLoadingIndicatorProps {
  show: boolean;
}

/**
 * Full-overlay loading spinner shown while a PDF page is loading.
 * Used inside PDFViewerCanvasOverlay.
 */
export const PDFViewerLoadingIndicator: React.FC<PDFViewerLoadingIndicatorProps> = ({ show }) => {
  if (!show) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 1000,
        background: 'rgba(255, 255, 255, 0.9)',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          border: '3px solid #f3f3f3',
          borderTop: '3px solid #3498db',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }}
      />
      <div style={{ fontSize: '14px', color: '#666', fontWeight: '500' }}>
        Loading PDF...
      </div>
    </div>
  );
};
