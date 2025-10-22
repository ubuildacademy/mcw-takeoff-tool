import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { 
  X, 
  Bot, 
  Play, 
  Pause, 
  Square,
  CheckCircle, 
  AlertCircle,
  Loader2,
  BookOpen,
  Target,
  BarChart3
} from 'lucide-react';
import { useTakeoffStore } from '../store/useTakeoffStore';
import type { PDFDocument } from '../types';

interface TrainingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  documents: PDFDocument[];
  onPageSelect?: (documentId: string, pageNumber: number) => void;
}

type TrainingStage = 'setup' | 'recording' | 'review' | 'complete';

export function TrainingDialog({ 
  isOpen, 
  onClose, 
  projectId, 
  documents,
  onPageSelect 
}: TrainingDialogProps) {
  // Training state
  const [currentStage, setCurrentStage] = useState<TrainingStage>('setup');
  const [scope, setScope] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>('');
  const [selectedPageNumber, setSelectedPageNumber] = useState<number>(1);
  const [isRecording, setIsRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // Training progress
  const [recordedActions, setRecordedActions] = useState<any[]>([]);
  const [accuracy, setAccuracy] = useState<number>(85);
  const [feedback, setFeedback] = useState('');
  
  // Store integration
  const { getCurrentProject } = useTakeoffStore();
  const currentProject = getCurrentProject();

  const handleStartTraining = async () => {
    if (!scope.trim() || !selectedDocumentId) {
      alert('Please provide a scope and select a document.');
      return;
    }

    try {
      // Start training session
      const response = await fetch('/api/training/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId,
          documentId: selectedDocumentId,
          pageNumber: selectedPageNumber,
          scope: scope.trim()
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start training session');
      }

      const data = await response.json();
      setSessionId(data.id);
      setCurrentStage('recording');
      setIsRecording(true);
      
      // Navigate to the selected page
      if (onPageSelect) {
        onPageSelect(selectedDocumentId, selectedPageNumber);
      }
    } catch (error) {
      console.error('Error starting training session:', error);
      alert('Failed to start training session. Please try again.');
    }
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    setCurrentStage('review');
  };

  const handleCompleteTraining = async () => {
    if (!sessionId) return;

    try {
      const response = await fetch('/api/training/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          accuracy,
          feedback: feedback.trim()
        })
      });

      if (!response.ok) {
        throw new Error('Failed to complete training session');
      }

      setCurrentStage('complete');
    } catch (error) {
      console.error('Error completing training session:', error);
      alert('Failed to complete training session. Please try again.');
    }
  };

  const handleClose = () => {
    setCurrentStage('setup');
    setScope('');
    setSelectedDocumentId('');
    setSelectedPageNumber(1);
    setIsRecording(false);
    setSessionId(null);
    setRecordedActions([]);
    setAccuracy(85);
    setFeedback('');
    onClose();
  };

  const getExampleScopes = () => [
    "Count all doors and windows",
    "Measure flooring areas (LVT, carpet, tile)",
    "Calculate wall areas for painting",
    "Count electrical outlets and switches",
    "Measure ceiling areas for drywall"
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full h-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-blue-600 rounded-lg flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-semibold">AI Agent Training</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {/* Setup Stage */}
          {currentStage === 'setup' && (
            <div className="p-6 h-full flex flex-col">
              <div className="mb-6">
                <h3 className="text-lg font-medium mb-2">Train the AI Agent</h3>
                <p className="text-gray-600">
                  Perform a manual takeoff while the AI watches and learns from your actions. 
                  This helps improve the AI's accuracy for future takeoffs.
                </p>
              </div>

              <div className="flex-1 flex flex-col gap-6">
                {/* Scope Input */}
                <div>
                  <label className="block text-sm font-medium mb-2">Training Scope</label>
                  <Textarea
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    placeholder="What would you like to train the AI on? (e.g., 'Count all doors and windows')"
                    className="h-24 resize-none"
                  />
                  
                  {/* Example Scopes */}
                  <div className="mt-4">
                    <p className="text-sm text-gray-600 mb-2">Example training scopes:</p>
                    <div className="grid grid-cols-1 gap-2">
                      {getExampleScopes().map((example, index) => (
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

                {/* Document and Page Selection */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Document</label>
                    <select
                      value={selectedDocumentId}
                      onChange={(e) => setSelectedDocumentId(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded-md"
                    >
                      <option value="">Select a document</option>
                      {documents.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.name} ({doc.totalPages} pages)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Page Number</label>
                    <Input
                      type="number"
                      min="1"
                      max={documents.find(d => d.id === selectedDocumentId)?.totalPages || 1}
                      value={selectedPageNumber}
                      onChange={(e) => setSelectedPageNumber(parseInt(e.target.value) || 1)}
                    />
                  </div>
                </div>

                {/* Training Info */}
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="font-medium text-blue-800 mb-2">How Training Works</h4>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• Perform the takeoff manually while recording</li>
                    <li>• The AI will watch and learn from your actions</li>
                    <li>• Rate the accuracy of your manual takeoff</li>
                    <li>• Provide feedback to help improve the AI</li>
                  </ul>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleStartTraining}
                  disabled={!scope.trim() || !selectedDocumentId}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Start Training
                </Button>
              </div>
            </div>
          )}

          {/* Recording Stage */}
          {currentStage === 'recording' && (
            <div className="p-6 h-full flex flex-col">
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                  <h3 className="text-lg font-medium">Recording Training Session</h3>
                </div>
                <p className="text-gray-600">
                  Perform your takeoff manually. All actions are being recorded for AI training.
                </p>
              </div>

              <div className="flex-1 flex flex-col gap-6">
                {/* Recording Status */}
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="font-medium text-red-800">Recording Active</span>
                  </div>
                  <p className="text-sm text-red-700">
                    Actions recorded: {recordedActions.length}
                  </p>
                </div>

                {/* Training Instructions */}
                <div className="space-y-4">
                  <h4 className="font-medium">Training Instructions</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <h5 className="font-medium text-sm mb-1">1. Create Conditions</h5>
                      <p className="text-sm text-gray-600">
                        Set up conditions for the items you're counting/measuring
                      </p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <h5 className="font-medium text-sm mb-1">2. Place Measurements</h5>
                      <p className="text-sm text-gray-600">
                        Click and drag to place measurements on the PDF
                      </p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <h5 className="font-medium text-sm mb-1">3. Be Accurate</h5>
                      <p className="text-sm text-gray-600">
                        Take your time to be as accurate as possible
                      </p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <h5 className="font-medium text-sm mb-1">4. Complete Takeoff</h5>
                      <p className="text-sm text-gray-600">
                        Finish the takeoff as you normally would
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t">
                <Button 
                  onClick={handleStopRecording}
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop Recording
                </Button>
              </div>
            </div>
          )}

          {/* Review Stage */}
          {currentStage === 'review' && (
            <div className="p-6 h-full flex flex-col">
              <div className="mb-6">
                <h3 className="text-lg font-medium mb-2">Review Training Session</h3>
                <p className="text-gray-600">
                  Rate the accuracy of your manual takeoff and provide feedback to help improve the AI.
                </p>
              </div>

              <div className="flex-1 flex flex-col gap-6">
                {/* Session Summary */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-medium mb-3">Training Session Summary</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Scope:</span>
                      <span className="ml-2 font-medium">{scope}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Document:</span>
                      <span className="ml-2 font-medium">
                        {documents.find(d => d.id === selectedDocumentId)?.name}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Page:</span>
                      <span className="ml-2 font-medium">{selectedPageNumber}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Actions Recorded:</span>
                      <span className="ml-2 font-medium">{recordedActions.length}</span>
                    </div>
                  </div>
                </div>

                {/* Accuracy Rating */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Rate the accuracy of your manual takeoff (0-100%)
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={accuracy}
                      onChange={(e) => setAccuracy(parseInt(e.target.value))}
                      className="flex-1"
                    />
                    <span className="text-lg font-medium w-12">{accuracy}%</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Very Inaccurate</span>
                    <span>Very Accurate</span>
                  </div>
                </div>

                {/* Feedback */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Additional Feedback (Optional)
                  </label>
                  <Textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Any additional notes about the training session, challenges encountered, or suggestions for improvement..."
                    className="h-24 resize-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleCompleteTraining}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Complete Training
                </Button>
              </div>
            </div>
          )}

          {/* Complete Stage */}
          {currentStage === 'complete' && (
            <div className="p-6 h-full flex flex-col items-center justify-center">
              <CheckCircle className="w-16 h-16 text-green-600 mb-4" />
              <h3 className="text-xl font-medium mb-2">Training Complete!</h3>
              <p className="text-gray-600 text-center mb-6">
                Thank you for training the AI agent. Your actions and feedback will help improve 
                the AI's performance for future takeoffs.
              </p>
              
              <div className="bg-gray-50 rounded-lg p-6 w-full max-w-md">
                <h4 className="font-medium mb-4">Training Summary</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Scope:</span>
                    <span className="font-medium">{scope}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Actions Recorded:</span>
                    <span className="font-medium">{recordedActions.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Accuracy Rating:</span>
                    <span className="font-medium">{accuracy}%</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <Button variant="outline" onClick={handleClose}>
                  Close
                </Button>
                <Button onClick={() => setCurrentStage('setup')}>
                  Train Again
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
