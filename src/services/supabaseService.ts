import { supabase, Database, authHelpers } from '../lib/supabase'
import type { ProjectFile } from '../types'

type Project = Database['public']['Tables']['projects']['Row']
type ProjectInsert = Database['public']['Tables']['projects']['Insert']
type ProjectUpdate = Database['public']['Tables']['projects']['Update']

type Condition = Database['public']['Tables']['conditions']['Row']
type ConditionInsert = Database['public']['Tables']['conditions']['Insert']
type ConditionUpdate = Database['public']['Tables']['conditions']['Update']

type Measurement = Database['public']['Tables']['measurements']['Row']
type MeasurementInsert = Database['public']['Tables']['measurements']['Insert']
type MeasurementUpdate = Database['public']['Tables']['measurements']['Update']

// Extended project type with user info
export interface ProjectWithUser extends Project {
  user_email?: string;
  user_name?: string;
}

// Project with takeoff/condition counts and computed total (from getProjects)
export interface ProjectWithCounts extends ProjectWithUser {
  takeoffCount: number;
  conditionCount: number;
  totalValue: number;
  profitMarginPercent?: number;
}

// Row shape from takeoff_files table (snake_case)
export interface TakeoffFileRow {
  id: string;
  project_id: string;
  original_name: string;
  filename: string;
  path: string;
  size: number;
  mimetype: string;
  created_at: string;
  [key: string]: unknown;
}

// Helper function to convert camelCase project fields to snake_case for database
function projectToDbFormat(project: Record<string, unknown>): Record<string, unknown> {
  const dbProject: Record<string, unknown> = {};
  
  const toNullIfEmpty = (value: unknown): unknown => {
    if (value === null || value === undefined) {
      return null;
    }
    // If it's a string, trim it and convert empty/whitespace-only strings to null
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }
    return value;
  };
  
  if (project.name !== undefined) dbProject.name = project.name;
  if (project.client !== undefined) dbProject.client = project.client;
  if (project.location !== undefined) dbProject.location = project.location;
  if (project.status !== undefined) dbProject.status = project.status;
  if (project.description !== undefined) dbProject.description = toNullIfEmpty(project.description);
  if (project.projectType !== undefined) dbProject.project_type = toNullIfEmpty(project.projectType);
  if (project.startDate !== undefined) dbProject.start_date = toNullIfEmpty(project.startDate);
  if (project.estimatedValue !== undefined) dbProject.estimated_value = project.estimatedValue ?? null;
  if (project.contactPerson !== undefined) dbProject.contact_person = toNullIfEmpty(project.contactPerson);
  if (project.contactEmail !== undefined) dbProject.contact_email = toNullIfEmpty(project.contactEmail);
  if (project.contactPhone !== undefined) dbProject.contact_phone = toNullIfEmpty(project.contactPhone);
  if (project.profitMarginPercent !== undefined) dbProject.profit_margin_percent = project.profitMarginPercent ?? null;
  if (project.createdAt !== undefined) dbProject.created_at = project.createdAt;
  if (project.lastModified !== undefined) dbProject.last_modified = project.lastModified;

  Object.keys(project).forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(dbProject, key) && key !== 'id' && key !== 'user_id') {
      if (key.includes('_') || !Number.isNaN(Number(key))) {
        const value = project[key];
        // Convert empty strings to null for date fields
        if ((key === 'start_date' || key.endsWith('_date')) && value === '') {
          dbProject[key] = null;
        } else {
          dbProject[key] = value;
        }
      }
    }
  });
  
  return dbProject;
}

