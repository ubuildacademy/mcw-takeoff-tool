import { describe, it, expect } from 'vitest';
import { diffSheetRasters, type RasterLike } from './sheetDiff';

/** Build a white raster and draw black rects onto it (plain arrays, jsdom-safe). */
function makeRaster(w: number, h: number): RasterLike & {
  drawRect: (x0: number, y0: number, x1: number, y1: number) => void;
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
    drawRect(x0, y0, x1, y1) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) setDark(x, y);
      }
    },
  };
}

describe('diffSheetRasters', () => {
  it('reports no changes for identical rasters', () => {
    const a = makeRaster(200, 200);
    a.drawRect(50, 50, 150, 52); // a line

    const b = makeRaster(200, 200);
    b.drawRect(50, 50, 150, 52);

    const result = diffSheetRasters(a, b);
    expect(result.removedPx).toBe(0);
    expect(result.addedPx).toBe(0);
    expect(result.changedRegions).toEqual([]);
  });

  it('detects a line present only in the old raster as removed', () => {
    const oldRaster = makeRaster(200, 200);
    oldRaster.drawRect(50, 50, 150, 52);

    const newRaster = makeRaster(200, 200);

    const result = diffSheetRasters(oldRaster, newRaster);
    expect(result.removedPx).toBeGreaterThan(0);
    expect(result.addedPx).toBe(0);
    expect(result.changedRegions).toHaveLength(1);
  });

  it('detects a line present only in the new raster as added', () => {
    const oldRaster = makeRaster(200, 200);

    const newRaster = makeRaster(200, 200);
    newRaster.drawRect(50, 50, 150, 52);

    const result = diffSheetRasters(oldRaster, newRaster);
    expect(result.addedPx).toBeGreaterThan(0);
    expect(result.removedPx).toBe(0);
    expect(result.changedRegions).toHaveLength(1);
  });

  it('absorbs a 1px shift with tolerancePx 2', () => {
    const oldRaster = makeRaster(200, 200);
    oldRaster.drawRect(50, 50, 150, 52);

    const newRaster = makeRaster(200, 200);
    newRaster.drawRect(51, 51, 151, 53); // shifted by 1px

    const result = diffSheetRasters(oldRaster, newRaster, { tolerancePx: 2 });
    expect(result.removedPx).toBe(0);
    expect(result.addedPx).toBe(0);
  });

  it('detects a 6px shift with tolerancePx 2 as both removed and added', () => {
    const oldRaster = makeRaster(200, 200);
    oldRaster.drawRect(50, 50, 150, 52);

    const newRaster = makeRaster(200, 200);
    newRaster.drawRect(56, 56, 156, 58); // shifted by 6px

    const result = diffSheetRasters(oldRaster, newRaster, { tolerancePx: 2 });
    expect(result.removedPx).toBeGreaterThan(0);
    expect(result.addedPx).toBeGreaterThan(0);
  });

  it('reports two changed regions for two far-apart changes', () => {
    const oldRaster = makeRaster(400, 400);
    oldRaster.drawRect(20, 20, 60, 22);
    oldRaster.drawRect(300, 300, 340, 302);

    const newRaster = makeRaster(400, 400);
    // Neither line present in the new raster => two removed regions.

    const result = diffSheetRasters(oldRaster, newRaster);
    expect(result.changedRegions).toHaveLength(2);
  });

  it('throws when raster dimensions differ', () => {
    const a = makeRaster(100, 100);
    const b = makeRaster(100, 101);
    expect(() => diffSheetRasters(a, b)).toThrow('Raster dimensions differ');
  });
});
