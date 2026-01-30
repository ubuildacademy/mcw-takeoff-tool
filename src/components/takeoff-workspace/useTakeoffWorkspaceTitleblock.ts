import { useState, useCallback } from 'react';
import { titleblockService } from '../../services/apiService';
import type { PDFDocument, ProjectFile } from '../../types';
import type { TitleblockExtractionStatus } from './TakeoffWorkspaceHeader.types';

export type TitleblockField = 'sheetNumber' | 'sheetName';

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TitleblockSelectionContext {
  documentId: string;
  scope: 'single' | 'bulk';
}

export interface PendingTitleblockConfig {
  sheetNumberField?: NormalizedBox;
  sheetNameField?: NormalizedBox;
}

export interface UseTakeoffWorkspaceTitleblockOptions {
  projectId: string | undefined;
  documents: PDFDocument[];
  projectFiles: ProjectFile[];
  loadProjectDocuments: () => Promise<void>;
  handlePageSelect: (documentId: string, pageNumber: number) => void;
  isDev?: boolean;
}

export interface UseTakeoffWorkspaceTitleblockResult {
  titleblockSelectionMode: TitleblockField | null;
  setTitleblockSelectionMode: (mode: TitleblockField | null) => void;
  titleblockSelectionContext: TitleblockSelectionContext | null;
  titleblockExtractionStatus: TitleblockExtractionStatus | null;
  handleTitleblockSelectionComplete: (field: TitleblockField, selectionBox: NormalizedBox) => Promise<void>;
  handleExtractTitleblockForDocument: (documentId: string) => void;
  handleBulkExtractTitleblock: () => void;
}

