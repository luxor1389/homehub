-- HomeHub · 0003 · Tasks: definitions, recurrence, occurrences, manual assignment, checklists, comments

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  category text not null default 'other' check (category in
    ('cleaning', 'maintenance', 'shopping', 'cooking', 'bills', 'vehicles', 'pets', 'plants', 'other')),
  subcategory text check (char_length(subcategory) <= 60),
  room_id uuid,
  vehicle_id uuid,
  pet_id uuid,
  plant_id uuid,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  estimated_minutes int check (estimated_minutes between 1 and 1440),
  -- recurrence definition (an RRULE subset). Individual executions live in task_occurrences.
  start_date date not null,
  due_time time,
  recurrence_freq text not null default 'none' check (recurrence_freq in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  recurrence_interval int not null default 1 check (recurrence_interval between 1 and 365),
  recurrence_weekdays smallint[] check (recurrence_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  recurrence_until date,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  check (recurrence_until is null or recurrence_until >= start_date),
  foreign key (room_id, household_id) references public.rooms (id, household_id) on delete set null (room_id),
  foreign key (vehicle_id, household_id) references public.vehicles (id, household_id) on delete set null (vehicle_id),
  foreign key (pet_id, household_id) references public.pets (id, household_id) on delete set null (pet_id),
  foreign key (plant_id, household_id) references public.plants (id, household_id) on delete set null (plant_id)
);
create index tasks_household_idx on public.tasks (household_id) where archived_at is null;
select private.attach_standard_triggers('public.tasks');
select private.apply_household_rls('public.tasks', true);

-- Default (series-level) responsible members.
create table public.task_assignees (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  task_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (task_id, user_id),
  foreign key (task_id, household_id) references public.tasks (id, household_id) on delete cascade,
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);
create index task_assignees_user_idx on public.task_assignees (household_id, user_id);
select private.apply_household_rls('public.task_assignees');

create table public.task_occurrences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  task_id uuid not null,
  -- the slot produced by the recurrence rule; never changes, makes generation idempotent
  scheduled_date date not null,
  due_date date not null,
  due_time time,
  due_at timestamptz not null, -- computed from due_date/due_time in the household time zone
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'done', 'cancelled')),
  title_override text check (char_length(btrim(title_override)) between 1 and 200),
  description_override text check (char_length(description_override) <= 5000),
  priority_override text check (priority_override in ('low', 'normal', 'high', 'urgent')),
  estimated_minutes_override int check (estimated_minutes_override between 1 and 1440),
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  unique (task_id, scheduled_date),
  foreign key (task_id, household_id) references public.tasks (id, household_id) on delete cascade
);
create index task_occurrences_household_due_idx on public.task_occurrences (household_id, due_date);
create index task_occurrences_open_idx on public.task_occurrences (household_id, due_at) where status in ('planned', 'in_progress');
create index task_occurrences_task_idx on public.task_occurrences (task_id, scheduled_date);
create trigger task_occurrences_updated_at before update on public.task_occurrences
  for each row execute function private.set_updated_at();
alter table public.task_occurrences enable row level security;
create policy hh_select on public.task_occurrences for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy hh_update on public.task_occurrences for update to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));
-- occurrences are created by the generator and never hard-deleted by clients (cancel instead)
revoke all on public.task_occurrences from anon;
revoke insert, delete on public.task_occurrences from authenticated;
revoke update on public.task_occurrences from authenticated;
grant update (status, title_override, description_override, priority_override, estimated_minutes_override,
              due_date, due_time) on public.task_occurrences to authenticated;

