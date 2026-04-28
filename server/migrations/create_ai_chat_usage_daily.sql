-- AI chat daily usage tracking (per user).
-- Used to enforce a daily request-count budget for /api/ollama/chat.

CREATE TABLE IF NOT EXISTS ai_chat_usage_daily (
  user_id UUID NOT NULL,
  day DATE NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
);

-- Enable RLS (defense in depth). Server uses service role key.
ALTER TABLE ai_chat_usage_daily ENABLE ROW LEVEL SECURITY;

-- Only allow users to read their own row (optional; admin can query separately if needed).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_chat_usage_daily'
      AND policyname = 'ai_chat_usage_daily_select_own'
  ) THEN
    CREATE POLICY ai_chat_usage_daily_select_own
      ON ai_chat_usage_daily
      FOR SELECT
      USING (user_id = auth.uid());
  END IF;
END $$;

-- RPC for atomic increment (safe under concurrency).
CREATE OR REPLACE FUNCTION increment_ai_chat_usage_daily(p_user_id UUID, p_day DATE)
RETURNS TABLE (request_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO ai_chat_usage_daily (user_id, day, request_count, updated_at)
  VALUES (p_user_id, p_day, 1, NOW())
  ON CONFLICT (user_id, day)
  DO UPDATE
    SET request_count = ai_chat_usage_daily.request_count + 1,
        updated_at = NOW();

  RETURN QUERY
    SELECT ai_chat_usage_daily.request_count
    FROM ai_chat_usage_daily
    WHERE user_id = p_user_id AND day = p_day;
END;
$$;

-- Allow authenticated users to execute the function for themselves.
-- (Server uses service role; this is mainly to avoid accidental permission issues in dev.)
REVOKE ALL ON FUNCTION increment_ai_chat_usage_daily(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_ai_chat_usage_daily(UUID, DATE) TO authenticated;

