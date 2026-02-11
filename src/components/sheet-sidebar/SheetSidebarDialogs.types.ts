/**
 * Types for SheetSidebar dialogs.
 */

export interface RenamingPage {
  documentId: string;
  pageNumber: number;
  currentName: string;
}

export interface SheetSidebarDialogsProps {
  /** Rename Page dialog */
  showRenameDialog: boolean;
  renamingPage: RenamingPage | null;
  renameInput: string;
  onRenameInputChange: (value: string) => void;
  onRenameCancel: () => void;
  onRenameSave: () => void;
  isRenameSaveDisabled: boolean;
}
