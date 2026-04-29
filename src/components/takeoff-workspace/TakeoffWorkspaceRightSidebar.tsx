import React, { lazy, Suspense } from 'react';
import { FileText, MessageSquare, Search } from 'lucide-react';

import { SidebarEdgeToggle } from './SidebarEdgeToggle';
import { SheetSidebar } from '../SheetSidebar';
import type { TakeoffWorkspaceRightSidebarProps } from './TakeoffWorkspaceHeader.types';

const SearchTab = lazy(() => import('../SearchTab').then((m) => ({ default: m.SearchTab })));
const ChatTab = lazy(() => import('../ChatTab').then((m) => ({ default: m.ChatTab })));

const TabFallback = () => (
  <div className="flex-1 flex items-center justify-center p-8" role="status" aria-label="Loading tab">
    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
  </div>
);

export function TakeoffWorkspaceRightSidebar({
  rightSidebarOpen,
  onRightSidebarOpenChange,
  rightSidebarTab,
  onRightSidebarTabChange,
  projectId,
  documents,
  documentsLoading,
  onPageSelect,
  onSearchResultSelect,
  onPageOpenInNewTab,
  selectedDocumentId,
  selectedPageNumber,
  onOCRRequest,
  onOcrSearchResults,
  onDocumentsUpdate,
  onReloadDocuments,
  onStartOcrTracking,
  onPdfUpload,
  uploading,
  onExtractTitleblockForDocument,
  onBulkExtractTitleblock,
  onRotateAllSheetsInDocument,
}: TakeoffWorkspaceRightSidebarProps) {
  return (
    <div className="flex">
      <SidebarEdgeToggle
        side="right"
        open={rightSidebarOpen}
        onOpenChange={onRightSidebarOpenChange}
      />
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
              onPageOpenInNewTab={onPageOpenInNewTab}
              selectedDocumentId={selectedDocumentId}
              selectedPageNumber={selectedPageNumber}
              onOCRRequest={onOCRRequest}
              onOcrSearchResults={onOcrSearchResults}
              onDocumentsUpdate={onDocumentsUpdate}
              onReloadDocuments={onReloadDocuments}
              onPdfUpload={onPdfUpload}
              uploading={uploading}
              onExtractTitleblockForDocument={onExtractTitleblockForDocument}
              onBulkExtractTitleblock={onBulkExtractTitleblock}
              onRotateAllSheetsInDocument={onRotateAllSheetsInDocument}
            />
          )}

          {rightSidebarTab === 'search' && (
            <Suspense fallback={<TabFallback />}>
              <SearchTab
                projectId={projectId}
                documents={documents}
                onPageSelect={onPageSelect}
                onSearchResultSelect={onSearchResultSelect}
                selectedDocumentId={selectedDocumentId}
                selectedPageNumber={selectedPageNumber}
                onReloadDocuments={onReloadDocuments}
                onStartOcrTracking={onStartOcrTracking}
              />
            </Suspense>
          )}

          {rightSidebarTab === 'ai-chat' && (
            <Suspense fallback={<TabFallback />}>
              <ChatTab projectId={projectId} documents={documents} />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}
