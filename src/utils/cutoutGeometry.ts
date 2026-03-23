import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Pair, Polygon } from 'polygon-clipping';
import type { ScaleInfo } from './measurementCalculation';

/** Ignore intersections smaller than this (sq ft) after scale conversion */
export const MIN_CUTOUT_AREA_SQFT = 0.001;

function closeRing(pairs: Pair[]): Pair[] {
  if (pairs.length < 3) return pairs;
  const f = pairs[0];
  const l = pairs[pairs.length - 1];
  if (f[0] === l[0] && f[1] === l[1]) return pairs;
  return [...pairs, [f[0], f[1]]];
}

/** Single polygon with one outer ring → MultiPolygon for polygon-clipping */
export function pdfPointsToMultiPolygon(points: Array<{ x: number; y: number }>): MultiPolygon | null {
  if (points.length < 3) return null;
  const ring: Pair[] = closeRing(points.map((p) => [p.x, p.y] as Pair));
  return [[ring]];
}

function ringShoelaceNormHalf(ring: Pair[]): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i][0] * ring[j][1];
    a -= ring[j][0] * ring[i][1];
  }
  return Math.abs(a) / 2;
}

/** Area in square feet for one polygon (exterior minus holes), normalized PDF coords */
function polygonFeatureAreaSqFt(poly: Polygon, scaleInfo: ScaleInfo): number {
  if (!poly.length || !scaleInfo.viewportWidth || !scaleInfo.viewportHeight) return 0;
  let areaNorm = ringShoelaceNormHalf(poly[0]);
  for (let i = 1; i < poly.length; i++) {
    areaNorm -= ringShoelaceNormHalf(poly[i]);
  }
  if (areaNorm <= 0) return 0;
  const pixelArea = areaNorm * (scaleInfo.viewportWidth * scaleInfo.viewportHeight);
  return Math.round(pixelArea * (scaleInfo.scaleFactor * scaleInfo.scaleFactor) * 100) / 100;
}

function pairRingToPdfPoints(ring: Pair[]): Array<{ x: number; y: number }> {
  if (ring.length < 3) return [];
  const last = ring[ring.length - 1];
  const first = ring[0];
  const closed = last[0] === first[0] && last[1] === first[1];
  const trimmed = closed ? ring.slice(0, -1) : ring;
  return trimmed.map(([x, y]) => ({ x, y }));
}

export type ClippedCutoutPiece = {
  pdfPoints: Array<{ x: number; y: number }>;
  areaSqFt: number;
  value: number;
};

/**
 * Intersect cutout with one parent polygon; split multipolygon into separate cutout records.
 * Values use area (SF) or volume (CF) from areaSqFt * depth when isVolume.
 */
export function clippedCutoutsFromIntersection(
  intersection: MultiPolygon,
  scaleInfo: ScaleInfo,
  depth: number,
  isVolume: boolean
): ClippedCutoutPiece[] {
  const out: ClippedCutoutPiece[] = [];
  for (const poly of intersection) {
    if (!poly.length) continue;
    const areaSqFt = polygonFeatureAreaSqFt(poly, scaleInfo);
    if (areaSqFt < MIN_CUTOUT_AREA_SQFT) continue;
    const pdfPoints = pairRingToPdfPoints(poly[0]);
    if (pdfPoints.length < 3) continue;
    const value = Math.round((isVolume ? areaSqFt * depth : areaSqFt) * 100) / 100;
    out.push({ pdfPoints, areaSqFt, value });
  }
  return out;
}

export function intersectCutoutWithParent(
  cutout: MultiPolygon,
  parent: MultiPolygon
): MultiPolygon {
  try {
    return polygonClipping.intersection(cutout, parent);
  } catch {
    return [];
  }
}
