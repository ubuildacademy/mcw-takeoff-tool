import React, { useRef, useEffect, type RefObject } from 'react';
import { baseNormToViewportPixels } from '../../utils/measurementGeometry';

export interface PDFViewerMagnifierProps {
  /** Source canvas to sample from */
  pdfCanvasRef: RefObject<HTMLCanvasElement | null>;
  /** Base-normalized cursor (unrotated PDF 0–1); read each frame from ref so parent need not re-render on mousemove */
  mousePositionRef: RefObject<{ x: number; y: number } | null>;
  /** Logical viewport (must match canvas layout); used to map base-normalized coords to bitmap pixels when rotated */
  pdfViewport: { width: number; height: number; rotation?: number } | null;
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
  mousePositionRef,
  pdfViewport,
  magnifierEnabled,
  magnifierZoom,
  isActive,
}: PDFViewerMagnifierProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const show = magnifierEnabled && isActive;

  useEffect(() => {
    if (!show || !pdfCanvasRef.current || !canvasRef.current) return;

    let raf = 0;
    let idleTimeout = 0;
    let cancelled = false;
    let lastHadMouse = false;

    const paintIdleFrame = () => {
      const destCanvas = canvasRef.current;
      if (!destCanvas) return;
      const ctx = destCanvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, MAGNIFIER_SIZE + 4, MAGNIFIER_SIZE + 4);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, MAGNIFIER_SIZE + 2, MAGNIFIER_SIZE + 2);
    };

    const scheduleWhenIdle = () => {
      idleTimeout = window.setTimeout(() => {
        idleTimeout = 0;
        raf = requestAnimationFrame(draw);
      }, 200);
    };

    const draw = () => {
      if (cancelled) return;
      const mousePosition = mousePositionRef.current;
      const sourceCanvas = pdfCanvasRef.current;
      const destCanvas = canvasRef.current;
      if (!sourceCanvas || !destCanvas) {
        scheduleWhenIdle();
        return;
      }

      if (!mousePosition) {
        if (lastHadMouse) {
          lastHadMouse = false;
          paintIdleFrame();
        }
        scheduleWhenIdle();
        return;
      }

      lastHadMouse = true;

      const ctx = destCanvas.getContext('2d');
      if (!ctx) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const sw = sourceCanvas.width;
      const sh = sourceCanvas.height;
      const dpr = window.devicePixelRatio || 1;

      let sourceRadius = (MAGNIFIER_SIZE * dpr) / (2 * magnifierZoom);
      sourceRadius = Math.max(10, Math.min(sourceRadius, Math.min(sw, sh) / 2 - 1));

      let centerX: number;
      let centerY: number;
      if (pdfViewport && pdfViewport.width > 0 && pdfViewport.height > 0) {
        const rotation = pdfViewport.rotation ?? 0;
        const logical = baseNormToViewportPixels(
          mousePosition.x,
          mousePosition.y,
          { width: pdfViewport.width, height: pdfViewport.height },
          rotation
        );
        centerX = logical.x * (sw / pdfViewport.width);
        centerY = logical.y * (sh / pdfViewport.height);
      } else {
        centerX = mousePosition.x * sw;
        centerY = mousePosition.y * sh;
      }

      const srcX = Math.max(0, centerX - sourceRadius);
      const srcY = Math.max(0, centerY - sourceRadius);
      const srcW = Math.min(sourceRadius * 2, sw - srcX);
      const srcH = Math.min(sourceRadius * 2, sh - srcY);

      if (srcW > 0 && srcH > 0) {
        const scale = MAGNIFIER_SIZE / Math.min(srcW, srcH);
        const drawW = srcW * scale;
        const drawH = srcH * scale;
        const offsetX = CROSSHAIR_CX - drawW / 2;
        const offsetY = CROSSHAIR_CY - drawH / 2;

        ctx.save();
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, MAGNIFIER_SIZE + 4, MAGNIFIER_SIZE + 4);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, MAGNIFIER_SIZE + 2, MAGNIFIER_SIZE + 2);

        ctx.drawImage(sourceCanvas, srcX, srcY, srcW, srcH, offsetX, offsetY, drawW, drawH);

        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(CROSSHAIR_CX - 8, CROSSHAIR_CY);
        ctx.lineTo(CROSSHAIR_CX + 8, CROSSHAIR_CY);
        ctx.moveTo(CROSSHAIR_CX, CROSSHAIR_CY - 8);
        ctx.lineTo(CROSSHAIR_CX, CROSSHAIR_CY + 8);
        ctx.stroke();
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };

    paintIdleFrame();
    raf = requestAnimationFrame(draw);
    return () => {
      cancelled = true;
      clearTimeout(idleTimeout);
      cancelAnimationFrame(raf);
    };
  }, [show, magnifierZoom, pdfCanvasRef, mousePositionRef, pdfViewport]);

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
