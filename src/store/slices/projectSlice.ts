import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Project } from '../../types';

interface ProjectState {
  // State
  projects: Project[];
  currentProjectId: string | null;
  
  // Actions
  addProject: (project: Omit<Project, 'id' | 'lastModified' | 'takeoffCount'>) => Promise<string>;
  importProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => void;
  setCurrentProject: (id: string) => void;
  setProjects: (projects: Project[]) => void;
  
  // Getters
  getCurrentProject: () => Project | null;
  
  // Data loading
  loadInitialData: () => Promise<void>;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      // Initial state
      projects: [],
      currentProjectId: null,
      
      // Actions
      addProject: async (projectData) => {
        try {
          const { supabaseService } = await import('../../services/supabaseService');
          const project = await supabaseService.createProject(projectData);
          
          const localProject: Project = {
            ...project,
            createdAt: project.created_at || new Date().toISOString(),
            lastModified: project.last_modified || new Date().toISOString(),
          } as Project;
          
          set(state => ({
            projects: [...state.projects, localProject]
          }));
          
          return project.id;
        } catch (error: any) {
          console.warn('Failed to create project via API, creating locally:', error.message);
          
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
      
      updateProject: async (id, updates) => {
        try {
          const { supabaseService } = await import('../../services/supabaseService');
          const updatedProject = await supabaseService.updateProject(id, updates);
          
          const localProject: Project = {
            ...updatedProject,
            createdAt: updatedProject.created_at || new Date().toISOString(),
            lastModified: updatedProject.last_modified || new Date().toISOString(),
          } as Project;
          
          set(state => ({
            projects: state.projects.map(project =>
              project.id === id ? localProject : project
            )
          }));
        } catch (error: any) {
          console.warn('Failed to update project via API, updating locally:', error.message);
          
          set(state => ({
            projects: state.projects.map(project =>
              project.id === id
                ? { ...project, ...updates, lastModified: new Date().toISOString() }
                : project
            )
          }));
        }
      },
      
      deleteProject: (id) => {
        set(state => ({
          projects: state.projects.filter(project => project.id !== id),
          currentProjectId: state.currentProjectId === id ? null : state.currentProjectId
        }));
      },
      
      setCurrentProject: (id) => {
        set({ currentProjectId: id });
      },
      
      setProjects: (projects) => {
        set({ projects });
      },
      
      // Getters
      getCurrentProject: () => {
        const { projects, currentProjectId } = get();
        return projects.find(project => project.id === currentProjectId) || null;
      },
      
      // Data loading
      loadInitialData: async () => {
        try {
          const { supabaseService } = await import('../../services/supabaseService');
          const projectsWithUser = await supabaseService.getProjects();
          
          const projects: Project[] = projectsWithUser.map((p: any) => ({
            id: p.id,
            name: p.name,
            client: p.client || '',
            location: p.location || '',
            status: p.status || 'active',
            description: p.description || undefined,
            projectType: p.project_type || undefined,
            startDate: p.start_date || undefined,
            estimatedValue: p.estimated_value || undefined,
            contactPerson: p.contact_person || undefined,
            contactEmail: p.contact_email || undefined,
            contactPhone: p.contact_phone || undefined,
            createdAt: p.created_at || new Date().toISOString(),
            lastModified: p.last_modified || new Date().toISOString(),
            takeoffCount: p.takeoffCount || 0,
            totalValue: p.totalValue || undefined,
            profitMarginPercent: p.profitMarginPercent || undefined,
          }));
          
          set({ projects });
          console.log('Projects loaded:', projects.length);
        } catch (error: any) {
          console.error('Failed to load projects from Supabase:', error);
          set({ projects: [] });
        }
      }
    }),
    {
      name: 'project-store',
      partialize: (state) => ({
        projects: state.projects
      })
    }
  )
);
