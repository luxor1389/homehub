import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Avatar, Button, Card, ErrorState, Input, LoadingState, PageHeader, Tabs } from '@/components/ui/ui';
import { useOccurrences } from '@/features/tasks/api';
import { TaskList } from '@/features/tasks/TaskCard';
import { applyFilters, EMPTY_FILTERS, TaskFilters, type Filters } from '@/features/tasks/TaskFilters';
import { useTaskEditor } from '@/features/tasks/TaskEditor';
import { addDays } from '@/lib/dates';
import type { Occurrence } from '@/lib/types';

type View = 'list' | 'members' | 'done';

export default function TasksPage() {
  const { t } = useTranslation();
  const { today } = useCurrentHousehold();
  const { openNew } = useTaskEditor();
  const [view, setView] = useState<View>('list');
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, status: 'open' });
  const [search, setSearch] = useState('');
  const [horizon, setHorizon] = useState(30);

  const list = useOccurrences('tasks-page', { from: addDays(today, -365), to: addDays(today, horizon) });
  const items = useMemo(() => {
    const s = search.trim().toLocaleLowerCase();
    return applyFilters(list.data ?? [], filters, today)
      .filter((o) => !s || o.title.toLocaleLowerCase().includes(s) || (o.description ?? '').toLocaleLowerCase().includes(s));
  }, [list.data, filters, today, search]);

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.tasks')} actions={<Button icon="plus" onClick={() => openNew()}>{t('tasks.new')}</Button>} />
      <Tabs value={view} onChange={setView} items={[
        { value: 'list', label: t('tasks.views.list') },
        { value: 'members', label: t('tasks.views.members') },
        { value: 'done', label: t('tasks.views.done') },
      ]} />
      {view === 'list' && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input type="search" placeholder={t('common.search')} aria-label={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
          </div>
          <TaskFilters value={filters} onChange={setFilters} />
          {list.isLoading ? <LoadingState /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : (
            <>
              <TaskList items={items} empty={t('tasks.emptyFiltered')} />
              {horizon < 365 && <Button variant="ghost" onClick={() => setHorizon(365)}>{t('tasks.showLater')}</Button>}
            </>
          )}
        </>
      )}
      {view === 'members' && <Workload items={list.data ?? []} loading={list.isLoading} />}
      {view === 'done' && <DoneList />}
    </div>
  );
}

/** Overview of how work is distributed — information for agreeing on tasks, not a performance score. */
function Workload({ items, loading }: { items: Occurrence[]; loading: boolean }) {
  const { t } = useTranslation();
  const { activeMembers, today } = useCurrentHousehold();
  const [range, setRange] = useState(7);
  if (loading) return <LoadingState />;
  const open = items.filter((o) => ['planned', 'in_progress'].includes(o.status) && o.due_date <= addDays(today, range));
  const unassigned = open.filter((o) => o.assignee_ids.length === 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-600">{t('workload.hint')}</p>
        <Tabs value={String(range)} onChange={(v) => setRange(Number(v))} items={[
          { value: '7', label: t('workload.days', { count: 7 }) }, { value: '30', label: t('workload.days', { count: 30 }) },
        ]} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {activeMembers.map((m) => {
          const mine = open.filter((o) => o.assignee_ids.includes(m.user_id));
          const minutes = mine.reduce((s, o) => s + (o.estimated_minutes ?? 0), 0);
          return (
            <Card key={m.user_id} title={<span className="flex items-center gap-2"><Avatar name={m.display_name} />{m.display_name}</span>}
              action={<span className="text-sm text-slate-600" data-testid={`workload-${m.display_name}`}>{t('workload.summary', { count: mine.length, minutes })}</span>}>
              <TaskList items={mine} empty={t('workload.none')} compact />
            </Card>
          );
        })}
        <Card title={t('tasks.unassigned')} action={<span className="text-sm text-slate-600">{t('workload.summary', { count: unassigned.length, minutes: unassigned.reduce((s, o) => s + (o.estimated_minutes ?? 0), 0) })}</span>}>
          <TaskList items={unassigned} empty={t('workload.noneUnassigned')} compact />
        </Card>
      </div>
    </div>
  );
}

function DoneList() {
  const { t } = useTranslation();
  const done = useOccurrences('done-page', { statuses: ['done'], completedSince: new Date(Date.now() - 60 * 86400000).toISOString(), limit: 200 });
  if (done.isLoading) return <LoadingState />;
  if (done.error) return <ErrorState error={done.error} onRetry={() => void done.refetch()} />;
  return <TaskList items={done.data ?? []} empty={t('dashboard.nothingDone')} />;
}
