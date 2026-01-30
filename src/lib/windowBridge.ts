/**
 * Typed bridge for PDF viewer / workspace globals attached to window.
 * Use these getters/setters instead of (window as any) so call sites stay type-safe.
 */

export interface PDFViewerWindowGlobals {
  restoreScrollPosition?: (x: number, y: number) => void;
  triggerCalibration?: () => void;
  triggerFitToWindow?: () => void;
}

declare global {
  interface Window extends PDFViewerWindowGlobals {}
}

/** Get the current window object with typed PDF viewer globals */
export function getWindow(): Window & PDFViewerWindowGlobals {
  return window;
}

/** Set restoreScrollPosition (called from PDFViewer on mount, cleared on unmount) */
export function setRestoreScrollPosition(fn: ((x: number, y: number) => void) | undefined): void {
  if (fn === undefined) {
    delete window.restoreScrollPosition;
  } else {
    window.restoreScrollPosition = fn;
  }
}

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

/** Call restoreScrollPosition if registered (e.g. from TakeoffWorkspace) */
export function restoreScrollPosition(x: number, y: number): void {
  if (window.restoreScrollPosition) {
    window.restoreScrollPosition(x, y);
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
