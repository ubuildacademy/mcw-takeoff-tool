import { useState, useCallback, useEffect, useRef } from 'react';
import { authHelpers } from '../../lib/supabase';
import { parseDocumentIdFromSheetId } from '../../lib/sheetUtils';
import { fileService } from '../../services/apiService';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import type { PDFDocument, PDFPage, ProjectFile } from '../../types';

export interface UseTakeoffWorkspaceDocumentsOptions {
  projectId: string | undefined;
  projectFiles: ProjectFile[];
  /** True after the parent has finished the initial project file list fetch. */
  projectFilesListReady: boolean;
}

export interface UseTakeoffWorkspaceDocumentsResult {
  documents: PDFDocument[];
  documentsLoading: boolean;
  loadProjectDocuments: (filesOverride?: ProjectFile[]) => Promise<void>;
  setDocuments: React.Dispatch<React.SetStateAction<PDFDocument[]>>;
}

/** Partial API sheet row reused for sidebar pages. */
type BatchSheetPayload = {
  sheetName?: string;
  sheetNumber?: string;
  hasTakeoffs?: boolean;
  takeoffCount?: number;
  isVisible?: boolean;
};

/** Build one page sidebar entry using optional batch-loaded sheet metadata. */
function pageFromSheetData(pageNumber: number, sheet: BatchSheetPayload | undefined): PDFPage {
  if (sheet) {
    return {
      pageNumber,
      hasTakeoffs: sheet.hasTakeoffs ?? false,
      takeoffCount: sheet.takeoffCount ?? 0,
      isVisible: sheet.isVisible !== false,
      sheetName: sheet.sheetName,
      sheetNumber: sheet.sheetNumber,
      ocrProcessed: false,
    };
  }
  return {
    ocrProcessed: false,
    pageNumber,
    hasTakeoffs: false,
    takeoffCount: 0,
    isVisible: true,
  };
}

/** Max simultaneous PDF opens when reading page counts for the sidebar (not used by the in-viewer loader). */
const PDF_METADATA_OPEN_CONCURRENCY = 6;

async function allSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      const item = items[i]!;
      try {
        const value = await fn(item, i);
        results[i] = { status: 'fulfilled', value };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }

  const n = items.length === 0 ? 0 : Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * Loads and caches project documents (PDF metadata + sheet data) for the takeoff workspace.
 * Does not own projectFiles; parent fetches those and passes them in.
 */
