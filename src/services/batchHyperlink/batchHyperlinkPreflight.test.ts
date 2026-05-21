import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { PDFDocument } from '../../types';
import { runBatchHyperlinkPreflight } from './batchHyperlinkPreflight';

vi.mock('./fetchStoredOcrForDocument', () => ({
  fetchStoredOcrForDocument: vi.fn(),
}));

import { fetchStoredOcrForDocument } from './fetchStoredOcrForDocument';

describe('runBatchHyperlinkPreflight', () => {
  beforeEach(() => {
    vi.mocked(fetchStoredOcrForDocument).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('counts OCR pages and word-box coverage', async () => {
    const documents: PDFDocument[] = [
      {
        id: 'd1',
        name: 'One',
        totalPages: 1,
        pages: [
          {
            pageNumber: 1,
            hasTakeoffs: false,
            takeoffCount: 0,
            isVisible: true,
            ocrProcessed: false,
            sheetNumber: 'A1',
          },
        ],
        isExpanded: false,
        ocrEnabled: false,
      },
    ];

    vi.mocked(fetchStoredOcrForDocument).mockResolvedValue({
      documentId: 'd1',
      projectId: 'p1',
      totalPages: 1,
      processedAt: new Date().toISOString(),
      results: [
        { pageNumber: 1, text: '', confidence: 1, processingTime: 0, method: 'direct_extraction', wordBoxes: [{ index: 0, text: 'SEE', confidence: 90, bbox: { x: 0, y: 0, width: 0.1, height: 0.02 }, source: 'pdfjs' }] },
        { pageNumber: 2, text: '', confidence: 1, processingTime: 0, method: 'direct_extraction', wordBoxes: [] },
      ],
    });

    const r = await runBatchHyperlinkPreflight({
      projectId: 'p1',
      documents,
      scope: 'project',
      currentDocumentId: null,
    });

    expect(r.documentsInScope).toBe(1);
    expect(r.documentsWithStoredOcr).toBe(1);
    expect(r.totalOcrPages).toBe(2);
    expect(r.pagesWithWordBoxes).toBe(1);
    expect(r.pagesWithoutWordBoxes).toBe(1);
    expect(r.pagesWithSheetNumber).toBe(1);
    expect(r.ocrByDocumentId.has('d1')).toBe(true);
  });

  it('flags documents whose stored OCR has no PyMuPDF word boxes as needing PyMuPDF', async () => {
    const documents: PDFDocument[] = [
      {
        id: 'pdfjs-only',
        name: 'PDF.js Only',
        totalPages: 2,
        pages: [
          { pageNumber: 1, hasTakeoffs: false, takeoffCount: 0, isVisible: true, ocrProcessed: false, sheetNumber: 'A1.00' },
          { pageNumber: 2, hasTakeoffs: false, takeoffCount: 0, isVisible: true, ocrProcessed: false, sheetNumber: 'A1.01' },
        ],
        isExpanded: false,
        ocrEnabled: false,
      },
      {
        id: 'has-pymupdf',
        name: 'Has PyMuPDF',
        totalPages: 1,
        pages: [
          { pageNumber: 1, hasTakeoffs: false, takeoffCount: 0, isVisible: true, ocrProcessed: false, sheetNumber: 'B1.00' },
        ],
        isExpanded: false,
        ocrEnabled: false,
      },
      {
        id: 'no-ocr',
        name: 'No OCR',
        totalPages: 3,
        pages: [
          { pageNumber: 1, hasTakeoffs: false, takeoffCount: 0, isVisible: true, ocrProcessed: false, sheetNumber: 'C1.00' },
        ],
        isExpanded: false,
        ocrEnabled: false,
      },
    ];

    vi.mocked(fetchStoredOcrForDocument).mockImplementation(async (docId) => {
      if (docId === 'pdfjs-only') {
        return {
          documentId: 'pdfjs-only',
          projectId: 'p1',
          totalPages: 2,
          processedAt: new Date().toISOString(),
          results: [
            {
              pageNumber: 1,
              text: 'A1.00',
              confidence: 100,
              processingTime: 0,
              method: 'direct_extraction',
              wordBoxes: [
                { index: 0, text: 'A1.00', confidence: 100, bbox: { x: 0, y: 0, width: 0.1, height: 0.02 }, source: 'pdfjs' },
              ],
            },
            {
              pageNumber: 2,
              text: '',
              confidence: 0,
              processingTime: 0,
              method: 'direct_extraction',
              wordBoxes: [
                { index: 0, text: 'A1.01', confidence: 90, bbox: { x: 0, y: 0, width: 0.1, height: 0.02 }, source: 'pdfjs' },
              ],
            },
          ],
        };
      }
      if (docId === 'has-pymupdf') {
        return {
          documentId: 'has-pymupdf',
          projectId: 'p1',
          totalPages: 1,
          processedAt: new Date().toISOString(),
          results: [
            {
              pageNumber: 1,
              text: 'B1.00 A9.22',
              confidence: 100,
              processingTime: 0,
              method: 'direct_extraction',
              wordBoxes: [
                { index: 0, text: 'B1.00', confidence: 100, bbox: { x: 0, y: 0, width: 0.1, height: 0.02 }, source: 'pdfjs' },
                { index: 1, text: 'A9.22', confidence: 100, bbox: { x: 0.4, y: 0.4, width: 0.06, height: 0.03 }, source: 'pymupdf' },
              ],
            },
          ],
        };
      }
      // no-ocr → null
      return null;
    });

    const r = await runBatchHyperlinkPreflight({
      projectId: 'p1',
      documents,
      scope: 'project',
      currentDocumentId: null,
    });

    const ids = r.documentsNeedingPymupdf.map((d) => d.id).sort();
    expect(ids).toEqual(['no-ocr', 'pdfjs-only']);

    const noOcr = r.documentsNeedingPymupdf.find((d) => d.id === 'no-ocr');
    expect(noOcr?.hasNoStoredOcr).toBe(true);
    expect(noOcr?.totalPages).toBe(3);

    const pdfjsOnly = r.documentsNeedingPymupdf.find((d) => d.id === 'pdfjs-only');
    expect(pdfjsOnly?.hasNoStoredOcr).toBe(false);
    expect(pdfjsOnly?.totalPages).toBe(2);

    // The doc that already has any PyMuPDF word box should NOT need another pass.
    expect(r.documentsNeedingPymupdf.find((d) => d.id === 'has-pymupdf')).toBeUndefined();

    // None of these docs have a `source: 'bubble_ocr'` box yet, so all three are flagged
    // for the bubble pass — independently of pymupdf coverage.
    const bubbleIds = r.documentsNeedingBubbleOcr.map((d) => d.id).sort();
    expect(bubbleIds).toEqual(['has-pymupdf', 'no-ocr', 'pdfjs-only']);
  });

  it('flags only docs missing bubble-OCR markers regardless of PyMuPDF status', async () => {
    const documents: PDFDocument[] = [
      {
        id: 'both-done',
        name: 'Both Done',
        totalPages: 1,
        pages: [
          { pageNumber: 1, hasTakeoffs: false, takeoffCount: 0, isVisible: true, ocrProcessed: false, sheetNumber: 'A1.00' },
        ],
        isExpanded: false,
        ocrEnabled: false,
      },
      {
        id: 'pymupdf-only',
        name: 'PyMuPDF Only',
        totalPages: 1,
        pages: [
          { pageNumber: 1, hasTakeoffs: false, takeoffCount: 0, isVisible: true, ocrProcessed: false, sheetNumber: 'B1.00' },
        ],
        isExpanded: false,
        ocrEnabled: false,
      },
    ];

    vi.mocked(fetchStoredOcrForDocument).mockImplementation(async (docId) => {
      if (docId === 'both-done') {
        return {
          documentId: 'both-done',
          projectId: 'p1',
          totalPages: 1,
          processedAt: new Date().toISOString(),
          results: [
            {
              pageNumber: 1,
              text: 'A1.00',
              confidence: 100,
              processingTime: 0,
              method: 'direct_extraction',
              wordBoxes: [
                { index: 0, text: 'A1.00', confidence: 100, bbox: { x: 0, y: 0, width: 0.1, height: 0.02 }, source: 'pymupdf' },
                { index: 1, text: '', confidence: 0, bbox: { x: 0, y: 0, width: 0, height: 0 }, source: 'bubble_ocr' },
              ],
            },
          ],
        };
      }
      // pymupdf-only → has pymupdf box but NO bubble_ocr marker yet
      return {
        documentId: 'pymupdf-only',
        projectId: 'p1',
        totalPages: 1,
        processedAt: new Date().toISOString(),
        results: [
          {
            pageNumber: 1,
            text: 'B1.00',
            confidence: 100,
            processingTime: 0,
            method: 'direct_extraction',
            wordBoxes: [
              { index: 0, text: 'B1.00', confidence: 100, bbox: { x: 0, y: 0, width: 0.1, height: 0.02 }, source: 'pymupdf' },
            ],
          },
        ],
      };
    });

    const r = await runBatchHyperlinkPreflight({
      projectId: 'p1',
      documents,
      scope: 'project',
      currentDocumentId: null,
    });

    expect(r.documentsNeedingPymupdf.length).toBe(0);
    expect(r.documentsNeedingBubbleOcr.map((d) => d.id)).toEqual(['pymupdf-only']);
  });

  it('respects scope=current when flagging pymupdf-needed docs', async () => {
    const documents: PDFDocument[] = [
      {
        id: 'd1',
        name: 'D1',
        totalPages: 1,
        pages: [{ pageNumber: 1, hasTakeoffs: false, takeoffCount: 0, isVisible: true, ocrProcessed: false, sheetNumber: 'A1' }],
        isExpanded: false,
        ocrEnabled: false,
      },
      {
        id: 'd2',
        name: 'D2',
        totalPages: 1,
        pages: [{ pageNumber: 1, hasTakeoffs: false, takeoffCount: 0, isVisible: true, ocrProcessed: false, sheetNumber: 'A2' }],
        isExpanded: false,
        ocrEnabled: false,
      },
    ];
    vi.mocked(fetchStoredOcrForDocument).mockResolvedValue(null);

    const r = await runBatchHyperlinkPreflight({
      projectId: 'p1',
      documents,
      scope: 'current',
      currentDocumentId: 'd1',
    });

    expect(r.documentsInScope).toBe(1);
    expect(r.documentsNeedingPymupdf.length).toBe(1);
    expect(r.documentsNeedingPymupdf[0].id).toBe('d1');
    expect(r.documentsNeedingBubbleOcr.length).toBe(1);
    expect(r.documentsNeedingBubbleOcr[0].id).toBe('d1');
  });
});
