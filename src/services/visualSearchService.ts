/**
 * Auto-Count Service - Client Side
 * 
 * Handles auto-count operations from the frontend
 */

import type { AutoCountResult, TakeoffMeasurement } from '../types';

import { getApiBaseUrl } from '../lib/apiConfig';
import { getAuthHeaders } from '../lib/apiAuth';

const API_BASE_URL = getApiBaseUrl();

/** Parse error body from a failed response; avoids throwing when body is not JSON. */
async function parseErrorResponse(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (body?.details && body?.error) return `${body.error}: ${body.details}`;
    if (body?.error && typeof body.error === 'string') return body.error;
    return fallback;
  } catch {
    return response.status === 401
      ? 'Unauthorized – please sign in again.'
      : `${fallback} (${response.status})`;
  }
}

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
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        pdfFileId,
        pageNumber,
        selectionBox
      })
    });

    if (!response.ok) {
      throw new Error(await parseErrorResponse(response, 'Failed to extract template'));
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
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        conditionId,
        pdfFileId,
        template,
        options
      })
    });

    if (!response.ok) {
      throw new Error(await parseErrorResponse(response, 'Failed to search for symbols'));
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
    const headers = { ...(await getAuthHeaders()), Accept: 'text/event-stream' };

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

      // Use fetch with POST to initiate the search, but request SSE response
      fetch(`${API_BASE_URL}/visual-search/complete-search?sse=true`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: abortSignal
      }).then(async (response) => {
        if (!response.ok) {
          const msg = await parseErrorResponse(response, 'Auto-count workflow failed');
          reject(new Error(msg));
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
              // eslint-disable-next-line no-constant-condition -- stream read loop
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
                          if (import.meta.env.DEV) console.warn('Failed to parse final SSE data:', line, parseError);
                        }
                      }
                    }
                  }
                  
                  if (finalResult) {
                    resolve(finalResult);
                  } else {
                    if (import.meta.env.DEV) console.error('SSE stream ended without complete message. Buffer:', buffer);
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
                      if (import.meta.env.DEV) console.log('[AutoCount SSE] Received:', data.type, data);

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
                        if (import.meta.env.DEV) console.log('[AutoCount SSE] Complete message received:', data);
                        finalResult = {
                          result: data.result,
                          measurementsCreated: data.measurementsCreated
                        };
                        // Don't break here - let the stream finish naturally
                      } else if (data.type === 'error') {
                        if (import.meta.env.DEV) console.error('[AutoCount SSE] Error received:', data.error);
                        reject(new Error(data.error || 'Auto-count failed'));
                        return;
                      }
                    } catch (parseError) {
                      if (import.meta.env.DEV) console.warn('Failed to parse SSE data:', line, parseError);
                    }
                  }
                }
              }
            } catch (error) {
              if (error instanceof Error && (error.name === 'AbortError' || error.message === 'Search cancelled')) {
                reject(error.message === 'Search cancelled' ? error : new Error('Search cancelled'));
                return;
              }
              reject(error instanceof Error ? error : new Error(String(error ?? 'Stream read failed')));
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
    const response = await fetch(`${API_BASE_URL}/visual-search/results/${conditionId}`, {
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(await parseErrorResponse(response, 'Failed to get auto-count results'));
    }

    const result = await response.json();
    return { measurements: result.measurements ?? [], count: result.count ?? 0 };
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
      `${API_BASE_URL}/visual-search/thumbnails/${conditionId}?projectId=${projectId}&maxThumbnails=${maxThumbnails}`,
      { headers: await getAuthHeaders() }
    );

    if (!response.ok) {
      throw new Error(await parseErrorResponse(response, 'Failed to get match thumbnails'));
    }

    const result = await response.json();
    return result.thumbnails || [];
  }
}

export const autoCountService = new AutoCountService();
