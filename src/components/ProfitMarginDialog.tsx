import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { BaseDialog } from './ui/base-dialog';
import { useProjectStore } from '../store/slices/projectSlice';

interface ProfitMarginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function ProfitMarginDialog({ open, onOpenChange, projectId: _projectId }: ProfitMarginDialogProps) {
  const getCurrentProject = useProjectStore((s) => s.getCurrentProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const currentProject = getCurrentProject();
  
  const [profitMargin, setProfitMargin] = useState(
    currentProject?.profitMarginPercent?.toString() || '15'
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }

    if (!currentProject) return;

    setIsSubmitting(true);
    try {
      await updateProject(currentProject.id, {
        profitMarginPercent: parseFloat(profitMargin) || 15
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating profit margin:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <BaseDialog 
      open={open} 
      onOpenChange={onOpenChange}
      title="Project Profit Margin"
      maxWidth="md"
      footer={
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="profit-margin-form"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Updating...' : 'Update Profit Margin'}
          </Button>
        </div>
      }
    >
      <form id="profit-margin-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="profitMargin">Profit Margin (%)</Label>
          <Input
            id="profitMargin"
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={profitMargin}
            onChange={(e) => setProfitMargin(e.target.value)}
            placeholder="15.0"
          />
          <p className="text-xs text-gray-500">
            This percentage will be applied to all cost calculations as a profit margin on top of material, labor, and equipment costs.
          </p>
        </div>
        
        <div className="bg-blue-50 p-3 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Current Project:</strong> {currentProject?.name}
          </p>
          <p className="text-xs text-blue-600 mt-1">
            The profit margin is applied globally to all conditions in this project.
          </p>
        </div>
      </form>
    </BaseDialog>
  );
}
