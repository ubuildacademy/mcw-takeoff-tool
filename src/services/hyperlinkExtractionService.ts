/**
 * Auto-extract hyperlinks from OCR text by matching sheet references to labeled sheets.
 * Finds patterns like "A-4.1", "See Detail 3", "Refer to Sheet 5" and creates hyperlinks.
 * Uses PDF.js text positions when available for accurate placement; falls back to OCR + heuristic.
 */

import type { PDFDocument } from '../types';
import type { DocumentOCRData } from './serverOcrService';
import type { PageTextWithPositions } from './pdfTextPositionService';
import { getRectForTextRange } from './pdfTextPositionService';

export interface ExtractedHyperlink {
  sourceSheetId: string;
  sourcePageNumber: number;
  sourceRect: { x: number; y: number; width: number; height: number };
  targetSheetId: string;
  targetPageNumber: number;
  matchedText: string;
}

/** Text source for a page: PDF (accurate positions) or OCR (heuristic) */
export type PageTextSource =
  | { type: 'pdf'; data: PageTextWithPositions }
  | { type: 'ocr'; text: string };

/** Normalize sheet reference for matching (e.g. "A-4.1" -> "a41", "1/A4.1" -> "1a41") */
function normalizeRef(s: string): string {
  return s.replace(/[-.\s/]/g, '').toLowerCase();
}

/** Build map of reference -> target (sheetId, pageNumber) from labeled documents */
function buildReferenceMap(documents: PDFDocument[]): Map<string, { sheetId: string; pageNumber: number }> {
  const map = new Map<string, { sheetId: string; pageNumber: number }>();
  for (const doc of documents) {
    for (const page of doc.pages ?? []) {
      const sheetId = doc.id;
      const pageNumber = page.pageNumber;
      const sheetNum = (page.sheetNumber ?? '').trim();
      const sheetName = (page.sheetName ?? '').trim();
      if (sheetNum) {
        map.set(normalizeRef(sheetNum), { sheetId, pageNumber });
        map.set(sheetNum.toLowerCase(), { sheetId, pageNumber });
      }
      if (sheetName) {
        map.set(sheetName.toLowerCase(), { sheetId, pageNumber });
      }
      map.set(`page${pageNumber}`, { sheetId, pageNumber });
      map.set(String(pageNumber), { sheetId, pageNumber });
    }
  }
  return map;
}

/**
 * Estimate sourceRect from text position. Uses line-based heuristic when we don't have word bbox.
 */
function estimateRectFromTextMatch(
  fullText: string,
  matchStartIndex: number
): { x: number; y: number; width: number; height: number } {
  const lines = fullText.split(/\r?\n/);
  let charCount = 0;
  let lineIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i].length + 1;
    if (charCount + lineLen > matchStartIndex) {
      lineIndex = i;
      break;
    }
    charCount += lineLen;
  }
  const numLines = Math.max(lines.length, 1);
  const y = 0.08 + (lineIndex / numLines) * 0.75;
  const height = Math.max(0.015, 0.7 / numLines);
  return { x: 0.15, y, width: 0.5, height };
}

/**
 * Find potential sheet references in text using regex patterns.
 * Returns matches with their text and start index. Dedupes by (text, startIndex).
 */
