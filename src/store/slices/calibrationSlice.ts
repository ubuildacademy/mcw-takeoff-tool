import { create } from 'zustand';
import type { Calibration } from '../../types';

interface CalibrationState {
  // State
  calibrations: Calibration[];
  currentCalibration: Calibration | null;
  
  // Actions
  setCalibration: (
    projectId: string, 
    sheetId: string, 
    scaleFactor: number, 
    unit: string, 
    pageNumber?: number | null, 
    viewportWidth?: number | null, 
    viewportHeight?: number | null, 
    rotation?: number | null
  ) => void;
  clearProjectCalibrations: (projectId: string) => void;
  setCalibrations: (calibrations: Calibration[]) => void;
  
  // Getters
  getCalibration: (projectId: string, sheetId: string, pageNumber?: number) => Calibration | null;
}

export const useCalibrationStore = create<CalibrationState>()(
  (set, get) => ({
    // Initial state
    calibrations: [
      {
        projectId: 'default',
        sheetId: 'default',
        scaleFactor: 1,
        unit: 'ft',
        calibratedAt: new Date().toISOString()
      }
    ],
    currentCalibration: null,
    
    // Actions
    setCalibration: (projectId, sheetId, scaleFactor, unit, pageNumber, viewportWidth, viewportHeight, rotation) => {
      console.log('💾 SET_CALIBRATION: Setting calibration', { projectId, sheetId, scaleFactor, unit, pageNumber, viewportWidth, viewportHeight, rotation });
      set(state => {
        const existingIndex = state.calibrations.findIndex(
          c => c.projectId === projectId && 
               c.sheetId === sheetId && 
               (c.pageNumber ?? null) === (pageNumber ?? null)
        );
        
        console.log('💾 SET_CALIBRATION: Existing calibration index', { existingIndex, totalCalibrations: state.calibrations.length, pageNumber });
        
        if (existingIndex >= 0) {
          const updatedCalibrations = [...state.calibrations];
          updatedCalibrations[existingIndex] = { 
            projectId, 
            sheetId, 
            pageNumber: pageNumber ?? null,
            scaleFactor, 
            unit, 
            viewportWidth: viewportWidth ?? null,
            viewportHeight: viewportHeight ?? null,
            rotation: rotation ?? null,
            calibratedAt: new Date().toISOString() 
          };
          console.log('💾 SET_CALIBRATION: Updated existing calibration', updatedCalibrations[existingIndex]);
          return { calibrations: updatedCalibrations };
        } else {
          const newCalibration = { 
            projectId, 
            sheetId, 
            pageNumber: pageNumber ?? null,
            scaleFactor, 
            unit, 
            viewportWidth: viewportWidth ?? null,
            viewportHeight: viewportHeight ?? null,
            rotation: rotation ?? null,
            calibratedAt: new Date().toISOString() 
          };
          console.log('💾 SET_CALIBRATION: Added new calibration', newCalibration);
          return {
            calibrations: [...state.calibrations, newCalibration]
          };
        }
      });
    },
    
    clearProjectCalibrations: (projectId) => {
      set(state => {
        const filteredCalibrations = state.calibrations.filter(
          c => c.projectId !== projectId
        );
        console.log(`🗑️ CLEAR_PROJECT_CALIBRATIONS: Removed ${state.calibrations.length - filteredCalibrations.length} calibration(s) for project ${projectId}`);
        return { calibrations: filteredCalibrations };
      });
    },
    
    setCalibrations: (calibrations) => {
      set({ calibrations });
    },
    
    // Getters
    getCalibration: (projectId, sheetId, pageNumber) => {
      const { calibrations } = get();
      // First try to get page-specific calibration
      if (pageNumber !== undefined) {
        const pageCalibration = calibrations.find(
          c => c.projectId === projectId && 
               c.sheetId === sheetId && 
               c.pageNumber === pageNumber
        );
        if (pageCalibration) return pageCalibration;
      }
      // Fall back to document-level calibration (pageNumber is null/undefined)
      const docCalibration = calibrations.find(
        c => c.projectId === projectId && 
             c.sheetId === sheetId && 
             (c.pageNumber === null || c.pageNumber === undefined)
      );
      return docCalibration || null;
    }
  })
);
