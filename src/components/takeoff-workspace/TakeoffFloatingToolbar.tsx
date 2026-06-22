import React from 'react';
import { Undo2, X, Check } from 'lucide-react';
import { Button } from '../ui/button';

interface TakeoffFloatingToolbarProps {
  /** Show the toolbar (any active drawing mode on tablet). */
  visible: boolean;
  /**
   * Whether to show the Finish button. True only for multi-point measurement
   * types where an explicit finish step is needed (linear, area, volume).
   * Computed by the parent — the toolbar doesn't need to know the active mode.
   */
  showFinish: boolean;
  canUndo: boolean;
  onUndo: () => void;
  /** Cancel current drawing (Escape equivalent). */
  onCancel: () => void;
  /** Complete current measurement (double-tap equivalent). */
  onFinish: () => void;
}

/**
 * Floating pill toolbar that surfaces touch-friendly equivalents for the
 * keyboard-only actions (Undo, Escape, Finish) while the user is actively
 * drawing a measurement, calibrating, or using annotation/cutout/hyperlink tools.
 *
 * Positioned at the bottom-center of the PDF viewer column so it stays out
 * of the way of the drawing canvas while remaining within thumb reach.
 */
export function TakeoffFloatingToolbar({
  visible,
  showFinish,
  canUndo,
  onUndo,
  onCancel,
  onFinish,
}: TakeoffFloatingToolbarProps): React.ReactNode {
  if (!visible) return null;

  return (
    <div
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
      aria-label="Drawing toolbar"
    >
      <div
        className="pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-full
                   bg-background/90 backdrop-blur-sm border border-border shadow-lg
                   select-none"
      >
        {/* Undo */}
        <Button
          variant="ghost"
          size="sm"
          className="min-h-[44px] min-w-[44px] flex flex-col items-center gap-0.5 px-3 rounded-full text-foreground disabled:opacity-40"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo (⌘Z)"
        >
          <Undo2 className="h-4 w-4" />
          <span className="text-[10px] leading-none font-medium">Undo</span>
        </Button>

        <div className="w-px h-6 bg-border mx-0.5" aria-hidden />

        {/* Cancel */}
        <Button
          variant="ghost"
          size="sm"
          className="min-h-[44px] min-w-[44px] flex flex-col items-center gap-0.5 px-3 rounded-full text-red-600 hover:text-red-700 hover:bg-red-500/10"
          onClick={onCancel}
          aria-label="Cancel drawing (Escape)"
          title="Cancel (Esc)"
        >
          <X className="h-4 w-4" />
          <span className="text-[10px] leading-none font-medium">Cancel</span>
        </Button>

        {/* Finish — only for multi-point measurement modes */}
        {showFinish && (
          <>
            <div className="w-px h-6 bg-border mx-0.5" aria-hidden />
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[44px] min-w-[44px] flex flex-col items-center gap-0.5 px-3 rounded-full text-green-700 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 hover:bg-green-500/10"
              onClick={onFinish}
              aria-label="Finish measurement (double-tap)"
              title="Finish (double-tap)"
            >
              <Check className="h-4 w-4" />
              <span className="text-[10px] leading-none font-medium">Finish</span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
