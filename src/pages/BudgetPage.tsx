import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { unwrap, useAction } from '@/lib/hooks';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, Modal, PageHeader, Select, Tabs, Textarea } from '@/components/ui/ui';
import { Attachments } from '@/features/files/Attachments';
import { useBills, useBudgetEntries, useExpenses } from '@/features/budget/api';
import { addDays, addMonths, endOfMonth, formatDate, formatMoney, monthTitle, startOfMonth } from '@/lib/dates';
import { CURRENCIES } from '@/lib/options';
import { BILL_CATEGORIES, BILL_FREQUENCIES, EXPENSE_CATEGORIES, type Bill, type Expense } from '@/lib/types';

type View = 'bills' | 'expenses' | 'overview';
const money = (max = 100_000_000) => z.preprocess((v) => (v === '' || v == null ? undefined : Number(String(v).replace(',', '.'))),
  z.number({ required_error: 'validation.required', invalid_type_error: 'validation.number' }).min(0, 'validation.positive').max(max, 'validation.max'));

export default function BudgetPage() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('bills');
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.budget')} subtitle={t('budget.noBankNote')} />
      <Tabs value={view} onChange={setView} items={[
        { value: 'bills', label: t('budget.bills') }, { value: 'expenses', label: t('budget.expenses') }, { value: 'overview', label: t('budget.overview') },
      ]} />
      {view === 'bills' && <Bills />}
      {view === 'expenses' && <Expenses />}
      {view === 'overview' && <Overview />}
    </div>
  );
}

function Bills() {
  const { t, i18n } = useTranslation();
  const { today, memberName } = useCurrentHousehold();
  const unpaid = useBills({ status: 'unpaid' });
  const paid = useBills({ status: 'paid', limit: 30 });
  const [editing, setEditing] = useState<Bill | 'new' | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [unpaying, setUnpaying] = useState<Bill | null>(null);
  const unpay = useAction(async (b: Bill) => unwrap(await supabase.rpc('unpay_bill', { p_bill: b.id })), { groups: ['budget'], success: 'budget.unpaid', onSuccess: () => setUnpaying(null) });

  const row = (b: Bill) => {
    const overdue = b.status === 'unpaid' && b.due_date < today;
    const soon = b.status === 'unpaid' && !overdue && b.due_date <= addDays(today, b.remind_days_before);
    return (
      <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="bill-row">
        <button type="button" className="min-w-0 text-left" onClick={() => setEditing(b)}>
          <p className="font-medium hover:underline">{b.name} <span className="text-sm font-normal text-slate-500">· {t(`budget.categories.${b.category}`)}</span></p>
          <p className="text-xs text-slate-500">
            {b.status === 'paid'
              ? t('budget.paidBy', { name: memberName(b.paid_by), date: formatDate(b.paid_on, i18n.language) })
              : `${t('budget.due')} ${formatDate(b.due_date, i18n.language)}${b.responsible_id ? ' · ' + memberName(b.responsible_id) : ''}`}
            {b.frequency !== 'once' && ` · ${t(`budget.frequencies.${b.frequency}`)}`}
          </p>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-right">
            <span className="block font-semibold">{formatMoney(Number(b.status === 'paid' ? b.paid_amount : b.amount), b.currency, i18n.language)}</span>
            {b.status === 'paid' && b.paid_amount != null && Number(b.paid_amount) !== Number(b.amount) && <span className="block text-xs text-slate-500">{t('budget.planned')}: {formatMoney(Number(b.amount), b.currency, i18n.language)}</span>}
          </span>
          {overdue && <Badge tone="red">{t('status.overdue')}</Badge>}
          {soon && <Badge tone="amber">{t('budget.dueSoon')}</Badge>}
          {b.status === 'paid' ? <Badge tone="green">{t('budget.statusPaid')}</Badge> : null}
          {b.status === 'unpaid'
            ? <Button size="sm" icon="check" onClick={() => setPaying(b)}>{t('budget.markPaid')}</Button>
            : <Button size="sm" variant="ghost" onClick={() => setUnpaying(b)}>{t('budget.markUnpaid')}</Button>}
        </div>
      </li>
    );
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button icon="plus" onClick={() => setEditing('new')}>{t('budget.newBill')}</Button></div>
      <Card title={t('budget.unpaidBills')}>
        {unpaid.isLoading ? <LoadingState /> : unpaid.error ? <ErrorState error={unpaid.error} onRetry={() => void unpaid.refetch()} /> : unpaid.data?.length
          ? <ul className="divide-y divide-slate-100">{unpaid.data.map(row)}</ul> : <EmptyState icon="wallet" title={t('budget.noUnpaid')} />}
      </Card>
      <Card title={t('budget.paidBills')}>
        {paid.isLoading ? <LoadingState /> : paid.data?.length ? <ul className="divide-y divide-slate-100">{paid.data.map(row)}</ul> : <p className="text-sm text-slate-500">—</p>}
      </Card>
      {editing && <BillEditor bill={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {paying && <PayDialog bill={paying} onClose={() => setPaying(null)} />}
      <ConfirmDialog open={Boolean(unpaying)} title={t('budget.markUnpaid')} message={t('budget.unpayConfirm', { name: unpaying?.name })}
        loading={unpay.isPending} onCancel={() => setUnpaying(null)} onConfirm={() => unpaying && unpay.mutate(unpaying)} />
    </div>
  );
}

const billSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(120, 'validation.tooLong'),
  category: z.enum(BILL_CATEGORIES),
  amount: money(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'validation.currency'),
  due_date: z.string().min(1, 'validation.required'),
  frequency: z.enum(BILL_FREQUENCIES),
  responsible_id: z.string().optional(),
  remind_days_before: z.preprocess((v) => Number(v ?? 3), z.number().int().min(0, 'validation.min').max(60, 'validation.max')),
  notes: z.string().max(2000, 'validation.tooLong').optional(),
});
type BillForm = z.infer<typeof billSchema>;

