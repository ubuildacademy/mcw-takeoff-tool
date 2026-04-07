import { useCallback, useEffect, useRef } from 'react';
import { restoreScrollPosition, triggerFitToWindow } from '../../lib/windowBridge';
import { getSheetId } from '../../lib/sheetUtils';
import { usePdfViewerTabsStore } from '../../store/slices/pdfViewerTabsSlice';
import { useDocumentViewStore } from '../../store/slices/documentViewSlice';
import type { ProjectFile, PDFDocument } from '../../types';

const SCROLL_RESTORE_DELAYS_MS = [50, 150, 300, 500, 700, 1000];
/** Fewer follow-ups than scroll restore: fit is heavier; rAF + two delays covers layout timing. */
const FIT_TO_WINDOW_RETRY_DELAYS_MS = [150, 500];
const SCROLL_RESTORE_AFTER_SWITCH_MS = 200;

/** After tab/page switch: restore saved scroll, or (0,0) so we never inherit the previous sheet’s scroll. */
function scheduleScrollRestoreAfterSwitch(
  saved: { x: number; y: number },
  isStale: () => boolean
) {
  setTimeout(() => {
    if (isStale()) return;
    const restore =
      saved.x !== 0 || saved.y !== 0
        ? () => restoreScrollPosition(saved.x, saved.y)
        : () => restoreScrollPosition(0, 0);
    restore();
  }, SCROLL_RESTORE_AFTER_SWITCH_MS);
}

function runScrollRestoreWithRetries(
  saved: { x: number; y: number },
  isStale: () => boolean
) {
  const apply = () => {
    if (isStale()) return;
    restoreScrollPosition(saved.x, saved.y);
  };
  requestAnimationFrame(apply);
  SCROLL_RESTORE_DELAYS_MS.forEach((delay) => setTimeout(apply, delay));
}

function runFitToWindowWithRetries(isStale: () => boolean) {
  const fit = () => {
    if (isStale()) return;
    restoreScrollPosition(0, 0);
    triggerFitToWindow();
  };
  requestAnimationFrame(fit);
  FIT_TO_WINDOW_RETRY_DELAYS_MS.forEach((delay) => setTimeout(fit, delay));
}

export function getSheetLabel(
  documents: PDFDocument[],
  projectFiles: ProjectFile[],
  documentId: string,
  pageNumber: number
): string {
  const doc = documents.find((d) => d.id === documentId);
  if (doc?.pages) {
    const page = doc.pages.find((p) => p.pageNumber === pageNumber);
    if (page) {
      if (page.sheetName) return page.sheetName;
      if (page.sheetNumber) return page.sheetNumber;
    }
  }
  const file = projectFiles.find((f) => f.id === documentId);
  const docName = file?.originalName?.replace(/\.pdf$/i, '') ?? 'Document';
  return `${docName} - Page ${pageNumber}`;
}

export interface UseTakeoffWorkspaceTabsOptions {
  projectId: string | undefined;
  projectFiles: ProjectFile[];
  documents: PDFDocument[];
  /** Optional: called when scale/rotation change from store (for legacy sync). Prefer deriving scale/rotation from store in parent. */
  setScale?: (s: number) => void;
  setRotation?: (r: number) => void;
  setSelectedDocumentId: (id: string | null) => void;
  setSelectedPageNumber: (p: number | null) => void;
  setSelectedSheet: (sheet: { id: string; name: string; pageNumber: number; isVisible?: boolean; hasTakeoffs?: boolean; takeoffCount?: number } | null) => void;
}

export interface UseTakeoffWorkspaceTabsResult {
  openTabs: import('../../store/slices/pdfViewerTabsSlice').PDFViewerTab[];
  activeTabId: string | null;
  activeTab: import('../../store/slices/pdfViewerTabsSlice').PDFViewerTab | null;
  currentPdfFile: ProjectFile | null;
  currentPage: number;
  sheetId: string | null;
  handlePageSelect: (documentId: string, pageNumber: number) => void;
  handlePageOpenInNewTab: (documentId: string, pageNumber: number) => void;
  handlePageChange: (page: number) => void;
  handleTabSelect: (tabId: string) => void;
  handleTabClose: (tabId: string) => void;
  handleCloseAllOtherTabs: (tabId: string) => void;
  handleScaleChange: (scale: number) => void;
  handleRotationChange: (rotation: number) => void;
  handleRotateAllSheetsInDocument: (documentId: string, direction: 'clockwise' | 'counterclockwise') => void;
  handleLocationChange: (x: number, y: number) => void;
  handlePDFRendered: () => void;
  hasTabs: boolean;
}

