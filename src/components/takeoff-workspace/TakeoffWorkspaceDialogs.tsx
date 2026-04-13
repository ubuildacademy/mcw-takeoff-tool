import React from 'react';
import { OCRProcessingDialog } from '../OCRProcessingDialog';
import { ProfitMarginDialog } from '../ProfitMarginDialog';
import { AutoCountProgressDialog } from '../AutoCountProgressDialog';
import type { AutoCountProgress, AutoCountCompletionResult } from './useTakeoffWorkspaceVisualSearch';

export interface TakeoffWorkspaceDialogsProps {
  projectId: string | null;

  /** OCR dialog */
  ocrShowDialog: boolean;
  ocrDocumentId: string;
  ocrDocumentName: string;
  ocrPageNumbers: number[];
  ocrOnClose: () => void;
  ocrOnComplete: () => void;

  /** Auto-Count progress dialog (when visual search condition is active) */
  autoCountCondition: { name: string; searchScope?: string } | null;
  autoCountShowProgress: boolean;
  autoCountProgress: AutoCountProgress | null;
  autoCountCompletionResult: AutoCountCompletionResult | null;
  autoCountIsCancelling: boolean;
  autoCountOnClose: () => void;
  autoCountOnCancel: () => void;

  /** Profit margin dialog */
  showProfitMarginDialog: boolean;
  setShowProfitMarginDialog: (open: boolean) => void;
}

/**
 * All workspace dialogs in one place: OCR, Auto-Count progress, Profit Margin.
 * Keeps main layout JSX focused on structure; dialog visibility and callbacks stay in parent.
 */
export function TakeoffWorkspaceDialogs({
  projectId,
  ocrShowDialog,
  ocrDocumentId,
  ocrDocumentName,
  ocrPageNumbers,
  ocrOnClose,
  ocrOnComplete,
  autoCountCondition,
  autoCountShowProgress,
  autoCountProgress,
  autoCountCompletionResult,
  autoCountIsCancelling,
  autoCountOnClose,
  autoCountOnCancel,
  showProfitMarginDialog,
  setShowProfitMarginDialog,
}: TakeoffWorkspaceDialogsProps): React.ReactElement {
  return (
    <>
      <OCRProcessingDialog
        isOpen={ocrShowDialog}
        onClose={ocrOnClose}
        documentId={ocrDocumentId}
        documentName={ocrDocumentName}
        pageNumbers={ocrPageNumbers}
        projectId={projectId ?? ''}
        onOCRComplete={ocrOnComplete}
      />

      {autoCountCondition && (
        <AutoCountProgressDialog
          isOpen={autoCountShowProgress}
          onClose={autoCountOnClose}
          onCancel={autoCountOnCancel}
          progress={autoCountProgress}
          conditionName={autoCountCondition.name}
          searchScope={(autoCountCondition.searchScope || 'current-page') as 'current-page' | 'entire-document' | 'entire-project'}
          isCancelling={autoCountIsCancelling}
          completionResult={autoCountCompletionResult}
        />
      )}

      {projectId && (
        <ProfitMarginDialog
          open={showProfitMarginDialog}
          onOpenChange={setShowProfitMarginDialog}
          projectId={projectId}
        />
      )}
    </>
  );
}
