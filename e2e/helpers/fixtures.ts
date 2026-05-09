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
  const deleteBtn = page.locator('button.contrast', { hasText: 'Cancella cliente' });
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
  // CTA "ADDEBITA" e' un button.primary.pos-cta dentro pos-actions.
  await Promise.all([
    page.waitForResponse((resp) =>
      resp.url().includes('/rest/v1/transactions') && resp.request().method() === 'POST'
    ),
    page.locator('button.pos-cta.primary, .pos-actions button.primary').first().click(),
  ]);
  // Attesa che l'overlay si chiuda.
  await expect(overlay).toBeHidden();
}
