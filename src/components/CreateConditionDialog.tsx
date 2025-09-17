import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { X } from 'lucide-react';
import { useTakeoffStore } from '../store/useTakeoffStore';
import { saveConditions, loadConditions } from '../utils/measurementStorage';
import { generateRandomColor, getDefaultUnit, generateId } from '../utils/commonUtils';

interface CreateConditionDialogProps {
  projectId: string;
  onClose: () => void;
  onConditionCreated: (condition: any) => void;
}

export function CreateConditionDialog({ projectId, onClose, onConditionCreated }: CreateConditionDialogProps) {
  // Random color generation now imported from common utils

  const [formData, setFormData] = useState({
    name: '',
    type: 'area' as 'area' | 'volume' | 'linear' | 'count',
    unit: 'SF', // Initialize with default unit for 'area' type
    wasteFactor: 0,
    color: generateRandomColor(),
    description: '',
    laborCost: '',
    materialCost: '',
    includePerimeter: false
  });
  const [loading, setLoading] = useState(false);

  const { addCondition } = useTakeoffStore();

  // Debug: Log form data changes
  useEffect(() => {
    console.log('Form data updated:', formData);
  }, [formData]);

  // Ensure unit is set when component mounts
  useEffect(() => {
    if (!formData.unit) {
      const defaultUnit = getDefaultUnit(formData.type);
      console.log('Setting default unit on mount:', defaultUnit);
      setFormData(prev => ({ ...prev, unit: defaultUnit }));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      console.log('Form data before submission:', formData);
      // Ensure unit is set - use formData.unit or fall back to default for the type
      const unit = formData.unit || getDefaultUnit(formData.type);
      console.log('Unit resolved:', { formDataUnit: formData.unit, defaultUnit: getDefaultUnit(formData.type), finalUnit: unit });
      
      const newCondition = {
        projectId,
        name: formData.name,
        type: formData.type,
        unit: unit,
        wasteFactor: formData.wasteFactor,
        color: formData.color,
        description: formData.description,
        laborCost: formData.laborCost ? parseFloat(formData.laborCost) : undefined,
        materialCost: formData.materialCost ? parseFloat(formData.materialCost) : undefined,
        includePerimeter: formData.includePerimeter,
      };
      console.log('New condition data:', newCondition);
      
      // Create condition with ID and timestamp
      const conditionId = generateId();
      const createdCondition = {
        ...newCondition,
        id: conditionId,
        createdAt: new Date().toISOString()
      };
      
      // Save to localStorage
      const existingConditions = loadConditions(projectId);
      const updatedConditions = [...existingConditions, createdCondition];
      saveConditions(projectId, updatedConditions);
      
      console.log('Condition saved to localStorage:', createdCondition);
      
      // Call the callback with the new condition
      onConditionCreated(createdCondition);
      
    } catch (error) {
      console.error('Error creating condition:', error);
      alert('Failed to create condition. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleTypeChange = (value: string) => {
    const defaultUnit = getDefaultUnit(value);
    console.log('Type changed to:', value, 'Default unit:', defaultUnit);
    setFormData(prev => {
      const newData = { 
        ...prev, 
        type: value as 'area' | 'volume' | 'linear' | 'count',
        unit: defaultUnit 
      };
      console.log('Setting form data to:', newData);
      return newData;
    });
  };

  const getDefaultUnit = (type: string) => {
    switch (type) {
      case 'area': return 'SF';
      case 'volume': return 'CY';
      case 'linear': return 'LF';
      case 'count': return 'EA';
      default: return '';
    }
  };

  return (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg max-w-md mx-4 w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Create New Condition</h3>
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
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="unit">Unit *</Label>
              <Select value={formData.unit || getDefaultUnit(formData.type)} onValueChange={(value) => {
                console.log('Unit changed to:', value);
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
                </SelectContent>
              </Select>
            </div>
          </div>

          {formData.type === 'area' && (
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="wasteFactor">Waste Factor (%)</Label>
              <Input
                id="wasteFactor"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={formData.wasteFactor}
                onChange={(e) => handleInputChange('wasteFactor', parseFloat(e.target.value) || 0)}
              />
            </div>

            <div>
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="laborCost">Labor Cost ($/hr)</Label>
              <Input
                id="laborCost"
                type="number"
                min="0"
                step="0.01"
                value={formData.laborCost}
                onChange={(e) => handleInputChange('laborCost', e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div>
              <Label htmlFor="materialCost">Material Cost ($/unit)</Label>
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
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Creating...' : 'Create Condition'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

