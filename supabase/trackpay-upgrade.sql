-- TrackPay additive upgrade for an existing Spendwise project.
-- Run once in Supabase Dashboard → SQL Editor before using TrackPay cloud sync.
-- It keeps every existing transaction and marks historic Spendwise rows as PhonePe.

alter table public.transactions
  add column if not exists source_app text not null default 'phonepe';

update public.transactions
set source_app = 'phonepe'
where source_app is null or source_app = '';

-- Keep the allowed source list explicit. The DO block makes this safe to run
-- even when the named constraint already exists in a prior local setup.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_source_app_check'
  ) then
    alter table public.transactions
      add constraint transactions_source_app_check
      check (source_app in ('phonepe', 'gpay', 'paytm', 'navi'));
  end if;
end $$;

create index if not exists transactions_user_source_app_idx
  on public.transactions (user_id, source_app);

-- A TrackPay display name is deliberately separate from Google profile data.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users read their own TrackPay profile" on public.profiles;
create policy "Users read their own TrackPay profile"
  on public.profiles for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users insert their own TrackPay profile" on public.profiles;
create policy "Users insert their own TrackPay profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update their own TrackPay profile" on public.profiles;
create policy "Users update their own TrackPay profile"
  on public.profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Confirm that the transactions foreign key includes ON DELETE CASCADE before
-- deploying the account-deletion function. Spendwise's supplied schema does.
-- Deploy separately: supabase functions deploy delete-account
-- Set its SUPABASE_SERVICE_ROLE_KEY only in Supabase Edge Function secrets.
