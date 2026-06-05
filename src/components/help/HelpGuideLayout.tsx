import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, HelpCircle } from 'lucide-react';
import { Button } from '../ui/button';
import type { HelpGuideSlug } from '../../content/helpContent';
import { HELP_GUIDE_TITLES } from '../../content/helpContent';
import { HELP_SIDEBAR_STICKY_CLASS } from './helpConstants';

type HelpGuideLayoutProps = {
  title: string;
  currentSlug?: HelpGuideSlug;
  children: ReactNode;
  aside?: ReactNode;
  actions?: ReactNode;
};

export function HelpGuideLayout({ title, currentSlug, children, aside, actions }: HelpGuideLayoutProps) {
  const otherSlug: HelpGuideSlug | null =
    currentSlug === 'workspace' ? 'shortcuts' : currentSlug === 'shortcuts' ? 'workspace' : null;
  const otherTitle = otherSlug ? HELP_GUIDE_TITLES[otherSlug] : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="help-guide-header sticky top-0 z-50 border-b border-border bg-background shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <Button variant="ghost" size="sm" asChild className="shrink-0 h-8">
                <Link to="/help">
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Help home
                </Link>
              </Button>
              <Button variant="ghost" size="sm" asChild className="shrink-0 h-8">
                <Link to="/app">App</Link>
              </Button>
              <div className="flex items-center gap-2 min-w-0 border-l border-border pl-2 ml-0.5">
                <HelpCircle className="w-5 h-5 shrink-0 text-primary" aria-hidden />
                <h1 className="text-base sm:text-lg font-semibold leading-tight">{title}</h1>
              </div>
            </div>
            <nav className="flex items-center gap-2 text-sm shrink-0">
              {otherSlug && otherTitle && (
                <>
                  <Link
                    to={`/help/${otherSlug}`}
                    className="text-primary hover:underline whitespace-nowrap"
                  >
                    {otherTitle}
                  </Link>
                  <span className="text-muted-foreground" aria-hidden>
                    ·
                  </span>
                </>
              )}
              <Link to="/contact" className="text-muted-foreground hover:text-foreground whitespace-nowrap">
                Contact
              </Link>
            </nav>
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/80">{actions}</div>
          )}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col lg:flex-row gap-8 lg:gap-10">
        {aside && (
          <aside className="lg:w-52 shrink-0 help-no-print">
            <nav className={HELP_SIDEBAR_STICKY_CLASS}>{aside}</nav>
          </aside>
        )}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
