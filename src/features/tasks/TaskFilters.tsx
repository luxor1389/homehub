import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, cx } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { TASK_CATEGORIES, type Occurrence } from '@/lib/types';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { addDays } from '@/lib/dates';

export interface Filters {
  category: string;
  assignee: string; // '' | 'unassigned' | user id
  priority: string;
  status: string; // '' | planned | in_progress | done | cancelled | overdue | open
  deadline: string; // '' | today | week | overdue | later
}
export const EMPTY_FILTERS: Filters = { category: '', assignee: '', priority: '', status: '', deadline: '' };

export function applyFilters(items: Occurrence[], f: Filters, today: string): Occurrence[] {
  return items.filter((o) => {
    if (f.category && o.category !== f.category) return false;
    if (f.assignee === 'unassigned' && o.assignee_ids.length) return false;
    if (f.assignee && f.assignee !== 'unassigned' && !o.assignee_ids.includes(f.assignee)) return false;
    if (f.priority && o.priority !== f.priority) return false;
    if (f.status === 'overdue' && !o.is_overdue) return false;
    if (f.status === 'open' && !['planned', 'in_progress'].includes(o.status)) return false;
    if (f.status && !['overdue', 'open'].includes(f.status) && o.status !== f.status) return false;
    if (f.deadline === 'today' && o.due_date !== today) return false;
    if (f.deadline === 'week' && (o.due_date < today || o.due_date > addDays(today, 7))) return false;
    if (f.deadline === 'overdue' && !o.is_overdue) return false;
    if (f.deadline === 'later' && o.due_date <= addDays(today, 7)) return false;
    return true;
  });
}

export function TaskFilters({ value, onChange, hide = [] }: { value: Filters; onChange: (f: Filters) => void; hide?: (keyof Filters)[] }) {
  const { t } = useTranslation();
  const { activeMembers } = useCurrentHousehold();
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  const activeCount = Object.values(value).filter(Boolean).length;
  const active = activeCount > 0;
  const [open, setOpen] = useState(false);
  return (
    <div role="search" aria-label={t('filters.title')} className="space-y-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 md:hidden">
        <Icon name="filter" className="h-4 w-4" />{t('filters.title')}{active ? ` (${activeCount})` : ''}
      </button>
    <div className={cx(open ? 'grid' : 'hidden', 'grid-cols-2 items-center gap-2 md:grid md:grid-cols-3 lg:grid-cols-6')}>
      {!hide.includes('category') && (
        <Select aria-label={t('filters.category')} value={value.category} onChange={set('category')}>
          <option value="">{t('filters.allCategories')}</option>
          {TASK_CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
        </Select>
      )}
      {!hide.includes('assignee') && (
        <Select aria-label={t('filters.assignee')} value={value.assignee} onChange={set('assignee')}>
          <option value="">{t('filters.allMembers')}</option>
          <option value="unassigned">{t('tasks.unassigned')}</option>
          {activeMembers.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
        </Select>
      )}
      {!hide.includes('priority') && (
        <Select aria-label={t('filters.priority')} value={value.priority} onChange={set('priority')}>
          <option value="">{t('filters.allPriorities')}</option>
          {(['low', 'normal', 'high', 'urgent'] as const).map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
        </Select>
      )}
      {!hide.includes('status') && (
        <Select aria-label={t('filters.status')} value={value.status} onChange={set('status')}>
          <option value="">{t('filters.allStatuses')}</option>
          <option value="open">{t('status.open')}</option>
          {(['planned', 'in_progress', 'done', 'cancelled', 'overdue'] as const).map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </Select>
      )}
      {!hide.includes('deadline') && (
        <Select aria-label={t('filters.deadline')} value={value.deadline} onChange={set('deadline')}>
          <option value="">{t('filters.anyDeadline')}</option>
          {(['today', 'week', 'overdue', 'later'] as const).map((d) => <option key={d} value={d}>{t(`filters.deadlines.${d}`)}</option>)}
        </Select>
      )}
      {active && <button type="button" className="min-h-11 px-2 text-sm text-brand-700 underline" onClick={() => onChange(EMPTY_FILTERS)}>{t('filters.clear')}</button>}
    </div>
    </div>
  );
}
