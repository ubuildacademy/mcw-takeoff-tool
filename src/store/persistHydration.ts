/**
 * Tracks when persisted Zustand slice stores have finished rehydrating from localStorage.
 * Viewport restore must wait for this — otherwise fit-to-window can run against empty
 * in-memory state and overwrite saved zoom/scroll before hydration completes.
 */

const hydration = {
  documentView: false,
  pdfViewerTabs: false,
};

const documentViewWaiters: Array<() => void> = [];
const pdfViewerTabsWaiters: Array<() => void> = [];

export function markDocumentViewStoreHydrated(): void {
  if (hydration.documentView) return;
  hydration.documentView = true;
  documentViewWaiters.splice(0).forEach((cb) => cb());
}

export function markPdfViewerTabsStoreHydrated(): void {
  if (hydration.pdfViewerTabs) return;
  hydration.pdfViewerTabs = true;
  pdfViewerTabsWaiters.splice(0).forEach((cb) => cb());
}

export function isDocumentViewStoreHydrated(): boolean {
  return hydration.documentView;
}

export function isPdfViewerTabsStoreHydrated(): boolean {
  return hydration.pdfViewerTabs;
}

export function areViewPersistStoresHydrated(): boolean {
  return hydration.documentView && hydration.pdfViewerTabs;
}

/** Run callback once document-view-store has rehydrated (immediately if already done). */
export function whenDocumentViewStoreHydrated(callback: () => void): () => void {
  if (hydration.documentView) {
    callback();
    return () => {};
  }
  documentViewWaiters.push(callback);
  return () => {
    const idx = documentViewWaiters.indexOf(callback);
    if (idx >= 0) documentViewWaiters.splice(idx, 1);
  };
}

/** Run callback once pdf-viewer-tabs-store has rehydrated (immediately if already done). */
export function whenPdfViewerTabsStoreHydrated(callback: () => void): () => void {
  if (hydration.pdfViewerTabs) {
    callback();
    return () => {};
  }
  pdfViewerTabsWaiters.push(callback);
  return () => {
    const idx = pdfViewerTabsWaiters.indexOf(callback);
    if (idx >= 0) pdfViewerTabsWaiters.splice(idx, 1);
  };
}
