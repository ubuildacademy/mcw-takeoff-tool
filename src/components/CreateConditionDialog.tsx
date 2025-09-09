import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { X } from 'lucide-react';
import { useTakeoffStore } from '../store/useTakeoffStore';

interface CreateConditionDialogProps {
  projectId: string;
  onClose: () => void;
  onConditionCreated: (condition: any) => void;
}

export function CreateConditionDialog({ projectId, onClose, onConditionCreated }: CreateConditionDialogProps) {
  // Generate a random color for new conditions
  const generateRandomColor = () => {
    const colors = [
      '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57',
      '#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3', '#ff9f43',
      '#10ac84', '#ee5a24', '#0984e3', '#6c5ce7', '#a29bfe',
      '#fd79a8', '#fdcb6e', '#e17055', '#74b9ff', '#00b894'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  const [formData, setFormData] = useState({
    name: '',
    type: 'area' as 'area' | 'volume' | 'linear' | 'count',
    unit: '',
    wasteFactor: 0,
    color: generateRandomColor(),
    description: '',
    laborCost: '',
    materialCost: ''
  });
  const [loading, setLoading] = useState(false);

  const { addCondition } = useTakeoffStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const newCondition = {
        projectId,
        name: formData.name,
        type: formData.type,
        unit: formData.unit,
        wasteFactor: formData.wasteFactor,
        color: formData.color,
        description: formData.description,
        laborCost: formData.laborCost ? parseFloat(formData.laborCost) : undefined,
        materialCost: formData.materialCost ? parseFloat(formData.materialCost) : undefined,
      };
      
      // Use the store method which will save to both local store and backend
      const conditionId = await addCondition(newCondition);
      console.log('Condition added with ID:', conditionId);
      
      // Call the callback with the new condition
      const createdCondition = { ...newCondition, id: conditionId };
      onConditionCreated(createdCondition);
      
    } catch (error) {
      console.error('Error creating condition:', error);
      alert('Failed to create condition. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
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
              <Select value={formData.type} onValueChange={(value: any) => {
                handleInputChange('type', value);
                handleInputChange('unit', getDefaultUnit(value));
              }}>
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
              <Input
                id="unit"
                value={formData.unit}
                onChange={(e) => handleInputChange('unit', e.target.value)}
                placeholder={getDefaultUnit(formData.type)}
                required
              />
            </div>
          </div>

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

