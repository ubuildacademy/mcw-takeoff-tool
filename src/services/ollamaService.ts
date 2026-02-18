export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    repeat_penalty?: number;
    seed?: number;
    stop?: string[];
  };
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaStreamResponse {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

class OllamaService {
  private apiKey: string;
  private defaultModel: string = 'gpt-oss:120b'; // Default to largest GPT-OSS model available
  private isConnected: boolean = false;
  private connectionRetries: number = 0;
  private retryDelay: number = 1000; // Used by chatStream retries
  /** Last error message from server (e.g. "Ollama API key not configured") for UI display */
  private lastErrorMessage: string | null = null;

  constructor() {
    this.apiKey = import.meta.env.VITE_OLLAMA_API_KEY || '';
    if (import.meta.env.DEV) {
      console.log('OllamaService initialized (uses apiClient for auth)');
    }
  }

  private setLastErrorFromAxios(error: { response?: { data?: { error?: string }; status?: number } }): void {
    if (error.response?.status != null && error.response.status >= 400 && error.response.status < 500) {
      const err = error.response.data;
      this.lastErrorMessage = err && typeof err === 'object' && typeof err.error === 'string'
        ? err.error
        : null;
    }
  }

  // Get list of available models (cloud models)
  async getModels(): Promise<OllamaModel[]> {
    const { apiClient } = await import('./apiService');
    try {
      const { data } = await apiClient.get('/ollama/models');
      this.isConnected = true;
      this.connectionRetries = 0;
      return data.models || [];
    } catch (error) {
      console.error('Error fetching Ollama models:', error);
      this.isConnected = false;
      this.connectionRetries++;
      this.setLastErrorFromAxios(error as Parameters<typeof this.setLastErrorFromAxios>[0]);
      throw new Error('Failed to connect to Ollama cloud API. Check your API key.');
    }
  }

  // Check if Ollama cloud API is accessible
  async isAvailable(): Promise<boolean> {
    this.lastErrorMessage = null;
    const { apiClient } = await import('./apiService');
    try {
      await apiClient.get('/ollama/models', { timeout: 15000 });
      this.isConnected = true;
      this.connectionRetries = 0;
      return true;
    } catch (error) {
      this.setLastErrorFromAxios(error as Parameters<typeof this.setLastErrorFromAxios>[0]);
      this.isConnected = false;
      return false;
    }
  }

  /** Server error message when unavailable (e.g. "Ollama API key not configured") for UI */
  getLastErrorMessage(): string | null {
    return this.lastErrorMessage;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get connection status
  getConnectionStatus(): { connected: boolean; retries: number } {
    return {
      connected: this.isConnected,
      retries: this.connectionRetries
    };
  }

  // Send a chat message to Ollama cloud with robust error handling
  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    const { apiClient } = await import('./apiService');
    try {
      const { data } = await apiClient.post('/ollama/chat', {
        model: request.model,
        messages: request.messages,
        stream: false,
        options: {
          temperature: request.options?.temperature || 0.7,
          top_p: request.options?.top_p || 0.9,
        }
      });
      this.isConnected = true;
      this.connectionRetries = 0;
      return {
        model: data.model,
        created_at: data.created_at,
        message: data.message,
        done: data.done,
        total_duration: data.total_duration,
        prompt_eval_count: data.prompt_eval_count,
        eval_count: data.eval_count,
      };
    } catch (error) {
      console.error('Error sending chat to Ollama:', error);
      this.isConnected = false;
      this.connectionRetries++;
      throw error;
    }
  }

  // Send a streaming chat message to Ollama cloud with robust error handling
  // Uses fetch for streaming (ReadableStream); apiClient does not support streaming responses
  async *chatStream(request: OllamaChatRequest): AsyncGenerator<OllamaStreamResponse, void, unknown> {
    let retryCount = 0;
    const maxStreamRetries = 2;
    const { getApiBaseUrl } = await import('../lib/apiConfig');
    const { authHelpers } = await import('../lib/supabase');

    while (retryCount <= maxStreamRetries) {
      try {
        const session = await authHelpers.getValidSession();
        const baseUrl = getApiBaseUrl();
        const url = `${baseUrl}/ollama/chat`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
          },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            stream: true,
            options: {
              temperature: request.options?.temperature || 0.7,
              top_p: request.options?.top_p || 0.9,
            }
          })
        });

        if (!response.ok) {
          throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body reader available');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let hasReceivedData = false;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            hasReceivedData = true;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const data = JSON.parse(line);
                  
                  // Ollama streaming response format
                  yield {
                    model: data.model,
                    created_at: data.created_at,
                    message: data.message,
                    done: data.done,
                  };
                  
                  if (data.done) {
                    // Update connection status on successful completion
                    this.isConnected = true;
                    this.connectionRetries = 0;
                    return;
                  }
                } catch {
                  console.warn('Failed to parse Ollama streaming response line:', line);
                  // Continue processing other lines instead of failing completely
                }
              }
            }
          }

          // If we get here without receiving data, it might be a connection issue
          if (!hasReceivedData && retryCount < maxStreamRetries) {
            console.warn('No data received from stream, retrying...');
            retryCount++;
            await this.delay(this.retryDelay * retryCount);
            continue;
          }

        } finally {
          reader.releaseLock();
        }

        // If we reach here, the stream completed successfully
        break;

      } catch (error) {
        console.error(`Error in streaming chat (attempt ${retryCount + 1}/${maxStreamRetries + 1}):`, error);
        this.isConnected = false;
        this.connectionRetries++;

        if (retryCount < maxStreamRetries) {
          console.warn('Retrying streaming chat...');
          retryCount++;
          await this.delay(this.retryDelay * retryCount);
          continue;
        } else {
          // Final attempt failed, throw the error
          throw new Error(`Streaming chat failed after ${maxStreamRetries + 1} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }
  }

  // Generate embeddings for text (useful for document similarity)
  // Note: Server may not have /embeddings route; will 404 if not implemented
  async generateEmbedding(model: string, prompt: string): Promise<number[]> {
    const { apiClient } = await import('./apiService');
    try {
      const { data } = await apiClient.post('/ollama/embeddings', { model, prompt });
      this.isConnected = true;
      this.connectionRetries = 0;
      return data.embedding || [];
    } catch (error) {
      console.error('Error generating embedding:', error);
      this.isConnected = false;
      this.connectionRetries++;
      throw error;
    }
  }

  // Note: pullModel is not needed for cloud models - they're available instantly

  // Set default model
  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  // Get default model
  getDefaultModel(): string {
    return this.defaultModel;
  }

  // Build context from project data for AI queries
  buildProjectContext(projectData: { name: string; client?: string; location?: string; projectType?: string; description?: string }, documents: Array<{ originalName?: string; filename?: string }>, measurements: Array<{ conditionName: string; calculatedValue: number; unit: string }>): string {
    let context = `Project: ${projectData.name}\n`;
    context += `Client: ${projectData.client || 'Not specified'}\n`;
    context += `Location: ${projectData.location || 'Not specified'}\n`;
    context += `Project Type: ${projectData.projectType || 'Not specified'}\n`;
    context += `Description: ${projectData.description || 'No description'}\n\n`;

    if (documents.length > 0) {
      context += `Documents (${documents.length}):\n`;
      documents.forEach((doc, index) => {
        context += `${index + 1}. ${doc.originalName || doc.filename}\n`;
      });
      context += '\n';
    }

    if (measurements.length > 0) {
      context += `Takeoff Measurements (${measurements.length}):\n`;
      measurements.forEach((measurement, index) => {
        context += `${index + 1}. ${measurement.conditionName}: ${measurement.calculatedValue} ${measurement.unit}\n`;
      });
      context += '\n';
    }

    return context;
  }

  // Build document context from OCR data
  buildDocumentContext(documentId: string, ocrData: { pages?: Array<{ pageNumber?: number; text?: string }>; totalPages?: number }): string {
    if (!ocrData || !ocrData.pages) {
      return `Document ${documentId}: No OCR data available`;
    }

    let context = `Document: ${documentId}\n`;
    context += `Total Pages: ${ocrData.totalPages ?? 0}\n`;
    context += `Processed Pages: ${ocrData.pages.length}\n\n`;

    ocrData.pages.forEach((page, _index: number) => {
      if (page.text && page.text.trim().length > 0) {
        context += `Page ${page.pageNumber}:\n${page.text}\n\n`;
      }
    });

    return context;
  }
}

// Export singleton instance
export const ollamaService = new OllamaService();