export function useTakeoffWorkspaceTabs({
  projectId,
  projectFiles,
  documents,
  setScale,
  setRotation,
  setSelectedDocumentId,
  setSelectedPageNumber,
  setSelectedSheet,
}: UseTakeoffWorkspaceTabsOptions): UseTakeoffWorkspaceTabsResult {
  const openTabs = usePdfViewerTabsStore((s) =>
    projectId ? s.getOpenTabs(projectId) : []
  );
  const activeTabId = usePdfViewerTabsStore((s) =>
    projectId ? s.getActiveTabId(projectId) : null
  );
  const activeTab = usePdfViewerTabsStore((s) =>
    projectId ? s.getActiveTab(projectId) : null
  );

  const addTab = usePdfViewerTabsStore((s) => s.addTab);
  const replaceActiveTab = usePdfViewerTabsStore((s) => s.replaceActiveTab);
  const closeTab = usePdfViewerTabsStore((s) => s.closeTab);
  const closeAllOtherTabs = usePdfViewerTabsStore((s) => s.closeAllOtherTabs);
  const setActiveTab = usePdfViewerTabsStore((s) => s.setActiveTab);

  const getDocumentRotationBySheet = useDocumentViewStore(
    (s) => s.getDocumentRotationBySheet
  );
  const getDocumentLocationBySheet = useDocumentViewStore(
    (s) => s.getDocumentLocationBySheet
  );
  const setDocumentScaleBySheet = useDocumentViewStore(
    (s) => s.setDocumentScaleBySheet
  );
  const setDocumentRotationBySheet = useDocumentViewStore(
    (s) => s.setDocumentRotationBySheet
  );
  const setDocumentRotationsForDocument = useDocumentViewStore(
    (s) => s.setDocumentRotationsForDocument
  );
  const setDocumentLocationBySheet = useDocumentViewStore(
    (s) => s.setDocumentLocationBySheet
  );

  /** Bumped when `activeTab` changes so pending scroll/fit work can no-op (fast tab switching). */
  const viewportSessionRef = useRef(0);

  const currentPdfFile =
    activeTab != null
      ? projectFiles.find((f) => f.id === activeTab.documentId) ?? null
      : null;
  const currentPage = activeTab?.pageNumber ?? 1;
  const sheetId =
    activeTab != null
      ? getSheetId(activeTab.documentId, activeTab.pageNumber)
      : null;

  const handlePageSelect = useCallback(
    (documentId: string, pageNumber: number) => {
      if (!projectId) return;
      const label = getSheetLabel(documents, projectFiles, documentId, pageNumber);
      replaceActiveTab(projectId, documentId, pageNumber, label);
      setSelectedDocumentId(documentId);
      setSelectedPageNumber(pageNumber);
      const file = projectFiles.find((f) => f.id === documentId);
      if (file) {
        setSelectedSheet({
          id: documentId,
          name: label,
          pageNumber,
          isVisible: true,
          hasTakeoffs: false,
          takeoffCount: 0,
        });
      }
      // Defer until after activeTab commit + session bump so stale checks match this navigation.
      setTimeout(() => {
        const session = viewportSessionRef.current;
        const isStale = () => session !== viewportSessionRef.current;
        scheduleScrollRestoreAfterSwitch(
          getDocumentLocationBySheet(getSheetId(documentId, pageNumber)),
          isStale
        );
      }, 0);
    },
    [
      projectId,
      projectFiles,
      documents,
      replaceActiveTab,
      setSelectedDocumentId,
      setSelectedPageNumber,
      setSelectedSheet,
      getDocumentLocationBySheet,
    ]
  );

  const handlePageChange = useCallback(
    (page: number) => {
      if (!projectId || !activeTab || !currentPdfFile) return;
      const doc = documents.find((d) => d.id === activeTab.documentId);
      const totalPages = doc?.totalPages ?? 1;
      if (page < 1 || page > totalPages) return;
      const label = getSheetLabel(documents, projectFiles, currentPdfFile.id, page);
      replaceActiveTab(projectId, currentPdfFile.id, page, label);
      setSelectedPageNumber(page);
      setSelectedSheet({
        id: currentPdfFile.id,
        name: label,
        pageNumber: page,
        isVisible: true,
        hasTakeoffs: false,
        takeoffCount: 0,
      });
      setTimeout(() => {
        const session = viewportSessionRef.current;
        const isStale = () => session !== viewportSessionRef.current;
        scheduleScrollRestoreAfterSwitch(
          getDocumentLocationBySheet(getSheetId(currentPdfFile.id, page)),
          isStale
        );
      }, 0);
    },
    [
      projectId,
      activeTab,
      currentPdfFile,
      documents,
      projectFiles,
      replaceActiveTab,
      setSelectedPageNumber,
      setSelectedSheet,
      getDocumentLocationBySheet,
    ]
  );

  const handlePageOpenInNewTab = useCallback(
    (documentId: string, pageNumber: number) => {
      if (!projectId) return;
      const label = getSheetLabel(documents, projectFiles, documentId, pageNumber);
      addTab(projectId, {
        documentId,
        pageNumber,
        label,
      });
      setSelectedDocumentId(documentId);
      setSelectedPageNumber(pageNumber);
      setSelectedSheet({
        id: documentId,
        name: label,
        pageNumber,
      });
    },
    [
      projectId,
      projectFiles,
      documents,
      addTab,
      setSelectedDocumentId,
      setSelectedPageNumber,
      setSelectedSheet,
    ]
  );

  const handleTabSelect = useCallback(
    (tabId: string) => {
      if (!projectId) return;
      setActiveTab(projectId, tabId);
      const tab = openTabs.find((t) => t.id === tabId);
      if (tab) {
        setSelectedPageNumber(tab.pageNumber);
        setSelectedDocumentId(tab.documentId);
        setSelectedSheet({
          id: tab.documentId,
          name: tab.label,
          pageNumber: tab.pageNumber,
          isVisible: true,
          hasTakeoffs: false,
          takeoffCount: 0,
        });
        setTimeout(() => {
          const session = viewportSessionRef.current;
          const isStale = () => session !== viewportSessionRef.current;
          scheduleScrollRestoreAfterSwitch(
            getDocumentLocationBySheet(getSheetId(tab.documentId, tab.pageNumber)),
            isStale
          );
        }, 0);
      }
    },
    [
      projectId,
      openTabs,
      setActiveTab,
      setSelectedDocumentId,
      setSelectedPageNumber,
      setSelectedSheet,
      getDocumentLocationBySheet,
    ]
  );

  const handleTabClose = useCallback(
    (tabId: string) => {
      if (!projectId) return;
      closeTab(projectId, tabId);
    },
    [projectId, closeTab]
  );

  const handleCloseAllOtherTabs = useCallback(
    (tabId: string) => {
      if (!projectId) return;
      closeAllOtherTabs(projectId, tabId);
    },
    [projectId, closeAllOtherTabs]
  );

  const handleScaleChange = useCallback(
    (newScale: number) => {
      if (sheetId) setDocumentScaleBySheet(sheetId, newScale);
      setScale?.(newScale);
    },
    [sheetId, setScale, setDocumentScaleBySheet]
  );

  const handleRotationChange = useCallback(
    (newRotation: number) => {
      if (sheetId) setDocumentRotationBySheet(sheetId, newRotation);
      setRotation?.(newRotation);
    },
    [sheetId, setRotation, setDocumentRotationBySheet]
  );

  const handleRotateAllSheetsInDocument = useCallback(
    (documentId: string, direction: 'clockwise' | 'counterclockwise') => {
      const doc = documents.find((d) => d.id === documentId);
      const totalPages = doc?.totalPages ?? 1;
      const firstSheetId = getSheetId(documentId, 1);
      const baseRotation = getDocumentRotationBySheet(firstSheetId);
      const delta = direction === 'clockwise' ? 90 : -90;
      const newRotation = ((baseRotation + delta) % 360 + 360) % 360;
      setDocumentRotationsForDocument(documentId, newRotation, totalPages);
      // Parent derives rotation from store, so no need to call setRotation
    },
    [
      documents,
      getDocumentRotationBySheet,
      setDocumentRotationsForDocument,
    ]
  );

  const isInitialRenderRef = useRef(true);

  useEffect(() => {
    if (activeTab) {
      viewportSessionRef.current += 1;
      isInitialRenderRef.current = true;
    }
  }, [activeTab]);

  const handleLocationChange = useCallback(
    (x: number, y: number) => {
      if (sheetId) setDocumentLocationBySheet(sheetId, { x, y });
    },
    [sheetId, setDocumentLocationBySheet]
  );

  const handlePDFRendered = useCallback(() => {
    if (sheetId && isInitialRenderRef.current) {
      const session = viewportSessionRef.current;
      const isStale = () => session !== viewportSessionRef.current;
      const saved = getDocumentLocationBySheet(sheetId);
      const hasExplicit = useDocumentViewStore.getState().hasExplicitViewStateForSheet(sheetId);

      if (saved.x !== 0 || saved.y !== 0) {
        runScrollRestoreWithRetries(saved, isStale);
      } else if (!hasExplicit) {
        runFitToWindowWithRetries(isStale);
      }
      isInitialRenderRef.current = false;
    }
  }, [sheetId, getDocumentLocationBySheet]);

  return {
    openTabs,
    activeTabId,
    activeTab,
    currentPdfFile,
    currentPage,
    sheetId,
    handlePageSelect,
    handlePageOpenInNewTab,
    handlePageChange,
    handleTabSelect,
    handleTabClose,
    handleCloseAllOtherTabs,
    handleScaleChange,
    handleRotationChange,
    handleRotateAllSheetsInDocument,
    handleLocationChange,
    handlePDFRendered,
    hasTabs: openTabs.length > 0,
  };
}
