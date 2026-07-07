/**
 * Sheet revision diff: pixel-diff two raster renderings of the same
 * construction sheet (old revision vs new revision) to find removed/added
 * linework.
 *
 * Pipeline: binarize both rasters into ink masks (dark pixels = linework) →
 * dilate each mask by a small tolerance radius (absorbs sub-pixel/hairline
 * rendering offsets between the two exports) → compare ink-only-in-old vs
 * dilated-new (removed) and ink-only-in-new vs dilated-old (added) → cluster
 * the changed pixels into block-grid regions and merge adjacent blocks into
 * bounding boxes. Pure raster math, fully deterministic, no dependencies.
 */

export interface RasterLike {
  /** RGBA bytes, 4 per pixel (ImageData.data layout). */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface SheetDiffOptions {
  /** Luminance below this = ink (linework). Default 160. */
  darkThreshold?: number;
  /** Dilation radius in px used as alignment tolerance. Default 2. */
  tolerancePx?: number;
  /** Block size for changed-region clustering. Default 24. */
  blockSize?: number;
  /** Minimum changed pixels in a block to count it. Default 12. */
  minBlockChangedPx?: number;
}

export interface SheetDiffResult {
  /** Per-pixel codes, length = width*height: 0 unchanged, 1 removed (ink only in old), 2 added (ink only in new). */
  codes: Uint8Array;
  removedPx: number;
  addedPx: number;
  /** Merged bounding boxes (px) of changed areas, sorted by area desc. */
  changedRegions: Array<{ x: number; y: number; width: number; height: number }>;
}

const DEFAULTS: Required<SheetDiffOptions> = {
  darkThreshold: 160,
  tolerancePx: 2,
  blockSize: 24,
  minBlockChangedPx: 12,
};

function luminance(data: Uint8ClampedArray, idx: number): number {
  // Treat near-transparent pixels as white (PDF pages render opaque; belt+braces).
  if (data[idx + 3] < 8) return 255;
  return (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
}

/** Binarize a raster to an ink mask (1 = ink/linework, 0 = background). */
function buildInkMask(raster: RasterLike, darkThreshold: number): Uint8Array {
  const { data, width: w, height: h } = raster;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    mask[i] = luminance(data, i * 4) < darkThreshold ? 1 : 0;
  }
  return mask;
}

/**
 * Square dilation by `radius` px, done as a separable two-pass (horizontal
 * run then vertical run) so it's O(n·radius) rather than O(n·radius²).
 */
function dilateMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask.slice();

  // Horizontal pass.
  const horiz = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[rowOffset + x] === 0) continue;
      const xStart = Math.max(0, x - radius);
      const xEnd = Math.min(w - 1, x + radius);
      for (let nx = xStart; nx <= xEnd; nx++) {
        horiz[rowOffset + nx] = 1;
      }
    }
  }

  // Vertical pass.
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (horiz[y * w + x] === 0) continue;
      const yStart = Math.max(0, y - radius);
      const yEnd = Math.min(h - 1, y + radius);
      for (let ny = yStart; ny <= yEnd; ny++) {
        out[ny * w + x] = 1;
      }
    }
  }

  return out;
}

/** Union-find over block indices for merging orthogonally-adjacent changed blocks. */
function findRoot(parent: Int32Array, i: number): number {
  let root = i;
  while (parent[root] !== root) root = parent[root];
  let cur = i;
  while (parent[cur] !== root) {
    const next = parent[cur];
    parent[cur] = root;
    cur = next;
  }
  return root;
}

function union(parent: Int32Array, a: number, b: number): void {
  const ra = findRoot(parent, a);
  const rb = findRoot(parent, b);
  if (ra !== rb) parent[ra] = rb;
}

export function diffSheetRasters(
  oldRaster: RasterLike,
  newRaster: RasterLike,
  options: SheetDiffOptions = {}
): SheetDiffResult {
  if (oldRaster.width !== newRaster.width || oldRaster.height !== newRaster.height) {
    throw new Error('Raster dimensions differ');
  }

  const opts = { ...DEFAULTS, ...options };
  const { width: w, height: h } = oldRaster;

  const oldInk = buildInkMask(oldRaster, opts.darkThreshold);
  const newInk = buildInkMask(newRaster, opts.darkThreshold);
  const oldDilated = dilateMask(oldInk, w, h, opts.tolerancePx);
  const newDilated = dilateMask(newInk, w, h, opts.tolerancePx);

  const codes = new Uint8Array(w * h);
  let removedPx = 0;
  let addedPx = 0;
  for (let i = 0; i < w * h; i++) {
    if (oldInk[i] === 1 && newDilated[i] === 0) {
      codes[i] = 1;
      removedPx++;
    } else if (newInk[i] === 1 && oldDilated[i] === 0) {
      codes[i] = 2;
      addedPx++;
    }
  }

  // Region clustering: divide the page into blockSize×blockSize blocks.
  const blockSize = opts.blockSize;
  const blocksX = Math.ceil(w / blockSize);
  const blocksY = Math.ceil(h / blockSize);
  const blockChangedCount = new Int32Array(blocksX * blocksY);

  for (let y = 0; y < h; y++) {
    const by = (y / blockSize) | 0;
    for (let x = 0; x < w; x++) {
      if (codes[y * w + x] === 0) continue;
      const bx = (x / blockSize) | 0;
      blockChangedCount[by * blocksX + bx]++;
    }
  }

  const isChangedBlock = new Uint8Array(blocksX * blocksY);
  for (let i = 0; i < blockChangedCount.length; i++) {
    if (blockChangedCount[i] >= opts.minBlockChangedPx) isChangedBlock[i] = 1;
  }

  // Merge orthogonally-adjacent changed blocks via union-find.
  const parent = new Int32Array(blocksX * blocksY);
  for (let i = 0; i < parent.length; i++) parent[i] = i;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const idx = by * blocksX + bx;
      if (!isChangedBlock[idx]) continue;
      if (bx + 1 < blocksX && isChangedBlock[idx + 1]) union(parent, idx, idx + 1);
      if (by + 1 < blocksY && isChangedBlock[idx + blocksX]) union(parent, idx, idx + blocksX);
    }
  }

  // Build bboxes (in block coords first) per root group.
  const groupBounds = new Map<number, { minBx: number; minBy: number; maxBx: number; maxBy: number }>();
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const idx = by * blocksX + bx;
      if (!isChangedBlock[idx]) continue;
      const root = findRoot(parent, idx);
      const existing = groupBounds.get(root);
      if (!existing) {
        groupBounds.set(root, { minBx: bx, minBy: by, maxBx: bx, maxBy: by });
      } else {
        if (bx < existing.minBx) existing.minBx = bx;
        if (by < existing.minBy) existing.minBy = by;
        if (bx > existing.maxBx) existing.maxBx = bx;
        if (by > existing.maxBy) existing.maxBy = by;
      }
    }
  }

  const changedRegions: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const bounds of groupBounds.values()) {
    const x = bounds.minBx * blockSize;
    const y = bounds.minBy * blockSize;
    const x1 = Math.min(w, (bounds.maxBx + 1) * blockSize);
    const y1 = Math.min(h, (bounds.maxBy + 1) * blockSize);
    changedRegions.push({ x, y, width: x1 - x, height: y1 - y });
  }

  changedRegions.sort((a, b) => b.width * b.height - a.width * a.height);

  return { codes, removedPx, addedPx, changedRegions };
}
