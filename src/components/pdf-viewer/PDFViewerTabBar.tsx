import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { PDFViewerTab } from '../../store/slices/pdfViewerTabsSlice';

export interface PDFViewerTabBarProps {
  projectId: string;
  tabs: PDFViewerTab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onCloseAllOtherTabs: (tabId: string) => void;
}

export function PDFViewerTabBar({
  projectId: _projectId,
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onCloseAllOtherTabs,
}: PDFViewerTabBarProps) {
  const [contextMenu, setContextMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu]);

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center gap-0 border-b bg-muted/30 px-1">
      <div className="flex flex-1 min-w-0 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="button"
            tabIndex={0}
            onClick={() => onTabSelect(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onTabSelect(tab.id);
              }
            }}
            className={cn(
              'flex items-center gap-1.5 shrink-0 px-3 py-2 text-sm border-b-2 cursor-pointer transition-colors',
              'hover:bg-muted/50',
              activeTabId === tab.id
                ? 'border-primary bg-background text-foreground'
                : 'border-transparent text-muted-foreground'
            )}
          >
            <span className="truncate max-w-[140px]">{tab.label}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
              className="p-0.5 rounded hover:bg-muted shrink-0"
              aria-label={`Close ${tab.label}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[100] min-w-[180px] rounded-md border bg-popover p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm rounded-sm hover:bg-accent"
            onClick={() => {
              onTabClose(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            Close Tab
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm rounded-sm hover:bg-accent"
            onClick={() => {
              onCloseAllOtherTabs(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            Close All Other Tabs
          </button>
        </div>
      )}
    </div>
  );
}
