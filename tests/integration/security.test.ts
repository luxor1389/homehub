import { beforeAll, describe, expect, it } from 'vitest';
import { admin, anonClient, createHousehold, createUser, invite, join, must, type TestUser } from './helpers';

// Two households (A with 3 members, B with 1) + an outsider without a household.
let a1: TestUser, a2: TestUser, a3: TestUser, b1: TestUser, outsider: TestUser;
let hhA: string, hhB: string;
let taskA: string, occA: string, listA: string, billA: string, vehicleA: string, petA: string, plantA: string;
let roomA: string;

beforeAll(async () => {
  [a1, a2, a3, b1, outsider] = await Promise.all([
    createUser('a1'), createUser('a2'), createUser('a3', 'en'), createUser('b1'), createUser('outsider'),
  ]);
  hhA = await createHousehold(a1, 'Kuća A');
  hhB = await createHousehold(b1, 'Kuća B');
  const inv = await invite(a1, hhA, { uses: 2 });
  await join(a2, inv.token);
  await join(a3, inv.token);

  taskA = must(await a1.client.rpc('create_task', {
    p_household: hhA, p_data: { title: 'Usisati dnevnu sobu', category: 'cleaning' }, p_assignees: [a2.id], p_checklist: ['Pomeriti stolice'],
  })) as unknown as string;
  occA = must(await a1.client.from('task_occurrences').select('id').eq('task_id', taskA).single()).id;
  listA = must(await a1.client.from('shopping_lists').select('id').eq('household_id', hhA).single()).id;
  must(await a1.client.rpc('add_shopping_item', { p_list: listA, p_name: 'Mleko' }));
  billA = must(await a1.client.from('bills').insert({ household_id: hhA, name: 'Struja', category: 'electricity', amount: 4500, due_date: '2026-11-15' }).select('id').single()).id;
  vehicleA = must(await a1.client.from('vehicles').insert({ household_id: hhA, make: 'Škoda', model: 'Octavia' }).select('id').single()).id;
  petA = must(await a1.client.from('pets').insert({ household_id: hhA, name: 'Žuća', species: 'dog' }).select('id').single()).id;
  plantA = must(await a1.client.from('plants').insert({ household_id: hhA, name: 'Fikus', watering_interval_days: 7 }).select('id').single()).id;
  must(await a1.client.from('pet_care_records').insert({ household_id: hhA, pet_id: petA, kind: 'vaccination', occurred_on: '2026-10-01' }));
  must(await a1.client.from('expenses').insert({ household_id: hhA, description: 'Popravka slavine', amount: 2500, spent_on: '2026-10-10', category: 'repairs' }));
  roomA = must(await a1.client.from('rooms').select('id').eq('household_id', hhA).eq('kind', 'kitchen').single()).id;
}, 60_000);

const householdTables = [
  'households', 'household_members', 'rooms', 'tasks', 'task_assignees', 'task_occurrences',
  'task_occurrence_assignees', 'task_checklist_items', 'task_comments', 'shopping_lists', 'shopping_items',
  'recipes', 'meal_plans', 'meal_ingredients', 'bills', 'expenses', 'vehicles', 'vehicle_maintenance', 'pets',
  'pet_care_records', 'plants', 'plant_care_records', 'attachments', 'notifications', 'activity_log',
  'task_occurrence_view', 'budget_entries', 'plant_status', 'pantry_items', 'task_templates',
];

