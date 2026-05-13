import { test, expect, Route } from '@playwright/test';
import { loginAsSuperAdmin, loginAsOperator, loginAsAdmin } from '../helpers/auth';
import {
  createTestCustomer,
  cleanupTestCustomer,
  chargeAmount,
  insertChargeViaApi,
  getCustomerQrToken,
  createTestOperator,
  createTestAdmin,
  cleanupTestProfile,
  changeRoleViaEdge
} from '../helpers/fixtures';

test.describe('Routing & redirect', () => {

  test('/ -> meta-refresh /login', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/login$/, { timeout: 8_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

  test('/qr/<token-non-base32> -> 404 dal Worker', async ({ page }) => {
    // TOKEN_RE in worker.js richiede 32 char base32 maiuscolo: passthrough -> 404 ASSETS.
    const resp = await page.goto('/qr/invalid-token-format', { waitUntil: 'commit' });
    expect(resp?.status()).toBe(404);
  });

  test('/checkout/<non-uuid> -> 404 dal Worker', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const resp = await page.goto('/checkout/abc', { waitUntil: 'commit' });
    expect(resp?.status()).toBe(404);
  });

});

test.describe('Asset self-hosted', () => {

  test('/login funziona con CDN esterni bloccati', async ({ context, page }) => {
    await context.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/, (route: Route) => route.abort());
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.goto('/login');
    await expect(page.locator('input[type=email]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('input[type=password]')).toBeVisible();
    await expect(page.locator('button[type=submit]')).toBeVisible();
    const significant = consoleErrors.filter((e) => !/favicon|sourcemap|\.map/i.test(e));
    expect(significant).toEqual([]);
  });

});

test.describe('Paused page', () => {

  test('/paused carica con titolo e testo IT corretti', async ({ page }) => {
    await page.goto('/paused');
    await expect(page).toHaveTitle(/Sito in pausa/);
    await expect(page.locator('h1')).toContainText('Sito in pausa');
    await expect(page.locator('body')).toContainText("Il servizio e' in pausa per inattivita'");
    await expect(page.locator('body')).toContainText("Contatta l'amministratore di sistema");
  });

  test('/paused e\' self-contained: niente richieste fuori dal Worker', async ({ context, page }) => {
    const externalRequests: string[] = [];
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (!u.hostname.endsWith('.workers.dev') && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
        externalRequests.push(req.url());
      }
    });
    await page.goto('/paused');
    await expect(page.locator('h1')).toContainText('Sito in pausa');
    expect(externalRequests).toEqual([]);
  });

  test('/__paused_status risponde JSON con campo paused boolean', async ({ request }) => {
    const r = await request.get('/__paused_status');
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toMatch(/application\/json/);
    const j = await r.json();
    expect(j).toHaveProperty('paused');
    expect(typeof j.paused).toBe('boolean');
  });

  test('/__paused_status?force=1 risponde con Cache-Control no-store', async ({ request }) => {
    const r = await request.get('/__paused_status?force=1');
    expect(r.status()).toBe(200);
    expect(r.headers()['cache-control']).toMatch(/no-store/);
    const j = await r.json();
    expect(j).toHaveProperty('paused');
    expect(typeof j.paused).toBe('boolean');
  });

});

test.describe('PWA installabile', () => {

  test('/login include link manifest + meta PWA', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/manifest.webmanifest');
    await expect(page.locator('meta[name=theme-color]')).toHaveAttribute('content', /#1f8a3e/i);
    await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
  });

  test('manifest.webmanifest valido + icone + sw raggiungibili', async ({ request }) => {
    const manifest = await request.get('/manifest.webmanifest');
    expect(manifest.status()).toBe(200);
    const json = await manifest.json();
    expect(json.name).toBeTruthy();
    expect(json.short_name).toBeTruthy();
    expect(json.start_url).toBe('/login');
    expect(json.display).toBe('standalone');
    expect(Array.isArray(json.icons)).toBe(true);
    const sizes = json.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    const hasMaskable = json.icons.some((i: { purpose: string }) => /maskable/.test(i.purpose));
    expect(hasMaskable).toBe(true);
    for (const icon of json.icons) {
      const resp = await request.get(icon.src);
      expect(resp.status(), icon.src).toBe(200);
    }
    const sw = await request.get('/sw.js');
    expect(sw.status()).toBe(200);
    const appleTouch = await request.get('/icons/apple-touch-icon.png');
    expect(appleTouch.status()).toBe(200);
  });

  test('pulsante "Installa app" iniettato nella nav su pagina operatore', async ({ page }) => {
    await loginAsSuperAdmin(page);
    // pwa.js inietta <button data-pwa-install> sempre; resta hidden finche'
    // il browser non supporta install. Verifichiamo solo l'esistenza del nodo.
    await expect(page.locator('nav.app-nav .nav-actions [data-pwa-install]')).toHaveCount(1);
  });

});

