import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Input } from '../ui/input';
import { cn } from '@/lib/utils';
import { useHelpFaq } from '../../context/HelpFaqProvider';
import type { HelpSurface } from '../../content/helpContent';
import { loadHelpSearchIndex } from './buildHelpSearchIndex';
import { faqToSearchEntries, searchHelp, type HelpSearchHit } from './searchHelp';
import { HELP_SEARCH_SUGGESTIONS } from './helpConstants';

export type HelpSearchProps = {
  surface?: HelpSurface;
  /** Compact layout for the help popover */
  variant?: 'default' | 'compact';
  className?: string;
  onResultClick?: () => void;
};

export function HelpSearch({ surface, variant = 'default', className, onResultClick }: HelpSearchProps) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [guideEntries, setGuideEntries] = useState<Awaited<ReturnType<typeof loadHelpSearchIndex>>>([]);
  const [indexLoading, setIndexLoading] = useState(true);
  const { getFaq, loading: faqLoading } = useHelpFaq();

  useEffect(() => {
    let cancelled = false;
    loadHelpSearchIndex()
      .then((entries) => {
        if (!cancelled) setGuideEntries(entries);
      })
      .finally(() => {
        if (!cancelled) setIndexLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const allEntries = useMemo(() => {
    const faqDashboard = faqToSearchEntries(getFaq('dashboard'), 'dashboard');
    const faqWorkspace = faqToSearchEntries(getFaq('workspace'), 'workspace');
    return [...faqDashboard, ...faqWorkspace, ...guideEntries];
  }, [getFaq, guideEntries]);

  const results = useMemo(
    () =>
      searchHelp(deferredQuery, allEntries, {
        surface,
        limit: variant === 'compact' ? 6 : 14,
      }),
    [deferredQuery, allEntries, surface, variant]
  );

  const showHint = deferredQuery.length < 2;
  const busy = (faqLoading || indexLoading) && deferredQuery.length >= 2;
  const isStale = query.trim() !== deferredQuery;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={variant === 'compact' ? 'Search help…' : 'Search guides and FAQs…'}
          className={cn('pl-9', variant === 'compact' ? 'h-9 text-sm' : 'h-10')}
          aria-label="Search help"
          role="combobox"
          aria-expanded={!showHint && results.length > 0}
          aria-controls="help-search-results"
        />
      </div>

      {variant === 'default' && showHint && (
        <div className="flex flex-wrap gap-1.5 px-0.5">
          {HELP_SEARCH_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="text-xs rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              onClick={() => setQuery(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {busy && <p className="text-xs text-muted-foreground px-1">Searching…</p>}

      {!showHint && !busy && results.length === 0 && (
        <p className="text-xs text-muted-foreground px-1">No results. Try different words or a suggestion above.</p>
      )}

      {!showHint && results.length > 0 && (
        <ul
          id="help-search-results"
          role="listbox"
          aria-label="Help search results"
          className={cn(
            'overflow-y-auto rounded-md border bg-background',
            variant === 'compact' ? 'max-h-40' : 'max-h-64',
            isStale && 'opacity-70'
          )}
        >
          {results.map((hit) => (
            <HelpSearchResultRow key={hit.id} hit={hit} onClick={onResultClick} compact={variant === 'compact'} />
          ))}
        </ul>
      )}

      {showHint && variant === 'default' && (
        <p className="text-xs text-muted-foreground px-1">
          Search FAQs and both user guides. Type at least 2 characters.
        </p>
      )}
    </div>
  );
}

function HelpSearchResultRow({
  hit,
  onClick,
  compact,
}: {
  hit: HelpSearchHit;
  onClick?: () => void;
  compact?: boolean;
}) {
  const typeLabel =
    hit.type === 'faq' ? 'FAQ' : hit.type === 'guide' ? 'Guide' : 'Section';

  return (
    <li className="border-b last:border-b-0" role="option">
      <Link
        to={hit.href}
        onClick={onClick}
        className={cn(
          'block hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          compact ? 'px-3 py-2' : 'px-3 py-2.5'
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground shrink-0 rounded border border-border px-1 py-0.5">
            {typeLabel}
          </span>
          <span className="text-sm font-medium text-foreground truncate">{hit.title}</span>
        </div>
        <p className={cn('text-muted-foreground line-clamp-2 mt-0.5', compact ? 'text-xs' : 'text-sm')}>
          {hit.snippet}
        </p>
      </Link>
    </li>
  );
}
