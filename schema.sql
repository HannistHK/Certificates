-- =====================================================================
-- CERTIFICATE GENERATOR — SUPABASE SCHEMA
-- =====================================================================
-- Run this entire script once in the Supabase SQL Editor
-- (Project → SQL Editor → New Query → paste → Run).
-- It is safe to re-run: destructive statements are guarded with
-- IF EXISTS / IF NOT EXISTS and CREATE OR REPLACE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. EXTENSIONS
-- ---------------------------------------------------------------------
-- pgcrypto gives us gen_random_uuid() and gen_random_bytes() for
-- cryptographically strong key generation.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. TABLE: keys
-- ---------------------------------------------------------------------
create table if not exists public.keys (
  id           uuid primary key default gen_random_uuid(),
  key_code     text unique not null,
  is_used      boolean not null default false,
  redeemed_by  text,
  redeemed_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- Fast lookups on the code students actually type in.
create index if not exists idx_keys_key_code on public.keys (key_code);
create index if not exists idx_keys_is_used  on public.keys (is_used);

comment on table public.keys is
  'Single-use access keys redeemable for a personalized certificate.';
comment on column public.keys.key_code is
  'Human-entered code, format CERT-XXXX-XXXX.';
comment on column public.keys.redeemed_by is
  'Full name supplied by the student at redemption time.';

-- ---------------------------------------------------------------------
-- 2. SEED: 100 unique, secure, random alphanumeric keys
-- ---------------------------------------------------------------------
-- Format: CERT-XXXX-XXXX where X is [A-Z0-9], drawn from
-- gen_random_bytes() so it is cryptographically unpredictable.
-- Collisions are vanishingly unlikely (36^8 combinations) but the loop
-- below still guards against them via ON CONFLICT DO NOTHING + retry,
-- so the script always ends with exactly 100 *new* keys inserted.

do $$
declare
  charset      text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  target_count int  := 100;
  inserted     int  := 0;
  candidate    text;
  seg          text;
  i            int;
  j            int;
  byte_val     int;
begin
  while inserted < target_count loop
    seg := '';
    -- build CERT-XXXX-XXXX
    for j in 1..2 loop
      for i in 1..4 loop
        byte_val := get_byte(gen_random_bytes(1), 0) % length(charset) + 1;
        seg := seg || substr(charset, byte_val, 1);
      end loop;
      if j = 1 then
        seg := seg || '-';
      end if;
    end loop;
    candidate := 'CERT-' || seg;

    begin
      insert into public.keys (key_code) values (candidate);
      inserted := inserted + 1;
    exception when unique_violation then
      -- extremely rare collision: loop again without incrementing
      null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
-- RLS is enabled with NO policies attached for anon/authenticated.
-- That means the default-deny behavior of Postgres RLS applies: the
-- `keys` table cannot be SELECTed, INSERTed, UPDATEd, or DELETEd
-- directly by the public API at all. The only way to interact with
-- keys from the client is through the SECURITY DEFINER function
-- below, which runs with the privileges of its owner and therefore
-- bypasses RLS in a controlled, audited way.

alter table public.keys enable row level security;
alter table public.keys force row level security;

-- Explicitly strip any table-level grants the anon/authenticated
-- roles might otherwise inherit, so the only door in is the RPC.
revoke all on public.keys from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. ATOMIC RPC: redeem_key(p_key_code, p_full_name)
-- ---------------------------------------------------------------------
-- SECURITY DEFINER + `select ... for update` gives us row-level
-- locking inside a single statement/transaction, so two concurrent
-- redemption attempts on the same key cannot both succeed
-- (no TOCTOU race between "check" and "mark used").

create or replace function public.redeem_key(
  p_key_code  text,
  p_full_name text
)
returns table (
  success boolean,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      public.keys%rowtype;
  v_code     text := upper(trim(coalesce(p_key_code, '')));
  v_name     text := trim(coalesce(p_full_name, ''));
begin
  if v_code = '' then
    return query select false, 'Please enter your access key.';
    return;
  end if;

  if v_name = '' then
    return query select false, 'Please enter your full name.';
    return;
  end if;

  if length(v_name) > 120 then
    return query select false, 'That name is too long. Please shorten it.';
    return;
  end if;

  -- Lock the matching row (if any) for the duration of this transaction.
  select * into v_row
  from public.keys
  where key_code = v_code
  for update;

  if not found then
    return query select false, 'That access key was not found. Double-check for typos.';
    return;
  end if;

  if v_row.is_used then
    return query select false, 'This access key has already been redeemed.';
    return;
  end if;

  update public.keys
  set is_used     = true,
      redeemed_by = v_name,
      redeemed_at = now()
  where id = v_row.id;

  return query select true, 'Key redeemed successfully.';
end;
$$;

-- Only the RPC entry point is exposed to the public API roles.
grant execute on function public.redeem_key(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Done. Verify with:
--   select count(*) from public.keys;                 -- expect 100
--   select * from public.redeem_key('BAD-CODE','Jane Doe');
-- ---------------------------------------------------------------------
