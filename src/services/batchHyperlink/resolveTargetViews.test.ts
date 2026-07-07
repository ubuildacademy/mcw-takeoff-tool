import { describe, it, expect } from 'vitest';
import { resolveTargetViews, AUTO_TARGET_VIEW_ZOOM } from './resolveTargetViews';
import type { VectorCalloutClient } from './runVectorCalloutsForDocument';
import type { SheetHyperlink } from '../../types';

const key = (doc: string, page: number) => `${doc}\0${page}`;

function makeLink(overrides: Partial<SheetHyperlink> = {}): SheetHyperlink {
  return {
    id: 'h1',
    projectId: 'p1',
    sourceSheetId: 'docA',
    sourcePageNumber: 2,
    sourceRect: { x: 0.6, y: 0.4, width: 0.02, height: 0.02 },
    targetSheetId: 'docB',
    targetPageNumber: 5,
    timestamp: 'now',
    origin: 'batch',
    detectedSheetRef: 'A-501',
    ...overrides,
  };
}

function refCallout(overrides: Partial<VectorCalloutClient> = {}): VectorCalloutClient {
  return {
    bbox: { x: 0.595, y: 0.395, width: 0.03, height: 0.03 },
    shape: 'circle',
    detailLabel: '5',
    sheetRef: 'A-501',
    kind: 'reference',
    titleText: null,
    ...overrides,
  };
}

function titleCallout(overrides: Partial<VectorCalloutClient> = {}): VectorCalloutClient {
  return {
    bbox: { x: 0.2, y: 0.7, width: 0.02, height: 0.02 },
    shape: 'circle',
    detailLabel: '5',
    sheetRef: null,
    kind: 'detail_title',
    titleText: 'TYP. PARAPET DETAIL',
    ...overrides,
  };
}

describe('resolveTargetViews', () => {
  it('sets targetViewport when source callout label matches a target detail-title bubble', () => {
    const link = makeLink();
    const map = new Map([
      [key('docA', 2), [refCallout()]],
      [key('docB', 5), [titleCallout()]],
    ]);
    const result = resolveTargetViews([link], map);
    expect(result.linksWithViews).toBe(1);
    expect(link.targetViewport?.x).toBeCloseTo(0.21, 10);
    expect(link.targetViewport?.y).toBeCloseTo(0.71, 10);
    expect(link.targetViewport?.zoom).toBe(AUTO_TARGET_VIEW_ZOOM);
  });

  it('leaves link untouched when no source callout contains the source rect', () => {
    const link = makeLink({ sourceRect: { x: 0.1, y: 0.1, width: 0.02, height: 0.02 } });
    const map = new Map([
      [key('docA', 2), [refCallout()]],
      [key('docB', 5), [titleCallout()]],
    ]);
    expect(resolveTargetViews([link], map).linksWithViews).toBe(0);
    expect(link.targetViewport).toBeUndefined();
  });

  it('ignores reference bubbles on the target page (they point elsewhere)', () => {
    const link = makeLink();
    const map = new Map([
      [key('docA', 2), [refCallout()]],
      [key('docB', 5), [refCallout({ kind: 'reference' })]],
    ]);
    expect(resolveTargetViews([link], map).linksWithViews).toBe(0);
  });

  it('prefers detail_title over unlabeled and picks the largest on ties', () => {
    const link = makeLink();
    const small = titleCallout({ bbox: { x: 0.5, y: 0.5, width: 0.01, height: 0.01 } });
    const big = titleCallout({ bbox: { x: 0.3, y: 0.3, width: 0.03, height: 0.03 } });
    const unlabeled = titleCallout({ kind: 'unlabeled', bbox: { x: 0.8, y: 0.8, width: 0.05, height: 0.05 } });
    const map = new Map([
      [key('docA', 2), [refCallout()]],
      [key('docB', 5), [small, unlabeled, big]],
    ]);
    resolveTargetViews([link], map);
    expect(link.targetViewport?.x).toBeCloseTo(0.315, 5);
    expect(link.targetViewport?.y).toBeCloseTo(0.315, 5);
  });

  it('falls back to unlabeled bubbles when no detail_title matches', () => {
    const link = makeLink();
    const map = new Map([
      [key('docA', 2), [refCallout()]],
      [key('docB', 5), [titleCallout({ kind: 'unlabeled', titleText: null })]],
    ]);
    expect(resolveTargetViews([link], map).linksWithViews).toBe(1);
  });

  it('matches labels case-insensitively', () => {
    const link = makeLink();
    const map = new Map([
      [key('docA', 2), [refCallout({ detailLabel: 'a' })]],
      [key('docB', 5), [titleCallout({ detailLabel: 'A' })]],
    ]);
    expect(resolveTargetViews([link], map).linksWithViews).toBe(1);
  });

  it('never overwrites an existing targetViewport', () => {
    const existing = { x: 0.9, y: 0.9, zoom: 3 };
    const link = makeLink({ targetViewport: existing });
    const map = new Map([
      [key('docA', 2), [refCallout()]],
      [key('docB', 5), [titleCallout()]],
    ]);
    expect(resolveTargetViews([link], map).linksWithViews).toBe(0);
    expect(link.targetViewport).toEqual(existing);
  });
});
