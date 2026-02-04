import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Eye, X, CheckCircle, AlertCircle, Clock, MapPin } from 'lucide-react';

interface LivePreviewData {
  progress?: number;
  message?: string;
  documentId?: string;
  pageNumber?: number;
  analysis?: { conditions?: unknown[]; measurements?: unknown[] };
  condition?: { type?: string; unit?: string };
}

interface LivePreviewUpdate {
  type: 'page_analysis' | 'condition_created' | 'measurement_placed' | 'progress_update' | 'error' | 'page_identified' | 'ai_processing';
  data: LivePreviewData | string;
  timestamp: string;
  projectId: string;
  documentId?: string;
  pageNumber?: number;
  imageData?: string; // Base64 image data for preview
}

interface LivePreviewProps {
  projectId: string;
  isVisible: boolean;
  onClose: () => void;
  takeoffProgress?: {
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
  } | null;
}

export const LivePreview: React.FC<LivePreviewProps> = ({ projectId, isVisible, onClose, takeoffProgress }) => {
  const [_socket, setSocket] = useState<Socket | null>(null);
  const [updates, setUpdates] = useState<LivePreviewUpdate[]>([]);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [currentPageImage, setCurrentPageImage] = useState<string | null>(null);
  const [currentPageNumber, setCurrentPageNumber] = useState<number | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const updatesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isVisible || !projectId) return;

    let newSocket: Socket | null = null;

    // Use consistent API base URL logic for Socket.IO connection
    // Socket.IO connects to the base server URL (without /api path)
    import('../lib/apiConfig').then(({ getServerBaseUrl }) => {
      const socketUrl = getServerBaseUrl();

      // Connect to Socket.IO server
      newSocket = io(socketUrl, {
        transports: ['websocket', 'polling'], // Add polling as fallback
        withCredentials: true,
        query: { projectId }
      });

      newSocket.on('connect', () => {
        console.log('🔌 Connected to live preview service');
        setIsConnected(true);
        newSocket?.emit('join_project', projectId);
      });

      newSocket.on('disconnect', () => {
        console.log('🔌 Disconnected from live preview service');
        setIsConnected(false);
      });

      newSocket.on('takeoff_update', (update: LivePreviewUpdate) => {
        console.log('📡 Received live preview update:', update);
        setUpdates(prev => [...prev, update]);
        
        if (update.type === 'progress_update' && typeof update.data !== 'string') {
          setCurrentProgress(update.data.progress ?? 0);
          setCurrentMessage(update.data.message ?? '');
          setIsScanning((update.data.message ?? '').includes('Analyzing') || (update.data.message ?? '').includes('Processing'));
        }
        
        if (update.type === 'page_analysis' && update.imageData) {
          setCurrentPageImage(update.imageData);
          setCurrentPageNumber(update.pageNumber ?? null);
          setIsScanning(false);
        }
        
        if (update.type === 'ai_processing' && typeof update.data !== 'string') {
          setCurrentMessage(update.data.message ?? '');
          setIsScanning(true);
        }
      });

      setSocket(newSocket);
    });

    return () => {
      if (newSocket) {
        newSocket.disconnect();
      }
      setSocket(null);
      setIsConnected(false);
    };
  }, [isVisible, projectId]);

  useEffect(() => {
    updatesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [updates]);

  if (!isVisible) return null;

  const getUpdateIcon = (type: string) => {
    switch (type) {
      case 'page_analysis': return <Eye className="w-4 h-4 text-blue-500" />;
      case 'condition_created': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'measurement_placed': return <MapPin className="w-4 h-4 text-purple-500" />;
      case 'progress_update': return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
      default: return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getUpdateColor = (type: string) => {
    switch (type) {
      case 'page_analysis': return 'border-blue-200 bg-blue-50';
      case 'condition_created': return 'border-green-200 bg-green-50';
      case 'measurement_placed': return 'border-purple-200 bg-purple-50';
      case 'progress_update': return 'border-yellow-200 bg-yellow-50';
      case 'error': return 'border-red-200 bg-red-50';
      default: return 'border-gray-200 bg-gray-50';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="presentation" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-5/6 flex flex-col" role="dialog" aria-modal="true" aria-labelledby="dialog-live-preview-title">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <h2 id="dialog-live-preview-title" className="text-xl font-semibold">Live Preview - AI Takeoff Agent</h2>
            <span className="text-sm text-gray-500">Project: {projectId.slice(0, 8)}...</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="p-4 border-b bg-gray-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Progress</span>
            <span className="text-sm text-gray-500">{Math.round(takeoffProgress?.progress || currentProgress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${takeoffProgress?.progress || currentProgress}%` }}
            />
          </div>
          {(takeoffProgress?.message || currentMessage) && (
            <p className="text-sm text-gray-600 mt-2">{takeoffProgress?.message || currentMessage}</p>
          )}
          {takeoffProgress && (
            <div className="mt-2 text-xs text-gray-500">
              <div className="flex justify-between">
                <span>Status: {takeoffProgress.status}</span>
                <span>Step: {takeoffProgress.currentStep}</span>
              </div>
              {takeoffProgress.totalPages > 0 && (
                <div className="flex justify-between mt-1">
                  <span>Pages: {takeoffProgress.processedPages}/{takeoffProgress.totalPages}</span>
                  <span>Conditions: {takeoffProgress.conditionsCreated}</span>
                </div>
              )}
              {takeoffProgress.duration && (
                <div className="mt-1">
                  Duration: {Math.round(takeoffProgress.duration / 1000)}s
                </div>
              )}
            </div>
          )}
        </div>

        {/* Page Preview and Updates */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Page Preview */}
          <div className="w-1/2 border-r border-gray-200 flex flex-col">
            <div className="p-3 border-b border-gray-200 bg-gray-50">
              <h3 className="font-medium text-sm text-gray-700">Page Preview</h3>
              {currentPageNumber && (
                <p className="text-xs text-gray-500">Page {currentPageNumber}</p>
              )}
            </div>
            <div className="flex-1 p-4 bg-gray-100 flex items-center justify-center relative">
              {currentPageImage ? (
                <div className="relative">
                  <img 
                    src={`data:image/png;base64,${currentPageImage}`}
                    alt={`Page ${currentPageNumber} preview`}
                    className="max-w-full max-h-full object-contain shadow-lg rounded"
                  />
                  {isScanning && (
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent animate-pulse opacity-75"></div>
                      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-transparent via-blue-200/20 to-transparent animate-pulse"></div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-gray-500">
                  <Eye className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p className="text-sm">Waiting for page analysis...</p>
                  <p className="text-xs mt-2">The AI will analyze pages and show them here in real-time.</p>
                  {isScanning && (
                    <div className="mt-4">
                      <div className="w-32 h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent animate-pulse mx-auto rounded"></div>
                      <p className="text-xs text-blue-600 mt-2 animate-pulse">AI is scanning...</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Right: Updates List */}
          <div className="w-1/2 overflow-y-auto p-4">
            {updates.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <Clock className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>Waiting for AI Takeoff Agent updates...</p>
                <p className="text-sm mt-2">Real-time progress will appear here as the AI works.</p>
              </div>
            ) : (
            <div className="space-y-3">
              {updates.map((update, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg border ${getUpdateColor(update.type)}`}
                >
                  <div className="flex items-start gap-3">
                    {getUpdateIcon(update.type)}
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm capitalize">
                          {update.type.replace('_', ' ')}
                        </h4>
                        <span className="text-xs text-gray-500">
                          {new Date(update.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 mt-1">
                        {(() => {
                          if (typeof update.data === 'string') {
                            return update.data;
                          }
                          if (update.data && typeof update.data === 'object') {
                            // Handle different data structures
                            if (update.data.message) {
                              return update.data.message;
                            }
                            if (update.data.progress !== undefined) {
                              return `Progress: ${update.data.progress}%`;
                            }
                            if (update.data.documentId && update.data.pageNumber) {
                              return `Document: ${update.data.documentId.slice(0, 8)}... | Page: ${typeof update.data.pageNumber === 'number' ? update.data.pageNumber : 'Unknown'}`;
                            }
                            // Fallback for other objects
                            return `Update: ${update.type}`;
                          }
                          return 'No data available';
                        })()}
                      </p>
                      
                      {/* Additional data display */}
                      {update.type === 'page_analysis' && typeof update.data !== 'string' && update.data.analysis && (
                        <div className="mt-2 text-xs text-gray-600">
                          <p>Conditions: {update.data.analysis.conditions?.length ?? 0}</p>
                          <p>Measurements: {update.data.analysis.measurements?.length ?? 0}</p>
                        </div>
                      )}
                      
                      {update.type === 'condition_created' && typeof update.data !== 'string' && update.data.condition && (
                        <div className="mt-2 text-xs text-gray-600">
                          <p>Type: {update.data.condition.type}</p>
                          <p>Unit: {update.data.condition.unit}</p>
                        </div>
                      )}
                      
                      {update.documentId && update.pageNumber && (
                        <div className="mt-2 text-xs text-gray-500">
                          Document: {update.documentId.slice(0, 8)}... | Page: {typeof update.pageNumber === 'number' ? update.pageNumber : 'Unknown'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={updatesEndRef} />
            </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div className="flex items-center gap-4">
              <span>Updates: {updates.length}</span>
              <span>Status: {isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <button
              onClick={() => setUpdates([])}
              className="text-blue-600 hover:text-blue-800 transition-colors"
            >
              Clear Updates
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
