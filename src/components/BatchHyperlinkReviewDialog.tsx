/**
 * Review table for Auto-hyperlink results: nothing is written until the user
 * applies. Rows are grouped by source sheet; each row shows the detected ref,
 * the resolved target, and whether the link got an auto target view (lands
 * zoomed on the exact detail). Unmatched refs are listed with the reason so
 * detection problems are visible instead of silent.
 */
import { useMemo, useState } from 'react';
import { BaseDialog } from './ui/base-dialog';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Crosshair } from 'lucide-react';
import type { PDFDocument, SheetHyperlink } from '../types';
import type { SkippedRefSample } from '../services/batchHyperlink/runBatchHyperlinks';

export interface BatchHyperlinkReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: SheetHyperlink[];
  documents: PDFDocument[];
  /** Refs that found no target sheet — shown so the user knows what was missed. */
  noTargetRefs: SkippedRefSample[];
  /** Refs that matched multiple sheets ambiguously. */
  ambiguousRefs: SkippedRefSample[];
  /** How many selected links carry an auto target view. */
  onApply: (selected: SheetHyperlink[]) => void;
  onCancel: () => void;
}

function sheetLabel(documents: PDFDocument[], documentId: string, pageNumber: number): string {
  const doc = documents.find((d) => d.id === documentId);
  const page = doc?.pages?.find((p) => p.pageNumber === pageNumber);
  const num = page?.sheetNumber && page.sheetNumber !== 'Unknown' ? page.sheetNumber : null;
  const name = page?.sheetName && page.sheetName !== 'Unknown' ? page.sheetName : null;
  if (num || name) return [num, name].filter(Boolean).join(' — ');
  return `${doc?.name ?? 'Document'} p.${pageNumber}`;
}

export function BatchHyperlinkReviewDialog({
  open,
  onOpenChange,
  links,
  documents,
  noTargetRefs,
  ambiguousRefs,
  onApply,
  onCancel,
}: BatchHyperlinkReviewDialogProps) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);

  // Reset exclusions whenever a new result set comes in.
  const [seenLinksKey, setSeenLinksKey] = useState('');
  const linksKey = links.map((l) => l.id).join(',');
  if (open && linksKey !== seenLinksKey) {
    setSeenLinksKey(linksKey);
    setExcluded(new Set());
  }

  const groups = useMemo(() => {
    const bySource = new Map<string, SheetHyperlink[]>();
    for (const link of links) {
      const k = `${link.sourceSheetId}\0${link.sourcePageNumber}`;
      const list = bySource.get(k) ?? [];
      list.push(link);
      bySource.set(k, list);
    }
    return [...bySource.entries()]
      .map(([k, list]) => {
        const [docId, pageStr] = k.split('\0');
        return {
          label: sheetLabel(documents, docId, parseInt(pageStr, 10)),
          links: list.sort((a, b) => (a.detectedSheetRef ?? '').localeCompare(b.detectedSheetRef ?? '')),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [links, documents]);

  const selectedCount = links.length - excluded.size;
  const viewsCount = links.filter((l) => !excluded.has(l.id) && l.targetViewport).length;
  const skippedTotal = noTargetRefs.length + ambiguousRefs.length;

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = () => {
    onApply(links.filter((l) => !excluded.has(l.id)));
    onOpenChange(false);
  };

  const handleClose = () => {
    onCancel();
    onOpenChange(false);
  };

  return (
    <BaseDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
        else onOpenChange(next);
      }}
      title={`Review auto-hyperlinks (${links.length} found)`}
      maxWidth="2xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {viewsCount > 0
              ? `${viewsCount} link${viewsCount === 1 ? '' : 's'} will land zoomed on the exact detail`
              : 'Links open the target sheet at its default view'}
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={selectedCount === 0}>
              Apply {selectedCount} link{selectedCount === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Existing auto-hyperlinks are replaced; manual links are untouched.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setExcluded(new Set())}>
              Select all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExcluded(new Set(links.map((l) => l.id)))}
            >
              Select none
            </Button>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-md border divide-y">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="sticky top-0 bg-muted/90 backdrop-blur px-3 py-1.5 text-xs font-semibold">
                {group.label}
              </div>
              {group.links.map((link) => (
                <label
                  key={link.id}
                  className="flex items-center gap-3 px-3 py-1.5 text-sm hover:bg-accent/50 cursor-pointer"
                >
                  <Checkbox
                    checked={!excluded.has(link.id)}
                    onCheckedChange={() => toggle(link.id)}
                  />
                  <span className="font-mono text-xs w-20 shrink-0">{link.detectedSheetRef}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="flex-1 truncate">
                    {sheetLabel(documents, link.targetSheetId, link.targetPageNumber)}
                  </span>
                  {link.targetViewport && (
                    <span
                      className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 shrink-0"
                      title="Lands zoomed on the exact detail"
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                      detail view
                    </span>
                  )}
                </label>
              ))}
            </div>
          ))}
          {links.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted-foreground text-center">
              No hyperlinks detected.
            </p>
          )}
        </div>

        {skippedTotal > 0 && (
          <div>
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => setShowSkipped((v) => !v)}
            >
              {showSkipped ? 'Hide' : 'Show'} {skippedTotal} unmatched ref
              {skippedTotal === 1 ? '' : 's'}
            </button>
            {showSkipped && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                {noTargetRefs.map(([ref, docId, page, count]) => (
                  <p key={`nt-${ref}-${docId}-${page}`} className="text-xs text-muted-foreground">
                    <span className="font-mono">{ref}</span> ×{count} on{' '}
                    {sheetLabel(documents, docId, page)} — no sheet with that number in this project
                  </p>
                ))}
                {ambiguousRefs.map(([ref, docId, page, count]) => (
                  <p key={`am-${ref}-${docId}-${page}`} className="text-xs text-muted-foreground">
                    <span className="font-mono">{ref}</span> ×{count} on{' '}
                    {sheetLabel(documents, docId, page)} — matches multiple documents (ambiguous)
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </BaseDialog>
  );
}
