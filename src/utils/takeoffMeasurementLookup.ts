import { useConditionStore } from '../store/slices/conditionSlice';
import type { TakeoffCondition, TakeoffMeasurement } from '../types';

/** API/legacy rows may use string or number for pdf_page; keep page filtering consistent with the measurement store. */
export function samePdfPageKey(a: number | string | undefined, b: number | string | undefined): boolean {
  return Number(a) === Number(b);
}

/** Tool mode for placing takeoff measurements; matches PDFViewer condition-selection logic. */
export type MeasurementDrawMode = 'linear' | 'area' | 'volume' | 'count';

/** Map a takeoff condition to draw mode (excludes auto-count — use caller guards). */
export function measurementDrawModeForCondition(condition: TakeoffCondition): MeasurementDrawMode {
  if (condition.type === 'count') return 'count';
  if (condition.type === 'volume') return 'volume';
  if (condition.type === 'area') return 'area';
  if (condition.type === 'linear') return 'linear';
  if (condition.unit === 'EA' || condition.unit === 'each') return 'count';
  if (condition.unit === 'SF' || condition.unit === 'sq ft') return 'area';
  if (condition.unit === 'CY' || condition.unit === 'cu yd') return 'volume';
  return 'linear';
}

export type PageTakeoffMeasurementsGetter = (
  projectId: string,
  fileId: string,
  page: number
) => TakeoffMeasurement[];

/**
 * Resolve a measurement by id from local page cache, then from the store page slice if needed.
 */
export function findTakeoffMeasurementOnPage(
  measurementId: string,
  localTakeoffMeasurements: TakeoffMeasurement[],
  projectId: string,
  fileId: string,
  currentPage: number,
  getPageTakeoffMeasurements: PageTakeoffMeasurementsGetter
): TakeoffMeasurement | undefined {
  let m = localTakeoffMeasurements.find((x) => x.id === measurementId);
  if (!m && projectId && fileId) {
    m = getPageTakeoffMeasurements(projectId, fileId, currentPage).find((x) => x.id === measurementId);
  }
  return m;
}

/**
 * When the user selects a measurement on the plan, align the condition store in the same tick as
 * markup selection so PDFViewer’s measurement-mode effect does not see a stale condition.
 */
export function syncStoreConditionFromMeasurementId(
  measurementId: string,
  localTakeoffMeasurements: TakeoffMeasurement[],
  projectId: string | null,
  fileId: string,
  currentPage: number,
  getPageTakeoffMeasurements: PageTakeoffMeasurementsGetter
): void {
  const m = findTakeoffMeasurementOnPage(
    measurementId,
    localTakeoffMeasurements,
    projectId ?? '',
    fileId,
    currentPage,
    getPageTakeoffMeasurements
  );
  if (m?.conditionId) {
    useConditionStore.getState().setSelectedCondition(m.conditionId);
  }
}

/** Clear condition highlight when canvas markup selection is cleared (empty click, toggle off, etc.). */
export function clearCanvasConditionSelection(): void {
  useConditionStore.getState().setSelectedCondition(null);
}

/**
 * True when only measurement markups are selected on the canvas (no annotations) and every
 * selected measurement belongs to {@link conditionId}. Used to stay in markup selection mode
 * for multi-select (e.g. "Select all similar") instead of entering sidebar-driven draw mode.
 */
export function canvasMeasurementSelectionMatchesCondition(
  selectedMeasurementIds: string[],
  selectedAnnotationIds: string[],
  selectedMarkupIds: string[],
  conditionId: string | null,
  localTakeoffMeasurements: TakeoffMeasurement[],
  projectId: string,
  fileId: string,
  currentPage: number,
  getPageTakeoffMeasurements: PageTakeoffMeasurementsGetter
): boolean {
  if (!conditionId) return false;
  if (selectedMarkupIds.length === 0 || selectedAnnotationIds.length > 0) return false;
  if (selectedMeasurementIds.length === 0) return false;
  return selectedMeasurementIds.every((mid) => {
    const m = findTakeoffMeasurementOnPage(
      mid,
      localTakeoffMeasurements,
      projectId,
      fileId,
      currentPage,
      getPageTakeoffMeasurements
    );
    return m != null && m.conditionId === conditionId;
  });
}
