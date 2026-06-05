import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, X } from 'lucide-react';
import { Button } from '../ui/button';
import { HELP_WELCOME_DISMISSED_KEY } from '../../content/helpContent';

function isWelcomeDismissed(): boolean {
  try {
    return localStorage.getItem(HELP_WELCOME_DISMISSED_KEY) === '1';
  } catch {
    return true;
  }
}

export function HelpWelcomeBanner() {
  const [visible, setVisible] = useState(() => !isWelcomeDismissed());

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(HELP_WELCOME_DISMISSED_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <div
      className="mb-6 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4"
      role="status"
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <HelpCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-medium text-foreground">New to Meridian Takeoff?</p>
          <p className="text-sm text-muted-foreground mt-1 leading-snug">
            Use <strong>Help</strong> in the header or press{' '}
            <kbd className="px-1 py-0.5 rounded border bg-background text-xs font-mono">?</kbd> in a project for
            shortcuts and tips. Browse the{' '}
            <Link to="/help" className="text-primary hover:underline" onClick={dismiss}>
              full guides
            </Link>{' '}
            anytime.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 sm:ml-auto">
        <Button variant="outline" size="sm" asChild>
          <Link to="/help/workspace" onClick={dismiss}>
            Get started
          </Link>
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={dismiss} aria-label="Dismiss welcome tip">
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
