-- PayParty — Supabase schema
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run.

-- 1) profiles: one row per user, holds the live balance
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  balance     numeric(12,2) not null default 0,
  lifetime    numeric(12,2) not null default 0,
  created_at  timestamptz   not null default now()
);

-- 2) Row Level Security: a user can only read/update their own row
alter table public.profiles enable row level security;

drop policy if exists "read own profile"   on public.profiles;
drop policy if exists "update own profile" on public.profiles;
create policy "read own profile"   on public.profiles for select using (auth.uid() = id);
create policy "update own profile" on public.profiles for update using (auth.uid() = id);

-- 3) Auto-create a profile (with a $0.25 welcome bonus) whenever someone signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, balance, lifetime)
  values (new.id, new.email, 0.25, 0.25)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) Safe RPC to credit earnings (call from your server / verified ad postbacks,
--    NOT directly from the client, so balances can't be faked).
create or replace function public.add_earnings(amount numeric)
returns numeric
language plpgsql
security definer set search_path = public
as $$
declare new_balance numeric;
begin
  update public.profiles
    set balance = balance + amount, lifetime = lifetime + amount
    where id = auth.uid()
    returning balance into new_balance;
  return new_balance;
end;
$$;
