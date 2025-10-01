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
  private defaultModel: string = 'gpt-oss:120b-cloud'; // Default to cloud model from your screenshot

  constructor() {
    // Use our backend API instead of direct Ollama calls
    this.baseUrl = 'http://localhost:4000/api/ollama';
  }

  // Get list of available models (both local and cloud)
  async getModels(): Promise<OllamaModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }
      const data = await response.json();
      return data.models || [];
    } catch (error) {
      console.error('Error fetching Ollama models:', error);
      throw new Error('Failed to connect to Ollama. Make sure Ollama is running locally.');
    }
  }

  // Check if Ollama is running and accessible
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      const data = await response.json();
      return data.available === true;
    } catch (error) {
      console.warn('Ollama not available:', error);
      return false;
    }
  }

  // Send a chat message to Ollama
  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...request,
          stream: false // For now, we'll use non-streaming
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error sending chat to Ollama:', error);
      throw error;
    }
  }

  // Send a streaming chat message to Ollama
  async *chatStream(request: OllamaChatRequest): AsyncGenerator<OllamaStreamResponse, void, unknown> {
    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...request,
          stream: true
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

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              try {
                const data = JSON.parse(line);
                yield data;
              } catch (parseError) {
                console.warn('Failed to parse Ollama response line:', line);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      console.error('Error in streaming chat:', error);
      throw error;
    }
  }

  // Generate embeddings for text (useful for document similarity)
  async generateEmbedding(model: string, prompt: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  }

  // Pull a model (download it locally)
  async pullModel(modelName: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: modelName,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to pull model: ${response.statusText}`);
      }

      await response.json();
    } catch (error) {
      console.error('Error pulling model:', error);
      throw error;
    }
  }

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
