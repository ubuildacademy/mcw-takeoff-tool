import React from 'react';

export interface PDFViewerTextAnnotationInputProps {
  show: boolean;
  position: { x: number; y: number } | null;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Positioned text input for adding text annotations on the PDF.
 * Used inside PDFViewerCanvasOverlay.
 */
export const PDFViewerTextAnnotationInput: React.FC<PDFViewerTextAnnotationInputProps> = ({
  show,
  position,
  value,
  onChange,
  onSave,
  onCancel,
  onKeyDown,
  placeholder = 'Enter text...',
  className = '',
}) => {
  if (!show || !position) return null;
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSave();
    } else if (e.key === 'Escape') {
      onCancel();
    }
    onKeyDown?.(e);
  };
  return (
    <div
      style={{
        position: 'absolute',
        left: position.x + 'px',
        top: position.y + 'px',
        zIndex: 1000,
        pointerEvents: 'auto',
      }}
    >
      <input
        type="text"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className={`border-2 border-blue-500 rounded px-2 py-1 text-sm shadow-lg bg-white ${className}`.trim()}
        placeholder={placeholder}
        style={{
          minWidth: '120px',
          fontSize: '14px',
          fontFamily: 'Arial, sans-serif',
        }}
      />
    </div>
  );
};
