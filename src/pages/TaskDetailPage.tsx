import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { unwrap, useAction, useHHQuery } from '@/lib/hooks';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingState, Select, Textarea, cx } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { useChecklist, useComments, useOccurrence, useOccurrences, useSetStatus, useTask } from '@/features/tasks/api';
import { useTaskEditor } from '@/features/tasks/TaskEditor';
import { priorityTone, recurrenceLabel, roomLabel, statusLabel, statusTone, subcategoryLabel } from '@/features/tasks/labels';
import { ActivityList } from '@/features/activity/ActivityList';
import { Attachments } from '@/features/files/Attachments';
import { formatDate, formatDateTime, formatTime } from '@/lib/dates';
import type { TaskComment } from '@/lib/types';

export default function TaskDetailPage() {
  const { occurrenceId } = useParams();
  const occ = useOccurrence(occurrenceId);
  if (occ.isLoading) return <LoadingState />;
  if (occ.error) return <ErrorState error={occ.error} onRetry={() => void occ.refetch()} />;
  if (!occ.data) return <ArchivedOrMissing occurrenceId={occurrenceId!} />;
  return <TaskDetail key={occ.data.id} />;
}

function ArchivedOrMissing({ occurrenceId }: { occurrenceId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const info = useHHQuery('tasks', ['archived-lookup', occurrenceId], async () => {
    const o = unwrap(await supabase.from('task_occurrences').select('task_id').eq('id', occurrenceId).maybeSingle()) as { task_id: string } | null;
    if (!o) return null;
    return unwrap(await supabase.from('tasks').select('id, title, archived_at').eq('id', o.task_id).maybeSingle()) as { id: string; title: string; archived_at: string | null } | null;
  });
  const restore = useAction(async (id: string) => unwrap(await supabase.rpc('archive_task', { p_task: id, p_archive: false })), { groups: ['tasks'], success: 'tasks.restored' });
  const remove = useAction(async (id: string) => unwrap(await supabase.from('tasks').delete().eq('id', id).select('id').single()), {
    groups: ['tasks'], success: 'tasks.deleted', onSuccess: () => navigate('/tasks'),
  });
  if (info.isLoading) return <LoadingState />;
  if (!info.data) return <EmptyState title={t('errors.not_found')}><Link to="/tasks" className="text-brand-700 underline">{t('nav.tasks')}</Link></EmptyState>;
  return (
    <Card title={info.data.title}>
      <p className="mb-4 text-slate-600">{t('tasks.archivedInfo')}</p>
      <div className="flex flex-wrap gap-2">
        <Button icon="restore" loading={restore.isPending} onClick={() => restore.mutate(info.data!.id)}>{t('common.restore')}</Button>
        <Button variant="danger" icon="trash" onClick={() => setConfirm(true)}>{t('common.deletePermanently')}</Button>
      </div>
      <ConfirmDialog open={confirm} title={t('common.deletePermanently')} message={t('tasks.deleteConfirm')} loading={remove.isPending}
        onCancel={() => setConfirm(false)} onConfirm={() => remove.mutate(info.data!.id)} />
    </Card>
  );
}

function TaskDetail() {
  const { occurrenceId } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { memberName, rooms, household, today } = useCurrentHousehold();
  const o = useOccurrence(occurrenceId).data!;
  const task = useTask(o.task_id).data;
  const { openEdit } = useTaskEditor();
  const setStatus = useSetStatus();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archive = useAction(async () => unwrap(await supabase.rpc('archive_task', { p_task: o.task_id, p_archive: true })), {
    groups: ['tasks'], success: 'tasks.archived', onSuccess: () => navigate('/tasks'),
  });
  const series = useOccurrences(`series-${o.task_id}`, { taskId: o.task_id }, o.recurrence_freq !== 'none');
  const room = rooms.find((r) => r.id === o.room_id);
  const upcoming = (series.data ?? []).filter((x) => x.due_date >= today && x.id !== o.id && ['planned', 'in_progress'].includes(x.status)).slice(0, 6);
  const past = (series.data ?? []).filter((x) => x.id !== o.id && (x.status === 'done' || x.status === 'cancelled' || x.due_date < today)).slice(-6).reverse();

  return (
    <div className="space-y-4">
      <Link to="/tasks" className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><Icon name="chevronLeft" className="h-4 w-4" />{t('nav.tasks')}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{o.title}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={statusTone(o)}>{statusLabel(o, t)}</Badge>
            <Badge tone={priorityTone[o.priority]}>{t(`priority.${o.priority}`)}</Badge>
            {o.recurrence_freq !== 'none' && <Badge tone="purple"><Icon name="repeat" className="mr-1 h-3 w-3" />{task ? recurrenceLabel(task, t, i18n.language) : t('tasks.recurring')}</Badge>}
            {o.has_overrides && <Badge tone="amber">{t('tasks.changedThisOnly')}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {o.status === 'planned' && <Button variant="secondary" icon="play" loading={setStatus.isPending} onClick={() => setStatus.mutate({ id: o.id, status: 'in_progress' })}>{t('tasks.actions.start')}</Button>}
          {(o.status === 'planned' || o.status === 'in_progress') && <Button icon="check" loading={setStatus.isPending} onClick={() => setStatus.mutate({ id: o.id, status: 'done' })}>{t('tasks.actions.complete')}</Button>}
          {(o.status === 'done' || o.status === 'cancelled') && <Button variant="secondary" icon="restore" loading={setStatus.isPending} onClick={() => setStatus.mutate({ id: o.id, status: 'planned' })}>{t('tasks.actions.reopen')}</Button>}
          {(o.status === 'planned' || o.status === 'in_progress') && <Button variant="ghost" loading={setStatus.isPending} onClick={() => setStatus.mutate({ id: o.id, status: 'cancelled' })}>{t('tasks.actions.cancel')}</Button>}
          <Button variant="secondary" icon="edit" onClick={() => openEdit(o)}>{t('common.edit')}</Button>
          <Button variant="ghost" icon="archive" onClick={() => setConfirmArchive(true)}>{t('common.archive')}</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('tasks.details')}>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              <Info label={t('tasks.fields.dueDate')} value={`${formatDate(o.due_date, i18n.language, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}${o.due_time ? ' ' + formatTime(o.due_time) : ''}`} />
              <Info label={t('tasks.fields.category')} value={`${t(`categories.${o.category}`)}${o.subcategory ? ' · ' + subcategoryLabel(o.subcategory, t) : ''}`} />
              {room && <Info label={t('tasks.fields.room')} value={roomLabel(room, t)} />}
              {o.estimated_minutes && <Info label={t('tasks.fields.estimate')} value={t('common.minutes', { count: o.estimated_minutes })} />}
              {o.vehicle_id && <Info label={t('tasks.fields.vehicle')} value={<Link className="text-brand-700 underline" to={`/vehicles/${o.vehicle_id}`}>{t('common.open')}</Link>} />}
              {o.pet_id && <Info label={t('tasks.fields.pet')} value={<Link className="text-brand-700 underline" to={`/pets/${o.pet_id}`}>{t('common.open')}</Link>} />}
              {o.plant_id && <Info label={t('tasks.fields.plant')} value={<Link className="text-brand-700 underline" to={`/plants/${o.plant_id}`}>{t('common.open')}</Link>} />}
              <Info label={t('tasks.createdBy')} value={`${memberName(o.created_by)} · ${formatDateTime(task?.created_at, i18n.language, household.timezone)}`} />
              <Info label={t('tasks.updatedAt')} value={formatDateTime(task?.updated_at ?? o.updated_at, i18n.language, household.timezone)} />
              {o.status === 'done' && <Info label={t('tasks.completed')} value={t('tasks.completedBy', { name: memberName(o.completed_by), date: formatDateTime(o.completed_at, i18n.language, household.timezone) })} />}
              {o.status === 'cancelled' && <Info label={t('status.cancelled')} value={`${memberName(o.cancelled_by)} · ${formatDateTime(o.cancelled_at, i18n.language, household.timezone)}`} />}
            </dl>
            {o.description && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{o.description}</p>}
          </Card>
          <Checklist taskId={o.task_id} occurrenceId={o.id} />
          <Comments taskId={o.task_id} occurrenceId={o.id} />
        </div>
        <div className="space-y-4">
          <Card title={t('tasks.fields.assignees')}>
            {o.assignee_ids.length ? (
              <ul className="space-y-2">{o.assignee_ids.map((id) => <li key={id} className="flex items-center gap-2 text-sm"><Avatar name={memberName(id)} />{memberName(id)}</li>)}</ul>
            ) : <p className="text-sm text-slate-500">{t('tasks.unassignedHint')}</p>}
          </Card>
          {o.recurrence_freq !== 'none' && (
            <Card title={t('tasks.series')}>
              <p className="mb-1 text-xs font-medium uppercase text-slate-500">{t('tasks.upcoming')}</p>
              <ul className="mb-3 space-y-1 text-sm">
                {upcoming.map((x) => <li key={x.id}><Link className="hover:underline" to={`/tasks/${x.id}`}>{formatDate(x.due_date, i18n.language)}{x.assignee_ids.length ? ` · ${x.assignee_ids.map(memberName).join(', ')}` : ''}</Link></li>)}
                {!upcoming.length && <li className="text-slate-500">—</li>}
              </ul>
              <p className="mb-1 text-xs font-medium uppercase text-slate-500">{t('tasks.history')}</p>
              <ul className="space-y-1 text-sm">
                {past.map((x) => (
                  <li key={x.id}><Link className="hover:underline" to={`/tasks/${x.id}`}>{formatDate(x.due_date, i18n.language)} · <span className={cx(x.status === 'done' ? 'text-green-700' : x.is_overdue ? 'text-red-700' : 'text-slate-600')}>{statusLabel(x, t)}</span>{x.completed_by ? ` · ${memberName(x.completed_by)}` : ''}</Link></li>
                ))}
                {!past.length && <li className="text-slate-500">—</li>}
              </ul>
            </Card>
          )}
          <Attachments entityType="task" entityId={o.task_id} />
          <Card title={t('activity.title')}>
            <ActivityList parentId={o.task_id} limit={30} />
          </Card>
        </div>
      </div>
      <ConfirmDialog open={confirmArchive} title={t('common.archive')} message={t('tasks.archiveConfirm')} confirmLabel={t('common.archive')}
        loading={archive.isPending} onCancel={() => setConfirmArchive(false)} onConfirm={() => archive.mutate(undefined)} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}

function Checklist({ taskId, occurrenceId }: { taskId: string; occurrenceId: string }) {
  const { t, i18n } = useTranslation();
  const { householdId, memberName, household } = useCurrentHousehold();
  const q = useChecklist(taskId, occurrenceId);
  const [label, setLabel] = useState('');
  const toggle = useAction(async ({ itemId, done }: { itemId: string; done: boolean }) => {
    if (done) unwrap(await supabase.from('task_checklist_progress').delete().eq('occurrence_id', occurrenceId).eq('item_id', itemId));
    else unwrap(await supabase.from('task_checklist_progress').insert({ household_id: householdId, occurrence_id: occurrenceId, item_id: itemId }));
  }, { groups: ['tasks'] });
  const add = useAction(async (text: string) => {
    const position = (q.data?.items.length ?? 0);
    unwrap(await supabase.from('task_checklist_items').insert({ household_id: householdId, task_id: taskId, label: text, position }));
  }, { groups: ['tasks'], onSuccess: () => setLabel('') });
  const remove = useAction(async (id: string) => unwrap(await supabase.from('task_checklist_items').delete().eq('id', id)), { groups: ['tasks'] });
  if (q.isLoading) return <Card title={t('tasks.fields.checklist')}><LoadingState /></Card>;
  const items = q.data?.items ?? [];
  const done = new Map((q.data?.progress ?? []).map((p) => [p.item_id, p]));
  return (
    <Card title={`${t('tasks.fields.checklist')}${items.length ? ` (${done.size}/${items.length})` : ''}`}>
      <ul className="space-y-1">
        {items.map((it) => {
          const p = done.get(it.id);
          return (
            <li key={it.id} className="flex items-center justify-between gap-2">
              <Checkbox label={<span className={cx(p && 'text-slate-500 line-through')}>{it.label}{p && <span className="ml-2 text-xs text-slate-500 no-underline">({memberName(p.done_by)}, {formatDateTime(p.done_at, i18n.language, household.timezone)})</span>}</span>}
                checked={Boolean(p)} disabled={toggle.isPending} onChange={() => toggle.mutate({ itemId: it.id, done: Boolean(p) })} />
              <button type="button" aria-label={t('common.remove')} className="h-9 w-9 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-600" onClick={() => remove.mutate(it.id)}>
                <Icon name="close" className="mx-auto h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (label.trim()) add.mutate(label.trim()); }}>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('tasks.addStep')} aria-label={t('tasks.addStep')} maxLength={200} />
        <Button type="submit" variant="secondary" loading={add.isPending} disabled={!label.trim()}>{t('common.add')}</Button>
      </form>
      {items.length > 0 && <p className="mt-2 text-xs text-slate-500">{t('tasks.checklistHint')}</p>}
    </Card>
  );
}

function Comments({ taskId, occurrenceId }: { taskId: string; occurrenceId: string }) {
  const { t, i18n } = useTranslation();
  const { householdId, memberName, activeMembers, household } = useCurrentHousehold();
  const { userId } = useAuth();
  const q = useComments(taskId);
  const [kind, setKind] = useState<TaskComment['kind']>('comment');
  const [body, setBody] = useState('');
  const [agreedDate, setAgreedDate] = useState('');
  const [applyDate, setApplyDate] = useState(true);
  const [swapWith, setSwapWith] = useState('');
  const [applySwap, setApplySwap] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const occ = useOccurrence(occurrenceId).data;

  const add = useAction(async () => {
    unwrap(await supabase.from('task_comments').insert({
      household_id: householdId, task_id: taskId, occurrence_id: occurrenceId, kind, body: body.trim(),
      agreed_due_date: kind === 'agreement' ? agreedDate : null, swap_with: kind === 'swap' ? swapWith : null, created_by: userId,
    }));
    // optional follow-up the members agreed on, applied to this occurrence only
    if (kind === 'agreement' && applyDate && agreedDate) {
      unwrap(await supabase.rpc('update_task', { p_occurrence: occurrenceId, p_scope: 'this', p_data: { due_date: agreedDate } }));
    }
    if (kind === 'swap' && applySwap && swapWith && occ) {
      const next = [...new Set([...occ.assignee_ids.filter((id) => id !== userId), swapWith])];
      unwrap(await supabase.rpc('update_task', { p_occurrence: occurrenceId, p_scope: 'this', p_data: {}, p_assignees: next }));
    }
  }, { groups: ['tasks', 'notifications'], success: 'tasks.commentSaved', onSuccess: () => { setBody(''); setAgreedDate(''); setSwapWith(''); } });
  const remove = useAction(async (id: string) => unwrap(await supabase.from('task_comments').delete().eq('id', id)), { groups: ['tasks'] });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return setError('validation.required');
    if (kind === 'agreement' && !agreedDate) return setError('validation.agreedDate');
    if (kind === 'swap' && !swapWith) return setError('validation.swapWith');
    setError(null);
    add.mutate(undefined);
  };

  return (
    <Card title={t('tasks.comments.title')}>
      {q.isLoading ? <LoadingState /> : (
        <ul className="mb-4 space-y-3">
          {(q.data ?? []).map((c) => (
            <li key={c.id} className="rounded-xl bg-slate-50 p-3 text-sm">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium"><Avatar name={memberName(c.created_by)} />{memberName(c.created_by)}
                  {c.kind !== 'comment' && <Badge tone={c.kind === 'agreement' ? 'teal' : 'purple'}>{t(`tasks.comments.kinds.${c.kind}`)}</Badge>}</span>
                <span className="text-xs text-slate-500">{formatDateTime(c.created_at, i18n.language, household.timezone)}</span>
              </div>
              <p className="whitespace-pre-wrap text-slate-800">{c.body}</p>
              {c.agreed_due_date && <p className="mt-1 text-xs text-brand-800">{t('tasks.comments.agreedDate', { date: formatDate(c.agreed_due_date, i18n.language) })}</p>}
              {c.swap_with && <p className="mt-1 text-xs text-violet-800">{t('tasks.comments.swapWith', { name: memberName(c.swap_with) })}</p>}
              {c.created_by === userId && <button type="button" className="mt-1 text-xs text-slate-500 underline" onClick={() => remove.mutate(c.id)}>{t('common.delete')}</button>}
            </li>
          ))}
          {!q.data?.length && <li className="text-sm text-slate-500">{t('tasks.comments.empty')}</li>}
        </ul>
      )}
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Select aria-label={t('tasks.comments.kind')} value={kind} onChange={(e) => setKind(e.target.value as TaskComment['kind'])}>
          {(['comment', 'agreement', 'swap'] as const).map((k) => <option key={k} value={k}>{t(`tasks.comments.kinds.${k}`)}</option>)}
        </Select>
        <Textarea aria-label={t('tasks.comments.body')} placeholder={t(`tasks.comments.placeholder.${kind}`)} rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
        {kind === 'agreement' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t('tasks.comments.agreedDateLabel')} htmlFor="agreed-date"><Input id="agreed-date" type="date" value={agreedDate} onChange={(e) => setAgreedDate(e.target.value)} /></Field>
            <Checkbox label={t('tasks.comments.applyDate')} checked={applyDate} onChange={(e) => setApplyDate(e.target.checked)} />
          </div>
        )}
        {kind === 'swap' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t('tasks.comments.swapWithLabel')} htmlFor="swap-with">
              <Select id="swap-with" value={swapWith} onChange={(e) => setSwapWith(e.target.value)}>
                <option value="">—</option>
                {activeMembers.filter((m) => m.user_id !== userId).map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
              </Select>
            </Field>
            <Checkbox label={t('tasks.comments.applySwap')} checked={applySwap} onChange={(e) => setApplySwap(e.target.checked)} />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-600">{t(error)}</p>}
        <Button type="submit" loading={add.isPending}>{t('tasks.comments.add')}</Button>
      </form>
    </Card>
  );
}