-- Actual responsible members per occurrence (copied from task_assignees, can be changed per occurrence).
create table public.task_occurrence_assignees (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  occurrence_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (occurrence_id, user_id),
  foreign key (occurrence_id, household_id) references public.task_occurrences (id, household_id) on delete cascade,
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);
create index task_occurrence_assignees_user_idx on public.task_occurrence_assignees (household_id, user_id);
select private.apply_household_rls('public.task_occurrence_assignees');

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  task_id uuid not null,
  position int not null default 0,
  label text not null check (char_length(btrim(label)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (task_id, household_id) references public.tasks (id, household_id) on delete cascade
);
create index task_checklist_items_task_idx on public.task_checklist_items (task_id, position);
create trigger task_checklist_items_updated_at before update on public.task_checklist_items
  for each row execute function private.set_updated_at();
create trigger task_checklist_items_row_guard before insert or update on public.task_checklist_items
  for each row execute function private.row_guard();
select private.apply_household_rls('public.task_checklist_items');

-- Per-occurrence progress of checklist steps.
create table public.task_checklist_progress (
  household_id uuid not null,
  occurrence_id uuid not null,
  item_id uuid not null,
  done_by uuid references public.profiles (id) on delete set null,
  done_at timestamptz not null default now(),
  primary key (occurrence_id, item_id),
  foreign key (occurrence_id, household_id) references public.task_occurrences (id, household_id) on delete cascade,
  foreign key (item_id, household_id) references public.task_checklist_items (id, household_id) on delete cascade
);
select private.apply_household_rls('public.task_checklist_progress');
create or replace function private.checklist_progress_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.done_by := coalesce((select auth.uid()), new.done_by);
  new.done_at := now();
  return new;
end $$;
create trigger task_checklist_progress_stamp before insert or update on public.task_checklist_progress
  for each row execute function private.checklist_progress_stamp();

-- Comments, agreements (agreed deadline) and swap records.
create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  task_id uuid not null,
  occurrence_id uuid,
  kind text not null default 'comment' check (kind in ('comment', 'agreement', 'swap')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  agreed_due_date date,
  swap_with uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, household_id) references public.tasks (id, household_id) on delete cascade,
  foreign key (occurrence_id, household_id) references public.task_occurrences (id, household_id) on delete set null (occurrence_id),
  foreign key (household_id, swap_with) references public.household_members (household_id, user_id) on delete set null (swap_with),
  check (kind <> 'agreement' or agreed_due_date is not null),
  check (kind <> 'swap' or swap_with is not null)
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);
select private.attach_standard_triggers('public.task_comments');
alter table public.task_comments enable row level security;
create policy hh_select on public.task_comments for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy hh_insert on public.task_comments for insert to authenticated
  with check (household_id in (select private.my_household_ids()) and created_by = (select auth.uid()));
-- only the author may edit or delete their own comment
create policy own_update on public.task_comments for update to authenticated
  using (household_id in (select private.my_household_ids()) and created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));
create policy own_delete on public.task_comments for delete to authenticated
  using (household_id in (select private.my_household_ids()) and created_by = (select auth.uid()));
revoke all on public.task_comments from anon;

