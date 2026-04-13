/**
 * Pure SVG renderer helpers for PDFViewer.
 * Used for selection box, point-in-polygon checks, and markup rendering.
 */
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';

/** Stroke width for annotation hit areas (rect/circle); stroke-only so interior passes through. */
const ANNOTATION_HIT_STROKE_WIDTH = 12;
import type { Measurement, SelectionBox } from '../PDFViewer.types';
import type { Annotation, SheetHyperlink } from '../../types';
import { formatFeetAndInches } from '../../lib/utils';
import { calculateDistance } from '../../utils/commonUtils';
import { baseNormToViewportPixels } from '../../utils/measurementGeometry';

/** Re-export so existing imports from this module keep working. Prefer `measurementGeometry` for new code. */
export { baseNormToViewportPixels };

export interface RenderSVGMeasurementOptions {
  rotation: number;
  selectedMarkupIds: string[];
  getConditionColor: (id: string, fallback?: string) => string;
  getConditionLineThickness?: (id: string) => number;
  selectionMode: boolean;
  /** When false, value labels (LF, SF, CY, etc.) on completed measurements are hidden. Defaults to true. */
  showLabel?: boolean;
  /** Laid-out canvas CSS px; when set, used instead of viewport width/height for SVG pixel coords. */
  pixelWidth?: number;
  pixelHeight?: number;
}

/** Ray-casting point-in-polygon test */
export function isPointInPolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[]
): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const condition1 = (yi > point.y) !== (yj > point.y);
    const condition2 = point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi;

    if (condition1 && condition2) {
      inside = !inside;
    }
  }

  return inside;
}

/** Renders the visual search / titleblock selection box as an SVG rect */
export function renderSVGSelectionBox(
  svg: SVGSVGElement,
  selectionBox: SelectionBox,
  _viewport: { width: number; height: number }
): void {
  if (!selectionBox) return;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', selectionBox.x.toString());
  rect.setAttribute('y', selectionBox.y.toString());
  rect.setAttribute('width', selectionBox.width.toString());
  rect.setAttribute('height', selectionBox.height.toString());
  rect.setAttribute('fill', 'rgba(59, 130, 246, 0.1)');
  rect.setAttribute('stroke', '#3B82F6');
  rect.setAttribute('stroke-width', '2');
  rect.setAttribute('stroke-dasharray', '5,5');
  rect.setAttribute('vector-effect', 'non-scaling-stroke');
  rect.setAttribute('pointer-events', 'none'); // Don't intercept events during drag
  svg.appendChild(rect);
}

/** Renders the hyperlink draw preview (dashed, thin - distinct from annotation boxes) */
export function renderSVGHyperlinkDrawBox(
  svg: SVGSVGElement,
  box: SelectionBox,
  _viewport: { width: number; height: number }
): void {
  if (!box) return;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', box.x.toString());
  rect.setAttribute('y', box.y.toString());
  rect.setAttribute('width', box.width.toString());
  rect.setAttribute('height', box.height.toString());
  rect.setAttribute('fill', 'rgba(59, 130, 246, 0.06)');
  rect.setAttribute('stroke', 'rgba(59, 130, 246, 0.8)');
  rect.setAttribute('stroke-width', '1');
  rect.setAttribute('stroke-dasharray', '4,4');
  rect.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(rect);
}

/** Renders sheet hyperlinks as clickable rectangles (dashed, thin - distinct from annotations).
 * sourceRect is in normalized 0-1 space (rotation=0); applies same rotation transform as measurements. */
export function renderSVGHyperlinks(
  svg: SVGSVGElement,
  hyperlinks: SheetHyperlink[],
  viewport: { width: number; height: number; rotation?: number }
): void {
  if (!viewport || hyperlinks.length === 0) return;
  const rotation = viewport.rotation ?? 0;
  for (const h of hyperlinks) {
    const { x: nx, y: ny, width: nw, height: nh } = h.sourceRect;
    const corners = [
      baseNormToViewportPixels(nx, ny, viewport, rotation),
      baseNormToViewportPixels(nx + nw, ny, viewport, rotation),
      baseNormToViewportPixels(nx + nw, ny + nh, viewport, rotation),
      baseNormToViewportPixels(nx, ny + nh, viewport, rotation),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x;
    const ht = Math.max(...ys) - y;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x.toString());
    rect.setAttribute('y', y.toString());
    rect.setAttribute('width', w.toString());
    rect.setAttribute('height', ht.toString());
    rect.setAttribute('fill', 'rgba(59, 130, 246, 0.12)');
    rect.setAttribute('stroke', 'rgba(59, 130, 246, 0.7)');
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('stroke-dasharray', '4,4');
    rect.setAttribute('data-hyperlink-id', h.id);
    rect.setAttribute('data-target-sheet', h.targetSheetId);
    rect.setAttribute('data-target-page', String(h.targetPageNumber));
    rect.setAttribute('cursor', 'pointer');
    rect.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(rect);
  }
}

/** Renders the annotation drag-to-draw box (rectangle/circle/arrow) with given stroke color */
export function renderSVGAnnotationDragBox(
  svg: SVGSVGElement,
  box: SelectionBox,
  _viewport: { width: number; height: number },
  strokeColor: string
): void {
  if (!box) return;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', box.x.toString());
  rect.setAttribute('y', box.y.toString());
  rect.setAttribute('width', box.width.toString());
  rect.setAttribute('height', box.height.toString());
  rect.setAttribute('fill', 'transparent');
  rect.setAttribute('stroke', strokeColor);
  rect.setAttribute('stroke-width', '2');
  rect.setAttribute('stroke-dasharray', '5,5');
  rect.setAttribute('vector-effect', 'non-scaling-stroke');
  rect.setAttribute('opacity', '0.8');
  svg.appendChild(rect);
}

/** Point in normalized (0–1) or viewport coordinates */
export interface Point {
  x: number;
  y: number;
}

/** Renders the current cut-out preview (polyline + optional fill polygon).
 *  Matches regular area/volume measurement preview behaviour: dashed stroke
 *  polyline following the cursor, with a semi-transparent fill polygon once
 *  three or more points exist (no diagonal closing stroke). */
export function renderSVGCurrentCutoutCommitted(
  parent: SVGGElement,
  viewport: { width: number; height: number; rotation?: number },
  currentCutout: Point[]
): void {
  if (!viewport || currentCutout.length < 3) return;
  const rotation = viewport.rotation ?? 0;
  const vw = viewport.width;
  const vh = viewport.height;
  const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  const polygonPointString = currentCutout
    .map((p) => {
      const pt = baseNormToViewportPixels(p.x, p.y, { width: vw, height: vh }, rotation);
      return `${pt.x},${pt.y}`;
    })
    .join(' ');
  polygon.setAttribute('points', polygonPointString);
  polygon.setAttribute('fill', 'rgba(255, 0, 0, 0.15)');
  polygon.setAttribute('stroke', 'none');
  polygon.setAttribute('pointer-events', 'none');
  parent.appendChild(polygon);
}

