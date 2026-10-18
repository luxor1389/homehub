import { beforeAll, describe, expect, it } from 'vitest';
import { admin, createHousehold, createUser, invite, join, must, type TestUser } from './helpers';

let u1: TestUser, u2: TestUser, u3: TestUser;
let hh: string;

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
// "today" in Europe/Belgrade, like the server computes it
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade' }).format(new Date());
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

beforeAll(async () => {
  [u1, u2, u3] = await Promise.all([createUser('t1'), createUser('t2'), createUser('t3')]);
  hh = await createHousehold(u1, 'Porodica');
  const inv = await invite(u1, hh, { uses: 2 });
  await join(u2, inv.token);
  await join(u3, inv.token);
}, 60_000);

async function occurrences(taskId: string) {
  return must(await u1.client.from('task_occurrence_view').select('*').eq('task_id', taskId).order('scheduled_date'));
}

describe('three members share tasks', () => {
  it('every member sees a task created by another member and its assignment', async () => {
    const id = must(await u1.client.rpc('create_task', {
      p_household: hh, p_data: { title: 'Oprati prozore', category: 'cleaning', estimated_minutes: 45, priority: 'high' },
      p_assignees: [u2.id, u3.id], p_checklist: ['Spremiti sredstvo', 'Oprati stakla', 'Obrisati ramove'],
    })) as unknown as string;
    for (const u of [u1, u2, u3]) {
      const rows = must(await u.client.from('task_occurrence_view').select('title, assignee_ids, estimated_minutes').eq('task_id', id));
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('Oprati prozore');
      expect([...rows[0].assignee_ids].sort()).toEqual([u2.id, u3.id].sort());
    }
    const checklist = must(await u3.client.from('task_checklist_items').select('label').eq('task_id', id).order('position'));
    expect(checklist.map((c) => c.label)).toEqual(['Spremiti sredstvo', 'Oprati stakla', 'Obrisati ramove']);
    // assignees (not the creator) got an in-app notification
    const n2 = must(await u2.client.from('notifications').select('type, params').eq('type', 'task_assigned'));
    expect(n2.some((n) => (n.params as { task_id: string }).task_id === id)).toBe(true);
    const n1 = must(await u1.client.from('notifications').select('id').eq('type', 'task_assigned'));
    expect(n1).toEqual([]);
  });

  it('unassigned tasks are visible to all members', async () => {
    const id = must(await u2.client.rpc('create_task', { p_household: hh, p_data: { title: 'Zameniti sijalicu', category: 'maintenance' } })) as unknown as string;
    const rows = must(await u3.client.from('task_occurrence_view').select('assignee_ids').eq('task_id', id));
    expect(rows[0].assignee_ids).toEqual([]);
  });

  it('a change by one member is visible to the others', async () => {
    const id = must(await u1.client.rpc('create_task', { p_household: hh, p_data: { title: 'Kupiti filter' } })) as unknown as string;
    const [occ] = await occurrences(id);
    must(await u3.client.rpc('update_task', { p_occurrence: occ.id, p_scope: 'future', p_data: { title: 'Kupiti filter za vodu', due_date: addDays(today(), 3) }, p_assignees: [u1.id] }));
    const seen = must(await u2.client.from('task_occurrence_view').select('title, due_date, assignee_ids').eq('id', occ.id).single());
    expect(seen.title).toBe('Kupiti filter za vodu');
    expect(seen.due_date).toBe(addDays(today(), 3));
    expect(seen.assignee_ids).toEqual([u1.id]);
    // u1 (new assignee) is notified about the assignment and the date change
    const types = must(await u1.client.from('notifications').select('type').eq('entity_id', occ.id)).map((n) => n.type).sort();
    expect(types).toEqual(['task_assigned', 'task_due_changed']);
  });

  it('completing records who and when; reopening keeps the history', async () => {
    const id = must(await u1.client.rpc('create_task', { p_household: hh, p_data: { title: 'Promeniti posteljinu' }, p_assignees: [u2.id] })) as unknown as string;
    const [occ] = await occurrences(id);
    const before = Date.now();
    const done = must(await u2.client.from('task_occurrences').update({ status: 'done' }).eq('id', occ.id).select('completed_by, completed_at').single());
    expect(done.completed_by).toBe(u2.id);
    expect(new Date(done.completed_at!).getTime()).toBeGreaterThanOrEqual(before - 5000);
    const reopened = must(await u3.client.from('task_occurrences').update({ status: 'planned' }).eq('id', occ.id).select('completed_by, status').single());
    expect(reopened).toMatchObject({ status: 'planned', completed_by: null });
    const history = must(await u1.client.from('activity_log').select('action, actor_id, details').eq('parent_id', id).eq('action', 'status').order('created_at'));
    expect(history.map((h) => [h.actor_id, (h.details as { to: string }).to])).toEqual([[u2.id, 'done'], [u3.id, 'planned']]);
  });

  it('marks an unfinished task with a past deadline as overdue automatically', async () => {
    const id = must(await u1.client.rpc('create_task', { p_household: hh, p_data: { title: 'Platiti komunalije', start_date: addDays(today(), -2) } })) as unknown as string;
    const [occ] = await occurrences(id);
    expect(occ.status).toBe('planned');
    expect(occ.is_overdue).toBe(true);
    must(await u1.client.from('task_occurrences').update({ status: 'done' }).eq('id', occ.id));
    const after = must(await u1.client.from('task_occurrence_view').select('is_overdue').eq('id', occ.id).single());
    expect(after.is_overdue).toBe(false);
  });
});

