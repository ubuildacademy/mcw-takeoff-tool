import type { TakeoffMeasurement } from '../types';
import type { Measurement } from '../components/PDFViewer.types';

/** Safely convert API timestamp to ISO string; avoids RangeError for invalid dates */
export function safeTimestampToISO(ts: string | number | undefined | null): string {
  if (ts == null || ts === '') return new Date().toISOString();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Map store/API takeoff row to the shape PDFViewer + SVG renderers expect (keeps fields like stackOrder in sync). */
export function takeoffMeasurementToPdfViewerMeasurement(m: TakeoffMeasurement): Measurement | null {
  try {
    return {
      id: m.id,
      projectId: m.projectId,
      sheetId: m.sheetId,
      conditionId: m.conditionId,
      type: m.type,
      points: m.points,
      calculatedValue: m.calculatedValue,
      unit: m.unit,
      timestamp: safeTimestampToISO(m.timestamp),
      pdfPage: m.pdfPage,
      pdfCoordinates: m.pdfCoordinates,
      conditionColor: m.conditionColor,
      conditionName: m.conditionName,
      perimeterValue: m.perimeterValue ?? undefined,
      areaValue: m.areaValue ?? undefined,
      cutouts: m.cutouts,
      netCalculatedValue: m.netCalculatedValue ?? undefined,
      stackOrder: m.stackOrder ?? 0,
    };
  } catch {
    return null;
  }
}
