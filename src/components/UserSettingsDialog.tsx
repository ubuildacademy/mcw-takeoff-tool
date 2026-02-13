import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Label } from './ui/label';
import { useUserPreferencesStore } from '../store/slices/userPreferencesSlice';

interface UserSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Reusable checkbox row for settings. */
function SettingsCheckbox({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border border-primary accent-primary focus:ring-2 focus:ring-ring focus:ring-offset-2"
        />
        <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
          {label}
        </Label>
      </div>
      {description && (
        <p className="text-xs text-muted-foreground ml-7">{description}</p>
      )}
    </>
  );
}

export function UserSettingsDialog({ open, onOpenChange }: UserSettingsDialogProps) {
  const crosshairFullScreen = useUserPreferencesStore((s) => s.crosshairFullScreen);
  const crosshairColor = useUserPreferencesStore((s) => s.crosshairColor);
  const crosshairStrokeWidth = useUserPreferencesStore((s) => s.crosshairStrokeWidth);
  const setCrosshairFullScreen = useUserPreferencesStore((s) => s.setCrosshairFullScreen);
  const setCrosshairColor = useUserPreferencesStore((s) => s.setCrosshairColor);
  const setCrosshairStrokeWidth = useUserPreferencesStore((s) => s.setCrosshairStrokeWidth);
  const defaultOrthoSnapping = useUserPreferencesStore((s) => s.defaultOrthoSnapping);
  const setDefaultOrthoSnapping = useUserPreferencesStore((s) => s.setDefaultOrthoSnapping);
  const showMeasurementLabels = useUserPreferencesStore((s) => s.showMeasurementLabels);
  const setShowMeasurementLabels = useUserPreferencesStore((s) => s.setShowMeasurementLabels);
  const showRunningLength = useUserPreferencesStore((s) => s.showRunningLength);
  const setShowRunningLength = useUserPreferencesStore((s) => s.setShowRunningLength);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="user-settings-description">
        <DialogHeader>
          <DialogTitle>User Settings</DialogTitle>
          <DialogDescription id="user-settings-description">
            Personal preferences applied across all projects.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Crosshairs */}
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Crosshairs</h3>
            <p className="text-sm text-muted-foreground">
              Shown when drawing conditions, calibrating, or annotating.
            </p>

            <SettingsCheckbox
              id="crosshair-fullscreen"
              checked={crosshairFullScreen}
              onChange={setCrosshairFullScreen}
              label="Full-screen crosshairs"
            />

            <div className="flex items-center gap-3">
              <Label htmlFor="crosshair-color" className="text-sm font-normal shrink-0">
                Color
              </Label>
              <input
                id="crosshair-color"
                type="color"
                value={crosshairColor}
                onChange={(e) => setCrosshairColor(e.target.value)}
                className="h-8 w-12 rounded border border-input cursor-pointer"
              />
            </div>

            <div className="flex items-center gap-3">
              <Label htmlFor="crosshair-stroke-width" className="text-sm font-normal shrink-0">
                Thickness
              </Label>
              <input
                id="crosshair-stroke-width"
                type="range"
                min="0.5"
                max="5"
                step="0.5"
                value={crosshairStrokeWidth}
                onChange={(e) => setCrosshairStrokeWidth(Number(e.target.value))}
                className="h-2 w-32 cursor-pointer accent-primary"
              />
              <span className="text-xs text-muted-foreground tabular-nums w-8">{crosshairStrokeWidth}px</span>
            </div>
          </section>

          <hr className="border-border" />

          {/* Drawing */}
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Drawing</h3>
            <p className="text-sm text-muted-foreground">
              Defaults applied when starting measurements or calibrations.
            </p>

            <SettingsCheckbox
              id="default-ortho-snapping"
              checked={defaultOrthoSnapping}
              onChange={setDefaultOrthoSnapping}
              label="Enable ortho snapping by default"
              description="Constrains drawing to horizontal or vertical lines. You can still toggle with Shift during a session."
            />
          </section>

          <hr className="border-border" />

          {/* Measurement Labels */}
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Measurement Labels</h3>
            <p className="text-sm text-muted-foreground">
              Control which labels appear on the PDF overlay.
            </p>

            <SettingsCheckbox
              id="show-measurement-labels"
              checked={showMeasurementLabels}
              onChange={setShowMeasurementLabels}
              label="Show labels on completed measurements"
              description={'Displays the value (e.g. 12\'-6" LF, 450 SF) on each measurement.'}
            />

            <SettingsCheckbox
              id="show-running-length"
              checked={showRunningLength}
              onChange={setShowRunningLength}
              label="Show running length while drawing"
              description="Shows a live length tooltip during continuous linear drawing."
            />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