export function useTakeoffWorkspaceTitleblock({
  projectId,
  documents,
  projectFiles,
  loadProjectDocuments,
  handlePageSelect,
  isDev = false,
}: UseTakeoffWorkspaceTitleblockOptions): UseTakeoffWorkspaceTitleblockResult {
  const [titleblockSelectionMode, setTitleblockSelectionMode] = useState<TitleblockField | null>(null);
  const [titleblockSelectionContext, setTitleblockSelectionContext] = useState<TitleblockSelectionContext | null>(null);
  const [pendingTitleblockConfig, setPendingTitleblockConfig] = useState<PendingTitleblockConfig | null>(null);
  const [titleblockExtractionStatus, setTitleblockExtractionStatus] = useState<TitleblockExtractionStatus | null>(null);

  const handleTitleblockSelectionComplete = useCallback(
    async (field: TitleblockField, selectionBox: NormalizedBox) => {
      console.log('[Titleblock] Selection complete:', { field, selectionBox, hasContext: !!titleblockSelectionContext });

      if (!titleblockSelectionContext) {
        console.error('[Titleblock] No selection context available - extraction cannot proceed');
        alert('Titleblock selection context is missing. Please try again.');
        return;
      }

      const nextConfig: PendingTitleblockConfig = {
        ...(pendingTitleblockConfig || {}),
        ...(field === 'sheetNumber'
          ? { sheetNumberField: selectionBox }
          : { sheetNameField: selectionBox }),
      };
      setPendingTitleblockConfig(nextConfig);
      console.log('[Titleblock] Updated config:', nextConfig);

      if (field === 'sheetNumber') {
        console.log('[Titleblock] Sheet number selected, prompting for sheet name');
        setTitleblockSelectionMode('sheetName');
        return;
      }

      console.log('[Titleblock] Sheet name selected, starting extraction');
      setTitleblockSelectionMode(null);

      const finalConfig = {
        sheetNumberField: nextConfig.sheetNumberField || selectionBox,
        sheetNameField: nextConfig.sheetNameField || selectionBox,
      };

      if (!finalConfig.sheetNumberField || !finalConfig.sheetNameField) {
        console.error('[Titleblock] Missing required fields:', finalConfig);
        alert('Both sheet number and sheet name regions must be selected. Please try again.');
        setTitleblockSelectionContext(null);
        setPendingTitleblockConfig(null);
        return;
      }

      const targetDocumentIds =
        titleblockSelectionContext.scope === 'single'
          ? [titleblockSelectionContext.documentId]
          : documents.map((d) => d.id);

      console.log('[Titleblock] Starting extraction:', {
        projectId,
        documentIds: targetDocumentIds,
        config: finalConfig,
        scope: titleblockSelectionContext.scope,
      });

      const totalPages = targetDocumentIds.reduce((sum, docId) => {
        const doc = documents.find((d) => d.id === docId);
        return sum + (doc?.pages?.length || 0);
      }, 0);

      setTitleblockExtractionStatus({
        status: 'processing',
        currentDocument: documents.find((d) => d.id === targetDocumentIds[0])?.filename || 'Unknown',
        processedPages: 0,
        totalPages,
        progress: 0,
      });

      try {
        if (!projectId) {
          throw new Error('Project ID is missing');
        }

        console.log('[Titleblock] Calling backend extraction API...');

        const startTime = Date.now();
        const estimatedDuration = totalPages * 2000;
        let progressInterval: ReturnType<typeof setInterval> | null = null;

        progressInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const estimatedProgress = Math.min(90, Math.round((elapsed / estimatedDuration) * 90));
          const processedPages = Math.max(1, Math.round((estimatedProgress / 100) * totalPages));

          if (isDev) {
            console.log('[Titleblock] Progress update:', { elapsed, estimatedProgress, processedPages, totalPages });
          }

          setTitleblockExtractionStatus((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              progress: estimatedProgress,
              processedPages,
            };
          });
        }, 500);

        const result = await titleblockService.extractTitleblock(projectId, targetDocumentIds, finalConfig);

        if (progressInterval) {
          clearInterval(progressInterval);
        }

        console.log('[Titleblock] Backend extraction response:', result);

        if (result.success && result.results) {
          const totalProcessed = result.results.reduce(
            (sum: number, r: { sheets?: unknown[] }) => sum + (r.sheets?.length || 0),
            0
          );

          if (isDev) {
            console.log('[Titleblock] Extraction completed:', {
              totalProcessed,
              totalPages,
              results: result.results.map((r: { documentId: string; sheets?: unknown[] }) => ({
                documentId: r.documentId,
                sheetsCount: r.sheets?.length || 0,
              })),
            });
          }

          setTitleblockExtractionStatus({
            status: 'completed',
            processedPages: totalProcessed,
            totalPages,
            progress: 100,
          });

          console.log('[Titleblock] Waiting 2 seconds for database saves to complete...');
          await new Promise((resolve) => setTimeout(resolve, 2000));

          console.log('[Titleblock] Reloading documents to display updated labels...');
          await loadProjectDocuments();
          console.log('[Titleblock] Documents reloaded successfully, labels should now be visible');

          setTimeout(() => {
            setTitleblockExtractionStatus(null);
          }, 3000);
        } else {
          throw new Error(result.error || 'Extraction returned unsuccessful result');
        }
      } catch (error) {
        console.error('[Titleblock] Extraction failed with error:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[Titleblock] Error details:', { message: errorMessage });

        setTitleblockExtractionStatus({
          status: 'failed',
          error: errorMessage,
          processedPages: 0,
          totalPages,
          progress: 0,
        });

        setTimeout(() => {
          setTitleblockExtractionStatus(null);
        }, 5000);
      } finally {
        console.log('[Titleblock] Clearing selection context');
        setTitleblockSelectionContext(null);
        setPendingTitleblockConfig(null);
      }
    },
    [
      titleblockSelectionContext,
      pendingTitleblockConfig,
      projectId,
      documents,
      loadProjectDocuments,
      isDev,
    ]
  );

  const handleExtractTitleblockForDocument = useCallback(
    (documentId: string) => {
      const targetDocument = documents.find((doc) => doc.id === documentId);
      if (!targetDocument || !projectFiles.length) {
        alert('Document not found or project files not loaded yet.');
        return;
      }

      const firstPage =
        Array.isArray(targetDocument.pages) && targetDocument.pages[0]
          ? targetDocument.pages[0].pageNumber
          : 1;

      handlePageSelect(documentId, firstPage);

      setTitleblockSelectionContext({ documentId, scope: 'single' });
      setPendingTitleblockConfig(null);
      setTitleblockSelectionMode('sheetNumber');

      if (isDev) {
        console.log('[Titleblock] Starting per-document titleblock selection', { documentId, pageNumber: firstPage });
      }
    },
    [documents, projectFiles, handlePageSelect, isDev]
  );

  const handleBulkExtractTitleblock = useCallback(() => {
    if (!documents.length) {
      alert('No documents available to extract titleblock info from.');
      return;
    }

    const referenceDocument = documents[0];
    const firstPage =
      Array.isArray(referenceDocument.pages) && referenceDocument.pages[0]
        ? referenceDocument.pages[0].pageNumber
        : 1;

    handlePageSelect(referenceDocument.id, firstPage);

    setTitleblockSelectionContext({ documentId: referenceDocument.id, scope: 'bulk' });
    setPendingTitleblockConfig(null);
    setTitleblockSelectionMode('sheetNumber');

    if (isDev) {
      console.log('[Titleblock] Starting bulk titleblock selection (reference document)', {
        documentId: referenceDocument.id,
        pageNumber: firstPage,
        totalDocuments: documents.length,
      });
    }
  }, [documents, handlePageSelect, isDev]);

  return {
    titleblockSelectionMode,
    setTitleblockSelectionMode,
    titleblockSelectionContext,
    titleblockExtractionStatus,
    handleTitleblockSelectionComplete,
    handleExtractTitleblockForDocument,
    handleBulkExtractTitleblock,
  };
}