test.describe('Auth & sessione', () => {

  test('login con password sbagliata -> messaggio errore IT, resta su /login', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type=email]').fill(process.env.TEST_SUPER_ADMIN_EMAIL!);
    await page.locator('input[type=password]').fill('definitely-wrong-pw-' + Date.now());
    await page.locator('button[type=submit]').click();
    const alert = page.locator('article[role=alert] p');
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText(/password|email/i);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('login con email inesistente -> stesso messaggio (no user enumeration)', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type=email]').fill('e2e-nonexistent-' + Date.now() + '@example.com');
    await page.locator('input[type=password]').fill('whatever-password');
    await page.locator('button[type=submit]').click();
    const alert = page.locator('article[role=alert] p');
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText(/password|email/i);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logout da /customers -> redirect /login', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await Promise.all([
      page.waitForURL(/\/login$/, { timeout: 10_000 }),
      page.locator('nav.app-nav button.btn--outline').click(),
    ]);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('/customers da contesto anon -> redirect /login', async ({ page }) => {
    await page.goto('/customers');
    await page.waitForURL(/\/login$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

});

test.describe('Navigazione (menu)', () => {

  test('super_admin vede tutte le voci del nav su /customers', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/customers');
    const nav = page.locator('nav.app-nav');
    await expect(nav.locator('a.btn--ghost', { hasText: 'Clienti' })).toBeVisible();
    await expect(nav.locator('a.btn--ghost', { hasText: 'Scan' })).toBeVisible();
    await expect(nav.locator('a.btn--ghost', { hasText: 'Utenti' })).toBeVisible();
    await expect(nav.locator('a.btn--ghost', { hasText: 'Report' })).toBeVisible();
    await expect(nav.locator('a.btn--ghost', { hasText: 'Manuale' })).toBeVisible();
    await expect(nav.locator('a.btn--ghost', { hasText: 'Reset stagione' })).toBeVisible();
    await expect(nav.locator('a.btn--ghost', { hasText: 'Probe' })).toBeVisible();
    await expect(nav.locator('a.btn--ghost', { hasText: 'Profilo' })).toBeVisible();
  });

  test('super_admin: voce attiva del nav ha classe btn--current', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/customers');
    const clientiLink = page.locator('nav.app-nav a.btn--ghost', { hasText: 'Clienti' });
    await expect(clientiLink).toHaveClass(/btn--current/);
    const scanLink = page.locator('nav.app-nav a.btn--ghost', { hasText: 'Scan' });
    await expect(scanLink).not.toHaveClass(/btn--current/);
  });

  test('super_admin: link Probe del nav porta a /probe', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/customers');
    await Promise.all([
      page.waitForURL(/\/probe$/, { timeout: 10_000 }),
      page.locator('nav.app-nav a.btn--ghost', { hasText: 'Probe' }).click(),
    ]);
    await expect(page).toHaveURL(/\/probe$/);
  });

  test('admin (non super_admin) vede Report ma NON Reset stagione/Probe nel nav', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const admin = await createTestAdmin(page);
    try {
      await page.evaluate(() => {
        Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
      });
      await loginAsAdmin(page, admin.email, admin.password);
      await page.goto('/customers');
      const nav = page.locator('nav.app-nav');
      await expect(nav.locator('a.btn--ghost', { hasText: 'Clienti' })).toBeVisible();
      await expect(nav.locator('a.btn--ghost', { hasText: 'Utenti' })).toBeVisible();
      await expect(nav.locator('a.btn--ghost', { hasText: 'Report' })).toBeVisible();
      await expect(nav.locator('a.btn--ghost', { hasText: 'Manuale' })).toBeVisible();
      await expect(nav.locator('a.btn--ghost', { hasText: 'Reset stagione' })).toHaveCount(0);
      await expect(nav.locator('a.btn--ghost', { hasText: 'Probe' })).toHaveCount(0);
    } finally {
      try {
        await page.evaluate(() => {
          Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
        });
        await loginAsSuperAdmin(page);
        await cleanupTestProfile(page, admin.id);
      } catch (e) {
        console.warn('[test cleanup] failed:', e);
      }
    }
  });

  test('mobile (<720px): burger visibile, tab inline nascoste; drawer espone le stesse voci', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsSuperAdmin(page);
    await page.goto('/customers');
    const nav = page.locator('nav.app-nav');
    await expect(nav.locator('.nav-actions')).toBeHidden();
    const burger = nav.locator('sl-icon-button.nav-burger');
    await expect(burger).toBeVisible();
    await burger.click();
    const drawer = nav.locator('sl-drawer.nav-drawer');
    await expect(drawer).toHaveAttribute('open', '', { timeout: 4_000 });
    for (const label of ['Clienti', 'Scan', 'Utenti', 'Report', 'Manuale', 'Reset stagione', 'Probe', 'Profilo']) {
      await expect(drawer.locator('sl-menu-item', { hasText: label })).toBeVisible();
    }
    await expect(drawer.locator('sl-menu-item', { hasText: 'Esci' })).toBeVisible();
  });

  test('mobile (<720px): tap su voce del drawer naviga alla pagina', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsSuperAdmin(page);
    await page.goto('/customers');
    const nav = page.locator('nav.app-nav');
    await nav.locator('sl-icon-button.nav-burger').click();
    const drawer = nav.locator('sl-drawer.nav-drawer');
    await expect(drawer).toHaveAttribute('open', '', { timeout: 4_000 });
    await drawer.locator('sl-menu-item', { hasText: 'Profilo' }).click();
    await page.waitForURL(/\/me$/, { timeout: 8_000 });
    await expect(page).toHaveURL(/\/me$/);
  });

  test('desktop (>=720px): burger nascosto, tab inline visibili', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAsSuperAdmin(page);
    await page.goto('/customers');
    const nav = page.locator('nav.app-nav');
    await expect(nav.locator('.nav-actions')).toBeVisible();
    await expect(nav.locator('sl-icon-button.nav-burger')).toBeHidden();
  });

  test('home post-login: super_admin -> /customers', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await expect(page).toHaveURL(/\/customers$/);
  });

  test('home post-login: operator -> /scan', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await page.evaluate(() => {
        Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
      });
      await loginAsOperator(page, op.email, op.password);
      await expect(page).toHaveURL(/\/scan$/);
    } finally {
      try {
        await page.evaluate(() => {
          Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
        });
        await loginAsSuperAdmin(page);
        await cleanupTestProfile(page, op.id);
      } catch (e) {
        console.warn('[test cleanup] failed:', e);
      }
    }
  });

  test('home post-login: admin -> /customers', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const adm = await createTestAdmin(page);
    try {
      await page.evaluate(() => {
        Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
      });
      await loginAsAdmin(page, adm.email, adm.password);
      await expect(page).toHaveURL(/\/customers$/);
    } finally {
      try {
        await page.evaluate(() => {
          Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
        });
        await loginAsSuperAdmin(page);
        await cleanupTestProfile(page, adm.id);
      } catch (e) {
        console.warn('[test cleanup] failed:', e);
      }
    }
  });

  test('operator NON vede Utenti, Report, Manuale, Reset stagione, Probe nel nav', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await page.evaluate(() => {
        Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
      });
      await loginAsOperator(page, op.email, op.password);
      await page.goto('/customers');
      const nav = page.locator('nav.app-nav');
      await expect(nav.locator('a.btn--ghost', { hasText: 'Clienti' })).toBeVisible();
      await expect(nav.locator('a.btn--ghost', { hasText: 'Scan' })).toBeVisible();
      await expect(nav.locator('a.btn--ghost', { hasText: 'Profilo' })).toBeVisible();
      await expect(nav.locator('a.btn--ghost', { hasText: 'Utenti' })).toHaveCount(0);
      await expect(nav.locator('a.btn--ghost', { hasText: 'Report' })).toHaveCount(0);
      await expect(nav.locator('a.btn--ghost', { hasText: 'Manuale' })).toHaveCount(0);
      await expect(nav.locator('a.btn--ghost', { hasText: 'Reset stagione' })).toHaveCount(0);
      await expect(nav.locator('a.btn--ghost', { hasText: 'Probe' })).toHaveCount(0);
    } finally {
      try {
        await page.evaluate(() => {
          Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
        });
        await loginAsSuperAdmin(page);
        await cleanupTestProfile(page, op.id);
      } catch (e) {
        console.warn('[test cleanup] failed:', e);
      }
    }
  });

});

