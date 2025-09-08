import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Project {
  id: string;
  name: string;
  client: string;
  location: string;
  status: 'active' | 'completed' | 'on-hold';
  lastModified: Date;
  takeoffCount: number;
  totalValue: number;
  description?: string;
  projectType?: string;
  startDate?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
}

interface TakeoffCondition {
  id: string;
  projectId: string;
  name: string;
  type: 'area' | 'volume' | 'linear' | 'count';
  unit: string;
  wasteFactor: number;
  color: string;
  description: string;
}

interface Measurement {
  id: string;
  projectId: string;
  type: 'linear' | 'area' | 'volume' | 'count';
  value: number;
  unit: string;
  description: string;
  conditionId?: string;
  timestamp: Date;
}

interface Calibration {
  projectId: string;
  sheetId: string;
  scaleFactor: number;
  unit: string;
  calibratedAt: Date;
}

interface TakeoffMeasurement {
  id: string;
  projectId: string;
  sheetId: string;
  conditionId: string;
  type: 'area' | 'volume' | 'linear' | 'count';
  points: Array<{ x: number; y: number }>;
  calculatedValue: number;
  unit: string;
  timestamp: Date;
  // PDF-specific properties
  pdfPage: number;
  pdfCoordinates: Array<{ x: number; y: number }>; // PDF-relative coordinates (0-1 scale)
  conditionColor: string;
  conditionName: string;
}

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
  
  // Takeoff measurements
  takeoffMeasurements: TakeoffMeasurement[];
  
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
  
  addMeasurement: (measurement: Omit<Measurement, 'id' | 'timestamp'>) => string;
  updateMeasurement: (id: string, updates: Partial<Measurement>) => void;
  deleteMeasurement: (id: string) => void;
  
  // Calibration actions
  setCalibration: (projectId: string, sheetId: string, scaleFactor: number, unit: string) => void;
  getCalibration: (projectId: string, sheetId: string) => Calibration | null;
  
  // Takeoff measurement actions
  addTakeoffMeasurement: (measurement: Omit<TakeoffMeasurement, 'id' | 'timestamp'>) => string;
  updateTakeoffMeasurement: (id: string, updates: Partial<TakeoffMeasurement>) => void;
  deleteTakeoffMeasurement: (id: string) => void;
  
  // New methods for takeoff functionality
  getSheetTakeoffMeasurements: (projectId: string, sheetId: string) => TakeoffMeasurement[];
  getConditionTakeoffMeasurements: (projectId: string, conditionId: string) => TakeoffMeasurement[];
  getProjectTakeoffSummary: (projectId: string) => {
    totalMeasurements: number;
    totalValue: number;
    byCondition: Record<string, { count: number; value: number; unit: string }>;
  };
  
  // Computed values
  getCurrentProject: () => Project | null;
  getProjectMeasurements: (projectId: string) => Measurement[];
  getSelectedCondition: () => TakeoffCondition | null;
  getProjectTakeoffMeasurements: (projectId: string) => TakeoffMeasurement[];
  
  // Data loading
  loadInitialData: () => Promise<void>;
  loadProjectConditions: (projectId: string) => Promise<void>;
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
          calibratedAt: new Date()
        }
      ],
      currentCalibration: null,
      
      takeoffMeasurements: [],
      
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
            lastModified: new Date(),
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
              ? { ...project, ...updates, lastModified: new Date() }
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
        try {
          // Import the API service dynamically to avoid circular dependencies
          const { conditionService } = await import('../services/apiService');
          
          // Create condition via API
          const response = await conditionService.createCondition(conditionData);
          const condition = response.condition || response;
          
          // Add to local store
          set(state => ({
            conditions: [...state.conditions, condition]
          }));
          
          return condition.id;
        } catch (error: any) {
          console.warn('Failed to create condition via API, creating locally:', error.message);
          
          // Create condition locally as fallback
          const id = Date.now().toString();
          const condition = {
            ...conditionData,
            id
          };
          
          set(state => ({
            conditions: [...state.conditions, condition]
          }));
          
          return id;
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
          
          // Update local store
          set(state => ({
            conditions: state.conditions.filter(condition => condition.id !== id),
            selectedConditionId: state.selectedConditionId === id ? null : state.selectedConditionId
          }));
        } catch (error) {
          console.error('Failed to delete condition:', error);
          throw error;
        }
      },
      
      setSelectedCondition: (id) => {
        set({ selectedConditionId: id });
      },
      
      addMeasurement: (measurementData) => {
        const id = Date.now().toString();
        const measurement: Measurement = {
          ...measurementData,
          id,
          timestamp: new Date()
        };
        
        set(state => ({
          measurements: [...state.measurements, measurement],
          projects: state.projects.map(project =>
            project.id === measurementData.projectId
              ? { ...project, takeoffCount: project.takeoffCount + 1 }
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
                ? { ...project, takeoffCount: Math.max(0, project.takeoffCount - 1) }
                : project
            ) : state.projects
          };
        });
      },
      
             setCalibration: (projectId, sheetId, scaleFactor, unit) => {
         set(state => {
           const existingIndex = state.calibrations.findIndex(
             c => c.projectId === projectId && c.sheetId === sheetId
           );
           
           if (existingIndex >= 0) {
             // Update existing calibration
             const updatedCalibrations = [...state.calibrations];
             updatedCalibrations[existingIndex] = { 
               projectId, 
               sheetId, 
               scaleFactor, 
               unit, 
               calibratedAt: new Date() 
             };
             return { calibrations: updatedCalibrations };
           } else {
             // Add new calibration
             return {
               calibrations: [...state.calibrations, { 
                 projectId, 
                 sheetId, 
                 scaleFactor, 
                 unit, 
                 calibratedAt: new Date() 
               }]
             };
           }
         });
       },
       
       getCalibration: (projectId, sheetId) => {
         const { calibrations } = get();
         return calibrations.find(c => c.projectId === projectId && c.sheetId === sheetId) || null;
       },
      
      addTakeoffMeasurement: (measurementData) => {
        const id = Date.now().toString();
        const condition = get().conditions.find(c => c.id === measurementData.conditionId);
        const measurement: TakeoffMeasurement = {
          ...measurementData,
          id,
          timestamp: new Date(),
          conditionColor: condition?.color || '#000000',
          conditionName: condition?.name || 'Unknown'
        };
        
        console.log('Adding takeoff measurement to store:', measurement);
        
        set(state => {
          const newState = {
            takeoffMeasurements: [...state.takeoffMeasurements, measurement]
          };
          console.log('New store state:', newState);
          return newState;
        });
        
        return id;
      },
      
      updateTakeoffMeasurement: (id, updates) => {
        set(state => ({
          takeoffMeasurements: state.takeoffMeasurements.map(measurement =>
            measurement.id === id ? { ...measurement, ...updates } : measurement
          )
        }));
      },
      
      deleteTakeoffMeasurement: (id) => {
        set(state => ({
          takeoffMeasurements: state.takeoffMeasurements.filter(measurement => measurement.id !== id)
        }));
      },
      
      // New methods for takeoff functionality
      getSheetTakeoffMeasurements: (projectId, sheetId) => {
        const { takeoffMeasurements } = get();
        console.log('getSheetTakeoffMeasurements called with:', { projectId, sheetId });
        console.log('All takeoff measurements:', takeoffMeasurements);
        const filtered = takeoffMeasurements.filter(m => m.projectId === projectId && m.sheetId === sheetId);
        console.log('Filtered measurements:', filtered);
        return filtered;
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
          const { projectService, conditionService } = await import('../services/apiService');
          
          // Load projects
          const projectsResponse = await projectService.getProjects();
          const projects = projectsResponse.projects || [];
          
          // Load all conditions
          const conditionsResponse = await conditionService.getConditions();
          const conditions = conditionsResponse.conditions || [];
          
          set(state => ({
            projects,
            conditions
          }));
          
          console.log('Initial data loaded:', { projects: projects.length, conditions: conditions.length });
        } catch (error: any) {
          console.warn('Failed to load initial data from API, using offline mode:', error.message);
          
          // Provide fallback data for offline mode
          const fallbackProjects = [
            {
              id: 'demo-project-1',
              name: 'Demo Construction Project',
              client: 'Demo Client',
              location: 'Demo Location',
              status: 'active' as const,
              lastModified: new Date(),
              takeoffCount: 0,
              totalValue: 0,
              description: 'This is a demo project for testing the takeoff tool'
            }
          ];
          
          const fallbackConditions = [
            {
              id: 'demo-condition-1',
              projectId: 'demo-project-1',
              name: 'Concrete Slab',
              type: 'area' as const,
              unit: 'sq ft',
              wasteFactor: 0.1,
              color: '#3B82F6',
              description: 'Concrete slab area measurement'
            },
            {
              id: 'demo-condition-2',
              projectId: 'demo-project-1',
              name: 'Steel Reinforcement',
              type: 'linear' as const,
              unit: 'ft',
              wasteFactor: 0.05,
              color: '#EF4444',
              description: 'Steel rebar linear measurement'
            }
          ];
          
          set(state => ({
            projects: fallbackProjects,
            conditions: fallbackConditions
          }));
          
          console.log('Using fallback data for offline mode');
        }
      },
      
      loadProjectConditions: async (projectId: string) => {
        try {
          // Import the API service dynamically to avoid circular dependencies
          const { conditionService } = await import('../services/apiService');
          
          // Load conditions for specific project
          const conditionsResponse = await conditionService.getProjectConditions(projectId);
          const projectConditions = conditionsResponse.conditions || [];
          
          // Merge with existing conditions, avoiding duplicates
          set(state => {
            const existingConditions = state.conditions.filter(c => c.projectId !== projectId);
            const allConditions = [...existingConditions, ...projectConditions];
            return { conditions: allConditions };
          });
          
          console.log(`Project conditions loaded for ${projectId}:`, projectConditions.length);
        } catch (error) {
          console.error(`Failed to load conditions for project ${projectId}:`, error);
        }
      }
    }),
    {
      name: 'takeoff-store',
      partialize: (state) => ({
        projects: state.projects,
        conditions: state.conditions,
        measurements: state.measurements,
        calibrations: state.calibrations,
        takeoffMeasurements: state.takeoffMeasurements
      })
    }
  )
);
