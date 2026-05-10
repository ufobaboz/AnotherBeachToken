// Suite E2E completa di Customer QR Tracker.
// I test descrivono il comportamento *attuale* del sistema in produzione,
// organizzati per area funzionale (routing, auth, anagrafica, ...).
// Niente riferimenti alle milestone della roadmap: la milestone e' un
// concetto di pianificazione (vive in spec/roadmap.md), il software ha
// un comportamento osservabile e basta. Quando una modifica futura
// cambia il comportamento di una feature gia' coperta, il test relativo
// si aggiorna -- non si aggiunge "stesso comportamento, milestone nuova".

import { test, expect, Route } from '@playwright/test';
import { loginAsSuperAdmin, loginAsOperator, loginAsAdmin } from '../helpers/auth';
import {
  createTestCustomer,
  softDeleteTestCustomer,
  chargeAmount,
  getCustomerQrToken,
  createTestOperator,
  softDeleteTestOperator,
  createTestAdmin,
  softDeleteTestProfile,
  changeRoleViaEdge
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
    expect(totalCount).toBeGreaterThanOrEqual(7);
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
    // summary contiene super_admin=<n> con n >= 1
    await expect(row).toContainText(/super_admin\s*=\s*[1-9]\d*/);
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

// ----------------------------------------------------------------------
// Gestione utenti
// ----------------------------------------------------------------------
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
    // cleanup
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
    // no cleanup needed: gia' soft-deleted dal test stesso
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
      // verify via SELECT (RLS permette al super_admin di leggere)
      const profile = await page.evaluate(async (id) => {
        const r = await window.Auth.client.from('profiles')
          .select('first_name, last_name, notes')
          .eq('id', id).maybeSingle();
        return r.data;
      }, op.id);
      expect(profile!.first_name).toBe('Modificato');
      expect(profile!.notes).toBe('note di test');
    } finally {
      await softDeleteTestOperator(page, op.id);
    }
  });

  test('reset-password: vecchia FAIL nuova OK', async ({ page, browser }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      const newPwd = 'NewPwd' + Date.now();
      const resp = await page.evaluate(async (body) => {
        return await window.Auth.callEdgeFunction('reset-password', body);
      }, { target_id: op.id, password: newPwd });
      expect(resp.status).toBe(200);
      // login con vecchia password -> FAIL (alert visibile)
      const ctx = await browser.newContext();
      const opPage = await ctx.newPage();
      try {
        await opPage.goto('/login');
        await opPage.locator('input[type=email]').fill(op.email);
        await opPage.locator('input[type=password]').fill(op.password);
        await opPage.locator('button[type=submit]').click();
        await expect(opPage.locator('article[role=alert] p')).toBeVisible({ timeout: 10_000 });
        // login con nuova password -> OK redirect /customers
        await opPage.locator('input[type=password]').fill(newPwd);
        await opPage.locator('button[type=submit]').click();
        await opPage.waitForURL(/\/customers$/, { timeout: 15_000 });
      } finally { await ctx.close(); }
    } finally {
      await softDeleteTestOperator(page, op.id);
    }
  });

  test('anon su /admin/users -> redirect /login', async ({ page }) => {
    await page.goto('/admin/users');
    await page.waitForURL(/\/login$/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login$/);
  });

  test('operator su /admin/users -> redirect /customers', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      // logout super_admin: pulisce localStorage Supabase e naviga a /login
      await page.evaluate(() => {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('sb-'))
          .forEach((k) => localStorage.removeItem(k));
      });
      await page.goto('/login');
      await expect(page.locator('input[type=email]')).toBeVisible({ timeout: 8_000 });
      // login operator
      await loginAsOperator(page, op.email, op.password);
      // visita /admin/users -> guard redirecta a /customers (operator non ha accesso)
      await page.goto('/admin/users');
      await page.waitForURL(/\/customers$/, { timeout: 15_000 });
      await expect(page).toHaveURL(/\/customers$/);
    } finally {
      // logout operator: stessa pulizia, poi login come super_admin
      try {
        await page.evaluate(() => {
          Object.keys(localStorage)
            .filter((k) => k.startsWith('sb-'))
            .forEach((k) => localStorage.removeItem(k));
        });
        await page.goto('/login');
        await expect(page.locator('input[type=email]')).toBeVisible({ timeout: 8_000 });
      } catch (_e) { /* ignore */ }
      await loginAsSuperAdmin(page);
      await softDeleteTestOperator(page, op.id);
    }
  });

  test('super_admin su /admin/users -> pagina caricata', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/users');
    // aspetta che Alpine rimuova x-cloak dal body (guard ok -> removeAttribute)
    await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
    await expect(page.locator('h1')).toHaveText('Gestione utenti', { timeout: 5_000 });
    await expect(page.locator('a[href="/customers"]')).toBeVisible();
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
      // riga aggiornata
      await expect(page.locator('table tbody tr', { hasText: 'Modificato' })).toBeVisible({ timeout: 5_000 });
    } finally {
      await softDeleteTestOperator(page, op.id);
    }
  });

  test('reset password via dialog: vecchia FAIL, nuova OK', async ({ page, browser }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await page.goto('/admin/users');
      const row = page.locator('table tbody tr', { hasText: op.lastName });
      await expect(row).toBeVisible({ timeout: 8_000 });
      await row.locator('button', { hasText: 'Reset password' }).click();
      const dialog = page.locator('sl-dialog[label="Reset password"]');
      await expect(dialog).toBeVisible();
      const newPwd = 'NewPwd' + Date.now();
      const inputs = dialog.locator('input[type="password"]');
      await inputs.nth(0).fill(newPwd);
      await inputs.nth(1).fill(newPwd);
      await dialog.locator('sl-button[variant="primary"]').click();
      await expect(page.locator('article[role="status"]')).toBeVisible({ timeout: 10_000 });
      // login con vecchia: FAIL; con nuova: OK
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
        await opPage.waitForURL(/\/customers$/, { timeout: 15_000 });
      } finally { await ctx.close(); }
    } finally {
      await softDeleteTestOperator(page, op.id);
    }
  });

  test('delete operator via dialog: scompare dalla lista + auth-ping profile_deleted', async ({ page, browser }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await page.goto('/admin/users');
      const row = page.locator('table tbody tr', { hasText: op.lastName });
      await expect(row).toBeVisible({ timeout: 8_000 });
      await row.locator('button.contrast', { hasText: 'Cancella' }).click();
      const dialog = page.locator('sl-dialog[label="Conferma cancellazione"]');
      await expect(dialog).toBeVisible();
      await dialog.locator('sl-button[variant="danger"]').click();
      await expect(page.locator('table tbody tr', { hasText: op.lastName })).toHaveCount(0, { timeout: 10_000 });

      // auth-ping del cancellato (login op + chiamata)
      const ctx = await browser.newContext();
      const opPage = await ctx.newPage();
      try {
        await opPage.goto('/login');
        await opPage.locator('input[type=email]').fill(op.email);
        await opPage.locator('input[type=password]').fill(op.password);
        await opPage.locator('button[type=submit]').click();
        // signInWithPassword riesce comunque; la pagina atterrara' su /customers.
        // Aspetta che il redirect si completi e auth.js abbia la sessione caricata.
        await opPage.waitForURL(/\/customers$/, { timeout: 15_000 });
        const ping = await opPage.evaluate(async () => {
          return await window.Auth.callAuthPing({ stamp: false });
        });
        expect(ping.status).toBe(403);
        const pingBody = ping.body as Record<string, unknown>;
        expect(pingBody.error).toBe('profile_deleted');
      } finally { await ctx.close(); }
    } finally {
      // gia' soft-deleted, no-op
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
      await page.locator('button.primary', { hasText: '+ Nuovo operator' }).click();
      const dialog = page.locator('sl-dialog[label="Nuovo operator"]');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.locator('input[type="email"]').fill(email);
      await dialog.locator('input[type="password"]').fill('TestPwd1234');
      const textInputs = dialog.locator('input[type="text"]');
      await textInputs.nth(0).fill('E2E'); // first_name
      await textInputs.nth(1).fill(lastName); // last_name
      await dialog.locator('sl-button[variant="primary"]').click();
      await expect(page.locator('article[role="status"]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('table tbody tr', { hasText: lastName })).toBeVisible({ timeout: 5_000 });
      // recupera id per cleanup
      createdId = await page.evaluate(async (ln) => {
        const r = await window.Auth.client.from('profiles').select('id').eq('last_name', ln).maybeSingle();
        return (r.data as { id: string } | null)?.id || null;
      }, lastName);
    } finally {
      if (createdId) await softDeleteTestOperator(page, createdId);
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
      await page.locator('button.primary', { hasText: '+ Nuovo admin' }).click();
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
      if (createdId) await softDeleteTestProfile(page, createdId);
    }
  });

  test('admin loggato non vede tab admin / bottone Cambia ruolo / checkbox cancellati', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const adm = await createTestAdmin(page);
    try {
      // logout super_admin
      await page.evaluate(() => {
        Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
      });
      await page.goto('/login');
      await loginAsAdmin(page, adm.email, adm.password);
      await page.goto('/admin/users');
      await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
      // bottone "+ Nuovo admin" presente in DOM ma nascosto via x-show (super_admin only)
      await expect(page.locator('button.primary', { hasText: '+ Nuovo admin' })).toBeHidden();
      // checkbox 'Mostra cancellati' presente in DOM ma nascosto via x-show (super_admin only)
      await expect(page.locator('label', { hasText: 'Mostra cancellati' })).toBeHidden();
      // 'Cambia ruolo' non presente in nessuna riga (operator-only list, no row eligible)
      await expect(page.locator('button', { hasText: 'Cambia ruolo' })).toHaveCount(0);
    } finally {
      // re-login super_admin per cleanup
      try {
        await page.evaluate(() => {
          Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
        });
        await page.goto('/login');
      } catch (_e) { /* ignore */ }
      await loginAsSuperAdmin(page);
      await softDeleteTestProfile(page, adm.id);
    }
  });

  test('change-role: super_admin promuove operator -> admin (via edge)', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    try {
      await changeRoleViaEdge(page, op.id, 'admin');
      // verifica via SELECT
      const profile = await page.evaluate(async (id) => {
        const r = await window.Auth.client.from('profiles').select('role').eq('id', id).maybeSingle();
        return r.data;
      }, op.id);
      expect((profile as { role: string }).role).toBe('admin');
    } finally {
      await softDeleteTestProfile(page, op.id);
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
      await softDeleteTestProfile(page, adm.id);
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
      await softDeleteTestProfile(page, op.id);
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
      await softDeleteTestProfile(page, op.id);
    }
  });

  test('change-role: forbidden_role per caller admin', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const adm = await createTestAdmin(page);
    const op = await createTestOperator(page);
    try {
      // logout super_admin -> login admin
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
      } catch (_e) { /* ignore */ }
      await loginAsSuperAdmin(page);
      await softDeleteTestProfile(page, adm.id);
      await softDeleteTestProfile(page, op.id);
    }
  });

  test('toggle Mostra cancellati: riga visibile se on, assente se off', async ({ page }) => {
    await loginAsSuperAdmin(page);
    const op = await createTestOperator(page);
    // soft-delete subito per averla cancellata
    await softDeleteTestProfile(page, op.id);
    try {
      await page.goto('/admin/users');
      await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
      // off (default): riga non visibile
      await expect(page.locator('table tbody tr', { hasText: op.lastName })).toHaveCount(0);
      // on: riga visibile + classe deleted
      await page.locator('input[type=checkbox]').check();
      await page.waitForTimeout(300); // attesa loadUsers
      const row = page.locator('table tbody tr', { hasText: op.lastName });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row).toHaveClass(/deleted/);
      // off: riga sparisce
      await page.locator('input[type=checkbox]').uncheck();
      await page.waitForTimeout(300);
      await expect(page.locator('table tbody tr', { hasText: op.lastName })).toHaveCount(0);
    } finally {
      // gia' soft-deleted
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
      } catch (_e) { /* ignore */ }
      await loginAsSuperAdmin(page);
      await softDeleteTestProfile(page, admA.id);
      await softDeleteTestProfile(page, admB.id);
    }
  });

});

