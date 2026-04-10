-- ── rate_limits table ─────────────────────────────────────────────────────────
create table if not exists public.rate_limits (
  key          text        primary key,
  count        integer     not null default 1,
  window_start timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Enable RLS — no policies defined, so anon/authenticated rows are invisible.
-- Edge functions use the service_role key which bypasses RLS entirely.
alter table public.rate_limits enable row level security;

-- Belt-and-suspenders: revoke all table privileges from public-facing roles.
-- Service role is not affected (it bypasses all grants/RLS).
revoke all on public.rate_limits from anon, authenticated;

-- Index to support periodic cleanup of expired windows
create index if not exists rate_limits_window_start_idx
  on public.rate_limits (window_start);

-- ── rate_limit_check function ─────────────────────────────────────────────────
-- Atomically increments (or resets) a rate limit window.
-- Called only by edge functions via service role — not accessible to anon/authenticated.
create or replace function public.rate_limit_check(
  p_key       text,
  p_window_ms bigint,   -- window length in milliseconds
  p_max       integer   -- max requests allowed per window
)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count        integer;
  v_window_start timestamptz;
  v_now          timestamptz := now();
  v_window_dur   interval    := (p_window_ms || ' milliseconds')::interval;
begin
  insert into public.rate_limits (key, count, window_start, updated_at)
  values (p_key, 1, v_now, v_now)
  on conflict (key) do update set
    count = case
      when rate_limits.window_start + v_window_dur <= v_now then 1
      else rate_limits.count + 1
    end,
    window_start = case
      when rate_limits.window_start + v_window_dur <= v_now then v_now
      else rate_limits.window_start
    end,
    updated_at = v_now
  returning rate_limits.count, rate_limits.window_start
  into v_count, v_window_start;

  return query
    select
      (v_count <= p_max)                   as allowed,
      greatest(p_max - v_count, 0)         as remaining,
      (v_window_start + v_window_dur)      as reset_at;
end;
$$;

-- Revoke execute from public-facing roles — only callable via service role
revoke execute on function public.rate_limit_check(text, bigint, integer)
  from anon, authenticated;
