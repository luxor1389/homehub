import { supabase } from '@/lib/supabase';
import { unwrap, useHHQuery } from '@/lib/hooks';
import type { PantryItem, ShoppingItem, ShoppingList } from '@/lib/types';

export function useShoppingLists() {
  return useHHQuery('shopping', ['lists'], async (hh) =>
    unwrap(await supabase.from('shopping_lists').select('*').eq('household_id', hh).is('archived_at', null).order('is_default', { ascending: false }).order('created_at')) as ShoppingList[]);
}
export function useShoppingItems(listId: string | undefined, status: 'needed' | 'purchased', limit = 500) {
  return useHHQuery('shopping', ['items', listId, status, limit], async () => {
    let q = supabase.from('shopping_items').select('*').eq('list_id', listId!).eq('status', status);
    q = status === 'purchased' ? q.order('purchased_at', { ascending: false }) : q.order('category').order('created_at');
    return unwrap(await q.limit(limit)) as ShoppingItem[];
  }, Boolean(listId));
}
export function useNeededItems() {
  return useHHQuery('shopping', ['needed-all'], async (hh) =>
    unwrap(await supabase.from('shopping_items').select('*').eq('household_id', hh).eq('status', 'needed').order('priority', { ascending: false }).order('created_at')) as ShoppingItem[]);
}
export function usePantry() {
  return useHHQuery('shopping', ['pantry'], async (hh) =>
    unwrap(await supabase.from('pantry_items').select('*').eq('household_id', hh).order('name')) as PantryItem[]);
}
/** Items whose names contain one another (e.g. "Mleko" and "Mleko 2.8%") – possible duplicates to merge. */
export function nearDuplicates(items: ShoppingItem[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of items) for (const b of items) {
    if (a.id === b.id) continue;
    const x = a.normalized_name, y = b.normalized_name;
    if (x.length >= 3 && y.includes(x)) {
      out.set(a.id, [...(out.get(a.id) ?? []), b.id]);
    }
  }
  return out;
}
