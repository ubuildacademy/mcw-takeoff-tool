import type { 
  AIIdentifiedPage, 
  AITakeoffResult, 
  AITakeoffProgress,
  TakeoffCondition 
} from '../types';
import { supabase } from '../lib/supabase';

export const aiTakeoffService = {
  /**
   * Check if AI takeoff services are available
   */
  async checkStatus(): Promise<{ qwenVision: boolean; chatAI: boolean }> {
    try {
      const response = await fetch('/api/ai-takeoff/status', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.services || { qwenVision: false, chatAI: false };
    } catch (error) {
      console.error('Error checking AI takeoff status:', error);
      return { qwenVision: false, chatAI: false };
    }
  },

  /**
   * Identify relevant pages using chat AI
   */
  async identifyPages(
    scope: string, 
    documentIds: string[], 
    projectId: string
  ): Promise<AIIdentifiedPage[]> {
    try {
      // Get authentication token from Supabase session
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      const response = await fetch('/api/ai-takeoff/identify-pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
        body: JSON.stringify({
          scope,
          documentIds,
          projectId
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.identifiedPages || [];
    } catch (error) {
      console.error('Error identifying pages:', error);
      throw new Error(`Failed to identify pages: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Process a single page with Qwen3-VL
   */
  async processPage(
    documentId: string, 
    pageNumber: number, 
    scope: string, 
    projectId: string,
    pageType?: string
  ): Promise<AITakeoffResult> {
    try {
      console.log('🚀 Frontend: Sending process page request:', {
        documentId,
        pageNumber,
        scope,
        projectId,
        pageType
      });

      // Get authentication token from Supabase session
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      const response = await fetch('/api/ai-takeoff/process-page', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
        body: JSON.stringify({
          documentId,
          pageNumber,
          scope,
          projectId,
          pageType
        }),
      });

      console.log('📡 Frontend: Response status:', response.status);
      console.log('📡 Frontend: Response ok:', response.ok);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ Frontend: API error:', errorData);
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Frontend: API response data:', data);
      return data.result;
    } catch (error) {
      console.error('❌ Frontend: Error processing page:', error);
      throw new Error(`Failed to process page: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Process multiple pages in batch and optionally aggregate results
   */
  async processBatch(
    pages: Array<{
      documentId: string;
      pageNumber: number;
      pageType?: string;
    }>,
    scope: string,
    projectId: string,
    aggregateResults: boolean = true
  ): Promise<{
    results: AITakeoffResult[];
    totalPages: number;
    processedPages: number;
    aggregated: boolean;
    message: string;
  }> {
    try {
      const response = await fetch('/api/ai-takeoff/process-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pages,
          scope,
          projectId,
          aggregateResults
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error processing batch:', error);
      throw new Error(`Failed to process batch: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Create AI-generated conditions and measurements
   */
  async createAIConditions(
    conditions: any[], 
    measurements: any[], 
    projectId: string, 
    documentId: string, 
    pageNumber: number
  ): Promise<TakeoffCondition[]> {
    try {
      const response = await fetch('/api/ai-takeoff/create-conditions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conditions,
          measurements,
          projectId,
          documentId,
          pageNumber
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.conditions || [];
    } catch (error) {
      console.error('Error creating AI conditions:', error);
      throw new Error(`Failed to create conditions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Get AI-generated conditions for a project
   */
  async getAIConditions(projectId: string): Promise<TakeoffCondition[]> {
    try {
      const response = await fetch(`/api/ai-takeoff/conditions/${projectId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.conditions || [];
    } catch (error) {
      console.error('Error fetching AI conditions:', error);
      throw new Error(`Failed to fetch AI conditions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Delete AI-generated conditions and their measurements
   */
  async deleteAIConditions(projectId: string, conditionIds: string[]): Promise<void> {
    try {
      const response = await fetch(`/api/ai-takeoff/conditions/${projectId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conditionIds
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      console.error('Error deleting AI conditions:', error);
      throw new Error(`Failed to delete AI conditions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Validate scope input
   */
  validateScope(scope: string): { valid: boolean; error?: string } {
    if (!scope || scope.trim().length === 0) {
      return { valid: false, error: 'Scope cannot be empty' };
    }

    if (scope.trim().length < 5) {
      return { valid: false, error: 'Scope must be at least 5 characters long' };
    }

    if (scope.trim().length > 500) {
      return { valid: false, error: 'Scope must be less than 500 characters' };
    }

    return { valid: true };
  },

  /**
   * Get example scopes for user guidance
   */
  getExampleScopes(): string[] {
    return [
      'King-A Units - count all occurrences',
      'Exterior door and window sealant - linear feet',
      'LVT flooring - square footage',
      'Roof fascia - linear feet',
      'Concrete footings - cubic yards',
      'Electrical outlets - count each',
      'HVAC ductwork - linear feet',
      'Insulation - square footage',
      'Paint - square footage of walls',
      'Tile work - square footage'
    ];
  }
};
