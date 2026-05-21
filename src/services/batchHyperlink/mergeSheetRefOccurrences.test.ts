import { describe, expect, it } from 'vitest';
import { DEFAULT_MERGE_IOU, mergeSheetRefOccurrences, rectIou } from './mergeSheetRefOccurrences';
import type { SheetRefOccurrence } from './detectSheetRefsFromWordBoxes';

function occ(ref: string, x: number, y: number, w = 0.1, h = 0.02): SheetRefOccurrence {
  return { normalizedRef: ref, sourceRect: { x, y, width: w, height: h } };
}

describe('mergeSheetRefOccurrences', () => {
  it('computes IoU for overlapping rects', () => {
    const a = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const b = { x: 0.15, y: 0.15, width: 0.2, height: 0.2 };
    const i = rectIou(a, b);
    expect(i).toBeGreaterThan(0.3);
    expect(i).toBeLessThanOrEqual(1);
  });

  it('keeps secondary when no primary overlaps with same ref', () => {
    const primary = [occ('A101', 0.05, 0.5)];
    const secondary = [occ('A101', 0.8, 0.5)];
    const merged = mergeSheetRefOccurrences(primary, secondary, { iouThreshold: DEFAULT_MERGE_IOU });
    expect(merged).toHaveLength(2);
  });

  it('drops secondary when IoU overlaps primary with same ref', () => {
    const primary = [occ('A101', 0.1, 0.1, 0.2, 0.05)];
    const secondary = [occ('A101', 0.12, 0.11, 0.18, 0.04)];
    const merged = mergeSheetRefOccurrences(primary, secondary, { iouThreshold: 0.45 });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.sourceRect.x).toBeCloseTo(0.1);
  });

  it('keeps secondary for different ref even if boxes overlap', () => {
    const primary = [occ('A101', 0.1, 0.1, 0.2, 0.05)];
    const secondary = [occ('A102', 0.12, 0.11, 0.18, 0.04)];
    const merged = mergeSheetRefOccurrences(primary, secondary);
    expect(merged).toHaveLength(2);
  });
});
