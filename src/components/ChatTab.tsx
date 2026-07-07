import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  Send,
  Bot,
  User,
  Loader2,
  AlertCircle,
  MessageSquare,
  Trash2,
  FileText,
  RefreshCw,
  Copy,
  Check,
  Square
} from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { ollamaService, type OllamaMessage, type OllamaQuotaInfo } from '../services/ollamaService';
import { serverOcrService } from '../services/serverOcrService';
import { useProjectStore } from '../store/slices/projectSlice';
import { useConditionStore } from '../store/slices/conditionSlice';
import { useMeasurementStore } from '../store/slices/measurementSlice';
import { authHelpers } from '../lib/supabase';
import { settingsService } from '../services/apiService';
import { CHAT_PRESET_CONFIGS, CHAT_PRESET_MAP, CHAT_PRESET_SETTING_KEY } from '../constants/chatPresets';
import { knowledgeBaseService } from '../services/knowledgeBaseService';
import { buildStaticProjectContext, retrieveRelevantPages, type ChatSourceDoc } from '../utils/chatContext';
import type { PDFDocument } from '../types';

/** Strip markdown to plain text (pure, no closure — safe to define outside component). */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*_]{3,}$/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '• ')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

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
}

/** Compact Tailwind styling for assistant markdown (tables, code, lists). Defined once, outside the component. */
const markdownComponents: Components = {
  p: ({ ...props }) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
  table: ({ ...props }) => (
    <div className="overflow-x-auto my-2 max-w-full">
      <table className="border-collapse text-sm" {...props} />
    </div>
  ),
  thead: ({ ...props }) => <thead {...props} />,
  th: ({ ...props }) => <th className="border px-2 py-1 bg-muted text-left font-medium whitespace-nowrap" {...props} />,
  td: ({ ...props }) => <td className="border px-2 py-1 align-top" {...props} />,
  ul: ({ ...props }) => <ul className="list-disc list-outside pl-5 space-y-0.5 my-1" {...props} />,
  ol: ({ ...props }) => <ol className="list-decimal list-outside pl-5 space-y-0.5 my-1" {...props} />,
  li: ({ ...props }) => <li {...props} />,
  h1: ({ ...props }) => <h1 className="text-base font-semibold mt-2 mb-1" {...props} />,
  h2: ({ ...props }) => <h2 className="text-sm font-semibold mt-2 mb-1" {...props} />,
  h3: ({ ...props }) => <h3 className="text-sm font-semibold mt-1 mb-1" {...props} />,
  a: ({ ...props }) => <a className="text-blue-600 underline break-all" target="_blank" rel="noreferrer" {...props} />,
  strong: ({ ...props }) => <strong className="font-semibold" {...props} />,
  blockquote: ({ ...props }) => <blockquote className="border-l-2 pl-2 italic text-muted-foreground my-1" {...props} />,
  pre: ({ ...props }) => <pre className="bg-muted rounded p-2 my-1 overflow-x-auto text-xs font-mono" {...props} />,
  code: ({ ...props }) => <code className="px-1 py-0.5 rounded bg-muted/70 text-xs font-mono" {...props} />,
  hr: ({ ...props }) => <hr className="my-2 border-border" {...props} />,
};

/** Generic suggested-question chips shown under the welcome message before the user has asked anything. */
const SUGGESTED_QUESTIONS = [
  'Summarize my takeoff so far',
  'What conditions have no measurements yet?',
  'What scope gaps should I check?',
  'What documents have been uploaded?',
];

