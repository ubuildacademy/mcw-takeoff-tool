import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Link2, Trash2, Sparkles, Eraser } from 'lucide-react';
import { toast } from 'sonner';
import { useUserPreferencesStore } from '../store/slices/userPreferencesSlice';
import { isAutoHyperlinkUiEnabled } from '../services/batchHyperlink/batchHyperlinkFeature';
import type { BatchHyperlinkPreflightResult } from '../services/batchHyperlink/batchHyperlinkPreflight';
import type { DocumentOCRData } from '../services/serverOcrService';

export interface ToolsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when user clicks Add hyperlink. Closes dialog and enters link mode. */
  onAddHyperlink?: () => void;
  /** Called when user clicks Clear all hyperlinks */
  onClearHyperlinks?: () => void;
  /** Step 1: load stored OCR and return preflight stats (single fetch). */
  onPreflightAutoHyperlink?: (opts: { scope: 'project' | 'current' }) => Promise<BatchHyperlinkPreflightResult>;
  /** Step 2: run detection using OCR map from preflight (no second fetch). */
  onExecuteAutoHyperlink?: (opts: {
    scope: 'project' | 'current';
    /** strict = SEE/MATCH cues required; loose = broader callout detection (default). */
    mode: 'strict' | 'loose';
    ocrByDocumentId: Map<string, DocumentOCRData>;
    /**
     * Documents to run a PyMuPDF (MuPDF) text re-extract pass on before detection. PyMuPDF
     * catches callout-bubble glyphs that PDF.js silently drops, and only takes a few seconds
     * per document.
     */
    runPymupdfFor?: BatchHyperlinkPreflightResult['documentsNeedingPymupdf'];
    /**
     * Documents to run the region-targeted bubble-OCR pass on before detection. The bubble
     * pass detects circular callout shapes with OpenCV and OCRs each tiny crop with Tesseract,
     * catching the most common pattern that pure text extraction misses: vector-path glyphs
     * inside detail/section bubbles.
     */
    runBubbleOcrFor?: BatchHyperlinkPreflightResult['documentsNeedingBubbleOcr'];
  }) => Promise<void>;
  /** Remove only auto-generated (batch) hyperlinks for this project. */
  onClearBatchHyperlinks?: () => void;
  /** When false, Auto-hyperlink controls are hidden (e.g. missing project). */
  autoHyperlinkAvailable?: boolean;
  /** Active PDF id for "Current document" scope. */
  currentDocumentId?: string | null;
}

/** Reusable checkbox row for settings. */
function SettingsCheckbox({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border border-primary accent-primary focus:ring-2 focus:ring-ring focus:ring-offset-2"
        />
        <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
          {label}
        </Label>
      </div>
      {description && (
        <p className="text-xs text-muted-foreground ml-7">{description}</p>
      )}
    </>
  );
}

