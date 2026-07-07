/**
 * Revision compare: overlay two revisions of a sheet — red = linework only in
 * the old revision (removed), blue = only in the new (added) — and carry the
 * old sheet's takeoffs onto the new one, flagging any that sit on changed
 * areas for review. Rendering + diff run fully client-side (see
 * utils/pdfPageRaster.ts and utils/sheetDiff.ts); deterministic, no server.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BaseDialog } from './ui/base-dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import type { PDFDocument, TakeoffMeasurement } from '../types';
import { renderPageRaster } from '../utils/pdfPageRaster';
import { diffSheetRasters, type SheetDiffResult } from '../utils/sheetDiff';
import { useMeasurementStore } from '../store/slices/measurementSlice';
import { useUndoStore } from '../store/slices/undoSlice';

interface RevisionCompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  documents: PDFDocument[];
  /** Defaults for the NEW side (usually the sheet open in the viewer). */
  currentDocumentId: string | null;
  currentPageNumber: number | null;
}

interface SheetOption {
  key: string;
  documentId: string;
  pageNumber: number;
  label: string;
}

type Phase = 'pick' | 'running' | 'view';

const ZOOM_LEVELS = [0.5, 1, 2] as const;

function buildSheetOptions(documents: PDFDocument[]): SheetOption[] {
  const options: SheetOption[] = [];
  for (const doc of documents) {
    for (const page of doc.pages ?? []) {
      const num = page.sheetNumber && page.sheetNumber !== 'Unknown' ? page.sheetNumber : null;
      const name = page.sheetName && page.sheetName !== 'Unknown' ? page.sheetName : null;
      const sheetLabel = [num, name].filter(Boolean).join(' — ') || `p.${page.pageNumber}`;
      options.push({
        key: `${doc.id}:${page.pageNumber}`,
        documentId: doc.id,
        pageNumber: page.pageNumber,
        label: `${doc.name} · ${sheetLabel}`,
      });
    }
  }
  return options;
}

