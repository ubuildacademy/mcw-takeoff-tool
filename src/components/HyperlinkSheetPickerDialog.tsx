import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import type { PDFDocument, ProjectFile } from '../types';

export interface HyperlinkSheetPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents: PDFDocument[];
  /** Optional: project files to ensure all PDFs appear even if not yet in documents */
  projectFiles?: ProjectFile[];
  /** Pre-selected when opening (e.g. current page - can't link to self) */
  excludeSheetId?: string;
  excludePageNumber?: number;
  /** When editing, the current target to pre-select */
  initialTargetSheetId?: string;
  initialTargetPageNumber?: number;
  /** Create mode: called when user picks target */
  onSelect: (targetSheetId: string, targetPageNumber: number) => void;
  /** Edit mode: when set, dialog is in edit mode (title may differ) */
  isEditMode?: boolean;
  /** Edit mode only: remove the hyperlink entirely (same as context menu Delete) */
  onDeleteLink?: () => void;
  onCancel: () => void;
}

/** Merge documents with projectFiles so all PDFs appear. Files not in documents get a minimal entry. */
function mergeDocumentsWithFiles(
  documents: PDFDocument[],
  projectFiles?: ProjectFile[]
): PDFDocument[] {
  const byId = new Map<string, PDFDocument>();
  for (const doc of documents) {
    byId.set(doc.id, doc);
  }
  if (projectFiles?.length) {
    const pdfFiles = projectFiles.filter((f: { mimetype?: string }) => f.mimetype === 'application/pdf');
    for (const file of pdfFiles) {
      if (!byId.has(file.id)) {
        byId.set(file.id, {
          id: file.id,
          name: (file.originalName ?? 'Document').replace(/\.pdf$/i, ''),
          totalPages: 1,
          pages: [{ pageNumber: 1, hasTakeoffs: false, takeoffCount: 0, isVisible: true, ocrProcessed: false }],
          isExpanded: false,
          ocrEnabled: false,
        });
      }
    }
  }
  return Array.from(byId.values());
}

/** Treat "Unknown" (from failed titleblock extraction) as meaningless for display. */
function isMeaningfulSheetValue(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  return value.trim().toLowerCase() !== 'unknown';
}

/** Build flat list of (documentId, pageNumber, label) for picker. Ensures all pages from all documents are included. */
function buildSheetOptions(
  documents: PDFDocument[],
  excludeSheetId?: string,
  excludePageNumber?: number
): Array<{ sheetId: string; pageNumber: number; label: string }> {
  const seen = new Set<string>();
  const options: Array<{ sheetId: string; pageNumber: number; label: string }> = [];
  for (const doc of documents) {
    // Use pages from doc; ensure we never undercount (use max of totalPages and actual page count)
    const pages = doc.pages ?? [];
    const totalPages = Math.max(doc.totalPages ?? 0, pages.length) || 1;
    for (let p = 1; p <= totalPages; p++) {
      const page = pages.find((pg) => pg.pageNumber === p);
      const pageNumber = page?.pageNumber ?? p;
      const key = `${doc.id}:${pageNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (excludeSheetId === doc.id && excludePageNumber === pageNumber) continue;
      const docName = doc.name ?? 'Document';
      // Use sheetNumber/sheetName only when meaningful (not "Unknown" from failed extraction)
      const sheetLabel = page
        ? (() => {
            const parts = [page.sheetNumber, page.sheetName].filter(isMeaningfulSheetValue);
            return parts.length > 0 ? parts.join(' - ') : `P. ${pageNumber}`;
          })()
        : `P. ${pageNumber}`;
      const label = `${docName} - ${sheetLabel}`;
      options.push({ sheetId: doc.id, pageNumber, label });
    }
  }
  // Sort by document name then page number for easier scanning
  return options.sort((a, b) => {
    const docA = documents.find((d) => d.id === a.sheetId);
    const docB = documents.find((d) => d.id === b.sheetId);
    const nameA = docA?.name ?? '';
    const nameB = docB?.name ?? '';
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return a.pageNumber - b.pageNumber;
  });
}

export function HyperlinkSheetPickerDialog({
  open,
  onOpenChange,
  documents,
  projectFiles,
  excludeSheetId,
  excludePageNumber,
  initialTargetSheetId,
  initialTargetPageNumber,
  onSelect,
  isEditMode = false,
  onDeleteLink,
  onCancel,
}: HyperlinkSheetPickerDialogProps) {
  const mergedDocs = mergeDocumentsWithFiles(documents, projectFiles);
  const options = buildSheetOptions(mergedDocs, excludeSheetId, excludePageNumber);
  const initialValue =
    initialTargetSheetId != null && initialTargetPageNumber != null
      ? `${initialTargetSheetId}:${initialTargetPageNumber}`
      : null;
  const [selected, setSelected] = useState<string | null>(initialValue);

  // Reset selected when opening with new initial target
  React.useEffect(() => {
    if (open) setSelected(initialValue);
  }, [open, initialValue]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelected(null);
      onCancel();
    }
    onOpenChange(next);
  };

  const handleConfirm = () => {
    if (!selected) return;
    const [sheetId, pageStr] = selected.split(':');
    const pageNumber = parseInt(pageStr, 10);
    if (sheetId && !Number.isNaN(pageNumber)) {
      onSelect(sheetId, pageNumber);
      setSelected(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="hyperlink-picker-description">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit hyperlink target' : 'Link to sheet'}</DialogTitle>
          <DialogDescription id="hyperlink-picker-description">
            {isEditMode ? 'Change which sheet this hyperlink jumps to.' : 'Select the sheet this hyperlink should jump to.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="hyperlink-sheet-picker">Target sheet</Label>
            <select
              id="hyperlink-sheet-picker"
              value={selected ?? ''}
              onChange={(e) => setSelected(e.target.value || null)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select a sheet...</option>
              {options.map((opt) => (
                <option key={`${opt.sheetId}-${opt.pageNumber}`} value={`${opt.sheetId}:${opt.pageNumber}`}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter
          className={
            isEditMode && onDeleteLink
              ? 'flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:space-x-0'
              : 'gap-2 sm:gap-0'
          }
        >
          {isEditMode && onDeleteLink ? (
            <Button
              type="button"
              variant="destructive"
              className="w-full sm:w-auto"
              onClick={() => {
                onDeleteLink();
              }}
            >
              Delete hyperlink
            </Button>
          ) : null}
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={!selected}>
              {isEditMode ? 'Update' : 'Create link'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
