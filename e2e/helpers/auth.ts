import { Page, expect } from '@playwright/test';

export async function loginAsSuperAdmin(page: Page): Promise<void> {
  const email = process.env.TEST_SUPER_ADMIN_EMAIL;
  const password = process.env.TEST_SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('TEST_SUPER_ADMIN_EMAIL e TEST_SUPER_ADMIN_PASSWORD devono essere settati nell\'ambiente.');
  }
  await page.goto('/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await Promise.all([
    page.waitForURL('**/customers', { timeout: 15_000 }),
    page.locator('button[type=submit]').click(),
  ]);
  await expect(page).toHaveURL(/\/customers$/);
}