-- Reusable task templates (user-created; built-in cleaning presets live in the app's translations).
create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  category text not null default 'cleaning' check (category in
    ('cleaning', 'maintenance', 'shopping', 'cooking', 'bills', 'vehicles', 'pets', 'plants', 'other')),
  subcategory text check (char_length(subcategory) <= 60),
  room_id uuid,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  estimated_minutes int check (estimated_minutes between 1 and 1440),
  recurrence_freq text not null default 'weekly' check (recurrence_freq in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  recurrence_interval int not null default 1 check (recurrence_interval between 1 and 365),
  recurrence_weekdays smallint[] check (recurrence_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  checklist text[] not null default '{}',
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (room_id, household_id) references public.rooms (id, household_id) on delete set null (room_id)
);
select private.attach_standard_triggers('public.task_templates');
select private.apply_household_rls('public.task_templates');

-- ---------------------------------------------------------------------------
-- Assignment guard: only ACTIVE members can be newly assigned.
-- ---------------------------------------------------------------------------
create or replace function private.assignee_must_be_active()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active_member(new.household_id, new.user_id) then
    raise exception 'assignee_not_active_member' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger task_assignees_active before insert on public.task_assignees
  for each row execute function private.assignee_must_be_active();
create trigger task_occurrence_assignees_active before insert on public.task_occurrence_assignees
  for each row execute function private.assignee_must_be_active();

-- ---------------------------------------------------------------------------
-- Recurrence
-- ---------------------------------------------------------------------------
create or replace function private.household_today(p_household uuid)
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone h.timezone)::date from public.households h where h.id = p_household;
$$;

create or replace function private.compute_due_at(p_household uuid, p_date date, p_time time)
returns timestamptz language sql stable security definer set search_path = '' as $$
  -- tasks without a time are due at the end of the day in the household's time zone
  select ((p_date + coalesce(p_time, time '23:59:59'))::timestamp at time zone h.timezone)
  from public.households h where h.id = p_household;
$$;

-- All slots of a recurrence rule within [p_from, p_to] (at most p_max).
create or replace function private.recurrence_slots(
  p_start date, p_freq text, p_interval int, p_weekdays smallint[], p_until date,
  p_from date, p_to date, p_max int default 500)
returns setof date language plpgsql immutable set search_path = '' as $$
declare
  v_to date := p_to;
  v_n int := greatest(coalesce(p_interval, 1), 1);
  v_k int;
  v_d date;
  v_cnt int := 0;
  v_week0 date;
  v_days smallint[];
  v_wd smallint;
  v_months int;
begin
  if p_until is not null and p_until < v_to then v_to := p_until; end if;
  if p_freq = 'none' then
    if p_start between p_from and v_to then return next p_start; end if;
    return;
  end if;
  if v_to < p_from then return; end if;

  if p_freq = 'daily' then
    v_k := greatest(0, ceil((p_from - p_start)::numeric / v_n)::int);
    loop
      v_d := p_start + v_k * v_n;
      exit when v_d > v_to or v_cnt >= p_max;
      return next v_d; v_cnt := v_cnt + 1; v_k := v_k + 1;
    end loop;
  elsif p_freq = 'weekly' then
    select coalesce(array_agg(distinct x order by x), array[extract(isodow from p_start)::smallint])
      into v_days from unnest(p_weekdays) x;
    v_week0 := p_start - (extract(isodow from p_start)::int - 1); -- Monday of the start week
    v_k := greatest(0, floor(((p_from - v_week0)::numeric / 7) / v_n)::int);
    loop
      exit when v_week0 + v_k * v_n * 7 > v_to or v_cnt >= p_max;
      foreach v_wd in array v_days loop
        v_d := v_week0 + v_k * v_n * 7 + (v_wd - 1);
        if v_d >= p_start and v_d >= p_from and v_d <= v_to and v_cnt < p_max then
          return next v_d; v_cnt := v_cnt + 1;
        end if;
      end loop;
      v_k := v_k + 1;
    end loop;
  else -- monthly / yearly: always computed from the anchor so 31st stays 31st when possible
    v_months := case when p_freq = 'yearly' then 12 * v_n else v_n end;
    v_k := greatest(0, ((extract(year from p_from)::int * 12 + extract(month from p_from)::int)
                      - (extract(year from p_start)::int * 12 + extract(month from p_start)::int)) / v_months - 1);
    loop
      v_d := (p_start + make_interval(months => v_k * v_months))::date;
      exit when v_d > v_to or v_cnt >= p_max;
      if v_d >= p_from then return next v_d; v_cnt := v_cnt + 1; end if;
      v_k := v_k + 1;
    end loop;
  end if;
end $$;

-- Idempotently materialises occurrences for a task: every slot from p_from (default: today, or the
-- start date for one-off tasks) up to 60 days ahead, plus the next slot beyond that window if none
-- is upcoming. The unique (task_id, scheduled_date) key prevents duplicates under concurrency.
create or replace function private.ensure_task_occurrences(p_task uuid, p_from date default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks;
  v_today date;
  v_from date;
  v_horizon date;
  v_slots date[];
  v_next date;
  v_count int := 0;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null or t.archived_at is not null then return 0; end if;
  v_today := private.household_today(t.household_id);
  v_horizon := v_today + 60;
  v_from := coalesce(p_from, case when t.recurrence_freq = 'none' then t.start_date
                                  else greatest(t.start_date, v_today) end);

  select coalesce(array_agg(s), '{}') into v_slots
  from private.recurrence_slots(t.start_date, t.recurrence_freq, t.recurrence_interval, t.recurrence_weekdays,
                                t.recurrence_until, v_from, v_horizon) s;

  perform set_config('homehub.bulk', 'on', true);
  with ins as (
    insert into public.task_occurrences (household_id, task_id, scheduled_date, due_date, due_time, due_at)
    select t.household_id, t.id, s, s, t.due_time, private.compute_due_at(t.household_id, s, t.due_time)
    from unnest(v_slots) s
    on conflict (task_id, scheduled_date) do nothing
    returning id
  ), ins_assignees as (
    insert into public.task_occurrence_assignees (household_id, occurrence_id, user_id)
    select t.household_id, ins.id, a.user_id
    from ins cross join public.task_assignees a
    join public.household_members m on m.household_id = a.household_id and m.user_id = a.user_id and m.status = 'active'
    where a.task_id = t.id
    on conflict do nothing
  )
  select count(*) into v_count from ins;

  -- Recurring tasks always keep one open upcoming occurrence (e.g. a yearly task whose next slot lies
  -- beyond the 60-day window, or after the current one was completed early).
  if t.recurrence_freq <> 'none' and not exists (
       select 1 from public.task_occurrences
        where task_id = t.id and status in ('planned', 'in_progress') and scheduled_date >= v_today) then
    select s into v_next
      from private.recurrence_slots(t.start_date, t.recurrence_freq, t.recurrence_interval, t.recurrence_weekdays,
             t.recurrence_until,
             greatest(v_from, v_today, coalesce((select max(scheduled_date) + 1 from public.task_occurrences where task_id = t.id), v_today)),
             v_today + 3700, 1) s;
    if v_next is not null then
      with ins as (
        insert into public.task_occurrences (household_id, task_id, scheduled_date, due_date, due_time, due_at)
        values (t.household_id, t.id, v_next, v_next, t.due_time, private.compute_due_at(t.household_id, v_next, t.due_time))
        on conflict (task_id, scheduled_date) do nothing
        returning id
      )
      insert into public.task_occurrence_assignees (household_id, occurrence_id, user_id)
      select t.household_id, ins.id, a.user_id
      from ins cross join public.task_assignees a
      join public.household_members m on m.household_id = a.household_id and m.user_id = a.user_id and m.status = 'active'
      where a.task_id = t.id
      on conflict do nothing;
      v_count := v_count + 1;
    end if;
  end if;
  perform set_config('homehub.bulk', 'off', true);
  return v_count;
end $$;

create or replace function private.ensure_household_occurrences(p_household uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_total int := 0; r record;
begin
  for r in select id from public.tasks
           where household_id = p_household and archived_at is null and recurrence_freq <> 'none' loop
    v_total := v_total + private.ensure_task_occurrences(r.id);
  end loop;
  return v_total;
end $$;

-- Called by the app on load and by the scheduler; safe to call repeatedly.
create or replace function public.ensure_occurrences(p_household uuid)
returns int language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(p_household);
  return private.ensure_household_occurrences(p_household);
end $$;

create or replace function private.ensure_all_occurrences()
returns int language plpgsql security definer set search_path = '' as $$
declare v_total int := 0; r record;
begin
  for r in select id from public.households where archived_at is null loop
    v_total := v_total + private.ensure_household_occurrences(r.id);
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- Occurrence guard: freezes identity columns, keeps due_at in sync, stamps who/when on status change.
-- ---------------------------------------------------------------------------
create or replace function private.occurrence_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.household_id := old.household_id;
    new.task_id := old.task_id;
    new.scheduled_date := old.scheduled_date;
    new.created_at := old.created_at;
    if new.status is distinct from old.status then
      new.completed_at := null; new.completed_by := null;
      new.cancelled_at := null; new.cancelled_by := null;
      if new.status = 'done' then
        new.completed_at := now(); new.completed_by := v_uid;
      elsif new.status = 'cancelled' then
        new.cancelled_at := now(); new.cancelled_by := v_uid;
      elsif new.status = 'in_progress' then
        new.started_at := coalesce(old.started_at, now());
      end if;
    else
      new.completed_at := old.completed_at; new.completed_by := old.completed_by;
      new.cancelled_at := old.cancelled_at; new.cancelled_by := old.cancelled_by;
      new.started_at := old.started_at;
    end if;
  end if;
  if tg_op = 'INSERT' or new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time then
    new.due_at := private.compute_due_at(new.household_id, new.due_date, new.due_time);
  end if;
  return new;
end $$;
create trigger task_occurrences_guard before insert or update on public.task_occurrences
  for each row execute function private.occurrence_guard();

-- After completing/cancelling an occurrence of a recurring task make sure the next one exists.
create or replace function private.occurrence_after_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('done', 'cancelled') and old.status is distinct from new.status then
    perform private.ensure_task_occurrences(new.task_id);
  end if;
  return null;
end $$;
create trigger task_occurrences_after_status after update of status on public.task_occurrences
  for each row execute function private.occurrence_after_status();

-- Time-zone change of a household re-computes due_at of open occurrences.
create or replace function private.household_tz_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.timezone is distinct from old.timezone then
    update public.task_occurrences o
       set due_at = ((o.due_date + coalesce(o.due_time, time '23:59:59'))::timestamp at time zone new.timezone)
     where o.household_id = new.id and o.status in ('planned', 'in_progress');
  end if;
  return null;
end $$;
create trigger households_tz_changed after update of timezone on public.households
  for each row execute function private.household_tz_changed();

-- When a member leaves or is removed their open assignments are released (task becomes unassigned
-- or stays with the remaining members). Completed history is kept.
create or replace function private.release_member_assignments(p_household uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.task_assignees where household_id = p_household and user_id = p_user;
  delete from public.task_occurrence_assignees oa
   using public.task_occurrences o
   where oa.occurrence_id = o.id and oa.household_id = p_household and oa.user_id = p_user
     and o.status in ('planned', 'in_progress');
end $$;

-- ---------------------------------------------------------------------------
-- Read model: occurrences joined with their task definition.
-- ---------------------------------------------------------------------------
create view public.task_occurrence_view with (security_invoker = true) as
select
  o.id, o.household_id, o.task_id, o.scheduled_date, o.due_date, o.due_time, o.due_at, o.status,
  (o.status in ('planned', 'in_progress') and o.due_at < now()) as is_overdue,
  coalesce(o.title_override, t.title) as title,
  coalesce(o.description_override, t.description) as description,
  t.category, t.subcategory, t.room_id, t.vehicle_id, t.pet_id, t.plant_id,
  coalesce(o.priority_override, t.priority) as priority,
  coalesce(o.estimated_minutes_override, t.estimated_minutes) as estimated_minutes,
  t.recurrence_freq, t.recurrence_interval,
  (o.title_override is not null or o.description_override is not null or o.priority_override is not null
     or o.estimated_minutes_override is not null or o.due_date <> o.scheduled_date) as has_overrides,
  o.started_at, o.completed_at, o.completed_by, o.cancelled_at, o.cancelled_by,
  coalesce((select array_agg(a.user_id order by a.created_at) from public.task_occurrence_assignees a
            where a.occurrence_id = o.id), '{}') as assignee_ids,
  o.created_at, o.updated_at, t.created_by
from public.task_occurrences o
join public.tasks t on t.id = o.task_id
where t.archived_at is null;
revoke all on public.task_occurrence_view from anon;

-- ---------------------------------------------------------------------------
-- Task RPCs. Notifications are created inside these functions so bulk generation never spams.
-- ---------------------------------------------------------------------------
create or replace function private.validate_assignees(p_household uuid, p_assignees uuid[])
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare v_clean uuid[];
begin
  select coalesce(array_agg(distinct u), '{}') into v_clean from unnest(coalesce(p_assignees, '{}')) u where u is not null;
  if exists (select 1 from unnest(v_clean) u where not private.is_active_member(p_household, u)) then
    raise exception 'assignee_not_active_member' using errcode = '23514';
  end if;
  return v_clean;
end $$;

-- Overwritten by the notifications migration; defined here so task RPCs compile.
create or replace function private.notify(p_household uuid, p_users uuid[], p_type text, p_entity_type text,
  p_entity_id uuid, p_params jsonb, p_dedupe text default null)
returns void language plpgsql security definer set search_path = '' as $$ begin return; end $$;

create or replace function public.create_task(
  p_household uuid, p_data jsonb, p_assignees uuid[] default '{}', p_checklist text[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_assignees uuid[];
  v_first uuid;
begin
  perform private.require_member(p_household);
  v_assignees := private.validate_assignees(p_household, p_assignees);

  insert into public.tasks (household_id, title, description, category, subcategory, room_id, vehicle_id, pet_id,
    plant_id, priority, estimated_minutes, start_date, due_time, recurrence_freq, recurrence_interval,
    recurrence_weekdays, recurrence_until, created_by, updated_by)
  values (p_household, btrim(p_data ->> 'title'), nullif(btrim(p_data ->> 'description'), ''),
    coalesce(p_data ->> 'category', 'other'), nullif(btrim(p_data ->> 'subcategory'), ''),
    (p_data ->> 'room_id')::uuid, (p_data ->> 'vehicle_id')::uuid, (p_data ->> 'pet_id')::uuid,
    (p_data ->> 'plant_id')::uuid, coalesce(p_data ->> 'priority', 'normal'),
    (p_data ->> 'estimated_minutes')::int,
    coalesce((p_data ->> 'start_date')::date, private.household_today(p_household)),
    (p_data ->> 'due_time')::time, coalesce(p_data ->> 'recurrence_freq', 'none'),
    coalesce((p_data ->> 'recurrence_interval')::int, 1),
    case when jsonb_typeof(p_data -> 'recurrence_weekdays') = 'array'
         then array(select jsonb_array_elements_text(p_data -> 'recurrence_weekdays')::smallint) end,
    (p_data ->> 'recurrence_until')::date, v_uid, v_uid)
  returning id into v_id;

  insert into public.task_assignees (household_id, task_id, user_id)
  select p_household, v_id, u from unnest(v_assignees) u;

  insert into public.task_checklist_items (household_id, task_id, position, label)
  select p_household, v_id, ord::int, btrim(l)
  from unnest(coalesce(p_checklist, '{}')) with ordinality as c(l, ord) where btrim(l) <> '';

  perform private.ensure_task_occurrences(v_id);

  select id into v_first from public.task_occurrences where task_id = v_id
   order by (status in ('planned', 'in_progress')) desc, scheduled_date limit 1;
  perform private.notify(p_household, array(select u from unnest(v_assignees) u where u <> v_uid),
    'task_assigned', 'task_occurrence', v_first,
    jsonb_build_object('title', btrim(p_data ->> 'title'), 'task_id', v_id), 'task_assigned:' || v_id::text);
  return v_id;
end $$;

-- Edit a task. p_scope = 'this' changes only the given occurrence; 'future' changes the series from this
-- occurrence on (and the definition). For one-off tasks both scopes behave the same.
create or replace function public.update_task(
  p_occurrence uuid, p_scope text, p_data jsonb, p_assignees uuid[] default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  o public.task_occurrences;
  t public.tasks;
  t_new public.tasks;
  v_assignees uuid[];
  v_old_assignees uuid[];
  v_rule_changed boolean;
  v_new_start date;
  v_old_due date;
  v_title text;
begin
  select * into o from public.task_occurrences where id = p_occurrence;
  if o.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(o.household_id);
  select * into t from public.tasks where id = o.task_id;
  if t.archived_at is not null then raise exception 'task_archived' using errcode = '22023'; end if;
  if p_scope not in ('this', 'future') then raise exception 'invalid_scope' using errcode = '22023'; end if;
  if p_assignees is not null then
    v_assignees := private.validate_assignees(o.household_id, p_assignees);
  end if;
  select coalesce(array_agg(user_id), '{}') into v_old_assignees
    from public.task_occurrence_assignees where occurrence_id = o.id;
  v_old_due := o.due_date;

  if p_scope = 'this' and t.recurrence_freq <> 'none' then
    update public.task_occurrences set
      title_override = case when p_data ? 'title' then nullif(nullif(btrim(p_data ->> 'title'), ''), t.title) else title_override end,
      description_override = case when p_data ? 'description' then nullif(nullif(btrim(p_data ->> 'description'), ''), t.description) else description_override end,
      priority_override = case when p_data ? 'priority' then nullif(p_data ->> 'priority', t.priority) else priority_override end,
      estimated_minutes_override = case when p_data ? 'estimated_minutes'
        then nullif((p_data ->> 'estimated_minutes')::int, t.estimated_minutes) else estimated_minutes_override end,
      due_date = coalesce((p_data ->> 'due_date')::date, due_date),
      due_time = case when p_data ? 'due_time' then (p_data ->> 'due_time')::time else due_time end
    where id = o.id;
    if v_assignees is not null then
      delete from public.task_occurrence_assignees where occurrence_id = o.id and user_id <> all (v_assignees);
      insert into public.task_occurrence_assignees (household_id, occurrence_id, user_id)
      select o.household_id, o.id, u from unnest(v_assignees) u on conflict do nothing;
    end if;
  else
    update public.tasks set
      title = coalesce(nullif(btrim(p_data ->> 'title'), ''), title),
      description = case when p_data ? 'description' then nullif(btrim(p_data ->> 'description'), '') else description end,
      category = coalesce(p_data ->> 'category', category),
      subcategory = case when p_data ? 'subcategory' then nullif(btrim(p_data ->> 'subcategory'), '') else subcategory end,
      room_id = case when p_data ? 'room_id' then (p_data ->> 'room_id')::uuid else room_id end,
      vehicle_id = case when p_data ? 'vehicle_id' then (p_data ->> 'vehicle_id')::uuid else vehicle_id end,
      pet_id = case when p_data ? 'pet_id' then (p_data ->> 'pet_id')::uuid else pet_id end,
      plant_id = case when p_data ? 'plant_id' then (p_data ->> 'plant_id')::uuid else plant_id end,
      priority = coalesce(p_data ->> 'priority', priority),
      estimated_minutes = case when p_data ? 'estimated_minutes' then (p_data ->> 'estimated_minutes')::int else estimated_minutes end,
      due_time = case when p_data ? 'due_time' then (p_data ->> 'due_time')::time else due_time end,
      recurrence_freq = coalesce(p_data ->> 'recurrence_freq', recurrence_freq),
      recurrence_interval = coalesce((p_data ->> 'recurrence_interval')::int, recurrence_interval),
      recurrence_weekdays = case when p_data ? 'recurrence_weekdays' then
        case when jsonb_typeof(p_data -> 'recurrence_weekdays') = 'array'
             then array(select jsonb_array_elements_text(p_data -> 'recurrence_weekdays')::smallint) end
        else recurrence_weekdays end,
      recurrence_until = case when p_data ? 'recurrence_until' then (p_data ->> 'recurrence_until')::date else recurrence_until end,
      updated_by = v_uid
    where id = t.id
    returning * into t_new;

    v_rule_changed := t_new.recurrence_freq is distinct from t.recurrence_freq
      or t_new.recurrence_interval is distinct from t.recurrence_interval
      or t_new.recurrence_weekdays is distinct from t.recurrence_weekdays
      or t_new.recurrence_until is distinct from t.recurrence_until
      or ((p_data ->> 'due_date')::date is not null and (p_data ->> 'due_date')::date <> o.due_date);

    if v_assignees is not null then
      delete from public.task_assignees where task_id = t.id and user_id <> all (v_assignees);
      insert into public.task_assignees (household_id, task_id, user_id)
      select t.household_id, t.id, u from unnest(v_assignees) u on conflict do nothing;
    end if;

    if t.recurrence_freq = 'none' and t_new.recurrence_freq = 'none' then
      -- one-off task: definition and its single occurrence move together
      v_new_start := coalesce((p_data ->> 'due_date')::date, o.due_date);
      update public.tasks set start_date = v_new_start where id = t.id;
      update public.task_occurrences set due_date = v_new_start, due_time = t_new.due_time,
        title_override = null, description_override = null, priority_override = null, estimated_minutes_override = null
      where id = o.id;
      if v_assignees is not null then
        delete from public.task_occurrence_assignees where occurrence_id = o.id and user_id <> all (v_assignees);
        insert into public.task_occurrence_assignees (household_id, occurrence_id, user_id)
        select o.household_id, o.id, u from unnest(v_assignees) u on conflict do nothing;
      end if;
    else
      if v_rule_changed then
        v_new_start := coalesce((p_data ->> 'due_date')::date, o.due_date);
        update public.tasks set start_date = v_new_start where id = t.id;
      else
        v_new_start := o.scheduled_date;
      end if;
      -- drop untouched future slots of the old series; done/in-progress history stays
      delete from public.task_occurrences
       where task_id = t.id and scheduled_date >= o.scheduled_date and status = 'planned';
      perform private.ensure_task_occurrences(t.id, v_new_start);
      -- in-progress occurrences after the pivot follow the new definition too
      update public.task_occurrences set due_time = t_new.due_time,
        title_override = null, description_override = null, priority_override = null, estimated_minutes_override = null
       where task_id = t.id and scheduled_date >= o.scheduled_date and status = 'in_progress';
      if v_assignees is not null then
        delete from public.task_occurrence_assignees oa using public.task_occurrences x
         where oa.occurrence_id = x.id and x.task_id = t.id and x.scheduled_date >= o.scheduled_date
           and x.status = 'in_progress' and oa.user_id <> all (v_assignees);
        insert into public.task_occurrence_assignees (household_id, occurrence_id, user_id)
        select t.household_id, x.id, u from public.task_occurrences x cross join unnest(v_assignees) u
         where x.task_id = t.id and x.scheduled_date >= o.scheduled_date and x.status = 'in_progress'
        on conflict do nothing;
      end if;
    end if;
  end if;

  -- notifications (only to other people, once per edit)
  select title into v_title from public.task_occurrence_view where id = o.id;
  if v_title is null then select title into v_title from public.tasks where id = t.id; end if;
  if v_assignees is not null then
    perform private.notify(o.household_id,
      array(select u from unnest(v_assignees) u where u <> v_uid and u <> all (v_old_assignees)),
      'task_assigned', 'task_occurrence', o.id, jsonb_build_object('title', v_title, 'task_id', t.id), null);
  end if;
  if (p_data ->> 'due_date')::date is not null and (p_data ->> 'due_date')::date <> v_old_due then
    perform private.notify(o.household_id,
      array(select u from unnest(coalesce(v_assignees, v_old_assignees)) u where u <> v_uid),
      'task_due_changed', 'task_occurrence', o.id,
      jsonb_build_object('title', v_title, 'task_id', t.id, 'from', v_old_due, 'to', (p_data ->> 'due_date')::date), null);
  end if;
end $$;

-- Archive (soft delete) a task: future planned occurrences are removed, history is kept.
create or replace function public.archive_task(p_task uuid, p_archive boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(t.household_id);
  if p_archive then
    update public.tasks set archived_at = coalesce(archived_at, now()) where id = p_task;
    delete from public.task_occurrences
     where task_id = p_task and status = 'planned' and due_date >= private.household_today(t.household_id);
  else
    update public.tasks set archived_at = null where id = p_task;
    perform private.ensure_task_occurrences(p_task);
  end if;
end $$;

-- Create a recurring task from a template.
create or replace function public.create_task_from_template(
  p_template uuid, p_start date default null, p_assignees uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare tt public.task_templates;
begin
  select * into tt from public.task_templates where id = p_template;
  if tt.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(tt.household_id);
  return public.create_task(tt.household_id, jsonb_build_object(
    'title', tt.title, 'description', tt.description, 'category', tt.category, 'subcategory', tt.subcategory,
    'room_id', tt.room_id, 'priority', tt.priority, 'estimated_minutes', tt.estimated_minutes,
    'start_date', coalesce(p_start, private.household_today(tt.household_id)),
    'recurrence_freq', tt.recurrence_freq, 'recurrence_interval', tt.recurrence_interval,
    'recurrence_weekdays', to_jsonb(tt.recurrence_weekdays)), p_assignees, tt.checklist);
end $$;

revoke execute on all functions in schema private from public, anon;
grant execute on function private.my_household_ids(), private.my_admin_household_ids(),
  private.co_member_ids(), private.is_member(uuid), private.is_admin(uuid),
  private.is_active_member(uuid, uuid), private.normalize_name(text) to authenticated, service_role;
revoke execute on function public.ensure_occurrences(uuid), public.create_task(uuid, jsonb, uuid[], text[]),
  public.update_task(uuid, text, jsonb, uuid[]), public.archive_task(uuid, boolean),
  public.create_task_from_template(uuid, date, uuid[]) from public, anon;
grant execute on function public.ensure_occurrences(uuid), public.create_task(uuid, jsonb, uuid[], text[]),
  public.update_task(uuid, text, jsonb, uuid[]), public.archive_task(uuid, boolean),
  public.create_task_from_template(uuid, date, uuid[]) to authenticated;
