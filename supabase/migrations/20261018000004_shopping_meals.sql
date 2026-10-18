-- HomeHub · 0004 · Shopping lists, pantry, recipes, meal plans

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text check (name is null or char_length(btrim(name)) between 1 and 80), -- NULL = default list (translated label)
  is_default boolean not null default false,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);
create unique index shopping_lists_one_default on public.shopping_lists (household_id) where is_default and archived_at is null;
select private.attach_standard_triggers('public.shopping_lists');
select private.apply_household_rls('public.shopping_lists', true);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (char_length(description) <= 2000),
  instructions text check (char_length(instructions) <= 10000),
  prep_minutes int check (prep_minutes between 1 and 1440),
  servings int check (servings between 1 and 100),
  is_favorite boolean not null default false,
  source_url text check (char_length(source_url) <= 500),
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);
create index recipes_household_idx on public.recipes (household_id) where archived_at is null;
select private.attach_standard_triggers('public.recipes');
select private.apply_household_rls('public.recipes', true);

create table public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  plan_date date not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  recipe_id uuid,
  cook_id uuid,
  prep_minutes int check (prep_minutes between 1 and 1440),
  prep_on date, -- optional: prepare in advance on this day
  servings int check (servings between 1 and 100),
  notes text check (char_length(notes) <= 2000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  check (prep_on is null or prep_on <= plan_date),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete set null (recipe_id),
  foreign key (household_id, cook_id) references public.household_members (household_id, user_id) on delete set null (cook_id)
);
create index meal_plans_household_date_idx on public.meal_plans (household_id, plan_date);
select private.attach_standard_triggers('public.meal_plans');
select private.apply_household_rls('public.meal_plans');

-- Ingredients belong either to a recipe or directly to a planned meal.
create table public.meal_ingredients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  recipe_id uuid,
  meal_plan_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  quantity numeric(12, 3) check (quantity > 0),
  unit text check (unit in ('pcs', 'kg', 'g', 'l', 'ml', 'pack', 'bottle', 'box', 'tbsp', 'tsp', 'cup', 'other')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(recipe_id, meal_plan_id) = 1),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade,
  foreign key (meal_plan_id, household_id) references public.meal_plans (id, household_id) on delete cascade
);
create index meal_ingredients_recipe_idx on public.meal_ingredients (recipe_id);
create index meal_ingredients_meal_idx on public.meal_ingredients (meal_plan_id);
create trigger meal_ingredients_updated_at before update on public.meal_ingredients
  for each row execute function private.set_updated_at();
create trigger meal_ingredients_row_guard before insert or update on public.meal_ingredients
  for each row execute function private.row_guard();
select private.apply_household_rls('public.meal_ingredients');

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  list_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  normalized_name text generated always as (private.normalize_name(name)) stored,
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit text check (unit in ('pcs', 'kg', 'g', 'l', 'ml', 'pack', 'bottle', 'box', 'tbsp', 'tsp', 'cup', 'other')),
  category text not null default 'food' check (category in ('food', 'hygiene', 'cleaning', 'household', 'pets', 'plants', 'other')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  note text check (char_length(note) <= 500),
  status text not null default 'needed' check (status in ('needed', 'purchased')),
  price numeric(12, 2) check (price >= 0),
  currency text not null default 'RSD' check (currency ~ '^[A-Z]{3}$'),
  purchased_by uuid references public.profiles (id) on delete set null,
  purchased_at timestamptz,
  meal_plan_id uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (list_id, household_id) references public.shopping_lists (id, household_id) on delete cascade,
  foreign key (meal_plan_id, household_id) references public.meal_plans (id, household_id) on delete set null (meal_plan_id)
);
-- the same product cannot be on the same active list twice
create unique index shopping_items_no_active_duplicates on public.shopping_items (list_id, normalized_name) where status = 'needed';
create index shopping_items_household_status_idx on public.shopping_items (household_id, status, purchased_at desc);
select private.attach_standard_triggers('public.shopping_items');
select private.apply_household_rls('public.shopping_items');

create or replace function private.shopping_item_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'purchased' then
      new.purchased_by := coalesce((select auth.uid()), new.purchased_by);
      new.purchased_at := now();
    else
      new.purchased_by := null; new.purchased_at := null;
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'purchased' then
      new.purchased_by := coalesce((select auth.uid()), new.purchased_by);
      new.purchased_at := now();
    else
      new.purchased_by := null; new.purchased_at := null;
    end if;
  else
    new.purchased_by := old.purchased_by; new.purchased_at := old.purchased_at;
  end if;
  return new;
end $$;
create trigger shopping_items_stamp before insert or update on public.shopping_items
  for each row execute function private.shopping_item_stamp();

-- Basic pantry / stock tracking (optional feature).
create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  normalized_name text generated always as (private.normalize_name(name)) stored,
  quantity numeric(12, 3) not null default 0 check (quantity >= 0),
  min_quantity numeric(12, 3) check (min_quantity >= 0),
  unit text check (unit in ('pcs', 'kg', 'g', 'l', 'ml', 'pack', 'bottle', 'box', 'tbsp', 'tsp', 'cup', 'other')),
  category text not null default 'food' check (category in ('food', 'hygiene', 'cleaning', 'household', 'pets', 'plants', 'other')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, normalized_name)
);
select private.attach_standard_triggers('public.pantry_items');
select private.apply_household_rls('public.pantry_items');

-- Seed a default shopping list for every new household.
create or replace function private.household_default_list()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.shopping_lists (household_id, is_default, created_by) values (new.id, true, new.created_by);
  return null;
