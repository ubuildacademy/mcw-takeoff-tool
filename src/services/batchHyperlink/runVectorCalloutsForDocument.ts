import { ocrApiService } from '../apiService';

/** Callout detected from vector geometry (see server vector_callout_pass.py). */
export interface VectorCalloutClient {
  bbox: { x: number; y: number; width: number; height: number };
  shape: 'circle' | 'hexagon';
  detailLabel: string | null;
  sheetRef: string | null;
  kind: 'reference' | 'detail_title' | 'unlabeled';
  titleText: string | null;
}

export interface RunVectorCalloutsResult {
  documentId: string;
  totalPages: number;
  calloutsFound: number;
  /** Reference callouts merged into stored OCR as `source: 'vector_callout'`. */
  referenceCallouts: number;
  /** Key: `${documentId}\0${pageNumber}` — same convention as visualWordBoxesByPageKey. */
  calloutsByPageKey: Map<string, VectorCalloutClient[]>;
}

/**
 * Auto-hyperlink precision pre-step for vector PDFs: exact callout geometry +
 * exact text, no OCR. The server merges reference callouts into stored OCR
 * (so the existing detection layer finds them); the returned callout map also
 * powers the review table and auto target views (detail-title bubbles).
 */
export async function runVectorCalloutsForDocument(options: {
  documentId: string;
  projectId: string;
}): Promise<RunVectorCalloutsResult> {
  const { documentId, projectId } = options;
  const result = await ocrApiService.runVectorCalloutExtract(documentId, projectId);

  const calloutsByPageKey = new Map<string, VectorCalloutClient[]>();
  for (const page of result.pages ?? []) {
    const callouts = (page.callouts ?? []).map((c) => ({
      bbox: c.bbox,
      shape: c.shape,
      detailLabel: c.detailLabel,
      sheetRef: c.sheetRef,
      kind: c.kind,
      titleText: c.titleText,
    }));
    if (callouts.length > 0) {
      calloutsByPageKey.set(`${documentId}\0${page.pageNumber}`, callouts);
    }
  }

  return {
    documentId,
    totalPages: result.totalPages ?? 0,
    calloutsFound: result.calloutsFound ?? 0,
    referenceCallouts: result.referenceCallouts ?? 0,
    calloutsByPageKey,
  };
}
