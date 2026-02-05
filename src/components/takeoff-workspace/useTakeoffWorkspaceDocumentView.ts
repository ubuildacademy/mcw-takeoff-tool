import { useCallback, useEffect, useRef } from 'react';
import { restoreScrollPosition } from '../../lib/windowBridge';
import type { ProjectFile, Sheet } from '../../types';

/** Delays (ms) to retry scroll restore after PDF render so we catch when layout is final */
const SCROLL_RESTORE_DELAYS_MS = [50, 150, 300, 500, 700, 1000];
/** Delay (ms) before restoring scroll when user switches sheet/page (gives viewer time to mount) */
const SCROLL_RESTORE_AFTER_SWITCH_MS = 200;

export interface UseTakeoffWorkspaceDocumentViewOptions {
  projectId: string | undefined;
  projectFiles: ProjectFile[];
  currentPdfFile: ProjectFile | null;
  currentPage: number;
  totalPages: number;
  scale: number;
  rotation: number;
  isDev?: boolean;
  setCurrentPdfFile: (file: ProjectFile | null) => void;
  setSelectedDocumentId: (id: string | null) => void;
  setSelectedPageNumber: (page: number | null) => void;
  setScale: (scale: number) => void;
  setRotation: (rotation: number) => void;
  setCurrentPage: (page: number) => void;
  setSelectedSheet: (sheet: Sheet | null) => void;
  getDocumentPage: (documentId: string) => number;
  getDocumentScale: (documentId: string) => number;
  getDocumentRotation: (documentId: string) => number;
  getDocumentLocation: (documentId: string) => { x: number; y: number };
  setDocumentPage: (documentId: string, page: number) => void;
  setLastViewedDocumentId: ((projectId: string, documentId: string) => void) | undefined;
  setDocumentScale: (documentId: string, scale: number) => void;
  setDocumentRotation: (documentId: string, rotation: number) => void;
  setDocumentLocation: (documentId: string, location: { x: number; y: number }) => void;
}

export interface UseTakeoffWorkspaceDocumentViewResult {
  handlePageChange: (page: number) => void;
  handleSheetSelect: (sheet: Sheet) => void;
  handlePageSelect: (documentId: string, pageNumber: number) => void;
  handleScaleChange: (newScale: number) => void;
  handleRotationChange: (newRotation: number) => void;
  handleLocationChange: (x: number, y: number) => void;
  handlePDFRendered: () => void;
}

