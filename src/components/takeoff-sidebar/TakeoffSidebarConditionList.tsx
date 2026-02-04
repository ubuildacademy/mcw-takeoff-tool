/**
 * Renders the list of takeoff conditions (search + condition cards) for the Conditions tab.
 */
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
} from 'lucide-react';
import type { TakeoffCondition } from '../../types';
import { formatFeetAndInches } from '../../lib/utils';

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
        className="mb-4"
      />
      <div className="p-4 space-y-3">
        {conditions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Calculator className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No takeoff conditions yet</p>
            <p className="text-sm">{onAddCondition ? 'Click the + button to create your first condition' : 'Create your first condition from the header.'}</p>
          </div>
        ) : (
          conditions.map((condition) => (
            <div
              key={condition.id}
              className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                selectedConditionId === condition.id
                  ? 'border-blue-500 bg-blue-50 shadow-sm'
                  : (condition as TakeoffCondition & { aiGenerated?: boolean }).aiGenerated
                    ? 'border-blue-400 bg-blue-100/50 hover:bg-blue-100/70 shadow-sm'
                    : 'border-gray-200 hover:bg-accent/50'
              }`}
              onClick={() => onConditionClick(condition)}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  {getTypeIcon(condition.type)}
                  <div className="min-w-0 flex-1">
                    <span className="font-medium break-words">{condition.name}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs flex-shrink-0">
                        {condition.unit}
                      </Badge>
                      {(condition as TakeoffCondition & { aiGenerated?: boolean }).aiGenerated && (
                        <div className="flex items-center gap-1">
                          <Bot className="w-4 h-4 text-blue-600" />
                        </div>
                      )}
                    </div>
                    {(condition as TakeoffCondition & { searchImage?: string }).searchImage && condition.type === 'auto-count' && (() => {
                      const img = (condition as TakeoffCondition & { searchImage?: string }).searchImage ?? '';
                      return (
                      <div className="mt-2 p-2 bg-indigo-50 border border-indigo-200 rounded-lg">
                        <div className="text-xs font-medium text-indigo-900 mb-1">Searched Symbol:</div>
                        <img
                          src={
                            img.startsWith('data:') || img.startsWith('http')
                              ? img
                              : `data:image/png;base64,${img}`
                          }
                          alt="Searched symbol"
                          className="max-w-full h-auto max-h-24 rounded border border-indigo-300"
                          style={{ imageRendering: 'crisp-edges' }}
                        />
                      </div>
                    ); })()}
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
              {selectedConditionId === condition.id && (
                <div className="mb-2">
                  <Badge variant="default" className="text-xs bg-blue-600">Active</Badge>
                  <div className="text-xs text-blue-600 mt-1 font-medium">Click to deactivate</div>
                </div>
              )}
              <p className="text-sm text-muted-foreground mb-2">{condition.description}</p>
              {(condition.type as string) === 'visual-search' && (
                <>
                  {(condition as TakeoffCondition & { searchImage?: string }).searchImage
                    ? (() => {
                        const img = (condition as TakeoffCondition & { searchImage?: string }).searchImage ?? '';
                        return (
                          <div className="mb-3">
                            <div className="text-xs text-gray-500 mb-1">Search Image:</div>
                            <div className="border border-gray-200 rounded-lg p-2 bg-gray-50 flex items-center justify-center min-h-[80px]">
                              <img
                                src={
                                  img.startsWith('data:') || img.startsWith('http')
                                    ? img
                                    : `data:image/png;base64,${img}`
                                }
                                alt="Search template"
                                className="max-w-full max-h-32 object-contain rounded"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            </div>
                          </div>
                        );
                      })()
                    : (
                    <div className="mb-2 text-xs text-gray-400 italic">No search image set</div>
                  )}
                  {(() => {
                    const measurements = getConditionTakeoffMeasurements(projectId, condition.id);
                    const hasMatches = measurements.length > 0;
                    const thumbnails = matchThumbnails[condition.id] || [];
                    const isLoading = loadingThumbnails.has(condition.id);
                    if (!hasMatches) return null;
                    return (
                      <div className="mb-3">
                        <div className="text-xs text-gray-500 mb-1">Found Items ({measurements.length}):</div>
                        {isLoading ? (
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
                    );
                  })()}
                </>
              )}
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: condition.color }} />
                  <span>Color</span>
                </div>
                {condition.type !== 'count' && <span>Waste: {condition.wasteFactor}%</span>}
                <div className="font-medium text-blue-600">
                  {(() => {
                    const measurements = getConditionTakeoffMeasurements(projectId, condition.id);
                    const currentDocumentMeasurements = selectedDocumentId
                      ? measurements.filter((m) => m.sheetId === selectedDocumentId)
                      : measurements;
                    const totalValue = currentDocumentMeasurements.reduce((sum, m) => {
                      const value = m.netCalculatedValue !== undefined && m.netCalculatedValue !== null ? m.netCalculatedValue : m.calculatedValue;
                      return sum + (value || 0);
                    }, 0);
                    const totalPerimeter = currentDocumentMeasurements.reduce((sum, m) => sum + (m.perimeterValue || 0), 0);
                    const totalAreaValue = currentDocumentMeasurements.reduce((sum, m) => sum + (m.areaValue || 0), 0);
                    const cond = condition as TakeoffCondition & { includeHeight?: boolean; height?: number; unit?: string };
                    if (totalValue > 0) {
                      if (cond.type === 'linear' && cond.includeHeight && cond.height && totalAreaValue > 0) {
                        return (
                          <div className="space-y-1">
                            <div>{formatFeetAndInches(totalValue)} LF</div>
                            <div className="text-xs text-gray-500">{totalAreaValue.toFixed(0)} SF</div>
                          </div>
                        );
                      }
                      if (cond.unit === 'ft' || cond.unit === 'feet' || (cond.type === 'linear' && (cond.unit === 'LF' || cond.unit === 'lf'))) {
                        return formatFeetAndInches(totalValue);
                      }
                      if (cond.unit === 'SF' || cond.unit === 'sq ft') {
                        return (
                          <div className="space-y-1">
                            <div>{totalValue.toFixed(0)} SF</div>
                            {totalPerimeter > 0 && (
                              <div className="text-xs text-gray-500">{formatFeetAndInches(totalPerimeter)} LF</div>
                            )}
                          </div>
                        );
                      }
                      return `${totalValue.toFixed(2)} ${cond.unit}`;
                    }
                    return '0';
                  })()}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
