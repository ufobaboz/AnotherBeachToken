import { chromium } from '@playwright/test';
import { loginAsSuperAdmin } from './helpers/auth';

// Belt-and-suspenders sopra i cleanup nei `finally` di ogni test: se uno e'
// stato saltato per fallimento precoce, qui chiamiamo il bulk cleanup di
// e2e-cleanup (DEV-only). Senza credenziali super_admin saltiamo silently.
export default async function globalTeardown(): Promise<void> {
  const email = process.env.TEST_SUPER_ADMIN_EMAIL;
  const password = process.env.TEST_SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('[globalTeardown] skip: TEST_SUPER_ADMIN_EMAIL/PASSWORD non settati');
    return;
  }
  const APP_URL = process.env.APP_URL || 'https://anotherbeachproject-dev.sovereto.workers.dev';
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: APP_URL });
    const page = await context.newPage();
    try {
      await loginAsSuperAdmin(page);
      const resp = await page.evaluate(async () => {
        return await window.Auth.callEdgeFunction('e2e-cleanup', {});
      });
      if (resp.status !== 200) {
        console.warn('[globalTeardown] e2e-cleanup non OK:', JSON.stringify(resp));
      } else {
        console.log('[globalTeardown] e2e-cleanup bulk ok:', JSON.stringify(resp.body));
      }
    } finally {
      await page.close();
      await context.close();
    }
  } catch (e) {
    console.warn('[globalTeardown] errore:', e);
  } finally {
    await browser.close();
  }
}
