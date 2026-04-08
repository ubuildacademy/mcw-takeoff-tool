import { useState, useCallback, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { authHelpers } from '../../lib/supabase';
import { fileService } from '../../services/apiService';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import type { PDFDocument, PDFPage, ProjectFile } from '../../types';

export interface UseTakeoffWorkspaceDocumentsOptions {
  projectId: string | undefined;
  projectFiles: ProjectFile[];
}

export interface UseTakeoffWorkspaceDocumentsResult {
  documents: PDFDocument[];
  documentsLoading: boolean;
  loadProjectDocuments: (filesOverride?: ProjectFile[]) => Promise<void>;
  setDocuments: React.Dispatch<React.SetStateAction<PDFDocument[]>>;
}

/**
 * Loads and caches project documents (PDF metadata + sheet data) for the takeoff workspace.
 * Does not own projectFiles; parent fetches those and passes them in.
 */
export function useTakeoffWorkspaceDocuments({
  projectId,
  projectFiles,
}: UseTakeoffWorkspaceDocumentsOptions): UseTakeoffWorkspaceDocumentsResult {
  const [documents, setDocuments] = useState<PDFDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState<boolean>(true);
  const getProjectTakeoffMeasurements = useMeasurementStore((s) => s.getProjectTakeoffMeasurements);

  const loadProjectDocuments = useCallback(async (filesOverride?: ProjectFile[]) => {
    if (!projectId) return;

    try {
      setDocumentsLoading(true);
      const files =
        (filesOverride && filesOverride.length > 0)
          ? filesOverride
          : projectFiles.length > 0
            ? projectFiles
            : (await fileService.getProjectFiles(projectId)).files || [];
      const pdfFiles = files.filter((file: { mimetype?: string }) => file.mimetype === 'application/pdf');

      const { ocrApiService } = await import('../../services/apiService');
      let ocrDocumentIds = new Set<string>();
      try {
        const { documentIds } = await ocrApiService.getProjectDocumentIdsWithOcr(projectId);
        if (Array.isArray(documentIds)) {
          ocrDocumentIds = new Set(documentIds);
        }
      } catch (e) {
        console.warn('Could not load OCR document list for project; OCR flags may be incomplete:', e);
      }

      const documentResults = await Promise.allSettled(
        pdfFiles.map(async (file: ProjectFile & { originalName?: string }) => {
          try {
            const { getApiBaseUrl } = await import('../../lib/apiConfig');
            const API_BASE_URL = getApiBaseUrl();
            const pdfUrl = `${API_BASE_URL}/files/${file.id}`;
            const session = await authHelpers.getValidSession();
            const httpHeaders: Record<string, string> = { Accept: 'application/pdf' };
            if (session?.access_token) {
              httpHeaders['Authorization'] = `Bearer ${session.access_token}`;
            }

            const pdf = await pdfjsLib.getDocument({ url: pdfUrl, httpHeaders }).promise;
            const totalPages = pdf.numPages;

            const { sheetService } = await import('../../services/apiService');
            const pageResults = await Promise.allSettled(
              Array.from({ length: totalPages }, async (_, index) => {
                const pageNumber = index + 1;
                const sheetId = `${file.id}-${pageNumber}`;
                try {
                  const sheetData = await sheetService.getSheet(sheetId);
                  if (sheetData?.sheet) {
                    return {
                      pageNumber,
                      hasTakeoffs: sheetData.sheet.hasTakeoffs ?? false,
                      takeoffCount: sheetData.sheet.takeoffCount ?? 0,
                      isVisible: sheetData.sheet.isVisible !== false,
                      sheetName: sheetData.sheet.sheetName,
                      sheetNumber: sheetData.sheet.sheetNumber,
                      ocrProcessed: false,
                    };
                  }
                } catch {
                  // Sheet doesn't exist yet - use defaults
                }
                return {
                  ocrProcessed: false,
                  pageNumber,
                  hasTakeoffs: false,
                  takeoffCount: 0,
                  isVisible: true,
                };
              })
            );

            const pages = pageResults
              .map((result, index) =>
                result.status === 'fulfilled' && result.value != null
                  ? result.value
                  : {
                      ocrProcessed: false,
                      pageNumber: index + 1,
                      hasTakeoffs: false,
                      takeoffCount: 0,
                      isVisible: true,
                    }
              )
              .filter((page): page is PDFPage => page != null && page.pageNumber != null);

            const hasOCRData = ocrDocumentIds.has(file.id);

            return {
              id: file.id,
              name: (file.originalName ?? 'Unknown').replace(/\.pdf$/i, ''),
              totalPages,
              pages,
              isExpanded: false,
              ocrEnabled: hasOCRData,
            };
          } catch (error) {
            console.error(`Error loading PDF ${file.originalName}:`, error);
            return {
              id: file.id,
              name: (file.originalName ?? 'Unknown').replace(/\.pdf$/i, ''),
              totalPages: 1,
              pages: [
                {
                  pageNumber: 1,
                  hasTakeoffs: false,
                  takeoffCount: 0,
                  isVisible: true,
                  ocrProcessed: false,
                },
              ],
              isExpanded: false,
              ocrEnabled: ocrDocumentIds.has(file.id),
            };
          }
        })
      );

      const loadedDocuments: PDFDocument[] = documentResults
        .map((result, index) => {
          if (result.status === 'fulfilled') return result.value;
          const file = pdfFiles[index] as ProjectFile | undefined;
          const fid = file?.id;
          return {
            id: fid ?? `error-${index}`,
            name: (file?.originalName ?? 'Unknown').replace(/\.pdf$/i, ''),
            totalPages: 1,
            pages: [
              {
                pageNumber: 1,
                hasTakeoffs: false,
                takeoffCount: 0,
                isVisible: true,
                ocrProcessed: false,
              },
            ],
            isExpanded: false,
            ocrEnabled: typeof fid === 'string' && ocrDocumentIds.has(fid),
          };
        })
        .filter((doc): doc is PDFDocument => doc != null);

      const takeoffMeasurements = getProjectTakeoffMeasurements(projectId);
      const documentsWithTakeoffCounts = loadedDocuments.map((doc) => ({
        ...doc,
        pages: doc.pages.map((page) => {
          const measurementCount = takeoffMeasurements.filter(
            (m) => m.sheetId === doc.id && m.pdfPage === page.pageNumber
          ).length;
          return {
            ...page,
            hasTakeoffs: measurementCount > 0,
            takeoffCount: measurementCount,
          };
        }),
      }));

      setDocuments(documentsWithTakeoffCounts);
    } catch (error) {
      console.error('Error loading project documents:', error);
    } finally {
      setDocumentsLoading(false);
    }
  }, [projectId, projectFiles, getProjectTakeoffMeasurements]);

  useEffect(() => {
    if (projectId) {
      setDocuments([]);
      loadProjectDocuments();
    }
    // Only re-run when project changes. loadProjectDocuments is recreated when
    // projectFiles changes; we must not depend on it or we re-fetch repeatedly
    // and exhaust resources (ERR_INSUFFICIENT_RESOURCES).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return {
    documents,
    documentsLoading,
    loadProjectDocuments,
    setDocuments,
  };
}
