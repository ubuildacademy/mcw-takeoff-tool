/**
 * Magic-wand room fill: click a point inside an enclosed region on a rendered
 * plan raster, get back a simplified polygon of that region's boundary.
 *
 * Pipeline: scanline flood fill over "light" pixels (walls/linework are dark
 * and act as barriers) → Moore-neighbour boundary trace of the filled mask →
 * Ramer-Douglas-Peucker simplification. Pure raster math — no ML, fully
 * deterministic, and the polygon lands on the *inside face* of the walls,
 * which is the correct floor-area semantic.
 *
 * Leak safety: a region that touches the raster edge or swallows more than
 * `maxRegionFraction` of the page almost certainly escaped through a door
 * opening or missing wall — callers get a typed error instead of a garbage
 * whole-sheet polygon.
 */

export interface RasterLike {
  /** RGBA bytes, 4 per pixel (ImageData.data layout). */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface MagicWandOptions {
  /** Pixels with luminance below this are boundaries (walls/linework). */
  darkThreshold?: number;
  /** Fill covering more than this fraction of the raster = leak. */
  maxRegionFraction?: number;
  /** Fill with fewer pixels than this = too small (clicked inside linework/text). */
  minRegionPixels?: number;
  /** RDP simplification tolerance in pixels. */
  simplifyEpsilon?: number;
}

export type MagicWandFailure =
  | { ok: false; reason: 'on-boundary' }
  | { ok: false; reason: 'leaked' }
  | { ok: false; reason: 'too-small' };

export type MagicWandResult =
  | { ok: true; polygon: Array<{ x: number; y: number }>; regionPixels: number }
  | MagicWandFailure;

const DEFAULTS: Required<MagicWandOptions> = {
  darkThreshold: 160,
  maxRegionFraction: 0.35,
  minRegionPixels: 64,
  simplifyEpsilon: 2.5,
};

function luminance(data: Uint8ClampedArray, idx: number): number {
  // Treat transparent pixels as white (PDF pages render opaque; belt+braces).
  if (data[idx + 3] < 8) return 255;
  return (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
}

/**
 * Scanline flood fill from (sx, sy) across light pixels.
 * Returns the filled mask (1 = region) plus pixel count and edge contact.
 */
export function floodFillMask(
  raster: RasterLike,
  sx: number,
  sy: number,
  darkThreshold: number
): { mask: Uint8Array; count: number; touchedEdge: boolean } {
  const { data, width: w, height: h } = raster;
  const mask = new Uint8Array(w * h);
  let count = 0;
  let touchedEdge = false;

  const isFillable = (x: number, y: number): boolean =>
    mask[y * w + x] === 0 && luminance(data, (y * w + x) * 4) >= darkThreshold;

  if (sx < 0 || sy < 0 || sx >= w || sy >= h || !isFillable(sx, sy)) {
    return { mask, count: 0, touchedEdge: false };
  }

  // Scanline stack: [x, y] spans seeded above/below each filled run.
  const stack: Array<[number, number]> = [[sx, sy]];
  while (stack.length > 0) {
    const [px, py] = stack.pop() as [number, number];
    if (!isFillable(px, py)) continue;

    let x0 = px;
    while (x0 > 0 && isFillable(x0 - 1, py)) x0--;
    let x1 = px;
    while (x1 < w - 1 && isFillable(x1 + 1, py)) x1++;

    if (x0 === 0 || x1 === w - 1 || py === 0 || py === h - 1) touchedEdge = true;

    for (let x = x0; x <= x1; x++) {
      mask[py * w + x] = 1;
      count++;
    }
    for (const ny of [py - 1, py + 1]) {
      if (ny < 0 || ny >= h) continue;
      let x = x0;
      while (x <= x1) {
        if (isFillable(x, ny)) {
          stack.push([x, ny]);
          // Skip the rest of this fillable run; the scanline pass covers it.
          while (x <= x1 && isFillable(x, ny)) x++;
        } else {
          x++;
        }
      }
    }
  }

  return { mask, count, touchedEdge };
}

/**
 * Moore-neighbour boundary trace (clockwise) of the mask's outer contour.
 * Interior holes (text, fixtures) are ignored — only the outer ring returns.
 */
export function traceBoundary(mask: Uint8Array, w: number, h: number): Array<{ x: number; y: number }> {
  // Find the topmost-left region pixel: guaranteed on the outer boundary.
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) {
      start = i;
      break;
    }
  }
  if (start === -1) return [];

