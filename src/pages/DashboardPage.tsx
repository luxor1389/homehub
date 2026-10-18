import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Card, ErrorState, LoadingState, PageHeader, cx } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { useOccurrences } from '@/features/tasks/api';
import { TaskList } from '@/features/tasks/TaskCard';
import { applyFilters, EMPTY_FILTERS, TaskFilters, type Filters } from '@/features/tasks/TaskFilters';
import { useMealPlans } from '@/features/meals/api';
import { useNeededItems } from '@/features/shopping/api';
import { useBills } from '@/features/budget/api';
import { useVehicles, vehicleObligations } from '@/features/vehicles/api';
import { usePetCare, usePets, upcomingPetCare } from '@/features/pets/api';
import { usePlants } from '@/features/plants/api';
import { addDays, formatDate, formatMoney, startOfWeek, weekdayName } from '@/lib/dates';
import { MEAL_TYPES } from '@/lib/types';

function SectionLink({ to, label }: { to: string; label: string }) {
  return <Link to={to} className="text-sm font-medium text-brand-700 hover:underline">{label}</Link>;
}

function DueBadge({ date, today }: { date: string; today: string }) {
  const { t, i18n } = useTranslation();
  const overdue = date < today;
  const soon = !overdue && date <= addDays(today, 3);
  return <Badge tone={overdue ? 'red' : soon ? 'amber' : 'gray'}>{overdue ? t('status.overdue') + ' · ' : ''}{formatDate(date, i18n.language, { day: 'numeric', month: 'short' })}</Badge>;
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { today, household, memberName } = useCurrentHousehold();
  const { profile } = useAuth();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const open = useOccurrences('dash-open', { from: addDays(today, -120), to: addDays(today, 7), statuses: ['planned', 'in_progress'] });
  const recent = useOccurrences('dash-done', { statuses: ['done'], completedSince: new Date(Date.now() - 7 * 86400000).toISOString(), limit: 10 });
  const weekStart = startOfWeek(today);
  const meals = useMealPlans(weekStart, addDays(weekStart, 6));
  const shopping = useNeededItems();
  const bills = useBills({ status: 'unpaid', to: addDays(today, 14) });
  const vehicles = useVehicles();
  const pets = usePets();
  const petCare = usePetCare();
  const plants = usePlants();

  const filtered = useMemo(() => applyFilters(open.data ?? [], filters, today), [open.data, filters, today]);
  const overdue = filtered.filter((o) => o.is_overdue);
  const todays = filtered.filter((o) => o.due_date === today && !o.is_overdue);
  // next occurrence per recurring task only, so a daily task doesn't fill the whole list
  const seen = new Set<string>();
  const week = filtered.filter((o) => {
    if (o.due_date <= today || o.due_date > addDays(today, 7) || seen.has(o.task_id)) return false;
    seen.add(o.task_id);
    return true;
  });
  const inProgress = filtered.filter((o) => o.status === 'in_progress');
  const recentDone = applyFilters(recent.data ?? [], { ...filters, status: '', deadline: '' }, today);

  const vehicleDue = vehicleObligations(vehicles.data ?? [], today, 30);
  const petsById = new Map((pets.data ?? []).map((p) => [p.id, p]));
  const petDue = upcomingPetCare(petCare.data ?? []).filter((r) => petsById.has(r.pet_id) && r.next_due_on! <= addDays(today, 14));
  const plantDue = (plants.data ?? []).filter((p) => p.status?.next_watering_on && p.status.next_watering_on <= addDays(today, 1));

  return (
    <div className="space-y-4">
      <PageHeader title={t('dashboard.greeting', { name: profile?.display_name ?? '' })}
        subtitle={`${household.name} · ${formatDate(today, i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}`} />
      <TaskFilters value={filters} onChange={setFilters} />
      {open.isLoading ? <LoadingState /> : open.error ? <ErrorState error={open.error} onRetry={() => void open.refetch()} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {overdue.length > 0 && (
            <Card className="border-red-200 lg:col-span-2" title={<span className="text-red-700">{t('dashboard.overdue')} ({overdue.length})</span>}>
              <TaskList items={overdue} empty="" />
            </Card>
          )}
          <Card title={`${t('dashboard.today')} (${todays.length})`} action={<SectionLink to="/tasks" label={t('common.all')} />}>
            <TaskList items={todays} empty={t('dashboard.nothingToday')} showDate={false} />
          </Card>
          <Card title={`${t('dashboard.next7')} (${week.length})`} action={<SectionLink to="/calendar" label={t('nav.calendar')} />}>
            <TaskList items={week.slice(0, 12)} empty={t('dashboard.nothingWeek')} compact />
            {week.length > 12 && <Link to="/tasks" className="mt-2 block text-sm text-brand-700">{t('dashboard.andMore', { count: week.length - 12 })}</Link>}
          </Card>
          <Card title={`${t('dashboard.inProgress')} (${inProgress.length})`}>
            <TaskList items={inProgress} empty={t('dashboard.nothingInProgress')} compact />
          </Card>
          <Card title={t('dashboard.recentlyDone')}>
            {recent.isLoading ? <LoadingState /> : <TaskList items={recentDone} empty={t('dashboard.nothingDone')} compact />}
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('dashboard.meals')} action={<SectionLink to="/meals" label={t('common.open')} />}>
          {meals.isLoading ? <LoadingState /> : (
            <div className="space-y-1 text-sm">
              {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d, i) => {
                const items = (meals.data ?? []).filter((m) => m.plan_date === d).sort((a, b) => MEAL_TYPES.indexOf(a.meal_type) - MEAL_TYPES.indexOf(b.meal_type));
                return (
                  <div key={d} className={cx('flex gap-2 rounded-lg px-2 py-1', d === today && 'bg-brand-50')}>
                    <span className="w-10 shrink-0 font-medium text-slate-600">{weekdayName(i + 1, i18n.language)}</span>
                    <span className="text-slate-800">{items.length ? items.map((m) => `${t(`meals.types.${m.meal_type}`)}: ${m.title}`).join(' · ') : <span className="text-slate-400">—</span>}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card title={`${t('dashboard.shopping')} (${shopping.data?.length ?? 0})`} action={<SectionLink to="/shopping" label={t('common.open')} />}>
          {shopping.isLoading ? <LoadingState /> : shopping.data?.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {shopping.data.slice(0, 20).map((i) => (
                <li key={i.id}><Badge tone={i.priority === 'high' ? 'amber' : 'gray'}>{i.name}{i.quantity !== 1 || i.unit ? ` · ${i.quantity}${i.unit ? ' ' + t(`units.${i.unit}`) : ''}` : ''}</Badge></li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">{t('shopping.empty')}</p>}
        </Card>
        <Card title={t('dashboard.bills')} action={<SectionLink to="/budget" label={t('common.open')} />}>
          {bills.isLoading ? <LoadingState /> : bills.data?.length ? (
            <ul className="divide-y divide-slate-100">
              {bills.data.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate">{b.name}{b.responsible_id && <span className="text-slate-500"> · {memberName(b.responsible_id)}</span>}</span>
                  <span className="flex shrink-0 items-center gap-2"><span className="font-medium">{formatMoney(b.amount, b.currency, i18n.language)}</span><DueBadge date={b.due_date} today={today} /></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">{t('dashboard.noBills')}</p>}
        </Card>
        <Card title={t('dashboard.vehicles')} action={<SectionLink to="/vehicles" label={t('common.open')} />}>
          {vehicles.isLoading ? <LoadingState /> : vehicleDue.length ? (
            <ul className="divide-y divide-slate-100">
              {vehicleDue.map((d) => (
                <li key={d.vehicle.id + d.what} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate"><Icon name="car" className="mr-1 inline h-4 w-4" />{d.vehicle.make} {d.vehicle.model ?? ''} · {t(`vehicles.fields.${d.what}`)}</span>
                  {d.date ? <DueBadge date={d.date} today={today} /> : <Badge tone="amber">{d.km} km</Badge>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">{t('dashboard.noVehicleDue')}</p>}
        </Card>
        <Card className="lg:col-span-2" title={t('dashboard.petsPlants')}>
          {petDue.length + plantDue.length === 0 ? <p className="text-sm text-slate-500">{t('dashboard.noPetPlantDue')}</p> : (
            <ul className="divide-y divide-slate-100">
              {petDue.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link to={`/pets/${r.pet_id}`} className="min-w-0 truncate hover:underline"><Icon name="paw" className="mr-1 inline h-4 w-4" />{petsById.get(r.pet_id)?.name} · {t(`pets.care.${r.kind}`)}</Link>
                  <DueBadge date={r.next_due_on!} today={today} />
                </li>
              ))}
              {plantDue.map(({ plant, status }) => (
                <li key={plant.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link to={`/plants/${plant.id}`} className="min-w-0 truncate hover:underline"><Icon name="leaf" className="mr-1 inline h-4 w-4" />{plant.name} · {t('plants.kinds.watering')}</Link>
                  <DueBadge date={status!.next_watering_on!} today={today} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