export function renderSVGCurrentCutoutEphemeral(
  parent: SVGGElement,
  viewport: { width: number; height: number; rotation?: number },
  currentCutout: Point[],
  mousePosition: Point | null
): void {
  if (!viewport || currentCutout.length === 0) return;
  const rotation = viewport.rotation ?? 0;
  const vw = viewport.width;
  const vh = viewport.height;
  const toPx = (nx: number, ny: number) =>
    baseNormToViewportPixels(nx, ny, { width: vw, height: vh }, rotation);

  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  let pointString = currentCutout
    .map((p) => {
      const pt = toPx(p.x, p.y);
      return `${pt.x},${pt.y}`;
    })
    .join(' ');
  if (mousePosition) {
    const m = toPx(mousePosition.x, mousePosition.y);
    pointString += ` ${m.x},${m.y}`;
  }
  polyline.setAttribute('points', pointString);
  polyline.setAttribute('stroke', '#ff0000');
  polyline.setAttribute('stroke-width', '2');
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke-dasharray', '5,5');
  polyline.setAttribute('vector-effect', 'non-scaling-stroke');
  polyline.setAttribute('pointer-events', 'none');
  parent.appendChild(polyline);
}

export function renderSVGCurrentCutout(
  svg: SVGSVGElement,
  viewport: { width: number; height: number },
  currentCutout: Point[],
  mousePosition: Point | null
): void {
  const parent = svg as unknown as SVGGElement;
  renderSVGCurrentCutoutCommitted(parent, viewport, currentCutout);
  renderSVGCurrentCutoutEphemeral(parent, viewport, currentCutout, mousePosition);
}

/** Converts hex color to rgba string. */
function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace(/^#/, '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

export interface CrosshairOptions {
  fullScreen?: boolean;
  /** Hex color for non-calibrating mode. Ignored when isCalibrating. */
  strokeColor?: string;
  /** Stroke thickness in CSS pixels. Defaults to 1.5 (or 2 when calibrating). */
  strokeWidth?: number;
}

/** Renders crosshair at position (base-normalized unrotated PDF 0–1, same as stored measurements). */
export function renderSVGCrosshair(
  svg: SVGSVGElement,
  position: Point,
  viewport: { width: number; height: number; rotation?: number },
  isCalibrating: boolean = false,
  options?: CrosshairOptions
): void {
  if (!position || !viewport) return;
  const rotation = viewport.rotation ?? 0;
  const { x: vx, y: vy } = baseNormToViewportPixels(position.x, position.y, viewport, rotation);
  if (typeof vx !== 'number' || typeof vy !== 'number') return;

  const { fullScreen = false, strokeColor: strokeColorHex, strokeWidth: customStrokeWidth } = options ?? {};
  const viewportMin = Math.min(viewport.width, viewport.height);
  const CROSSHAIR_SIZE_MIN = 22;
  const CROSSHAIR_SIZE_FRACTION = 0.035;
  const CROSSHAIR_SIZE_CALIBRATING_MIN = 24;
  const CROSSHAIR_SIZE_CALIBRATING_FRACTION = 0.032;
  const crosshairSize = isCalibrating
    ? Math.max(CROSSHAIR_SIZE_CALIBRATING_MIN, viewportMin * CROSSHAIR_SIZE_CALIBRATING_FRACTION)
    : Math.max(CROSSHAIR_SIZE_MIN, viewportMin * CROSSHAIR_SIZE_FRACTION);

  const strokeColor = isCalibrating
    ? 'rgba(255, 0, 0, 0.9)'
    : strokeColorHex
      ? hexToRgba(strokeColorHex, 0.85)
      : 'rgba(0, 0, 0, 0.85)';
  const strokeWidth = isCalibrating ? '2' : String(customStrokeWidth ?? 1.5);

  const hx1 = fullScreen && !isCalibrating ? 0 : vx - crosshairSize;
  const hx2 = fullScreen && !isCalibrating ? viewport.width : vx + crosshairSize;
  const vy1 = fullScreen && !isCalibrating ? 0 : vy - crosshairSize;
  const vy2 = fullScreen && !isCalibrating ? viewport.height : vy + crosshairSize;

  const makeLine = (x1: number, y1: number, x2: number, y2: number) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', strokeColor);
    line.setAttribute('stroke-width', String(strokeWidth));
    line.setAttribute('stroke-dasharray', '6 4');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    return line;
  };

  svg.appendChild(makeLine(hx1, vy, hx2, vy));   // horizontal
  svg.appendChild(makeLine(vx, vy1, vx, vy2));    // vertical
}

