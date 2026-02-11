import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import type { SheetSidebarDialogsProps } from './SheetSidebarDialogs.types';

/**
 * SheetSidebar dialogs: Rename Page. Visibility and callbacks stay in parent.
 */
export function SheetSidebarDialogs({
  showRenameDialog,
  renamingPage,
  renameInput,
  onRenameInputChange,
  onRenameCancel,
  onRenameSave,
  isRenameSaveDisabled,
}: SheetSidebarDialogsProps): React.ReactElement {
  return (
    <>
      {showRenameDialog && renamingPage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="presentation" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onRenameCancel(); } }}>
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4" role="dialog" aria-modal="true" aria-labelledby="dialog-rename-page-title">
            <h3 id="dialog-rename-page-title" className="text-lg font-semibold mb-4">Rename Page</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="sheet-page-rename" className="text-sm font-medium text-gray-700 mb-2 block">Page Name</label>
                <Input
                  id="sheet-page-rename"
                  name="sheet-page-rename"
                  value={renameInput}
                  onChange={(e) => onRenameInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onRenameSave();
                    } else if (e.key === 'Escape') {
                      onRenameCancel();
                    }
                  }}
                  autoFocus
                  placeholder="Enter page name"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={onRenameCancel}>
                  Cancel
                </Button>
                <Button onClick={onRenameSave} disabled={isRenameSaveDisabled}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