/** Normalized-bbox of a measurement's outer boundary. */
function measurementBbox(m: TakeoffMeasurement): { x0: number; y0: number; x1: number; y1: number } | null {
  const pts = m.pdfCoordinates;
  if (!pts || pts.length === 0) return null;
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

export function RevisionCompareDialog({
  open,
  onOpenChange,
  projectId,
  documents,
  currentDocumentId,
  currentPageNumber,
}: RevisionCompareDialogProps) {
  const options = useMemo(() => buildSheetOptions(documents), [documents]);
  const currentKey =
    currentDocumentId && currentPageNumber ? `${currentDocumentId}:${currentPageNumber}` : '';

  const [phase, setPhase] = useState<Phase>('pick');
  const [oldKey, setOldKey] = useState('');
  const [newKey, setNewKey] = useState('');
  const [zoom, setZoom] = useState<(typeof ZOOM_LEVELS)[number]>(0.5);
  const [diff, setDiff] = useState<SheetDiffResult | null>(null);
  const [carrying, setCarrying] = useState(false);
  const [carrySummary, setCarrySummary] = useState<{ carried: number; review: string[] } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositeRef = useRef<{ width: number; height: number } | null>(null);
  const compositeImageRef = useRef<ImageData | null>(null);
  const [compareRunId, setCompareRunId] = useState(0);

  // Seed defaults each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setPhase('pick');
    setDiff(null);
    setCarrySummary(null);
    setOldKey('');
    setNewKey(currentKey && options.some((o) => o.key === currentKey) ? currentKey : '');
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const findOption = useCallback(
    (key: string) => options.find((o) => o.key === key) ?? null,
    [options]
  );

  const handleCompare = useCallback(async () => {
    const oldOpt = findOption(oldKey);
    const newOpt = findOption(newKey);
    if (!oldOpt || !newOpt) return;
    setPhase('running');
    try {
      const [oldRaster, newRaster] = await Promise.all([
        renderPageRaster(oldOpt.documentId, oldOpt.pageNumber),
        renderPageRaster(newOpt.documentId, newOpt.pageNumber),
      ]);
      if (oldRaster.width !== newRaster.width || oldRaster.height !== newRaster.height) {
        toast.error(
          'These sheets have different page sizes — revision compare needs matching sheet sizes.'
        );
        setPhase('pick');
        return;
      }
      const result = diffSheetRasters(oldRaster, newRaster);
      setDiff(result);

      // Composite: lightened new revision + red removed / blue added overlays.
      const { width, height } = newRaster;
      const composite = new ImageData(width, height);
      const src = newRaster.data;
      const out = composite.data;
      for (let i = 0; i < width * height; i++) {
        const s = i * 4;
        const code = result.codes[i];
        if (code === 1) {
          out[s] = 220; out[s + 1] = 38; out[s + 2] = 38; out[s + 3] = 255; // removed → red
        } else if (code === 2) {
          out[s] = 37; out[s + 1] = 99; out[s + 2] = 235; out[s + 3] = 255; // added → blue
        } else {
          // Fade unchanged content so the deltas pop.
          out[s] = 178 + ((src[s] * 77) >> 8);
          out[s + 1] = 178 + ((src[s + 1] * 77) >> 8);
          out[s + 2] = 178 + ((src[s + 2] * 77) >> 8);
          out[s + 3] = 255;
        }
      }
      compositeRef.current = { width, height };
      compositeImageRef.current = composite;
      setPhase('view');
      setCompareRunId((id) => id + 1);
    } catch (error) {
      console.error('Revision compare failed:', error);
      toast.error(error instanceof Error ? error.message : 'Revision compare failed');
      setPhase('pick');
    }
  }, [oldKey, newKey, findOption]);

  // Paint the composite once the canvas has actually mounted for the 'view' phase.
  // (A rAF fired from handleCompare could run before React commits that render,
  // leaving canvasRef.current null and the canvas blank.)
  useEffect(() => {
    if (phase !== 'view') return;
    const canvas = canvasRef.current;
    const dims = compositeRef.current;
    const image = compositeImageRef.current;
    if (!canvas || !dims || !image) return;
    canvas.width = dims.width;
    canvas.height = dims.height;
    canvas.getContext('2d')?.putImageData(image, 0, 0);
  }, [phase, compareRunId]);

  const handleCarry = useCallback(async () => {
    const oldOpt = findOption(oldKey);
    const newOpt = findOption(newKey);
    const d = diff;
    const dims = compositeRef.current;
    if (!oldOpt || !newOpt || !d || !dims || carrying) return;
    if (oldOpt.key === newOpt.key) return;
    setCarrying(true);
    try {
      const store = useMeasurementStore.getState();
      const oldMeasurements = store
        .getProjectTakeoffMeasurements(projectId)
        .filter((m) => m.sheetId === oldOpt.documentId && m.pdfPage === oldOpt.pageNumber);
      if (oldMeasurements.length === 0) {
        toast.info('The old sheet has no takeoffs to carry.');
        return;
      }
      let carried = 0;
      const review: string[] = [];
      for (const m of oldMeasurements) {
        const payload = {
          projectId,
          sheetId: newOpt.documentId,
          conditionId: m.conditionId,
          type: m.type,
          points: m.points,
          calculatedValue: m.calculatedValue,
          unit: m.unit,
          pdfPage: newOpt.pageNumber,
          pdfCoordinates: m.pdfCoordinates,
          conditionColor: m.conditionColor,
          conditionName: m.conditionName,
          ...(m.perimeterValue != null && { perimeterValue: m.perimeterValue }),
          ...(m.areaValue != null && { areaValue: m.areaValue }),
          ...(m.cutouts && { cutouts: m.cutouts }),
          ...(m.arcs && { arcs: m.arcs }),
          ...(m.conditionMarkerShape && { conditionMarkerShape: m.conditionMarkerShape }),
          ...(m.conditionLineThickness != null && {
            conditionLineThickness: m.conditionLineThickness,
          }),
        };
        const newId = await store.addTakeoffMeasurement(payload);
        useUndoStore.getState().push({ type: 'measurement_add', id: newId, createPayload: payload });
        carried += 1;

        const bbox = measurementBbox(m);
        if (bbox) {
          const px = {
            x0: bbox.x0 * dims.width,
            y0: bbox.y0 * dims.height,
            x1: bbox.x1 * dims.width,
            y1: bbox.y1 * dims.height,
          };
          const overlapsChange = d.changedRegions.some(
            (r) =>
              px.x0 < r.x + r.width && px.x1 > r.x && px.y0 < r.y + r.height && px.y1 > r.y
          );
          if (overlapsChange) review.push(m.conditionName);
        }
      }
      setCarrySummary({ carried, review });
      toast.success(
        `Carried ${carried} takeoff${carried === 1 ? '' : 's'} to the new revision`,
        review.length > 0
          ? { description: `${review.length} sit on changed areas — review them.` }
          : undefined
      );
    } catch (error) {
      console.error('Carry takeoffs failed:', error);
      toast.error('Carry failed partway — check the new sheet and retry.');
    } finally {
      setCarrying(false);
    }
  }, [oldKey, newKey, diff, projectId, carrying, findOption]);

  const selectClass =
    'w-full h-9 rounded-md border border-input bg-background px-2 text-sm';

  return (
    <BaseDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Compare sheet revisions"
      maxWidth="screen"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {phase === 'view' && diff
              ? `${diff.changedRegions.length} changed area${diff.changedRegions.length === 1 ? '' : 's'} · red = removed, blue = added`
              : 'Pick the old and new revision of the same sheet.'}
          </p>
          <div className="flex gap-2">
            {phase === 'view' && (
              <Button
                variant="secondary"
                onClick={handleCarry}
                disabled={carrying || oldKey === newKey}
                title="Copy every takeoff from the old sheet onto the new one; measurements on changed areas get flagged"
              >
                {carrying ? 'Carrying…' : 'Carry takeoffs to new rev'}
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {phase !== 'view' && (
              <Button
                onClick={handleCompare}
                disabled={phase === 'running' || !findOption(oldKey) || !findOption(newKey) || oldKey === newKey}
              >
                {phase === 'running' ? 'Comparing…' : 'Compare'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="rev-old">Old revision</Label>
            <select
              id="rev-old"
              className={selectClass}
              value={oldKey}
              onChange={(e) => setOldKey(e.target.value)}
              disabled={phase === 'running'}
            >
              <option value="">Select sheet…</option>
              {options.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rev-new">New revision</Label>
            <select
              id="rev-new"
              className={selectClass}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              disabled={phase === 'running'}
            >
              <option value="">Select sheet…</option>
              {options.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {phase === 'running' && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Rendering both revisions and computing the diff…
          </p>
        )}

        {phase === 'view' && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Zoom</span>
              {ZOOM_LEVELS.map((z) => (
                <Button
                  key={z}
                  size="sm"
                  variant={zoom === z ? 'secondary' : 'ghost'}
                  onClick={() => setZoom(z)}
                >
                  {Math.round(z * 100)}%
                </Button>
              ))}
              {carrySummary && carrySummary.review.length > 0 && (
                <span className="ml-auto text-xs text-amber-600 dark:text-amber-400 font-medium">
                  ⚠ Review carried takeoffs: {[...new Set(carrySummary.review)].slice(0, 4).join(', ')}
                  {new Set(carrySummary.review).size > 4 ? '…' : ''}
                </span>
              )}
            </div>
            <div className="max-h-[65vh] min-h-[40vh] overflow-auto rounded-md border bg-muted/30">
              <canvas
                ref={canvasRef}
                style={{
                  width: compositeRef.current ? compositeRef.current.width * zoom : undefined,
                  height: compositeRef.current ? compositeRef.current.height * zoom : undefined,
                  imageRendering: zoom >= 2 ? 'pixelated' : 'auto',
                }}
              />
            </div>
          </>
        )}
      </div>
    </BaseDialog>
  );
}
