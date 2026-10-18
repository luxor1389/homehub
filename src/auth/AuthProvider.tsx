import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { applyLocale } from '@/i18n';
import type { Locale, Profile } from '@/lib/types';

interface AuthState {
  session: Session | null;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  loading: boolean;
  profileError: unknown;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: Partial<Pick<Profile, 'display_name' | 'locale' | 'email_notifications'>>) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_OUT') {
        setProfile(null);
        queryClient.clear(); // never keep another user's data in memory
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  const userId = session?.user.id ?? null;

  const loadProfile = useCallback(async () => {
    if (!userId) return;
    setProfileLoading(true);
    setProfileError(null);
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error) setProfileError(error);
    else {
      setProfile(data as Profile);
      applyLocale((data as Profile).locale); // the saved language wins after every sign-in
    }
    setProfileLoading(false);
  }, [userId]);

  useEffect(() => {
    if (userId) void loadProfile();
  }, [userId, loadProfile]);

  const updateProfile = useCallback<AuthState['updateProfile']>(async (patch) => {
    if (!userId) return;
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select('*').single();
    if (error) throw error;
    setProfile(data as Profile);
    if (patch.locale) applyLocale(patch.locale as Locale);
  }, [userId]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthState>(() => ({
    session, userId, email: session?.user.email ?? null, profile,
    loading: sessionLoading || (Boolean(userId) && !profile && profileLoading),
    profileError, refreshProfile: loadProfile, updateProfile, signOut,
  }), [session, userId, profile, sessionLoading, profileLoading, profileError, loadProfile, updateProfile, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
