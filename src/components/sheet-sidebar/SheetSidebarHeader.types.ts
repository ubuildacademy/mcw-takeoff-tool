/**
 * Types for SheetSidebar subcomponents.
 */

import type { SheetSidebarFilterBy } from './useSheetSidebarFilter';

export interface SheetSidebarHeaderProps {
  filterBy: SheetSidebarFilterBy;
  onFilterByChange: (value: SheetSidebarFilterBy) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  openBulkActionsMenu: boolean;
  onBulkActionsMenuToggle: (open: boolean) => void;
  documentsCount: number;
  onBulkExtractTitleblock?: () => void;
  onDeleteAllDocuments: () => void;
  onPdfUpload?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  uploading?: boolean;
}
