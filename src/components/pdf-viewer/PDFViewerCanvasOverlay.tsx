import React, { useRef, useCallback, type RefObject } from 'react';
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
  // ── Existing mouse handlers (desktop) ────────────────────────────────────
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
  onSvgContextMenu?: (event: React.MouseEvent<SVGSVGElement>) => void;
  isPDFLoading: boolean;
  textAnnotation: PDFViewerCanvasOverlayTextAnnotationProps | null;
  // ── Touch / pointer gesture props (iPad / Apple Pencil support) ───────────
  /**
   * True when any active drawing mode is engaged (measuring, calibrating,
   * annotating). In this state single-finger touch acts as a drawing pointer
   * rather than a pan gesture.
   */
  isMeasuringOrDrawing?: boolean;
  /**
   * Called with (dx, dy) CSS-pixel deltas when a single-finger pan is
   * performed in idle mode. The parent should scroll its scroll container.
   */
  onTouchPan?: (dx: number, dy: number) => void;
  /**
   * Called with an incremental scale factor and the viewport-relative midpoint
   * of the pinch. The parent applies this to its zoom state each frame.
   */
  onTouchPinch?: (factor: number, anchorClientX: number, anchorClientY: number) => void;
}

// ── Stable style objects ──────────────────────────────────────────────────

const canvasBlockStyles: React.CSSProperties = {
  display: 'block',
  position: 'relative',
  zIndex: 1,
  margin: 0,
  padding: 0,
  border: 'none',
  outline: 'none',
  // Prevent browser from intercepting touch gestures so we handle them in JS.
  // Also removes the 300 ms double-tap delay on iOS Safari.
  touchAction: 'none',
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
  touchAction: 'none',
};

// ── Helper: distance between two tracked points ───────────────────────────