export const supabaseService = {
  // Projects
  async getProjects(): Promise<ProjectWithCounts[]> {
    // Simple query that works with RLS
    const { data, error } = await supabase
      .from('takeoff_projects')
      .select('*')
      .order('last_modified', { ascending: false });
    
    if (error) {
      console.error('Error fetching projects:', error)
      throw error
    }
    
    // Transform data to include user info (simplified) and map snake_case to camelCase
    const baseProjects = (data || []).map(project => ({
      ...project,
      lastModified: project.last_modified, // Map snake_case to camelCase
      createdAt: project.created_at, // Map snake_case to camelCase
      user_email: undefined, // We'll add this later if needed
      user_name: undefined
    }));

    // Attach takeoff/condition counts and computed total value per project (from conditions + measurements)
    const projectsWithCounts = await Promise.all(
      baseProjects.map(async (project) => {
        try {
          const [conditionsDataRes, measurementsDataRes] = await Promise.all([
            supabase
              .from('takeoff_conditions')
              .select('id, material_cost, equipment_cost, waste_factor')
              .eq('project_id', project.id),
            supabase
              .from('takeoff_measurements')
              .select('condition_id, calculated_value, net_calculated_value')
              .eq('project_id', project.id)
          ]);
          const conditions = (conditionsDataRes.data ?? []) as Array<{ id: string; material_cost: number | null; equipment_cost?: number | null; waste_factor?: number }>;
          const measurements = (measurementsDataRes.data ?? []) as Array<{ condition_id: string; calculated_value: number; net_calculated_value: number | null }>;
          const conditionCount = conditions.length;
          const takeoffCount = measurements.length;

          // Compute project total cost (same formula as measurementSlice getProjectCostBreakdown)
          const profitMarginPercent = (project as { profit_margin_percent?: number }).profit_margin_percent ?? 15;
          let subtotal = 0;
          for (const cond of conditions) {
            const materialCostPerUnit = cond.material_cost ?? 0;
            const equipmentCost = cond.equipment_cost ?? 0;
            const wasteFactor = cond.waste_factor ?? 0;
            const conditionMeasurements = measurements.filter((m) => m.condition_id === cond.id);
            const quantity = conditionMeasurements.reduce((sum, m) => {
              const value = m.net_calculated_value != null ? m.net_calculated_value : m.calculated_value;
              return sum + (value ?? 0);
            }, 0);
            const adjustedQuantity = quantity * (1 + wasteFactor / 100);
            const materialCost = adjustedQuantity * materialCostPerUnit;
            const wasteCost = (adjustedQuantity - quantity) * materialCostPerUnit;
            subtotal += materialCost + equipmentCost + wasteCost;
          }
          const profitMarginAmount = subtotal * (profitMarginPercent / 100);
          const totalCost = Math.round((subtotal + profitMarginAmount) * 100) / 100;

          return {
            ...project,
            takeoff_count: undefined,
            takeoffCount: takeoffCount || 0,
            conditionCount: conditionCount || 0,
            totalValue: totalCost,
            profitMarginPercent: profitMarginPercent
          } as ProjectWithCounts;
        } catch (e) {
          console.warn('Failed to load counts/total for project', project.id, e);
          return {
            ...project,
            takeoffCount: 0,
            conditionCount: 0,
            totalValue: 0,
            profitMarginPercent: (project as { profit_margin_percent?: number }).profit_margin_percent ?? 15
          } as ProjectWithCounts;
        }
      })
    );

    return projectsWithCounts;
  },

  async createProject(project: Omit<ProjectInsert, 'user_id'> | Record<string, unknown>): Promise<Project> {
    const user = await authHelpers.getCurrentUser();
    if (!user) throw new Error('No authenticated user');

    // Convert camelCase to snake_case for database
    const dbProject = projectToDbFormat(project);

    const { data, error } = await supabase
      .from('takeoff_projects')
      .insert({
        ...dbProject,
        user_id: user.id
      })
      .select()
      .single()
    
    if (error) {
      console.error('Error creating project:', error)
      throw error
    }
    
    return data
  },

  async updateProject(id: string, updates: ProjectUpdate | Record<string, unknown>): Promise<Project> {
    // Convert camelCase to snake_case for database
    const dbUpdates = projectToDbFormat(updates);

    const { data, error } = await supabase
      .from('takeoff_projects')
      .update({ ...dbUpdates, last_modified: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    
    if (error) {
      console.error('Error updating project:', error)
      throw error
    }
    
    return data
  },

  // Conditions
  async getProjectConditions(projectId: string): Promise<Condition[]> {
    const { data, error } = await supabase
      .from('takeoff_conditions')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    
    if (error) {
      console.error('Error fetching conditions:', error)
      throw error
    }
    
    return data || []
  },

  async createCondition(condition: ConditionInsert): Promise<Condition> {
    const { data, error } = await supabase
      .from('takeoff_conditions')
      .insert(condition)
      .select()
      .single()
    
    if (error) {
      console.error('Error creating condition:', error)
      throw error
    }
    
    return data
  },

  async updateCondition(id: string, updates: ConditionUpdate): Promise<Condition> {
    const { data, error } = await supabase
      .from('takeoff_conditions')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) {
      console.error('Error updating condition:', error)
      throw error
    }
    
    return data
  },

  async deleteCondition(id: string): Promise<void> {
    const { error } = await supabase
      .from('takeoff_conditions')
      .delete()
      .eq('id', id)
    
    if (error) {
      console.error('Error deleting condition:', error)
      throw error
    }
  },

  // Measurements
  async getProjectMeasurements(projectId: string): Promise<Measurement[]> {
    const { data, error } = await supabase
      .from('takeoff_measurements')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    
    if (error) {
      console.error('Error fetching measurements:', error)
      throw error
    }
    
    return data || []
  },

  async getPageMeasurements(projectId: string, fileId: string, pageNumber: number): Promise<Measurement[]> {
    const { data, error } = await supabase
      .from('takeoff_measurements')
      .select('*')
      .eq('project_id', projectId)
      .eq('sheet_id', fileId)
      .eq('pdf_page', pageNumber)
      .order('created_at', { ascending: false })
    
    if (error) {
      console.error('Error fetching page measurements:', error)
      throw error
    }
    
    return data || []
  },

  async createMeasurement(measurement: MeasurementInsert): Promise<Measurement> {
    const { data, error } = await supabase
      .from('takeoff_measurements')
      .insert(measurement)
      .select()
      .single()
    
    if (error) {
      console.error('Error creating measurement:', error)
      throw error
    }
    
    return data
  },

  async updateMeasurement(id: string, updates: MeasurementUpdate): Promise<Measurement> {
    const { data, error } = await supabase
      .from('takeoff_measurements')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) {
      console.error('Error updating measurement:', error)
      throw error
    }
    
    return data
  },

  async deleteMeasurement(id: string): Promise<void> {
    const { error } = await supabase
      .from('takeoff_measurements')
      .delete()
      .eq('id', id)
    
    if (error) {
      console.error('Error deleting measurement:', error)
      throw error
    }
  },

  async clearPageMeasurements(projectId: string, fileId: string, pageNumber: number): Promise<void> {
    const { error } = await supabase
      .from('takeoff_measurements')
      .delete()
      .eq('project_id', projectId)
      .eq('sheet_id', fileId)
      .eq('pdf_page', pageNumber)
    
    if (error) {
      console.error('Error clearing page measurements:', error)
      throw error
    }
  },

  // Files
  async getProjectFiles(projectId: string): Promise<TakeoffFileRow[]> {
    const { data, error } = await supabase
      .from('takeoff_files')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    
    if (error) {
      console.error('Error fetching files:', error)
      throw error
    }
    
    return data || []
  },

  async uploadPDF(file: File, projectId: string): Promise<{ file: ProjectFile }> {
    // For now, we'll use the existing backend API for file uploads
    // This is because file uploads are complex and the backend handles storage
    const { getApiBaseUrl } = await import('../lib/apiConfig');
    const API_BASE_URL = getApiBaseUrl();
    
    const formData = new FormData()
    formData.append('file', file)
    formData.append('projectId', projectId)
    
    const response = await fetch(`${API_BASE_URL}/files/upload`, {
      method: 'POST',
      body: formData
    })
    
    if (!response.ok) {
      throw new Error('Upload failed')
    }
    
    return await response.json()
  },

  async deletePDF(fileId: string): Promise<void> {
    const { error } = await supabase
      .from('takeoff_files')
      .delete()
      .eq('id', fileId)
    
    if (error) {
      console.error('Error deleting file:', error)
      throw error
    }
  },

  async getPDFUrl(fileId: string): Promise<string> {
    // Use the correct API base URL instead of hardcoded localhost
    const { getApiBaseUrl } = await import('../lib/apiConfig');
    const API_BASE_URL = getApiBaseUrl();
    return `${API_BASE_URL}/files/${fileId}`
  }
}
