import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Icon, type IconName } from '@/components/ui/icons';
import { cx, Select } from '@/components/ui/ui';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { useAuth } from '@/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { TaskEditorProvider, useTaskEditor } from '@/features/tasks/TaskEditor';

export const NAV: { to: string; key: string; icon: IconName }[] = [
  { to: '/', key: 'nav.home', icon: 'home' },
  { to: '/tasks', key: 'nav.tasks', icon: 'tasks' },
  { to: '/cleaning', key: 'nav.cleaning', icon: 'broom' },
  { to: '/shopping', key: 'nav.shopping', icon: 'cart' },
  { to: '/meals', key: 'nav.meals', icon: 'meal' },
  { to: '/budget', key: 'nav.budget', icon: 'wallet' },
  { to: '/vehicles', key: 'nav.vehicles', icon: 'car' },
  { to: '/pets', key: 'nav.pets', icon: 'paw' },
  { to: '/plants', key: 'nav.plants', icon: 'leaf' },
  { to: '/calendar', key: 'nav.calendar', icon: 'calendar' },
  { to: '/settings', key: 'nav.settings', icon: 'settings' },
];
const MOBILE_PRIMARY = ['/', '/tasks', '/shopping', '/calendar'];

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

function useUnreadCount() {
  const { householdId } = useCurrentHousehold();
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['hh', householdId, 'notifications', 'unread'],
    queryFn: async () => {
      const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true })
        .eq('household_id', householdId).eq('user_id', userId!).is('read_at', null);
      if (error) throw error;
      return count ?? 0;
    },
  }).data ?? 0;
}

function NavItem({ to, label, icon, onClick, compact }: { to: string; label: string; icon: IconName; onClick?: () => void; compact?: boolean }) {
  return (
    <NavLink to={to} end={to === '/'} onClick={onClick}
      className={({ isActive }) => cx(
        compact ? 'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium'
          : 'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium',
        isActive ? (compact ? 'text-brand-700' : 'bg-brand-50 text-brand-800') : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}>
      <Icon name={icon} className={compact ? 'h-6 w-6' : 'h-5 w-5'} />
      <span>{label}</span>
    </NavLink>
  );
}

function HouseholdSwitcher() {
  const { t } = useTranslation();
  const { households, householdId, selectHousehold, household } = useCurrentHousehold();
  if (households.length < 2) return <p className="truncate px-3 text-sm font-semibold text-slate-900">{household.name}</p>;
  return (
    <Select aria-label={t('household.switch')} value={householdId} onChange={(e) => selectHousehold(e.target.value)}>
      {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
    </Select>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const online = useOnline();
  const unread = useUnreadCount();
  const { openNew } = useTaskEditor();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMoreOpen(false), [location.pathname]);

  const bell = (
    <NavLink to="/notifications" aria-label={t('nav.notifications')} className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100">
      <Icon name="bell" />
      {unread > 0 && <span data-testid="unread-count" className="absolute right-1.5 top-1.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
    </NavLink>
  );

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-slate-200 bg-white p-3 md:flex">
        <div className="mb-3 flex items-center gap-2 px-3 pt-1">
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <span className="text-lg font-bold text-brand-800">HomeHub</span>
        </div>
        <div className="mb-3"><HouseholdSwitcher /></div>
        <nav aria-label={t('nav.main')} className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {NAV.map((n) => <NavItem key={n.to} to={n.to} label={t(n.key)} icon={n.icon} />)}
        </nav>
        <NavItem to="/activity" label={t('nav.activity')} icon="history" />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-3 py-1 backdrop-blur pt-[max(0.25rem,env(safe-area-inset-top))]">
          <div className="min-w-0 md:hidden"><HouseholdSwitcher /></div>
          <div className="hidden md:block" />
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => openNew()} className="hidden min-h-11 items-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 md:inline-flex">
              <Icon name="plus" className="h-4 w-4" /> {t('tasks.new')}
            </button>
            {bell}
          </div>
        </header>
        {!online && (
          <div role="status" className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900">
            <Icon name="wifiOff" className="h-4 w-4" /> {t('common.offlineBanner')}
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-28 pt-4 sm:px-6 md:pb-10">{children}</main>
      </div>

      {/* Mobile: floating quick add + bottom navigation */}
      <button type="button" onClick={() => openNew()} aria-label={t('tasks.new')}
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg hover:bg-brand-800 md:hidden">
        <Icon name="plus" className="h-7 w-7" />
      </button>
      <nav aria-label={t('nav.main')} className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.filter((n) => MOBILE_PRIMARY.includes(n.to)).map((n) => <NavItem key={n.to} compact to={n.to} label={t(n.key)} icon={n.icon} />)}
        <button type="button" onClick={() => setMoreOpen(true)} aria-expanded={moreOpen}
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-600">
          <Icon name="menu" className="h-6 w-6" /> {t('nav.more')}
        </button>
      </nav>
      {moreOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 md:hidden" onClick={() => setMoreOpen(false)}>
          <div role="dialog" aria-label={t('nav.more')} className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-3 pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-3 gap-2">
              {[...NAV.filter((n) => !MOBILE_PRIMARY.includes(n.to)), { to: '/activity', key: 'nav.activity', icon: 'history' as IconName }].map((n) => (
                <NavLink key={n.to} to={n.to} className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl bg-slate-50 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  <Icon name={n.icon} className="h-6 w-6" /> {t(n.key)}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <TaskEditorProvider>
      <ShellInner>{children}</ShellInner>
    </TaskEditorProvider>
  );
}
