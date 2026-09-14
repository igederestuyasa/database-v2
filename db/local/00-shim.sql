-- ============================================================================
-- db/local/00-shim.sql — LOCAL TEST HARNESS ONLY. NOT PRODUCTION SCHEMA.
--
-- !! This file is deliberately NOT in supabase/migrations/. It must never be
-- !! applied to the Supabase project. It exists so that
-- !! supabase/migrations/0001_init.sql can be applied unmodified to a plain
-- !! PostgreSQL 16 server for verification (scripts/db-local.sh).
--
-- It reproduces the *minimum* of Supabase that the migration depends on:
--   * schema `auth` with `auth.users`
--   * `auth.uid()`, `auth.jwt()`, `auth.role()` reading `request.jwt.claims`
--     the same way Supabase's own helpers do
--   * roles `anon`, `authenticated`, `service_role`
--
-- Real Supabase Auth has ~30 more columns on auth.users, a GoTrue server, JWT
-- verification, refresh tokens and so on. None of that is modelled here.
-- ============================================================================

set client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- Roles. On Supabase these already exist and are managed by the platform.
-- Roles are cluster-wide, so on a re-run they already exist.
-- ---------------------------------------------------------------------------
do $roles$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
  end loop;
end
$roles$;

-- Let the bootstrapping superuser switch into these roles (SET ROLE) the way
-- PostgREST does per request. Needed by scripts/verify-schema.sql.
do $grants$
begin
  execute format('grant anon, authenticated, service_role to %I', current_user);
exception
  when others then null;  -- already a member, or no privilege needed
end
$grants$;

-- ---------------------------------------------------------------------------
-- auth schema
-- ---------------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                   uuid primary key default gen_random_uuid(),
  email                text unique,
  raw_user_meta_data   jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

comment on table auth.users is
  'SHIM — local stand-in for Supabase auth.users. Not production schema.';

grant select on auth.users to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth helper functions — same bodies Supabase ships.
-- ---------------------------------------------------------------------------
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb;
$fn$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')
  )::uuid;
$fn$;

create or replace function auth.role()
returns text
language sql
stable
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role')
  )::text;
$fn$;

grant execute on function auth.jwt(), auth.uid(), auth.role()
  to anon, authenticated, service_role;

-- The email domain the `on_auth_user_created` trigger accepts. On Supabase set
-- this with: alter database postgres set app.allowed_email_domain = '...';
do $cfg$
begin
  execute format(
    'alter database %I set app.allowed_email_domain = %L',
    current_database(), 'hutamakarya.com'
  );
end
$cfg$;
