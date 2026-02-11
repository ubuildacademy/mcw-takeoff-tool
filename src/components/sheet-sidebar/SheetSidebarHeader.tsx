import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Upload, Settings, Filter, Search, Tag, Trash2 } from 'lucide-react';
import type { SheetSidebarHeaderProps } from './SheetSidebarHeader.types';
import type { SheetSidebarFilterBy } from './useSheetSidebarFilter';

export function SheetSidebarHeader({
  filterBy,
  onFilterByChange,
  searchQuery,
  onSearchQueryChange,
  openBulkActionsMenu,
  onBulkActionsMenuToggle,
  documentsCount,
  onBulkExtractTitleblock,
  onDeleteAllDocuments,
  onPdfUpload,
  uploading,
}: SheetSidebarHeaderProps) {
  const handleBulkExtractOrLabel = () => {
    const confirmed = window.confirm(
      `Extract titleblock information for all ${documentsCount} document(s)? This will process all pages.`
    );
    if (!confirmed) return;
    if (onBulkExtractTitleblock) {
      onBulkExtractTitleblock();
    }
  };

  return (
    <div className="p-4 border-b relative">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Project Documents</h2>
        <div className="flex gap-2 relative">
          {onPdfUpload && (
            <label htmlFor="pdf-upload" className="cursor-pointer">
              <Button size="sm" variant="outline" asChild title="Upload new PDF document(s)">
                <span className="flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  {uploading ? 'Uploading…' : 'Upload PDF'}
                </span>
              </Button>
            </label>
          )}
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onBulkActionsMenuToggle(!openBulkActionsMenu);
              }}
              title="Document Actions"
            >
              <Settings className="w-4 h-4" />
            </Button>

            {openBulkActionsMenu && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white border rounded-lg shadow-lg z-50 py-1">
                <button
                  className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 text-blue-600 flex items-center gap-2"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onBulkActionsMenuToggle(false);
                    handleBulkExtractOrLabel();
                  }}
                >
                  <Tag className="w-4 h-4" />
                  Extract Titleblock Info (All)
                </button>
                <button
                  className="w-full px-3 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDeleteAllDocuments();
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete All Documents
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {onPdfUpload && (
        <input
          id="pdf-upload"
          name="pdf-upload"
          type="file"
          accept=".pdf,application/pdf"
          onChange={onPdfUpload}
          className="hidden"
          multiple
        />
      )}

      <div className="space-y-3">
        <div className="space-y-2">
          <label htmlFor="sheet-search-pages" className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Search className="w-4 h-4" />
            Search Pages
          </label>
          <Input
            id="sheet-search-pages"
            name="sheet-search-pages"
            type="text"
            autoComplete="off"
            placeholder="Search by page number, sheet name, or sheet number..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="sheet-filter-pages" className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filter Pages
          </label>
          <select
            id="sheet-filter-pages"
            name="sheet-filter-pages"
            value={filterBy}
            onChange={(e) =>
              onFilterByChange((e.target.value as SheetSidebarFilterBy) || 'all')
            }
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
          >
            <option value="all">All Pages</option>
            <option value="withTakeoffs">With Takeoffs</option>
            <option value="withoutTakeoffs">Without Takeoffs</option>
          </select>
        </div>
      </div>
    </div>
  );
}
