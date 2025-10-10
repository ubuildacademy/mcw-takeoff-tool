import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { 
  Project, 
  TakeoffCondition, 
  TakeoffMeasurement, 
  Calibration,
  ConditionCostBreakdown,
  ProjectCostBreakdown
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
  loadingConditions: boolean;
  
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
  updateTakeoffMeasurement: (id: string, updates: Partial<TakeoffMeasurement>) => Promise<void>;
  deleteTakeoffMeasurement: (id: string) => Promise<void>;
  
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
  getProjectTotalCost: (projectId: string) => number;
  
  // Enhanced cost calculation methods
  getConditionCostBreakdown: (conditionId: string) => ConditionCostBreakdown | null;
  getProjectCostBreakdown: (projectId: string) => ProjectCostBreakdown;
  
  // Data loading
  loadInitialData: () => Promise<void>;
  loadProjectConditions: (projectId: string) => Promise<void>;
  loadProjectTakeoffMeasurements: (projectId: string) => Promise<void>;
  refreshProjectConditions: (projectId: string) => Promise<void>;
  ensureConditionsLoaded: (projectId: string) => Promise<void>;
}

export const useTakeoffStore = create<TakeoffStore>()(
  persist(
    (set, get) => ({
      // Initial state
      projects: [],
      currentProjectId: null,
      
      conditions: [],
      selectedConditionId: null,
      loadingConditions: false,
      
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
          // Import the Supabase service dynamically to avoid circular dependencies
          const { supabaseService } = await import('../services/supabaseService');
          
          // Create project via Supabase
          const project = await supabaseService.createProject(projectData);
          
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
         const calibration = calibrations.find(c => c.projectId === projectId && c.sheetId === sheetId) || null;
         return calibration;
       },
      
      addTakeoffMeasurement: async (measurementData) => {
        // console.log('🔄 ADD_TAKEOFF_MEASUREMENT: Starting to create takeoff measurement:', measurementData);
        try {
          // Import the API service dynamically to avoid circular dependencies
          const { takeoffMeasurementService } = await import('../services/apiService');
          
          const condition = get().conditions.find(c => c.id === measurementData.conditionId);
          const measurementPayload = {
            ...measurementData,
            conditionColor: condition?.color || '#000000',
            conditionName: condition?.name || 'Unknown'
          };
          
          // console.log('🔄 ADD_TAKEOFF_MEASUREMENT: Calling API to create measurement...');
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
      
      updateTakeoffMeasurement: async (id, updates) => {
        try {
          // Import the API service dynamically to avoid circular dependencies
          const { takeoffMeasurementService } = await import('../services/apiService');
          
          console.log('🔄 UPDATE_TAKEOFF_MEASUREMENT: Updating measurement via API:', { id, updates });
          // Update measurement via API
          const response = await takeoffMeasurementService.updateTakeoffMeasurement(id, updates);
          console.log('✅ UPDATE_TAKEOFF_MEASUREMENT: API update successful:', response);
          const updatedMeasurement = response.measurement || response;
          
          // Update local store with the backend response
          set(state => ({
            takeoffMeasurements: state.takeoffMeasurements.map(measurement =>
              measurement.id === id ? { ...measurement, ...updatedMeasurement } : measurement
            )
          }));
          
          // Update markupsByPage structure
          get().updateMarkupsByPage();
        } catch (error: any) {
          console.error('❌ UPDATE_TAKEOFF_MEASUREMENT: Failed to update measurement via API:', error);
          // Fallback to local update if API fails
          set(state => ({
            takeoffMeasurements: state.takeoffMeasurements.map(measurement =>
              measurement.id === id ? { ...measurement, ...updates } : measurement
            )
          }));
          
          // Update markupsByPage structure
          get().updateMarkupsByPage();
        }
      },
      
      deleteTakeoffMeasurement: async (id) => {
        try {
          // Import the API service dynamically to avoid circular dependencies
          const { takeoffMeasurementService } = await import('../services/apiService');
          
          // Delete measurement via API
          await takeoffMeasurementService.deleteTakeoffMeasurement(id);
          console.log('✅ DELETE_TAKEOFF_MEASUREMENT: Measurement deleted successfully from API');
          
          // Remove from local store
          set(state => ({
            takeoffMeasurements: state.takeoffMeasurements.filter(measurement => measurement.id !== id)
          }));
          
          // Update markupsByPage structure
          get().updateMarkupsByPage();
        } catch (error: any) {
          console.error('❌ DELETE_TAKEOFF_MEASUREMENT: Failed to delete measurement via API:', error);
          // Don't remove from local store if API call failed
          throw new Error(`Failed to delete takeoff measurement: ${error.message}`);
        }
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
        const filtered = takeoffMeasurements.filter(m => m.projectId === projectId && m.conditionId === conditionId);
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
      
      getProjectTotalCost: (projectId) => {
        const costBreakdown = get().getProjectCostBreakdown(projectId);
        return costBreakdown.summary.totalCost;
      },
      
      getConditionCostBreakdown: (conditionId) => {
        const { conditions, takeoffMeasurements } = get();
        const condition = conditions.find(c => c.id === conditionId);
        
        if (!condition) {
          return null;
        }
        
        // Get all measurements for this condition
        const conditionMeasurements = takeoffMeasurements.filter(m => m.conditionId === conditionId);
        
        // Calculate total quantity for this condition
        const quantity = conditionMeasurements.reduce((sum, measurement) => {
          // Use net value if cutouts exist, otherwise use calculated value
          const value = measurement.netCalculatedValue !== undefined && measurement.netCalculatedValue !== null 
            ? measurement.netCalculatedValue 
            : measurement.calculatedValue;
          return sum + (value || 0);
        }, 0);
        
        // Apply waste factor to get adjusted quantity
        const adjustedQuantity = quantity * (1 + (condition.wasteFactor || 0) / 100);
        
        // Calculate costs
        const materialCostPerUnit = condition.materialCost || 0;
        const laborCostPerUnit = condition.laborCost || 0;
        const equipmentCost = condition.equipmentCost || 0;
        
        const materialCost = adjustedQuantity * materialCostPerUnit;
        const laborCost = adjustedQuantity * laborCostPerUnit;
        const wasteCost = (adjustedQuantity - quantity) * materialCostPerUnit; // Additional cost due to waste
        
        const subtotal = materialCost + laborCost + equipmentCost + wasteCost;
        
        return {
          condition,
          quantity,
          adjustedQuantity,
          materialCost,
          laborCost,
          equipmentCost,
          wasteCost,
          subtotal,
          hasCosts: materialCostPerUnit > 0 || laborCostPerUnit > 0 || equipmentCost > 0
        };
      },
      
      getProjectCostBreakdown: (projectId) => {
        const { conditions, takeoffMeasurements } = get();
        const currentProject = get().getCurrentProject();
        
        // Get all conditions for this project
        const projectConditions = conditions.filter(c => c.projectId === projectId);
        
        // Calculate cost breakdown for each condition
        const conditionBreakdowns: ConditionCostBreakdown[] = projectConditions.map(condition => {
          const breakdown = get().getConditionCostBreakdown(condition.id);
          return breakdown!; // We know it exists since we're filtering by projectId
        });
        
        // Calculate project-level summary
        let totalMaterialCost = 0;
        let totalLaborCost = 0;
        let totalEquipmentCost = 0;
        let totalWasteCost = 0;
        let conditionsWithCosts = 0;
        
        conditionBreakdowns.forEach(breakdown => {
          totalMaterialCost += breakdown.materialCost;
          totalLaborCost += breakdown.laborCost;
          totalEquipmentCost += breakdown.equipmentCost;
          totalWasteCost += breakdown.wasteCost;
          
          if (breakdown.hasCosts) {
            conditionsWithCosts++;
          }
        });
        
        const subtotal = totalMaterialCost + totalLaborCost + totalEquipmentCost + totalWasteCost;
        
        // Get profit margin from project settings (default 15%)
        const profitMarginPercent = currentProject?.profitMarginPercent || 15;
        const profitMarginAmount = subtotal * (profitMarginPercent / 100);
        const totalCost = subtotal + profitMarginAmount;
        
        return {
          conditions: conditionBreakdowns,
          summary: {
            totalMaterialCost,
            totalLaborCost,
            totalEquipmentCost,
            totalWasteCost,
            subtotal,
            profitMarginPercent,
            profitMarginAmount,
            totalCost,
            conditionsWithCosts,
            totalConditions: projectConditions.length
          }
        };
      },
      
      // Data loading
      loadInitialData: async () => {
        try {
          // Import the Supabase service dynamically to avoid circular dependencies
          const { supabaseService } = await import('../services/supabaseService');
          
          // Load projects using the new Supabase service with user authentication
          const projects = await supabaseService.getProjects();
          
          set(state => ({
            projects
            // Don't clear conditions - they should persist from localStorage
          }));
          
          console.log('Initial data loaded:', { projects: projects.length });
        } catch (error: any) {
          console.error('Failed to load initial data from Supabase:', error);
          console.error('Error details:', {
            message: error.message,
            code: error.code,
            response: error.response?.data
          });
          
          // Start with empty state for offline mode, but preserve conditions
          set(state => ({
            projects: []
            // Don't clear conditions - they should persist from localStorage
          }));
          
          console.log('Starting with empty state for offline mode');
        }
      },
      
      loadProjectConditions: async (projectId: string) => {
        const state = get();
        
        // Check if we already have conditions for this project from localStorage
        const existingProjectConditions = state.conditions.filter(c => c.projectId === projectId);
        if (existingProjectConditions.length > 0) {
          console.log(`🔄 LOAD_PROJECT_CONDITIONS: Already have ${existingProjectConditions.length} conditions for project ${projectId} from localStorage, refreshing from API`);
        }
        
        // Prevent multiple simultaneous loads for the same project
        if (state.loadingConditions) {
          console.log('🔄 LOAD_PROJECT_CONDITIONS: Already loading conditions, skipping duplicate request');
          return;
        }
        
        console.log('🔄 LOAD_PROJECT_CONDITIONS: Starting to load conditions for project:', projectId);
        
        // Set loading state with timeout to prevent getting stuck
        set({ loadingConditions: true });
        
        // Set a timeout to reset loading state if it gets stuck
        const loadingTimeout = setTimeout(() => {
          const currentState = get();
          if (currentState.loadingConditions) {
            console.warn('⚠️ LOAD_PROJECT_CONDITIONS: Loading timeout, resetting loading state');
            set({ loadingConditions: false });
          }
        }, 10000); // 10 second timeout
        
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
            return { 
              conditions: allConditions,
              loadingConditions: false
            };
          });
          
          // Clear the timeout since we completed successfully
          clearTimeout(loadingTimeout);
          
          console.log(`✅ LOAD_PROJECT_CONDITIONS: Project conditions loaded for ${projectId}:`, projectConditions.length);
        } catch (error) {
          console.error(`❌ LOAD_PROJECT_CONDITIONS: Failed to load conditions for project ${projectId}:`, error);
          // Reset loading state on error
          set({ loadingConditions: false });
          // Clear the timeout
          clearTimeout(loadingTimeout);
        }
      },

      refreshProjectConditions: async (projectId: string) => {
        console.log('🔄 REFRESH_PROJECT_CONDITIONS: Force refreshing conditions for project:', projectId);
        // Reset loading state to allow fresh load
        set({ loadingConditions: false });
        // Load conditions fresh from API
        await get().loadProjectConditions(projectId);
      },

      ensureConditionsLoaded: async (projectId: string) => {
        const state = get();
        const existingProjectConditions = state.conditions.filter(c => c.projectId === projectId);
        
        // Always load conditions from API to ensure we have the latest data
        // This prevents issues where local storage has outdated conditions
        console.log(`🔄 ENSURE_CONDITIONS_LOADED: Loading conditions for project ${projectId} from API (found ${existingProjectConditions.length} in local storage)`);
        await get().loadProjectConditions(projectId);
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
        // Persist conditions to localStorage for better UX and faster loading
        conditions: state.conditions,
        measurements: state.measurements,
        calibrations: state.calibrations,
        takeoffMeasurements: state.takeoffMeasurements,
        markupsByPage: state.markupsByPage
      })
    }
  )
);
