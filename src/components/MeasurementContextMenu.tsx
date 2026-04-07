import React, { useEffect, useRef } from 'react';

export interface MeasurementContextMenuProps {
  x: number;
  y: number;
  onSelectAllSimilar: () => void;
  onBringForward?: () => void;
  onSendBackward?: () => void;
  onSendToBack?: () => void;
  canBringForward?: boolean;
  canSendBackward?: boolean;
  canSendToBack?: boolean;
  onClose: () => void;
}

/**
 * Context menu for takeoff measurements (condition markups) on the PDF overlay.
 */
export function MeasurementContextMenu({
  x,
  y,
  onSelectAllSimilar,
  onBringForward,
  onSendBackward,
  onSendToBack,
  canBringForward = true,
  canSendBackward = true,
  canSendToBack = true,
  onClose,
}: MeasurementContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[200px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!canBringForward}
        onClick={() => {
          if (canBringForward) onBringForward?.();
        }}
      >
        Bring forward
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!canSendBackward}
        onClick={() => {
          if (canSendBackward) onSendBackward?.();
        }}
      >
        Send backward
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!canSendToBack}
        onClick={() => {
          if (canSendToBack) onSendToBack?.();
        }}
      >
        Send to back
      </button>
      <div className="my-1 border-t border-slate-200" />
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100"
        onClick={() => {
          onSelectAllSimilar();
        }}
      >
        Select all similar
      </button>
    </div>
  );
}
