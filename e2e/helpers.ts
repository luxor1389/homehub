import { createClient } from '@supabase/supabase-js';
import { expect, type Browser, type Page } from '@playwright/test';

const URL = process.env.SUPABASE_URL ?? 'http://localhost:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!ANON || !SERVICE) throw new Error('Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (test stack only)');

export const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
export const runId = Math.random().toString(36).slice(2, 7);

export interface E2EUser { name: string; email: string; password: string; id?: string }

export function newUser(name: string): E2EUser {
  return { name, email: `${name.toLowerCase()}-${runId}@example.test`, password: `Lozinka-${runId}-1` };
}

/** Creates a confirmed user directly (faster than the UI; the UI sign-up is covered separately). */
export async function seedUser(u: E2EUser, locale = 'sr-Latn') {
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email, password: u.password, email_confirm: true, user_metadata: { display_name: u.name, locale },
  });
  if (error) throw error;
  u.id = data.user!.id;
  return u;
}

/** Signs in as the user and returns a client acting as them (RLS applies). */
export async function clientFor(u: E2EUser) {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw error;
  return c;
}

export async function login(page: Page, u: E2EUser) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Lozinka', { exact: true }).fill(u.password);
  await page.getByRole('button', { name: 'Prijavi se' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function newPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

export function toast(page: Page, text: string | RegExp) {
  return page.locator('[role=status], [role=alert]').filter({ hasText: text }).first();
}
