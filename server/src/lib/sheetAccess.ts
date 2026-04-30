import { storage, type StoredSheet } from '../storage';
import { hasProjectAccess, isAdmin } from '../middleware/auth';

/** Matches client `getSheetId` / `parseDocumentIdFromSheetId`: `${documentId}-${pageNumber}`. */
export function documentIdFromSheetKey(sheetId: string): string {
  if (!sheetId.includes('-')) return sheetId;
  return sheetId.slice(0, sheetId.lastIndexOf('-'));
}

export function pageNumberFromSheetKey(sheetId: string): number {
  if (!sheetId.includes('-')) return 1;
  const n = parseInt(sheetId.slice(sheetId.lastIndexOf('-') + 1), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Resolve backing file and verify user can read/write this sheet key (IDOR prevention). */
export async function assertSheetAccess(
  userId: string,
  sheetId: string
): Promise<{ ok: true; sheet: StoredSheet | null; documentId: string } | { ok: false }> {
  const userIsAdmin = await isAdmin(userId);
  const sheet = await storage.getSheet(sheetId);
  const documentId = sheet?.documentId ?? documentIdFromSheetKey(sheetId);

  const file = await storage.getFile(documentId);
  if (!file) {
    return { ok: false };
  }

  const expectedPage = pageNumberFromSheetKey(sheetId);
  if (sheet && sheet.pageNumber !== expectedPage) {
    return { ok: false };
  }

  if (!userIsAdmin && !(await hasProjectAccess(userId, file.projectId, userIsAdmin))) {
    return { ok: false };
  }

  return { ok: true, sheet, documentId };
}
