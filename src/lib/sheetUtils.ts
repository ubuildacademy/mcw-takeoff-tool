/**
 * Sheet identifier utilities for multi-tab and document view state.
 * sheetId = `${documentId}-${pageNumber}` (e.g. "abc123-2")
 */

export function getSheetId(documentId: string, pageNumber: number): string {
  return `${documentId}-${pageNumber}`;
}

/** Extract documentId from sheetId for fallback lookups. Handles IDs that may contain hyphens. */
export function parseDocumentIdFromSheetId(sheetId: string): string {
  if (!sheetId.includes('-')) return sheetId;
  return sheetId.slice(0, sheetId.lastIndexOf('-'));
}
