/**
 * Vertex edit mode for takeoff markups.
 *
 * Entered explicitly (context menu "Edit vertices"), never implicitly — the
 * beta team's safeguard against accidentally reshaping a takeoff. While
 * active, renderVertexEditHandles draws square vertex handles and round
 * segment-midpoint handles for one measurement:
 *   - drag a square = move that vertex,
 *   - drag a round handle off its chord = bow the segment into a circular arc
 *     (drag back near the chord = snap straight).
 *
 * Drags patch the measurement's SVG elements directly (cheap DOM writes,
 * rAF-throttled); the store — and therefore quantities — updates once on
 * pointerup with recalculated length/area/perimeter including arc curvature.
 * Esc or clicking away exits.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import { useConditionStore } from '../../store/slices/conditionSlice';
import { useUndoStore } from '../../store/slices/undoSlice';
import {
  arcApexPoint,
  bulgeFromDragPoint,
  expandNormalizedPointsWithArcs,
  expandPolylineWithArcs,
  withSegmentBulge,
  type ArcSegment,
  type XY,
} from '../../utils/arcGeometry';
import {
  baseNormToViewportPixels,
  cssToBaseNormalized,
} from '../../utils/measurementGeometry';
import { MeasurementCalculator, type ScaleInfo } from '../../utils/measurementCalculation';
import { VERTEX_EDIT_LAYER_CLASS } from './pdfViewerRenderers';
import type { TakeoffMeasurement } from '../../types';

export interface UseVertexEditModeOptions {
  editingMarkupId: string | null;
  exitEditMode: () => void;
  pdfCanvasRef: RefObject<HTMLCanvasElement | null>;
  svgOverlayRef: RefObject<SVGSVGElement | null>;
  /** Same scale info the creation path feeds MeasurementCalculator. */
  getScaleInfo: () => ScaleInfo | null;
  /** Repaint committed markups (drag cancel / handle refresh after commit). */
  requestRepaint: () => void;
  /** Current view rotation (0/90/180/270). */
  getRotation: () => number;
}

interface DragState {
  measurementId: string;
  kind: 'vertex' | 'arc';
  index: number;
  closed: boolean;
  draftPoints: XY[];
  draftArcs: ArcSegment[];
  /** Pixel space of the SVG layer (uniform aspect) for bulge math + patching. */
  pixelW: number;
  pixelH: number;
  rotation: number;
  moved: boolean;
  raf: number | null;
  lastClient: { x: number; y: number } | null;
}

function getMeasurement(id: string): TakeoffMeasurement | undefined {
  return useMeasurementStore.getState().takeoffMeasurements.find((m) => m.id === id);
}

function isClosedType(type: TakeoffMeasurement['type']): boolean {
  return type === 'area' || type === 'volume';
}

