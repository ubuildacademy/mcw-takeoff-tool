import React from 'react';
import { Undo2, X, Check } from 'lucide-react';
import { Button } from '../ui/button';

interface TakeoffFloatingToolbarProps {
  /** Show the toolbar (isMeasuring || isCalibrating) */
  visible: boolean;
  /** Current measurement type — 'count' suppresses the Finish button */
  measurementType: string;
  /** Whether we're in calibration mode (suppresses Finish, keeps Cancel) */
  isCalibrating: boolean;
  canUndo: boolean;
  onUndo: () => void;
  /** Cancel current drawing (Escape equivalent) */
  onCancel: () => void;
  /** Complete current measurement (double-tap equivalent) */
  onFinish: () => void;
}

/**
 * Floating pill toolbar that surfaces touch-friendly equivalents for the
 * keyboard-only actions (Undo, Escape, Finish) while the user is actively
 * drawing a measurement or calibrating.
 *
 * Positioned at the bottom-center of the PDF viewer column so it stays out
 * of the way of the drawing canvas while remaining within thumb reach.
 */
export function TakeoffFloatingToolbar({
  visible,
  measurementType,
  isCalibrating,
  canUndo,
  onUndo,
  onCancel,
  onFinish,
}: TakeoffFloatingToolbarProps): React.ReactNode {
  if (!visible) return null;

  // "Finish" is meaningful for multi-point shapes (linear / area / volume).
  // Count lands a mark on each tap (no explicit finish step).
  // Calibration auto-completes after placing 2 points.
  const showFinish = !isCalibrating && measurementType !== 'count' && measurementType !== '';

  return (
    <div
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
      aria-label="Drawing toolbar"
    >
      <div
        className="pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-full
                   bg-white/90 backdrop-blur-sm border border-gray-200 shadow-lg
                   select-none"
      >
        {/* Undo */}
        <Button
          variant="ghost"
          size="sm"
          className="min-h-[44px] min-w-[44px] flex flex-col items-center gap-0.5 px-3 rounded-full text-gray-700 disabled:opacity-40"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo (⌘Z)"
        >
          <Undo2 className="h-4 w-4" />
          <span className="text-[10px] leading-none font-medium">Undo</span>
        </Button>

        <div className="w-px h-6 bg-gray-200 mx-0.5" aria-hidden />

        {/* Cancel */}
        <Button
          variant="ghost"
          size="sm"
          className="min-h-[44px] min-w-[44px] flex flex-col items-center gap-0.5 px-3 rounded-full text-red-600 hover:text-red-700 hover:bg-red-50"
          onClick={onCancel}
          aria-label="Cancel drawing (Escape)"
          title="Cancel (Esc)"
        >
          <X className="h-4 w-4" />
          <span className="text-[10px] leading-none font-medium">Cancel</span>
        </Button>

        {/* Finish — only for non-count, non-calibration modes */}
        {showFinish && (
          <>
            <div className="w-px h-6 bg-gray-200 mx-0.5" aria-hidden />
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[44px] min-w-[44px] flex flex-col items-center gap-0.5 px-3 rounded-full text-green-700 hover:text-green-800 hover:bg-green-50"
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
