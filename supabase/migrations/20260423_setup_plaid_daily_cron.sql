-- Daily Plaid sync via pg_cron + pg_net
--
-- ROOT CAUSE FIX: plaid-sync-all existed but was never scheduled.
-- This migration creates the cron job that calls it every day at 13:00 UTC
-- (8:00 AM EST / 9:00 AM EDT).
--
-- BEFORE RUNNING THIS MIGRATION:
--   1. Replace YOUR_CRON_SECRET below with any strong random string you choose.
--   2. Add that same string to Supabase → Edge Functions → Secrets as: CRON_SECRET
--   3. Run: supabase db push
--
-- To verify the job is registered after migration:
--   SELECT * FROM cron.job WHERE jobname = 'plaid-daily-sync';

-- Remove any previously registered version of this job (idempotent)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'plaid-daily-sync') then
    perform cron.unschedule('plaid-daily-sync');
  end if;
end $$;

-- Schedule daily sync at 13:00 UTC every day (8:00 AM EST / 9:00 AM EDT)
select cron.schedule(
  'plaid-daily-sync',
  '0 13 * * *',
  $$
  select net.http_post(
    url     := 'https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/plaid-sync-all',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  'YOUR_CRON_SECRET'
    ),
    body    := '{}'::jsonb
  );
  $$
);
