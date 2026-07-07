/**
 * Circular-arc segments for takeoff markups (DXF bulge convention).
 *
 * A measurement stays a polyline/polygon of true vertices (`points`); an
 * optional `arcs` list marks segments that bow into circular arcs:
 * `{ segmentIndex, bulge }` where bulge = tan(θ/4) of the included angle θ.
 * bulge 0 = straight, 1 = semicircle. Sign picks the side (see `perp`).
 *
 * Bulge is invariant under uniform scale, rotation, and translation — so the
 * same stored value is valid in normalized page space, CSS pixels, or export
 * raster pixels, as long as the space is uniform (x and y scaled alike).
 * Normalized 0-1 page coords are NOT uniform (width ≠ height), so consumers
 * must expand AFTER transforming vertices into their own pixel space:
 * transform vertices → `expandPolylineWithArcs` → draw/measure.
 */

export interface ArcSegment {
  /** Segment points[i] → points[i+1]; for closed shapes, index n-1 = last → first. */
  segmentIndex: number;
  /** tan(θ/4), signed. 0 = straight (segment entry should be omitted instead). */
  bulge: number;
}

export interface XY {
  x: number;
  y: number;
}

/** Below this |bulge| a drag is treated as "snap back to straight" (~2° arc). */
export const BULGE_STRAIGHT_SNAP = 0.02;
/** Semicircle-and-a-bit; beyond this the arc math gets needle-thin circles. */
export const BULGE_MAX = 4;

/** Max angular step per tessellation chord (radians ≈ 3°) and segment caps. */
const TESS_MAX_STEP = Math.PI / 60;
const TESS_MIN_SEGMENTS = 4;
const TESS_MAX_SEGMENTS = 96;

/** Perpendicular of the chord direction: rotate 90° counter-clockwise in math coords. */
function perp(dx: number, dy: number): XY {
  return { x: -dy, y: dx };
}

/**
 * Arc apex (farthest point of the arc from its chord). Also the natural spot
 * for the curve-edit handle.
 */
export function arcApexPoint(p0: XY, p1: XY, bulge: number): XY {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return { ...p0 };
  const n = perp(dx / chord, dy / chord);
  const sagitta = (bulge * chord) / 2;
  return {
    x: (p0.x + p1.x) / 2 + n.x * sagitta,
    y: (p0.y + p1.y) / 2 + n.y * sagitta,
  };
}

/**
 * Bulge for the arc whose apex tracks a dragged point: the drag's signed
 * perpendicular distance from the chord is taken as the sagitta
 * (bulge = 2·sagitta / chord). The parallel component is ignored, which keeps
 * the interaction stable — the handle slides on the chord's mid-normal.
 * Returns 0 within the straight-snap band; clamped to ±BULGE_MAX.
 */
export function bulgeFromDragPoint(p0: XY, p1: XY, drag: XY): number {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return 0;
  const n = perp(dx / chord, dy / chord);
  const mx = drag.x - (p0.x + p1.x) / 2;
  const my = drag.y - (p0.y + p1.y) / 2;
  const sagitta = mx * n.x + my * n.y;
  const bulge = (2 * sagitta) / chord;
  if (Math.abs(bulge) < BULGE_STRAIGHT_SNAP) return 0;
  return Math.max(-BULGE_MAX, Math.min(BULGE_MAX, bulge));
}

/**
 * Points along the arc from p0 to p1 (exclusive of both endpoints), suitable
 * for splicing into a polyline. Straight segments return [].
 */