export function useVertexEditMode(options: UseVertexEditModeOptions): void {
  // getScaleInfo / requestRepaint / getRotation are read through optsRef so the
  // document listeners never capture stale closures.
  const { editingMarkupId, exitEditMode, pdfCanvasRef, svgOverlayRef } = options;

  // Handlers read latest values through this ref so the single document
  // listener registration never goes stale (house pattern in this codebase).
  const optsRef = useRef(options);
  optsRef.current = options;

  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!editingMarkupId) return;

    const clientToNormalized = (clientX: number, clientY: number): XY | null => {
      const canvas = pdfCanvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      const norm = cssToBaseNormalized(
        clientX - rect.left,
        clientY - rect.top,
        { w: rect.width, h: rect.height },
        // Ratio-only usage: cssToBaseNormalized divides back out these dims.
        { width: 1, height: 1 },
        optsRef.current.getRotation()
      );
      return { x: Math.min(1, Math.max(0, norm.x)), y: Math.min(1, Math.max(0, norm.y)) };
    };

    /** Patch the edited measurement's SVG elements + handles for the current draft. */
    const patchDom = (drag: DragState) => {
      const svg = svgOverlayRef.current;
      if (!svg) return;
      const dims = { width: drag.pixelW, height: drag.pixelH };
      const px = drag.draftPoints.map((p) =>
        baseNormToViewportPixels(p.x, p.y, dims, drag.rotation)
      );
      const expanded = expandPolylineWithArcs(px, drag.draftArcs, { closed: drag.closed });
      const pointsAttr = expanded.map((p) => `${p.x},${p.y}`).join(' ');

      const shapes = svg.querySelectorAll(`[data-measurement-id="${drag.measurementId}"]`);
      shapes.forEach((el) => {
        const tag = el.tagName.toLowerCase();
        if (tag === 'polyline' || tag === 'polygon') {
          el.setAttribute('points', pointsAttr);
        } else if (tag === 'path') {
          // Compound path (area with cutouts): rebuild outer ring, keep cutouts.
          const m = getMeasurement(drag.measurementId);
          let d = `M ${pointsAttr.split(' ')[0]} L ${pointsAttr.split(' ').slice(1).join(' L ')} Z`;
          for (const cutout of m?.cutouts ?? []) {
            if (!cutout.pdfCoordinates || cutout.pdfCoordinates.length < 3) continue;
            const cp = cutout.pdfCoordinates
              .map((p) => baseNormToViewportPixels(p.x, p.y, dims, drag.rotation))
              .map((p) => `${p.x},${p.y}`);
            d += ` M ${cp[0]} L ${cp.slice(1).join(' L ')} Z`;
          }
          el.setAttribute('d', d);
        } else if (tag === 'text') {
          if (drag.closed) {
            const cx = expanded.reduce((s, p) => s + p.x, 0) / expanded.length;
            const cy = expanded.reduce((s, p) => s + p.y, 0) / expanded.length;
            el.setAttribute('x', String(cx));
            el.setAttribute('y', String(cy));
          } else {
            const mid = {
              x: (px[0].x + px[px.length - 1].x) / 2,
              y: (px[0].y + px[px.length - 1].y) / 2,
            };
            el.setAttribute('x', String(mid.x));
            el.setAttribute('y', String(mid.y - 5));
          }
        }
      });

      const layer = svg.querySelector(
        `.${VERTEX_EDIT_LAYER_CLASS}[data-edit-measurement-id="${drag.measurementId}"]`
      );
      if (!layer) return;
      const bulgeBySegment = new Map(drag.draftArcs.map((a) => [a.segmentIndex, a.bulge]));
      layer.querySelectorAll('[data-vertex-handle]').forEach((el) => {
        const i = Number(el.getAttribute('data-vertex-handle'));
        if (!px[i]) return;
        el.setAttribute('x', String(px[i].x - 5));
        el.setAttribute('y', String(px[i].y - 5));
      });
      layer.querySelectorAll('[data-arc-handle]').forEach((el) => {
        const i = Number(el.getAttribute('data-arc-handle'));
        const p0 = px[i];
        const p1 = px[(i + 1) % px.length];
        if (!p0 || !p1) return;
        const bulge = bulgeBySegment.get(i) ?? 0;
        const apex = arcApexPoint(p0, p1, bulge);
        el.setAttribute('cx', String(apex.x));
        el.setAttribute('cy', String(apex.y));
        el.setAttribute('fill', bulge !== 0 ? '#2563eb' : '#ffffff');
      });
    };

    const applyMove = (drag: DragState) => {
      if (!drag.lastClient) return;
      const norm = clientToNormalized(drag.lastClient.x, drag.lastClient.y);
      if (!norm) return;
      if (drag.kind === 'vertex') {
        drag.draftPoints[drag.index] = norm;
      } else {
        const dims = { width: drag.pixelW, height: drag.pixelH };
        const p0n = drag.draftPoints[drag.index];
        const p1n = drag.draftPoints[(drag.index + 1) % drag.draftPoints.length];
        const p0 = baseNormToViewportPixels(p0n.x, p0n.y, dims, drag.rotation);
        const p1 = baseNormToViewportPixels(p1n.x, p1n.y, dims, drag.rotation);
        const dragPx = baseNormToViewportPixels(norm.x, norm.y, dims, drag.rotation);
        const bulge = bulgeFromDragPoint(p0, p1, dragPx);
        drag.draftArcs = withSegmentBulge(drag.draftArcs, drag.index, bulge) ?? [];
      }
      drag.moved = true;
      patchDom(drag);
    };

    const commit = async (drag: DragState) => {
      const m = getMeasurement(drag.measurementId);
      if (!m) return;
      const scaleInfo = optsRef.current.getScaleInfo();
      const condition = useConditionStore.getState().getConditionById(m.conditionId);
      const arcs = drag.draftArcs.filter((a) => a.bulge !== 0);

      const updates: Partial<TakeoffMeasurement> = {
        points: drag.draftPoints,
        pdfCoordinates: drag.draftPoints,
        // Empty array (not undefined) so the API PUT sees the key and clears the column.
        arcs,
      };

      if (scaleInfo?.viewportWidth && scaleInfo.viewportHeight) {
        const expandedNorm = expandNormalizedPointsWithArcs(
          drag.draftPoints,
          arcs,
          scaleInfo.viewportWidth,
          scaleInfo.viewportHeight,
          { closed: drag.closed }
        );
        if (m.type === 'linear') {
          const result = MeasurementCalculator.calculateLinear(expandedNorm, scaleInfo, 1.0);
          if (result.validation.isValid) {
            updates.calculatedValue = result.calculatedValue;
            if (condition?.includeHeight && condition.height) {
              updates.areaValue = result.calculatedValue * condition.height;
            }
          }
        } else if (m.type === 'area' || m.type === 'volume') {
          const result =
            m.type === 'area'
              ? MeasurementCalculator.calculateArea(expandedNorm, scaleInfo, 1.0)
              : MeasurementCalculator.calculateVolume(
                  expandedNorm,
                  scaleInfo,
                  condition?.depth || 1,
                  1.0
                );
          if (result.validation.isValid) {
            updates.calculatedValue = result.calculatedValue;
            if (condition?.includePerimeter && result.perimeterValue != null) {
              updates.perimeterValue = result.perimeterValue;
            }
            if (m.cutouts && m.cutouts.length > 0) {
              const cutoutTotal = m.cutouts.reduce((s, c) => s + (c.calculatedValue || 0), 0);
              updates.netCalculatedValue = Math.max(0, result.calculatedValue - cutoutTotal);
            }
          }
        }
      }

      // Undoable: capture the pre-edit values of every field we touch.
      const previous: Partial<TakeoffMeasurement> = {
        points: m.points,
        pdfCoordinates: m.pdfCoordinates,
        arcs: m.arcs ?? [],
        calculatedValue: m.calculatedValue,
        ...(updates.perimeterValue !== undefined && { perimeterValue: m.perimeterValue }),
        ...(updates.areaValue !== undefined && { areaValue: m.areaValue }),
        ...(updates.netCalculatedValue !== undefined && {
          netCalculatedValue: m.netCalculatedValue,
        }),
      };
      await useMeasurementStore.getState().updateTakeoffMeasurement(m.id, updates);
      useUndoStore.getState().push({ type: 'measurement_update', id: m.id, previous, next: updates });
      optsRef.current.requestRepaint();
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const handleEl = target?.closest?.('[data-vertex-handle], [data-arc-handle]');
      const layer = handleEl?.closest?.(`.${VERTEX_EDIT_LAYER_CLASS}`);
      const layerId = layer?.getAttribute('data-edit-measurement-id');

      if (!handleEl || !layer || layerId !== editingMarkupId) {
        // Click-away (not on a handle): leave edit mode, let the event proceed.
        // Ignore clicks inside menus/dialogs (anything outside the SVG overlay).
        const inOverlay = svgOverlayRef.current?.contains(target as Node) ?? false;
        const onCanvas = pdfCanvasRef.current?.contains(target as Node) ?? false;
        if (inOverlay || onCanvas) exitEditMode();
        return;
      }

      const m = getMeasurement(editingMarkupId);
      if (!m) return;

      e.preventDefault();
      e.stopPropagation();

      const vertexAttr = handleEl.getAttribute('data-vertex-handle');
      const arcAttr = handleEl.getAttribute('data-arc-handle');
      dragRef.current = {
        measurementId: editingMarkupId,
        kind: vertexAttr != null ? 'vertex' : 'arc',
        index: Number(vertexAttr ?? arcAttr),
        closed: isClosedType(m.type),
        draftPoints: m.points.map((p) => ({ ...p })),
        draftArcs: (m.arcs ?? []).map((a) => ({ ...a })),
        pixelW: Number(layer.getAttribute('data-pixel-w')) || 1,
        pixelH: Number(layer.getAttribute('data-pixel-h')) || 1,
        rotation: Number(layer.getAttribute('data-rotation')) || 0,
        moved: false,
        raf: null,
        lastClient: null,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      drag.lastClient = { x: e.clientX, y: e.clientY };
      if (drag.raf == null) {
        drag.raf = requestAnimationFrame(() => {
          drag.raf = null;
          applyMove(drag);
        });
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      if (drag.raf != null) {
        cancelAnimationFrame(drag.raf);
        drag.raf = null;
        applyMove(drag);
      }
      dragRef.current = null;
      if (drag.moved) {
        void commit(drag);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const drag = dragRef.current;
      if (drag) {
        // Cancel the in-flight drag: throw the draft away, repaint from store.
        if (drag.raf != null) cancelAnimationFrame(drag.raf);
        dragRef.current = null;
        optsRef.current.requestRepaint();
        e.stopPropagation();
        return;
      }
      exitEditMode();
    };

    // Capture phase so handle drags win over the viewer's own pointer handlers.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('keydown', onKeyDown, true);
      if (dragRef.current?.raf != null) cancelAnimationFrame(dragRef.current.raf);
      dragRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers read live values via optsRef
  }, [editingMarkupId]);
}
