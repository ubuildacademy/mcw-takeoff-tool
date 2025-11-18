/**
 * CV Takeoff Service (Frontend)
 * 
 * Client-side service for computer vision-based takeoff detection
 */

import { supabase } from '../lib/supabase';

export interface CVTakeoffOptions {
  detectRooms?: boolean;
  detectWalls?: boolean;
  detectDoors?: boolean;
  detectWindows?: boolean;
  minRoomArea?: number;
  minWallLength?: number;
  roomConditionName?: string;
  wallConditionName?: string;
  doorConditionName?: string;
  windowConditionName?: string;
}

export interface CVTakeoffResult {
  success: boolean;
  conditionsCreated: number;
  measurementsCreated: number;
  roomsDetected: number;
  wallsDetected: number;
  doorsDetected: number;
  windowsDetected: number;
  errors: string[];
  processingTime: number;
}

export interface PageDetectionResult {
  pageNumber: number;
  rooms: any[];
  walls: any[];
  doors: any[];
  windows: any[];
  conditionsCreated: number;
  measurementsCreated: number;
}

export const cvTakeoffService = {
  /**
   * Check if CV takeoff service is available
   */
  async checkStatus(): Promise<{ 
    available: boolean; 
    message: string;
    details?: any;
    diagnostics?: any;
  }> {
    try {
      const response = await fetch('/api/cv-takeoff/status', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`HTTP error! status: ${response.status}. ${errorData.error || ''}`);
      }

      const data = await response.json();
      return {
        available: data.available || false,
        message: data.message || 'CV takeoff service status unknown',
        details: data.details,
        diagnostics: data.details?.diagnostics
      };
    } catch (error) {
      console.error('Error checking CV takeoff status:', error);
      return {
        available: false,
        message: `Failed to check CV takeoff service status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      };
    }
  },

  /**
   * Process a single page
   */
  async processPage(
    documentId: string,
    pageNumber: number,
    projectId: string,
    scaleFactor: number,
    options: CVTakeoffOptions = {}
  ): Promise<PageDetectionResult> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      const response = await fetch('/api/cv-takeoff/process-page', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
        body: JSON.stringify({
          documentId,
          pageNumber,
          projectId,
          scaleFactor,
          options
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || `HTTP error! status: ${response.status}`;
        const errorWithDetails = errorData.details 
          ? `${errorMessage}. Details: ${JSON.stringify(errorData.details, null, 2)}`
          : errorMessage;
        throw new Error(errorWithDetails);
      }

      const data = await response.json();
      return data.result;
    } catch (error) {
      console.error('Error processing page:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to process page: ${errorMessage}`);
    }
  },

  /**
   * Process multiple pages
   */
  async processPages(
    documentId: string,
    pageNumbers: number[],
    projectId: string,
    scaleFactor: number,
    options: CVTakeoffOptions = {}
  ): Promise<CVTakeoffResult> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      const response = await fetch('/api/cv-takeoff/process-pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
        body: JSON.stringify({
          documentId,
          pageNumbers,
          projectId,
          scaleFactor,
          options
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.result;
    } catch (error) {
      console.error('Error processing pages:', error);
      throw new Error(`Failed to process pages: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
};

