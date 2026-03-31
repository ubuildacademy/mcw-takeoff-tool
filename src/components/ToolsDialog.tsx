import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Link2, Trash2 } from 'lucide-react';
import { useUserPreferencesStore } from '../store/slices/userPreferencesSlice';

export interface ToolsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when user clicks Add hyperlink. Closes dialog and enters link mode. */
  onAddHyperlink?: () => void;
  /** Called when user clicks Clear all hyperlinks */
  onClearHyperlinks?: () => void;
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

export function ToolsDialog({
  open,
  onOpenChange,
  onAddHyperlink,
  onClearHyperlinks,
}: ToolsDialogProps) {
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
  const magnifierEnabled = useUserPreferencesStore((s) => s.magnifierEnabled);
  const magnifierZoom = useUserPreferencesStore((s) => s.magnifierZoom);
  const setMagnifierEnabled = useUserPreferencesStore((s) => s.setMagnifierEnabled);
  const setMagnifierZoom = useUserPreferencesStore((s) => s.setMagnifierZoom);

  const handleAddHyperlink = () => {
    onOpenChange(false);
    onAddHyperlink?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="tools-dialog-description">
        <DialogHeader>
          <DialogTitle>Tools</DialogTitle>
          <DialogDescription id="tools-dialog-description">
            Preferences and tools for takeoff and navigation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2 max-h-[70vh] overflow-y-auto">
          {/* Preferences */}
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Preferences</h3>

            {/* Crosshairs */}
            <div className="space-y-2">
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
            </div>

            <SettingsCheckbox
              id="default-ortho-snapping"
              checked={defaultOrthoSnapping}
              onChange={setDefaultOrthoSnapping}
              label="Enable ortho snapping by default"
              description="Constrains drawing to horizontal or vertical lines. Toggle with Shift during a session."
            />

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

            {/* Magnifier */}
            <div className="space-y-2 pt-2">
              <p className="text-sm text-muted-foreground">
                Zoomed view near cursor for precise point placement.
              </p>
              <SettingsCheckbox
                id="magnifier-enabled"
                checked={magnifierEnabled}
                onChange={setMagnifierEnabled}
                label="Enable magnifier"
                description="Shows a magnified region when drawing or measuring."
              />
              {magnifierEnabled && (
                <div className="flex items-center gap-3 ml-7">
                  <Label htmlFor="magnifier-zoom" className="text-sm font-normal shrink-0">
                    Zoom
                  </Label>
                  <select
                    id="magnifier-zoom"
                    value={magnifierZoom}
                    onChange={(e) => setMagnifierZoom(Number(e.target.value) as 2 | 3 | 4)}
                    className="h-8 rounded border border-input bg-background px-2 text-sm"
                  >
                    <option value={2}>2×</option>
                    <option value={3}>3×</option>
                    <option value={4}>4×</option>
                  </select>
                </div>
              )}
            </div>
          </section>

          <hr className="border-border" />

          {/* Hyperlinks */}
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Hyperlinks</h3>
            <p className="text-sm text-muted-foreground">
              Draw a region on the sheet and pick a destination sheet (manual links only).
            </p>

            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={handleAddHyperlink}
                disabled={!onAddHyperlink}
              >
                <Link2 className="w-4 h-4 mr-2 shrink-0" />
                Add hyperlink (H)
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start text-muted-foreground hover:text-destructive hover:border-destructive/50"
                onClick={() => {
                  onOpenChange(false);
                  onClearHyperlinks?.();
                }}
                disabled={!onClearHyperlinks}
              >
                <Trash2 className="w-4 h-4 mr-2 shrink-0" />
                Clear all hyperlinks
              </Button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