  const startX = start % w;
  const startY = (start / w) | 0;
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;

  // Moore neighbourhood, clockwise from west.
  const DIRS = [
    [-1, 0], [-1, -1], [0, -1], [1, -1],
    [1, 0], [1, 1], [0, 1], [-1, 1],
  ] as const;

  const contour: Array<{ x: number; y: number }> = [];
  let cx = startX;
  let cy = startY;
  // Backtrack starts west of the start pixel (we scanned row-major, so west is outside).
  let backtrackDir = 0;
  const maxSteps = mask.length * 4;
  let steps = 0;

  do {
    contour.push({ x: cx, y: cy });
    // Search clockwise starting just after the backtrack direction.
    let found = false;
    for (let i = 0; i < 8; i++) {
      const dirIdx = (backtrackDir + 1 + i) % 8;
      const nx = cx + DIRS[dirIdx][0];
      const ny = cy + DIRS[dirIdx][1];
      if (inside(nx, ny)) {
        // New backtrack: direction pointing back at the pixel we came from.
        backtrackDir = (dirIdx + 4) % 8;
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }
    if (!found) break; // isolated single pixel
    steps++;
  } while ((cx !== startX || cy !== startY) && steps < maxSteps);

  return contour;
}

/** Ramer-Douglas-Peucker polyline simplification. */
export function rdpSimplify(
  points: Array<{ x: number; y: number }>,
  epsilon: number
): Array<{ x: number; y: number }> {
  if (points.length <= 3) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    const pa = points[a];
    const pb = points[b];
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1;
    let maxDist = 0;
    let maxIdx = -1;
    for (let i = a + 1; i < b; i++) {
      const p = points[i];
      const dist = Math.abs(dy * p.x - dx * p.y + pb.x * pa.y - pb.y * pa.x) / len;
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([a, maxIdx], [maxIdx, b]);
    }
  }

  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

/** Full pipeline: click → region polygon (raster pixel coords) or typed failure. */
export function magicWandPolygon(
  raster: RasterLike,
  clickX: number,
  clickY: number,
  options: MagicWandOptions = {}
): MagicWandResult {
  const opts = { ...DEFAULTS, ...options };
  const sx = Math.round(clickX);
  const sy = Math.round(clickY);
  const { width: w, height: h } = raster;

  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { ok: false, reason: 'on-boundary' };
  if (luminance(raster.data, (sy * w + sx) * 4) < opts.darkThreshold) {
    return { ok: false, reason: 'on-boundary' };
  }

  const { mask, count, touchedEdge } = floodFillMask(raster, sx, sy, opts.darkThreshold);
  if (count === 0) return { ok: false, reason: 'on-boundary' };
  if (touchedEdge || count > w * h * opts.maxRegionFraction) {
    return { ok: false, reason: 'leaked' };
  }
  if (count < opts.minRegionPixels) return { ok: false, reason: 'too-small' };

  const contour = traceBoundary(mask, w, h);
  if (contour.length < 3) return { ok: false, reason: 'too-small' };

  // Drop the duplicated closing point before simplification, keep ring order.
  const polygon = rdpSimplify(contour, opts.simplifyEpsilon);
  if (polygon.length < 3) return { ok: false, reason: 'too-small' };

  return { ok: true, polygon, regionPixels: count };
}
