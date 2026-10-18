import { supabase } from '@/lib/supabase';
import { unwrap, useHHQuery } from '@/lib/hooks';
import type { Bill, BudgetEntry, Expense } from '@/lib/types';

export function useBills(opts: { status?: 'unpaid' | 'paid'; from?: string; to?: string; limit?: number } = {}) {
  return useHHQuery('budget', ['bills', opts], async (hh) => {
    let q = supabase.from('bills').select('*').eq('household_id', hh).is('archived_at', null);
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.from) q = q.gte('due_date', opts.from);
    if (opts.to) q = q.lte('due_date', opts.to);
    q = opts.status === 'paid' ? q.order('paid_at', { ascending: false }) : q.order('due_date');
    return unwrap(await q.limit(opts.limit ?? 500)) as Bill[];
  });
}
export function useExpenses(from: string, to: string) {
  return useHHQuery('budget', ['expenses', from, to], async (hh) =>
    unwrap(await supabase.from('expenses').select('*').eq('household_id', hh).is('archived_at', null).gte('spent_on', from).lte('spent_on', to).order('spent_on', { ascending: false })) as Expense[]);
}
export function useBudgetEntries(from: string, to: string) {
  return useHHQuery('budget', ['entries', from, to], async (hh) =>
    unwrap(await supabase.from('budget_entries').select('*').eq('household_id', hh).gte('entry_date', from).lte('entry_date', to)) as BudgetEntry[]);
}
