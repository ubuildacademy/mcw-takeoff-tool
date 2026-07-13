import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import {
  RefreshCw,
  Settings,
  Brain,
  BookOpen,
  CheckCircle,
  Users,
  UserPlus,
  Trash2,
  Mail,
  Database,
  Loader2,
  RotateCcw,
  Send,
  KeyRound,
  BarChart3,
} from 'lucide-react';
import { toast } from 'sonner';
import { ollamaService, type OllamaModel } from '../services/ollamaService';
import { authHelpers, supabase, UserMetadata, UserInvitation } from '../lib/supabase';
import { settingsService, usageService, type AiTokenUsageSummary } from '../services/apiService';
import { extractErrorMessage } from '../utils/commonUtils';
import { AdminHelpFaqTab } from './help/AdminHelpFaqTab';
import { CHAT_PRESET_CONFIGS, CHAT_PRESET_SETTING_KEY } from '../constants/chatPresets';
import { knowledgeBaseService } from '../services/knowledgeBaseService';
import { KB_CHAR_BUDGET } from '../constants/chatPresets';
import { cn } from '@/lib/utils';

// Fallback when /api/ollama/models fails (https://ollama.com/search?c=cloud)
const FALLBACK_OLLAMA_MODELS: OllamaModel[] = [
  { name: 'gpt-oss:120b', size: 0, digest: '', modified_at: '' },
  { name: 'gpt-oss:20b', size: 0, digest: '', modified_at: '' },
  { name: 'deepseek-v3.1:671b', size: 0, digest: '', modified_at: '' },
  { name: 'qwen3-coder:480b', size: 0, digest: '', modified_at: '' },
];

const adminPanelSection = 'border border-border rounded-lg bg-card p-6 shadow-sm';
const adminNestedSection = 'border border-border rounded-lg bg-background/45 p-4';
const adminMutedText = 'text-muted-foreground';
const adminHelpText = 'text-sm text-muted-foreground';
const adminTextArea =
  'w-full rounded-md border border-input bg-background p-3 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const adminSelect =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const adminListRow =
  'flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 p-3';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

