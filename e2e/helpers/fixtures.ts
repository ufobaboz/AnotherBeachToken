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
  // Pattern accettato da customer-new: ^\+[0-9]{8,15}$.
  // Prefisso "+39000" + 7 cifre random per non collidere con formati reali.
  const tail = String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
  return '+39000' + tail;
}

export async function createTestCustomer(page: Page): Promise<TestCustomer> {
  const suffix = randomSuffix();
  const lastName = 'ZZ-E2E-' + suffix;
  const firstName = 'Test';
  const phone = randomPhone();
  await page.goto('/customers/new');
  // 2 input text required maxlength=120: first_name, last_name (in ordine).
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

export async function softDeleteTestCustomer(page: Page, id: string): Promise<void> {
  // Idempotente: se la pagina e' gia' aperta sul detail con dialog gia' chiuso,
  // si fa goto comunque per riusare la stessa logica.
  await page.goto(`/customers/${id}`);
  // Bottone "Cancella cliente" visibile solo a admin+; il super_admin di test lo vede.
  const deleteBtn = page.locator('button.btn--danger', { hasText: 'Cancella cliente' });
  await deleteBtn.click();
  // Shoelace dialog: bottone variant=danger nel footer.
  const confirmBtn = page.locator('sl-dialog sl-button[variant=danger]', { hasText: 'Cancella' });
  await Promise.all([
    page.waitForURL('**/customers', { timeout: 10_000 }),
    confirmBtn.click(),
  ]);
}

/**
 * Legge il qr_token di un cliente via supabase-js dal browser context.
 * La pagina deve essere autenticata (super_admin di test loggato).
 */
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
  // page deve essere autenticata come super_admin o admin (l'edge function create-operator richiede admin+).
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

export async function softDeleteTestOperator(page: Page, id: string): Promise<void> {
  // Best-effort cleanup. Se la pagina non e' loggata come admin+, fallisce silenzioso.
  try {
    await page.evaluate(async (target_id) => {
      return await window.Auth.callEdgeFunction('soft-delete-profile', { target_id });
    }, id);
  } catch (e) {
    console.warn('[softDeleteTestOperator] cleanup failed for id=' + id + ':', e);
  }
}

/**
 * Apre il customer-detail con ?charge=1 (auto-open tastiera POS) e battezza
 * un addebito. amountInteger e amountDecimal sono stringhe di cifre senza
 * separatori (es. amountInteger="5", amountDecimal="50" per 5,50 EUR).
 */
export async function chargeAmount(
  page: Page,
  customerId: string,
  amountInteger: string,
  amountDecimal: string
): Promise<void> {
  await page.goto(`/customers/${customerId}?charge=1`);
  // Attesa che l'overlay POS sia visibile.
  const overlay = page.locator('.pos-overlay');
  await expect(overlay).toBeVisible();
  for (const digit of amountInteger) {
    await page.locator(`.pos-keypad button`, { hasText: new RegExp(`^${digit}$`) }).click();
  }
  await page.locator(`.pos-keypad button`, { hasText: new RegExp(`^,$`) }).click();
  for (const digit of amountDecimal) {
    await page.locator(`.pos-keypad button`, { hasText: new RegExp(`^${digit}$`) }).click();
  }
  // CTA "ADDEBITA" e' un button.pos-cta.btn--primary dentro pos-actions.
  await Promise.all([
    page.waitForResponse((resp) =>
      resp.url().includes('/rest/v1/transactions') && resp.request().method() === 'POST'
    ),
    page.locator('button.pos-cta.btn--primary, .pos-actions button.btn--primary').first().click(),
  ]);
  // Attesa che l'overlay si chiuda.
  await expect(overlay).toBeHidden();
}

export interface TestAdmin {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export async function createTestAdmin(page: Page): Promise<TestAdmin> {
  // page deve essere autenticata come super_admin (admin non puo' creare admin).
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

/**
 * Helper generico per soft-delete di un profilo (operator o admin).
 * Equivalente a softDeleteTestOperator ma con nome che riflette lo scope esteso M7.
 */
export async function softDeleteTestProfile(page: Page, id: string): Promise<void> {
  try {
    await page.evaluate(async (target_id) => {
      return await window.Auth.callEdgeFunction('soft-delete-profile', { target_id });
    }, id);
  } catch (e) {
    console.warn('[softDeleteTestProfile] cleanup failed for id=' + id + ':', e);
  }
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
