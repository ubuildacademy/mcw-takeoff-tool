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
import { Link2, Trash2, Sparkles, Eraser, Monitor, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { useUserPreferencesStore } from '../store/slices/userPreferencesSlice';
import type { ThemeMode } from '../lib/theme';
import { isAutoHyperlinkUiEnabled } from '../services/batchHyperlink/batchHyperlinkFeature';
import type { BatchHyperlinkPreflightResult } from '../services/batchHyperlink/batchHyperlinkPreflight';
import {
  type AutoHyperlinkRunProgress,
  phaseLabel,
} from '../services/batchHyperlink/autoHyperlinkProgress';
import { Progress } from './ui/progress';
import type { DocumentOCRData } from '../services/serverOcrService';

/**
 * Detection mode is a dev-side default, not a user-facing choice.
 * 'loose' = broader callout detection; 'strict' = only near SEE/DET/REF cues.
 */
const AUTO_HYPERLINK_MODE: 'strict' | 'loose' = 'loose';

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
    /** Live progress sink so the run dialog can render a page-by-page bar. */
    onProgress?: (progress: AutoHyperlinkRunProgress) => void;
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
  const themeMode = useUserPreferencesStore((s) => s.themeMode);
  const setThemeMode = useUserPreferencesStore((s) => s.setThemeMode);

  const showAutoHyperlink = isAutoHyperlinkUiEnabled() && Boolean(onPreflightAutoHyperlink && onExecuteAutoHyperlink);
  const [autoScope, setAutoScope] = useState<'project' | 'current'>('project');
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightResult, setPreflightResult] = useState<BatchHyperlinkPreflightResult | null>(null);
  const [executeRunning, setExecuteRunning] = useState(false);
  /** Live run progress for the bar; null until the first tick arrives. */
  const [runProgress, setRunProgress] = useState<AutoHyperlinkRunProgress | null>(null);

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

  // Pages in scope = pages with saved text + full page counts of docs that have none yet.
  const preflightPages = preflightResult
    ? preflightResult.totalOcrPages +
      preflightResult.documentsNeedingPymupdf
        .filter((d) => d.hasNoStoredOcr)
        .reduce((n, d) => n + d.totalPages, 0)
    : 0;
  // Bubble OCR ~2s/page on docs that still need it; PyMuPDF re-extract a few seconds per doc.
  const preflightSeconds = preflightResult
    ? preflightResult.documentsNeedingBubbleOcr.reduce((n, d) => n + d.totalPages, 0) * 2 +
      preflightResult.documentsNeedingPymupdf.length * 5
    : 0;
  const preflightSummary = preflightResult
    ? `Will scan ${preflightResult.documentsInScope} PDF${preflightResult.documentsInScope === 1 ? '' : 's'} (${preflightPages} page${preflightPages === 1 ? '' : 's'}) — ${
        preflightSeconds < 60 ? 'usually under a minute' : `about ${Math.ceil(preflightSeconds / 60)} minutes`
      }.`
    : '';

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

            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-start gap-3">
                {themeMode === 'dark' ? (
                  <Moon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                ) : themeMode === 'light' ? (
                  <Sun className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <Label htmlFor="theme-mode" className="text-sm font-normal">
                      Appearance
                    </Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Choose light mode, dark mode, or follow this device.
                    </p>
                  </div>
                  <select
                    id="theme-mode"
                    value={themeMode}
                    onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>
              </div>
            </div>

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
              scan sheet callouts and detail bubbles and turn them into links — you review everything before it&rsquo;s
              applied.
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
                Add hyperlink (⇧H)
              </Button>

              {showAutoHyperlink && (
                <div className="ml-0 space-y-3 rounded-md border border-border p-3 bg-muted/30">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Sparkles className="w-4 h-4 shrink-0" />
                    Auto-hyperlink
                  </div>
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
                  <div className="flex flex-col gap-2">
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
                      {preflightLoading ? 'Checking…' : 'Run auto-hyperlink'}
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
                  </div>
                </div>
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
        <DialogContent size="fit" aria-describedby="auto-hyperlink-preflight-desc">
          <DialogHeader>
            <DialogTitle>Auto-hyperlink</DialogTitle>
            <DialogDescription id="auto-hyperlink-preflight-desc">{preflightSummary}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-foreground">
            Finds callout bubbles, matchlines, and sheet references and turns them into links. You review everything
            before it&rsquo;s applied; hand-drawn links stay put.
          </p>
          {preflightResult && preflightResult.pagesWithSheetNumber === 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              No sheet numbers in the sidebar yet — set them or run title block extract first.
            </p>
          )}
          {executeRunning && (
            <div className="space-y-1.5" aria-live="polite">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">
                  {runProgress ? phaseLabel(runProgress.phase) : 'Starting…'}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {runProgress ? Math.round(runProgress.fraction * 100) : 0}%
                </span>
              </div>
              <Progress value={runProgress ? Math.round(runProgress.fraction * 100) : 0} className="h-2" />
              <p className="text-xs text-muted-foreground tabular-nums">
                {runProgress ? `${runProgress.pagesDone}/${runProgress.totalPages} pages` : 'Preparing…'}
                {runProgress?.currentDoc && runProgress.currentDocTotal > 0 && (
                  <>
                    {' · '}
                    {runProgress.currentDoc} p{runProgress.currentDocPage}/{runProgress.currentDocTotal}
                  </>
                )}
                {runProgress && runProgress.calloutsFound > 0 && (
                  <> · {runProgress.calloutsFound} callouts found</>
                )}
              </p>
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
                  preflightResult.documentsNeedingPymupdf.length === 0 &&
                  preflightResult.documentsNeedingBubbleOcr.length === 0)
              }
              onClick={async () => {
                if (!preflightResult || !onExecuteAutoHyperlink) return;
                setExecuteRunning(true);
                setRunProgress(null);
                try {
                  await onExecuteAutoHyperlink({
                    scope: autoScope,
                    mode: AUTO_HYPERLINK_MODE,
                    ocrByDocumentId: preflightResult.ocrByDocumentId,
                    runPymupdfFor:
                      preflightResult.documentsNeedingPymupdf.length > 0
                        ? preflightResult.documentsNeedingPymupdf
                        : undefined,
                    runBubbleOcrFor:
                      preflightResult.documentsNeedingBubbleOcr.length > 0
                        ? preflightResult.documentsNeedingBubbleOcr
                        : undefined,
                    onProgress: setRunProgress,
                  });
                  setPreflightOpen(false);
                  onOpenChange(false);
                } catch (e) {
                  console.error(e);
                } finally {
                  setExecuteRunning(false);
                  setRunProgress(null);
                }
              }}
            >
              {executeRunning ? 'Running…' : 'Run'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
