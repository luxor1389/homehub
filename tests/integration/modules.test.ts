import { beforeAll, describe, expect, it } from 'vitest';
import { createHousehold, createUser, invite, join, must, type TestUser } from './helpers';

let u1: TestUser, u2: TestUser, u3: TestUser;
let hh: string;
let list: string;

beforeAll(async () => {
  [u1, u2, u3] = await Promise.all([createUser('m1'), createUser('m2', 'en'), createUser('m3')]);
  hh = await createHousehold(u1, 'Stan');
  const inv = await invite(u1, hh, { uses: 2 });
  await join(u2, inv.token);
  await join(u3, inv.token);
  list = must(await u1.client.from('shopping_lists').select('id').eq('household_id', hh).eq('is_default', true).single()).id;
}, 60_000);

describe('shopping', () => {
  it('prevents duplicates on the active list and offers increment instead', async () => {
    const first = must(await u1.client.rpc('add_shopping_item', { p_list: list, p_name: 'Hleb', p_quantity: 1, p_unit: 'pcs' })) as { action: string; item_id: string };
    expect(first.action).toBe('added');
    const dup = await u2.client.rpc('add_shopping_item', { p_list: list, p_name: '  hleb ', p_quantity: 2, p_unit: 'pcs' });
    expect(dup.error?.code).toBe('23505');
    expect(dup.error?.message).toBe('duplicate_item');
    const direct = await u3.client.from('shopping_items').insert({ household_id: hh, list_id: list, name: 'HLEB' });
    expect(direct.error?.code).toBe('23505');
    const inc = must(await u2.client.rpc('add_shopping_item', { p_list: list, p_name: 'Hleb', p_quantity: 2, p_unit: 'pcs', p_on_duplicate: 'increment' })) as { action: string; item_id: string };
    expect(inc).toEqual({ action: 'incremented', item_id: first.item_id });
    const row = must(await u3.client.from('shopping_items').select('quantity').eq('id', first.item_id).single());
    expect(Number(row.quantity)).toBe(3);
  });

  it('records buyer, time and price; purchased items form the history and can be re-added', async () => {
    const { item_id } = must(await u1.client.rpc('add_shopping_item', { p_list: list, p_name: 'Deterdžent', p_category: 'cleaning' })) as { item_id: string };
    const bought = must(await u3.client.from('shopping_items').update({ status: 'purchased', price: 899.99 }).eq('id', item_id).select('purchased_by, purchased_at, price').single());
    expect(bought.purchased_by).toBe(u3.id);
    expect(bought.purchased_at).toBeTruthy();
    // a new "Deterdžent" can be added again because the old one is purchased
    must(await u1.client.rpc('add_shopping_item', { p_list: list, p_name: 'Deterdžent', p_category: 'cleaning' }));
    const budget = must(await u2.client.from('budget_entries').select('source, amount, category').eq('source_id', item_id));
    expect(budget).toEqual([{ source: 'shopping', amount: 899.99, category: 'household' }]);
  });

  it('merges near-duplicates chosen by the user', async () => {
    const a = (must(await u1.client.rpc('add_shopping_item', { p_list: list, p_name: 'Mleko', p_quantity: 1, p_unit: 'l' })) as { item_id: string }).item_id;
    const b = (must(await u2.client.rpc('add_shopping_item', { p_list: list, p_name: 'Mleko 2.8%', p_quantity: 2, p_unit: 'l', p_priority: 'high' })) as { item_id: string }).item_id;
    must(await u3.client.rpc('merge_shopping_items', { p_target: a, p_sources: [b] }));
    const rows = must(await u1.client.from('shopping_items').select('id, quantity, priority').in('id', [a, b]));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(3);
    expect(rows[0].priority).toBe('high');
  });
});

