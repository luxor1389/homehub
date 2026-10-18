import { useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { unwrap, useAction } from '@/lib/hooks';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Attachments } from '@/features/files/Attachments';
import { Photo } from '@/features/files/Photo';
import { fuelConsumption, useMaintenance, useVehicles, VEHICLE_DATE_FIELDS } from '@/features/vehicles/api';
import { useOccurrences } from '@/features/tasks/api';
import { TaskList } from '@/features/tasks/TaskCard';
import { useTaskEditor } from '@/features/tasks/TaskEditor';
import { addDays, formatDate, formatMoney, formatNumber } from '@/lib/dates';
import { CURRENCIES } from '@/lib/options';
import { MAINTENANCE_KINDS, type Vehicle, type VehicleMaintenance } from '@/lib/types';

export default function VehiclesPage() {
  return (
    <Routes>
      <Route index element={<VehicleList />} />
      <Route path=":id" element={<VehicleDetail />} />
    </Routes>
  );
}

function dateTone(d: string | null, today: string) {
  if (!d) return 'gray' as const;
  if (d < today) return 'red' as const;
  if (d <= addDays(today, 30)) return 'amber' as const;
  return 'green' as const;
}

function VehicleList() {
  const { t, i18n } = useTranslation();
  const { today } = useCurrentHousehold();
  const vehicles = useVehicles();
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.vehicles')} actions={<Button icon="plus" onClick={() => setEditing(true)}>{t('vehicles.new')}</Button>} />
      {vehicles.isLoading ? <LoadingState /> : vehicles.error ? <ErrorState error={vehicles.error} onRetry={() => void vehicles.refetch()} /> : !vehicles.data?.length ? (
        <EmptyState icon="car" title={t('vehicles.empty')} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {vehicles.data.map((v) => (
            <Link key={v.id} to={`/vehicles/${v.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-600">
              <div className="flex gap-4">
                <Photo table="vehicles" id={v.id} path={v.photo_path} group="vehicles" fallback="car" editable={false} />
                <div className="min-w-0">
                  <p className="text-lg font-semibold">{v.make} {v.model}</p>
                  <p className="text-sm text-slate-600">{[v.plate, v.year, v.odometer_km != null ? `${formatNumber(v.odometer_km, i18n.language, 0)} km` : null].filter(Boolean).join(' · ')}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {VEHICLE_DATE_FIELDS.filter((f) => v[f]).map((f) => (
                      <Badge key={f} tone={dateTone(v[f], today)}>{t(`vehicles.fields.${f}`)}: {formatDate(v[f], i18n.language, { day: 'numeric', month: 'short', year: '2-digit' })}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {editing && <VehicleEditor vehicle={null} onClose={() => setEditing(false)} />}
    </div>
  );
}

const optDate = z.string().optional();
const optNum = (max: number) => z.preprocess((v) => (v === '' || v == null ? undefined : Number(String(v).replace(',', '.'))), z.number({ invalid_type_error: 'validation.number' }).min(0, 'validation.positive').max(max, 'validation.max').optional());
const vehicleSchema = z.object({
  make: z.string().trim().min(1, 'validation.required').max(60, 'validation.tooLong'),
  model: z.string().max(60, 'validation.tooLong').optional(),
  year: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(1900, 'validation.min').max(2100, 'validation.max').optional()),
  plate: z.string().max(20, 'validation.tooLong').optional(),
  odometer_km: optNum(5_000_000),
  registration_date: optDate, registration_expires_on: optDate, insurance_company: z.string().max(100, 'validation.tooLong').optional(),
  insurance_policy: z.string().max(60, 'validation.tooLong').optional(), insurance_expires_on: optDate, inspection_due_on: optDate,
  tire_season: z.string().optional(), next_tire_change_on: optDate, next_service_on: optDate, next_service_km: optNum(5_000_000),
  notes: z.string().max(2000, 'validation.tooLong').optional(),
});
type VehicleForm = z.infer<typeof vehicleSchema>;

function VehicleEditor({ vehicle, onClose }: { vehicle: Vehicle | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { householdId } = useCurrentHousehold();
  const navigate = useNavigate();
  const blankToNull = (v: VehicleForm) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' || x === undefined ? null : x]));
  const form = useForm<VehicleForm>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: vehicle ? Object.fromEntries(Object.entries(vehicle).map(([k, x]) => [k, x ?? ''])) as unknown as VehicleForm : {},
  });
  const save = useAction(async (v: VehicleForm) => {
    const row = blankToNull(v);
    if (vehicle) return unwrap(await supabase.from('vehicles').update(row).eq('id', vehicle.id).select('id').single()) as { id: string };
    return unwrap(await supabase.from('vehicles').insert({ ...row, household_id: householdId }).select('id').single()) as { id: string };
  }, { groups: ['vehicles'], success: 'common.saved', onSuccess: (r) => { onClose(); if (!vehicle) navigate(`/vehicles/${r.id}`); } });
  const e = form.formState.errors;
  const date = (name: keyof VehicleForm, label: string) => (
    <Field label={label} htmlFor={`v-${name}`}><Input id={`v-${name}`} type="date" {...form.register(name)} /></Field>
  );
  return (
    <Modal open onClose={onClose} size="lg" title={vehicle ? t('vehicles.edit') : t('vehicles.new')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="veh-form" loading={save.isPending}>{t('common.save')}</Button></>}>
      <form id="veh-form" className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label={t('vehicles.fields.make')} htmlFor="v-make" error={e.make?.message}><Input id="v-make" {...form.register('make')} /></Field>
        <Field label={t('vehicles.fields.model')} htmlFor="v-model"><Input id="v-model" {...form.register('model')} /></Field>
        <Field label={t('vehicles.fields.plate')} htmlFor="v-plate" error={e.plate?.message}><Input id="v-plate" {...form.register('plate')} /></Field>
        <Field label={t('vehicles.fields.year')} htmlFor="v-year" error={e.year?.message}><Input id="v-year" type="number" {...form.register('year')} /></Field>
        <Field label={t('vehicles.fields.odometer_km')} htmlFor="v-odo" error={e.odometer_km?.message}><Input id="v-odo" inputMode="numeric" {...form.register('odometer_km')} /></Field>
        {date('registration_date', t('vehicles.fields.registration_date'))}
        {date('registration_expires_on', t('vehicles.fields.registration_expires_on'))}
        <Field label={t('vehicles.fields.insurance_company')} htmlFor="v-insco"><Input id="v-insco" {...form.register('insurance_company')} /></Field>
        <Field label={t('vehicles.fields.insurance_policy')} htmlFor="v-inspol"><Input id="v-inspol" {...form.register('insurance_policy')} /></Field>
        {date('insurance_expires_on', t('vehicles.fields.insurance_expires_on'))}
        {date('inspection_due_on', t('vehicles.fields.inspection_due_on'))}
        <Field label={t('vehicles.fields.tire_season')} htmlFor="v-tires">
          <Select id="v-tires" {...form.register('tire_season')}><option value="">—</option>{(['summer', 'winter', 'all_season'] as const).map((s) => <option key={s} value={s}>{t(`vehicles.tires.${s}`)}</option>)}</Select>
        </Field>
        {date('next_tire_change_on', t('vehicles.fields.next_tire_change_on'))}
        {date('next_service_on', t('vehicles.fields.next_service_on'))}
        <Field label={t('vehicles.fields.next_service_km')} htmlFor="v-skm" error={e.next_service_km?.message}><Input id="v-skm" inputMode="numeric" {...form.register('next_service_km')} /></Field>
        <Field label={t('vehicles.fields.notes')} htmlFor="v-notes" className="sm:col-span-2"><Textarea id="v-notes" rows={2} {...form.register('notes')} /></Field>
      </form>
    </Modal>
  );
}

function VehicleDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { today, memberName } = useCurrentHousehold();
  const { openNew } = useTaskEditor();
  const vehicles = useVehicles(true);
  const v = vehicles.data?.find((x) => x.id === id);
  const log = useMaintenance(id);
  const tasks = useOccurrences(`vehicle-${id}`, { from: addDays(today, -30), to: addDays(today, 365), statuses: ['planned', 'in_progress'] });
  const [editing, setEditing] = useState(false);
  const [entry, setEntry] = useState<VehicleMaintenance | 'new' | null>(null);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const archive = useAction(async (archived: boolean) => unwrap(await supabase.from('vehicles').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id!).select('id').single()),
    { groups: ['vehicles'], success: (_, a) => (a ? 'common.archivedOk' : 'tasks.restored'), onSuccess: () => setConfirm(null) });
  const remove = useAction(async () => unwrap(await supabase.from('vehicles').delete().eq('id', id!).select('id').single()),
    { groups: ['vehicles'], success: 'common.deleted', onSuccess: () => navigate('/vehicles') });
  if (vehicles.isLoading) return <LoadingState />;
  if (!v) return <EmptyState title={t('errors.not_found')}><Link to="/vehicles" className="text-brand-700 underline">{t('nav.vehicles')}</Link></EmptyState>;
  const entries = log.data ?? [];
  const consumption = fuelConsumption(entries);
  const costs = entries.filter((e) => e.cost).reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.currency]: (acc[e.currency] ?? 0) + Number(e.cost) }), {});
  const vehicleTasks = (tasks.data ?? []).filter((o) => o.vehicle_id === v.id);
  return (
    <div className="space-y-4">
      <Link to="/vehicles" className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600"><Icon name="chevronLeft" className="h-4 w-4" />{t('nav.vehicles')}</Link>
      <div className="flex flex-wrap items-start gap-4">
        <Photo table="vehicles" id={v.id} path={v.photo_path} group="vehicles" fallback="car" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{v.make} {v.model}</h1>
          <p className="text-slate-600">{[v.plate, v.year, v.odometer_km != null ? `${formatNumber(v.odometer_km, i18n.language, 0)} km` : null].filter(Boolean).join(' · ')}</p>
          {v.archived_at && <Badge tone="gray">{t('common.archived')}</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>{t('common.edit')}</Button>
          {v.archived_at ? <>
            <Button variant="secondary" icon="restore" onClick={() => archive.mutate(false)}>{t('common.restore')}</Button>
            <Button variant="danger" icon="trash" onClick={() => setConfirm('delete')}>{t('common.deletePermanently')}</Button>
          </> : <Button variant="ghost" icon="archive" onClick={() => setConfirm('archive')}>{t('common.archive')}</Button>}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('vehicles.obligations')}>
            <ul className="grid gap-2 sm:grid-cols-2">
              {VEHICLE_DATE_FIELDS.map((f) => (
                <li key={f} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span>{t(`vehicles.fields.${f}`)}</span>
                  {v[f] ? <Badge tone={dateTone(v[f], today)}>{formatDate(v[f], i18n.language)}</Badge> : <span className="text-slate-400">—</span>}
                </li>
              ))}
              <li className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span>{t('vehicles.fields.next_service_km')}</span>
                {v.next_service_km != null ? <Badge tone={v.odometer_km != null && v.odometer_km >= v.next_service_km - 1000 ? 'amber' : 'green'}>{formatNumber(v.next_service_km, i18n.language, 0)} km</Badge> : <span className="text-slate-400">—</span>}
              </li>
            </ul>
            {(v.insurance_company || v.tire_season) && <p className="mt-3 text-sm text-slate-600">{[v.insurance_company && `${t('vehicles.fields.insurance_company')}: ${v.insurance_company}${v.insurance_policy ? ` (${v.insurance_policy})` : ''}`, v.tire_season && `${t('vehicles.fields.tire_season')}: ${t(`vehicles.tires.${v.tire_season}`)}`].filter(Boolean).join(' · ')}</p>}
            {v.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{v.notes}</p>}
          </Card>
          <Card title={t('vehicles.log')} action={<Button size="sm" icon="plus" onClick={() => setEntry('new')}>{t('vehicles.addEntry')}</Button>}>
            {log.isLoading ? <LoadingState /> : entries.length ? (
              <ul className="divide-y divide-slate-100">
                {entries.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm" onClick={() => setEntry(e)}>
                      <span className="min-w-0">
                        <span className="font-medium">{t(`vehicles.kinds.${e.kind}`)}</span>{e.description ? ` · ${e.description}` : ''}
                        <span className="block text-xs text-slate-500">{formatDate(e.performed_on, i18n.language)}{e.odometer_km != null ? ` · ${formatNumber(e.odometer_km, i18n.language, 0)} km` : ''}{e.liters ? ` · ${formatNumber(Number(e.liters), i18n.language)} l` : ''} · {memberName(e.created_by)}</span>
                      </span>
                      {e.cost != null && <span className="shrink-0 font-semibold">{formatMoney(Number(e.cost), e.currency, i18n.language)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">{t('vehicles.noEntries')}</p>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={t('vehicles.stats')}>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt>{t('vehicles.consumption')}</dt><dd className="font-medium">{consumption != null ? `${formatNumber(consumption, i18n.language, 1)} l/100 km` : '—'}</dd></div>
              {Object.entries(costs).map(([cur, sum]) => <div key={cur} className="flex justify-between"><dt>{t('vehicles.totalCosts')}</dt><dd className="font-medium">{formatMoney(sum, cur, i18n.language)}</dd></div>)}
            </dl>
            <p className="mt-2 text-xs text-slate-500">{t('vehicles.consumptionHint')}</p>
          </Card>
          <Card title={t('vehicles.tasks')} action={<Button size="sm" variant="ghost" icon="plus" onClick={() => openNew({ category: 'vehicles', vehicle_id: v.id })}>{t('common.add')}</Button>}>
            <TaskList items={vehicleTasks} empty={t('vehicles.noTasks')} compact />
          </Card>
          <Attachments entityType="vehicle" entityId={v.id} />
        </div>
      </div>
      {editing && <VehicleEditor vehicle={v} onClose={() => setEditing(false)} />}
      {entry && <MaintenanceEditor vehicle={v} entry={entry === 'new' ? null : entry} onClose={() => setEntry(null)} />}
      <ConfirmDialog open={confirm === 'archive'} title={t('common.archive')} message={t('vehicles.archiveConfirm')} confirmLabel={t('common.archive')}
        loading={archive.isPending} onCancel={() => setConfirm(null)} onConfirm={() => archive.mutate(true)} />
      <ConfirmDialog open={confirm === 'delete'} title={t('common.deletePermanently')} message={t('vehicles.deleteConfirm')}
        loading={remove.isPending} onCancel={() => setConfirm(null)} onConfirm={() => remove.mutate(undefined)} />
    </div>
  );
}

const entrySchema = z.object({
  kind: z.enum(MAINTENANCE_KINDS),
  performed_on: z.string().min(1, 'validation.required'),
  odometer_km: optNum(5_000_000),
  description: z.string().max(2000, 'validation.tooLong').optional(),
  cost: optNum(100_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/, 'validation.currency'),
  liters: optNum(10_000),
  full_tank: z.boolean(),
});
type EntryForm = z.infer<typeof entrySchema>;

function MaintenanceEditor({ vehicle, entry, onClose }: { vehicle: Vehicle; entry: VehicleMaintenance | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { householdId, household, today } = useCurrentHousehold();
  const [confirm, setConfirm] = useState(false);
  const form = useForm<EntryForm>({
    resolver: zodResolver(entrySchema),
    defaultValues: entry ? {
      kind: entry.kind as EntryForm['kind'], performed_on: entry.performed_on, odometer_km: entry.odometer_km ?? undefined, description: entry.description ?? '',
      cost: entry.cost != null ? Number(entry.cost) : undefined, currency: entry.currency, liters: entry.liters != null ? Number(entry.liters) : undefined, full_tank: entry.full_tank,
    } : { kind: 'service', performed_on: today, currency: household.currency, full_tank: true, odometer_km: vehicle.odometer_km ?? undefined },
  });
  const kind = form.watch('kind');
  const save = useAction(async (v: EntryForm) => {
    const row = { ...v, odometer_km: v.odometer_km ?? null, cost: v.cost ?? null, liters: kind === 'fuel' ? v.liters ?? null : null, description: v.description || null };
    if (entry) return unwrap(await supabase.from('vehicle_maintenance').update(row).eq('id', entry.id).select('id').single());
    return unwrap(await supabase.from('vehicle_maintenance').insert({ ...row, household_id: householdId, vehicle_id: vehicle.id }).select('id').single());
  }, { groups: ['vehicles', 'budget'], success: 'common.saved', onSuccess: onClose });
  const remove = useAction(async () => unwrap(await supabase.from('vehicle_maintenance').delete().eq('id', entry!.id).select('id').single()),
    { groups: ['vehicles', 'budget'], success: 'common.deleted', onSuccess: onClose });
  const e = form.formState.errors;
  return (
    <Modal open onClose={onClose} size="lg" title={entry ? t('vehicles.editEntry') : t('vehicles.addEntry')}
      footer={<>
        {entry && <Button variant="ghost" icon="trash" className="mr-auto text-red-700" onClick={() => setConfirm(true)}>{t('common.delete')}</Button>}
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="entry-form" loading={save.isPending}>{t('common.save')}</Button>
      </>}>
      <form id="entry-form" className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label={t('vehicles.kind')} htmlFor="m-kind"><Select id="m-kind" {...form.register('kind')}>{MAINTENANCE_KINDS.map((k) => <option key={k} value={k}>{t(`vehicles.kinds.${k}`)}</option>)}</Select></Field>
        <Field label={t('budget.date')} htmlFor="m-date" error={e.performed_on?.message}><Input id="m-date" type="date" {...form.register('performed_on')} /></Field>
        <Field label={t('vehicles.fields.odometer_km')} htmlFor="m-km" error={e.odometer_km?.message}><Input id="m-km" inputMode="numeric" {...form.register('odometer_km')} /></Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label={t('vehicles.cost')} htmlFor="m-cost" error={e.cost?.message}><Input id="m-cost" inputMode="decimal" {...form.register('cost')} /></Field>
          <Field label={t('household.currency')} htmlFor="m-cur"><Select id="m-cur" {...form.register('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        </div>
        {kind === 'fuel' && <>
          <Field label={t('vehicles.liters')} htmlFor="m-l" error={e.liters?.message}><Input id="m-l" inputMode="decimal" {...form.register('liters')} /></Field>
          <div className="flex items-end"><Checkbox label={t('vehicles.fullTank')} {...form.register('full_tank')} /></div>
        </>}
        <Field label={t('vehicles.description')} htmlFor="m-desc" className="sm:col-span-2"><Textarea id="m-desc" rows={2} {...form.register('description')} /></Field>
      </form>
      {entry && <div className="mt-4"><Attachments entityType="vehicle_maintenance" entityId={entry.id} /></div>}
      <ConfirmDialog open={confirm} title={t('common.delete')} message={t('vehicles.deleteEntry')} loading={remove.isPending} onCancel={() => setConfirm(false)} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}
