import { create } from 'zustand';
import type { TakeoffMeasurement, ConditionCostBreakdown, ProjectCostBreakdown } from '../../types';
import { useConditionStore } from './conditionSlice';
import { useProjectStore } from './projectSlice';

interface MeasurementState {
  // State
  takeoffMeasurements: TakeoffMeasurement[];
  markupsByPage: Record<string, TakeoffMeasurement[]>;
  loadingMeasurements: boolean;
  loadingMeasurementsProjectId: string | null;
  loadedPages: Set<string>;
  loadingPages: Set<string>;
  
  // Actions
  addTakeoffMeasurement: (measurement: Omit<TakeoffMeasurement, 'id' | 'timestamp'>) => Promise<string>;
  updateTakeoffMeasurement: (id: string, updates: Partial<TakeoffMeasurement>) => Promise<void>;
  deleteTakeoffMeasurement: (id: string) => Promise<void>;
  clearProjectMeasurements: (projectId: string) => void;
  /** Clear measurements when switching project (so new project load is clean). */
  clearForProjectSwitch: (newProjectId: string) => void;

  // Page-based markup management
  getPageKey: (projectId: string, sheetId: string, pageNumber: number) => string;
  getPageMarkups: (projectId: string, sheetId: string, pageNumber: number) => TakeoffMeasurement[];
  updateMarkupsByPage: () => void;
  
  // Getters
  getSheetTakeoffMeasurements: (projectId: string, sheetId: string) => TakeoffMeasurement[];
  getPageTakeoffMeasurements: (projectId: string, sheetId: string, pageNumber: number) => TakeoffMeasurement[];
  getConditionTakeoffMeasurements: (projectId: string, conditionId: string) => TakeoffMeasurement[];
  getProjectTakeoffMeasurements: (projectId: string) => TakeoffMeasurement[];
  getProjectTakeoffSummary: (projectId: string) => {
    totalMeasurements: number;
    totalValue: number;
    byCondition: Record<string, { count: number; value: number; unit: string }>;
  };
  
  // Cost calculations
  getProjectTotalCost: (projectId: string) => number;
  getConditionCostBreakdown: (conditionId: string) => ConditionCostBreakdown | null;
  getProjectCostBreakdown: (projectId: string) => ProjectCostBreakdown;
  
  // Data loading
  loadProjectTakeoffMeasurements: (projectId: string) => Promise<void>;
  loadPageTakeoffMeasurements: (projectId: string, sheetId: string, pageNumber: number) => Promise<void>;
}