/** Renders a single takeoff measurement as SVG (polyline/polygon/circle + label). */
export function renderSVGMeasurement(
  svg: SVGSVGElement,
  measurement: Measurement,
  viewport: PageViewport,
  page: PDFPageProxy | undefined,
  options: RenderSVGMeasurementOptions
): void {
  if (!measurement || !measurement.points || !viewport) return;
  const points = measurement.points;
  if (points.length < 1) return;
  if (measurement.type === 'count' && points.length < 1) return;
  if (measurement.type !== 'count' && points.length < 2) return;
  if (!page) return;

  const {
    rotation,
    selectedMarkupIds,
    getConditionColor,
    getConditionLineThickness,
    selectionMode,
    showLabel = true,
    pixelWidth,
    pixelHeight,
  } = options;
  const currentViewport = viewport;
  const vw = pixelWidth ?? currentViewport.width;
  const vh = pixelHeight ?? currentViewport.height;

  const transformedPoints = points.map((point) =>
    baseNormToViewportPixels(point.x, point.y, { width: vw, height: vh }, rotation)
  );

  const isSelected = selectedMarkupIds.includes(measurement.id);
  const liveColor = getConditionColor(measurement.conditionId, measurement.conditionColor);
  const strokeColor = isSelected ? '#ff0000' : liveColor;
  const baseStrokeWidth = measurement.type === 'linear' && getConditionLineThickness
    ? getConditionLineThickness(measurement.conditionId)
    : 2;
  const strokeWidth = isSelected ? '4' : String(baseStrokeWidth);

  switch (measurement.type) {
    case 'linear': {
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      const pointString = transformedPoints.map((p) => `${p.x},${p.y}`).join(' ');
      polyline.setAttribute('points', pointString);
      polyline.setAttribute('stroke', strokeColor);
      polyline.setAttribute('stroke-width', strokeWidth);
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('data-measurement-id', measurement.id);
      polyline.style.pointerEvents = selectionMode ? 'auto' : 'none';
      polyline.style.cursor = selectionMode ? 'pointer' : 'default';
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      hitArea.setAttribute('points', pointString);
      hitArea.setAttribute('stroke', 'transparent');
      hitArea.setAttribute('stroke-width', '20');
      hitArea.setAttribute('fill', 'none');
      hitArea.setAttribute('data-measurement-id', measurement.id);
      hitArea.style.pointerEvents = selectionMode ? 'auto' : 'none';
      hitArea.style.cursor = selectionMode ? 'pointer' : 'default';
      svg.appendChild(hitArea);
      svg.appendChild(polyline);
      if (showLabel) {
        const startPoint = { x: transformedPoints[0].x, y: transformedPoints[0].y };
        const endPoint = { x: transformedPoints[transformedPoints.length - 1].x, y: transformedPoints[transformedPoints.length - 1].y };
        const midPoint = { x: (startPoint.x + endPoint.x) / 2, y: (startPoint.y + endPoint.y) / 2 };
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', midPoint.x.toString());
        text.setAttribute('y', (midPoint.y - 5).toString());
        text.setAttribute('fill', strokeColor);
        text.setAttribute('font-size', '12');
        text.setAttribute('font-family', 'Arial');
        text.setAttribute('text-anchor', 'middle');
        const linearValue = (measurement.unit === 'ft' || measurement.unit === 'feet' || measurement.unit === 'LF' || measurement.unit === 'lf')
          ? formatFeetAndInches(measurement.calculatedValue)
          : `${measurement.calculatedValue.toFixed(2)} ${measurement.unit}`;
        const displayValue = measurement.areaValue ? `${linearValue} LF / ${measurement.areaValue.toFixed(0)} SF` : linearValue;
        text.textContent = displayValue;
        text.setAttribute('data-measurement-id', measurement.id);
        text.style.pointerEvents = selectionMode ? 'auto' : 'none';
        text.style.cursor = selectionMode ? 'pointer' : 'default';
        svg.appendChild(text);
      }
      break;
    }
    case 'area':
      if (transformedPoints.length >= 3) {
        const pointString = transformedPoints.map((p) => `${p.x},${p.y}`).join(' ');
        if (measurement.cutouts && Array.isArray(measurement.cutouts) && measurement.cutouts.length > 0) {
          const compoundPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          let pathData = `M ${pointString.split(' ')[0]} L ${pointString.split(' ').slice(1).join(' L ')} Z`;
          measurement.cutouts.forEach((cutout) => {
            if (cutout?.points?.length >= 3) {
              const cutoutPointString = cutout.points.map((p) => `${p.x * vw},${p.y * vh}`).join(' ');
              pathData += ` M ${cutoutPointString.split(' ')[0]} L ${cutoutPointString.split(' ').slice(1).join(' L ')} Z`;
            }
          });
          compoundPath.setAttribute('d', pathData);
          compoundPath.setAttribute('fill-rule', 'evenodd');
          compoundPath.setAttribute('fill', liveColor + '40');
          compoundPath.setAttribute('stroke', strokeColor);
          compoundPath.setAttribute('stroke-width', strokeWidth);
          compoundPath.setAttribute('data-measurement-id', measurement.id);
          compoundPath.style.pointerEvents = selectionMode ? 'auto' : 'none';
          compoundPath.style.cursor = selectionMode ? 'pointer' : 'default';
          svg.appendChild(compoundPath);
        } else {
          const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          polygon.setAttribute('points', pointString);
          polygon.setAttribute('fill', liveColor + '40');
          polygon.setAttribute('stroke', strokeColor);
          polygon.setAttribute('stroke-width', strokeWidth);
          polygon.setAttribute('data-measurement-id', measurement.id);
          polygon.style.pointerEvents = selectionMode ? 'auto' : 'none';
          polygon.style.cursor = selectionMode ? 'pointer' : 'default';
          const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          hitArea.setAttribute('points', pointString);
          hitArea.setAttribute('fill', 'transparent');
          hitArea.setAttribute('stroke', 'transparent');
          hitArea.setAttribute('stroke-width', '10');
          hitArea.setAttribute('data-measurement-id', measurement.id);
          hitArea.style.pointerEvents = selectionMode ? 'auto' : 'none';
          hitArea.style.cursor = selectionMode ? 'pointer' : 'default';
          svg.appendChild(hitArea);
          svg.appendChild(polygon);
        }
        if (showLabel) {
          const centerX = transformedPoints.reduce((s, p) => s + p.x, 0) / transformedPoints.length;
          const centerY = transformedPoints.reduce((s, p) => s + p.y, 0) / transformedPoints.length;
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', centerX.toString());
          text.setAttribute('y', centerY.toString());
          text.setAttribute('fill', strokeColor);
          text.setAttribute('font-size', '12');
          text.setAttribute('font-family', 'Arial');
          text.setAttribute('font-weight', 'bold');
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          const displayValue = measurement.netCalculatedValue != null ? measurement.netCalculatedValue : measurement.calculatedValue;
          const areaValue = `${displayValue.toFixed(0)} SF`;
          text.textContent = measurement.perimeterValue ? `${areaValue} / ${formatFeetAndInches(measurement.perimeterValue)} LF` : areaValue;
          text.setAttribute('data-measurement-id', measurement.id);
          text.style.pointerEvents = selectionMode ? 'auto' : 'none';
          text.style.cursor = selectionMode ? 'pointer' : 'default';
          svg.appendChild(text);
        }
      }
      break;
    case 'volume':
      if (transformedPoints.length >= 3) {
        const pointString = transformedPoints.map((p) => `${p.x},${p.y}`).join(' ');
        if (measurement.cutouts && Array.isArray(measurement.cutouts) && measurement.cutouts.length > 0) {
          const compoundPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          let pathData = `M ${pointString.split(' ')[0]} L ${pointString.split(' ').slice(1).join(' L ')} Z`;
          measurement.cutouts.forEach((cutout) => {
            if (cutout?.points?.length >= 3) {
              const cutoutPointString = cutout.points.map((p) => `${p.x * vw},${p.y * vh}`).join(' ');
              pathData += ` M ${cutoutPointString.split(' ')[0]} L ${cutoutPointString.split(' ').slice(1).join(' L ')} Z`;
            }
          });
          compoundPath.setAttribute('d', pathData);
          compoundPath.setAttribute('fill-rule', 'evenodd');
          compoundPath.setAttribute('fill', liveColor + '40');
          compoundPath.setAttribute('stroke', strokeColor);
          compoundPath.setAttribute('stroke-width', strokeWidth);
          compoundPath.setAttribute('data-measurement-id', measurement.id);
          compoundPath.style.pointerEvents = selectionMode ? 'auto' : 'none';
          compoundPath.style.cursor = selectionMode ? 'pointer' : 'default';
          svg.appendChild(compoundPath);
        } else {
          const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          polygon.setAttribute('points', pointString);
          polygon.setAttribute('fill', liveColor + '40');
          polygon.setAttribute('stroke', strokeColor);
          polygon.setAttribute('stroke-width', strokeWidth);
          polygon.setAttribute('data-measurement-id', measurement.id);
          polygon.style.pointerEvents = selectionMode ? 'auto' : 'none';
          polygon.style.cursor = selectionMode ? 'pointer' : 'default';
          const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          hitArea.setAttribute('points', pointString);
          hitArea.setAttribute('fill', 'transparent');
          hitArea.setAttribute('stroke', 'transparent');
          hitArea.setAttribute('stroke-width', '10');
          hitArea.setAttribute('data-measurement-id', measurement.id);
          hitArea.style.pointerEvents = selectionMode ? 'auto' : 'none';
          hitArea.style.cursor = selectionMode ? 'pointer' : 'default';
          svg.appendChild(hitArea);
          svg.appendChild(polygon);
        }
        if (showLabel) {
          const centerX = transformedPoints.reduce((s, p) => s + p.x, 0) / transformedPoints.length;
          const centerY = transformedPoints.reduce((s, p) => s + p.y, 0) / transformedPoints.length;
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', centerX.toString());
          text.setAttribute('y', centerY.toString());
          text.setAttribute('fill', strokeColor);
          text.setAttribute('font-size', '12');
          text.setAttribute('font-family', 'Arial');
          text.setAttribute('font-weight', 'bold');
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          const displayValue = measurement.netCalculatedValue != null ? measurement.netCalculatedValue : measurement.calculatedValue;
          const volumeValue = `${displayValue.toFixed(0)} CY`;
          text.textContent = measurement.perimeterValue ? `${volumeValue} / ${formatFeetAndInches(measurement.perimeterValue)} LF` : volumeValue;
          text.setAttribute('data-measurement-id', measurement.id);
          text.style.pointerEvents = selectionMode ? 'auto' : 'none';
          text.style.cursor = selectionMode ? 'pointer' : 'default';
          svg.appendChild(text);
        }
      }
      break;
    case 'count': {
      const point = { x: transformedPoints[0].x, y: transformedPoints[0].y };
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', point.x.toString());
      circle.setAttribute('cy', point.y.toString());
      circle.setAttribute('r', '8');
      circle.setAttribute('fill', liveColor);
      if (isSelected) {
        circle.setAttribute('stroke', '#ff0000');
        circle.setAttribute('stroke-width', '3');
      } else {
        circle.setAttribute('stroke', 'none');
      }
      circle.setAttribute('data-measurement-id', measurement.id);
      circle.style.pointerEvents = selectionMode ? 'auto' : 'none';
      circle.style.cursor = selectionMode ? 'pointer' : 'default';
      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hitArea.setAttribute('cx', point.x.toString());
      hitArea.setAttribute('cy', point.y.toString());
      hitArea.setAttribute('r', '20');
      hitArea.setAttribute('fill', 'transparent');
      hitArea.setAttribute('stroke', 'transparent');
      hitArea.setAttribute('data-measurement-id', measurement.id);
      hitArea.style.pointerEvents = selectionMode ? 'auto' : 'none';
      hitArea.style.cursor = selectionMode ? 'pointer' : 'default';
      svg.appendChild(hitArea);
      svg.appendChild(circle);
      break;
    }
  }
}

