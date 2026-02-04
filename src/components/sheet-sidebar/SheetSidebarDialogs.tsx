import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Brain, Check, X } from 'lucide-react';
import type { SheetSidebarDialogsProps } from './SheetSidebarDialogs.types';

/**
 * All SheetSidebar dialogs in one place: Labeling (AI Analyzing), Bulk Analysis
 * Confirmation, Bulk Analysis Progress, Rename Page. Visibility and callbacks stay in parent.
 */
export function SheetSidebarDialogs({
  showLabelingDialog,
  labelingProgress,
  showBulkAnalysisConfirmation,
  pendingBulkAnalysis,
  bulkAnalysisUnlabeledCount,
  bulkAnalysisTotalCount,
  onBulkAnalysisConfirmationCancel,
  onBulkAnalysisConfirm,
  showBulkAnalysisDialog,
  bulkAnalysisProgress,
  onBulkAnalysisProgressClose,
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
      {showLabelingDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="presentation">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4" role="dialog" aria-modal="true" aria-labelledby="dialog-labeling-title">
            <div className="flex flex-col items-center space-y-4">
              <div className="relative">
                <Brain className="w-12 h-12 text-blue-600 animate-pulse" />
                <div className="absolute inset-0">
                  <Brain className="w-12 h-12 text-blue-300 animate-spin" style={{ animationDuration: '2s' }} />
                </div>
              </div>
              <h3 id="dialog-labeling-title" className="text-lg font-semibold text-center">AI Analyzing Document</h3>
              <p className="text-gray-600 text-center text-sm">{labelingProgress}</p>
              <div className="flex items-center space-x-2 text-blue-600">
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-4 text-center">Extracting text and analyzing sheets with AI...</p>
          </div>
        </div>
      )}

      {showBulkAnalysisConfirmation && pendingBulkAnalysis && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="presentation" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onBulkAnalysisConfirmationCancel(); } }}>
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4" role="dialog" aria-modal="true" aria-labelledby="dialog-bulk-confirm-title">
            <div className="flex flex-col space-y-4">
              <div className="flex items-center justify-between">
                <h3 id="dialog-bulk-confirm-title" className="text-lg font-semibold">Confirm Document Analysis</h3>
                <Button variant="ghost" size="sm" onClick={onBulkAnalysisConfirmationCancel} aria-label="Close">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  {pendingBulkAnalysis.onlyUnlabeled
                    ? 'This will analyze all unlabeled documents to extract sheet names and numbers using AI.'
                    : 'This will analyze all documents to extract sheet names and numbers using AI.'}
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-blue-900 mb-2">What will happen:</p>
                  <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                    <li>OCR processing will extract text from each document</li>
                    <li>AI will analyze title blocks to identify sheet numbers and names</li>
                    <li>Sheet information will be automatically saved</li>
                    <li>This process may take several minutes for large documents</li>
                  </ul>
                </div>
                <div className="text-sm text-gray-600">
                  <p className="font-medium mb-1">Documents to analyze:</p>
                  <p>
                    {pendingBulkAnalysis.onlyUnlabeled
                      ? `${bulkAnalysisUnlabeledCount} unlabeled document(s)`
                      : `${bulkAnalysisTotalCount} document(s)`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={onBulkAnalysisConfirmationCancel}>
                  Cancel
                </Button>
                <Button onClick={() => onBulkAnalysisConfirm(pendingBulkAnalysis.onlyUnlabeled)}>
                  <Brain className="w-4 h-4 mr-2" />
                  Start Analysis
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBulkAnalysisDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="presentation" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onBulkAnalysisProgressClose(); } }}>
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="dialog-bulk-progress-title">
            <div className="flex flex-col space-y-4">
              <div className="flex items-center justify-between">
                <h3 id="dialog-bulk-progress-title" className="text-lg font-semibold">Bulk Document Analysis</h3>
                <Button variant="ghost" size="sm" onClick={onBulkAnalysisProgressClose} aria-label="Close">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Progress:</span>
                  <span className="font-medium">
                    {bulkAnalysisProgress.completed + bulkAnalysisProgress.failed} / {bulkAnalysisProgress.total}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${(bulkAnalysisProgress.total > 0 ? (bulkAnalysisProgress.completed + bulkAnalysisProgress.failed) / bulkAnalysisProgress.total : 0) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">{bulkAnalysisProgress.status}</p>
                {bulkAnalysisProgress.current && (
                  <p className="text-sm text-gray-600">Currently processing: {bulkAnalysisProgress.current}</p>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Completed Documents:</p>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {bulkAnalysisProgress.completedDocuments.map((doc, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center gap-2 text-sm p-2 rounded ${
                        doc.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {doc.success ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                      <span>{doc.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
