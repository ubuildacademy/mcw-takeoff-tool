import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { 
  X, 
  Bot, 
  Search, 
  CheckCircle, 
  XCircle, 
  ArrowRight, 
  ArrowLeft,
  FileText,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  Plus,
  Trash2
} from 'lucide-react';
import { aiTakeoffService } from '../services/aiTakeoffService';
import { hybridDetectionService } from '../services/hybridDetectionService';
import { playwrightTakeoffService } from '../services/playwrightTakeoffService';
import { ollamaService } from '../services/ollamaService';
// import { LivePreview } from './LivePreview'; // Removed to fix React errors
import { serverOcrService } from '../services/serverOcrService';
import { useTakeoffStore } from '../store/useTakeoffStore';
import { supabase } from '../lib/supabase';
import type { 
  AIIdentifiedPage, 
  AITakeoffResult, 
  AITakeoffProgress,
  PDFDocument 
} from '../types';

interface AITakeoffAgentProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  documents: PDFDocument[];
  onPageSelect?: (documentId: string, pageNumber: number) => void;
}

type Stage = 'scope' | 'identifying' | 'page-selection' | 'processing' | 'complete';

export function AITakeoffAgent({ 
  isOpen, 
  onClose, 
  projectId, 
  documents,
  onPageSelect 
}: AITakeoffAgentProps) {
  // Stage management
  const [currentStage, setCurrentStage] = useState<Stage>('scope');
  const [scope, setScope] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  
  // Page identification
  const [identifiedPages, setIdentifiedPages] = useState<AIIdentifiedPage[]>([]);
  const [isIdentifying, setIsIdentifying] = useState(false);
  
  // Processing
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [currentResult, setCurrentResult] = useState<AITakeoffResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState<string>('');
  const [processingProgress, setProcessingProgress] = useState(0);
  
  // Results tracking
  const [acceptedResults, setAcceptedResults] = useState<AITakeoffResult[]>([]);
  const [rejectedPages, setRejectedPages] = useState<number[]>([]);
  
  // Live preview
  // const [showLivePreview, setShowLivePreview] = useState(false); // Removed to fix React errors
  const [takeoffProgress, setTakeoffProgress] = useState<{
    active: boolean;
    status: string;
    progress: number;
    message: string;
    currentStep: string;
    totalPages: number;
    processedPages: number;
    conditionsCreated: number;
    measurementsPlaced: number;
    errors: string[];
    duration?: number;
  } | null>(null);

  // Poll for takeoff progress
  const pollTakeoffProgress = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;
      
      const response = await fetch(`/api/playwright-takeoff/takeoff-progress/${projectId}`, {
        headers: {
          ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setTakeoffProgress(data);
        
        // Stop polling if completed or error
        if (data.status === 'completed' || data.status === 'error') {
          return false; // Stop polling
        }
        return true; // Continue polling
      }
    } catch (error) {
      console.error('Error polling takeoff progress:', error);
    }
    return true; // Continue polling on error
  };
  
  // Service availability
  const [serviceStatus, setServiceStatus] = useState<{ 
    qwenVision: boolean; 
    chatAI: boolean; 
    playwright: boolean;
    hybrid: boolean;
    fullAutomation: boolean;
  }>({ qwenVision: false, chatAI: false, playwright: false, hybrid: false, fullAutomation: false });
  
  // Store integration
  const { loadProjectConditions } = useTakeoffStore();

  // Check service availability on mount
  useEffect(() => {
    if (isOpen) {
      checkServiceStatus();
    }
  }, [isOpen]);

  const checkServiceStatus = async () => {
    try {
      // Check if the same AI model used by chat agent is available
      const isAvailable = await ollamaService.isAvailable();
      // Also check Qwen3-VL status from backend
      const backendStatus = await aiTakeoffService.checkStatus();
      // Check Playwright automation capabilities
      const automationStatus = await playwrightTakeoffService.checkAutomationStatus();
      // Check hybrid detection availability
      const hybridStatus = await hybridDetectionService.isAvailable();
      
      console.log('🔍 Service Status Check:');
      console.log('- Chat AI available:', isAvailable);
      console.log('- Backend status:', backendStatus);
      console.log('- Automation capabilities:', automationStatus.capabilities);
      console.log('- Hybrid detection:', hybridStatus);
      
      setServiceStatus({
        qwenVision: backendStatus.qwenVision,
        chatAI: isAvailable, // Using the same model as chat agent
        playwright: automationStatus.capabilities.playwright,
        hybrid: hybridStatus,
        fullAutomation: automationStatus.capabilities.fullAutomation
      });
    } catch (error) {
      console.error('Error checking service status:', error);
      setServiceStatus({
        qwenVision: false,
        chatAI: false,
        playwright: false,
        hybrid: false,
        fullAutomation: false
      });
    }
  };

  const handleScopeSubmit = async () => {
    if (!scope.trim()) return;
    
    // Validate scope
    const validation = aiTakeoffService.validateScope(scope);
    if (!validation.valid) {
      alert(validation.error);
      return;
    }

    // Set selected documents (all if none selected)
    const docsToUse = selectedDocuments.length > 0 ? selectedDocuments : documents.map(d => d.id);
    setSelectedDocuments(docsToUse);

    // Start page identification
    setCurrentStage('identifying');
    setIsIdentifying(true);

    try {
      const pages = await identifyPagesWithOllama(scope, docsToUse, projectId);
      setIdentifiedPages(pages);
      setCurrentStage('page-selection');
    } catch (error) {
      console.error('Error identifying pages:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert(`Failed to identify pages: ${errorMessage}`);
      setCurrentStage('scope');
    } finally {
      setIsIdentifying(false);
    }
  };

  // Use the same AI model as chat agent for page identification
  const identifyPagesWithOllama = async (scope: string, documentIds: string[], projectId: string): Promise<AIIdentifiedPage[]> => {
    console.log(`AI Takeoff: Identifying relevant pages for scope: ${scope}`);

    // Get OCR data for all documents
    const documentContexts = await Promise.all(documentIds.map(async (docId) => {
      try {
        const ocrData = await serverOcrService.getDocumentData(docId, projectId);
        const document = documents.find(d => d.id === docId);
        const documentName = document?.name || docId;
        
        if (ocrData && ocrData.results.length > 0) {
          // CRITICAL FIX: Filter out null/undefined results before accessing pageNumber
          // This prevents "Cannot read properties of undefined (reading 'pageNumber')" errors
          const pagesText = ocrData.results
            .filter(p => p != null && p.pageNumber != null)
            .map(p => `Page ${p.pageNumber}: ${p.text}`)
            .join('\n\n');
          return {
            documentId: docId,
            documentName,
            text: pagesText,
          };
        }
        return null;
      } catch (error) {
        console.error(`Error fetching OCR data for document ${docId}:`, error);
        return null;
      }
    }));

    const validDocumentContexts = documentContexts.filter(Boolean);

    console.log('AI Takeoff Debug:', {
      documentIds,
      documentContexts: documentContexts.length,
      validDocumentContexts: validDocumentContexts.length,
      scope,
      validDocumentContextsDetails: validDocumentContexts.map(doc => ({
        documentId: doc?.documentId,
        documentName: doc?.documentName,
        textLength: doc?.text?.length || 0,
        textPreview: doc?.text?.substring(0, 200) + '...'
      }))
    });

    if (validDocumentContexts.length === 0) {
      console.log('No valid document contexts found - no OCR data available');
      return [];
    }

    const systemPrompt = `You are a construction document analyst. Your task is to identify pages containing items matching a specific takeoff scope.

SCOPE: "${scope}"

ANALYSIS REQUIREMENTS:
1. Analyze each page's OCR text for scope-relevant content
2. Identify page type and confidence level
3. Provide specific evidence for your decision
4. Return structured JSON only

PAGE TYPE CLASSIFICATION:
- "floor-plan": Room layouts, dimensions, architectural drawings, scale information
- "finish-schedule": Material specifications, room finish tables, material schedules
- "detail-drawing": Enlarged views, construction details, cross-sections
- "elevation": Building elevations, wall sections, exterior views
- "other": General construction information, notes, specifications

CONFIDENCE SCORING:
- 0.9-1.0: Strong evidence, multiple indicators present
- 0.7-0.8: Good evidence, clear indicators
- 0.5-0.6: Moderate evidence, some indicators
- 0.3-0.4: Weak evidence, few indicators
- 0.0-0.2: No relevant evidence

SCOPE-SPECIFIC INDICATORS:
For flooring scopes (LVT, carpet, tile, etc.):
- Floor plans: Room boundaries, area measurements, scale bars
- Finish schedules: Material specifications, room finish tables
- Details: Flooring installation details, transitions

For door/window scopes:
- Floor plans: Door/window symbols, schedules
- Elevations: Door/window details, hardware specs
- Details: Door/window installation details

For electrical scopes:
- Floor plans: Outlet symbols, electrical plans
- Schedules: Electrical fixture schedules, panel schedules
- Details: Electrical installation details

OUTPUT FORMAT - Return ONLY this JSON structure:
[
  {
    "documentId": "doc1",
    "pageNumber": 1,
    "confidence": 0.9,
    "reason": "Specific evidence found: [list key indicators]",
    "pageType": "floor-plan",
    "indicators": ["room layouts", "scale bar", "dimensions"],
    "relevanceScore": 0.95
  }
]

CRITICAL RULES:
1. Return ONLY valid JSON array
2. Include specific evidence in reason field
3. List key indicators found
4. Provide relevance score (0-1)
5. If no pages relevant, return: []

RESPONSE FORMAT: Start with [ and end with ]. No other text.`;

    const userMessage = validDocumentContexts.map(doc => 
      `Document ${doc?.documentName} (ID: ${doc?.documentId}):\n${doc?.text}`
    ).join('\n\n---\n\n');

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userMessage }
    ];

    console.log('AI Takeoff - Sending to AI model:', {
      systemPrompt: systemPrompt.substring(0, 200) + '...',
      userMessageLength: userMessage.length,
      userMessagePreview: userMessage.substring(0, 500) + '...',
      model: ollamaService.getDefaultModel()
    });

    try {
      const response = await ollamaService.chat({
        model: ollamaService.getDefaultModel(),
        messages: messages,
        options: { temperature: 0.3 }
      });

      const content = response.message.content;
      console.log('AI Takeoff Response:', content);
      
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const identifiedPages: AIIdentifiedPage[] = JSON.parse(jsonMatch[0]);
        console.log('Parsed identified pages:', identifiedPages);
        return identifiedPages.map(p => ({ ...p, selected: true })); // Default to selected
      }
      console.log('No JSON array found in AI response');
      return [];
    } catch (error) {
      console.error('Error identifying pages with Ollama:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to identify relevant pages: ${error.message}`);
      } else {
        throw new Error('Failed to identify relevant pages: Unknown error');
      }
    }
  };

  const handlePageSelectionToggle = (pageIndex: number) => {
    setIdentifiedPages(prev => 
      prev.map((page, index) => 
        index === pageIndex ? { ...page, selected: !page.selected } : page
      )
    );
  };

  const handleStartProcessing = () => {
    const selectedPages = identifiedPages.filter(p => p.selected);
    if (selectedPages.length === 0) {
      alert('Please select at least one page to process.');
      return;
    }
    
    setCurrentStage('processing');
    setCurrentPageIndex(0);
    processNextPage(selectedPages, 0);
  };

  const handleBatchProcessing = async () => {
    const selectedPages = identifiedPages.filter(p => p.selected);
    if (selectedPages.length === 0) {
      alert('Please select at least one page to process.');
      return;
    }
    
    setCurrentStage('processing');
    setIsProcessing(true);
    setProcessingMessage('Processing all pages in batch...');
    
    try {
      // Check if this is a flooring scope that would benefit from aggregation
      const isFlooringScope = scope.toLowerCase().includes('lvt') || 
                             scope.toLowerCase().includes('flooring') || 
                             scope.toLowerCase().includes('carpet') || 
                             scope.toLowerCase().includes('tile');
      
      const batchResult = await aiTakeoffService.processBatch(
        selectedPages.map(p => ({
          documentId: p.documentId,
          pageNumber: p.pageNumber,
          pageType: p.pageType
        })),
        scope,
        projectId,
        isFlooringScope // Aggregate results for flooring scopes
      );
      
      // Create a consolidated result for display
      const consolidatedResult: AITakeoffResult = {
        pageNumber: 1,
        documentId: selectedPages[0].documentId,
        conditions: batchResult.results.flatMap(r => r.conditions),
        measurements: batchResult.results.flatMap(r => r.measurements),
        calibration: batchResult.results[0]?.calibration
      };
      
      setCurrentResult(consolidatedResult);
      setProcessingMessage(`Batch processing complete: ${batchResult.message}`);
      
      // Auto-accept if we have results
      if (consolidatedResult.conditions.length > 0) {
        setTimeout(() => {
          handleAcceptResult();
        }, 2000);
      }
    } catch (error) {
      console.error('Error in batch processing:', error);
      setProcessingMessage(`Batch processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFullAutomatedTakeoff = async () => {
    const selectedPages = identifiedPages.filter(p => p.selected);
    if (selectedPages.length === 0) {
      alert('Please select at least one page to process.');
      return;
    }
    
    setCurrentStage('processing');
    setIsProcessing(true);
    setProcessingMessage('Executing full automated takeoff with AI analysis and measurement placement...');
    
    // Automatically open live preview when starting full automation
    // setShowLivePreview(true); // Removed to fix React errors
    setTakeoffProgress(null); // Reset progress
    
    // Start polling for progress updates
    const pollInterval = setInterval(async () => {
      const shouldContinue = await pollTakeoffProgress();
      if (!shouldContinue) {
        clearInterval(pollInterval);
      }
    }, 1000); // Poll every second
    
    try {
      console.log('🤖 Starting full automated takeoff workflow');
      
      // Execute full automated takeoff using Playwright service
      const fullResult = await playwrightTakeoffService.executeFullAutomatedTakeoff(
        scope,
        selectedPages.map(p => p.documentId),
        projectId,
        selectedPages.map(p => p.pageNumber), // Pass just the page numbers
        serviceStatus.fullAutomation // Only execute automation if fully available
      );
      
      console.log('✅ Full automated takeoff complete:', fullResult);
      
      // Update processing message with results
      setProcessingMessage(
        `Full automation complete! ${fullResult.summary.totalConditionsCreated} conditions created, ` +
        `${fullResult.summary.totalMeasurementsPlaced} measurements placed across ${fullResult.summary.totalPages} pages. ` +
        `${fullResult.summary.totalErrors} errors encountered.`
      );
      
      // Refresh conditions in store
      await loadProjectConditions(projectId);
      
      // Force refresh conditions to ensure they appear in the UI
      setTimeout(async () => {
        console.log('🔄 Force refreshing conditions after takeoff completion...');
        await loadProjectConditions(projectId);
      }, 2000);
      
      // Also refresh after a longer delay to catch any delayed condition creation
      setTimeout(async () => {
        console.log('🔄 Final condition refresh after takeoff completion...');
        await loadProjectConditions(projectId);
      }, 5000);
      
      // Move to complete stage immediately since we have results
      setCurrentStage('complete');
      setIsProcessing(false);
      
    } catch (error) {
      console.error('❌ Error in full automated takeoff:', error);
      setProcessingMessage(`Full automation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsProcessing(false);
    }
  };

  const processNextPage = async (pages: AIIdentifiedPage[], pageIndex: number) => {
    if (pageIndex >= pages.length) {
      setCurrentStage('complete');
      return;
    }

    const page = pages[pageIndex];
    console.log(`🔄 Processing page ${page.pageNumber} (${pageIndex + 1}/${pages.length})`);
    console.log('- Document ID:', page.documentId);
    console.log('- Page type:', page.pageType);
    console.log('- Scope:', scope);
    console.log('- Service status:', serviceStatus);
    
    setProcessingProgress((pageIndex / pages.length) * 100);
    setIsProcessing(true);

    // Check if Qwen3-VL is available for processing
    if (!serviceStatus.qwenVision) {
      console.log('❌ Qwen3-VL not available, skipping processing');
      // Show message that Qwen3-VL is not available
      setCurrentResult({
        pageNumber: page.pageNumber,
        documentId: page.documentId,
        conditions: [],
        measurements: [],
        calibration: undefined
      });
      setProcessingMessage('Qwen3-VL vision model not available. Page identification complete. Set up Qwen3-VL for detailed takeoff analysis.');
      setIsProcessing(false);
      return;
    }

    console.log('✅ Qwen3-VL is available, processing page...');
    
    try {
      const result = await aiTakeoffService.processPage(
        page.documentId,
        page.pageNumber,
        scope,
        projectId,
        page.pageType
      );
      
      console.log('✅ Page processing result:', result);
      setCurrentResult(result);
      
      // Always show the result to the user - don't auto-skip
      // Let the user decide whether to accept, reject, or skip
    } catch (error) {
      console.error('❌ Error processing page:', error);
      setRejectedPages(prev => [...prev, page.pageNumber]);
      setTimeout(() => processNextPage(pages, pageIndex + 1), 1000);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAcceptResult = async () => {
    if (!currentResult) return;

    try {
      // Create conditions and measurements
      await aiTakeoffService.createAIConditions(
        currentResult.conditions,
        currentResult.measurements,
        projectId,
        currentResult.documentId,
        currentResult.pageNumber
      );

      // Refresh conditions in store
      await loadProjectConditions(projectId);

      setAcceptedResults(prev => [...prev, currentResult]);
      
      // Move to next page
      const selectedPages = identifiedPages.filter(p => p.selected);
      processNextPage(selectedPages, currentPageIndex + 1);
    } catch (error) {
      console.error('Error accepting result:', error);
      alert('Failed to save results. Please try again.');
    }
  };

  const handleRejectResult = () => {
    if (!currentResult) return;
    
    setRejectedPages(prev => [...prev, currentResult.pageNumber]);
    
    // Move to next page
    const selectedPages = identifiedPages.filter(p => p.selected);
    processNextPage(selectedPages, currentPageIndex + 1);
  };

  const handleSkipPage = () => {
    if (!currentResult) return;
    
    setRejectedPages(prev => [...prev, currentResult.pageNumber]);
    
    // Move to next page
    const selectedPages = identifiedPages.filter(p => p.selected);
    processNextPage(selectedPages, currentPageIndex + 1);
  };

  const handleClose = () => {
    setCurrentStage('scope');
    setScope('');
    setSelectedDocuments([]);
    setIdentifiedPages([]);
    setCurrentResult(null);
    setAcceptedResults([]);
    setRejectedPages([]);
    setCurrentPageIndex(0);
    onClose();
  };

  const getExampleScopes = () => aiTakeoffService.getExampleScopes();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full h-full max-w-7xl max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-semibold">AI Takeoff Agent</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {/* Scope Input Stage */}
          {currentStage === 'scope' && (
            <div className="p-6 h-full flex flex-col">
              <div className="mb-6">
                <h3 className="text-lg font-medium mb-2">Define Your Takeoff Scope</h3>
                <p className="text-gray-600">
                  Describe what you want to quantify across your construction documents. 
                  Be specific about the items, units, and any special requirements.
                </p>
              </div>

              <div className="flex-1 flex flex-col gap-6">
                {/* Scope Input */}
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-2">Scope Description</label>
                  <Textarea
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    placeholder="Enter your takeoff scope here..."
                    className="h-32 resize-none"
                  />
                  
                  {/* Example Scopes */}
                  <div className="mt-4">
                    <p className="text-sm text-gray-600 mb-2">Example scopes:</p>
                    <div className="grid grid-cols-1 gap-2">
                      {getExampleScopes().slice(0, 5).map((example, index) => (
                        <button
                          key={index}
                          onClick={() => setScope(example)}
                          className="text-left p-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded border border-transparent hover:border-gray-200"
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Document Selection */}
                <div>
                  <label className="block text-sm font-medium mb-2">Documents to Analyze</label>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {documents.map((doc) => (
                      <label key={doc.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedDocuments.includes(doc.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedDocuments(prev => [...prev, doc.id]);
                            } else {
                              setSelectedDocuments(prev => prev.filter(id => id !== doc.id));
                            }
                          }}
                        />
                        <span className="text-sm">{doc.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {doc.totalPages} pages
                        </Badge>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Leave unselected to analyze all documents
                  </p>
                </div>

                {/* Service Status */}
                <div className="flex items-center gap-4 p-3 bg-gray-50 rounded">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${serviceStatus.chatAI ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-sm">Chat AI (Page ID)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${serviceStatus.qwenVision ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-sm">Qwen3-VL Vision</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${serviceStatus.playwright ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-sm">Playwright</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${serviceStatus.hybrid ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-sm">Hybrid Detection</span>
                  </div>
                  {serviceStatus.fullAutomation && (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-sm font-medium text-blue-600">Full Automation</span>
                    </div>
                  )}
                  {(!serviceStatus.chatAI || !serviceStatus.qwenVision || !serviceStatus.playwright) && (
                    <AlertCircle className="w-4 h-4 text-orange-500" />
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleScopeSubmit}
                  disabled={!scope.trim() || !serviceStatus.chatAI}
                >
                  <Search className="w-4 h-4 mr-2" />
                  Identify Pages
                </Button>
              </div>
            </div>
          )}

          {/* Page Identification Stage */}
          {currentStage === 'identifying' && (
            <div className="p-6 h-full flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-4" />
              <h3 className="text-lg font-medium mb-2">Identifying Relevant Pages</h3>
              <p className="text-gray-600 text-center">
                AI is analyzing your documents to find pages containing items matching your scope...
              </p>
            </div>
          )}

          {/* Page Selection Stage */}
          {currentStage === 'page-selection' && (
            <div className="p-6 h-full flex flex-col">
              <div className="mb-6">
                <h3 className="text-lg font-medium mb-2">Review Identified Pages</h3>
                <p className="text-gray-600 mb-3">
                  Review the pages AI identified as relevant to your scope. 
                  You can add or remove pages before processing.
                </p>
                {scope.toLowerCase().includes('lvt') || scope.toLowerCase().includes('flooring') ? (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <p className="text-sm text-blue-800">
                      <strong>Flooring Takeoff Detected:</strong> For flooring scopes like LVT, the system will:
                      <br />• Identify both floor plans (for area measurement) and finish schedules (for specifications)
                      <br />• Group similar flooring areas across different building levels
                      <br />• Automatically aggregate totals when using "Process All & Aggregate"
                    </p>
                  </div>
                ) : null}
                {serviceStatus.fullAutomation && (
                  <div className="p-3 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-md">
                    <p className="text-sm text-blue-800">
                      <strong>🤖 Full Automation Available:</strong> The "Full Automation" button will:
                      <br />• Analyze pages with Qwen3-VL AI vision
                      <br />• Create conditions and measurements in the database
                      <br />• Automatically place visual measurements on the PDF using Playwright
                      <br />• Complete the entire takeoff process without manual intervention
                    </p>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                <div className="space-y-3">
                  {identifiedPages.map((page, index) => (
                    <div
                      key={`${page.documentId}-${page.pageNumber}`}
                      className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                        page.selected 
                          ? 'border-blue-500 bg-blue-50' 
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                      onClick={() => handlePageSelectionToggle(index)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={page.selected}
                            onChange={() => handlePageSelectionToggle(index)}
                            className="w-4 h-4"
                          />
                          <div>
                            <div className="font-medium">
                              {documents.find(d => d.id === page.documentId)?.name || 'Unknown Document'}
                            </div>
                            <div className="text-sm text-gray-600">
                              Page {page.pageNumber} • Confidence: {Math.round(page.confidence * 100)}%
                              {page.relevanceScore && (
                                <span className="ml-2 text-blue-600">
                                  • Relevance: {Math.round(page.relevanceScore * 100)}%
                                </span>
                              )}
                              {page.pageType && (
                                <Badge variant="outline" className="ml-2 text-xs">
                                  {page.pageType === 'floor-plan' ? 'Floor Plan' : 
                                   page.pageType === 'finish-schedule' ? 'Finish Schedule' : 
                                   page.pageType === 'detail-drawing' ? 'Detail Drawing' :
                                   page.pageType === 'elevation' ? 'Elevation' :
                                   'Other'}
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-gray-500 mt-1">
                              {page.reason}
                            </div>
                            {page.indicators && page.indicators.length > 0 && (
                              <div className="text-xs text-gray-400 mt-1">
                                Indicators: {page.indicators.join(', ')}
                              </div>
                            )}
                          </div>
                        </div>
                        <Badge variant={page.selected ? "default" : "outline"}>
                          {page.selected ? 'Selected' : 'Not Selected'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-center pt-6 border-t">
                <Button variant="outline" onClick={() => setCurrentStage('scope')}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Scope
                </Button>
                <div className="flex gap-2">
        {serviceStatus.fullAutomation ? (
          <div className="flex gap-3">
            <Button 
              onClick={handleFullAutomatedTakeoff}
              disabled={identifiedPages.filter(p => p.selected).length === 0}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
            >
              <Bot className="w-4 h-4 mr-2" />
              Full Automation with Live Preview
            </Button>
          </div>
        ) : (
                    <div className="text-center p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                      <p className="text-yellow-800">
                        <strong>Full Automation Not Available</strong>
                        <br />
                        Please ensure all services are running:
                        <br />
                        • Chat AI: {serviceStatus.chatAI ? '✅' : '❌'}
                        <br />
                        • Qwen3-VL Vision: {serviceStatus.qwenVision ? '✅' : '❌'}
                        <br />
                        • Playwright: {serviceStatus.playwright ? '✅' : '❌'}
                        <br />
                        • Hybrid Detection: {serviceStatus.hybrid ? '✅' : '❌'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Processing Stage */}
          {currentStage === 'processing' && (
            <div className="h-full flex">
              {/* Left Panel - PDF Preview */}
              <div className="flex-1 p-6 border-r">
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-medium">Processing Results</h3>
                    <Badge variant="outline">
                      Page {currentPageIndex + 1} of {identifiedPages.filter(p => p.selected).length}
                    </Badge>
                  </div>
                  <Progress value={processingProgress} className="mb-4" />
                  {processingMessage && (
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                      <p className="text-sm text-blue-800">{processingMessage}</p>
                    </div>
                  )}
                </div>

                {isProcessing ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
                      <p className="text-gray-600">Analyzing page with AI...</p>
                    </div>
                  </div>
                ) : currentResult ? (
                  <div className="space-y-4">
                    {/* Show calibration information */}
                    {currentResult.calibration && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <h5 className="font-medium text-blue-800 mb-1">Scale Calibration</h5>
                        <p className="text-sm text-blue-700">
                          Scale: {currentResult.calibration.scaleText || 'Detected'} 
                          {currentResult.calibration.scaleFactor && (
                            <span className="ml-2">
                              (Factor: {currentResult.calibration.scaleFactor.toFixed(4)})
                            </span>
                          )}
                        </p>
                      </div>
                    )}

                    {currentResult.conditions.length === 0 ? (
                      <div className="text-center py-8">
                        <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <h4 className="text-lg font-medium mb-2">No Items Found</h4>
                        <p className="text-gray-600 mb-4">
                          Qwen3-VL couldn't find any items matching your scope on this page.
                        </p>
                        {currentResult.calibration && (
                          <p className="text-sm text-gray-500">
                            Scale was detected: {currentResult.calibration.scaleText || 'Yes'}
                          </p>
                        )}
                        <p className="text-sm text-gray-500 mt-2">
                          You can still accept this result to skip the page, or reject it to try again.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <h4 className="font-medium">Found {currentResult.conditions.length} condition(s):</h4>
                        {currentResult.conditions.map((condition, index) => {
                          const conditionMeasurements = currentResult.measurements.filter(m => m.conditionIndex === index);
                          const totalValue = conditionMeasurements.reduce((sum, m) => sum + m.calculatedValue, 0);
                          
                          return (
                            <div key={index} className="p-3 border rounded-lg">
                              <div className="flex items-center gap-2 mb-2">
                                <div 
                                  className="w-4 h-4 rounded-full" 
                                  style={{ backgroundColor: condition.color }}
                                />
                                <span className="font-medium">{condition.name}</span>
                                <Badge variant="outline" className="text-xs">
                                  {condition.type}
                                </Badge>
                                <Badge variant="secondary" className="text-xs">
                                  {totalValue.toFixed(1)} {condition.unit}
                                </Badge>
                              </div>
                              <p className="text-sm text-gray-600">{condition.description}</p>
                              <div className="text-sm text-gray-500 mt-1">
                                {conditionMeasurements.length} measurement(s) • Total: {totalValue.toFixed(1)} {condition.unit}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              {/* Right Panel - Actions */}
              <div className="w-80 p-6">
                <div className="space-y-4">
                  <h4 className="font-medium">Review & Actions</h4>
                  
                  {/* Progress Cards */}
                  {isProcessing && (
                    <div className="space-y-3">
                      <h5 className="font-medium text-sm text-gray-700">System Activity</h5>
                      
                      {/* AI Analysis Card */}
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <Bot className="w-4 h-4 text-blue-600" />
                          <span className="text-sm font-medium text-blue-800">AI Analysis</span>
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                        </div>
                        <p className="text-xs text-blue-700">
                          Qwen3-VL analyzing page {currentPageIndex + 1} for {scope}
                        </p>
                      </div>
                      
                      {/* Playwright Automation Card */}
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <Search className="w-4 h-4 text-green-600" />
                          <span className="text-sm font-medium text-green-800">Automation</span>
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        </div>
                        <p className="text-xs text-green-700">
                          Playwright placing measurements on drawing
                        </p>
                      </div>
                      
                      {/* Progress Card */}
                      <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle className="w-4 h-4 text-purple-600" />
                          <span className="text-sm font-medium text-purple-800">Progress</span>
                        </div>
                        <p className="text-xs text-purple-700">
                          {processingMessage || 'Processing...'}
                        </p>
                        <div className="mt-2">
                          <Progress value={processingProgress} className="h-1" />
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Full Automation Progress Cards */}
                  {takeoffProgress && takeoffProgress.active && (
                    <div className="space-y-3">
                      <h5 className="font-medium text-sm text-gray-700">Full Automation Progress</h5>
                      
                      {/* Status Card */}
                      <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <Bot className="w-4 h-4 text-orange-600" />
                          <span className="text-sm font-medium text-orange-800">Status</span>
                          <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                        </div>
                        <p className="text-xs text-orange-700">
                          {takeoffProgress.status} - {takeoffProgress.currentStep}
                        </p>
                      </div>
                      
                      {/* Progress Card */}
                      <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle className="w-4 h-4 text-indigo-600" />
                          <span className="text-sm font-medium text-indigo-800">Progress</span>
                        </div>
                        <p className="text-xs text-indigo-700">
                          {takeoffProgress.message}
                        </p>
                        <div className="mt-2">
                          <Progress value={takeoffProgress.progress} className="h-1" />
                        </div>
                        <p className="text-xs text-indigo-600 mt-1">
                          {takeoffProgress.processedPages}/{takeoffProgress.totalPages} pages
                        </p>
                      </div>
                      
                      {/* Results Card */}
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle className="w-4 h-4 text-emerald-600" />
                          <span className="text-sm font-medium text-emerald-800">Results</span>
                        </div>
                        <p className="text-xs text-emerald-700">
                          {takeoffProgress.conditionsCreated} conditions created
                        </p>
                        {takeoffProgress.duration && (
                          <p className="text-xs text-emerald-600 mt-1">
                            Duration: {Math.round(takeoffProgress.duration / 1000)}s
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {currentResult ? (
                    <div className="space-y-3">
                      {currentResult.conditions.length > 0 ? (
                        <>
                          <Button 
                            onClick={handleAcceptResult}
                            className="w-full"
                            size="lg"
                          >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Accept & Save
                          </Button>
                          <Button 
                            onClick={handleRejectResult}
                            variant="outline"
                            className="w-full"
                            size="lg"
                          >
                            <XCircle className="w-4 h-4 mr-2" />
                            Reject
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button 
                            onClick={handleAcceptResult}
                            variant="outline"
                            className="w-full"
                            size="lg"
                          >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Accept (No Items Found)
                          </Button>
                          <Button 
                            onClick={handleRejectResult}
                            variant="outline"
                            className="w-full"
                            size="lg"
                          >
                            <XCircle className="w-4 h-4 mr-2" />
                            Reject & Retry
                          </Button>
                        </>
                      )}
                      <Button 
                        onClick={handleSkipPage}
                        variant="ghost"
                        className="w-full"
                        size="lg"
                      >
                        <ArrowRight className="w-4 h-4 mr-2" />
                        Skip to Next
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-gray-500">Processing page...</p>
                    </div>
                  )}

                  <div className="pt-4 border-t">
                    <h5 className="font-medium mb-2">Progress Summary</h5>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Accepted:</span>
                        <span className="text-green-600">{acceptedResults.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Rejected:</span>
                        <span className="text-red-600">{rejectedPages.length}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Complete Stage */}
          {currentStage === 'complete' && (
            <div className="p-6 h-full flex flex-col items-center justify-center">
              <CheckCircle className="w-16 h-16 text-green-600 mb-4" />
              <h3 className="text-xl font-medium mb-2">Processing Complete!</h3>
              <p className="text-gray-600 text-center mb-6">
                AI takeoff processing has finished. Review the summary below.
              </p>
              
              <div className="bg-gray-50 rounded-lg p-6 w-full max-w-md">
                <h4 className="font-medium mb-4">Summary</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Pages Processed:</span>
                    <span>{identifiedPages.filter(p => p.selected).length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Results Accepted:</span>
                    <span className="text-green-600">{acceptedResults.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Pages Skipped:</span>
                    <span className="text-gray-600">{rejectedPages.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Conditions Created:</span>
                    <span className="text-blue-600">
                      {acceptedResults.reduce((sum, result) => sum + result.conditions.length, 0)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <Button variant="outline" onClick={handleClose}>
                  Close
                </Button>
                <Button onClick={() => setCurrentStage('scope')}>
                  Start New Takeoff
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Live Preview Modal - Removed to fix React errors */}
    </div>
  );
}
