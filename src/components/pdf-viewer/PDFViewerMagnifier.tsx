import React, { useRef, useEffect, type RefObject } from 'react';

export interface PDFViewerMagnifierProps {
  /** Source canvas to sample from */
  pdfCanvasRef: RefObject<HTMLCanvasElement | null>;
  /** Mouse position in normalized 0-1 coordinates (relative to PDF viewport) */
  mousePosition: { x: number; y: number } | null;
  /** Whether magnifier is enabled in user preferences */
  magnifierEnabled: boolean;
  /** Zoom level (2, 3, or 4x) */
  magnifierZoom: 2 | 3 | 4;
  /** Whether to show (during measuring, calibrating, or annotating) */
  isActive: boolean;
}

const MAGNIFIER_SIZE = 120;
/** Crosshair center in magnifier canvas (accounting for 2px border) */
const CROSSHAIR_CX = 2 + MAGNIFIER_SIZE / 2;
const CROSSHAIR_CY = 2 + MAGNIFIER_SIZE / 2;

/**
 * Magnifier overlay: shows a zoomed region of the PDF canvas near the cursor
 * for precise point placement during drawing/measuring/annotating.
 */
export function PDFViewerMagnifier({
  pdfCanvasRef,
  mousePosition,
  magnifierEnabled,
  magnifierZoom,
  isActive,
}: PDFViewerMagnifierProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const show = magnifierEnabled && isActive && mousePosition !== null;

  useEffect(() => {
    if (!show || !pdfCanvasRef.current || !canvasRef.current) return;

    const sourceCanvas = pdfCanvasRef.current;
    const destCanvas = canvasRef.current;
    const ctx = destCanvas.getContext('2d');
    if (!ctx) return;

    // Source canvas dimensions (may differ from CSS size due to devicePixelRatio)
    const sw = sourceCanvas.width;
    const sh = sourceCanvas.height;
    const dpr = window.devicePixelRatio || 1;

    // Source radius: chosen so that the magnifier shows true Nx magnification vs the main view.
    // Main view displays 1 canvas px = 1/dpr display px. We show 2*sourceRadius canvas px
    // in MAGNIFIER_SIZE display px. For magnifierZoom x: MAGNIFIER_SIZE / (2*sourceRadius/dpr) = magnifierZoom
    // => sourceRadius = MAGNIFIER_SIZE * dpr / (2 * magnifierZoom)
    let sourceRadius = (MAGNIFIER_SIZE * dpr) / (2 * magnifierZoom);
    sourceRadius = Math.max(10, Math.min(sourceRadius, Math.min(sw, sh) / 2 - 1));

    // Center of region to sample: mousePosition is 0-1 normalized to viewport; canvas is proportional
    const centerX = mousePosition.x * sw;
    const centerY = mousePosition.y * sh;

    // Bounds of source region (clip to canvas)
    const srcX = Math.max(0, centerX - sourceRadius);
    const srcY = Math.max(0, centerY - sourceRadius);
    const srcW = Math.min(sourceRadius * 2, sw - srcX);
    const srcH = Math.min(sourceRadius * 2, sh - srcY);

    if (srcW <= 0 || srcH <= 0) return;

    // Scale the sampled region to fill the magnifier (maintain aspect ratio)
    const scale = MAGNIFIER_SIZE / Math.min(srcW, srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;

    // Center the drawn content on the crosshair so crosshairs align with cursor position
    const offsetX = CROSSHAIR_CX - drawW / 2;
    const offsetY = CROSSHAIR_CY - drawH / 2;

    ctx.save();
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, MAGNIFIER_SIZE + 4, MAGNIFIER_SIZE + 4);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, MAGNIFIER_SIZE + 2, MAGNIFIER_SIZE + 2);

    ctx.drawImage(
      sourceCanvas,
      srcX, srcY, srcW, srcH,
      offsetX, offsetY, drawW, drawH
    );

    // Crosshair at center (aligned with sampled region center)
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CROSSHAIR_CX - 8, CROSSHAIR_CY);
    ctx.lineTo(CROSSHAIR_CX + 8, CROSSHAIR_CY);
    ctx.moveTo(CROSSHAIR_CX, CROSSHAIR_CY - 8);
    ctx.lineTo(CROSSHAIR_CX, CROSSHAIR_CY + 8);
    ctx.stroke();

    ctx.restore();
  }, [show, mousePosition, magnifierZoom, pdfCanvasRef]);

  if (!show) return null;

  return (
    <div
      className="absolute bottom-4 right-4 z-50 rounded border-2 border-slate-400 bg-slate-800 shadow-lg pointer-events-none"
      style={{ width: MAGNIFIER_SIZE + 4, height: MAGNIFIER_SIZE + 4 }}
      aria-hidden
    >
      <canvas
        ref={canvasRef}
        width={MAGNIFIER_SIZE + 4}
        height={MAGNIFIER_SIZE + 4}
        className="block rounded"
      />
      <div className="absolute -top-5 left-0 text-xs text-slate-400">
        {magnifierZoom}×
      </div>
    </div>
  );
}
