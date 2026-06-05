import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

export interface ExportProgressOverlayProps {
  /** When type is null, overlay is not rendered */
  exportStatus: {
    type: 'excel' | 'pdf' | null;
    progress: number;
  };
}

/**
 * Full-screen overlay shown during export (Excel or PDF).
 * Renders nothing when exportStatus.type is null.
 */
export function ExportProgressOverlay({ exportStatus }: ExportProgressOverlayProps): React.ReactNode {
  const exportType = exportStatus.type;
  if (!exportType) {
    return null;
  }

  const title = `Exporting ${exportType.toUpperCase()} Report`;
  const progressLabel = `${exportStatus.progress}% complete`;

  return (
    <Dialog open onOpenChange={() => { /* non-dismissible while exporting */ }}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        aria-busy="true"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-4">
            <div
              className="animate-spin w-8 h-8 border-[3px] border-blue-500 border-t-transparent rounded-full shrink-0"
              aria-hidden="true"
            />
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                Please wait while we process your data.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Progress</span>
            <span aria-live="polite" aria-atomic="true">
              {progressLabel}
            </span>
          </div>
          <div
            className="w-full h-3 bg-muted rounded-full overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={exportStatus.progress}
            aria-label="Export progress"
          >
            <div
              className="h-full bg-blue-500 transition-all duration-500 ease-out rounded-full"
              style={{ width: `${exportStatus.progress}%` }}
            />
          </div>
        </div>

        {exportType === 'pdf' && (
          <div className="text-xs text-muted-foreground">
            {exportStatus.progress > 20 ? (
              <>
                <p>Capturing PDF pages with measurements…</p>
                <p>This may take a moment for large projects.</p>
              </>
            ) : (
              <>
                <p>Preparing report data…</p>
                <p>This may take a moment for large projects.</p>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
