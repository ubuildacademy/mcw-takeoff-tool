import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { 
  Project, 
  TakeoffCondition, 
  TakeoffMeasurement, 
  Calibration 
} from '../types';

// Re-export types for backward compatibility
export type { TakeoffCondition, TakeoffMeasurement, Calibration, Project };

// Project and TakeoffCondition interfaces now imported from types

interface Measurement {
  id: string;
  projectId: string;
  type: 'linear' | 'area' | 'volume' | 'count';
  value: number;
  unit: string;
  description: string;
  conditionId?: string;
  timestamp: string;
}

// Calibration and TakeoffMeasurement interfaces now imported from types

interface TakeoffStore {
  // Projects
  projects: Project[];
  currentProjectId: string | null;
  
  // Takeoff conditions
  conditions: TakeoffCondition[];
  selectedConditionId: string | null;
  
  // Measurements
  measurements: Measurement[];
  
  // Calibration
  calibrations: Calibration[];
  currentCalibration: Calibration | null;
  
  // Takeoff measurements - organized by page for better isolation
  takeoffMeasurements: TakeoffMeasurement[];
  markupsByPage: Record<string, TakeoffMeasurement[]>; // Key: `${projectId}-${sheetId}-${pageNumber}`
  
  // Actions
  addProject: (project: Omit<Project, 'id' | 'lastModified' | 'takeoffCount'>) => Promise<string>;
  importProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  setCurrentProject: (id: string) => void;
  
  addCondition: (condition: Omit<TakeoffCondition, 'id'>) => Promise<string>;
  updateCondition: (id: string, updates: Partial<TakeoffCondition>) => Promise<void>;
  deleteCondition: (id: string) => Promise<void>;
  setSelectedCondition: (id: string | null) => void;
  setConditions: (conditions: TakeoffCondition[]) => void;
  
  addMeasurement: (measurement: Omit<Measurement, 'id' | 'timestamp'>) => string;
  updateMeasurement: (id: string, updates: Partial<Measurement>) => void;
  deleteMeasurement: (id: string) => void;
  
  // Calibration actions
  setCalibration: (projectId: string, sheetId: string, scaleFactor: number, unit: string) => void;
  getCalibration: (projectId: string, sheetId: string) => Calibration | null;
  
  // Takeoff measurement actions
  addTakeoffMeasurement: (measurement: Omit<TakeoffMeasurement, 'id' | 'timestamp'>) => Promise<string>;
  updateTakeoffMeasurement: (id: string, updates: Partial<TakeoffMeasurement>) => void;
  deleteTakeoffMeasurement: (id: string) => void;
  
  // New methods for takeoff functionality
  getSheetTakeoffMeasurements: (projectId: string, sheetId: string) => TakeoffMeasurement[];
  getPageTakeoffMeasurements: (projectId: string, sheetId: string, pageNumber: number) => TakeoffMeasurement[];
  getConditionTakeoffMeasurements: (projectId: string, conditionId: string) => TakeoffMeasurement[];
  getProjectTakeoffSummary: (projectId: string) => {
    totalMeasurements: number;
    totalValue: number;
    byCondition: Record<string, { count: number; value: number; unit: string }>;
  };
  
  // Page-based markup management
  getPageMarkups: (projectId: string, sheetId: string, pageNumber: number) => TakeoffMeasurement[];
  updateMarkupsByPage: () => void;
  getPageKey: (projectId: string, sheetId: string, pageNumber: number) => string;
  
  // Computed values
  getCurrentProject: () => Project | null;
  getProjectMeasurements: (projectId: string) => Measurement[];
  getSelectedCondition: () => TakeoffCondition | null;
  getProjectTakeoffMeasurements: (projectId: string) => TakeoffMeasurement[];
  
  // Data loading
  loadInitialData: () => Promise<void>;
  loadProjectConditions: (projectId: string) => Promise<void>;
  loadProjectTakeoffMeasurements: (projectId: string) => Promise<void>;
}

