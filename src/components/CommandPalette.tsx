/**
 * ⌘K command palette: jump to sheets, activate conditions, run viewer actions
 * without leaving the keyboard. Estimators live in this app all day — palette
 * beats hunting through sidebars for every sheet switch.
 *
 * Ranking: prefix match > word-boundary match > substring, then by group order
 * (actions, conditions, sheets). No fuzzy-matching dependency needed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ArrowRight, Layers, FileText, Zap } from 'lucide-react';

export interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  /** Extra match terms (e.g. sheet name for a sheet-number label). */
  keywords?: string;
  group: 'actions' | 'conditions' | 'sheets';
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
}

const GROUP_ORDER: Record<CommandItem['group'], number> = {
  actions: 0,
  conditions: 1,
  sheets: 2,
};

const GROUP_LABEL: Record<CommandItem['group'], string> = {
  actions: 'Actions',
  conditions: 'Conditions',
  sheets: 'Sheets',
};

const GROUP_ICON: Record<CommandItem['group'], typeof Zap> = {
  actions: Zap,
  conditions: Layers,
  sheets: FileText,
};

const MAX_RESULTS = 40;

function scoreItem(item: CommandItem, query: string): number {
  if (!query) return 1;
  const haystacks = [item.label, item.sublabel ?? '', item.keywords ?? ''];
  let best = 0;
  for (const raw of haystacks) {
    const text = raw.toLowerCase();
    if (!text) continue;
    const idx = text.indexOf(query);
    if (idx === -1) continue;
    if (idx === 0) best = Math.max(best, 3);
    else if (/[\s\-_./]/.test(text[idx - 1])) best = Math.max(best, 2);
    else best = Math.max(best, 1);
  }
  return best;
}

export function CommandPalette({ open, onOpenChange, items }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .map((item) => ({ item, score: scoreItem(item, q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        const g = GROUP_ORDER[a.item.group] - GROUP_ORDER[b.item.group];
        if (g !== 0) return g;
        return a.item.label.localeCompare(b.item.label);
      })
      .slice(0, MAX_RESULTS)
      .map((r) => r.item);
  }, [items, query]);

  // Reset on open / on query change — render-phase state adjustment (no effect
  // cascade); focus stays in an effect since it touches the DOM.
  const [wasOpen, setWasOpen] = useState(false);
  const [lastQuery, setLastQuery] = useState('');
  if (open && !wasOpen) {
    setWasOpen(true);
    setQuery('');
    setLastQuery('');
    setActiveIndex(0);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }
  if (query !== lastQuery) {
    setLastQuery(query);
    setActiveIndex(0);
  }

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Keep the active row visible while arrowing.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const run = (item: CommandItem) => {
    onOpenChange(false);
    item.action();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[activeIndex];
      if (item) run(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/30 flex items-start justify-center pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="w-full max-w-lg rounded-lg border bg-popover text-popover-foreground shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Jump to sheet, condition, or action…"
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Command palette search"
          />
          <kbd className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5 shrink-0">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">No matches.</p>
          )}
          {results.map((item, i) => {
            const showGroup = i === 0 || results[i - 1].group !== item.group;
            const Icon = GROUP_ICON[item.group];
            return (
              <div key={item.id}>
                {showGroup && (
                  <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {GROUP_LABEL[item.group]}
                  </p>
                )}
                <button
                  type="button"
                  data-active={i === activeIndex}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${
                    i === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                  }`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => run(item)}
                >
                  <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {item.sublabel && (
                    <span className="ml-auto truncate text-xs text-muted-foreground max-w-[45%]">
                      {item.sublabel}
                    </span>
                  )}
                  {i === activeIndex && <ArrowRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
