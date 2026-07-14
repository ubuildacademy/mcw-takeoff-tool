import { describe, it, expect } from 'vitest';
import {
  floodFillMask,
  magicWandPolygon,
  rdpSimplify,
  traceBoundary,
  type RasterLike,
} from './floodFillRoom';

/** Build a white raster and draw black rectangles (walls) onto it. */
function makeRaster(w: number, h: number): RasterLike & {
  drawRect: (x0: number, y0: number, x1: number, y1: number, thickness?: number) => void;
  drawBlob: (x0: number, y0: number, x1: number, y1: number) => void;
} {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 255;
    data[i * 4 + 1] = 255;
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = 255;
  }
  const setDark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
  };
  return {
    data,
    width: w,
    height: h,
    // Rectangle outline (room walls)
    drawRect(x0, y0, x1, y1, thickness = 2) {
      for (let t = 0; t < thickness; t++) {
        for (let x = x0; x <= x1; x++) {
          setDark(x, y0 + t);
          setDark(x, y1 - t);
        }
        for (let y = y0; y <= y1; y++) {
          setDark(x0 + t, y);
          setDark(x1 - t, y);
        }
      }
    },
    // Solid block (text/fixture inside a room)
    drawBlob(x0, y0, x1, y1) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) setDark(x, y);
      }
    },
  };
}

describe('floodFillMask', () => {
  it('fills an enclosed room and stops at walls', () => {
    const r = makeRaster(100, 100);
    r.drawRect(10, 10, 89, 89);
    const { count, touchedEdge } = floodFillMask(r, 50, 50, 160);
    // Interior ≈ (89-10-4+1)² area inside 2px walls
    expect(count).toBeGreaterThan(70 * 70);
    expect(count).toBeLessThan(80 * 80);
    expect(touchedEdge).toBe(false);
  });

  it('reports edge contact when the region is not enclosed', () => {
    const r = makeRaster(100, 100); // no walls at all
    const { touchedEdge } = floodFillMask(r, 50, 50, 160);
    expect(touchedEdge).toBe(true);
  });

  it('returns zero when clicking on a wall pixel', () => {
    const r = makeRaster(100, 100);
    r.drawRect(10, 10, 89, 89);
    const { count } = floodFillMask(r, 10, 50, 160);
    expect(count).toBe(0);
  });

  it('flows around interior islands (text) without filling them', () => {
    const r = makeRaster(100, 100);
    r.drawRect(10, 10, 89, 89);
    r.drawBlob(40, 40, 60, 60); // "room label"
    const { mask, count } = floodFillMask(r, 20, 20, 160);
    expect(count).toBeGreaterThan(0);
    expect(mask[50 * 100 + 50]).toBe(0); // island not filled
    expect(mask[20 * 100 + 80]).toBe(1); // far side reached around the island
  });
});

describe('traceBoundary + rdpSimplify', () => {
  it('traces a filled rectangle and simplifies to ~4 corners', () => {
    const r = makeRaster(120, 100);
    r.drawRect(10, 10, 109, 89);
    const { mask } = floodFillMask(r, 60, 50, 160);
    const contour = traceBoundary(mask, 120, 100);
    expect(contour.length).toBeGreaterThan(100); // pixel-level ring
    const simplified = rdpSimplify(contour, 2.5);
    expect(simplified.length).toBeLessThanOrEqual(8);
    // Corners near the wall inner face (walls 2px thick from 10..109)
    const xs = simplified.map((p) => p.x);
    const ys = simplified.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(11);
    expect(Math.max(...xs)).toBeLessThanOrEqual(108);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(11);
    expect(Math.max(...ys)).toBeLessThanOrEqual(88);
  });
});

describe('magicWandPolygon', () => {
  it('returns a simplified polygon for an enclosed room', () => {
    // Room ≈ 14% of the page — well under the leak guard's maxRegionFraction.
    const r = makeRaster(400, 300);
    r.drawRect(20, 20, 179, 129);
    const result = magicWandPolygon(r, 100, 75);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.polygon.length).toBeGreaterThanOrEqual(4);
      expect(result.polygon.length).toBeLessThan(20);
      // Shoelace area ≈ interior area
      let area = 0;
      const pts = result.polygon;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        area += a.x * b.y - b.x * a.y;
      }
      area = Math.abs(area) / 2;
      expect(area).toBeGreaterThan(150 * 100);
      expect(area).toBeLessThan(160 * 110);
    }
  });

  it('fails with "leaked" when the room has an opening to the page edge', () => {
    const r = makeRaster(100, 100);
    // Three walls only — open on the right
    r.drawRect(10, 10, 89, 89);
    r.drawBlob(88, 40, 89, 60); // punch is not needed; instead erase right wall:
    // redraw: simpler — new raster with a gap
    const r2 = makeRaster(100, 100);
    r2.drawBlob(10, 10, 89, 11); // top
    r2.drawBlob(10, 88, 89, 89); // bottom
    r2.drawBlob(10, 10, 11, 89); // left — right side open
    const result = magicWandPolygon(r2, 50, 50);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('leaked');
  });

  it('fails with "on-boundary" when clicking a wall', () => {
    const r = makeRaster(100, 100);
    r.drawRect(10, 10, 89, 89);
    const result = magicWandPolygon(r, 10, 50);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('on-boundary');
  });

  it('fails with "too-small" for slivers', () => {
    const r = makeRaster(100, 100);
    r.drawRect(40, 40, 48, 48, 1); // 7×7 interior ≈ 49 px < 64 default min
    const result = magicWandPolygon(r, 44, 44);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-small');
  });

  it('respects out-of-bounds clicks', () => {
    const r = makeRaster(50, 50);
    expect(magicWandPolygon(r, -5, 10).ok).toBe(false);
    expect(magicWandPolygon(r, 10, 500).ok).toBe(false);
  });
});
