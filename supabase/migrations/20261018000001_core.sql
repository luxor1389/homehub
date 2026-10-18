-- HomeHub · 0001 · Core: helpers, profiles, households, membership, invitations
-- All privileged logic lives in SECURITY DEFINER functions with an empty search_path.

-- Supabase's standard API privileges (already present on hosted projects; repeated so the migrations are
-- self-contained). Row access is always restricted by RLS; sensitive columns are narrowed below.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.is_valid_timezone(p_tz text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
$$;

-- Trimmed, lower-cased, whitespace-collapsed key used for duplicate detection.
create or replace function private.normalize_name(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users). Private account data (email, password) stays in auth.users.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  locale text not null default 'sr-Latn' check (locale in ('sr-Latn', 'en')),
  avatar_path text,
  email_notifications boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
  v_locale text := new.raw_user_meta_data ->> 'locale';
begin
  if v_locale is null or v_locale not in ('sr-Latn', 'en') then
    v_locale := 'sr-Latn';
  end if;
  insert into public.profiles (id, display_name, locale)
  values (new.id, left(coalesce(v_name, split_part(coalesce(new.email, 'user'), '@', 1)), 80), v_locale)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text check (char_length(description) <= 500),
  address text check (char_length(address) <= 200),
  timezone text not null default 'Europe/Belgrade',
  currency text not null default 'RSD' check (currency ~ '^[A-Z]{3}$'),
  created_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger households_updated_at before update on public.households
  for each row execute function private.set_updated_at();

create or replace function private.households_validate()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not private.is_valid_timezone(new.timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
create trigger households_validate before insert or update on public.households
  for each row execute function private.households_validate();

-- ---------------------------------------------------------------------------
-- household_members
-- ---------------------------------------------------------------------------
create table public.household_members (
  id uuid not null default gen_random_uuid() unique,
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'active' check (status in ('active', 'removed', 'left')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_active_idx on public.household_members (user_id) where status = 'active';
create trigger household_members_updated_at before update on public.household_members
  for each row execute function private.set_updated_at();

-- Membership helpers used by every RLS policy. SECURITY DEFINER avoids policy recursion;
-- they only ever answer questions about the calling user (auth.uid()).
create or replace function private.my_household_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.household_id from public.household_members m
  where m.user_id = (select auth.uid()) and m.status = 'active';
$$;

create or replace function private.my_admin_household_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.household_id from public.household_members m
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'admin';
$$;

create or replace function private.is_member(p_household uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = (select auth.uid()) and m.status = 'active');
$$;

create or replace function private.is_admin(p_household uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role = 'admin');
$$;

create or replace function private.is_active_member(p_household uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = p_user and m.status = 'active');
$$;

-- Users who share at least one household with the caller (used for profile visibility).
create or replace function private.co_member_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct m.user_id from public.household_members m
  where m.household_id in (select private.my_household_ids());
$$;

create or replace function private.require_member(p_household uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.is_member(p_household) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
end $$;

create or replace function private.require_admin(p_household uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member(p_household);
  if not private.is_admin(p_household) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
end $$;

-- A household must always keep at least one active admin.
create or replace function private.members_keep_admin()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.role = 'admin' and old.status = 'active'
     and (new.role <> 'admin' or new.status <> 'active')
     and not exists (
       select 1 from public.household_members m
       where m.household_id = old.household_id and m.user_id <> old.user_id
         and m.role = 'admin' and m.status = 'active') then
    raise exception 'last_admin' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger household_members_keep_admin before update on public.household_members
  for each row execute function private.members_keep_admin();

-- ---------------------------------------------------------------------------
-- household_invitations. Only a SHA-256 hash of the token is stored; the raw token is
-- returned once to the admin who created it.
-- ---------------------------------------------------------------------------
create table public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  token_hash text not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  max_uses int not null default 1 check (max_uses between 1 and 20),
  use_count int not null default 0 check (use_count >= 0),
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (use_count <= max_uses)
);
create index household_invitations_household_idx on public.household_invitations (household_id, created_at desc);
create trigger household_invitations_updated_at before update on public.household_invitations
  for each row execute function private.set_updated_at();

create or replace function private.hash_token(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invitations enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or id in (select private.co_member_ids()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy households_select on public.households for select to authenticated
  using (id in (select private.my_household_ids()));
create policy households_update on public.households for update to authenticated
  using (id in (select private.my_admin_household_ids()))
  with check (id in (select private.my_admin_household_ids()));

create policy household_members_select on public.household_members for select to authenticated
  using (household_id in (select private.my_household_ids()));
-- no insert/update/delete policies: membership changes only through the RPCs below

create policy household_invitations_select on public.household_invitations for select to authenticated
  using (household_id in (select private.my_admin_household_ids()));
-- insert/update only through RPCs

-- Column privileges: clients may only change these profile/household columns.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, locale, avatar_path, email_notifications) on public.profiles to authenticated;
revoke update on public.households from anon, authenticated;
grant update (name, description, address, timezone, currency) on public.households to authenticated;
revoke insert, update, delete on public.household_members from anon, authenticated;
revoke insert, update, delete on public.household_invitations from anon, authenticated;
revoke insert, delete on public.profiles, public.households from anon, authenticated;
revoke all on public.profiles, public.households, public.household_members, public.household_invitations from anon;

-- ---------------------------------------------------------------------------
-- RPCs: households and membership
-- ---------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null default 'other' check (kind in
    ('kitchen', 'living_room', 'bathroom', 'bedroom', 'hallway', 'terrace', 'windows', 'storage', 'other')),
  -- NULL name = show the translated label of `kind` (built-in rooms). User-entered names are never translated.
  name text check (name is null or char_length(btrim(name)) between 1 and 80),
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);
create index rooms_household_idx on public.rooms (household_id);
create trigger rooms_updated_at before update on public.rooms
  for each row execute function private.set_updated_at();

create or replace function public.create_household(
  p_name text,
  p_timezone text default 'Europe/Belgrade',
  p_currency text default 'RSD',
  p_address text default null,
  p_description text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if (select count(*) from public.household_members where user_id = v_uid and status = 'active') >= 10 then
    raise exception 'too_many_households' using errcode = '54000';
  end if;
  insert into public.households (name, timezone, currency, address, description, created_by)
  values (btrim(p_name), coalesce(nullif(p_timezone, ''), 'Europe/Belgrade'),
          upper(coalesce(nullif(p_currency, ''), 'RSD')), nullif(btrim(p_address), ''),
          nullif(btrim(p_description), ''), v_uid)
  returning id into v_id;

  insert into public.household_members (household_id, user_id, role) values (v_id, v_uid, 'admin');

  insert into public.rooms (household_id, kind, sort_order)
  select v_id, k, ord::int
  from unnest(array['kitchen', 'living_room', 'bathroom', 'bedroom', 'hallway', 'terrace', 'windows', 'storage'])
       with ordinality as t(k, ord);

  return v_id;
end $$;

create or replace function public.create_invitation(
  p_household uuid,
  p_email text default null,
  p_valid_hours int default 72,
  p_max_uses int default 1
) returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_exp timestamptz;
  v_id uuid;
begin
  perform private.require_admin(p_household);
  if p_valid_hours is null or p_valid_hours < 1 or p_valid_hours > 720 then
    raise exception 'invalid_valid_hours' using errcode = '22023';
  end if;
  v_exp := now() + make_interval(hours => p_valid_hours);
  insert into public.household_invitations (household_id, email, token_hash, created_by, expires_at, max_uses)
  values (p_household, nullif(lower(btrim(p_email)), ''), private.hash_token(v_token), (select auth.uid()), v_exp,
          coalesce(p_max_uses, 1))
  returning id into v_id;
  return query select v_id, v_token, v_exp;
end $$;

create or replace function public.revoke_invitation(p_invitation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_household uuid;
begin
  select household_id into v_household from public.household_invitations where id = p_invitation;
  if v_household is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_household);
  update public.household_invitations set revoked_at = coalesce(revoked_at, now()) where id = p_invitation;
end $$;

-- Shared validation for preview/accept. Returns the invitation row or a reason.
create or replace function private.check_invitation(p_token text, out inv public.household_invitations, out reason text)
language plpgsql stable security definer set search_path = '' as $$
declare v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
begin
  select * into inv from public.household_invitations where token_hash = private.hash_token(coalesce(p_token, ''));
  if inv.id is null then reason := 'invalid'; return; end if;
  if inv.revoked_at is not null then reason := 'revoked'; return; end if;
  if inv.expires_at <= now() then reason := 'expired'; return; end if;
  if inv.use_count >= inv.max_uses then reason := 'used'; return; end if;
  if inv.email is not null and inv.email <> v_email then reason := 'email_mismatch'; return; end if;
  if exists (select 1 from public.households h where h.id = inv.household_id and h.archived_at is not null) then
    reason := 'invalid'; return;
  end if;
  reason := null;
end $$;

create or replace function public.get_invitation_preview(p_token text)
returns table (household_name text, invited_by text, expires_at timestamptz, valid boolean, reason text, already_member boolean)
language plpgsql stable security definer set search_path = '' as $$
declare r record;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into r from private.check_invitation(p_token);
  if (r.inv).id is null then
    return query select null::text, null::text, null::timestamptz, false, r.reason, false;
    return;
  end if;
  return query
    select h.name, p.display_name, (r.inv).expires_at, r.reason is null, r.reason,
           private.is_member((r.inv).household_id)
    from public.households h left join public.profiles p on p.id = (r.inv).created_by
    where h.id = (r.inv).household_id;
end $$;

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  r record;
  v_existing public.household_members;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into r from private.check_invitation(p_token);
  if r.reason is not null then
    raise exception 'invitation_%', r.reason using errcode = '22023';
  end if;
  -- lock the invitation row so concurrent accepts cannot exceed max_uses
  perform 1 from public.household_invitations where id = (r.inv).id for update;
  select * into v_existing from public.household_members
    where household_id = (r.inv).household_id and user_id = v_uid;
  if v_existing.user_id is not null and v_existing.status = 'active' then
    return (r.inv).household_id; -- already a member: do not consume the invitation
  end if;
  update public.household_invitations
     set use_count = use_count + 1, last_used_at = now()
   where id = (r.inv).id and use_count < max_uses;
  if not found then
    raise exception 'invitation_used' using errcode = '22023';
  end if;
  insert into public.household_members (household_id, user_id, role, status, joined_at, left_at)
  values ((r.inv).household_id, v_uid, 'member', 'active', now(), null)
  on conflict (household_id, user_id) do update
    set status = 'active', role = 'member', joined_at = now(), left_at = null;
  return (r.inv).household_id;
end $$;

create or replace function private.release_member_assignments(p_household uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Implemented in the tasks migration (replaced there); no-op placeholder keeps dependencies simple.
  return;
end $$;

create or replace function public.remove_member(p_household uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin(p_household);
  if p_user = (select auth.uid()) then
    raise exception 'use_leave_household' using errcode = '22023';
  end if;
  update public.household_members set status = 'removed', left_at = now()
   where household_id = p_household and user_id = p_user and status = 'active';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform private.release_member_assignments(p_household, p_user);
end $$;

create or replace function public.leave_household(p_household uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  perform private.require_member(p_household);
  -- the keep-admin trigger rejects this when the caller is the last admin
  update public.household_members set status = 'left', left_at = now()
   where household_id = p_household and user_id = v_uid;
  perform private.release_member_assignments(p_household, v_uid);
end $$;

create or replace function public.set_member_role(p_household uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin(p_household);
  if p_role not in ('admin', 'member') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  update public.household_members set role = p_role
   where household_id = p_household and user_id = p_user and status = 'active';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end $$;

-- Controlled admin handover: the new admin is promoted first, then the caller is demoted.
create or replace function public.transfer_admin(p_household uuid, p_new_admin uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  perform private.require_admin(p_household);
  if p_new_admin = v_uid then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  update public.household_members set role = 'admin'
   where household_id = p_household and user_id = p_new_admin and status = 'active';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.household_members set role = 'member'
   where household_id = p_household and user_id = v_uid;
end $$;

-- Function privileges: nothing is callable by anonymous users.
revoke execute on all functions in schema private from public, anon;
grant execute on function private.my_household_ids(), private.my_admin_household_ids(),
  private.co_member_ids(), private.is_member(uuid), private.is_admin(uuid),
  private.is_active_member(uuid, uuid), private.normalize_name(text) to authenticated, service_role;

revoke execute on function public.create_household(text, text, text, text, text),
  public.create_invitation(uuid, text, int, int), public.revoke_invitation(uuid),
  public.get_invitation_preview(text), public.accept_invitation(text),
  public.remove_member(uuid, uuid), public.leave_household(uuid),
  public.set_member_role(uuid, uuid, text), public.transfer_admin(uuid, uuid)
  from public, anon;
grant execute on function public.create_household(text, text, text, text, text),
  public.create_invitation(uuid, text, int, int), public.revoke_invitation(uuid),
  public.get_invitation_preview(text), public.accept_invitation(text),
  public.remove_member(uuid, uuid), public.leave_household(uuid),
  public.set_member_role(uuid, uuid, text), public.transfer_admin(uuid, uuid)
  to authenticated;