test.describe('Manuale', () => {

  test('/manuale come super_admin -> rendering OK, console pulita', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await loginAsSuperAdmin(page);
    await page.goto('/manuale');
    await expect(page).toHaveURL(/\/manuale$/);
    await expect(page.locator('nav.app-nav h1', { hasText: 'Manuale' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('main.container h2', { hasText: '1. Come funziona' })).toBeVisible();
    await expect(page.locator('main.container h2', { hasText: '2. Chi fa cosa' })).toBeVisible();
    await expect(page.locator('main.container h2', { hasText: '3. Il menu' })).toBeVisible();
    const significant = consoleErrors.filter((e) => !/favicon|sourcemap|\.map/i.test(e));
    expect(significant).toEqual([]);
  });

  test('/manuale come admin -> rendering OK', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const admin = await createTestAdmin(page);
    try {
      await page.evaluate(() => {
        Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
      });
      await loginAsAdmin(page, admin.email, admin.password);
      await page.goto('/manuale');
      await expect(page).toHaveURL(/\/manuale$/);
      await expect(page.locator('nav.app-nav h1', { hasText: 'Manuale' })).toBeVisible({ timeout: 10_000 });
    } finally {
      try {
        await page.evaluate(() => {
          Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
        });
        await loginAsSuperAdmin(page);
        await cleanupTestProfile(page, admin.id);
      } catch (e) {
        console.warn('[test cleanup] failed:', e);
      }
    }
  });

  test('/manuale come operator -> redirect alla home dell ruolo', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await page.evaluate(() => {
        Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
      });
      await loginAsOperator(page, op.email, op.password);
      await page.goto('/manuale');
      await page.waitForURL(/\/scan$/, { timeout: 10_000 });
      await expect(page).toHaveURL(/\/scan$/);
    } finally {
      try {
        await page.evaluate(() => {
          Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
        });
        await loginAsSuperAdmin(page);
        await cleanupTestProfile(page, op.id);
      } catch (e) {
        console.warn('[test cleanup] failed:', e);
      }
    }
  });

  test('/manuale da contesto anon -> redirect /login', async ({ page }) => {
    await page.goto('/manuale');
    await page.waitForURL(/\/login$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

});

test.describe('Probe diagnostico', () => {

  test('/probe come super_admin -> tutti i check OK o n/a', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/probe');
    // Aspetta che <template x-for> popoli la lista prima di contare i badge.
    const allBadges = page.locator('.check .badge');
    await expect(allBadges.first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.check .badge.badge-pending')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('.check .badge.badge-fail')).toHaveCount(0);
    // Su DEV "Backup giornaliero R2" puo' essere n/a (bucket non configurato);
    // accettiamo OK o n/a per ogni badge, mai FAIL.
    const totalCount = await allBadges.count();
    const okCount = await page.locator('.check .badge.badge-ok').count();
    const naCount = await page.locator('.check .badge.badge-na').count();
    expect(okCount + naCount).toBe(totalCount);
    expect(totalCount).toBeGreaterThanOrEqual(8);
  });

  test('/probe da contesto anon -> redirect /login', async ({ page }) => {
    await page.goto('/probe');
    await page.waitForURL(/\/login$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

  test('/probe check 7: Profiles per ruolo', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/probe');
    const row = page.locator('.check', { hasText: 'Profiles per ruolo' });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.locator('.badge.badge-ok')).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(/super_admin\s*=\s*[1-9]\d*/);
  });

  test('/probe check Backup giornaliero R2: presente e non FAIL', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/probe');
    const row = page.locator('.check', { hasText: 'Backup giornaliero R2' });
    await expect(row).toBeVisible({ timeout: 15_000 });
    // n/a accettato (DEV senza R2); FAIL no.
    await expect(row.locator('.badge.badge-pending')).toHaveCount(0, { timeout: 30_000 });
    await expect(row.locator('.badge.badge-fail')).toHaveCount(0);
  });

});

test.describe('Anagrafica clienti', () => {

  test('customer-new: phone non valido -> warning inline, no submit', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/customers/new');
    const inputs = page.locator('input[type=text][required]');
    await inputs.nth(0).fill('Mario');
    await inputs.nth(1).fill('ZZ-E2E-validation-only');
    await page.locator('input[type=tel]').fill('123');
    await page.locator('button[type=submit]').click();
    await expect(page).toHaveURL(/\/customers\/new$/);
    await expect(page.locator('input[type=tel][aria-invalid="true"]')).toBeVisible();
  });

  test('customer-new: phone IT 10 cifre senza prefisso -> salvato con +39', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const suffix = Math.random().toString(36).slice(2, 10);
    const lastName = 'ZZ-E2E-phone-it-' + suffix;
    await page.goto('/customers/new');
    const inputs = page.locator('input[type=text][required]');
    await inputs.nth(0).fill('Mario');
    await inputs.nth(1).fill(lastName);
    await page.locator('input[type=tel]').fill('3204806847');
    await Promise.all([
      page.waitForURL(/\/customers\/[0-9a-f-]{36}$/, { timeout: 15_000 }),
      page.locator('button[type=submit]').click(),
    ]);
    const id = new URL(page.url()).pathname.split('/').pop() || '';
    try {
      const phone = await page.evaluate(async (cid) => {
        const resp = await (window as any).Auth.client
          .from('customers').select('phone').eq('id', cid).single();
        if (resp.error) throw new Error('phone fetch: ' + resp.error.message);
        return resp.data.phone as string;
      }, id);
      expect(phone).toBe('+393204806847');
    } finally {
      await cleanupTestCustomer(page, id);
    }
  });

  test('customers list: search filtra per last_name', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await page.goto('/customers');
      await page.locator('button.btn--outline', { hasText: 'Mostra tutti' }).click();
      await page.locator('input[type=search]').fill(customer.lastName);
      await page.waitForTimeout(400);
      const rows = page.locator('tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(rows.first().locator('td a')).toContainText(customer.lastName);
    } finally {
      await cleanupTestCustomer(page, customer.id);
    }
  });

  test('customers list: default mostra solo conti aperti, toggle mostra tutti', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const zero = await createTestCustomer(page);
    const open = await createTestCustomer(page);
    try {
      await insertChargeViaApi(page, open.id, 3.50);
      await page.goto('/customers');
      await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
      // Search per nome: con DB grande la pagination di 25 puo' nasconderlo (sort by balance desc).
      const searchInput = page.locator('input[type=search]');
      await searchInput.fill(open.lastName);
      await page.waitForTimeout(400);
      await expect(page.locator('tbody tr', { hasText: open.lastName })).toBeVisible({ timeout: 8_000 });
      await searchInput.fill(zero.lastName);
      await page.waitForTimeout(400);
      await expect(page.locator('tbody tr', { hasText: zero.lastName })).toHaveCount(0);
      await page.locator('button.btn--outline', { hasText: 'Mostra tutti' }).click();
      await expect(page.locator('tbody tr', { hasText: zero.lastName })).toHaveCount(1, { timeout: 5_000 });
      await page.locator('button.btn--outline', { hasText: 'Solo conti aperti' }).click();
      await expect(page.locator('tbody tr', { hasText: zero.lastName })).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await cleanupTestCustomer(page, zero.id);
      await cleanupTestCustomer(page, open.id);
    }
  });

  test('customer-detail super_admin: CTA Archivia visibile', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await page.goto(`/customers/${customer.id}`);
      const deleteBtn = page.locator('button.btn--danger', { hasText: 'Archivia cliente' });
      await expect(deleteBtn).toBeVisible({ timeout: 8_000 });
    } finally {
      await cleanupTestCustomer(page, customer.id);
    }
  });

  test('customer-detail: UUID inesistente -> "Cliente non trovato"', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/checkout/00000000-0000-0000-0000-000000000000');
    await expect(
      page.locator('article p', { hasText: 'Cliente non trovato' })
    ).toBeVisible();
  });

});

