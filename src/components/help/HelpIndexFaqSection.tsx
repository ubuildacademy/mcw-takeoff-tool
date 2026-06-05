import { useEffect, useState } from 'react';
import { useHelpFaq } from '../../context/HelpFaqProvider';
import { HELP_POPULAR_FAQ_IDS } from '../../content/helpContent';
import { cn } from '@/lib/utils';
import { faqAnchorId } from './helpConstants';
import { HELP_FAQ_ANCHOR_CLASS, scrollToHelpHash } from './scrollToHelpHash';
import { ChevronDown } from 'lucide-react';

export function HelpIndexFaqSection() {
  const { getFaq, loading, customized, config } = useHelpFaq();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const workspaceFaq = getFaq('workspace');
  const popular = HELP_POPULAR_FAQ_IDS.map((id) => workspaceFaq.find((item) => item.id === id)).filter(
    (item): item is NonNullable<typeof item> => Boolean(item)
  );

  useEffect(() => {
    if (loading) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#faq-')) return;
    const anchor = hash.slice(1);
    const dashboardMatches = config.dashboard.map((item) => ({
      item,
      anchor: faqAnchorId('dashboard', item.id),
    }));
    const workspaceMatches = config.workspace.map((item) => ({
      item,
      anchor: faqAnchorId('workspace', item.id),
    }));
    const match = [...dashboardMatches, ...workspaceMatches].find((row) => row.anchor === anchor)?.item;
    if (match) {
      setExpandedId(match.id);
      scrollToHelpHash(hash, 'auto');
    }
  }, [loading, config]);

  if (loading) {
    return <p className="text-sm text-muted-foreground animate-pulse">Loading FAQs…</p>;
  }

  return (
    <section className="space-y-3" aria-labelledby="help-popular-faq-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="help-popular-faq-heading" className="text-lg font-semibold text-foreground">
          Popular questions
        </h2>
        {customized && (
          <span className="text-xs text-muted-foreground">Updated by your team</span>
        )}
      </div>
      <ul className="rounded-lg border divide-y bg-card">
        {popular.map((item) => {
          const isExpanded = expandedId === item.id;
          const anchor = faqAnchorId('workspace', item.id);
          return (
            <li key={item.id} id={anchor} className={HELP_FAQ_ANCHOR_CLASS}>
              <button
                type="button"
                className="w-full flex items-start gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
                aria-expanded={isExpanded}
              >
                <ChevronDown
                  className={cn(
                    'w-4 h-4 shrink-0 mt-0.5 text-muted-foreground transition-transform',
                    isExpanded && 'rotate-180'
                  )}
                />
                <span className="text-sm font-medium text-foreground">{item.question}</span>
              </button>
              {isExpanded && (
                <p className="px-4 pb-3 pl-10 text-sm text-muted-foreground leading-relaxed">{item.answer}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
