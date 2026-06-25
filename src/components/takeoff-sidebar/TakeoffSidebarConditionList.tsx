/**
 * Renders the conditions list for the Conditions tab.
 * Compact cards, folder grouping, contextual toolbar, right-click menu.
 */
import {
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Input } from '../ui/input';
import {
  Calculator,
  Ruler,
  Square,
  Hash,
  Package,
  Trash2,
  Copy,
  Scissors,
  Bot,
  Search,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  Pencil,
  Check,
  X,
  FolderMinus,
} from 'lucide-react';
import { useConditionStore } from '../../store/slices/conditionSlice';
import { useConditionFolderStore } from '../../store/slices/conditionFolderSlice';
import type { TakeoffCondition, ConditionFolder } from '../../types';
import { parseDocumentIdFromSheetId } from '../../lib/sheetUtils';
import { cn, formatFeetAndInches } from '../../lib/utils';

// ─── helpers ────────────────────────────────────────────────────────────────

function samePdfPage(stored: number | string | undefined, viewerPage: number | null | undefined): boolean {
  if (viewerPage == null || viewerPage < 1) return true;
  return Number(stored) === Number(viewerPage);
}

function measurementBelongsToDocument(m: { sheetId: string }, viewerDocumentId: string): boolean {
  if (m.sheetId === viewerDocumentId) return true;
  return parseDocumentIdFromSheetId(m.sheetId) === viewerDocumentId;
}

function supportsWasteFactor(type: TakeoffCondition['type']): boolean {
  return type !== 'count' && type !== 'auto-count';
}

function supportsCutout(type: TakeoffCondition['type']): boolean {
  return type === 'area' || type === 'volume';
}

function filterMeasurementsForCurrentPage<T extends { sheetId: string; pdfPage: number | string }>(
  measurements: T[],
  viewerDocumentId: string | null | undefined,
  currentPage: number | null | undefined
): T[] {
  if (!viewerDocumentId) return [];
  let current = measurements.filter((m) => measurementBelongsToDocument(m, viewerDocumentId));
  if (currentPage != null && currentPage >= 1) {
    current = current.filter((m) => samePdfPage(m.pdfPage, currentPage));
  }
  return current;
}

function formatConditionValue(
  condition: TakeoffCondition,
  measurements: Array<{ sheetId: string; pdfPage: number; netCalculatedValue?: number | null; calculatedValue: number; perimeterValue?: number | null; areaValue?: number | null }>,
  viewerDocumentId?: string | null,
  currentPage?: number | null
): ReactNode {
  const current = filterMeasurementsForCurrentPage(measurements, viewerDocumentId, currentPage);
  const multiplier = condition.multiplier ?? 1;
  const totalValue = current.reduce((sum, m) => sum + (m.netCalculatedValue ?? m.calculatedValue ?? 0), 0) * multiplier;
  const totalAreaValue = current.reduce((sum, m) => sum + (m.areaValue ?? 0), 0) * multiplier;
  if (totalValue <= 0) return null;
  if (condition.type === 'linear' && condition.includeHeight && condition.height && totalAreaValue > 0) {
    return `${formatFeetAndInches(totalValue)} LF · ${totalAreaValue.toFixed(0)} SF`;
  }
  if (condition.unit === 'ft' || condition.unit === 'feet' || (condition.type === 'linear' && (condition.unit === 'LF' || condition.unit === 'lf'))) {
    return formatFeetAndInches(totalValue);
  }
  if (condition.unit === 'SF' || condition.unit === 'sq ft') {
    const totalPerimeter = current.reduce((sum, m) => sum + (m.perimeterValue ?? 0), 0);
    return totalPerimeter > 0
      ? `${totalValue.toFixed(0)} SF · ${formatFeetAndInches(totalPerimeter)} LF`
      : `${totalValue.toFixed(0)} SF`;
  }
  return `${totalValue.toFixed(2)} ${condition.unit}`;
}

function getTypeIcon(type: string) {
  const cls = 'w-3.5 h-3.5 flex-shrink-0 text-muted-foreground';
  switch (type) {
    case 'area': return <Square className={cls} />;
    case 'volume': return <Package className={cls} />;
    case 'linear': return <Ruler className={cls} />;
    case 'count': return <Hash className={cls} />;
    case 'auto-count': return <Search className={cls} />;
    default: return <Calculator className={cls} />;
  }
}

