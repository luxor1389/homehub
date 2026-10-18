import { useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { unwrap, useAction, useHHQuery } from '@/lib/hooks';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Attachments } from '@/features/files/Attachments';
import { Photo } from '@/features/files/Photo';
import { usePetCare, usePets, upcomingPetCare } from '@/features/pets/api';
import { useOccurrences } from '@/features/tasks/api';
import { TaskList } from '@/features/tasks/TaskCard';
import { useTaskEditor } from '@/features/tasks/TaskEditor';
import { addDays, formatDate, formatMoney } from '@/lib/dates';
import { CURRENCIES } from '@/lib/options';
import { PET_CARE_KINDS, PET_SPECIES, type Pet, type PetCareRecord } from '@/lib/types';

export default function PetsPage() {
  return (
    <Routes>
      <Route index element={<PetList />} />
      <Route path=":id" element={<PetDetail />} />
    </Routes>
  );
}

function dueTone(d: string, today: string) {
  return d < today ? 'red' as const : d <= addDays(today, 7) ? 'amber' as const : 'green' as const;
}

function PetList() {
  const { t, i18n } = useTranslation();
  const { today } = useCurrentHousehold();
  const pets = usePets();
  const care = usePetCare();
  const [editing, setEditing] = useState(false);
  const upcoming = upcomingPetCare(care.data ?? []);
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.pets')} actions={<Button icon="plus" onClick={() => setEditing(true)}>{t('pets.new')}</Button>} />
      {pets.isLoading ? <LoadingState /> : !pets.data?.length ? <EmptyState icon="paw" title={t('pets.empty')} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {pets.data.map((p) => {
            const next = upcoming.filter((r) => r.pet_id === p.id).slice(0, 3);
            return (
              <Link key={p.id} to={`/pets/${p.id}`} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-600">
                <Photo table="pets" id={p.id} path={p.photo_path} group="pets" fallback="paw" editable={false} />
                <div className="min-w-0">
                  <p className="text-lg font-semibold">{p.name}</p>
                  <p className="text-sm text-slate-600">{t(`pets.species.${p.species}`)}{p.breed ? ` · ${p.breed}` : ''}</p>
                  <div className="mt-2 flex flex-wrap gap-1">{next.map((r) => <Badge key={r.id} tone={dueTone(r.next_due_on!, today)}>{t(`pets.care.${r.kind}`)}: {formatDate(r.next_due_on, i18n.language, { day: 'numeric', month: 'short' })}</Badge>)}</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {editing && <PetEditor pet={null} onClose={() => setEditing(false)} />}
    </div>
  );
}

const petSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(60, 'validation.tooLong'),
  species: z.enum(PET_SPECIES),
  breed: z.string().max(60, 'validation.tooLong').optional(),
  birth_date: z.string().optional(),
  feeding_plan: z.string().max(2000, 'validation.tooLong').optional(),
  notes: z.string().max(2000, 'validation.tooLong').optional(),
});
type PetForm = z.infer<typeof petSchema>;

function PetEditor({ pet, onClose }: { pet: Pet | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { householdId } = useCurrentHousehold();
  const navigate = useNavigate();
  const form = useForm<PetForm>({ resolver: zodResolver(petSchema), defaultValues: pet ? {
    name: pet.name, species: pet.species as PetForm['species'], breed: pet.breed ?? '', birth_date: pet.birth_date ?? '', feeding_plan: pet.feeding_plan ?? '', notes: pet.notes ?? '',
  } : { species: 'dog' } });
  const save = useAction(async (v: PetForm) => {
    const row = { ...v, breed: v.breed || null, birth_date: v.birth_date || null, feeding_plan: v.feeding_plan || null, notes: v.notes || null };
    if (pet) return unwrap(await supabase.from('pets').update(row).eq('id', pet.id).select('id').single()) as { id: string };
    return unwrap(await supabase.from('pets').insert({ ...row, household_id: householdId }).select('id').single()) as { id: string };
  }, { groups: ['pets'], success: 'common.saved', onSuccess: (r) => { onClose(); if (!pet) navigate(`/pets/${r.id}`); } });
  const e = form.formState.errors;
  return (
    <Modal open onClose={onClose} size="lg" title={pet ? t('pets.edit') : t('pets.new')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="pet-form" loading={save.isPending}>{t('common.save')}</Button></>}>
      <form id="pet-form" className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label={t('pets.name')} htmlFor="p-name" error={e.name?.message}><Input id="p-name" {...form.register('name')} /></Field>
        <Field label={t('pets.speciesLabel')} htmlFor="p-species"><Select id="p-species" {...form.register('species')}>{PET_SPECIES.map((s) => <option key={s} value={s}>{t(`pets.species.${s}`)}</option>)}</Select></Field>
        <Field label={t('pets.breed')} htmlFor="p-breed"><Input id="p-breed" {...form.register('breed')} /></Field>
        <Field label={t('pets.birthDate')} htmlFor="p-birth"><Input id="p-birth" type="date" {...form.register('birth_date')} /></Field>
        <Field label={t('pets.feedingPlan')} htmlFor="p-feed" className="sm:col-span-2" error={e.feeding_plan?.message}><Textarea id="p-feed" rows={3} {...form.register('feeding_plan')} /></Field>
        <Field label={t('pets.notes')} htmlFor="p-notes" className="sm:col-span-2" error={e.notes?.message}><Textarea id="p-notes" rows={2} {...form.register('notes')} /></Field>
      </form>
    </Modal>
  );
}

function PetDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { today, memberName } = useCurrentHousehold();
  const { openNew } = useTaskEditor();
  const pet = useHHQuery('pets', ['one', id], async () => unwrap(await supabase.from('pets').select('*').eq('id', id!).maybeSingle()) as Pet | null);
  const care = usePetCare(id);
  const tasks = useOccurrences(`pet-${id}`, { from: addDays(today, -30), to: addDays(today, 120), statuses: ['planned', 'in_progress'] });
  const [editing, setEditing] = useState(false);
  const [record, setRecord] = useState<PetCareRecord | 'new' | null>(null);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const archive = useAction(async (a: boolean) => unwrap(await supabase.from('pets').update({ archived_at: a ? new Date().toISOString() : null }).eq('id', id!).select('id').single()),
    { groups: ['pets'], success: (_, a) => (a ? 'common.archivedOk' : 'tasks.restored'), onSuccess: () => setConfirm(null) });
  const remove = useAction(async () => unwrap(await supabase.from('pets').delete().eq('id', id!).select('id').single()), { groups: ['pets'], success: 'common.deleted', onSuccess: () => navigate('/pets') });
  if (pet.isLoading) return <LoadingState />;
  const p = pet.data;
  if (!p) return <EmptyState title={t('errors.not_found')}><Link to="/pets" className="text-brand-700 underline">{t('nav.pets')}</Link></EmptyState>;
  const records = care.data ?? [];
  const upcoming = upcomingPetCare(records);
  return (
    <div className="space-y-4">
      <Link to="/pets" className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600"><Icon name="chevronLeft" className="h-4 w-4" />{t('nav.pets')}</Link>
      <div className="flex flex-wrap items-start gap-4">
        <Photo table="pets" id={p.id} path={p.photo_path} group="pets" fallback="paw" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{p.name}</h1>
          <p className="text-slate-600">{t(`pets.species.${p.species}`)}{p.breed ? ` · ${p.breed}` : ''}{p.birth_date ? ` · ${formatDate(p.birth_date, i18n.language)}` : ''}</p>
          {p.archived_at && <Badge>{t('common.archived')}</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>{t('common.edit')}</Button>
          {p.archived_at ? <>
            <Button variant="secondary" icon="restore" onClick={() => archive.mutate(false)}>{t('common.restore')}</Button>
            <Button variant="danger" icon="trash" onClick={() => setConfirm('delete')}>{t('common.deletePermanently')}</Button>
          </> : <Button variant="ghost" icon="archive" onClick={() => setConfirm('archive')}>{t('common.archive')}</Button>}
        </div>
      </div>
      <p className="rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-900"><Icon name="info" className="mr-1 inline h-4 w-4" />{t('pets.privacyNote')}</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {(p.feeding_plan || p.notes) && (
            <Card title={t('pets.feedingPlan')}>
              {p.feeding_plan && <p className="whitespace-pre-wrap text-sm">{p.feeding_plan}</p>}
              {p.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{p.notes}</p>}
            </Card>
          )}
          <Card title={t('pets.careHistory')} action={<Button size="sm" icon="plus" onClick={() => setRecord('new')}>{t('pets.addRecord')}</Button>}>
            {care.isLoading ? <LoadingState /> : records.length ? (
              <ul className="divide-y divide-slate-100">
                {records.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm" onClick={() => setRecord(r)}>
                      <span className="min-w-0">
                        <span className="font-medium">{t(`pets.care.${r.kind}`)}</span>{r.description ? ` · ${r.description}` : ''}
                        <span className="block text-xs text-slate-500">{formatDate(r.occurred_on, i18n.language)}{r.performed_by ? ` · ${memberName(r.performed_by)}` : ''}{r.next_due_on ? ` · ${t('pets.nextDue')}: ${formatDate(r.next_due_on, i18n.language)}` : ''}</span>
                      </span>
                      {r.cost != null && <span className="font-semibold">{formatMoney(Number(r.cost), r.currency, i18n.language)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">{t('pets.noRecords')}</p>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={t('pets.upcoming')}>
            {upcoming.length ? <ul className="space-y-1 text-sm">{upcoming.map((r) => <li key={r.id} className="flex justify-between gap-2"><span>{t(`pets.care.${r.kind}`)}</span><Badge tone={dueTone(r.next_due_on!, today)}>{formatDate(r.next_due_on, i18n.language)}</Badge></li>)}</ul> : <p className="text-sm text-slate-500">—</p>}
          </Card>
          <Card title={t('pets.recurringTasks')} action={<Button size="sm" variant="ghost" icon="plus" onClick={() => openNew({ category: 'pets', pet_id: p.id, recurrence_freq: 'daily', title: t('pets.defaultTaskTitle', { name: p.name }) })}>{t('common.add')}</Button>}>
            <TaskList items={(tasks.data ?? []).filter((o) => o.pet_id === p.id).slice(0, 10)} empty={t('pets.noTasks')} compact />
          </Card>
          <Attachments entityType="pet" entityId={p.id} />
        </div>
      </div>
      {editing && <PetEditor pet={p} onClose={() => setEditing(false)} />}
      {record && <CareEditor pet={p} record={record === 'new' ? null : record} onClose={() => setRecord(null)} />}
      <ConfirmDialog open={confirm === 'archive'} title={t('common.archive')} message={t('pets.archiveConfirm', { name: p.name })} confirmLabel={t('common.archive')} loading={archive.isPending} onCancel={() => setConfirm(null)} onConfirm={() => archive.mutate(true)} />
      <ConfirmDialog open={confirm === 'delete'} title={t('common.deletePermanently')} message={t('pets.deleteConfirm', { name: p.name })} loading={remove.isPending} onCancel={() => setConfirm(null)} onConfirm={() => remove.mutate(undefined)} />
    </div>
  );
}

const careSchema = z.object({
  kind: z.enum(PET_CARE_KINDS),
  occurred_on: z.string().min(1, 'validation.required'),
  next_due_on: z.string().optional(),
  description: z.string().max(2000, 'validation.tooLong').optional(),
  cost: z.preprocess((v) => (v === '' || v == null ? undefined : Number(String(v).replace(',', '.'))), z.number({ invalid_type_error: 'validation.number' }).min(0, 'validation.positive').optional()),
  currency: z.string(),
  performed_by: z.string().optional(),
}).refine((v) => !v.next_due_on || v.next_due_on >= v.occurred_on, { path: ['next_due_on'], message: 'validation.nextAfter' });
type CareForm = z.infer<typeof careSchema>;

function CareEditor({ pet, record, onClose }: { pet: Pet; record: PetCareRecord | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { householdId, household, today, activeMembers } = useCurrentHousehold();
  const [confirm, setConfirm] = useState(false);
  const form = useForm<CareForm>({ resolver: zodResolver(careSchema), defaultValues: record ? {
    kind: record.kind as CareForm['kind'], occurred_on: record.occurred_on, next_due_on: record.next_due_on ?? '', description: record.description ?? '',
    cost: record.cost != null ? Number(record.cost) : undefined, currency: record.currency, performed_by: record.performed_by ?? '',
  } : { kind: 'feeding', occurred_on: today, currency: household.currency } });
  const save = useAction(async (v: CareForm) => {
    const row = { ...v, next_due_on: v.next_due_on || null, description: v.description || null, cost: v.cost ?? null, performed_by: v.performed_by || null };
    if (record) return unwrap(await supabase.from('pet_care_records').update(row).eq('id', record.id).select('id').single());
    return unwrap(await supabase.from('pet_care_records').insert({ ...row, household_id: householdId, pet_id: pet.id }).select('id').single());
  }, { groups: ['pets', 'budget'], success: 'common.saved', onSuccess: onClose });
  const remove = useAction(async () => unwrap(await supabase.from('pet_care_records').delete().eq('id', record!.id).select('id').single()), { groups: ['pets', 'budget'], success: 'common.deleted', onSuccess: onClose });
  const e = form.formState.errors;
  return (
    <Modal open onClose={onClose} size="lg" title={record ? t('pets.editRecord') : t('pets.addRecord')}
      footer={<>
        {record && <Button variant="ghost" icon="trash" className="mr-auto text-red-700" onClick={() => setConfirm(true)}>{t('common.delete')}</Button>}
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="care-form" loading={save.isPending}>{t('common.save')}</Button>
      </>}>
      <form id="care-form" className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label={t('pets.kind')} htmlFor="c-kind"><Select id="c-kind" {...form.register('kind')}>{PET_CARE_KINDS.map((k) => <option key={k} value={k}>{t(`pets.care.${k}`)}</option>)}</Select></Field>
        <Field label={t('budget.date')} htmlFor="c-date" error={e.occurred_on?.message}><Input id="c-date" type="date" {...form.register('occurred_on')} /></Field>
        <Field label={t('pets.nextDue')} htmlFor="c-next" error={e.next_due_on?.message} hint={t('pets.nextDueHint')}><Input id="c-next" type="date" {...form.register('next_due_on')} /></Field>
        <Field label={t('pets.performedBy')} htmlFor="c-by"><Select id="c-by" {...form.register('performed_by')}><option value="">—</option>{activeMembers.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</Select></Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label={t('vehicles.cost')} htmlFor="c-cost" error={e.cost?.message}><Input id="c-cost" inputMode="decimal" {...form.register('cost')} /></Field>
          <Field label={t('household.currency')} htmlFor="c-cur"><Select id="c-cur" {...form.register('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        </div>
        <Field label={t('vehicles.description')} htmlFor="c-desc" className="sm:col-span-2"><Textarea id="c-desc" rows={2} {...form.register('description')} /></Field>
      </form>
      {record && <div className="mt-4"><Attachments entityType="pet_care_record" entityId={record.id} /></div>}
      <ConfirmDialog open={confirm} title={t('common.delete')} message={t('pets.deleteRecord')} loading={remove.isPending} onCancel={() => setConfirm(false)} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}
