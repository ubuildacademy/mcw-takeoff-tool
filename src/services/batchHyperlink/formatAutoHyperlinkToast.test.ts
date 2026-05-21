import { describe, expect, it } from 'vitest';
import { formatAutoHyperlinkToast } from './formatAutoHyperlinkToast';
import type { RunBatchHyperlinksResult } from './runBatchHyperlinks';

function baseRun(partial: Partial<RunBatchHyperlinksResult>): RunBatchHyperlinksResult {
  return {
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
    ...partial,
  };
}

describe('formatAutoHyperlinkToast', () => {
  it('uses friendly title when links were added', () => {
    const { title, description } = formatAutoHyperlinkToast(
      baseRun({ createdCount: 19, skippedNoTarget: 1 })
    );
    expect(title).toContain('19');
    expect(description).toMatch(/didn’t match/i);
  });

  it('explains cross-file duplicates when ambiguous skips remain', () => {
    const { description } = formatAutoHyperlinkToast(
      baseRun({ createdCount: 5, skippedAmbiguousTarget: 6, ambiguousKeysInIndex: ['A4.51', 'A3.02'] })
    );
    expect(description).toMatch(/more than one uploaded file/i);
    expect(description).toMatch(/A4\.51/);
  });

  it('notes zero links', () => {
    const { title } = formatAutoHyperlinkToast(baseRun({ createdCount: 0 }));
    expect(title).toMatch(/no new links/i);
  });

  it('mentions PyMuPDF pass counts when supplied', () => {
    const { description } = formatAutoHyperlinkToast(
      baseRun({ createdCount: 42 }),
      { pymupdfDocsRan: 2, pymupdfPagesExtracted: 80 }
    );
    expect(description).toMatch(/PyMuPDF re-read text from 2 PDFs/);
    expect(description).toMatch(/80 pages/);
  });

  it('omits PyMuPDF info when no docs ran', () => {
    const { description } = formatAutoHyperlinkToast(
      baseRun({ createdCount: 3 }),
      { pymupdfDocsRan: 0, pymupdfPagesExtracted: 0 }
    );
    expect(description ?? '').not.toMatch(/PyMuPDF/);
  });

  it('mentions bubble OCR counts when supplied', () => {
    const { description } = formatAutoHyperlinkToast(
      baseRun({ createdCount: 50 }),
      { bubbleOcrDocsRan: 1, bubbleOcrCalloutsFound: 27 }
    );
    expect(description).toMatch(/Bubble OCR scanned 1 PDF/);
    expect(description).toMatch(/27 round callouts/);
  });

  it('singularizes bubble OCR strings for one callout', () => {
    const { description } = formatAutoHyperlinkToast(
      baseRun({ createdCount: 5 }),
      { bubbleOcrDocsRan: 1, bubbleOcrCalloutsFound: 1 }
    );
    expect(description).toMatch(/1 round callout\b/);
    expect(description).not.toMatch(/round callouts/);
  });

  it('omits bubble OCR info when no docs ran', () => {
    const { description } = formatAutoHyperlinkToast(
      baseRun({ createdCount: 4 }),
      { bubbleOcrDocsRan: 0, bubbleOcrCalloutsFound: 0 }
    );
    expect(description ?? '').not.toMatch(/Bubble OCR/);
  });
});