describe('recurring tasks', () => {
  it('generates daily occurrences idempotently (no duplicates on repeated/concurrent generation)', async () => {
    const id = must(await u1.client.rpc('create_task', {
      p_household: hh, p_data: { title: 'Iznositi smeće', recurrence_freq: 'daily', start_date: today() }, p_assignees: [u3.id],
    })) as unknown as string;
    const first = await occurrences(id);
    expect(first.length).toBe(61); // today + 60 days
    await Promise.all([
      u1.client.rpc('ensure_occurrences', { p_household: hh }),
      u2.client.rpc('ensure_occurrences', { p_household: hh }),
      u3.client.rpc('refresh_household', { p_household: hh }),
    ]);
    const again = await occurrences(id);
    expect(again.length).toBe(61);
    expect(new Set(again.map((o) => o.scheduled_date)).size).toBe(61);
    expect(again.every((o) => o.assignee_ids.length === 1 && o.assignee_ids[0] === u3.id)).toBe(true);
  });

  it('weekly on selected weekdays and every-N-weeks schedules', async () => {
    const id = must(await u1.client.rpc('create_task', {
      p_household: hh, p_data: { title: 'Usisavanje', recurrence_freq: 'weekly', recurrence_weekdays: [1, 4], start_date: today() },
    })) as unknown as string;
    const occ = await occurrences(id);
    const weekdays = new Set(occ.map((o) => new Date(`${o.scheduled_date}T12:00:00Z`).getUTCDay()));
    expect([...weekdays].sort()).toEqual([1, 4]); // Monday, Thursday
    expect(occ.length).toBeGreaterThanOrEqual(16);

    const biweekly = must(await u1.client.rpc('create_task', {
      p_household: hh, p_data: { title: 'Pranje kupatila', recurrence_freq: 'weekly', recurrence_interval: 2, start_date: today() },
    })) as unknown as string;
    const b = await occurrences(biweekly);
    for (let i = 1; i < b.length; i++) {
      expect((Date.parse(b[i].scheduled_date) - Date.parse(b[i - 1].scheduled_date)) / 86400000).toBe(14);
    }
  });

  it('monthly on the 31st clamps to the last day of shorter months, yearly gets its next date', async () => {
    const id = must(await u1.client.rpc('create_task', {
      p_household: hh, p_data: { title: 'Očitati struju', recurrence_freq: 'monthly', start_date: '2026-10-31' },
    })) as unknown as string;
    const dates = (await occurrences(id)).map((o) => o.scheduled_date);
    expect(dates.slice(0, 2)).toEqual(['2026-10-31', '2026-11-30']);

    const y = must(await u1.client.rpc('create_task', {
      p_household: hh, p_data: { title: 'Čišćenje dimnjaka', recurrence_freq: 'yearly', start_date: addDays(today(), -10) },
    })) as unknown as string;
    const yd = (await occurrences(y)).map((o) => o.scheduled_date);
    expect(yd).toHaveLength(1); // the next one, a year after start (past start is not back-filled)
    expect(yd[0]).toBe(String(Number(addDays(today(), -10).slice(0, 4)) + 1) + addDays(today(), -10).slice(4));
  });

  it('completing the last generated occurrence produces the next one', async () => {
    const y = must(await u1.client.rpc('create_task', {
      p_household: hh, p_data: { title: 'Servis klime', recurrence_freq: 'yearly', start_date: today() },
    })) as unknown as string;
    let occ = await occurrences(y);
    expect(occ).toHaveLength(1);
    must(await u2.client.from('task_occurrences').update({ status: 'done' }).eq('id', occ[0].id));
    occ = await occurrences(y);
    expect(occ).toHaveLength(2);
    expect(occ[1].status).toBe('planned');
    // repeating the status write does not create more
    must(await u2.client.from('task_occurrences').update({ status: 'done' }).eq('id', occ[0].id));
    expect(await occurrences(y)).toHaveLength(2);
  });

  it('edit only this occurrence vs. all future occurrences', async () => {
    const id = must(await u1.client.rpc('create_task', {
      p_household: hh, p_data: { title: 'Zalivanje', recurrence_freq: 'weekly', start_date: today() }, p_assignees: [u1.id],
    })) as unknown as string;
    let occ = await occurrences(id);
    const [o0, o1, o2] = occ;
    // this only: rename + reassign + move the 2nd occurrence
    must(await u2.client.rpc('update_task', {
      p_occurrence: o1.id, p_scope: 'this', p_data: { title: 'Zalivanje + prihrana', due_date: addDays(o1.scheduled_date, 1) }, p_assignees: [u2.id],
    }));
    occ = await occurrences(id);
    expect(occ.find((o) => o.id === o1.id)).toMatchObject({ title: 'Zalivanje + prihrana', assignee_ids: [u2.id], due_date: addDays(o1.scheduled_date, 1) });
    expect(occ.find((o) => o.id === o2.id)).toMatchObject({ title: 'Zalivanje', assignee_ids: [u1.id] });

    // complete the first one, then change all future from the 3rd on
    must(await u1.client.from('task_occurrences').update({ status: 'done' }).eq('id', o0.id));
    must(await u3.client.rpc('update_task', {
      p_occurrence: o2.id, p_scope: 'future', p_data: { title: 'Zalivanje biljaka', estimated_minutes: 15 }, p_assignees: [u3.id],
    }));
    occ = await occurrences(id);
    const done = occ.find((o) => o.id === o0.id)!;
    expect(done.status).toBe('done');
    expect(done.title).toBe('Zalivanje biljaka'); // definition title (no override) – history keeps status/completer
    const second = occ.find((o) => o.scheduled_date === o1.scheduled_date)!;
    expect(second.title).toBe('Zalivanje + prihrana'); // earlier override untouched
    const future = occ.filter((o) => o.scheduled_date >= o2.scheduled_date);
    expect(future.length).toBeGreaterThan(5);
    expect(future.every((o) => o.title === 'Zalivanje biljaka' && o.estimated_minutes === 15)).toBe(true);
    expect(future.every((o) => o.assignee_ids.length === 1 && o.assignee_ids[0] === u3.id)).toBe(true);
    expect(new Set(occ.map((o) => o.scheduled_date)).size).toBe(occ.length);
  });

  it('changing the rule for all future occurrences replaces the schedule from that point', async () => {
    const id = must(await u1.client.rpc('create_task', {
      p_household: hh, p_data: { title: 'Prašina', recurrence_freq: 'daily', start_date: today() },
    })) as unknown as string;
    const occ = await occurrences(id);
    must(await u1.client.from('task_occurrences').update({ status: 'done' }).eq('id', occ[0].id));
    must(await u1.client.rpc('update_task', {
      p_occurrence: occ[1].id, p_scope: 'future', p_data: { recurrence_freq: 'weekly', recurrence_interval: 1 },
    }));
    const after = await occurrences(id);
    expect(after[0].status).toBe('done');
    const rest = after.slice(1);
    for (let i = 1; i < rest.length; i++) {
      expect((Date.parse(rest[i].scheduled_date) - Date.parse(rest[i - 1].scheduled_date)) / 86400000).toBe(7);
    }
  });

  it('archiving removes future planned occurrences but keeps history; restoring regenerates', async () => {
    const id = must(await u1.client.rpc('create_task', {
      p_household: hh, p_data: { title: 'Reciklaža', recurrence_freq: 'weekly', start_date: today() },
    })) as unknown as string;
    const occ = await occurrences(id);
    must(await u1.client.from('task_occurrences').update({ status: 'done' }).eq('id', occ[0].id));
    must(await u1.client.rpc('archive_task', { p_task: id }));
    expect(await occurrences(id)).toEqual([]); // archived tasks are hidden from the view
    const raw = must(await admin.from('task_occurrences').select('status').eq('task_id', id));
    expect(raw.map((r) => r.status)).toEqual(['done']);
    must(await u1.client.rpc('archive_task', { p_task: id, p_archive: false }));
    expect((await occurrences(id)).length).toBeGreaterThan(5);
  });

  it('templates turn into recurring tasks', async () => {
    const tpl = must(await u1.client.from('task_templates').insert({
      household_id: hh, title: 'Čišćenje frižidera', category: 'cleaning', subcategory: 'fridge',
      recurrence_freq: 'monthly', checklist: ['Izvaditi namirnice', 'Oprati police'],
    }).select('id').single());
    const id = must(await u2.client.rpc('create_task_from_template', { p_template: tpl.id, p_assignees: [u2.id] })) as unknown as string;
    const t = must(await u2.client.from('tasks').select('title, recurrence_freq, subcategory').eq('id', id).single());
    expect(t).toMatchObject({ title: 'Čišćenje frižidera', recurrence_freq: 'monthly', subcategory: 'fridge' });
    expect(must(await u2.client.from('task_checklist_items').select('id').eq('task_id', id))).toHaveLength(2);
  });
});