export const useTakeoffStore = create<TakeoffStore>()(
  persist(
    (set, get) => ({
      // Initial state
      projects: [],
      currentProjectId: null,
      
      conditions: [],
      selectedConditionId: null,
      
      measurements: [],
      
      calibrations: [
        {
          projectId: 'default',
          sheetId: 'default',
          scaleFactor: 1, // 1 unit = 1 foot (default scale)
          unit: 'ft',
          calibratedAt: new Date().toISOString()
        }
      ],
      currentCalibration: null,
      
      takeoffMeasurements: [],
      markupsByPage: {},
      
      // Actions
      addProject: async (projectData) => {
        try {
          // Import the API service dynamically to avoid circular dependencies
          const { projectService } = await import('../services/apiService');
          
          // Create project via API
          const response = await projectService.createProject(projectData);
          const project = response.project || response;
          
          // Add to local store
          set(state => ({
            projects: [...state.projects, project]
          }));
          
          return project.id;
        } catch (error: any) {
          console.warn('Failed to create project via API, creating locally:', error.message);
          
          // Create project locally as fallback
          const id = Date.now().toString();
          const project = {
            ...projectData,
            id,
            lastModified: new Date().toISOString(),
            takeoffCount: 0,
            totalValue: 0
          };
          
          set(state => ({
            projects: [...state.projects, project]
          }));
          
          return id;
        }
      },
      
      importProject: (project) => {
        set(state => ({
          projects: [...state.projects, project]
        }));
      },
      
      updateProject: (id, updates) => {
        set(state => ({
          projects: state.projects.map(project =>
            project.id === id
              ? { ...project, ...updates, lastModified: new Date().toISOString() }
              : project
          )
        }));
      },
      
      deleteProject: (id) => {
        set(state => ({
          projects: state.projects.filter(project => project.id !== id),
          measurements: state.measurements.filter(m => m.projectId !== id),
          currentProjectId: state.currentProjectId === id ? null : state.currentProjectId
        }));
      },
      
      setCurrentProject: (id) => {
        set({ currentProjectId: id });
      },
      
      addCondition: async (conditionData) => {
        console.log('🔄 ADD_CONDITION: Starting to create condition:', conditionData);
        try {
          // Import the API service dynamically to avoid circular dependencies
          const { conditionService } = await import('../services/apiService');
          
          console.log('🔄 ADD_CONDITION: Calling API to create condition...');
          // Create condition via API - this is the source of truth
          const response = await conditionService.createCondition(conditionData);
          console.log('✅ ADD_CONDITION: API response received:', response);
          const condition = response.condition || response;
          
          // Add to local store with the backend response
          set(state => {
            console.log('💾 ADD_CONDITION: Adding condition to store from backend:', condition);
            return {
              conditions: [...state.conditions, condition]
            };
          });
          
          console.log('✅ ADD_CONDITION: Condition created successfully with ID:', condition.id);
          return condition.id;
        } catch (error: any) {
          console.error('❌ ADD_CONDITION: Failed to create condition via API:', error);
          // Don't create locally - throw the error so the user knows it failed
          throw new Error(`Failed to create condition: ${error.message}`);
        }
      },
      
      updateCondition: async (id, updates) => {
        try {
          // Import the API service dynamically to avoid circular dependencies
          const { conditionService } = await import('../services/apiService');
          
          // Update condition via API
          const response = await conditionService.updateCondition(id, updates);
          const updatedCondition = response.condition || response;
          
          // Update local store
          set(state => ({
            conditions: state.conditions.map(condition =>
              condition.id === id ? { ...condition, ...updatedCondition } : condition
            )
          }));
        } catch (error) {
          console.error('Failed to update condition:', error);
          throw error;
        }
      },
      
      deleteCondition: async (id) => {
        try {
          // Import the API service dynamically to avoid circular dependencies
          const { conditionService } = await import('../services/apiService');
          
          // Delete condition via API
          await conditionService.deleteCondition(id);
          
          // Update local store - remove condition and all associated measurements
          set(state => ({
            conditions: state.conditions.filter(condition => condition.id !== id),
            selectedConditionId: state.selectedConditionId === id ? null : state.selectedConditionId,
            // Also remove all measurements associated with this condition
            takeoffMeasurements: state.takeoffMeasurements.filter(measurement => measurement.conditionId !== id)
          }));
          
          // Update markupsByPage structure to reflect the deleted measurements
          get().updateMarkupsByPage();
          
          console.log(`✅ DELETE_CONDITION: Deleted condition ${id} and all associated measurements`, {
            deletedConditionId: id,
            remainingMeasurements: get().takeoffMeasurements.filter(measurement => measurement.conditionId !== id).length,
            totalMeasurements: get().takeoffMeasurements.length
          });
          
          // Force reload measurements for the current project to ensure UI is updated
          const currentProjectId = get().currentProjectId;
          if (currentProjectId) {
            console.log(`🔄 DELETE_CONDITION: Reloading measurements for project ${currentProjectId}`);
            get().loadProjectTakeoffMeasurements(currentProjectId);
          }
        } catch (error) {
          console.error('Failed to delete condition:', error);
          throw error;
        }
      },
      
      setSelectedCondition: (id) => {
        console.log('🏪 STORE_SET_SELECTED_CONDITION:', {
          newId: id,
          previousId: get().selectedConditionId,
          timestamp: new Date().toISOString(),
          stackTrace: new Error().stack?.split('\n').slice(1, 4)
        });
        set({ selectedConditionId: id });
      },
      
      setConditions: (conditions) => {
        set({ conditions });
      },
      
      addMeasurement: (measurementData) => {
        const id = Date.now().toString();
        const measurement: Measurement = {
          ...measurementData,
          id,
          timestamp: new Date().toISOString()
        };
        
        set(state => ({
          measurements: [...state.measurements, measurement],
          projects: state.projects.map(project =>
            project.id === measurementData.projectId
              ? { ...project, takeoffCount: (project.takeoffCount || 0) + 1 }
              : project
          )
        }));
        
        return id;
      },
      
      updateMeasurement: (id, updates) => {
        set(state => ({
          measurements: state.measurements.map(measurement =>
            measurement.id === id ? { ...measurement, ...updates } : measurement
          )
        }));
      },
      
      deleteMeasurement: (id) => {
        set(state => {
          const measurement = state.measurements.find(m => m.id === id);
          return {
            measurements: state.measurements.filter(m => m.id !== id),
            projects: measurement ? state.projects.map(project =>
              project.id === measurement.projectId
                ? { ...project, takeoffCount: Math.max(0, (project.takeoffCount || 0) - 1) }
                : project
            ) : state.projects
          };
        });
      },
      
             setCalibration: (projectId, sheetId, scaleFactor, unit) => {
         console.log('💾 SET_CALIBRATION: Setting calibration', { projectId, sheetId, scaleFactor, unit });
         set(state => {
           const existingIndex = state.calibrations.findIndex(
             c => c.projectId === projectId && c.sheetId === sheetId
           );
           
           console.log('💾 SET_CALIBRATION: Existing calibration index', { existingIndex, totalCalibrations: state.calibrations.length });
           
           if (existingIndex >= 0) {
             // Update existing calibration
             const updatedCalibrations = [...state.calibrations];
             updatedCalibrations[existingIndex] = { 
               projectId, 
               sheetId, 
               scaleFactor, 
               unit, 
               calibratedAt: new Date().toISOString() 
             };
             console.log('💾 SET_CALIBRATION: Updated existing calibration', updatedCalibrations[existingIndex]);
             return { calibrations: updatedCalibrations };
           } else {
             // Add new calibration
             const newCalibration = { 
               projectId, 
               sheetId, 
               scaleFactor, 
               unit, 
               calibratedAt: new Date().toISOString() 
             };
             console.log('💾 SET_CALIBRATION: Added new calibration', newCalibration);
             return {
               calibrations: [...state.calibrations, newCalibration]
             };
           }
         });
       },
       
       getCalibration: (projectId, sheetId) => {
         const { calibrations } = get();
         console.log('🔍 GET_CALIBRATION_STORE: Looking for calibration', { projectId, sheetId, totalCalibrations: calibrations.length });
         const calibration = calibrations.find(c => c.projectId === projectId && c.sheetId === sheetId) || null;
         console.log('🔍 GET_CALIBRATION_STORE: Found calibration', calibration);
         return calibration;
       },
      
      addTakeoffMeasurement: async (measurementData) => {
        console.log('🔄 ADD_TAKEOFF_MEASUREMENT: Starting to create takeoff measurement:', measurementData);
        try {
          // Import the API service dynamically to avoid circular dependencies
          const { takeoffMeasurementService } = await import('../services/apiService');
          
          const condition = get().conditions.find(c => c.id === measurementData.conditionId);
          const measurementPayload = {
            ...measurementData,
            conditionColor: condition?.color || '#000000',
            conditionName: condition?.name || 'Unknown'
          };
          
          console.log('🔄 ADD_TAKEOFF_MEASUREMENT: Calling API to create measurement...');
          // Create measurement via API - this is the source of truth
          const response = await takeoffMeasurementService.createTakeoffMeasurement(measurementPayload);
          console.log('✅ ADD_TAKEOFF_MEASUREMENT: API response received:', response);
          const measurement = response.measurement || response;
          
          // Add to local store with the backend response
          set(state => {
            console.log('💾 ADD_TAKEOFF_MEASUREMENT: Adding measurement to store from backend:', measurement);
            return {
              takeoffMeasurements: [...state.takeoffMeasurements, measurement]
            };
          });
          
          // Update markupsByPage structure
          get().updateMarkupsByPage();
          
          console.log('✅ ADD_TAKEOFF_MEASUREMENT: Measurement created successfully with ID:', measurement.id);
          return measurement.id;
        } catch (error: any) {
          console.error('❌ ADD_TAKEOFF_MEASUREMENT: Failed to create measurement via API:', error);
          // Don't create locally - throw the error so the user knows it failed
          throw new Error(`Failed to create takeoff measurement: ${error.message}`);
        }
      },
      
      updateTakeoffMeasurement: (id, updates) => {
        set(state => ({
          takeoffMeasurements: state.takeoffMeasurements.map(measurement =>
            measurement.id === id ? { ...measurement, ...updates } : measurement
          )
        }));
        
        // Update markupsByPage structure
        get().updateMarkupsByPage();
      },
      
      deleteTakeoffMeasurement: (id) => {
        set(state => ({
          takeoffMeasurements: state.takeoffMeasurements.filter(measurement => measurement.id !== id)
        }));
        
        // Update markupsByPage structure
        get().updateMarkupsByPage();
      },
      
      // New methods for takeoff functionality
      getSheetTakeoffMeasurements: (projectId, sheetId) => {
        const { takeoffMeasurements } = get();
        return takeoffMeasurements.filter(m => m.projectId === projectId && m.sheetId === sheetId);
      },
      
      getPageTakeoffMeasurements: (projectId, sheetId, pageNumber) => {
        const { takeoffMeasurements } = get();
        return takeoffMeasurements.filter(m => 
          m.projectId === projectId && 
          m.sheetId === sheetId && 
          m.pdfPage === pageNumber
        );
      },
      
      getConditionTakeoffMeasurements: (projectId, conditionId) => {
        const { takeoffMeasurements } = get();
        console.log('getConditionTakeoffMeasurements called with:', { projectId, conditionId });
        console.log('All takeoff measurements:', takeoffMeasurements);
        const filtered = takeoffMeasurements.filter(m => m.projectId === projectId && m.conditionId === conditionId);
        console.log('Filtered condition measurements:', filtered);
        return filtered;
      },
      
      getProjectTakeoffSummary: (projectId) => {
        const { takeoffMeasurements } = get();
        const summary: {
          totalMeasurements: number;
          totalValue: number;
          byCondition: Record<string, { count: number; value: number; unit: string }>;
        } = {
          totalMeasurements: 0,
          totalValue: 0,
          byCondition: {}
        };

        takeoffMeasurements.forEach(measurement => {
          if (measurement.projectId === projectId) {
            summary.totalMeasurements++;
            const condition = get().conditions.find(c => c.id === measurement.conditionId);
            if (condition) {
              if (!summary.byCondition[condition.id]) {
                summary.byCondition[condition.id] = { count: 0, value: 0, unit: condition.unit };
              }
              summary.byCondition[condition.id].count++;
              summary.byCondition[condition.id].value += measurement.calculatedValue;
            }
          }
        });

        return summary;
      },
      
      // Page-based markup management methods
      getPageKey: (projectId, sheetId, pageNumber) => {
        return `${projectId}-${sheetId}-${pageNumber}`;
      },
      
      getPageMarkups: (projectId, sheetId, pageNumber) => {
        const { markupsByPage } = get();
        const pageKey = get().getPageKey(projectId, sheetId, pageNumber);
        return markupsByPage[pageKey] || [];
      },
      
      updateMarkupsByPage: () => {
        const { takeoffMeasurements } = get();
        const markupsByPage: Record<string, TakeoffMeasurement[]> = {};
        
        // Group measurements by page
        takeoffMeasurements.forEach(measurement => {
          const pageKey = get().getPageKey(measurement.projectId, measurement.sheetId, measurement.pdfPage);
          if (!markupsByPage[pageKey]) {
            markupsByPage[pageKey] = [];
          }
          markupsByPage[pageKey].push(measurement);
        });
        
        set({ markupsByPage });
        console.log('🔄 Updated markupsByPage:', Object.keys(markupsByPage).length, 'pages');
      },
      
      // Computed values
      getCurrentProject: () => {
        const { projects, currentProjectId } = get();
        return projects.find(project => project.id === currentProjectId) || null;
      },
      
      getProjectMeasurements: (projectId) => {
        const { measurements } = get();
        return measurements.filter(m => m.projectId === projectId);
      },
      
      getSelectedCondition: () => {
        const { conditions, selectedConditionId } = get();
        return conditions.find(condition => condition.id === selectedConditionId) || null;
      },
      
      getProjectTakeoffMeasurements: (projectId) => {
        const { takeoffMeasurements } = get();
        return takeoffMeasurements.filter(m => m.projectId === projectId);
      },
      
      // Data loading
      loadInitialData: async () => {
        try {
          // Import the API service dynamically to avoid circular dependencies
          const { projectService } = await import('../services/apiService');
          
          // Load projects only - conditions will be loaded per project as needed
          const projectsResponse = await projectService.getProjects();
          const projects = projectsResponse.projects || [];
          
          set(state => ({
            projects,
            conditions: [] // Always start with empty conditions - load from backend per project
          }));
          
          console.log('Initial data loaded:', { projects: projects.length });
        } catch (error: any) {
          console.error('Failed to load initial data from API, using offline mode:', error);
          console.error('Error details:', {
            message: error.message,
            code: error.code,
            isOffline: error.isOffline,
            response: error.response?.data
          });
          
          // Start with empty state for offline mode
          set(state => ({
            projects: [],
            conditions: []
          }));
          
          console.log('Starting with empty state for offline mode');
        }
      },
      
      loadProjectConditions: async (projectId: string) => {
        console.log('🔄 LOAD_PROJECT_CONDITIONS: Starting to load conditions for project:', projectId);
        try {
          // Import the API service dynamically to avoid circular dependencies
          const { conditionService } = await import('../services/apiService');
          
          console.log('🔄 LOAD_PROJECT_CONDITIONS: Calling API to get project conditions...');
          // Load conditions for specific project
          const conditionsResponse = await conditionService.getProjectConditions(projectId);
          console.log('✅ LOAD_PROJECT_CONDITIONS: API response received:', conditionsResponse);
          const projectConditions = conditionsResponse.conditions || [];
          
          // Merge with existing conditions, avoiding duplicates
          set(state => {
            // Remove existing conditions for this project and add the new ones
            const existingConditions = state.conditions.filter(c => c.projectId !== projectId);
            const allConditions = [...existingConditions, ...projectConditions];
            console.log(`💾 LOAD_PROJECT_CONDITIONS: Merging conditions for project ${projectId}:`, {
              existingCount: existingConditions.length,
              projectConditionsCount: projectConditions.length,
              totalCount: allConditions.length,
              projectConditions: projectConditions
            });
            return { conditions: allConditions };
          });
          
          console.log(`✅ LOAD_PROJECT_CONDITIONS: Project conditions loaded for ${projectId}:`, projectConditions.length);
        } catch (error) {
          console.error(`❌ LOAD_PROJECT_CONDITIONS: Failed to load conditions for project ${projectId}:`, error);
        }
      },

      loadProjectTakeoffMeasurements: async (projectId: string) => {
        console.log('🔄 LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Starting to load measurements for project:', projectId);
        try {
          // Import the API service dynamically to avoid circular dependencies
          const { takeoffMeasurementService } = await import('../services/apiService');
          
          console.log('🔄 LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Calling API to get project measurements...');
          // Load measurements for specific project
          const measurementsResponse = await takeoffMeasurementService.getProjectTakeoffMeasurements(projectId);
          console.log('✅ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: API response received:', measurementsResponse);
          const projectMeasurements = measurementsResponse.measurements || [];
          
          // Merge with existing measurements, avoiding duplicates
          set(state => {
            // Remove existing measurements for this project and add the new ones
            const existingMeasurements = state.takeoffMeasurements.filter(m => m.projectId !== projectId);
            const allMeasurements = [...existingMeasurements, ...projectMeasurements];
            console.log(`💾 LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Merging measurements for project ${projectId}:`, {
              existingCount: existingMeasurements.length,
              projectMeasurementsCount: projectMeasurements.length,
              totalCount: allMeasurements.length,
              projectMeasurements: projectMeasurements
            });
            return { takeoffMeasurements: allMeasurements };
          });
          
          // Update markupsByPage structure
          get().updateMarkupsByPage();
          
          console.log(`✅ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Project measurements loaded for ${projectId}:`, projectMeasurements.length);
        } catch (error) {
          console.error(`❌ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Failed to load measurements for project ${projectId}:`, error);
        }
      }
    }),
    {
      name: 'takeoff-store',
      partialize: (state) => ({
        projects: state.projects,
        // Don't persist conditions to localStorage - always load from backend
        measurements: state.measurements,
        calibrations: state.calibrations,
        takeoffMeasurements: state.takeoffMeasurements,
        markupsByPage: state.markupsByPage
      })
    }
  )
);
