-- TrackPay Foundation Security Hardening
-- Run this once in the TrackPay test/production Supabase project AFTER
-- trackpay-upgrade.sql and AFTER deploying the four Edge Functions.
-- Do not run it in the existing Spendwise production project during testing.

-- Privacy-safe audit events: no statement content, amount, counterparty,
-- transaction ID, file name, or IP address is stored here.
create table if not exists public.security_audit_events (
  id uuid primary key default gen_random_uuid(),
  -- Deliberately no foreign key: the minimal deletion event is retained for
  -- the agreed 30-day security window after the Auth user is gone.
  user_id uuid not null,
  action text not null check (action in ('commit_import', 'profile_save', 'clear_data', 'delete_account')),
  result text not null check (result in ('success', 'failure', 'rejected', 'rate_limited')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

-- If an early staging run created the former cascade foreign key, remove it so
-- a successful account-deletion audit event is retained until expiry.
alter table public.security_audit_events drop constraint if exists security_audit_events_user_id_fkey;

create index if not exists security_audit_events_expiry_idx
  on public.security_audit_events (expires_at);
create index if not exists security_audit_events_user_created_idx
  on public.security_audit_events (user_id, created_at desc);

alter table public.security_audit_events enable row level security;
revoke all on table public.security_audit_events from anon, authenticated;

-- Per-account counters are changed only through a service-role-only RPC called
-- by Edge Functions. This is an atomic database operation, not a browser timer.
create table if not exists public.trackpay_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('commit_import', 'profile_save', 'clear_data', 'delete_account')),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  primary key (user_id, action)
);

alter table public.trackpay_rate_limits enable row level security;
revoke all on table public.trackpay_rate_limits from anon, authenticated;

create or replace function public.consume_trackpay_rate_limit(
  p_subject uuid,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_attempts integer;
  v_window_started_at timestamptz;
  v_retry_after integer;
begin
  if p_subject is null
    or p_action not in ('commit_import', 'profile_save', 'clear_data', 'delete_account')
    or p_limit < 1
    or p_window_seconds < 60 then
    raise exception 'Invalid rate limit request';
  end if;

  insert into public.trackpay_rate_limits as rate_limit (user_id, action, window_started_at, attempts)
  values (p_subject, p_action, v_now, 1)
  on conflict (user_id, action) do update
    set window_started_at = case
          when rate_limit.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now
          else rate_limit.window_started_at
        end,
        attempts = case
          when rate_limit.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1
          else rate_limit.attempts + 1
        end
  returning attempts, window_started_at into v_attempts, v_window_started_at;

  v_retry_after := greatest(0, extract(epoch from (v_window_started_at + make_interval(secs => p_window_seconds) - v_now))::integer);
  return jsonb_build_object(
    'allowed', v_attempts <= p_limit,
    'retry_after_seconds', case when v_attempts <= p_limit then 0 else v_retry_after end
  );
end;
$$;

revoke all on function public.consume_trackpay_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_trackpay_rate_limit(uuid, text, integer, integer) to service_role;

create or replace function public.purge_trackpay_security_events()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.security_audit_events where expires_at <= now();
end;
$$;

revoke all on function public.purge_trackpay_security_events() from public, anon, authenticated;
grant execute on function public.purge_trackpay_security_events() to service_role;

-- Enforce the agreed 30-day retention window even when there is no later user
-- action. pg_cron is available in Supabase projects; this block is idempotent.
create extension if not exists pg_cron;
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'trackpay-purge-security-audit-events') then
    perform cron.schedule(
      'trackpay-purge-security-audit-events',
      '17 3 * * *',
      'select public.purge_trackpay_security_events();'
    );
  end if;
end $$;

-- A statement's original file name is not needed for analysis and is personal
-- data. Remove the legacy column so no future client can persist it.
alter table public.transactions drop column if exists source_file_name;

-- Server-side validation is duplicated in database constraints so malformed
-- data cannot be stored even if a future client has a regression.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_amount_ceiling_check') then
    alter table public.transactions add constraint transactions_amount_ceiling_check
      check (amount_paise between 1 and 1000000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_date_range_check') then
    alter table public.transactions add constraint transactions_date_range_check
      check (transaction_date between date '2000-01-01' and date '2100-12-31');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_counterparty_length_check') then
    alter table public.transactions add constraint transactions_counterparty_length_check
      check (char_length(counterparty) between 1 and 240);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_description_length_check') then
    alter table public.transactions add constraint transactions_description_length_check
      check (description is null or char_length(description) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_identifier_length_check') then
    alter table public.transactions add constraint transactions_identifier_length_check
      check ((transaction_id is null or char_length(transaction_id) <= 128)
        and (utr is null or char_length(utr) <= 128));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_source_page_range_check') then
    alter table public.transactions add constraint transactions_source_page_range_check
      check (source_page is null or source_page between 1 and 100000);
  end if;
end $$;

-- The browser may read only its own data. All create/update/delete actions now
-- go through authenticated Edge Functions that bind user_id from the JWT.
-- Remove every direct write policy, including policies inherited from an older
-- Spendwise setup whose policy names may not match this repository.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('transactions', 'profiles')
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy if exists %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end $$;
