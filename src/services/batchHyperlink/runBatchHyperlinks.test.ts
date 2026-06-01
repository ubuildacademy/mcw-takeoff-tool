import { describe, expect, it } from 'vitest';
import type { DocumentOCRData } from '../serverOcrService';
import type { PDFDocument } from '../../types';
import { runBatchHyperlinks } from './runBatchHyperlinks';

function pageMeta(sheetNumber: string, pageNumber: number) {
  return {
    pageNumber,
    hasTakeoffs: false as const,
    takeoffCount: 0,
    isVisible: true as const,
    ocrProcessed: true as const,
    sheetNumber,
  };
}

describe('runBatchHyperlinks', () => {
  it('creates one link per occurrence when the same sheet is referenced from multiple spots', async () => {
    const documents: PDFDocument[] = [
      {
        id: 'd1',
        name: 'Set',
        totalPages: 2,
        isExpanded: false,
        ocrEnabled: true,
        pages: [pageMeta('A6.01', 1), pageMeta('A6.05', 2)],
      },
    ];

    const ocr: DocumentOCRData = {
      documentId: 'd1',
      projectId: 'p1',
      totalPages: 2,
      processedAt: new Date().toISOString(),
      results: [
        {
          pageNumber: 1,
          text: '',
          confidence: 1,
          processingTime: 0,
          method: 'direct_extraction' as const,
          wordBoxes: [
            { index: 0, text: 'A6.05', confidence: 90, bbox: { x: 0.1, y: 0.15, width: 0.06, height: 0.02 }, source: 'pdfjs' as const },
            { index: 1, text: 'A6.05', confidence: 90, bbox: { x: 0.55, y: 0.42, width: 0.06, height: 0.02 }, source: 'pdfjs' as const },
          ],
        },
      ],
    };

    const run = await runBatchHyperlinks({
      projectId: 'p1',
      documents,
      mode: 'loose',
      scope: 'project',
      ocrByDocumentId: new Map([['d1', ocr]]),
    });

    expect(run.createdCount).toBe(2);
    expect(run.skippedDuplicate).toBe(0);
    expect(run.skippedSelfLink).toBe(0);
    expect(run.created.every((h) => h.targetPageNumber === 2)).toBe(true);
    const xs = run.created.map((h) => h.sourceRect.x).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(0.2);
    expect(xs[1]).toBeGreaterThan(0.4);
    expect(run.visualCalloutPagesMerged).toBe(0);
    expect(run.visualCalloutWordBoxCount).toBe(0);
  });

  it('merges supplemental callout-pass word boxes with stored OCR', async () => {
    const documents: PDFDocument[] = [
      {
        id: 'd1',
        name: 'Set',
        totalPages: 2,
        isExpanded: false,
        ocrEnabled: true,
        pages: [pageMeta('A9.01', 1), pageMeta('A9.31', 2)],
      },
    ];
    const ocr: DocumentOCRData = {
      documentId: 'd1',
      projectId: 'p1',
      totalPages: 2,
      processedAt: new Date().toISOString(),
      results: [
        {
          pageNumber: 1,
          text: '',
          confidence: 1,
          processingTime: 0,
          method: 'direct_extraction' as const,
          wordBoxes: [
            { index: 0, text: 'NOTE', confidence: 90, bbox: { x: 0.1, y: 0.5, width: 0.04, height: 0.02 }, source: 'pdfjs' as const },
          ],
        },
      ],
    };
    const pageKey = `d1\u0000${1}`;
    const visualMap = new Map([
      [
        pageKey,
        [{ text: 'A9.31', bbox: { x: 0.2, y: 0.3, width: 0.08, height: 0.02 }, confidence: 80 }],
      ],
    ]);
    const run = await runBatchHyperlinks({
      projectId: 'p1',
      documents,
      mode: 'loose',
      scope: 'project',
      ocrByDocumentId: new Map([['d1', ocr]]),
      visualWordBoxesByPageKey: visualMap,
    });
    expect(run.createdCount).toBe(1);
    expect(run.created[0]!.targetPageNumber).toBe(2);
    expect(run.visualCalloutPagesMerged).toBe(1);
    expect(run.visualCalloutWordBoxCount).toBe(1);
  });

  it('links bubble callouts to the same-document sheet even when a duplicate exists in another file', async () => {
    const documents: PDFDocument[] = [
      {
        id: 'plans',
        name: 'Plans',
        totalPages: 2,
        isExpanded: false,
        ocrEnabled: true,
        pages: [pageMeta('A4.01', 1), pageMeta('A4.51', 2)],
      },
      {
        id: 'revision',
        name: 'Revision (old)',
        totalPages: 1,
        isExpanded: false,
        ocrEnabled: true,
        pages: [pageMeta('A4.51', 1)],
      },
    ];
    const planOcr: DocumentOCRData = {
      documentId: 'plans',
      projectId: 'p1',
      totalPages: 2,
      processedAt: new Date().toISOString(),
      results: [
        {
          pageNumber: 1,
          text: '',
          confidence: 1,
          processingTime: 0,
          method: 'direct_extraction' as const,
          wordBoxes: [
            { index: 0, text: 'A4.51', confidence: 90, bbox: { x: 0.25, y: 0.3, width: 0.06, height: 0.02 }, source: 'pdfjs' as const },
          ],
        },
      ],
    };
    const run = await runBatchHyperlinks({
      projectId: 'p1',
      documents,
      mode: 'loose',
      scope: 'project',
      ocrByDocumentId: new Map([['plans', planOcr]]),
    });
    expect(run.createdCount).toBe(1);
    expect(run.created[0]!.targetSheetId).toBe('plans');
    expect(run.created[0]!.targetPageNumber).toBe(2);
    expect(run.skippedAmbiguousTarget).toBe(0);
  });

  it('matches A4.51 callouts against an A451 (no-dot) titleblock sheet number', async () => {
    const documents: PDFDocument[] = [
      {
        id: 'd1',
        name: 'Set',
        totalPages: 2,
        isExpanded: false,
        ocrEnabled: true,
        pages: [pageMeta('A4.01', 1), pageMeta('A451', 2)],
      },
    ];
    const ocr: DocumentOCRData = {
      documentId: 'd1',
      projectId: 'p1',
      totalPages: 2,
      processedAt: new Date().toISOString(),
      results: [
        {
          pageNumber: 1,
          text: '',
          confidence: 1,
          processingTime: 0,
          method: 'direct_extraction' as const,
          wordBoxes: [
            { index: 0, text: 'A4.51', confidence: 90, bbox: { x: 0.2, y: 0.3, width: 0.06, height: 0.02 }, source: 'pdfjs' as const },
          ],
        },
      ],
    };
    const run = await runBatchHyperlinks({
      projectId: 'p1',
      documents,
      mode: 'loose',
      scope: 'project',
      ocrByDocumentId: new Map([['d1', ocr]]),
    });
    expect(run.createdCount).toBe(1);
    expect(run.created[0]!.targetPageNumber).toBe(2);
  });

  it('uses isolated detection for bubble_ocr word boxes at the crop hotspot', async () => {
    const documents: PDFDocument[] = [
      {
        id: 'd1',
        name: 'Set',
        totalPages: 2,
        isExpanded: false,
        ocrEnabled: true,
        pages: [pageMeta('A9.01', 1), pageMeta('A9.31', 2)],
      },
    ];
    const ocr: DocumentOCRData = {
      documentId: 'd1',
      projectId: 'p1',
      totalPages: 2,
      processedAt: new Date().toISOString(),
      results: [
        {
          pageNumber: 1,
          text: '',
          confidence: 1,
          processingTime: 0,
          method: 'direct_extraction' as const,
          wordBoxes: [
            {
              index: 0,
              text: '15 A9.31',
              confidence: 80,
              bbox: { x: 0.62, y: 0.41, width: 0.04, height: 0.06 },
              source: 'bubble_ocr' as const,
            },
          ],
        },
      ],
    };
    const run = await runBatchHyperlinks({
      projectId: 'p1',
      documents,
      mode: 'loose',
      scope: 'project',
      ocrByDocumentId: new Map([['d1', ocr]]),
    });
    expect(run.createdCount).toBe(1);
    expect(run.created[0]!.sourceRect.y).toBeCloseTo(0.41, 2);
    expect(run.created[0]!.targetPageNumber).toBe(2);
  });
});
