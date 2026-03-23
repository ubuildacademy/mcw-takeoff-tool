import { describe, expect, it } from 'vitest';
import polygonClipping from 'polygon-clipping';
import { clippedCutoutsFromIntersection, pdfPointsToMultiPolygon } from './cutoutGeometry';

describe('cutoutGeometry', () => {
  /** scaleFactor is units per pixel; 0.01 makes a full-page normalized square ≈ 1 SF at 100×100 px */
  const scaleInfo = {
    scaleFactor: 0.01,
    unit: 'ft',
    scaleText: '1',
    confidence: 1,
    viewportWidth: 100,
    viewportHeight: 100,
  };

  it('intersects unit square with inner square and yields partial area', () => {
    const outer = pdfPointsToMultiPolygon([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    const cut = pdfPointsToMultiPolygon([
      { x: 0.5, y: 0.5 },
      { x: 1.5, y: 0.5 },
      { x: 1.5, y: 1.5 },
      { x: 0.5, y: 1.5 },
    ]);
    if (outer == null || cut == null) {
      expect.fail('expected valid polygons from test points');
      return;
    }
    const inter = polygonClipping.intersection(cut, outer);
    expect(inter.length).toBeGreaterThan(0);
    const pieces = clippedCutoutsFromIntersection(inter, scaleInfo, 1, false);
    expect(pieces.length).toBe(1);
    expect(pieces[0].areaSqFt).toBeCloseTo(0.25, 2);
  });
});
