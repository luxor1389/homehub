import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { unwrap, useAction, useHHQuery } from '@/lib/hooks';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Button, Field, Input, LoadingState, Modal, Select, Textarea, cx } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { TASK_CATEGORIES, type Freq, type Occurrence, type Pet, type Plant, type Priority, type Task, type TaskCategory, type Vehicle } from '@/lib/types';
import { weekdayName } from '@/lib/dates';
import { roomLabel } from './labels';
import { CLEANING_PRESETS } from './presets';
import { useTask } from './api';

export interface TaskPrefill {
  title?: string;
  description?: string;
  category?: TaskCategory;
  subcategory?: string;
  room_id?: string | null;
  vehicle_id?: string | null;
  pet_id?: string | null;
  plant_id?: string | null;
  recurrence_freq?: Freq;
  recurrence_interval?: number;
  estimated_minutes?: number;
  due_date?: string;
  assignees?: string[];
  checklist?: string[];
}

interface EditorApi {
  openNew: (prefill?: TaskPrefill) => void;
  openEdit: (occurrence: Occurrence) => void;
}
const EditorContext = createContext<EditorApi | null>(null);

export function useTaskEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useTaskEditor outside provider');
  return ctx;
}

type EditorState = { mode: 'new'; prefill?: TaskPrefill } | { mode: 'edit'; occurrence: Occurrence } | null;

export function TaskEditorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EditorState>(null);
  const api = useMemo<EditorApi>(() => ({
    openNew: (prefill) => setState({ mode: 'new', prefill }),
    openEdit: (occurrence) => setState({ mode: 'edit', occurrence }),
  }), []);
  const close = useCallback(() => setState(null), []);
  return (
    <EditorContext.Provider value={api}>
      {children}
      {state && <TaskEditorModal state={state} onClose={close} />}
    </EditorContext.Provider>
  );
}

const optionalInt = (min: number, max: number) => z.preprocess(
  (v) => (v === '' || v == null || Number.isNaN(v) ? undefined : Number(v)),
  z.number({ invalid_type_error: 'validation.number' }).int('validation.integer').min(min, 'validation.min').max(max, 'validation.max').optional(),
);

const schema = z.object({
  title: z.string().trim().min(1, 'validation.required').max(200, 'validation.tooLong'),
  description: z.string().max(5000, 'validation.tooLong').optional(),
  category: z.enum(TASK_CATEGORIES),
  subcategory: z.string().max(60, 'validation.tooLong').optional(),
  room_id: z.string().optional(),
  vehicle_id: z.string().optional(),
  pet_id: z.string().optional(),
  plant_id: z.string().optional(),
  assignees: z.array(z.string()),
  due_date: z.string().min(1, 'validation.required'),
  due_time: z.string().optional(),
  recurrence_freq: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly']),
  recurrence_interval: z.preprocess((v) => Number(v || 1), z.number().int('validation.integer').min(1, 'validation.min').max(365, 'validation.max')),
  recurrence_weekdays: z.array(z.number()),
  recurrence_until: z.string().optional(),
  estimated_minutes: optionalInt(1, 1440),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  checklist: z.array(z.object({ label: z.string().max(200, 'validation.tooLong') })),
  scope: z.enum(['this', 'future']),
}).refine((v) => !v.recurrence_until || v.recurrence_freq === 'none' || v.recurrence_until >= v.due_date,
  { path: ['recurrence_until'], message: 'validation.untilAfterStart' });

type FormValues = z.infer<typeof schema>;

function useResources() {
  return useHHQuery('vehicles', ['task-resources'], async (hh) => {
    const [v, p, pl] = await Promise.all([
      supabase.from('vehicles').select('id, make, model, plate').eq('household_id', hh).is('archived_at', null).order('make'),
      supabase.from('pets').select('id, name').eq('household_id', hh).is('archived_at', null).order('name'),
      supabase.from('plants').select('id, name').eq('household_id', hh).is('archived_at', null).order('name'),
    ]);
    return {
      vehicles: unwrap(v) as Pick<Vehicle, 'id' | 'make' | 'model' | 'plate'>[],
      pets: unwrap(p) as Pick<Pet, 'id' | 'name'>[],
      plants: unwrap(pl) as Pick<Plant, 'id' | 'name'>[],
    };
  });
}

