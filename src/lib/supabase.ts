import { createClient } from '@supabase/supabase-js'

// You'll need to replace these with your actual Supabase project credentials
// Get these from: https://supabase.com/dashboard/project/[your-project]/settings/api
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'your-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Database types
export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string
          name: string
          client: string
          location: string
          status: string
          description: string
          project_type: string
          start_date: string | null
          contact_person: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          last_modified: string
        }
        Insert: {
          id?: string
          name: string
          client: string
          location: string
          status?: string
          description?: string
          project_type?: string
          start_date?: string | null
          contact_person?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          last_modified?: string
        }
        Update: {
          id?: string
          name?: string
          client?: string
          location?: string
          status?: string
          description?: string
          project_type?: string
          start_date?: string | null
          contact_person?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          last_modified?: string
        }
      }
      conditions: {
        Row: {
          id: string
          project_id: string
          name: string
          type: 'area' | 'volume' | 'linear' | 'count'
          unit: string
          waste_factor: number
          color: string
          description: string
          labor_cost: number | null
          material_cost: number | null
          include_perimeter: boolean | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          name: string
          type: 'area' | 'volume' | 'linear' | 'count'
          unit: string
          waste_factor?: number
          color: string
          description?: string
          labor_cost?: number | null
          material_cost?: number | null
          include_perimeter?: boolean | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          name?: string
          type?: 'area' | 'volume' | 'linear' | 'count'
          unit?: string
          waste_factor?: number
          color?: string
          description?: string
          labor_cost?: number | null
          material_cost?: number | null
          include_perimeter?: boolean | null
          created_at?: string
        }
      }
      measurements: {
        Row: {
          id: string
          project_id: string
          file_id: string
          pdf_page: number
          type: 'area' | 'volume' | 'linear' | 'count'
          points: any // JSON array of points
          calculated_value: number
          unit: string
          condition_id: string
          color: string
          condition_name: string
          timestamp: number
          pdf_coordinates: any // JSON array of PDF-relative coordinates
          perimeter_value: number | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          file_id: string
          pdf_page: number
          type: 'area' | 'volume' | 'linear' | 'count'
          points: any
          calculated_value: number
          unit: string
          condition_id: string
          color: string
          condition_name: string
          timestamp?: number
          pdf_coordinates: any
          perimeter_value?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          file_id?: string
          pdf_page?: number
          type?: 'area' | 'volume' | 'linear' | 'count'
          points?: any
          calculated_value?: number
          unit?: string
          condition_id?: string
          color?: string
          condition_name?: string
          timestamp?: number
          pdf_coordinates?: any
          perimeter_value?: number | null
          created_at?: string
        }
      }
    }
  }
}