export function useTakeoffWorkspaceDocuments({
  projectId,
  projectFiles,
  projectFilesListReady,
}: UseTakeoffWorkspaceDocumentsOptions): UseTakeoffWorkspaceDocumentsResult {
  const [documents, setDocuments] = useState<PDFDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState<boolean>(false);
  const getProjectTakeoffMeasurements = useMeasurementStore((s) => s.getProjectTakeoffMeasurements);

  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  /** Bumps when `projectId` changes or a new `loadProjectDocuments` run starts; stale async work must not call setState. */
  const documentLoadGenerationRef = useRef(0);

  const loadProjectDocuments = useCallback(async (filesOverride?: ProjectFile[]) => {
    const scopedProjectId = projectIdRef.current;
    if (!scopedProjectId) return;

    const loadGenerationAtStart = ++documentLoadGenerationRef.current;
    const applyIfCurrent = (): boolean =>
      documentLoadGenerationRef.current === loadGenerationAtStart &&
      projectIdRef.current === scopedProjectId;


    let files: ProjectFile[];
    if (filesOverride !== undefined) {
      files = filesOverride;
    } else if (projectFiles.length > 0) {
      files = projectFiles;
    } else {
      files = (await fileService.getProjectFiles(scopedProjectId)).files || [];
    }
    const pdfFiles = files.filter((file: ProjectFile & { filename?: string; originalName?: string }) => {
      const mt = typeof file.mimetype === 'string' ? file.mimetype.toLowerCase() : '';
      if (mt === 'application/pdf' || mt.includes('pdf')) return true;
      const name = (file.originalName ?? file.filename ?? '').toLowerCase();
      return name.endsWith('.pdf');
    });

    if (pdfFiles.length === 0) {
      if (import.meta.env.DEV && files.length > 0) {
        console.warn('No PDF files found for project; check file mimetypes/filenames.', {
          projectId: scopedProjectId,
          totalFiles: files.length,
          sample: files.slice(0, 3).map((f) => ({
            id: f.id,
            mimetype: f.mimetype,
            originalName: (f as any).originalName,
            filename: (f as any).filename,
          })),
        });
      }
      if (!applyIfCurrent()) return;
      setDocuments([]);
      setDocumentsLoading(false);
      return;
    }

    try {
      if (!applyIfCurrent()) return;
      setDocumentsLoading(true);

      const { ocrApiService } = await import('../../services/apiService');
      const ocrIdsPromise = ocrApiService
        .getProjectDocumentIdsWithOcr(scopedProjectId)
        .then((res) =>
          Array.isArray(res.documentIds) ? new Set<string>(res.documentIds) : new Set<string>(),
        )
        .catch((e) => {
          console.warn(
            'Could not load OCR document list for project; OCR flags may be incomplete:',
            e,
          );
          return new Set<string>();
        });

      const { getApiBaseUrl } = await import('../../lib/apiConfig');
      const { getPdfjs } = await import('../../lib/pdfjs');
      const pdfjsLib = await getPdfjs();
      const session = await authHelpers.getValidSession();
      const API_BASE_URL = getApiBaseUrl();

      const pdfLoadResults = await allSettledWithConcurrency(
        pdfFiles,
        PDF_METADATA_OPEN_CONCURRENCY,
        async (file: ProjectFile & { originalName?: string }) => {
          const pdfUrl = `${API_BASE_URL}/files/${file.id}`;
          const httpHeaders: Record<string, string> = { Accept: 'application/pdf' };
          if (session?.access_token) {
            httpHeaders['Authorization'] = `Bearer ${session.access_token}`;
          }
          const pdf = await pdfjsLib.getDocument({ url: pdfUrl, httpHeaders }).promise;
          return pdf.numPages;
        },
      );

      const allSheetIds: string[] = [];
      pdfLoadResults.forEach((result, idx) => {
        if (result.status !== 'fulfilled') return;
        const file = pdfFiles[idx];
        const totalPages = result.value;
        for (let p = 1; p <= totalPages; p++) {
          allSheetIds.push(`${file.id}-${p}`);
        }
      });

      let sheetsById: Record<string, BatchSheetPayload> | undefined;
      try {
        if (allSheetIds.length > 0) {
          const { sheetService } = await import('../../services/apiService');
          const batch = await sheetService.batchSheetMetadata(scopedProjectId, allSheetIds);
          sheetsById = batch.sheetsById;
        }
      } catch (e) {
        console.warn(
          'Batch sheet metadata failed; sidebar uses defaults until next load or edits.',
          e,
        );
      }

      const ocrResolved = await ocrIdsPromise.catch(() => new Set<string>());

      const loadedDocuments: PDFDocument[] = [];

      for (let index = 0; index < pdfFiles.length; index++) {
        const file = pdfFiles[index] as ProjectFile & { originalName?: string };
        const pdfRes = pdfLoadResults[index];

        if (pdfRes.status === 'fulfilled') {
          const totalPages = pdfRes.value;
          const pages: PDFPage[] = [];
          for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
            const sheetId = `${file.id}-${pageNumber}`;
            const sheet = sheetsById?.[sheetId];
            pages.push(pageFromSheetData(pageNumber, sheet));
          }
          loadedDocuments.push({
            id: file.id,
            name: (file.originalName ?? 'Unknown').replace(/\.pdf$/i, ''),
            totalPages,
            pages,
            isExpanded: false,
            ocrEnabled: ocrResolved.has(file.id),
          });
        } else {
          console.error(`Error loading PDF ${file.originalName}:`, pdfRes.reason);
          const ocrForError = await ocrIdsPromise.catch(() => new Set<string>());
          loadedDocuments.push({
            id: file.id,
            name: (file.originalName ?? 'Unknown').replace(/\.pdf$/i, ''),
            totalPages: 1,
            pages: [pageFromSheetData(1, undefined)],
            isExpanded: false,
            ocrEnabled: ocrForError.has(file.id),
          });
        }
      }

      if (!applyIfCurrent()) return;

      const takeoffMeasurements = getProjectTakeoffMeasurements(scopedProjectId);
      const measurementCountByDocPage = new Map<string, number>();
      for (const m of takeoffMeasurements) {
        const docId = parseDocumentIdFromSheetId(m.sheetId);
        const k = `${docId}:${m.pdfPage}`;
        measurementCountByDocPage.set(k, (measurementCountByDocPage.get(k) ?? 0) + 1);
      }
      const documentsWithTakeoffCounts = loadedDocuments.map((doc) => ({
        ...doc,
        pages: doc.pages.map((page) => {
          const measurementCount =
            measurementCountByDocPage.get(`${doc.id}:${page.pageNumber}`) ?? 0;
          return {
            ...page,
            hasTakeoffs: measurementCount > 0,
            takeoffCount: measurementCount,
          };
        }),
      }));

      if (!applyIfCurrent()) return;
      setDocuments(documentsWithTakeoffCounts);
    } catch (error) {
      console.error('Error loading project documents:', error);
    } finally {
      if (applyIfCurrent()) {
        setDocumentsLoading(false);
      }
    }
  }, [projectId, projectFiles, getProjectTakeoffMeasurements]);

  useEffect(() => {
    documentLoadGenerationRef.current += 1;
    if (!projectId) return;
    setDocuments([]);
    setDocumentsLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !projectFilesListReady) return;
    void loadProjectDocuments(projectFiles);
    // Initial document build runs once the file list is known; uploads/OCR call loadProjectDocuments explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- omit projectFiles/loadProjectDocuments to avoid re-fetch loops
  }, [projectId, projectFilesListReady]);

  return {
    documents,
    documentsLoading,
    loadProjectDocuments,
    setDocuments,
  };
}
