/**
 * Render any project PDF page to an offscreen raster (rotation 0), independent
 * of what's open in the viewer. Used by revision compare, which needs clean
 * renders of two different documents at matched dimensions.
 */
import { getApiBaseUrl } from '../lib/apiConfig';
import { getAuthHeaders } from '../lib/apiAuth';
import { getPdfjs } from '../lib/pdfjs';

export interface PageRaster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Unrotated page size in PDF points (for dimension-compatibility checks). */
  pageWidthPt: number;
  pageHeightPt: number;
}

async function fetchPdfBytes(fileId: string): Promise<Uint8Array> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${getApiBaseUrl()}/files/${fileId}`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Render `pageNumber` (1-based) of `fileId` at rotation 0, sized so the longer
 * side is `maxSide` px. Same-size sheets rendered with the same `maxSide` come
 * back with identical raster dimensions — the property revision diff needs.
 */
export async function renderPageRaster(
  fileId: string,
  pageNumber: number,
  maxSide = 2200
): Promise<PageRaster> {
  const pdfjsLib = await getPdfjs();
  const bytes = await fetchPdfBytes(fileId);
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  try {
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1, rotation: 0 });
    const scale = maxSide / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale, rotation: 0 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    // White background so transparent pages binarize as blank, not ink.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport } as unknown as Parameters<typeof page.render>[0]).promise;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return {
      data: imageData.data,
      width: canvas.width,
      height: canvas.height,
      pageWidthPt: base.width,
      pageHeightPt: base.height,
    };
  } finally {
    try {
      await doc.destroy();
    } catch {
      // best effort
    }
  }
}
