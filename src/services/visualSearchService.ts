/**
 * Visual Search Service - Client Side
 * 
 * Handles visual search operations from the frontend
 */

import type { VisualSearchMatch, VisualSearchResult } from '../types';

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

export interface VisualSearchOptions {
  confidenceThreshold: number;
  maxMatches: number;
  searchRadius: number;
  scaleTolerance: number;
}

export class VisualSearchService {
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
    options?: Partial<VisualSearchOptions>
  ): Promise<VisualSearchResult> {
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
   * Complete visual search workflow
   */
  async completeSearch(
    conditionId: string,
    pdfFileId: string,
    pageNumber: number,
    selectionBox: { x: number; y: number; width: number; height: number },
    projectId: string,
    sheetId: string,
    options?: Partial<VisualSearchOptions>
  ): Promise<{ result: VisualSearchResult; measurementsCreated: number }> {
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
        options
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Visual search workflow failed');
    }

    const result = await response.json();
    return {
      result: result.result,
      measurementsCreated: result.measurementsCreated
    };
  }

  /**
   * Get visual search results for a condition
   */
  async getResults(conditionId: string): Promise<{ measurements: any[]; count: number }> {
    const response = await fetch(`${API_BASE_URL}/visual-search/results/${conditionId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get visual search results');
    }

    return await response.json();
  }
}

export const visualSearchService = new VisualSearchService();
