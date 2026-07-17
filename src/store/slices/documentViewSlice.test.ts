import { describe, it, expect, beforeEach } from 'vitest';
import { useDocumentViewStore } from './documentViewSlice';

const DOC = '11111111-2222-3333-4444-555555555555';
const sheet = (page: number) => `${DOC}-${page}`;

describe('documentViewSlice — hasExplicitScaleForSheet', () => {
  beforeEach(() => {
    useDocumentViewStore.setState({
      documentScales: {},
      documentScalesBySheet: {},
      documentLocations: {},
      documentLocationsBySheet: {},
      documentRotations: {},
      documentRotationsBySheet: {},
    });
  });

  it('false for a never-visited sheet', () => {
    expect(useDocumentViewStore.getState().hasExplicitScaleForSheet(sheet(1))).toBe(false);
  });

  it('false when only a location is saved (legacy doc-level or scroll-save race) — landing must fit, not restore 100%', () => {
    useDocumentViewStore.getState().setDocumentLocationBySheet(sheet(1), { x: 120, y: 340 });
    useDocumentViewStore.getState().setDocumentLocation(DOC, { x: 5, y: 9 });
    useDocumentViewStore.getState().setDocumentRotationBySheet(sheet(1), 90);
    expect(useDocumentViewStore.getState().hasExplicitScaleForSheet(sheet(1))).toBe(false);
  });

  it('true when a per-sheet zoom was saved, and only for that sheet', () => {
    useDocumentViewStore.getState().setDocumentScaleBySheet(sheet(3), 2.5);
    expect(useDocumentViewStore.getState().hasExplicitScaleForSheet(sheet(3))).toBe(true);
    expect(useDocumentViewStore.getState().hasExplicitScaleForSheet(sheet(4))).toBe(false);
  });

  it('true for a legacy document-level scale (matches getDocumentScaleBySheet fallback)', () => {
    useDocumentViewStore.getState().setDocumentScale(DOC, 1.5);
    expect(useDocumentViewStore.getState().hasExplicitScaleForSheet(sheet(7))).toBe(true);
    expect(useDocumentViewStore.getState().getDocumentScaleBySheet(sheet(7))).toBe(1.5);
  });
});