function ptDist(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ptMid(pts: Map<number, { x: number; y: number }>): { x: number; y: number } {
  const [p1, p2] = [...pts.values()];
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

// ── Canvas drag threshold: if touch moves < this px it's considered a tap ─

const TAP_MOVE_THRESHOLD_PX = 8;
const DOUBLE_TAP_MAX_MS = 350;
const DOUBLE_TAP_MAX_DIST_PX = 30;
const LONG_PRESS_MS = 500;

/**
 * Canvas + SVG overlay layer for PDFViewer. Renders the PDF canvas, the SVG
 * overlay for markups, loading indicator, and optional text annotation input.
 *
 * On desktop, all interaction is driven by mouse events passed in as props.
 * On touch devices (iPad, Apple Pencil), Pointer Events are handled internally:
 *   - Single-finger in idle mode → pan via `onTouchPan`
 *   - Single-finger in drawing mode → forwards to existing mouse handlers
 *   - Two-finger pinch → zoom via `onTouchPinch`
 * Mouse events are still attached and handle desktop interactions unchanged.
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
  onSvgContextMenu,
  isPDFLoading,
  textAnnotation,
  isMeasuringOrDrawing = false,
  onTouchPan,
  onTouchPinch,
}) => {
  // ── Touch gesture state ─────────────────────────────────────────────────
  // Map from pointerId → last known position (for all active touch pointers)
  const touchPtrs = useRef(new Map<number, { x: number; y: number }>());

  // Pinch state: captured when a 2nd touch pointer goes down
  const pinchBase = useRef<{ dist: number } | null>(null);

  // Single-touch bookkeeping
  const tapDown = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null);
  const hasDragged = useRef(false);
  // True if a pinch was active during this touch sequence (suppresses tap events on lift)
  const wasInPinch = useRef(false);

  // Long-press detection: fires onSvgContextMenu after LONG_PRESS_MS if the finger hasn't moved
  const longPressTimerId = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPos = useRef<{ x: number; y: number } | null>(null);

  // ── Shared pointer handlers (used by both canvas and SVG) ───────────────

  const onTouchPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement | SVGSVGElement>) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;

      // Prevent synthesised mouse events so handlers don't fire twice.
      e.preventDefault();

      const pt = { x: e.clientX, y: e.clientY };
      touchPtrs.current.set(e.pointerId, pt);

      // Capture pointer so pointermove/up fire even when finger leaves the element.
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw on some SVG implementations — ignore
      }

      if (touchPtrs.current.size >= 2) {
        // Second (or later) finger → enter pinch mode
        const [p1, p2] = [...touchPtrs.current.values()];
        pinchBase.current = { dist: ptDist(p1, p2) };
        wasInPinch.current = true;
        // Cancel any in-progress single-touch drawing
        onCanvasMouseLeave();
        return;
      }

      // Single touch
      hasDragged.current = false;
      wasInPinch.current = false;
      tapDown.current = { x: e.clientX, y: e.clientY, t: Date.now() };

      // Start long-press timer so a sustained press opens the context menu.
      // Only arm when the SVG is interactive (svgPointerEvents='auto') so
      // accidental long-presses on the bare canvas don't trigger it.
      if (longPressTimerId.current) clearTimeout(longPressTimerId.current);
      longPressPos.current = { x: e.clientX, y: e.clientY };
      if (onSvgContextMenu && e.currentTarget instanceof SVGSVGElement) {
        longPressTimerId.current = setTimeout(() => {
          longPressTimerId.current = null;
          if (hasDragged.current || wasInPinch.current) return;
          const pos = longPressPos.current;
          if (!pos) return;
          const el = document.elementFromPoint(pos.x, pos.y);
          const synth = {
            target: el,
            currentTarget: svgOverlayRef.current,
            clientX: pos.x,
            clientY: pos.y,
            preventDefault: () => {},
            stopPropagation: () => {},
          } as unknown as React.MouseEvent<SVGSVGElement>;
          onSvgContextMenu(synth);
        }, LONG_PRESS_MS);
      }

      if (isMeasuringOrDrawing) {
        // Forward to the unified mouse handler (handleMouseDown in the hook).
        // PointerEvent extends MouseEvent, so the cast is safe: all properties
        // used by the handler (clientX/Y, button, target, preventDefault, …)
        // are available on PointerEvent.
        onCanvasMouseDown(e as unknown as React.MouseEvent<HTMLCanvasElement>);
      }
    },
    [isMeasuringOrDrawing, onCanvasMouseDown, onCanvasMouseLeave, onSvgContextMenu, svgOverlayRef]
  );

  const onTouchPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement | SVGSVGElement>) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      e.preventDefault();

      const prev = touchPtrs.current.get(e.pointerId);
      touchPtrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // ── Two-finger pinch ───────────────────────────────────────────────
      if (touchPtrs.current.size >= 2 && pinchBase.current) {
        const [p1, p2] = [...touchPtrs.current.values()];
        const currentDist = ptDist(p1, p2);
        const factor = currentDist / pinchBase.current.dist;
        const mid = ptMid(touchPtrs.current);
        onTouchPinch?.(factor, mid.x, mid.y);
        // Update base so each frame delivers an incremental factor near 1.0
        pinchBase.current = { dist: currentDist };
        return;
      }

      // ── Single-touch ───────────────────────────────────────────────────
      if (touchPtrs.current.size === 1 && prev) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;

        const down = tapDown.current;
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_MOVE_THRESHOLD_PX) {
          hasDragged.current = true;
          // Movement past threshold cancels any pending long-press.
          if (longPressTimerId.current) {
            clearTimeout(longPressTimerId.current);
            longPressTimerId.current = null;
          }
        }

        if (isMeasuringOrDrawing && !wasInPinch.current) {
          onCanvasMouseMove(e as unknown as React.MouseEvent<HTMLCanvasElement>);
        } else if (!isMeasuringOrDrawing) {
          onTouchPan?.(dx, dy);
        }
      }
    },
    [isMeasuringOrDrawing, onCanvasMouseMove, onTouchPan, onTouchPinch]
  );

  const onTouchPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement | SVGSVGElement>) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      e.preventDefault();

      // Cancel long-press on lift so it doesn't fire after a normal tap.
      if (longPressTimerId.current) {
        clearTimeout(longPressTimerId.current);
        longPressTimerId.current = null;
      }

      touchPtrs.current.delete(e.pointerId);

      if (touchPtrs.current.size < 2) {
        pinchBase.current = null;
      }

      // Still more active pointers — don't fire up/click yet
      if (touchPtrs.current.size > 0) return;

      // All pointers lifted — finalise the gesture
      if (wasInPinch.current) {
        wasInPinch.current = false;
        hasDragged.current = false;
        tapDown.current = null;
        return;
      }

      if (isMeasuringOrDrawing) {
        // Complete any drag operations (move, rect-draw, etc.)
        void onCanvasMouseUp(e as unknown as React.MouseEvent<HTMLCanvasElement>);

        if (!hasDragged.current) {
          // It was a tap → fire click AND double-click detection.
          // We route to the SVG click handler when the SVG is the active target
          // (svgPointerEvents = 'auto') because handleSvgClick carries markup-
          // selection logic. Otherwise use the canvas click handler.
          const fromSvg = e.currentTarget instanceof SVGSVGElement;
          if (fromSvg) {
            void onSvgClick(e as unknown as React.MouseEvent<SVGSVGElement>);
          } else {
            void onCanvasClick(e as unknown as React.MouseEvent<HTMLCanvasElement>);
          }

          // Double-tap detection
          const now = Date.now();
          const lt = lastTap.current;
          const cur = tapDown.current;
          if (
            lt &&
            cur &&
            now - lt.t < DOUBLE_TAP_MAX_MS &&
            Math.hypot(cur.x - lt.x, cur.y - lt.y) < DOUBLE_TAP_MAX_DIST_PX
          ) {
            if (fromSvg) {
              onSvgDoubleClick(e as unknown as React.MouseEvent<SVGSVGElement>);
            } else {
              onCanvasDoubleClick(e as unknown as React.MouseEvent<HTMLCanvasElement>);
            }
            lastTap.current = null;
          } else {
            lastTap.current = cur;
          }
        }
      }

      hasDragged.current = false;
      tapDown.current = null;
    },
    [
      isMeasuringOrDrawing,
      onCanvasMouseUp,
      onCanvasClick,
      onSvgClick,
      onCanvasDoubleClick,
      onSvgDoubleClick,
    ]
  );

  const onTouchPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement | SVGSVGElement>) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (longPressTimerId.current) {
        clearTimeout(longPressTimerId.current);
        longPressTimerId.current = null;
      }
      touchPtrs.current.delete(e.pointerId);
      if (touchPtrs.current.size < 2) pinchBase.current = null;
      if (touchPtrs.current.size === 0) {
        hasDragged.current = false;
        tapDown.current = null;
        wasInPinch.current = false;
      }
    },
    []
  );

  return (
    <div
      className="relative inline-block"
      style={{ margin: 0, padding: 0, border: 'none', outline: 'none' }}
    >
      <canvas
        ref={pdfCanvasRef as RefObject<HTMLCanvasElement>}
        className="shadow-lg"
        style={{ ...canvasBlockStyles, cursor }}
        // Mouse events — unchanged desktop path
        onClick={onCanvasClick}
        onMouseDown={onCanvasMouseDown}
        onMouseUp={onCanvasMouseUp}
        onDoubleClick={onCanvasDoubleClick}
        onMouseMove={onCanvasMouseMove}
        onMouseLeave={onCanvasMouseLeave}
        // Pointer events — touch / Apple Pencil path
        // preventDefault() in onTouchPointerDown suppresses synthetic mouse
        // events for touch, so these handlers do not fire twice.
        onPointerDown={onTouchPointerDown}
        onPointerMove={onTouchPointerMove}
        onPointerUp={onTouchPointerUp}
        onPointerCancel={onTouchPointerCancel}
      />
      <svg
        key={overlayKey}
        ref={svgOverlayRef as RefObject<SVGSVGElement>}
        id={`overlay-page-${currentPage}`}
        className="shadow-lg"
        style={{ ...svgBlockStyles, cursor, pointerEvents: svgPointerEvents }}
        // Mouse events — unchanged desktop path
        onMouseMove={onSvgMouseMove}
        onMouseDown={onSvgMouseDown}
        onMouseUp={onSvgMouseUp}
        onMouseLeave={onSvgMouseLeave}
        onClick={onSvgClick}
        onContextMenu={onSvgContextMenu}
        onDoubleClick={onSvgDoubleClick}
        // Pointer events — touch / Apple Pencil path
        onPointerDown={onTouchPointerDown}
        onPointerMove={onTouchPointerMove}
        onPointerUp={onTouchPointerUp}
        onPointerCancel={onTouchPointerCancel}
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
