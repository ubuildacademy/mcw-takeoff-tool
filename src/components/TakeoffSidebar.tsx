import { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Plus,
  Calculator,
  FileText,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileImage,
  DollarSign,
  Edit3,
} from 'lucide-react';
import { toast } from 'sonner';
import { useConditionStore } from '../store/slices/conditionSlice';
import { useMeasurementStore } from '../store/slices/measurementSlice';
import type { TakeoffCondition, PDFDocument } from '../types';
import { CreateConditionDialog } from './CreateConditionDialog';
import { formatFeetAndInches } from '../lib/utils';
import { useTakeoffExport, TakeoffSidebarConditionList } from './takeoff-sidebar';

// TakeoffCondition interface imported from shared types

interface TakeoffSidebarProps {
  projectId: string;
  onConditionSelect: (condition: TakeoffCondition | null) => void;
  onToolSelect: (tool: string) => void;
  documents?: PDFDocument[];
  onPageSelect?: (documentId: string, pageNumber: number) => void;
  onExportStatusUpdate?: (type: 'excel' | 'pdf' | null, progress: number) => void;
  onCutoutMode?: (conditionId: string | null) => void;
  cutoutMode?: boolean;
  cutoutTargetConditionId?: string | null;
  selectedDocumentId?: string | null;
}

