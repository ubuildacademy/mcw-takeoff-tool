import { supabase } from '../supabase';

export type AiDailyQuotaResult =
  | { allowed: true; limit: number; remaining: number; resetAtEpochSeconds: number }
  | { allowed: false; limit: number; remaining: 0; resetAtEpochSeconds: number; retryAfterSeconds: number };

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
    // Fail closed to protect usage limits if quota infrastructure breaks.
    // Return a 429-friendly response to avoid burning upstream usage unexpectedly.
    return {
      allowed: false,
      limit: limitPerDay,
      remaining: 0,
      resetAtEpochSeconds,
      retryAfterSeconds: Math.max(1, resetAtEpochSeconds - Math.floor(Date.now() / 1000)),
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

