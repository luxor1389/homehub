import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Button, ErrorState, IconButton, LoadingState, PageHeader, Select, Tabs, cx } from '@/components/ui/ui';
import { Icon, type IconName } from '@/components/ui/icons';
import { useOccurrences } from '@/features/tasks/api';
import { useBills } from '@/features/budget/api';
import { useMealPlans } from '@/features/meals/api';
import { useVehicles, VEHICLE_DATE_FIELDS } from '@/features/vehicles/api';
import { usePetCare, usePets, upcomingPetCare } from '@/features/pets/api';
import { usePlants } from '@/features/plants/api';
import { useTaskEditor } from '@/features/tasks/TaskEditor';
import { addDays, addMonths, isoWeekday, endOfMonth, formatDate, formatTime, monthGrid, monthTitle, startOfMonth, startOfWeek, weekdayName } from '@/lib/dates';
import { statusLabel } from '@/features/tasks/labels';

type View = 'day' | 'week' | 'month';
type Kind = 'task' | 'bill' | 'meal' | 'vehicle' | 'pet' | 'plant';
interface CalEvent { id: string; date: string; time?: string | null; kind: Kind; title: string; sub?: string; to: string; done?: boolean; overdue?: boolean; assignees?: string[] }

const KIND_STYLE: Record<Kind, { icon: IconName; cls: string }> = {
  task: { icon: 'tasks', cls: 'bg-sky-50 border-sky-200 text-sky-900' },
  bill: { icon: 'wallet', cls: 'bg-amber-50 border-amber-200 text-amber-900' },
  meal: { icon: 'meal', cls: 'bg-orange-50 border-orange-200 text-orange-900' },
  vehicle: { icon: 'car', cls: 'bg-slate-100 border-slate-300 text-slate-800' },
  pet: { icon: 'paw', cls: 'bg-violet-50 border-violet-200 text-violet-900' },
  plant: { icon: 'leaf', cls: 'bg-green-50 border-green-200 text-green-900' },
};

