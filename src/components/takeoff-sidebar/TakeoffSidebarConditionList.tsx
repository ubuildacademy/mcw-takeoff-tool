/**
 * Renders the list of takeoff conditions (search + condition cards) for the Conditions tab.
 */
import { useState, type ReactNode } from 'react';
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
} from 'lucide-react';
import type { TakeoffCondition } from '../../types';
import { cn, formatFeetAndInches } from '../../lib/utils';

function getImageSrc(img: string): string {
  return img.startsWith('data:') || img.startsWith('http') ? img : `data:image/png;base64,${img}`;
}

function formatConditionValue(
  condition: TakeoffCondition,
  measurements: Array<{ sheetId: string; netCalculatedValue?: number | null; calculatedValue: number; perimeterValue?: number | null; areaValue?: number | null }>,
  selectedDocumentId?: string | null
): ReactNode {
  const current = selectedDocumentId ? measurements.filter((m) => m.sheetId === selectedDocumentId) : measurements;
  const totalValue = current.reduce((sum, m) => sum + (m.netCalculatedValue ?? m.calculatedValue ?? 0), 0);
  const totalPerimeter = current.reduce((sum, m) => sum + (m.perimeterValue ?? 0), 0);
  const totalAreaValue = current.reduce((sum, m) => sum + (m.areaValue ?? 0), 0);
  if (totalValue <= 0) return '0';
  if (condition.type === 'linear' && condition.includeHeight && condition.height && totalAreaValue > 0) {
    return (
      <div className="space-y-1">
        <div>{formatFeetAndInches(totalValue)} LF</div>
        <div className="text-xs text-gray-500">{totalAreaValue.toFixed(0)} SF</div>
      </div>
    );
  }
  if (condition.unit === 'ft' || condition.unit === 'feet' || (condition.type === 'linear' && (condition.unit === 'LF' || condition.unit === 'lf'))) {
    return formatFeetAndInches(totalValue);
  }
  if (condition.unit === 'SF' || condition.unit === 'sq ft') {
    return (
      <div className="space-y-1">
        <div>{totalValue.toFixed(0)} SF</div>
        {totalPerimeter > 0 && <div className="text-xs text-gray-500">{formatFeetAndInches(totalPerimeter)} LF</div>}
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
  selectedDocumentId?: string | null;
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
      return <Square className="w-4 h-4" />;
    case 'volume':
      return <Package className="w-4 h-4" />;
    case 'linear':
      return <Ruler className="w-4 h-4" />;
    case 'count':
      return <Hash className="w-4 h-4" />;
    case 'auto-count':
      return <Search className="w-4 h-4" />;
    default:
      return <Calculator className="w-4 h-4" />;
  }
}

export function TakeoffSidebarConditionList({
  conditions,
  searchQuery,
  onSearchChange,
  selectedConditionId,
  projectId,
  selectedDocumentId,
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
      <Input
        id="conditions-search"
        name="conditions-search"
        type="search"
        autoComplete="off"
        placeholder="Search conditions..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="mb-2 h-8"
      />
      <div className="p-2 space-y-2">
        {conditions.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Calculator className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No takeoff conditions yet</p>
            <p className="text-sm">{onAddCondition ? 'Click the + button to create your first condition' : 'Create your first condition from the header.'}</p>
          </div>
        ) : (
          conditions.map((condition) => (
            <div
              key={condition.id}
              className={cn(
                'p-2 border rounded-lg cursor-pointer transition-colors',
                selectedConditionId === condition.id && 'border-blue-500 bg-blue-50 shadow-sm',
                selectedConditionId !== condition.id && condition.aiGenerated && 'border-blue-400 bg-blue-100/50 hover:bg-blue-100/70 shadow-sm',
                selectedConditionId !== condition.id && !condition.aiGenerated && 'border-gray-200 hover:bg-accent/50'
              )}
              onClick={() => onConditionClick(condition)}
            >
              {(() => {
                const measurements = getConditionTakeoffMeasurements(projectId, condition.id);
                const thumbnails = matchThumbnails[condition.id] || [];
                const isLoadingThumbnails = loadingThumbnails.has(condition.id);
                return (
              <>
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  {getTypeIcon(condition.type)}
                  <div className="min-w-0 flex-1">
                    <div className="relative pr-12">
                      <span className="font-medium break-words block">{condition.name}</span>
                      <Badge variant="outline" className="absolute top-0 right-0 text-xs flex-shrink-0">
                        {condition.unit}
                      </Badge>
                    </div>
                    {(selectedConditionId === condition.id || condition.aiGenerated) && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {selectedConditionId === condition.id && (
                          <Badge variant="default" className="text-xs bg-blue-600" title="Click to deactivate">Active</Badge>
                        )}
                        {condition.aiGenerated && <Bot className="w-3 h-3 text-blue-600 flex-shrink-0" />}
                      </div>
                    )}
                    {condition.searchImage && condition.type === 'auto-count' && (
                      <div className="mt-1.5 bg-indigo-50 border border-indigo-200 rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={(e) => toggleSearchedSymbol(condition.id, e)}
                          className="w-full flex items-center justify-between gap-2 px-2 py-1 text-xs font-medium text-indigo-900 hover:bg-indigo-100/70 transition-colors text-left"
                        >
                          Searched symbol
                          {collapsedSearchedSymbols.has(condition.id) ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronUp className="w-3 h-3 flex-shrink-0" />}
                        </button>
                        {!collapsedSearchedSymbols.has(condition.id) && (
                          <div className="px-2 pb-2 pt-0">
                            <img
                              src={getImageSrc(condition.searchImage)}
                              alt="Searched symbol"
                              className="max-w-full h-auto max-h-14 rounded border border-indigo-300"
                              style={{ imageRendering: 'crisp-edges' }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                  {(condition.type === 'area' || condition.type === 'volume') && onCutoutMode && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCutoutMode(condition);
                      }}
                      className={`h-6 w-6 p-0 ${cutoutMode && cutoutTargetConditionId === condition.id ? 'bg-red-100 text-red-600' : 'text-red-500 hover:text-red-600'}`}
                      title="Add cut-out to existing measurements"
                    >
                      <Scissors className="w-3 h-3" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onDuplicate(condition); }} className="h-6 w-6 p-0">
                    <Copy className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onEdit(condition); }} className="h-6 w-6 p-0">
                    <Edit3 className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onDeleteClick(condition.id); }}
                    className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <p
                className={`text-sm text-muted-foreground mb-1 ${selectedConditionId === condition.id ? '' : 'line-clamp-2'}`}
                title={condition.description || undefined}
              >
                {condition.description}
              </p>
              {(condition.type as string) === 'visual-search' && (
                <>
                  {condition.searchImage ? (
                    <div className="mb-3">
                      <div className="text-xs text-gray-500 mb-1">Search Image:</div>
                      <div className="border border-gray-200 rounded-lg p-2 bg-gray-50 flex items-center justify-center min-h-[80px]">
                        <img
                          src={getImageSrc(condition.searchImage)}
                          alt="Search template"
                          className="max-w-full max-h-32 object-contain rounded"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mb-2 text-xs text-gray-400 italic">No search image set</div>
                  )}
                  {measurements.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs text-gray-500 mb-1">Found Items ({measurements.length}):</div>
                        {isLoadingThumbnails ? (
                          <div className="text-xs text-gray-400 italic">Loading previews...</div>
                        ) : thumbnails.length > 0 ? (
                          <div className="grid grid-cols-3 gap-1">
                            {thumbnails.map((thumb, idx) => (
                              <div
                                key={thumb.measurementId || idx}
                                className="border border-gray-200 rounded p-1 bg-gray-50 aspect-square flex items-center justify-center overflow-hidden"
                              >
                                <img
                                  src={thumb.thumbnail}
                                  alt={`Match ${idx + 1}`}
                                  className="w-full h-full object-contain rounded"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 italic">
                            {measurements.length} match{measurements.length !== 1 ? 'es' : ''} found
                          </div>
                        )}
                      </div>
                  )}
                </>
              )}
              <div className="flex items-center gap-3 text-xs">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: condition.color }} />
                {condition.type !== 'count' && <span>Waste: {condition.wasteFactor}%</span>}
                <div className="font-medium text-blue-600">
                  {formatConditionValue(condition, measurements, selectedDocumentId)}
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
