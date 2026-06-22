import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { CheckCircle, RefreshCw, Trash2, Plus, ChevronUp, ChevronDown, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_HELP_FAQ_CONFIG, type HelpSurface } from '../../content/helpContent';
import type { HelpFaqConfig, HelpItem } from '../../content/helpFaqTypes';
import { helpService, fetchHelpFaq } from '../../services/helpService';
import { extractErrorMessage } from '../../utils/commonUtils';

function cloneConfig(config: HelpFaqConfig): HelpFaqConfig {
  return {
    version: 1,
    dashboard: config.dashboard.map((item) => ({ ...item })),
    workspace: config.workspace.map((item) => ({ ...item })),
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
  };
}

function FaqEditorSection({
  surface,
  title,
  items,
  onChange,
}: {
  surface: HelpSurface;
  title: string;
  items: HelpItem[];
  onChange: (next: HelpItem[]) => void;
}) {
  const updateItem = (index: number, patch: Partial<HelpItem>) => {
    const next = items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange(next);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    onChange(next);
  };

  const addItem = () => {
    onChange([
      ...items,
      {
        id: `${surface}-custom-${Date.now()}`,
        question: 'New question',
        answer: 'Answer text…',
      },
    ]);
  };

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        <Button type="button" variant="outline" size="sm" onClick={addItem}>
          <Plus className="w-4 h-4 mr-1" />
          Add question
        </Button>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">No items. Add at least one FAQ entry.</p>
      )}

      <div className="space-y-4">
        {items.map((item, index) => (
          <div key={item.id} className="rounded-md border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">#{index + 1}</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={index === 0}
                  onClick={() => moveItem(index, -1)}
                  aria-label="Move up"
                >
                  <ChevronUp className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={index === items.length - 1}
                  onClick={() => moveItem(index, 1)}
                  aria-label="Move down"
                >
                  <ChevronDown className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => removeItem(index)}
                  aria-label="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor={`${surface}-q-${item.id}`} className="text-xs">
                Question
              </Label>
              <Input
                id={`${surface}-q-${item.id}`}
                value={item.question}
                onChange={(e) => updateItem(index, { question: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor={`${surface}-a-${item.id}`} className="text-xs">
                Answer
              </Label>
              <textarea
                id={`${surface}-a-${item.id}`}
                value={item.answer}
                onChange={(e) => updateItem(index, { answer: e.target.value })}
                className="mt-1 w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminHelpFaqTab() {
  const [config, setConfig] = useState<HelpFaqConfig>(() => cloneConfig(DEFAULT_HELP_FAQ_CONFIG));
  const [customized, setCustomized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { customized: isCustom, faq } = await fetchHelpFaq();
      setCustomized(isCustom);
      if (isCustom && faq) {
        setConfig(cloneConfig(faq));
      } else {
        setConfig(cloneConfig(DEFAULT_HELP_FAQ_CONFIG));
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Failed to load help FAQ'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const validateConfig = (): string | null => {
    const all = [...config.dashboard, ...config.workspace];
    if (all.length === 0) return 'Add at least one FAQ entry before saving.';
    const bad = all.find((item) => !item.question.trim() || !item.answer.trim());
    if (bad) return 'Every FAQ needs a question and answer.';
    return null;
  };

  const save = async () => {
    const validationError = validateConfig();
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);
    try {
      const saved = await helpService.saveHelpFaq(config);
      setConfig(cloneConfig(saved));
      setCustomized(true);
      toast.success('Help FAQ saved. Users will see changes without a new app deploy.');
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Failed to save help FAQ'));
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    if (
      !window.confirm(
        'Clear the saved FAQ on the server and revert all users to bundled defaults?'
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      await helpService.resetHelpFaq();
      setConfig(cloneConfig(DEFAULT_HELP_FAQ_CONFIG));
      setCustomized(false);
      toast.success('Help FAQ reset to app defaults.');
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Failed to reset help FAQ'));
    } finally {
      setSaving(false);
    }
  };

  const loadBundledDefaults = () => {
    setConfig(cloneConfig(DEFAULT_HELP_FAQ_CONFIG));
    toast.message('Loaded bundled defaults into the editor. Click Save to publish.');
  };

  if (loading) {
    return <p className="p-6 text-muted-foreground">Loading help content…</p>;
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <BookOpen className="w-6 h-6" />
          Help & FAQ
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Edit the questions shown in the in-app Help menu (? icon). Changes apply immediately for all
          users after you save — no redeploy required. Full guides remain in{' '}
          <code className="text-xs bg-muted px-1 rounded">docs/WORKSPACE_GUIDE.md</code> and{' '}
          <code className="text-xs bg-muted px-1 rounded">docs/QUICKSTART_AND_HOTKEYS.md</code> until
          updated in the repo.
        </p>
        {customized && config.updatedAt && (
          <p className="text-xs text-muted-foreground mt-2">
            Last saved: {new Date(config.updatedAt).toLocaleString()}
            {config.updatedBy ? ` · ${config.updatedBy}` : ''}
          </p>
        )}
        {!customized && (
          <p className="text-xs text-amber-700 dark:text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded px-2 py-1 mt-2 inline-block">
            Using bundled defaults (not yet customized on server)
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={saving}>
          <CheckCircle className="w-4 h-4 mr-2" />
          Save FAQ
        </Button>
        <Button variant="outline" onClick={loadBundledDefaults} disabled={saving}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Load bundled defaults
        </Button>
        <Button variant="outline" onClick={resetToDefaults} disabled={saving}>
          <Trash2 className="w-4 h-4 mr-2" />
          Clear server copy
        </Button>
        <Button variant="ghost" asChild>
          <a href="/help" target="_blank" rel="noopener noreferrer">
            Preview help site
          </a>
        </Button>
      </div>

      <FaqEditorSection
        surface="dashboard"
        title="Project dashboard FAQ"
        items={config.dashboard}
        onChange={(dashboard) => setConfig((c) => ({ ...c, dashboard }))}
      />

      <FaqEditorSection
        surface="workspace"
        title="Takeoff workspace FAQ"
        items={config.workspace}
        onChange={(workspace) => setConfig((c) => ({ ...c, workspace }))}
      />
    </div>
  );
}