function findReferenceMatches(text: string): Array<{ text: string; startIndex: number }> {
  const seen = new Set<string>();
  const matches: Array<{ text: string; startIndex: number }> = [];

  const add = (ref: string, idx: number) => {
    const key = `${idx}:${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (ref.length >= 1) matches.push({ text: ref.trim(), startIndex: idx });
  };

  let m: RegExpExecArray | null;

  // Pattern 1: Sheet numbers - A-4.1, A4.1, 4.21, A.4.21, 1/A4.1, G-101
  const sheetNumRegex = /\b([A-Z]?\d+[.-]?\d*)\b|\b([A-Z][-.]?\d+\.?\d*)\b|\b(\d+\/\d+\.?\d*)\b/gi;
  while ((m = sheetNumRegex.exec(text)) !== null) {
    const ref = (m[1] ?? m[2] ?? m[3] ?? m[0]).trim();
    if (ref.length >= 2) add(ref, m.index);
  }

  // Pattern 2: "See Detail X", "Detail X", "Sheet A4.1", "Refer to Plan 4", "Ref. A4.1", "Typ. 3"
  const detailRegex =
    /\b(?:see\s+|refer\s+to\s+|ref\.?\s*|typ\.?\s*|r\/\s*)?(?:detail|sheet|plan|sht\.?)\s*[#:]?\s*([A-Z0-9./-]+)\b/gi;
  while ((m = detailRegex.exec(text)) !== null) {
    add(m[1].trim(), m.index);
  }

  // Pattern 3: Standalone numbers after context - "Detail 3", "Sheet 5", "Plan 12"
  const simpleRefRegex = /\b(?:detail|sheet|plan|sht\.?|dwg)\s+(\d+)\b/gi;
  while ((m = simpleRefRegex.exec(text)) !== null) {
    add(m[1].trim(), m.index);
  }

  return matches;
}

function getSourceRect(
  source: PageTextSource,
  startIndex: number,
  endIndex: number
): { x: number; y: number; width: number; height: number } {
  if (source.type === 'pdf' && source.data.items.length > 0) {
    const rect = getRectForTextRange(source.data.items, startIndex, endIndex);
    if (rect) return rect;
  }
  return estimateRectFromTextMatch(
    source.type === 'pdf' ? source.data.fullText : source.text,
    startIndex
  );
}

function getPageText(source: PageTextSource): string {
  return source.type === 'pdf' ? source.data.fullText : source.text;
}

/**
 * Extract hyperlinks from page text sources. Uses PDF positions when available for accurate placement.
 */
export function extractHyperlinksFromPageSources(
  projectId: string,
  documents: PDFDocument[],
  pageSources: Map<string, Map<number, PageTextSource>>
): ExtractedHyperlink[] {
  const refMap = buildReferenceMap(documents);
  const results: ExtractedHyperlink[] = [];
  const seen = new Set<string>();

  for (const doc of documents) {
    const docSources = pageSources.get(doc.id);
    if (!docSources?.size) continue;

    for (const [pageNum, source] of docSources) {
      const sourcePageNumber = typeof pageNum === 'number' ? pageNum : parseInt(String(pageNum), 10);
      if (Number.isNaN(sourcePageNumber)) continue;

      const text = getPageText(source);
      if (!text.trim()) continue;

      const sourceSheetId = doc.id;
      const matchKeyBase = `${sourceSheetId}:${sourcePageNumber}:`;

      const refMatches = findReferenceMatches(text);
      for (const { text: refText, startIndex } of refMatches) {
        const endIndex = startIndex + refText.length;
        const norm = normalizeRef(refText);
        const target = refMap.get(norm) ?? refMap.get(refText.toLowerCase());
        if (!target) continue;

        if (target.sheetId === sourceSheetId && target.pageNumber === sourcePageNumber) continue;

        const dedupeKey = `${matchKeyBase}${refText}:${target.sheetId}:${target.pageNumber}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const sourceRect = getSourceRect(source, startIndex, endIndex);
        results.push({
          sourceSheetId,
          sourcePageNumber,
          sourceRect,
          targetSheetId: target.sheetId,
          targetPageNumber: target.pageNumber,
          matchedText: refText,
        });
      }
    }
  }

  return results;
}

/**
 * Extract hyperlinks from OCR data by matching references to labeled sheets.
 * Builds page sources from OCR; for accurate placement, use extractHyperlinksFromPageSources
 * with PDF text positions (getPageTextWithPositions) when available.
 */
export function extractHyperlinksFromOCR(
  projectId: string,
  documents: PDFDocument[],
  ocrDataByDocument: Map<string, DocumentOCRData | null>
): ExtractedHyperlink[] {
  const pageSources = new Map<string, Map<number, PageTextSource>>();
  for (const doc of documents) {
    const ocrData = ocrDataByDocument.get(doc.id);
    if (!ocrData?.results?.length) continue;
    const map = new Map<number, PageTextSource>();
    for (const r of ocrData.results) {
      const text = r.text ?? '';
      if (text.trim()) map.set(r.pageNumber, { type: 'ocr', text });
    }
    if (map.size) pageSources.set(doc.id, map);
  }
  return extractHyperlinksFromPageSources(projectId, documents, pageSources);
}
