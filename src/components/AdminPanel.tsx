import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { 
  Settings, 
  BarChart3, 
  Database, 
  RefreshCw,
  Lock,
  Unlock,
  Brain,
  CheckCircle
} from 'lucide-react';
import { OCRTrainingDialog } from './OCRTrainingDialog';
import { ocrTrainingService } from '../services/ocrTrainingService';
import { enhancedOcrService } from '../services/enhancedOcrService';
import { ollamaService, type OllamaModel } from '../services/ollamaService';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

export function AdminPanel({ isOpen, onClose, projectId }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'ocr-training' | 'ai-settings' | 'system-settings'>('overview');
  const [showOCRTraining, setShowOCRTraining] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [availableModels, setAvailableModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('gpt-oss:120b-cloud');
  const [fallbackModel, setFallbackModel] = useState<string>('llama3.1:8b');

  // Admin authentication (simple key-based for now)
  const ADMIN_KEY = 'admin'; // In production, this would be more secure

  const handleUnlock = () => {
    if (adminKey === ADMIN_KEY) {
      setIsUnlocked(true);
      setAdminKey('');
    } else {
      alert('Invalid admin key');
    }
  };

  const handleLock = () => {
    setIsUnlocked(false);
    setActiveTab('overview');
  };

  // Load available models when AI settings tab is opened
  const loadAvailableModels = async () => {
    try {
      const models = await ollamaService.getModels();
      setAvailableModels(models);
      
      // Set current default model
      const currentDefault = ollamaService.getDefaultModel();
      setSelectedModel(currentDefault);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  // Load models when AI settings tab becomes active
  useEffect(() => {
    if (activeTab === 'ai-settings' && isUnlocked) {
      loadAvailableModels();
    }
  }, [activeTab, isUnlocked]);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'ocr-training', label: 'OCR Training', icon: Brain },
    { id: 'ai-settings', label: 'AI Settings', icon: Brain },
    { id: 'system-settings', label: 'System Settings', icon: Settings }
  ];

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] h-[95vh] max-w-none max-h-none overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Admin Panel
            {isUnlocked && <Badge variant="outline" className="text-green-600">Unlocked</Badge>}
          </DialogTitle>
        </DialogHeader>

        {!isUnlocked ? (
          // Admin Authentication
          <div className="flex-1 flex items-center justify-center">
            <div className="w-96 space-y-6">
              <div className="text-center">
                <Lock className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                <h2 className="text-xl font-semibold mb-2">Admin Access Required</h2>
                <p className="text-gray-600">Enter admin key to access system management tools</p>
              </div>
              
              <div className="space-y-4">
                <div>
                  <Label htmlFor="admin-key">Admin Key</Label>
                  <Input
                    id="admin-key"
                    type="password"
                    value={adminKey}
                    onChange={(e) => setAdminKey(e.target.value)}
                    placeholder="Enter admin key..."
                    onKeyPress={(e) => e.key === 'Enter' && handleUnlock()}
                  />
                </div>
                
                <Button 
                  onClick={handleUnlock} 
                  className="w-full"
                  disabled={!adminKey.trim()}
                >
                  <Unlock className="w-4 h-4 mr-2" />
                  Unlock Admin Panel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          // Admin Panel Content
          <div className="flex-1 flex min-h-0">
            {/* Sidebar */}
            <div className="w-64 border-r bg-gray-50 flex flex-col">
              <div className="p-4 border-b">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">Admin Tools</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLock}
                    className="text-gray-500"
                  >
                    <Lock className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              <div className="flex-1 p-2">
                <nav className="space-y-1">
                  {tabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors ${
                          activeTab === tab.id
                            ? 'bg-blue-100 text-blue-700'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {tab.label}
                      </button>
                    );
                  })}
                </nav>
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === 'overview' && (
                <div className="p-6 space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold mb-4">System Overview</h2>
                    <p className="text-gray-600 mb-6">
                      Welcome to the Meridian Takeoff Admin Panel. Here you can manage AI training, 
                      OCR accuracy, and system settings.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="border rounded-lg p-6 flex flex-col">
                      <div className="flex items-center gap-3 mb-4">
                        <Brain className="w-8 h-8 text-blue-600" />
                        <h3 className="text-lg font-semibold">OCR Training</h3>
                      </div>
                      <p className="text-gray-600 mb-4 flex-grow">
                        Manage OCR training data and improve accuracy for sheet number and name extraction.
                      </p>
                      <Button 
                        onClick={() => setShowOCRTraining(true)}
                        className="w-full"
                      >
                        <Brain className="w-4 h-4 mr-2" />
                        Open OCR Training
                      </Button>
                    </div>

                    <div className="border rounded-lg p-6 flex flex-col">
                      <div className="flex items-center gap-3 mb-4">
                        <Brain className="w-8 h-8 text-orange-600" />
                        <h3 className="text-lg font-semibold">AI Settings</h3>
                      </div>
                      <p className="text-gray-600 mb-4 flex-grow">
                        Configure AI chat models, prompts, and response parameters for optimal performance.
                      </p>
                      <Button 
                        onClick={() => setActiveTab('ai-settings')}
                        className="w-full"
                      >
                        <Brain className="w-4 h-4 mr-2" />
                        AI Configuration
                      </Button>
                    </div>

                    <div className="border rounded-lg p-6 flex flex-col">
                      <div className="flex items-center gap-3 mb-4">
                        <Database className="w-8 h-8 text-purple-600" />
                        <h3 className="text-lg font-semibold">System Settings</h3>
                      </div>
                      <p className="text-gray-600 mb-4 flex-grow">
                        Configure system parameters, manage data, and access advanced settings.
                      </p>
                      <Button 
                        onClick={() => setActiveTab('system-settings')}
                        className="w-full"
                      >
                        <Settings className="w-4 h-4 mr-2" />
                        System Settings
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
                    <div className="flex gap-4">
                      <Button 
                        size="sm"
                        onClick={async () => {
                          const isConnected = await ocrTrainingService.testDatabaseConnection();
                          if (isConnected) {
                            alert('✅ Database connection successful!');
                          } else {
                            alert('❌ Database connection failed. Check console for details.');
                          }
                        }}
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Test Database
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'ocr-training' && (
                <div className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold">OCR Training Management</h2>
                    <div className="flex gap-2">
                      <Button 
                        onClick={async () => {
                          const isConnected = await ocrTrainingService.testDatabaseConnection();
                          if (isConnected) {
                            alert('✅ Database connection successful!');
                          } else {
                            alert('❌ Database connection failed. Check console for details.');
                          }
                        }}
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Test DB
                      </Button>
                      <Button 
                        onClick={async () => {
                          console.log('🔍 Loading ALL training data (no project filter)...');
                          await ocrTrainingService.loadTrainingData(); // No projectId = load all
                          const data = ocrTrainingService.getTrainingData();
                          alert(`Found ${data.length} total training entries in database. Check console for details.`);
                        }}
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Load All Data
                      </Button>
                      <Button onClick={() => setShowOCRTraining(true)}>
                        <Brain className="w-4 h-4 mr-2" />
                        Open Training Interface
                      </Button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="border rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-4">Training Statistics</h3>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span>Total Training Entries:</span>
                          <Badge variant="outline">Loading...</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Average Confidence:</span>
                          <Badge variant="outline">Loading...</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>User Validations:</span>
                          <Badge variant="outline">Loading...</Badge>
                        </div>
                      </div>
                    </div>

                    <div className="border rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-4">Pattern Recognition</h3>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span>Sheet Number Patterns:</span>
                          <Badge variant="outline">5 patterns</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Sheet Name Categories:</span>
                          <Badge variant="outline">8 categories</Badge>
                        </div>
                        <div className="flex justify-between">
                          <span>Character Substitutions:</span>
                          <Badge variant="outline">12 mappings</Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}


              {activeTab === 'ai-settings' && (
                <div className="p-6">
                  <h2 className="text-2xl font-bold mb-6">AI Chat Configuration</h2>
                  
                  <div className="space-y-6">
                    <div className="border rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-4">Model Settings</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Default Model</Label>
                          <select 
                            className="w-full p-2 border rounded-md"
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                          >
                            {availableModels.map((model) => (
                              <option key={model.name} value={model.name}>
                                {model.name} ({(model.size / 1024 / 1024 / 1024).toFixed(1)}GB)
                              </option>
                            ))}
                          </select>
                          <p className="text-sm text-gray-600 mt-1">Primary AI model for chat responses</p>
                        </div>
                        <div>
                          <Label>Fallback Model</Label>
                          <select 
                            className="w-full p-2 border rounded-md"
                            value={fallbackModel}
                            onChange={(e) => setFallbackModel(e.target.value)}
                          >
                            {availableModels.map((model) => (
                              <option key={model.name} value={model.name}>
                                {model.name} ({(model.size / 1024 / 1024 / 1024).toFixed(1)}GB)
                              </option>
                            ))}
                          </select>
                          <p className="text-sm text-gray-600 mt-1">Backup model if primary fails</p>
                        </div>
                      </div>
                    </div>

                    <div className="border rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-4">Response Parameters</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <Label>Temperature</Label>
                          <Input 
                            type="number" 
                            step="0.1" 
                            min="0" 
                            max="2" 
                            placeholder="0.7" 
                            defaultValue="0.7"
                          />
                          <p className="text-sm text-gray-600 mt-1">Creativity level (0-2)</p>
                        </div>
                        <div>
                          <Label>Top P</Label>
                          <Input 
                            type="number" 
                            step="0.1" 
                            min="0" 
                            max="1" 
                            placeholder="0.9" 
                            defaultValue="0.9"
                          />
                          <p className="text-sm text-gray-600 mt-1">Response diversity (0-1)</p>
                        </div>
                        <div>
                          <Label>Max Tokens</Label>
                          <Input 
                            type="number" 
                            placeholder="2048" 
                            defaultValue="2048"
                          />
                          <p className="text-sm text-gray-600 mt-1">Maximum response length</p>
                        </div>
                      </div>
                    </div>

                    <div className="border rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-4">System Prompt</h3>
                      <div className="space-y-4">
                        <div>
                          <Label>Construction Takeoff Assistant Prompt</Label>
                          <textarea 
                            className="w-full h-32 p-3 border rounded-md resize-none"
                            placeholder="You are an AI assistant specialized in construction takeoff and project analysis..."
                            defaultValue="You are an AI assistant specialized in construction takeoff and project analysis. You help users understand their construction documents, measurements, and project requirements.

When answering questions:
- Be specific and reference actual data from the project when possible
- If you reference a document or page, mention the document name and page number
- Help users understand measurements, conditions, and project details
- If you don't have enough information, ask clarifying questions
- Be concise but thorough in your responses"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="border rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-4">Context & Memory</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Context Window Size</Label>
                          <Input 
                            type="number" 
                            placeholder="10" 
                            defaultValue="10"
                          />
                          <p className="text-sm text-gray-600 mt-1">Number of previous messages to include</p>
                        </div>
                        <div>
                          <Label>Project Context Level</Label>
                          <select className="w-full p-2 border rounded-md">
                            <option value="full">Full Project Data</option>
                            <option value="summary">Summary Only</option>
                            <option value="minimal">Minimal Context</option>
                          </select>
                          <p className="text-sm text-gray-600 mt-1">Amount of project data to include</p>
                        </div>
                      </div>
                    </div>

                    <div className="border rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-4">Performance & Limits</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Response Timeout (seconds)</Label>
                          <Input 
                            type="number" 
                            placeholder="300" 
                            defaultValue="300"
                          />
                          <p className="text-sm text-gray-600 mt-1">Maximum time to wait for response</p>
                        </div>
                        <div>
                          <Label>Rate Limit (requests/minute)</Label>
                          <Input 
                            type="number" 
                            placeholder="60" 
                            defaultValue="60"
                          />
                          <p className="text-sm text-gray-600 mt-1">Maximum requests per minute</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-4">
                      <Button
                        onClick={() => {
                          ollamaService.setDefaultModel(selectedModel);
                          alert('✅ AI settings saved successfully!');
                        }}
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Save AI Settings
                      </Button>
                      <Button 
                        onClick={async () => {
                          try {
                            const isAvailable = await ollamaService.isAvailable();
                            if (isAvailable) {
                              alert('✅ Ollama connection successful!');
                            } else {
                              alert('❌ Ollama connection failed. Make sure Ollama is running.');
                            }
                          } catch (error) {
                            alert('❌ Connection test failed. Check console for details.');
                          }
                        }}
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Test Connection
                      </Button>
                      <Button 
                        className="bg-red-600 hover:bg-red-700"
                        onClick={() => {
                          setSelectedModel('gpt-oss:120b-cloud');
                          setFallbackModel('llama3.1:8b');
                          ollamaService.setDefaultModel('gpt-oss:120b-cloud');
                          alert('✅ Settings reset to defaults!');
                        }}
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Reset to Defaults
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'system-settings' && (
                <div className="p-6">
                  <h2 className="text-2xl font-bold mb-6">System Settings</h2>
                  
                  <div className="space-y-6">
                    <div className="border rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-4">OCR Configuration</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Confidence Threshold</Label>
                          <Input type="number" placeholder="30" />
                        </div>
                        <div>
                          <Label>Processing Timeout (seconds)</Label>
                          <Input type="number" placeholder="30" />
                        </div>
                      </div>
                    </div>

                    <div className="border rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-4">Data Management</h3>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-medium">Training Data</h4>
                            <p className="text-sm text-gray-600">Use the OCR Training interface to manage training data</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-medium">System Cache</h4>
                            <p className="text-sm text-gray-600">Cache is automatically managed by the system</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Sub-dialogs */}
      <OCRTrainingDialog
        isOpen={showOCRTraining}
        onClose={() => setShowOCRTraining(false)}
        projectId={projectId}
      />
    </Dialog>
  );
}
