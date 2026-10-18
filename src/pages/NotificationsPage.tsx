import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { unwrap, useAction, useHHQuery } from '@/lib/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Badge, Button, EmptyState, ErrorState, LoadingState, PageHeader, Tabs, cx } from '@/components/ui/ui';
import { Icon, type IconName } from '@/components/ui/icons';
import { formatDate, formatDateTime, formatMoney } from '@/lib/dates';
import type { AppNotification, NotificationDelivery } from '@/lib/types';

const ICONS: Record<string, IconName> = {
  task_assigned: 'tasks', task_due_changed: 'calendar', task_due_soon: 'clock', task_overdue: 'clock',
  bill_due_soon: 'wallet', bill_overdue: 'wallet', vehicle_due: 'car', pet_due: 'paw', plant_due: 'leaf', member_joined: 'users',
};

function linkFor(n: AppNotification): string {
  switch (n.entity_type) {
    case 'task_occurrence': return `/tasks/${n.entity_id}`;
    case 'bill': return '/budget';
    case 'vehicle': return `/vehicles/${n.entity_id}`;
    case 'pet': return `/pets/${n.entity_id}`;
    case 'plant': return `/plants/${n.entity_id}`;
    case 'member': return '/settings';
    default: return '/';
  }
}

export default function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const { userId, profile } = useAuth();
  const { household } = useCurrentHousehold();
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const q = useHHQuery('notifications', ['list', tab], async (hh) => {
    let query = supabase.from('notifications').select('*').eq('household_id', hh).eq('user_id', userId!);
    if (tab === 'unread') query = query.is('read_at', null);
    const list = unwrap(await query.order('created_at', { ascending: false }).limit(100)) as AppNotification[];
    const ids = list.map((n) => n.id);
    const deliveries = ids.length
      ? unwrap(await supabase.from('notification_deliveries').select('id, notification_id, channel, status').in('notification_id', ids)) as NotificationDelivery[]
      : [];
    return { list, email: new Map(deliveries.filter((d) => d.channel === 'email').map((d) => [d.notification_id, d.status])) };
  });
  const markRead = useAction(async (ids: string[]) => unwrap(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).select('id')),
    { groups: ['notifications'] });
  const markAll = useAction(async () => unwrap(await supabase.from('notifications').update({ read_at: new Date().toISOString() })
    .eq('household_id', household.id).eq('user_id', userId!).is('read_at', null).select('id')), { groups: ['notifications'], success: 'notifications.allRead' });
  const remove = useAction(async (id: string) => unwrap(await supabase.from('notifications').delete().eq('id', id).select('id')), { groups: ['notifications'] });

  const text = (n: AppNotification) => {
    const p = n.params as Record<string, string | number | undefined>;
    const date = (d: unknown) => formatDate(typeof d === 'string' ? d : null, i18n.language);
    return t(`notifications.types.${n.type}`, {
      title: p.title ?? '', name: p.name ?? '', date: date(p.due_date), from: date(p.from), to: date(p.to),
      amount: p.amount != null ? formatMoney(Number(p.amount), String(p.currency ?? household.currency), i18n.language) : '',
      what: p.what ? t(`notifications.what.${p.what}`, { defaultValue: t(`pets.care.${p.what}`, { defaultValue: String(p.what) }) }) : '',
      km: p.km != null ? ` (${p.km} km)` : '',
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.notifications')} actions={<Button variant="secondary" icon="check" loading={markAll.isPending} onClick={() => markAll.mutate(undefined)}>{t('notifications.markAllRead')}</Button>} />
      <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">
        <Icon name="info" className="mr-1 inline h-4 w-4" />
        {profile?.email_notifications ? t('notifications.emailOnInfo') : t('notifications.emailOffInfo')}{' '}
        <Link to="/settings" className="text-brand-700 underline">{t('nav.settings')}</Link>
      </p>
      <Tabs value={tab} onChange={(v) => setTab(v as 'unread' | 'all')} items={[{ value: 'unread', label: t('notifications.unread') }, { value: 'all', label: t('notifications.all') }]} />
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.list.length ? (
        <EmptyState icon="bell" title={tab === 'unread' ? t('notifications.emptyUnread') : t('notifications.empty')} />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {q.data.list.map((n) => {
            const email = q.data.email.get(n.id);
            return (
              <li key={n.id} className={cx('flex items-start gap-3 p-3', !n.read_at && 'bg-brand-50/50')}>
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600"><Icon name={ICONS[n.type] ?? 'bell'} className="h-5 w-5" /></span>
                <Link to={linkFor(n)} className="min-w-0 flex-1" onClick={() => { if (!n.read_at) markRead.mutate([n.id]); }}>
                  <p className={cx('text-sm', !n.read_at && 'font-semibold')}>{text(n)}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {formatDateTime(n.created_at, i18n.language, household.timezone)}
                    {email && <Badge tone={email === 'sent' ? 'green' : email === 'failed' ? 'red' : 'gray'}>{t(`notifications.email.${email}`)}</Badge>}
                  </p>
                </Link>
                <div className="flex shrink-0 gap-1">
                  {!n.read_at && <Button size="sm" variant="ghost" icon="check" aria-label={t('notifications.markRead')} onClick={() => markRead.mutate([n.id])} />}
                  <Button size="sm" variant="ghost" icon="trash" aria-label={t('common.delete')} onClick={() => remove.mutate(n.id)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
