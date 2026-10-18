-- HomeHub · 0006 · Attachments + private storage, notifications, activity log, reminders, realtime

-- ---------------------------------------------------------------------------
-- Attachments (metadata). Files live in the private bucket `household-files` under `<household_id>/...`.
-- ---------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  entity_type text not null check (entity_type in ('bill', 'expense', 'vehicle', 'vehicle_maintenance', 'pet',
    'pet_care_record', 'plant', 'task', 'recipe')),
  entity_id uuid not null,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path like household_id::text || '/%')
);
create index attachments_entity_idx on public.attachments (household_id, entity_type, entity_id);
select private.attach_standard_triggers('public.attachments');
select private.apply_household_rls('public.attachments');

-- The referenced entity must exist in the same household (polymorphic reference, checked by trigger).
create or replace function private.attachment_entity_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_table text := case new.entity_type
    when 'bill' then 'bills' when 'expense' then 'expenses' when 'vehicle' then 'vehicles'
    when 'vehicle_maintenance' then 'vehicle_maintenance' when 'pet' then 'pets'
    when 'pet_care_record' then 'pet_care_records' when 'plant' then 'plants'
    when 'task' then 'tasks' when 'recipe' then 'recipes' end;
  v_ok boolean;
begin
  execute format('select exists (select 1 from public.%I where id = $1 and household_id = $2)', v_table)
    into v_ok using new.entity_id, new.household_id;
  if not v_ok then
    raise exception 'attachment_entity_mismatch' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger attachments_entity_check before insert or update on public.attachments
  for each row execute function private.attachment_entity_check();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('household-files', 'household-files', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "household files: members read" on storage.objects for select to authenticated
  using (bucket_id = 'household-files'
         and (storage.foldername(name))[1] in (select id::text from private.my_household_ids() id));
create policy "household files: members upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'household-files'
         and (storage.foldername(name))[1] in (select id::text from private.my_household_ids() id));
create policy "household files: members update" on storage.objects for update to authenticated
  using (bucket_id = 'household-files'
         and (storage.foldername(name))[1] in (select id::text from private.my_household_ids() id))
  with check (bucket_id = 'household-files'
         and (storage.foldername(name))[1] in (select id::text from private.my_household_ids() id));
create policy "household files: members delete" on storage.objects for delete to authenticated
  using (bucket_id = 'household-files'
         and (storage.foldername(name))[1] in (select id::text from private.my_household_ids() id));

-- ---------------------------------------------------------------------------
-- Notifications (in-app). Text is rendered by the client from `type` + `params` in the user's language.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('task_assigned', 'task_due_changed', 'task_due_soon', 'task_overdue',
    'bill_due_soon', 'bill_overdue', 'vehicle_due', 'pet_due', 'plant_due', 'member_joined')),
  entity_type text,
  entity_id uuid,
  params jsonb not null default '{}',
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create policy own_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and household_id in (select private.my_household_ids()));
create policy own_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.notifications from anon;
revoke insert, update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Outbound delivery queue for optional channels. A row is only marked 'sent' by the dispatcher after
-- the provider accepted the message; the UI shows the real status.
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null check (channel in ('email', 'push')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, channel)
);
create index notification_deliveries_pending_idx on public.notification_deliveries (status, created_at) where status = 'pending';
create trigger notification_deliveries_updated_at before update on public.notification_deliveries
  for each row execute function private.set_updated_at();
alter table public.notification_deliveries enable row level security;
create policy own_select on public.notification_deliveries for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.notification_deliveries from anon;
revoke insert, update, delete on public.notification_deliveries from authenticated;

