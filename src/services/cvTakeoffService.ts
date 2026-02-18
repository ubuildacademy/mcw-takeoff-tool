/**
 * CV Takeoff Service (Frontend)
 *
 * Client-side service for computer vision-based takeoff detection.
 * Uses apiClient for consistent auth handling, 401 retry, and timeout.
 */

import { apiClient } from './apiService';
import { extractErrorMessage } from '../utils/commonUtils';

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
  rooms: unknown[];
  walls: unknown[];
  doors: unknown[];
  windows: unknown[];
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
    details?: Record<string, unknown>;
    diagnostics?: unknown;
  }> {
    try {
      const { data } = await apiClient.get('/cv-takeoff/status');
      return {
        available: data.available || false,
        message: data.message || 'CV takeoff service status unknown',
        details: data.details,
        diagnostics: data.details?.diagnostics
      };
    } catch (error) {
      console.error('Error checking CV takeoff status:', error);
      const msg = extractErrorMessage(error);
      return {
        available: false,
        message: `Failed to check CV takeoff service status: ${msg}`,
        details: { error: msg }
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
      const { data } = await apiClient.get(`/cv-takeoff/job/${jobId}`);
      return data;
    } catch (error) {
      console.error('Error getting job status:', error);
      throw new Error(`Failed to get job status: ${extractErrorMessage(error)}`);
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
      const { data: startData } = await apiClient.post('/cv-takeoff/process-page', {
        documentId,
        pageNumber,
        projectId,
        scaleFactor,
        options
      });

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
      throw new Error(`Failed to process page: ${extractErrorMessage(error, 'unknown error')}`);
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
      const { data } = await apiClient.post('/cv-takeoff/process-pages', {
        documentId,
        pageNumbers,
        projectId,
        scaleFactor,
        options
      });
      return data.result;
    } catch (error) {
      console.error('Error processing pages:', error);
      throw new Error(`Failed to process pages: ${extractErrorMessage(error)}`);
    }
  }
};