export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const { today, activeMembers, memberName } = useCurrentHousehold();
  const { openNew } = useTaskEditor();
  const [view, setView] = useState<View>(() => (window.matchMedia?.('(min-width: 768px)').matches ? 'month' : 'week'));
  const [cursor, setCursor] = useState(today);
  const [member, setMember] = useState('');
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(['task', 'bill', 'meal', 'vehicle', 'pet', 'plant']));

  const [from, to] = view === 'day' ? [cursor, cursor]
    : view === 'week' ? [startOfWeek(cursor), addDays(startOfWeek(cursor), 6)]
    : [monthGrid(cursor)[0], monthGrid(cursor)[41]];

  const occ = useOccurrences(`cal-${from}-${to}`, { from, to });
  const bills = useBills({ from, to });
  const meals = useMealPlans(from, to);
  const vehicles = useVehicles();
  const pets = usePets();
  const petCare = usePetCare();
  const plants = usePlants();

  const events = useMemo<CalEvent[]>(() => {
    const out: CalEvent[] = [];
    for (const o of occ.data ?? []) {
      if (o.status === 'cancelled') continue;
      out.push({ id: o.id, date: o.due_date, time: o.due_time, kind: 'task', title: o.title, to: `/tasks/${o.id}`, done: o.status === 'done', overdue: o.is_overdue, assignees: o.assignee_ids, sub: statusLabel(o, t) });
    }
    for (const b of bills.data ?? []) out.push({ id: b.id, date: b.due_date, kind: 'bill', title: b.name, to: '/budget', done: b.status === 'paid', overdue: b.status === 'unpaid' && b.due_date < today, assignees: b.responsible_id ? [b.responsible_id] : [] });
    for (const m of meals.data ?? []) out.push({ id: m.id, date: m.plan_date, kind: 'meal', title: `${t(`meals.types.${m.meal_type}`)}: ${m.title}`, to: '/meals', assignees: m.cook_id ? [m.cook_id] : [] });
    for (const v of vehicles.data ?? []) for (const f of VEHICLE_DATE_FIELDS) {
      const d = v[f];
      if (d && d >= from && d <= to) out.push({ id: v.id + f, date: d, kind: 'vehicle', title: `${v.make} ${v.model ?? ''}`.trim(), sub: t(`vehicles.fields.${f}`), to: `/vehicles/${v.id}`, overdue: d < today });
    }
    const petNames = new Map((pets.data ?? []).map((p) => [p.id, p.name]));
    for (const r of upcomingPetCare(petCare.data ?? [])) {
      if (petNames.has(r.pet_id) && r.next_due_on! >= from && r.next_due_on! <= to) out.push({ id: r.id, date: r.next_due_on!, kind: 'pet', title: petNames.get(r.pet_id)!, sub: t(`pets.care.${r.kind}`), to: `/pets/${r.pet_id}`, overdue: r.next_due_on! < today });
    }
    for (const { plant, status } of plants.data ?? []) {
      const d = status?.next_watering_on;
      if (d && d <= to) {
        const shown = d < from ? (from <= today && today <= to ? today : null) : d;
        if (shown) out.push({ id: plant.id, date: shown, kind: 'plant', title: plant.name, sub: t('plants.kinds.watering'), to: `/plants/${plant.id}`, overdue: d < today });
      }
    }
    return out
      .filter((e) => kinds.has(e.kind))
      .filter((e) => !member || (e.assignees ?? []).includes(member) || (member === 'unassigned' && e.kind === 'task' && !(e.assignees ?? []).length))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99'));
  }, [occ.data, bills.data, meals.data, vehicles.data, pets.data, petCare.data, plants.data, kinds, member, from, to, today, t]);

  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [events]);

  const move = (dir: number) => setCursor(view === 'day' ? addDays(cursor, dir) : view === 'week' ? addDays(cursor, 7 * dir) : addMonths(startOfMonth(cursor), dir));
  const title = view === 'month' ? monthTitle(cursor, i18n.language)
    : view === 'week' ? `${formatDate(from, i18n.language, { day: 'numeric', month: 'short' })} – ${formatDate(to, i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : formatDate(cursor, i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const toggleKind = (k: Kind) => setKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const EventChip = ({ e, small }: { e: CalEvent; small?: boolean }) => (
    <Link to={e.to} className={cx('block rounded-lg border px-2 py-1 text-xs leading-tight hover:brightness-95', KIND_STYLE[e.kind].cls, e.done && 'opacity-60 line-through', e.overdue && 'ring-1 ring-red-400')} data-testid="calendar-event">
      <span className="flex items-center gap-1"><Icon name={KIND_STYLE[e.kind].icon} className="h-3 w-3 shrink-0" />{e.time && <span>{formatTime(e.time)}</span>}<span className="truncate font-medium">{e.title}</span></span>
      {!small && (e.sub || e.assignees?.length) ? <span className="mt-0.5 block truncate opacity-80">{[e.sub, (e.assignees ?? []).map(memberName).join(', ')].filter(Boolean).join(' · ')}</span> : null}
    </Link>
  );

  const loading = occ.isLoading;
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.calendar')} actions={<Button icon="plus" onClick={() => openNew({ due_date: view === 'day' ? cursor : today })}>{t('tasks.new')}</Button>} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton icon="chevronLeft" label={t('calendar.previous')} onClick={() => move(-1)} />
          <Button variant="secondary" size="sm" onClick={() => setCursor(today)}>{t('calendar.today')}</Button>
          <IconButton icon="chevronRight" label={t('calendar.next')} onClick={() => move(1)} />
          <h2 className="ml-2 text-lg font-semibold capitalize">{title}</h2>
        </div>
        <Tabs value={view} onChange={setView} items={[
          { value: 'day', label: t('calendar.day') }, { value: 'week', label: t('calendar.week') }, { value: 'month', label: t('calendar.month') },
        ]} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t('filters.assignee')} className="w-auto" value={member} onChange={(e) => setMember(e.target.value)}>
          <option value="">{t('filters.allMembers')}</option>
          <option value="unassigned">{t('tasks.unassigned')}</option>
          {activeMembers.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
        </Select>
        {(Object.keys(KIND_STYLE) as Kind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kinds.has(k)} onClick={() => toggleKind(k)}
            className={cx('inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs font-medium', kinds.has(k) ? KIND_STYLE[k].cls : 'border-slate-200 bg-white text-slate-400')}>
            <Icon name={KIND_STYLE[k].icon} className="h-3.5 w-3.5" />{t(`calendar.kinds.${k}`)}
          </button>
        ))}
      </div>
      {occ.error && <ErrorState error={occ.error} onRetry={() => void occ.refetch()} />}
      {loading ? <LoadingState /> : view === 'month' ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium text-slate-600">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <div key={d} className="py-2">{weekdayName(d, i18n.language)}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {monthGrid(cursor).map((d) => {
              const list = byDate.get(d) ?? [];
              const inMonth = d >= startOfMonth(cursor) && d <= endOfMonth(cursor);
              return (
                <button type="button" key={d} onClick={() => { setCursor(d); setView('day'); }}
                  className={cx('min-h-20 border-b border-r border-slate-100 p-1 text-left align-top sm:min-h-28', !inMonth && 'bg-slate-50 text-slate-400')}>
                  <span className={cx('mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium', d === today && 'bg-brand-700 text-white')}>{Number(d.slice(8))}</span>
                  <div className="hidden space-y-0.5 sm:block">
                    {list.slice(0, 3).map((e) => (
                      <span key={e.id} className={cx('block truncate rounded border px-1 text-[11px]', KIND_STYLE[e.kind].cls, e.done && 'line-through opacity-60', e.overdue && 'ring-1 ring-red-400')}>{e.title}</span>
                    ))}
                    {list.length > 3 && <span className="block text-[11px] text-slate-500">+{list.length - 3}</span>}
                  </div>
                  {list.length > 0 && <span className="flex flex-wrap gap-0.5 sm:hidden">{list.slice(0, 6).map((e) => <span key={e.id} className={cx('h-1.5 w-1.5 rounded-full', e.overdue ? 'bg-red-500' : 'bg-brand-600')} />)}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ) : view === 'week' ? (
        <div className="grid gap-2 md:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => (
            <div key={d} className={cx('rounded-xl border bg-white p-2', d === today ? 'border-brand-600' : 'border-slate-200')}>
              <button type="button" onClick={() => { setCursor(d); setView('day'); }} className="mb-1 text-left text-sm font-semibold">
                {weekdayName(isoWeekday(d), i18n.language)} {Number(d.slice(8))}.
              </button>
              <div className="space-y-1">
                {(byDate.get(d) ?? []).map((e) => <EventChip key={e.id} e={e} small />)}
                {!(byDate.get(d) ?? []).length && <p className="text-xs text-slate-400">—</p>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {(byDate.get(cursor) ?? []).map((e) => <EventChip key={e.id} e={e} />)}
          {!(byDate.get(cursor) ?? []).length && <p className="text-sm text-slate-500">{t('calendar.nothing')}</p>}
        </div>
      )}
    </div>
  );
}
