import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, BookOpen, ChevronDown, MessageSquarePlus } from 'lucide-react';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '@/lib/utils';
import { isEditableKeyboardTarget } from '../../utils/keyboardUtils';
import {
  getHelpGuides,
  getHelpSubtitle,
  getWorkspaceContextTip,
  HELP_SEEN_STORAGE_KEY,
  type HelpSurface,
  type WorkspaceHelpState,
} from '../../content/helpContent';
import { useHelpFaq } from '../../context/HelpFaqProvider';
import { HelpSearch } from './HelpSearch';
import { FeedbackDialog } from '../FeedbackDialog';

export type HelpMenuProps = {
  surface: HelpSurface;
  workspaceState?: WorkspaceHelpState;
  /** Workspace header uses icon; dashboard uses larger outline button */
  variant?: 'icon' | 'outline';
  className?: string;
};

function markHelpSeen(): void {
  try {
    localStorage.setItem(HELP_SEEN_STORAGE_KEY, '1');
  } catch {
    /* ignore quota / private mode */
  }
}

function hasSeenHelp(): boolean {
  try {
    return localStorage.getItem(HELP_SEEN_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

function workspaceStateEqual(a?: WorkspaceHelpState, b?: WorkspaceHelpState): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return (
    a.hasOpenPdf === b.hasOpenPdf &&
    a.isCalibrating === b.isCalibrating &&
    a.isMeasuring === b.isMeasuring &&
    a.hasSelectedCondition === b.hasSelectedCondition
  );
}

function HelpMenuComponent({ surface, workspaceState, variant = 'icon', className }: HelpMenuProps) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNewHint, setShowNewHint] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [pendingScreenshot, setPendingScreenshot] = useState<Blob | null>(null);
  const capturingRef = useRef(false);

  const { getFaq } = useHelpFaq();
  const faq = getFaq(surface);
  const guides = getHelpGuides(surface);
  const contextTip =
    surface === 'workspace' && workspaceState ? getWorkspaceContextTip(workspaceState) : null;

  useEffect(() => {
    setShowNewHint(!hasSeenHelp());
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      markHelpSeen();
      setShowNewHint(false);
    } else {
      setExpandedId(null);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableKeyboardTarget(e.target)) return;
      e.preventDefault();
      setOpen((prev) => {
        const next = !prev;
        if (next) {
          markHelpSeen();
          setShowNewHint(false);
        }
        return next;
      });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleFeedbackClick = useCallback(() => {
    // Close the popover first so the screenshot captures the page behind it
    handleOpenChange(false);
    if (capturingRef.current) return;
    capturingRef.current = true;
    setPendingScreenshot(null);

    // Brief delay to let the popover fully close before capturing
    setTimeout(async () => {
      try {
        const { default: html2canvas } = await import('html2canvas');
        const canvas = await html2canvas(document.body, {
          useCORS: true,
          allowTaint: true,
          logging: false,
          scale: Math.min(window.devicePixelRatio, 2),
        });
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/png')
        );
        setPendingScreenshot(blob);
      } catch {
        setPendingScreenshot(null);
      } finally {
        capturingRef.current = false;
        setFeedbackOpen(true);
      }
    }, 180);
  }, [handleOpenChange]);

  return (
    <>
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant={variant === 'icon' ? 'ghost' : 'outline'}
          size={variant === 'icon' ? 'icon' : 'lg'}
          className={cn(
            variant === 'icon' ? 'shrink-0 relative' : 'relative',
            className
          )}
          aria-label="Help and guides"
          title="Help and guides (?)"
        >
          <HelpCircle className={variant === 'icon' ? 'w-4 h-4' : 'w-5 h-5 mr-2'} />
          {variant === 'outline' && 'Help'}
          {showNewHint && (
            <span
              className={cn(
                'absolute h-2 w-2 rounded-full bg-primary ring-2 ring-background',
                variant === 'icon' ? 'top-1.5 right-1.5' : 'top-2 right-2'
              )}
              aria-hidden
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        animated={false}
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="border-b px-4 py-3">
          <p className="font-semibold text-sm text-foreground">Help</p>
          <p className="text-xs text-muted-foreground mt-0.5">{getHelpSubtitle(surface)}</p>
        </div>

        {contextTip && (
          <div className="px-4 py-3 bg-muted/50 border-b text-xs text-foreground leading-snug">
            <span className="font-medium text-muted-foreground">Right now: </span>
            {contextTip}
          </div>
        )}

        <div className="px-4 py-3 border-b">
          <HelpSearch surface={surface} variant="compact" onResultClick={() => handleOpenChange(false)} />
        </div>

        <div className="max-h-[min(50vh,20rem)] overflow-y-auto px-2 py-2">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Common questions
          </p>
          <ul className="space-y-0.5">
            {faq.map((item) => {
              const isExpanded = expandedId === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="w-full flex items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    aria-expanded={isExpanded}
                  >
                    <ChevronDown
                      className={cn(
                        'w-4 h-4 shrink-0 mt-0.5 text-muted-foreground transition-transform',
                        isExpanded && 'rotate-180'
                      )}
                    />
                    <span className="font-medium text-foreground">{item.question}</span>
                  </button>
                  {isExpanded && (
                    <p className="px-2 pb-2 pl-8 text-xs text-muted-foreground leading-relaxed">
                      {item.answer}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="border-t px-4 py-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Guides</p>
          <ul className="space-y-2">
            {guides.map((guide) => (
              <li key={guide.id}>
                <Link
                  to={guide.href}
                  className="flex items-start gap-2 text-sm text-primary hover:underline group"
                  onClick={() => handleOpenChange(false)}
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-70" />
                  <span>
                    <span className="font-medium">{guide.label}</span>
                    {guide.description && (
                      <span className="block text-xs text-muted-foreground group-hover:text-muted-foreground">
                        {guide.description}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t px-4 py-3 flex flex-col gap-2 text-xs text-muted-foreground">
          {surface === 'workspace' && (
            <p>
              Project-specific questions? Open the{' '}
              <span className="text-foreground font-medium">AI Chat</span> tab in the right sidebar.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="flex items-center gap-3">
              <Link to="/help" className="text-primary hover:underline" onClick={() => handleOpenChange(false)}>
                Help center
              </Link>
              <Link to="/contact" className="text-primary hover:underline" onClick={() => handleOpenChange(false)}>
                Contact
              </Link>
            </div>
            <span className="tabular-nums text-muted-foreground">Press ? to toggle</span>
          </div>
        </div>

        <div className="border-t px-3 py-2.5">
          <button
            type="button"
            onClick={handleFeedbackClick}
            className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            <MessageSquarePlus className="w-4 h-4 shrink-0 text-primary" />
            Submit Feedback
            <span className="ml-auto text-xs text-muted-foreground font-normal bg-muted rounded px-1.5 py-0.5">
              Beta
            </span>
          </button>
        </div>
      </PopoverContent>
    </Popover>

    <FeedbackDialog
      open={feedbackOpen}
      onOpenChange={setFeedbackOpen}
      screenshot={pendingScreenshot}
    />
    </>
  );
}

export const HelpMenu = memo(HelpMenuComponent, (prev, next) => {
  return (
    prev.surface === next.surface &&
    prev.variant === next.variant &&
    prev.className === next.className &&
    workspaceStateEqual(prev.workspaceState, next.workspaceState)
  );
});
