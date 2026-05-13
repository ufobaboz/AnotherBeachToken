import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Max-Age': '86400'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(JSON.stringify({
    event: 'auth-ping',
    error: 'missing_env',
    message: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set'
  }));
}

const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

interface ErrorBody {
  error: string;
  message: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function errorBody(code: string, message: string): ErrorBody {
  return { error: code, message };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const startedAt = Date.now();

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const stamp = url.searchParams.get('stamp') === 'true';

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    console.log(JSON.stringify({ event: 'auth-ping', status: 401, error: 'missing_auth', latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('missing_auth', 'Authorization Bearer header mancante.'), 401);
  }
  const jwt = authHeader.slice(7).trim();

  const userResp = await serviceClient.auth.getUser(jwt);
  if (userResp.error || !userResp.data?.user) {
    console.log(JSON.stringify({ event: 'auth-ping', status: 401, error: 'invalid_token', latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('invalid_token', 'JWT non valido o scaduto.'), 401);
  }
  const userId = userResp.data.user.id;

  const profileResp = await serviceClient
    .from('profiles')
    .select('role, deleted_at')
    .eq('id', userId)
    .maybeSingle();
  if (profileResp.error) {
    console.error(JSON.stringify({ event: 'auth-ping', status: 500, error: 'profile_query_failed', message: profileResp.error.message, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('profile_query_failed', 'Errore di lettura del profilo.'), 500);
  }
  if (!profileResp.data) {
    console.log(JSON.stringify({ event: 'auth-ping', user_id: userId, status: 403, error: 'profile_not_found', latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('profile_not_found', 'Nessun profilo associato a questo utente.'), 403);
  }
  if (profileResp.data.deleted_at !== null) {
    console.log(JSON.stringify({ event: 'auth-ping', user_id: userId, status: 403, error: 'profile_deleted', latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('profile_deleted', 'Profilo cancellato.'), 403);
  }

  const role = profileResp.data.role as string;
  let stampApplied = false;
  if (stamp) {
    const updResp = await serviceClient
      .from('profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', userId);
    if (updResp.error) {
      console.error(JSON.stringify({
        event: 'auth-ping',
        user_id: userId,
        role,
        stamp: true,
        stamp_applied: false,
        error: 'stamp_failed',
        message: updResp.error.message,
        latency_ms: Date.now() - startedAt
      }));
    } else {
      stampApplied = true;
    }
  }

  console.log(JSON.stringify({
    event: 'auth-ping',
    user_id: userId,
    role,
    stamp,
    stamp_applied: stampApplied,
    status: 200,
    latency_ms: Date.now() - startedAt
  }));

  return jsonResponse({
    user_id: userId,
    role,
    stamp_applied: stampApplied
  }, 200);
});
