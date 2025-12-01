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
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<{
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress: number;
    result?: PageDetectionResult;
    error?: string;
    startedAt?: Date;
    completedAt?: Date;
  }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      const response = await fetch(`/api/cv-takeoff/job/${jobId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting job status:', error);
      throw new Error(`Failed to get job status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Process a single page (async - returns job ID, then polls for results)
   */
  async processPage(
    documentId: string,
    pageNumber: number,
    projectId: string,
    scaleFactor: number,
    options: CVTakeoffOptions = {},
    onProgress?: (progress: number, status: string) => void
  ): Promise<PageDetectionResult> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      // Start the job
      const startResponse = await fetch('/api/cv-takeoff/process-page', {
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

      if (!startResponse.ok) {
        let errorData: any = {};
        try {
          errorData = await startResponse.json();
        } catch {
          errorData = { error: `HTTP error! status: ${startResponse.status}` };
        }
        
        const errorMessage = errorData.error || `HTTP error! status: ${startResponse.status}`;
        const errorMessageStr = typeof errorMessage === 'string' 
          ? errorMessage 
          : JSON.stringify(errorMessage);
        throw new Error(errorMessageStr);
      }

      const startData = await startResponse.json();
      const jobId = startData.jobId;

      if (!jobId) {
        throw new Error('No job ID returned from server');
      }

      // Poll for job completion
      const maxAttempts = 300; // 5 minutes max (1 second intervals)
      let attempts = 0;

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between polls

        const status = await this.getJobStatus(jobId);
        
        if (onProgress) {
          onProgress(status.progress, status.status);
        }

        if (status.status === 'completed') {
          if (!status.result) {
            throw new Error('Job completed but no result returned');
          }
          return status.result;
        }

        if (status.status === 'failed') {
          throw new Error(status.error || 'Job failed');
        }

        attempts++;
      }

      throw new Error('Job timeout - processing took too long');
    } catch (error) {
      console.error('Error processing page:', error);
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message || String(error);
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