export const useMeasurementStore = create<MeasurementState>()(
  (set, get) => ({
    // Initial state
    takeoffMeasurements: [],
    markupsByPage: {},
    loadingMeasurements: false,
    loadingMeasurementsProjectId: null,
    loadedPages: new Set<string>(),
    loadingPages: new Set<string>(),
    
    // Actions
    addTakeoffMeasurement: async (measurementData) => {
      try {
        const { takeoffMeasurementService } = await import('../../services/apiService');
        
        const condition = useConditionStore.getState().getConditionById(measurementData.conditionId);
        const measurementPayload = {
          ...measurementData,
          conditionColor: condition?.color || '#000000',
          conditionName: condition?.name || 'Unknown'
        };
        
        const response = await takeoffMeasurementService.createTakeoffMeasurement(measurementPayload);
        console.log('✅ ADD_TAKEOFF_MEASUREMENT: API response received:', response);
        const measurement = response.measurement || response;
        
        set(state => {
          console.log('💾 ADD_TAKEOFF_MEASUREMENT: Adding measurement to store from backend:', measurement);
          
          const pageKey = `${measurement.projectId}-${measurement.sheetId}-${measurement.pdfPage}`;
          const updatedLoadedPages = new Set(state.loadedPages);
          updatedLoadedPages.add(pageKey);
          
          return {
            takeoffMeasurements: [...state.takeoffMeasurements, measurement],
            loadedPages: updatedLoadedPages
          };
        });
        
        get().updateMarkupsByPage();
        
        console.log('✅ ADD_TAKEOFF_MEASUREMENT: Measurement created successfully with ID:', measurement.id);
        return measurement.id;
      } catch (error: any) {
        console.error('❌ ADD_TAKEOFF_MEASUREMENT: Failed to create measurement via API:', error);
        throw new Error(`Failed to create takeoff measurement: ${error.message}`);
      }
    },
    
    updateTakeoffMeasurement: async (id, updates) => {
      try {
        const { takeoffMeasurementService } = await import('../../services/apiService');
        
        console.log('🔄 UPDATE_TAKEOFF_MEASUREMENT: Updating measurement via API:', { id, updates });
        const response = await takeoffMeasurementService.updateTakeoffMeasurement(id, updates);
        console.log('✅ UPDATE_TAKEOFF_MEASUREMENT: API update successful:', response);
        const updatedMeasurement = response.measurement || response;
        
        set(state => ({
          takeoffMeasurements: state.takeoffMeasurements.map(measurement =>
            measurement.id === id ? { ...measurement, ...updatedMeasurement } : measurement
          )
        }));
        
        get().updateMarkupsByPage();
      } catch (error: any) {
        console.error('❌ UPDATE_TAKEOFF_MEASUREMENT: Failed to update measurement via API:', error);
        // Fallback to local update if API fails
        set(state => ({
          takeoffMeasurements: state.takeoffMeasurements.map(measurement =>
            measurement.id === id ? { ...measurement, ...updates } : measurement
          )
        }));
        
        get().updateMarkupsByPage();
      }
    },
    
    deleteTakeoffMeasurement: async (id) => {
      try {
        const { takeoffMeasurementService } = await import('../../services/apiService');
        
        await takeoffMeasurementService.deleteTakeoffMeasurement(id);
        console.log('✅ DELETE_TAKEOFF_MEASUREMENT: Measurement deleted successfully from API');
        
        set(state => ({
          takeoffMeasurements: state.takeoffMeasurements.filter(measurement => measurement.id !== id)
        }));
        
        get().updateMarkupsByPage();
      } catch (error: any) {
        console.error('❌ DELETE_TAKEOFF_MEASUREMENT: Failed to delete measurement via API:', error);
        throw new Error(`Failed to delete takeoff measurement: ${error.message}`);
      }
    },
    
    clearProjectMeasurements: (projectId) => {
      set(state => ({
        takeoffMeasurements: state.takeoffMeasurements.filter(m => m.projectId !== projectId),
        markupsByPage: {}
      }));
      get().updateMarkupsByPage();
    },

    clearForProjectSwitch: (newProjectId) => {
      const projectStore = useProjectStore.getState();
      const state = get();
      const isSwitching = projectStore.currentProjectId !== newProjectId;
      const notLoadingNew = !state.loadingMeasurements || state.loadingMeasurementsProjectId !== newProjectId;
      if (isSwitching && notLoadingNew) {
        set({
          takeoffMeasurements: [],
          markupsByPage: {},
          loadingMeasurements: false,
          loadingMeasurementsProjectId: null
        });
      }
    },

    // Page-based markup management
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
    
    // Getters
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
      return takeoffMeasurements.filter(m => m.projectId === projectId && m.conditionId === conditionId);
    },
    
    getProjectTakeoffMeasurements: (projectId) => {
      const { takeoffMeasurements } = get();
      return takeoffMeasurements.filter(m => m.projectId === projectId);
    },
    
    getProjectTakeoffSummary: (projectId) => {
      const { takeoffMeasurements } = get();
      const conditions = useConditionStore.getState().conditions;
      
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
          const condition = conditions.find(c => c.id === measurement.conditionId);
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
    
    // Cost calculations
    getProjectTotalCost: (projectId) => {
      const costBreakdown = get().getProjectCostBreakdown(projectId);
      return costBreakdown.summary.totalCost;
    },
    
    getConditionCostBreakdown: (conditionId) => {
      const { takeoffMeasurements } = get();
      const condition = useConditionStore.getState().getConditionById(conditionId);
      
      if (!condition) {
        return null;
      }
      
      const conditionMeasurements = takeoffMeasurements.filter(m => m.conditionId === conditionId);
      
      const quantity = conditionMeasurements.reduce((sum, measurement) => {
        const value = measurement.netCalculatedValue !== undefined && measurement.netCalculatedValue !== null 
          ? measurement.netCalculatedValue 
          : measurement.calculatedValue;
        return sum + (value || 0);
      }, 0);
      
      const adjustedQuantity = quantity * (1 + (condition.wasteFactor || 0) / 100);
      
      const materialCostPerUnit = condition.materialCost || 0;
      const equipmentCost = condition.equipmentCost || 0;
      
      const materialCost = adjustedQuantity * materialCostPerUnit;
      const wasteCost = (adjustedQuantity - quantity) * materialCostPerUnit;
      
      const subtotal = materialCost + equipmentCost + wasteCost;
      
      return {
        condition,
        quantity,
        adjustedQuantity,
        materialCost,
        equipmentCost,
        wasteCost,
        subtotal,
        hasCosts: materialCostPerUnit > 0 || equipmentCost > 0
      };
    },
    
    getProjectCostBreakdown: (projectId) => {
      const conditions = useConditionStore.getState().getProjectConditions(projectId);
      const currentProject = useProjectStore.getState().getCurrentProject();
      
      const conditionBreakdowns: ConditionCostBreakdown[] = conditions.map(condition => {
        const breakdown = get().getConditionCostBreakdown(condition.id);
        return breakdown!;
      }).filter(Boolean);
      
      let totalMaterialCost = 0;
      let totalEquipmentCost = 0;
      let totalWasteCost = 0;
      let conditionsWithCosts = 0;
      
      conditionBreakdowns.forEach(breakdown => {
        totalMaterialCost += breakdown.materialCost;
        totalEquipmentCost += breakdown.equipmentCost;
        totalWasteCost += breakdown.wasteCost;
        
        if (breakdown.hasCosts) {
          conditionsWithCosts++;
        }
      });
      
      const subtotal = totalMaterialCost + totalEquipmentCost + totalWasteCost;
      
      const profitMarginPercent = currentProject?.profitMarginPercent || 15;
      const profitMarginAmount = subtotal * (profitMarginPercent / 100);
      const totalCost = subtotal + profitMarginAmount;
      
      return {
        conditions: conditionBreakdowns,
        summary: {
          totalMaterialCost,
          totalEquipmentCost,
          totalWasteCost,
          subtotal,
          profitMarginPercent,
          profitMarginAmount,
          totalCost,
          conditionsWithCosts,
          totalConditions: conditions.length
        }
      };
    },
    
    // Data loading
    loadProjectTakeoffMeasurements: async (projectId: string) => {
      const state = get();
      const projectStore = useProjectStore.getState();
      
      // RACE CONDITION PREVENTION: If already loading for this project, skip
      if (state.loadingMeasurements && state.loadingMeasurementsProjectId === projectId) {
        console.log('⏭️ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Already loading measurements for project', projectId, '- skipping duplicate request');
        return;
      }
      
      // RACE CONDITION PREVENTION: If project changed while we were about to load, abort
      if (projectStore.currentProjectId !== projectId) {
        console.log('⏭️ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Project changed from', projectId, 'to', projectStore.currentProjectId, '- aborting load');
        return;
      }
      
      console.log('🔄 LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Starting to load measurements for project:', projectId);
      
      set({ 
        loadingMeasurements: true,
        loadingMeasurementsProjectId: projectId
      });
      
      try {
        const { takeoffMeasurementService } = await import('../../services/apiService');
        
        console.log('🔄 LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Calling API to get project measurements from Supabase...');
        const measurementsResponse = await takeoffMeasurementService.getProjectTakeoffMeasurements(projectId);
        console.log('✅ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: API response received:', measurementsResponse);
        
        // RACE CONDITION PREVENTION: Double-check project hasn't changed during async operation
        const currentProjectStore = useProjectStore.getState();
        if (currentProjectStore.currentProjectId !== projectId) {
          console.log('⏭️ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Project changed during load from', projectId, 'to', currentProjectStore.currentProjectId, '- discarding results');
          set({ 
            loadingMeasurements: false,
            loadingMeasurementsProjectId: null
          });
          return;
        }
        
        const projectMeasurements = measurementsResponse.measurements || [];
        
        set(state => {
          const otherProjectMeasurements = state.takeoffMeasurements.filter(m => m.projectId !== projectId);
          const allMeasurements = [...otherProjectMeasurements, ...projectMeasurements];
          console.log(`💾 LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Loaded ${projectMeasurements.length} measurements from Supabase for project ${projectId}`, {
            projectMeasurementsCount: projectMeasurements.length,
            totalMeasurementsInStore: allMeasurements.length,
            source: 'Supabase'
          });
          return { 
            takeoffMeasurements: allMeasurements,
            loadingMeasurements: false,
            loadingMeasurementsProjectId: null
          };
        });
        
        get().updateMarkupsByPage();
        
        console.log(`✅ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Project measurements loaded from Supabase for ${projectId}:`, projectMeasurements.length);
      } catch (error) {
        console.error(`❌ LOAD_PROJECT_TAKEOFF_MEASUREMENTS: Failed to load measurements for project ${projectId} from Supabase:`, error);
        
        const currentProjectStore = useProjectStore.getState();
        if (currentProjectStore.currentProjectId === projectId) {
          set(state => ({
            takeoffMeasurements: state.takeoffMeasurements.filter(m => m.projectId !== projectId),
            markupsByPage: {},
            loadingMeasurements: false,
            loadingMeasurementsProjectId: null
          }));
          get().updateMarkupsByPage();
        } else {
          set({ 
            loadingMeasurements: false,
            loadingMeasurementsProjectId: null
          });
        }
      }
    },

    loadPageTakeoffMeasurements: async (projectId: string, sheetId: string, pageNumber: number) => {
      const pageKey = `${projectId}-${sheetId}-${pageNumber}`;
      const state = get();
      
      if (state.loadedPages.has(pageKey)) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`⏭️ LOAD_PAGE_TAKEOFF_MEASUREMENTS: Page ${pageNumber} already loaded for sheet ${sheetId}, skipping`);
        }
        return;
      }
      
      if (state.loadingPages.has(pageKey)) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`⏳ LOAD_PAGE_TAKEOFF_MEASUREMENTS: Page ${pageNumber} already loading for sheet ${sheetId}, skipping duplicate request`);
        }
        return;
      }
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔄 LOAD_PAGE_TAKEOFF_MEASUREMENTS: Loading measurements for page ${pageNumber} of sheet ${sheetId}`);
      }
      
      set(state => {
        const updatedLoadingPages = new Set(state.loadingPages);
        updatedLoadingPages.add(pageKey);
        return { loadingPages: updatedLoadingPages };
      });
      
      try {
        const { takeoffMeasurementService } = await import('../../services/apiService');
        
        const response = await takeoffMeasurementService.getPageTakeoffMeasurements(sheetId, pageNumber);
        const pageMeasurements = response.measurements || [];
        
        if (process.env.NODE_ENV === 'development') {
          console.log(`✅ LOAD_PAGE_TAKEOFF_MEASUREMENTS: Loaded ${pageMeasurements.length} measurements for page ${pageNumber}`);
        }
        
        set(state => {
          const existingIds = new Set(state.takeoffMeasurements.map((m: TakeoffMeasurement) => m.id));
          const newMeasurements = pageMeasurements.filter((m: TakeoffMeasurement) => !existingIds.has(m.id));
          
          const updatedLoadedPages = new Set(state.loadedPages);
          updatedLoadedPages.add(pageKey);
          const updatedLoadingPages = new Set(state.loadingPages);
          updatedLoadingPages.delete(pageKey);
          
          return {
            takeoffMeasurements: [...state.takeoffMeasurements, ...newMeasurements],
            loadedPages: updatedLoadedPages,
            loadingPages: updatedLoadingPages
          };
        });
        
        get().updateMarkupsByPage();
        
      } catch (error) {
        console.error(`❌ LOAD_PAGE_TAKEOFF_MEASUREMENTS: Failed to load measurements for page ${pageNumber} of sheet ${sheetId}:`, error);
        
        set(state => {
          const updatedLoadingPages = new Set(state.loadingPages);
          updatedLoadingPages.delete(pageKey);
          return { loadingPages: updatedLoadingPages };
        });
      }
    }
  })
);