describe('meals', () => {
  it('links recipe ingredients to the shopping list without creating duplicates', async () => {
    const recipe = must(await u1.client.from('recipes').insert({ household_id: hh, title: 'Palačinke', prep_minutes: 30, is_favorite: true }).select('id').single());
    must(await u1.client.from('meal_ingredients').insert([
      { household_id: hh, recipe_id: recipe.id, name: 'Jaja', quantity: 3, unit: 'pcs', position: 0 },
      { household_id: hh, recipe_id: recipe.id, name: 'Brašno', quantity: 0.5, unit: 'kg', position: 1 },
    ]));
    const meal = must(await u2.client.from('meal_plans').insert({
      household_id: hh, plan_date: '2026-10-25', meal_type: 'breakfast', title: 'Palačinke', recipe_id: recipe.id, cook_id: u3.id, prep_minutes: 30,
    }).select('id').single());
    // "Jaja" already on the list → the user chooses to update the quantity; "Brašno" is added
    const existing = (must(await u1.client.rpc('add_shopping_item', { p_list: list, p_name: 'jaja', p_quantity: 10, p_unit: 'pcs' })) as { item_id: string }).item_id;
    const res = must(await u2.client.rpc('apply_ingredients_to_list', { p_list: list, p_items: [
      { name: 'Jaja', quantity: 13, unit: 'pcs', action: 'update', item_id: existing },
      { name: 'Brašno', quantity: 0.5, unit: 'kg', action: 'add', meal_plan_id: meal.id },
    ] }));
    expect(res).toEqual({ added: 1, updated: 1 });
    const items = must(await u3.client.from('shopping_items').select('name, quantity, meal_plan_id').eq('list_id', list).in('normalized_name', ['jaja', 'brašno']).eq('status', 'needed'));
    expect(items).toHaveLength(2);
    expect(Number(items.find((i) => i.name === 'jaja')!.quantity)).toBe(13);
    expect(items.find((i) => i.name === 'Brašno')!.meal_plan_id).toBe(meal.id);
  });

  it('rejects a cook from outside the household', async () => {
    const other = await createUser('stranger');
    const otherHh = await createHousehold(other, 'Drugi');
    expect(otherHh).toBeTruthy();
    const res = await u1.client.from('meal_plans').insert({ household_id: hh, plan_date: '2026-10-25', meal_type: 'lunch', title: 'x', cook_id: other.id });
    expect(res.error?.code).toBe('23503');
  });
});

describe('bills and budget', () => {
  it('pays a monthly bill once and creates exactly one next bill', async () => {
    const bill = must(await u1.client.from('bills').insert({
      household_id: hh, name: 'Internet', category: 'internet_phone', amount: 2999, due_date: '2026-01-31', frequency: 'monthly', responsible_id: u2.id,
    }).select('id, series_id').single());
    const next = must(await u2.client.rpc('pay_bill', { p_bill: bill.id }));
    expect(next).toBeTruthy();
    const again = await u3.client.rpc('pay_bill', { p_bill: bill.id });
    expect(again.error?.message).toContain('already_paid');
    const series = must(await u1.client.from('bills').select('due_date, status, paid_by, amount').eq('series_id', bill.series_id).order('due_date'));
    expect(series).toEqual([
      { due_date: '2026-01-31', status: 'paid', paid_by: u2.id, amount: 2999 },
      { due_date: '2026-02-28', status: 'unpaid', paid_by: null, amount: 2999 },
    ]);
    // unpay → pay again does not create a second "next" bill
    must(await u1.client.rpc('unpay_bill', { p_bill: bill.id }));
    must(await u1.client.rpc('pay_bill', { p_bill: bill.id, p_paid_amount: 3100 }));
    expect(must(await u1.client.from('bills').select('id').eq('series_id', bill.series_id))).toHaveLength(2);
    const actual = must(await u1.client.from('budget_entries').select('amount, kind').eq('source_id', bill.id).order('kind'));
    expect(actual).toEqual([{ amount: 3100, kind: 'actual' }, { amount: 2999, kind: 'planned' }]);
  });

  it('stores money as exact decimals and validates input on the server', async () => {
    const e = must(await u1.client.from('expenses').insert({ household_id: hh, description: 'Moler', amount: 0.1 + 0.2, spent_on: '2026-10-01', category: 'repairs' }).select('amount').single());
    expect(e.amount).toBe(0.3);
    const neg = await u1.client.from('expenses').insert({ household_id: hh, description: 'x', amount: -5, spent_on: '2026-10-01' });
    expect(neg.error?.code).toBe('23514');
    const cur = await u1.client.from('bills').insert({ household_id: hh, name: 'x', amount: 1, due_date: '2026-10-01', currency: 'dinara' });
    expect(cur.error?.code).toBe('23514');
  });

  it('upcoming bills generate a reminder for the responsible member', async () => {
    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    must(await u1.client.from('bills').insert({ household_id: hh, name: 'Voda', category: 'water', amount: 1200, due_date: soon, responsible_id: u3.id }));
    must(await u1.client.rpc('refresh_household', { p_household: hh }));
    must(await u1.client.rpc('refresh_household', { p_household: hh }));
    const n = must(await u3.client.from('notifications').select('type, params').eq('type', 'bill_due_soon'));
    expect(n.filter((x) => (x.params as { title: string }).title === 'Voda')).toHaveLength(1);
  });
});

