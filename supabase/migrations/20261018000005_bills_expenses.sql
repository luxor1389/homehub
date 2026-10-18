-- HomeHub · 0005 · Bills, expenses and the budget read model. No bank connections, no payments.

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  series_id uuid not null default gen_random_uuid(), -- all bills of one recurring obligation
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category text not null default 'other' check (category in ('electricity', 'water', 'heating', 'internet_phone',
    'building', 'insurance', 'subscriptions', 'taxes', 'repairs', 'other')),
  amount numeric(12, 2) not null check (amount >= 0),           -- billed / planned amount
  currency text not null default 'RSD' check (currency ~ '^[A-Z]{3}$'),
  due_date date not null,
  frequency text not null default 'monthly' check (frequency in
    ('once', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly')),
  status text not null default 'unpaid' check (status in ('unpaid', 'paid')),
  paid_amount numeric(12, 2) check (paid_amount >= 0),           -- actually paid
  paid_on date,
  paid_at timestamptz,
  paid_by uuid references public.profiles (id) on delete set null,
  responsible_id uuid,
  remind_days_before int not null default 3 check (remind_days_before between 0 and 60),
  notes text check (char_length(notes) <= 2000),
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  unique (series_id, due_date),
  check ((status = 'paid') = (paid_at is not null)),
  foreign key (household_id, responsible_id) references public.household_members (household_id, user_id)
    on delete set null (responsible_id)
);
create index bills_household_due_idx on public.bills (household_id, due_date) where archived_at is null;
select private.attach_standard_triggers('public.bills');
select private.apply_household_rls('public.bills', true);
-- payment fields can only be changed through pay_bill / unpay_bill
revoke update on public.bills from authenticated;
grant update (name, category, amount, currency, due_date, frequency, responsible_id, remind_days_before, notes,
              archived_at) on public.bills to authenticated;
revoke insert on public.bills from authenticated;
grant insert (household_id, series_id, name, category, amount, currency, due_date, frequency, responsible_id,
              remind_days_before, notes) on public.bills to authenticated;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  category text not null default 'other' check (category in ('electricity', 'water', 'heating', 'internet_phone',
    'building', 'insurance', 'subscriptions', 'taxes', 'repairs', 'groceries', 'household', 'vehicles', 'pets',
    'plants', 'health', 'other')),
  description text not null check (char_length(btrim(description)) between 1 and 200),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'RSD' check (currency ~ '^[A-Z]{3}$'),
  spent_on date not null,
  kind text not null default 'actual' check (kind in ('planned', 'actual')),
  paid_by uuid,
  notes text check (char_length(notes) <= 2000),
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (household_id, paid_by) references public.household_members (household_id, user_id)
    on delete set null (paid_by)
);
create index expenses_household_date_idx on public.expenses (household_id, spent_on);
select private.attach_standard_triggers('public.expenses');
select private.apply_household_rls('public.expenses', true);

create or replace function private.next_bill_date(p_date date, p_freq text)
returns date language sql immutable set search_path = '' as $$
  select case p_freq
    when 'monthly' then (p_date + interval '1 month')::date
    when 'bimonthly' then (p_date + interval '2 months')::date
    when 'quarterly' then (p_date + interval '3 months')::date
    when 'semiannual' then (p_date + interval '6 months')::date
    when 'yearly' then (p_date + interval '1 year')::date
    else null end;
$$;

-- Marks a bill as paid by the caller and creates the next bill of a recurring series (idempotent).
create or replace function public.pay_bill(p_bill uuid, p_paid_amount numeric default null, p_paid_on date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.bills;
  v_next date;
  v_next_id uuid;
begin
  select * into b from public.bills where id = p_bill for update;
  if b.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(b.household_id);
  if b.status = 'paid' then raise exception 'already_paid' using errcode = '22023'; end if;
  if p_paid_amount is not null and p_paid_amount < 0 then raise exception 'invalid_amount' using errcode = '22023'; end if;
  update public.bills set status = 'paid', paid_amount = coalesce(p_paid_amount, amount),
    paid_on = coalesce(p_paid_on, private.household_today(household_id)), paid_at = now(),
    paid_by = (select auth.uid())
  where id = b.id;
  v_next := private.next_bill_date(b.due_date, b.frequency);
  if v_next is not null and b.archived_at is null then
    insert into public.bills (household_id, series_id, name, category, amount, currency, due_date, frequency,
                              responsible_id, remind_days_before, notes, created_by)
    values (b.household_id, b.series_id, b.name, b.category, b.amount, b.currency, v_next, b.frequency,
            b.responsible_id, b.remind_days_before, b.notes, (select auth.uid()))
    on conflict (series_id, due_date) do nothing
    returning id into v_next_id;
  end if;
  return v_next_id;
end $$;

create or replace function public.unpay_bill(p_bill uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bills;
begin
  select * into b from public.bills where id = p_bill for update;
  if b.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(b.household_id);
  update public.bills set status = 'unpaid', paid_amount = null, paid_on = null, paid_at = null, paid_by = null
   where id = b.id;
end $$;

-- Unified read model for budget overviews: manual expenses, paid bills, vehicle/pet costs and priced purchases.
create view public.budget_entries with (security_invoker = true) as
  select e.household_id, 'expense'::text as source, e.id as source_id, e.category, e.description,
         e.amount, e.currency, e.spent_on as entry_date, e.paid_by, e.kind
    from public.expenses e where e.archived_at is null
  union all
  select b.household_id, 'bill', b.id, b.category, b.name, b.paid_amount, b.currency, b.paid_on, b.paid_by, 'actual'
    from public.bills b where b.status = 'paid' and b.paid_amount > 0
  union all
  select b.household_id, 'bill', b.id, b.category, b.name, b.amount, b.currency, b.due_date, b.responsible_id, 'planned'
    from public.bills b where b.archived_at is null
  union all
  select m.household_id, 'vehicle', m.id, 'vehicles', m.kind, m.cost, m.currency, m.performed_on, m.created_by, 'actual'
    from public.vehicle_maintenance m where m.cost > 0
  union all
  select p.household_id, 'pet', p.id, 'pets', p.kind, p.cost, p.currency, p.occurred_on, p.performed_by, 'actual'
    from public.pet_care_records p where p.cost > 0
  union all
  select s.household_id, 'shopping', s.id,
         case s.category when 'food' then 'groceries' when 'pets' then 'pets' when 'plants' then 'plants' else 'household' end,
         s.name, s.price, s.currency, (s.purchased_at at time zone 'UTC')::date, s.purchased_by, 'actual'
    from public.shopping_items s where s.status = 'purchased' and s.price > 0;
revoke all on public.budget_entries from anon;

revoke execute on all functions in schema private from public, anon;
grant execute on function private.my_household_ids(), private.my_admin_household_ids(),
  private.co_member_ids(), private.is_member(uuid), private.is_admin(uuid),
  private.is_active_member(uuid, uuid), private.normalize_name(text) to authenticated, service_role;
revoke execute on function public.pay_bill(uuid, numeric, date), public.unpay_bill(uuid) from public, anon;
grant execute on function public.pay_bill(uuid, numeric, date), public.unpay_bill(uuid) to authenticated;
