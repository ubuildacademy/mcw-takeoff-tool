import type { PDFDocument } from '../../types';
import { visualSearchApiService } from '../apiService';
import type { BatchOcrWordBox } from './detectSheetRefsFromWordBoxes';

export interface BuildCalloutPassWordBoxesResult {
  /** Key: `${documentId}\0${pageNumber}` */
  visualWordBoxesByPageKey: Map<string, BatchOcrWordBox[]>;
  calloutPagesMatched: number;
  calloutWordBoxCount: number;
}

function documentsInScope(
  documents: PDFDocument[],
  scope: 'project' | 'current',
  currentDocumentId: string | null | undefined
): PDFDocument[] {
  if (scope === 'current' && currentDocumentId) {
    return documents.filter((d) => d.id === currentDocumentId);
  }
  return documents;
}

/**
 * Template-match + ROI OCR pass for split-circle / cloud callout shapes.
 * Results are ephemeral (not persisted) — merged at link time via `visualWordBoxesByPageKey`.
 */
export async function buildCalloutPassWordBoxes(options: {
  projectId: string;
  documents: PDFDocument[];
  scope: 'project' | 'current';
  currentDocumentId?: string | null;
}): Promise<BuildCalloutPassWordBoxesResult> {
  const { projectId, documents, scope, currentDocumentId } = options;
  const scopedDocs = documentsInScope(documents, scope, currentDocumentId);
  const visualWordBoxesByPageKey = new Map<string, BatchOcrWordBox[]>();
  let calloutPagesMatched = 0;
  let calloutWordBoxCount = 0;

  for (const doc of scopedDocs) {
    const totalPages = Math.max(doc.totalPages ?? 0, doc.pages?.length ?? 0) || 1;
    const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
    if (pageNumbers.length === 0) continue;

    const { results } = await visualSearchApiService.runCalloutHyperlinkPass({
      projectId,
      documentId: doc.id,
      pageNumbers,
    });

    for (const row of results) {
      const boxes = row.wordBoxes ?? [];
      if (boxes.length === 0) continue;
      const mapped: BatchOcrWordBox[] = boxes
        .map((w) => ({
          text: typeof w.text === 'string' ? w.text : '',
          bbox: w.bbox,
          confidence: typeof w.confidence === 'number' ? w.confidence : undefined,
          source: 'callout_pass' as const,
        }))
        .filter((w) => w.text.trim().length > 0 && w.bbox && typeof w.bbox.x === 'number');

      if (mapped.length === 0) continue;
      calloutPagesMatched += 1;
      calloutWordBoxCount += mapped.length;
      visualWordBoxesByPageKey.set(`${doc.id}\0${row.pageNumber}`, mapped);
    }
  }

  return { visualWordBoxesByPageKey, calloutPagesMatched, calloutWordBoxCount };
}