export function useTakeoffWorkspaceDocumentView({
  projectId,
  projectFiles,
  currentPdfFile,
  currentPage,
  totalPages,
  scale,
  rotation,
  isDev = false,
  setCurrentPdfFile,
  setSelectedDocumentId,
  setSelectedPageNumber,
  setScale,
  setRotation,
  setCurrentPage,
  setSelectedSheet,
  getDocumentPage,
  getDocumentScale,
  getDocumentRotation,
  getDocumentLocation,
  setDocumentPage,
  setLastViewedDocumentId,
  setDocumentScale,
  setDocumentRotation,
  setDocumentLocation,
}: UseTakeoffWorkspaceDocumentViewOptions): UseTakeoffWorkspaceDocumentViewResult {
  const lastRestoredFileIdRef = useRef<string | null>(null);
  const isInitialRenderRef = useRef(true);

  // Restore page/scale/rotation from store when switching documents (scroll restored in handlePDFRendered)
  useEffect(() => {
    if (!currentPdfFile || currentPdfFile.id === lastRestoredFileIdRef.current) return;

    const savedRotation = getDocumentRotation(currentPdfFile.id);
    const savedPage = getDocumentPage(currentPdfFile.id);
    const savedScale = getDocumentScale(currentPdfFile.id);

    if (savedPage !== currentPage) {
      setCurrentPage(savedPage);
      setSelectedPageNumber(savedPage);
    }
    if (savedRotation !== rotation) {
      setRotation(savedRotation);
    }
    if (savedScale !== scale) {
      setScale(savedScale);
    }

    lastRestoredFileIdRef.current = currentPdfFile.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Run only when file id changes; store getters/setters stable
    }, [currentPdfFile?.id]);

  // Reset initial render flag when file changes
  useEffect(() => {
    if (currentPdfFile) {
      isInitialRenderRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Run when file id changes; currentPdfFile?.id sufficient
  }, [currentPdfFile?.id]);

  const handlePageChange = useCallback(
    (page: number) => {
      if (page < 1 || (totalPages > 0 && page > totalPages)) {
        if (isDev) console.warn('⚠️ Invalid page number requested:', { page, totalPages, currentPage });
        return;
      }
      if (page !== currentPage) {
        if (isDev) console.log('📄 Page change:', { from: currentPage, to: page, documentId: currentPdfFile?.id });
        setCurrentPage(page);
        setSelectedPageNumber(page);
        if (currentPdfFile && projectId) {
          setDocumentPage(currentPdfFile.id, page);
          setLastViewedDocumentId?.(projectId, currentPdfFile.id);
          if (isDev) console.log('💾 Saved page to store:', { documentId: currentPdfFile.id, page });
        }
      } else if (isDev) {
        console.log('⏭️ Page change skipped - already on page', page);
      }
    },
    [totalPages, currentPage, currentPdfFile, projectId, setCurrentPage, setSelectedPageNumber, setDocumentPage, setLastViewedDocumentId, isDev]
  );

  const handleScaleChange = useCallback(
    (newScale: number) => {
      setScale(newScale);
      if (currentPdfFile) {
        setDocumentScale(currentPdfFile.id, newScale);
      }
    },
    [currentPdfFile, setScale, setDocumentScale]
  );

  const handleRotationChange = useCallback(
    (newRotation: number) => {
      setRotation(newRotation);
      if (currentPdfFile) {
        setDocumentRotation(currentPdfFile.id, newRotation);
      }
    },
    [currentPdfFile, setRotation, setDocumentRotation]
  );

  const handleLocationChange = useCallback(
    (x: number, y: number) => {
      if (currentPdfFile) {
        setDocumentLocation(currentPdfFile.id, { x, y });
      }
    },
    [currentPdfFile, setDocumentLocation]
  );

  const applySavedViewStateForFile = useCallback(
    (selectedFile: ProjectFile, pageNumber: number) => {
      setCurrentPdfFile(selectedFile);
      setScale(getDocumentScale(selectedFile.id));
      setRotation(getDocumentRotation(selectedFile.id));
      setCurrentPage(pageNumber);
      setSelectedPageNumber(pageNumber);
      setDocumentPage(selectedFile.id, pageNumber);
      if (projectId) setLastViewedDocumentId?.(projectId, selectedFile.id);
      const savedLocation = getDocumentLocation(selectedFile.id);
      if (savedLocation.x !== 0 || savedLocation.y !== 0) {
        setTimeout(() => restoreScrollPosition(savedLocation.x, savedLocation.y), SCROLL_RESTORE_AFTER_SWITCH_MS);
      }
    },
    [
      projectId,
      setCurrentPdfFile,
      setScale,
      setRotation,
      setCurrentPage,
      setSelectedPageNumber,
      setDocumentPage,
      setLastViewedDocumentId,
      getDocumentScale,
      getDocumentRotation,
      getDocumentLocation,
    ]
  );

  const handleSheetSelect = useCallback(
    (sheet: Sheet) => {
      setSelectedSheet(sheet);
      const selectedFile = projectFiles.find((file) => file.id === sheet.id);
      if (selectedFile) {
        applySavedViewStateForFile(selectedFile, getDocumentPage(selectedFile.id));
      }
    },
    [projectFiles, setSelectedSheet, applySavedViewStateForFile, getDocumentPage]
  );

  const handlePageSelect = useCallback(
    (documentId: string, pageNumber: number) => {
      setSelectedDocumentId(documentId);
      setSelectedPageNumber(pageNumber);
      const selectedFile = projectFiles.find((file) => file.id === documentId);
      if (selectedFile) {
        applySavedViewStateForFile(selectedFile, pageNumber);
      }
    },
    [projectFiles, setSelectedDocumentId, setSelectedPageNumber, applySavedViewStateForFile]
  );

  const handlePDFRendered = useCallback(() => {
    if (currentPdfFile && isInitialRenderRef.current) {
      const savedLocation = getDocumentLocation(currentPdfFile.id);
      if (savedLocation.x !== 0 || savedLocation.y !== 0) {
        const { x, y } = savedLocation;
        requestAnimationFrame(() => restoreScrollPosition(x, y));
        SCROLL_RESTORE_DELAYS_MS.forEach((delay) => setTimeout(() => restoreScrollPosition(x, y), delay));
      }
      isInitialRenderRef.current = false;
    }
  }, [currentPdfFile, getDocumentLocation]);

  return {
    handlePageChange,
    handleSheetSelect,
    handlePageSelect,
    handleScaleChange,
    handleRotationChange,
    handleLocationChange,
    handlePDFRendered,
  };
}
