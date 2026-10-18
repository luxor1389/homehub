import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { unwrap, useAction } from '@/lib/hooks';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, Modal, PageHeader, Select, Tabs, Textarea, Checkbox, cx } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { useIngredients, useMealPlans, useRecipes } from '@/features/meals/api';
import { useShoppingItems, useShoppingLists } from '@/features/shopping/api';
import { addDays, formatDate, startOfWeek, weekdayName } from '@/lib/dates';
import { MEAL_TYPES, UNITS, type Ingredient, type MealPlan, type MealType, type Recipe } from '@/lib/types';

type View = 'week' | 'recipes';
const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const ingredientSchema = z.object({
  name: z.string().trim().max(80, 'validation.tooLong'),
  quantity: z.string().optional(),
  unit: z.string().optional(),
});
function parseQty(q?: string) {
  if (!q || !q.trim()) return null;
  const n = Number(q.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}
const optInt = (max: number) => z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int('validation.integer').min(1, 'validation.min').max(max, 'validation.max').optional());

export default function MealsPage() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('week');
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.meals')} />
      <Tabs value={view} onChange={setView} items={[{ value: 'week', label: t('meals.weekPlan') }, { value: 'recipes', label: t('meals.recipes') }]} />
      {view === 'week' ? <WeekPlan /> : <Recipes />}
    </div>
  );
}

type MealEditorState = { meal?: MealPlan; date: string; type: MealType; recipe?: Recipe } | null;

