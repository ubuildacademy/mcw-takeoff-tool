import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { 
  Send, 
  Bot, 
  User, 
  Settings, 
  Loader2,
  AlertCircle,
  CheckCircle,
  MessageSquare,
  Trash2,
  FileText,
  RefreshCw
} from 'lucide-react';
import { ollamaService, type OllamaMessage } from '../services/ollamaService';
import { serverOcrService } from '../services/serverOcrService';
import { useTakeoffStore } from '../store/useTakeoffStore';
import type { PDFDocument } from '../types';
// Removed complex export libraries - keeping it simple

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  error?: string;
}

interface ChatTabProps {
  projectId: string;
  documents: PDFDocument[];
  onPageSelect?: (documentId: string, pageNumber: number) => void;
  onOCRRequest?: (documentId: string) => void;
}

export function ChatTab({ 
  projectId, 
  documents,
  onPageSelect,
  onOCRRequest
}: ChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOllamaAvailable, setIsOllamaAvailable] = useState<boolean | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Function to strip markdown formatting from text
  const stripMarkdown = (text: string): string => {
    return text
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      // Remove bold and italic
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Remove headers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove links but keep the text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}$/gm, '')
      // Remove list markers
      .replace(/^[\s]*[-*+]\s+/gm, '• ')
      .replace(/^[\s]*\d+\.\s+/gm, '')
      // Clean up extra whitespace
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  };

  // Simple function to render message content as plain text
  const renderMessageContent = (message: ChatMessage) => {
    return (
      <div className="whitespace-pre-wrap">
        {stripMarkdown(message.content)}
      </div>
    );
  };

  // Store integration for full project data access
  const { 
    getCurrentProject, 
    getProjectTakeoffSummary, 
    getProjectTakeoffMeasurements,
    conditions,
    loadProjectConditions,
    loadProjectTakeoffMeasurements
  } = useTakeoffStore();

  // Scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Check Ollama availability on mount
  useEffect(() => {
    const initializeOllama = async () => {
      try {
        const available = await ollamaService.isAvailable();
        setIsOllamaAvailable(available);
      } catch (error) {
        console.error('Failed to initialize Ollama:', error);
        setIsOllamaAvailable(false);
      }
    };

    initializeOllama();
  }, []);

  // Load project data when projectId changes
  useEffect(() => {
    if (projectId) {
      loadProjectConditions(projectId);
      loadProjectTakeoffMeasurements(projectId);
    }
  }, [projectId, loadProjectConditions, loadProjectTakeoffMeasurements]);

  // Load chat history from localStorage for persistence
  useEffect(() => {
    const chatKey = `chat-${projectId}`;
    const savedMessages = localStorage.getItem(chatKey);
    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        setMessages(parsed.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        })));
      } catch (error) {
        console.error('Failed to load chat history:', error);
      }
    }
  }, [projectId]);

  // Save chat history to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      const chatKey = `chat-${projectId}`;
      localStorage.setItem(chatKey, JSON.stringify(messages));
    }
  }, [messages, projectId]);

  // Add initial system message
  useEffect(() => {
    if (messages.length === 0 && isOllamaAvailable) {
      const systemMessage: ChatMessage = {
        id: 'system-welcome',
        role: 'assistant',
        content: `Hello! I'm your AI assistant for this takeoff project. I can help you analyze documents, answer questions about the project, and assist with measurements.

What would you like to know about this project?`,
        timestamp: new Date()
      };
      setMessages([systemMessage]);
    }
  }, [isOllamaAvailable, messages.length]);

  // Handle sending a message
  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading || !isOllamaAvailable) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputMessage.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      // Build context from project data
      const projectContext = await buildProjectContext();
      
      // Create messages for Ollama
      const ollamaMessages: OllamaMessage[] = [
        {
          role: 'system',
          content: `You are an AI assistant specialized in construction takeoff and project analysis. You help users understand their construction documents, measurements, and project requirements.

${projectContext}

When answering questions:
- Be specific and reference actual data from the project when possible
- If you reference a document or page, mention the document name and page number
- Help users understand measurements, conditions, and project details
- If you don't have enough information, ask clarifying questions
- Be concise but thorough in your responses
- IMPORTANT: Respond in plain text only. Do not use any markdown formatting, code blocks, asterisks, or special formatting. Use simple text with line breaks for readability.`
        },
        ...messages.slice(-10).map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        })),
        {
          role: 'user',
          content: userMessage.content
        }
      ];

      // Create assistant message placeholder
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Send to Ollama with streaming
      let fullResponse = '';
      for await (const chunk of ollamaService.chatStream({
        model: ollamaService.getDefaultModel(),
        messages: ollamaMessages,
        stream: true,
        options: {
          temperature: 0.7,
          top_p: 0.9
        }
      })) {
        if (chunk.message?.content) {
          fullResponse += chunk.message.content;
          
          // Update the streaming message with markdown stripped
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessage.id 
              ? { ...msg, content: stripMarkdown(fullResponse) }
              : msg
          ));
        }

        if (chunk.done) {
          // Mark streaming as complete and ensure final content is markdown-free
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessage.id 
              ? { ...msg, isStreaming: false, content: stripMarkdown(fullResponse) }
              : msg
          ));
          break;
        }
      }

    } catch (error) {
      console.error('Error sending message to Ollama:', error);
      
      // Update the assistant message with error
      setMessages(prev => prev.map(msg => 
        msg.id === `assistant-${Date.now()}` 
          ? { 
              ...msg, 
              content: 'Sorry, I encountered an error while processing your request. Please try again.',
              isStreaming: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            }
          : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  // Build comprehensive project context for AI
  const buildProjectContext = async (): Promise<string> => {
    const project = getCurrentProject();
    const projectSummary = getProjectTakeoffSummary(projectId);
    const takeoffMeasurements = getProjectTakeoffMeasurements(projectId);
    
    let context = `=== PROJECT OVERVIEW ===\n`;
    
    // Project details
    if (project) {
      context += `Project: ${project.name}\n`;
      context += `Client: ${project.client || 'Not specified'}\n`;
      context += `Location: ${project.location || 'Not specified'}\n`;
      context += `Project Type: ${project.projectType || 'Not specified'}\n`;
      context += `Status: ${project.status || 'active'}\n`;
      context += `Description: ${project.description || 'No description'}\n`;
      if (project.contactPerson) context += `Contact: ${project.contactPerson} (${project.contactEmail || 'No email'})\n`;
      if (project.startDate) context += `Start Date: ${project.startDate}\n`;
    } else {
      context += `Project ID: ${projectId}\n`;
    }
    
    // Takeoff summary
    if (projectSummary) {
      context += `\n=== TAKEOFF SUMMARY ===\n`;
      context += `Total Measurements: ${projectSummary.totalMeasurements}\n`;
      context += `Total Value: ${projectSummary.totalValue}\n`;
      
      if (Object.keys(projectSummary.byCondition).length > 0) {
        context += `\nBy Condition:\n`;
        Object.entries(projectSummary.byCondition).forEach(([conditionId, data]) => {
          const condition = conditions.find(c => c.id === conditionId);
          const conditionName = condition?.name || `Condition ${conditionId}`;
          context += `- ${conditionName}: ${data.count} measurements, ${data.value} ${data.unit}\n`;
        });
      }
    }
    
    // Conditions
    if (conditions.length > 0) {
      context += `\n=== TAKEOFF CONDITIONS ===\n`;
      conditions.forEach(condition => {
        context += `- ${condition.name} (${condition.type}): ${condition.unit}`;
        if (condition.wasteFactor > 0) context += `, ${condition.wasteFactor}% waste`;
        if (condition.laborCost) context += `, $${condition.laborCost} labor cost`;
        if (condition.materialCost) context += `, $${condition.materialCost} material cost`;
        if (condition.description) context += ` - ${condition.description}`;
        context += `\n`;
      });
    }
    
    // Documents with OCR status
    if (documents.length > 0) {
      context += `\n=== DOCUMENTS ===\n`;
      let processedCount = 0;
      let unprocessedCount = 0;
      
      for (const doc of documents) {
        context += `- ${doc.originalName || doc.filename}`;
        if (doc.size) context += ` (${(doc.size / 1024 / 1024).toFixed(1)}MB)`;
        if (doc.uploadedAt) context += ` - Uploaded: ${new Date(doc.uploadedAt).toLocaleDateString()}`;
        context += `\n`;
        
        // Check OCR status
        if (doc.ocrEnabled || doc.pages?.some(page => page.ocrProcessed)) {
          context += `  ✓ OCR Processed (${doc.pages?.length || 1} pages)\n`;
          processedCount++;
          
          // Try to get OCR data from server
          try {
            const ocrData = await serverOcrService.getDocumentData(doc.id, projectId);
            // CRITICAL FIX: Ensure results is an array before accessing length
            if (ocrData && Array.isArray(ocrData.results) && ocrData.results.length > 0) {
              // Include full text content from all pages for comprehensive AI analysis
              // CRITICAL FIX: Filter out null/undefined results before accessing pageNumber
              const fullText = ocrData.results
                .filter((result: any) => result != null && result.pageNumber != null)
                .map((result: any) => `    Page ${result.pageNumber}:\n${result.text}`)
                .join('\n\n');
              if (fullText) {
                context += `  Full OCR content:\n${fullText}\n`;
              }
            }
          } catch (error) {
            context += `  ⚠ OCR data not accessible - AI analysis limited\n`;
          }
        } else {
          context += `  ⚠ OCR Not processed - AI cannot analyze content\n`;
          unprocessedCount++;
        }
      }
      
      context += `\nOCR Status: ${processedCount} processed, ${unprocessedCount} unprocessed\n`;
      
      if (unprocessedCount > 0) {
        context += `\n💡 SUGGESTION: Run OCR on unprocessed documents to enable AI analysis of their content.\n`;
      }
    } else {
      context += `\n=== DOCUMENTS ===\n`;
      context += `No documents uploaded to this project yet.\n`;
    }
    
    // Recent takeoff measurements
    if (takeoffMeasurements.length > 0) {
      context += `\n=== RECENT MEASUREMENTS ===\n`;
      const recentMeasurements = takeoffMeasurements
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);
      
      recentMeasurements.forEach(measurement => {
        const condition = conditions.find(c => c.id === measurement.conditionId);
        const conditionName = condition?.name || `Condition ${measurement.conditionId}`;
        context += `- ${conditionName}: ${measurement.calculatedValue} ${measurement.unit}`;
        if (measurement.description) context += ` (${measurement.description})`;
        context += `\n`;
      });
      
      if (takeoffMeasurements.length > 10) {
        context += `... and ${takeoffMeasurements.length - 10} more measurements\n`;
      }
    }
    
    return context;
  };

  // Handle key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };


  // Clear chat history
  const clearChat = () => {
    setMessages([]);
    const chatKey = `chat-${projectId}`;
    localStorage.removeItem(chatKey);
  };

  // Export chat as clean text file
  const exportChatAsDocx = async () => {
    try {
      // Create a well-formatted text document
      const chatContent = messages.map(msg => {
        const timestamp = msg.timestamp.toLocaleString();
        const role = msg.role === 'user' ? 'User' : 'AI Assistant';
        
        return `${role} - ${timestamp}\n${'='.repeat(50)}\n${stripMarkdown(msg.content)}\n\n`;
      }).join('');

      const fullContent = `AI CHAT EXPORT
${'='.repeat(50)}

Project ID: ${projectId}
Export Date: ${new Date().toLocaleString()}
Total Messages: ${messages.length}

${'='.repeat(50)}

${chatContent}

${'='.repeat(50)}
End of Chat Export
Generated by Meridian Takeoff`;

      // Create a blob with the formatted content
      const blob = new Blob([fullContent], { type: 'text/plain; charset=utf-8' });
      const url = URL.createObjectURL(blob);
      
      // Create download link
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-export-${projectId}-${new Date().toISOString().split('T')[0]}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('Failed to export chat:', error);
      alert('Failed to export chat. Please try again.');
    }
  };

  if (isOllamaAvailable === null) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-4" />
        <p className="text-gray-600">Checking Ollama connection...</p>
      </div>
    );
  }

  if (isOllamaAvailable === false) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-4">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Ollama Not Available</h3>
        <p className="text-gray-600 text-center mb-4">
          Unable to connect to Ollama cloud service. Please check your API key configuration.
        </p>
        <Button 
          onClick={() => window.location.reload()} 
          variant="outline"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry Connection
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header with AI icon */}
      <div className="p-4 border-b border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-900">AI Assistant</h3>
          </div>
          
          <div className="flex items-center gap-1 min-w-0">
            {/* Action Buttons */}
            {messages.length > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportChatAsDocx}
                  className="h-8 w-8 p-0 shrink-0 border-slate-300 hover:bg-slate-50"
                  title="Export chat"
                >
                  <FileText className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearChat}
                  className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 border-slate-300 shrink-0"
                  title="Clear chat"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <Input
            placeholder="Ask me anything about your project documents..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isLoading}
            className="flex-1 border-slate-300 focus:border-blue-500 focus:ring-blue-500"
          />
          <Button 
            onClick={handleSendMessage}
            disabled={!inputMessage.trim() || isLoading}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Start a conversation</h3>
            <p className="text-slate-600 max-w-sm">
              Ask me anything about your project documents, measurements, or conditions. I can help you understand your blueprints and project details.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {message.role === 'assistant' && (
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-blue-600" />
                </div>
              )}
              
              <div
                className={`max-w-xs rounded-lg p-3 ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-900 border border-slate-200 shadow-sm'
                }`}
              >
                <div className="text-sm">
                  {renderMessageContent(message)}
                  {message.isStreaming && (
                    <span className="inline-block w-2 h-4 bg-current animate-pulse ml-1" />
                  )}
                </div>
                {message.error && (
                  <div className="mt-2 text-sm text-red-600">
                    Error: {message.error}
                  </div>
                )}
              </div>

              {message.role === 'user' && (
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-green-600" />
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      
      {/* Status bar */}
      <div className="px-6 py-3 border-t border-slate-200 bg-white">
        <div className="flex items-center space-x-2 text-slate-500">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-sm">AI Assistant Online</span>
        </div>
      </div>
    </div>
  );
}