export function ChatTab({ projectId, documents }: ChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOllamaAvailable, setIsOllamaAvailable] = useState<boolean | null>(null);
  const [retryingConnection, setRetryingConnection] = useState(false);
  const [userName, setUserName] = useState<string>('');
  const [quotaInfo, setQuotaInfo] = useState<OllamaQuotaInfo | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(() => {
    return localStorage.getItem(`chat-preset-${projectId}`) ?? 'general';
  });
  // Prompts loaded from server settings (admin-editable); fall back to defaults from constants
  const [presetPrompts, setPresetPrompts] = useState<Record<string, string>>({});
  // KB content cached per preset — loaded once on mount/preset-change, not per message
  const [kbCache, setKbCache] = useState<Record<string, string>>({});
  // Message id whose content was just copied (drives the brief check-mark confirmation on the copy button)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // OCR text cache, keyed by document id — fetched once per document, reused across every message.
  const ocrCacheRef = useRef<Map<string, ChatSourceDoc>>(new Map());
  // Aborts the in-flight streaming request when the user clicks Stop.
  const abortControllerRef = useRef<AbortController | null>(null);

  // Render assistant content as GitHub-flavored markdown (tables, lists, headings); user content stays plain text.
  const renderMessageContent = (message: ChatMessage) => {
    if (message.role === 'user') {
      return <div className="whitespace-pre-wrap">{message.content}</div>;
    }
    return (
      <div className="text-sm [&>*:first-child]:mt-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {message.content}
        </ReactMarkdown>
      </div>
    );
  };

  const handleCopyMessage = useCallback(async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopiedMessageId((current) => (current === message.id ? null : current)), 1500);
    } catch {
      toast.error('Failed to copy');
    }
  }, []);

  const getCurrentProject = useProjectStore((s) => s.getCurrentProject);
  const getProjectTakeoffSummary = useMeasurementStore((s) => s.getProjectTakeoffSummary);
  // Narrow selector with shallow eq: only this project's conditions (fewer re-renders when other projects change)
  const conditions = useConditionStore(useShallow((s) => s.getProjectConditions(projectId)));
  // Do not load conditions/measurements here — the left conditions sidebar owns loading.
  // ChatTab only reads from the store so switching to AI Chat won't refresh the sidebar.

  // Scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const checkOllamaAvailability = useCallback(async () => {
    try {
      const available = await ollamaService.isAvailable();
      setIsOllamaAvailable(available);
      return available;
    } catch (error) {
      console.error('Failed to check Ollama availability:', error);
      setIsOllamaAvailable(false);
      return false;
    }
  }, []);

  // Load KB content for a preset and cache it; no-op if already cached
  const loadKbForPreset = useCallback(async (presetId: string) => {
    setKbCache(prev => {
      if (presetId in prev) return prev; // Already cached
      return prev;
    });
    try {
      const content = await knowledgeBaseService.getContent(presetId);
      setKbCache(prev => ({ ...prev, [presetId]: content }));
    } catch {
      // KB unavailable — silently use empty string
      setKbCache(prev => ({ ...prev, [presetId]: '' }));
    }
  }, []);

  // On mount: user name + Ollama availability + preset prompts + KB for current preset
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [metadata, available] = await Promise.all([
          authHelpers.getUserMetadata(),
          ollamaService.isAvailable(),
        ]);
        if (!cancelled) {
          if (metadata?.full_name) setUserName(metadata.full_name);
          setIsOllamaAvailable(available);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to initialize chat:', error);
          setIsOllamaAvailable(false);
        }
      }

      // Load admin-configured prompts for each preset (fail silently)
      try {
        const loaded: Record<string, string> = {};
        await Promise.all(
          CHAT_PRESET_CONFIGS.map(async (preset) => {
            try {
              const res = await settingsService.getSetting(CHAT_PRESET_SETTING_KEY(preset.id));
              if (res?.value) loaded[preset.id] = res.value;
            } catch {
              // Not configured yet — default will be used
            }
          })
        );
        if (!cancelled) setPresetPrompts(loaded);
      } catch {
        // Silently ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load KB content whenever the selected preset changes (lazy, cached)
  useEffect(() => {
    const preset = CHAT_PRESET_MAP[selectedPresetId];
    if (preset?.usesKnowledgeBase && !(selectedPresetId in kbCache)) {
      loadKbForPreset(selectedPresetId);
    }
  }, [selectedPresetId, kbCache, loadKbForPreset]);

  // Load chat history from localStorage for persistence
  useEffect(() => {
    const chatKey = `chat-${projectId}`;
    const savedMessages = localStorage.getItem(chatKey);
    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        setMessages(parsed.map((msg: { role: string; content: string; timestamp?: string }) => ({
          ...msg,
          timestamp: new Date(msg.timestamp ?? 0)
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
      const firstName = userName ? userName.split(' ')[0] : null;
      const preset = CHAT_PRESET_MAP[selectedPresetId] ?? CHAT_PRESET_MAP['general'];
      const systemMessage: ChatMessage = {
        id: 'system-welcome',
        role: 'assistant',
        content: preset.welcomeMessage(firstName),
        timestamp: new Date()
      };
      setMessages([systemMessage]);
    }
  }, [isOllamaAvailable, messages.length, userName, selectedPresetId]);

  const handlePresetChange = useCallback((newPresetId: string) => {
    setSelectedPresetId(newPresetId);
    localStorage.setItem(`chat-preset-${projectId}`, newPresetId);
    localStorage.removeItem(`chat-${projectId}`);
    const firstName = userName ? userName.split(' ')[0] : null;
    const preset = CHAT_PRESET_MAP[newPresetId] ?? CHAT_PRESET_MAP['general'];
    const welcomeMsg: ChatMessage = {
      id: `system-welcome-${Date.now()}`,
      role: 'assistant',
      content: preset.welcomeMessage(firstName),
      timestamp: new Date(),
    };
    setMessages([welcomeMsg]);
    // Pre-load KB for new preset if not already cached
    if (preset.usesKnowledgeBase && !(newPresetId in kbCache)) {
      loadKbForPreset(newPresetId);
    }
  }, [projectId, userName, kbCache, loadKbForPreset]);

  // Ensure every current document's OCR data is cached (ref, not state — fetching does not need a re-render).
  // Only documents not already cached are fetched, in parallel; already-cached docs are reused as-is.
  const getCachedOcrDocs = useCallback(async (): Promise<ChatSourceDoc[]> => {
    const cache = ocrCacheRef.current;
    const missing = documents.filter((d) => !cache.has(d.id));
    if (missing.length > 0) {
      const fetched = await Promise.all(
        missing.map(async (doc): Promise<ChatSourceDoc> => {
          const docName = doc.originalName || doc.filename || doc.name;
          try {
            const ocrData = await serverOcrService.getDocumentData(doc.id, projectId);
            const pages = Array.isArray(ocrData?.results)
              ? ocrData.results
                  .filter((r) => r != null && r.pageNumber != null)
                  .map((r) => ({ pageNumber: r.pageNumber, text: r.text ?? '' }))
              : [];
            return { docId: doc.id, docName, pages };
          } catch {
            // OCR not available for this document yet — cache as empty so we don't retry every message.
            return { docId: doc.id, docName, pages: [] };
          }
        })
      );
      for (const chatDoc of fetched) {
        cache.set(chatDoc.docId, chatDoc);
      }
    }
    return documents
      .map((d) => cache.get(d.id))
      .filter((d): d is ChatSourceDoc => d != null);
  }, [documents, projectId]);

  // Stop the in-flight streaming response, keeping whatever content has arrived so far.
  const handleStopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // Core send routine — accepts explicit content so suggested-question chips can send
  // without going through input-field state (which would otherwise be stale here).
  const sendMessage = useCallback(async (rawContent: string) => {
    const content = rawContent.trim();
    if (!content || isLoading || !isOllamaAvailable) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    const assistantMessageId = `assistant-${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true
    };

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const activePreset = CHAT_PRESET_MAP[selectedPresetId] ?? CHAT_PRESET_MAP['general'];
      const systemPrompt = presetPrompts[selectedPresetId] ?? activePreset.defaultPrompt;

      // OCR text is cached per document id (ref) so it is fetched once, not on every message.
      const cachedDocs = await getCachedOcrDocs();

      const staticContext = buildStaticProjectContext({
        projectId,
        project: getCurrentProject(),
        conditions,
        totals: getProjectTakeoffSummary(projectId),
        documents: documents.map((d) => ({
          name: d.originalName || d.filename || d.name,
          pageCount: d.totalPages,
        })),
      });

      // Question-aware retrieval over OCR page text, instead of stuffing every page of
      // every document into the prompt (which silently got truncated by the model's context window).
      const relevantPages = retrieveRelevantPages(content, cachedDocs);
      const relevantSection = relevantPages
        ? `\n\n=== RELEVANT SHEET TEXT (auto-selected for this question) ===\n${relevantPages}`
        : '';

      const kbContent = kbCache[selectedPresetId] ?? '';
      const kbSection = kbContent
        ? `\n\n=== KNOWLEDGE BASE ===\nUse the following reference material to answer technical questions about materials, installation methods, specifications, and standards. Cite the section when referencing it.\n\n${kbContent}\n=== END KNOWLEDGE BASE ===`
        : '';

      const ollamaMessages: OllamaMessage[] = [
        {
          role: 'system',
          content: `${systemPrompt}${kbSection}\n\n${staticContext}${relevantSection}`
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

      setMessages(prev => [...prev, assistantMessage]);

      // Send to Ollama with streaming
      let fullResponse = '';
      for await (const chunk of ollamaService.chatStream({
        model: ollamaService.getDefaultModel(),
        messages: ollamaMessages,
        stream: true,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          num_ctx: 32768
        }
      }, controller.signal)) {
        // Update quota display whenever we get new header info (once per request).
        const q = ollamaService.getLastQuotaInfo();
        if (q) setQuotaInfo(q);

        if (chunk.message?.content) {
          fullResponse += chunk.message.content;

          // Store raw markdown — rendering (or stripping for export) happens at display time.
          setMessages(prev => prev.map(msg =>
            msg.id === assistantMessage.id
              ? { ...msg, content: fullResponse }
              : msg
          ));
        }

        if (chunk.done) {
          setMessages(prev => prev.map(msg =>
            msg.id === assistantMessage.id
              ? { ...msg, isStreaming: false, content: fullResponse }
              : msg
          ));
          break;
        }
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User clicked Stop — keep whatever partial content already streamed in, just end the stream.
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMessageId ? { ...msg, isStreaming: false } : msg
        ));
        return;
      }

      console.error('Error sending message to Ollama:', error);

      const q = ollamaService.getLastQuotaInfo();
      if (q) setQuotaInfo(q);

      const maybeStatus = (error as any)?.status;
      const retryAfter = (error as any)?.retryAfterSeconds;
      if (maybeStatus === 429) {
        const remaining = q?.dailyRemaining;
        const msg =
          typeof remaining === 'number'
            ? `AI chat limit reached (${remaining} remaining today). Try again later.`
            : 'AI chat limit reached. Try again later.';
        toast.error(retryAfter ? `${msg} Retry in ~${Math.ceil(retryAfter / 60)} min.` : msg);
      } else if (maybeStatus === 422) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'That question is outside the AI Assistant scope. Please ask about construction/estimating/takeoff.'
        );
      }

      setMessages(prev => prev.map(msg =>
        msg.id === assistantMessageId
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
      abortControllerRef.current = null;
    }
  }, [isLoading, isOllamaAvailable, selectedPresetId, presetPrompts, getCachedOcrDocs, projectId, getCurrentProject, conditions, getProjectTakeoffSummary, documents, kbCache, messages]);

  // Handle sending a message from the input field
  const handleSendMessage = useCallback(() => {
    void sendMessage(inputMessage);
  }, [sendMessage, inputMessage]);

  // Handle a suggested-question chip click — sends immediately, bypassing input-field state.
  const handleSuggestedQuestion = useCallback((question: string) => {
    void sendMessage(question);
  }, [sendMessage]);

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
      toast.error('Failed to export chat. Please try again.');
    }
  };

  if (isOllamaAvailable === null) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-4" />
        <p className="text-muted-foreground">Checking Ollama connection...</p>
      </div>
    );
  }

  if (isOllamaAvailable === false) {
    const serverError = ollamaService.getLastErrorMessage();
    const handleRetry = async () => {
      setRetryingConnection(true);
      setIsOllamaAvailable(null);
      const available = await checkOllamaAvailability();
      setRetryingConnection(false);
      if (!available) setIsOllamaAvailable(false);
    };
    return (
      <div className="flex flex-col h-full items-center justify-center p-4">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Ollama Not Available</h3>
        <p className="text-muted-foreground text-center mb-4">
          {serverError
            ? serverError
            : 'Unable to connect to Ollama cloud service. Please check your API key configuration.'}
        </p>
        <Button 
          onClick={handleRetry} 
          variant="outline"
          disabled={retryingConnection}
        >
          {retryingConnection ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          {retryingConnection ? 'Checking...' : 'Retry Connection'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background text-foreground">
      {/* Header with AI icon */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-foreground">AI Assistant</h3>
          </div>

          <div className="flex items-center gap-1 min-w-0">
            {typeof quotaInfo?.dailyRemaining === 'number' && typeof quotaInfo?.dailyLimit === 'number' && (
              <div className="text-xs text-muted-foreground mr-2 whitespace-nowrap">
                Chats today: {quotaInfo.dailyRemaining}/{quotaInfo.dailyLimit}
              </div>
            )}
            {messages.length > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportChatAsDocx}
                  className="h-8 w-8 p-0 shrink-0"
                  title="Export chat"
                >
                  <FileText className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearChat}
                  className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-500/10 shrink-0"
                  title="Clear chat"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Preset selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">Mode:</span>
          <Select value={selectedPresetId} onValueChange={handlePresetChange}>
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHAT_PRESET_CONFIGS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id} className="text-xs">
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-muted/30">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Start a conversation</h3>
            <p className="text-muted-foreground max-w-sm">
              Ask me anything about your project. I can help you understand your blueprints and project details.
            </p>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`group flex gap-3 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-blue-600" />
                  </div>
                )}

                <div
                  className={`rounded-lg p-3 ${
                    message.role === 'user' ? 'max-w-md bg-blue-600 text-white' : 'max-w-[85%] bg-card text-foreground border shadow-sm'
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
                  {message.role === 'assistant' && !message.isStreaming && message.content && (
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(message)}
                      className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Copy message"
                    >
                      {copiedMessageId === message.id ? (
                        <>
                          <Check className="w-3 h-3" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Copy
                        </>
                      )}
                    </button>
                  )}
                </div>

                {message.role === 'user' && (
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-green-600" />
                  </div>
                )}
              </div>
            ))}
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-2 justify-start pl-11">
                {SUGGESTED_QUESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => handleSuggestedQuestion(question)}
                    disabled={isLoading}
                    className="text-xs px-3 py-1.5 rounded-full border bg-card hover:bg-accent hover:text-accent-foreground text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {question}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar at bottom */}
      <div className="p-4 border-t bg-background">
        <div className="flex gap-2">
          <Input
            id="chat-input"
            name="chat-input"
            placeholder="Ask me anything about your project"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isLoading}
            className="flex-1"
          />
          {isLoading ? (
            <Button
              onClick={handleStopStreaming}
              size="sm"
              variant="destructive"
              className="px-4"
              title="Stop generating"
            >
              <Square className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSendMessage}
              disabled={!inputMessage.trim()}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white px-4"
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
      
      {/* Status bar */}
      <div className="px-6 py-3 border-t bg-background">
        <div className="flex items-center space-x-2 text-muted-foreground">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-sm">AI Assistant Online</span>
        </div>
      </div>
    </div>
  );
}
