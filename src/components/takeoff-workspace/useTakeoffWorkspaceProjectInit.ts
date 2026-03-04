import { useEffect, useRef } from 'react';
import { fileService } from '../../services/apiService';
import { useMeasurementStore } from '../../store/slices/measurementSlice';
import type { ProjectFile, Calibration } from '../../types';

export interface UseTakeoffWorkspaceProjectInitOptions {
  projectId: string | undefined;
  isDev?: boolean;
  setProjectFiles: (files: ProjectFile[]) => void;
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
  setProjectFiles,
  setCurrentProject,
  clearProjectCalibrations,
  setCalibration,
  loadProjectTakeoffMeasurements,
  setShowProfitMarginDialog,
}: UseTakeoffWorkspaceProjectInitOptions): void {
  const loadedProjectIdRef = useRef<string | null>(null);

  // Load project files. Tab-based view: tabs drive the view; useTakeoffWorkspaceTabs restores/syncs scale/rotation.
  useEffect(() => {
    if (!projectId) {
      loadedProjectIdRef.current = null;
      return;
    }
    if (loadedProjectIdRef.current === projectId) {
      return;
    }
    const currentProjectId: string = projectId;
    loadedProjectIdRef.current = projectId;

    async function loadFiles() {
      try {
        const res = await fileService.getProjectFiles(currentProjectId);
        const files = (res.files || []) as ProjectFile[];
        setProjectFiles(files);

        // Tab-based view: tabs drive the view. If persisted tabs exist, useTakeoffWorkspaceTabs restores them.
        // If no tabs, user sees "Select a sheet" until they click one. Don't auto-open a file.
      } catch (e: unknown) {
        if (isDev) console.error('Error loading project files:', e);
        setProjectFiles([]);
        loadedProjectIdRef.current = null;
      }
    }
    loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Run once per projectId; ref guards; omit store setters/getters
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Run once per projectId; ref guards; omit store/load functions
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
