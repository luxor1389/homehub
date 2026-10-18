import { useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { unwrap, useAction, useHHQuery } from '@/lib/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Attachments } from '@/features/files/Attachments';
import { Photo } from '@/features/files/Photo';
import { usePlantCare, usePlants } from '@/features/plants/api';
import { useOccurrences } from '@/features/tasks/api';
import { TaskList } from '@/features/tasks/TaskCard';
import { useTaskEditor } from '@/features/tasks/TaskEditor';
import { roomLabel } from '@/features/tasks/labels';
import { addDays, formatDate } from '@/lib/dates';
import { PLANT_CARE_KINDS, type Plant, type PlantCareRecord, type PlantStatus } from '@/lib/types';

const LIGHT = ['low', 'medium', 'bright_indirect', 'direct'] as const;

export default function PlantsPage() {
  return (
    <Routes>
      <Route index element={<PlantList />} />
      <Route path=":id" element={<PlantDetail />} />
    </Routes>
  );
}

function tone(d: string | null, today: string) {
  if (!d) return 'gray' as const;
  return d < today ? 'red' as const : d === today ? 'amber' as const : 'green' as const;
}

/** Quick "watered today" log entry. */
function useWatered() {
  const { userId } = useAuth();
  const { householdId, today } = useCurrentHousehold();
  return useAction(async (plantId: string) => unwrap(await supabase.from('plant_care_records')
    .insert({ household_id: householdId, plant_id: plantId, kind: 'watering', occurred_on: today, performed_by: userId })
    .select('id').single()), { groups: ['plants'], success: 'plants.wateredOk' });
}

function PlantList() {
  const { t, i18n } = useTranslation();
  const { today, rooms } = useCurrentHousehold();
  const plants = usePlants();
  const watered = useWatered();
  const [editing, setEditing] = useState(false);
  const list = [...(plants.data ?? [])].sort((a, b) => (a.status?.next_watering_on ?? '9999').localeCompare(b.status?.next_watering_on ?? '9999'));
  const due = list.filter((x) => x.status?.next_watering_on && x.status.next_watering_on <= today).length;
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.plants')} subtitle={due ? t('plants.dueCount', { count: due }) : undefined}
        actions={<Button icon="plus" onClick={() => setEditing(true)}>{t('plants.new')}</Button>} />
      {plants.isLoading ? <LoadingState /> : !list.length ? <EmptyState icon="leaf" title={t('plants.empty')} /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map(({ plant: p, status: s }) => {
            const room = rooms.find((r) => r.id === p.room_id);
            const wateredToday = s?.last_watered_on === today;
            return (
              <div key={p.id} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <Link to={`/plants/${p.id}`} className="shrink-0"><Photo table="plants" id={p.id} path={p.photo_path} group="plants" fallback="leaf" editable={false} /></Link>
                <div className="min-w-0 flex-1">
                  <Link to={`/plants/${p.id}`} className="block text-lg font-semibold hover:text-brand-700">{p.name}</Link>
                  <p className="truncate text-sm text-slate-600">{[p.species, room ? roomLabel(room, t) : p.location].filter(Boolean).join(' · ') || ' '}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {s?.next_watering_on
                      ? <Badge tone={tone(s.next_watering_on, today)}>{t('plants.nextWatering')}: {formatDate(s.next_watering_on, i18n.language, { day: 'numeric', month: 'short' })}</Badge>
                      : <Badge>{t('plants.noSchedule')}</Badge>}
                    <Button size="sm" variant={wateredToday ? 'ghost' : 'secondary'} icon="water" disabled={wateredToday}
                      loading={watered.isPending && watered.variables === p.id} onClick={() => watered.mutate(p.id)}>
                      {wateredToday ? t('plants.wateredToday') : t('plants.markWatered')}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && <PlantEditor plant={null} onClose={() => setEditing(false)} />}
    </div>
  );
}

const intSchema = z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)),
  z.number({ invalid_type_error: 'validation.number' }).int('validation.number').min(1, 'validation.range').max(365, 'validation.range').optional());

const plantSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(60, 'validation.tooLong'),
  species: z.string().max(80, 'validation.tooLong').optional(),
  room_id: z.string().optional(),
  location: z.string().max(80, 'validation.tooLong').optional(),
  watering_interval_days: intSchema,
  fertilizing_interval_days: intSchema,
  light_needs: z.string().optional(),
  repotting_notes: z.string().max(1000, 'validation.tooLong').optional(),
  notes: z.string().max(2000, 'validation.tooLong').optional(),
});
type PlantForm = z.infer<typeof plantSchema>;