describe('vehicles, pets and plants keep separate records', () => {
  it('vehicle maintenance updates odometer and triggers date and km reminders', async () => {
    const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const car = must(await u1.client.from('vehicles').insert({ household_id: hh, make: 'VW', model: 'Golf', plate: 'BG-123-AA', registration_expires_on: soon, next_service_km: 120000 }).select('id').single());
    const van = must(await u1.client.from('vehicles').insert({ household_id: hh, make: 'Renault', model: 'Kangoo' }).select('id').single());
    must(await u2.client.from('vehicle_maintenance').insert({ household_id: hh, vehicle_id: car.id, kind: 'fuel', performed_on: '2026-10-10', odometer_km: 119500, cost: 6500, liters: 40 }));
    must(await u2.client.from('vehicle_maintenance').insert({ household_id: hh, vehicle_id: car.id, kind: 'service', performed_on: '2026-09-01', odometer_km: 110000, cost: 25000, description: 'Mali servis' }));
    const v = must(await u3.client.from('vehicles').select('odometer_km').eq('id', car.id).single());
    expect(v.odometer_km).toBe(119500);
    expect(must(await u3.client.from('vehicle_maintenance').select('id').eq('vehicle_id', van.id))).toEqual([]);
    must(await u1.client.rpc('refresh_household', { p_household: hh }));
    const n = must(await u2.client.from('notifications').select('params').eq('type', 'vehicle_due').eq('entity_id', car.id));
    expect(n.map((x) => (x.params as { what: string }).what).sort()).toEqual(['registration', 'service_km']);
  });

  it('pets and plants have their own care histories and reminders', async () => {
    const dog = must(await u1.client.from('pets').insert({ household_id: hh, name: 'Meda', species: 'dog' }).select('id').single());
    const cat = must(await u1.client.from('pets').insert({ household_id: hh, name: 'Maca', species: 'cat' }).select('id').single());
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    must(await u2.client.from('pet_care_records').insert({ household_id: hh, pet_id: dog.id, kind: 'vaccination', occurred_on: '2025-10-20', next_due_on: tomorrow, cost: 3000 }));
    expect(must(await u1.client.from('pet_care_records').select('id').eq('pet_id', cat.id))).toEqual([]);

    const plant = must(await u1.client.from('plants').insert({ household_id: hh, name: 'Monstera', watering_interval_days: 3, light_needs: 'bright_indirect' }).select('id').single());
    const longAgo = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    must(await u3.client.from('plant_care_records').insert({ household_id: hh, plant_id: plant.id, kind: 'watering', occurred_on: longAgo, performed_by: u3.id }));
    const status = must(await u1.client.from('plant_status').select('last_watered_on, next_watering_on').eq('plant_id', plant.id).single());
    expect(status.last_watered_on).toBe(longAgo);
    must(await u1.client.rpc('refresh_household', { p_household: hh }));
    const types = must(await u1.client.from('notifications').select('type, entity_id').in('type', ['pet_due', 'plant_due']));
    expect(types.some((t) => t.type === 'pet_due' && t.entity_id === dog.id)).toBe(true);
    expect(types.some((t) => t.type === 'plant_due' && t.entity_id === plant.id)).toBe(true);
  });
});

describe('profile and language', () => {
  it('stores the chosen language per user and keeps it across sign-ins', async () => {
    const p = must(await u2.client.from('profiles').select('locale').eq('id', u2.id).single());
    expect(p.locale).toBe('en'); // from sign-up metadata
    must(await u2.client.from('profiles').update({ locale: 'sr-Latn' }).eq('id', u2.id));
    await u2.client.auth.signOut();
    const again = await u2.client.from('profiles').select('locale').eq('id', u2.id);
    expect(again.data ?? []).toEqual([]); // signed out → no access
    must(await u2.client.auth.signInWithPassword({ email: u2.email, password: u2.password }));
    const after = must(await u2.client.from('profiles').select('locale').eq('id', u2.id).single());
    expect(after.locale).toBe('sr-Latn');
    const bad = await u1.client.from('profiles').update({ locale: 'de' }).eq('id', u1.id);
    expect(bad.error?.code).toBe('23514');
  });
});
