import { describe, it, expect } from 'vitest';
import {
  buildStaticProjectContext,
  retrieveRelevantPages,
  STATIC_CONTEXT_CHAR_BUDGET,
  RETRIEVAL_TOTAL_CHAR_BUDGET,
  RETRIEVAL_PER_PAGE_CHAR_BUDGET,
  type ChatSourceDoc,
} from './chatContext';

describe('buildStaticProjectContext', () => {
  it('includes project details, all conditions, complete totals, and document list', () => {
    const context = buildStaticProjectContext({
      projectId: 'proj-1',
      project: {
        name: 'Riverside Tower',
        client: 'Acme Corp',
        location: 'Denver, CO',
        projectType: 'Commercial',
        status: 'active',
        description: 'A mixed-use tower.',
      },
      conditions: [
        { id: 'c1', name: 'Roof Membrane', type: 'area', unit: 'SF', wasteFactor: 10, materialCost: 2.5, description: 'TPO membrane' },
        { id: 'c2', name: 'Expansion Joint', type: 'linear', unit: 'LF', wasteFactor: 0, multiplier: 2, laborCost: 5 },
      ],
      totals: {
        totalMeasurements: 42,
        totalValue: 1234,
        byCondition: {
          c1: { count: 20, value: 800, unit: 'SF' },
          c2: { count: 22, value: 434, unit: 'LF' },
        },
      },
      documents: [
        { name: 'A-101.pdf', pageCount: 12 },
        { name: 'S-200.pdf', pageCount: 4 },
      ],
    });

    expect(context).toContain('Riverside Tower');
    expect(context).toContain('Acme Corp');
    expect(context).toContain('Roof Membrane');
    expect(context).toContain('Expansion Joint');
    expect(context).toContain('×2 multiplier');
    expect(context).toContain('Roof Membrane: 20 measurements, 800 SF');
    expect(context).toContain('Expansion Joint: 22 measurements, 434 LF');
    expect(context).toContain('A-101.pdf (12 pages)');
    expect(context).toContain('S-200.pdf (4 pages)');
    expect(context).not.toMatch(/Full OCR content/);
  });

  it('handles a null project and totals gracefully', () => {
    const context = buildStaticProjectContext({
      projectId: 'proj-2',
      project: null,
      conditions: [],
      totals: null,
      documents: [],
    });
    expect(context).toContain('proj-2');
    expect(context).toContain('No documents uploaded');
  });

  it('caps output at the static context char budget', () => {
    const manyConditions = Array.from({ length: 2000 }, (_, i) => ({
      id: `c${i}`,
      name: `Condition number ${i} with a fairly long descriptive name`,
      type: 'area',
      unit: 'SF',
      wasteFactor: 10,
      description: 'Some description text that adds length to each line.',
    }));
    const context = buildStaticProjectContext({
      projectId: 'proj-3',
      project: { name: 'Big Project' },
      conditions: manyConditions,
      totals: null,
      documents: [],
    });
    expect(context.length).toBeLessThanOrEqual(STATIC_CONTEXT_CHAR_BUDGET);
  });
});

