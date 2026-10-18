import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import type { Household, Member, Profile, Room } from '@/lib/types';
import { todayIn } from '@/lib/dates';

export interface MemberInfo extends Member {
  display_name: string;
}

interface HouseholdState {
  households: (Household & { role: Member['role'] })[];
  household: Household | null;
  householdId: string | null;
  isAdmin: boolean;
  members: MemberInfo[]; // every member ever (for history); use activeMembers for pickers
  activeMembers: MemberInfo[];
  memberName: (userId: string | null | undefined) => string;
  rooms: Room[];
  today: string;
  loading: boolean;
  error: unknown;
  realtimeConnected: boolean;
  selectHousehold: (id: string) => void;
  reload: () => Promise<void>;
}

const HouseholdContext = createContext<HouseholdState | null>(null);
const STORAGE_KEY = 'homehub.household';

// Which query groups a table change invalidates.
const TABLE_GROUPS: Record<string, string[]> = {
  households: ['households', 'members'], household_members: ['households', 'members', 'tasks'], rooms: ['members', 'tasks'],
  tasks: ['tasks'], task_assignees: ['tasks'], task_occurrences: ['tasks'], task_occurrence_assignees: ['tasks'],
  task_checklist_items: ['tasks'], task_checklist_progress: ['tasks'], task_comments: ['tasks'], task_templates: ['tasks'],
  shopping_lists: ['shopping'], shopping_items: ['shopping', 'budget'], pantry_items: ['shopping'],
  recipes: ['meals'], meal_plans: ['meals'], meal_ingredients: ['meals'],
  bills: ['budget'], expenses: ['budget'],
  vehicles: ['vehicles'], vehicle_maintenance: ['vehicles', 'budget'],
  pets: ['pets'], pet_care_records: ['pets', 'budget'],
  plants: ['plants'], plant_care_records: ['plants'],
  attachments: ['attachments'], notifications: ['notifications'],
};

const FALLBACK_POLL_MS = Number(import.meta.env.VITE_REALTIME_FALLBACK_POLL_MS ?? 30000);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  });
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const householdsQuery = useQuery({
    queryKey: ['me', userId, 'households'],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from('household_members')
        .select('role, household:households(*)').eq('user_id', userId!).eq('status', 'active');
      if (error) throw error;
      return (data as unknown as { role: Member['role']; household: Household }[])
        .filter((r) => r.household)
        .map((r) => ({ ...r.household, role: r.role }))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
  });
  const households = useMemo(() => householdsQuery.data ?? [], [householdsQuery.data]);
  const current = households.find((h) => h.id === selectedId) ?? households[0] ?? null;
  const householdId = current?.id ?? null;

  useEffect(() => {
    if (householdId && householdId !== selectedId) {
      setSelectedId(householdId);
      try { localStorage.setItem(STORAGE_KEY, householdId); } catch { /* ignore */ }
    }
  }, [householdId, selectedId]);

  const membersQuery = useQuery({
    queryKey: ['hh', householdId, 'members', 'list'],
    enabled: Boolean(householdId),
    queryFn: async () => {
      const [m, p] = await Promise.all([
        supabase.from('household_members').select('*').eq('household_id', householdId!).order('joined_at'),
        supabase.from('profiles').select('id, display_name'),
      ]);
      if (m.error) throw m.error;
      if (p.error) throw p.error;
      const names = new Map((p.data as Pick<Profile, 'id' | 'display_name'>[]).map((x) => [x.id, x.display_name]));
      return (m.data as Member[]).map((x) => ({ ...x, display_name: names.get(x.user_id) ?? '—' }));
    },
  });

  const roomsQuery = useQuery({
    queryKey: ['hh', householdId, 'members', 'rooms'],
    enabled: Boolean(householdId),
    queryFn: async () => {
      const { data, error } = await supabase.from('rooms').select('*').eq('household_id', householdId!)
        .is('archived_at', null).order('sort_order').order('created_at');
      if (error) throw error;
      return data as Room[];
    },
  });

  // Keep recurring occurrences and reminders fresh (idempotent server function).
  useEffect(() => {
    if (!householdId) return;
    const run = () => supabase.rpc('refresh_household', { p_household: householdId }).then(({ error }) => {
      if (!error) void queryClient.invalidateQueries({ queryKey: ['hh', householdId] });
    });
    void run();
    const timer = setInterval(run, 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [householdId, queryClient]);

  // Realtime sync: any change by another member invalidates the affected queries.
  const pending = useRef(new Set<string>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!householdId || !userId) return;
    const flush = () => {
      const groups = [...pending.current];
      pending.current.clear();
      for (const g of groups) void queryClient.invalidateQueries({ queryKey: ['hh', householdId, g] });
      void queryClient.invalidateQueries({ queryKey: ['hh', householdId, 'activity'] });
      if (groups.includes('households')) void queryClient.invalidateQueries({ queryKey: ['me', userId, 'households'] });
    };
    const onChange = (table: string) => {
      for (const g of TABLE_GROUPS[table] ?? []) pending.current.add(g);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(flush, 150);
    };
    let channel = supabase.channel(`household:${householdId}`);
    for (const table of Object.keys(TABLE_GROUPS)) {
      const filter = table === 'households' ? `id=eq.${householdId}`
        : table === 'notifications' ? `user_id=eq.${userId}` : `household_id=eq.${householdId}`;
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => onChange(table));
    }
    channel.subscribe((status) => setRealtimeConnected(status === 'SUBSCRIBED'));
    return () => {
      setRealtimeConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [householdId, userId, queryClient]);

  // Fallback while realtime is unavailable: periodic refetch of what is on screen.
  useEffect(() => {
    if (!householdId || realtimeConnected) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void queryClient.invalidateQueries({ queryKey: ['hh', householdId] });
        void queryClient.invalidateQueries({ queryKey: ['me'] });
      }
    }, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [householdId, realtimeConnected, queryClient]);

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const activeMembers = useMemo(() => members.filter((m) => m.status === 'active'), [members]);
  const nameMap = useMemo(() => new Map(members.map((m) => [m.user_id, m.display_name])), [members]);
  const memberName = useCallback((id: string | null | undefined) => (id ? nameMap.get(id) ?? '—' : '—'), [nameMap]);
  const me = members.find((m) => m.user_id === userId && m.status === 'active');

  const selectHousehold = useCallback((id: string) => {
    setSelectedId(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
  }, []);
  const reload = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['me', userId, 'households'] });
  }, [queryClient, userId]);

  const value: HouseholdState = {
    households,
    household: current,
    householdId,
    isAdmin: me?.role === 'admin',
    members,
    activeMembers,
    memberName,
    rooms: roomsQuery.data ?? [],
    today: todayIn(current?.timezone ?? 'Europe/Belgrade'),
    loading: householdsQuery.isLoading || (Boolean(householdId) && membersQuery.isLoading),
    error: householdsQuery.error ?? membersQuery.error,
    realtimeConnected,
    selectHousehold,
    reload,
  };
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold() {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error('useHousehold outside HouseholdProvider');
  return ctx;
}

/** Same as useHousehold but guarantees a selected household (used inside the app shell). */
export function useCurrentHousehold() {
  const ctx = useHousehold();
  if (!ctx.household || !ctx.householdId) throw new Error('No household selected');
  return { ...ctx, household: ctx.household, householdId: ctx.householdId };
}
