import { supabase, Database } from '../lib/supabase'

type Project = Database['public']['Tables']['projects']['Row']
type ProjectInsert = Database['public']['Tables']['projects']['Insert']
type ProjectUpdate = Database['public']['Tables']['projects']['Update']

type Condition = Database['public']['Tables']['conditions']['Row']
type ConditionInsert = Database['public']['Tables']['conditions']['Insert']
type ConditionUpdate = Database['public']['Tables']['conditions']['Update']

type Measurement = Database['public']['Tables']['measurements']['Row']
type MeasurementInsert = Database['public']['Tables']['measurements']['Insert']
type MeasurementUpdate = Database['public']['Tables']['measurements']['Update']

export const supabaseService = {
  // Projects
  async getProjects(): Promise<Project[]> {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('last_modified', { ascending: false })
    
    if (error) {
      console.error('Error fetching projects:', error)
      throw error
    }
    
    return data || []
  },

  async createProject(project: ProjectInsert): Promise<Project> {
    const { data, error } = await supabase
      .from('projects')
      .insert(project)
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
      .from('projects')
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
      .from('conditions')
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
      .from('conditions')
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
      .from('conditions')
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
      .from('conditions')
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
      .from('measurements')
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
      .from('measurements')
      .select('*')
      .eq('project_id', projectId)
      .eq('file_id', fileId)
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
      .from('measurements')
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
      .from('measurements')
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
      .from('measurements')
      .delete()
      .eq('id', id)
    
    if (error) {
      console.error('Error deleting measurement:', error)
      throw error
    }
  },

  async clearPageMeasurements(projectId: string, fileId: string, pageNumber: number): Promise<void> {
    const { error } = await supabase
      .from('measurements')
      .delete()
      .eq('project_id', projectId)
      .eq('file_id', fileId)
      .eq('pdf_page', pageNumber)
    
    if (error) {
      console.error('Error clearing page measurements:', error)
      throw error
    }
  }
}
