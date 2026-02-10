import React from 'react';
import { FileText, Search, MessageSquare, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '../ui/button';
import { SheetSidebar } from '../SheetSidebar';
import { SearchTab } from '../SearchTab';
import { ChatTab } from '../ChatTab';
import type { TakeoffWorkspaceRightSidebarProps } from './TakeoffWorkspaceHeader.types';

export function TakeoffWorkspaceRightSidebar({
  rightSidebarOpen,
  onRightSidebarOpenChange,
  rightSidebarTab,
  onRightSidebarTabChange,
  projectId,
  documents,
  documentsLoading,
  onPageSelect,
  selectedDocumentId,
  selectedPageNumber,
  onOCRRequest,
  onOcrSearchResults,
  onDocumentsUpdate,
  onReloadDocuments,
  onPdfUpload,
  uploading,
  onLabelingJobUpdate,
  onExtractTitleblockForDocument,
  onBulkExtractTitleblock,
}: TakeoffWorkspaceRightSidebarProps) {
  return (
    <div className="flex">
      <Button
        variant="ghost"
        size="sm"
        className="h-full w-8 rounded-none border-l"
        onClick={() => onRightSidebarOpenChange(!rightSidebarOpen)}
      >
        {rightSidebarOpen ? (
          <PanelRightClose className="w-4 h-4" />
        ) : (
          <PanelRightOpen className="w-4 h-4" />
        )}
      </Button>
      {rightSidebarOpen && (
        <div className="w-96 bg-white border-l flex flex-col h-full">
          <div className="flex border-b">
            <button
              className={`flex-1 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
                rightSidebarTab === 'documents'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => onRightSidebarTabChange('documents')}
            >
              <div className="flex items-center justify-center gap-2">
                <FileText className="w-4 h-4" />
                Documents
              </div>
            </button>
            <button
              className={`flex-1 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
                rightSidebarTab === 'search'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => onRightSidebarTabChange('search')}
            >
              <div className="flex items-center justify-center gap-2">
                <Search className="w-4 h-4" />
                Search
              </div>
            </button>
            <button
              className={`flex-1 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
                rightSidebarTab === 'ai-chat'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => onRightSidebarTabChange('ai-chat')}
            >
              <div className="flex items-center justify-center gap-2">
                <MessageSquare className="w-4 h-4" />
                AI Chat
              </div>
            </button>
          </div>

          {rightSidebarTab === 'documents' && (
            <SheetSidebar
              projectId={projectId}
              documents={documents}
              documentsLoading={documentsLoading}
              onPageSelect={onPageSelect}
              selectedDocumentId={selectedDocumentId}
              selectedPageNumber={selectedPageNumber}
              onOCRRequest={onOCRRequest}
              onOcrSearchResults={onOcrSearchResults}
              onDocumentsUpdate={onDocumentsUpdate}
              onReloadDocuments={onReloadDocuments}
              onPdfUpload={onPdfUpload}
              uploading={uploading}
              onLabelingJobUpdate={onLabelingJobUpdate}
              onExtractTitleblockForDocument={onExtractTitleblockForDocument}
              onBulkExtractTitleblock={onBulkExtractTitleblock}
            />
          )}

          {rightSidebarTab === 'search' && (
            <SearchTab
              projectId={projectId}
              documents={documents}
              onPageSelect={onPageSelect}
              selectedDocumentId={selectedDocumentId}
              selectedPageNumber={selectedPageNumber}
            />
          )}

          {rightSidebarTab === 'ai-chat' && (
            <ChatTab projectId={projectId} documents={documents} />
          )}
        </div>
      )}
    </div>
  );
}
