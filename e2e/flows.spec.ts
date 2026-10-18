import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { clientFor, login, newUser, seedUser, toast } from './helpers';

// One household (Ana = admin, Bojan, Ceca) and one outsider (Dragan) with his own household.
// The steps build on each other, so they run in order.
test.describe.configure({ mode: 'serial' });

const ana = newUser('Ana');
const bojan = newUser('Bojan');
const ceca = newUser('Ceca');
const dragan = newUser('Dragan');
const TASK = 'Usisati dnevnu sobu';

let ctx: Record<string, { context: BrowserContext; page: Page }> = {};
let inviteLink = '';
let taskUrl = '';

test.beforeAll(async ({ browser }) => {
  await Promise.all([seedUser(bojan), seedUser(ceca), seedUser(dragan)]);
  const d = await clientFor(dragan);
  const { error } = await d.rpc('create_household', { p_name: 'Draganov stan' });
  if (error) throw error;
  for (const name of ['ana', 'bojan', 'ceca', 'dragan']) {
    const context = await browser.newContext();
    ctx[name] = { context, page: await context.newPage() };
  }
});
test.afterAll(async () => {
  await Promise.all(Object.values(ctx).map((c) => c.context.close()));
  ctx = {};
});

test('sign up through the UI, create a household and an invitation link', async () => {
  const { page } = ctx.ana;
  await page.goto('/register');
  await page.getByLabel('Ime koje vide ukućani').fill(ana.name);
  await page.getByLabel('Email').fill(ana.email);
  await page.getByLabel('Lozinka', { exact: true }).fill(ana.password);
  await page.getByLabel('Ponovi lozinku').fill(ana.password);
  await page.getByRole('button', { name: 'Napravi nalog' }).click();

  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.getByRole('heading', { name: `Zdravo, ${ana.name}!` })).toBeVisible();
  await page.getByLabel('Naziv domaćinstva').fill('Stan u Beogradu');
  await page.getByRole('button', { name: 'Napravi domaćinstvo' }).click();
  await expect(page).toHaveURL(/\/settings\?tab=members/);
  await expect(page.getByText('Stan u Beogradu').first()).toBeVisible();

  await page.getByRole('spinbutton', { name: 'Broj korišćenja' }).fill('2');
  await page.getByRole('button', { name: 'Napravi link' }).click();
  const link = page.getByRole('textbox', { name: 'Link pozivnice' });
  await expect(link).toHaveValue(/\/join\/[a-f0-9]{64}$/);
  inviteLink = await link.inputValue();
  await page.getByRole('button', { name: 'Zatvori' }).last().click();
  await expect(page.getByText('Iskorišćeno 0/2')).toBeVisible();
});