// ─── context menu ───────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  conditionId: string;
  showFolderFlyout: boolean;
}

// ─── props ──────────────────────────────────────────────────────────────────

export interface TakeoffSidebarConditionListProps {
  conditions: TakeoffCondition[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedConditionId: string | null;
  projectId: string;
  viewerDocumentId?: string | null;
  currentPage?: number | null;
  matchThumbnails: Record<string, Array<{ measurementId: string; thumbnail: string }>>;
  loadingThumbnails: Set<string>;
  getConditionTakeoffMeasurements: (projectId: string, conditionId: string) => Array<{
    sheetId: string;
    pdfPage: number;
    calculatedValue: number;
    netCalculatedValue?: number | null;
    perimeterValue?: number | null;
    areaValue?: number | null;
  }>;
  cutoutMode?: boolean;
  cutoutTargetConditionId?: string | null;
  onConditionClick: (condition: TakeoffCondition) => void;
  onCutoutMode?: (condition: TakeoffCondition) => void;
  onDuplicate: (condition: TakeoffCondition) => void;
  onEdit: (condition: TakeoffCondition) => void;
  onAddCondition?: () => void;
  onDeleteClick: (conditionId: string) => void;
}

// ─── component ──────────────────────────────────────────────────────────────

export function TakeoffSidebarConditionList({
  conditions,
  searchQuery,
  onSearchChange,
  selectedConditionId,
  projectId,
  viewerDocumentId,
  currentPage,
  matchThumbnails: _matchThumbnails,
  loadingThumbnails: _loadingThumbnails,
  getConditionTakeoffMeasurements,
  cutoutMode,
  cutoutTargetConditionId,
  onConditionClick,
  onCutoutMode,
  onDuplicate,
  onEdit,
  onDeleteClick,
  onAddCondition,
}: TakeoffSidebarConditionListProps) {
  const conditionRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ── store ──
  const hiddenMarkupConditionIds = useConditionStore(
    useShallow((s) => (s.hiddenMarkupConditionIdsByProject ?? {})[projectId] ?? [])
  );
  const toggleMarkupHidden = useConditionStore((s) => s.toggleConditionMarkupHidden);
  const updateCondition = useConditionStore((s) => s.updateCondition);

  const folders = useConditionFolderStore((s) => s.getFolders(projectId));
  const ensureFoldersLoaded = useConditionFolderStore((s) => s.ensureFoldersLoaded);
  const createFolder = useConditionFolderStore((s) => s.createFolder);
  const renameFolder = useConditionFolderStore((s) => s.renameFolder);
  const deleteFolder = useConditionFolderStore((s) => s.deleteFolder);

  useEffect(() => {
    ensureFoldersLoaded(projectId);
  }, [projectId, ensureFoldersLoaded]);

  // ── folder UI state ──
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipRenameBlurRef = useRef(false);

  // ── context menu state ──
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [folderSearch, setFolderSearch] = useState('');
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const folderFlyoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── scroll selected into view ──
  useLayoutEffect(() => {
    if (!selectedConditionId) return;
    const el = conditionRowRefs.current.get(selectedConditionId);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [selectedConditionId]);

  // ── dismiss context menu on outside click ──
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
        setFolderSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ctxMenu]);

  // ── focus new folder input ──
  useEffect(() => {
    if (creatingFolder) newFolderInputRef.current?.focus();
  }, [creatingFolder]);

  useEffect(() => {
    if (renamingFolderId) renameInputRef.current?.focus();
  }, [renamingFolderId]);

  // ── actions ──
  const selectedCondition = conditions.find((c) => c.id === selectedConditionId) ?? null;
  const isHidden = selectedConditionId ? hiddenMarkupConditionIds.includes(selectedConditionId) : false;

