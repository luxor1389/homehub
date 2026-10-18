import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { unwrap, useAction } from '@/lib/hooks';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Tabs, cx } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { nearDuplicates, usePantry, useShoppingItems, useShoppingLists } from '@/features/shopping/api';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/dates';
import { SHOP_CATEGORIES, UNITS, type PantryItem, type ShoppingItem } from '@/lib/types';

type View = 'list' | 'history' | 'pantry';

const qty = z.preprocess((v) => (v === '' || v == null ? undefined : Number(String(v).replace(',', '.'))),
  z.number({ invalid_type_error: 'validation.number' }).positive('validation.positive').max(100000, 'validation.max').optional());
const itemSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(80, 'validation.tooLong'),
  quantity: qty,
  unit: z.string().optional(),
  category: z.enum(SHOP_CATEGORIES),
  priority: z.enum(['low', 'normal', 'high']),
  note: z.string().max(500, 'validation.tooLong').optional(),
});
type ItemForm = z.infer<typeof itemSchema>;

export function itemQty(i: Pick<ShoppingItem, 'quantity' | 'unit'>, t: (k: string) => string, locale: string) {
  return `${formatNumber(Number(i.quantity), locale, 3)}${i.unit ? ' ' + t(`units.${i.unit}`) : ''}`;
}

export default function ShoppingPage() {
  const { t } = useTranslation();
  const lists = useShoppingLists();
  const [listId, setListId] = useState<string | null>(null);
  const [view, setView] = useState<View>('list');
  const [newList, setNewList] = useState(false);
  const current = (lists.data ?? []).find((l) => l.id === listId) ?? lists.data?.[0];
  if (lists.isLoading) return <LoadingState />;
  if (lists.error) return <ErrorState error={lists.error} onRetry={() => void lists.refetch()} />;
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.shopping')} actions={
        <div className="flex gap-2">
          {(lists.data?.length ?? 0) > 1 && (
            <Select aria-label={t('shopping.list')} className="w-auto" value={current?.id} onChange={(e) => setListId(e.target.value)}>
              {lists.data!.map((l) => <option key={l.id} value={l.id}>{l.name ?? t('shopping.defaultList')}</option>)}
            </Select>
          )}
          <Button variant="secondary" icon="plus" onClick={() => setNewList(true)}>{t('shopping.newList')}</Button>
        </div>
      } />
      <Tabs value={view} onChange={setView} items={[
        { value: 'list', label: t('shopping.toBuy') }, { value: 'history', label: t('shopping.history') }, { value: 'pantry', label: t('shopping.pantry') },
      ]} />
      {current && view === 'list' && <ActiveList listId={current.id} />}
      {current && view === 'history' && <History listId={current.id} />}
      {view === 'pantry' && current && <Pantry listId={current.id} />}
      <NewListModal open={newList} onClose={() => setNewList(false)} onCreated={(id) => setListId(id)} />
    </div>
  );
}

function NewListModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const { householdId } = useCurrentHousehold();
  const [name, setName] = useState('');
  const create = useAction(async () => unwrap(await supabase.from('shopping_lists').insert({ household_id: householdId, name: name.trim() }).select('id').single()) as { id: string },
    { groups: ['shopping'], success: 'shopping.listCreated', onSuccess: (r) => { onCreated(r.id); setName(''); onClose(); } });
  return (
    <Modal open={open} onClose={onClose} title={t('shopping.newList')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate(undefined)}>{t('common.save')}</Button></>}>
      <Field label={t('shopping.listName')} htmlFor="list-name"><Input id="list-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
    </Modal>
  );
}

