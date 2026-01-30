import { useState, useCallback } from 'react';
import { ocrService } from '../../services/apiService';
import type { ProjectFile } from '../../types';
import type { OcrJobEntry } from './TakeoffWorkspaceHeader.types';

export type OcrJobsMap = Map<
  string,
  OcrJobEntry & { status?: 'pending' | 'processing' | 'completed' | 'failed' }
>;

export interface UseTakeoffWorkspaceOCROptions {
  projectId: string | undefined;
  projectFiles: ProjectFile[];
  loadProjectDocuments: () => Promise<void>;
}

export interface UseTakeoffWorkspaceOCRResult {
  ocrJobs: OcrJobsMap;
  showOCRDialog: boolean;
  ocrDocumentId: string;
  ocrPageNumbers: number[];
  ocrDocumentName: string;
  handleOCRRequest: (documentId: string, pageNumbers?: number[]) => void;
  pollOcrStatus: (documentId: string, documentName: string) => void;
  startOcrTracking: (documentId: string, documentName: string) => void;
  closeOCRDialog: () => void;
  onOCRComplete: () => void;
}

export function useTakeoffWorkspaceOCR({
  projectId,
  projectFiles,
  loadProjectDocuments,
}: UseTakeoffWorkspaceOCROptions): UseTakeoffWorkspaceOCRResult {
  const [ocrJobs, setOcrJobs] = useState<OcrJobsMap>(new Map());
  const [showOCRDialog, setShowOCRDialog] = useState(false);
  const [ocrDocumentId, setOcrDocumentId] = useState('');
  const [ocrPageNumbers, setOcrPageNumbers] = useState<number[]>([]);
  const [ocrDocumentName, setOcrDocumentName] = useState('');

  const pollOcrStatus = useCallback(
    async (documentId: string, documentName: string) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      let attempts = 0;
      const maxAttempts = 300;

      const pollInterval = setInterval(async () => {
        try {
          if (!projectId) return;
          const results = await ocrService.getDocumentResults(documentId, projectId);

          if (results && results.results && results.results.length > 0) {
            setOcrJobs((prev) => {
              const newMap = new Map(prev);
              const job = newMap.get(documentId);
              if (job) {
                newMap.set(documentId, {
                  ...job,
                  status: 'completed',
                  progress: 100,
                  processedPages: results.totalPages,
                  totalPages: results.totalPages,
                });
              }
              return newMap;
            });
            clearInterval(pollInterval);

            setTimeout(() => {
              loadProjectDocuments();
            }, 500);

            setTimeout(() => {
              setOcrJobs((prev) => {
                const newMap = new Map(prev);
                newMap.delete(documentId);
                return newMap;
              });
            }, 3000);
            return;
          }

          attempts++;
          if (attempts < maxAttempts) {
            setOcrJobs((prev) => {
              const newMap = new Map(prev);
              const job = newMap.get(documentId);
              if (job) {
                const estimatedProgress = Math.min(95, Math.floor((attempts / maxAttempts) * 100));
                newMap.set(documentId, {
                  ...job,
                  status: 'processing',
                  progress: estimatedProgress,
                });
              }
              return newMap;
            });
          } else {
            setOcrJobs((prev) => {
              const newMap = new Map(prev);
              newMap.delete(documentId);
              return newMap;
            });
            clearInterval(pollInterval);
          }
        } catch {
          attempts++;
          if (attempts >= maxAttempts) {
            setOcrJobs((prev) => {
              const newMap = new Map(prev);
              newMap.delete(documentId);
              return newMap;
            });
            clearInterval(pollInterval);
          }
        }
      }, 1000);
    },
    [projectId, loadProjectDocuments]
  );

  const startOcrTracking = useCallback((documentId: string, documentName: string) => {
    setOcrJobs((prev) => {
      const newMap = new Map(prev);
      newMap.set(documentId, {
        documentId,
        documentName,
        progress: 0,
        status: 'pending',
        processedPages: 0,
        totalPages: 0,
      });
      return newMap;
    });
    pollOcrStatus(documentId, documentName);
  }, [pollOcrStatus]);

  const handleOCRRequest = useCallback(
    (documentId: string, pageNumbers?: number[]) => {
      const document = projectFiles.find((file) => file.id === documentId);
      const documentName = document?.originalName || 'Unknown Document';

      setOcrDocumentId(documentId);
      setOcrPageNumbers(pageNumbers ?? []);
      setOcrDocumentName(documentName);
      setShowOCRDialog(true);
    },
    [projectFiles]
  );

  const closeOCRDialog = useCallback(() => {
    setShowOCRDialog(false);
    setOcrDocumentId('');
    setOcrPageNumbers([]);
    setOcrDocumentName('');
  }, []);

  const onOCRComplete = useCallback(() => {
    setShowOCRDialog(false);
    loadProjectDocuments();
  }, [loadProjectDocuments]);

  return {
    ocrJobs,
    showOCRDialog,
    ocrDocumentId,
    ocrPageNumbers,
    ocrDocumentName,
    handleOCRRequest,
    pollOcrStatus,
    startOcrTracking,
    closeOCRDialog,
    onOCRComplete,
  };
}