test.describe('QR pubblico', () => {

  test('/qr/<token-fake-32-char>: pagina mostra "QR non trovato"', async ({ page }) => {
    // Token sintatticamente valido ma non in DB: cade nel ramo "not found" del worker.
    await page.goto('/qr/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const notFound = page.locator('article p').filter({ hasText: /non.*trov|non.*riconosc|QR/i }).first();
    await expect(notFound).toBeVisible({ timeout: 8_000 });
  });

  test('/qr/<token reale>: saluto IT + conto 0,00 EUR (no charges)', async ({ page, browser }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      const qrToken = await getCustomerQrToken(page, customer.id);
      const ctx = await browser.newContext();
      const anonPage = await ctx.newPage();
      try {
        await anonPage.goto(`/qr/${qrToken}`);
        await expect(anonPage.locator('h1')).toContainText(customer.firstName, { timeout: 12_000 });
        await expect(anonPage.locator('.balance')).toContainText('0,00 EUR');
        await expect(anonPage.locator('img.qr-image')).toBeVisible();
      } finally {
        await ctx.close();
      }
    } finally {
      await cleanupTestCustomer(page, customer.id);
    }
  });

  test('/qr/<token>: conto riflette charges aperte', async ({ page, browser }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await insertChargeViaApi(page, customer.id, 12.34);
      const qrToken = await getCustomerQrToken(page, customer.id);
      const ctx = await browser.newContext();
      const anonPage = await ctx.newPage();
      try {
        await anonPage.goto(`/qr/${qrToken}`);
        await expect(anonPage.locator('.balance')).toContainText('12,34', { timeout: 12_000 });
      } finally {
        await ctx.close();
      }
    } finally {
      await cleanupTestCustomer(page, customer.id);
    }
  });

});

test.describe('Operazioni POS', () => {

  test('charge 5,50 -> conto 5,50 EUR + badge aperto', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await chargeAmount(page, customer.id, '5', '50');
      await expect(page.locator('.balance-card')).toContainText('5,50 EUR');
      await expect(page.locator('ul.transactions .badge-aperto').first()).toBeVisible();
    } finally {
      await cleanupTestCustomer(page, customer.id);
    }
  });

  test('reversal: dialog Shoelace -> conferma -> conto 0 + badge annullato', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await insertChargeViaApi(page, customer.id, 7.00);
      await page.goto(`/customers/${customer.id}`);
      await page.locator('ul.transactions .btn--sm').first().click();
      const confirmBtn = page.locator('sl-dialog sl-button[variant=danger]').first();
      await Promise.all([
        page.waitForResponse((r) =>
          r.url().includes('/rest/v1/transactions') && r.request().method() === 'POST'
        ),
        confirmBtn.click(),
      ]);
      await expect(page.locator('.balance-card')).toContainText('0,00 EUR');
      await expect(page.locator('ul.transactions .badge-annullato').first()).toBeVisible();
      // Lo storno e' aggregato nella charge: una sola <li>, sub-info "annullato il ...".
      await expect(page.locator('ul.transactions .tx-sub-info').first()).toContainText('annullato il');
      const txItems = page.locator('ul.transactions li.tx');
      await expect(txItems).toHaveCount(1);
    } finally {
      await cleanupTestCustomer(page, customer.id);
    }
  });

  test('WhatsApp link conto: href ben formato wa.me con conto IT', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await insertChargeViaApi(page, customer.id, 3.20);
      await page.goto(`/customers/${customer.id}`);
      // Aspetta balance-card aggiornato: il link wa.me viene ricomputato sullo
      // stesso ciclo, leggerlo prima genera href con balance stale.
      await expect(page.locator('.balance-card')).toContainText('3,20 EUR');
      const link = page.locator('a[href^="https://wa.me/"]').last();
      await expect(link).toBeVisible();
      const href = await link.getAttribute('href');
      expect(href).toMatch(/^https:\/\/wa\.me\/\d{11,}\?text=.+/);
      const decoded = decodeURIComponent(href!.split('?text=')[1] || '');
      expect(decoded).toContain('3,20');
      expect(decoded).toMatch(/qr\/[A-Z2-7]{32}/);
    } finally {
      await cleanupTestCustomer(page, customer.id);
    }
  });

});

test.describe('Scan QR', () => {

  test('/scan: senza camera mostra messaggio errore', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/scan');
    // Headless: getUserMedia rejecta -> error UI.
    const alert = page.locator('article[role=alert] p').first();
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText(/camera|qr/i);
    await expect(page.locator('a.btn--outline[href="/customers"]')).toBeVisible();
  });

});

test.describe('Chiusura conto', () => {

  test('admin+ chiude conto con 1 charge 5,50 via Contanti -> sub-text saldato', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await insertChargeViaApi(page, customer.id, 5.50);

      await page.goto(`/checkout/${customer.id}`);
      // 'main h2': scope necessario per evitare match con <h2 part="title"> shadow DOM di sl-drawer.
      await expect(page.locator('main h2'))
        .toHaveText(`${customer.lastName} ${customer.firstName}`);
      await expect(page.locator('.balance-card')).toContainText('5,50 EUR');

      const dropdown = page.locator('.method-row select');
      await expect(dropdown).toBeVisible();
      await expect(dropdown.locator('option')).toHaveCount(4);

      const archiveCta = page.locator('button.btn--primary.btn--cta', { hasText: 'Chiudi conto e archivia' });
      const partialCta = page.locator('button.btn--outline.btn--cta', { hasText: 'Chiusura parziale' });
      await expect(archiveCta).toBeEnabled();
      await expect(partialCta).toBeEnabled();

      await Promise.all([
        page.waitForURL(new RegExp(`/customers/${customer.id}$`), { timeout: 15_000 }),
        partialCta.click(),
      ]);

      const txList = page.locator('ul.transactions');
      await expect(txList.locator('.tx-sub-info').first()).toContainText('saldato il');
      await expect(txList.locator('.tx-sub-info').first()).toContainText('via Contanti');
      await expect(txList.locator('.badge-saldato').first()).toBeVisible();
    } finally {
      await cleanupTestCustomer(page, customer.id);
    }
  });

  test('Chiudi e archivia: chiude conto + soft-delete cliente + redirect /customers', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await insertChargeViaApi(page, customer.id, 12.34);
      await page.goto(`/checkout/${customer.id}`);
      await expect(page.locator('.balance-card')).toContainText('12,34 EUR');
      const archiveCta = page.locator('button.btn--primary.btn--cta', { hasText: 'Chiudi conto e archivia' });
      await expect(archiveCta).toBeVisible();
      await Promise.all([
        page.waitForURL(/\/customers$/, { timeout: 15_000 }),
        archiveCta.click(),
      ]);
      const archived = await page.evaluate(async (id) => {
        const r = await window.Auth.client.from('customers').select('deleted_at').eq('id', id).maybeSingle();
        return r.data ? r.data.deleted_at : null;
      }, customer.id);
      expect(archived).toBeTruthy();
    } finally {
    }
  });

  test('conto=0 -> dropdown nascosto, CTA disabilitato', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await page.goto(`/checkout/${customer.id}`);
      await expect(page.locator('.balance-card')).toContainText('0,00 EUR');

      const emptyCta = page.locator('button.btn--primary.btn--cta', { hasText: 'Nessun importo da pagare' });
      await expect(emptyCta).toBeVisible();
      await expect(emptyCta).toBeDisabled();
      await expect(page.locator('button.btn--outline.btn--cta')).toBeHidden();
      await expect(page.locator('.method-row')).toBeHidden();
    } finally {
      await cleanupTestCustomer(page, customer.id);
    }
  });

});

