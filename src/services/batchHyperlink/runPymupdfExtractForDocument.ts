import { ocrApiService } from '../apiService';

export interface RunPymupdfExtractOptions {
  documentId: string;
  projectId: string;
}

export interface RunPymupdfExtractResult {
  documentId: string;
  /** Pages the script touched (typically equals totalPages). */
  pagesExtracted: number;
  /** Pages that ended up with at least one word box. */
  pagesWithText: number;
  totalPages: number;
}

/**
 * Auto-hyperlink pre-step: ask the server to re-extract this document's text with PyMuPDF
 * (MuPDF) and merge the resulting word boxes into the document's stored OCR rows.
 *
 * One server call per document; no streaming, no progress callbacks. PyMuPDF reads the PDF
 * content stream directly and finishes a typical 80-page set of architectural drawings in a
 * few seconds, so per-page progress isn't useful.
 */
export async function runPymupdfExtractForDocument(
  options: RunPymupdfExtractOptions,
): Promise<RunPymupdfExtractResult> {
  const { documentId, projectId } = options;

  const result = await ocrApiService.runPymupdfExtract(documentId, projectId);

  return {
    documentId,
    pagesExtracted: result.pagesExtracted ?? 0,
    pagesWithText: result.pagesWithText ?? 0,
    totalPages: result.totalPages ?? 0,
  };
}
