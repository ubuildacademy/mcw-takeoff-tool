import React, { type RefObject } from 'react';
import { PDFViewerLoadingIndicator } from './PDFViewerLoadingIndicator';
import { PDFViewerTextAnnotationInput } from './PDFViewerTextAnnotationInput';

export interface PDFViewerCanvasOverlayTextAnnotationProps {
  show: boolean;
  position: { x: number; y: number } | null;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export interface PDFViewerCanvasOverlayProps {
  pdfCanvasRef: RefObject<HTMLCanvasElement | null>;
  svgOverlayRef: RefObject<SVGSVGElement | null>;
  overlayKey: string;
  currentPage: number;
  cursor: string;
  svgPointerEvents: 'auto' | 'none';
  onCanvasClick: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onCanvasMouseDown: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onCanvasMouseUp: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onCanvasDoubleClick: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onCanvasMouseMove: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onCanvasMouseLeave: () => void;
  onSvgMouseMove: (event: React.MouseEvent<SVGSVGElement>) => void;
  onSvgMouseDown: (event: React.MouseEvent<SVGSVGElement>) => void;
  onSvgMouseUp: (event: React.MouseEvent<SVGSVGElement>) => void;
  onSvgMouseLeave: () => void;
  onSvgClick: (event: React.MouseEvent<SVGSVGElement>) => void;
  onSvgDoubleClick: (event: React.MouseEvent<SVGSVGElement>) => void;
  isPDFLoading: boolean;
  textAnnotation: PDFViewerCanvasOverlayTextAnnotationProps | null;
}

const canvasBlockStyles: React.CSSProperties = {
  display: 'block',
  position: 'relative',
  zIndex: 1,
  margin: 0,
  padding: 0,
  border: 'none',
  outline: 'none',
};

const svgBlockStyles: React.CSSProperties = {
  display: 'block',
  position: 'absolute',
  top: 0,
  left: 0,
  zIndex: 2,
  margin: 0,
  padding: 0,
  border: 'none',
  outline: 'none',
};

/**
 * Canvas + SVG overlay layer for PDFViewer. Renders the PDF canvas, the SVG
 * overlay for markups, loading indicator, and optional text annotation input.
 * Event handlers and refs are passed from PDFViewer.
 */
export const PDFViewerCanvasOverlay: React.FC<PDFViewerCanvasOverlayProps> = ({
  pdfCanvasRef,
  svgOverlayRef,
  overlayKey,
  currentPage,
  cursor,
  svgPointerEvents,
  onCanvasClick,
  onCanvasMouseDown,
  onCanvasMouseUp,
  onCanvasDoubleClick,
  onCanvasMouseMove,
  onCanvasMouseLeave,
  onSvgMouseMove,
  onSvgMouseDown,
  onSvgMouseUp,
  onSvgMouseLeave,
  onSvgClick,
  onSvgDoubleClick,
  isPDFLoading,
  textAnnotation,
}) => {
  return (
    <div
      className="relative inline-block"
      style={{
        margin: 0,
        padding: 0,
        border: 'none',
        outline: 'none',
      }}
    >
      <canvas
        ref={pdfCanvasRef as RefObject<HTMLCanvasElement>}
        className="shadow-lg"
        style={{ ...canvasBlockStyles, cursor }}
        onClick={onCanvasClick}
        onMouseDown={onCanvasMouseDown}
        onMouseUp={onCanvasMouseUp}
        onDoubleClick={onCanvasDoubleClick}
        onMouseMove={onCanvasMouseMove}
        onMouseLeave={onCanvasMouseLeave}
      />
      <svg
        key={overlayKey}
        ref={svgOverlayRef as RefObject<SVGSVGElement>}
        id={`overlay-page-${currentPage}`}
        className="shadow-lg"
        style={{ ...svgBlockStyles, cursor, pointerEvents: svgPointerEvents }}
        onMouseMove={onSvgMouseMove}
        onMouseDown={onSvgMouseDown}
        onMouseUp={onSvgMouseUp}
        onMouseLeave={onSvgMouseLeave}
        onClick={onSvgClick}
        onContextMenu={() => {}}
        onDoubleClick={onSvgDoubleClick}
      />
      <PDFViewerLoadingIndicator show={isPDFLoading} />
      {textAnnotation && (
        <PDFViewerTextAnnotationInput
          show={textAnnotation.show}
          position={textAnnotation.position}
          value={textAnnotation.value}
          onChange={textAnnotation.onChange}
          onSave={textAnnotation.onSave}
          onCancel={textAnnotation.onCancel}
        />
      )}
    </div>
  );
};
