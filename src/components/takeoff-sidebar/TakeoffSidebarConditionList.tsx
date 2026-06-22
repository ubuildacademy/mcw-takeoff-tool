/**
 * Renders the list of takeoff conditions (search + condition cards) for the Conditions tab.
 */
import { useState, useRef, useLayoutEffect, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import {
  Calculator,
  Ruler,
  Square,
  Hash,
  Package,
  Trash2,
  Edit3,
  Copy,
  Scissors,
  Bot,
  Search,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useConditionStore } from '../../store/slices/conditionSlice';
import type { TakeoffCondition } from '../../types';
import { parseDocumentIdFromSheetId } from '../../lib/sheetUtils';
import { cn, formatFeetAndInches } from '../../lib/utils';

function samePdfPage(stored: number | string | undefined, viewerPage: number | null | undefined): boolean {
  if (viewerPage == null || viewerPage < 1) return true;
  return Number(stored) === Number(viewerPage);
}

/** True if measurement belongs to the open PDF (document id or legacy composite sheet id). */
function measurementBelongsToDocument(m: { sheetId: string }, viewerDocumentId: string): boolean {
  if (m.sheetId === viewerDocumentId) return true;
  return parseDocumentIdFromSheetId(m.sheetId) === viewerDocumentId;
}

function getImageSrc(img: string): string {
  return img.startsWith('data:') || img.startsWith('http') ? img : `data:image/png;base64,${img}`;
}

function supportsWasteFactor(type: TakeoffCondition['type']): boolean {
  return type !== 'count' && type !== 'auto-count';
}

/** Measurements for the active viewer sheet + page only (standard takeoff sidebar: page totals, not project-wide). */
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
  const totalValue = current.reduce((sum, m) => sum + (m.netCalculatedValue ?? m.calculatedValue ?? 0), 0);
  const totalPerimeter = current.reduce((sum, m) => sum + (m.perimeterValue ?? 0), 0);
  const totalAreaValue = current.reduce((sum, m) => sum + (m.areaValue ?? 0), 0);
  if (totalValue <= 0) return '0';
  if (condition.type === 'linear' && condition.includeHeight && condition.height && totalAreaValue > 0) {
    return (
      <div className="flex items-center gap-2">
        <span>{formatFeetAndInches(totalValue)} LF</span>
        <span className="text-xs text-muted-foreground">{totalAreaValue.toFixed(0)} SF</span>
      </div>
    );
  }
  if (condition.unit === 'ft' || condition.unit === 'feet' || (condition.type === 'linear' && (condition.unit === 'LF' || condition.unit === 'lf'))) {
    return formatFeetAndInches(totalValue);
  }
  if (condition.unit === 'SF' || condition.unit === 'sq ft') {
    return (
      <div className="flex items-center gap-2">
        <span>{totalValue.toFixed(0)} SF</span>
        {totalPerimeter > 0 && <span className="text-xs text-muted-foreground">{formatFeetAndInches(totalPerimeter)} LF</span>}
      </div>
    );
  }
  return `${totalValue.toFixed(2)} ${condition.unit}`;
}