end $$;
create trigger households_default_list after insert on public.households
  for each row execute function private.household_default_list();

-- ---------------------------------------------------------------------------
-- Shopping RPCs
-- ---------------------------------------------------------------------------
-- Adds an item; if the same product is already on the active list either raises 'duplicate_item'
-- (p_on_duplicate = 'error') or increases the existing quantity (p_on_duplicate = 'increment').
create or replace function public.add_shopping_item(
  p_list uuid, p_name text, p_quantity numeric default 1, p_unit text default null,
  p_category text default 'food', p_priority text default 'normal', p_note text default null,
  p_on_duplicate text default 'error', p_meal_plan uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l public.shopping_lists;
  v_existing public.shopping_items;
  v_id uuid;
begin
  select * into l from public.shopping_lists where id = p_list;
  if l.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(l.household_id);
  select * into v_existing from public.shopping_items
   where list_id = p_list and status = 'needed' and normalized_name = private.normalize_name(p_name)
   for update;
  if v_existing.id is not null then
    if p_on_duplicate = 'increment' then
      update public.shopping_items
         set quantity = case when unit is not distinct from p_unit then quantity + coalesce(p_quantity, 1) else quantity end,
             note = case when unit is not distinct from p_unit then note
                         else left(concat_ws('; ', note, '+ ' || coalesce(p_quantity, 1)::text || coalesce(' ' || p_unit, '')), 500) end
       where id = v_existing.id;
      return jsonb_build_object('action', 'incremented', 'item_id', v_existing.id);
    end if;
    raise exception 'duplicate_item' using errcode = '23505', detail = v_existing.id::text;
  end if;
  insert into public.shopping_items (household_id, list_id, name, quantity, unit, category, priority, note, meal_plan_id)
  values (l.household_id, p_list, btrim(p_name), coalesce(p_quantity, 1), p_unit, coalesce(p_category, 'food'),
          coalesce(p_priority, 'normal'), nullif(btrim(p_note), ''), p_meal_plan)
  returning id into v_id;
  return jsonb_build_object('action', 'added', 'item_id', v_id);
end $$;

-- Merges several items into one: quantities are summed when the units match, otherwise kept in the note.
create or replace function public.merge_shopping_items(p_target uuid, p_sources uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  tgt public.shopping_items;
  s public.shopping_items;
begin
  select * into tgt from public.shopping_items where id = p_target for update;
  if tgt.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(tgt.household_id);
  for s in select * from public.shopping_items where id = any (p_sources) and id <> p_target for update loop
    if s.household_id <> tgt.household_id or s.list_id <> tgt.list_id then
      raise exception 'cross_list_merge' using errcode = '22023';
    end if;
    if s.unit is not distinct from tgt.unit then
      tgt.quantity := tgt.quantity + s.quantity;
    else
      tgt.note := left(concat_ws('; ', tgt.note, s.name || ' ' || s.quantity::text || coalesce(' ' || s.unit, '')), 500);
    end if;
    if s.note is not null and s.unit is not distinct from tgt.unit then
      tgt.note := left(concat_ws('; ', tgt.note, s.note), 500);
    end if;
    if s.priority = 'high' then tgt.priority := 'high'; end if;
    delete from public.shopping_items where id = s.id;
  end loop;
  update public.shopping_items set quantity = tgt.quantity, note = tgt.note, priority = tgt.priority where id = tgt.id;
end $$;

-- Applies the user's explicit choices for meal ingredients: add new, set quantity of an existing item, or skip.
-- p_items: [{ "name", "quantity", "unit", "category", "action": "add"|"update"|"skip", "item_id", "meal_plan_id" }]
create or replace function public.apply_ingredients_to_list(p_list uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l public.shopping_lists;
  v jsonb;
  v_added int := 0;
  v_updated int := 0;
  v_target public.shopping_items;
begin
  select * into l from public.shopping_lists where id = p_list;
  if l.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(l.household_id);
  for v in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    if v ->> 'action' = 'add' then
      perform public.add_shopping_item(p_list, v ->> 'name', (v ->> 'quantity')::numeric, v ->> 'unit',
        coalesce(v ->> 'category', 'food'), 'normal', v ->> 'note', 'increment', (v ->> 'meal_plan_id')::uuid);
      v_added := v_added + 1;
    elsif v ->> 'action' = 'update' then
      select * into v_target from public.shopping_items
       where id = (v ->> 'item_id')::uuid and list_id = p_list and status = 'needed';
      if v_target.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
      update public.shopping_items
         set quantity = coalesce((v ->> 'quantity')::numeric, quantity),
             unit = case when v ? 'unit' then v ->> 'unit' else unit end
       where id = v_target.id;
      v_updated := v_updated + 1;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'updated', v_updated);
end $$;

revoke execute on all functions in schema private from public, anon;
grant execute on function private.my_household_ids(), private.my_admin_household_ids(),
  private.co_member_ids(), private.is_member(uuid), private.is_admin(uuid),
  private.is_active_member(uuid, uuid), private.normalize_name(text) to authenticated, service_role;
revoke execute on function public.add_shopping_item(uuid, text, numeric, text, text, text, text, text, uuid),
  public.merge_shopping_items(uuid, uuid[]), public.apply_ingredients_to_list(uuid, jsonb) from public, anon;
grant execute on function public.add_shopping_item(uuid, text, numeric, text, text, text, text, text, uuid),
  public.merge_shopping_items(uuid, uuid[]), public.apply_ingredients_to_list(uuid, jsonb) to authenticated;
