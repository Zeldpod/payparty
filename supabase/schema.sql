-- PayParty — production-safe Supabase schema
-- Run this entire file in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- It is intentionally idempotent so it can also upgrade the original schema.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  balance     numeric(12,2) not null default 0 check (balance >= 0),
  lifetime    numeric(12,2) not null default 0 check (lifetime >= 0),
  created_at  timestamptz not null default now()
);

-- CREATE TABLE IF NOT EXISTS does not upgrade a legacy table. Some early
-- PayParty databases only had id/balance, so add every newer profile field
-- before triggers, backfills, or dashboard queries reference it.
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists balance numeric(12,2) default 0;
alter table public.profiles add column if not exists lifetime numeric(12,2) default 0;
alter table public.profiles add column if not exists created_at timestamptz default now();

update public.profiles set balance = 0 where balance is null;
update public.profiles set lifetime = 0 where lifetime is null;
update public.profiles set created_at = now() where created_at is null;
update public.profiles set lifetime = balance where lifetime = 0 and balance > 0;
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

alter table public.profiles alter column balance set default 0;
alter table public.profiles alter column balance set not null;
alter table public.profiles alter column lifetime set default 0;
alter table public.profiles alter column lifetime set not null;
alter table public.profiles alter column created_at set default now();
alter table public.profiles alter column created_at set not null;

-- Every verified earning becomes an immutable ledger entry.
create table if not exists public.earnings_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  source      text not null default 'sponsor' check (char_length(source) between 1 and 80),
  created_at  timestamptz not null default now()
);

-- A cash-out reserves money immediately. A private worker/admin can then mark
-- it processing, paid, failed, or cancelled through resolve_cashout().
create table if not exists public.cashouts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  request_key      uuid not null,
  amount           numeric(12,2) not null check (amount >= 5),
  method           text not null check (method in ('paypal', 'venmo', 'cash_app')),
  destination      text not null check (char_length(destination) between 3 and 120),
  status           text not null default 'pending'
                   check (status in ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  payout_reference text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, request_key)
);

create index if not exists earnings_ledger_user_created_idx
  on public.earnings_ledger (user_id, created_at desc);
create index if not exists cashouts_user_created_idx
  on public.cashouts (user_id, created_at desc);
create index if not exists cashouts_status_created_idx
  on public.cashouts (status, created_at asc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.earnings_ledger enable row level security;
alter table public.cashouts enable row level security;

drop policy if exists "read own profile" on public.profiles;
drop policy if exists "update own profile" on public.profiles;
drop policy if exists "read own earnings" on public.earnings_ledger;
drop policy if exists "read own cashouts" on public.cashouts;

create policy "read own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);
create policy "read own earnings"
  on public.earnings_ledger for select to authenticated
  using (auth.uid() = user_id);
create policy "read own cashouts"
  on public.cashouts for select to authenticated
  using (auth.uid() = user_id);

-- There are deliberately no client insert/update/delete policies. Balances and
-- payout states can only change through the transactional functions below.

-- ---------------------------------------------------------------------------
-- New account bootstrap
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, balance, lifetime)
  values (new.id, new.email, 0.25, 0.25)
  on conflict (id) do nothing;

  if not exists (
    select 1 from public.earnings_ledger
    where user_id = new.id and source = 'Welcome bonus'
  ) then
    insert into public.earnings_ledger (user_id, amount, source)
    values (new.id, 0.25, 'Welcome bonus');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill ledger history for accounts created before earnings_ledger existed.
insert into public.earnings_ledger (user_id, amount, source, created_at)
select p.id, p.lifetime, 'Previous earnings', p.created_at
from public.profiles p
where p.lifetime > 0
  and not exists (select 1 from public.earnings_ledger e where e.user_id = p.id);

-- ---------------------------------------------------------------------------
-- Server-only earnings credit
-- ---------------------------------------------------------------------------
drop function if exists public.add_earnings(numeric);

