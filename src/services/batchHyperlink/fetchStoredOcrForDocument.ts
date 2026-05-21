import { serverOcrService } from '../serverOcrService';

/** Read-only: returns persisted OCR for a document or null. */
export async function fetchStoredOcrForDocument(documentId: string, projectId: string) {
  return serverOcrService.getDocumentData(documentId, projectId);
}