create or replace function private.notify(p_household uuid, p_users uuid[], p_type text, p_entity_type text,
  p_entity_id uuid, p_params jsonb, p_dedupe text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  with ins as (
    insert into public.notifications (household_id, user_id, type, entity_type, entity_id, params, dedupe_key)
    select p_household, u, p_type, p_entity_type, p_entity_id, coalesce(p_params, '{}'),
           case when p_dedupe is null then null else p_dedupe end
    from unnest(coalesce(p_users, '{}')) u
    where private.is_active_member(p_household, u)
    on conflict (user_id, dedupe_key) do nothing
    returning id, user_id
  )
  insert into public.notification_deliveries (notification_id, user_id, channel)
  select ins.id, ins.user_id, 'email' from ins
  join public.profiles p on p.id = ins.user_id and p.email_notifications;
end $$;

-- ---------------------------------------------------------------------------
-- Reminder generator: due-soon/overdue tasks, bills, vehicle dates/km, pet care, plant watering.
-- Idempotent through dedupe keys; run by pg_cron (if available) and on app load for the caller.
-- ---------------------------------------------------------------------------
create or replace function private.generate_reminders(p_household uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.household_today(p_household);
  v_all uuid[];
  r record;
begin
  select coalesce(array_agg(user_id), '{}') into v_all
    from public.household_members where household_id = p_household and status = 'active';

  -- tasks due within 24h / overdue
  for r in
    select o.id, o.task_id, coalesce(o.title_override, t.title) as title, o.due_date, o.due_at,
           coalesce((select array_agg(a.user_id) from public.task_occurrence_assignees a where a.occurrence_id = o.id), '{}') as users
    from public.task_occurrences o join public.tasks t on t.id = o.task_id
    where o.household_id = p_household and t.archived_at is null
      and o.status in ('planned', 'in_progress') and o.due_at < now() + interval '24 hours'
      and o.due_date >= v_today - 30
  loop
    if r.due_at < now() then
      perform private.notify(p_household, case when cardinality(r.users) > 0 then r.users else v_all end,
        'task_overdue', 'task_occurrence', r.id,
        jsonb_build_object('title', r.title, 'due_date', r.due_date, 'task_id', r.task_id), 'task_overdue:' || r.id);
    else
      perform private.notify(p_household, case when cardinality(r.users) > 0 then r.users else v_all end,
        'task_due_soon', 'task_occurrence', r.id,
        jsonb_build_object('title', r.title, 'due_date', r.due_date, 'task_id', r.task_id), 'task_due_soon:' || r.id);
    end if;
  end loop;

  -- bills
  for r in
    select b.* from public.bills b
    where b.household_id = p_household and b.archived_at is null and b.status = 'unpaid'
      and b.due_date <= v_today + b.remind_days_before and b.due_date >= v_today - 60
  loop
    perform private.notify(p_household, case when r.responsible_id is not null then array[r.responsible_id] else v_all end,
      case when r.due_date < v_today then 'bill_overdue' else 'bill_due_soon' end, 'bill', r.id,
      jsonb_build_object('title', r.name, 'due_date', r.due_date, 'amount', r.amount, 'currency', r.currency),
      case when r.due_date < v_today then 'bill_overdue:' else 'bill_due_soon:' end || r.id);
  end loop;

  -- vehicles: dates within 14 days, service by km within 1000 km
  for r in
    select v.id, v.make || coalesce(' ' || v.model, '') || coalesce(' (' || v.plate || ')', '') as title, x.what, x.d
    from public.vehicles v
    cross join lateral (values ('registration', v.registration_expires_on), ('insurance', v.insurance_expires_on),
                               ('inspection', v.inspection_due_on), ('tires', v.next_tire_change_on),
                               ('service', v.next_service_on)) as x(what, d)
    where v.household_id = p_household and v.archived_at is null and x.d is not null and x.d <= v_today + 14
      and x.d >= v_today - 60
  loop
    perform private.notify(p_household, v_all, 'vehicle_due', 'vehicle', r.id,
      jsonb_build_object('title', r.title, 'what', r.what, 'due_date', r.d), 'vehicle:' || r.what || ':' || r.id || ':' || r.d);
  end loop;
  for r in
    select v.id, v.make || coalesce(' ' || v.model, '') || coalesce(' (' || v.plate || ')', '') as title,
           v.next_service_km, v.odometer_km
    from public.vehicles v
    where v.household_id = p_household and v.archived_at is null and v.next_service_km is not null
      and v.odometer_km is not null and v.odometer_km >= v.next_service_km - 1000
  loop
    perform private.notify(p_household, v_all, 'vehicle_due', 'vehicle', r.id,
      jsonb_build_object('title', r.title, 'what', 'service_km', 'km', r.next_service_km, 'odometer', r.odometer_km),
      'vehicle:service_km:' || r.id || ':' || r.next_service_km);
  end loop;

  -- pets: next due care within 3 days (latest record per pet and kind)
  for r in
    select distinct on (c.pet_id, c.kind) c.id, c.pet_id, c.kind, c.next_due_on, p.name
    from public.pet_care_records c join public.pets p on p.id = c.pet_id
    where c.household_id = p_household and p.archived_at is null and c.next_due_on is not null
    order by c.pet_id, c.kind, c.occurred_on desc, c.created_at desc
  loop
    if r.next_due_on <= v_today + 3 and r.next_due_on >= v_today - 30 then
      perform private.notify(p_household, v_all, 'pet_due', 'pet', r.pet_id,
        jsonb_build_object('title', r.name, 'what', r.kind, 'due_date', r.next_due_on),
        'pet:' || r.kind || ':' || r.pet_id || ':' || r.next_due_on);
    end if;
  end loop;

  -- plants: watering due today or earlier
  for r in
    select s.plant_id, p.name, s.next_watering_on
    from public.plant_status s join public.plants p on p.id = s.plant_id
    where s.household_id = p_household and s.next_watering_on is not null and s.next_watering_on <= v_today
  loop
    perform private.notify(p_household, v_all, 'plant_due', 'plant', r.plant_id,
      jsonb_build_object('title', r.name, 'what', 'watering', 'due_date', r.next_watering_on),
      'plant:watering:' || r.plant_id || ':' || r.next_watering_on);
  end loop;
end $$;

-- App-load hook: keeps recurring occurrences generated and reminders up to date for the caller.
create or replace function public.refresh_household(p_household uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(p_household);
  perform private.ensure_household_occurrences(p_household);
  perform private.generate_reminders(p_household);
end $$;

create or replace function private.refresh_all_households()
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.households where archived_at is null loop
    perform private.ensure_household_occurrences(r.id);
    perform private.generate_reminders(r.id);
  end loop;
end $$;

-- New member joined → let the others know.
create or replace function private.member_joined_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    select display_name into v_name from public.profiles where id = new.user_id;
    perform private.notify(new.household_id,
      array(select user_id from public.household_members
             where household_id = new.household_id and status = 'active' and user_id <> new.user_id),
      'member_joined', 'member', new.user_id, jsonb_build_object('name', v_name), null);
  end if;
  return null;
end $$;
create trigger household_members_joined after insert or update of status on public.household_members
  for each row execute function private.member_joined_notify();

-- ---------------------------------------------------------------------------
-- Activity log: who changed what and when. Only labels, field names and status values are stored —
-- never notes, amounts of private records, passwords or tokens.
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  parent_id uuid, -- e.g. the task of an occurrence
  action text not null,
  label text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_log_household_idx on public.activity_log (household_id, created_at desc);
create index activity_log_parent_idx on public.activity_log (household_id, parent_id, created_at desc);
alter table public.activity_log enable row level security;
create policy hh_select on public.activity_log for select to authenticated
  using (household_id in (select private.my_household_ids()));
revoke all on public.activity_log from anon;
revoke insert, update, delete on public.activity_log from authenticated;

create or replace function private.log_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_action text := lower(tg_op);
  v_details jsonb := '{}';
  v_parent_col text := tg_argv[1];
  v_label text;
begin
  if current_setting('homehub.bulk', true) = 'on' then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into v_changed
      from jsonb_object_keys(v_new) k
     where k not in ('updated_at', 'updated_by', 'due_at', 'normalized_name')
       and v_new -> k is distinct from v_old -> k;
    if cardinality(v_changed) = 0 then return null; end if;
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));
    if 'status' = any (v_changed) then
      v_action := 'status';
      v_details := v_details || jsonb_build_object('from', v_old ->> 'status', 'to', v_new ->> 'status');
    elsif 'archived_at' = any (v_changed) then
      v_action := case when v_new ->> 'archived_at' is null then 'restored' else 'archived' end;
    end if;
    if 'due_date' = any (v_changed) then
      v_details := v_details || jsonb_build_object('due_from', v_old ->> 'due_date', 'due_to', v_new ->> 'due_date');
    end if;
  end if;
  v_label := coalesce(v_row ->> 'title_override', v_row ->> 'title', v_row ->> 'name', v_row ->> 'make',
                      v_row ->> 'description', v_row ->> 'label');
  if tg_table_name = 'task_occurrences' and v_label is null then
    select t.title into v_label from public.tasks t where t.id = (v_row ->> 'task_id')::uuid;
  end if;
  insert into public.activity_log (household_id, actor_id, entity_type, entity_id, parent_id, action, label, details)
  values ((v_row ->> 'household_id')::uuid, (select auth.uid()), tg_argv[0], (v_row ->> 'id')::uuid,
          case when v_parent_col is not null then (v_row ->> v_parent_col)::uuid end,
          v_action, left(v_label, 200), v_details);
  return null;
end $$;

create trigger log_tasks after insert or update or delete on public.tasks
  for each row execute function private.log_activity('task', 'id');
create trigger log_task_occurrences after update on public.task_occurrences
  for each row execute function private.log_activity('task_occurrence', 'task_id');
create trigger log_shopping_items after insert or update of status or delete on public.shopping_items
  for each row execute function private.log_activity('shopping_item');
create trigger log_meal_plans after insert or delete on public.meal_plans
  for each row execute function private.log_activity('meal_plan');
create trigger log_bills after insert or update or delete on public.bills
  for each row execute function private.log_activity('bill', 'series_id');
create trigger log_expenses after insert or delete on public.expenses
  for each row execute function private.log_activity('expense');
create trigger log_vehicles after insert or update or delete on public.vehicles
  for each row execute function private.log_activity('vehicle', 'id');
create trigger log_vehicle_maintenance after insert or delete on public.vehicle_maintenance
  for each row execute function private.log_activity('vehicle_maintenance', 'vehicle_id');
create trigger log_pets after insert or update or delete on public.pets
  for each row execute function private.log_activity('pet', 'id');
create trigger log_pet_care after insert or delete on public.pet_care_records
  for each row execute function private.log_activity('pet_care_record', 'pet_id');
create trigger log_plants after insert or update or delete on public.plants
  for each row execute function private.log_activity('plant', 'id');
create trigger log_plant_care after insert or delete on public.plant_care_records
  for each row execute function private.log_activity('plant_care_record', 'plant_id');
create trigger log_members after insert or update on public.household_members
  for each row execute function private.log_activity('member');
create trigger log_attachments after insert or delete on public.attachments
  for each row execute function private.log_activity('attachment');

-- ---------------------------------------------------------------------------
-- Realtime: broadcast row changes of shared tables (Realtime applies RLS per subscriber).
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['households', 'household_members', 'rooms', 'tasks', 'task_assignees', 'task_occurrences',
    'task_occurrence_assignees', 'task_checklist_items', 'task_checklist_progress', 'task_comments', 'task_templates',
    'shopping_lists', 'shopping_items', 'pantry_items', 'recipes', 'meal_plans', 'meal_ingredients', 'bills', 'expenses',
    'vehicles', 'vehicle_maintenance', 'pets', 'pet_care_records', 'plants', 'plant_care_records', 'attachments',
    'notifications'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Scheduling: hourly refresh through pg_cron when the extension is available (Supabase: enable
-- "pg_cron" under Database → Extensions). The app also refreshes on load, so this is not required.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('homehub-refresh', '7 * * * *', 'select private.refresh_all_households()');
    exception when others then
      raise notice 'pg_cron not scheduled: %', sqlerrm;
    end;
  end if;
end $$;

revoke execute on all functions in schema private from public, anon;
grant execute on function private.my_household_ids(), private.my_admin_household_ids(),
  private.co_member_ids(), private.is_member(uuid), private.is_admin(uuid),
  private.is_active_member(uuid, uuid), private.normalize_name(text) to authenticated, service_role;
grant execute on function private.refresh_all_households() to service_role;
revoke execute on function public.refresh_household(uuid) from public, anon;
grant execute on function public.refresh_household(uuid) to authenticated;
