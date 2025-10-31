import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { X } from 'lucide-react';
import { useTakeoffStore } from '../store/useTakeoffStore';
import { generateRandomColor, getDefaultUnit, parseDepthInput, formatDepthOutput } from '../utils/commonUtils';

interface CreateConditionDialogProps {
  projectId: string;
  onClose: () => void;
  onConditionCreated: (condition: any) => void;
  editingCondition?: any; // Condition to edit, if provided
}

export function CreateConditionDialog({ projectId, onClose, onConditionCreated, editingCondition }: CreateConditionDialogProps) {
  const { addCondition, updateCondition } = useTakeoffStore();

  const [formData, setFormData] = useState({
    name: editingCondition?.name || '',
    type: (editingCondition?.type || 'area') as 'area' | 'volume' | 'linear' | 'count' | 'visual-search',
    unit: editingCondition?.unit || 'SF', // Initialize with default unit for 'area' type
    wasteFactor: editingCondition?.wasteFactor?.toString() || '',
    color: editingCondition?.color || generateRandomColor(),
    description: editingCondition?.description || '',
    materialCost: editingCondition?.materialCost?.toString() || '',
    equipmentCost: editingCondition?.equipmentCost?.toString() || '',
    includePerimeter: editingCondition?.includePerimeter || false,
    depth: editingCondition?.depth ? formatDepthOutput(editingCondition.depth) : '',
    // Visual search specific fields
    searchImage: editingCondition?.searchImage || '',
    searchImageId: editingCondition?.searchImageId || '',
    searchThreshold: editingCondition?.searchThreshold?.toString() || '0.7'
  });
  const [loading, setLoading] = useState(false);
  const [depthError, setDepthError] = useState<string>('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);


  // Ensure unit is set when component mounts
  useEffect(() => {
    if (!formData.unit) {
      const defaultUnit = getDefaultUnit(formData.type);
      setFormData(prev => ({ ...prev, unit: defaultUnit }));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Ensure unit is set - use formData.unit or fall back to default for the type
      const unit = formData.unit || getDefaultUnit(formData.type);
      
      // Parse depth value (supports both decimal feet and feet/inches format)
      let parsedDepth: number | null | undefined;
      if (formData.depth && formData.depth.trim() !== '') {
        parsedDepth = parseDepthInput(formData.depth);
        if (parsedDepth === null) {
          setDepthError('Invalid depth format. Use decimal feet (e.g., 1.5) or feet/inches (e.g., 1\'6")');
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
        materialCost: formData.materialCost ? parseFloat(formData.materialCost) : undefined,
        equipmentCost: formData.equipmentCost ? parseFloat(formData.equipmentCost) : undefined,
        includePerimeter: formData.includePerimeter,
        depth: parsedDepth === null ? undefined : parsedDepth,
        // Visual search specific fields
        ...(formData.type === 'visual-search' && {
          searchImage: formData.searchImage,
          searchImageId: formData.searchImageId,
          searchThreshold: formData.searchThreshold ? parseFloat(formData.searchThreshold) : 0.7
        })
      };
      
      let result;
      if (editingCondition) {
        // Update existing condition
        result = await updateCondition(editingCondition.id, conditionData);
      } else {
        // Create new condition
        result = await addCondition(conditionData);
      }
      
      // Call the callback with the result
      onConditionCreated(result);
      
    } catch (error) {
      console.error('Error saving condition:', error);
      alert(`Failed to ${editingCondition ? 'update' : 'create'} condition. Please try again.`);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Clear depth error when user starts typing
    if (field === 'depth' && depthError) {
      setDepthError('');
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
        wasteFactor: value === 'count' ? 0 : prev.wasteFactor
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
      case 'visual-search': return 'EA';
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
                  <SelectItem value="visual-search">Visual Search</SelectItem>
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
                      <SelectItem value="LF">LF (Linear Feet)</SelectItem>
                      <SelectItem value="LY">LY (Linear Yards)</SelectItem>
                      <SelectItem value="LM">LM (Linear Meters)</SelectItem>
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
                  {formData.type === 'visual-search' && (
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

          {formData.type === 'visual-search' && (
            <>
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                <div className="flex items-start space-x-2">
                  <div className="flex-shrink-0">
                    <div className="w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center">
                      <span className="text-indigo-600 text-sm">🔍</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-indigo-900 mb-1">Visual Search Condition</h4>
                    <p className="text-sm text-indigo-700 mb-2">
                      After creating this condition, you'll be able to draw a selection box around a symbol on the drawing to define what to search for.
                    </p>
                    <p className="text-xs text-indigo-600">
                      The system will use AI to automatically find and count all similar symbols throughout the plans.
                    </p>
                  </div>
                </div>
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
              value={formData.materialCost}
              onChange={(e) => handleInputChange('materialCost', e.target.value)}
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
              value={formData.equipmentCost}
              onChange={(e) => handleInputChange('equipmentCost', e.target.value)}
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

