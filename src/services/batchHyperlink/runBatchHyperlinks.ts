import type { PDFDocument } from '../../types';
import type { SheetHyperlink } from '../../types';
import { buildSheetIndexFromDocuments, resolveTargetForSource, getTargetsWithNearMiss } from './buildSheetIndex';
import { detectSheetRefsFromWordBoxes, type BatchOcrWordBox } from './detectSheetRefsFromWordBoxes';
import { mergeSheetRefOccurrences } from './mergeSheetRefOccurrences';
import type { DocumentOCRData } from '../serverOcrService';
import { fetchStoredOcrForDocument } from './fetchStoredOcrForDocument';

export interface RunBatchHyperlinksOptions {
  projectId: string;
  documents: PDFDocument[];
  mode: 'strict' | 'loose';
  /** Entire project vs only the active PDF. */
  scope: 'project' | 'current';
  currentDocumentId?: string | null;
  /**
   * When set (e.g. after preflight), use these OCR payloads only — no additional fetches.
   * Documents missing from the map are treated as having no stored OCR.
   */
  ocrByDocumentId?: Map<string, DocumentOCRData>;
  /**
   * When set, merged after stored-OCR detection (IoU dedupe). Key: `${documentId}\\0${pageNumber}`.
   */
  visualWordBoxesByPageKey?: Map<string, BatchOcrWordBox[]>;
}

/** Diagnostic sample of a skipped occurrence — `[normalizedRef, sourceDocId, sourcePage, count]`. */
export type SkippedRefSample = [string, string, number, number];

export interface RunBatchHyperlinksResult {
  created: SheetHyperlink[];
  createdCount: number;
  skippedNoWordBoxesPages: number;
  skippedNoTarget: number;
  skippedAmbiguousTarget: number;
  skippedSelfLink: number;
  skippedDuplicate: number;
  ambiguousKeysInIndex: string[];
  pagesWithSheetNumber: number;
  documentsSkippedNoOcr: number;
  /** Pages where supplemental callout-pass word boxes were merged (if any). */
  visualCalloutPagesMerged: number;
  /** Total supplemental word boxes supplied for merging. */
  visualCalloutWordBoxCount: number;
  /** Top refs that found no target sheet, by frequency (capped). */
  topNoTargetRefs: SkippedRefSample[];
  /** Top refs flagged ambiguous across files, by frequency (capped). */
  topAmbiguousRefs: SkippedRefSample[];
}

