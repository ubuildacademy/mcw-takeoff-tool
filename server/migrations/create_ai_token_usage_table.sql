-- AI token usage log — one row per completed chat request.
-- Purpose: measure real token consumption across the beta so the provider
-- decision (Ollama Cloud vs OpenRouter vs direct DeepSeek) is made on data,
-- not a guess. Counts come straight from Ollama's response
-- (prompt_eval_count / eval_count) — authoritative, not estimated.

create table if not exists public.ai_token_usage (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  project_id        uuid,
  model             text        not null,
  prompt_tokens     integer     not null default 0,
  completion_tokens integer     not null default 0,
  total_tokens      integer     not null default 0,
  streamed          boolean     not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists ai_token_usage_created_at_idx on public.ai_token_usage (created_at desc);
create index if not exists ai_token_usage_user_id_idx    on public.ai_token_usage (user_id);
create index if not exists ai_token_usage_model_idx      on public.ai_token_usage (model);

-- Server writes/reads with the service-role key (bypasses RLS). RLS on +
-- no policies = no direct client access; usage is admin-only via the API.
alter table public.ai_token_usage enable row level security;
