// Suite E2E completa di Customer QR Tracker.
// I test descrivono il comportamento *attuale* del sistema in produzione,
// organizzati per area funzionale (routing, auth, anagrafica, ...).
// Niente riferimenti alle milestone della roadmap: la milestone e' un
// concetto di pianificazione (vive in spec/roadmap.md), il software ha
// un comportamento osservabile e basta. Quando una modifica futura
// cambia il comportamento di una feature gia' coperta, il test relativo
// si aggiorna -- non si aggiunge "stesso comportamento, milestone nuova".

import { test, expect, Route } from '@playwright/test';
import { loginAsSuperAdmin } from '../helpers/auth';
import {
  createTestCustomer,
  softDeleteTestCustomer,
  chargeAmount,
  getCustomerQrToken
} from '../helpers/fixtures';

// ----------------------------------------------------------------------
// Routing & redirect
// ----------------------------------------------------------------------
test.describe('Routing & redirect', () => {

  test('/ -> meta-refresh /login', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/login$/, { timeout: 8_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

  test('/qr/<token-non-base32> -> 404 dal Worker', async ({ page }) => {
    // TOKEN_RE in worker.js richiede 32 char base32 maiuscolo. Token con '-'
    // non matcha: il Worker lo lascia in passthrough e ASSETS ritorna 404.
    const resp = await page.goto('/qr/invalid-token-format', { waitUntil: 'commit' });
    expect(resp?.status()).toBe(404);
  });

  test('/checkout/<non-uuid> -> 404 dal Worker', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const resp = await page.goto('/checkout/abc', { waitUntil: 'commit' });
    expect(resp?.status()).toBe(404);
  });

});

// ----------------------------------------------------------------------
// Asset self-hosted (no CDN runtime)
// ----------------------------------------------------------------------
test.describe('Asset self-hosted', () => {

  test('/login funziona con CDN esterni bloccati', async ({ context, page }) => {
    // Se i vendor fossero ancora su CDN, bloccare jsdelivr/unpkg/cdnjs farebbe
    // crashare la pagina. Vendor self-hosted in /vendor/ -> nessun impatto.
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

// ----------------------------------------------------------------------
// Auth & sessione
// ----------------------------------------------------------------------
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
      page.locator('nav.app-nav button.secondary').click(),
    ]);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('/customers da contesto anon -> redirect /login', async ({ page }) => {
    await page.goto('/customers');
    await page.waitForURL(/\/login$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

});

// ----------------------------------------------------------------------
// Probe diagnostico
// ----------------------------------------------------------------------
test.describe('Probe diagnostico', () => {

  test('/probe come super_admin -> tutti i check OK', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/probe');
    // 1) aspetto che Alpine renderizzi tutti i check (count > 0).
    //    Senza questo, gli expect successivi possono passare a vuoto sul DOM
    //    iniziale prima che <template x-for> popoli la lista.
    const allBadges = page.locator('.check .badge');
    await expect(allBadges.first()).toBeVisible({ timeout: 15_000 });
    // 2) tutti i check si risolvono: zero pending residui, zero fail.
    await expect(page.locator('.check .badge.badge-pending')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('.check .badge.badge-fail')).toHaveCount(0);
    // 3) sanity: tutti i badge presenti sono OK (no n/a). Quando si aggiungono
    //    nuovi check al probe, il test resta verde finche' tutti passano OK,
    //    senza dover hardcodare il numero esatto.
    const totalCount = await allBadges.count();
    const okCount = await page.locator('.check .badge.badge-ok').count();
    expect(okCount).toBe(totalCount);
    expect(totalCount).toBeGreaterThanOrEqual(6);
  });

  test('/probe da contesto anon -> redirect /login', async ({ page }) => {
    await page.goto('/probe');
    await page.waitForURL(/\/login$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

});

// ----------------------------------------------------------------------
// Anagrafica clienti
// ----------------------------------------------------------------------
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

  test('customers list: search filtra per last_name', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await page.goto('/customers');
      await page.locator('input[type=search]').fill(customer.lastName);
      await page.waitForTimeout(400); // debounce 250ms
      const rows = page.locator('tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(rows.first().locator('td a')).toContainText(customer.lastName);
    } finally {
      await softDeleteTestCustomer(page, customer.id);
    }
  });

  test('customer-detail super_admin: CTA Cancella visibile', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await page.goto(`/customers/${customer.id}`);
      const deleteBtn = page.locator('button.contrast', { hasText: 'Cancella cliente' });
      await expect(deleteBtn).toBeVisible({ timeout: 8_000 });
    } finally {
      await softDeleteTestCustomer(page, customer.id);
    }
  });

  test('customer-detail: UUID inesistente -> "Cliente non trovato"', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/checkout/00000000-0000-0000-0000-000000000000');
    await expect(
      page.locator('article p', { hasText: 'Cliente non trovato' })
    ).toBeVisible();
    await expect(page.locator('a[href="/customers"]')).toBeVisible();
  });

});

