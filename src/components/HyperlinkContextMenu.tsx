import React, { useEffect, useRef } from 'react';

export interface HyperlinkContextMenuProps {
  x: number;
  y: number;
  hyperlinkId: string;
  onEdit: () => void;
  onDelete: () => void;
  /** Navigate to the target page and capture the exact landing view for this link. */
  onSetTargetView?: () => void;
  onClose: () => void;
}

export function HyperlinkContextMenu({
  x,
  y,
  hyperlinkId: _hyperlinkId,
  onEdit,
  onDelete,
  onSetTargetView,
  onClose,
}: HyperlinkContextMenuProps) {
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
      className="fixed z-[100] min-w-[160px] rounded-md border bg-popover text-popover-foreground py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
        onClick={() => {
          onEdit();
          onClose();
        }}
      >
        Edit...
      </button>
      {onSetTargetView && (
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          onClick={() => {
            onSetTargetView();
            onClose();
          }}
        >
          Set target view...
        </button>
      )}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-500/10"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        Delete
      </button>
    </div>
  );
}