test('two members join through the link; a third use is refused', async () => {
  for (const [u, key] of [[bojan, 'bojan'], [ceca, 'ceca']] as const) {
    const { page } = ctx[key];
    await login(page, u);
    await expect(page).toHaveURL(/\/welcome/);
    await page.goto(new URL(inviteLink).pathname);
    await expect(page.getByText(`${ana.name} te poziva u domaćinstvo „Stan u Beogradu”.`)).toBeVisible();
    await page.getByRole('button', { name: 'Pridruži se' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Stan u Beogradu').first()).toBeVisible();
  }
  // the outsider can't use the exhausted link
  const { page } = ctx.dragan;
  await login(page, dragan);
  await page.goto(new URL(inviteLink).pathname);
  await expect(page.getByText('Pozivnica je već iskorišćena.')).toBeVisible();
});

test('quick add a task assigned to Bojan; Bojan is notified and completes it', async () => {
  const a = ctx.ana.page;
  await a.goto('/');
  await a.getByRole('button', { name: 'Novi zadatak' }).first().click();
  const dialog = a.getByRole('dialog');
  await dialog.locator('#task-title').fill(TASK);
  await dialog.getByRole('button', { name: bojan.name }).click();
  await expect(dialog.getByRole('button', { name: bojan.name })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Sačuvaj' }).click();
  await expect(toast(a, 'Zadatak je napravljen.')).toBeVisible();

  const b = ctx.bojan.page;
  await b.goto('/notifications');
  await expect(b.getByText(`Dodeljen ti je zadatak „${TASK}”.`)).toBeVisible();
  // also "due soon" (due today) and "Ceca joined" are expected here
  await expect(b.getByText(`${ceca.name} se pridružio/la domaćinstvu.`)).toBeVisible();
  await expect(b.getByTestId('unread-count')).toHaveText('3');
  await b.getByRole('button', { name: 'Označi sve kao pročitano' }).click();
  await expect(b.getByTestId('unread-count')).toHaveCount(0);

  await b.goto('/tasks');
  const card = b.getByTestId('task-card').filter({ hasText: TASK });
  await expect(card).toBeVisible();
  await card.getByRole('link', { name: TASK }).click();
  taskUrl = new URL(b.url()).pathname;
  await b.goBack();
  await card.getByRole('button', { name: 'Završi' }).click();
  await expect(toast(b, 'Zadatak je završen.')).toBeVisible();

  // Ana sees who completed it (fetched fresh, no realtime needed)
  await a.goto(taskUrl);
  await expect(a.getByText('Završeno').first()).toBeVisible();
  await expect(a.getByText(new RegExp(`${bojan.name} · `)).first()).toBeVisible();
});

test('shopping: duplicate is detected and merged into one item', async () => {
  const a = ctx.ana.page;
  await a.goto('/shopping');
  await a.locator('#item-name').fill('Mleko');
  await a.locator('#item-qty').fill('1');
  await a.locator('#item-unit').selectOption('l');
  await a.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await expect(a.getByTestId('shopping-item').filter({ hasText: 'Mleko' })).toBeVisible();

  const c = ctx.ceca.page;
  await c.goto('/shopping');
  await c.locator('#item-name').fill('  mleko ');
  await c.locator('#item-qty').fill('1');
  await c.locator('#item-unit').selectOption('l');
  await c.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await expect(c.getByRole('dialog').getByText('„  mleko ” je već na spisku', { exact: false }).or(c.getByRole('dialog').getByText('je već na spisku'))).toBeVisible();
  await c.getByRole('dialog').getByRole('button', { name: 'Povećaj' }).click();
  await expect(toast(c, 'Količina postojeće stavke je povećana.')).toBeVisible();

  await a.reload();
  const items = a.getByTestId('shopping-item').filter({ hasText: /mleko/i });
  await expect(items).toHaveCount(1);
  await expect(items).toContainText('2');
});

test('offline: a change is refused with a clear message, nothing fake is shown as saved', async () => {
  const { page, context } = ctx.bojan;
  await page.goto('/shopping');
  await expect(page.getByTestId('shopping-item').first()).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('Nema internet veze. Podaci možda nisu ažurni')).toBeVisible();
  await page.locator('#item-name').fill('Hleb');
  await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await expect(page.getByText('Nema internet veze. Izmena nije sačuvana.').first()).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByTestId('shopping-item').filter({ hasText: 'Mleko' })).toBeVisible();
  await expect(page.getByTestId('shopping-item').filter({ hasText: 'Hleb' })).toHaveCount(0);
});

test('an outsider cannot see another household’s task or shopping list', async () => {
  const d = ctx.dragan.page;
  await d.goto('/');
  await expect(d.getByText('Draganov stan').first()).toBeVisible();
  await d.goto(taskUrl);
  await expect(d.getByText('Nije pronađeno ili ti nije dostupno.')).toBeVisible();
  await expect(d.getByText(TASK)).toHaveCount(0);
  await d.goto('/shopping');
  await expect(d.getByText('Spisak je prazan.')).toBeVisible();
  await expect(d.getByTestId('shopping-item')).toHaveCount(0);
});

test('language is saved per user', async () => {
  const c = ctx.ceca.page;
  await c.goto('/settings');
  await c.getByLabel('Jezik').selectOption('en');
  await c.getByRole('button', { name: 'Sačuvaj' }).click();
  await expect(c.getByRole('link', { name: 'Tasks' }).first()).toBeVisible();
  // other users keep Serbian
  await ctx.ana.page.goto('/');
  await expect(ctx.ana.page.getByRole('link', { name: 'Zadaci' }).first()).toBeVisible();
  // and Ceca gets English again after signing in on a fresh device
  const fresh = await ctx.ceca.context.browser()!.newContext();
  const p = await fresh.newPage();
  await login(p, ceca);
  await expect(p.getByRole('link', { name: 'Tasks' }).first()).toBeVisible();
  await fresh.close();
});

test('admin removes a member; the member loses access immediately', async () => {
  const a = ctx.ana.page;
  await a.goto('/settings?tab=members');
  const row = a.getByRole('listitem').filter({ hasText: ceca.name }).filter({ has: a.getByRole('button', { name: 'Ukloni iz domaćinstva' }) });
  await row.getByRole('button', { name: 'Ukloni iz domaćinstva' }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Potvrdi' }).click();
  await expect(toast(a, 'Član je uklonjen.')).toBeVisible();

  const c = ctx.ceca.page;
  await c.goto('/');
  await expect(c).toHaveURL(/\/welcome/);
  await c.goto(taskUrl);
  await expect(c).toHaveURL(/\/welcome/);
});

test('a regular member cannot change household settings or create invitations', async () => {
  const b = ctx.bojan.page;
  await b.goto('/settings?tab=household');
  await expect(b.getByLabel('Naziv domaćinstva')).toBeDisabled();
  await b.goto('/settings?tab=members');
  await expect(b.getByText('Pozivnice pravi administrator domaćinstva.')).toBeVisible();
  // and the database refuses it even when the UI is bypassed
  const client = await clientFor(bojan);
  const { data: hh } = await client.from('households').select('id').limit(1).single();
  const res = await client.rpc('create_invitation', { p_household: hh!.id });
  expect(res.error?.message).toBe('admin_required');
});

