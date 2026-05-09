// repo/supabase/functions/soft-delete-profile/index.ts
// Soft-delete profilo operator. Chiamante admin+. Target NON se stesso.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Max-Age': '86400'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(JSON.stringify({
    event: 'soft-delete-profile',
    error: 'missing_env',
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

async function checkCallerAdminOrAbove(req: Request): Promise<
  { ok: true; userId: string; role: string } | { ok: false; resp: Response }
> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    console.log(JSON.stringify({ event: 'soft-delete-profile', status: 401, error: 'missing_auth' }));
    return { ok: false, resp: jsonResponse(errorBody('missing_auth', 'Authorization Bearer mancante.'), 401) };
  }
  const jwt = authHeader.slice(7).trim();
  const userResp = await serviceClient.auth.getUser(jwt);
  if (userResp.error || !userResp.data?.user) {
    console.log(JSON.stringify({ event: 'soft-delete-profile', status: 401, error: 'invalid_token' }));
    return { ok: false, resp: jsonResponse(errorBody('invalid_token', 'JWT non valido o scaduto.'), 401) };
  }
  const userId = userResp.data.user.id;
  const profileResp = await serviceClient
    .from('profiles')
    .select('role, deleted_at')
    .eq('id', userId)
    .maybeSingle();
  if (profileResp.error) {
    console.error(JSON.stringify({ event: 'soft-delete-profile', status: 500, error: 'unknown_error', message: profileResp.error.message }));
    return { ok: false, resp: jsonResponse(errorBody('unknown_error', profileResp.error.message), 500) };
  }
  if (!profileResp.data) {
    console.log(JSON.stringify({ event: 'soft-delete-profile', status: 403, error: 'profile_not_found' }));
    return { ok: false, resp: jsonResponse(errorBody('profile_not_found', 'Profilo non trovato.'), 403) };
  }
  if (profileResp.data.deleted_at !== null) {
    console.log(JSON.stringify({ event: 'soft-delete-profile', status: 403, error: 'profile_deleted' }));
    return { ok: false, resp: jsonResponse(errorBody('profile_deleted', 'Profilo cancellato.'), 403) };
  }
  const role = profileResp.data.role as string;
  if (role !== 'admin' && role !== 'super_admin') {
    console.log(JSON.stringify({ event: 'soft-delete-profile', status: 403, error: 'forbidden_role' }));
    return { ok: false, resp: jsonResponse(errorBody('forbidden_role', 'Ruolo insufficiente.'), 403) };
  }
  return { ok: true, userId, role };
}

interface SoftDeleteBody {
  target_id?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return jsonResponse(errorBody('bad_request', 'Metodo non supportato.'), 405);
  }

  const caller = await checkCallerAdminOrAbove(req);
  if (!caller.ok) return caller.resp;

  let body: SoftDeleteBody;
  try { body = await req.json(); } catch (_e) {
    return jsonResponse(errorBody('bad_request', 'Body JSON malformato.'), 400);
  }
  const targetId = (body.target_id || '').trim();
  if (!UUID_RE.test(targetId)) {
    return jsonResponse(errorBody('bad_request', 'target_id deve essere UUID.'), 400);
  }
  if (targetId === caller.userId) {
    console.log(JSON.stringify({ event: 'soft-delete-profile', status: 409, error: 'target_self', caller_id: caller.userId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('target_self', 'Non puoi cancellare il tuo profilo.'), 409);
  }

  const targetResp = await serviceClient
    .from('profiles')
    .select('role, deleted_at')
    .eq('id', targetId)
    .maybeSingle();
  if (targetResp.error) {
    console.error(JSON.stringify({ event: 'soft-delete-profile', status: 500, error: 'unknown_error', message: targetResp.error.message, caller_id: caller.userId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('unknown_error', targetResp.error.message), 500);
  }
  if (!targetResp.data || targetResp.data.deleted_at !== null) {
    console.log(JSON.stringify({ event: 'soft-delete-profile', status: 404, error: 'target_not_found', caller_id: caller.userId, target_id: targetId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('target_not_found', 'Target non trovato.'), 404);
  }
  if (targetResp.data.role !== 'operator') {
    console.log(JSON.stringify({ event: 'soft-delete-profile', status: 409, error: 'target_not_operator', caller_id: caller.userId, target_id: targetId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('target_not_operator', 'Target non e\' un operator (M6).'), 409);
  }

  const updResp = await serviceClient
    .from('profiles')
    .update({
      deleted_at: new Date().toISOString(),
      last_modified_by_id: caller.userId
    })
    .eq('id', targetId);
  if (updResp.error) {
    console.error(JSON.stringify({ event: 'soft-delete-profile', status: 500, error: 'update_failed', message: updResp.error.message, caller_id: caller.userId, target_id: targetId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('unknown_error', updResp.error.message), 500);
  }

  console.log(JSON.stringify({ event: 'soft-delete-profile', status: 200, caller_id: caller.userId, target_id: targetId, latency_ms: Date.now() - startedAt }));
  return jsonResponse({ ok: true }, 200);
});
