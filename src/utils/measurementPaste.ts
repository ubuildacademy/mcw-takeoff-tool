/**
 * The payload for a pasted copy of a measurement.
 *
 * This object was built inline in four places — context-menu paste and
 * context-menu "paste as new condition" in PDFViewer.tsx, and the ⌘V and
 * ⌘⇧V equivalents in usePDFViewerInteractions.ts. All four were the same
 * ~25 lines, and the two in PDFViewer.tsx hardcoded the nudge offset while a
 * `_PASTE_OFFSET` constant sat unused above them, so the constant had already
 * half-decayed. Adding a field to a measurement meant remembering all four.
 *
 * Callers keep their own handling of the returned promise: ⌘V pushes an undo
 * entry and the context-menu paste does not, which is existing behaviour this
 * does not change.
 */
import type { TakeoffMeasurement } from '../types';

/** Pasted copies land slightly down-right of the original so they are visibly separate. */
const PASTE_OFFSET = 0.02;

export interface PasteTarget {
  projectId: string;
  sheetId: string;
  pdfPage: number;
  /** The condition the copy belongs to — the source's own, or a newly created one. */
  conditionId: string;
  conditionColor: string;
  conditionName: string;
}

const offsetPoint = (p: { x: number; y: number }) => ({
  x: p.x + PASTE_OFFSET,
  y: p.y + PASTE_OFFSET,
});

export function buildPastedMeasurementPayload(
  m: TakeoffMeasurement,
  target: PasteTarget
): Omit<TakeoffMeasurement, 'id' | 'timestamp'> {
  return {
    projectId: target.projectId,
    sheetId: target.sheetId,
    pdfPage: target.pdfPage,
    conditionId: target.conditionId,
    type: m.type,
    points: m.points.map(offsetPoint),
    pdfCoordinates: m.pdfCoordinates.map(offsetPoint),
    calculatedValue: m.calculatedValue,
    unit: m.unit,
    conditionColor: target.conditionColor,
    conditionName: target.conditionName,
    ...(m.conditionMarkerShape && { conditionMarkerShape: m.conditionMarkerShape }),
    ...(m.perimeterValue != null && { perimeterValue: m.perimeterValue }),
    ...(m.areaValue != null && { areaValue: m.areaValue }),
    ...(m.cutouts && m.cutouts.length > 0 && {
      cutouts: m.cutouts.map((c) => ({
        ...c,
        points: c.points.map(offsetPoint),
        pdfCoordinates: c.pdfCoordinates.map(offsetPoint),
      })),
    }),
    ...(m.netCalculatedValue != null && { netCalculatedValue: m.netCalculatedValue }),
    ...(m.description != null && { description: m.description }),
  };
}
