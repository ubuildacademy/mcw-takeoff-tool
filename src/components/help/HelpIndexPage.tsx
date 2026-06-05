import { Link } from 'react-router-dom';
import { BookOpen, Keyboard, HelpCircle, ArrowRight, LifeBuoy } from 'lucide-react';
import { Button } from '../ui/button';
import { HelpGuideLayout } from './HelpGuideLayout';
import { HELP_HUB_CARDS, HELP_HUB_INTRO } from '../../content/helpContent';
import { HelpSearch } from './HelpSearch';
import { HelpIndexFaqSection } from './HelpIndexFaqSection';
import { useHelpFaq } from '../../context/HelpFaqProvider';

export function HelpIndexPage() {
  const { customized } = useHelpFaq();

  return (
    <HelpGuideLayout title="Meridian Takeoff Help">
      <div className="space-y-10">
        <div className="rounded-lg border bg-muted/30 px-5 py-5 space-y-4">
          <div className="flex items-start gap-3">
            <LifeBuoy className="w-8 h-8 text-primary shrink-0 mt-0.5" aria-hidden />
            <div className="space-y-2 min-w-0">
              <p className="text-sm text-muted-foreground leading-relaxed">{HELP_HUB_INTRO}</p>
              <p className="text-sm text-foreground">
                In the app, click <strong>Help</strong> or press{' '}
                <kbd className="px-1.5 py-0.5 rounded border bg-background text-xs font-mono">?</kbd> for quick
                answers without leaving your project.
              </p>
              {customized && (
                <p className="text-xs text-muted-foreground">
                  FAQ answers may reflect settings saved by your administrator.
                </p>
              )}
            </div>
          </div>
          <HelpSearch />
        </div>

        <HelpIndexFaqSection />

        <div>
          <h2 className="text-lg font-semibold text-foreground mb-4">Full guides</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {HELP_HUB_CARDS.map((card) => (
              <Link
                key={card.slug}
                to={`/help/${card.slug}`}
                className="group rounded-lg border bg-card p-5 shadow-sm hover:border-primary/40 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-3">
                  {card.slug === 'workspace' ? (
                    <BookOpen className="w-8 h-8 text-primary shrink-0" aria-hidden />
                  ) : (
                    <Keyboard className="w-8 h-8 text-primary shrink-0" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                      {card.title}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">{card.description}</p>
                    <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                      {card.highlights.map((item) => (
                        <li key={item} className="flex items-start gap-1.5">
                          <span className="text-primary mt-0.5" aria-hidden>
                            •
                          </span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                      Read guide
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
          <Button asChild>
            <Link to="/app">
              <HelpCircle className="w-4 h-4 mr-2" />
              Open app
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/contact">Contact support</Link>
          </Button>
        </div>
      </div>
    </HelpGuideLayout>
  );
}