function BillEditor({ bill, onClose }: { bill: Bill | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { householdId, household, activeMembers, today } = useCurrentHousehold();
  const [confirm, setConfirm] = useState(false);
  const form = useForm<BillForm>({
    resolver: zodResolver(billSchema),
    defaultValues: bill ? {
      name: bill.name, category: bill.category as BillForm['category'], amount: Number(bill.amount), currency: bill.currency, due_date: bill.due_date,
      frequency: bill.frequency as BillForm['frequency'], responsible_id: bill.responsible_id ?? '', remind_days_before: bill.remind_days_before, notes: bill.notes ?? '',
    } : { category: 'electricity', currency: household.currency, due_date: today, frequency: 'monthly', remind_days_before: 3 },
  });
  const save = useAction(async (v: BillForm) => {
    const row = { ...v, responsible_id: v.responsible_id || null, notes: v.notes || null };
    if (bill) return unwrap(await supabase.from('bills').update(row).eq('id', bill.id).select('id').single());
    return unwrap(await supabase.from('bills').insert({ ...row, household_id: householdId }).select('id').single());
  }, { groups: ['budget'], success: 'common.saved', onSuccess: onClose });
  const archive = useAction(async () => unwrap(await supabase.from('bills').update({ archived_at: new Date().toISOString() }).eq('id', bill!.id).select('id').single()),
    { groups: ['budget'], success: 'common.archivedOk', onSuccess: onClose });
  const e = form.formState.errors;
  return (
    <Modal open onClose={onClose} size="lg" title={bill ? t('budget.editBill') : t('budget.newBill')}
      footer={<>
        {bill && <Button variant="ghost" icon="archive" className="mr-auto" onClick={() => setConfirm(true)}>{t('common.archive')}</Button>}
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="bill-form" loading={save.isPending}>{t('common.save')}</Button>
      </>}>
      <form id="bill-form" className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label={t('budget.name')} htmlFor="b-name" error={e.name?.message} className="sm:col-span-2"><Input id="b-name" {...form.register('name')} /></Field>
        <Field label={t('budget.category')} htmlFor="b-cat"><Select id="b-cat" {...form.register('category')}>{BILL_CATEGORIES.map((c) => <option key={c} value={c}>{t(`budget.categories.${c}`)}</option>)}</Select></Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label={t('budget.amount')} htmlFor="b-amount" error={e.amount?.message}><Input id="b-amount" inputMode="decimal" {...form.register('amount')} /></Field>
          <Field label={t('household.currency')} htmlFor="b-cur" error={e.currency?.message}><Select id="b-cur" {...form.register('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        </div>
        <Field label={t('budget.dueDate')} htmlFor="b-due" error={e.due_date?.message}><Input id="b-due" type="date" {...form.register('due_date')} /></Field>
        <Field label={t('budget.frequency')} htmlFor="b-freq"><Select id="b-freq" {...form.register('frequency')}>{BILL_FREQUENCIES.map((f) => <option key={f} value={f}>{t(`budget.frequencies.${f}`)}</option>)}</Select></Field>
        <Field label={t('budget.responsible')} htmlFor="b-resp"><Select id="b-resp" {...form.register('responsible_id')}><option value="">{t('budget.everyone')}</option>{activeMembers.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</Select></Field>
        <Field label={t('budget.remindDays')} htmlFor="b-remind" error={e.remind_days_before?.message}><Input id="b-remind" type="number" min={0} max={60} {...form.register('remind_days_before')} /></Field>
        <Field label={t('budget.notes')} htmlFor="b-notes" className="sm:col-span-2"><Textarea id="b-notes" rows={2} {...form.register('notes')} /></Field>
      </form>
      {bill && <div className="mt-4"><Attachments entityType="bill" entityId={bill.id} /></div>}
      <ConfirmDialog open={confirm} title={t('common.archive')} message={t('budget.archiveBill', { name: bill?.name })} confirmLabel={t('common.archive')}
        loading={archive.isPending} onCancel={() => setConfirm(false)} onConfirm={() => archive.mutate(undefined)} />
    </Modal>
  );
}

function PayDialog({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const { t } = useTranslation();
  const { today } = useCurrentHousehold();
  const [amount, setAmount] = useState(String(bill.amount));
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const pay = useAction(async () => unwrap(await supabase.rpc('pay_bill', { p_bill: bill.id, p_paid_amount: Number(amount.replace(',', '.')), p_paid_on: date })),
    { groups: ['budget', 'notifications'], success: 'budget.paid', onSuccess: onClose });
  const submit = () => {
    const n = Number(amount.replace(',', '.'));
    if (!amount.trim() || Number.isNaN(n) || n < 0) return setError('validation.number');
    if (!date) return setError('validation.required');
    setError(null);
    pay.mutate(undefined);
  };
  return (
    <Modal open onClose={onClose} title={t('budget.payTitle', { name: bill.name })}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button icon="check" loading={pay.isPending} onClick={submit}>{t('budget.markPaid')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('budget.paidAmount')} htmlFor="pay-amount" hint={bill.currency}><Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={t('budget.paidOn')} htmlFor="pay-date"><Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {error && <p role="alert" className="text-sm text-red-600">{t(error)}</p>}
        <p className="text-xs text-slate-500">{t('budget.payNote')}</p>
      </div>
    </Modal>
  );
}

const expenseSchema = z.object({
  description: z.string().trim().min(1, 'validation.required').max(200, 'validation.tooLong'),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: money().refine((v) => v > 0, 'validation.positive'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'validation.currency'),
  spent_on: z.string().min(1, 'validation.required'),
  kind: z.enum(['planned', 'actual']),
  paid_by: z.string().optional(),
  notes: z.string().max(2000, 'validation.tooLong').optional(),
});
type ExpenseForm = z.infer<typeof expenseSchema>;

function Expenses() {
  const { t, i18n } = useTranslation();
  const { today, memberName } = useCurrentHousehold();
  const [month, setMonth] = useState(startOfMonth(today));
  const list = useExpenses(month, endOfMonth(month));
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton icon="chevronLeft" label={t('calendar.previous')} onClick={() => setMonth(addMonths(month, -1))} />
          <span className="min-w-36 text-center font-medium capitalize">{monthTitle(month, i18n.language)}</span>
          <IconButton icon="chevronRight" label={t('calendar.next')} onClick={() => setMonth(addMonths(month, 1))} />
        </div>
        <Button icon="plus" onClick={() => setEditing('new')}>{t('budget.newExpense')}</Button>
      </div>
      <Card>
        {list.isLoading ? <LoadingState /> : list.error ? <ErrorState error={list.error} /> : list.data?.length ? (
          <ul className="divide-y divide-slate-100">
            {list.data.map((x) => (
              <li key={x.id}>
                <button type="button" className="flex w-full items-center justify-between gap-2 py-2 text-left" onClick={() => setEditing(x)}>
                  <span className="min-w-0">
                    <span className="block font-medium">{x.description}</span>
                    <span className="block text-xs text-slate-500">{formatDate(x.spent_on, i18n.language)} · {t(`budget.categories.${x.category}`)}{x.paid_by ? ` · ${memberName(x.paid_by)}` : ''}</span>
                  </span>
                  <span className="flex items-center gap-2">{x.kind === 'planned' && <Badge tone="blue">{t('budget.planned')}</Badge>}<span className="font-semibold">{formatMoney(Number(x.amount), x.currency, i18n.language)}</span></span>
                </button>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon="wallet" title={t('budget.noExpenses')} />}
      </Card>
      {editing && <ExpenseEditor expense={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ExpenseEditor({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { householdId, household, activeMembers, today } = useCurrentHousehold();
  const [confirm, setConfirm] = useState(false);
  const form = useForm<ExpenseForm>({
    resolver: zodResolver(expenseSchema),
    defaultValues: expense ? {
      description: expense.description, category: expense.category as ExpenseForm['category'], amount: Number(expense.amount), currency: expense.currency,
      spent_on: expense.spent_on, kind: expense.kind, paid_by: expense.paid_by ?? '', notes: expense.notes ?? '',
    } : { category: 'household', currency: household.currency, spent_on: today, kind: 'actual' },
  });
  const save = useAction(async (v: ExpenseForm) => {
    const row = { ...v, paid_by: v.paid_by || null, notes: v.notes || null };
    if (expense) return unwrap(await supabase.from('expenses').update(row).eq('id', expense.id).select('id').single());
    return unwrap(await supabase.from('expenses').insert({ ...row, household_id: householdId }).select('id').single());
  }, { groups: ['budget'], success: 'common.saved', onSuccess: onClose });
  const remove = useAction(async () => {
    unwrap(await supabase.from('expenses').update({ archived_at: new Date().toISOString() }).eq('id', expense!.id).select('id').single());
    unwrap(await supabase.from('expenses').delete().eq('id', expense!.id).select('id').single());
  }, { groups: ['budget'], success: 'common.deleted', onSuccess: onClose });
  const e = form.formState.errors;
  return (
    <Modal open onClose={onClose} size="lg" title={expense ? t('budget.editExpense') : t('budget.newExpense')}
      footer={<>
        {expense && <Button variant="ghost" icon="trash" className="mr-auto text-red-700" onClick={() => setConfirm(true)}>{t('common.delete')}</Button>}
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="exp-form" loading={save.isPending}>{t('common.save')}</Button>
      </>}>
      <form id="exp-form" className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label={t('budget.description')} htmlFor="e-desc" error={e.description?.message} className="sm:col-span-2"><Input id="e-desc" {...form.register('description')} /></Field>
        <Field label={t('budget.category')} htmlFor="e-cat"><Select id="e-cat" {...form.register('category')}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`budget.categories.${c}`)}</option>)}</Select></Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label={t('budget.amount')} htmlFor="e-amount" error={e.amount?.message}><Input id="e-amount" inputMode="decimal" {...form.register('amount')} /></Field>
          <Field label={t('household.currency')} htmlFor="e-cur"><Select id="e-cur" {...form.register('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        </div>
        <Field label={t('budget.date')} htmlFor="e-date" error={e.spent_on?.message}><Input id="e-date" type="date" {...form.register('spent_on')} /></Field>
        <Field label={t('budget.kind')} htmlFor="e-kind"><Select id="e-kind" {...form.register('kind')}><option value="actual">{t('budget.actual')}</option><option value="planned">{t('budget.planned')}</option></Select></Field>
        <Field label={t('budget.paidByLabel')} htmlFor="e-paid"><Select id="e-paid" {...form.register('paid_by')}><option value="">—</option>{activeMembers.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</Select></Field>
        <Field label={t('budget.notes')} htmlFor="e-notes" className="sm:col-span-2"><Textarea id="e-notes" rows={2} {...form.register('notes')} /></Field>
      </form>
      {expense && <div className="mt-4"><Attachments entityType="expense" entityId={expense.id} /></div>}
      <ConfirmDialog open={confirm} title={t('common.delete')} message={t('budget.deleteExpense', { name: expense?.description })}
        loading={remove.isPending} onCancel={() => setConfirm(false)} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}

function Overview() {
  const { t, i18n } = useTranslation();
  const { today, memberName } = useCurrentHousehold();
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [cursor, setCursor] = useState(startOfMonth(today));
  const from = mode === 'month' ? cursor : `${cursor.slice(0, 4)}-01-01`;
  const to = mode === 'month' ? endOfMonth(cursor) : `${cursor.slice(0, 4)}-12-31`;
  const entries = useBudgetEntries(from, to);
  const data = entries.data ?? [];
  const currencies = [...new Set(data.map((d) => d.currency))].sort();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton icon="chevronLeft" label={t('calendar.previous')} onClick={() => setCursor(addMonths(cursor, mode === 'month' ? -1 : -12))} />
          <span className="min-w-36 text-center font-medium capitalize">{mode === 'month' ? monthTitle(cursor, i18n.language) : cursor.slice(0, 4)}</span>
          <IconButton icon="chevronRight" label={t('calendar.next')} onClick={() => setCursor(addMonths(cursor, mode === 'month' ? 1 : 12))} />
        </div>
        <Tabs value={mode} onChange={setMode} items={[{ value: 'month', label: t('budget.monthly') }, { value: 'year', label: t('budget.yearly') }]} />
      </div>
      {entries.isLoading ? <LoadingState /> : entries.error ? <ErrorState error={entries.error} /> : !data.length ? <EmptyState icon="wallet" title={t('budget.noData')} /> : currencies.map((cur) => {
        const rows = data.filter((d) => d.currency === cur);
        const cats = [...new Set(rows.map((r) => r.category))];
        const sum = (kind: string, cat?: string) => rows.filter((r) => r.kind === kind && (!cat || r.category === cat)).reduce((s, r) => s + Number(r.amount), 0);
        const totalActual = sum('actual');
        const totalPlanned = sum('planned');
        const max = Math.max(...cats.map((c) => Math.max(sum('actual', c), sum('planned', c))), 1);
        const payers = [...new Set(rows.filter((r) => r.kind === 'actual' && r.paid_by).map((r) => r.paid_by!))];
        return (
          <Card key={cur} title={`${t('budget.totals')} · ${cur}`}>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{t('budget.actual')}</p><p className="text-xl font-bold" data-testid="total-actual">{formatMoney(totalActual, cur, i18n.language)}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{t('budget.planned')}</p><p className="text-xl font-bold">{formatMoney(totalPlanned, cur, i18n.language)}</p></div>
            </div>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('budget.byCategory')}</caption>
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium">{t('budget.category')}</th><th className="py-1 text-right font-medium">{t('budget.actual')}</th><th className="py-1 text-right font-medium">{t('budget.planned')}</th></tr></thead>
              <tbody>
                {cats.sort((a, b) => sum('actual', b) - sum('actual', a)).map((c) => (
                  <tr key={c} className="border-t border-slate-100">
                    <td className="py-2 pr-2">
                      {t(`budget.categories.${c}`)}
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${(sum('actual', c) / max) * 100}%` }} /></div>
                    </td>
                    <td className="py-2 text-right font-medium">{formatMoney(sum('actual', c), cur, i18n.language)}</td>
                    <td className="py-2 text-right text-slate-600">{formatMoney(sum('planned', c), cur, i18n.language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {payers.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-medium uppercase text-slate-500">{t('budget.byMember')}</p>
                <ul className="space-y-1 text-sm">{payers.map((p) => <li key={p} className="flex justify-between"><span>{memberName(p)}</span><span>{formatMoney(rows.filter((r) => r.kind === 'actual' && r.paid_by === p).reduce((s, r) => s + Number(r.amount), 0), cur, i18n.language)}</span></li>)}</ul>
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500">{t('budget.overviewNote')}</p>
          </Card>
        );
      })}
    </div>
  );
}
