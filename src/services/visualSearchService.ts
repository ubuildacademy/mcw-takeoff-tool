/**
 * Auto-Count Service - Client Side
 * 
 * Handles auto-count operations from the frontend
 */

import type { AutoCountMatch, AutoCountResult, TakeoffMeasurement } from '../types';

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
   * Complete auto-count workflow with Server-Sent Events for real-time progress
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
    return new Promise((resolve, reject) => {
      // First, send the request using fetch with POST
      // We'll use a workaround: send POST data via query params and body, then switch to SSE
      const requestBody = {
        conditionId,
        pdfFileId,
        pageNumber,
        selectionBox,
        projectId,
        sheetId,
        options,
        searchScope: searchScope || 'current-page'
      };

      // Create a unique job ID for this search
      const jobId = `autocount_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Use fetch with POST to initiate the search, but request SSE response
      fetch(`${API_BASE_URL}/visual-search/complete-search?sse=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(requestBody),
        signal: abortSignal
      }).then(async (response) => {
        if (!response.ok) {
          // If not SSE, try to parse as JSON error
          try {
            const error = await response.json();
            const errorMessage = error.details 
              ? `${error.error || 'Auto-count workflow failed'}: ${error.details}`
              : error.error || 'Auto-count workflow failed';
            reject(new Error(errorMessage));
          } catch {
            reject(new Error(`Auto-count failed with status ${response.status}`));
          }
          return;
        }

        // Check if response is SSE
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('text/event-stream')) {
          // Handle SSE stream
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          
          if (!reader) {
            reject(new Error('Failed to get response stream'));
            return;
          }

          let buffer = '';
          let finalResult: { result: AutoCountResult; measurementsCreated: number } | null = null;

          const processChunk = async () => {
            try {
              while (true) {
                if (abortSignal?.aborted) {
                  reader.cancel();
                  reject(new Error('Search cancelled'));
                  return;
                }

                const { done, value } = await reader.read();
                
                if (done) {
                  // Process any remaining buffer before resolving/rejecting
                  if (buffer.trim()) {
                    const lines = buffer.split('\n');
                    for (const line of lines) {
                      if (line.startsWith('data: ')) {
                        try {
                          const data = JSON.parse(line.slice(6));
                          if (data.type === 'complete') {
                            finalResult = {
                              result: data.result,
                              measurementsCreated: data.measurementsCreated
                            };
                          } else if (data.type === 'error') {
                            reject(new Error(data.error || 'Auto-count failed'));
                            return;
                          }
                        } catch (parseError) {
                          console.warn('Failed to parse final SSE data:', line, parseError);
                        }
                      }
                    }
                  }
                  
                  if (finalResult) {
                    resolve(finalResult);
                  } else {
                    console.error('SSE stream ended without complete message. Buffer:', buffer);
                    reject(new Error('Search completed but no result received. The server may have closed the connection prematurely.'));
                  }
                  return;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer

                for (const line of lines) {
                  if (line.trim() && line.startsWith('data: ')) {
                    try {
                      const data = JSON.parse(line.slice(6));
                      console.log('[AutoCount SSE] Received:', data.type, data);
                      
                      if (data.type === 'connected') {
                        // Connection established
                        continue;
                      } else if (data.type === 'progress') {
                        // Update progress
                        if (onProgress) {
                          onProgress({
                            current: data.current,
                            total: data.total,
                            currentPage: data.currentPage,
                            currentDocument: data.currentDocument
                          });
                        }
                      } else if (data.type === 'complete') {
                        // Search complete
                        console.log('[AutoCount SSE] Complete message received:', data);
                        finalResult = {
                          result: data.result,
                          measurementsCreated: data.measurementsCreated
                        };
                        // Don't break here - let the stream finish naturally
                      } else if (data.type === 'error') {
                        console.error('[AutoCount SSE] Error received:', data.error);
                        reject(new Error(data.error || 'Auto-count failed'));
                        return;
                      }
                    } catch (parseError) {
                      console.warn('Failed to parse SSE data:', line, parseError);
                    }
                  }
                }
              }
            } catch (error) {
              if (error instanceof Error && error.message !== 'Search cancelled') {
                reject(error);
              }
            }
          };

          processChunk();
        } else {
          // Fallback to regular JSON response (for backwards compatibility)
          const result = await response.json();
          resolve({
            result: result.result,
            measurementsCreated: result.measurementsCreated
          });
        }
      }).catch((error) => {
        if (error.name === 'AbortError') {
          reject(new Error('Search cancelled'));
        } else {
          reject(error);
        }
      });
    });
  }

  /**
   * Get auto-count results for a condition
   */
  async getResults(conditionId: string): Promise<{ measurements: TakeoffMeasurement[]; count: number }> {
    const response = await fetch(`${API_BASE_URL}/visual-search/results/${conditionId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get auto-count results');
    }

    return await response.json();
  }

  /**
   * Get match thumbnails for a visual search condition
   */
  async getMatchThumbnails(
    conditionId: string,
    projectId: string,
    maxThumbnails: number = 6
  ): Promise<Array<{ measurementId: string; thumbnail: string }>> {
    const response = await fetch(
      `${API_BASE_URL}/visual-search/thumbnails/${conditionId}?projectId=${projectId}&maxThumbnails=${maxThumbnails}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get match thumbnails');
    }

    const result = await response.json();
    return result.thumbnails || [];
  }
}

export const autoCountService = new AutoCountService();
// Legacy export for backward compatibility during migration
export const visualSearchService = autoCountService;
