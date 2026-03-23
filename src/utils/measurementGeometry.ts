import type { TakeoffMeasurement } from '../types';

/** Minimum CSS drag size (px) before completing a rectangle area or cutout. */
export const MIN_DRAG_RECT_PX = 5;

/** CSS-space rectangle (min corner + size) → four corners in normalized PDF space (0–1). */
export function cssDragRectToPdfQuad(
  viewport: { width: number; height: number },
  x: number,
  y: number,
  width: number,
  height: number
): Array<{ x: number; y: number }> {
  return [
    { x: x / viewport.width, y: y / viewport.height },
    { x: (x + width) / viewport.width, y: y / viewport.height },
    { x: (x + width) / viewport.width, y: (y + height) / viewport.height },
    { x: x / viewport.width, y: (y + height) / viewport.height },
  ];
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
