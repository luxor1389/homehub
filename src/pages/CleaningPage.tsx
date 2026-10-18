import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { unwrap, useAction } from '@/lib/hooks';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Button, Card, ConfirmDialog, Field, Input, LoadingState, Modal, PageHeader, Select, Tabs, Textarea } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { useOccurrences, useTemplates } from '@/features/tasks/api';
import { TaskList } from '@/features/tasks/TaskCard';
import { useTaskEditor } from '@/features/tasks/TaskEditor';
import { CLEANING_PRESETS } from '@/features/tasks/presets';
import { recurrenceLabel, roomLabel, subcategoryLabel } from '@/features/tasks/labels';
import { addDays } from '@/lib/dates';
import { ROOM_KINDS, type Room, type TaskTemplate } from '@/lib/types';

type View = 'rooms' | 'templates' | 'manage';

export default function CleaningPage() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('rooms');
  const { openNew } = useTaskEditor();
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.cleaning')} actions={<Button icon="plus" onClick={() => openNew({ category: 'cleaning' })}>{t('tasks.new')}</Button>} />
      <Tabs value={view} onChange={setView} items={[
        { value: 'rooms', label: t('cleaning.byRoom') },
        { value: 'templates', label: t('cleaning.templates') },
        { value: 'manage', label: t('cleaning.manageRooms') },
      ]} />
      {view === 'rooms' && <ByRoom />}
      {view === 'templates' && <Templates />}
      {view === 'manage' && <ManageRooms />}
    </div>
  );
}

function ByRoom() {
  const { t } = useTranslation();
  const { rooms, today } = useCurrentHousehold();
  const { openNew } = useTaskEditor();
  const q = useOccurrences('cleaning', { category: 'cleaning', from: addDays(today, -90), to: addDays(today, 14), statuses: ['planned', 'in_progress'] });
  if (q.isLoading) return <LoadingState />;
  const items = q.data ?? [];
  const groups: { room: Room | null; label: string }[] = [...rooms.map((r) => ({ room: r, label: roomLabel(r, t) })), { room: null, label: t('cleaning.noRoom') }];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map(({ room, label }) => {
        const list = items.filter((o) => (room ? o.room_id === room.id : !o.room_id || !rooms.some((r) => r.id === o.room_id)));
        if (!room && !list.length) return null;
        return (
          <Card key={room?.id ?? 'none'} title={`${label} (${list.length})`}
            action={<Button size="sm" variant="ghost" icon="plus" aria-label={t('cleaning.addToRoom', { room: label })} onClick={() => openNew({ category: 'cleaning', room_id: room?.id ?? null })}>{t('common.add')}</Button>}>
            <TaskList items={list} empty={t('cleaning.roomClean')} compact />
          </Card>
        );
      })}
    </div>
  );
}

const templateSchema = z.object({
  title: z.string().trim().min(1, 'validation.required').max(200, 'validation.tooLong'),
  subcategory: z.string().optional(),
  room_id: z.string().optional(),
  recurrence_freq: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly']),
  recurrence_interval: z.preprocess((v) => Number(v || 1), z.number().int().min(1, 'validation.min').max(365, 'validation.max')),
  estimated_minutes: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(1, 'validation.min').max(1440, 'validation.max').optional()),
  checklist: z.string().max(4000, 'validation.tooLong').optional(),
});
type TemplateForm = z.infer<typeof templateSchema>;

