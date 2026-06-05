import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { BaseDialog } from '../ui/base-dialog';
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
  const open = showRenameDialog && renamingPage != null;

  return (
    <BaseDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onRenameCancel();
      }}
      title="Rename Page"
      description="Change the display name for this sheet page."
      maxWidth="sm"
      footer={
        <div className="flex gap-2 justify-end w-full">
          <Button variant="outline" onClick={onRenameCancel}>
            Cancel
          </Button>
          <Button onClick={onRenameSave} disabled={isRenameSaveDisabled}>
            Save
          </Button>
        </div>
      }
    >
      <div>
        <Label htmlFor="sheet-page-rename" className="mb-2 block">
          Page Name
        </Label>
        <Input
          id="sheet-page-rename"
          name="sheet-page-rename"
          value={renameInput}
          onChange={(e) => onRenameInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isRenameSaveDisabled) {
              onRenameSave();
            }
          }}
          autoFocus
          placeholder="Enter page name"
        />
      </div>
    </BaseDialog>
  );
}