describe('agreements, comments and checklists', () => {
  it('records comments, agreed deadlines and swaps; only authors edit their comments', async () => {
    const id = must(await u1.client.rpc('create_task', { p_household: hh, p_data: { title: 'Kosidba' }, p_assignees: [u1.id] })) as unknown as string;
    must(await u1.client.from('task_comments').insert({ household_id: hh, task_id: id, body: 'Ja ću u subotu', kind: 'agreement', agreed_due_date: addDays(today(), 5), created_by: u1.id }));
    must(await u2.client.from('task_comments').insert({ household_id: hh, task_id: id, body: 'Menjam se sa tobom', kind: 'swap', swap_with: u1.id, created_by: u2.id }));
    // a forged author is replaced by the real one on the server
    const forged = must(await u2.client.from('task_comments').insert({ household_id: hh, task_id: id, body: 'x', created_by: u1.id }).select('id, created_by').single());
    expect(forged.created_by).toBe(u2.id);
    must(await u2.client.from('task_comments').delete().eq('id', forged.id));
    const all = must(await u3.client.from('task_comments').select('kind').eq('task_id', id));
    expect(all.map((c) => c.kind).sort()).toEqual(['agreement', 'swap']);
    const edit = await u3.client.from('task_comments').update({ body: 'izmena' }).eq('task_id', id).select();
    expect(edit.data).toEqual([]);
  });

  it('checklist progress is tracked per occurrence and stamped with the member', async () => {
    const id = must(await u1.client.rpc('create_task', { p_household: hh, p_data: { title: 'Spremanje kuhinje', recurrence_freq: 'weekly', start_date: today() }, p_checklist: ['Sudovi', 'Šporet'] })) as unknown as string;
    const [o0] = await occurrences(id);
    const items = must(await u1.client.from('task_checklist_items').select('id').eq('task_id', id).order('position'));
    const p = must(await u2.client.from('task_checklist_progress').insert({ household_id: hh, occurrence_id: o0.id, item_id: items[0].id }).select('done_by').single());
    expect(p.done_by).toBe(u2.id);
  });
});

describe('workload overview data', () => {
  it('per-member counts and minutes can be derived from the view', async () => {
    const rows = must(await u1.client.from('task_occurrence_view').select('assignee_ids, estimated_minutes, status')
      .eq('household_id', hh).in('status', ['planned', 'in_progress']).lte('due_date', addDays(today(), 7)));
    const perMember = new Map<string, { count: number; minutes: number }>();
    for (const r of rows) for (const uid of r.assignee_ids) {
      const cur = perMember.get(uid) ?? { count: 0, minutes: 0 };
      perMember.set(uid, { count: cur.count + 1, minutes: cur.minutes + (r.estimated_minutes ?? 0) });
    }
    expect(perMember.get(u3.id)!.count).toBeGreaterThan(0);
  });
});