function Templates() {
  const { t, i18n } = useTranslation();
  const { rooms, householdId, today } = useCurrentHousehold();
  const { openNew } = useTaskEditor();
  const templates = useTemplates();
  const [editing, setEditing] = useState(false);
  const [toDelete, setToDelete] = useState<TaskTemplate | null>(null);
  const use = useAction(async (tpl: TaskTemplate) => unwrap(await supabase.rpc('create_task_from_template', { p_template: tpl.id, p_start: today, p_assignees: [] })),
    { groups: ['tasks'], success: 'cleaning.templateUsed' });
  const remove = useAction(async (id: string) => unwrap(await supabase.from('task_templates').delete().eq('id', id)), { groups: ['tasks'], success: 'common.deleted', onSuccess: () => setToDelete(null) });
  const form = useForm<TemplateForm>({ resolver: zodResolver(templateSchema), defaultValues: { recurrence_freq: 'weekly', recurrence_interval: 1 } });
  const save = useAction(async (v: TemplateForm) => unwrap(await supabase.from('task_templates').insert({
    household_id: householdId, title: v.title, category: 'cleaning', subcategory: v.subcategory || null, room_id: v.room_id || null,
    recurrence_freq: v.recurrence_freq, recurrence_interval: v.recurrence_interval, estimated_minutes: v.estimated_minutes ?? null,
    checklist: (v.checklist ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
  })), { groups: ['tasks'], success: 'cleaning.templateSaved', onSuccess: () => { setEditing(false); form.reset(); } });
  const e = form.formState.errors;

  return (
    <div className="space-y-4">
      <Card title={t('cleaning.presetsTitle')}>
        <p className="mb-3 text-sm text-slate-600">{t('cleaning.presetsHint')}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {CLEANING_PRESETS.map((p) => (
            <button key={p.key} type="button" className="flex min-h-16 flex-col items-start justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:border-brand-600 hover:bg-brand-50"
              onClick={() => openNew({
                category: 'cleaning', subcategory: p.key, title: t(`cleaning.presets.${p.key}`), recurrence_freq: p.freq,
                recurrence_interval: p.interval ?? 1, estimated_minutes: p.minutes, room_id: rooms.find((r) => r.kind === p.room)?.id ?? null,
              })}>
              <span className="text-sm font-medium">{t(`cleaning.presets.${p.key}`)}</span>
              <span className="text-xs text-slate-500">{recurrenceLabel({ recurrence_freq: p.freq, recurrence_interval: p.interval ?? 1 }, t, i18n.language)}</span>
            </button>
          ))}
        </div>
      </Card>
      <Card title={t('cleaning.savedTemplates')} action={<Button size="sm" icon="plus" onClick={() => setEditing(true)}>{t('cleaning.newTemplate')}</Button>}>
        {templates.isLoading ? <LoadingState /> : templates.data?.length ? (
          <ul className="divide-y divide-slate-100">
            {templates.data.map((tpl) => (
              <li key={tpl.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">{tpl.title}</p>
                  <p className="text-xs text-slate-500">{[subcategoryLabel(tpl.subcategory, t), roomLabel(rooms.find((r) => r.id === tpl.room_id), t), recurrenceLabel(tpl, t, i18n.language), tpl.checklist.length ? t('cleaning.steps', { count: tpl.checklist.length }) : ''].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" icon="repeat" loading={use.isPending} onClick={() => use.mutate(tpl)}>{t('cleaning.useTemplate')}</Button>
                  <Button size="sm" variant="ghost" icon="trash" aria-label={t('common.delete')} onClick={() => setToDelete(tpl)} />
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">{t('cleaning.noTemplates')}</p>}
      </Card>
      <Modal open={editing} onClose={() => setEditing(false)} title={t('cleaning.newTemplate')}
        footer={<><Button variant="secondary" onClick={() => setEditing(false)}>{t('common.cancel')}</Button><Button type="submit" form="tpl-form" loading={save.isPending}>{t('common.save')}</Button></>}>
        <form id="tpl-form" className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
          <Field label={t('tasks.fields.title')} htmlFor="tpl-title" error={e.title?.message}><Input id="tpl-title" {...form.register('title')} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('tasks.fields.subcategory')} htmlFor="tpl-sub">
              <Select id="tpl-sub" {...form.register('subcategory')}>
                <option value="">{t('common.none')}</option>
                {CLEANING_PRESETS.map((p) => <option key={p.key} value={p.key}>{t(`cleaning.presets.${p.key}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('tasks.fields.room')} htmlFor="tpl-room">
              <Select id="tpl-room" {...form.register('room_id')}>
                <option value="">{t('common.none')}</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{roomLabel(r, t)}</option>)}
              </Select>
            </Field>
            <Field label={t('tasks.fields.recurrence')} htmlFor="tpl-freq">
              <Select id="tpl-freq" {...form.register('recurrence_freq')}>
                {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((f) => <option key={f} value={f}>{t(`recurrence.freq.${f}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('recurrence.interval')} htmlFor="tpl-int" error={e.recurrence_interval?.message}><Input id="tpl-int" type="number" min={1} {...form.register('recurrence_interval')} /></Field>
            <Field label={t('tasks.fields.estimate')} htmlFor="tpl-min" error={e.estimated_minutes?.message}><Input id="tpl-min" type="number" min={1} {...form.register('estimated_minutes')} /></Field>
          </div>
          <Field label={t('cleaning.checklistLines')} htmlFor="tpl-check" hint={t('cleaning.checklistLinesHint')}><Textarea id="tpl-check" rows={4} {...form.register('checklist')} /></Field>
        </form>
      </Modal>
      <ConfirmDialog open={Boolean(toDelete)} title={t('common.delete')} message={t('cleaning.deleteTemplate', { name: toDelete?.title })}
        loading={remove.isPending} onCancel={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.id)} />
    </div>
  );
}

function ManageRooms() {
  const { t } = useTranslation();
  const { rooms, householdId } = useCurrentHousehold();
  const [kind, setKind] = useState<string>('other');
  const [name, setName] = useState('');
  const [toArchive, setToArchive] = useState<Room | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const add = useAction(async () => unwrap(await supabase.from('rooms').insert({ household_id: householdId, kind, name: name.trim() || null, sort_order: rooms.length })),
    { groups: ['members', 'tasks'], success: 'cleaning.roomAdded', onSuccess: () => setName('') });
  const rename = useAction(async (r: { id: string; name: string }) => unwrap(await supabase.from('rooms').update({ name: r.name.trim() || null }).eq('id', r.id).select('id').single()),
    { groups: ['members'], success: 'common.saved', onSuccess: () => setRenaming(null) });
  const archive = useAction(async (id: string) => unwrap(await supabase.from('rooms').update({ archived_at: new Date().toISOString() }).eq('id', id).select('id').single()),
    { groups: ['members', 'tasks'], success: 'common.archivedOk', onSuccess: () => setToArchive(null) });
  return (
    <Card title={t('cleaning.manageRooms')}>
      <ul className="mb-4 divide-y divide-slate-100">
        {rooms.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2">
            {renaming?.id === r.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); rename.mutate(renaming); }}>
                <Input aria-label={t('cleaning.roomName')} value={renaming.name} maxLength={80} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} placeholder={t(`rooms.${r.kind}`)} />
                <Button type="submit" size="sm" loading={rename.isPending}>{t('common.save')}</Button>
              </form>
            ) : (
              <span>{roomLabel(r, t)} <span className="text-xs text-slate-500">({t(`rooms.${r.kind}`)})</span></span>
            )}
            <div className="flex gap-1">
              <button type="button" aria-label={t('common.edit')} className="h-10 w-10 rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => setRenaming({ id: r.id, name: r.name ?? '' })}><Icon name="edit" className="mx-auto h-4 w-4" /></button>
              <button type="button" aria-label={t('common.archive')} className="h-10 w-10 rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => setToArchive(r)}><Icon name="archive" className="mx-auto h-4 w-4" /></button>
            </div>
          </li>
        ))}
      </ul>
      <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined); }}>
        <Select aria-label={t('cleaning.roomKind')} value={kind} onChange={(e) => setKind(e.target.value)}>
          {ROOM_KINDS.map((k) => <option key={k} value={k}>{t(`rooms.${k}`)}</option>)}
        </Select>
        <Input aria-label={t('cleaning.roomName')} placeholder={t('cleaning.roomNamePlaceholder')} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" icon="plus" loading={add.isPending}>{t('cleaning.addRoom')}</Button>
      </form>
      <ConfirmDialog open={Boolean(toArchive)} title={t('common.archive')} message={t('cleaning.archiveRoom', { room: roomLabel(toArchive, t) })}
        loading={archive.isPending} onCancel={() => setToArchive(null)} onConfirm={() => toArchive && archive.mutate(toArchive.id)} />
    </Card>
  );
}