function createHyperlinkIdFactory() {
  let seq = 0;
  return () => `hyperlink-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Runs auto-hyperlink across stored OCR only (no OCR jobs).
 */
export async function runBatchHyperlinks(options: RunBatchHyperlinksOptions): Promise<RunBatchHyperlinksResult> {
  const { projectId, documents, mode, scope, currentDocumentId, ocrByDocumentId, visualWordBoxesByPageKey } = options;

  const result: RunBatchHyperlinksResult = {
    created: [],
    createdCount: 0,
    skippedNoWordBoxesPages: 0,
    skippedNoTarget: 0,
    skippedAmbiguousTarget: 0,
    skippedSelfLink: 0,
    skippedDuplicate: 0,
    ambiguousKeysInIndex: [],
    pagesWithSheetNumber: 0,
    documentsSkippedNoOcr: 0,
    visualCalloutPagesMerged: 0,
    visualCalloutWordBoxCount: 0,
    topNoTargetRefs: [],
    topAmbiguousRefs: [],
  };

  /** key → `[ref, docId, pageNum, count]` (sample first occurrence + total count). */
  const noTargetCounts = new Map<string, SkippedRefSample>();
  const ambiguousCounts = new Map<string, SkippedRefSample>();
  function bump(map: Map<string, SkippedRefSample>, ref: string, docId: string, page: number): void {
    const key = `${ref}|${docId}|${page}`;
    const cur = map.get(key);
    if (cur) cur[3] += 1;
    else map.set(key, [ref, docId, page, 1]);
  }

  const sheetIndex = buildSheetIndexFromDocuments(documents);
  result.ambiguousKeysInIndex = sheetIndex.ambiguousKeys;
  result.pagesWithSheetNumber = sheetIndex.pagesWithSheetNumber;

  const docsInScope =
    scope === 'current' && currentDocumentId
      ? documents.filter((d) => d.id === currentDocumentId)
      : documents;

  const pending: SheetHyperlink[] = [];
  const duplicateWithinRun = new Set<string>();
  const nextId = createHyperlinkIdFactory();

  for (const doc of docsInScope) {
    const ocr =
      ocrByDocumentId !== undefined
        ? ocrByDocumentId.get(doc.id) ?? null
        : await fetchStoredOcrForDocument(doc.id, projectId);
    if (!ocr || !ocr.results?.length) {
      result.documentsSkippedNoOcr += 1;
      continue;
    }

    for (const pageResult of ocr.results) {
      const pageNum = pageResult.pageNumber;
      const wboxes = pageResult.wordBoxes;
      if (!Array.isArray(wboxes) || wboxes.length === 0) {
        result.skippedNoWordBoxesPages += 1;
        continue;
      }

      const words: BatchOcrWordBox[] = wboxes
        .map((w) => ({
          text: typeof w.text === 'string' ? w.text : '',
          bbox: w.bbox,
          confidence: typeof w.confidence === 'number' ? w.confidence : undefined,
        }))
        .filter((w) => w.bbox && typeof w.bbox.x === 'number');

      const pageKey = `${doc.id}\0${pageNum}`;
      const visualExtra = visualWordBoxesByPageKey?.get(pageKey) ?? [];
      if (visualExtra.length > 0) {
        result.visualCalloutPagesMerged += 1;
        result.visualCalloutWordBoxCount += visualExtra.length;
      }

      const refsStored = detectSheetRefsFromWordBoxes(words, { mode });
      const refsVisual =
        visualExtra.length > 0 ? detectSheetRefsFromWordBoxes(visualExtra, { mode }) : [];
      // Higher IoU than default: keep bubble hits unless they nearly duplicate stored OCR boxes (same ref, same footprint).
      const refs = mergeSheetRefOccurrences(refsStored, refsVisual, { iouThreshold: 0.62 });

      for (const occ of refs) {
        let candidates = sheetIndex.getTargets(occ.normalizedRef);
        if (candidates.length === 0) {
          candidates = getTargetsWithNearMiss(sheetIndex, occ.normalizedRef);
        }
        if (candidates.length === 0) {
          result.skippedNoTarget += 1;
          bump(noTargetCounts, occ.normalizedRef, doc.id, pageNum);
          continue;
        }
        const resolved = resolveTargetForSource(candidates, doc.id);
        if (!resolved.target) {
          // Same sheet number appears in multiple unrelated docs and none are this source doc.
          result.skippedAmbiguousTarget += 1;
          bump(ambiguousCounts, occ.normalizedRef, doc.id, pageNum);
          continue;
        }
        const target = resolved.target;
        if (target.documentId === doc.id && target.pageNumber === pageNum) {
          result.skippedSelfLink += 1;
          continue;
        }

        // Same target sheet may appear many times per page; only skip true duplicates (same ref + same box).
        const r = occ.sourceRect;
        const dedupeKey = `${doc.id}|${pageNum}|${occ.normalizedRef}|${r.x.toFixed(4)}|${r.y.toFixed(4)}|${r.width.toFixed(4)}|${r.height.toFixed(4)}`;
        if (duplicateWithinRun.has(dedupeKey)) {
          result.skippedDuplicate += 1;
          continue;
        }
        duplicateWithinRun.add(dedupeKey);

        const hyperlink: SheetHyperlink = {
          id: nextId(),
          projectId,
          sourceSheetId: doc.id,
          sourcePageNumber: pageNum,
          sourceRect: occ.sourceRect,
          targetSheetId: target.documentId,
          targetPageNumber: target.pageNumber,
          timestamp: new Date().toISOString(),
          origin: 'batch',
          detectedSheetRef: occ.normalizedRef,
        };
        pending.push(hyperlink);
      }
    }
  }

  result.created = pending;
  result.createdCount = pending.length;
  const TOP_N = 300;
  result.topNoTargetRefs = [...noTargetCounts.values()]
    .sort((a, b) => b[3] - a[3])
    .slice(0, TOP_N);
  result.topAmbiguousRefs = [...ambiguousCounts.values()]
    .sort((a, b) => b[3] - a[3])
    .slice(0, TOP_N);
  return result;
}

/** Replace batch-only hyperlinks then append new ones. */
export function applyBatchHyperlinkResults(
  pending: SheetHyperlink[],
  projectId: string,
  store: {
    clearBatchHyperlinksForProject: (projectId: string) => number;
    addHyperlinksBulk: (h: SheetHyperlink[]) => void;
  }
): void {
  store.clearBatchHyperlinksForProject(projectId);
  if (pending.length > 0) {
    store.addHyperlinksBulk(pending);
  }
}