function PlantEditor({ plant, onClose }: { plant: Plant | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { householdId, rooms } = useCurrentHousehold();
  const navigate = useNavigate();
  const form = useForm<PlantForm>({ resolver: zodResolver(plantSchema), defaultValues: plant ? {
    name: plant.name, species: plant.species ?? '', room_id: plant.room_id ?? '', location: plant.location ?? '',
    watering_interval_days: plant.watering_interval_days ?? undefined, fertilizing_interval_days: plant.fertilizing_interval_days ?? undefined,
    light_needs: plant.light_needs ?? '', repotting_notes: plant.repotting_notes ?? '', notes: plant.notes ?? '',
  } : { watering_interval_days: 7 } });
  const save = useAction(async (v: PlantForm) => {
    const row = {
      name: v.name, species: v.species || null, room_id: v.room_id || null, location: v.location || null,
      watering_interval_days: v.watering_interval_days ?? null, fertilizing_interval_days: v.fertilizing_interval_days ?? null,
      light_needs: v.light_needs || null, repotting_notes: v.repotting_notes || null, notes: v.notes || null,
    };
    if (plant) return unwrap(await supabase.from('plants').update(row).eq('id', plant.id).select('id').single()) as { id: string };
    return unwrap(await supabase.from('plants').insert({ ...row, household_id: householdId }).select('id').single()) as { id: string };
  }, { groups: ['plants'], success: 'common.saved', onSuccess: (r) => { onClose(); if (!plant) navigate(`/plants/${r.id}`); } });
  const e = form.formState.errors;
  return (
    <Modal open onClose={onClose} size="lg" title={plant ? t('plants.edit') : t('plants.new')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="plant-form" loading={save.isPending}>{t('common.save')}</Button></>}>
      <form id="plant-form" className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label={t('plants.name')} htmlFor="pl-name" error={e.name?.message}><Input id="pl-name" {...form.register('name')} /></Field>
        <Field label={t('plants.species')} htmlFor="pl-species" error={e.species?.message}><Input id="pl-species" {...form.register('species')} /></Field>
        <Field label={t('tasks.fields.room')} htmlFor="pl-room"><Select id="pl-room" {...form.register('room_id')}><option value="">—</option>{rooms.map((r) => <option key={r.id} value={r.id}>{roomLabel(r, t)}</option>)}</Select></Field>
        <Field label={t('plants.location')} htmlFor="pl-loc" error={e.location?.message}><Input id="pl-loc" {...form.register('location')} placeholder={t('plants.locationPlaceholder')} /></Field>
        <Field label={t('plants.wateringEvery')} htmlFor="pl-water" error={e.watering_interval_days?.message} hint={t('plants.daysHint')}><Input id="pl-water" type="number" min={1} max={365} {...form.register('watering_interval_days')} /></Field>
        <Field label={t('plants.fertilizingEvery')} htmlFor="pl-fert" error={e.fertilizing_interval_days?.message} hint={t('plants.daysHint')}><Input id="pl-fert" type="number" min={1} max={365} {...form.register('fertilizing_interval_days')} /></Field>
        <Field label={t('plants.light')} htmlFor="pl-light"><Select id="pl-light" {...form.register('light_needs')}><option value="">—</option>{LIGHT.map((l) => <option key={l} value={l}>{t(`plants.lightLevels.${l}`)}</option>)}</Select></Field>
        <Field label={t('plants.repotting')} htmlFor="pl-repot" error={e.repotting_notes?.message}><Input id="pl-repot" {...form.register('repotting_notes')} /></Field>
        <Field label={t('pets.notes')} htmlFor="pl-notes" className="sm:col-span-2" error={e.notes?.message}><Textarea id="pl-notes" rows={3} {...form.register('notes')} /></Field>
      </form>
    </Modal>
  );
}

function PlantDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { today, memberName, rooms } = useCurrentHousehold();
  const { openNew } = useTaskEditor();
  const plant = useHHQuery('plants', ['one', id], async () => {
    const [p, s] = await Promise.all([
      supabase.from('plants').select('*').eq('id', id!).maybeSingle(),
      supabase.from('plant_status').select('*').eq('plant_id', id!).maybeSingle(),
    ]);
    return { plant: unwrap(p) as Plant | null, status: unwrap(s) as PlantStatus | null };
  });
  const care = usePlantCare(id);
  const tasks = useOccurrences(`plant-${id}`, { from: addDays(today, -30), to: addDays(today, 120), statuses: ['planned', 'in_progress'] });
  const watered = useWatered();
  const [editing, setEditing] = useState(false);
  const [record, setRecord] = useState<PlantCareRecord | 'new' | null>(null);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const archive = useAction(async (a: boolean) => unwrap(await supabase.from('plants').update({ archived_at: a ? new Date().toISOString() : null }).eq('id', id!).select('id').single()),
    { groups: ['plants'], success: (_, a) => (a ? 'common.archivedOk' : 'tasks.restored'), onSuccess: () => setConfirm(null) });
  const remove = useAction(async () => unwrap(await supabase.from('plants').delete().eq('id', id!).select('id').single()), { groups: ['plants'], success: 'common.deleted', onSuccess: () => navigate('/plants') });
  if (plant.isLoading) return <LoadingState />;
  const p = plant.data?.plant;
  const s = plant.data?.status;
  if (!p) return <EmptyState title={t('errors.not_found')}><Link to="/plants" className="text-brand-700 underline">{t('nav.plants')}</Link></EmptyState>;
  const room = rooms.find((r) => r.id === p.room_id);
  const records = care.data ?? [];
  return (
    <div className="space-y-4">
      <Link to="/plants" className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600"><Icon name="chevronLeft" className="h-4 w-4" />{t('nav.plants')}</Link>
      <div className="flex flex-wrap items-start gap-4">
        <Photo table="plants" id={p.id} path={p.photo_path} group="plants" fallback="leaf" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{p.name}</h1>
          <p className="text-slate-600">{[p.species, room ? roomLabel(room, t) : null, p.location].filter(Boolean).join(' · ')}</p>
          {p.archived_at && <Badge>{t('common.archived')}</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {!p.archived_at && <Button icon="water" disabled={s?.last_watered_on === today} loading={watered.isPending} onClick={() => watered.mutate(p.id)}>
            {s?.last_watered_on === today ? t('plants.wateredToday') : t('plants.markWatered')}</Button>}
          <Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>{t('common.edit')}</Button>
          {p.archived_at ? <>
            <Button variant="secondary" icon="restore" onClick={() => archive.mutate(false)}>{t('common.restore')}</Button>
            <Button variant="danger" icon="trash" onClick={() => setConfirm('delete')}>{t('common.deletePermanently')}</Button>
          </> : <Button variant="ghost" icon="archive" onClick={() => setConfirm('archive')}>{t('common.archive')}</Button>}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('plants.care')}>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Info label={t('plants.wateringEvery')} value={p.watering_interval_days ? t('plants.everyDays', { count: p.watering_interval_days }) : '—'} />
              <Info label={t('plants.fertilizingEvery')} value={p.fertilizing_interval_days ? t('plants.everyDays', { count: p.fertilizing_interval_days }) : '—'} />
              <Info label={t('plants.lastWatered')} value={s?.last_watered_on ? formatDate(s.last_watered_on, i18n.language) : '—'} />
              <Info label={t('plants.nextWatering')} value={s?.next_watering_on ? <Badge tone={tone(s.next_watering_on, today)}>{formatDate(s.next_watering_on, i18n.language)}</Badge> : '—'} />
              <Info label={t('plants.lastFertilized')} value={s?.last_fertilized_on ? formatDate(s.last_fertilized_on, i18n.language) : '—'} />
              <Info label={t('plants.nextFertilizing')} value={s?.next_fertilizing_on ? <Badge tone={tone(s.next_fertilizing_on, today)}>{formatDate(s.next_fertilizing_on, i18n.language)}</Badge> : '—'} />
              <Info label={t('plants.light')} value={p.light_needs ? t(`plants.lightLevels.${p.light_needs}`) : '—'} />
              <Info label={t('plants.repotting')} value={p.repotting_notes || '—'} />
            </dl>
            {p.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{p.notes}</p>}
          </Card>
          <Card title={t('plants.history')} action={<Button size="sm" icon="plus" onClick={() => setRecord('new')}>{t('pets.addRecord')}</Button>}>
            {care.isLoading ? <LoadingState /> : records.length ? (
              <ul className="divide-y divide-slate-100">
                {records.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="w-full py-2 text-left text-sm" onClick={() => setRecord(r)}>
                      <span className="font-medium">{t(`plants.kinds.${r.kind}`)}</span>{r.notes ? ` · ${r.notes}` : ''}
                      <span className="block text-xs text-slate-500">{formatDate(r.occurred_on, i18n.language)}{r.performed_by ? ` · ${memberName(r.performed_by)}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">{t('pets.noRecords')}</p>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={t('pets.recurringTasks')} action={<Button size="sm" variant="ghost" icon="plus" onClick={() => openNew({
            category: 'plants', plant_id: p.id, recurrence_freq: 'daily', recurrence_interval: p.watering_interval_days ?? 7,
            title: t('plants.defaultTaskTitle', { name: p.name }), estimated_minutes: 5,
          })}>{t('common.add')}</Button>}>
            <p className="mb-2 text-xs text-slate-500">{t('plants.taskHint')}</p>
            <TaskList items={(tasks.data ?? []).filter((o) => o.plant_id === p.id).slice(0, 10)} empty={t('pets.noTasks')} compact />
          </Card>
          <Attachments entityType="plant" entityId={p.id} />
        </div>
      </div>
      {editing && <PlantEditor plant={p} onClose={() => setEditing(false)} />}
      {record && <PlantCareEditor plant={p} record={record === 'new' ? null : record} onClose={() => setRecord(null)} />}
      <ConfirmDialog open={confirm === 'archive'} title={t('common.archive')} message={t('plants.archiveConfirm', { name: p.name })} confirmLabel={t('common.archive')} loading={archive.isPending} onCancel={() => setConfirm(null)} onConfirm={() => archive.mutate(true)} />
      <ConfirmDialog open={confirm === 'delete'} title={t('common.deletePermanently')} message={t('plants.deleteConfirm', { name: p.name })} loading={remove.isPending} onCancel={() => setConfirm(null)} onConfirm={() => remove.mutate(undefined)} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-0.5">{value}</dd></div>;
}

const recSchema = z.object({
  kind: z.enum(PLANT_CARE_KINDS),
  occurred_on: z.string().min(1, 'validation.required'),
  notes: z.string().max(1000, 'validation.tooLong').optional(),
  performed_by: z.string().optional(),
});
type RecForm = z.infer<typeof recSchema>;

function PlantCareEditor({ plant, record, onClose }: { plant: Plant; record: PlantCareRecord | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { userId } = useAuth();
  const { householdId, today, activeMembers } = useCurrentHousehold();
  const [confirm, setConfirm] = useState(false);
  const form = useForm<RecForm>({ resolver: zodResolver(recSchema), defaultValues: record
    ? { kind: record.kind as RecForm['kind'], occurred_on: record.occurred_on, notes: record.notes ?? '', performed_by: record.performed_by ?? '' }
    : { kind: 'watering', occurred_on: today, performed_by: userId ?? '' } });
  const save = useAction(async (v: RecForm) => {
    const row = { ...v, notes: v.notes || null, performed_by: v.performed_by || null };
    if (record) return unwrap(await supabase.from('plant_care_records').update(row).eq('id', record.id).select('id').single());
    return unwrap(await supabase.from('plant_care_records').insert({ ...row, household_id: householdId, plant_id: plant.id }).select('id').single());
  }, { groups: ['plants'], success: 'common.saved', onSuccess: onClose });
  const remove = useAction(async () => unwrap(await supabase.from('plant_care_records').delete().eq('id', record!.id).select('id').single()), { groups: ['plants'], success: 'common.deleted', onSuccess: onClose });
  const e = form.formState.errors;
  return (
    <Modal open onClose={onClose} title={record ? t('pets.editRecord') : t('pets.addRecord')}
      footer={<>
        {record && <Button variant="ghost" icon="trash" className="mr-auto text-red-700" onClick={() => setConfirm(true)}>{t('common.delete')}</Button>}
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="plant-care-form" loading={save.isPending}>{t('common.save')}</Button>
      </>}>
      <form id="plant-care-form" className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label={t('pets.kind')} htmlFor="pc-kind"><Select id="pc-kind" {...form.register('kind')}>{PLANT_CARE_KINDS.map((k) => <option key={k} value={k}>{t(`plants.kinds.${k}`)}</option>)}</Select></Field>
        <Field label={t('budget.date')} htmlFor="pc-date" error={e.occurred_on?.message}><Input id="pc-date" type="date" {...form.register('occurred_on')} /></Field>
        <Field label={t('pets.performedBy')} htmlFor="pc-by"><Select id="pc-by" {...form.register('performed_by')}><option value="">—</option>{activeMembers.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</Select></Field>
        <Field label={t('pets.notes')} htmlFor="pc-notes" className="sm:col-span-2" error={e.notes?.message}><Textarea id="pc-notes" rows={2} {...form.register('notes')} /></Field>
      </form>
      <ConfirmDialog open={confirm} title={t('common.delete')} message={t('pets.deleteRecord')} loading={remove.isPending} onCancel={() => setConfirm(false)} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}
