/**
 * Typed bridge for PDF viewer / workspace globals attached to window.
 * Use these getters/setters instead of (window as any) so call sites stay type-safe.
 */

export type ScrollPosition = { x: number; y: number };

/** A deep-link landing view: point to center (0-1, unrotated PDF space) + viewer scale. */
export type NormalizedViewportTarget = { x: number; y: number; zoom: number };

export interface PDFViewerWindowGlobals {
  restoreScrollPosition?: (x: number, y: number) => void;
  getCurrentScrollPosition?: () => ScrollPosition | null;
  triggerCalibration?: () => void;
  triggerFitToWindow?: () => void;
  centerViewportOnPoint?: (target: NormalizedViewportTarget) => void;
  getNormalizedViewportCenter?: () => NormalizedViewportTarget | null;
  triggerRoomProposals?: () => void;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merge for PDF viewer globals
  interface Window extends PDFViewerWindowGlobals {}
}

// --- Scroll position (viewport persistence on reload) ---

/** Set restoreScrollPosition (called from PDFViewer on mount, cleared on unmount) */
export function setRestoreScrollPosition(fn: ((x: number, y: number) => void) | undefined): void {
  if (fn === undefined) {
    delete window.restoreScrollPosition;
  } else {
    window.restoreScrollPosition = fn;
  }
}

/** Call restoreScrollPosition if registered */
export function restoreScrollPosition(x: number, y: number): void {
  if (window.restoreScrollPosition) {
    window.restoreScrollPosition(x, y);
  }
}

/** Set getCurrentScrollPosition (called from PDFViewer on mount, cleared on unmount) */
export function setGetCurrentScrollPosition(fn: (() => ScrollPosition | null) | undefined): void {
  if (fn === undefined) {
    delete window.getCurrentScrollPosition;
  } else {
    window.getCurrentScrollPosition = fn;
  }
}

/** Get current scroll position from PDF viewer if registered (e.g. for beforeunload save) */
export function getCurrentScrollPosition(): ScrollPosition | null {
  return window.getCurrentScrollPosition?.() ?? null;
}

// --- Deep-link viewport (hyperlink to a spot at a zoom level) ---

/** Set centerViewportOnPoint (called from PDFViewer on mount, cleared on unmount) */
export function setCenterViewportOnPoint(
  fn: ((target: NormalizedViewportTarget) => void) | undefined
): void {
  if (fn === undefined) {
    delete window.centerViewportOnPoint;
  } else {
    window.centerViewportOnPoint = fn;
  }
}

/** Center the viewer on a normalized point at a zoom level, if a viewer is mounted */
export function centerViewportOnPoint(target: NormalizedViewportTarget): void {
  window.centerViewportOnPoint?.(target);
}

/** Set getNormalizedViewportCenter (called from PDFViewer on mount, cleared on unmount) */
export function setGetNormalizedViewportCenter(
  fn: (() => NormalizedViewportTarget | null) | undefined
): void {
  if (fn === undefined) {
    delete window.getNormalizedViewportCenter;
  } else {
    window.getNormalizedViewportCenter = fn;
  }
}

/** Read the current view center (normalized point + zoom) from the mounted viewer */
export function getNormalizedViewportCenter(): NormalizedViewportTarget | null {
  return window.getNormalizedViewportCenter?.() ?? null;
}

// --- Room proposals (whole-sheet magic wand) ---

/** Set triggerRoomProposals (called from PDFViewer on mount, cleared on unmount) */
export function setTriggerRoomProposals(fn: (() => void) | undefined): void {
  if (fn === undefined) {
    delete window.triggerRoomProposals;
  } else {
    window.triggerRoomProposals = fn;
  }
}

/** Run the whole-sheet room proposal pass in the mounted viewer */
export function triggerRoomProposals(): void {
  window.triggerRoomProposals?.();
}

// --- Calibration / fit ---

/** Set triggerCalibration (called from PDFViewer when onCalibrationRequest is provided) */
export function setTriggerCalibration(fn: (() => void) | undefined): void {
  if (fn === undefined) {
    delete window.triggerCalibration;
  } else {
    window.triggerCalibration = fn;
  }
}

/** Set triggerFitToWindow (called from PDFViewer on mount) */
export function setTriggerFitToWindow(fn: (() => void) | undefined): void {
  if (fn === undefined) {
    delete window.triggerFitToWindow;
  } else {
    window.triggerFitToWindow = fn;
  }
}

/** Call triggerCalibration if registered (opens calibration dialog in PDFViewer) */
export function triggerCalibration(): void {
  if (window.triggerCalibration) {
    window.triggerCalibration();
  }
}

/** Call triggerFitToWindow if registered (fits PDF to container) */
export function triggerFitToWindow(): void {
  if (window.triggerFitToWindow) {
    window.triggerFitToWindow();
  }
}