export function tessellateSegment(p0: XY, p1: XY, bulge: number): XY[] {
  if (bulge === 0 || !Number.isFinite(bulge)) return [];
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return [];

  const theta = 4 * Math.atan(bulge); // signed included angle
  const radius = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const n = perp(dx / chord, dy / chord);
  const sagitta = (bulge * chord) / 2;
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  // Center sits on the mid-normal, radius away from the apex (see docs above).
  const centerOffset = sagitta - Math.sign(bulge) * radius;
  const cx = mid.x + n.x * centerOffset;
  const cy = mid.y + n.y * centerOffset;

  const startAngle = Math.atan2(p0.y - cy, p0.x - cx);
  const segments = Math.max(
    TESS_MIN_SEGMENTS,
    Math.min(TESS_MAX_SEGMENTS, Math.ceil(Math.abs(theta) / TESS_MAX_STEP))
  );

  // With `perp` = CCW rotation and the apex on the +perp side, the arc sweeps
  // clockwise (decreasing angle) for positive bulge: sweep = -theta.
  const sweep = -theta;
  const out: XY[] = [];
  for (let i = 1; i < segments; i++) {
    const a = startAngle + (sweep * i) / segments;
    out.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return out;
}

/**
 * Expand a polyline/polygon's arc segments into flat vertices. Returns the
 * input array untouched (same reference) when there are no arcs — the cheap
 * common case stays allocation-free.
 *
 * `closed` treats segmentIndex points.length-1 as the closing edge
 * (last vertex → first vertex), e.g. area/volume polygons.
 */
export function expandPolylineWithArcs(
  points: XY[],
  arcs: ArcSegment[] | undefined,
  options: { closed?: boolean } = {}
): XY[] {
  if (!arcs || arcs.length === 0 || points.length < 2) return points;
  const closed = options.closed === true;
  const segmentCount = closed ? points.length : points.length - 1;

  const bulgeBySegment = new Map<number, number>();
  for (const arc of arcs) {
    if (
      Number.isInteger(arc.segmentIndex) &&
      arc.segmentIndex >= 0 &&
      arc.segmentIndex < segmentCount &&
      Number.isFinite(arc.bulge) &&
      arc.bulge !== 0
    ) {
      bulgeBySegment.set(arc.segmentIndex, arc.bulge);
    }
  }
  if (bulgeBySegment.size === 0) return points;

  const out: XY[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % points.length];
    out.push(p0);
    const bulge = bulgeBySegment.get(i);
    if (bulge) out.push(...tessellateSegment(p0, p1, bulge));
  }
  if (!closed) out.push(points[points.length - 1]);
  return out;
}

/**
 * Expand arcs for points stored in normalized 0-1 page space. Normalized space
 * is non-uniform (page width ≠ height), so vertices are mapped into pixel
 * space (where arcs are circular), tessellated, and mapped back. The result
 * feeds consumers that take normalized points (e.g. MeasurementCalculator).
 */
export function expandNormalizedPointsWithArcs(
  points: XY[],
  arcs: ArcSegment[] | undefined,
  viewportWidth: number,
  viewportHeight: number,
  options: { closed?: boolean } = {}
): XY[] {
  if (!arcs || arcs.length === 0 || viewportWidth <= 0 || viewportHeight <= 0) return points;
  const px = points.map((p) => ({ x: p.x * viewportWidth, y: p.y * viewportHeight }));
  const expanded = expandPolylineWithArcs(px, arcs, options);
  if (expanded === px) return points;
  return expanded.map((p) => ({ x: p.x / viewportWidth, y: p.y / viewportHeight }));
}

/** True when the measurement-shaped object has at least one real arc segment. */
export function hasArcs(m: { arcs?: ArcSegment[] | null }): boolean {
  return Array.isArray(m.arcs) && m.arcs.some((a) => Number.isFinite(a.bulge) && a.bulge !== 0);
}

/**
 * Upsert/remove one segment's bulge in an arcs list (immutable). bulge 0
 * removes the entry. Returns undefined when the result has no arcs left,
 * so callers can drop the field entirely.
 */
export function withSegmentBulge(
  arcs: ArcSegment[] | undefined,
  segmentIndex: number,
  bulge: number
): ArcSegment[] | undefined {
  const rest = (arcs ?? []).filter((a) => a.segmentIndex !== segmentIndex);
  const next = bulge === 0 ? rest : [...rest, { segmentIndex, bulge }];
  return next.length > 0 ? next.sort((a, b) => a.segmentIndex - b.segmentIndex) : undefined;
}

/**
 * Renumber arc segments after a vertex is inserted or removed.
 * `insertedAtSegment`: splitting segment k in two shifts every arc at index ≥ k
 * by one and drops the arc on k itself (the split segment goes straight).
 */
export function arcsAfterVertexInsert(
  arcs: ArcSegment[] | undefined,
  splitSegmentIndex: number
): ArcSegment[] | undefined {
  if (!arcs || arcs.length === 0) return undefined;
  const next = arcs
    .filter((a) => a.segmentIndex !== splitSegmentIndex)
    .map((a) =>
      a.segmentIndex > splitSegmentIndex ? { ...a, segmentIndex: a.segmentIndex + 1 } : a
    );
  return next.length > 0 ? next : undefined;
}
