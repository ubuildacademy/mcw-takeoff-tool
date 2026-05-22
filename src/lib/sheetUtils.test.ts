import { describe, it, expect } from 'vitest';
import { getSheetId, parseDocumentIdFromSheetId } from './sheetUtils';

describe('sheetUtils', () => {
  it('getSheetId joins document id and page number', () => {
    expect(getSheetId('doc-abc', 3)).toBe('doc-abc-3');
  });

  it('parseDocumentIdFromSheetId handles simple ids', () => {
    expect(parseDocumentIdFromSheetId('doc-abc-3')).toBe('doc-abc');
  });

  it('parseDocumentIdFromSheetId handles UUID document ids with hyphens', () => {
    const docId = '550e8400-e29b-41d4-a716-446655440000';
    expect(parseDocumentIdFromSheetId(`${docId}-12`)).toBe(docId);
  });

  it('parseDocumentIdFromSheetId returns input when no hyphen', () => {
    expect(parseDocumentIdFromSheetId('legacyDoc')).toBe('legacyDoc');
  });
});