export interface TakeoffSidebarConditionListProps {
  conditions: TakeoffCondition[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedConditionId: string | null;
  projectId: string;
  /** Open tab's document (file) id — use this instead of separate selection state so quantities stay in sync with the viewer. */
  viewerDocumentId?: string | null;
  /** 1-based PDF page for the active tab; quantities are scoped to this page. */
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

function getTypeIcon(type: string) {
  switch (type) {
    case 'area':
      return <Square />;
    case 'volume':
      return <Package />;
    case 'linear':
      return <Ruler />;
    case 'count':
      return <Hash />;
    case 'auto-count':
      return <Search />;
    default:
      return <Calculator />;
  }
}

export function TakeoffSidebarConditionList({
  conditions,
  searchQuery,
  onSearchChange,
  selectedConditionId,
  projectId,
  viewerDocumentId,
  currentPage,
  matchThumbnails,
  loadingThumbnails,
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
  const [collapsedSearchedSymbols, setCollapsedSearchedSymbols] = useState<Set<string>>(new Set());
  const conditionRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const hiddenMarkupConditionIds = useConditionStore(
    useShallow((s) => (s.hiddenMarkupConditionIdsByProject ?? {})[projectId] ?? [])
  );
  const toggleMarkupHidden = useConditionStore((s) => s.toggleConditionMarkupHidden);

  useLayoutEffect(() => {
    if (!selectedConditionId) return;
    const el = conditionRowRefs.current.get(selectedConditionId);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [selectedConditionId]);

  const toggleSearchedSymbol = (conditionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedSearchedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(conditionId)) next.delete(conditionId);
      else next.add(conditionId);
      return next;
    });
  };

  return (
    <>
      <div className="p-2 pb-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            id="conditions-search"
            name="conditions-search"
            type="search"
            autoComplete="off"
            placeholder="Search conditions..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-9 pl-8 bg-background"
          />
        </div>
      </div>
      <div className="p-2 space-y-2">
        {conditions.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Calculator className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No takeoff conditions yet</p>
            <p className="text-sm">{onAddCondition ? 'Click the + button to create your first condition' : 'Create your first condition from the sidebar.'}</p>
          </div>
        ) : (
          conditions.map((condition) => (
            <div
              key={condition.id}
              ref={(el) => {
                if (el) conditionRowRefs.current.set(condition.id, el);
                else conditionRowRefs.current.delete(condition.id);
              }}
              className={cn(
                'condition-card group',
                selectedConditionId === condition.id && 'condition-card-active',
                selectedConditionId !== condition.id && condition.aiGenerated && 'border-blue-300 bg-blue-50/70'
              )}
              onClick={() => onConditionClick(condition)}
            >
              {(() => {
                const measurements = getConditionTakeoffMeasurements(projectId, condition.id);
                const pageMeasurements = filterMeasurementsForCurrentPage(measurements, viewerDocumentId, currentPage);
                const displayValue = formatConditionValue(condition, measurements, viewerDocumentId, currentPage);
                const isHidden = hiddenMarkupConditionIds.includes(condition.id);
                const thumbnails = matchThumbnails[condition.id] ?? [];
                const thumbnailsLoading = loadingThumbnails.has(condition.id);
                return (
              <>
              <div className="condition-color-rail" style={{ backgroundColor: condition.color }} />
              <div className="condition-card-body">
                <div className="condition-card-header">
                  <div className="condition-kind-icon">
                    {getTypeIcon(condition.type)}
                  </div>
                  <div className="condition-card-main">
                    <div className="min-w-0">
                        <div className="condition-card-title-line">
                          <span className="font-semibold text-foreground break-words">{condition.name}</span>
                          <span className="condition-unit-pill">{condition.unit}</span>
                        </div>
                        {(selectedConditionId === condition.id || condition.aiGenerated) && (
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {selectedConditionId === condition.id && (
                              <Badge variant="default" className="text-xs bg-blue-600" title="Click to deactivate">Active</Badge>
                            )}
                            {condition.aiGenerated && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700">
                                <Bot className="w-3 h-3 flex-shrink-0" />
                                AI
                              </span>
                            )}
                          </div>
                        )}
                    </div>
                  </div>
                      <div className="condition-card-actions">
                        <div className="condition-action-group">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleMarkupHidden(projectId, condition.id);
                            }}
                            className={`condition-action-button ${isHidden ? 'text-muted-foreground' : ''}`}
                            title={
                              isHidden
                                ? 'Show markups on page'
                                : 'Hide markups on page (still in sidebar; excluded from PDF/Excel)'
                            }
                          >
                            {isHidden ? (
                              <EyeOff className="condition-action-icon" />
                            ) : (
                              <Eye className="condition-action-icon" />
                            )}
                          </Button>
                          {(condition.type === 'area' || condition.type === 'volume') && onCutoutMode && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCutoutMode(condition);
                              }}
                                className={`condition-action-button ${cutoutMode && cutoutTargetConditionId === condition.id ? 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-300' : 'text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300'}`}
                              title="Add cut-out to existing measurements"
                            >
                              <Scissors className="condition-action-icon" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onDuplicate(condition); }} className="condition-action-button" title="Duplicate condition">
                            <Copy className="condition-action-icon" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onEdit(condition); }} className="condition-action-button" title="Edit condition">
                            <Edit3 className="condition-action-icon" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); onDeleteClick(condition.id); }}
                            className="condition-action-button condition-action-danger"
                            title="Delete condition"
                          >
                            <Trash2 className="condition-action-icon" />
                          </Button>
                        </div>
                      </div>
                    <div className="col-start-2 min-w-0">
                    <p
                      className={`text-xs text-muted-foreground mt-0.5 ${selectedConditionId === condition.id ? '' : 'line-clamp-1'}`}
                      title={condition.description || undefined}
                    >
                      {condition.description}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: condition.color }} />
                        Waste: {supportsWasteFactor(condition.type) ? `${condition.wasteFactor}%` : 'n/a'}
                      </span>
                      <span className="condition-total">
                        {displayValue}
                      </span>
                      {condition.type === 'auto-count' && pageMeasurements.length > 0 && (
                        <span>{pageMeasurements.length} match{pageMeasurements.length !== 1 ? 'es' : ''} on this page</span>
                      )}
                    </div>
                    {condition.searchImage && condition.type === 'auto-count' && (
                      <div className="mt-1.5 bg-indigo-50 border border-indigo-200 rounded-lg overflow-hidden dark:bg-indigo-950/30 dark:border-indigo-800">
                        <button
                          type="button"
                          onClick={(e) => toggleSearchedSymbol(condition.id, e)}
                          className="w-full flex items-center justify-between gap-2 px-2 py-1 text-xs font-medium text-indigo-900 hover:bg-indigo-100/70 transition-colors text-left dark:text-indigo-200 dark:hover:bg-indigo-900/40"
                        >
                          Searched symbol
                          {collapsedSearchedSymbols.has(condition.id) ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronUp className="w-3 h-3 flex-shrink-0" />}
                        </button>
                        {!collapsedSearchedSymbols.has(condition.id) && (
                          <div className="px-2 pb-2 pt-0">
                            <img
                              src={getImageSrc(condition.searchImage)}
                              alt="Searched symbol"
                              className="max-w-full h-auto max-h-10 rounded border border-indigo-300 bg-white dark:border-indigo-700"
                              style={{ imageRendering: 'crisp-edges' }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {condition.type === 'auto-count' && (thumbnailsLoading || thumbnails.length > 0) && (
                      <div className="mt-1.5">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Matches
                        </div>
                        {thumbnailsLoading ? (
                          <div className="grid grid-cols-3 gap-1.5">
                            {[0, 1, 2].map((i) => (
                              <div key={i} className="h-8 animate-pulse rounded-md bg-muted" />
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-1.5">
                            {thumbnails.slice(0, 6).map((thumb) => (
                              <img
                                key={thumb.measurementId}
                                src={getImageSrc(thumb.thumbnail)}
                                alt=""
                                className="h-8 w-full rounded-md border border-border bg-white object-contain"
                                style={{ imageRendering: 'crisp-edges' }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </>
                );
              })()}
            </div>
          ))
        )}
      </div>
    </>
  );
}