  const handleToggleFolder = (folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, conditionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, conditionId, showFolderFlyout: false });
    setFolderSearch('');
  }, []);

  const ctxCondition = ctxMenu ? conditions.find((c) => c.id === ctxMenu.conditionId) ?? null : null;

  const handleMoveToFolder = async (conditionId: string, folderId: string | null) => {
    await updateCondition(conditionId, { folderId });
    setCtxMenu(null);
    setFolderSearch('');
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) { setCreatingFolder(false); return; }
    await createFolder(projectId, name);
    setNewFolderName('');
    setCreatingFolder(false);
  };

  const handleRenameFolder = async (id: string) => {
    const name = renameValue.trim();
    if (!name) { setRenamingFolderId(null); return; }
    await renameFolder(id, name);
    setRenamingFolderId(null);
  };

  const handleDeleteFolder = async (id: string) => {
    await deleteFolder(id, projectId);
  };

  // ── grouping ──
  const isSearching = searchQuery.trim().length > 0;

  const folderedConditions: Record<string, TakeoffCondition[]> = {};
  const uncategorized: TakeoffCondition[] = [];

  if (!isSearching) {
    for (const c of conditions) {
      if (c.folderId) {
        folderedConditions[c.folderId] = folderedConditions[c.folderId] ?? [];
        folderedConditions[c.folderId].push(c);
      } else {
        uncategorized.push(c);
      }
    }
  }

  // ── contextual toolbar ──
  const canCutout = selectedCondition ? supportsCutout(selectedCondition.type) : false;
  const isCuttingOut = cutoutMode && cutoutTargetConditionId === selectedConditionId;

  // ── filtered folders for flyout ──
  const flyoutFolders = folderSearch.trim()
    ? folders.filter((f) => f.name.toLowerCase().includes(folderSearch.toLowerCase()))
    : folders;

  // ── render single condition card ──
  const renderConditionCard = (condition: TakeoffCondition, indented: boolean) => {
    const measurements = getConditionTakeoffMeasurements(projectId, condition.id);
    const displayValue = formatConditionValue(condition, measurements, viewerDocumentId, currentPage);
    const isSelected = selectedConditionId === condition.id;
    const isCutTarget = isCuttingOut && condition.id === cutoutTargetConditionId;

    return (
      <div
        key={condition.id}
        ref={(el) => {
          if (el) conditionRowRefs.current.set(condition.id, el);
          else conditionRowRefs.current.delete(condition.id);
        }}
        className={cn(
          'flex items-start gap-2 px-3 py-1.5 cursor-pointer select-none group/card transition-colors',
          indented && 'pl-7',
          isSelected && !isCutTarget && 'bg-blue-100/80 dark:bg-blue-900/40 ring-1 ring-inset ring-blue-200 dark:ring-blue-700/60',
          isCutTarget && 'bg-red-50 dark:bg-red-950/20 ring-1 ring-inset ring-red-200 dark:ring-red-800/40',
          !isSelected && !isCutTarget && 'hover:bg-muted/50'
        )}
        onClick={() => onConditionClick(condition)}
        onContextMenu={(e) => handleContextMenu(e, condition.id)}
      >
        {/* color rail — wider when selected */}
        <div
          className={cn('self-stretch rounded-full flex-shrink-0 mt-0.5 transition-all', isSelected || isCutTarget ? 'w-1' : 'w-0.5')}
          style={{ backgroundColor: isCutTarget ? '#EF4444' : condition.color, minHeight: '20px' }}
        />
        {/* body */}
        <div className="flex-1 min-w-0 py-0.5">
          <div className="flex items-start gap-1">
            <span className={cn(
              'text-sm leading-snug break-words',
              isSelected && !isCutTarget ? 'font-semibold text-foreground' : 'font-medium',
              isCutTarget && 'font-semibold text-red-600 dark:text-red-400'
            )}>
              {condition.name}
            </span>
            {condition.aiGenerated && (
              <Bot className="w-3 h-3 flex-shrink-0 mt-0.5 text-blue-500" />
            )}
            {(condition.multiplier ?? 1) > 1 && (
              <span
                title={`Quantity multiplier: ×${condition.multiplier} — total = measured × ${condition.multiplier}`}
                className="text-[10px] font-bold px-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 leading-tight flex-shrink-0 mt-0.5"
              >
                ×{condition.multiplier}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
            {getTypeIcon(condition.type)}
            <span>{condition.unit}</span>
            {displayValue && (
              <>
                <span className="opacity-40">·</span>
                <span className={cn('font-medium', isCutTarget ? 'text-red-500' : 'text-foreground/70')}>{displayValue}</span>
              </>
            )}
            {isCutTarget && (
              <>
                <span className="opacity-40">·</span>
                <span className="text-red-500 flex items-center gap-0.5">
                  <Scissors className="w-3 h-3" /> cutting out
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── empty state ──
  if (conditions.length === 0) {
    return (
      <>
        <ContextualToolbar
          selectedCondition={null}
          isHidden={false}
          canCutout={false}
          isCuttingOut={false}
          cutoutMode={cutoutMode}
          onToggleHide={() => {}}
          onCutout={() => {}}
          onDuplicate={() => {}}
          onDelete={() => {}}
          onCreateFolder={() => setCreatingFolder(true)}
          onAddCondition={onAddCondition}
        />
        <SearchBar searchQuery={searchQuery} onSearchChange={onSearchChange} />
        <div className="text-center py-8 text-muted-foreground px-4">
          <Calculator className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No conditions yet</p>
          {onAddCondition && (
            <p className="text-xs mt-1 opacity-60">Click + to create your first condition</p>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {/* Contextual toolbar */}
      <ContextualToolbar
        selectedCondition={selectedCondition}
        isHidden={isHidden}
        canCutout={canCutout}
        isCuttingOut={!!isCuttingOut}
        cutoutMode={cutoutMode}
        onToggleHide={() => {
          if (selectedConditionId) toggleMarkupHidden(projectId, selectedConditionId);
        }}
        onCutout={() => {
          if (selectedCondition && onCutoutMode) onCutoutMode(selectedCondition);
        }}
        onDuplicate={() => { if (selectedCondition) onDuplicate(selectedCondition); }}
        onDelete={() => { if (selectedConditionId) onDeleteClick(selectedConditionId); }}
        onCreateFolder={() => setCreatingFolder(true)}
        onAddCondition={onAddCondition}
      />

      {/* Search */}
      <SearchBar searchQuery={searchQuery} onSearchChange={onSearchChange} />

      {/* List */}
      <div className="py-1">

        {/* Inline new folder creation */}
        {creatingFolder && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border">
            <FolderPlus className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <input
              ref={newFolderInputRef}
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder();
                if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); }
              }}
              placeholder="Folder name…"
              className="flex-1 text-sm bg-transparent outline-none border-b border-primary"
            />
            <button onClick={handleCreateFolder} className="text-primary hover:text-primary/80">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { setCreatingFolder(false); setNewFolderName(''); }} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {isSearching ? (
          /* Flat search results */
          conditions.map((c) => renderConditionCard(c, false))
        ) : (
          <>
            {/* Folders */}
            {folders.map((folder) => {
              const folderConditions = folderedConditions[folder.id] ?? [];
              const isCollapsed = collapsedFolders.has(folder.id);
              const isRenaming = renamingFolderId === folder.id;

              return (
                <div key={folder.id}>
                  {/* Folder header row */}
                  <div
                    className="flex items-center gap-1.5 px-3 h-8 cursor-pointer group/folder hover:bg-muted/50 select-none"
                    onClick={() => !isRenaming && handleToggleFolder(folder.id)}
                  >
                    <ChevronRight
                      className={cn('w-3 h-3 text-muted-foreground flex-shrink-0 transition-transform', !isCollapsed && 'rotate-90')}
                    />
                    {isCollapsed
                      ? <Folder className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      : <FolderOpen className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    }

                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            skipRenameBlurRef.current = true;
                            handleRenameFolder(folder.id);
                          }
                          if (e.key === 'Escape') {
                            skipRenameBlurRef.current = true;
                            setRenamingFolderId(null);
                          }
                        }}
                        onBlur={() => {
                          if (skipRenameBlurRef.current) {
                            skipRenameBlurRef.current = false;
                            return;
                          }
                          handleRenameFolder(folder.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 text-sm font-medium bg-transparent outline-none border-b border-primary"
                      />
                    ) : (
                      <span className="flex-1 text-sm font-medium truncate">{folder.name}</span>
                    )}

                    <span className="text-xs text-muted-foreground tabular-nums mr-1">
                      {folderConditions.length}
                    </span>

                    {/* Hover actions */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100">
                      <button
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        title="Rename folder"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingFolderId(folder.id);
                          setRenameValue(folder.name);
                        }}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        title="Delete folder"
                        onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Folder contents */}
                  {!isCollapsed && folderConditions.map((c) => renderConditionCard(c, true))}
                </div>
              );
            })}

            {/* Uncategorized section */}
            {uncategorized.length > 0 && (
              <>
                {folders.length > 0 && (
                  <div className="flex items-center gap-2 px-3 pt-2 pb-0.5">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                      Uncategorized
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                {uncategorized.map((c) => renderConditionCard(c, false))}
              </>
            )}
          </>
        )}
      </div>

      {/* Context menu (portal-less, fixed position) */}
      {ctxMenu && ctxCondition && (
        <div
          ref={ctxMenuRef}
          className="fixed z-[9999] min-w-[180px] bg-popover text-popover-foreground border border-border rounded-lg shadow-lg py-1"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <CtxItem icon={<Pencil />} label="Edit condition" onClick={() => { onEdit(ctxCondition); setCtxMenu(null); }} />
          <CtxItem icon={<Copy />} label="Duplicate" onClick={() => { onDuplicate(ctxCondition); setCtxMenu(null); }} />
          <CtxSep />
          {/* Move to folder row — relative so flyout anchors to it */}
          <div
            className="relative"
            onMouseEnter={() => {
              if (folderFlyoutTimerRef.current) clearTimeout(folderFlyoutTimerRef.current);
              setCtxMenu((prev) => prev ? { ...prev, showFolderFlyout: true } : null);
            }}
            onMouseLeave={() => {
              folderFlyoutTimerRef.current = setTimeout(() => {
                setCtxMenu((prev) => prev ? { ...prev, showFolderFlyout: false } : null);
              }, 150);
            }}
          >
            <CtxItem
              icon={<Folder />}
              label="Move to folder"
              hasSubmenu
              active={ctxMenu.showFolderFlyout}
              onClick={() => setCtxMenu((prev) => prev ? { ...prev, showFolderFlyout: !prev.showFolderFlyout } : null)}
            />
            {ctxMenu.showFolderFlyout && (
              <div
                className="absolute left-full top-0 z-[10000] w-52 bg-popover border border-border rounded-lg shadow-xl py-1.5 px-1.5"
                onMouseEnter={() => {
                  if (folderFlyoutTimerRef.current) clearTimeout(folderFlyoutTimerRef.current);
                }}
                onMouseLeave={() => {
                  folderFlyoutTimerRef.current = setTimeout(() => {
                    setCtxMenu((prev) => prev ? { ...prev, showFolderFlyout: false } : null);
                  }, 150);
                }}
              >
                <input
                  autoFocus
                  type="text"
                  value={folderSearch}
                  onChange={(e) => setFolderSearch(e.target.value)}
                  placeholder="Search folders…"
                  className="w-full text-xs px-2 py-1 mb-1 border border-border rounded-md bg-background outline-none"
                />
                <div className="max-h-48 overflow-y-auto">
                  {flyoutFolders.length === 0 && (
                    <p className="text-xs text-muted-foreground px-2 py-1">No folders found</p>
                  )}
                  {flyoutFolders.map((f) => (
                    <button
                      key={f.id}
                      className={cn(
                        'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted text-left',
                        ctxCondition.folderId === f.id && 'font-medium text-primary'
                      )}
                      onClick={() => handleMoveToFolder(ctxCondition.id, f.id)}
                    >
                      <Folder className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      {f.name}
                      {ctxCondition.folderId === f.id && <Check className="w-3 h-3 ml-auto" />}
                    </button>
                  ))}
                </div>
                {ctxCondition.folderId && (
                  <>
                    <div className="my-1 h-px bg-border" />
                    <button
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted text-left text-muted-foreground"
                      onClick={() => handleMoveToFolder(ctxCondition.id, null)}
                    >
                      <FolderMinus className="w-3.5 h-3.5 flex-shrink-0" />
                      Remove from folder
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <CtxSep />
          <CtxItem
            icon={hiddenMarkupConditionIds.includes(ctxCondition.id) ? <Eye /> : <EyeOff />}
            label={hiddenMarkupConditionIds.includes(ctxCondition.id) ? 'Show markup' : 'Hide markup'}
            onClick={() => { toggleMarkupHidden(projectId, ctxCondition.id); setCtxMenu(null); }}
          />
          <CtxSep />
          <CtxItem
            icon={<Trash2 />}
            label="Delete"
            danger
            onClick={() => { onDeleteClick(ctxCondition.id); setCtxMenu(null); }}
          />
        </div>
      )}
    </>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function SearchBar({ searchQuery, onSearchChange }: { searchQuery: string; onSearchChange: (v: string) => void }) {
  return (
    <div className="px-2 py-1.5 border-b border-border">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          id="conditions-search"
          name="conditions-search"
          type="search"
          autoComplete="off"
          placeholder="Search conditions…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-8 pl-8 text-sm bg-background"
        />
      </div>
    </div>
  );
}

interface ContextualToolbarProps {
  selectedCondition: TakeoffCondition | null;
  isHidden: boolean;
  canCutout: boolean;
  isCuttingOut: boolean;
  cutoutMode?: boolean;
  onToggleHide: () => void;
  onCutout: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCreateFolder: () => void;
  onAddCondition?: () => void;
}

function ContextualToolbar({
  selectedCondition,
  isHidden,
  canCutout,
  isCuttingOut,
  cutoutMode,
  onToggleHide,
  onCutout,
  onDuplicate,
  onDelete,
  onCreateFolder,
  onAddCondition,
}: ContextualToolbarProps) {
  const hasSelection = !!selectedCondition;
  const inCutoutMode = cutoutMode && isCuttingOut;

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 px-2 py-1 border-b border-border',
        inCutoutMode ? 'bg-red-50 dark:bg-red-950/20' : 'bg-muted/30'
      )}
    >
      {/* Label */}
      <span
        className={cn(
          'text-xs flex-1 truncate mr-1',
          inCutoutMode ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground'
        )}
      >
        {inCutoutMode
          ? '✂ Cut-out mode'
          : selectedCondition
          ? selectedCondition.name
          : 'No condition selected'}
      </span>

      {/* Hide / show */}
      <ToolbarBtn
        title={isHidden ? 'Show markup' : 'Hide markup'}
        disabled={!hasSelection || inCutoutMode}
        onClick={onToggleHide}
      >
        {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </ToolbarBtn>

      {/* Cut-out (always shown; red when applicable, extra red when active) */}
      <ToolbarBtn
        title={isCuttingOut ? 'Exit cut-out mode' : 'Add cut-out'}
        disabled={!canCutout && !isCuttingOut}
        active={canCutout || isCuttingOut}
        danger={canCutout || isCuttingOut}
        activeClass={isCuttingOut ? 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-300' : 'text-red-500 hover:text-red-600'}
        onClick={onCutout}
        className={isCuttingOut ? 'scissors-pulse-once' : ''}
      >
        <Scissors className="w-3.5 h-3.5" />
      </ToolbarBtn>

      <div className="w-px h-4 bg-border mx-0.5" />

      {/* Duplicate */}
      <ToolbarBtn title="Duplicate condition" disabled={!hasSelection || inCutoutMode} onClick={onDuplicate}>
        <Copy className="w-3.5 h-3.5" />
      </ToolbarBtn>

      {/* Delete */}
      <ToolbarBtn title="Delete condition" disabled={!hasSelection || inCutoutMode} onClick={onDelete} danger>
        <Trash2 className="w-3.5 h-3.5" />
      </ToolbarBtn>

      <div className="w-px h-4 bg-border mx-0.5" />

      {/* New folder */}
      <ToolbarBtn title="New folder" onClick={onCreateFolder}>
        <FolderPlus className="w-3.5 h-3.5" />
      </ToolbarBtn>

      {/* New condition */}
      {onAddCondition && (
        <ToolbarBtn title="New condition" onClick={onAddCondition}>
          <span className="text-sm font-medium leading-none">+</span>
        </ToolbarBtn>
      )}
    </div>
  );
}

interface ToolbarBtnProps {
  title: string;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  activeClass?: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}

function ToolbarBtn({ title, disabled, active, danger, activeClass, onClick, className, children }: ToolbarBtnProps) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-7 h-7 flex items-center justify-center rounded-md transition-colors',
        disabled
          ? 'opacity-30 cursor-default text-muted-foreground'
          : active && activeClass
          ? activeClass
          : active && danger
          ? 'text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30'
          : danger && !disabled
          ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
        className
      )}
    >
      {children}
    </button>
  );
}

function CtxItem({
  icon,
  label,
  onClick,
  danger,
  hasSubmenu,
  active,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  hasSubmenu?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted text-left',
        danger && 'text-destructive hover:bg-destructive/10',
        active && !danger && 'bg-muted'
      )}
      onClick={onClick}
    >
      <span className={cn('w-4 h-4 flex-shrink-0', danger ? 'text-destructive' : 'text-muted-foreground')}>
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {hasSubmenu && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
    </button>
  );
}

function CtxSep() {
  return <div className="my-0.5 h-px bg-border" />;
}
