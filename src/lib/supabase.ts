import { createClient, User, Session } from '@supabase/supabase-js'

// Supabase project credentials - use environment variables in production
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://mxjyytwfhmoonkduvybr.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14anl5dHdmaG1vb25rZHV2eWJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxMzE4NTksImV4cCI6MjA3MzcwNzg1OX0.nG28P04Gdg9hbwasEeYKL2ekoSkWoInoT6RwUwA0BJ8'

// Validate that we have the required values
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase configuration. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Auth types
export interface UserMetadata {
  id: string
  role: 'admin' | 'user'
  full_name?: string
  company?: string
  created_at: string
  updated_at: string
}

export interface UserInvitation {
  id: string
  email: string
  role: 'admin' | 'user'
  invite_token: string
  status: 'pending' | 'accepted' | 'expired'
  invited_by?: string
  expires_at: string
  created_at: string
  accepted_at?: string
}

// Auth helper functions
export const authHelpers = {
  // Get current user
  async getCurrentUser(): Promise<User | null> {
    const { data: { user } } = await supabase.auth.getUser()
    return user
  },

  // Get current session
  async getCurrentSession(): Promise<Session | null> {
    const { data: { session } } = await supabase.auth.getSession()
    return session
  },

  // Sign in with email and password
  async signIn(email: string, password: string) {
    return await supabase.auth.signInWithPassword({
      email,
      password
    })
  },

  // Sign up with email and password
  async signUp(email: string, password: string, metadata?: { full_name?: string, company?: string }) {
    return await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata
      }
    })
  },

  // Sign out
  async signOut() {
    return await supabase.auth.signOut()
  },

  // Reset password
  async resetPassword(email: string) {
    return await supabase.auth.resetPasswordForEmail(email)
  },

  // Update password
  async updatePassword(password: string) {
    return await supabase.auth.updateUser({ password })
  },

  // Get user metadata
  async getUserMetadata(userId?: string): Promise<UserMetadata | null> {
    const targetUserId = userId || (await this.getCurrentUser())?.id
    if (!targetUserId) return null

    const { data, error } = await supabase
      .from('user_metadata')
      .select('*')
      .eq('id', targetUserId)
      .single()

    if (error) {
      console.error('Error fetching user metadata:', error)
      return null
    }

    return data
  },

  // Update user metadata
  async updateUserMetadata(updates: Partial<UserMetadata>) {
    const user = await this.getCurrentUser()
    if (!user) throw new Error('No authenticated user')

    return await supabase
      .from('user_metadata')
      .update(updates)
      .eq('id', user.id)
  },

  // Check if user is admin
  async isAdmin(userId?: string): Promise<boolean> {
    const metadata = await this.getUserMetadata(userId)
    return metadata?.role === 'admin'
  },

  // Get all users (admin only)
  async getAllUsers(): Promise<UserMetadata[]> {
    const { data, error } = await supabase
      .from('user_metadata')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching users:', error)
      return []
    }

    return data || []
  },

  // Create user invitation (now uses backend API to send email)
  async createInvitation(email: string, role: 'admin' | 'user') {
    // Use backend API which handles email sending
    const { userService } = await import('../services/apiService')
    return await userService.createInvitation(email, role)
  },

  // Get invitation by token
  async getInvitationByToken(token: string): Promise<UserInvitation | null> {
    const { data, error } = await supabase
      .from('user_invitations')
      .select('*')
      .eq('invite_token', token)
      .eq('status', 'pending')
      .single()

    if (error) {
      console.error('Error fetching invitation:', error)
      return null
    }

    // Check if invitation is expired
    if (new Date(data.expires_at) < new Date()) {
      // Mark as expired
      await supabase
        .from('user_invitations')
        .update({ status: 'expired' })
        .eq('id', data.id)
      return null
    }

    return data
  },

  // Accept invitation
  async acceptInvitation(token: string, userData: { full_name?: string, company?: string }) {
    const invitation = await this.getInvitationByToken(token)
    if (!invitation) throw new Error('Invalid or expired invitation')

    // Create user metadata
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No authenticated user')

    const { error: metadataError } = await supabase
      .from('user_metadata')
      .insert({
        id: user.id,
        role: invitation.role,
        full_name: userData.full_name,
        company: userData.company
      })

    if (metadataError) {
      console.error('Error creating user metadata:', metadataError)
      throw new Error('Failed to create user profile')
    }

    // Mark invitation as accepted
    await supabase
      .from('user_invitations')
      .update({ 
        status: 'accepted',
        accepted_at: new Date().toISOString()
      })
      .eq('id', invitation.id)
  },

  // Get all invitations (admin only) - uses backend API
  async getAllInvitations(): Promise<UserInvitation[]> {
    const { userService } = await import('../services/apiService')
    try {
      const data = await userService.getInvitations()
      return data || []
    } catch (error) {
      console.error('Error fetching invitations:', error)
      return []
    }
  },

  // Delete invitation - uses backend API
  async deleteInvitation(invitationId: string) {
    const { userService } = await import('../services/apiService')
    return await userService.deleteInvitation(invitationId)
  },

  // Update user role (admin only)
  async updateUserRole(userId: string, role: 'admin' | 'user') {
    return await supabase
      .from('user_metadata')
      .update({ role })
      .eq('id', userId)
  },

  // Delete user (admin only)
  async deleteUser(userId: string) {
    // This will cascade delete all user's projects and related data
    return await supabase.auth.admin.deleteUser(userId)
  }
}

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
          type: 'area' | 'volume' | 'linear' | 'count' | 'auto-count'
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
          type: 'area' | 'volume' | 'linear' | 'count' | 'auto-count'
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
