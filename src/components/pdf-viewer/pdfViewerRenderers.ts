/**
 * Pure SVG renderer helpers for PDFViewer.
 * Used for selection box and point-in-polygon checks.
 */

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

export interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
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

/** Point in normalized (0–1) or viewport coordinates */
export interface Point {
  x: number;
  y: number;
}

/** Renders the current cut-out preview (polyline + optional polygon) */
export function renderSVGCurrentCutout(
  svg: SVGSVGElement,
  viewport: { width: number; height: number },
  currentCutout: Point[],
  mousePosition: Point | null
): void {
  if (!viewport || currentCutout.length === 0) return;

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
  polyline.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(polyline);

  if (currentCutout.length >= 3) {
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const polygonPointString = currentCutout
      .map((p) => `${p.x * viewport.width},${p.y * viewport.height}`)
      .join(' ');
    polygon.setAttribute('points', polygonPointString);
    polygon.setAttribute('fill', 'none');
    polygon.setAttribute('stroke', '#ff0000');
    polygon.setAttribute('stroke-width', '2');
    svg.appendChild(polygon);
  }
}

/** Renders crosshair at position (position in normalized 0–1 coordinates) */
export function renderSVGCrosshair(
  svg: SVGSVGElement,
  position: Point,
  viewport: { width: number; height: number },
  isCalibrating: boolean = false
): void {
  if (!position || !viewport) return;
  const vx = position.x * viewport.width;
  const vy = position.y * viewport.height;
  if (typeof vx !== 'number' || typeof vy !== 'number') return;

  const crosshairSize = isCalibrating ? 30 : 35;
  const strokeColor = isCalibrating ? 'rgba(255, 0, 0, 0.9)' : 'rgba(0, 0, 0, 0.8)';
  const strokeWidth = isCalibrating ? '2' : '1';
  const dotColor = isCalibrating ? 'rgba(255, 0, 0, 1)' : 'rgba(0, 0, 0, 0.9)';
  const dotRadius = isCalibrating ? '3' : '2';

  const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  hLine.setAttribute('x1', String(vx - crosshairSize));
  hLine.setAttribute('y1', String(vy));
  hLine.setAttribute('x2', String(vx + crosshairSize));
  hLine.setAttribute('y2', String(vy));
  hLine.setAttribute('stroke', strokeColor);
  hLine.setAttribute('stroke-width', strokeWidth);
  hLine.setAttribute('stroke-linecap', 'round');
  svg.appendChild(hLine);

  const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  vLine.setAttribute('x1', String(vx));
  vLine.setAttribute('y1', String(vy - crosshairSize));
  vLine.setAttribute('x2', String(vx));
  vLine.setAttribute('y2', String(vy + crosshairSize));
  vLine.setAttribute('stroke', strokeColor);
  vLine.setAttribute('stroke-width', strokeWidth);
  vLine.setAttribute('stroke-linecap', 'round');
  svg.appendChild(vLine);

  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', String(vx));
  dot.setAttribute('cy', String(vy));
  dot.setAttribute('r', dotRadius);
  dot.setAttribute('fill', dotColor);
  dot.setAttribute('stroke', isCalibrating ? 'rgba(255, 255, 255, 0.8)' : 'none');
  dot.setAttribute('stroke-width', '1');
  svg.appendChild(dot);
}
