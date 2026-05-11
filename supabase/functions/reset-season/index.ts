// repo/supabase/functions/reset-season/index.ts
// Verifica caller super_admin, chiama RPC reset_season() per TRUNCATE
// atomico di transactions + customers. profiles intatto.
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
    event: 'reset-season',
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

async function checkCallerSuperAdmin(req: Request): Promise<
  { ok: true; userId: string } | { ok: false; resp: Response }
> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    console.log(JSON.stringify({ event: 'reset-season', status: 401, error: 'missing_auth' }));
    return { ok: false, resp: jsonResponse(errorBody('missing_auth', 'Authorization Bearer mancante.'), 401) };
  }
  const jwt = authHeader.slice(7).trim();
  const userResp = await serviceClient.auth.getUser(jwt);
  if (userResp.error || !userResp.data?.user) {
    console.log(JSON.stringify({ event: 'reset-season', status: 401, error: 'invalid_token' }));
    return { ok: false, resp: jsonResponse(errorBody('invalid_token', 'JWT non valido o scaduto.'), 401) };
  }
  const userId = userResp.data.user.id;
  const profileResp = await serviceClient
    .from('profiles').select('role, deleted_at').eq('id', userId).maybeSingle();
  if (profileResp.error) {
    console.error(JSON.stringify({
      event: 'reset-season', status: 500, error: 'unknown_error',
      message: profileResp.error.message
    }));
    return { ok: false, resp: jsonResponse(errorBody('unknown_error', profileResp.error.message), 500) };
  }
  if (!profileResp.data) {
    console.log(JSON.stringify({ event: 'reset-season', status: 403, error: 'profile_not_found' }));
    return { ok: false, resp: jsonResponse(errorBody('profile_not_found', 'Profilo non trovato.'), 403) };
  }
  if (profileResp.data.deleted_at !== null) {
    console.log(JSON.stringify({ event: 'reset-season', status: 403, error: 'profile_deleted' }));
    return { ok: false, resp: jsonResponse(errorBody('profile_deleted', 'Profilo cancellato.'), 403) };
  }
  if (profileResp.data.role !== 'super_admin') {
    console.log(JSON.stringify({ event: 'reset-season', status: 403, error: 'forbidden_role', user_id: userId }));
    return { ok: false, resp: jsonResponse(errorBody('forbidden_role', 'Solo super_admin puo eseguire il reset.'), 403) };
  }
  return { ok: true, userId };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse(errorBody('bad_request', 'Metodo non supportato.'), 405);

  const caller = await checkCallerSuperAdmin(req);
  if (!caller.ok) return caller.resp;

  const rpcResp = await serviceClient.rpc('reset_season');
  if (rpcResp.error) {
    console.error(JSON.stringify({
      event: 'reset-season', status: 500, error: 'rpc_failed',
      message: rpcResp.error.message,
      caller_id: caller.userId,
      latency_ms: Date.now() - startedAt
    }));
    return jsonResponse(errorBody('unknown_error', rpcResp.error.message), 500);
  }

  console.log(JSON.stringify({
    event: 'reset-season', status: 200,
    caller_id: caller.userId, latency_ms: Date.now() - startedAt
  }));
  return jsonResponse({ ok: true }, 200);
});
