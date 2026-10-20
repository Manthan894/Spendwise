-- TrackPay base database schema
-- Run this in Supabase Dashboard → SQL Editor before configuring a new project.
-- The original PhonePe, GPay, Paytm, or Navi PDF is never uploaded to Supabase.

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Stable browser-generated fingerprint. Combined with user_id, it prevents
  -- duplicate records when the same or overlapping statement is imported.
  fingerprint text not null,
  transaction_id text,
  utr text,
  transaction_date date not null,
  transaction_time text,
  transaction_type text not null check (transaction_type in ('DEBIT', 'CREDIT')),
  amount_paise bigint not null check (amount_paise >= 0),
  counterparty text not null,
  account_last4 text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  description text,
  source_page integer,
  source_file_name text,
  source_app text not null default 'phonepe' check (source_app in ('phonepe', 'gpay', 'paytm', 'navi')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, transaction_date desc);
create index if not exists transactions_user_counterparty_idx
  on public.transactions (user_id, counterparty);

alter table public.transactions enable row level security;

-- Every policy is explicitly tied to auth.uid(). A signed-in user cannot
-- select, insert, edit, or delete rows belonging to a different user.
drop policy if exists "Users read their own transactions" on public.transactions;
create policy "Users read their own transactions"
  on public.transactions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users insert their own transactions" on public.transactions;
create policy "Users insert their own transactions"
  on public.transactions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update their own transactions" on public.transactions;
create policy "Users update their own transactions"
  on public.transactions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete their own transactions" on public.transactions;
create policy "Users delete their own transactions"
  on public.transactions for delete
  to authenticated
  using (auth.uid() = user_id);

-- Keep updated_at current without allowing browsers to alter ownership.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
before update on public.transactions
for each row execute function public.set_updated_at();
