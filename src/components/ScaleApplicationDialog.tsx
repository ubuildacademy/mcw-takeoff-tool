import React, { useState } from 'react';
import { BaseDialog } from './ui/base-dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface ScaleApplicationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (scope: 'page' | 'document') => void;
  scaleFactor: number;
  unit: string;
  currentPage: number;
  totalPages: number;
}

const ScaleApplicationDialog: React.FC<ScaleApplicationDialogProps> = ({
  isOpen,
  onClose,
  onApply,
  scaleFactor,
  unit,
  currentPage,
  totalPages
}) => {
  const [selectedScope, setSelectedScope] = useState<'page' | 'document'>('page');

  const handleApply = () => {
    onApply(selectedScope);
    onClose();
  };

  const scaleInInches = (scaleFactor * 0.0833).toFixed(4);

  return (
    <BaseDialog
      open={isOpen}
      onOpenChange={onClose}
      title="Apply Scale Calibration"
      description={`Choose how to apply the calibrated scale factor of ${scaleInInches} ${unit} per pixel.`}
      maxWidth="md"
      footer={
        <div className="flex justify-end space-x-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleApply}>
            Apply Scale
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        <Label htmlFor="scope">Apply to:</Label>
        <Select value={selectedScope} onValueChange={(value: 'page' | 'document') => setSelectedScope(value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="page">
              Current page only (Page {currentPage} of {totalPages})
            </SelectItem>
            <SelectItem value="document">
              Entire document ({totalPages} pages)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-gray-50 p-3 rounded-md">
        <p className="text-sm text-gray-600">
          <strong>Current page:</strong> {currentPage} of {totalPages}<br/>
          <strong>Scale factor:</strong> 1 pixel = {scaleInInches} {unit}<br/>
          <strong>Scope:</strong> {selectedScope === 'page' ? 'Current page only' : 'All pages in document'}
        </p>
      </div>
    </BaseDialog>
  );
};

export default ScaleApplicationDialog;