export function AdminPanel({ isOpen, onClose, projectId: _projectId }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<
    'ai-prompt' | 'ai-settings' | 'user-management' | 'help-faq' | 'knowledge-base' | 'usage'
  >('user-management');
  // AI token usage (provider-decision data)
  const [usage, setUsage] = useState<AiTokenUsageSummary | null>(null);
  const [usageDays, setUsageDays] = useState(30);
  const [usageLoading, setUsageLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('gpt-oss:120b');
  const [fallbackModel, setFallbackModel] = useState<string>('gpt-oss:20b');
  // Titleblock extraction prompts (separate for sheet number and sheet name)
  const [sheetNumberPrompt, setSheetNumberPrompt] = useState<string>('');
  const [sheetNamePrompt, setSheetNamePrompt] = useState<string>('');
  const [chatPrompt, setChatPrompt] = useState<string>('');
  // Chat preset prompts — keyed by preset id, loaded from server
  const [presetPromptDrafts, setPresetPromptDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(CHAT_PRESET_CONFIGS.map((p) => [p.id, p.defaultPrompt]))
  );

  // Knowledge base wiki-editor state
  const kbPresets = CHAT_PRESET_CONFIGS.filter((p) => p.usesKnowledgeBase);
  const [kbPresetId, setKbPresetId] = useState<string>(kbPresets[0]?.id ?? '');
  const [kbDraft, setKbDraft] = useState<string>('');
  const [kbLoading, setKbLoading] = useState(false);
  const [kbSaving, setKbSaving] = useState(false);
  
  // User management state
  const [users, setUsers] = useState<UserMetadata[]>([]);
  const [invitations, setInvitations] = useState<UserInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user');
  const [isInviting, setIsInviting] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resettingPasswordId, setResettingPasswordId] = useState<string | null>(null);

  // Get default prompt for sheet number extraction
  const getDefaultSheetNumberPrompt = () => {
    return `You are an expert at extracting sheet numbers from construction document titleblocks.

Your task is to extract the sheet number from the provided text region. The text was extracted from a specific region of the titleblock that should contain the sheet number.

INSTRUCTIONS:
- Look for alphanumeric codes like "A4.21", "A0.01", "S0.02", "M1.15", etc.
- Common patterns: Letter(s) followed by numbers, often with dots (e.g., A4.21, S0.02)
- May appear with labels like "sheet number:", "sheet #:", "dwg no:", or standalone
- Fix minor OCR errors (O→0, I→1, l→1, etc.)
- Return ONLY the sheet number, nothing else
- If you cannot find a sheet number, return "Unknown"

Examples:
- "sheet number: A4.21" → "A4.21"
- "A4.2l" (OCR error) → "A4.21"
- "Sheet # S0.02" → "S0.02"
- "DWG NO: M1.15" → "M1.15"
- Empty or unclear text → "Unknown"`;
  };

  // Get default prompt for sheet name extraction
  const getDefaultSheetNamePrompt = () => {
    return `You are an expert at extracting sheet names/titles from construction document titleblocks.

Your task is to extract the sheet name from the provided text region. The text was extracted from a specific region of the titleblock that should contain the sheet name/title.

INSTRUCTIONS:
- Look for drawing titles, names, or descriptions
- May appear with labels like "drawing data:", "drawing title:", "sheet title:", "sheet name:", or standalone
- Capture the COMPLETE title, including all descriptive text
- Sheet names can span multiple lines - capture everything until you hit another label or empty line
- Fix minor OCR errors (O→0, I→1, l→1, etc.)
- Return ONLY the sheet name, nothing else
- Do NOT include the label itself (e.g., don't include "drawing data:" in the result)
- If you cannot find a sheet name, return "Unknown"

Examples:
- "drawing data: Enlarged Floor Plan - Ground Floor - East Side" → "Enlarged Floor Plan - Ground Floor - East Side"
- "drawing title: Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level" → "Overall Reflected Ceiling Plans - Third thru Sixth & Int. Roof Level"
- "sheet name: Cover Sheet" → "Cover Sheet"
- "Floor Plan\nGround Level" (multi-line) → "Floor Plan Ground Level"
- Empty or unclear text → "Unknown"`;
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

  // Save sheet number prompt to API (with localStorage fallback)
  const saveSheetNumberPrompt = async () => {
    try {
      setIsLoading(true);
      const hasSession = await ensureSession();
      if (hasSession) {
        try {
          await settingsService.updateSetting('titleblock-sheet-number-prompt', sheetNumberPrompt);
        } catch (apiError: unknown) {
          const status = (apiError as { response?: { status?: number } })?.response?.status;
          if (status !== 401 && status !== 403 && import.meta.env.DEV) {
            console.warn('Failed to save to API, using localStorage fallback:', apiError);
          }
          localStorage.setItem('titleblock-sheet-number-prompt', sheetNumberPrompt);
        }
      } else {
        localStorage.setItem('titleblock-sheet-number-prompt', sheetNumberPrompt);
      }
      
      // Also save to localStorage as backup
      localStorage.setItem('titleblock-sheet-number-prompt', sheetNumberPrompt);
      
      // Show success message
      toast.success('Sheet number prompt saved successfully!');
    } catch (error) {
      console.error('Error saving sheet number prompt:', error);
      toast.error(extractErrorMessage(error, 'Failed to save sheet number prompt'));
    } finally {
      setIsLoading(false);
    }
  };

  // Save sheet name prompt to API (with localStorage fallback)
  const saveSheetNamePrompt = async () => {
    try {
      setIsLoading(true);
      const hasSession = await ensureSession();
      if (hasSession) {
        try {
          await settingsService.updateSetting('titleblock-sheet-name-prompt', sheetNamePrompt);
        } catch (apiError: unknown) {
          const status = (apiError as { response?: { status?: number } })?.response?.status;
          if (status !== 401 && status !== 403 && import.meta.env.DEV) {
            console.warn('Failed to save to API, using localStorage fallback:', apiError);
          }
          localStorage.setItem('titleblock-sheet-name-prompt', sheetNamePrompt);
        }
      } else {
        localStorage.setItem('titleblock-sheet-name-prompt', sheetNamePrompt);
      }
      
      // Also save to localStorage as backup
      localStorage.setItem('titleblock-sheet-name-prompt', sheetNamePrompt);
      
      // Show success message
      toast.success('Sheet name prompt saved successfully!');
    } catch (error) {
      console.error('Error saving sheet name prompt:', error);
      toast.error(extractErrorMessage(error, 'Failed to save sheet name prompt'));
    } finally {
      setIsLoading(false);
    }
  };

  // Ensure we have a valid session before calling settings API (avoids 401 when session not ready)
  const ensureSession = async (): Promise<boolean> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) return true;
    await supabase.auth.refreshSession();
    const next = await supabase.auth.getSession();
    return !!next.data.session?.access_token;
  };

  // Load all AI prompts from API (one request) when we have a session, else from localStorage
  const loadSheetNumberPrompt = async () => {
    try {
      const hasSession = await ensureSession();
      if (hasSession) {
        try {
          const response = await settingsService.getSetting('titleblock-sheet-number-prompt');
          if (response?.value) {
            setSheetNumberPrompt(response.value);
            return;
          }
        } catch (apiError: unknown) {
          const err = apiError as { response?: { status?: number }; isExpected404?: boolean };
          const status = err?.response?.status;
          const isExpected404 = err?.isExpected404;
          if (status !== 401 && status !== 403 && !isExpected404 && import.meta.env.DEV) {
            console.warn('Failed to load sheet number prompt from API, using localStorage:', apiError);
          }
        }
      }
      const saved = localStorage.getItem('titleblock-sheet-number-prompt');
      setSheetNumberPrompt(saved || getDefaultSheetNumberPrompt());
    } catch (error) {
      console.error('Error loading prompt:', error);
      setSheetNumberPrompt(getDefaultSheetNumberPrompt());
    }
  };

  const loadSheetNamePrompt = async () => {
    try {
      const hasSession = await ensureSession();
      if (hasSession) {
        try {
          const response = await settingsService.getSetting('titleblock-sheet-name-prompt');
          if (response?.value) {
            setSheetNamePrompt(response.value);
            return;
          }
        } catch (apiError: unknown) {
          const err = apiError as { response?: { status?: number }; isExpected404?: boolean };
          const status = err?.response?.status;
          const isExpected404 = err?.isExpected404;
          if (status !== 401 && status !== 403 && !isExpected404 && import.meta.env.DEV) {
            console.warn('Failed to load sheet name prompt from API, using localStorage:', apiError);
          }
        }
      }
      const saved = localStorage.getItem('titleblock-sheet-name-prompt');
      setSheetNamePrompt(saved || getDefaultSheetNamePrompt());
    } catch (error) {
      console.error('Error loading prompt:', error);
      setSheetNamePrompt(getDefaultSheetNamePrompt());
    }
  };

  // Save chat prompt to API (with localStorage fallback)
  const saveChatPrompt = async () => {
    try {
      setIsLoading(true);
      const hasSession = await ensureSession();
      if (hasSession) {
        try {
          await settingsService.updateSetting('ai-chat-assistant-prompt', chatPrompt);
        } catch (apiError: unknown) {
          const status = (apiError as { response?: { status?: number } })?.response?.status;
          if (status !== 401 && status !== 403 && import.meta.env.DEV) {
            console.warn('Failed to save to API, using localStorage fallback:', apiError);
          }
        }
      }
      localStorage.setItem('ai-chat-assistant-prompt', chatPrompt);
      toast.success('Chat assistant prompt saved successfully!');
    } catch (error) {
      console.error('Error saving chat prompt:', error);
      toast.error(extractErrorMessage(error, 'Failed to save chat prompt'));
    } finally {
      setIsLoading(false);
    }
  };

  const loadChatPrompt = async () => {
    try {
      const hasSession = await ensureSession();
      if (hasSession) {
        try {
          const response = await settingsService.getSetting('ai-chat-assistant-prompt');
          if (response?.value) {
            setChatPrompt(response.value);
            return;
          }
        } catch (apiError: unknown) {
          const err = apiError as { response?: { status?: number }; isExpected404?: boolean };
          const status = err?.response?.status;
          const isExpected404 = err?.isExpected404;
          if (status !== 401 && status !== 403 && !isExpected404 && import.meta.env.DEV) {
            console.warn('Failed to load chat prompt from API, using localStorage:', apiError);
          }
        }
      }
      const saved = localStorage.getItem('ai-chat-assistant-prompt');
      setChatPrompt(saved || getDefaultChatPrompt());
    } catch (error) {
      console.error('Error loading chat prompt:', error);
      setChatPrompt(getDefaultChatPrompt());
    }
  };

  // Load preset prompts from settings (one request per preset)
  const loadPresetPrompts = async () => {
    const drafts: Record<string, string> = {};
    await Promise.all(
      CHAT_PRESET_CONFIGS.map(async (preset) => {
        try {
          const res = await settingsService.getSetting(CHAT_PRESET_SETTING_KEY(preset.id));
          drafts[preset.id] = res?.value ?? preset.defaultPrompt;
        } catch {
          drafts[preset.id] = preset.defaultPrompt;
        }
      })
    );
    setPresetPromptDrafts(drafts);
  };

  const savePresetPrompt = async (presetId: string) => {
    try {
      setIsLoading(true);
      const value = presetPromptDrafts[presetId] ?? '';
      const hasSession = await ensureSession();
      if (hasSession) {
        await settingsService.updateSetting(CHAT_PRESET_SETTING_KEY(presetId), value);
      }
      localStorage.setItem(CHAT_PRESET_SETTING_KEY(presetId), value);
      toast.success('Preset prompt saved!');
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to save preset prompt'));
    } finally {
      setIsLoading(false);
    }
  };

  const loadKbContent = async (presetId?: string) => {
    const id = presetId ?? kbPresetId;
    if (!id) return;
    setKbLoading(true);
    try {
      const content = await knowledgeBaseService.getContent(id);
      setKbDraft(content);
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to load knowledge base'));
    } finally {
      setKbLoading(false);
    }
  };

  const handleKbPresetChange = (presetId: string) => {
    setKbPresetId(presetId);
    setKbDraft('');
    loadKbContent(presetId);
  };

  const handleKbSave = async () => {
    if (!kbPresetId) return;
    setKbSaving(true);
    try {
      await knowledgeBaseService.saveContent(kbPresetId, kbDraft);
      toast.success('Knowledge base saved');
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to save knowledge base'));
    } finally {
      setKbSaving(false);
    }
  };

  const handleKbResetToDefault = () => {
    if (!confirm('Reset to built-in default content? Any custom edits will be lost.')) return;
    const defaultContent = knowledgeBaseService.getDefaultContent(kbPresetId);
    setKbDraft(defaultContent);
  };

  // Load available models and saved settings when AI settings tab is opened
  const loadAvailableModels = async () => {
    try {
      const hasSession = await ensureSession();

      try {
        const models = await ollamaService.getModels();
        // Defensive: only show cloud-offering list (server already requests ?c=cloud).
        const cloudModels = (models || []).filter((m) => m && typeof m.name === 'string' && m.name.trim().length > 0);
        setAvailableModels(cloudModels.length > 0 ? cloudModels : FALLBACK_OLLAMA_MODELS);
      } catch {
        setAvailableModels(FALLBACK_OLLAMA_MODELS);
      }

      const normalizeLegacyModelName = (name: string | null): string | null => {
        if (!name) return null;
        // Older configs used a "-cloud" suffix; Ollama cloud model ids no longer use that.
        return name.endsWith('-cloud') ? name.replace(/-cloud$/, '') : name;
      };

      if (hasSession) {
        try {
          const settings = await settingsService.getSettings();
          if (settings?.settings) {
            if (settings.settings['ai-selected-model']) {
              const normalized = normalizeLegacyModelName(settings.settings['ai-selected-model']);
              if (normalized) {
                setSelectedModel(normalized);
                ollamaService.setDefaultModel(normalized);
              }
            }
            if (settings.settings['ai-fallback-model']) {
              const normalized = normalizeLegacyModelName(settings.settings['ai-fallback-model']);
              if (normalized) setFallbackModel(normalized);
            }
            return;
          }
        } catch (apiError: unknown) {
          const status = (apiError as { response?: { status?: number } })?.response?.status;
          if (status !== 401 && status !== 403 && import.meta.env.DEV) {
            console.warn('Failed to load settings from API, using localStorage:', apiError);
          }
        }
      }
      
      // Fallback to localStorage
      const savedModel = normalizeLegacyModelName(localStorage.getItem('ai-selected-model'));
      const savedFallback = normalizeLegacyModelName(localStorage.getItem('ai-fallback-model'));
      
      if (savedModel) {
        setSelectedModel(savedModel);
        ollamaService.setDefaultModel(savedModel);
      } else {
        const currentDefault = ollamaService.getDefaultModel();
        setSelectedModel(normalizeLegacyModelName(currentDefault) ?? currentDefault);
      }
      
      if (savedFallback) {
        setFallbackModel(savedFallback);
      }
    } catch (error) {
      const err = error as { message?: string; status?: number };
      const is401 = err?.message?.includes('Unauthorized') ?? false;
      if (!is401 && import.meta.env.DEV) {
        console.error('Failed to load models:', error);
      }
    }
  };

  // Load models when AI settings tab becomes active
  useEffect(() => {
    if (isOpen && activeTab === 'ai-settings') {
      loadAvailableModels();
    }
    if (isOpen && activeTab === 'ai-prompt') {
      loadSheetNumberPrompt();
      loadSheetNamePrompt();
      loadChatPrompt();
      loadPresetPrompts();
    }
    if (isOpen && activeTab === 'knowledge-base') {
      loadKbContent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isOpen]);


  // Load user management data
  useEffect(() => {
    if (isOpen && activeTab === 'user-management') {
      loadUsers();
      loadInvitations();
    }
  }, [activeTab, isOpen]);

  const loadUsage = async (days: number) => {
    setUsageLoading(true);
    try {
      setUsage(await usageService.getTokenUsage(days));
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to load token usage'));
    } finally {
      setUsageLoading(false);
    }
  };

  // Load token usage when the Usage tab (or its window) changes
  useEffect(() => {
    if (isOpen && activeTab === 'usage') {
      loadUsage(usageDays);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isOpen, usageDays]);

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
      const result = await authHelpers.createInvitation(inviteEmail, inviteRole);
      setInviteEmail('');
      setInviteRole('user');
      await loadInvitations();
      
      // Check if email was actually sent
      if (result?.email_sent) {
        toast.success('Invitation created and email sent successfully!');
      } else {
        toast.warning(`Invitation created, but email was not sent. Check server logs for details. Invitation URL: ${result?.invite_url || 'N/A'}`);
      }
    } catch (error: unknown) {
      console.error('Error sending invitation:', error);
      toast.error(`Failed to create invitation: ${extractErrorMessage(error, 'Failed to send invitation')}`);
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
      toast.error(extractErrorMessage(error, 'Failed to delete invitation'));
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    setResendingId(invitationId);
    try {
      const result = await authHelpers.resendInvitation(invitationId);
      await loadInvitations();
      if (result?.email_sent) {
        toast.success('Invitation resent successfully!');
      } else {
        toast.warning('Invitation expiry extended, but email could not be sent. Check server logs.');
      }
    } catch (error) {
      console.error('Error resending invitation:', error);
      toast.error(extractErrorMessage(error, 'Failed to resend invitation'));
    } finally {
      setResendingId(null);
    }
  };

  const handleResetPassword = async (userId: string, userEmail?: string) => {
    const label = userEmail || 'this user';
    if (!confirm(`Send a password reset email to ${label}?`)) return;
    setResettingPasswordId(userId);
    try {
      const result = await authHelpers.resetUserPassword(userId);
      if (result?.email_sent) {
        toast.success(`Password reset email sent to ${label}`);
      } else {
        toast.warning('Reset link generated but email could not be sent. Check server logs.');
      }
    } catch (error) {
      console.error('Error sending password reset:', error);
      toast.error(extractErrorMessage(error, 'Failed to send password reset'));
    } finally {
      setResettingPasswordId(null);
    }
  };

  const handleUpdateUserRole = async (userId: string, newRole: 'admin' | 'user') => {
    if (!confirm(`Are you sure you want to change this user's role to ${newRole}?`)) return;
    
    try {
      await authHelpers.updateUserRole(userId, newRole);
      await loadUsers();
      toast.success(`User role updated to ${newRole} successfully!`);
    } catch (error) {
      console.error('Error updating user role:', error);
      toast.error(extractErrorMessage(error, 'Failed to update user role'));
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This will permanently delete all their projects and data.')) return;
    
    try {
      await authHelpers.deleteUser(userId);
      await loadUsers();
      toast.success('User deleted successfully!');
    } catch (error) {
      console.error('Error deleting user:', error);
      toast.error(extractErrorMessage(error, 'Failed to delete user'));
    }
  };

  const tabs = [
    { id: 'user-management', label: 'User Management', icon: Users },
    { id: 'knowledge-base', label: 'Knowledge Base', icon: Database },
    { id: 'help-faq', label: 'Help & FAQ', icon: BookOpen },
    { id: 'ai-prompt', label: 'AI Prompt Editor', icon: Brain },
    { id: 'ai-settings', label: 'AI Settings', icon: Brain },
    { id: 'usage', label: 'AI Usage', icon: BarChart3 },
  ];

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] h-[95vh] max-w-none max-h-none overflow-hidden flex flex-col bg-background text-foreground" aria-describedby="admin-panel-description">
        <DialogDescription id="admin-panel-description" className="sr-only">
          System administration: AI prompts, model settings, and user management.
        </DialogDescription>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Admin Panel
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex min-h-0 overflow-hidden rounded-lg border border-border">
          {/* Sidebar */}
          <div className="w-64 border-r border-border bg-card flex flex-col">
            <div className="p-4 border-b border-border">
              <h3 className="font-medium">Admin Tools</h3>
            </div>
              
              <div className="flex-1 p-2">
                <nav className="space-y-1">
                  {tabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as typeof activeTab)}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors',
                          activeTab === tab.id
                            ? 'bg-primary/12 text-primary'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                        )}
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
            <div className="flex-1 overflow-y-auto bg-background">
              {activeTab === 'help-faq' && <AdminHelpFaqTab />}

              {activeTab === 'usage' && (
                <div className="p-6 space-y-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h2 className="text-2xl font-bold flex items-center gap-2">
                        <BarChart3 className="w-6 h-6" />
                        AI Token Usage
                      </h2>
                      <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                        Real token consumption from the chat, straight from Ollama's per-request
                        counts. Data to pick the cheapest provider (Ollama Cloud vs OpenRouter vs
                        direct) once beta usage is clear — not a guess.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={usageDays}
                        onChange={(e) => setUsageDays(Number(e.target.value))}
                        className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                      >
                        <option value={7}>Last 7 days</option>
                        <option value={30}>Last 30 days</option>
                        <option value={90}>Last 90 days</option>
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => loadUsage(usageDays)}
                        disabled={usageLoading}
                      >
                        {usageLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {usageLoading && !usage ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading usage…
                    </div>
                  ) : !usage || usage.totals.requests === 0 ? (
                    <div className={adminPanelSection}>
                      <p className="text-sm text-muted-foreground">
                        No chat activity recorded in this window yet. Once testers use the chat,
                        totals appear here.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Totals */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { l: 'Total tokens', v: usage.totals.totalTokens },
                          { l: 'Prompt tokens', v: usage.totals.promptTokens },
                          { l: 'Completion tokens', v: usage.totals.completionTokens },
                          { l: 'Requests', v: usage.totals.requests },
                        ].map((s) => (
                          <div key={s.l} className={adminNestedSection}>
                            <div className="text-2xl font-semibold tabular-nums">
                              {s.v.toLocaleString()}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">{s.l}</div>
                          </div>
                        ))}
                      </div>

                      {/* By model */}
                      <div className={adminPanelSection}>
                        <h3 className="font-medium mb-3">By model</h3>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-muted-foreground border-b border-border">
                              <th className="py-2 font-medium">Model</th>
                              <th className="py-2 font-medium text-right">Total tokens</th>
                              <th className="py-2 font-medium text-right">Requests</th>
                              <th className="py-2 font-medium text-right">Avg / req</th>
                            </tr>
                          </thead>
                          <tbody>
                            {usage.byModel.map((m) => (
                              <tr key={m.model} className="border-b border-border/50">
                                <td className="py-2 font-mono text-xs">{m.model}</td>
                                <td className="py-2 text-right tabular-nums">
                                  {m.totalTokens.toLocaleString()}
                                </td>
                                <td className="py-2 text-right tabular-nums">{m.requests}</td>
                                <td className="py-2 text-right tabular-nums">
                                  {Math.round(m.totalTokens / Math.max(1, m.requests)).toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* By day */}
                      <div className={adminPanelSection}>
                        <h3 className="font-medium mb-3">By day</h3>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-muted-foreground border-b border-border">
                              <th className="py-2 font-medium">Day</th>
                              <th className="py-2 font-medium text-right">Total tokens</th>
                              <th className="py-2 font-medium text-right">Requests</th>
                            </tr>
                          </thead>
                          <tbody>
                            {usage.byDay.map((d) => (
                              <tr key={d.day} className="border-b border-border/50">
                                <td className="py-2 font-mono text-xs">{d.day}</td>
                                <td className="py-2 text-right tabular-nums">
                                  {d.totalTokens.toLocaleString()}
                                </td>
                                <td className="py-2 text-right tabular-nums">{d.requests}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'knowledge-base' && (
                <div className="flex flex-col h-full">
                  {/* KB header bar */}
                  <div className="p-6 pb-4 border-b border-border shrink-0">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                          <Database className="w-6 h-6" />
                          Knowledge Base
                        </h2>
                        <p className={`${adminMutedText} mt-1 text-sm max-w-xl`}>
                          Per-trade wiki injected as AI context. Users never see this — the model reads it automatically when the matching mode is selected.
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleKbResetToDefault}
                          disabled={kbLoading || kbSaving}
                        >
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Reset to Default
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleKbSave}
                          disabled={kbLoading || kbSaving}
                        >
                          {kbSaving ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <CheckCircle className="w-4 h-4 mr-2" />
                          )}
                          {kbSaving ? 'Saving...' : 'Save'}
                        </Button>
                      </div>
                    </div>

                    {/* Trade / preset selector */}
                    {kbPresets.length > 1 && (
                      <div className="flex items-center gap-3 mt-4">
                        <span className="text-sm text-muted-foreground shrink-0">Trade:</span>
                        <div className="flex gap-2">
                          {kbPresets.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => handleKbPresetChange(p.id)}
                              className={cn(
                                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                                kbPresetId === p.id
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                              )}
                            >
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Character budget indicator */}
                    {!kbLoading && kbDraft && (() => {
                      const pct = Math.min(100, Math.round((kbDraft.length / KB_CHAR_BUDGET) * 100));
                      const over = kbDraft.length > KB_CHAR_BUDGET;
                      const barColor = over
                        ? 'bg-red-500'
                        : pct > 80
                        ? 'bg-yellow-500'
                        : 'bg-green-500';
                      return (
                        <div className="mt-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-muted-foreground">Context budget</span>
                            <span className={`text-xs font-mono ${over ? 'text-red-500' : 'text-muted-foreground'}`}>
                              {kbDraft.length.toLocaleString()} / {KB_CHAR_BUDGET.toLocaleString()} chars
                              {over ? ' — content will be truncated' : ''}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${barColor}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Wiki editor — fills remaining height */}
                  <div className="flex-1 min-h-0 p-6 pt-4">
                    {kbLoading ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                        <Loader2 className="w-6 h-6 animate-spin" />
                        <span className="text-sm">Loading knowledge base…</span>
                      </div>
                    ) : (
                      <textarea
                        value={kbDraft}
                        onChange={(e) => setKbDraft(e.target.value)}
                        className="w-full h-full rounded-lg border border-input bg-background p-4 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none leading-relaxed"
                        placeholder={`Write your ${kbPresets.find(p => p.id === kbPresetId)?.name ?? 'trade'} knowledge base here.\n\nUse plain text with section headers (e.g., === SECTION NAME ===) to organize content.\nThe AI will reference this automatically when answering technical questions in this mode.`}
                        spellCheck={false}
                      />
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'ai-prompt' && (
                <div className="p-6">
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold">AI Prompt Editor</h2>
                  </div>
                  
                  <div className="space-y-6">
                    {/* Titleblock Extraction Prompts */}
                    <div className={adminPanelSection}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">Titleblock Extraction Prompts</h3>
                      </div>
                      <p className={`${adminMutedText} mb-4`}>
                        Edit the AI prompts used for titleblock extraction. Each region (sheet number and sheet name) has its own prompt that the LLM uses to extract values from the OCR text.
                      </p>
                      
                      <div className="space-y-6">
                        {/* Sheet Number Prompt */}
                        <div className={adminNestedSection}>
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="text-md font-semibold">Sheet Number Extraction Prompt</h4>
                            <div className="flex gap-2">
                              <Button 
                                onClick={() => {
                                  setSheetNumberPrompt(getDefaultSheetNumberPrompt());
                                }}
                                variant="outline"
                                size="sm"
                              >
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Reset to Default
                              </Button>
                              <Button 
                                onClick={saveSheetNumberPrompt}
                                disabled={isLoading}
                                size="sm"
                              >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Save
                              </Button>
                            </div>
                          </div>
                          <p className={`${adminHelpText} mb-2`}>
                            This prompt is used to extract sheet numbers from the sheet number region of the titleblock.
                          </p>
                          <textarea
                            id="sheet-number-prompt"
                            value={sheetNumberPrompt}
                            onChange={(e) => setSheetNumberPrompt(e.target.value)}
                            className={`${adminTextArea} h-64 font-mono text-sm`}
                            placeholder="Enter prompt for sheet number extraction..."
                          />
                        </div>

                        {/* Sheet Name Prompt */}
                        <div className={adminNestedSection}>
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="text-md font-semibold">Sheet Name Extraction Prompt</h4>
                            <div className="flex gap-2">
                              <Button 
                                onClick={() => {
                                  setSheetNamePrompt(getDefaultSheetNamePrompt());
                                }}
                                variant="outline"
                                size="sm"
                              >
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Reset to Default
                              </Button>
                              <Button 
                                onClick={saveSheetNamePrompt}
                                disabled={isLoading}
                                size="sm"
                              >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Save
                              </Button>
                            </div>
                          </div>
                          <p className={`${adminHelpText} mb-2`}>
                            This prompt is used to extract sheet names/titles from the sheet name region of the titleblock.
                          </p>
                          <textarea
                            id="sheet-name-prompt"
                            value={sheetNamePrompt}
                            onChange={(e) => setSheetNamePrompt(e.target.value)}
                            className={`${adminTextArea} h-64 font-mono text-sm`}
                            placeholder="Enter prompt for sheet name extraction..."
                          />
                        </div>
                      </div>
                    </div>

                    {/* Chat Assistant Prompt */}
                    <div className={adminPanelSection}>
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
                      <p className={`${adminMutedText} mb-4`}>
                        Edit the system prompt used for the AI chat assistant in the chat tab.
                      </p>
                      
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="chat-prompt">Construction Takeoff Assistant Prompt</Label>
                          <textarea 
                            id="chat-prompt"
                            name="chat-prompt"
                            value={chatPrompt}
                            onChange={(e) => setChatPrompt(e.target.value)}
                            className={`${adminTextArea} h-32 resize-none`}
                            placeholder="You are an AI assistant specialized in construction takeoff and project analysis..."
                          />
                        </div>
                      </div>
                    </div>
                    
                    {/* Chat Presets */}
                    <div className={adminPanelSection}>
                      <div className="mb-4">
                        <h3 className="text-lg font-semibold">Chat Presets</h3>
                        <p className={`${adminMutedText} mt-1 text-sm`}>
                          System prompts for each AI chat mode. Users select a preset by name — they cannot see or edit these prompts.
                        </p>
                      </div>

                      <div className="space-y-6">
                        {CHAT_PRESET_CONFIGS.map((preset) => (
                          <div key={preset.id} className={adminNestedSection}>
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="text-md font-semibold">{preset.name}</h4>
                              <div className="flex gap-2">
                                <Button
                                  onClick={() =>
                                    setPresetPromptDrafts((prev) => ({
                                      ...prev,
                                      [preset.id]: preset.defaultPrompt,
                                    }))
                                  }
                                  variant="outline"
                                  size="sm"
                                >
                                  <RefreshCw className="w-4 h-4 mr-2" />
                                  Reset to Default
                                </Button>
                                <Button
                                  onClick={() => savePresetPrompt(preset.id)}
                                  disabled={isLoading}
                                  size="sm"
                                >
                                  <CheckCircle className="w-4 h-4 mr-2" />
                                  Save
                                </Button>
                              </div>
                            </div>
                            <textarea
                              value={presetPromptDrafts[preset.id] ?? preset.defaultPrompt}
                              onChange={(e) =>
                                setPresetPromptDrafts((prev) => ({
                                  ...prev,
                                  [preset.id]: e.target.value,
                                }))
                              }
                              className={`${adminTextArea} h-64 font-mono text-sm`}
                              placeholder={`System prompt for "${preset.name}"...`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-blue-500/25 bg-blue-500/10 p-4">
                      <h4 className="font-medium text-blue-700 dark:text-blue-200 mb-2">How it works:</h4>
                      <ul className="text-sm text-blue-700 dark:text-blue-100/90 space-y-1">
                        <li>• <strong>Titleblock Extraction Prompts:</strong> Used for extracting sheet numbers and names from titleblock regions (separate prompts for each field)</li>
                        <li>• <strong>Chat Assistant Prompt:</strong> Used for AI responses in the chat tab</li>
                        <li>• <strong>Chat Presets:</strong> System prompts users select in the chat mode dropdown — users see only the preset name, not the prompt text</li>
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
                    <div className={adminPanelSection}>
                      <h3 className="text-lg font-semibold mb-4">Model Settings</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Default Model</Label>
                          <select 
                            className={adminSelect}
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                          >
                            {availableModels.map((model) => (
                              <option key={model.name} value={model.name} className="bg-background text-foreground">
                                {model.name} (cloud{model.size ? `, ${(model.size / 1024 / 1024 / 1024).toFixed(1)}GB` : ''})
                              </option>
                            ))}
                          </select>
                          <p className={`${adminHelpText} mt-1`}>Primary AI model for chat responses</p>
                        </div>
                        <div>
                          <Label>Fallback Model</Label>
                          <select 
                            className={adminSelect}
                            value={fallbackModel}
                            onChange={(e) => setFallbackModel(e.target.value)}
                          >
                            {availableModels.map((model) => (
                              <option key={model.name} value={model.name} className="bg-background text-foreground">
                                {model.name} (cloud{model.size ? `, ${(model.size / 1024 / 1024 / 1024).toFixed(1)}GB` : ''})
                              </option>
                            ))}
                          </select>
                          <p className={`${adminHelpText} mt-1`}>Backup model if primary fails</p>
                        </div>
                      </div>
                    </div>

                    <div className={adminPanelSection}>
                      <h3 className="text-lg font-semibold mb-4">OCR & AI Analysis Settings</h3>
                      <div className="rounded-lg border border-green-500/25 bg-green-500/10 p-4">
                        <h4 className="font-medium text-green-700 dark:text-green-200 mb-2">Current Approach: Simple OCR + AI</h4>
                        <ul className="text-sm text-green-700 dark:text-green-100/90 space-y-1">
                          <li>• Fast text extraction using pdf-parse (18 seconds for 80 pages)</li>
                          <li>• AI analysis of extracted text for sheet labeling</li>
                          <li>• Reliable processing of all pages</li>
                          <li>• Cost-effective and maintainable</li>
                        </ul>
                      </div>
                    </div>

                    <div className={adminPanelSection}>
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
                          <p className={`${adminHelpText} mt-1`}>Creativity level (0-2)</p>
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
                          <p className={`${adminHelpText} mt-1`}>Response diversity (0-1)</p>
                        </div>
                        <div>
                          <Label>Max Tokens</Label>
                          <Input 
                            type="number" 
                            placeholder="2048" 
                            defaultValue="2048"
                          />
                          <p className={`${adminHelpText} mt-1`}>Maximum response length</p>
                        </div>
                      </div>
                    </div>


                    <div className={adminPanelSection}>
                      <h3 className="text-lg font-semibold mb-4">Context & Memory</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Context Window Size</Label>
                          <Input 
                            type="number" 
                            placeholder="10" 
                            defaultValue="10"
                          />
                          <p className={`${adminHelpText} mt-1`}>Number of previous messages to include</p>
                        </div>
                        <div>
                          <Label>Project Context Level</Label>
                          <select className={adminSelect}>
                            <option value="full" className="bg-background text-foreground">Full Project Data</option>
                            <option value="summary" className="bg-background text-foreground">Summary Only</option>
                            <option value="minimal" className="bg-background text-foreground">Minimal Context</option>
                          </select>
                          <p className={`${adminHelpText} mt-1`}>Amount of project data to include</p>
                        </div>
                      </div>
                    </div>

                    <div className={adminPanelSection}>
                      <h3 className="text-lg font-semibold mb-4">Performance & Limits</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Response Timeout (seconds)</Label>
                          <Input 
                            type="number" 
                            placeholder="300" 
                            defaultValue="300"
                          />
                          <p className={`${adminHelpText} mt-1`}>Maximum time to wait for response</p>
                        </div>
                        <div>
                          <Label>Rate Limit (requests/minute)</Label>
                          <Input 
                            type="number" 
                            placeholder="60" 
                            defaultValue="60"
                          />
                          <p className={`${adminHelpText} mt-1`}>Maximum requests per minute</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-4">
                      <Button
                        onClick={async () => {
                          try {
                            setIsLoading(true);
                            ollamaService.setDefaultModel(selectedModel);
                            
                            const hasSession = await ensureSession();
                            if (hasSession) {
                              try {
                                await settingsService.updateSettings({
                                  'ai-selected-model': selectedModel,
                                  'ai-fallback-model': fallbackModel
                                });
                              } catch (apiError: unknown) {
                                const status = (apiError as { response?: { status?: number } })?.response?.status;
                                if (status !== 401 && status !== 403 && import.meta.env.DEV) {
                                  console.warn('Failed to save to API, using localStorage fallback:', apiError);
                                }
                                localStorage.setItem('ai-selected-model', selectedModel);
                                localStorage.setItem('ai-fallback-model', fallbackModel);
                              }
                            } else {
                              localStorage.setItem('ai-selected-model', selectedModel);
                              localStorage.setItem('ai-fallback-model', fallbackModel);
                            }
                            
                            // Also save to localStorage as backup
                            localStorage.setItem('ai-selected-model', selectedModel);
                            localStorage.setItem('ai-fallback-model', fallbackModel);
                            
                            toast.success('AI settings saved successfully!');
                          } catch (error) {
                            console.error('Error saving AI settings:', error);
                            toast.error(extractErrorMessage(error, 'Failed to save AI settings'));
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                        disabled={isLoading}
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Save AI Settings
                      </Button>
                      <Button 
                        onClick={async () => {
                          try {
                            const isAvailable = await ollamaService.isAvailable();
                            if (isAvailable) {
                              toast.success('Ollama connection successful!');
                            } else {
                              toast.error('Ollama connection failed. Make sure Ollama is running.');
                            }
                          } catch (error) {
                            toast.error(extractErrorMessage(error, 'Connection test failed. Check console for details.'));
                          }
                        }}
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Test Connection
                      </Button>
                      <Button 
                        className="bg-red-600 hover:bg-red-700"
                        onClick={() => {
                          setSelectedModel('gpt-oss:120b');
                          setFallbackModel('gpt-oss:20b');
                          ollamaService.setDefaultModel('gpt-oss:120b');
                          toast.success('Settings reset to defaults!');
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
                    <div className={adminPanelSection}>
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <UserPlus className="w-5 h-5" />
                        Invite New User
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <Label htmlFor="invite-email">Email Address</Label>
                          <Input
                            id="invite-email"
                            name="invite-email"
                            type="email"
                            autoComplete="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="user@example.com"
                          />
                        </div>
                        <div>
                          <Label htmlFor="invite-role">Role</Label>
                          <select
                            id="invite-role"
                            name="invite-role"
                            className={adminSelect}
                            value={inviteRole}
                            onChange={(e) => setInviteRole(e.target.value as 'admin' | 'user')}
                          >
                            <option value="user" className="bg-background text-foreground">User</option>
                            <option value="admin" className="bg-background text-foreground">Admin</option>
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
                    <div className={adminPanelSection}>
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <Mail className="w-5 h-5" />
                        Pending Invitations ({invitations.filter(inv => inv.status === 'pending').length})
                      </h3>
                      {invitations.filter(inv => inv.status === 'pending').length === 0 ? (
                        <p className={adminMutedText}>No pending invitations</p>
                      ) : (
                        <div className="space-y-2">
                          {invitations
                            .filter(inv => inv.status === 'pending')
                            .map((invitation) => (
                              <div key={invitation.id} className={adminListRow}>
                                <div>
                                  <p className="font-medium">{invitation.email}</p>
                                  <p className={adminHelpText}>
                                    {invitation.source === 'project_share' ? (
                                      <>Project share: {invitation.project_name || 'Project'} • </>
                                    ) : (
                                      <>Role: {invitation.role} • </>
                                    )}
                                    Expires: {new Date(invitation.expires_at).toLocaleDateString()}
                                  </p>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleResendInvitation(invitation.id)}
                                  disabled={resendingId === invitation.id}
                                  title="Resend invitation email"
                                >
                                  {resendingId === invitation.id
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : <Send className="w-4 h-4" />}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDeleteInvitation(invitation.id)}
                                  className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    {/* Active Users */}
                    <div className={adminPanelSection}>
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <Users className="w-5 h-5" />
                        Active Users ({users.length})
                      </h3>
                      {users.length === 0 ? (
                        <p className={adminMutedText}>No users found</p>
                      ) : (
                        <div className="space-y-2">
                          {users.map((user) => (
                            <div key={user.id} className={adminListRow}>
                              <div>
                                <p className="font-medium">{user.full_name || 'No name'}</p>
                                <p className={adminHelpText}>
                                  {user.email && <>{user.email} • </>}
                                  Role: {user.role} •
                                  Joined: {new Date(user.created_at).toLocaleDateString()}
                                  {user.company && ` • ${user.company}`}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleResetPassword(user.id, user.email)}
                                  disabled={resettingPasswordId === user.id}
                                  title="Send password reset email"
                                >
                                  {resettingPasswordId === user.id
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : <KeyRound className="w-4 h-4" />}
                                </Button>
                                <select
                                  value={user.role}
                                  onChange={(e) => handleUpdateUserRole(user.id, e.target.value as 'admin' | 'user')}
                                  className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <option value="user" className="bg-background text-foreground">User</option>
                                  <option value="admin" className="bg-background text-foreground">Admin</option>
                                </select>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDeleteUser(user.id)}
                                  className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
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

        <DialogFooter className="border-t border-border pt-4">
          <Button onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

    </Dialog>
  );
}