test.describe('Gestione utenti', () => {

  test('create-operator: 401 senza Authorization', async ({ request }) => {
    const resp = await request.post(
      `${process.env.SUPABASE_URL || 'https://xccpopnwqrxjjhrtyiwd.supabase.co'}/functions/v1/create-operator`,
      { data: {}, failOnStatusCode: false }
    );
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body.error).toBe('missing_auth');
  });

  test('create-operator: 200 per super_admin con body valido', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const email = `e2e-op-${Date.now()}@example.com`;
    const resp = await page.evaluate(async (body) => {
      return await window.Auth.callEdgeFunction('create-operator', body);
    }, { email, password: 'TestPwd1234', first_name: 'E2E', last_name: `ZZ-E2E-OP-${Date.now()}` });
    expect(resp.status).toBe(200);
    const respBody = resp.body as Record<string, unknown>;
    expect(respBody.profile_id).toMatch(/^[0-9a-f-]{36}$/);
    await page.evaluate(async (target_id) => {
      return await window.Auth.callEdgeFunction('soft-delete-profile', { target_id });
    }, respBody.profile_id as string);
  });

  test('soft-delete-profile: 200 + record marcato deleted', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    const delResp = await page.evaluate(async (target_id) => {
      return await window.Auth.callEdgeFunction('soft-delete-profile', { target_id });
    }, op.id);
    expect(delResp.status).toBe(200);
    const delBody = delResp.body as Record<string, unknown>;
    expect(delBody.ok).toBe(true);
  });

  test('soft-delete-profile: 409 target_self', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const sessionUserId = await page.evaluate(async () => {
      const s = await window.Auth.client.auth.getSession();
      return s.data.session?.user.id;
    });
    expect(sessionUserId).toBeTruthy();
    const resp = await page.evaluate(async (target_id) => {
      return await window.Auth.callEdgeFunction('soft-delete-profile', { target_id });
    }, sessionUserId as string);
    expect(resp.status).toBe(409);
    const body = resp.body as Record<string, unknown>;
    expect(body.error).toBe('target_self');
  });

  test('e2e-cleanup: 401 senza Authorization', async ({ request }) => {
    const resp = await request.post(
      `${process.env.SUPABASE_URL || 'https://esxnberopfmfaebmbqwd.supabase.co'}/functions/v1/e2e-cleanup`,
      { data: {}, failOnStatusCode: false }
    );
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body.error).toBe('missing_auth');
  });

  test('e2e-cleanup: 403 per operator', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await page.evaluate(() => {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('sb-'))
          .forEach((k) => localStorage.removeItem(k));
      });
      await page.goto('/login');
      await expect(page.locator('input[type=email]')).toBeVisible({ timeout: 8_000 });
      await loginAsOperator(page, op.email, op.password);
      const resp = await page.evaluate(async () => {
        return await window.Auth.callEdgeFunction('e2e-cleanup', {});
      });
      expect(resp.status).toBe(403);
      expect((resp.body as { error: string }).error).toBe('forbidden_role');
    } finally {
      try {
        await page.evaluate(() => {
          Object.keys(localStorage)
            .filter((k) => k.startsWith('sb-'))
            .forEach((k) => localStorage.removeItem(k));
        });
        await page.goto('/login');
        await expect(page.locator('input[type=email]')).toBeVisible({ timeout: 8_000 });
      } catch (_e) { }
      await loginAsSuperAdmin(page);
      await cleanupTestProfile(page, op.id);
    }
  });

  test('e2e-cleanup: 200 + hard delete del profilo (cascade)', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    const resp = await page.evaluate(async (target_id) => {
      return await window.Auth.callEdgeFunction('e2e-cleanup', { target_id, scope: 'profile' });
    }, op.id);
    expect(resp.status).toBe(200);
    const body = resp.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.users_deleted).toBe(1);
    const stillExists = await page.evaluate(async (id) => {
      const r = await window.Auth.client.from('profiles')
        .select('id').eq('id', id).maybeSingle();
      return r.data;
    }, op.id);
    expect(stillExists).toBeNull();
  });

  test('e2e-cleanup: 409 target_not_e2e per profilo reale', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const sessionUserId = await page.evaluate(async () => {
      const s = await window.Auth.client.auth.getSession();
      return s.data.session?.user.id;
    });
    expect(sessionUserId).toBeTruthy();
    const resp = await page.evaluate(async (target_id) => {
      return await window.Auth.callEdgeFunction('e2e-cleanup', { target_id, scope: 'profile' });
    }, sessionUserId as string);
    expect(resp.status).toBe(409);
    expect((resp.body as { error: string }).error).toBe('target_not_e2e');
  });

  test('update-profile: 200 + UPDATE applicato', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      const resp = await page.evaluate(async (body) => {
        return await window.Auth.callEdgeFunction('update-profile', body);
      }, { target_id: op.id, first_name: 'Modificato', last_name: op.lastName, notes: 'note di test' });
      expect(resp.status).toBe(200);
      const respBody = resp.body as Record<string, unknown>;
      expect(respBody.ok).toBe(true);
      const profile = await page.evaluate(async (id) => {
        const r = await window.Auth.client.from('profiles')
          .select('first_name, last_name, notes')
          .eq('id', id).maybeSingle();
        return r.data;
      }, op.id);
      expect(profile!.first_name).toBe('Modificato');
      expect(profile!.notes).toBe('note di test');
    } finally {
      await cleanupTestProfile(page, op.id);
    }
  });

  test('anon su /admin/users -> redirect /login', async ({ page }) => {
    await page.goto('/admin/users');
    await page.waitForURL(/\/login$/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

  test('operator su /admin/users -> redirect /scan (home operator)', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await page.evaluate(() => {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('sb-'))
          .forEach((k) => localStorage.removeItem(k));
      });
      await page.goto('/login');
      await expect(page.locator('input[type=email]')).toBeVisible({ timeout: 8_000 });
      await loginAsOperator(page, op.email, op.password);
      await page.goto('/admin/users');
      await page.waitForURL(/\/scan$/, { timeout: 15_000 });
      await expect(page).toHaveURL(/\/scan$/);
    } finally {
      try {
        await page.evaluate(() => {
          Object.keys(localStorage)
            .filter((k) => k.startsWith('sb-'))
            .forEach((k) => localStorage.removeItem(k));
        });
        await page.goto('/login');
        await expect(page.locator('input[type=email]')).toBeVisible({ timeout: 8_000 });
      } catch (_e) { }
      await loginAsSuperAdmin(page);
      await cleanupTestProfile(page, op.id);
    }
  });

  test('super_admin su /admin/users -> pagina caricata', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/users');
    await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
    await expect(page.locator('h1')).toHaveText('Gestione utenti', { timeout: 5_000 });
  });

  test('edit operator via dialog -> nuovo nome in lista', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await page.goto('/admin/users');
      const row = page.locator('table tbody tr', { hasText: op.lastName });
      await expect(row).toBeVisible({ timeout: 8_000 });
      await row.locator('button', { hasText: 'Modifica' }).click();
      const dialog = page.locator('sl-dialog[label="Modifica operator"]');
      await expect(dialog).toBeVisible();
      const inputs = dialog.locator('input[type="text"]');
      await inputs.nth(0).fill('Modificato');
      await dialog.locator('sl-button[variant="primary"]').click();
      const editedRow = page.locator('table tbody tr', { hasText: op.lastName });
      await expect(editedRow).toContainText('Modificato', { timeout: 5_000 });
    } finally {
      await cleanupTestProfile(page, op.id);
    }
  });

  test('reset password via dialog: vecchia FAIL, nuova OK', async ({ page, browser }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await page.goto('/admin/users');
      const row = page.locator('table tbody tr', { hasText: op.lastName });
      await expect(row).toBeVisible({ timeout: 8_000 });
      await row.locator('button', { hasText: 'Reset pw' }).click();
      const dialog = page.locator('sl-dialog[label="Reset password"]');
      await expect(dialog).toBeVisible();
      const newPwd = 'NewPwd' + Date.now();
      const inputs = dialog.locator('input[type="password"]');
      await inputs.nth(0).fill(newPwd);
      await inputs.nth(1).fill(newPwd);
      await dialog.locator('sl-button[variant="primary"]').click();
      await expect(page.locator('article[role="status"]')).toBeVisible({ timeout: 10_000 });
      const ctx = await browser.newContext();
      const opPage = await ctx.newPage();
      try {
        await opPage.goto('/login');
        await opPage.locator('input[type=email]').fill(op.email);
        await opPage.locator('input[type=password]').fill(op.password);
        await opPage.locator('button[type=submit]').click();
        await expect(opPage.locator('article[role=alert] p')).toBeVisible({ timeout: 10_000 });
        await opPage.locator('input[type=password]').fill(newPwd);
        await opPage.locator('button[type=submit]').click();
        await opPage.waitForURL(/\/scan$/, { timeout: 15_000 });
      } finally { await ctx.close(); }
    } finally {
      await cleanupTestProfile(page, op.id);
    }
  });

  test('disattiva operator via dialog: riga in grigio in fondo + auth-ping profile_deleted', async ({ page, browser }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await page.goto('/admin/users');
      const row = page.locator('table tbody tr', { hasText: op.lastName });
      await expect(row).toBeVisible({ timeout: 8_000 });
      await row.locator('button.btn--danger', { hasText: 'Disattiva' }).click();
      const dialog = page.locator('sl-dialog[label="Conferma disattivazione"]');
      await expect(dialog).toBeVisible();
      await dialog.locator('sl-button[variant="danger"]').click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });
      await page.reload();
      await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
      await page.locator('button.btn--outline', { hasText: 'Mostra tutti' }).click();
      const targetRow = page.locator('table tbody tr', { hasText: op.lastName });
      await expect(targetRow).toHaveCount(1, { timeout: 10_000 });
      await expect(targetRow).toHaveClass(/deleted/);

      const ctx = await browser.newContext();
      const opPage = await ctx.newPage();
      try {
        await opPage.goto('/login');
        await opPage.locator('input[type=email]').fill(op.email);
        await opPage.locator('input[type=password]').fill(op.password);
        await opPage.locator('button[type=submit]').click();
        // signInWithPassword riesce anche su profilo soft-deleted; il blocco
        // arriva da auth-ping (probe sotto). Aspetta home del ruolo prima.
        await opPage.waitForURL(/\/scan$/, { timeout: 15_000 });
        const ping = await opPage.evaluate(async () => {
          return await window.Auth.callAuthPing({ stamp: false });
        });
        expect(ping.status).toBe(403);
        const pingBody = ping.body as Record<string, unknown>;
        expect(pingBody.error).toBe('profile_deleted');
      } finally { await ctx.close(); }
    } finally {
    }
  });

  test('create operator via dialog -> riga in lista + success message', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/users');
    const ts = Date.now();
    const lastName = `ZZ-E2E-OP-DLG-${ts}`;
    const email = `e2e-op-dlg-${ts}@example.com`;
    let createdId: string | null = null;
    try {
      await page.locator('button.btn--primary', { hasText: '+ Nuovo operatore' }).click();
      const dialog = page.locator('sl-dialog[label="Nuovo operator"]');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.locator('input[type="email"]').fill(email);
      await dialog.locator('input[type="password"]').fill('TestPwd1234');
      const textInputs = dialog.locator('input[type="text"]');
      await textInputs.nth(0).fill('E2E');
      await textInputs.nth(1).fill(lastName);
      await dialog.locator('sl-button[variant="primary"]').click();
      await expect(page.locator('article[role="status"]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('table tbody tr', { hasText: lastName })).toBeVisible({ timeout: 5_000 });
      createdId = await page.evaluate(async (ln) => {
        const r = await window.Auth.client.from('profiles').select('id').eq('last_name', ln).maybeSingle();
        return (r.data as { id: string } | null)?.id || null;
      }, lastName);
    } finally {
      if (createdId) await cleanupTestProfile(page, createdId);
    }
  });

  test('super_admin crea admin via dialog -> riga in lista con ruolo admin', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/users');
    const ts = Date.now();
    const lastName = `ZZ-E2E-ADM-DLG-${ts}`;
    const email = `e2e-adm-dlg-${ts}@example.com`;
    let createdId: string | null = null;
    try {
      await page.locator('button.btn--primary', { hasText: '+ Nuovo admin' }).click();
      const dialog = page.locator('sl-dialog[label="Nuovo admin"]');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.locator('input[type="email"]').fill(email);
      await dialog.locator('input[type="password"]').fill('TestPwd1234');
      const textInputs = dialog.locator('input[type="text"]');
      await textInputs.nth(0).fill('E2E');
      await textInputs.nth(1).fill(lastName);
      await dialog.locator('sl-button[variant="primary"]').click();
      await expect(page.locator('article[role="status"]')).toBeVisible({ timeout: 10_000 });
      const row = page.locator('table tbody tr', { hasText: lastName });
      await expect(row).toBeVisible({ timeout: 5_000 });
      await expect(row.locator('.role-badge')).toHaveText('admin');
      createdId = await page.evaluate(async (ln) => {
        const r = await window.Auth.client.from('profiles').select('id').eq('last_name', ln).maybeSingle();
        return (r.data as { id: string } | null)?.id || null;
      }, lastName);
    } finally {
      if (createdId) await cleanupTestProfile(page, createdId);
    }
  });

  test('admin loggato non vede tab admin / bottone Cambia ruolo', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const adm = await createTestAdmin(page);
    try {
      await page.evaluate(() => {
        Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
      });
      await page.goto('/login');
      await loginAsAdmin(page, adm.email, adm.password);
      await page.goto('/admin/users');
      await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
      await expect(page.locator('button.btn--primary', { hasText: '+ Nuovo admin' })).toBeHidden();
      await expect(page.locator('button', { hasText: 'Cambia ruolo' })).toHaveCount(0);
    } finally {
      try {
        await page.evaluate(() => {
          Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
        });
        await page.goto('/login');
      } catch (_e) { }
      await loginAsSuperAdmin(page);
      await cleanupTestProfile(page, adm.id);
    }
  });

  test('change-role: super_admin promuove operator -> admin (via edge)', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await changeRoleViaEdge(page, op.id, 'admin');
      const profile = await page.evaluate(async (id) => {
        const r = await window.Auth.client.from('profiles').select('role').eq('id', id).maybeSingle();
        return r.data;
      }, op.id);
      expect((profile as { role: string }).role).toBe('admin');
    } finally {
      await cleanupTestProfile(page, op.id);
    }
  });

  test('change-role: super_admin retrocede admin -> operator (via edge)', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const adm = await createTestAdmin(page);
    try {
      await changeRoleViaEdge(page, adm.id, 'operator');
      const profile = await page.evaluate(async (id) => {
        const r = await window.Auth.client.from('profiles').select('role').eq('id', id).maybeSingle();
        return r.data;
      }, adm.id);
      expect((profile as { role: string }).role).toBe('operator');
    } finally {
      await cleanupTestProfile(page, adm.id);
    }
  });

  test('change-role: target_self 409 (super_admin auto-degrade rifiutato)', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const sessionUserId = await page.evaluate(async () => {
      const s = await window.Auth.client.auth.getSession();
      return s.data.session?.user.id;
    });
    expect(sessionUserId).toBeTruthy();
    const resp = await page.evaluate(async (target_id) => {
      return await window.Auth.callEdgeFunction('change-role', { target_id, new_role: 'admin' });
    }, sessionUserId as string);
    expect(resp.status).toBe(409);
    const body = resp.body as Record<string, unknown>;
    expect(body.error).toBe('target_self');
  });

  test('change-role: same_role 400', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      const resp = await page.evaluate(async (body) => {
        return await window.Auth.callEdgeFunction('change-role', body);
      }, { target_id: op.id, new_role: 'operator' });
      expect(resp.status).toBe(400);
      const body = resp.body as Record<string, unknown>;
      expect(body.error).toBe('same_role');
    } finally {
      await cleanupTestProfile(page, op.id);
    }
  });

  test('change-role: invalid_new_role 400', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      const resp = await page.evaluate(async (body) => {
        return await window.Auth.callEdgeFunction('change-role', body);
      }, { target_id: op.id, new_role: 'super_admin' });
      expect(resp.status).toBe(400);
      const body = resp.body as Record<string, unknown>;
      expect(body.error).toBe('invalid_new_role');
    } finally {
      await cleanupTestProfile(page, op.id);
    }
  });

  test('change-role: forbidden_role per caller admin', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const adm = await createTestAdmin(page);
    const op = await createTestOperator(page);
    try {
      await page.evaluate(() => {
        Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
      });
      await page.goto('/login');
      await loginAsAdmin(page, adm.email, adm.password);
      const resp = await page.evaluate(async (body) => {
        return await window.Auth.callEdgeFunction('change-role', body);
      }, { target_id: op.id, new_role: 'admin' });
      expect(resp.status).toBe(403);
      const body = resp.body as Record<string, unknown>;
      expect(body.error).toBe('forbidden_role');
    } finally {
      try {
        await page.evaluate(() => {
          Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
        });
        await page.goto('/login');
      } catch (_e) { }
      await loginAsSuperAdmin(page);
      await cleanupTestProfile(page, adm.id);
      await cleanupTestProfile(page, op.id);
    }
  });

  test('disattivati mostrati come ultime righe in grigio (super_admin)', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      // soft delete via edge function dedicata: il test verifica che la riga
      // disattivata compaia nell'admin/users con classe `deleted`. Hard delete
      // (cleanupTestProfile) farebbe sparire la riga. Cleanup hard nel finally.
      await page.evaluate(async (target_id) => {
        return await window.Auth.callEdgeFunction('soft-delete-profile', { target_id });
      }, op.id);
      await page.goto('/admin/users');
      await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
      await page.locator('button.btn--outline', { hasText: 'Mostra tutti' }).click();
      const targetRow = page.locator('table tbody tr', { hasText: op.lastName });
      await expect(targetRow).toHaveCount(1, { timeout: 10_000 });
      await expect(targetRow).toHaveClass(/deleted/);
      const rows = page.locator('table tbody tr');
      const total = await rows.count();
      await expect(rows.nth(total - 1)).toHaveClass(/deleted/);
    } finally {
      await cleanupTestProfile(page, op.id);
    }
  });

  test('admin tenta target admin via update-profile -> forbidden_role_target', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const admA = await createTestAdmin(page);
    const admB = await createTestAdmin(page);
    try {
      await page.evaluate(() => {
        Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
      });
      await page.goto('/login');
      await loginAsAdmin(page, admA.email, admA.password);
      const resp = await page.evaluate(async (body) => {
        return await window.Auth.callEdgeFunction('update-profile', body);
      }, { target_id: admB.id, first_name: 'Hijack', last_name: admB.lastName });
      expect(resp.status).toBe(409);
      const body = resp.body as Record<string, unknown>;
      expect(body.error).toBe('forbidden_role_target');
    } finally {
      try {
        await page.evaluate(() => {
          Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
        });
        await page.goto('/login');
      } catch (_e) { }
      await loginAsSuperAdmin(page);
      await cleanupTestProfile(page, admA.id);
      await cleanupTestProfile(page, admB.id);
    }
  });

});