export interface RenderSVGAnnotationOptions {
  rotation: number;
  selectedMarkupIds: string[];
  selectionMode: boolean;
}

/** Renders a single annotation (text, arrow, rectangle, circle, highlight) as SVG. */
export function renderSVGAnnotation(
  svg: SVGSVGElement,
  annotation: Annotation,
  viewport: PageViewport,
  options: RenderSVGAnnotationOptions
): void {
  if (!viewport || annotation.points.length === 0) return;
  const { rotation, selectedMarkupIds, selectionMode } = options;
  const currentViewport = viewport;

  const points = annotation.points.map((p) =>
    baseNormToViewportPixels(p.x, p.y, currentViewport, rotation)
  );

  const isSelected = selectedMarkupIds.includes(annotation.id);
  const strokeWidth = isSelected ? '5' : '3';
  const strokeColor = isSelected ? '#00ff00' : annotation.color;

  if (annotation.type === 'text' && annotation.text) {
    const point = points[0];
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', point.x.toString());
    text.setAttribute('y', point.y.toString());
    text.setAttribute('fill', strokeColor);
    text.setAttribute('font-size', '14');
    text.setAttribute('font-weight', 'bold');
    text.textContent = annotation.text;
    text.setAttribute('data-annotation-id', annotation.id);
    text.style.pointerEvents = selectionMode ? 'auto' : 'none';
    text.style.cursor = selectionMode ? 'pointer' : 'default';
    svg.appendChild(text);
    const textWidth = annotation.text ? annotation.text.length * 8 : 50;
    const textHeight = 16;
    const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hitArea.setAttribute('x', (point.x - 5).toString());
    hitArea.setAttribute('y', (point.y - textHeight - 5).toString());
    hitArea.setAttribute('width', (textWidth + 10).toString());
    hitArea.setAttribute('height', (textHeight + 10).toString());
    hitArea.setAttribute('fill', 'transparent');
    hitArea.setAttribute('stroke', 'transparent');
    hitArea.setAttribute('data-annotation-id', annotation.id);
    hitArea.style.pointerEvents = selectionMode ? 'auto' : 'none';
    hitArea.style.cursor = selectionMode ? 'pointer' : 'default';
    svg.appendChild(hitArea);
  } else if (annotation.type === 'arrow' && points.length === 2) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', points[0].x.toString());
    line.setAttribute('y1', points[0].y.toString());
    line.setAttribute('x2', points[1].x.toString());
    line.setAttribute('y2', points[1].y.toString());
    line.setAttribute('stroke', strokeColor);
    line.setAttribute('stroke-width', strokeWidth);
    line.setAttribute('marker-end', 'url(#arrowhead)');
    line.setAttribute('data-annotation-id', annotation.id);
    line.style.pointerEvents = selectionMode ? 'auto' : 'none';
    line.style.cursor = selectionMode ? 'pointer' : 'default';
    svg.appendChild(line);
    const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hitArea.setAttribute('x1', points[0].x.toString());
    hitArea.setAttribute('y1', points[0].y.toString());
    hitArea.setAttribute('x2', points[1].x.toString());
    hitArea.setAttribute('y2', points[1].y.toString());
    hitArea.setAttribute('stroke', 'transparent');
    hitArea.setAttribute('stroke-width', '20');
    hitArea.setAttribute('fill', 'none');
    hitArea.setAttribute('data-annotation-id', annotation.id);
    hitArea.style.pointerEvents = selectionMode ? 'auto' : 'none';
    hitArea.style.cursor = selectionMode ? 'pointer' : 'default';
    svg.appendChild(hitArea);
    if (!svg.querySelector('#arrowhead')) {
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', 'arrowhead');
      marker.setAttribute('markerWidth', '10');
      marker.setAttribute('markerHeight', '10');
      marker.setAttribute('refX', '9');
      marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', '0 0, 10 3, 0 6');
      polygon.setAttribute('fill', strokeColor);
      marker.appendChild(polygon);
      defs.appendChild(marker);
      svg.appendChild(defs);
    }
  } else if (annotation.type === 'rectangle' && points.length === 2) {
    const x = Math.min(points[0].x, points[1].x);
    const y = Math.min(points[0].y, points[1].y);
    const width = Math.abs(points[1].x - points[0].x);
    const height = Math.abs(points[1].y - points[0].y);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x.toString());
    rect.setAttribute('y', y.toString());
    rect.setAttribute('width', width.toString());
    rect.setAttribute('height', height.toString());
    rect.setAttribute('stroke', strokeColor);
    rect.setAttribute('stroke-width', strokeWidth);
    rect.setAttribute('fill', 'none');
    rect.setAttribute('data-annotation-id', annotation.id);
    rect.style.pointerEvents = selectionMode ? 'stroke' : 'none';
    rect.style.cursor = selectionMode ? 'pointer' : 'default';
    svg.appendChild(rect);
    // Hit area: stroke-only so interior passes through to markups below (e.g. measurements)
    const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hitArea.setAttribute('x', x.toString());
    hitArea.setAttribute('y', y.toString());
    hitArea.setAttribute('width', width.toString());
    hitArea.setAttribute('height', height.toString());
    hitArea.setAttribute('fill', 'none');
    hitArea.setAttribute('stroke', 'transparent');
    hitArea.setAttribute('stroke-width', ANNOTATION_HIT_STROKE_WIDTH.toString());
    hitArea.setAttribute('data-annotation-id', annotation.id);
    hitArea.style.pointerEvents = selectionMode ? 'stroke' : 'none';
    hitArea.style.cursor = selectionMode ? 'pointer' : 'default';
    svg.appendChild(hitArea);
  } else if (annotation.type === 'circle' && points.length === 2) {
    const cx = (points[0].x + points[1].x) / 2;
    const cy = (points[0].y + points[1].y) / 2;
    const rx = Math.abs(points[1].x - points[0].x) / 2;
    const ry = Math.abs(points[1].y - points[0].y) / 2;
    const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    ellipse.setAttribute('cx', cx.toString());
    ellipse.setAttribute('cy', cy.toString());
    ellipse.setAttribute('rx', rx.toString());
    ellipse.setAttribute('ry', ry.toString());
    ellipse.setAttribute('stroke', strokeColor);
    ellipse.setAttribute('stroke-width', strokeWidth);
    ellipse.setAttribute('fill', 'none');
    ellipse.setAttribute('data-annotation-id', annotation.id);
    ellipse.style.pointerEvents = selectionMode ? 'stroke' : 'none';
    ellipse.style.cursor = selectionMode ? 'pointer' : 'default';
    svg.appendChild(ellipse);
    // Hit area: stroke-only so interior passes through to markups below
    const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    hitArea.setAttribute('cx', cx.toString());
    hitArea.setAttribute('cy', cy.toString());
    hitArea.setAttribute('rx', rx.toString());
    hitArea.setAttribute('ry', ry.toString());
    hitArea.setAttribute('fill', 'none');
    hitArea.setAttribute('stroke', 'transparent');
    hitArea.setAttribute('stroke-width', ANNOTATION_HIT_STROKE_WIDTH.toString());
    hitArea.setAttribute('data-annotation-id', annotation.id);
    hitArea.style.pointerEvents = selectionMode ? 'stroke' : 'none';
    hitArea.style.cursor = selectionMode ? 'pointer' : 'default';
    svg.appendChild(hitArea);
  } else if (annotation.type === 'highlight' && points.length >= 2) {
    const x = Math.min(...points.map((p) => p.x));
    const y = Math.min(...points.map((p) => p.y));
    const width = Math.max(...points.map((p) => p.x)) - x;
    const height = Math.max(...points.map((p) => p.y)) - y;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x.toString());
    rect.setAttribute('y', y.toString());
    rect.setAttribute('width', width.toString());
    rect.setAttribute('height', height.toString());
    rect.setAttribute('fill', annotation.color);
    rect.setAttribute('fill-opacity', '0.3');
    rect.setAttribute('stroke', annotation.color);
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('data-annotation-id', annotation.id);
    rect.style.pointerEvents = selectionMode ? 'auto' : 'none';
    rect.style.cursor = selectionMode ? 'pointer' : 'default';
    svg.appendChild(rect);
  }
}

