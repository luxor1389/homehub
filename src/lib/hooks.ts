import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { useToast } from '@/components/ui/toast';

export type Group = 'tasks' | 'shopping' | 'meals' | 'budget' | 'vehicles' | 'pets' | 'plants' | 'members' | 'attachments' | 'notifications' | 'activity';

/** Household-scoped query; key = ['hh', householdId, group, ...rest] so realtime can invalidate it. */
export function useHHQuery<T>(group: Group, rest: QueryKey, fn: (householdId: string) => Promise<T>, enabled = true) {
  const { householdId } = useCurrentHousehold();
  return useQuery({ queryKey: ['hh', householdId, group, ...rest], queryFn: () => fn(householdId), enabled });
}

/** Unwraps a supabase response, throwing its error. */
export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

/**
 * Mutation that only reports success after the server confirmed it, shows a translated error otherwise,
 * and refreshes the given query groups.
 */
export function useAction<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { groups: Group[]; success?: string | ((r: TResult, v: TVars) => string | null); onSuccess?: (r: TResult, v: TVars) => void; silentError?: boolean } ,
) {
  const qc = useQueryClient();
  const { householdId } = useCurrentHousehold();
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: fn,
    networkMode: 'always', // fail fast when offline instead of silently queueing
    onSuccess: (r, v) => {
      for (const g of [...opts.groups, 'activity' as const]) void qc.invalidateQueries({ queryKey: ['hh', householdId, g] });
      const msg = typeof opts.success === 'function' ? opts.success(r, v) : opts.success;
      if (msg) toast.success(t(msg));
      opts.onSuccess?.(r, v);
    },
    onError: (e) => {
      if (!opts.silentError) toast.error(e);
    },
  });
}