// ----------------------------------------------------------------------
// Profilo proprio (/me)
// ----------------------------------------------------------------------
test.describe('Profilo proprio', () => {

  test('/me come super_admin: anagrafica readonly + bottone Cambia password', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/me');
    await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
    await expect(page.locator('h1')).toHaveText('Profilo');
    // anagrafica visibile: h2 con nome cognome (selettore stretto su x-text per escludere h2#title del dialog Shoelace)
    await expect(page.locator('main h2[x-text]')).toBeVisible({ timeout: 5_000 });
    // dl con role/email/last_login
    const dl = page.locator('dl.profile-fields');
    await expect(dl).toContainText('super_admin');
    await expect(dl).toContainText(process.env.TEST_SUPER_ADMIN_EMAIL!);
    // bottone Cambia password
    await expect(page.locator('button.primary', { hasText: 'Cambia password' })).toBeVisible();
    // nessun input editabile (no input text required visibili)
    await expect(page.locator('main input[type=text][required]')).toHaveCount(0);
  });

  test('/me change-own-password vecchia sbagliata -> errore inline', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/me');
    await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
    await page.locator('button.primary', { hasText: 'Cambia password' }).click();
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
    // sanity: la password reale del super_admin di test e' invariata (login OK)
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
      // logout super_admin -> login operator
      await page.evaluate(() => {
        Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
      });
      await page.goto('/login');
      await loginAsOperator(page, op.email, op.password);
      // visita /me (operator OK: requireAuth basta)
      await page.goto('/me');
      await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
      // dialog cambio password
      await page.locator('button.primary', { hasText: 'Cambia password' }).click();
      const dialog = page.locator('sl-dialog[label="Cambia password"]');
      await expect(dialog).toBeVisible();
      const newPwd = 'NewOpPwd' + Date.now();
      const inputs = dialog.locator('input[type=password]');
      await inputs.nth(0).fill(op.password);
      await inputs.nth(1).fill(newPwd);
      await inputs.nth(2).fill(newPwd);
      await dialog.locator('sl-button[variant="primary"]').click();
      // success message su /me
      await expect(page.locator('article[role=status]')).toBeVisible({ timeout: 10_000 });
      // verify: login con vecchia FAIL, con nuova OK
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
        await opPage.waitForURL(/\/customers$/, { timeout: 15_000 });
      } finally { await ctx.close(); }
    } finally {
      // re-login super_admin per cleanup
      try {
        await page.evaluate(() => {
          Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k));
        });
        await page.goto('/login');
      } catch (_e) { /* ignore */ }
      await loginAsSuperAdmin(page);
      await softDeleteTestProfile(page, op.id);
    }
  });

});
