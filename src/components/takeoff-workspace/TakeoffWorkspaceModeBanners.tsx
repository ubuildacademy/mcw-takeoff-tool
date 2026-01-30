import React from 'react';
import type { TakeoffCondition } from '../../types';
import type { TitleblockField } from './useTakeoffWorkspaceTitleblock';

export interface TakeoffWorkspaceModeBannersProps {
  /** Auto Count (visual search) mode: show banner when active with condition */
  visualSearchMode: boolean;
  visualSearchCondition: TakeoffCondition | null;
  /** Titleblock selection mode: show banner when user is drawing regions */
  titleblockSelectionMode: TitleblockField | null;
}

/**
 * Mode indicator banners above the PDF viewer: Auto Count and Titleblock selection.
 * Renders nothing when neither mode is active.
 */
export function TakeoffWorkspaceModeBanners({
  visualSearchMode,
  visualSearchCondition,
  titleblockSelectionMode,
}: TakeoffWorkspaceModeBannersProps): React.ReactNode {
  const showAutoCount = visualSearchMode && visualSearchCondition;
  const showTitleblock = !!titleblockSelectionMode;

  if (!showAutoCount && !showTitleblock) {
    return null;
  }

  return (
    <>
      {showAutoCount && (
        <div className="bg-indigo-100 border-b border-indigo-200 p-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-indigo-900">
              Auto Count Mode: {visualSearchCondition!.name}
            </span>
          </div>
          <div className="text-xs text-indigo-700">
            Draw a box around a symbol to automatically find and count similar items
          </div>
        </div>
      )}
      {showTitleblock && (
        <div className="bg-blue-100 border-b border-blue-200 p-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-blue-900">
              Titleblock Selection: Draw a box around the{' '}
              {titleblockSelectionMode === 'sheetNumber' ? 'sheet number' : 'sheet name'} field
            </span>
          </div>
          <div className="text-xs text-blue-800">
            This configuration will be used to extract sheet titles and numbers automatically.
          </div>
        </div>
      )}
    </>
  );
}
