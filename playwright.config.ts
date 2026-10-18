import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run the built app against a disposable Supabase stack (local harness or `supabase start`).
// Required env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (service key is used only by the
// Node test process to create test users; it is never passed to the browser build).
const url = process.env.SUPABASE_URL ?? 'http://localhost:54321';
const anon = process.env.SUPABASE_ANON_KEY ?? '';
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'sr-RS',
    timezoneId: 'Europe/Belgrade',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', testMatch: /flows\.spec\.ts/, use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } },
    { name: 'mobile', testMatch: /mobile\.spec\.ts/, use: { ...devices['Pixel 7'], launchOptions: { executablePath } } },
  ],
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anon, VITE_REALTIME_FALLBACK_POLL_MS: '2000' },
  },
});
