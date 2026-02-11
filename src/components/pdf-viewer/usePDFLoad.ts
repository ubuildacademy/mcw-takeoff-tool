import { useState, useEffect, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ProjectFile } from '../../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

/** Stable identity for file so we only reload when the logical file changes, not on object reference churn */
function getFileKey(file: PDFLoadFile): string | null {
  if (file == null) return null;
  if (typeof file === 'string') return file;
  if (file instanceof File) return `${file.name}-${file.size}-${file.lastModified}`;
  if (file && typeof file === 'object' && 'id' in file && file.id) return (file as ProjectFile).id;
  return null;
}

export interface UsePDFLoadOptions {
  externalTotalPages?: number;
  externalCurrentPage?: number;
  onPDFLoaded?: (totalPages: number) => void;
}

export interface UsePDFLoadResult {
  pdfDocument: PDFDocumentProxy | null;
  isLoading: boolean;
  error: string | null;
  internalTotalPages: number;
  setInternalTotalPages: React.Dispatch<React.SetStateAction<number>>;
  internalCurrentPage: number;
  setInternalCurrentPage: React.Dispatch<React.SetStateAction<number>>;
}

/** File shape accepted by usePDFLoad: project file, URL string, or browser File */
export type PDFLoadFile = ProjectFile | string | File | null | undefined;

/**
 * Loads a PDF from file (project file with id, URL string, or browser File) and exposes document + page state.
 */
export function usePDFLoad(
  file: PDFLoadFile,
  options: UsePDFLoadOptions = {}
): UsePDFLoadResult {
  const { externalTotalPages, externalCurrentPage, onPDFLoaded } = options;

  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [internalTotalPages, setInternalTotalPages] = useState(0);
  const [internalCurrentPage, setInternalCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileKey = useMemo(() => getFileKey(file), [file]);

  useEffect(() => {
    if (!fileKey || !file) {
      setPdfDocument(null);
      setInternalTotalPages(0);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const loadPDF = async () => {
      let pdfUrl: string | undefined;
      try {
        if (typeof file === 'string') {
          pdfUrl = file;
        } else if (file instanceof File) {
          pdfUrl = URL.createObjectURL(file);
        } else if (file && typeof file === 'object' && 'id' in file && file.id) {
          const { getApiBaseUrl } = await import('../../lib/apiConfig');
          const API_BASE_URL = getApiBaseUrl();
          pdfUrl = `${API_BASE_URL}/files/${file.id}`;
        } else {
          throw new Error('Invalid file object provided');
        }

        let httpHeaders: Record<string, string> | undefined;
        if (file && typeof file === 'object' && 'id' in file && file.id) {
          const { getAuthHeaders } = await import('../../lib/apiAuth');
          const auth = await getAuthHeaders();
          httpHeaders = { ...auth, Accept: 'application/pdf' };
        }

        const pdf = await pdfjsLib.getDocument({
          url: pdfUrl,
          httpHeaders,
          disableAutoFetch: false,
          disableStream: false,
          disableRange: false,
          cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
          cMapPacked: true,
          maxImageSize: 1024 * 1024,
          isEvalSupported: false,
          verbosity: 0, // Suppress font recovery warnings (e.g. "TT: undefined function")
        }).promise;

        setPdfDocument(pdf);

        if (externalTotalPages === undefined) {
          setInternalTotalPages(pdf.numPages);
        }
        if (externalCurrentPage === undefined) {
          setInternalCurrentPage((prev) => prev || 1);
        }

        onPDFLoaded?.(pdf.numPages);
      } catch (err: unknown) {
        console.error('Error loading PDF:', err);
        setError('Failed to load PDF file');
      } finally {
        setIsLoading(false);
      }
    };

    loadPDF();
    // Depend on stable file identity (fileKey) so we don't reload when parent passes
    // a new object reference for the same document (e.g. after project init re-renders).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey]);

  return {
    pdfDocument,
    isLoading,
    error,
    internalTotalPages,
    setInternalTotalPages,
    internalCurrentPage,
    setInternalCurrentPage,
  };
}
