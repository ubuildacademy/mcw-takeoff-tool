/**
 * Sheet ids are `${documentId}-${pageNumber}` (see client `getSheetId`).
 * Document ids may be UUIDs with hyphens, so do not split on the first `-` only.
 */

export function parseDocumentIdFromSheetId(sheetId: string): string {
  if (!sheetId.includes('-')) return sheetId;
  return sheetId.slice(0, sheetId.lastIndexOf('-'));
}

export function parsePageNumberFromSheetId(sheetId: string): number {
  const tail = sheetId.slice(sheetId.lastIndexOf('-') + 1);
  return parseInt(tail, 10);
}