describe('household isolation', () => {
  it('member of household B sees nothing of household A', async () => {
    for (const table of householdTables) {
      const col = table === 'households' ? 'id' : 'household_id';
      const { data, error } = await b1.client.from(table).select('*').eq(col, hhA);
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
  });

  it('a user without any household sees nothing at all', async () => {
    for (const table of householdTables) {
      const { data, error } = await outsider.client.from(table).select('*');
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
  });

  it('anonymous requests are rejected', async () => {
    const anon = anonClient();
    for (const table of ['households', 'tasks', 'bills', 'profiles', 'shopping_items']) {
      const { data, error } = await anon.from(table).select('*');
      expect(data ?? []).toEqual([]);
      expect(error?.code).toBe('42501');
    }
    const { error } = await anon.rpc('create_household', { p_name: 'x' });
    expect(error).not.toBeNull();
  });

  it('cannot insert rows into another household', async () => {
    const attempts = [
      b1.client.from('tasks').insert({ household_id: hhA, title: 'x', start_date: '2026-10-20' }),
      b1.client.from('shopping_items').insert({ household_id: hhA, list_id: listA, name: 'Hack' }),
      b1.client.from('bills').insert({ household_id: hhA, name: 'x', amount: 1, due_date: '2026-10-20' }),
      b1.client.from('vehicles').insert({ household_id: hhA, make: 'x' }),
      b1.client.from('pets').insert({ household_id: hhA, name: 'x' }),
      b1.client.from('plants').insert({ household_id: hhA, name: 'x' }),
      b1.client.from('expenses').insert({ household_id: hhA, description: 'x', amount: 1, spent_on: '2026-10-20' }),
      b1.client.from('task_comments').insert({ household_id: hhA, task_id: taskA, body: 'x', created_by: b1.id }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.error?.code).toBe('42501');
    }
    const rpc = await b1.client.rpc('create_task', { p_household: hhA, p_data: { title: 'x' } });
    expect(rpc.error?.message).toContain('not_a_member');
    const add = await b1.client.rpc('add_shopping_item', { p_list: listA, p_name: 'x' });
    expect(add.error?.message).toContain('not_a_member');
  });

  it('cannot update or delete rows of another household', async () => {
    const upd = await b1.client.from('tasks').update({ title: 'hacked' }).eq('id', taskA).select();
    expect(upd.data).toEqual([]);
    const occ = await b1.client.from('task_occurrences').update({ status: 'done' }).eq('id', occA).select();
    expect(occ.data).toEqual([]);
    const del = await b1.client.from('bills').delete().eq('id', billA).select();
    expect(del.data).toEqual([]);
    const del2 = await b1.client.from('shopping_items').delete().eq('household_id', hhA).select();
    expect(del2.data).toEqual([]);
    const hh = await b1.client.from('households').update({ name: 'hacked' }).eq('id', hhA).select();
    expect(hh.data).toEqual([]);
    for (const rpc of [
      b1.client.rpc('update_task', { p_occurrence: occA, p_scope: 'future', p_data: { title: 'x' } }),
      b1.client.rpc('archive_task', { p_task: taskA }),
      b1.client.rpc('pay_bill', { p_bill: billA }),
      b1.client.rpc('ensure_occurrences', { p_household: hhA }),
      b1.client.rpc('refresh_household', { p_household: hhA }),
    ]) {
      const { error } = await rpc;
      expect(error?.message).toContain('not_a_member');
    }
    // data in A is untouched
    const t = must(await a1.client.from('tasks').select('title').eq('id', taskA).single());
    expect(t.title).toBe('Usisati dnevnu sobu');
    const b = must(await a1.client.from('bills').select('status').eq('id', billA).single());
    expect(b.status).toBe('unpaid');
  });

  it('rejects links between records of different households', async () => {
    // B tries to point its own task at A's room / vehicle
    const r1 = await b1.client.from('tasks').insert({ household_id: hhB, title: 'x', start_date: '2026-10-20', room_id: roomA });
    expect(r1.error?.code).toBe('23503');
    const r2 = await b1.client.rpc('create_task', { p_household: hhB, p_data: { title: 'x', vehicle_id: vehicleA } });
    expect(r2.error?.code).toBe('23503');
    // A cannot assign a task to someone outside the household
    const r3 = await a1.client.rpc('create_task', { p_household: hhA, p_data: { title: 'x' }, p_assignees: [b1.id] });
    expect(r3.error?.message).toContain('assignee_not_active_member');
    // A cannot attach a record of household B to its own maintenance log
    const vehB = must(await b1.client.from('vehicles').insert({ household_id: hhB, make: 'Fiat' }).select('id').single()).id;
    const r4 = await a1.client.from('vehicle_maintenance').insert({ household_id: hhA, vehicle_id: vehB, kind: 'service', performed_on: '2026-10-01' });
    expect(r4.error).not.toBeNull();
    // moving a row to another household is impossible (household_id is frozen)
    const r5 = await a1.client.from('pets').update({ household_id: hhB }).eq('id', petA).select('household_id');
    expect(r5.error ?? r5.data?.[0]?.household_id === hhA).toBeTruthy();
  });

  it('profiles are only visible to co-members', async () => {
    const seenByB = must(await b1.client.from('profiles').select('id'));
    expect(seenByB.map((p) => p.id).sort()).toEqual([b1.id]);
    const seenByA2 = must(await a2.client.from('profiles').select('id'));
    expect(seenByA2.map((p) => p.id).sort()).toEqual([a1.id, a2.id, a3.id].sort());
    const upd = await a2.client.from('profiles').update({ display_name: 'hacked' }).eq('id', a1.id).select();
    expect(upd.data).toEqual([]);
  });

  it('storage paths of other households are refused by the attachments table', async () => {
    const res = await b1.client.from('attachments').insert({
      household_id: hhB, entity_type: 'bill', entity_id: billA, storage_path: `${hhB}/x.pdf`,
      file_name: 'x.pdf', mime_type: 'application/pdf', size_bytes: 100,
    });
    expect(res.error?.message).toContain('attachment_entity_mismatch');
    const res2 = await a1.client.from('attachments').insert({
      household_id: hhA, entity_type: 'bill', entity_id: billA, storage_path: `${hhB}/x.pdf`,
      file_name: 'x.pdf', mime_type: 'application/pdf', size_bytes: 100,
    });
    expect(res2.error?.code).toBe('23514');
  });
});

describe('roles and membership', () => {
  it('regular members cannot use admin functions', async () => {
    const inv = await a2.client.rpc('create_invitation', { p_household: hhA });
    expect(inv.error?.message).toContain('admin_required');
    const rm = await a2.client.rpc('remove_member', { p_household: hhA, p_user: a3.id });
    expect(rm.error?.message).toContain('admin_required');
    const role = await a2.client.rpc('set_member_role', { p_household: hhA, p_user: a2.id, p_role: 'admin' });
    expect(role.error?.message).toContain('admin_required');
    const hh = await a2.client.from('households').update({ name: 'X' }).eq('id', hhA).select();
    expect(hh.data).toEqual([]);
    const direct = await a2.client.from('household_members').update({ role: 'admin' }).eq('user_id', a2.id).select();
    expect(direct.error?.code).toBe('42501');
    const invites = must(await a2.client.from('household_invitations').select('*'));
    expect(invites).toEqual([]);
  });

  it('the admin can change household settings (same request as the settings page)', async () => {
    const saved = must(await a1.client.from('households').update({
      name: 'Kuća A2', address: 'Ulica 1', description: null, timezone: 'Europe/Belgrade', currency: 'RSD',
    }).eq('id', hhA).select('id, name').single());
    expect(saved.name).toBe('Kuća A2');
    const bad = await a1.client.from('households').update({ timezone: 'Mars/Olympus' }).eq('id', hhA).select('id');
    expect(bad.error?.message).toBe('invalid_timezone');
    must(await a1.client.from('households').update({ name: 'Kuća A' }).eq('id', hhA).select('id').single());
  });

  it('but they have equal rights on shared data', async () => {
    const t = must(await a3.client.rpc('create_task', {
      p_household: hhA, p_data: { title: 'Iznositi smeće', category: 'cleaning' }, p_assignees: [a1.id],
    }));
    expect(t).toBeTruthy();
    const occ = must(await a3.client.from('task_occurrences').select('id').eq('task_id', t as unknown as string).single());
    must(await a2.client.rpc('update_task', { p_occurrence: occ.id, p_scope: 'future', p_data: { priority: 'high' }, p_assignees: [a2.id, a3.id] }));
    const view = must(await a1.client.from('task_occurrence_view').select('priority, assignee_ids').eq('id', occ.id).single());
    expect(view.priority).toBe('high');
    expect([...view.assignee_ids].sort()).toEqual([a2.id, a3.id].sort());
  });

  it('the last admin cannot leave; admin can be transferred in a controlled way', async () => {
    const leave = await a1.client.rpc('leave_household', { p_household: hhA });
    expect(leave.error?.message).toContain('last_admin');
    must(await a1.client.rpc('transfer_admin', { p_household: hhA, p_new_admin: a2.id }));
    const members = must(await a1.client.from('household_members').select('user_id, role').eq('household_id', hhA));
    expect(members.find((m) => m.user_id === a2.id)?.role).toBe('admin');
    expect(members.find((m) => m.user_id === a1.id)?.role).toBe('member');
    const inv = await a1.client.rpc('create_invitation', { p_household: hhA });
    expect(inv.error?.message).toContain('admin_required');
    // hand it back for the remaining tests
    must(await a2.client.rpc('transfer_admin', { p_household: hhA, p_new_admin: a1.id }));
  });

  it('a removed member immediately loses access and their open assignments are released', async () => {
    const extra = await createUser('a4');
    const inv = await invite(a1, hhA);
    await join(extra, inv.token);
    const t = must(await a1.client.rpc('create_task', { p_household: hhA, p_data: { title: 'Zaliti cveće' }, p_assignees: [extra.id] })) as unknown as string;
    expect(must(await extra.client.from('tasks').select('id').eq('id', t))).toHaveLength(1);
    must(await a1.client.rpc('remove_member', { p_household: hhA, p_user: extra.id }));
    expect(must(await extra.client.from('tasks').select('id').eq('household_id', hhA))).toEqual([]);
    expect(must(await extra.client.from('households').select('id'))).toEqual([]);
    const view = must(await a1.client.from('task_occurrence_view').select('assignee_ids').eq('task_id', t).single());
    expect(view.assignee_ids).toEqual([]);
    const assign = await a1.client.rpc('create_task', { p_household: hhA, p_data: { title: 'x' }, p_assignees: [extra.id] });
    expect(assign.error?.message).toContain('assignee_not_active_member');
  });
});

describe('invitations', () => {
  it('single-use invitation cannot be used twice', async () => {
    const u1 = await createUser('inv1');
    const u2 = await createUser('inv2');
    const inv = await invite(a1, hhA, { uses: 1 });
    await join(u1, inv.token);
    const second = await u2.client.rpc('accept_invitation', { p_token: inv.token });
    expect(second.error?.message).toContain('invitation_used');
  });

  it('expired, revoked, wrong-email and invalid tokens are refused', async () => {
    const u = await createUser('inv3');
    const revoked = await invite(a1, hhA);
    must(await a1.client.rpc('revoke_invitation', { p_invitation: revoked.invitation_id }));
    expect((await u.client.rpc('accept_invitation', { p_token: revoked.token })).error?.message).toContain('invitation_revoked');

    const expired = await invite(a1, hhA, { hours: 1 });
    // simulate passage of time with the service role (tests only)
    must(await admin.from('household_invitations').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', expired.invitation_id));
    expect((await u.client.rpc('accept_invitation', { p_token: expired.token })).error?.message).toContain('invitation_expired');

    const forOther = await invite(a1, hhA, { email: 'someone.else@example.test' });
    expect((await u.client.rpc('accept_invitation', { p_token: forOther.token })).error?.message).toContain('invitation_email_mismatch');

    expect((await u.client.rpc('accept_invitation', { p_token: 'not-a-token' })).error?.message).toContain('invitation_invalid');

    const preview = must(await u.client.rpc('get_invitation_preview', { p_token: forOther.token })) as { valid: boolean; reason: string }[];
    expect(preview[0].valid).toBe(false);
    expect(preview[0].reason).toBe('email_mismatch');

    const forMe = await invite(a1, hhA, { email: u.email.toUpperCase() });
    expect(await join(u, forMe.token)).toBe(hhA);
  });

  it('only the token hash is stored', async () => {
    const inv = await invite(a1, hhA);
    const row = must(await a1.client.from('household_invitations').select('*').eq('id', inv.invitation_id).single());
    expect(JSON.stringify(row)).not.toContain(inv.token);
  });
});

describe('server-side stamping cannot be spoofed', () => {
  it('completion is recorded with the real user and time', async () => {
    const res = must(await a3.client.from('task_occurrences').update({ status: 'done' }).eq('id', occA).select('completed_by, completed_at').single());
    expect(res.completed_by).toBe(a3.id);
    expect(res.completed_at).toBeTruthy();
    // completed_by is not writable by clients
    const spoof = await a3.client.from('task_occurrences').update({ completed_by: a1.id } as never).eq('id', occA);
    expect(spoof.error?.code).toBe('42501');
  });

  it('notifications, activity log and deliveries are read-only for clients', async () => {
    const n = await a1.client.from('notifications').insert({ household_id: hhA, user_id: a2.id, type: 'task_assigned' });
    expect(n.error?.code).toBe('42501');
    const l = await a1.client.from('activity_log').insert({ household_id: hhA, entity_type: 'x', action: 'x' });
    expect(l.error?.code).toBe('42501');
    const del = await a1.client.from('activity_log').delete().eq('household_id', hhA).select();
    expect(del.error?.code ?? (del.data?.length === 0 ? 'none' : 'deleted')).not.toBe('deleted');
  });

  it('users only see their own notifications', async () => {
    const mine = must(await a2.client.from('notifications').select('user_id'));
    expect(mine.length).toBeGreaterThan(0); // a2 got "task_assigned"
    expect(mine.every((n) => n.user_id === a2.id)).toBe(true);
    const others = must(await a1.client.from('notifications').select('id').eq('user_id', a2.id));
    expect(others).toEqual([]);
  });

  it('bills can only be paid through the RPC (payer and time stamped)', async () => {
    const direct = await a1.client.from('bills').update({ status: 'paid' } as never).eq('id', billA);
    expect(direct.error?.code).toBe('42501');
    must(await a2.client.rpc('pay_bill', { p_bill: billA, p_paid_amount: 4380.5 }));
    const b = must(await a1.client.from('bills').select('status, paid_by, paid_amount, paid_at').eq('id', billA).single());
    expect(b).toMatchObject({ status: 'paid', paid_by: a2.id, paid_amount: 4380.5 });
  });

  it('only archived records can be permanently deleted', async () => {
    const del = await a1.client.from('plants').delete().eq('id', plantA).select();
    expect(del.data).toEqual([]);
    must(await a1.client.from('plants').update({ archived_at: new Date().toISOString() }).eq('id', plantA));
    const del2 = must(await a1.client.from('plants').delete().eq('id', plantA).select());
    expect(del2).toHaveLength(1);
  });
});
