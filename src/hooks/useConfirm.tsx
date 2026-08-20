/**
 * Promise-based confirmation, so a themed dialog can stand in for `window.confirm`.
 *
 * Five destructive or heavy actions used the browser's native confirm box: it cannot
 * be styled, ignores the app's dark mode, and looks nothing like the rest of Meridian.
 * `ConfirmDialog` already existed for this and was never wired up, because swapping a
 * blocking call for a React dialog normally means splitting a handler in half around
 * the user's answer.
 *
 * This keeps the call shape:
 *
 *   if (!(await confirm({ title, description }))) return;
 *
 * so each handler's control flow is unchanged from the `window.confirm` version.
 * Render `confirmDialog` anywhere in the component's tree.
 */
import { useCallback, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ui/base-dialog';

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  /** 'destructive' gives the confirm button the red treatment. */
  variant?: 'default' | 'destructive';
}

export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmDialog: React.ReactNode;
} {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  // Held across renders so both the confirm button and a dismissal (escape, the close
  // button, clicking away) settle the same pending promise, exactly once.
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(value);
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => {
    // A second prompt while one is open would strand the first promise forever.
    settle(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, [settle]);

  const confirmDialog = options ? (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (open) return;
        settle(false);
        setOptions(null);
      }}
      title={options.title}
      description={options.description}
      confirmText={options.confirmText}
      cancelText={options.cancelText}
      variant={options.variant}
      onConfirm={() => settle(true)}
    />
  ) : null;

  return { confirm, confirmDialog };
}
