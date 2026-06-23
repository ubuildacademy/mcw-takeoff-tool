import { useEffect, useState } from 'react';
import {
  areViewPersistStoresHydrated,
  isDocumentViewStoreHydrated,
  isPdfViewerTabsStoreHydrated,
  markDocumentViewStoreHydrated,
  markPdfViewerTabsStoreHydrated,
  whenDocumentViewStoreHydrated,
  whenPdfViewerTabsStoreHydrated,
} from './persistHydration';

/** True once document-view and pdf-viewer-tabs stores have rehydrated from localStorage. */
export function useViewStoresHydrated(): boolean {
  const [hydrated, setHydrated] = useState(areViewPersistStoresHydrated);

  useEffect(() => {
    if (hydrated) return;

    const trySetHydrated = () => {
      if (areViewPersistStoresHydrated()) {
        setHydrated(true);
      }
    };

    const unsubDoc = whenDocumentViewStoreHydrated(trySetHydrated);
    const unsubTabs = whenPdfViewerTabsStoreHydrated(trySetHydrated);
    trySetHydrated();

    // Safety net: never block the workspace if rehydration callbacks were missed (e.g. HMR).
    const timeoutId = window.setTimeout(() => {
      if (!areViewPersistStoresHydrated()) {
        markDocumentViewStoreHydrated();
        markPdfViewerTabsStoreHydrated();
      }
      setHydrated(true);
    }, 250);

    return () => {
      unsubDoc();
      unsubTabs();
      window.clearTimeout(timeoutId);
    };
  }, [hydrated]);

  return hydrated;
}

export {
  areViewPersistStoresHydrated,
  isDocumentViewStoreHydrated,
  isPdfViewerTabsStoreHydrated,
  whenDocumentViewStoreHydrated,
  whenPdfViewerTabsStoreHydrated,
};