export interface RenderSVGCalibrationPointsOptions {
  calibrationPoints: { x: number; y: number }[];
  viewport: { width: number; height: number; rotation?: number };
  mousePosition: { x: number; y: number } | null;
  isOrthoSnapping: boolean;
  applyOrthoSnapping: (point: { x: number; y: number }, refPoints: { x: number; y: number }[]) => { x: number; y: number };
}

/** Fixed calibration points (circles, line between two points). */
export function renderSVGCalibrationPointsCommitted(
  parent: SVGGElement,
  options: Omit<RenderSVGCalibrationPointsOptions, 'mousePosition'>
): void {
  const { calibrationPoints, viewport } = options;
  if (!viewport) return;
  const rotation = viewport.rotation ?? 0;
  const toPx = (nx: number, ny: number) =>
    baseNormToViewportPixels(nx, ny, viewport, rotation);

  calibrationPoints.forEach((point, index) => {
    const viewportPoint = toPx(point.x, point.y);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', viewportPoint.x.toString());
    circle.setAttribute('cy', viewportPoint.y.toString());
    circle.setAttribute('r', '8');
    circle.setAttribute('fill', '#ff0000');
    circle.setAttribute('stroke', '#ffffff');
    circle.setAttribute('stroke-width', '2');
    parent.appendChild(circle);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', viewportPoint.x.toString());
    text.setAttribute('y', (viewportPoint.y + 4).toString());
    text.setAttribute('fill', 'white');
    text.setAttribute('font-size', '12');
    text.setAttribute('font-family', 'Arial');
    text.setAttribute('font-weight', 'bold');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.textContent = (index + 1).toString();
    parent.appendChild(text);
  });

  if (calibrationPoints.length === 2) {
    const firstPoint = toPx(calibrationPoints[0].x, calibrationPoints[0].y);
    const secondPoint = toPx(calibrationPoints[1].x, calibrationPoints[1].y);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', firstPoint.x.toString());
    line.setAttribute('y1', firstPoint.y.toString());
    line.setAttribute('x2', secondPoint.x.toString());
    line.setAttribute('y2', secondPoint.y.toString());
    line.setAttribute('stroke', '#ff0000');
    line.setAttribute('stroke-width', '3');
    parent.appendChild(line);
    const midX = (firstPoint.x + secondPoint.x) / 2;
    const midY = (firstPoint.y + secondPoint.y) / 2;
    const distance = calculateDistance(firstPoint, secondPoint);
    const distanceText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    distanceText.setAttribute('x', midX.toString());
    distanceText.setAttribute('y', (midY - 10).toString());
    distanceText.setAttribute('fill', '#ff0000');
    distanceText.setAttribute('font-size', '14');
    distanceText.setAttribute('font-family', 'Arial');
    distanceText.setAttribute('font-weight', 'bold');
    distanceText.setAttribute('text-anchor', 'middle');
    distanceText.textContent = `${distance.toFixed(1)} px`;
    parent.appendChild(distanceText);
  }
}