function TaskEditorModal({ state, onClose }: { state: NonNullable<EditorState>; onClose: () => void }) {
  const { t } = useTranslation();
  const editing = state.mode === 'edit' ? state.occurrence : null;
  const taskQuery = useTask(editing?.task_id);
  const title = editing ? t('tasks.edit') : t('tasks.new');
  if (editing && taskQuery.isLoading) {
    return <Modal open onClose={onClose} title={title}><LoadingState /></Modal>;
  }
  return <TaskForm state={state} task={taskQuery.data ?? null} onClose={onClose} title={title} />;
}

function TaskForm({ state, task, onClose, title }: { state: NonNullable<EditorState>; task: Task | null; onClose: () => void; title: string }) {
  const { t, i18n } = useTranslation();
  const { householdId, activeMembers, rooms, today } = useCurrentHousehold();
  const resources = useResources().data;
  const editing = state.mode === 'edit' ? state.occurrence : null;
  const prefill = state.mode === 'new' ? state.prefill ?? {} : {};
  const isRecurring = Boolean(editing && editing.recurrence_freq !== 'none');

  const defaults: FormValues = editing ? {
    title: editing.title, description: editing.description ?? '', category: editing.category,
    subcategory: editing.subcategory ?? '', room_id: editing.room_id ?? '', vehicle_id: editing.vehicle_id ?? '',
    pet_id: editing.pet_id ?? '', plant_id: editing.plant_id ?? '', assignees: editing.assignee_ids,
    due_date: editing.due_date, due_time: editing.due_time?.slice(0, 5) ?? '',
    recurrence_freq: task?.recurrence_freq ?? editing.recurrence_freq, recurrence_interval: task?.recurrence_interval ?? 1,
    recurrence_weekdays: task?.recurrence_weekdays ?? [], recurrence_until: task?.recurrence_until ?? '',
    estimated_minutes: editing.estimated_minutes ?? undefined, priority: editing.priority, checklist: [],
    scope: isRecurring ? 'this' : 'future',
  } : {
    title: prefill.title ?? '', description: prefill.description ?? '', category: prefill.category ?? 'other',
    subcategory: prefill.subcategory ?? '', room_id: prefill.room_id ?? '', vehicle_id: prefill.vehicle_id ?? '',
    pet_id: prefill.pet_id ?? '', plant_id: prefill.plant_id ?? '', assignees: prefill.assignees ?? [],
    due_date: prefill.due_date ?? today, due_time: '', recurrence_freq: prefill.recurrence_freq ?? 'none',
    recurrence_interval: prefill.recurrence_interval ?? 1, recurrence_weekdays: [], recurrence_until: '',
    estimated_minutes: prefill.estimated_minutes, priority: 'normal',
    checklist: (prefill.checklist ?? []).map((label) => ({ label })), scope: 'future',
  };

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });
  const { register, watch, setValue, formState: { errors, isSubmitting } } = form;
  const checklist = useFieldArray({ control: form.control, name: 'checklist' });
  const [showMore, setShowMore] = useState(Boolean(editing) || Boolean(prefill.category && prefill.category !== 'other'));
  const values = watch();
  const thisOnly = isRecurring && values.scope === 'this';

  useEffect(() => {
    if (values.recurrence_freq !== 'weekly' && values.recurrence_weekdays.length) setValue('recurrence_weekdays', []);
  }, [values.recurrence_freq, values.recurrence_weekdays.length, setValue]);

  const save = useAction(async (v: FormValues) => {
    const base = {
      title: v.title.trim(), description: v.description?.trim() || null, priority: v.priority as Priority,
      estimated_minutes: v.estimated_minutes ?? null,
    };
    const definition = {
      ...base, category: v.category, subcategory: v.subcategory?.trim() || null,
      room_id: v.room_id || null, vehicle_id: v.vehicle_id || null, pet_id: v.pet_id || null, plant_id: v.plant_id || null,
      due_time: v.due_time || null, recurrence_freq: v.recurrence_freq, recurrence_interval: v.recurrence_interval,
      recurrence_weekdays: v.recurrence_freq === 'weekly' && v.recurrence_weekdays.length ? v.recurrence_weekdays : null,
      recurrence_until: v.recurrence_freq !== 'none' && v.recurrence_until ? v.recurrence_until : null,
    };
    if (!editing) {
      return unwrap(await supabase.rpc('create_task', {
        p_household: householdId, p_data: { ...definition, start_date: v.due_date }, p_assignees: v.assignees,
        p_checklist: v.checklist.map((c) => c.label.trim()).filter(Boolean),
      }));
    }
    if (thisOnly) {
      return unwrap(await supabase.rpc('update_task', {
        p_occurrence: editing.id, p_scope: 'this',
        p_data: { ...base, due_date: v.due_date, due_time: v.due_time || null }, p_assignees: v.assignees,
      }));
    }
    const data: Record<string, unknown> = { ...definition };
    // for a series, a new date re-anchors the rule; only send it when it was changed
    if (!isRecurring || v.due_date !== editing.due_date) data.due_date = v.due_date;
    return unwrap(await supabase.rpc('update_task', { p_occurrence: editing.id, p_scope: 'future', p_data: data, p_assignees: v.assignees }));
  }, { groups: ['tasks', 'notifications'], success: editing ? 'tasks.saved' : 'tasks.created', onSuccess: onClose });

  const onSubmit = form.handleSubmit((v) => save.mutate(v));

  const applyPreset = (key: string) => {
    const p = CLEANING_PRESETS.find((x) => x.key === key);
    setValue('subcategory', key);
    if (!p) return;
    if (!values.title) setValue('title', t(`cleaning.presets.${key}`));
    const room = rooms.find((r) => r.kind === p.room);
    if (room && !values.room_id) setValue('room_id', room.id);
    if (!values.estimated_minutes) setValue('estimated_minutes', p.minutes);
  };

  const toggleAssignee = (id: string) => {
    const cur = values.assignees;
    setValue('assignees', cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], { shouldDirty: true });
  };
  const toggleWeekday = (d: number) => {
    const cur = values.recurrence_weekdays;
    setValue('recurrence_weekdays', cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort());
  };

  return (
    <Modal open onClose={onClose} title={title} size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="task-form" loading={save.isPending || isSubmitting}>{t('common.save')}</Button>
      </>}>
      <form id="task-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        {isRecurring && (
          <fieldset className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <legend className="px-1 text-sm font-medium text-amber-900">{t('tasks.scope.title')}</legend>
            <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" value="this" {...register('scope')} className="h-5 w-5" /> {t('tasks.scope.this')}</label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" value="future" {...register('scope')} className="h-5 w-5" /> {t('tasks.scope.future')}</label>
            </div>
          </fieldset>
        )}
        <Field label={t('tasks.fields.title')} htmlFor="task-title" error={errors.title?.message}>
          <Input id="task-title" {...register('title')} aria-invalid={!!errors.title} placeholder={t('tasks.fields.titlePlaceholder')} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('tasks.fields.dueDate')} htmlFor="task-date" error={errors.due_date?.message}>
            <Input id="task-date" type="date" {...register('due_date')} />
          </Field>
          <Field label={t('tasks.fields.dueTime')} htmlFor="task-time" hint={t('tasks.fields.dueTimeHint')}>
            <Input id="task-time" type="time" {...register('due_time')} />
          </Field>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">{t('tasks.fields.assignees')}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('tasks.fields.assignees')}>
            {activeMembers.map((m) => {
              const on = values.assignees.includes(m.user_id);
              return (
                <button key={m.user_id} type="button" aria-pressed={on} onClick={() => toggleAssignee(m.user_id)}
                  className={cx('min-h-11 rounded-full border px-4 text-sm font-medium', on ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700')}>
                  {on && <Icon name="check" className="mr-1 inline h-4 w-4" />}{m.display_name}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-slate-500">{values.assignees.length ? t('tasks.assignHint') : t('tasks.unassignedHint')}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('tasks.fields.priority')} htmlFor="task-priority">
            <Select id="task-priority" {...register('priority')}>
              {(['low', 'normal', 'high', 'urgent'] as const).map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('tasks.fields.estimate')} htmlFor="task-min" error={errors.estimated_minutes?.message}>
            <Input id="task-min" type="number" inputMode="numeric" min={1} max={1440} {...register('estimated_minutes')} />
          </Field>
        </div>

        {!thisOnly && (
          <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-sm font-medium text-slate-700"><Icon name="repeat" className="mr-1 inline h-4 w-4" />{t('tasks.fields.recurrence')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select aria-label={t('tasks.fields.recurrence')} {...register('recurrence_freq')}>
                {(['none', 'daily', 'weekly', 'monthly', 'yearly'] as const).map((f) => <option key={f} value={f}>{t(`recurrence.freq.${f}`)}</option>)}
              </Select>
              {values.recurrence_freq !== 'none' && (
                <label className="flex items-center gap-2 text-sm">
                  <span>{t('recurrence.everyN')}</span>
                  <Input type="number" min={1} max={365} className="w-20" aria-label={t('recurrence.interval')} {...register('recurrence_interval')} />
                  <span>{t(`recurrence.unit.${values.recurrence_freq}`)}</span>
                </label>
              )}
            </div>
            {values.recurrence_freq === 'weekly' && (
              <div className="flex flex-wrap gap-1" role="group" aria-label={t('recurrence.weekdays')}>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                  const on = values.recurrence_weekdays.includes(d);
                  return (
                    <button key={d} type="button" aria-pressed={on} onClick={() => toggleWeekday(d)}
                      className={cx('h-11 min-w-11 rounded-lg border px-2 text-sm', on ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white')}>
                      {weekdayName(d, i18n.language)}
                    </button>
                  );
                })}
              </div>
            )}
            {values.recurrence_freq !== 'none' && (
              <Field label={t('recurrence.until')} htmlFor="task-until" error={errors.recurrence_until?.message} hint={t('recurrence.untilHint')}>
                <Input id="task-until" type="date" {...register('recurrence_until')} />
              </Field>
            )}
          </fieldset>
        )}

        {!showMore ? (
          <Button variant="ghost" size="sm" icon="plus" onClick={() => setShowMore(true)}>{t('tasks.moreDetails')}</Button>
        ) : (
          <>
            <Field label={t('tasks.fields.description')} htmlFor="task-desc" error={errors.description?.message}>
              <Textarea id="task-desc" rows={3} {...register('description')} />
            </Field>
            {!thisOnly && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('tasks.fields.category')} htmlFor="task-cat">
                  <Select id="task-cat" {...register('category')}>
                    {TASK_CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
                  </Select>
                </Field>
                <Field label={t('tasks.fields.subcategory')} htmlFor="task-sub">
                  {values.category === 'cleaning' ? (
                    <Select id="task-sub" value={values.subcategory ?? ''} onChange={(e) => applyPreset(e.target.value)}>
                      <option value="">{t('common.none')}</option>
                      {CLEANING_PRESETS.map((p) => <option key={p.key} value={p.key}>{t(`cleaning.presets.${p.key}`)}</option>)}
                    </Select>
                  ) : <Input id="task-sub" {...register('subcategory')} />}
                </Field>
                <Field label={t('tasks.fields.room')} htmlFor="task-room">
                  <Select id="task-room" {...register('room_id')}>
                    <option value="">{t('common.none')}</option>
                    {rooms.map((r) => <option key={r.id} value={r.id}>{roomLabel(r, t)}</option>)}
                  </Select>
                </Field>
                {values.category === 'vehicles' && (
                  <Field label={t('tasks.fields.vehicle')} htmlFor="task-veh">
                    <Select id="task-veh" {...register('vehicle_id')}>
                      <option value="">{t('common.none')}</option>
                      {resources?.vehicles.map((v) => <option key={v.id} value={v.id}>{[v.make, v.model, v.plate].filter(Boolean).join(' ')}</option>)}
                    </Select>
                  </Field>
                )}
                {values.category === 'pets' && (
                  <Field label={t('tasks.fields.pet')} htmlFor="task-pet">
                    <Select id="task-pet" {...register('pet_id')}>
                      <option value="">{t('common.none')}</option>
                      {resources?.pets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </Field>
                )}
                {values.category === 'plants' && (
                  <Field label={t('tasks.fields.plant')} htmlFor="task-plant">
                    <Select id="task-plant" {...register('plant_id')}>
                      <option value="">{t('common.none')}</option>
                      {resources?.plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </Field>
                )}
              </div>
            )}
            {!editing && (
              <div>
                <p className="mb-1 text-sm font-medium text-slate-700">{t('tasks.fields.checklist')}</p>
                <div className="space-y-2">
                  {checklist.fields.map((f, i) => (
                    <div key={f.id} className="flex gap-2">
                      <Input aria-label={t('tasks.fields.checklistStep', { n: i + 1 })} {...register(`checklist.${i}.label` as const)} />
                      <Button variant="ghost" icon="trash" aria-label={t('common.remove')} onClick={() => checklist.remove(i)} />
                    </div>
                  ))}
                  <Button variant="secondary" size="sm" icon="plus" onClick={() => checklist.append({ label: '' })}>{t('tasks.addStep')}</Button>
                </div>
              </div>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}
