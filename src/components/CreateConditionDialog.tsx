import { useState, useEffect, useMemo } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { X } from 'lucide-react';
import { useConditionStore } from '../store/slices/conditionSlice';
import type { TakeoffCondition } from '../types';
import { generateDistinctColor, getDefaultUnit, parseDepthInput, formatDepthOutput } from '../utils/commonUtils';

interface CreateConditionDialogProps {
  projectId: string;
  onClose: () => void;
  onConditionCreated: (condition: TakeoffCondition) => void;
  onConditionSelect?: (condition: TakeoffCondition) => void;
  editingCondition?: TakeoffCondition | null;
}

export function CreateConditionDialog({ projectId, onClose, onConditionCreated, onConditionSelect, editingCondition }: CreateConditionDialogProps) {
  const addCondition = useConditionStore((s) => s.addCondition);
  const updateCondition = useConditionStore((s) => s.updateCondition);
  const conditions = useConditionStore((s) => s.conditions);

  const existingColors = useMemo(() => {
    return conditions
      .filter((c: { projectId: string; color?: string }) => c.projectId === projectId)
      .map((c: { color?: string }) => c.color)
      .filter(Boolean);
  }, [conditions, projectId]);

  const [formData, setFormData] = useState({
    name: editingCondition?.name || '',
    type: (editingCondition?.type || 'area') as 'area' | 'volume' | 'linear' | 'count' | 'auto-count',
    unit: editingCondition?.unit || 'SF', // Initialize with default unit for 'area' type
    wasteFactor: editingCondition?.wasteFactor?.toString() || '',
    color: editingCondition?.color || generateDistinctColor(conditions.filter((c: { projectId: string; color?: string }) => c.projectId === projectId).map((c: { color?: string }) => c.color).filter((color): color is string => typeof color === 'string')),
    description: editingCondition?.description || '',
    materialCost: editingCondition?.materialCost != null ? editingCondition.materialCost.toString() : '',
    equipmentCost: editingCondition?.equipmentCost != null ? editingCondition.equipmentCost.toString() : '',
    includePerimeter: editingCondition?.includePerimeter || false,
    depth: editingCondition?.depth ? formatDepthOutput(editingCondition.depth) : '',
    includeHeight: editingCondition?.includeHeight || false,
    height: editingCondition?.height ? formatDepthOutput(editingCondition.height) : '',
    // Auto-count specific fields
    searchImage: editingCondition?.searchImage || '',
    searchImageId: editingCondition?.searchImageId || '',
    searchThreshold: editingCondition?.searchThreshold?.toString() || '0.7',
    searchScope: editingCondition?.searchScope || 'current-page' as 'current-page' | 'entire-document' | 'entire-project'
  });
  const [loading, setLoading] = useState(false);
  const [depthError, setDepthError] = useState<string>('');
  const [heightError, setHeightError] = useState<string>('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);


  // Ensure unit is set when component mounts
  useEffect(() => {
    if (!formData.unit) {
      const defaultUnit = getDefaultUnit(formData.type);
      setFormData(prev => ({ ...prev, unit: defaultUnit }));
    }
  }, []);

  // Auto-switch unit when includeHeight changes for linear conditions
  useEffect(() => {
    if (formData.type === 'linear') {
      if (formData.includeHeight) {
        // Switch to SF when height is enabled (if not already an area unit)
        if (formData.unit !== 'SF' && formData.unit !== 'SY' && formData.unit !== 'SM') {
          setFormData(prev => ({ ...prev, unit: 'SF' }));
        }
      } else {
        // Switch back to LF when height is disabled (if currently an area unit)
        if (formData.unit === 'SF' || formData.unit === 'SY' || formData.unit === 'SM') {
          setFormData(prev => ({ ...prev, unit: 'LF' }));
        }
      }
    }
  }, [formData.includeHeight, formData.type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Ensure unit is set - use formData.unit or fall back to default for the type
      const unit = formData.unit || getDefaultUnit(formData.type);
      
      // Parse depth value (supports both decimal feet and feet/inches format)
      // Depth is required for volume conditions
      let parsedDepth: number | null | undefined;
      if (formData.type === 'volume') {
        if (!formData.depth || formData.depth.trim() === '') {
          setDepthError('Depth is required for volume conditions');
          setLoading(false);
          return;
        }
        parsedDepth = parseDepthInput(formData.depth);
        if (parsedDepth === null) {
          setDepthError('Invalid depth format. Use decimal feet (e.g., 1.5) or feet/inches (e.g., 1\'6")');
          setLoading(false);
          return;
        }
        if (parsedDepth <= 0) {
          setDepthError('Depth must be greater than 0');
          setLoading(false);
          return;
        }
      } else if (formData.depth && formData.depth.trim() !== '') {
        parsedDepth = parseDepthInput(formData.depth);
        if (parsedDepth === null) {
          setDepthError('Invalid depth format. Use decimal feet (e.g., 1.5) or feet/inches (e.g., 1\'6")');
          setLoading(false);
          return;
        }
      }

      // Parse height value (supports both decimal feet and feet/inches format)
      // Height is required when includeHeight is checked for linear conditions
      let parsedHeight: number | null | undefined;
      if (formData.type === 'linear' && formData.includeHeight) {
        if (!formData.height || formData.height.trim() === '') {
          setHeightError('Height is required when height calculation is enabled');
          setLoading(false);
          return;
        }
        parsedHeight = parseDepthInput(formData.height);
        if (parsedHeight === null) {
          setHeightError('Invalid height format. Use decimal feet (e.g., 1.5) or feet/inches (e.g., 1\'6")');
          setLoading(false);
          return;
        }
        if (parsedHeight <= 0) {
          setHeightError('Height must be greater than 0');
          setLoading(false);
          return;
        }
      } else if (formData.height && formData.height.trim() !== '') {
        parsedHeight = parseDepthInput(formData.height);
        if (parsedHeight === null) {
          setHeightError('Invalid height format. Use decimal feet (e.g., 1.5) or feet/inches (e.g., 1\'6")');
          setLoading(false);
          return;
        }
      }

      const conditionData = {
        projectId,
        name: formData.name,
        type: formData.type,
        unit: unit,
        wasteFactor: formData.wasteFactor ? parseFloat(formData.wasteFactor) : 0,
        color: formData.color,
        description: formData.description,
        materialCost: formData.materialCost && formData.materialCost.trim() !== '' ? parseFloat(formData.materialCost) : undefined,
        // Always send equipmentCost, even if 0 or empty, to ensure it persists
        equipmentCost: formData.equipmentCost !== '' && formData.equipmentCost !== null && formData.equipmentCost !== undefined 
          ? (formData.equipmentCost.trim() !== '' ? parseFloat(formData.equipmentCost) : 0)
          : 0,
        includePerimeter: formData.includePerimeter,
        depth: parsedDepth === null || parsedDepth === undefined ? undefined : parsedDepth,
        includeHeight: formData.includeHeight,
        height: parsedHeight === null || parsedHeight === undefined ? undefined : parsedHeight,
        // Auto-count specific fields
        ...(formData.type === 'auto-count' && {
          searchImage: formData.searchImage,
          searchImageId: formData.searchImageId,
          searchThreshold: formData.searchThreshold ? parseFloat(formData.searchThreshold) : 0.7,
          searchScope: formData.searchScope || 'current-page'
        })
      };
      
      let result: TakeoffCondition;
      let createdCondition: TakeoffCondition | null = null;
      
      if (editingCondition) {
        await updateCondition(editingCondition.id, conditionData);
        result = editingCondition;
      } else {
        const conditionId = await addCondition(conditionData);
        const store = useConditionStore.getState();
        createdCondition = store.conditions.find((c): c is TakeoffCondition => c.id === conditionId) ?? null;
        result = createdCondition ?? { id: conditionId, ...conditionData } as TakeoffCondition;
      }
      
      // Call the callback with the result
      onConditionCreated(result);
      
      // Auto-select auto-count conditions after creation to enable selection mode
      if (!editingCondition && createdCondition && createdCondition.type === 'auto-count' && onConditionSelect) {
        // Small delay to ensure condition is fully created and UI is updated
        setTimeout(() => {
          onConditionSelect(createdCondition);
        }, 100);
      }
      
    } catch (error) {
      console.error('Error saving condition:', error);
      alert(`Failed to ${editingCondition ? 'update' : 'create'} condition. Please try again.`);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string | number | boolean) => {
    setFormData(prev => {
      const newData = { ...prev, [field]: value };
      
      // Auto-switch unit to SF when includeHeight is checked for linear conditions
      if (field === 'includeHeight' && value === true && prev.type === 'linear') {
        newData.unit = 'SF';
      }
      // Reset unit to LF and clear height when includeHeight is unchecked for linear conditions
      if (field === 'includeHeight' && value === false && prev.type === 'linear') {
        newData.unit = 'LF';
        newData.height = '';
      }
      
      return newData;
    });
    
    // Clear depth error when user starts typing
    if (field === 'depth' && depthError) {
      setDepthError('');
    }
    
    // Clear height error when user starts typing
    if (field === 'height' && heightError) {
      setHeightError('');
    }
  };

  const handleTypeChange = (value: string) => {
    const defaultUnit = getDefaultUnit(value);
    setFormData(prev => {
      const newData = { 
        ...prev, 
        type: value as 'area' | 'volume' | 'linear' | 'count',
        unit: defaultUnit,
        // Set waste factor to 0 for count conditions since they don't have waste
        wasteFactor: value === 'count' ? '0' : prev.wasteFactor,
        // Reset height-related fields when type changes
        includeHeight: false,
        height: ''
      };
      return newData;
    });
  };

  const getDefaultUnit = (type: string) => {
    switch (type) {
      case 'area': return 'SF';
      case 'volume': return 'CY';
      case 'linear': return 'LF';
      case 'count': return 'EA';
      case 'auto-count': return 'EA';
      default: return '';
    }
  };

  return (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg max-w-md mx-4 w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{editingCondition ? 'Edit Condition' : 'Create New Condition'}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
                              placeholder="e.g., Foundation Wall"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="type">Type *</Label>
              <Select value={formData.type} onValueChange={handleTypeChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="area">Area</SelectItem>
                  <SelectItem value="volume">Volume</SelectItem>
                  <SelectItem value="linear">Linear</SelectItem>
                  <SelectItem value="count">Count</SelectItem>
                  <SelectItem value="auto-count">Auto-Count</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="unit">Unit *</Label>
              <Select value={formData.unit || getDefaultUnit(formData.type)} onValueChange={(value) => {
                handleInputChange('unit', value);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select unit" />
                </SelectTrigger>
                <SelectContent>
                  {formData.type === 'area' && (
                    <>
                      <SelectItem value="SF">SF (Square Feet)</SelectItem>
                      <SelectItem value="SY">SY (Square Yards)</SelectItem>
                      <SelectItem value="SM">SM (Square Meters)</SelectItem>
                    </>
                  )}
                  {formData.type === 'linear' && (
                    <>
                      {formData.includeHeight ? (
                        <>
                          <SelectItem value="SF">SF (Square Feet)</SelectItem>
                          <SelectItem value="SY">SY (Square Yards)</SelectItem>
                          <SelectItem value="SM">SM (Square Meters)</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="LF">LF (Linear Feet)</SelectItem>
                          <SelectItem value="LY">LY (Linear Yards)</SelectItem>
                          <SelectItem value="LM">LM (Linear Meters)</SelectItem>
                        </>
                      )}
                    </>
                  )}
                  {formData.type === 'volume' && (
                    <>
                      <SelectItem value="CY">CY (Cubic Yards)</SelectItem>
                      <SelectItem value="CF">CF (Cubic Feet)</SelectItem>
                      <SelectItem value="CM">CM (Cubic Meters)</SelectItem>
                    </>
                  )}
                  {formData.type === 'count' && (
                    <>
                      <SelectItem value="EA">EA (Each)</SelectItem>
                      <SelectItem value="PC">PC (Piece)</SelectItem>
                      <SelectItem value="LS">LS (Lump Sum)</SelectItem>
                    </>
                  )}
                  {formData.type === 'auto-count' && (
                    <>
                      <SelectItem value="EA">EA (Each)</SelectItem>
                      <SelectItem value="PC">PC (Piece)</SelectItem>
                      <SelectItem value="LS">LS (Lump Sum)</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {(formData.type === 'area' || formData.type === 'volume') && (
            <div>
              <Label htmlFor="includePerimeter" className="flex items-center space-x-2">
                <input
                  id="includePerimeter"
                  type="checkbox"
                  checked={formData.includePerimeter}
                  onChange={(e) => handleInputChange('includePerimeter', e.target.checked)}
                  className="rounded"
                />
                <span>Include perimeter measurement (LF)</span>
              </Label>
            </div>
          )}

          {formData.type === 'linear' && (
            <div>
              <Label htmlFor="includeHeight" className="flex items-center space-x-2">
                <input
                  id="includeHeight"
                  type="checkbox"
                  checked={formData.includeHeight}
                  onChange={(e) => handleInputChange('includeHeight', e.target.checked)}
                  className="rounded"
                />
                <span>Include height for area calculation (SF)</span>
              </Label>
            </div>
          )}

          {formData.type === 'volume' && (
            <div>
              <Label htmlFor="depth">Depth</Label>
              <Input
                id="depth"
                type="text"
                value={formData.depth}
                onChange={(e) => handleInputChange('depth', e.target.value)}
                placeholder="e.g., 1.5 or 1'6&quot;"
                className={depthError ? 'border-red-500' : ''}
              />
              {depthError && (
                <p className="text-sm text-red-500 mt-1">{depthError}</p>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Enter depth as decimal feet (1.5) or feet/inches (1'6&quot;)
              </p>
            </div>
          )}

          {formData.type === 'linear' && formData.includeHeight && (
            <div>
              <Label htmlFor="height">Height</Label>
              <Input
                id="height"
                type="text"
                value={formData.height}
                onChange={(e) => handleInputChange('height', e.target.value)}
                placeholder="e.g., 1.5 or 1'6&quot;"
                className={heightError ? 'border-red-500' : ''}
              />
              {heightError && (
                <p className="text-sm text-red-500 mt-1">{heightError}</p>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Enter height as decimal feet (1.5) or feet/inches (1'6&quot;)
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {formData.type !== 'count' && (
              <div>
                <Label htmlFor="wasteFactor">Waste Factor (%)</Label>
                <Input
                  id="wasteFactor"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={formData.wasteFactor}
                  onChange={(e) => handleInputChange('wasteFactor', e.target.value)}
                  placeholder="0"
                />
              </div>
            )}

            <div className={formData.type === 'count' ? 'col-span-2' : ''}>
              <Label htmlFor="color">Color</Label>
              <Input
                id="color"
                type="color"
                value={formData.color}
                onChange={(e) => handleInputChange('color', e.target.value)}
                className="h-10"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="Describe the condition..."
              rows={3}
            />
          </div>

          {formData.type === 'auto-count' && (
            <>
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                <div className="flex items-start space-x-2">
                  <div className="flex-shrink-0">
                    <div className="w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center">
                      <span className="text-indigo-600 text-sm">🔍</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-indigo-900 mb-1">Auto-Count Condition</h4>
                    <p className="text-sm text-indigo-700 mb-2">
                      After creating this condition, you'll be able to draw a selection box around a symbol on the drawing to define what to count.
                    </p>
                    <p className="text-xs text-indigo-600">
                      The system will use AI to automatically find and count all similar symbols based on your selected scope.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <Label htmlFor="searchScope">Search Scope</Label>
                <Select 
                  value={formData.searchScope} 
                  onValueChange={(value) => handleInputChange('searchScope', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current-page">Current Page</SelectItem>
                    <SelectItem value="entire-document">Entire Document</SelectItem>
                    <SelectItem value="entire-project">Entire Project</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-1">
                  Select where to search for matching symbols: current page only, all pages in the current document, or all pages in all documents.
                </p>
              </div>

              <div>
                <Label htmlFor="searchThreshold">Detection Confidence</Label>
                <Input
                  id="searchThreshold"
                  type="number"
                  min="0.1"
                  max="1.0"
                  step="0.1"
                  value={formData.searchThreshold}
                  onChange={(e) => handleInputChange('searchThreshold', e.target.value)}
                  placeholder="0.7"
                />
                <p className="text-xs text-gray-500 mt-1">
                  How confident the AI should be before counting a match (0.1 = very loose, 1.0 = very strict)
                </p>
              </div>
            </>
          )}

          <div>
            <Label htmlFor="materialCost">
              Material Cost ({formData.type === 'count' ? '$/unit' : `$/${formData.unit || getDefaultUnit(formData.type)}`})
            </Label>
            <Input
              id="materialCost"
              type="number"
              min="0"
              step="0.01"
              value={formData.materialCost || ''}
              onChange={(e) => {
                const value = e.target.value;
                handleInputChange('materialCost', value === '' ? '' : value);
              }}
              placeholder="0.00"
            />
          </div>

          <div>
            <Label htmlFor="equipmentCost">Equipment Cost ($)</Label>
            <Input
              id="equipmentCost"
              type="number"
              min="0"
              step="0.01"
              value={formData.equipmentCost || ''}
              onChange={(e) => {
                const value = e.target.value;
                handleInputChange('equipmentCost', value === '' ? '' : value);
              }}
              placeholder="0.00"
            />
            <p className="text-xs text-gray-500 mt-1">
              Fixed equipment cost for this condition (e.g., crane rental, specialized tools)
            </p>
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? (editingCondition ? 'Updating...' : 'Creating...') : (editingCondition ? 'Update Condition' : 'Create Condition')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

