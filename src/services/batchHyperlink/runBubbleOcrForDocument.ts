import { ocrApiService } from '../apiService';

export interface RunBubbleOcrOptions {
  documentId: string;
  projectId: string;
}

export interface RunBubbleOcrResult {
  documentId: string;
  totalPages: number;
  /** Number of callout bubbles whose OCR survived the sheet-ref regex filter. */
  calloutsFound: number;
  /** Number of pages where at least one callout survived. */
  pagesWithCallouts: number;
}

/**
 * Auto-hyperlink pre-step (second half): ask the server to detect circular callout bubbles
 * on each page of the document and OCR each tiny crop.
 *
 * Most architectural detail-callout bubbles are drawn as vector paths (line segments forming
 * the glyphs) rather than text, so neither PDF.js nor PyMuPDF can read them. A targeted OCR
 * pass on the small bubble crop is fast (~1-2 s/page) where full-page OCR would be brutal.
 *
 * One server call per document; the server walks every page sequentially and merges survivors
 * into the document's stored OCR rows under `source: 'tesseract'`.
 */
export async function runBubbleOcrForDocument(
  options: RunBubbleOcrOptions,
): Promise<RunBubbleOcrResult> {
  const { documentId, projectId } = options;

  const result = await ocrApiService.runBubbleOcrExtract(documentId, projectId);

  return {
    documentId,
    totalPages: result.totalPages ?? 0,
    calloutsFound: result.calloutsFound ?? 0,
    pagesWithCallouts: result.pagesWithCallouts ?? 0,
  };
}
