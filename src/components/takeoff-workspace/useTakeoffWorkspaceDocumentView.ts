import { useCallback, useEffect, useRef } from 'react';
import { restoreScrollPosition } from '../../lib/windowBridge';
import type { ProjectFile, Sheet } from '../../types';

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
  setLastViewedDocumentId: ((documentId: string) => void) | undefined;
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

  // Restore page/scale/rotation/location from store when currentPdfFile changes
  useEffect(() => {
    if (!currentPdfFile || currentPdfFile.id === lastRestoredFileIdRef.current) return;

    const savedRotation = getDocumentRotation(currentPdfFile.id);
    const savedPage = getDocumentPage(currentPdfFile.id);
    const savedScale = getDocumentScale(currentPdfFile.id);
    const savedLocation = getDocumentLocation(currentPdfFile.id);

    if (isDev) {
      console.log('🔄 Restoring document state (backup):', {
        documentId: currentPdfFile.id,
        savedRotation,
        savedPage,
        savedScale,
        savedLocation,
        currentPage,
        currentRotation: rotation,
        currentScale: scale,
      });
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPdfFile?.id]);

  // Reset initial render flag when file changes
  useEffect(() => {
    if (currentPdfFile) {
      isInitialRenderRef.current = true;
    }
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
        if (currentPdfFile) {
          setDocumentPage(currentPdfFile.id, page);
          setLastViewedDocumentId?.(currentPdfFile.id);
          if (isDev) console.log('💾 Saved page to store:', { documentId: currentPdfFile.id, page });
        }
      } else if (isDev) {
        console.log('⏭️ Page change skipped - already on page', page);
      }
    },
    [totalPages, currentPage, currentPdfFile, setCurrentPage, setSelectedPageNumber, setDocumentPage, setLastViewedDocumentId, isDev]
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

  const handleSheetSelect = useCallback(
    (sheet: Sheet) => {
      setSelectedSheet(sheet);
      const selectedFile = projectFiles.find((file) => file.id === sheet.id);
      if (selectedFile) {
        setCurrentPdfFile(selectedFile);
        const savedScale = getDocumentScale(selectedFile.id);
        const savedRotation = getDocumentRotation(selectedFile.id);
        const savedPage = getDocumentPage(selectedFile.id);
        const savedLocation = getDocumentLocation(selectedFile.id);
        setScale(savedScale);
        setRotation(savedRotation);
        setCurrentPage(savedPage);
        setSelectedPageNumber(savedPage);
        setDocumentPage(selectedFile.id, savedPage);
        setLastViewedDocumentId?.(selectedFile.id);
        if (savedLocation.x !== 0 || savedLocation.y !== 0) {
          setTimeout(() => restoreScrollPosition(savedLocation.x, savedLocation.y), 200);
        }
      }
    },
    [
      projectFiles,
      setSelectedSheet,
      setCurrentPdfFile,
      setScale,
      setRotation,
      setCurrentPage,
      setSelectedPageNumber,
      setDocumentPage,
      setLastViewedDocumentId,
      getDocumentScale,
      getDocumentRotation,
      getDocumentPage,
      getDocumentLocation,
    ]
  );

  const handlePageSelect = useCallback(
    (documentId: string, pageNumber: number) => {
      setSelectedDocumentId(documentId);
      setSelectedPageNumber(pageNumber);
      const selectedFile = projectFiles.find((file) => file.id === documentId);
      if (selectedFile) {
        setCurrentPdfFile(selectedFile);
        const savedScale = getDocumentScale(selectedFile.id);
        const savedRotation = getDocumentRotation(selectedFile.id);
        const savedLocation = getDocumentLocation(selectedFile.id);
        setScale(savedScale);
        setRotation(savedRotation);
        setCurrentPage(pageNumber);
        setDocumentPage(selectedFile.id, pageNumber);
        setLastViewedDocumentId?.(selectedFile.id);
        if (savedLocation.x !== 0 || savedLocation.y !== 0) {
          setTimeout(() => restoreScrollPosition(savedLocation.x, savedLocation.y), 200);
        }
      }
    },
    [
      projectFiles,
      setSelectedDocumentId,
      setSelectedPageNumber,
      setCurrentPdfFile,
      setScale,
      setRotation,
      setCurrentPage,
      setDocumentPage,
      setLastViewedDocumentId,
      getDocumentScale,
      getDocumentRotation,
      getDocumentLocation,
    ]
  );

  const handlePDFRendered = useCallback(() => {
    if (currentPdfFile && isInitialRenderRef.current) {
      const savedLocation = getDocumentLocation(currentPdfFile.id);
      if (savedLocation.x !== 0 || savedLocation.y !== 0) {
        if (isDev) console.log('🔄 Restoring scroll position after initial PDF render:', savedLocation);
        setTimeout(() => restoreScrollPosition(savedLocation.x, savedLocation.y), 25);
      }
      isInitialRenderRef.current = false;
    } else if (isDev && !isInitialRenderRef.current) {
      if (isDev) console.log('⏭️ Skipping scroll restoration - not initial render (likely zoom operation)');
    }
  }, [currentPdfFile, getDocumentLocation, isDev]);

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
