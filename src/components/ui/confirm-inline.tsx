/**
 * Arm-then-confirm, in place.
 *
 * The admin panel is itself a large dialog, so confirming an action from inside it
 * with `ConfirmDialog` meant a modal over a modal. These actions sit in tight row
 * clusters (an icon button per user, per invitation, per assembly), and the answer
 * belongs where the question was asked — so the trigger arms itself instead: the
 * control is replaced in place by a short confirm button and a cancel, and the row
 * never leaves the screen.
 *
 * Escape, clicking away, or four seconds of no answer all disarm, so an armed control
 * left alone returns to normal rather than sitting there waiting to be clicked once.
 *
 * `ConfirmDialog` is still the right call outside the admin panel, where there is no
 * host modal to stack on and there is room for the full question. See hooks/useConfirm.
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from './button';

/** An armed control returns to normal after this long without an answer. */
const AUTO_DISARM_MS = 4000;

export interface ConfirmInlineProps {
  /** Short question on the confirm button itself, e.g. 'Delete?'. Keep it to one word. */
  confirmLabel: string;
  onConfirm: () => void;
  /** Red confirm button, for actions that destroy something. */
  destructive?: boolean;
  /** The control in its normal state. `arm` swaps it for the confirm pair. */
  trigger: (arm: () => void) => React.ReactNode;
}

export function ConfirmInline({
  confirmLabel,
  onConfirm,
  destructive = false,
  trigger,
}: ConfirmInlineProps) {
  const [armed, setArmed] = React.useState(false);
  const containerRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!armed) return;
    const disarm = () => setArmed(false);
    const timer = setTimeout(disarm, AUTO_DISARM_MS);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') disarm();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) disarm();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [armed]);

  if (!armed) return <>{trigger(() => setArmed(true))}</>;

  return (
    <span ref={containerRef} className="inline-flex items-center gap-1">
      <Button
        size="sm"
        variant={destructive ? 'destructive' : 'default'}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        autoFocus
      >
        {confirmLabel}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setArmed(false)} aria-label="Cancel">
        <X className="w-4 h-4" />
      </Button>
    </span>
  );
}
