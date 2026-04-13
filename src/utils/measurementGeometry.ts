/**
 * PDF coordinate helpers for takeoff measurements.
 *
 * **Base-normalized** coordinates: unrotated PDF user space (0–1). This is what we persist in
 * `pdfCoordinates` / `points`. **Viewport pixels**: rotated on-screen space (PDF.js
 * `getViewport({ rotation })` / SVG overlay), matching the canvas bitmap.
 *
 * Pointer → storage: `cssToBaseNormalized`. Storage → overlay drawing: `baseNormToViewportPixels`.
 * Do not multiply base-normalized `x,y` by viewport width/height without rotation — that only
 * matches at 0° and caused production bugs when previews used a different convention than clicks.
 */
import type { TakeoffMeasurement } from '../types';

/** Minimum CSS drag size (px) before completing a rectangle area or cutout. */
export const MIN_DRAG_RECT_PX = 5;

/**
 * Laid-out CSS size of the PDF canvas, or `viewport` when the canvas has not sized yet.
 * Prefer over PDF.js `viewport.width/height` for pointer→normalized math and for SVG pixel coords
 * so they match the visible bitmap when React state is briefly ahead of layout.
 */
export function canvasPixelExtent(
  canvas: HTMLCanvasElement | null,
  viewport: { width: number; height: number }
): { w: number; h: number } {
  if (!canvas) return { w: viewport.width, h: viewport.height };
  const r = canvas.getBoundingClientRect();
  if (r.width >= 0.5 && r.height >= 0.5) return { w: r.width, h: r.height };
  return { w: viewport.width, h: viewport.height };
}

export function normalizeRotationDeg(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

/**
 * Canvas CSS pixel → normalized coordinates in unrotated (rotation=0) PDF user space.
 * Must match handleClick / PDF.js display rotation (multiples of 90°).
 */
export function cssToBaseNormalized(
  cssX: number,
  cssY: number,
  dp: { w: number; h: number },
  baseViewport: { width: number; height: number },
  rotation: number
): { x: number; y: number } {
  const r = normalizeRotationDeg(rotation);
  let baseX: number;
  let baseY: number;
  if (r === 0) {
    baseX = (cssX / dp.w) * baseViewport.width;
    baseY = (cssY / dp.h) * baseViewport.height;
  } else if (r === 90) {
    baseX = (cssY / dp.h) * baseViewport.width;
    baseY = (1 - cssX / dp.w) * baseViewport.height;
  } else if (r === 180) {
    baseX = (1 - cssX / dp.w) * baseViewport.width;
    baseY = (1 - cssY / dp.h) * baseViewport.height;
  } else if (r === 270) {
    baseX = (1 - cssY / dp.h) * baseViewport.width;
    baseY = (cssX / dp.w) * baseViewport.height;
  } else {
    baseX = (cssX / dp.w) * baseViewport.width;
    baseY = (cssY / dp.h) * baseViewport.height;
  }
  return { x: baseX / baseViewport.width, y: baseY / baseViewport.height };
}

/**
 * Base-normalized (unrotated PDF 0–1) → rotated viewport pixel coordinates (SVG / canvas overlay).
 * Inverse mapping of the rotation baked into `cssToBaseNormalized`; must match `renderSVGMeasurement`.
 */
export function baseNormToViewportPixels(
  nx: number,
  ny: number,
  vp: { width: number; height: number },
  rotation: number
): { x: number; y: number } {
  const r = normalizeRotationDeg(rotation);
  const vw = vp.width;
  const vh = vp.height;
  if (r === 0) return { x: nx * vw, y: ny * vh };
  if (r === 90) return { x: vw * (1 - ny), y: vh * nx };
  if (r === 180) return { x: vw * (1 - nx), y: vh * (1 - ny) };
  if (r === 270) return { x: vw * ny, y: vh * (1 - nx) };
  return { x: nx * vw, y: ny * vh };
}

/**
 * Pixel translation in rotated viewport space when every base-normalized point shifts by (dNx, dNy).
 * Same for every vertex; use for SVG `translate` during move-drag preview (not `dNx * width`, which is only correct at 0°).
 */
export function baseNormDeltaToViewportPixels(
  dNx: number,
  dNy: number,
  vp: { width: number; height: number },
  rotation: number
): { x: number; y: number } {
  const end = baseNormToViewportPixels(dNx, dNy, vp, rotation);
  const origin = baseNormToViewportPixels(0, 0, vp, rotation);
  return { x: end.x - origin.x, y: end.y - origin.y };
}

/** CSS drag rectangle → four corners in base normalized PDF space (0–1). Correct for any display rotation. */
export function cssDragRectToBasePdfQuad(
  dp: { w: number; h: number },
  baseViewport: { width: number; height: number },
  rotation: number,
  x: number,
  y: number,
  width: number,
  height: number
): Array<{ x: number; y: number }> {
  return [
    cssToBaseNormalized(x, y, dp, baseViewport, rotation),
    cssToBaseNormalized(x + width, y, dp, baseViewport, rotation),
    cssToBaseNormalized(x + width, y + height, dp, baseViewport, rotation),
    cssToBaseNormalized(x, y + height, dp, baseViewport, rotation),
  ];
}

/**
 * Axis-aligned bounding box in base normalized space from a CSS drag rect on the rotated canvas.
 * Use for hyperlinks and anywhere we store `sourceRect` in unrotated PDF 0–1 space.
 */
export function cssDragRectToBasePdfAabb(
  dp: { w: number; h: number },
  baseViewport: { width: number; height: number },
  rotation: number,
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const quad = cssDragRectToBasePdfQuad(dp, baseViewport, rotation, x, y, width, height);
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  return {
    x: xMin,
    y: yMin,
    width: Math.max(1e-6, xMax - xMin),
    height: Math.max(1e-6, yMax - yMin),
  };
}

/** Shift normalized PDF points by a delta (e.g. when dragging a measurement). */
export function shiftPdfPoints(
  points: Array<{ x: number; y: number }>,
  delta: { x: number; y: number }
): Array<{ x: number; y: number }> {
  return points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
}

/**
 * Apply the same PDF-space translation to the outer polygon and every cutout
 * so a moved area stays one shape with holes.
 */
export function shiftTakeoffMeasurementGeometry(
  m: Pick<TakeoffMeasurement, 'pdfCoordinates' | 'cutouts'>,
  delta: { x: number; y: number }
): Pick<TakeoffMeasurement, 'pdfCoordinates' | 'points' | 'cutouts'> {
  const newPoints = shiftPdfPoints(m.pdfCoordinates, delta);
  let cutouts = m.cutouts;
  if (cutouts && cutouts.length > 0) {
    cutouts = cutouts.map((c) => {
      const src = c.pdfCoordinates?.length ? c.pdfCoordinates : c.points;
      const shifted = shiftPdfPoints(src, delta);
      return { ...c, points: shifted, pdfCoordinates: shifted };
    });
  }
  return { pdfCoordinates: newPoints, points: newPoints, cutouts };
}
