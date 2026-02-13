/**
 * Pure SVG renderer helpers for PDFViewer.
 * Used for selection box, point-in-polygon checks, and markup rendering.
 */
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';

/** Stroke width for annotation hit areas (rect/circle); stroke-only so interior passes through. */
const ANNOTATION_HIT_STROKE_WIDTH = 12;
import type { Measurement, SelectionBox } from '../PDFViewer.types';
import type { Annotation } from '../../types';
import { formatFeetAndInches } from '../../lib/utils';
import { calculateDistance } from '../../utils/commonUtils';

export interface RenderSVGMeasurementOptions {
  rotation: number;
  selectedMarkupIds: string[];
  getConditionColor: (id: string, fallback?: string) => string;
  getConditionLineThickness?: (id: string) => number;
  selectionMode: boolean;
  /** When false, value labels (LF, SF, CY, etc.) on completed measurements are hidden. Defaults to true. */
  showLabel?: boolean;
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
  svg.appendChild(rect);
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
export function renderSVGCurrentCutout(
  svg: SVGSVGElement,
  viewport: { width: number; height: number },
  currentCutout: Point[],
  mousePosition: Point | null
): void {
  if (!viewport || currentCutout.length === 0) return;

  // Dashed polyline showing committed points + mouse position (matches area/volume preview)
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  let pointString = currentCutout
    .map((p) => `${p.x * viewport.width},${p.y * viewport.height}`)
    .join(' ');
  if (mousePosition) {
    pointString += ` ${mousePosition.x * viewport.width},${mousePosition.y * viewport.height}`;
  }
  polyline.setAttribute('points', pointString);
  polyline.setAttribute('stroke', '#ff0000');
  polyline.setAttribute('stroke-width', '2');
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke-dasharray', '5,5');
  polyline.setAttribute('vector-effect', 'non-scaling-stroke');
  polyline.setAttribute('pointer-events', 'none');
  svg.appendChild(polyline);

  // Semi-transparent fill polygon (no stroke) — same pattern as area/volume preview
  if (currentCutout.length >= 3) {
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const polygonPointString = currentCutout
      .map((p) => `${p.x * viewport.width},${p.y * viewport.height}`)
      .join(' ');
    polygon.setAttribute('points', polygonPointString);
    polygon.setAttribute('fill', 'rgba(255, 0, 0, 0.15)');
    polygon.setAttribute('stroke', 'none');
    polygon.setAttribute('pointer-events', 'none');
    svg.appendChild(polygon);
  }
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

/** Renders crosshair at position (position in normalized 0–1 coordinates). */
export function renderSVGCrosshair(
  svg: SVGSVGElement,
  position: Point,
  viewport: { width: number; height: number },
  isCalibrating: boolean = false,
  options?: CrosshairOptions
): void {
  if (!position || !viewport) return;
  const vx = position.x * viewport.width;
  const vy = position.y * viewport.height;
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

  const { rotation, selectedMarkupIds, getConditionColor, getConditionLineThickness, selectionMode, showLabel = true } = options;
  const currentViewport = viewport;
  const _baseViewport = page.getViewport({ scale: 1, rotation: 0 });

  const transformedPoints = points.map((point) => {
    const normalizedX = point.x;
    const normalizedY = point.y;
    let canvasX: number, canvasY: number;
    if (rotation === 0) {
      canvasX = normalizedX * currentViewport.width;
      canvasY = normalizedY * currentViewport.height;
    } else if (rotation === 90) {
      canvasX = currentViewport.width * (1 - normalizedY);
      canvasY = currentViewport.height * normalizedX;
    } else if (rotation === 180) {
      canvasX = currentViewport.width * (1 - normalizedX);
      canvasY = currentViewport.height * (1 - normalizedY);
    } else if (rotation === 270) {
      canvasX = currentViewport.width * normalizedY;
      canvasY = currentViewport.height * (1 - normalizedX);
    } else {
      canvasX = normalizedX * currentViewport.width;
      canvasY = normalizedY * currentViewport.height;
    }
    return { x: canvasX, y: canvasY };
  });

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
              const cutoutPointString = cutout.points.map((p) => `${p.x * currentViewport.width},${p.y * currentViewport.height}`).join(' ');
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
              const cutoutPointString = cutout.points.map((p) => `${p.x * currentViewport.width},${p.y * currentViewport.height}`).join(' ');
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

  const points = annotation.points.map((p) => {
    const normalizedX = p.x;
    const normalizedY = p.y;
    let canvasX: number, canvasY: number;
    if (rotation === 0) {
      canvasX = normalizedX * currentViewport.width;
      canvasY = normalizedY * currentViewport.height;
    } else if (rotation === 90) {
      canvasX = currentViewport.width * (1 - normalizedY);
      canvasY = currentViewport.height * normalizedX;
    } else if (rotation === 180) {
      canvasX = currentViewport.width * (1 - normalizedX);
      canvasY = currentViewport.height * (1 - normalizedY);
    } else if (rotation === 270) {
      canvasX = currentViewport.width * normalizedY;
      canvasY = currentViewport.height * (1 - normalizedX);
    } else {
      canvasX = normalizedX * currentViewport.width;
      canvasY = normalizedY * currentViewport.height;
    }
    return { x: canvasX, y: canvasY };
  });

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
  viewport: { width: number; height: number };
  mousePosition: { x: number; y: number } | null;
  isOrthoSnapping: boolean;
  applyOrthoSnapping: (point: { x: number; y: number }, refPoints: { x: number; y: number }[]) => { x: number; y: number };
}

/** Renders calibration points and preview line/distance. */
export function renderSVGCalibrationPoints(svg: SVGSVGElement, options: RenderSVGCalibrationPointsOptions): void {
  const { calibrationPoints, viewport, mousePosition, isOrthoSnapping, applyOrthoSnapping } = options;
  if (!viewport) return;

  calibrationPoints.forEach((point, index) => {
    const viewportPoint = { x: point.x * viewport.width, y: point.y * viewport.height };
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', viewportPoint.x.toString());
    circle.setAttribute('cy', viewportPoint.y.toString());
    circle.setAttribute('r', '8');
    circle.setAttribute('fill', '#ff0000');
    circle.setAttribute('stroke', '#ffffff');
    circle.setAttribute('stroke-width', '2');
    svg.appendChild(circle);
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
    svg.appendChild(text);
  });

  if (calibrationPoints.length === 1 && mousePosition) {
    const firstPoint = { x: calibrationPoints[0].x * viewport.width, y: calibrationPoints[0].y * viewport.height };
    const snappedMousePoint = isOrthoSnapping ? applyOrthoSnapping(mousePosition, calibrationPoints) : mousePosition;
    const snappedViewportPoint = { x: snappedMousePoint.x * viewport.width, y: snappedMousePoint.y * viewport.height };
    const previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    previewLine.setAttribute('x1', firstPoint.x.toString());
    previewLine.setAttribute('y1', firstPoint.y.toString());
    previewLine.setAttribute('x2', snappedViewportPoint.x.toString());
    previewLine.setAttribute('y2', snappedViewportPoint.y.toString());
    previewLine.setAttribute('stroke', '#ff0000');
    previewLine.setAttribute('stroke-width', '2');
    previewLine.setAttribute('stroke-dasharray', '5,5');
    previewLine.setAttribute('opacity', '0.7');
    svg.appendChild(previewLine);
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
    svg.appendChild(distanceText);
  }

  if (calibrationPoints.length === 2) {
    const firstPoint = { x: calibrationPoints[0].x * viewport.width, y: calibrationPoints[0].y * viewport.height };
    const secondPoint = { x: calibrationPoints[1].x * viewport.width, y: calibrationPoints[1].y * viewport.height };
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', firstPoint.x.toString());
    line.setAttribute('y1', firstPoint.y.toString());
    line.setAttribute('x2', secondPoint.x.toString());
    line.setAttribute('y2', secondPoint.y.toString());
    line.setAttribute('stroke', '#ff0000');
    line.setAttribute('stroke-width', '3');
    svg.appendChild(line);
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
    svg.appendChild(distanceText);
  }
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
  viewport: { width: number; height: number },
  options: RenderRunningLengthDisplayOptions
): void {
  const { runningLength, conditionColor, unit, lastPoint } = options;
  if (!viewport) return;

  const displayValue =
    unit === 'ft' || unit === 'feet' || unit === 'LF' || unit === 'lf'
      ? formatFeetAndInches(runningLength)
      : `${runningLength.toFixed(2)} ${unit}`;

  const textX = lastPoint.x * viewport.width + 10;
  const textY = lastPoint.y * viewport.height - 10;
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

  const points = currentAnnotation.map((p) => ({ x: p.x * viewport.width, y: p.y * viewport.height }));

  if (['arrow', 'rectangle', 'circle'].includes(annotationTool)) {
    if (points.length === 0 && mousePosition) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', (mousePosition.x * viewport.width).toString());
      dot.setAttribute('cy', (mousePosition.y * viewport.height).toString());
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', annotationColor);
      dot.setAttribute('opacity', '0.7');
      svg.appendChild(dot);
    } else if (points.length === 1 && mousePosition) {
      const endPoint = { x: mousePosition.x * viewport.width, y: mousePosition.y * viewport.height };
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
}

/** Renders current measurement being drawn (preview polylines, polygons, count circle). */
export function renderSVGCurrentMeasurement(
  svg: SVGSVGElement,
  viewport: PageViewport,
  options: RenderSVGCurrentMeasurementOptions
): void {
  const {
    currentPage,
    measurementType,
    isContinuousDrawing,
    activePoints,
    pageCommittedPolylineRefs,
    mousePosition,
    currentMeasurement,
    cutoutMode,
    conditionColor,
    conditionLineThickness = 2,
  } = options;
  if (!viewport) return;

  const strokeColor = cutoutMode ? '#ff0000' : conditionColor;
  const previewId = `linear-preview-${currentPage}`;
  const existingPreview = svg.querySelector(`#${previewId}`);
  if (existingPreview?.parentNode === svg) svg.removeChild(existingPreview);
  svg.querySelectorAll('polyline').forEach((polyline) => {
    const id = polyline.getAttribute('id');
    if (id?.startsWith('linear-preview-') && id !== previewId && polyline.parentNode === svg) {
      svg.removeChild(polyline);
    }
  });

  switch (measurementType) {
    case 'linear':
      if (isContinuousDrawing && activePoints.length > 0) {
        if (activePoints.length > 1) {
          const existingPolyline = pageCommittedPolylineRefs.current[currentPage];
          if (existingPolyline?.parentNode === svg) svg.removeChild(existingPolyline);
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          const pointString = activePoints.map((p) => `${p.x * viewport.width},${p.y * viewport.height}`).join(' ');
          polyline.setAttribute('points', pointString);
          polyline.setAttribute('stroke', strokeColor);
          polyline.setAttribute('stroke-width', String(conditionLineThickness));
          polyline.setAttribute('stroke-linecap', 'round');
          polyline.setAttribute('stroke-linejoin', 'round');
          polyline.setAttribute('fill', 'none');
          polyline.setAttribute('vector-effect', 'non-scaling-stroke');
          polyline.setAttribute('id', `committed-segments-${currentPage}`);
          svg.appendChild(polyline);
          pageCommittedPolylineRefs.current[currentPage] = polyline;
        }
        if (activePoints.length > 0) {
          const previewPolyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          let pointString = activePoints.map((p) => `${p.x * viewport.width},${p.y * viewport.height}`).join(' ');
          if (mousePosition) {
            pointString += ` ${mousePosition.x * viewport.width},${mousePosition.y * viewport.height}`;
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
          svg.appendChild(previewPolyline);
        }
      } else if (currentMeasurement.length > 0) {
        const nonContinuousPreviewId = `linear-noncontinuous-preview-${currentPage}`;
        const existingNonContinuous = svg.querySelector(`#${nonContinuousPreviewId}`);
        if (existingNonContinuous?.parentNode === svg) svg.removeChild(existingNonContinuous);
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        let pointString = currentMeasurement.map((p) => `${p.x * viewport.width},${p.y * viewport.height}`).join(' ');
        if (mousePosition) {
          pointString += ` ${mousePosition.x * viewport.width},${mousePosition.y * viewport.height}`;
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
        svg.appendChild(polyline);
      }
      break;
    case 'area':
      if (currentMeasurement.length > 0) {
        const areaPreviewId = `area-preview-${currentPage}`;
        const areaPolygonId = `area-polygon-${currentPage}`;
        [areaPreviewId, areaPolygonId].forEach((id) => {
          const el = svg.querySelector(`#${id}`);
          if (el?.parentNode === svg) svg.removeChild(el);
        });
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        let pointString = currentMeasurement.map((p) => `${p.x * viewport.width},${p.y * viewport.height}`).join(' ');
        if (mousePosition) {
          pointString += ` ${mousePosition.x * viewport.width},${mousePosition.y * viewport.height}`;
        }
        polyline.setAttribute('points', pointString);
        polyline.setAttribute('stroke', strokeColor);
        polyline.setAttribute('stroke-width', '3');
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke-dasharray', '5,5');
        polyline.setAttribute('id', areaPreviewId);
        polyline.setAttribute('pointer-events', 'none');
        polyline.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.appendChild(polyline);
        if (currentMeasurement.length >= 3) {
          const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          polygon.setAttribute(
            'points',
            currentMeasurement.map((p) => `${p.x * viewport.width},${p.y * viewport.height}`).join(' ')
          );
          polygon.setAttribute('fill', cutoutMode ? 'none' : conditionColor + '40');
          polygon.setAttribute('stroke', 'none');
          polygon.setAttribute('id', areaPolygonId);
          polygon.setAttribute('pointer-events', 'none');
          svg.appendChild(polygon);
        }
      }
      break;
    case 'volume':
      if (currentMeasurement.length > 0) {
        const volumePreviewId = `volume-preview-${currentPage}`;
        const volumePolygonId = `volume-polygon-${currentPage}`;
        [volumePreviewId, volumePolygonId].forEach((id) => {
          const el = svg.querySelector(`#${id}`);
          if (el?.parentNode === svg) svg.removeChild(el);
        });
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        let pointString = currentMeasurement.map((p) => `${p.x * viewport.width},${p.y * viewport.height}`).join(' ');
        if (mousePosition) {
          pointString += ` ${mousePosition.x * viewport.width},${mousePosition.y * viewport.height}`;
        }
        polyline.setAttribute('points', pointString);
        polyline.setAttribute('stroke', strokeColor);
        polyline.setAttribute('stroke-width', '3');
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke-dasharray', '5,5');
        polyline.setAttribute('id', volumePreviewId);
        polyline.setAttribute('pointer-events', 'none');
        polyline.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.appendChild(polyline);
        if (currentMeasurement.length >= 3) {
          const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          polygon.setAttribute(
            'points',
            currentMeasurement.map((p) => `${p.x * viewport.width},${p.y * viewport.height}`).join(' ')
          );
          polygon.setAttribute('fill', cutoutMode ? 'none' : conditionColor + '40');
          polygon.setAttribute('stroke', 'none');
          polygon.setAttribute('id', volumePolygonId);
          polygon.setAttribute('pointer-events', 'none');
          svg.appendChild(polygon);
        }
      }
      break;
    case 'count':
      if (currentMeasurement.length >= 1) {
        const point = { x: currentMeasurement[0].x * viewport.width, y: currentMeasurement[0].y * viewport.height };
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', point.x.toString());
        circle.setAttribute('cy', point.y.toString());
        circle.setAttribute('r', '12');
        circle.setAttribute('fill', conditionColor + '80');
        circle.setAttribute('stroke', 'white');
        circle.setAttribute('stroke-width', '3');
        circle.setAttribute('stroke-dasharray', '5,5');
        svg.appendChild(circle);
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
        svg.appendChild(previewText);
      }
      break;
  }
}
