import type { Request } from 'express';

export const HELP_FAQ_SETTING_KEY = 'help-faq-v1';

export type HelpFaqItem = {
  id: string;
  question: string;
  answer: string;
};

export type HelpFaqConfig = {
  version: 1;
  dashboard: HelpFaqItem[];
  workspace: HelpFaqItem[];
  updatedAt?: string;
  updatedBy?: string;
};

const MAX_ITEMS_PER_SURFACE = 40;
const MAX_QUESTION_LEN = 300;
const MAX_ANSWER_LEN = 4000;
const MAX_ID_LEN = 80;

function sanitizeItem(raw: unknown, index: number, surface: string): HelpFaqItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const question = typeof row.question === 'string' ? row.question.trim() : '';
  const answer = typeof row.answer === 'string' ? row.answer.trim() : '';
  if (!question || !answer) return null;
  const id =
    typeof row.id === 'string' && row.id.trim()
      ? row.id.trim().slice(0, MAX_ID_LEN)
      : `${surface}-item-${index + 1}`;
  return {
    id,
    question: question.slice(0, MAX_QUESTION_LEN),
    answer: answer.slice(0, MAX_ANSWER_LEN),
  };
}

function sanitizeList(raw: unknown, surface: string): HelpFaqItem[] {
  if (!Array.isArray(raw)) return [];
  const items: HelpFaqItem[] = [];
  for (let i = 0; i < raw.length && items.length < MAX_ITEMS_PER_SURFACE; i += 1) {
    const item = sanitizeItem(raw[i], i, surface);
    if (item) items.push(item);
  }
  return items;
}

export function parseHelpFaqConfig(raw: unknown): HelpFaqConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const dashboard = sanitizeList(body.dashboard, 'dashboard');
  const workspace = sanitizeList(body.workspace, 'workspace');
  if (dashboard.length === 0 && workspace.length === 0) return null;
  return {
    version: 1,
    dashboard,
    workspace,
    updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : undefined,
    updatedBy: typeof body.updatedBy === 'string' ? body.updatedBy : undefined,
  };
}

export function parseStoredHelpFaq(value: string): HelpFaqConfig | null {
  try {
    return parseHelpFaqConfig(JSON.parse(value));
  } catch {
    return null;
  }
}

export function buildHelpFaqPayload(
  body: unknown,
  updatedBy?: string
): HelpFaqConfig | null {
  const parsed = parseHelpFaqConfig(body);
  if (!parsed) return null;
  return {
    ...parsed,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}