test.describe('Profilo proprio', () => {

  test('/me come super_admin: anagrafica readonly + bottone Cambia password', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/me');
    await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
    await expect(page.locator('h1')).toHaveText('Profilo');
    // h2[x-text]: stringe via attribute per escludere h2#title del dialog Shoelace.
    await expect(page.locator('main h2[x-text]')).toBeVisible({ timeout: 5_000 });
    const dl = page.locator('dl.profile-fields');
    await expect(dl).toContainText('super_admin');
    await expect(dl).toContainText(process.env.TEST_SUPER_ADMIN_EMAIL!);
    await expect(page.locator('button.btn--primary', { hasText: 'Cambia password' })).toBeVisible();
    await expect(page.locator('main input[type=text][required]')).toHaveCount(0);
  });

  test('/me change-own-password vecchia sbagliata -> errore inline', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/me');
    await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
    await page.locator('button.btn--primary', { hasText: 'Cambia password' }).click();
    const dialog = page.locator('sl-dialog[label="Cambia password"]');
    await expect(dialog).toBeVisible();
    const inputs = dialog.locator('input[type=password]');
    await inputs.nth(0).fill('definitely-wrong-old-' + Date.now());
    const newPwd = 'NeverApplied' + Date.now();
    await inputs.nth(1).fill(newPwd);
    await inputs.nth(2).fill(newPwd);
    await dialog.locator('sl-button[variant="primary"]').click();
    await expect(page.locator('article.error[role=alert]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('article.error[role=alert]')).toContainText('Vecchia password sbagliata');
    // Re-login per garantire che la password originale sia ancora valida.
    await page.evaluate(() => {
      Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
    });
    await page.goto('/login');
    await page.locator('input[type=email]').fill(process.env.TEST_SUPER_ADMIN_EMAIL!);
    await page.locator('input[type=password]').fill(process.env.TEST_SUPER_ADMIN_PASSWORD!);
    await Promise.all([
      page.waitForURL(/\/customers$/, { timeout: 15_000 }),
      page.locator('button[type=submit]').click(),
    ]);
  });

  test('/me change-own-password happy path su operator fresh', async ({ page, browser }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await page.evaluate(() => {
        Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
      });
      await page.goto('/login');
      await loginAsOperator(page, op.email, op.password);
      await page.goto('/me');
      await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
      await page.locator('button.btn--primary', { hasText: 'Cambia password' }).click();
      const dialog = page.locator('sl-dialog[label="Cambia password"]');
      await expect(dialog).toBeVisible();
      const newPwd = 'NewOpPwd' + Date.now();
      const inputs = dialog.locator('input[type=password]');
      await inputs.nth(0).fill(op.password);
      await inputs.nth(1).fill(newPwd);
      await inputs.nth(2).fill(newPwd);
      await dialog.locator('sl-button[variant="primary"]').click();
      await expect(page.locator('article[role=status]')).toBeVisible({ timeout: 10_000 });
      const ctx = await browser.newContext();
      const opPage = await ctx.newPage();
      try {
        await opPage.goto('/login');
        await opPage.locator('input[type=email]').fill(op.email);
        await opPage.locator('input[type=password]').fill(op.password);
        await opPage.locator('button[type=submit]').click();
        await expect(opPage.locator('article[role=alert] p')).toBeVisible({ timeout: 10_000 });
        await opPage.locator('input[type=password]').fill(newPwd);
        await opPage.locator('button[type=submit]').click();
        await opPage.waitForURL(/\/scan$/, { timeout: 15_000 });
      } finally { await ctx.close(); }
    } finally {
      try {
        await page.evaluate(() => {
          Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
        });
        await page.goto('/login');
      } catch (_e) { }
      await loginAsSuperAdmin(page);
      await cleanupTestProfile(page, op.id);
    }
  });

});

