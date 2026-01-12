/**
 * Auto-Count Service - Client Side
 * 
 * Handles auto-count operations from the frontend
 */

import type { AutoCountMatch, AutoCountResult } from '../types';

import { getApiBaseUrl } from '../lib/apiConfig';

// Use consistent API base URL logic across all services
const API_BASE_URL = getApiBaseUrl();

export interface SymbolTemplate {
  id: string;
  imageData: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  features?: number[];
  description?: string;
}

export interface AutoCountOptions {
  confidenceThreshold: number;
  maxMatches: number;
  searchRadius: number;
  scaleTolerance: number;
}

export class AutoCountService {
  /**
   * Extract symbol template from selection box
   */
  async extractTemplate(
    pdfFileId: string,
    pageNumber: number,
    selectionBox: { x: number; y: number; width: number; height: number }
  ): Promise<SymbolTemplate> {
    const response = await fetch(`${API_BASE_URL}/visual-search/extract-template`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pdfFileId,
        pageNumber,
        selectionBox
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to extract template');
    }

    const result = await response.json();
    return result.template;
  }

  /**
   * Search for symbols matching a template
   */
  async searchSymbols(
    conditionId: string,
    pdfFileId: string,
    template: SymbolTemplate,
    options?: Partial<AutoCountOptions>
  ): Promise<AutoCountResult> {
    const response = await fetch(`${API_BASE_URL}/visual-search/search-symbols`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conditionId,
        pdfFileId,
        template,
        options
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to search for symbols');
    }

    const result = await response.json();
    return result.result;
  }

  /**
   * Complete auto-count workflow
   */
  async completeSearch(
    conditionId: string,
    pdfFileId: string,
    pageNumber: number,
    selectionBox: { x: number; y: number; width: number; height: number },
    projectId: string,
    sheetId: string,
    options?: Partial<AutoCountOptions>,
    searchScope?: 'current-page' | 'entire-document' | 'entire-project',
    onProgress?: (progress: { current: number; total: number; currentPage?: number; currentDocument?: string }) => void,
    abortSignal?: AbortSignal
  ): Promise<{ result: AutoCountResult; measurementsCreated: number }> {
    const response = await fetch(`${API_BASE_URL}/visual-search/complete-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conditionId,
        pdfFileId,
        pageNumber,
        selectionBox,
        projectId,
        sheetId,
        options,
        searchScope: searchScope || 'current-page'
      }),
      signal: abortSignal
    });

    if (!response.ok) {
      const error = await response.json();
      const errorMessage = error.details 
        ? `${error.error || 'Auto-count workflow failed'}: ${error.details}`
        : error.error || 'Auto-count workflow failed';
      throw new Error(errorMessage);
    }

    const result = await response.json();
    return {
      result: result.result,
      measurementsCreated: result.measurementsCreated
    };
  }

  /**
   * Get auto-count results for a condition
   */
  async getResults(conditionId: string): Promise<{ measurements: any[]; count: number }> {
    const response = await fetch(`${API_BASE_URL}/visual-search/results/${conditionId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get auto-count results');
    }

    return await response.json();
  }
}

export const autoCountService = new AutoCountService();
// Legacy export for backward compatibility during migration
export const visualSearchService = autoCountService;
