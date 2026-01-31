/**
 * Types for SheetSidebar dialogs.
 */

export interface BulkAnalysisProgressDoc {
  id: string;
  name: string;
  success: boolean;
}

export interface BulkAnalysisProgress {
  total: number;
  completed: number;
  failed: number;
  current?: string;
  status: string;
  completedDocuments: BulkAnalysisProgressDoc[];
}

export interface RenamingPage {
  documentId: string;
  pageNumber: number;
  currentName: string;
}

export interface SheetSidebarDialogsProps {
  /** Labeling (AI Analyzing) dialog */
  showLabelingDialog: boolean;
  labelingProgress: string;

  /** Bulk Analysis Confirmation */
  showBulkAnalysisConfirmation: boolean;
  pendingBulkAnalysis: { onlyUnlabeled: boolean } | null;
  bulkAnalysisUnlabeledCount: number;
  bulkAnalysisTotalCount: number;
  onBulkAnalysisConfirmationCancel: () => void;
  onBulkAnalysisConfirm: (onlyUnlabeled: boolean) => void;

  /** Bulk Analysis Progress */
  showBulkAnalysisDialog: boolean;
  bulkAnalysisProgress: BulkAnalysisProgress;
  onBulkAnalysisProgressClose: () => void;

  /** Rename Page dialog */
  showRenameDialog: boolean;
  renamingPage: RenamingPage | null;
  renameInput: string;
  onRenameInputChange: (value: string) => void;
  onRenameCancel: () => void;
  onRenameSave: () => void;
  isRenameSaveDisabled: boolean;
}
