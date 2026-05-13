import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Max-Age': '86400'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Guard DEV-only: lo deploy va anche su PRD (workflow deploy-functions.yml
// non distingue env), ma su PRD la function rifiuta con 403. Doppia difesa:
// l'SQL _e2e_bulk_cleanup() esiste solo su DEV.
const DEV_SUPABASE_URL = 'https://esxnberopfmfaebmbqwd.supabase.co';
const IS_DEV_ENV = SUPABASE_URL === DEV_SUPABASE_URL;

const E2E_LAST_NAME_PREFIX = 'ZZ-E2E';

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(JSON.stringify({
    event: 'e2e-cleanup', error: 'missing_env',
    message: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set'
  }));
}

const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function errorBody(code: string, message: string): { error: string; message: string } {
  return { error: code, message };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function checkCallerSuperAdmin(req: Request): Promise<
  { ok: true; userId: string } | { ok: false; resp: Response }
> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { ok: false, resp: jsonResponse(errorBody('missing_auth', 'Authorization Bearer mancante.'), 401) };
  }
  const jwt = authHeader.slice(7).trim();
  const userResp = await serviceClient.auth.getUser(jwt);
  if (userResp.error || !userResp.data?.user) {
    return { ok: false, resp: jsonResponse(errorBody('invalid_token', 'JWT non valido o scaduto.'), 401) };
  }
  const userId = userResp.data.user.id;
  const profileResp = await serviceClient
    .from('profiles').select('role, deleted_at').eq('id', userId).maybeSingle();
  if (profileResp.error) {
    return { ok: false, resp: jsonResponse(errorBody('unknown_error', profileResp.error.message), 500) };
  }
  if (!profileResp.data) {
    return { ok: false, resp: jsonResponse(errorBody('profile_not_found', 'Profilo non trovato.'), 403) };
  }
  if (profileResp.data.deleted_at !== null) {
    return { ok: false, resp: jsonResponse(errorBody('profile_deleted', 'Profilo cancellato.'), 403) };
  }
  if (profileResp.data.role !== 'super_admin') {
    return { ok: false, resp: jsonResponse(errorBody('forbidden_role', 'Solo super_admin puo\' chiamare e2e-cleanup.'), 403) };
  }
  return { ok: true, userId };
}

interface Body {
  target_id?: string;
  scope?: 'profile' | 'customer';
}

interface CleanupResult {
  tx_deleted: number;
  customers_deleted: number;
  users_deleted: number;
}

async function deleteSingleCustomer(targetId: string): Promise<CleanupResult> {
  const cust = await serviceClient
    .from('customers').select('id, last_name').eq('id', targetId).maybeSingle();
  if (cust.error) throw new Error('lookup_customer_failed: ' + cust.error.message);
  if (!cust.data) throw Object.assign(new Error('target_not_found'), { code: 'target_not_found' });
  if (!cust.data.last_name.startsWith(E2E_LAST_NAME_PREFIX)) {
    throw Object.assign(new Error('target_not_e2e'), { code: 'target_not_e2e' });
  }
  // reversal prima (FK reversal_of_id ON DELETE RESTRICT).
  const revDel = await serviceClient
    .from('transactions').delete({ count: 'exact' })
    .eq('customer_id', targetId).eq('type', 'reversal');
  if (revDel.error) throw new Error('delete_tx_reversal_failed: ' + revDel.error.message);
  const chargeDel = await serviceClient
    .from('transactions').delete({ count: 'exact' }).eq('customer_id', targetId);
  if (chargeDel.error) throw new Error('delete_tx_charge_failed: ' + chargeDel.error.message);
  const custDel = await serviceClient
    .from('customers').delete({ count: 'exact' }).eq('id', targetId);
  if (custDel.error) throw new Error('delete_customer_failed: ' + custDel.error.message);
  return {
    tx_deleted: (revDel.count ?? 0) + (chargeDel.count ?? 0),
    customers_deleted: custDel.count ?? 0,
    users_deleted: 0
  };
}

