/**
 * Extract text with positions from PDF using PDF.js getTextContent.
 * Used for accurate hyperlink placement when PDF has embedded text.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { authHelpers } from '../lib/supabase';
import { getApiBaseUrl } from '../lib/apiConfig';

export interface TextItemWithPosition {
  str: string;
  /** Start index in concatenated page text */
  startIndex: number;
  /** End index (exclusive) */
  endIndex: number;
  /** Normalized 0-1 rect (x,y = top-left, same as overlay) */
  rect: { x: number; y: number; width: number; height: number };
}

export interface PageTextWithPositions {
  pageNumber: number;
  fullText: string;
  items: TextItemWithPosition[];
}

const pdfCache = new Map<string, { pdf: pdfjsLib.PDFDocumentProxy; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

function getCachedPdf(documentId: string, projectId: string): Promise<pdfjsLib.PDFDocumentProxy> | null {
  const key = `${documentId}:${projectId}`;
  const cached = pdfCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return Promise.resolve(cached.pdf);
  }
  return null;
}

function setCachedPdf(documentId: string, projectId: string, pdf: pdfjsLib.PDFDocumentProxy): void {
  const key = `${documentId}:${projectId}`;
  pdfCache.set(key, { pdf, timestamp: Date.now() });
}

/** Load PDF document for a file (uses same auth as workspace) */
export async function loadPdfForDocument(
  documentId: string,
  projectId: string
): Promise<pdfjsLib.PDFDocumentProxy> {
  const cached = getCachedPdf(documentId, projectId);
  if (cached) return cached;

  const API_BASE_URL = getApiBaseUrl();
  const pdfUrl = `${API_BASE_URL}/files/${documentId}`;
  const session = await authHelpers.getValidSession();
  const httpHeaders: Record<string, string> = { Accept: 'application/pdf' };
  if (session?.access_token) {
    httpHeaders['Authorization'] = `Bearer ${session.access_token}`;
  }

  const pdf = await pdfjsLib.getDocument({ url: pdfUrl, httpHeaders }).promise;
  setCachedPdf(documentId, projectId, pdf);
  return pdf;
}

/**
 * Get text content with positions for a single page.
 * Returns null if page has no text items.
 */
export async function getPageTextWithPositions(
  documentId: string,
  projectId: string,
  pageNumber: number
): Promise<PageTextWithPositions | null> {
  const pdf = await loadPdfForDocument(documentId, projectId);
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  if (!textContent?.items?.length) return null;

  const items: TextItemWithPosition[] = [];
  let startIndex = 0;

  for (const item of textContent.items as Array<{
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
  }>) {
    const str = item.str ?? '';
    if (!str) continue;

    const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
    const x = transform[4];
    const yPdf = transform[5];
    const w = item.width ?? 0;
    const h = item.height ?? 0;

    // PDF origin is bottom-left; convert to top-left normalized 0-1
    const xNorm = x / viewport.width;
    const yNorm = (viewport.height - yPdf - h) / viewport.height;
    const wNorm = w / viewport.width;
    const hNorm = h / viewport.height;

    items.push({
      str,
      startIndex,
      endIndex: startIndex + str.length,
      rect: { x: xNorm, y: yNorm, width: wNorm, height: hNorm },
    });
    startIndex += str.length;
  }

  const fullText = items.map((i) => i.str).join('');
  return { pageNumber, fullText, items };
}

/**
 * Get bounding rect for text spanning [startIndex, endIndex) in page text items.
 * Returns null if range is invalid or empty.
 */
export function getRectForTextRange(
  items: TextItemWithPosition[],
  startIndex: number,
  endIndex: number
): { x: number; y: number; width: number; height: number } | null {
  const overlapping = items.filter((it) => it.endIndex > startIndex && it.startIndex < endIndex);
  if (overlapping.length === 0) return null;

  const x0 = Math.min(...overlapping.map((it) => it.rect.x));
  const y0 = Math.min(...overlapping.map((it) => it.rect.y));
  const x1 = Math.max(...overlapping.map((it) => it.rect.x + it.rect.width));
  const y1 = Math.max(...overlapping.map((it) => it.rect.y + it.rect.height));

  const width = Math.max(x1 - x0, 0.008);
  const height = Math.max(y1 - y0, 0.008);
  return { x: x0, y: y0, width, height };
}