export function TakeoffSidebar({ projectId, onConditionSelect, onToolSelect: _onToolSelect, documents = [], onPageSelect, onExportStatusUpdate, onCutoutMode, cutoutMode, cutoutTargetConditionId, selectedDocumentId }: TakeoffSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingCondition, setEditingCondition] = useState<TakeoffCondition | null>(null);
  const [activeTab, setActiveTab] = useState<'conditions' | 'reports' | 'costs'>('conditions');
  const [expandedConditions, setExpandedConditions] = useState<Set<string>>(new Set());
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [matchThumbnails, setMatchThumbnails] = useState<Record<string, Array<{ measurementId: string; thumbnail: string }>>>({});
  const [loadingThumbnails, setLoadingThumbnails] = useState<Set<string>>(new Set());

  const addCondition = useConditionStore((s) => s.addCondition);
  // Narrow selector: only this project's conditions (avoids re-render when other projects' conditions change)
  const conditions = useConditionStore((s) => s.getProjectConditions(projectId));
  const setSelectedCondition = useConditionStore((s) => s.setSelectedCondition);
  const selectedConditionId = useConditionStore((s) => s.selectedConditionId);
  const getConditionTakeoffMeasurements = useMeasurementStore((s) => s.getConditionTakeoffMeasurements);
  const _loadProjectConditions = useConditionStore((s) => s.loadProjectConditions);
  const _getProjectTakeoffMeasurements = useMeasurementStore((s) => s.getProjectTakeoffMeasurements);
  // Narrow selector: summary changes when measurements change; used to trigger thumbnail effect (avoids subscribing to full array)
  const takeoffSummary = useMeasurementStore((s) => s.getProjectTakeoffSummary(projectId));
  const loadingConditions = useConditionStore((s) => s.loadingConditions);
  const refreshProjectConditions = useConditionStore((s) => s.refreshProjectConditions);
  const ensureConditionsLoaded = useConditionStore((s) => s.ensureConditionsLoaded);
  const getProjectCostBreakdown = useMeasurementStore((s) => s.getProjectCostBreakdown);
  const _getConditionCostBreakdown = useMeasurementStore((s) => s.getConditionCostBreakdown);

  const { getQuantityReportData, getCostAnalysisData: _getCostAnalysisData, exportToExcel, exportToPDF } = useTakeoffExport({
    projectId,
    documents,
    onExportStatusUpdate,
  });

  useEffect(() => {
    if (!projectId) return;
    ensureConditionsLoaded(projectId).catch((error) => {
      console.error('Failed to ensure conditions:', error);
    });
  }, [projectId, ensureConditionsLoaded]);

  // Retry loading conditions when auth session becomes available (avoids 401 race on first load)
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    let subscription: { unsubscribe: () => void } | undefined;
    void import('../lib/supabase').then(({ supabase }) => {
      const result = supabase.auth.onAuthStateChange((event, session) => {
        if (cancelled || !session?.access_token) return;
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
          ensureConditionsLoaded(projectId).catch((err) => console.error('Retry conditions load:', err));
        }
      });
      subscription = result.data.subscription;
    });
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [projectId, ensureConditionsLoaded]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showExportDropdown && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowExportDropdown(false);
      }
    };

    if (showExportDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showExportDropdown]);

  const filteredConditions = conditions.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Load match thumbnails for auto-count (visual-search) conditions
  useEffect(() => {
    if (!projectId) return;

    const loadThumbnails = async () => {
      const visualSearchConditions = filteredConditions.filter(
        c => (c.type as string) === 'visual-search' && 
        !loadingThumbnails.has(c.id) &&
        !matchThumbnails[c.id]
      );

      // Load thumbnails for each condition
      for (const condition of visualSearchConditions) {
        const measurements = getConditionTakeoffMeasurements(projectId, condition.id);
        if (measurements.length > 0) {
          console.log(`[TakeoffSidebar] Loading thumbnails for condition ${condition.id} with ${measurements.length} measurements`);
          setLoadingThumbnails(prev => new Set(prev).add(condition.id));
          try {
            const { autoCountService } = await import('../services/visualSearchService');
            const thumbnails = await autoCountService.getMatchThumbnails(condition.id, projectId, 6);
            console.log(`[TakeoffSidebar] Loaded ${thumbnails.length} thumbnails for condition ${condition.id}`, thumbnails);
            setMatchThumbnails(prev => ({
              ...prev,
              [condition.id]: thumbnails
            }));
          } catch (error) {
            console.error(`[TakeoffSidebar] Failed to load thumbnails for condition ${condition.id}:`, error);
          } finally {
            setLoadingThumbnails(prev => {
              const next = new Set(prev);
              next.delete(condition.id);
              return next;
            });
          }
        }
      }
    };

    loadThumbnails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, conditions, searchQuery, takeoffSummary]);


  const toggleConditionExpansion = (conditionId: string) => {
    const newExpanded = new Set(expandedConditions);
    if (newExpanded.has(conditionId)) {
      newExpanded.delete(conditionId);
    } else {
      newExpanded.add(conditionId);
    }
    setExpandedConditions(newExpanded);
  };

  const handlePageClick = (sheetId: string, pageNumber: number, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent expanding/collapsing the condition
    if (onPageSelect) {
      onPageSelect(sheetId, pageNumber);
    }
  };

  const handleConditionClick = (condition: TakeoffCondition) => {
    // If the condition is already selected, deselect it
    if (selectedConditionId === condition.id) {
      setSelectedCondition(null);
      onConditionSelect(null);
      return;
    }
    
    // Otherwise, select the new condition
    onConditionSelect(condition);
    setSelectedCondition(condition.id);
  };



  const handleDeleteCondition = async (conditionId: string) => {
    try {
      // Delete condition via API and update store
      await useConditionStore.getState().deleteCondition(conditionId);
      setShowDeleteConfirm(null);
    } catch (error) {
      console.error('Failed to delete condition:', error);
      // You might want to show an error message to the user here
    }
  };

  const handleDuplicateCondition = (condition: TakeoffCondition) => {
    const { id: _id, ...conditionWithoutId } = condition;
    
    // Generate a random color from a curated palette
    const colors = [
      '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57',
      '#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3', '#ff9f43',
      '#10ac84', '#ee5a24', '#0984e3', '#6c5ce7', '#a29bfe',
      '#fd79a8', '#fdcb6e', '#e17055', '#74b9ff', '#00b894'
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    const newCondition = {
      ...conditionWithoutId,
      projectId,
      name: `${condition.name} (Copy)`,
      color: randomColor
    };
    addCondition(newCondition);
  };

  const handleEditCondition = (condition: TakeoffCondition) => {
    setEditingCondition(condition);
    setShowCreateDialog(true);
  };

  const handleCutoutMode = (condition: TakeoffCondition) => {
    if (onCutoutMode) {
      // If already in cut-out mode for this condition, turn it off
      if (cutoutMode && cutoutTargetConditionId === condition.id) {
        onCutoutMode(null);
      } else {
        // Turn on cut-out mode for this condition
        onCutoutMode(condition.id);
      }
    }
  };

  const handleCloseDialog = () => {
    setShowCreateDialog(false);
    setEditingCondition(null);
  };

  // Helper function to check if condition has measurements
  const _hasMeasurements = (condition: TakeoffCondition): boolean => {
    const measurements = getConditionTakeoffMeasurements(projectId, condition.id);
    return measurements.length > 0;
  };


  if (loadingConditions) {
    return (
      <div className="w-80 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-white border-r flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        {/* Tabs */}
        <div className="flex mb-4">
          <button
            className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'conditions'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('conditions')}
          >
            <div className="flex items-center justify-center gap-1">
              <Calculator className="w-4 h-4" />
              <span className="hidden sm:inline">Conditions</span>
            </div>
          </button>
          <button
            className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'reports'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('reports')}
          >
            <div className="flex items-center justify-center gap-1">
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Reports</span>
            </div>
          </button>
          <button
            className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'costs'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('costs')}
          >
            <div className="flex items-center justify-center gap-1">
              <DollarSign className="w-4 h-4" />
              <span className="hidden sm:inline">Costs</span>
            </div>
          </button>
        </div>

        {/* Tab Content Header */}
        {activeTab === 'conditions' && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Takeoff Conditions</h2>
            <Button size="sm" variant="outline" onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Quantity Reports</h2>
            <div className="relative">
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => setShowExportDropdown(!showExportDropdown)}
              >
                <Download className="w-4 h-4 mr-1" />
                Export
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
              
              {showExportDropdown && (
                <div ref={dropdownRef} className="absolute right-0 top-full mt-1 w-48 bg-white border rounded-lg shadow-lg z-50">
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        await exportToExcel();
                        setShowExportDropdown(false);
                      } catch (error) {
                        console.error('Excel export error:', error);
                        toast.error('Error exporting Excel file. Please try again.');
                      }
                    }}
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    Export Excel Report
                  </button>
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        await exportToPDF();
                        setShowExportDropdown(false);
                      } catch (error) {
                        console.error('PDF export error:', error);
                        toast.error('Error exporting PDF file. Please try again.');
                      }
                    }}
                  >
                    <FileImage className="w-4 h-4" />
                    Export PDF Report
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'conditions' && (
          <TakeoffSidebarConditionList
            conditions={filteredConditions}
            searchQuery={searchQuery}
            onSearchChange={(value) => setSearchQuery(value)}
            selectedConditionId={selectedConditionId}
            projectId={projectId}
            selectedDocumentId={selectedDocumentId}
            matchThumbnails={matchThumbnails}
            loadingThumbnails={loadingThumbnails}
            getConditionTakeoffMeasurements={getConditionTakeoffMeasurements}
            cutoutMode={cutoutMode}
            cutoutTargetConditionId={cutoutTargetConditionId}
            onConditionClick={handleConditionClick}
            onCutoutMode={handleCutoutMode}
            onDuplicate={handleDuplicateCondition}
            onEdit={handleEditCondition}
            onDeleteClick={setShowDeleteConfirm}
            onAddCondition={() => setShowCreateDialog(true)}
          />
        )}

        {activeTab === 'reports' && (
          <div className="p-4">
            {(() => {
              const { reportData } = getQuantityReportData();
              const conditionIds = Object.keys(reportData);
              const costBreakdown = getProjectCostBreakdown(projectId);
              
              if (conditionIds.length === 0) {
                return (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No quantity data yet</p>
                    <p className="text-sm">Create conditions and add measurements to see reports</p>
                  </div>
                );
              }

              return (
                <div className="space-y-4">
                  {/* Cost Summary Section */}
                  {costBreakdown.summary.totalCost > 0 && (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-lg p-4 border border-blue-200">
                      <h3 className="text-lg font-semibold text-slate-900 mb-3">Project Cost Summary</h3>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-600">Total Cost:</span>
                          <span className="font-semibold text-blue-600">${costBreakdown.summary.totalCost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Profit Margin:</span>
                          <span className="font-semibold text-green-600">{costBreakdown.summary.profitMarginPercent}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Subtotal:</span>
                          <span className="font-medium">${costBreakdown.summary.subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600">Conditions with Costs:</span>
                          <span className="font-medium">{costBreakdown.summary.conditionsWithCosts}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Quantity Reports */}
                  <div className="space-y-3">
                    {conditionIds.map(conditionId => {
                    const conditionData = reportData[conditionId];
                    const isExpanded = expandedConditions.has(conditionId);
                    const pageCount = Object.keys(conditionData.pages).length;
                    
                    return (
                      <div key={conditionId} className="border rounded-lg">
                        {/* Condition Row */}
                        <div 
                          className="p-3 hover:bg-gray-50 cursor-pointer"
                          onClick={() => toggleConditionExpansion(conditionId)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-gray-500" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-gray-500" />
                              )}
                              <div 
                                className="w-4 h-4 rounded-full" 
                                style={{ backgroundColor: conditionData.condition.color }}
                              />
                              <div>
                                <div className="font-medium text-sm">
                                  {conditionData.condition.name}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {pageCount} page{pageCount !== 1 ? 's' : ''} • {conditionData.condition.type} • {conditionData.condition.unit}
                                </div>
                              </div>
                            </div>
                            
                            <div className="text-right">
                              <div className="font-semibold text-sm">
                                {conditionData.condition.unit === 'ft' || conditionData.condition.unit === 'feet' 
                                  ? formatFeetAndInches(conditionData.grandTotal)
                                  : `${conditionData.grandTotal.toFixed(0)} ${conditionData.condition.unit}`
                                }
                              </div>
                              <div className="text-xs text-gray-500">
                                Total
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Expanded Measurements */}
                        {isExpanded && (
                          <div className="border-t bg-gray-50 p-3 space-y-3">
                            {Object.values(conditionData.pages).map(pageData => (
                              <div key={`${pageData.pageNumber}-${pageData.sheetName}`} className="bg-white rounded p-2">
                                <div className="flex justify-between items-center mb-2">
                                  <button
                                    className="font-medium text-sm text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-left"
                                    onClick={(e) => handlePageClick(pageData.sheetId, pageData.pageNumber, e)}
                                    title={`Go to ${pageData.sheetName}`}
                                  >
                                    {pageData.sheetName}
                                  </button>
                                  <div className="text-sm font-semibold">
                                    {conditionData.condition.unit === 'ft' || conditionData.condition.unit === 'feet' 
                                      ? formatFeetAndInches(pageData.total)
                                      : `${pageData.total.toFixed(2)} ${conditionData.condition.unit}`
                                    }
                                  </div>
                                </div>
                                
                                <div className="text-xs text-gray-500">
                                  {pageData.measurements.length} measurement{pageData.measurements.length !== 1 ? 's' : ''}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'costs' && (
          <div className="p-4">
            {(() => {
              const costBreakdown = getProjectCostBreakdown(projectId);
              const { conditions: costConditions, summary } = costBreakdown;
              
              if (costConditions.length === 0) {
                return (
                  <div className="text-center py-8 text-muted-foreground">
                    <DollarSign className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No cost data yet</p>
                    <p className="text-sm">Create conditions with cost information to see cost analysis</p>
                  </div>
                );
              }

              return (
                <div className="space-y-4">
                  {/* Project Cost Summary */}
                  <div className="bg-gradient-to-br from-purple-50 to-pink-100 rounded-lg p-4 border border-purple-200">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-semibold text-slate-900">Project Cost Summary</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // Open profit margin dialog
                          const event = new CustomEvent('openProjectSettings');
                          window.dispatchEvent(event);
                        }}
                        className="flex items-center gap-1 text-xs"
                      >
                        <Edit3 className="w-3 h-3" />
                        Profit Margin
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Material Costs</span>
                        <span className="text-sm font-medium text-slate-900">${summary.totalMaterialCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Equipment Costs</span>
                        <span className="text-sm font-medium text-slate-900">${summary.totalEquipmentCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Waste Factor Costs</span>
                        <span className="text-sm font-medium text-slate-900">${summary.totalWasteCost.toFixed(2)}</span>
                      </div>
                      <div className="border-t border-slate-200 pt-2">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-slate-900">Subtotal</span>
                          <span className="font-semibold text-slate-900">${summary.subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-slate-600">Profit Margin ({summary.profitMarginPercent}%)</span>
                          <span className="text-sm text-green-600 font-medium">${summary.profitMarginAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                          <span className="text-lg font-bold text-slate-900">Total Cost</span>
                          <span className="text-lg font-bold text-blue-600">${summary.totalCost.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>


                  {/* Condition Cost Breakdown */}
                  <div className="space-y-3">
                    <h4 className="font-semibold text-slate-900">Cost Breakdown by Condition</h4>
                    {costConditions.filter(c => c.hasCosts).length === 0 ? (
                      <div className="text-center py-6 text-slate-500 bg-slate-50 rounded-lg">
                        <DollarSign className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No conditions with cost data</p>
                        <p className="text-xs">Add material or equipment costs to conditions to see breakdown</p>
                      </div>
                    ) : (
                      costConditions.map(condition => {
                        if (!condition.hasCosts) return null;
                        
                        return (
                        <div key={condition.condition.id} className="border rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div 
                                className="w-5 h-5 rounded-full border-2 border-white shadow-sm" 
                                style={{ backgroundColor: condition.condition.color }}
                              />
                              <div>
                                <span className="font-medium text-sm text-slate-900">{condition.condition.name}</span>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant="outline" className="text-xs">
                                    {condition.condition.type}
                                  </Badge>
                                  <Badge variant="secondary" className="text-xs">
                                    {condition.condition.unit}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-lg text-blue-600">
                                ${condition.subtotal.toFixed(2)}
                              </span>
                              <div className="text-xs text-slate-500">
                                ${condition.quantity > 0 ? (condition.subtotal / condition.quantity).toFixed(2) : '0.00'}/unit
                              </div>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-slate-600">Quantity</span>
                              <div className="text-right">
                                <span className="font-medium">{condition.quantity.toFixed(2)} {condition.condition.unit}</span>
                                {condition.condition.wasteFactor > 0 && (
                                  <div className="text-xs text-slate-500">
                                    + {condition.condition.wasteFactor}% waste = {condition.adjustedQuantity.toFixed(2)} {condition.condition.unit}
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-slate-600">Material</span>
                                <span className="font-medium text-blue-600">${condition.materialCost.toFixed(2)}</span>
                              </div>
                              {condition.equipmentCost > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-slate-600">Equipment</span>
                                  <span className="font-medium text-green-600">${condition.equipmentCost.toFixed(2)}</span>
                                </div>
                              )}
                              {condition.wasteCost > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-slate-600">Waste</span>
                                  <span className="font-medium text-orange-600">${condition.wasteCost.toFixed(2)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-2">Delete Condition</h3>
            <p className="text-muted-foreground mb-4">
              Are you sure you want to delete this condition? This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDeleteCondition(showDeleteConfirm)}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Condition Dialog */}
      {showCreateDialog && (
        <CreateConditionDialog
          projectId={projectId}
          onClose={handleCloseDialog}
          onConditionCreated={(_condition) => {
            refreshProjectConditions(projectId); // Force refresh conditions from API
            handleCloseDialog();
          }}
          onConditionSelect={onConditionSelect} // Pass condition select handler for auto-selection
          editingCondition={editingCondition}
        />
      )}


    </div>
  );
}
