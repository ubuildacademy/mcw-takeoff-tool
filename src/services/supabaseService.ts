import { supabase, Database, authHelpers } from '../lib/supabase'

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

export const supabaseService = {
  // Projects
  async getProjects(): Promise<ProjectWithUser[]> {
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

    // Attach takeoff counts for each project so the UI can display them
    // We use a head-only count query per project to respect RLS and avoid large payloads
    const projectsWithCounts = await Promise.all(
      baseProjects.map(async (project) => {
        try {
          const { count: takeoffCount } = await supabase
            .from('takeoff_measurements')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', project.id);
          const { count: conditionCount } = await supabase
            .from('takeoff_conditions')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', project.id);
          return {
            ...project,
            takeoff_count: undefined, // normalize if coming from a view
            takeoffCount: takeoffCount || 0,
            conditionCount: conditionCount || 0,
            totalValue: project.totalValue ?? 0
          } as any;
        } catch (e) {
          console.warn('Failed to load takeoff count for project', project.id, e);
          return {
            ...project,
            takeoffCount: 0,
            conditionCount: 0,
            totalValue: project.totalValue ?? 0
          } as any;
        }
      })
    );

    return projectsWithCounts;
  },

  async createProject(project: Omit<ProjectInsert, 'user_id'>): Promise<Project> {
    const user = await authHelpers.getCurrentUser();
    if (!user) throw new Error('No authenticated user');

    const { data, error } = await supabase
      .from('takeoff_projects')
      .insert({
        ...project,
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

  async updateProject(id: string, updates: ProjectUpdate): Promise<Project> {
    const { data, error } = await supabase
      .from('takeoff_projects')
      .update({ ...updates, last_modified: new Date().toISOString() })
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
  async getProjectFiles(projectId: string): Promise<any[]> {
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

  async uploadPDF(file: File, projectId: string): Promise<any> {
    // For now, we'll use the existing backend API for file uploads
    // This is because file uploads are complex and the backend handles storage
    const formData = new FormData()
    formData.append('file', file)
    formData.append('projectId', projectId)
    
    const response = await fetch(`http://localhost:4000/api/files/upload`, {
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
    // For now, use the backend API for file serving
    return `http://localhost:4000/api/files/${fileId}`
  }
}
