import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

interface CalibrationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onStartCalibration: (knownDistance: number, unit: string) => void;
  currentScale?: { scaleFactor: number; unit: string } | null;
  isCalibrating?: boolean;
}

const CalibrationDialog: React.FC<CalibrationDialogProps> = ({
  isOpen,
  onClose,
  onStartCalibration,
  currentScale,
  isCalibrating = false
}) => {
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');

  const parseDistance = useCallback((): number => {
    const feetValue = parseFloat(feet) || 0;
    const inchesValue = parseFloat(inches) || 0;
    return feetValue + (inchesValue / 12);
  }, [feet, inches]);

  const handleStartCalibration = useCallback(() => {
    const distance = parseDistance();
    if (distance <= 0) {
      return;
    }
    onStartCalibration(distance, 'ft');
  }, [parseDistance, onStartCalibration]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}>
      <DialogContent className="sm:max-w-md" aria-describedby="calibration-dialog-description">
        <DialogDescription id="calibration-dialog-description" className="sr-only">
          Enter a known distance on the drawing to calibrate the scale.
        </DialogDescription>
        <DialogHeader>
          <DialogTitle>Calibrate Scale</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2" role="group" aria-labelledby="known-distance-label">
            <p id="known-distance-label" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Known Distance on Drawing</p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label htmlFor="feet-input" className="text-xs text-gray-600">Feet</Label>
                <Input
                  id="feet-input"
                  name="feet"
                  type="number"
                  value={feet}
                  onChange={(e) => setFeet(e.target.value)}
                  placeholder="10"
                  disabled={isCalibrating}
                  min="0"
                  step="0.1"
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="inches-input" className="text-xs text-gray-600">Inches</Label>
                <Input
                  id="inches-input"
                  name="inches"
                  type="number"
                  value={inches}
                  onChange={(e) => setInches(e.target.value)}
                  placeholder="0"
                  disabled={isCalibrating}
                  min="0"
                  max="11.99"
                  step="0.1"
                />
              </div>
            </div>
            <p className="text-sm text-gray-500">
              Enter the known distance in feet and inches. Use a known dimension like a wall length, door width, or scale bar.
            </p>
          </div>

          {currentScale && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded">
              <p className="text-sm text-blue-700">
                Current scale: 1 pixel = {currentScale.scaleFactor.toFixed(6)} {currentScale.unit}
              </p>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleCancel} disabled={isCalibrating}>
              {isCalibrating ? 'Cancel Calibration' : 'Cancel'}
            </Button>
            {!isCalibrating && (
              <Button 
                onClick={handleStartCalibration}
                disabled={(!feet && !inches) || parseDistance() <= 0}
              >
                Start Calibration
              </Button>
            )}
          </div>

          {isCalibrating && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-sm text-yellow-700 font-medium">
                Calibration Mode Active
              </p>
              <p className="text-xs text-yellow-600 mt-1">
                Click two points on the PDF to draw a line representing {parseDistance().toFixed(3)} ft
              </p>
              <p className="text-xs text-yellow-600 mt-1">
                • First click: Place point 1<br/>
                • Second click: Place point 2 (automatically snaps to horizontal/vertical)<br/>
                • A red line will appear showing the measured distance<br/>
                • Press Escape to cancel
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CalibrationDialog;
