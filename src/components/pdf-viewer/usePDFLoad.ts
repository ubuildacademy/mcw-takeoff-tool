import { useState, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export interface UsePDFLoadOptions {
  externalTotalPages?: number;
  externalCurrentPage?: number;
  onPDFLoaded?: (totalPages: number) => void;
}

export interface UsePDFLoadResult {
  pdfDocument: Awaited<ReturnType<typeof pdfjsLib.getDocument>> | null;
  isLoading: boolean;
  error: string | null;
  internalTotalPages: number;
  setInternalTotalPages: React.Dispatch<React.SetStateAction<number>>;
  internalCurrentPage: number;
  setInternalCurrentPage: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * Loads a PDF from file (URL string, File, or API file object) and exposes document + page state.
 */
export function usePDFLoad(
  file: File | string | Record<string, unknown> | null | undefined,
  options: UsePDFLoadOptions = {}
): UsePDFLoadResult {
  const { externalTotalPages, externalCurrentPage, onPDFLoaded } = options;

  const [pdfDocument, setPdfDocument] = useState<Awaited<ReturnType<typeof pdfjsLib.getDocument>> | null>(null);
  const [internalTotalPages, setInternalTotalPages] = useState(0);
  const [internalCurrentPage, setInternalCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
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
          const { supabase } = await import('../../lib/supabase');
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            httpHeaders = {
              Authorization: `Bearer ${session.access_token}`,
              Accept: 'application/pdf',
            };
          }
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
    // Intentionally only depend on file - match original PDFViewer behavior
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

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