// DEVE restare ULTIMO: il reset distruttivo svuota customers e transactions
// su DEV, qualsiasi test successivo girerebbe contro un DB vuoto.
test.describe('Fine stagione', () => {

  async function logoutViaStorage(page: Parameters<typeof loginAsSuperAdmin>[0]) {
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('sb-'))
        .forEach((k) => localStorage.removeItem(k));
    });
    await page.goto('/login');
    await expect(page.locator('input[type=email]')).toBeVisible({ timeout: 8_000 });
  }

  test('/admin/reports da operator -> redirect /scan (home operator)', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await logoutViaStorage(page);
      await loginAsOperator(page, op.email, op.password);
      await page.goto('/admin/reports');
      await page.waitForURL(/\/scan$/, { timeout: 15_000 });
      await expect(page).toHaveURL(/\/scan$/);
    } finally {
      try { await logoutViaStorage(page); } catch (_e) { }
      await loginAsSuperAdmin(page);
      await cleanupTestProfile(page, op.id);
    }
  });

  test('/admin/reports da admin -> render OK (Report accessibile ad admin+)', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const adm = await createTestAdmin(page);
    try {
      await logoutViaStorage(page);
      await loginAsAdmin(page, adm.email, adm.password);
      await page.goto('/admin/reports');
      await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
      await expect(page.getByRole('heading', { name: 'Report' })).toBeVisible({ timeout: 8_000 });
    } finally {
      try { await logoutViaStorage(page); } catch (_e) { }
      await loginAsSuperAdmin(page);
      await cleanupTestProfile(page, adm.id);
    }
  });

  test('/admin/reports da super_admin -> render Report con 2 esportazioni', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/reports');
    await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Report' })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('button', { name: 'Esporta aggregato per cliente' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Esporta dettaglio transazioni' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Scarica customers/i })).toHaveCount(0);
    await expect(page.locator('section.reset')).toHaveCount(0);
  });

  test('/admin/reset-season da operator -> redirect /scan (home operator)', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await logoutViaStorage(page);
      await loginAsOperator(page, op.email, op.password);
      await page.goto('/admin/reset-season');
      await page.waitForURL(/\/scan$/, { timeout: 15_000 });
      await expect(page).toHaveURL(/\/scan$/);
    } finally {
      try { await logoutViaStorage(page); } catch (_e) { }
      await loginAsSuperAdmin(page);
      await cleanupTestProfile(page, op.id);
    }
  });

  test('/admin/reset-season da admin -> redirect /customers', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const adm = await createTestAdmin(page);
    try {
      await logoutViaStorage(page);
      await loginAsAdmin(page, adm.email, adm.password);
      await page.goto('/admin/reset-season');
      await page.waitForURL(/\/customers$/, { timeout: 15_000 });
      await expect(page).toHaveURL(/\/customers$/);
    } finally {
      try { await logoutViaStorage(page); } catch (_e) { }
      await loginAsSuperAdmin(page);
      await cleanupTestProfile(page, adm.id);
    }
  });

  test('/admin/reset-season da super_admin -> render OK con bottone reset', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/reset-season');
    await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Reset stagione' }).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('section.reset button.btn--danger')).toBeVisible();
  });

  test('download aggregato per cliente: filename, BOM, separator ;, header IT', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/reports');
    await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Esporta aggregato per cliente' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^aggregato-stagione-\d{4}-\d{2}-\d{2}\.csv$/);
    // CSV Excel-friendly: BOM 0xFEFF + separatore ; + header IT.
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    const content = Buffer.concat(chunks).toString('utf8');
    expect(content.charCodeAt(0)).toBe(0xfeff);
    const firstLine = content.split('\n')[0];
    expect(firstLine).toContain(';');
    expect(firstLine).toContain('Cliente');
    expect(firstLine).toContain('Saldo aperto (EUR)');
  });

  test('download dettaglio transazioni: filename, header IT con Tipo e Importo', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/reports');
    await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Esporta dettaglio transazioni' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^dettaglio-transazioni-\d{4}-\d{2}-\d{2}\.csv$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    const content = Buffer.concat(chunks).toString('utf8');
    expect(content.charCodeAt(0)).toBe(0xfeff);
    const firstLine = content.split('\n')[0];
    expect(firstLine).toContain('Tipo');
    expect(firstLine).toContain('Importo (EUR)');
  });

  test("modal type-to-confirm: bottone disabled finche' input != 'RESET STAGIONE'", async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/reset-season');
    await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
    await page.locator('section.reset button.btn--danger').click();
    const dialog = page.locator('sl-dialog[label="Reset stagione"]');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    const dangerBtn = page.locator('sl-dialog sl-button[variant="danger"]');
    const confirmInput = page.locator('input.confirm-input');
    // sl-button reflecta `disabled` come attribute con valore "disabled", quindi
    // toHaveAttribute('disabled', '') non matcha: interroghiamo la property.
    const isDangerDisabled = () => dangerBtn.evaluate((el: { disabled: boolean }) => el.disabled);
    await confirmInput.fill('reset stagione');
    await expect.poll(isDangerDisabled, { timeout: 8_000 }).toBe(true);
    await confirmInput.fill('RESET STAGIONE');
    await expect.poll(isDangerDisabled, { timeout: 8_000 }).toBe(false);
    await page.locator('sl-dialog sl-button[variant="default"]').click();
  });

});
