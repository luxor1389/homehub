-- HomeHub · 0002 · Shared RLS/guard helpers, rooms, vehicles, pets, plants

-- Standard household policies: any active member may read/write rows of their household.
-- When p_delete_requires_archive is true a row must be archived before it can be permanently deleted.
create or replace function private.apply_household_rls(p_table regclass, p_delete_requires_archive boolean default false)
returns void language plpgsql set search_path = '' as $$
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('create policy hh_select on %s for select to authenticated
    using (household_id in (select private.my_household_ids()))', p_table);
  execute format('create policy hh_insert on %s for insert to authenticated
    with check (household_id in (select private.my_household_ids()))', p_table);
  execute format('create policy hh_update on %s for update to authenticated
    using (household_id in (select private.my_household_ids()))
    with check (household_id in (select private.my_household_ids()))', p_table);
  execute format('create policy hh_delete on %s for delete to authenticated
    using (household_id in (select private.my_household_ids())%s)', p_table,
    case when p_delete_requires_archive then ' and archived_at is not null' else '' end);
  execute format('revoke all on %s from anon', p_table);
end $$;

-- Row guard: stamps created_by on insert, freezes ownership columns on update.
-- Works for any table; keys missing from the row type are ignored by jsonb_populate_record.
create or replace function private.row_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      new := jsonb_populate_record(new, jsonb_build_object('created_by', (select auth.uid())));
    end if;
  else
    new := jsonb_populate_record(new, jsonb_build_object(
      'id', old.id, 'household_id', old.household_id,
      'created_by', to_jsonb(old) -> 'created_by', 'created_at', old.created_at));
  end if;
  return new;
end $$;

-- convenience: attach updated_at + row guard triggers
create or replace function private.attach_standard_triggers(p_table regclass)
returns void language plpgsql set search_path = '' as $$
declare v_name text := replace(p_table::text, 'public.', '');
begin
  execute format('create trigger %I before update on %s for each row execute function private.set_updated_at()',
                 v_name || '_updated_at', p_table);
  execute format('create trigger %I before insert or update on %s for each row execute function private.row_guard()',
                 v_name || '_row_guard', p_table);
end $$;

-- rooms (table created in 0001 because create_household seeds it)
alter table public.rooms add column created_by uuid references public.profiles (id) on delete set null;
drop trigger rooms_updated_at on public.rooms;
select private.attach_standard_triggers('public.rooms');
select private.apply_household_rls('public.rooms', true);

-- ---------------------------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------------------------
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  make text not null check (char_length(btrim(make)) between 1 and 60),
  model text check (char_length(model) <= 60),
  year int check (year between 1900 and 2100),
  plate text check (char_length(plate) <= 20),
  odometer_km int check (odometer_km >= 0),
  registration_date date,
  registration_expires_on date,
  insurance_company text check (char_length(insurance_company) <= 100),
  insurance_policy text check (char_length(insurance_policy) <= 60),
  insurance_expires_on date,
  inspection_due_on date,
  tire_season text check (tire_season in ('summer', 'winter', 'all_season')),
  next_tire_change_on date,
  next_service_on date,
  next_service_km int check (next_service_km >= 0),
  notes text check (char_length(notes) <= 2000),
  photo_path text,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  check (photo_path is null or photo_path like household_id::text || '/%')
);
create index vehicles_household_idx on public.vehicles (household_id) where archived_at is null;
select private.attach_standard_triggers('public.vehicles');
select private.apply_household_rls('public.vehicles', true);

create table public.vehicle_maintenance (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  vehicle_id uuid not null,
  kind text not null check (kind in ('service', 'repair', 'tires', 'registration', 'inspection',
                                     'insurance', 'fuel', 'parking', 'toll', 'wash', 'other')),
  performed_on date not null,
  odometer_km int check (odometer_km >= 0),
  description text check (char_length(description) <= 2000),
  cost numeric(12, 2) check (cost >= 0),
  currency text not null default 'RSD' check (currency ~ '^[A-Z]{3}$'),
  liters numeric(8, 2) check (liters > 0),
  full_tank boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (vehicle_id, household_id) references public.vehicles (id, household_id) on delete cascade
);
create index vehicle_maintenance_vehicle_idx on public.vehicle_maintenance (vehicle_id, performed_on desc);
select private.attach_standard_triggers('public.vehicle_maintenance');
select private.apply_household_rls('public.vehicle_maintenance');

-- keep the vehicle odometer at the highest recorded value
create or replace function private.vehicle_odometer_bump()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.odometer_km is not null then
    update public.vehicles set odometer_km = new.odometer_km
     where id = new.vehicle_id and (odometer_km is null or odometer_km < new.odometer_km);
  end if;
  return new;
end $$;
create trigger vehicle_maintenance_odometer after insert or update of odometer_km on public.vehicle_maintenance
  for each row execute function private.vehicle_odometer_bump();

-- ---------------------------------------------------------------------------
-- Pets. Medical data is private to the household (RLS); the app never gives medical advice.
-- ---------------------------------------------------------------------------
create table public.pets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  species text not null default 'dog' check (species in ('dog', 'cat', 'bird', 'fish', 'rodent', 'reptile', 'other')),
  breed text check (char_length(breed) <= 60),
  birth_date date,
  feeding_plan text check (char_length(feeding_plan) <= 2000),
  notes text check (char_length(notes) <= 2000),
  photo_path text,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  check (photo_path is null or photo_path like household_id::text || '/%')
);
create index pets_household_idx on public.pets (household_id) where archived_at is null;
select private.attach_standard_triggers('public.pets');
select private.apply_household_rls('public.pets', true);

create table public.pet_care_records (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  pet_id uuid not null,
  kind text not null check (kind in ('feeding', 'grooming', 'cleaning', 'food_purchase', 'vet_visit',
                                     'vaccination', 'treatment', 'medication', 'other')),
  occurred_on date not null,
  next_due_on date,
  description text check (char_length(description) <= 2000),
  cost numeric(12, 2) check (cost >= 0),
  currency text not null default 'RSD' check (currency ~ '^[A-Z]{3}$'),
  performed_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (pet_id, household_id) references public.pets (id, household_id) on delete cascade
);
create index pet_care_records_pet_idx on public.pet_care_records (pet_id, occurred_on desc);
create index pet_care_records_due_idx on public.pet_care_records (household_id, next_due_on) where next_due_on is not null;
select private.attach_standard_triggers('public.pet_care_records');
select private.apply_household_rls('public.pet_care_records');

-- ---------------------------------------------------------------------------
-- Plants
-- ---------------------------------------------------------------------------
create table public.plants (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  species text check (char_length(species) <= 80),
  location text check (char_length(location) <= 80),
  room_id uuid,
  watering_interval_days int check (watering_interval_days between 1 and 365),
  fertilizing_interval_days int check (fertilizing_interval_days between 1 and 365),
  light_needs text check (light_needs in ('low', 'medium', 'bright_indirect', 'direct')),
  repotting_notes text check (char_length(repotting_notes) <= 1000),
  notes text check (char_length(notes) <= 2000),
  photo_path text,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (room_id, household_id) references public.rooms (id, household_id) on delete set null (room_id),
  check (photo_path is null or photo_path like household_id::text || '/%')
);
create index plants_household_idx on public.plants (household_id) where archived_at is null;
select private.attach_standard_triggers('public.plants');
select private.apply_household_rls('public.plants', true);

create table public.plant_care_records (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  plant_id uuid not null,
  kind text not null check (kind in ('watering', 'fertilizing', 'repotting', 'pruning', 'treatment', 'other')),
  occurred_on date not null,
  notes text check (char_length(notes) <= 1000),
  performed_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (plant_id, household_id) references public.plants (id, household_id) on delete cascade
);
create index plant_care_records_plant_idx on public.plant_care_records (plant_id, kind, occurred_on desc);
select private.attach_standard_triggers('public.plant_care_records');
select private.apply_household_rls('public.plant_care_records');

-- Next watering / fertilizing date per plant, derived from the care log.
create view public.plant_status with (security_invoker = true) as
select p.id as plant_id, p.household_id,
  (select max(r.occurred_on) from public.plant_care_records r where r.plant_id = p.id and r.kind = 'watering') as last_watered_on,
  (select max(r.occurred_on) from public.plant_care_records r where r.plant_id = p.id and r.kind = 'fertilizing') as last_fertilized_on,
  case when p.watering_interval_days is not null then
    coalesce((select max(r.occurred_on) from public.plant_care_records r where r.plant_id = p.id and r.kind = 'watering'),
             (p.created_at at time zone 'UTC')::date) + p.watering_interval_days end as next_watering_on,
  case when p.fertilizing_interval_days is not null then
    coalesce((select max(r.occurred_on) from public.plant_care_records r where r.plant_id = p.id and r.kind = 'fertilizing'),
             (p.created_at at time zone 'UTC')::date) + p.fertilizing_interval_days end as next_fertilizing_on
from public.plants p
where p.archived_at is null;
revoke all on public.plant_status from anon;
