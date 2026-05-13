import { Page, expect } from '@playwright/test';

export interface TestCustomer {
  id: string;
  lastName: string;
  firstName: string;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function randomPhone(): string {
  // Pattern customer-new ^\+[0-9]{8,15}$. Prefisso "+39000" per non collidere
  // con formati reali italiani.
  const tail = String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
  return '+39000' + tail;
}

export async function createTestCustomer(page: Page): Promise<TestCustomer> {
  const suffix = randomSuffix();
  const lastName = 'ZZ-E2E-' + suffix;
  const firstName = 'Test';
  const phone = randomPhone();
  await page.goto('/customers/new');
  const textInputs = page.locator('input[type=text][required]');
  await textInputs.nth(0).fill(firstName);
  await textInputs.nth(1).fill(lastName);
  await page.locator('input[type=tel]').fill(phone);
  await Promise.all([
    page.waitForURL(/\/customers\/[0-9a-f-]{36}$/, { timeout: 15_000 }),
    page.locator('button[type=submit]').click(),
  ]);
  const id = new URL(page.url()).pathname.split('/').pop() || '';
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return { id, lastName, firstName };
}

// Hard delete via edge function e2e-cleanup (DEV-only). Niente flow UI: il
// pulsante "Archivia" e' coperto da un suo test dedicato, qui ci interessa
// solo cancellare il record + tx collegate (anche se aperte).
export async function cleanupTestCustomer(page: Page, id: string): Promise<void> {
  try {
    await page.evaluate(async (target_id) => {
      return await window.Auth.callEdgeFunction('e2e-cleanup', { target_id, scope: 'customer' });
    }, id);
  } catch (e) {
    console.warn('[cleanupTestCustomer] cleanup failed for id=' + id + ':', e);
  }
}

export async function getCustomerQrToken(page: Page, customerId: string): Promise<string> {
  const token = await page.evaluate(async (id) => {
    const resp = await (window as any).Auth.client
      .from('customers')
      .select('qr_token')
      .eq('id', id)
      .single();
    if (resp.error) throw new Error('qr_token fetch: ' + resp.error.message);
    return resp.data.qr_token as string;
  }, customerId);
  if (!/^[A-Z2-7]{32}$/.test(token)) {
    throw new Error('qr_token format inatteso: ' + token);
  }
  return token;
}

export interface TestOperator {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export async function createTestOperator(page: Page): Promise<TestOperator> {
  const ts = Date.now();
  const rand = randomSuffix();
  const email = `e2e-op-${ts}-${rand}@example.com`;
  const password = 'E2eTest' + ts + rand;
  const firstName = 'E2E';
  const lastName = `ZZ-E2E-OP-${rand}`;
  const resp = await page.evaluate(async (body) => {
    return await window.Auth.callEdgeFunction('create-operator', body);
  }, { email, password, first_name: firstName, last_name: lastName });
  if (resp.status !== 200) {
    throw new Error('createTestOperator failed: ' + JSON.stringify(resp));
  }
  const respBody = resp.body as Record<string, unknown>;
  if (typeof respBody.profile_id !== 'string') {
    throw new Error('createTestOperator: missing profile_id in response: ' + JSON.stringify(resp));
  }
  return { id: respBody.profile_id, email, password, firstName, lastName };
}

// Hard delete del profilo (operator o admin) via edge function e2e-cleanup:
// cancella tx collegate, customers ZZ-E2E creati dal profilo, e infine
// auth.users (cascade public.profiles).
export async function cleanupTestProfile(page: Page, id: string): Promise<void> {
  try {
    await page.evaluate(async (target_id) => {
      return await window.Auth.callEdgeFunction('e2e-cleanup', { target_id, scope: 'profile' });
    }, id);
  } catch (e) {
    console.warn('[cleanupTestProfile] cleanup failed for id=' + id + ':', e);
  }
}

// Smoke del POS UI (keypad + submit). Per i test che vogliono solo un addebito
// pre-esistente sul customer usa insertChargeViaApi: piu' veloce, no race con
// Alpine hydration. amountInteger/amountDecimal: cifre senza separatore
// (amountInteger="5", amountDecimal="50" -> 5,50 EUR).
export async function chargeAmount(
  page: Page,
  customerId: string,
  amountInteger: string,
  amountDecimal: string
): Promise<void> {
  await page.goto(`/customers/${customerId}?charge=1`);
  await page.waitForFunction(() => !document.body.hasAttribute('x-cloak'), { timeout: 15_000 });
  await expect(page.locator('.balance-card')).toContainText('EUR', { timeout: 15_000 });
  const overlay = page.locator('.pos-overlay');
  await expect(overlay).toBeVisible();
  const expected = amountInteger + ',' + amountDecimal;
  await page.evaluate((amt) => {
    const body = document.querySelector('body[x-data="customerDetailPage"]') as HTMLElement & {
      _x_dataStack?: Array<Record<string, unknown>>;
    };
    if (!body || !body._x_dataStack || !body._x_dataStack[0]) {
      throw new Error('Alpine data not found on body');
    }
    body._x_dataStack[0].posAmount = amt;
  }, expected);
  await expect(page.locator('.pos-display')).toContainText(expected, { timeout: 4_000 });
  await Promise.all([
    page.waitForResponse((r) =>
      r.url().includes('/rest/v1/transactions') && r.request().method() === 'POST'
    ),
    page.locator('button.pos-cta.btn--primary, .pos-actions button.btn--primary').first().click(),
  ]);
  await expect(overlay).toBeHidden();
}

// Bypass UI POS via supabase-js: zero-race con Alpine hydration. Le invarianti
// sono garantite da RLS + CHECK lato DB (la pagina dev'essere loggata).
export async function insertChargeViaApi(
  page: Page,
  customerId: string,
  amount: number
): Promise<void> {
  const result = await page.evaluate(async ({ cid, amt }) => {
    const session = await (window as any).Auth.client.auth.getSession();
    const userId = session.data.session?.user.id;
    if (!userId) throw new Error('insertChargeViaApi: no session user.id');
    const resp = await (window as any).Auth.client.from('transactions').insert({
      customer_id: cid,
      user_id: userId,
      type: 'charge',
      amount: amt
    }).select('id').single();
    return { error: resp.error, id: resp.data?.id };
  }, { cid: customerId, amt: amount });
  if (result.error) {
    throw new Error('insertChargeViaApi: ' + JSON.stringify(result.error));
  }
}

export interface TestAdmin {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export async function createTestAdmin(page: Page): Promise<TestAdmin> {
  // admin non puo' creare altri admin: serve super_admin loggato.
  const ts = Date.now();
  const rand = randomSuffix();
  const email = `e2e-adm-${ts}-${rand}@example.com`;
  const password = 'E2eTest' + ts + rand;
  const firstName = 'E2E';
  const lastName = `ZZ-E2E-ADM-${rand}`;
  const resp = await page.evaluate(async (body) => {
    return await window.Auth.callEdgeFunction('create-operator', body);
  }, { email, password, first_name: firstName, last_name: lastName, role: 'admin' });
  if (resp.status !== 200) {
    throw new Error('createTestAdmin failed: ' + JSON.stringify(resp));
  }
  const respBody = resp.body as Record<string, unknown>;
  if (typeof respBody.profile_id !== 'string') {
    throw new Error('createTestAdmin: missing profile_id in response: ' + JSON.stringify(resp));
  }
  return { id: respBody.profile_id, email, password, firstName, lastName };
}

export async function changeRoleViaEdge(
  page: Page, target_id: string, new_role: 'operator' | 'admin'
): Promise<void> {
  const resp = await page.evaluate(async (body) => {
    return await window.Auth.callEdgeFunction('change-role', body);
  }, { target_id, new_role });
  if (resp.status !== 200) {
    throw new Error('changeRoleViaEdge failed: ' + JSON.stringify(resp));
  }
}
