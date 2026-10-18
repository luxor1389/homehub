import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// These tests run against a disposable Supabase stack (local harness or `supabase start`).
// They create users through the admin API, so NEVER point them at production.
export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://localhost:54321';
export const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY for integration tests');
}

export const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
}

const runId = Math.random().toString(36).slice(2, 8);

export async function createUser(label: string, locale = 'sr-Latn'): Promise<TestUser> {
  const email = `${label}-${runId}@example.test`;
  const password = `Pw-${runId}-${label}-123!`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: label, locale },
  });
  if (error) throw error;
  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user!.id, email, password, client };
}

export function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

export async function createHousehold(u: TestUser, name: string): Promise<string> {
  return must(await u.client.rpc('create_household', { p_name: name })) as unknown as string;
}

export async function invite(u: TestUser, household: string, opts: { email?: string; hours?: number; uses?: number } = {}) {
  const rows = must(await u.client.rpc('create_invitation', {
    p_household: household, p_email: opts.email ?? null, p_valid_hours: opts.hours ?? 72, p_max_uses: opts.uses ?? 1,
  })) as { invitation_id: string; token: string }[];
  return rows[0];
}

export async function join(u: TestUser, token: string) {
  return must(await u.client.rpc('accept_invitation', { p_token: token })) as unknown as string;
}
