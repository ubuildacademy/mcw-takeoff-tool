/**
 * Choose one assembly out of a library that is heading for 200+ entries.
 *
 * A `Select` was fine at three assemblies and unusable at two hundred: no
 * search, and every name in the DOM in workbook-import order. This is the
 * search box the estimator actually needs — filter as you type, arrow keys and
 * Enter to pick, brands as section headers (matching the source folder), and
 * the list capped so it scrolls instead of running off the dialog.
 *
 * No `cmdk`: popover + input + a listbox is all this needs, and a dependency
 * for it would be a bigger change than the problem.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Input } from './ui/input';
import {
  filterAssemblies,
  groupAssembliesByBrand,
  sortAssembliesByName,
} from '../utils/assemblyListFilter';

interface AssemblyOption {
  id: string;
  name: string;
  brand?: string | null;
}

interface AssemblyComboboxProps {
  id?: string;
  assemblies: AssemblyOption[];
  value: string | null;
  onChange: (assemblyId: string | null) => void;
  /** Label for the "not priced by an assembly" row, which is pinned above the search results. */
  noneLabel: string;
}

type FlatOption =
  | { kind: 'none'; id: null; name: string }
  | { kind: 'header'; label: string }
  | { kind: 'assembly'; id: string; name: string };

export function AssemblyCombobox({
  id,
  assemblies,
  value,
  onChange,
  noneLabel,
}: AssemblyComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selected = assemblies.find((assembly) => assembly.id === value) ?? null;

  const options = useMemo<FlatOption[]>(() => {
    const matched = filterAssemblies(assemblies, query);
    const groups = groupAssembliesByBrand(matched);
    const rows: FlatOption[] = [{ kind: 'none', id: null, name: noneLabel }];
    for (const group of groups) {
      // Only show brand headers when there is more than one brand in play —
      // a single-brand library (or a search that collapsed to one) would
      // otherwise put a lone header above every row for no gain.
      if (groups.length > 1) {
        rows.push({ kind: 'header', label: group.label });
      }
      for (const assembly of group.assemblies) {
        rows.push({ kind: 'assembly', id: assembly.id, name: assembly.name });
      }
    }
    return rows;
  }, [assemblies, query, noneLabel]);

  const selectableIndexes = useMemo(
    () =>
      options
        .map((option, index) => (option.kind === 'header' ? -1 : index))
        .filter((index) => index >= 0),
    [options]
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const sorted = sortAssembliesByName(assemblies);
    const selectedPos = value ? sorted.findIndex((a) => a.id === value) : -1;
    // Headers shift indexes; fall back to the None row and let the next
    // effect settle on the real selection once options rebuild.
    setActiveIndex(selectedPos >= 0 ? 1 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when it opens
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (value) {
      const index = options.findIndex(
        (option) => option.kind === 'assembly' && option.id === value
      );
      if (index >= 0) setActiveIndex(index);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settle once options exist for this open
  }, [options, open]);

  useEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const commit = (assemblyId: string | null) => {
    onChange(assemblyId);
    setOpen(false);
  };

  const moveActive = (step: 1 | -1) => {
    if (selectableIndexes.length === 0) return;
    const currentPos = selectableIndexes.indexOf(activeIndex);
    const nextPos =
      currentPos < 0
        ? step === 1
          ? 0
          : selectableIndexes.length - 1
        : (currentPos + step + selectableIndexes.length) % selectableIndexes.length;
    setActiveIndex(selectableIndexes[nextPos]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      if (selectableIndexes[0] !== undefined) setActiveIndex(selectableIndexes[0]);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      const last = selectableIndexes[selectableIndexes.length - 1];
      if (last !== undefined) setActiveIndex(last);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[activeIndex];
      if (!option || option.kind === 'header') return;
      commit(option.id);
    }
  };

  const selectedLabel = selected
    ? selected.brand
      ? `${selected.brand} — ${selected.name}`
      : selected.name
    : noneLabel;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <span className={`truncate text-left ${selected ? '' : 'text-muted-foreground'}`}>
            {selectedLabel}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search by name or brand…"
              className="h-8 pl-8"
              aria-label="Search assemblies"
            />
          </div>
        </div>
        <div role="listbox" className="max-h-72 overflow-y-auto p-1">
          {options.length === 1 && query.trim() !== '' && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              No assembly matches “{query.trim()}”.
            </p>
          )}
          {options.map((option, index) => {
            if (option.kind === 'header') {
              return (
                <div
                  key={`header-${option.label}`}
                  className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {option.label}
                </div>
              );
            }
            const isSelected = (option.id ?? null) === (value ?? null);
            return (
              <button
                key={option.id ?? '__none__'}
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(option.id)}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
                  index === activeIndex ? 'bg-accent text-accent-foreground' : ''
                } ${option.kind === 'none' ? 'text-muted-foreground' : ''}`}
              >
                <Check className={`h-4 w-4 shrink-0 ${isSelected ? '' : 'invisible'}`} />
                <span className="truncate">{option.name}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