export function ToolsDialog({
  open,
  onOpenChange,
  onAddHyperlink,
  onClearHyperlinks,
  onPreflightAutoHyperlink,
  onExecuteAutoHyperlink,
  onClearBatchHyperlinks,
  autoHyperlinkAvailable = false,
  currentDocumentId = null,
}: ToolsDialogProps) {
  const crosshairFullScreen = useUserPreferencesStore((s) => s.crosshairFullScreen);
  const crosshairColor = useUserPreferencesStore((s) => s.crosshairColor);
  const crosshairStrokeWidth = useUserPreferencesStore((s) => s.crosshairStrokeWidth);
  const setCrosshairFullScreen = useUserPreferencesStore((s) => s.setCrosshairFullScreen);
  const setCrosshairColor = useUserPreferencesStore((s) => s.setCrosshairColor);
  const setCrosshairStrokeWidth = useUserPreferencesStore((s) => s.setCrosshairStrokeWidth);
  const defaultOrthoSnapping = useUserPreferencesStore((s) => s.defaultOrthoSnapping);
  const setDefaultOrthoSnapping = useUserPreferencesStore((s) => s.setDefaultOrthoSnapping);
  const showMeasurementLabels = useUserPreferencesStore((s) => s.showMeasurementLabels);
  const setShowMeasurementLabels = useUserPreferencesStore((s) => s.setShowMeasurementLabels);
  const showRunningLength = useUserPreferencesStore((s) => s.showRunningLength);
  const setShowRunningLength = useUserPreferencesStore((s) => s.setShowRunningLength);
  const magnifierEnabled = useUserPreferencesStore((s) => s.magnifierEnabled);
  const magnifierZoom = useUserPreferencesStore((s) => s.magnifierZoom);
  const setMagnifierEnabled = useUserPreferencesStore((s) => s.setMagnifierEnabled);
  const setMagnifierZoom = useUserPreferencesStore((s) => s.setMagnifierZoom);

  const showAutoHyperlink = isAutoHyperlinkUiEnabled() && Boolean(onPreflightAutoHyperlink && onExecuteAutoHyperlink);
  const [autoScope, setAutoScope] = useState<'project' | 'current'>('project');
  const [autoMode, setAutoMode] = useState<'strict' | 'loose'>('loose');
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightResult, setPreflightResult] = useState<BatchHyperlinkPreflightResult | null>(null);
  const [executeRunning, setExecuteRunning] = useState(false);
  const [runPymupdfFirst, setRunPymupdfFirst] = useState(true);

  useEffect(() => {
    if (!open) {
      setPreflightOpen(false);
      setPreflightResult(null);
      setPreflightLoading(false);
      setExecuteRunning(false);
    }
  }, [open]);

  const handleAddHyperlink = () => {
    onOpenChange(false);
    onAddHyperlink?.();
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="tools-dialog-description">
        <DialogHeader>
          <DialogTitle>Tools</DialogTitle>
          <DialogDescription id="tools-dialog-description">
            Preferences and tools for takeoff and navigation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2 max-h-[70vh] overflow-y-auto">
          {/* Preferences */}
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Preferences</h3>

            {/* Crosshairs */}
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Shown when drawing conditions, calibrating, or annotating.
              </p>
              <SettingsCheckbox
                id="crosshair-fullscreen"
                checked={crosshairFullScreen}
                onChange={setCrosshairFullScreen}
                label="Full-screen crosshairs"
              />
              <div className="flex items-center gap-3">
                <Label htmlFor="crosshair-color" className="text-sm font-normal shrink-0">
                  Color
                </Label>
                <input
                  id="crosshair-color"
                  type="color"
                  value={crosshairColor}
                  onChange={(e) => setCrosshairColor(e.target.value)}
                  className="h-8 w-12 rounded border border-input cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-3">
                <Label htmlFor="crosshair-stroke-width" className="text-sm font-normal shrink-0">
                  Thickness
                </Label>
                <input
                  id="crosshair-stroke-width"
                  type="range"
                  min="0.5"
                  max="5"
                  step="0.5"
                  value={crosshairStrokeWidth}
                  onChange={(e) => setCrosshairStrokeWidth(Number(e.target.value))}
                  className="h-2 w-32 cursor-pointer accent-primary"
                />
                <span className="text-xs text-muted-foreground tabular-nums w-8">{crosshairStrokeWidth}px</span>
              </div>
            </div>

            <SettingsCheckbox
              id="default-ortho-snapping"
              checked={defaultOrthoSnapping}
              onChange={setDefaultOrthoSnapping}
              label="Enable ortho snapping by default"
              description="Constrains drawing to horizontal or vertical lines. Toggle with Shift during a session."
            />

            <SettingsCheckbox
              id="show-measurement-labels"
              checked={showMeasurementLabels}
              onChange={setShowMeasurementLabels}
              label="Show labels on completed measurements"
              description={'Displays the value (e.g. 12\'-6" LF, 450 SF) on each measurement.'}
            />

            <SettingsCheckbox
              id="show-running-length"
              checked={showRunningLength}
              onChange={setShowRunningLength}
              label="Show running length while drawing"
              description="Shows a live length tooltip during continuous linear drawing."
            />

            {/* Magnifier */}
            <div className="space-y-2 pt-2">
              <p className="text-sm text-muted-foreground">
                Zoomed view near cursor for precise point placement.
              </p>
              <SettingsCheckbox
                id="magnifier-enabled"
                checked={magnifierEnabled}
                onChange={setMagnifierEnabled}
                label="Enable magnifier"
                description="Shows a magnified region when drawing or measuring."
              />
              {magnifierEnabled && (
                <div className="flex items-center gap-3 ml-7">
                  <Label htmlFor="magnifier-zoom" className="text-sm font-normal shrink-0">
                    Zoom
                  </Label>
                  <select
                    id="magnifier-zoom"
                    value={magnifierZoom}
                    onChange={(e) => setMagnifierZoom(Number(e.target.value) as 2 | 3 | 4)}
                    className="h-8 rounded border border-input bg-background px-2 text-sm"
                  >
                    <option value={2}>2×</option>
                    <option value={3}>3×</option>
                    <option value={4}>4×</option>
                  </select>
                </div>
              )}
            </div>
          </section>

          <hr className="border-border" />

          {/* Hyperlinks */}
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-foreground">Hyperlinks</h3>
            <p className="text-sm text-muted-foreground">
              Draw a box to link by hand, or use <span className="font-medium text-foreground">Auto-hyperlink</span> to
              turn sheet callouts into taps that jump to the right page. It uses your saved searchable text and sheet
              numbers in the sidebar.
            </p>

            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={handleAddHyperlink}
                disabled={!onAddHyperlink}
              >
                <Link2 className="w-4 h-4 mr-2 shrink-0" />
                Add hyperlink (H)
              </Button>

              {showAutoHyperlink && (
                <>
                  <div className="ml-0 space-y-2 rounded-md border border-border p-3 bg-muted/30">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-normal">Which files to scan</Label>
                      <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="auto-hyperlink-scope"
                            checked={autoScope === 'project'}
                            onChange={() => setAutoScope('project')}
                            className="accent-primary"
                          />
                          Entire project
                        </label>
                        <label
                          className={`flex items-center gap-2 text-sm ${currentDocumentId ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                        >
                          <input
                            type="radio"
                            name="auto-hyperlink-scope"
                            checked={autoScope === 'current'}
                            onChange={() => currentDocumentId && setAutoScope('current')}
                            disabled={!currentDocumentId}
                            className="accent-primary"
                          />
                          Current document
                        </label>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-normal">Detection mode</Label>
                      <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="auto-hyperlink-mode"
                            checked={autoMode === 'loose'}
                            onChange={() => setAutoMode('loose')}
                            className="accent-primary"
                          />
                          Loose (recommended) — finds more callouts
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="auto-hyperlink-mode"
                            checked={autoMode === 'strict'}
                            onChange={() => setAutoMode('strict')}
                            className="accent-primary"
                          />
                          Strict — only near SEE / DET / REF cues
                        </label>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    disabled={!autoHyperlinkAvailable || preflightLoading || executeRunning}
                    onClick={async () => {
                      if (!onPreflightAutoHyperlink) return;
                      setPreflightLoading(true);
                      try {
                        const stats = await onPreflightAutoHyperlink({ scope: autoScope });
                        setPreflightResult(stats);
                        setPreflightOpen(true);
                      } catch (e) {
                        console.error(e);
                        toast.error(e instanceof Error ? e.message : 'Preflight failed');
                      } finally {
                        setPreflightLoading(false);
                      }
                    }}
                  >
                    <Sparkles className="w-4 h-4 mr-2 shrink-0" />
                    {preflightLoading ? 'Checking…' : 'Auto-hyperlink'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start text-muted-foreground"
                    disabled={!onClearBatchHyperlinks || !autoHyperlinkAvailable}
                    onClick={() => onClearBatchHyperlinks?.()}
                  >
                    <Eraser className="w-4 h-4 mr-2 shrink-0" />
                    Clear auto-hyperlinks
                  </Button>
                </>
              )}

              <Button
                variant="outline"
                size="sm"
                className="justify-start text-muted-foreground hover:text-destructive hover:border-destructive/50"
                onClick={() => {
                  onOpenChange(false);
                  onClearHyperlinks?.();
                }}
                disabled={!onClearHyperlinks}
              >
                <Trash2 className="w-4 h-4 mr-2 shrink-0" />
                Clear all hyperlinks
              </Button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>

      <Dialog open={preflightOpen} onOpenChange={setPreflightOpen}>
        <DialogContent className="sm:max-w-md" aria-describedby="auto-hyperlink-preflight-desc">
          <DialogHeader>
            <DialogTitle>Auto-hyperlink</DialogTitle>
            <DialogDescription id="auto-hyperlink-preflight-desc">
              Here’s what we found from your saved searchable text. We can also re-read each PDF with a more permissive
              text engine before linking so callout-bubble text isn’t missed. Your hand-drawn links stay put.
            </DialogDescription>
          </DialogHeader>
          {preflightResult && (
            <ul className="text-sm space-y-1.5 list-disc pl-5 text-foreground">
              <li>
                PDFs in this run: {preflightResult.documentsInScope} ({preflightResult.documentsWithStoredOcr} with saved
                text)
              </li>
              <li>Pages of saved text: {preflightResult.totalOcrPages}</li>
              <li>
                Pages where we know each word’s position: {preflightResult.pagesWithWordBoxes}
                {preflightResult.pagesWithoutWordBoxes > 0
                  ? ` (another ${preflightResult.pagesWithoutWordBoxes} only have plain text — links may be fewer)`
                  : ''}
              </li>
              <li>
                Pages with a sheet number in the sidebar: {preflightResult.pagesWithSheetNumber} (out of{' '}
                {preflightResult.totalPagesInProject} total pages)
              </li>
              {preflightResult.ambiguousSheetNumberKeys.length > 0 && (
                <li className="text-amber-700 dark:text-amber-400">
                  Same sheet number on more than one page — we’ll skip jumping to these:{' '}
                  {preflightResult.ambiguousSheetNumberKeys.join(', ')}
                </li>
              )}
              {preflightResult.documentsMissingOcrNames.length > 0 && (
                <li className="text-amber-700 dark:text-amber-400">
                  No saved text yet for: {preflightResult.documentsMissingOcrNames.join(', ')}
                </li>
              )}
              {preflightResult.pagesWithSheetNumber === 0 && (
                <li className="text-amber-700 dark:text-amber-400">
                  No sheet numbers in the sidebar yet — set them or run title block extract first.
                </li>
              )}
            </ul>
          )}
          {preflightResult &&
            (preflightResult.documentsNeedingPymupdf.length > 0 ||
              preflightResult.documentsNeedingBubbleOcr.length > 0) && (
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
                <div className="text-sm font-medium text-foreground">
                  Re-scan text & bubbles first (recommended)
                </div>
                <p className="text-xs text-muted-foreground">
                  {preflightResult.documentsNeedingPymupdf.length > 0 && (
                    <>
                      The browser's PDF text reader misses text on{' '}
                      {preflightResult.documentsNeedingPymupdf.length === 1
                        ? '1 PDF'
                        : `${preflightResult.documentsNeedingPymupdf.length} PDFs`}
                      . We'll re-read each PDF with a more permissive engine (PyMuPDF, seconds per
                      doc).{' '}
                    </>
                  )}
                  {preflightResult.documentsNeedingBubbleOcr.length > 0 && (
                    <>
                      We'll also OCR the round callout bubbles on{' '}
                      {preflightResult.documentsNeedingBubbleOcr.length === 1
                        ? '1 PDF'
                        : `${preflightResult.documentsNeedingBubbleOcr.length} PDFs`}
                      , since they're usually drawn as line art instead of text
                      (~1–2&nbsp;seconds per page). With re-scan we also template-match split-circle
                      and cloud callout shapes.
                    </>
                  )}
                </p>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={runPymupdfFirst}
                    onChange={(e) => setRunPymupdfFirst(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                  />
                  <span>Re-extract searchable text and scan callout bubbles before adding links</span>
                </label>
              </div>
            )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setPreflightOpen(false)} disabled={executeRunning}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                !preflightResult ||
                executeRunning ||
                !onExecuteAutoHyperlink ||
                (preflightResult.documentsWithStoredOcr === 0 &&
                  (!runPymupdfFirst ||
                    (preflightResult.documentsNeedingPymupdf.length === 0 &&
                      preflightResult.documentsNeedingBubbleOcr.length === 0)))
              }
              onClick={async () => {
                if (!preflightResult || !onExecuteAutoHyperlink) return;
                setExecuteRunning(true);
                try {
                  const runPymupdfFor =
                    runPymupdfFirst && preflightResult.documentsNeedingPymupdf.length > 0
                      ? preflightResult.documentsNeedingPymupdf
                      : undefined;
                  const runBubbleOcrFor =
                    runPymupdfFirst && preflightResult.documentsNeedingBubbleOcr.length > 0
                      ? preflightResult.documentsNeedingBubbleOcr
                      : undefined;
                  await onExecuteAutoHyperlink({
                    scope: autoScope,
                    mode: autoMode,
                    ocrByDocumentId: preflightResult.ocrByDocumentId,
                    runPymupdfFor,
                    runBubbleOcrFor,
                  });
                  setPreflightOpen(false);
                  onOpenChange(false);
                } catch (e) {
                  console.error(e);
                } finally {
                  setExecuteRunning(false);
                }
              }}
            >
              {executeRunning
                ? runPymupdfFirst && preflightResult && preflightResult.documentsNeedingPymupdf.length > 0
                  ? 'Scanning text & bubbles…'
                  : 'Running…'
                : 'Add links'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
