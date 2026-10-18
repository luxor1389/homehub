import { test, expect } from '@playwright/test';
import { clientFor, login, newUser, seedUser, toast } from './helpers';

const milan = newUser('Milan');

test.beforeAll(async () => {
  await seedUser(milan);
  const c = await clientFor(milan);
  const { error } = await c.rpc('create_household', { p_name: 'Mobilni stan' });
  if (error) throw error;
});

test('mobile: bottom navigation, quick add button and no horizontal scroll', async ({ page }) => {
  await login(page, milan);
  await expect(page.locator(':text("Mobilni stan"):visible').first()).toBeVisible();

  const bottomNav = page.getByRole('navigation', { name: 'Glavna navigacija' }).last();
  await expect(bottomNav).toBeVisible();
  await bottomNav.getByRole('link', { name: 'Kupovina' }).click();
  await expect(page).toHaveURL(/\/shopping/);

  // floating "+" opens the task editor from any page
  await page.getByRole('button', { name: 'Novi zadatak' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#task-title').fill('Izneti smeće');
  await dialog.getByRole('button', { name: 'Sačuvaj' }).click();
  await expect(toast(page, 'Zadatak je napravljen.')).toBeVisible();

  await bottomNav.getByRole('link', { name: 'Zadaci' }).click();
  await expect(page.getByTestId('task-card').filter({ hasText: 'Izneti smeće' })).toBeVisible();

  // "More" sheet reaches the other modules
  await bottomNav.getByRole('button', { name: 'Više' }).click();
  await page.getByRole('dialog', { name: 'Više' }).getByRole('link', { name: 'Biljke' }).click();
  await expect(page).toHaveURL(/\/plants/);

  for (const path of ['/', '/tasks', '/calendar', '/shopping', '/meals', '/budget', '/vehicles', '/pets', '/plants', '/settings', '/notifications']) {
    await page.goto(path);
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal scroll on ${path}`).toBeLessThanOrEqual(1);
  }
});
