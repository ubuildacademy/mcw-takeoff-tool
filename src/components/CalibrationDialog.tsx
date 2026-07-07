import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { HelpTopicTrigger } from './help/HelpTopicTrigger';
import type { DetectedScale, SheetSizeAssessment } from '../utils/scaleDetection';

interface CalibrationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onStartCalibration: (knownDistance: number, unit: string) => void;
  currentScale?: { scaleFactor: number; unit: string } | null;
  isCalibrating?: boolean;
  /** Scale notations found in the sheet's vector text (best candidate first). */
  detectedScales?: DetectedScale[];
  /** Physical sheet-size check backing the detected scales' trustworthiness. */
  sheetSizeAssessment?: SheetSizeAssessment | null;
  /** Start click-to-verify for a detected scale. Never applies the scale directly. */
  onUseDetectedScale?: (scale: DetectedScale) => void;
}

/** Copy for the sheet-size check. Replotted sheets make stated scales wrong. */
function sheetSizeMessage(a: SheetSizeAssessment): { text: string; warn: boolean } {
  const dims = `${a.widthIn.toFixed(1)}×${a.heightIn.toFixed(1)}"`;
  if (a.verdict === 'half-size') {
    return {
      warn: true,
      text: a.standardName
        ? `Sheet is ${dims} (${a.standardName}) — but this is also a half-size print of ${a.halfSizeOf}. If this set was printed reduced, the stated scale is 2× off. Verify carefully.`
        : `Sheet is ${dims} — looks like a half-size print of ${a.halfSizeOf}. The stated scale is likely 2× off. Prefer manual calibration.`,
    };
  }
  if (a.verdict === 'unknown') {
    return {
      warn: true,
      text: `Sheet is ${dims} — not a standard plot size. This may be a fit-to-page reprint, which makes any stated scale wrong. Prefer manual calibration.`,
    };
  }
  return { warn: false, text: `Sheet is ${dims} (${a.standardName}) — standard plot size.` };
}

const CalibrationDialog: React.FC<CalibrationDialogProps> = ({
  isOpen,
  onClose,
  onStartCalibration,
  currentScale,
  isCalibrating = false,
  detectedScales,
  sheetSizeAssessment,
  onUseDetectedScale,
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
        <DialogHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <DialogTitle>Calibrate Scale</DialogTitle>
          <HelpTopicTrigger topicId="calibrate" />
        </DialogHeader>
        
        <div className="space-y-4">
          {!isCalibrating && detectedScales && detectedScales.length > 0 && onUseDetectedScale && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded space-y-2">
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                Scale found on this sheet
              </p>
              <div className="flex flex-wrap gap-2">
                {detectedScales.map((scale) => (
                  <Button
                    key={scale.label}
                    size="sm"
                    variant="outline"
                    className="border-emerald-300 dark:border-emerald-700"
                    onClick={() => onUseDetectedScale(scale)}
                    title={
                      scale.nearScaleKeyword
                        ? 'Found next to the word "SCALE" on this sheet'
                        : 'Found in the sheet text'
                    }
                  >
                    Verify &amp; use {scale.label}
                  </Button>
                ))}
              </div>
              {sheetSizeAssessment && (() => {
                const msg = sheetSizeMessage(sheetSizeAssessment);
                return (
                  <p
                    className={
                      msg.warn
                        ? 'text-xs text-amber-700 dark:text-amber-400 font-medium'
                        : 'text-xs text-emerald-700 dark:text-emerald-400'
                    }
                  >
                    {msg.warn ? '⚠ ' : ''}{msg.text}
                  </p>
                );
              })()}
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                You'll be asked to click a printed dimension to confirm the scale before it's applied —
                a stated scale is only correct if the sheet was plotted at its original size.
              </p>
            </div>
          )}

          <div className="space-y-2" role="group" aria-labelledby="known-distance-label">
            <p id="known-distance-label" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Known Distance on Drawing</p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label htmlFor="feet-input" className="text-xs text-muted-foreground">Feet</Label>
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
                <Label htmlFor="inches-input" className="text-xs text-muted-foreground">Inches</Label>
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
            <p className="text-sm text-muted-foreground">
              Enter the known distance in feet and inches. Use a known dimension like a wall length, door width, or scale bar.
            </p>
          </div>

          {currentScale && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded">
              <p className="text-sm text-blue-700 dark:text-blue-300">
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
