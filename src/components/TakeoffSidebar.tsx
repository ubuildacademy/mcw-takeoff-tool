import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { 
  Plus, 
  Calculator, 
  Ruler, 
  Square, 
  Circle, 
  Hash,
  Package,
  Trash2,
  Edit3,
  Copy
} from 'lucide-react';
import { useTakeoffStore } from '../store/useTakeoffStore';
import type { TakeoffCondition } from '../types';
import { CreateConditionDialog } from './CreateConditionDialog';
import { formatFeetAndInches } from '../lib/utils';
import { loadConditions } from '../utils/measurementStorage';

// TakeoffCondition interface imported from shared types

interface TakeoffSidebarProps {
  projectId: string;
  onConditionSelect: (condition: TakeoffCondition | null) => void;
  onToolSelect: (tool: string) => void;
}

export function TakeoffSidebar({ projectId, onConditionSelect, onToolSelect }: TakeoffSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { addCondition, conditions, setSelectedCondition, selectedConditionId, getConditionTakeoffMeasurements, setConditions } = useTakeoffStore();

  // Function to reload conditions from localStorage
  const reloadConditions = () => {
    const loadedConditions = loadConditions(projectId);
    console.log('🔄 RELOAD_CONDITIONS: Loading conditions from localStorage', {
      projectId,
      conditionsCount: loadedConditions.length,
      conditions: loadedConditions.map(c => ({ id: c.id, name: c.name }))
    });
    setConditions(loadedConditions);
  };

  useEffect(() => {
    // Load conditions from localStorage when component mounts or projectId changes
    reloadConditions();
    setLoading(false);
  }, [projectId]);

  const filteredConditions = conditions.filter(condition =>
    condition.projectId === projectId && (
      condition.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      condition.description.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  const handleConditionClick = (condition: TakeoffCondition) => {
    console.log('Condition clicked:', condition);
    
    // If the condition is already selected, deselect it
    if (selectedConditionId === condition.id) {
      console.log('Deselecting condition:', condition.id);
      setSelectedCondition(null);
      onConditionSelect(null);
      return;
    }
    
    // Otherwise, select the new condition
    console.log('Selecting condition:', condition.id);
    onConditionSelect(condition);
    setSelectedCondition(condition.id);
    console.log('Selected condition set to:', condition.id);
    console.log('Current selected condition ID:', useTakeoffStore.getState().selectedConditionId);
  };



  const handleDeleteCondition = (conditionId: string) => {
    // Remove condition from store
    useTakeoffStore.getState().deleteCondition(conditionId);
    setShowDeleteConfirm(null);
  };

  const handleDuplicateCondition = (condition: TakeoffCondition) => {
    const { id, ...conditionWithoutId } = condition;
    
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
    // Edit functionality - could be implemented with a dialog in the future
    console.log('Edit condition:', condition);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'area': return <Square className="w-4 h-4" />;
      case 'volume': return <Package className="w-4 h-4" />;
      case 'linear': return <Ruler className="w-4 h-4" />;
      case 'count': return <Hash className="w-4 h-4" />;
      default: return <Calculator className="w-4 h-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'area': return 'bg-blue-100 text-blue-800';
      case 'volume': return 'bg-green-100 text-green-800';
      case 'linear': return 'bg-purple-100 text-purple-800';
      case 'count': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Takeoff Conditions</h2>
          <Button size="sm" variant="outline" onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        
        <Input
          placeholder="Search conditions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="mb-4"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-3">
          {filteredConditions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Calculator className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No takeoff conditions yet</p>
              <p className="text-sm">Click the + button to create your first condition</p>
            </div>
          ) : (
            filteredConditions.map((condition) => (
              <div
                key={condition.id}
                className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                  selectedConditionId === condition.id 
                    ? 'border-blue-500 bg-blue-50 shadow-sm' 
                    : 'border-gray-200 hover:bg-accent/50'
                }`}
                onClick={() => handleConditionClick(condition)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {getTypeIcon(condition.type)}
                    <span className="font-medium truncate">{condition.name}</span>
                    <Badge variant="outline" className="text-xs flex-shrink-0">
                      {condition.unit}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicateCondition(condition);
                      }}
                      className="h-6 w-6 p-0"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditCondition(condition);
                      }}
                      className="h-6 w-6 p-0"
                    >
                      <Edit3 className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDeleteConfirm(condition.id);
                      }}
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                
                {/* Active indicator - moved below to save horizontal space */}
                {selectedConditionId === condition.id && (
                  <div className="mb-2">
                    <Badge variant="default" className="text-xs bg-blue-600">
                      Active
                    </Badge>
                    <div className="text-xs text-blue-600 mt-1 font-medium">
                      Click to deactivate
                    </div>
                  </div>
                )}
                
                <p className="text-sm text-muted-foreground mb-2">
                  {condition.description}
                </p>
                
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: condition.color }}
                    />
                    <span>Color</span>
                  </div>
                  <span>Waste: {condition.wasteFactor}%</span>
                  <div className="font-medium text-blue-600">
                    {(() => {
                      console.log('Getting measurements for condition:', { projectId, conditionId: condition.id });
                      const measurements = getConditionTakeoffMeasurements(projectId, condition.id);
                      const totalValue = measurements.reduce((sum, m) => sum + m.calculatedValue, 0);
                      const totalPerimeter = measurements.reduce((sum, m) => sum + (m.perimeterValue || 0), 0);
                      console.log('Condition measurements:', { conditionId: condition.id, measurements, totalValue, totalPerimeter });
                      
                      if (totalValue > 0) {
                        // For linear measurements (feet), use feet and inches format
                        if (condition.unit === 'ft' || condition.unit === 'feet') {
                          return formatFeetAndInches(totalValue);
                        }
                        // For area measurements, show area and perimeter separately if perimeter exists
                        if (condition.unit === 'SF' || condition.unit === 'sq ft') {
                          return (
                            <div className="space-y-1">
                              <div>{totalValue.toFixed(0)} SF</div>
                              {totalPerimeter > 0 && (
                                <div className="text-xs text-gray-500">
                                  {formatFeetAndInches(totalPerimeter)} LF
                                </div>
                              )}
                            </div>
                          );
                        }
                        // For other units, keep the original format
                        return `${totalValue.toFixed(2)} ${condition.unit}`;
                      }
                      return '0';
                    })()}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
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

      {/* Create Condition Dialog */}
      {showCreateDialog && (
        <CreateConditionDialog
          projectId={projectId}
          onClose={() => setShowCreateDialog(false)}
          onConditionCreated={(newCondition) => {
            console.log('✅ CONDITION_CREATED: New condition created, reloading conditions', newCondition);
            reloadConditions(); // Reload conditions from localStorage
            setShowCreateDialog(false);
          }}
        />
      )}


    </div>
  );
}
