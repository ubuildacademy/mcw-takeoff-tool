import type { 
  AIIdentifiedPage, 
  AITakeoffResult 
} from '../types';
import { supabase } from '../lib/supabase';

interface PlaywrightAutomationResult {
  success: boolean;
  measurementsPlaced: number;
  errors: string[];
}

interface AutomatedTakeoffResult {
  success: boolean;
  aiAnalysis: {
    conditionsFound: number;
    measurementsFound: number;
    hasCalibration: boolean;
  };
  databaseOperations: {
    conditionsCreated: number;
    measurementsCreated: number;
    conditionIds: string[];
  };
  automation: {
    executed: boolean;
    success: boolean;
    measurementsPlaced: number;
    errors: string[];
  };
  message: string;
}

interface BatchAutomatedTakeoffResult {
  success: boolean;
  summary: {
    totalPages: number;
    processedPages: number;
    totalConditionsCreated: number;
    totalMeasurementsPlaced: number;
    totalErrors: number;
  };
  results: Array<{
    pageNumber: number;
    documentId: string;
    conditionsCreated: number;
    measurementsPlaced: number;
    automationSuccess: boolean;
    error?: string;
  }>;
  aggregation?: any;
  errors: string[];
  message: string;
}

interface AutomationCapabilities {
  playwright: boolean;
  qwenVision: boolean;
  chatAI: boolean;
  fullAutomation: boolean;
}

export const playwrightTakeoffService = {
  /**
   * Execute automated takeoff for a single page
   */
  async executeAutomatedTakeoff(
    documentId: string,
    pageNumber: number,
    scope: string,
    projectId: string,
    pageType?: string,
    executeAutomation: boolean = true
  ): Promise<AutomatedTakeoffResult> {
    try {
      console.log('🚀 Frontend: Starting automated takeoff request:', {
        documentId,
        pageNumber,
        scope,
        projectId,
        pageType,
        executeAutomation
      });

      // Get authentication token from Supabase session
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      const response = await fetch('/api/playwright-takeoff/execute-automated-takeoff', {
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
          pageType,
          executeAutomation
        }),
      });

      console.log('📡 Frontend: Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ Frontend: API error:', errorData);
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Frontend: Automated takeoff result:', data);
      return data;
    } catch (error) {
      console.error('❌ Frontend: Error executing automated takeoff:', error);
      throw new Error(`Failed to execute automated takeoff: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Execute batch automated takeoff for multiple pages
   */
  async executeBatchAutomatedTakeoff(
    pages: Array<{
      documentId: string;
      pageNumber: number;
      pageType?: string;
    }>,
    scope: string,
    projectId: string,
    executeAutomation: boolean = true,
    aggregateResults: boolean = true
  ): Promise<BatchAutomatedTakeoffResult> {
    try {
      console.log('🚀 Frontend: Starting batch automated takeoff request:', {
        pagesCount: pages.length,
        scope,
        projectId,
        executeAutomation,
        aggregateResults
      });

      // Get authentication token from Supabase session
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      const response = await fetch('/api/playwright-takeoff/execute-batch-automated-takeoff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
        body: JSON.stringify({
          pages,
          scope,
          projectId,
          executeAutomation,
          aggregateResults
        }),
      });

      console.log('📡 Frontend: Batch response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ Frontend: Batch API error:', errorData);
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Frontend: Batch automated takeoff result:', data);
      return data;
    } catch (error) {
      console.error('❌ Frontend: Error executing batch automated takeoff:', error);
      throw new Error(`Failed to execute batch automated takeoff: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Check automation capabilities and status
   */
  async checkAutomationStatus(): Promise<{
    success: boolean;
    capabilities: AutomationCapabilities;
    message: string;
  }> {
    try {
      // Get authentication token from Supabase session
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      const response = await fetch('/api/playwright-takeoff/automation-status', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Frontend: Automation status:', data);
      return data;
    } catch (error) {
      console.error('❌ Frontend: Error checking automation status:', error);
      throw new Error(`Failed to check automation status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  },

  /**
   * Execute full automated takeoff workflow
   * This combines AI analysis with Playwright automation
   */
  async executeFullAutomatedTakeoff(
    scope: string,
    documentIds: string[],
    projectId: string,
    selectedPages: any[] = [],
    executeAutomation: boolean = true
  ): Promise<{
    success: boolean;
    summary: {
      totalPages: number;
      totalConditionsCreated: number;
      totalMeasurementsPlaced: number;
      totalErrors: number;
    };
    message: string;
    details: any[];
  }> {
    try {
      console.log('🚀 Frontend: Starting full automated takeoff workflow');

      // Get authentication token from Supabase session
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;

      const response = await fetch('/api/playwright-takeoff/execute-full-automated-takeoff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
        body: JSON.stringify({
          scope,
          documentIds,
          projectId,
          selectedPages,
          enableAutomation: executeAutomation
        }),
      });

      console.log('📡 Frontend: Full automation response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ Frontend: Full automation API error:', errorData);
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Frontend: Full automation result:', data);
      return data;

    } catch (error) {
      console.error('❌ Frontend: Error in full automated takeoff:', error);
      throw new Error(`Failed to execute full automated takeoff: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
};