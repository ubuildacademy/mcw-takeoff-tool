import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

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
  const [knownDistance, setKnownDistance] = useState('');
  const [unit, setUnit] = useState(currentScale?.unit || 'ft');

  const parseDistance = useCallback((input: string): number => {
    // Handle feet and inches format (e.g., "7'6"", "7'", "6"")
    const feetInchesMatch = input.match(/^(\d+(?:\.\d+)?)'(?:(\d+(?:\.\d+)?)")?$/);
    if (feetInchesMatch) {
      const feet = parseFloat(feetInchesMatch[1]) || 0;
      const inches = parseFloat(feetInchesMatch[2]) || 0;
      return feet + (inches / 12);
    }
    
    // Handle decimal feet
    const decimal = parseFloat(input);
    if (!isNaN(decimal) && decimal > 0) {
      return decimal;
    }
    
    return 0;
  }, []);

  const handleStartCalibration = useCallback(() => {
    const distance = parseDistance(knownDistance);
    if (distance <= 0) {
      return;
    }
    onStartCalibration(distance, unit);
  }, [knownDistance, unit, onStartCalibration, parseDistance]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Calibrate Scale</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="known-distance">Known Distance on Drawing</Label>
            <div className="flex gap-2">
              <Input
                id="known-distance"
                type="text"
                value={knownDistance}
                onChange={(e) => setKnownDistance(e.target.value)}
                placeholder="e.g., 7'6&quot; or 7.5"
                disabled={isCalibrating}
              />
              <Select value={unit} onValueChange={setUnit} disabled={isCalibrating}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ft">ft</SelectItem>
                  <SelectItem value="in">in</SelectItem>
                  <SelectItem value="m">m</SelectItem>
                  <SelectItem value="cm">cm</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-gray-500">
              Enter distance as 7'6" or 7.5 (decimal feet). Use a known dimension like a wall length, door width, or scale bar.
            </p>
          </div>

          {currentScale && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded">
              <p className="text-sm text-blue-700">
                Current scale: 1 pixel = {(currentScale.scaleFactor * 0.0833).toFixed(4)} {currentScale.unit}
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
                disabled={!knownDistance || parseDistance(knownDistance) <= 0}
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
                Click two points on the PDF to draw a line representing {parseDistance(knownDistance).toFixed(3)} {unit}
              </p>
              <p className="text-xs text-yellow-600 mt-1">
                • First click: Place point 1<br/>
                • Second click: Place point 2<br/>
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
