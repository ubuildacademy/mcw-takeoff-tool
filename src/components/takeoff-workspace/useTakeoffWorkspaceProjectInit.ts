import { useEffect, useRef } from 'react';
import { fileService } from '../../services/apiService';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import type { ProjectFile, Calibration } from '../../types';

export interface UseTakeoffWorkspaceProjectInitOptions {
  projectId: string | undefined;
  isDev?: boolean;
  /** When true, document view store has rehydrated from localStorage so saved view state is available */
  documentViewRehydrated?: boolean;
  currentPdfFile: ProjectFile | null;
  setProjectFiles: (files: ProjectFile[]) => void;
  setCurrentPdfFile: (file: ProjectFile | null) => void;
  setSelectedDocumentId: (id: string | null) => void;
  setScale: (scale: number) => void;
  setRotation: (rotation: number) => void;
  setCurrentPage: (page: number) => void;
  setSelectedPageNumber: (page: number | null) => void;
  getLastViewedDocumentId: ((projectId: string) => string | undefined) | undefined;
  getDocumentPage: (documentId: string) => number;
  getDocumentScale: (documentId: string) => number;
  getDocumentRotation: (documentId: string) => number;
  setCurrentProject: (projectId: string) => void;
  clearProjectCalibrations: (projectId: string) => void;
  setCalibration: (
    projectId: string,
    sheetId: string,
    scaleFactor: number,
    unit: string,
    pageNumber: number | null,
    viewportWidth: number | null,
    viewportHeight: number | null,
    rotation: number | null
  ) => void;
  loadProjectTakeoffMeasurements: (projectId: string) => Promise<void>;
  setShowProfitMarginDialog: (show: boolean) => void;
}

/**
 * Runs project initialization effects: load files and restore last viewed doc,
 * set current project and load calibrations/measurements, and profit margin dialog listener.
 */
export function useTakeoffWorkspaceProjectInit({
  projectId,
  isDev = false,
  documentViewRehydrated = false,
  currentPdfFile,
  setProjectFiles,
  setCurrentPdfFile,
  setSelectedDocumentId,
  setScale,
  setRotation,
  setCurrentPage,
  setSelectedPageNumber,
  getLastViewedDocumentId,
  getDocumentPage,
  getDocumentScale,
  getDocumentRotation,
  setCurrentProject,
  clearProjectCalibrations,
  setCalibration,
  loadProjectTakeoffMeasurements,
  setShowProfitMarginDialog,
}: UseTakeoffWorkspaceProjectInitOptions): void {
  const loadedProjectIdRef = useRef<string | null>(null);
  const appliedRehydratedRef = useRef(false);

  // After document view store rehydrates, re-apply saved page/scale/rotation once (scroll restored by handlePDFRendered)
  useEffect(() => {
    if (!documentViewRehydrated || !projectId || !currentPdfFile || appliedRehydratedRef.current) return;
    appliedRehydratedRef.current = true;
    setScale(getDocumentScale(currentPdfFile.id));
    setRotation(getDocumentRotation(currentPdfFile.id));
    const savedPage = getDocumentPage(currentPdfFile.id);
    setCurrentPage(savedPage);
    setSelectedPageNumber(savedPage);
  }, [documentViewRehydrated, projectId, currentPdfFile?.id]);

  // Load project files and restore last viewed document (once per projectId)
  useEffect(() => {
    if (!projectId) {
      loadedProjectIdRef.current = null;
      appliedRehydratedRef.current = false;
      return;
    }
    if (loadedProjectIdRef.current === projectId) {
      return;
    }
    const currentProjectId: string = projectId;
    loadedProjectIdRef.current = projectId;
    appliedRehydratedRef.current = false;

    async function loadFiles() {
      try {
        const res = await fileService.getProjectFiles(currentProjectId);
        const files = (res.files || []) as ProjectFile[];
        setProjectFiles(files);

        if (files.length > 0) {
          const pdfFiles = files.filter((f: ProjectFile) => f.mimetype === 'application/pdf');
          let target = pdfFiles[0];
          const lastViewedId = getLastViewedDocumentId?.(currentProjectId);
          if (lastViewedId) {
            const match = pdfFiles.find((f: ProjectFile) => f.id === lastViewedId);
            if (match) target = match;
          }
          if (target) {
            setCurrentPdfFile(target);
            setSelectedDocumentId(target.id);
            setScale(getDocumentScale(target.id));
            setRotation(getDocumentRotation(target.id));
            const savedPage = getDocumentPage(target.id);
            setCurrentPage(savedPage);
            setSelectedPageNumber(savedPage);
            // Scroll position restored in handlePDFRendered when the PDF has rendered
          }
        }
      } catch (e: unknown) {
        if (isDev) console.error('Error loading project files:', e);
        setProjectFiles([]);
        loadedProjectIdRef.current = null;
      }
    }
    loadFiles();
  }, [projectId, isDev]);

  const initCalibrationsRef = useRef<string | null>(null);

  // Set current project in store and load calibrations + measurements (once per projectId)
  useEffect(() => {
    if (!projectId) return;
    if (initCalibrationsRef.current === projectId) return;
    initCalibrationsRef.current = projectId;

    useMeasurementStore.getState().clearForProjectSwitch(projectId);
    setCurrentProject(projectId);

    const loadCalibrations = async () => {
      try {
        const { calibrationService } = await import('../../services/apiService');
        const calibrations = await calibrationService.getCalibrationsByProject(projectId);

        clearProjectCalibrations(projectId);

        calibrations.forEach((cal: Calibration) => {
          setCalibration(
            cal.projectId,
            cal.sheetId,
            cal.scaleFactor,
            cal.unit,
            cal.pageNumber ?? null,
            cal.viewportWidth ?? null,
            cal.viewportHeight ?? null,
            cal.rotation ?? null
          );
        });

        if (calibrations.length === 0) {
          console.log(`ℹ️ No calibrations found in database for project ${projectId}`);
        }
      } catch (error) {
        console.error('❌ Failed to load calibrations from database:', error);
      }
    };

    const loadMeasurements = async () => {
      try {
        await loadProjectTakeoffMeasurements(projectId);
      } catch (error) {
        console.error('❌ Failed to load project measurements:', error);
      }
    };

    loadCalibrations();
    loadMeasurements();
    // Only depend on projectId so we don't re-run when store setters change reference
  }, [projectId]);

  // Listen for profit margin dialog open event
  useEffect(() => {
    const handleOpenProfitMarginDialog = () => {
      setShowProfitMarginDialog(true);
    };

    window.addEventListener('openProjectSettings', handleOpenProfitMarginDialog);
    return () => {
      window.removeEventListener('openProjectSettings', handleOpenProfitMarginDialog);
    };
  }, [setShowProfitMarginDialog]);
}