async function deleteSingleProfile(targetId: string): Promise<CleanupResult> {
  const prof = await serviceClient
    .from('profiles').select('id, last_name').eq('id', targetId).maybeSingle();
  if (prof.error) throw new Error('lookup_profile_failed: ' + prof.error.message);
  if (!prof.data) throw Object.assign(new Error('target_not_found'), { code: 'target_not_found' });
  if (!prof.data.last_name.startsWith(E2E_LAST_NAME_PREFIX)) {
    throw Object.assign(new Error('target_not_e2e'), { code: 'target_not_e2e' });
  }
  // Customers ZZ-E2E creati dal profilo: id da cancellare con le tx collegate.
  const cust = await serviceClient
    .from('customers').select('id')
    .eq('created_by_id', targetId).like('last_name', E2E_LAST_NAME_PREFIX + '%');
  if (cust.error) throw new Error('lookup_customers_failed: ' + cust.error.message);
  const custIds = (cust.data ?? []).map((c: { id: string }) => c.id);

  let txCount = 0;
  // reversal sui customer del profilo
  if (custIds.length > 0) {
    const rev = await serviceClient
      .from('transactions').delete({ count: 'exact' })
      .in('customer_id', custIds).eq('type', 'reversal');
    if (rev.error) throw new Error('delete_tx_cust_rev_failed: ' + rev.error.message);
    txCount += rev.count ?? 0;
    const rest = await serviceClient
      .from('transactions').delete({ count: 'exact' }).in('customer_id', custIds);
    if (rest.error) throw new Error('delete_tx_cust_rest_failed: ' + rest.error.message);
    txCount += rest.count ?? 0;
  }
  // tx con user_id = target
  const txUserRev = await serviceClient
    .from('transactions').delete({ count: 'exact' })
    .eq('user_id', targetId).eq('type', 'reversal');
  if (txUserRev.error) throw new Error('delete_tx_user_rev_failed: ' + txUserRev.error.message);
  txCount += txUserRev.count ?? 0;
  const txUserRest = await serviceClient
    .from('transactions').delete({ count: 'exact' }).eq('user_id', targetId);
  if (txUserRest.error) throw new Error('delete_tx_user_rest_failed: ' + txUserRest.error.message);
  txCount += txUserRest.count ?? 0;
  // tx con paid_by_id = target (potrebbero esserci tx non riferite da user_id ma da paid_by_id)
  const txPaid = await serviceClient
    .from('transactions').delete({ count: 'exact' }).eq('paid_by_id', targetId);
  if (txPaid.error) throw new Error('delete_tx_paidby_failed: ' + txPaid.error.message);
  txCount += txPaid.count ?? 0;

  let custCount = 0;
  if (custIds.length > 0) {
    const cDel = await serviceClient.from('customers').delete({ count: 'exact' }).in('id', custIds);
    if (cDel.error) throw new Error('delete_customers_failed: ' + cDel.error.message);
    custCount = cDel.count ?? 0;
  }

  // auth.users -> CASCADE su public.profiles
  const userDel = await serviceClient.auth.admin.deleteUser(targetId);
  if (userDel.error) throw new Error('delete_user_failed: ' + userDel.error.message);

  return { tx_deleted: txCount, customers_deleted: custCount, users_deleted: 1 };
}

async function bulkCleanup(): Promise<CleanupResult> {
  const rpc = await serviceClient.rpc('_e2e_bulk_cleanup');
  if (rpc.error) throw new Error('rpc_failed: ' + rpc.error.message);
  const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
  return {
    tx_deleted: Number(row?.tx_deleted ?? 0),
    customers_deleted: Number(row?.customers_deleted ?? 0),
    users_deleted: Number(row?.users_deleted ?? 0)
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return jsonResponse(errorBody('bad_request', 'Metodo non supportato.'), 405);
  }

  if (!IS_DEV_ENV) {
    console.log(JSON.stringify({ event: 'e2e-cleanup', status: 403, error: 'env_not_dev' }));
    return jsonResponse(errorBody('env_not_dev', 'e2e-cleanup attivo solo su DEV.'), 403);
  }

  const caller = await checkCallerSuperAdmin(req);
  if (!caller.ok) return caller.resp;

  let body: Body = {};
  try {
    const raw = await req.text();
    if (raw.trim() !== '') body = JSON.parse(raw);
  } catch (_e) {
    return jsonResponse(errorBody('bad_request', 'Body JSON malformato.'), 400);
  }

  try {
    let result: CleanupResult;
    if (body.target_id) {
      if (!UUID_RE.test(body.target_id)) {
        return jsonResponse(errorBody('bad_request', 'target_id deve essere UUID.'), 400);
      }
      const scope = body.scope ?? 'profile';
      if (scope !== 'profile' && scope !== 'customer') {
        return jsonResponse(errorBody('bad_request', 'scope deve essere profile o customer.'), 400);
      }
      result = scope === 'customer'
        ? await deleteSingleCustomer(body.target_id)
        : await deleteSingleProfile(body.target_id);
    } else {
      result = await bulkCleanup();
    }
    console.log(JSON.stringify({
      event: 'e2e-cleanup', status: 200,
      caller_id: caller.userId,
      mode: body.target_id ? (body.scope ?? 'profile') : 'bulk',
      target_id: body.target_id ?? null,
      tx_deleted: result.tx_deleted,
      customers_deleted: result.customers_deleted,
      users_deleted: result.users_deleted,
      latency_ms: Date.now() - startedAt
    }));
    return jsonResponse({ ok: true, ...result }, 200);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'target_not_found') {
      console.log(JSON.stringify({ event: 'e2e-cleanup', status: 404, error: 'target_not_found', caller_id: caller.userId, target_id: body.target_id, latency_ms: Date.now() - startedAt }));
      return jsonResponse(errorBody('target_not_found', 'Target non trovato.'), 404);
    }
    if (code === 'target_not_e2e') {
      console.log(JSON.stringify({ event: 'e2e-cleanup', status: 409, error: 'target_not_e2e', caller_id: caller.userId, target_id: body.target_id, latency_ms: Date.now() - startedAt }));
      return jsonResponse(errorBody('target_not_e2e', 'Target non e\' un record ZZ-E2E.'), 409);
    }
    console.error(JSON.stringify({
      event: 'e2e-cleanup', status: 500, error: 'unknown_error',
      message, caller_id: caller.userId, target_id: body.target_id ?? null,
      latency_ms: Date.now() - startedAt
    }));
    return jsonResponse(errorBody('unknown_error', message), 500);
  }
});
