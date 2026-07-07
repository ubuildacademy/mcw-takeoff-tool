/**
 * Auto target views for batch hyperlinks.
 *
 * A reference callout carries a detail label ("5" in the 5/A-501 bubble). If
 * the target sheet has a detail-title bubble with the same label, the link can
 * land zoomed on that exact detail instead of the top of the page. This module
 * matches created links to source callouts (by geometry) and to target
 * detail-title bubbles (by label), and fills in `targetViewport`.
 */
import type { SheetHyperlink } from '../../types';
import type { VectorCalloutClient } from './runVectorCalloutsForDocument';

/** Landing zoom for auto target views: close enough to read a detail on a full-size sheet. */
export const AUTO_TARGET_VIEW_ZOOM = 1.75;

function pageKey(documentId: string, pageNumber: number): string {
  return `${documentId}\0${pageNumber}`;
}

function rectCenter(r: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function bboxContains(
  bbox: { x: number; y: number; width: number; height: number },
  pt: { x: number; y: number },
  slack = 0.004
): boolean {
  return (
    pt.x >= bbox.x - slack &&
    pt.x <= bbox.x + bbox.width + slack &&
    pt.y >= bbox.y - slack &&
    pt.y <= bbox.y + bbox.height + slack
  );
}

export interface ResolveTargetViewsResult {
  /** Links that received a targetViewport (subset of input, same object refs). */
  linksWithViews: number;
}

/**
 * Mutates `links` in place: sets `targetViewport` where a confident match
 * exists. A match requires (a) the link's source rect to sit on a reference
 * callout that has a detail label, and (b) exactly one best detail-title
 * bubble with that label on the target page. No match → link keeps default
 * page-level navigation. Never overwrites an existing targetViewport.
 */
export function resolveTargetViews(
  links: SheetHyperlink[],
  calloutsByPageKey: Map<string, VectorCalloutClient[]>
): ResolveTargetViewsResult {
  let linksWithViews = 0;

  for (const link of links) {
    if (link.targetViewport) continue;
    if (!link.targetSheetId) continue;

    const sourceCallouts = calloutsByPageKey.get(
      pageKey(link.sourceSheetId, link.sourcePageNumber)
    );
    if (!sourceCallouts || sourceCallouts.length === 0) continue;

    const sourceCenter = rectCenter(link.sourceRect);
    const sourceCallout = sourceCallouts.find(
      (c) => c.kind === 'reference' && c.detailLabel && bboxContains(c.bbox, sourceCenter)
    );
    if (!sourceCallout?.detailLabel) continue;
    const label = sourceCallout.detailLabel.toUpperCase();

    const targetCallouts = calloutsByPageKey.get(
      pageKey(link.targetSheetId, link.targetPageNumber)
    );
    if (!targetCallouts || targetCallouts.length === 0) continue;

    // Detail-title bubbles first; fall back to unlabeled bubbles with the same
    // label (title text not always adjacent). Reference bubbles never qualify —
    // a matching reference on the target page points elsewhere.
    const candidates = targetCallouts.filter(
      (c) =>
        c.kind !== 'reference' &&
        c.detailLabel != null &&
        c.detailLabel.toUpperCase() === label
    );
    if (candidates.length === 0) continue;
    const titled = candidates.filter((c) => c.kind === 'detail_title');
    const pool = titled.length > 0 ? titled : candidates;
    // Largest bubble wins ties — detail titles are drawn bigger than references.
    const best = pool.reduce((a, b) =>
      b.bbox.width * b.bbox.height > a.bbox.width * a.bbox.height ? b : a
    );

    const center = rectCenter(best.bbox);
    link.targetViewport = { x: center.x, y: center.y, zoom: AUTO_TARGET_VIEW_ZOOM };
    linksWithViews += 1;
  }

  return { linksWithViews };
}
