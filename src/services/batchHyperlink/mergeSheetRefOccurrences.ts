import type { SheetRefOccurrence } from './detectSheetRefsFromWordBoxes';

export type NormRect = { x: number; y: number; width: number; height: number };

const EPS = 1e-9;

/** Intersection-over-union for normalized axis-aligned rects. */
export function rectIou(a: NormRect, b: NormRect): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix0 = Math.max(a.x, b.x);
  const iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(ax2, bx2);
  const iy1 = Math.min(ay2, by2);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  const ua = a.width * a.height + b.width * b.height - inter;
  if (ua <= EPS) return 0;
  return inter / ua;
}

export const DEFAULT_MERGE_IOU = 0.45;

/**
 * Merge secondary occurrences into primary: keep primary; add from secondary only when
 * no primary entry has the same normalized ref with IoU >= threshold.
 */
export function mergeSheetRefOccurrences(
  primary: SheetRefOccurrence[],
  secondary: SheetRefOccurrence[],
  options?: { iouThreshold?: number }
): SheetRefOccurrence[] {
  const thr = options?.iouThreshold ?? DEFAULT_MERGE_IOU;
  const out = [...primary];
  for (const sec of secondary) {
    const overlapped = out.some(
      (p) =>
        p.normalizedRef === sec.normalizedRef && rectIou(p.sourceRect, sec.sourceRect) >= thr
    );
    if (!overlapped) {
      out.push(sec);
    }
  }
  return out;
}