/** Dashed preview from first calibration point to cursor. */
export function renderSVGCalibrationPointsEphemeral(
  parent: SVGGElement,
  options: RenderSVGCalibrationPointsOptions
): void {
  const { calibrationPoints, viewport, mousePosition, isOrthoSnapping, applyOrthoSnapping } = options;
  if (!viewport) return;

  if (calibrationPoints.length === 1 && mousePosition) {
    const rotation = viewport.rotation ?? 0;
    const toPx = (nx: number, ny: number) =>
      baseNormToViewportPixels(nx, ny, viewport, rotation);
    const firstPoint = toPx(calibrationPoints[0].x, calibrationPoints[0].y);
    const snappedMousePoint = isOrthoSnapping ? applyOrthoSnapping(mousePosition, calibrationPoints) : mousePosition;
    const snappedViewportPoint = toPx(snappedMousePoint.x, snappedMousePoint.y);
    const previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    previewLine.setAttribute('x1', firstPoint.x.toString());
    previewLine.setAttribute('y1', firstPoint.y.toString());
    previewLine.setAttribute('x2', snappedViewportPoint.x.toString());
    previewLine.setAttribute('y2', snappedViewportPoint.y.toString());
    previewLine.setAttribute('stroke', '#ff0000');
    previewLine.setAttribute('stroke-width', '2');
    previewLine.setAttribute('stroke-dasharray', '5,5');
    previewLine.setAttribute('opacity', '0.7');
    parent.appendChild(previewLine);
    const midX = (firstPoint.x + snappedViewportPoint.x) / 2;
    const midY = (firstPoint.y + snappedViewportPoint.y) / 2;
    const distance = calculateDistance(firstPoint, snappedViewportPoint);
    const distanceText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    distanceText.setAttribute('x', midX.toString());
    distanceText.setAttribute('y', (midY - 10).toString());
    distanceText.setAttribute('fill', '#ff0000');
    distanceText.setAttribute('font-size', '12');
    distanceText.setAttribute('font-family', 'Arial');
    distanceText.setAttribute('font-weight', 'bold');
    distanceText.setAttribute('text-anchor', 'middle');
    distanceText.textContent = `${distance.toFixed(1)} px`;
    parent.appendChild(distanceText);
  }
}

/** Renders calibration points and preview line/distance. */
export function renderSVGCalibrationPoints(svg: SVGSVGElement, options: RenderSVGCalibrationPointsOptions): void {
  const parent = svg as unknown as SVGGElement;
  renderSVGCalibrationPointsCommitted(parent, options);
  renderSVGCalibrationPointsEphemeral(parent, options);
}

export interface RenderRunningLengthDisplayOptions {
  runningLength: number;
  conditionColor: string;
  unit: string;
  /** Last point in normalized 0-1 coords; label is placed near it */
  lastPoint: { x: number; y: number };
}

/** Renders running length label for continuous linear drawing. */
export function renderRunningLengthDisplay(
  svg: SVGSVGElement,
  viewport: { width: number; height: number; rotation?: number },
  options: RenderRunningLengthDisplayOptions
): void {
  const { runningLength, conditionColor, unit, lastPoint } = options;
  if (!viewport) return;

  const displayValue =
    unit === 'ft' || unit === 'feet' || unit === 'LF' || unit === 'lf'
      ? formatFeetAndInches(runningLength)
      : `${runningLength.toFixed(2)} ${unit}`;

  const rotation = viewport.rotation ?? 0;
  const lp = baseNormToViewportPixels(lastPoint.x, lastPoint.y, viewport, rotation);
  const textX = lp.x + 10;
  const textY = lp.y - 10;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', (textX - 5).toString());
  rect.setAttribute('y', (textY - 20).toString());
  rect.setAttribute('width', '120');
  rect.setAttribute('height', '20');
  rect.setAttribute('fill', 'rgba(255, 255, 255, 0.9)');
  rect.setAttribute('stroke', conditionColor);
  rect.setAttribute('stroke-width', '1');
  rect.setAttribute('rx', '3');
  svg.appendChild(rect);
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', textX.toString());
  text.setAttribute('y', (textY - 5).toString());
  text.setAttribute('fill', conditionColor);
  text.setAttribute('font-size', '12');
  text.setAttribute('font-family', 'Arial');
  text.setAttribute('font-weight', 'bold');
  text.textContent = `Length: ${displayValue}`;
  svg.appendChild(text);
}

export interface RenderSVGCurrentAnnotationOptions {
  annotationTool: 'text' | 'arrow' | 'rectangle' | 'circle' | null;
  currentAnnotation: { x: number; y: number }[];
  mousePosition: { x: number; y: number } | null;
  annotationColor: string;
}

