import { createClient } from '@supabase/supabase-js'

// Supabase project credentials
const supabaseUrl = 'https://ufbsppxapyuplxafmpsn.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmYnNwcHhhcHl1cGx4YWZtcHNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEzNDA1ODYsImV4cCI6MjA2NjkxNjU4Nn0.WmW6cfQfKwPtmYn_w0joNEQLs59URsYrVgY5KML-CrE'

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
          cutouts: any | null // JSON array of cut-out objects
          net_calculated_value: number | null
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
          cutouts?: any | null
          net_calculated_value?: number | null
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
          cutouts?: any | null
          net_calculated_value?: number | null
          created_at?: string
        }
      }
    }
  }
}
