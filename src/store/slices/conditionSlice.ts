import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TakeoffCondition } from '../../types';
import { useProjectStore } from './projectSlice';
import { supabase } from '../../lib/supabase';

interface ConditionState {
  // State
  conditions: TakeoffCondition[];
  selectedConditionId: string | null;
  loadingConditions: boolean;
  
  // Actions
  addCondition: (
    condition: Omit<TakeoffCondition, 'id'>,
    options?: { insertAfterId?: string }
  ) => Promise<string>;
  updateCondition: (id: string, updates: Partial<TakeoffCondition>) => Promise<void>;
  deleteCondition: (id: string) => Promise<void>;
  setSelectedCondition: (id: string | null) => void;
  setConditions: (conditions: TakeoffCondition[]) => void;
  
  // Getters
  getSelectedCondition: () => TakeoffCondition | null;
  getProjectConditions: (projectId: string) => TakeoffCondition[];
  getConditionById: (id: string) => TakeoffCondition | undefined;
  
  // Data loading
  loadProjectConditions: (projectId: string) => Promise<void>;
  refreshProjectConditions: (projectId: string) => Promise<void>;
  ensureConditionsLoaded: (projectId: string) => Promise<void>;
}

export const useConditionStore = create<ConditionState>()(
  persist(
    (set, get) => ({
      // Initial state
      conditions: [],
      selectedConditionId: null,
      loadingConditions: false,
      
      // Actions
      addCondition: async (conditionData, options) => {
        console.log('🔄 ADD_CONDITION: Starting to create condition:', conditionData);
        try {
          const { conditionService } = await import('../../services/apiService');
          
          console.log('🔄 ADD_CONDITION: Calling API to create condition...');
          const response = await conditionService.createCondition(conditionData);
          console.log('✅ ADD_CONDITION: API response received:', response);
          const condition = response.condition || response;
          
          set(state => {
            console.log('💾 ADD_CONDITION: Adding condition to store from backend:', condition);
            const afterId = options?.insertAfterId;
            const insertAt =
              afterId != null ? state.conditions.findIndex((c) => c.id === afterId) : -1;
            const nextConditions =
              insertAt >= 0
                ? [
                    ...state.conditions.slice(0, insertAt + 1),
                    condition,
                    ...state.conditions.slice(insertAt + 1),
                  ]
                : [...state.conditions, condition];
            return { conditions: nextConditions };
          });
          
          console.log('✅ ADD_CONDITION: Condition created successfully with ID:', condition.id);
          return condition.id;
        } catch (error: unknown) {
          console.error('❌ ADD_CONDITION: Failed to create condition via API:', error);
          const msg = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to create condition: ${msg}`);
        }
      },
      
      updateCondition: async (id, updates) => {
        try {
          const { conditionService } = await import('../../services/apiService');
          
          const response = await conditionService.updateCondition(id, updates);
          const updatedCondition = response.condition || response;
          
          set(state => ({
            conditions: state.conditions.map(condition =>
              condition.id === id ? { ...condition, ...updatedCondition } : condition
            )
          }));

          // Sync denormalized condition styling to existing measurements so viewer/export reflect updates
          const { useMeasurementStore } = await import('./measurementSlice');
          useMeasurementStore.setState((state) => ({
            takeoffMeasurements: state.takeoffMeasurements.map((m) =>
              m.conditionId === id
                ? {
                    ...m,
                    conditionColor: updatedCondition.color ?? m.conditionColor,
                    conditionName: updatedCondition.name ?? m.conditionName,
                    ...(m.type === 'linear' &&
                      updatedCondition.lineThickness != null && {
                        conditionLineThickness: updatedCondition.lineThickness,
                      }),
                  }
                : m
            ),
          }));
          useMeasurementStore.getState().updateMarkupsByPage();
        } catch (error) {
          console.error('Failed to update condition:', error);
          throw error;
        }
      },
      
      deleteCondition: async (id) => {
        try {
          const { conditionService } = await import('../../services/apiService');
          await conditionService.deleteCondition(id);

          set(state => ({
            conditions: state.conditions.filter(condition => condition.id !== id),
            selectedConditionId: state.selectedConditionId === id ? null : state.selectedConditionId
          }));

          const { useMeasurementStore } = await import('./measurementSlice');
          useMeasurementStore.setState(state => ({
            takeoffMeasurements: state.takeoffMeasurements.filter(m => m.conditionId !== id)
          }));
          useMeasurementStore.getState().updateMarkupsByPage();
          const currentProjectId = useProjectStore.getState().currentProjectId;
          if (currentProjectId) {
            await useMeasurementStore.getState().loadProjectTakeoffMeasurements(currentProjectId);
          }
          console.log(`✅ DELETE_CONDITION: Deleted condition ${id}`);
        } catch (error) {
          console.error('Failed to delete condition:', error);
          throw error;
        }
      },
      
      setSelectedCondition: (id) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('🏪 STORE_SET_SELECTED_CONDITION:', {
            newId: id,
            previousId: get().selectedConditionId,
            timestamp: new Date().toISOString()
          });
        }
        set({ selectedConditionId: id });
      },
      
      setConditions: (conditions) => {
        set({ conditions });
      },
      
      // Getters
      getSelectedCondition: () => {
        const { conditions, selectedConditionId } = get();
        const cond = conditions.find((c) => c.id === selectedConditionId) || null;
        if (!cond) return null;
        const currentProjectId = useProjectStore.getState().currentProjectId;
        if (currentProjectId != null && cond.projectId !== currentProjectId) {
          return null;
        }
        return cond;
      },
      
      getProjectConditions: (projectId) => {
        const { conditions } = get();
        return conditions.filter(c => c.projectId === projectId);
      },
      
      getConditionById: (id) => {
        const { conditions } = get();
        const currentProjectId = useProjectStore.getState().currentProjectId;
        const found = conditions.find((c) => c.id === id);
        if (!found) return undefined;
        if (currentProjectId != null && found.projectId !== currentProjectId) {
          return undefined;
        }
        return found;
      },
      
      // Data loading
      loadProjectConditions: async (projectId: string) => {
        const state = get();
        
        if (state.loadingConditions) {
          console.log('🔄 LOAD_PROJECT_CONDITIONS: Already loading conditions, skipping duplicate request');
          return;
        }
        
        // Avoid 401: only call API when we have a session (token). Conditions route uses requireAuth.
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          console.warn('🔄 LOAD_PROJECT_CONDITIONS: No session yet, skipping API call (will retry when auth is ready)');
          return;
        }
        
        console.log('🔄 LOAD_PROJECT_CONDITIONS: Starting to load conditions for project:', projectId);
        
        set({ loadingConditions: true });
        
        const loadingTimeout = setTimeout(() => {
          const currentState = get();
          if (currentState.loadingConditions) {
            console.warn('⚠️ LOAD_PROJECT_CONDITIONS: Loading timeout, resetting loading state');
            set({ loadingConditions: false });
          }
        }, 10000);
        
        try {
          const { conditionService } = await import('../../services/apiService');
          
          console.log('🔄 LOAD_PROJECT_CONDITIONS: Calling API to get project conditions...');
          const conditionsResponse = await conditionService.getProjectConditions(projectId);
          console.log('✅ LOAD_PROJECT_CONDITIONS: API response received:', conditionsResponse);
          const projectConditions = conditionsResponse.conditions || [];
          
          set(state => {
            const existingConditions = state.conditions.filter(c => c.projectId !== projectId);
            const allConditions = [...existingConditions, ...projectConditions];
            console.log(`💾 LOAD_PROJECT_CONDITIONS: Merging conditions for project ${projectId}:`, {
              existingCount: existingConditions.length,
              projectConditionsCount: projectConditions.length,
              totalCount: allConditions.length
            });
            return { 
              conditions: allConditions,
              loadingConditions: false
            };
          });
          
          clearTimeout(loadingTimeout);
          console.log(`✅ LOAD_PROJECT_CONDITIONS: Project conditions loaded for ${projectId}:`, projectConditions.length);
        } catch (error) {
          console.error(`❌ LOAD_PROJECT_CONDITIONS: Failed to load conditions for project ${projectId}:`, error);
          set({ loadingConditions: false });
          clearTimeout(loadingTimeout);
        }
      },

      refreshProjectConditions: async (projectId: string) => {
        console.log('🔄 REFRESH_PROJECT_CONDITIONS: Force refreshing conditions for project:', projectId);
        set({ loadingConditions: false });
        await get().loadProjectConditions(projectId);
      },

      ensureConditionsLoaded: async (projectId: string) => {
        const state = get();
        const existingProjectConditions = state.conditions.filter(c => c.projectId === projectId);
        
        console.log(`🔄 ENSURE_CONDITIONS_LOADED: Loading conditions for project ${projectId} from API (found ${existingProjectConditions.length} in local storage)`);
        await get().loadProjectConditions(projectId);
      }
    }),
    {
      name: 'condition-store',
      partialize: (state) => ({
        conditions: state.conditions
      })
    }
  )
);