/** Renders current annotation being drawn (preview). */
export function renderSVGCurrentAnnotation(
  svg: SVGSVGElement,
  viewport: PageViewport,
  options: RenderSVGCurrentAnnotationOptions
): void {
  const { annotationTool, currentAnnotation, mousePosition, annotationColor } = options;
  if (!viewport || !annotationTool) return;

  const rotation = viewport.rotation ?? 0;
  const toPx = (nx: number, ny: number) =>
    baseNormToViewportPixels(nx, ny, { width: viewport.width, height: viewport.height }, rotation);
  const points = currentAnnotation.map((p) => toPx(p.x, p.y));

  if (['arrow', 'rectangle', 'circle'].includes(annotationTool)) {
    if (points.length === 0 && mousePosition) {
      const m = toPx(mousePosition.x, mousePosition.y);
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', m.x.toString());
      dot.setAttribute('cy', m.y.toString());
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', annotationColor);
      dot.setAttribute('opacity', '0.7');
      svg.appendChild(dot);
    } else if (points.length === 1 && mousePosition) {
      const endPoint = toPx(mousePosition.x, mousePosition.y);
      const startDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      startDot.setAttribute('cx', points[0].x.toString());
      startDot.setAttribute('cy', points[0].y.toString());
      startDot.setAttribute('r', '4');
      startDot.setAttribute('fill', annotationColor);
      svg.appendChild(startDot);
      if (annotationTool === 'arrow') {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', points[0].x.toString());
        line.setAttribute('y1', points[0].y.toString());
        line.setAttribute('x2', endPoint.x.toString());
        line.setAttribute('y2', endPoint.y.toString());
        line.setAttribute('stroke', annotationColor);
        line.setAttribute('stroke-width', '3');
        line.setAttribute('stroke-dasharray', '5,5');
        line.setAttribute('opacity', '0.7');
        svg.appendChild(line);
      } else if (annotationTool === 'rectangle') {
        const x = Math.min(points[0].x, endPoint.x);
        const y = Math.min(points[0].y, endPoint.y);
        const width = Math.abs(endPoint.x - points[0].x);
        const height = Math.abs(endPoint.y - points[0].y);
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x.toString());
        rect.setAttribute('y', y.toString());
        rect.setAttribute('width', width.toString());
        rect.setAttribute('height', height.toString());
        rect.setAttribute('stroke', annotationColor);
        rect.setAttribute('stroke-width', '3');
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke-dasharray', '5,5');
        rect.setAttribute('opacity', '0.7');
        svg.appendChild(rect);
      } else if (annotationTool === 'circle') {
        const cx = (points[0].x + endPoint.x) / 2;
        const cy = (points[0].y + endPoint.y) / 2;
        const rx = Math.abs(endPoint.x - points[0].x) / 2;
        const ry = Math.abs(endPoint.y - points[0].y) / 2;
        const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        ellipse.setAttribute('cx', cx.toString());
        ellipse.setAttribute('cy', cy.toString());
        ellipse.setAttribute('rx', rx.toString());
        ellipse.setAttribute('ry', ry.toString());
        ellipse.setAttribute('stroke', annotationColor);
        ellipse.setAttribute('stroke-width', '3');
        ellipse.setAttribute('fill', 'none');
        ellipse.setAttribute('stroke-dasharray', '5,5');
        ellipse.setAttribute('opacity', '0.7');
        svg.appendChild(ellipse);
      }
    }
  }
}

export interface RenderSVGCurrentMeasurementOptions {
  currentPage: number;
  measurementType: 'linear' | 'area' | 'volume' | 'count';
  isContinuousDrawing: boolean;
  activePoints: { x: number; y: number }[];
  pageCommittedPolylineRefs: { current: Record<number, SVGPolylineElement | null> };
  mousePosition: { x: number; y: number } | null;
  currentMeasurement: { x: number; y: number }[];
  cutoutMode: boolean;
  conditionColor: string;
  /** For linear measurements, stroke width in px. Defaults to 2. */
  conditionLineThickness?: number;
  /** Laid-out canvas CSS px; when set, used instead of viewport width/height for SVG pixel coords. */
  pixelWidth?: number;
  pixelHeight?: number;
}

export type RenderSVGCurrentMeasurementCommittedOptions = Omit<RenderSVGCurrentMeasurementOptions, 'mousePosition'>;

/** Committed geometry only (no cursor-following preview). Pair with `renderSVGCurrentMeasurementEphemeral`. */
export function renderSVGCurrentMeasurementCommitted(
  parent: SVGGElement,
  viewport: PageViewport,
  options: RenderSVGCurrentMeasurementCommittedOptions
): void {
  const {
    currentPage,
    measurementType,
    isContinuousDrawing,
    activePoints,
    pageCommittedPolylineRefs,
    currentMeasurement,
    cutoutMode,
    conditionColor,
    conditionLineThickness = 2,
    pixelWidth,
    pixelHeight,
  } = options;
  if (!viewport) return;

  const vw = pixelWidth ?? viewport.width;
  const vh = pixelHeight ?? viewport.height;
  const rotation = viewport.rotation ?? 0;
  const toPx = (nx: number, ny: number) =>
    baseNormToViewportPixels(nx, ny, { width: vw, height: vh }, rotation);
  const strokeColor = cutoutMode ? '#ff0000' : conditionColor;

  switch (measurementType) {
    case 'linear':
      if (isContinuousDrawing && activePoints.length > 0 && activePoints.length > 1) {
        const existingPolyline = pageCommittedPolylineRefs.current[currentPage];
        if (existingPolyline?.parentNode === parent) parent.removeChild(existingPolyline);
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        const pointString = activePoints
          .map((p) => {
            const pt = toPx(p.x, p.y);
            return `${pt.x},${pt.y}`;
          })
          .join(' ');
        polyline.setAttribute('points', pointString);
        polyline.setAttribute('stroke', strokeColor);
        polyline.setAttribute('stroke-width', String(conditionLineThickness));
        polyline.setAttribute('stroke-linecap', 'round');
        polyline.setAttribute('stroke-linejoin', 'round');
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('vector-effect', 'non-scaling-stroke');
        polyline.setAttribute('id', `committed-segments-${currentPage}`);
        parent.appendChild(polyline);
        pageCommittedPolylineRefs.current[currentPage] = polyline;
      }
      break;
    case 'area':
      if (currentMeasurement.length >= 3) {
        const areaPolygonId = `area-polygon-${currentPage}`;
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute(
          'points',
          currentMeasurement
            .map((p) => {
              const pt = toPx(p.x, p.y);
              return `${pt.x},${pt.y}`;
            })
            .join(' ')
        );
        polygon.setAttribute('fill', cutoutMode ? 'none' : conditionColor + '40');
        polygon.setAttribute('stroke', 'none');
        polygon.setAttribute('id', areaPolygonId);
        polygon.setAttribute('pointer-events', 'none');
        parent.appendChild(polygon);
      }
      break;
    case 'volume':
      if (currentMeasurement.length >= 3) {
        const volumePolygonId = `volume-polygon-${currentPage}`;
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute(
          'points',
          currentMeasurement
            .map((p) => {
              const pt = toPx(p.x, p.y);
              return `${pt.x},${pt.y}`;
            })
            .join(' ')
        );
        polygon.setAttribute('fill', cutoutMode ? 'none' : conditionColor + '40');
        polygon.setAttribute('stroke', 'none');
        polygon.setAttribute('id', volumePolygonId);
        polygon.setAttribute('pointer-events', 'none');
        parent.appendChild(polygon);
      }
      break;
    case 'count':
      if (currentMeasurement.length >= 1) {
        const point = toPx(currentMeasurement[0].x, currentMeasurement[0].y);
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', point.x.toString());
        circle.setAttribute('cy', point.y.toString());
        circle.setAttribute('r', '12');
        circle.setAttribute('fill', conditionColor + '80');
        circle.setAttribute('stroke', 'white');
        circle.setAttribute('stroke-width', '3');
        circle.setAttribute('stroke-dasharray', '5,5');
        parent.appendChild(circle);
        const previewText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        previewText.setAttribute('x', point.x.toString());
        previewText.setAttribute('y', (point.y + 4).toString());
        previewText.setAttribute('fill', 'white');
        previewText.setAttribute('font-size', '14');
        previewText.setAttribute('font-family', 'Arial');
        previewText.setAttribute('font-weight', 'bold');
        previewText.setAttribute('text-anchor', 'middle');
        previewText.setAttribute('dominant-baseline', 'middle');
        previewText.setAttribute('stroke', 'black');
        previewText.setAttribute('stroke-width', '0.5');
        previewText.textContent = '1';
        parent.appendChild(previewText);
      }
      break;
  }
}

