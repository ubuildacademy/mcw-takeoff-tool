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
  private baseUrl: string;
  private apiKey: string;
  private defaultModel: string = 'gpt-oss:120b'; // Default to largest GPT-OSS model available
  private isConnected: boolean = false;
  private connectionRetries: number = 0;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second

  constructor() {
    // Use consistent API base URL logic - backend proxy avoids CORS issues
    // Initialize baseUrl lazily to avoid require() issues in browser
    this.baseUrl = '/api/ollama'; // Default, will be updated by _initializeBaseUrl()
    this._initializeBaseUrl();
    
    // Note: API key is handled by backend, this is just for reference
    this.apiKey = import.meta.env.VITE_OLLAMA_API_KEY || '';
    
    // Debug logging - will log after baseUrl is initialized
    this._initializeBaseUrl().then(() => {
      console.log('OllamaService initialized with:', {
        baseUrl: this.baseUrl,
        hasApiKey: !!this.apiKey,
        apiKeyLength: this.apiKey.length,
        note: 'API key is handled by backend'
      });
    });
  }

  private async _initializeBaseUrl() {
    try {
      const { getApiBaseUrl } = await import('../lib/apiConfig');
      const API_BASE_URL = getApiBaseUrl();
      this.baseUrl = `${API_BASE_URL}/ollama`;
    } catch {
      // Fallback to default
      this.baseUrl = '/api/ollama';
    }
  }

  private async getBaseUrl(): Promise<string> {
    if (this.baseUrl === '/api/ollama') {
      await this._initializeBaseUrl();
    }
    return this.baseUrl;
  }

  // Get list of available models (cloud models)
  async getModels(): Promise<OllamaModel[]> {
    try {
      const response = await this.makeRequest('/models', {
        method: 'GET'
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Update connection status on successful response
      this.isConnected = true;
      this.connectionRetries = 0;
      
      return data.models || [];
    } catch (error) {
      console.error('Error fetching Ollama models:', error);
      this.isConnected = false;
      this.connectionRetries++;
      throw new Error('Failed to connect to Ollama cloud API. Check your API key.');
    }
  }

  // Check if Ollama cloud API is accessible with retry logic
  async isAvailable(): Promise<boolean> {
    try {
      // Note: API key is handled by the backend, so we don't need to check it here
      const response = await this.makeRequest('/models', {
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      
      this.isConnected = response.ok;
      this.connectionRetries = 0; // Reset retry counter on success
      return response.ok;
    } catch (error) {
      console.warn('Ollama cloud API not available:', error);
      this.isConnected = false;
      return false;
    }
  }

  // Robust request method with retry logic
  private async makeRequest(endpoint: string, options: RequestInit = {}, retryCount: number = 0): Promise<Response> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok && retryCount < this.maxRetries) {
        console.warn(`Request failed (${response.status}), retrying... (${retryCount + 1}/${this.maxRetries})`);
        await this.delay(this.retryDelay * (retryCount + 1)); // Exponential backoff
        return this.makeRequest(endpoint, options, retryCount + 1);
      }

      return response;
    } catch (error) {
      if (retryCount < this.maxRetries) {
        console.warn(`Network error, retrying... (${retryCount + 1}/${this.maxRetries}):`, error);
        await this.delay(this.retryDelay * (retryCount + 1));
        return this.makeRequest(endpoint, options, retryCount + 1);
      }
      throw error;
    }
  }

  // Utility method for delays
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
    try {
      const response = await this.makeRequest('/chat', {
        method: 'POST',
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: false,
          options: {
            temperature: request.options?.temperature || 0.7,
            top_p: request.options?.top_p || 0.9,
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Update connection status on successful response
      this.isConnected = true;
      this.connectionRetries = 0;
      
      // Ollama API response format
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
  async *chatStream(request: OllamaChatRequest): AsyncGenerator<OllamaStreamResponse, void, unknown> {
    let retryCount = 0;
    const maxStreamRetries = 2;

    while (retryCount <= maxStreamRetries) {
      try {
        const response = await this.makeRequest('/chat', {
          method: 'POST',
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
                } catch (parseError) {
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
  async generateEmbedding(model: string, prompt: string): Promise<number[]> {
    try {
      const response = await this.makeRequest('/embeddings', {
        method: 'POST',
        body: JSON.stringify({
          model,
          prompt
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Update connection status on successful response
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
  buildProjectContext(projectData: any, documents: any[], measurements: any[]): string {
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
  buildDocumentContext(documentId: string, ocrData: any): string {
    if (!ocrData || !ocrData.pages) {
      return `Document ${documentId}: No OCR data available`;
    }

    let context = `Document: ${documentId}\n`;
    context += `Total Pages: ${ocrData.totalPages}\n`;
    context += `Processed Pages: ${ocrData.pages.length}\n\n`;

    // Include text from all pages
    ocrData.pages.forEach((page: any, index: number) => {
      if (page.text && page.text.trim().length > 0) {
        context += `Page ${page.pageNumber}:\n${page.text}\n\n`;
      }
    });

    return context;
  }
}

// Export singleton instance
export const ollamaService = new OllamaService();
