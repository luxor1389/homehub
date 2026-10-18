import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Occurrence } from '@/lib/types';
import { Avatar, Badge, cx } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { formatDate, formatTime, formatDateTime } from '@/lib/dates';
import { priorityTone, roomLabel, statusLabel, statusTone, subcategoryLabel } from './labels';
import { useSetStatus } from './api';

export function TaskCard({ o, showDate = true, compact = false }: { o: Occurrence; showDate?: boolean; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const { memberName, rooms, household } = useCurrentHousehold();
  const setStatus = useSetStatus();
  const done = o.status === 'done';
  const room = rooms.find((r) => r.id === o.room_id);
  const busy = setStatus.isPending;
  return (
    <li className={cx('flex items-start gap-3 rounded-xl border bg-white p-3', o.is_overdue ? 'border-red-200' : 'border-slate-200', o.status === 'cancelled' && 'opacity-60')} data-testid="task-card">
      <button type="button" disabled={busy || o.status === 'cancelled'}
        onClick={() => setStatus.mutate({ id: o.id, status: done ? 'planned' : 'done' })}
        aria-label={done ? t('tasks.actions.reopen') : t('tasks.actions.complete')}
        className={cx('mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2',
          done ? 'border-green-600 bg-green-600 text-white' : 'border-slate-300 text-transparent hover:border-green-600 hover:text-green-600')}>
        <Icon name="check" className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        <Link to={`/tasks/${o.id}`} className={cx('block font-medium text-slate-900 hover:underline', done && 'text-slate-500 line-through')}>{o.title}</Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
          <Badge tone={statusTone(o)}>{statusLabel(o, t)}</Badge>
          {o.priority !== 'normal' && <Badge tone={priorityTone[o.priority]}>{t(`priority.${o.priority}`)}</Badge>}
          {showDate && <span className="inline-flex items-center gap-1"><Icon name="calendar" className="h-3.5 w-3.5" />{formatDate(o.due_date, i18n.language, { day: 'numeric', month: 'short' })}{o.due_time ? ` ${formatTime(o.due_time)}` : ''}</span>}
          {o.recurrence_freq !== 'none' && <Icon name="repeat" className="h-3.5 w-3.5" aria-label={t('tasks.recurring')} />}
          {!compact && <span>{t(`categories.${o.category}`)}{o.subcategory ? ` · ${subcategoryLabel(o.subcategory, t)}` : ''}</span>}
          {!compact && room && <span>· {roomLabel(room, t)}</span>}
          {o.estimated_minutes && <span className="inline-flex items-center gap-0.5"><Icon name="clock" className="h-3.5 w-3.5" />{t('common.minutesShort', { count: o.estimated_minutes })}</span>}
        </div>
        {done && o.completed_by && (
          <p className="mt-1 text-xs text-green-700">{t('tasks.completedBy', { name: memberName(o.completed_by), date: formatDateTime(o.completed_at, i18n.language, household.timezone) })}</p>
        )}
      </div>
      <div className="flex shrink-0 -space-x-1.5" aria-label={t('tasks.fields.assignees')}>
        {o.assignee_ids.length ? o.assignee_ids.map((id) => <Avatar key={id} name={memberName(id)} className="ring-2 ring-white" />)
          : <span className="text-xs text-slate-400">{t('tasks.unassigned')}</span>}
      </div>
    </li>
  );
}

export function TaskList({ items, empty, showDate, compact }: { items: Occurrence[]; empty: string; showDate?: boolean; compact?: boolean }) {
  if (!items.length) return <p className="py-3 text-sm text-slate-500">{empty}</p>;
  return <ul className="space-y-2">{items.map((o) => <TaskCard key={o.id} o={o} showDate={showDate} compact={compact} />)}</ul>;
}