/** Cursor-following preview (dashed polylines, etc.). Re-rendered often via rAF without rebuilding committed markups. */
export function renderSVGCurrentMeasurementEphemeral(
  parent: SVGGElement,
  viewport: PageViewport,
  options: RenderSVGCurrentMeasurementOptions
): void {
  const {
    currentPage,
    measurementType,
    isContinuousDrawing,
    activePoints,
    mousePosition,
    currentMeasurement,
    cutoutMode,
    conditionColor,
    conditionLineThickness = 2,
    pixelWidth,
    pixelHeight,
  } = options;
  if (!viewport) return;

  const vw = pixelWidth ?? viewport.width;
  const vh = pixelHeight ?? viewport.height;
  const rotation = viewport.rotation ?? 0;
  const toPx = (nx: number, ny: number) =>
    baseNormToViewportPixels(nx, ny, { width: vw, height: vh }, rotation);
  const strokeColor = cutoutMode ? '#ff0000' : conditionColor;
  const previewId = `linear-preview-${currentPage}`;

  switch (measurementType) {
    case 'linear':
      if (isContinuousDrawing && activePoints.length > 0) {
        const previewPolyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        let pointString = activePoints
          .map((p) => {
            const pt = toPx(p.x, p.y);
            return `${pt.x},${pt.y}`;
          })
          .join(' ');
        if (mousePosition) {
          const m = toPx(mousePosition.x, mousePosition.y);
          pointString += ` ${m.x},${m.y}`;
        }
        previewPolyline.setAttribute('points', pointString);
        previewPolyline.setAttribute('stroke', conditionColor);
        previewPolyline.setAttribute('stroke-width', String(conditionLineThickness));
        previewPolyline.setAttribute('stroke-linecap', 'round');
        previewPolyline.setAttribute('stroke-linejoin', 'round');
        previewPolyline.setAttribute('fill', 'none');
        previewPolyline.setAttribute('stroke-dasharray', '5,5');
        previewPolyline.setAttribute('vector-effect', 'non-scaling-stroke');
        previewPolyline.setAttribute('id', previewId);
        previewPolyline.setAttribute('pointer-events', 'none');
        parent.appendChild(previewPolyline);
      } else if (currentMeasurement.length > 0) {
        const nonContinuousPreviewId = `linear-noncontinuous-preview-${currentPage}`;
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        let pointString = currentMeasurement
          .map((p) => {
            const pt = toPx(p.x, p.y);
            return `${pt.x},${pt.y}`;
          })
          .join(' ');
        if (mousePosition) {
          const m = toPx(mousePosition.x, mousePosition.y);
          pointString += ` ${m.x},${m.y}`;
        }
        polyline.setAttribute('points', pointString);
        polyline.setAttribute('stroke', strokeColor);
        polyline.setAttribute('stroke-width', String(conditionLineThickness));
        polyline.setAttribute('stroke-linecap', 'round');
        polyline.setAttribute('stroke-linejoin', 'round');
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke-dasharray', '5,5');
        polyline.setAttribute('vector-effect', 'non-scaling-stroke');
        polyline.setAttribute('id', nonContinuousPreviewId);
        polyline.setAttribute('pointer-events', 'none');
        parent.appendChild(polyline);
      }
      break;
    case 'area':
      if (currentMeasurement.length > 0) {
        const areaPreviewId = `area-preview-${currentPage}`;
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        let pointString = currentMeasurement
          .map((p) => {
            const pt = toPx(p.x, p.y);
            return `${pt.x},${pt.y}`;
          })
          .join(' ');
        if (mousePosition) {
          const m = toPx(mousePosition.x, mousePosition.y);
          pointString += ` ${m.x},${m.y}`;
        }
        polyline.setAttribute('points', pointString);
        polyline.setAttribute('stroke', strokeColor);
        polyline.setAttribute('stroke-width', '3');
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke-dasharray', '5,5');
        polyline.setAttribute('id', areaPreviewId);
        polyline.setAttribute('pointer-events', 'none');
        polyline.setAttribute('vector-effect', 'non-scaling-stroke');
        parent.appendChild(polyline);
      }
      break;
    case 'volume':
      if (currentMeasurement.length > 0) {
        const volumePreviewId = `volume-preview-${currentPage}`;
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        let pointString = currentMeasurement
          .map((p) => {
            const pt = toPx(p.x, p.y);
            return `${pt.x},${pt.y}`;
          })
          .join(' ');
        if (mousePosition) {
          const m = toPx(mousePosition.x, mousePosition.y);
          pointString += ` ${m.x},${m.y}`;
        }
        polyline.setAttribute('points', pointString);
        polyline.setAttribute('stroke', strokeColor);
        polyline.setAttribute('stroke-width', '3');
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke-dasharray', '5,5');
        polyline.setAttribute('id', volumePreviewId);
        polyline.setAttribute('pointer-events', 'none');
        polyline.setAttribute('vector-effect', 'non-scaling-stroke');
        parent.appendChild(polyline);
      }
      break;
    default:
      break;
  }
}

/** @deprecated Prefer committed + ephemeral split. Single-layer fallback (tests / legacy). */
export function renderSVGCurrentMeasurement(
  svg: SVGSVGElement,
  viewport: PageViewport,
  options: RenderSVGCurrentMeasurementOptions
): void {
  const parent = svg as unknown as SVGGElement;
  renderSVGCurrentMeasurementCommitted(parent, viewport, options);
  renderSVGCurrentMeasurementEphemeral(parent, viewport, options);
}
