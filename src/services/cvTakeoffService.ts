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
        let errorData: any = {};
        try {
          errorData = await response.json();
        } catch {
          // If JSON parsing fails, create a basic error object
          errorData = { error: `HTTP error! status: ${response.status}` };
        }
        
        const errorMessage = errorData.error || `HTTP error! status: ${response.status}`;
        // Ensure error message is a string, not an object
        const errorMessageStr = typeof errorMessage === 'string' 
          ? errorMessage 
          : JSON.stringify(errorMessage);
        
        const errorWithDetails = errorData.details 
          ? `${errorMessageStr}. Details: ${JSON.stringify(errorData.details, null, 2)}`
          : errorMessageStr;
        throw new Error(errorWithDetails);
      }

      const data = await response.json();
      return data.result;
    } catch (error) {
      console.error('Error processing page:', error);
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message || String(error);
        // If message is "[object Object]", try to extract more details
        if (errorMessage === '[object Object]' || errorMessage.includes('[object Object]')) {
          try {
            const errorObj = error as any;
            errorMessage = errorObj.message || errorObj.error || JSON.stringify(errorObj) || 'Unknown error';
          } catch {
            errorMessage = 'Failed to process page - unknown error';
          }
        }
      } else if (error && typeof error === 'object') {
        try {
          errorMessage = (error as any).message || (error as any).error || JSON.stringify(error) || 'Unknown error';
        } catch {
          errorMessage = 'Failed to process page - unknown error';
        }
      } else {
        errorMessage = String(error);
      }
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

