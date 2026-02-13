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

export function UserSettingsDialog({ open, onOpenChange }: UserSettingsDialogProps) {
  const crosshairFullScreen = useUserPreferencesStore((s) => s.crosshairFullScreen);
  const crosshairColor = useUserPreferencesStore((s) => s.crosshairColor);
  const setCrosshairFullScreen = useUserPreferencesStore((s) => s.setCrosshairFullScreen);
  const setCrosshairColor = useUserPreferencesStore((s) => s.setCrosshairColor);

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
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Crosshairs</h3>
            <p className="text-sm text-muted-foreground">
              Shown when drawing conditions, calibrating, or annotating.
            </p>

            <div className="flex items-center gap-3">
              <input
                id="crosshair-fullscreen"
                type="checkbox"
                checked={crosshairFullScreen}
                onChange={(e) => setCrosshairFullScreen(e.target.checked)}
                className="h-4 w-4 rounded border border-primary accent-primary focus:ring-2 focus:ring-ring focus:ring-offset-2"
              />
              <Label htmlFor="crosshair-fullscreen" className="cursor-pointer text-sm font-normal">
                Full-screen crosshairs
              </Label>
            </div>

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
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
