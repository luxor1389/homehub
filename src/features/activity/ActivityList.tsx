import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { unwrap, useHHQuery } from '@/lib/hooks';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { ErrorState, LoadingState } from '@/components/ui/ui';
import { formatDate, formatDateTime } from '@/lib/dates';
import type { ActivityEntry } from '@/lib/types';

export function ActivityList({ parentId, limit = 50 }: { parentId?: string; limit?: number }) {
  const { t, i18n } = useTranslation();
  const { memberName, household } = useCurrentHousehold();
  const q = useHHQuery('activity', [parentId ?? 'all', limit], async (hh) => {
    let query = supabase.from('activity_log').select('*').eq('household_id', hh);
    if (parentId) query = query.eq('parent_id', parentId);
    return unwrap(await query.order('created_at', { ascending: false }).limit(limit)) as ActivityEntry[];
  });
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data?.length) return <p className="text-sm text-slate-500">{t('activity.empty')}</p>;
  return (
    <ol className="space-y-2">
      {q.data.map((a) => (
        <li key={a.id} className="text-sm">
          <p className="text-slate-800">
            <span className="font-medium">{a.actor_id ? memberName(a.actor_id) : t('activity.system')}</span>{' '}
            {t(`activity.actions.${a.action}`, { defaultValue: a.action })}{' '}
            <span className="text-slate-500">{t(`activity.entities.${a.entity_type}`, { defaultValue: a.entity_type })}</span>
            {a.label && <> „{a.label}“</>}
            {a.action === 'status' && a.details.to && <> → <strong>{t(`status.${a.details.to}`, { defaultValue: t(`activity.statusValues.${a.details.to}`, { defaultValue: a.details.to }) })}</strong></>}
            {a.details.due_to && <> ({t('activity.dueMoved', { from: formatDate(a.details.due_from, i18n.language), to: formatDate(a.details.due_to, i18n.language) })})</>}
          </p>
          <p className="text-xs text-slate-500">{formatDateTime(a.created_at, i18n.language, household.timezone)}</p>
        </li>
      ))}
    </ol>
  );
}