create or replace function public.credit_earnings(
  p_user_id uuid,
  p_amount numeric,
  p_source text default 'Sponsor earnings'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(12,2) := round(p_amount, 2);
  v_balance numeric(12,2);
begin
  if p_user_id is null then raise exception 'User is required'; end if;
  if v_amount is null or v_amount <= 0 or v_amount > 1000 then raise exception 'Invalid earning amount'; end if;
  if char_length(trim(coalesce(p_source, ''))) not between 1 and 80 then
    raise exception 'Invalid earning source';
  end if;

  update public.profiles
  set balance = balance + v_amount,
      lifetime = lifetime + v_amount
  where id = p_user_id
  returning balance into v_balance;

  if not found then raise exception 'Profile not found'; end if;

  insert into public.earnings_ledger (user_id, amount, source)
  values (p_user_id, v_amount, trim(p_source));
  return v_balance;
end;
$$;

-- Only a trusted postback/worker using the service-role key can credit money.
revoke all on function public.credit_earnings(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.credit_earnings(uuid, numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- Authenticated, atomic cash-out request
-- ---------------------------------------------------------------------------
create or replace function public.request_cashout(
  p_amount numeric,
  p_method text,
  p_destination text,
  p_request_key uuid
)
returns table (
  id uuid,
  amount numeric,
  method text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_amount numeric(12,2) := round(p_amount, 2);
  v_balance numeric(12,2);
  v_existing public.cashouts%rowtype;
  v_row public.cashouts%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_request_key is null then raise exception 'Request key is required'; end if;

  -- Serialize retries of the same request key before the existence check.
  perform pg_advisory_xact_lock(hashtext(p_request_key::text));

  -- Replaying the same browser request returns the original row and never
  -- charges the balance twice.
  select * into v_existing
  from public.cashouts c
  where c.user_id = v_user and c.request_key = p_request_key;
  if found then
    return query select v_existing.id, v_existing.amount, v_existing.method,
                        v_existing.status, v_existing.created_at;
    return;
  end if;

  if v_amount is null or v_amount < 5 then raise exception 'Minimum cash out is $5.00'; end if;
  if v_amount > 5000 then raise exception 'Maximum cash out is $5,000.00'; end if;
  if p_method is null or p_method not in ('paypal', 'venmo', 'cash_app') then
    raise exception 'Choose a valid payout method';
  end if;
  if char_length(trim(coalesce(p_destination, ''))) not between 3 and 120 then
    raise exception 'Enter a valid payout destination';
  end if;

  select p.balance into v_balance
  from public.profiles p
  where p.id = v_user
  for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_balance < v_amount then raise exception 'Insufficient available balance'; end if;

  update public.profiles
  set balance = balance - v_amount
  where public.profiles.id = v_user;

  insert into public.cashouts (user_id, request_key, amount, method, destination)
  values (v_user, p_request_key, v_amount, p_method, trim(p_destination))
  returning * into v_row;

  return query select v_row.id, v_row.amount, v_row.method, v_row.status, v_row.created_at;
end;
$$;

revoke all on function public.request_cashout(numeric, text, text, uuid) from public, anon;
grant execute on function public.request_cashout(numeric, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Server-only payout resolution
-- Failed/cancelled requests are refunded exactly once in the same transaction.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_cashout(
  p_cashout_id uuid,
  p_status text,
  p_reference text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cashout public.cashouts%rowtype;
begin
  if p_status not in ('processing', 'paid', 'failed', 'cancelled') then
    raise exception 'Invalid cash-out status';
  end if;

  select * into v_cashout from public.cashouts
  where id = p_cashout_id for update;
  if not found then raise exception 'Cash-out not found'; end if;
  if v_cashout.status in ('paid', 'failed', 'cancelled') then
    raise exception 'Cash-out is already final';
  end if;
  if v_cashout.status = 'pending' and p_status = 'paid' then
    raise exception 'Move the cash-out to processing before paid';
  end if;

  if p_status in ('failed', 'cancelled') then
    update public.profiles
    set balance = balance + v_cashout.amount
    where id = v_cashout.user_id;
  end if;

  update public.cashouts
  set status = p_status,
      payout_reference = nullif(trim(coalesce(p_reference, '')), ''),
      updated_at = now()
  where id = p_cashout_id;
  return p_status;
end;
$$;

revoke all on function public.resolve_cashout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.resolve_cashout(uuid, text, text) to service_role;

-- Keep table grants read-only for signed-in clients; RLS still scopes rows.
revoke all on public.profiles, public.earnings_ledger, public.cashouts from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.profiles, public.earnings_ledger, public.cashouts from authenticated;
grant select on public.profiles, public.earnings_ledger, public.cashouts to authenticated;

-- ---------------------------------------------------------------------------
-- Waitlist (pre-launch email capture)
-- Written only by api/waitlist.js with the service-role key. The email column
-- is unique so the API can insert idempotently (duplicate signups are ignored,
-- never an error). RLS is on with deliberately no client policies, so anon and
-- authenticated clients can neither read nor write this table directly.
-- ---------------------------------------------------------------------------
create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  source      text,
  created_at  timestamptz not null default now()
);

create index if not exists waitlist_created_idx
  on public.waitlist (created_at desc);

alter table public.waitlist enable row level security;

-- No client insert/select policies: only the service-role API touches this table.
revoke all on public.waitlist from anon, authenticated;

commit;
