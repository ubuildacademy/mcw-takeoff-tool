import type { PDFDocument } from '../../types';
import type { DocumentOCRData } from '../serverOcrService';
import { buildSheetIndexFromDocuments } from './buildSheetIndex';
import { fetchStoredOcrForDocument } from './fetchStoredOcrForDocument';

export type { DocumentOCRData };

/** Stats gathered from sidebar + one read pass over stored OCR (no writes). */
export interface BatchHyperlinkPreflightResult {
  documentsInScope: number;
  documentsWithStoredOcr: number;
  /** Display names for PDFs in scope that have no stored OCR rows. */
  documentsMissingOcrNames: string[];
  /** Pages returned in OCR results (may exceed sidebar page count if API differs). */
  totalOcrPages: number;
  pagesWithWordBoxes: number;
  pagesWithoutWordBoxes: number;
  /** From sheet index: pages with a non-Unknown sheetNumber. */
  pagesWithSheetNumber: number;
  /** Total sidebar pages across all project PDFs (for “coverage” context). */
  totalPagesInProject: number;
  ambiguousSheetNumberKeys: string[];
  /** Fetched OCR payloads to reuse for the run step (no second fetch). */
  ocrByDocumentId: Map<string, DocumentOCRData>;
  /**
   * Documents whose stored OCR has no PyMuPDF-derived word boxes yet — i.e. their text was
   * only read by PDF.js (or hasn't been read at all). PDF.js silently drops glyphs in Type-3
   * fonts and form XObjects with malformed ToUnicode CMaps, which is how callout-bubble text
   * in vector architectural PDFs goes missing. PyMuPDF (MuPDF) reads those reliably, so we
   * offer to run it on these documents before linking. Includes documents with no stored OCR
   * at all (their PDF.js pass either hasn't run or returned nothing).
   */
  documentsNeedingPymupdf: Array<{
    id: string;
    name: string;
    totalPages: number;
    /** True iff there is no OCR row at all for this document yet. */
    hasNoStoredOcr: boolean;
  }>;
  /**
   * Documents whose stored OCR has no bubble-OCR marker yet. PDF.js and PyMuPDF both miss
   * round callout bubbles that are drawn as vector paths instead of text glyphs (very common
   * on architectural detail/section bubbles). The bubble-OCR pass detects circular shapes via
   * OpenCV and OCRs each tiny crop with Tesseract, which is fast enough to run inline. Tracked
   * independently of `documentsNeedingPymupdf` so the bubble pass keeps running on subsequent
   * Auto-hyperlink invocations until the document is marked done.
   */
  documentsNeedingBubbleOcr: Array<{
    id: string;
    name: string;
    totalPages: number;
    hasNoStoredOcr: boolean;
  }>;
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

function totalProjectPages(documents: PDFDocument[]): number {
  let n = 0;
  for (const doc of documents) {
    n += Math.max(doc.totalPages ?? 0, doc.pages?.length ?? 0) || 1;
  }
  return n;
}

/**
 * Load stored OCR once and summarize index + OCR coverage for the Auto-hyperlink confirm step.
 */
export async function runBatchHyperlinkPreflight(options: {
  projectId: string;
  documents: PDFDocument[];
  scope: 'project' | 'current';
  currentDocumentId?: string | null;
}): Promise<BatchHyperlinkPreflightResult> {
  const { projectId, documents, scope, currentDocumentId } = options;
  const scopedDocs = documentsInScope(documents, scope, currentDocumentId);

  const sheetIndex = buildSheetIndexFromDocuments(documents);
  const ocrByDocumentId = new Map<string, DocumentOCRData>();

  let documentsWithStoredOcr = 0;
  const documentsMissingOcrNames: string[] = [];
  const documentsNeedingPymupdf: BatchHyperlinkPreflightResult['documentsNeedingPymupdf'] = [];
  const documentsNeedingBubbleOcr: BatchHyperlinkPreflightResult['documentsNeedingBubbleOcr'] = [];
  let totalOcrPages = 0;
  let pagesWithWordBoxes = 0;
  let pagesWithoutWordBoxes = 0;

  for (const doc of scopedDocs) {
    const docName = doc.name?.trim() || doc.id;
    const docTotalPages = Math.max(doc.totalPages ?? 0, doc.pages?.length ?? 0) || 1;
    const ocr = await fetchStoredOcrForDocument(doc.id, projectId);
    if (!ocr || !ocr.results?.length) {
      documentsMissingOcrNames.push(docName);
      // No stored OCR at all → candidate for both pre-passes. The PyMuPDF pass also seeds
      // the row, so it must run first; the bubble pass then layers callout markers on top.
      documentsNeedingPymupdf.push({
        id: doc.id,
        name: docName,
        totalPages: docTotalPages,
        hasNoStoredOcr: true,
      });
      documentsNeedingBubbleOcr.push({
        id: doc.id,
        name: docName,
        totalPages: docTotalPages,
        hasNoStoredOcr: true,
      });
      continue;
    }
    documentsWithStoredOcr += 1;
    ocrByDocumentId.set(doc.id, ocr);

    let hasPymupdfBox = false;
    let hasBubbleOcrBox = false;
    for (const pageResult of ocr.results) {
      totalOcrPages += 1;
      const wboxes = pageResult.wordBoxes;
      if (Array.isArray(wboxes) && wboxes.length > 0) {
        pagesWithWordBoxes += 1;
        if (!hasPymupdfBox || !hasBubbleOcrBox) {
          for (const box of wboxes) {
            if (!box) continue;
            if (box.source === 'pymupdf') hasPymupdfBox = true;
            else if (box.source === 'bubble_ocr') hasBubbleOcrBox = true;
            if (hasPymupdfBox && hasBubbleOcrBox) break;
          }
        }
      } else {
        pagesWithoutWordBoxes += 1;
      }
    }

    // If no page has any PyMuPDF-derived word box, the stored OCR is pure PDF.js direct
    // extraction (or an older Tesseract pass). Re-reading the PDF with MuPDF typically
    // recovers callout-bubble glyphs that PDF.js silently drops.
    if (!hasPymupdfBox) {
      documentsNeedingPymupdf.push({
        id: doc.id,
        name: docName,
        totalPages: docTotalPages,
        hasNoStoredOcr: false,
      });
    }
    // Bubble OCR (region-targeted Tesseract on detected circles) is tracked independently:
    // a doc can have full PyMuPDF coverage and still be missing bubble-OCR coverage if the
    // pass hasn't run yet for it. The bubble-OCR route writes a sentinel marker per page
    // even when 0 callouts are detected, so a missing marker means "never ran here".
    if (!hasBubbleOcrBox) {
      documentsNeedingBubbleOcr.push({
        id: doc.id,
        name: docName,
        totalPages: docTotalPages,
        hasNoStoredOcr: false,
      });
    }
  }

  return {
    documentsInScope: scopedDocs.length,
    documentsWithStoredOcr,
    documentsMissingOcrNames,
    totalOcrPages,
    pagesWithWordBoxes,
    pagesWithoutWordBoxes,
    pagesWithSheetNumber: sheetIndex.pagesWithSheetNumber,
    totalPagesInProject: totalProjectPages(documents),
    ambiguousSheetNumberKeys: sheetIndex.ambiguousKeys,
    ocrByDocumentId,
    documentsNeedingPymupdf,
    documentsNeedingBubbleOcr,
  };
}
