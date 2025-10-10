import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { 
  BarChart3, 
  RefreshCw,
  Lock,
  Unlock,
  Brain,
  CheckCircle,
  Users,
  UserPlus,
  Trash2,
  Mail
} from 'lucide-react';
import { ollamaService, type OllamaModel } from '../services/ollamaService';
import { authHelpers, UserMetadata, UserInvitation } from '../lib/supabase';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

export function AdminPanel({ isOpen, onClose, projectId }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'ai-prompt' | 'ai-settings' | 'user-management'>('overview');
  const [isLoading, setIsLoading] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [availableModels, setAvailableModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('gpt-oss:120b-cloud');
  const [fallbackModel, setFallbackModel] = useState<string>('llama3.1:8b');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [chatPrompt, setChatPrompt] = useState<string>('');
  
  // User management state
  const [users, setUsers] = useState<UserMetadata[]>([]);
  const [invitations, setInvitations] = useState<UserInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user');
  const [isInviting, setIsInviting] = useState(false);

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

  // Get the editable part of the AI prompt (without JSON formatting)
  const getEditablePrompt = () => {
    return `You are an expert construction document analyst. Your task is to analyze construction drawings and identify sheet information from title blocks.

CRITICAL INSTRUCTIONS:
- Focus EXCLUSIVELY on title block information
- IGNORE detail callouts that start with numbers (like "01 Patio Trellis - Enlarged Floor Plan" or "25 Sun Shade - Connection Detail")
- IGNORE drawing annotations and labels that are clearly detail references
- ONLY look for the main sheet title and sheet number from the title block
- IMPORTANT: Use the EXACT page order as provided - do not reorder sheet numbers based on numerical patterns
- IMPORTANT: Do NOT ignore legitimate sheet titles that contain words like "details", "sections", "typical", etc.

For each page, identify ONLY:
1. Sheet number (e.g., A0.01, A0.02, A1.01, A9.02, etc.) - use the EXACT sheet number found in the title block
2. Sheet name/description - capture the COMPLETE title from the drawing data field

Look specifically for text near these title block labels:
- "sheet number:" followed by the sheet number (use exactly as found)
- "drawing data:" followed by the COMPLETE sheet title (capture the full title, not just the first part)
- "drawing title:" followed by the COMPLETE sheet title
- "sheet name:" followed by the sheet name

IMPORTANT: 
- Do NOT reorder sheet numbers based on numerical patterns (A3.02 can come before A3.01 if it appears that way in the document set)
- Capture the COMPLETE drawing title from the "drawing data:" field, including all descriptive text
- Use the page order exactly as provided in the input

Common sheet number patterns:
- A0.01, A0.02, A1.01, A1.02, A9.02 (Architectural)
- S0.01, S0.02 (Structural) 
- M0.01, M0.02 (Mechanical)
- E0.01, E0.02 (Electrical)
- P0.01, P0.02 (Plumbing)
- Sheet numbers may be in formats not listed here; usually in easily identified patterns. 

Common sheet names:
- "Cover Sheet", "Title Sheet", "Index"
- "Ground Floor Plan", "First Floor Plan", "Second Floor Plan"
- "Roof Plan", "Elevations", "Exterior Elevations"
- "Enlarged Patio Trellis", "Details", "Schedules"
- "Specifications", "Wall Types", "Finishes"

IMPORTANT: 
- Do NOT use detail callout titles like "01 Patio Trellis - Enlarged Floor Plan" as the sheet name
- DO use legitimate sheet titles like "Typical Wall Details", "Section Details", "Enlarged Plans", etc.
- Look for the main sheet title in the title block, such as "Enlarged Patio Trellis" or "Typical Details"

EXAMPLE: If you see "drawing data: Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level", 
use the COMPLETE title "Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level", not just "Overall Reflected Ceiling Plans".`;
  };

  // Get the fixed JSON formatting section
  const getJsonFormatting = () => {
    return `Return your analysis as a JSON array with this exact format for the pages in this batch:
[
  {
    "pageNumber": 1,
    "sheetNumber": "A0.01",
    "sheetName": "Cover Sheet"
  },
  {
    "pageNumber": 2,
    "sheetNumber": "A9.02", 
    "sheetName": "Enlarged Patio Trellis"
  },
  {
    "pageNumber": 13,
    "sheetNumber": "A3.02",
    "sheetName": "Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level"
  },
  {
    "pageNumber": 14,
    "sheetNumber": "A3.01",
    "sheetName": "Overall Reflected Ceiling Plans - First & Second Level"
  }
]

If you cannot determine a sheet number or name for a page, use "Unknown" as the value. Be as accurate as possible based ONLY on the title block information.`;
  };

  // Get the default chat assistant prompt
  const getDefaultChatPrompt = () => {
    return `You are an AI assistant specialized in construction takeoff and project analysis. You help users understand their construction documents, measurements, and project requirements.

When answering questions:
- Be specific and reference actual data from the project when possible
- If you reference a document or page, mention the document name and page number
- Help users understand measurements, conditions, and project details
- If you don't have enough information, ask clarifying questions
- Be concise but thorough in your responses`;
  };

  // Save custom prompt to localStorage
  const saveCustomPrompt = async () => {
    try {
      setIsLoading(true);
      
      // Combine editable prompt with fixed JSON formatting
      const fullPrompt = customPrompt + '\n\n' + getJsonFormatting();
      
      // Save to localStorage
      localStorage.setItem('ai-page-labeling-prompt', fullPrompt);
      
      // Show success message
      alert('✅ AI prompt saved successfully!');
    } catch (error) {
      console.error('Error saving prompt:', error);
      alert('❌ Failed to save prompt');
    } finally {
      setIsLoading(false);
    }
  };

  // Load custom prompt from localStorage
  const loadCustomPrompt = () => {
    const saved = localStorage.getItem('ai-page-labeling-prompt');
    if (saved) {
      // Extract just the editable part (remove JSON formatting section)
      const jsonStart = saved.indexOf('Return your analysis as a JSON array');
      if (jsonStart !== -1) {
        setCustomPrompt(saved.substring(0, jsonStart).trim());
      } else {
        setCustomPrompt(saved);
      }
    } else {
      setCustomPrompt(getEditablePrompt());
    }
  };

  // Save chat prompt to localStorage
  const saveChatPrompt = async () => {
    try {
      setIsLoading(true);
      
      // Save to localStorage
      localStorage.setItem('ai-chat-assistant-prompt', chatPrompt);
      
      // Show success message
      alert('✅ Chat assistant prompt saved successfully!');
    } catch (error) {
      console.error('Error saving chat prompt:', error);
      alert('❌ Failed to save chat prompt');
    } finally {
      setIsLoading(false);
    }
  };

  // Load chat prompt from localStorage
  const loadChatPrompt = () => {
    const saved = localStorage.getItem('ai-chat-assistant-prompt');
    if (saved) {
      setChatPrompt(saved);
    } else {
      setChatPrompt(getDefaultChatPrompt());
    }
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
    if (activeTab === 'ai-prompt' && isUnlocked) {
      loadCustomPrompt();
      loadChatPrompt();
    }
  }, [activeTab, isUnlocked]);

  // Load user management data
  useEffect(() => {
    if (isUnlocked && activeTab === 'user-management') {
      loadUsers();
      loadInvitations();
    }
  }, [activeTab, isUnlocked]);

  const loadUsers = async () => {
    try {
      const userList = await authHelpers.getAllUsers();
      setUsers(userList);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadInvitations = async () => {
    try {
      const invitationList = await authHelpers.getAllInvitations();
      setInvitations(invitationList);
    } catch (error) {
      console.error('Error loading invitations:', error);
    }
  };

  const handleInviteUser = async () => {
    if (!inviteEmail.trim()) return;
    
    setIsInviting(true);
    try {
      await authHelpers.createInvitation(inviteEmail, inviteRole);
      setInviteEmail('');
      setInviteRole('user');
      await loadInvitations();
      alert('Invitation sent successfully!');
    } catch (error) {
      console.error('Error sending invitation:', error);
      alert('Failed to send invitation');
    } finally {
      setIsInviting(false);
    }
  };

  const handleDeleteInvitation = async (invitationId: string) => {
    if (!confirm('Are you sure you want to delete this invitation?')) return;
    
    try {
      await authHelpers.deleteInvitation(invitationId);
      await loadInvitations();
    } catch (error) {
      console.error('Error deleting invitation:', error);
      alert('Failed to delete invitation');
    }
  };

  const handleUpdateUserRole = async (userId: string, newRole: 'admin' | 'user') => {
    if (!confirm(`Are you sure you want to change this user's role to ${newRole}?`)) return;
    
    try {
      await authHelpers.updateUserRole(userId, newRole);
      await loadUsers();
    } catch (error) {
      console.error('Error updating user role:', error);
      alert('Failed to update user role');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This will permanently delete all their projects and data.')) return;
    
    try {
      await authHelpers.deleteUser(userId);
      await loadUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
      alert('Failed to delete user');
    }
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'ai-prompt', label: 'AI Prompt Editor', icon: Brain },
    { id: 'ai-settings', label: 'AI Settings', icon: Brain },
    { id: 'user-management', label: 'User Management', icon: Users }
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
                      Welcome to the Meridian Takeoff Admin Panel. Here you can manage AI prompts, 
                      model settings, and system configuration.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="border rounded-lg p-6 flex flex-col">
                      <div className="flex items-center gap-3 mb-4">
                        <Brain className="w-8 h-8 text-blue-600" />
                        <h3 className="text-lg font-semibold">AI Prompt Editor</h3>
                      </div>
                      <p className="text-gray-600 mb-4 flex-grow">
                        Customize AI prompts for page labeling and chat assistance to improve accuracy for different drawing sets and use cases.
                      </p>
                      <Button 
                        onClick={() => setActiveTab('ai-prompt')}
                        className="w-full"
                      >
                        <Brain className="w-4 h-4 mr-2" />
                        Edit AI Prompts
                      </Button>
                    </div>

                    <div className="border rounded-lg p-6 flex flex-col">
                      <div className="flex items-center gap-3 mb-4">
                        <Brain className="w-8 h-8 text-orange-600" />
                        <h3 className="text-lg font-semibold">AI Settings</h3>
                      </div>
                      <p className="text-gray-600 mb-4 flex-grow">
                        Configure AI models, response parameters, and performance settings for optimal chat and analysis performance.
                      </p>
                      <Button 
                        onClick={() => setActiveTab('ai-settings')}
                        className="w-full"
                      >
                        <Brain className="w-4 h-4 mr-2" />
                        AI Settings
                      </Button>
                    </div>

                  </div>

                  <div className="border rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
                    <div className="flex gap-4">
                      <Button 
                        size="sm"
                        onClick={async () => {
                          try {
                            const models = await ollamaService.getModels();
                            if (models && models.length > 0) {
                              alert(`✅ AI models loaded successfully! Found ${models.length} available models.`);
                            } else {
                              alert('⚠️ No AI models found. Please check your Ollama installation.');
                            }
                          } catch (error) {
                            alert('❌ Failed to connect to AI models. Check console for details.');
                            console.error('Model connection error:', error);
                          }
                        }}
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Test AI Models
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'ai-prompt' && (
                <div className="p-6">
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold">AI Prompt Editor</h2>
                  </div>
                  
                  <div className="space-y-6">
                    {/* Page Labeling Prompt */}
                    <div className="border rounded-lg p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">Page Labeling Prompt</h3>
                        <div className="flex gap-2">
                          <Button 
                            onClick={() => {
                              // Reset to default prompt
                              setCustomPrompt(getEditablePrompt());
                            }}
                            variant="outline"
                            size="sm"
                          >
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Reset to Default
                          </Button>
                          <Button 
                            onClick={saveCustomPrompt}
                            disabled={isLoading}
                            size="sm"
                          >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Save Prompt
                          </Button>
                        </div>
                      </div>
                      <p className="text-gray-600 mb-4">
                        Edit the AI prompt used for automatic page labeling. The JSON formatting section is fixed and cannot be modified.
                      </p>
                      
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="custom-prompt">Editable Prompt Instructions</Label>
                          <textarea
                            id="custom-prompt"
                            value={customPrompt}
                            onChange={(e) => setCustomPrompt(e.target.value)}
                            className="w-full h-80 p-3 border rounded-md font-mono text-sm"
                            placeholder="Enter your custom AI prompt instructions here..."
                          />
                        </div>
                        
                        <div>
                          <Label>JSON Formatting (Fixed)</Label>
                          <div className="w-full h-32 p-3 bg-gray-100 border rounded-md font-mono text-sm text-gray-600 overflow-auto">
                            {getJsonFormatting()}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Chat Assistant Prompt */}
                    <div className="border rounded-lg p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">Chat Assistant Prompt</h3>
                        <div className="flex gap-2">
                          <Button 
                            onClick={() => {
                              // Reset to default chat prompt
                              setChatPrompt(getDefaultChatPrompt());
                            }}
                            variant="outline"
                            size="sm"
                          >
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Reset to Default
                          </Button>
                          <Button 
                            onClick={saveChatPrompt}
                            disabled={isLoading}
                            size="sm"
                          >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Save Prompt
                          </Button>
                        </div>
                      </div>
                      <p className="text-gray-600 mb-4">
                        Edit the system prompt used for the AI chat assistant in the chat tab.
                      </p>
                      
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="chat-prompt">Construction Takeoff Assistant Prompt</Label>
                          <textarea 
                            id="chat-prompt"
                            value={chatPrompt}
                            onChange={(e) => setChatPrompt(e.target.value)}
                            className="w-full h-32 p-3 border rounded-md resize-none"
                            placeholder="You are an AI assistant specialized in construction takeoff and project analysis..."
                          />
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="font-medium text-blue-800 mb-2">ℹ️ How it works:</h4>
                      <ul className="text-sm text-blue-700 space-y-1">
                        <li>• <strong>Page Labeling Prompt:</strong> Used for automatic sheet number and name extraction from documents</li>
                        <li>• <strong>Chat Assistant Prompt:</strong> Used for AI responses in the chat tab</li>
                        <li>• The JSON formatting for page labeling is automatically appended and cannot be changed</li>
                        <li>• Test changes on a small document first</li>
                      </ul>
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

              {activeTab === 'user-management' && (
                <div className="p-6">
                  <h2 className="text-2xl font-bold mb-6">User Management</h2>
                  
                  <div className="space-y-8">
                    {/* Invite User Section */}
                    <div className="border rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <UserPlus className="w-5 h-5" />
                        Invite New User
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <Label htmlFor="invite-email">Email Address</Label>
                          <Input
                            id="invite-email"
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="user@example.com"
                          />
                        </div>
                        <div>
                          <Label htmlFor="invite-role">Role</Label>
                          <select
                            id="invite-role"
                            className="w-full p-2 border rounded-md"
                            value={inviteRole}
                            onChange={(e) => setInviteRole(e.target.value as 'admin' | 'user')}
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                        <div className="flex items-end">
                          <Button
                            onClick={handleInviteUser}
                            disabled={isInviting || !inviteEmail.trim()}
                            className="w-full"
                          >
                            <Mail className="w-4 h-4 mr-2" />
                            {isInviting ? 'Sending...' : 'Send Invitation'}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Pending Invitations */}
                    <div className="border rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <Mail className="w-5 h-5" />
                        Pending Invitations ({invitations.filter(inv => inv.status === 'pending').length})
                      </h3>
                      {invitations.filter(inv => inv.status === 'pending').length === 0 ? (
                        <p className="text-gray-500">No pending invitations</p>
                      ) : (
                        <div className="space-y-2">
                          {invitations
                            .filter(inv => inv.status === 'pending')
                            .map((invitation) => (
                              <div key={invitation.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div>
                                  <p className="font-medium">{invitation.email}</p>
                                  <p className="text-sm text-gray-600">
                                    Role: {invitation.role} • 
                                    Expires: {new Date(invitation.expires_at).toLocaleDateString()}
                                  </p>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDeleteInvitation(invitation.id)}
                                  className="text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    {/* Active Users */}
                    <div className="border rounded-lg p-6">
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <Users className="w-5 h-5" />
                        Active Users ({users.length})
                      </h3>
                      {users.length === 0 ? (
                        <p className="text-gray-500">No users found</p>
                      ) : (
                        <div className="space-y-2">
                          {users.map((user) => (
                            <div key={user.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                              <div>
                                <p className="font-medium">{user.full_name || 'No name'}</p>
                                <p className="text-sm text-gray-600">
                                  Role: {user.role} • 
                                  Joined: {new Date(user.created_at).toLocaleDateString()}
                                  {user.company && ` • ${user.company}`}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <select
                                  value={user.role}
                                  onChange={(e) => handleUpdateUserRole(user.id, e.target.value as 'admin' | 'user')}
                                  className="text-sm border rounded px-2 py-1"
                                >
                                  <option value="user">User</option>
                                  <option value="admin">Admin</option>
                                </select>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDeleteUser(user.id)}
                                  className="text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
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

    </Dialog>
  );
}
