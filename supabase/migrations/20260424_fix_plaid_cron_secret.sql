-- Fix: plaid-daily-sync cron was broken because the previous migration
-- (20260423_setup_plaid_daily_cron.sql) embedded the literal placeholder
-- 'YOUR_CRON_SECRET' instead of the real secret value.
--
-- This migration re-schedules the cron job to read CRON_SECRET from
-- Supabase Vault at runtime, so the secret never appears in git history.
--
-- BEFORE RUNNING THIS MIGRATION, complete both steps:
--
--   Step 1 — Edge Function Secret (used by plaid-sync-all to validate the request):
--     Supabase Dashboard → Edge Functions → Secrets → Add secret
--     Name:  CRON_SECRET
--     Value: <any strong random string, e.g.: openssl rand -hex 32>
--
--   Step 2 — Vault secret (used by pg_cron to send the correct header):
--     Run in Supabase SQL Editor:
--       SELECT vault.create_secret('<same value from Step 1>', 'CRON_SECRET');
--     Then verify:
--       SELECT name FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET';
--
--   Step 3 — Apply this migration:
--     supabase db push
--
--   Step 4 — Verify the job is registered:
--     SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'plaid-daily-sync';

-- Remove any previously registered version of this job (idempotent)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'plaid-daily-sync') then
    perform cron.unschedule('plaid-daily-sync');
  end if;
end $$;

-- Schedule daily sync at 13:00 UTC (8:00 AM EST / 9:00 AM EDT).
-- Secret is read from Vault at job execution time — never stored in SQL text.
select cron.schedule(
  'plaid-daily-sync',
  '0 13 * * *',
  $$
  select net.http_post(
    url     := 'https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/plaid-sync-all',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'CRON_SECRET'
        limit 1
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