describe('retrieveRelevantPages', () => {
  function makeDocs(pages: Array<{ docId?: string; docName?: string; pageNumber: number; text: string }>): ChatSourceDoc[] {
    const byDoc = new Map<string, ChatSourceDoc>();
    for (const p of pages) {
      const docId = p.docId ?? 'doc-1';
      const docName = p.docName ?? 'doc.pdf';
      let entry = byDoc.get(docId);
      if (!entry) {
        entry = { docId, docName, pages: [] };
        byDoc.set(docId, entry);
      }
      entry.pages.push({ pageNumber: p.pageNumber, text: p.text });
    }
    return Array.from(byDoc.values());
  }

  it('prefers pages containing question terms over pages that do not', () => {
    const docs = makeDocs([
      { pageNumber: 1, text: 'General notes and legend for the project drawings.' },
      { pageNumber: 2, text: 'Waterproofing membrane details at the parapet and roof drain penetrations.' },
      { pageNumber: 3, text: 'Electrical panel schedule and circuit breaker information.' },
    ]);

    const result = retrieveRelevantPages('What are the waterproofing membrane details at the roof?', docs);
    expect(result).toContain('page 2');
    // Page 2 should appear before the unrelated electrical page (or the electrical
    // page should be excluded entirely since it scores 0 for these terms).
    const page2Index = result.indexOf('page 2');
    const page3Index = result.indexOf('page 3');
    expect(page2Index).toBeGreaterThanOrEqual(0);
    if (page3Index >= 0) {
      expect(page2Index).toBeLessThan(page3Index);
    }
  });

  it('weights rare terms higher than common terms (IDF)', () => {
    // "concrete" appears the same (capped) number of times on every page, so it
    // contributes equally everywhere. Only page 2 also contains the rare term
    // "hydrostatic" — IDF weighting should make that the deciding factor.
    const commonFiller = 'concrete concrete concrete concrete concrete concrete.';
    const docs = makeDocs([
      { pageNumber: 1, text: `${commonFiller} General notes for the slab.` },
      { pageNumber: 2, text: `${commonFiller} Hydrostatic pressure requires crystalline waterproofing.` },
      { pageNumber: 3, text: `${commonFiller} Footing and column schedule.` },
    ]);

    const result = retrieveRelevantPages('hydrostatic concrete', docs);
    // Page 2 (contains the rare term "hydrostatic") should be the top-ranked page.
    const firstPageMarker = result.split('──')[1];
    expect(firstPageMarker).toContain('page 2');
  });

  it('gives a sheet-reference match a large boost over plain term matches', () => {
    const docs = makeDocs([
      { pageNumber: 1, text: 'Waterproofing waterproofing waterproofing details and notes throughout.' },
      { pageNumber: 2, text: 'Sheet A-101 — floor plan, ground level, minimal waterproofing mention.' },
      { pageNumber: 3, text: 'Unrelated mechanical schedule with no overlap at all.' },
    ]);

    const result = retrieveRelevantPages('Show me sheet A-101 waterproofing scope', docs);
    const firstPageMarker = result.split('──')[1];
    expect(firstPageMarker).toContain('page 2');
  });

  it('excludes zero-score pages when at least one page scores above zero', () => {
    const docs = makeDocs([
      { pageNumber: 1, text: 'Waterproofing membrane and sealant scope for the plaza deck.' },
      { pageNumber: 2, text: 'Completely unrelated content about staffing and payroll.' },
    ]);
    const result = retrieveRelevantPages('waterproofing membrane scope', docs);
    expect(result).toContain('page 1');
    expect(result).not.toContain('page 2');
  });

  it('falls back to the first page of each document when every page scores 0', () => {
    const docs = makeDocs([
      { docId: 'd1', docName: 'A-100.pdf', pageNumber: 1, text: 'Titleblock and index for document one.' },
      { docId: 'd1', docName: 'A-100.pdf', pageNumber: 2, text: 'More content for document one, page two.' },
      { docId: 'd2', docName: 'S-200.pdf', pageNumber: 1, text: 'Titleblock and index for document two.' },
      { docId: 'd2', docName: 'S-200.pdf', pageNumber: 3, text: 'More content for document two, page three.' },
    ]);
    // A question with no term overlap with any page and no sheet-ref match.
    const result = retrieveRelevantPages('xyzzy plugh frobnicate qux', docs);
    expect(result).toContain('A-100.pdf');
    expect(result).toContain('S-200.pdf');
    expect(result).toContain('page 1');
    // Should not include the non-first pages in the fallback.
    expect(result).not.toContain('page 2');
    expect(result).not.toContain('page 3');
  });

  it('falls back for a stopword-only question', () => {
    const docs = makeDocs([
      { pageNumber: 1, text: 'Some page content about the project scope and details.' },
    ]);
    const result = retrieveRelevantPages('what is this and how does it work', docs);
    expect(result).toContain('page 1');
  });

  it('caps a single very long page to the per-page char budget', () => {
    const longText = 'waterproofing detail '.repeat(2000); // Well over the per-page budget.
    const docs = makeDocs([{ pageNumber: 1, text: longText }]);
    const result = retrieveRelevantPages('waterproofing detail', docs);
    // Strip the header line to isolate the page text portion.
    const textPortion = result.replace(/^── .* ──\n/, '');
    expect(textPortion.length).toBeLessThanOrEqual(RETRIEVAL_PER_PAGE_CHAR_BUDGET + 1);
  });

  it('enforces the total char budget across many relevant pages', () => {
    const pages = Array.from({ length: 20 }, (_, i) => ({
      pageNumber: i + 1,
      text: `waterproofing membrane scope details ${'x'.repeat(5000)}`,
    }));
    const docs = makeDocs(pages);
    const result = retrieveRelevantPages('waterproofing membrane scope', docs);
    expect(result.length).toBeLessThanOrEqual(RETRIEVAL_TOTAL_CHAR_BUDGET);
  });

  it('returns an empty string when there are no pages', () => {
    expect(retrieveRelevantPages('anything', [])).toBe('');
  });
});