// ----------------------------------------------------------------------
// QR pubblico
// ----------------------------------------------------------------------
test.describe('QR pubblico', () => {

  test('/qr/<token-fake-32-char>: pagina mostra "QR non trovato"', async ({ page }) => {
    // Token sintatticamente valido (32 char base32) ma non in DB.
    await page.goto('/qr/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const notFound = page.locator('article p').filter({ hasText: /non.*trov|non.*riconosc|QR/i }).first();
    await expect(notFound).toBeVisible({ timeout: 8_000 });
  });

  test('/qr/<token reale>: saluto IT + saldo 0,00 EUR (no charges)', async ({ page, browser }) => {
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
      await softDeleteTestCustomer(page, customer.id);
    }
  });

  test('/qr/<token>: saldo riflette charges aperte', async ({ page, browser }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await chargeAmount(page, customer.id, '12', '34');
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
      await softDeleteTestCustomer(page, customer.id);
    }
  });

});

// ----------------------------------------------------------------------
// Operazioni POS (charge / reversal / WhatsApp)
// ----------------------------------------------------------------------
test.describe('Operazioni POS', () => {

  test('charge 5,50 -> saldo 5,50 EUR + badge aperto', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await chargeAmount(page, customer.id, '5', '50');
      await expect(page.locator('.balance-card')).toContainText('5,50 EUR');
      await expect(page.locator('ul.transactions .badge-aperto').first()).toBeVisible();
    } finally {
      await softDeleteTestCustomer(page, customer.id);
    }
  });

  test('reversal: dialog Shoelace -> conferma -> saldo 0 + badge stornato', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await chargeAmount(page, customer.id, '7', '00');
      await page.locator('.tx-storna-btn').first().click();
      const confirmBtn = page.locator('sl-dialog sl-button[variant=danger]').first();
      await Promise.all([
        page.waitForResponse((r) =>
          r.url().includes('/rest/v1/transactions') && r.request().method() === 'POST'
        ),
        confirmBtn.click(),
      ]);
      await expect(page.locator('.balance-card')).toContainText('0,00 EUR');
      await expect(page.locator('ul.transactions .badge-storno').first()).toBeVisible();
    } finally {
      await softDeleteTestCustomer(page, customer.id);
    }
  });

  test('WhatsApp link saldo: href ben formato wa.me con saldo IT', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await chargeAmount(page, customer.id, '3', '20');
      // chargeAmount aspetta che l'overlay si chiuda; il refresh del balance
      // + del link WhatsApp e' async post-chiusura. Aspetto l'aggiornamento
      // esplicito del balance-card prima di leggere href.
      await expect(page.locator('.balance-card')).toContainText('3,20 EUR');
      const link = page.locator('a[href^="https://wa.me/"][role=button]').last();
      await expect(link).toBeVisible();
      const href = await link.getAttribute('href');
      expect(href).toMatch(/^https:\/\/wa\.me\/\d{11,}\?text=.+/);
      const decoded = decodeURIComponent(href!.split('?text=')[1] || '');
      expect(decoded).toContain('3,20');
      expect(decoded).toMatch(/qr\/[A-Z2-7]{32}/);
    } finally {
      await softDeleteTestCustomer(page, customer.id);
    }
  });

});

// ----------------------------------------------------------------------
// Scan QR camera
// ----------------------------------------------------------------------
test.describe('Scan QR', () => {

  test('/scan: senza camera mostra messaggio errore', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/scan');
    // Headless senza camera -> getUserMedia rejecta -> error UI visibile.
    const alert = page.locator('article[role=alert] p').first();
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText(/camera|qr/i);
    await expect(page.locator('a[href="/customers"][role=button]')).toBeVisible();
  });

});

// ----------------------------------------------------------------------
// Chiusura conto (admin+)
// ----------------------------------------------------------------------
test.describe('Chiusura conto', () => {

  test('admin+ chiude conto con 1 charge 5,50 via Contanti -> sub-text saldato', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await chargeAmount(page, customer.id, '5', '50');

      await page.goto(`/checkout/${customer.id}`);
      await expect(page.locator('h2'))
        .toHaveText(`${customer.lastName} ${customer.firstName}`);
      await expect(page.locator('.balance-card')).toContainText('5,50 EUR');

      const dropdown = page.locator('.method-row select');
      await expect(dropdown).toBeVisible();
      await expect(dropdown.locator('option')).toHaveCount(4);

      const cta = page.locator('button.submit-cta');
      await expect(cta).toBeEnabled();
      await expect(cta).toHaveText(/Conferma chiusura - 5,50 EUR via Contanti/);

      await Promise.all([
        page.waitForURL(new RegExp(`/customers/${customer.id}$`), { timeout: 15_000 }),
        cta.click(),
      ]);

      // Sub-text "saldato il ... via Contanti" visibile (super_admin -> nome leggibile).
      const txList = page.locator('ul.transactions');
      await expect(txList.locator('.tx-paid-info').first()).toContainText('saldato il');
      await expect(txList.locator('.tx-paid-info').first()).toContainText('via Contanti');
      await expect(txList.locator('.badge-saldato').first()).toBeVisible();
    } finally {
      await softDeleteTestCustomer(page, customer.id);
    }
  });

  test('saldo=0 -> dropdown nascosto, CTA disabilitato', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const customer = await createTestCustomer(page);
    try {
      await page.goto(`/checkout/${customer.id}`);
      await expect(page.locator('.balance-card')).toContainText('0,00 EUR');

      const cta = page.locator('button.submit-cta');
      await expect(cta).toBeDisabled();
      await expect(cta).toHaveText('Nessun importo da saldare');
      await expect(page.locator('.method-row')).toBeHidden();
    } finally {
      await softDeleteTestCustomer(page, customer.id);
    }
  });

});