function WeekPlan() {
  const { t, i18n } = useTranslation();
  const { today, memberName } = useCurrentHousehold();
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const [editor, setEditor] = useState<MealEditorState>(null);
  const [toList, setToList] = useState(false);
  const [showSnack, setShowSnack] = useState(false);
  const plans = useMealPlans(weekStart, addDays(weekStart, 6));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const types = MEAL_TYPES.filter((m) => m !== 'snack' || showSnack);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton icon="chevronLeft" label={t('calendar.previous')} onClick={() => setWeekStart(addDays(weekStart, -7))} />
          <Button size="sm" variant="secondary" onClick={() => setWeekStart(startOfWeek(today))}>{t('calendar.thisWeek')}</Button>
          <IconButton icon="chevronRight" label={t('calendar.next')} onClick={() => setWeekStart(addDays(weekStart, 7))} />
          <span className="ml-2 text-sm font-medium">{formatDate(weekStart, i18n.language, { day: 'numeric', month: 'short' })} – {formatDate(addDays(weekStart, 6), i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
        <div className="flex gap-2">
          <Checkbox label={t('meals.showSnack')} checked={showSnack} onChange={(e) => setShowSnack(e.target.checked)} />
          <Button icon="cart" variant="secondary" disabled={!plans.data?.length} onClick={() => setToList(true)}>{t('meals.ingredientsToList')}</Button>
        </div>
      </div>
      {plans.isLoading ? <LoadingState /> : plans.error ? <ErrorState error={plans.error} onRetry={() => void plans.refetch()} /> : (
        <div className="grid gap-2 lg:grid-cols-7">
          {days.map((d, i) => (
            <div key={d} className={cx('rounded-2xl border bg-white p-2', d === today ? 'border-brand-600' : 'border-slate-200')}>
              <p className="mb-2 text-sm font-semibold">{weekdayName(i + 1, i18n.language, 'long')} <span className="font-normal text-slate-500">{formatDate(d, i18n.language, { day: 'numeric', month: 'numeric' })}</span></p>
              <div className="space-y-2">
                {types.map((mt) => {
                  const meals = (plans.data ?? []).filter((m) => m.plan_date === d && m.meal_type === mt);
                  return (
                    <div key={mt}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t(`meals.types.${mt}`)}</span>
                        <button type="button" aria-label={t('meals.addMeal', { type: t(`meals.types.${mt}`), date: formatDate(d, i18n.language) })} className="h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => setEditor({ date: d, type: mt })}>
                          <Icon name="plus" className="mx-auto h-4 w-4" />
                        </button>
                      </div>
                      {meals.map((m) => (
                        <button key={m.id} type="button" onClick={() => setEditor({ meal: m, date: m.plan_date, type: m.meal_type })}
                          className="mt-1 flex w-full items-center gap-2 rounded-lg bg-orange-50 px-2 py-1.5 text-left text-sm hover:bg-orange-100">
                          <span className="min-w-0 flex-1 truncate">{m.title}</span>
                          {m.cook_id && <Avatar name={memberName(m.cook_id)} className="h-6 w-6" />}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {editor && <MealEditor state={editor} onClose={() => setEditor(null)} />}
      {toList && <IngredientsToListModal meals={plans.data ?? []} onClose={() => setToList(false)} />}
    </div>
  );
}

const mealSchema = z.object({
  title: z.string().trim().min(1, 'validation.required').max(120, 'validation.tooLong'),
  plan_date: z.string().min(1, 'validation.required'),
  meal_type: z.enum(MEAL_TYPES),
  recipe_id: z.string().optional(),
  cook_id: z.string().optional(),
  prep_minutes: optInt(1440),
  prep_on: z.string().optional(),
  servings: optInt(100),
  notes: z.string().max(2000, 'validation.tooLong').optional(),
  ingredients: z.array(ingredientSchema),
}).refine((v) => !v.prep_on || v.prep_on <= v.plan_date, { path: ['prep_on'], message: 'validation.prepBeforeMeal' });
type MealForm = z.infer<typeof mealSchema>;

function MealEditor({ state, onClose }: { state: NonNullable<MealEditorState>; onClose: () => void }) {
  const { t } = useTranslation();
  const { householdId, activeMembers } = useCurrentHousehold();
  const recipes = useRecipes();
  const meal = state.meal;
  const own = useIngredients({ mealIds: meal ? [meal.id] : [] });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const form = useForm<MealForm>({
    resolver: zodResolver(mealSchema),
    defaultValues: {
      title: meal?.title ?? state.recipe?.title ?? '', plan_date: state.date, meal_type: state.type,
      recipe_id: meal?.recipe_id ?? state.recipe?.id ?? '', cook_id: meal?.cook_id ?? '',
      prep_minutes: meal?.prep_minutes ?? state.recipe?.prep_minutes ?? undefined, prep_on: meal?.prep_on ?? '',
      servings: meal?.servings ?? state.recipe?.servings ?? undefined, notes: meal?.notes ?? '', ingredients: [],
    },
  });
  const ingredients = useFieldArray({ control: form.control, name: 'ingredients' });
  useEffect(() => {
    if (own.data && meal) form.setValue('ingredients', own.data.map((i) => ({ name: i.name, quantity: i.quantity != null ? String(i.quantity) : '', unit: i.unit ?? '' })));
  }, [own.data, meal, form]);
  const recipeId = form.watch('recipe_id');
  const recipeIngr = useIngredients({ recipeIds: recipeId ? [recipeId] : [] });

  const save = useAction(async (v: MealForm) => {
    const row = {
      title: v.title, plan_date: v.plan_date, meal_type: v.meal_type, recipe_id: v.recipe_id || null, cook_id: v.cook_id || null,
      prep_minutes: v.prep_minutes ?? null, prep_on: v.prep_on || null, servings: v.servings ?? null, notes: v.notes || null,
    };
    const id = meal
      ? (unwrap(await supabase.from('meal_plans').update(row).eq('id', meal.id).select('id').single()) as { id: string }).id
      : (unwrap(await supabase.from('meal_plans').insert({ ...row, household_id: householdId }).select('id').single()) as { id: string }).id;
    unwrap(await supabase.from('meal_ingredients').delete().eq('meal_plan_id', id));
    const rows = v.ingredients.filter((i) => i.name.trim()).map((i, position) => ({
      household_id: householdId, meal_plan_id: id, name: i.name.trim(), quantity: parseQty(i.quantity), unit: i.unit || null, position,
    }));
    if (rows.length) unwrap(await supabase.from('meal_ingredients').insert(rows));
  }, { groups: ['meals'], success: 'common.saved', onSuccess: onClose });
  const remove = useAction(async () => unwrap(await supabase.from('meal_plans').delete().eq('id', meal!.id).select('id').single()),
    { groups: ['meals'], success: 'common.deleted', onSuccess: onClose });
  const e = form.formState.errors;
  return (
    <Modal open onClose={onClose} size="lg" title={meal ? t('meals.editMeal') : t('meals.newMeal')}
      footer={<>
        {meal && <Button variant="ghost" icon="trash" className="mr-auto text-red-700" onClick={() => setConfirmDelete(true)}>{t('common.delete')}</Button>}
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="meal-form" loading={save.isPending}>{t('common.save')}</Button>
      </>}>
      <form id="meal-form" className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('meals.recipe')} htmlFor="meal-recipe">
            <Select id="meal-recipe" {...form.register('recipe_id', {
              onChange: (ev) => {
                const r = recipes.data?.find((x) => x.id === ev.target.value);
                if (r) {
                  if (!form.getValues('title')) form.setValue('title', r.title);
                  if (!form.getValues('prep_minutes') && r.prep_minutes) form.setValue('prep_minutes', r.prep_minutes);
                }
              },
            })}>
              <option value="">{t('meals.noRecipe')}</option>
              {recipes.data?.map((r) => <option key={r.id} value={r.id}>{r.is_favorite ? '★ ' : ''}{r.title}</option>)}
            </Select>
          </Field>
          <Field label={t('meals.title')} htmlFor="meal-title" error={e.title?.message}><Input id="meal-title" {...form.register('title')} /></Field>
          <Field label={t('meals.date')} htmlFor="meal-date" error={e.plan_date?.message}><Input id="meal-date" type="date" {...form.register('plan_date')} /></Field>
          <Field label={t('meals.type')} htmlFor="meal-type"><Select id="meal-type" {...form.register('meal_type')}>{MEAL_TYPES.map((m) => <option key={m} value={m}>{t(`meals.types.${m}`)}</option>)}</Select></Field>
          <Field label={t('meals.cook')} htmlFor="meal-cook">
            <Select id="meal-cook" {...form.register('cook_id')}><option value="">{t('tasks.unassigned')}</option>{activeMembers.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</Select>
          </Field>
          <Field label={t('meals.prepMinutes')} htmlFor="meal-prep" error={e.prep_minutes?.message}><Input id="meal-prep" type="number" min={1} {...form.register('prep_minutes')} /></Field>
          <Field label={t('meals.prepOn')} htmlFor="meal-prepon" error={e.prep_on?.message} hint={t('meals.prepOnHint')}><Input id="meal-prepon" type="date" {...form.register('prep_on')} /></Field>
          <Field label={t('meals.servings')} htmlFor="meal-serv" error={e.servings?.message}><Input id="meal-serv" type="number" min={1} {...form.register('servings')} /></Field>
        </div>
        <Field label={t('meals.notes')} htmlFor="meal-notes"><Textarea id="meal-notes" rows={2} {...form.register('notes')} /></Field>
        {recipeId && (recipeIngr.data?.length ?? 0) > 0 && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <p className="mb-1 font-medium">{t('meals.recipeIngredients')}</p>
            <p className="text-slate-700">{recipeIngr.data!.map((i) => `${i.name}${i.quantity ? ` ${i.quantity}` : ''}${i.unit ? ` ${t(`units.${i.unit}`)}` : ''}`).join(', ')}</p>
          </div>
        )}
        <IngredientRows label={t('meals.extraIngredients')} fields={ingredients.fields} register={form.register} name="ingredients"
          onAdd={() => ingredients.append({ name: '', quantity: '', unit: '' })} onRemove={ingredients.remove} />
      </form>
      <ConfirmDialog open={confirmDelete} title={t('common.delete')} message={t('meals.deleteConfirm', { name: meal?.title })}
        loading={remove.isPending} onCancel={() => setConfirmDelete(false)} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function IngredientRows({ label, fields, register, name, onAdd, onRemove }: { label: string; fields: { id: string }[]; register: any; name: string; onAdd: () => void; onRemove: (i: number) => void }) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">{label}</p>
      <div className="space-y-2">
        {fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-[1fr_4.5rem_6rem_auto] gap-2">
            <Input aria-label={t('meals.ingredientName')} placeholder={t('meals.ingredientName')} {...register(`${name}.${i}.name`)} />
            <Input aria-label={t('shopping.quantity')} placeholder={t('shopping.quantity')} inputMode="decimal" {...register(`${name}.${i}.quantity`)} />
            <Select aria-label={t('shopping.unit')} {...register(`${name}.${i}.unit`)}><option value="">—</option>{UNITS.map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}</Select>
            <IconButton icon="trash" label={t('common.remove')} onClick={() => onRemove(i)} />
          </div>
        ))}
        <Button size="sm" variant="secondary" icon="plus" onClick={onAdd}>{t('meals.addIngredient')}</Button>
      </div>
    </div>
  );
}

interface Row { key: string; name: string; quantity: number | null; unit: string | null; mealId: string | null; existingId: string | null; existingQty: number | null; existingUnit: string | null; action: 'add' | 'update' | 'skip'; newQty: string }

/** Lets the user decide, per ingredient, whether to add it, update the quantity of the item already on the list, or skip it. */
function IngredientsToListModal({ meals, onClose }: { meals: MealPlan[]; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lists = useShoppingLists();
  const listId = lists.data?.[0]?.id;
  const needed = useShoppingItems(listId, 'needed');
  const recipeIds = [...new Set(meals.map((m) => m.recipe_id).filter(Boolean) as string[])];
  const ingr = useIngredients({ recipeIds, mealIds: meals.map((m) => m.id) });
  const [rows, setRows] = useState<Row[] | null>(null);

  const computed = useMemo<Row[] | null>(() => {
    if (!ingr.data || !needed.data) return null;
    const byRecipe = new Map<string, Ingredient[]>();
    for (const i of ingr.data) if (i.recipe_id) byRecipe.set(i.recipe_id, [...(byRecipe.get(i.recipe_id) ?? []), i]);
    const merged = new Map<string, Row>();
    for (const m of meals) {
      const list = [...(m.recipe_id ? byRecipe.get(m.recipe_id) ?? [] : []), ...ingr.data.filter((i) => i.meal_plan_id === m.id)];
      for (const i of list) {
        const key = normalize(i.name);
        const prev = merged.get(key);
        if (prev) {
          if (prev.unit === i.unit && prev.quantity != null && i.quantity != null) prev.quantity += Number(i.quantity);
          continue;
        }
        const existing = needed.data.find((x) => x.normalized_name === key);
        merged.set(key, {
          key, name: i.name, quantity: i.quantity != null ? Number(i.quantity) : null, unit: i.unit, mealId: m.id,
          existingId: existing?.id ?? null, existingQty: existing ? Number(existing.quantity) : null, existingUnit: existing?.unit ?? null,
          action: existing ? 'update' : 'add', newQty: '',
        });
      }
    }
    return [...merged.values()].map((r) => ({
      ...r,
      newQty: r.existingId ? String((r.existingQty ?? 0) + (r.unit === r.existingUnit && r.quantity ? r.quantity : 0)) : r.quantity != null ? String(r.quantity) : '1',
    }));
  }, [ingr.data, needed.data, meals]);
  useEffect(() => { if (computed && !rows) setRows(computed); }, [computed, rows]);

  const apply = useAction(async () => unwrap(await supabase.rpc('apply_ingredients_to_list', {
    p_list: listId, p_items: (rows ?? []).filter((r) => r.action !== 'skip').map((r) => ({
      name: r.name, quantity: parseQty(r.newQty) ?? 1, unit: r.action === 'update' ? (r.existingUnit ?? r.unit) : r.unit,
      action: r.action, item_id: r.existingId, meal_plan_id: r.mealId,
    })),
  })) as { added: number; updated: number }, { groups: ['shopping'], success: 'meals.ingredientsApplied', onSuccess: onClose });

  const setRow = (key: string, patch: Partial<Row>) => setRows((all) => all!.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <Modal open onClose={onClose} size="lg" title={t('meals.ingredientsToList')}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={apply.isPending} disabled={!rows?.some((r) => r.action !== 'skip')} onClick={() => apply.mutate(undefined)}>{t('meals.applyToList')}</Button></>}>
      {!rows ? <LoadingState /> : !rows.length ? <EmptyState title={t('meals.noIngredients')}>{t('meals.noIngredientsHint')}</EmptyState> : (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">{t('meals.applyHint')}</p>
          {rows.map((r) => (
            <div key={r.key} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{r.name} <span className="font-normal text-slate-500">{r.quantity != null ? `${r.quantity}${r.unit ? ' ' + t(`units.${r.unit}`) : ''}` : ''}</span></p>
                {r.existingId && <Badge tone="amber">{t('meals.alreadyOnList', { qty: `${r.existingQty}${r.existingUnit ? ' ' + t(`units.${r.existingUnit}`) : ''}` })}</Badge>}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Select aria-label={t('meals.action')} value={r.action} onChange={(e) => setRow(r.key, { action: e.target.value as Row['action'] })}>
                  {r.existingId ? <option value="update">{t('meals.actions.update')}</option> : <option value="add">{t('meals.actions.add')}</option>}
                  <option value="skip">{t('meals.actions.skip')}</option>
                </Select>
                {r.action !== 'skip' && <Input aria-label={t('shopping.quantity')} inputMode="decimal" value={r.newQty} onChange={(e) => setRow(r.key, { newQty: e.target.value })} />}
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-500">{formatDate(meals[0]?.plan_date, i18n.language)}{meals.length > 1 ? ` – ${formatDate(meals[meals.length - 1]?.plan_date, i18n.language)}` : ''}</p>
        </div>
      )}
    </Modal>
  );
}

const recipeSchema = z.object({
  title: z.string().trim().min(1, 'validation.required').max(120, 'validation.tooLong'),
  description: z.string().max(2000, 'validation.tooLong').optional(),
  instructions: z.string().max(10000, 'validation.tooLong').optional(),
  prep_minutes: optInt(1440),
  servings: optInt(100),
  is_favorite: z.boolean(),
  source_url: z.string().max(500, 'validation.tooLong').refine((v) => !v || /^https?:\/\//i.test(v), 'validation.url').optional(),
  ingredients: z.array(ingredientSchema),
});
type RecipeForm = z.infer<typeof recipeSchema>;

function Recipes() {
  const { t } = useTranslation();
  const { today } = useCurrentHousehold();
  const recipes = useRecipes();
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null);
  const [planning, setPlanning] = useState<Recipe | null>(null);
  const [search, setSearch] = useState('');
  const fav = useAction(async (r: Recipe) => unwrap(await supabase.from('recipes').update({ is_favorite: !r.is_favorite }).eq('id', r.id).select('id').single()), { groups: ['meals'] });
  const list = (recipes.data ?? []).filter((r) => !search || r.title.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input type="search" className="max-w-xs" placeholder={t('common.search')} aria-label={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button icon="plus" onClick={() => setEditing('new')}>{t('meals.newRecipe')}</Button>
      </div>
      {recipes.isLoading ? <LoadingState /> : !list.length ? <EmptyState icon="meal" title={t('meals.noRecipes')} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="text-left font-semibold hover:underline" onClick={() => setEditing(r)}>{r.title}</button>
                <button type="button" aria-pressed={r.is_favorite} aria-label={t('meals.favorite')} onClick={() => fav.mutate(r)} className={cx('h-10 w-10 rounded-lg', r.is_favorite ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500')}>
                  <Icon name="star" className="mx-auto h-5 w-5" fill={r.is_favorite ? 'currentColor' : 'none'} />
                </button>
              </div>
              {r.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{r.description}</p>}
              <p className="mt-2 text-xs text-slate-500">{[r.prep_minutes ? t('common.minutes', { count: r.prep_minutes }) : '', r.servings ? t('meals.servingsCount', { count: r.servings }) : ''].filter(Boolean).join(' · ')}</p>
              <Button size="sm" variant="secondary" className="mt-3" icon="calendar" onClick={() => setPlanning(r)}>{t('meals.plan')}</Button>
            </Card>
          ))}
        </div>
      )}
      {editing && <RecipeEditor recipe={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {planning && <MealEditor state={{ date: today, type: 'lunch', recipe: planning }} onClose={() => setPlanning(null)} />}
    </div>
  );
}

function RecipeEditor({ recipe, onClose }: { recipe: Recipe | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { householdId } = useCurrentHousehold();
  const existing = useIngredients({ recipeIds: recipe ? [recipe.id] : [] });
  const [confirm, setConfirm] = useState(false);
  const form = useForm<RecipeForm>({
    resolver: zodResolver(recipeSchema),
    defaultValues: {
      title: recipe?.title ?? '', description: recipe?.description ?? '', instructions: recipe?.instructions ?? '',
      prep_minutes: recipe?.prep_minutes ?? undefined, servings: recipe?.servings ?? undefined, is_favorite: recipe?.is_favorite ?? false,
      source_url: recipe?.source_url ?? '', ingredients: [],
    },
  });
  const ingredients = useFieldArray({ control: form.control, name: 'ingredients' });
  useEffect(() => {
    if (recipe && existing.data) form.setValue('ingredients', existing.data.map((i) => ({ name: i.name, quantity: i.quantity != null ? String(i.quantity) : '', unit: i.unit ?? '' })));
  }, [existing.data, recipe, form]);
  const save = useAction(async (v: RecipeForm) => {
    const row = { title: v.title, description: v.description || null, instructions: v.instructions || null, prep_minutes: v.prep_minutes ?? null, servings: v.servings ?? null, is_favorite: v.is_favorite, source_url: v.source_url || null };
    const id = recipe
      ? (unwrap(await supabase.from('recipes').update(row).eq('id', recipe.id).select('id').single()) as { id: string }).id
      : (unwrap(await supabase.from('recipes').insert({ ...row, household_id: householdId }).select('id').single()) as { id: string }).id;
    unwrap(await supabase.from('meal_ingredients').delete().eq('recipe_id', id));
    const rows = v.ingredients.filter((i) => i.name.trim()).map((i, position) => ({ household_id: householdId, recipe_id: id, name: i.name.trim(), quantity: parseQty(i.quantity), unit: i.unit || null, position }));
    if (rows.length) unwrap(await supabase.from('meal_ingredients').insert(rows));
  }, { groups: ['meals'], success: 'common.saved', onSuccess: onClose });
  const archive = useAction(async () => {
    unwrap(await supabase.from('recipes').update({ archived_at: new Date().toISOString() }).eq('id', recipe!.id).select('id').single());
  }, { groups: ['meals'], success: 'common.archivedOk', onSuccess: onClose });
  const e = form.formState.errors;
  return (
    <Modal open onClose={onClose} size="lg" title={recipe ? t('meals.editRecipe') : t('meals.newRecipe')}
      footer={<>
        {recipe && <Button variant="ghost" icon="archive" className="mr-auto" onClick={() => setConfirm(true)}>{t('common.archive')}</Button>}
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="recipe-form" loading={save.isPending}>{t('common.save')}</Button>
      </>}>
      <form id="recipe-form" className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label={t('meals.title')} htmlFor="r-title" error={e.title?.message}><Input id="r-title" {...form.register('title')} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('meals.prepMinutes')} htmlFor="r-prep" error={e.prep_minutes?.message}><Input id="r-prep" type="number" min={1} {...form.register('prep_minutes')} /></Field>
          <Field label={t('meals.servings')} htmlFor="r-serv" error={e.servings?.message}><Input id="r-serv" type="number" min={1} {...form.register('servings')} /></Field>
          <div className="flex items-end"><Checkbox label={t('meals.favorite')} {...form.register('is_favorite')} /></div>
        </div>
        <Field label={t('meals.description')} htmlFor="r-desc" error={e.description?.message}><Textarea id="r-desc" rows={2} {...form.register('description')} /></Field>
        <IngredientRows label={t('meals.ingredients')} fields={ingredients.fields} register={form.register} name="ingredients"
          onAdd={() => ingredients.append({ name: '', quantity: '', unit: '' })} onRemove={ingredients.remove} />
        <Field label={t('meals.instructions')} htmlFor="r-instr" error={e.instructions?.message}><Textarea id="r-instr" rows={5} {...form.register('instructions')} /></Field>
        <Field label={t('meals.sourceUrl')} htmlFor="r-url" error={e.source_url?.message}><Input id="r-url" type="url" placeholder="https://" {...form.register('source_url')} /></Field>
      </form>
      <ConfirmDialog open={confirm} title={t('common.archive')} message={t('meals.archiveRecipe', { name: recipe?.title })} confirmLabel={t('common.archive')}
        loading={archive.isPending} onCancel={() => setConfirm(false)} onConfirm={() => archive.mutate(undefined)} />
    </Modal>
  );
}
