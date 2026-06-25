import React, { useEffect, useRef, useState } from 'react';

interface ConditionOption {
  id: string;
  name: string;
  color: string;
  type: string;
  unit: string;
}

export interface MeasurementContextMenuProps {
  x: number;
  y: number;
  onCopy?: () => void;
  onPaste?: () => void;
  onPasteAsNewCondition?: () => void;
  canPaste?: boolean;
  onSelectAllSimilar: () => void;
  onBringForward?: () => void;
  onSendBackward?: () => void;
  onSendToBack?: () => void;
  canBringForward?: boolean;
  canSendBackward?: boolean;
  canSendToBack?: boolean;
  conditions?: ConditionOption[];
  currentConditionId?: string;
  currentConditionType?: string;
  currentMeasurementUnit?: string;
  onMoveToCondition?: (conditionId: string) => void;
  onClose: () => void;
}

const MENU_WIDTH = 220;
const SUBMENU_WIDTH = 220;

export function MeasurementContextMenu({
  x,
  y,
  onCopy,
  onPaste,
  onPasteAsNewCondition,
  canPaste = false,
  onSelectAllSimilar,
  onBringForward,
  onSendBackward,
  onSendToBack,
  canBringForward = true,
  canSendBackward = true,
  canSendToBack = true,
  conditions,
  currentConditionId,
  currentConditionType,
  currentMeasurementUnit,
  onMoveToCondition,
  onClose,
}: MeasurementContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const moveToRef = useRef<HTMLButtonElement>(null);
  const [showConditionSubmenu, setShowConditionSubmenu] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const inMenu = ref.current?.contains(e.target as Node);
      const inSubmenu = submenuRef.current?.contains(e.target as Node);
      if (!inMenu && !inSubmenu) onClose();
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

  const availableConditions = (conditions ?? []).filter(
    (c) =>
      c.id !== currentConditionId &&
      c.type === currentConditionType &&
      c.unit === currentMeasurementUnit
  );

  // Clamp main menu so it never overflows right or bottom edge
  const menuLeft = Math.min(x, window.innerWidth - MENU_WIDTH - 8);
  const menuMaxHeight = window.innerHeight - y - 8;

  const getSubmenuStyle = (): React.CSSProperties => {
    if (!moveToRef.current) return { left: menuLeft + MENU_WIDTH + 2, top: y };
    const rect = moveToRef.current.getBoundingClientRect();
    const spaceRight = window.innerWidth - rect.right;
    const left = spaceRight >= SUBMENU_WIDTH + 4
      ? rect.right + 2
      : rect.left - SUBMENU_WIDTH - 2;
    // Clamp top so submenu doesn't go below viewport
    const maxHeight = window.innerHeight - rect.top - 8;
    const top = Math.min(rect.top, window.innerHeight - Math.min(maxHeight, 300) - 8);
    return {
      position: 'fixed',
      left,
      top,
      maxHeight: Math.max(80, maxHeight),
      overflowY: 'auto',
      zIndex: 101,
    };
  };

  const btnClass = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <>
      <div
        ref={ref}
        className="fixed z-[100] min-w-[200px] rounded-md border bg-popover text-popover-foreground py-1 shadow-lg overflow-y-auto"
        style={{ left: menuLeft, top: y, maxHeight: Math.max(120, menuMaxHeight) }}
      >
        {/* Clipboard section */}
        {(onCopy || onPaste || onPasteAsNewCondition) && (
          <>
            {onCopy && (
              <button type="button" className={btnClass} onClick={onCopy}>
                Copy
                <span className="ml-auto text-xs text-muted-foreground">⌘C</span>
              </button>
            )}
            {onPaste && (
              <button type="button" className={btnClass} disabled={!canPaste} onClick={onPaste}>
                Paste
                <span className="ml-auto text-xs text-muted-foreground">⌘V</span>
              </button>
            )}
            {onPasteAsNewCondition && (
              <button type="button" className={btnClass} disabled={!canPaste} onClick={onPasteAsNewCondition}>
                Paste as New Condition
                <span className="ml-auto text-xs text-muted-foreground">⌘⇧V</span>
              </button>
            )}
            <div className="my-1 border-t border-border" />
          </>
        )}

        {/* Z-order section */}
        <button
          type="button"
          className={btnClass}
          disabled={!canBringForward}
          onClick={() => { if (canBringForward) onBringForward?.(); }}
        >
          Bring forward
        </button>
        <button
          type="button"
          className={btnClass}
          disabled={!canSendBackward}
          onClick={() => { if (canSendBackward) onSendBackward?.(); }}
        >
          Send backward
        </button>
        <button
          type="button"
          className={btnClass}
          disabled={!canSendToBack}
          onClick={() => { if (canSendToBack) onSendToBack?.(); }}
        >
          Send to back
        </button>
        <div className="my-1 border-t border-border" />
        <button type="button" className={btnClass} onClick={onSelectAllSimilar}>
          Select all similar
        </button>

        {/* Move to condition — always shown when handler provided */}
        {onMoveToCondition && (
          <>
            <div className="my-1 border-t border-border" />
            <button
              ref={moveToRef}
              type="button"
              className={btnClass}
              onMouseEnter={() => setShowConditionSubmenu(true)}
              onMouseLeave={(e) => {
                if (!submenuRef.current?.contains(e.relatedTarget as Node)) {
                  setShowConditionSubmenu(false);
                }
              }}
            >
              Move to condition
              <span className="ml-auto">›</span>
            </button>
          </>
        )}
      </div>

      {showConditionSubmenu && onMoveToCondition && (
        <div
          ref={submenuRef}
          className="min-w-[220px] rounded-md border bg-popover text-popover-foreground py-1 shadow-lg"
          style={getSubmenuStyle()}
          onMouseEnter={() => setShowConditionSubmenu(true)}
          onMouseLeave={() => setShowConditionSubmenu(false)}
        >
          {availableConditions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground italic">
              No other compatible conditions
            </div>
          ) : (
            availableConditions.map((cond) => (
              <button
                key={cond.id}
                type="button"
                className={btnClass}
                onClick={() => onMoveToCondition(cond.id)}
              >
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-sm"
                  style={{ backgroundColor: cond.color }}
                />
                <span className="truncate">{cond.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </>
  );
}
