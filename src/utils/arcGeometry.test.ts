import { describe, it, expect } from 'vitest';
import {
  arcApexPoint,
  arcsAfterVertexInsert,
  bulgeFromDragPoint,
  BULGE_MAX,
  expandPolylineWithArcs,
  hasArcs,
  tessellateSegment,
  withSegmentBulge,
} from './arcGeometry';

const P0 = { x: 0, y: 0 };
const P1 = { x: 100, y: 0 };

describe('arcApexPoint / bulgeFromDragPoint round-trip', () => {
  it('semicircle (bulge 1) apex sits one radius off the chord midpoint', () => {
    const apex = arcApexPoint(P0, P1, 1);
    expect(apex.x).toBeCloseTo(50, 6);
    expect(Math.abs(apex.y)).toBeCloseTo(50, 6);
  });

  it('round-trips: bulge from the apex point returns the original bulge', () => {
    for (const bulge of [0.25, -0.5, 1, -1.5, 0.05]) {
      const apex = arcApexPoint(P0, P1, bulge);
      expect(bulgeFromDragPoint(P0, P1, apex)).toBeCloseTo(bulge, 6);
    }
  });

  it('ignores drag movement parallel to the chord', () => {
    const apex = arcApexPoint(P0, P1, 0.5);
    const slid = { x: apex.x + 30, y: apex.y };
    expect(bulgeFromDragPoint(P0, P1, slid)).toBeCloseTo(0.5, 6);
  });

  it('snaps to straight when the drag is close to the chord', () => {
    expect(bulgeFromDragPoint(P0, P1, { x: 50, y: 0.5 })).toBe(0);
  });

  it('clamps runaway drags to BULGE_MAX', () => {
    expect(Math.abs(bulgeFromDragPoint(P0, P1, { x: 50, y: 100000 }))).toBe(BULGE_MAX);
  });
});

describe('tessellateSegment', () => {
  it('returns no points for straight segments', () => {
    expect(tessellateSegment(P0, P1, 0)).toEqual([]);
  });

  it('all tessellated points lie on the arc circle', () => {
    const bulge = 0.75;
    const pts = tessellateSegment(P0, P1, bulge);
    expect(pts.length).toBeGreaterThan(4);
    // Circle through P0, P1, apex — derive center/radius from three points.
    const apex = arcApexPoint(P0, P1, bulge);
    // Center is equidistant; use perpendicular bisector intersection via known
    // sagitta formulation: radius = chord(1+b^2)/(4|b|).
    const radius = (100 * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
    const cy = apex.y - Math.sign(apex.y) * radius;
    for (const p of pts) {
      expect(Math.hypot(p.x - 50, p.y - cy)).toBeCloseTo(radius, 4);
    }
  });

  it('semicircle passes through its apex', () => {
    const pts = tessellateSegment(P0, P1, 1);
    const apex = arcApexPoint(P0, P1, 1);
    const nearest = Math.min(...pts.map((p) => Math.hypot(p.x - apex.x, p.y - apex.y)));
    expect(nearest).toBeLessThan(2.5);
  });

  it('negative bulge bows to the opposite side', () => {
    const up = tessellateSegment(P0, P1, 0.5);
    const down = tessellateSegment(P0, P1, -0.5);
    expect(Math.sign(up[3].y)).not.toBe(Math.sign(down[3].y));
  });
});

describe('expandPolylineWithArcs', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it('returns the same reference when there are no arcs', () => {
    expect(expandPolylineWithArcs(square, undefined)).toBe(square);
    expect(expandPolylineWithArcs(square, [])).toBe(square);
    expect(expandPolylineWithArcs(square, [{ segmentIndex: 1, bulge: 0 }])).toBe(square);
  });

  it('expands one open-polyline segment and keeps true vertices in order', () => {
    const out = expandPolylineWithArcs(square, [{ segmentIndex: 0, bulge: 1 }]);
    expect(out[0]).toEqual(square[0]);
    expect(out[out.length - 1]).toEqual(square[3]);
    expect(out.length).toBeGreaterThan(square.length + 4);
    // Later vertices still present, in order
    const idx2 = out.findIndex((p) => p.x === 100 && p.y === 100);
    const idx3 = out.findIndex((p) => p.x === 0 && p.y === 100);
    expect(idx2).toBeGreaterThan(0);
    expect(idx3).toBeGreaterThan(idx2);
  });

  it('closed polygons can arc the closing edge (segmentIndex = n-1)', () => {
    const out = expandPolylineWithArcs(square, [{ segmentIndex: 3, bulge: 0.5 }], {
      closed: true,
    });
    // Closing-edge tessellation points appended after the last true vertex.
    expect(out.length).toBeGreaterThan(square.length);
    expect(out[0]).toEqual(square[0]);
    // Open-polyline expansion ignores the same index (only n-2 segments exist).
    const open = expandPolylineWithArcs(square, [{ segmentIndex: 3, bulge: 0.5 }]);
    expect(open).toBe(square);
  });

  it('bulged edge adds the semicircle area (outward bow)', () => {
    // CCW square, outward bow on edge 1 = negative bulge (positive bows left
    // of travel = inward here): area = 100² + π·50²/2
    const out = expandPolylineWithArcs(square, [{ segmentIndex: 1, bulge: -1 }], { closed: true });
    let area = 0;
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      area += a.x * b.y - b.x * a.y;
    }
    area = Math.abs(area) / 2;
    expect(area).toBeCloseTo(100 * 100 + (Math.PI * 50 * 50) / 2, -1);
  });
});

describe('arc list helpers', () => {
  it('hasArcs ignores empty and zero-bulge lists', () => {
    expect(hasArcs({})).toBe(false);
    expect(hasArcs({ arcs: [] })).toBe(false);
    expect(hasArcs({ arcs: [{ segmentIndex: 0, bulge: 0 }] })).toBe(false);
    expect(hasArcs({ arcs: [{ segmentIndex: 0, bulge: 0.4 }] })).toBe(true);
  });

  it('withSegmentBulge upserts, removes on zero, and drops to undefined when empty', () => {
    let arcs = withSegmentBulge(undefined, 2, 0.5);
    expect(arcs).toEqual([{ segmentIndex: 2, bulge: 0.5 }]);
    arcs = withSegmentBulge(arcs, 0, -0.25);
    expect(arcs).toEqual([
      { segmentIndex: 0, bulge: -0.25 },
      { segmentIndex: 2, bulge: 0.5 },
    ]);
    arcs = withSegmentBulge(arcs, 2, 0.9);
    expect(arcs?.find((a) => a.segmentIndex === 2)?.bulge).toBe(0.9);
    arcs = withSegmentBulge(arcs, 2, 0);
    expect(arcs).toEqual([{ segmentIndex: 0, bulge: -0.25 }]);
    expect(withSegmentBulge(arcs, 0, 0)).toBeUndefined();
  });

  it('arcsAfterVertexInsert shifts later arcs and straightens the split segment', () => {
    const arcs = [
      { segmentIndex: 0, bulge: 0.3 },
      { segmentIndex: 2, bulge: 0.6 },
      { segmentIndex: 4, bulge: -0.2 },
    ];
    expect(arcsAfterVertexInsert(arcs, 2)).toEqual([
      { segmentIndex: 0, bulge: 0.3 },
      { segmentIndex: 5, bulge: -0.2 },
    ]);
    expect(arcsAfterVertexInsert(undefined, 1)).toBeUndefined();
  });
});
