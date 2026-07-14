import { supabase } from '../supabase';

export type AiDailyQuotaResult =
  | { allowed: true; limit: number; remaining: number; resetAtEpochSeconds: number }
  | { allowed: false; limit: number; remaining: 0; resetAtEpochSeconds: number; retryAfterSeconds: number };

type FallbackEntry = { count: number; resetAtEpochSeconds: number };
const fallbackStore = new Map<string, FallbackEntry>();

function startOfTodayUtcDate(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`; // YYYY-MM-DD
}

function nextMidnightUtcEpochSeconds(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return Math.floor(next.getTime() / 1000);
}

/**
 * Log one completed chat request's token usage. Best-effort: never throws into
 * the request path — if the table isn't deployed yet or the insert fails, we
 * warn and move on so chat is never blocked by logging.
 */
export async function logAiTokenUsage(params: {
  userId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  projectId?: string | null;
  streamed?: boolean;
}): Promise<void> {
  const { userId, model, promptTokens, completionTokens, projectId, streamed } = params;
  const prompt = Number.isFinite(promptTokens) ? promptTokens : 0;
  const completion = Number.isFinite(completionTokens) ? completionTokens : 0;

  // Nothing meaningful to record (e.g. upstream omitted counts) — skip the row.
  if (prompt === 0 && completion === 0) return;

  try {
    const { error } = await supabase.from('ai_token_usage').insert({
      user_id: userId,
      project_id: projectId ?? null,
      model,
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
      streamed: streamed ?? false,
    });
    if (error) console.warn('[aiUsage] token log insert failed:', error.message);
  } catch (e) {
    console.warn('[aiUsage] token log threw:', e instanceof Error ? e.message : e);
  }
}

export interface AiTokenUsageSummary {
  sinceDays: number;
  totals: { promptTokens: number; completionTokens: number; totalTokens: number; requests: number };
  byModel: Array<{ model: string; totalTokens: number; requests: number }>;
  byDay: Array<{ day: string; totalTokens: number; requests: number }>;
  byUser: Array<{ userId: string; totalTokens: number; requests: number }>;
}

/**
 * Aggregate token usage over the last `sinceDays` days. Beta volume is small,
 * so we pull the bounded window and aggregate in JS — no extra RPC to deploy.
 */
export async function getAiTokenUsageSummary(sinceDays: number): Promise<AiTokenUsageSummary> {
  const days = Math.min(90, Math.max(1, Math.floor(sinceDays) || 30));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const empty: AiTokenUsageSummary = {
    sinceDays: days,
    totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 },
    byModel: [],
    byDay: [],
    byUser: [],
  };

  const { data, error } = await supabase
    .from('ai_token_usage')
    .select('user_id, model, prompt_tokens, completion_tokens, total_tokens, created_at')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(50000);

  if (error || !Array.isArray(data)) {
    if (error) console.warn('[aiUsage] summary query failed:', error.message);
    return empty;
  }

  const modelMap = new Map<string, { totalTokens: number; requests: number }>();
  const dayMap = new Map<string, { totalTokens: number; requests: number }>();
  const userMap = new Map<string, { totalTokens: number; requests: number }>();

  const bump = (
    map: Map<string, { totalTokens: number; requests: number }>,
    key: string,
    tokens: number
  ) => {
    const cur = map.get(key) ?? { totalTokens: 0, requests: 0 };
    cur.totalTokens += tokens;
    cur.requests += 1;
    map.set(key, cur);
  };

  for (const row of data) {
    const total = Number(row.total_tokens) || 0;
    empty.totals.promptTokens += Number(row.prompt_tokens) || 0;
    empty.totals.completionTokens += Number(row.completion_tokens) || 0;
    empty.totals.totalTokens += total;
    empty.totals.requests += 1;
    bump(modelMap, row.model ?? 'unknown', total);
    bump(dayMap, String(row.created_at).slice(0, 10), total);
    bump(userMap, row.user_id ?? 'unknown', total);
  }

  empty.byModel = [...modelMap.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
  empty.byDay = [...dayMap.entries()]
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
  empty.byUser = [...userMap.entries()]
    .map(([userId, v]) => ({ userId, ...v }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return empty;
}

export async function checkAndIncrementAiChatDailyQuota(params: {
  userId: string;
  limitPerDay: number;
  bypass?: boolean;
}): Promise<AiDailyQuotaResult> {
  const { userId, limitPerDay, bypass } = params;

  const resetAtEpochSeconds = nextMidnightUtcEpochSeconds();

  if (bypass) {
    return {
      allowed: true,
      limit: limitPerDay,
      remaining: limitPerDay,
      resetAtEpochSeconds,
    };
  }

  const day = startOfTodayUtcDate();

  const { data, error } = await supabase.rpc('increment_ai_chat_usage_daily', {
    p_user_id: userId,
    p_day: day,
  });

  if (error) {
    // If the DB/RPC isn't deployed yet (or transiently unavailable), fall back to an
    // in-memory daily counter so we don't hard-block legit users immediately.
    const key = `${userId}:${day}`;
    const existing = fallbackStore.get(key);
    const entry =
      existing && existing.resetAtEpochSeconds === resetAtEpochSeconds
        ? existing
        : { count: 0, resetAtEpochSeconds };

    entry.count += 1;
    fallbackStore.set(key, entry);

    const remaining = Math.max(0, limitPerDay - entry.count);
    if (entry.count > limitPerDay) {
      const nowEpochSeconds = Math.floor(Date.now() / 1000);
      return {
        allowed: false,
        limit: limitPerDay,
        remaining: 0,
        resetAtEpochSeconds,
        retryAfterSeconds: Math.max(1, resetAtEpochSeconds - nowEpochSeconds),
      };
    }

    return {
      allowed: true,
      limit: limitPerDay,
      remaining,
      resetAtEpochSeconds,
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const requestCount = typeof row?.request_count === 'number' ? row.request_count : Number(row?.request_count);
  const used = Number.isFinite(requestCount) ? requestCount : limitPerDay;
  const remaining = Math.max(0, limitPerDay - used);

  if (used > limitPerDay) {
    const nowEpochSeconds = Math.floor(Date.now() / 1000);
    return {
      allowed: false,
      limit: limitPerDay,
      remaining: 0,
      resetAtEpochSeconds,
      retryAfterSeconds: Math.max(1, resetAtEpochSeconds - nowEpochSeconds),
    };
  }

  return {
    allowed: true,
    limit: limitPerDay,
    remaining,
    resetAtEpochSeconds,
  };
}

