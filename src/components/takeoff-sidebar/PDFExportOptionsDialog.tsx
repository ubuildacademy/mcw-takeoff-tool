/**
 * Options for exported PDF sheet pages: per-page legend visibility/content/position
 * and how measurements are labeled on the sheets. Persisted per project.
 */
import { useState } from 'react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import { BaseDialog } from '../ui/base-dialog';
import { usePdfExportPrefsStore } from '../../store/slices/pdfExportPrefsSlice';
import type {
  LegendAnchor,
  MarkupLabelMode,
  PdfSheetExportOptions,
} from '../../utils/pdfExportUtils';

interface PDFExportOptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Called with the chosen options after they are saved; kicks off the export. */
  onExport: () => void | Promise<void>;
}

const ANCHOR_GRID: Array<Array<LegendAnchor | null>> = [
  ['top-left', 'top-center', 'top-right'],
  ['middle-left', null, 'middle-right'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
];

const LABEL_MODES: Array<{ value: MarkupLabelMode; label: string; hint: string }> = [
  { value: 'quantity', label: 'Quantity', hint: 'e.g. 1,250 SF' },
  { value: 'nameOnly', label: 'Condition name', hint: 'e.g. Deck Coating' },
  { value: 'none', label: 'None', hint: 'markup only' },
];

export function PDFExportOptionsDialog({
  open,
  onOpenChange,
  projectId,
  onExport,
}: PDFExportOptionsDialogProps) {
  const getOptions = usePdfExportPrefsStore((s) => s.getOptions);
  const setOptions = usePdfExportPrefsStore((s) => s.setOptions);

  const [draft, setDraft] = useState<PdfSheetExportOptions>(() => getOptions(projectId));

  // Re-seed from saved prefs each time the dialog opens (project may have changed).
  const [seededForOpen, setSeededForOpen] = useState(false);
  if (open && !seededForOpen) {
    setDraft(getOptions(projectId));
    setSeededForOpen(true);
  } else if (!open && seededForOpen) {
    setSeededForOpen(false);
  }

  const update = (patch: Partial<PdfSheetExportOptions>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const handleExport = async () => {
    setOptions(projectId, draft);
    onOpenChange(false);
    await onExport();
  };

  return (
    <BaseDialog
      open={open}
      onOpenChange={onOpenChange}
      title="PDF Export Options"
      maxWidth="md"
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleExport}>
            Export PDF
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label>Measurement labels on sheets</Label>
          <div className="flex gap-2">
            {LABEL_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => update({ markupLabelMode: mode.value })}
                className={`flex-1 rounded-md border px-3 py-2 text-sm text-left transition-colors ${
                  draft.markupLabelMode === mode.value
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-input hover:bg-accent text-muted-foreground'
                }`}
              >
                <span className="block font-medium">{mode.label}</span>
                <span className="block text-xs opacity-70">{mode.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="show-page-legend"
            checked={draft.showLegend}
            onCheckedChange={(checked) => update({ showLegend: checked === true })}
          />
          <Label htmlFor="show-page-legend" className="cursor-pointer">
            Show per-page quantity legend
          </Label>
        </div>

        {draft.showLegend && (
          <div className="grid grid-cols-2 gap-4 pl-6">
            <div className="space-y-2">
              <Label>Legend content</Label>
              <div className="flex flex-col gap-1.5">
                {(
                  [
                    { value: 'nameAndQty', label: 'Name + quantity' },
                    { value: 'nameOnly', label: 'Name only' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update({ legendContent: opt.value })}
                    className={`rounded-md border px-3 py-1.5 text-sm text-left transition-colors ${
                      draft.legendContent === opt.value
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-input hover:bg-accent text-muted-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Legend position</Label>
              <div
                className="grid grid-cols-3 gap-1 rounded-md border border-input bg-muted/40 p-1.5 aspect-[4/3] max-w-[10rem]"
                role="radiogroup"
                aria-label="Legend position on page"
              >
                {ANCHOR_GRID.flat().map((anchor, i) =>
                  anchor === null ? (
                    <div key={`empty-${i}`} />
                  ) : (
                    <button
                      key={anchor}
                      type="button"
                      role="radio"
                      aria-checked={draft.legendAnchor === anchor}
                      aria-label={anchor.replace('-', ' ')}
                      title={anchor.replace('-', ' ')}
                      onClick={() => update({ legendAnchor: anchor })}
                      className={`rounded-sm transition-colors ${
                        draft.legendAnchor === anchor
                          ? 'bg-primary'
                          : 'bg-background border border-input hover:bg-accent'
                      }`}
                    />
                  )
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Pick a corner that keeps your titleblock visible.
              </p>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Saved per project and reused for emailed reports.
        </p>
      </div>
    </BaseDialog>
  );
}