function ActiveList({ listId }: { listId: string }) {
  const { t, i18n } = useTranslation();
  const { memberName } = useCurrentHousehold();
  const items = useShoppingItems(listId, 'needed');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<ShoppingItem | null>(null);
  const dupes = useMemo(() => nearDuplicates(items.data ?? []), [items.data]);

  const buy = useAction(async (item: ShoppingItem) => unwrap(await supabase.from('shopping_items').update({ status: 'purchased' }).eq('id', item.id).select('id').single()),
    { groups: ['shopping'], success: 'shopping.bought' });
  const remove = useAction(async (id: string) => unwrap(await supabase.from('shopping_items').delete().eq('id', id).select('id').single()),
    { groups: ['shopping'], success: 'common.deleted', onSuccess: () => setToDelete(null) });
  const merge = useAction(async (ids: string[]) => unwrap(await supabase.rpc('merge_shopping_items', { p_target: ids[0], p_sources: ids.slice(1) })),
    { groups: ['shopping'], success: 'shopping.merged', onSuccess: () => setSelected(new Set()) });

  const visible = (items.data ?? []).filter((i) => !category || i.category === category);
  const grouped = SHOP_CATEGORIES.map((c) => ({ c, list: visible.filter((i) => i.category === c) })).filter((g) => g.list.length);
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      <AddItemForm listId={listId} />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('filters.category')}>
        <button type="button" aria-pressed={!category} onClick={() => setCategory('')} className={cx('min-h-9 rounded-full border px-3 text-sm', !category ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white')}>{t('filters.allCategories')}</button>
        {SHOP_CATEGORIES.map((c) => (
          <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(category === c ? '' : c)}
            className={cx('min-h-9 rounded-full border px-3 text-sm', category === c ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white')}>{t(`shopping.categories.${c}`)}</button>
        ))}
      </div>
      {selected.size >= 2 && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-brand-50 p-3 text-sm">
          <span>{t('shopping.selected', { count: selected.size })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t('common.cancel')}</Button>
            <Button size="sm" icon="merge" loading={merge.isPending} onClick={() => merge.mutate([...selected])}>{t('shopping.merge')}</Button>
          </div>
        </div>
      )}
      {items.isLoading ? <LoadingState /> : items.error ? <ErrorState error={items.error} onRetry={() => void items.refetch()} /> : !visible.length ? (
        <EmptyState icon="cart" title={t('shopping.empty')} />
      ) : grouped.map(({ c, list }) => (
        <Card key={c} title={t(`shopping.categories.${c}`)}>
          <ul className="divide-y divide-slate-100">
            {list.map((i) => (
              <li key={i.id} className="flex items-center gap-2 py-1.5" data-testid="shopping-item">
                <button type="button" aria-label={t('shopping.markBought', { name: i.name })} disabled={buy.isPending} onClick={() => buy.mutate(i)}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 text-transparent hover:border-green-600 hover:text-green-600">
                  <Icon name="check" className="h-5 w-5" />
                </button>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(i)}>
                  <span className="font-medium">{i.name}</span> <span className="text-sm text-slate-600">· {itemQty(i, t, i18n.language)}</span>
                  {i.priority === 'high' && <Badge tone="amber" className="ml-1">{t('priority.high')}</Badge>}
                  {dupes.has(i.id) && <Badge tone="purple" className="ml-1">{t('shopping.possibleDuplicate')}</Badge>}
                  {i.note && <span className="block truncate text-xs text-slate-500">{i.note}</span>}
                  <span className="block text-xs text-slate-400">{t('shopping.addedBy', { name: memberName(i.created_by) })}</span>
                </button>
                <input type="checkbox" aria-label={t('shopping.selectForMerge', { name: i.name })} className="h-5 w-5" checked={selected.has(i.id)} onChange={() => toggleSel(i.id)} />
                <button type="button" aria-label={t('common.delete')} className="h-10 w-10 shrink-0 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-600" onClick={() => setToDelete(i)}>
                  <Icon name="trash" className="mx-auto h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {(items.data?.length ?? 0) > 1 && <p className="text-xs text-slate-500">{t('shopping.mergeHint')}</p>}
      {editing && <EditItemModal item={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={Boolean(toDelete)} title={t('common.delete')} message={t('shopping.deleteConfirm', { name: toDelete?.name })}
        loading={remove.isPending} onCancel={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.id)} />
    </div>
  );
}

function AddItemForm({ listId }: { listId: string }) {
  const { t } = useTranslation();
  const [more, setMore] = useState(false);
  const [duplicate, setDuplicate] = useState<ItemForm | null>(null);
  const form = useForm<ItemForm>({ resolver: zodResolver(itemSchema), defaultValues: { category: 'food', priority: 'normal' } });
  const add = useAction(async ({ v, onDuplicate }: { v: ItemForm; onDuplicate: 'error' | 'increment' }) => unwrap(await supabase.rpc('add_shopping_item', {
    p_list: listId, p_name: v.name, p_quantity: v.quantity ?? 1, p_unit: v.unit || null, p_category: v.category,
    p_priority: v.priority, p_note: v.note || null, p_on_duplicate: onDuplicate,
  })) as { action: string }, {
    groups: ['shopping'], silentError: true,
    success: (r) => (r.action === 'incremented' ? 'shopping.incremented' : 'shopping.added'),
    onSuccess: () => { form.reset({ category: form.getValues('category'), priority: 'normal', name: '', quantity: undefined, unit: '', note: '' }); setDuplicate(null); },
  });
  const submit = form.handleSubmit((v) => add.mutate({ v, onDuplicate: 'error' }, {
    onError: (e) => { if ((e as { message?: string }).message === 'duplicate_item') setDuplicate(v); },
  }));
  const e = form.formState.errors;
  return (
    <Card>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid grid-cols-[1fr_5rem] gap-2 sm:grid-cols-[1fr_6rem_8rem_auto]">
          <Field label={t('shopping.item')} htmlFor="item-name" error={e.name?.message}><Input id="item-name" placeholder={t('shopping.itemPlaceholder')} {...form.register('name')} /></Field>
          <Field label={t('shopping.quantity')} htmlFor="item-qty" error={e.quantity?.message}><Input id="item-qty" inputMode="decimal" placeholder="1" {...form.register('quantity')} /></Field>
          <Field label={t('shopping.unit')} htmlFor="item-unit" className="col-span-1">
            <Select id="item-unit" {...form.register('unit')}>
              <option value="">—</option>
              {UNITS.map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
            </Select>
          </Field>
          <div className="flex items-end"><Button type="submit" icon="plus" className="w-full" loading={add.isPending}>{t('common.add')}</Button></div>
        </div>
        <ServerError error={add.error} ignore="duplicate_item" />
        {more ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label={t('shopping.category')} htmlFor="item-cat">
              <Select id="item-cat" {...form.register('category')}>{SHOP_CATEGORIES.map((c) => <option key={c} value={c}>{t(`shopping.categories.${c}`)}</option>)}</Select>
            </Field>
            <Field label={t('tasks.fields.priority')} htmlFor="item-pri">
              <Select id="item-pri" {...form.register('priority')}>{(['low', 'normal', 'high'] as const).map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}</Select>
            </Field>
            <Field label={t('shopping.note')} htmlFor="item-note" error={e.note?.message}><Input id="item-note" {...form.register('note')} /></Field>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label={t('shopping.category')} className="w-auto" {...form.register('category')}>{SHOP_CATEGORIES.map((c) => <option key={c} value={c}>{t(`shopping.categories.${c}`)}</option>)}</Select>
            <Button variant="ghost" size="sm" onClick={() => setMore(true)}>{t('shopping.moreOptions')}</Button>
          </div>
        )}
      </form>
      <ConfirmDialog open={Boolean(duplicate)} danger={false} title={t('shopping.duplicateTitle')}
        message={t('shopping.duplicateMessage', { name: duplicate?.name })} confirmLabel={t('shopping.increase')}
        loading={add.isPending} onCancel={() => setDuplicate(null)} onConfirm={() => duplicate && add.mutate({ v: duplicate, onDuplicate: 'increment' })} />
    </Card>
  );
}

function ServerError({ error, ignore }: { error: unknown; ignore?: string }) {
  if (!error || (error as { message?: string }).message === ignore) return null;
  return <ErrorState error={error} />;
}

function EditItemModal({ item, onClose }: { item: ShoppingItem; onClose: () => void }) {
  const { t } = useTranslation();
  const form = useForm<ItemForm>({
    resolver: zodResolver(itemSchema),
    defaultValues: { name: item.name, quantity: Number(item.quantity), unit: item.unit ?? '', category: item.category, priority: item.priority, note: item.note ?? '' },
  });
  const save = useAction(async (v: ItemForm) => unwrap(await supabase.from('shopping_items').update({
    name: v.name, quantity: v.quantity ?? 1, unit: v.unit || null, category: v.category, priority: v.priority, note: v.note || null,
  }).eq('id', item.id).select('id').single()), { groups: ['shopping'], success: 'common.saved', onSuccess: onClose });
  const e = form.formState.errors;
  return (
    <Modal open onClose={onClose} title={t('shopping.editItem')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="edit-item" loading={save.isPending}>{t('common.save')}</Button></>}>
      <form id="edit-item" className="grid gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label={t('shopping.item')} htmlFor="ei-name" error={e.name?.message} className="sm:col-span-2"><Input id="ei-name" {...form.register('name')} /></Field>
        <Field label={t('shopping.quantity')} htmlFor="ei-qty" error={e.quantity?.message}><Input id="ei-qty" inputMode="decimal" {...form.register('quantity')} /></Field>
        <Field label={t('shopping.unit')} htmlFor="ei-unit"><Select id="ei-unit" {...form.register('unit')}><option value="">—</option>{UNITS.map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}</Select></Field>
        <Field label={t('shopping.category')} htmlFor="ei-cat"><Select id="ei-cat" {...form.register('category')}>{SHOP_CATEGORIES.map((c) => <option key={c} value={c}>{t(`shopping.categories.${c}`)}</option>)}</Select></Field>
        <Field label={t('tasks.fields.priority')} htmlFor="ei-pri"><Select id="ei-pri" {...form.register('priority')}>{(['low', 'normal', 'high'] as const).map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}</Select></Field>
        <Field label={t('shopping.note')} htmlFor="ei-note" error={e.note?.message} className="sm:col-span-2"><Input id="ei-note" {...form.register('note')} /></Field>
      </form>
    </Modal>
  );
}

function History({ listId }: { listId: string }) {
  const { t, i18n } = useTranslation();
  const { memberName, household } = useCurrentHousehold();
  const items = useShoppingItems(listId, 'purchased', 200);
  const [price, setPrice] = useState<{ id: string; value: string } | null>(null);
  const savePrice = useAction(async (p: { id: string; value: string }) => {
    const n = p.value.trim() === '' ? null : Number(p.value.replace(',', '.'));
    if (n != null && (Number.isNaN(n) || n < 0)) throw { code: '23514' };
    return unwrap(await supabase.from('shopping_items').update({ price: n }).eq('id', p.id).select('id').single());
  }, { groups: ['shopping', 'budget'], success: 'common.saved', onSuccess: () => setPrice(null) });
  const readd = useAction(async (i: ShoppingItem) => unwrap(await supabase.rpc('add_shopping_item', {
    p_list: listId, p_name: i.name, p_quantity: i.quantity, p_unit: i.unit, p_category: i.category, p_on_duplicate: 'increment',
  })), { groups: ['shopping'], success: 'shopping.added' });
  if (items.isLoading) return <LoadingState />;
  if (items.error) return <ErrorState error={items.error} onRetry={() => void items.refetch()} />;
  if (!items.data?.length) return <EmptyState icon="history" title={t('shopping.noHistory')} />;
  return (
    <Card>
      <ul className="divide-y divide-slate-100">
        {items.data.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{i.name} <span className="font-normal text-slate-600">· {itemQty(i, t, i18n.language)}</span></p>
              <p className="text-xs text-slate-500">{t('shopping.boughtBy', { name: memberName(i.purchased_by), date: formatDateTime(i.purchased_at, i18n.language, household.timezone) })}</p>
            </div>
            <div className="flex items-center gap-2">
              {price?.id === i.id ? (
                <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); savePrice.mutate(price); }}>
                  <Input aria-label={t('shopping.price')} inputMode="decimal" className="w-28" value={price.value} onChange={(e) => setPrice({ ...price, value: e.target.value })} />
                  <Button type="submit" size="sm" loading={savePrice.isPending}>{t('common.save')}</Button>
                </form>
              ) : (
                <button type="button" className="min-h-9 rounded-lg px-2 text-slate-700 underline decoration-dotted" onClick={() => setPrice({ id: i.id, value: i.price != null ? String(i.price) : '' })}>
                  {i.price != null ? formatMoney(Number(i.price), i.currency, i18n.language) : t('shopping.addPrice')}
                </button>
              )}
              <Button size="sm" variant="ghost" icon="restore" loading={readd.isPending} onClick={() => readd.mutate(i)}>{t('shopping.buyAgain')}</Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Pantry({ listId }: { listId: string }) {
  const { t, i18n } = useTranslation();
  const { householdId } = useCurrentHousehold();
  const pantry = usePantry();
  const [name, setName] = useState('');
  const [minQ, setMinQ] = useState('');
  const [unit, setUnit] = useState('');
  const add = useAction(async () => unwrap(await supabase.from('pantry_items').insert({
    household_id: householdId, name: name.trim(), quantity: 0, min_quantity: minQ ? Number(minQ.replace(',', '.')) : null, unit: unit || null,
  })), { groups: ['shopping'], success: 'shopping.pantryAdded', onSuccess: () => { setName(''); setMinQ(''); } });
  const adjust = useAction(async ({ p, delta }: { p: PantryItem; delta: number }) => unwrap(await supabase.from('pantry_items')
    .update({ quantity: Math.max(0, Number(p.quantity) + delta) }).eq('id', p.id).select('id').single()), { groups: ['shopping'] });
  const remove = useAction(async (id: string) => unwrap(await supabase.from('pantry_items').delete().eq('id', id)), { groups: ['shopping'], success: 'common.deleted' });
  const toList = useAction(async (p: PantryItem) => unwrap(await supabase.rpc('add_shopping_item', {
    p_list: listId, p_name: p.name, p_quantity: Math.max(1, Number(p.min_quantity ?? 1) - Number(p.quantity)), p_unit: p.unit, p_category: p.category, p_on_duplicate: 'increment',
  })), { groups: ['shopping'], success: 'shopping.added' });
  return (
    <Card title={t('shopping.pantry')}>
      <p className="mb-3 text-sm text-slate-600">{t('shopping.pantryHint')}</p>
      {pantry.isLoading ? <LoadingState /> : (
        <ul className="mb-4 divide-y divide-slate-100">
          {(pantry.data ?? []).map((p) => {
            const low = p.min_quantity != null && Number(p.quantity) < Number(p.min_quantity);
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{p.name}</span> · {formatNumber(Number(p.quantity), i18n.language)}{p.unit ? ' ' + t(`units.${p.unit}`) : ''}
                  {p.min_quantity != null && <span className="text-xs text-slate-500"> ({t('shopping.min')} {formatNumber(Number(p.min_quantity), i18n.language)})</span>}
                  {low && <Badge tone="amber" className="ml-1">{t('shopping.low')}</Badge>}
                </span>
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="secondary" aria-label={t('shopping.decrease')} onClick={() => adjust.mutate({ p, delta: -1 })}>−</Button>
                  <Button size="sm" variant="secondary" aria-label={t('shopping.increase')} onClick={() => adjust.mutate({ p, delta: 1 })}>+</Button>
                  {low && <Button size="sm" icon="cart" onClick={() => toList.mutate(p)}>{t('shopping.addToList')}</Button>}
                  <button type="button" aria-label={t('common.delete')} className="h-9 w-9 rounded-lg text-slate-400 hover:text-red-600" onClick={() => remove.mutate(p.id)}><Icon name="trash" className="mx-auto h-4 w-4" /></button>
                </span>
              </li>
            );
          })}
          {!pantry.data?.length && <li className="py-2 text-sm text-slate-500">{t('shopping.pantryEmpty')}</li>}
        </ul>
      )}
      <form className="grid gap-2 sm:grid-cols-[1fr_7rem_7rem_auto]" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(undefined); }}>
        <Input aria-label={t('shopping.item')} placeholder={t('shopping.item')} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <Input aria-label={t('shopping.minQuantity')} placeholder={t('shopping.minQuantity')} inputMode="decimal" value={minQ} onChange={(e) => setMinQ(e.target.value)} />
        <Select aria-label={t('shopping.unit')} value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">—</option>{UNITS.map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}</Select>
        <Button type="submit" icon="plus" loading={add.isPending}>{t('common.add')}</Button>
      </form>
    </Card>
  );
}
