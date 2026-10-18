import { supabase } from '@/lib/supabase';
import { unwrap, useHHQuery } from '@/lib/hooks';
import type { Ingredient, MealPlan, Recipe } from '@/lib/types';

export function useMealPlans(from: string, to: string) {
  return useHHQuery('meals', ['plans', from, to], async (hh) =>
    unwrap(await supabase.from('meal_plans').select('*').eq('household_id', hh).gte('plan_date', from).lte('plan_date', to).order('plan_date')) as MealPlan[]);
}
export function useRecipes() {
  return useHHQuery('meals', ['recipes'], async (hh) =>
    unwrap(await supabase.from('recipes').select('*').eq('household_id', hh).is('archived_at', null).order('is_favorite', { ascending: false }).order('title')) as Recipe[]);
}
export function useIngredients(opts: { recipeIds?: string[]; mealIds?: string[] }) {
  const r = opts.recipeIds ?? [];
  const m = opts.mealIds ?? [];
  return useHHQuery('meals', ['ingredients', r, m], async () => {
    const parts: Ingredient[] = [];
    if (r.length) parts.push(...(unwrap(await supabase.from('meal_ingredients').select('*').in('recipe_id', r).order('position')) as Ingredient[]));
    if (m.length) parts.push(...(unwrap(await supabase.from('meal_ingredients').select('*').in('meal_plan_id', m).order('position')) as Ingredient[]));
    return parts;
  }, r.length + m.length > 0);
}
