// Re-auth con anonClient (NON serviceClient): la service_role bypassa i
// rate-limit Auth, esponendo al brute force della old_password con JWT valido.
// Inoltre signInWithPassword muta lo stato auth del client, sub-ottimale su un
// singleton privilegiato condiviso fra richieste.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Max-Age': '86400'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
  console.error(JSON.stringify({
    event: 'change-own-password',
    error: 'missing_env',
    message: 'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o SUPABASE_ANON_KEY non impostata'
  }));
}

const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const anonClient: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
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

interface CallerInfo { userId: string; role: string; email: string; }

async function checkAuthenticatedCaller(req: Request): Promise<
  { ok: true; caller: CallerInfo } | { ok: false; resp: Response }
> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    console.log(JSON.stringify({ event: 'change-own-password', status: 401, error: 'missing_auth' }));
    return { ok: false, resp: jsonResponse(errorBody('missing_auth', 'Authorization Bearer mancante.'), 401) };
  }
  const jwt = authHeader.slice(7).trim();
  const userResp = await serviceClient.auth.getUser(jwt);
  if (userResp.error || !userResp.data?.user) {
    console.log(JSON.stringify({ event: 'change-own-password', status: 401, error: 'invalid_token' }));
    return { ok: false, resp: jsonResponse(errorBody('invalid_token', 'JWT non valido o scaduto.'), 401) };
  }
  const userId = userResp.data.user.id;
  const email = userResp.data.user.email ?? '';
  if (!email) {
    console.error(JSON.stringify({ event: 'change-own-password', status: 500, error: 'no_email_on_auth_user', user_id: userId }));
    return { ok: false, resp: jsonResponse(errorBody('unknown_error', 'Email non disponibile sull\'utente Auth.'), 500) };
  }
  const profileResp = await serviceClient
    .from('profiles').select('role, deleted_at').eq('id', userId).maybeSingle();
  if (profileResp.error) {
    console.error(JSON.stringify({ event: 'change-own-password', status: 500, error: 'unknown_error', message: profileResp.error.message }));
    return { ok: false, resp: jsonResponse(errorBody('unknown_error', profileResp.error.message), 500) };
  }
  if (!profileResp.data) {
    console.log(JSON.stringify({ event: 'change-own-password', status: 403, error: 'profile_not_found' }));
    return { ok: false, resp: jsonResponse(errorBody('profile_not_found', 'Profilo non trovato.'), 403) };
  }
  if (profileResp.data.deleted_at !== null) {
    console.log(JSON.stringify({ event: 'change-own-password', status: 403, error: 'profile_deleted' }));
    return { ok: false, resp: jsonResponse(errorBody('profile_deleted', 'Profilo cancellato.'), 403) };
  }
  return { ok: true, caller: { userId, role: profileResp.data.role as string, email } };
}

interface ChangeOwnPasswordBody {
  old_password?: string;
  new_password?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse(errorBody('bad_request', 'Metodo non supportato.'), 405);

  const auth = await checkAuthenticatedCaller(req);
  if (!auth.ok) return auth.resp;
  const { caller } = auth;

  let body: ChangeOwnPasswordBody;
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse(errorBody('bad_request', 'Body JSON malformato.'), 400);
  }

  const oldPassword = body.old_password || '';
  const newPassword = body.new_password || '';

  if (!oldPassword || oldPassword.length < 8 || oldPassword.length > 200) {
    return jsonResponse(errorBody('bad_request', 'old_password obbligatoria, fra 8 e 200 char.'), 400);
  }
  if (!newPassword || newPassword.length < 8 || newPassword.length > 200) {
    return jsonResponse(errorBody('bad_request', 'new_password obbligatoria, fra 8 e 200 char.'), 400);
  }

  const reauthResp = await anonClient.auth.signInWithPassword({
    email: caller.email,
    password: oldPassword
  });
  if (reauthResp.error || !reauthResp.data?.user) {
    console.log(JSON.stringify({ event: 'change-own-password', status: 401, error: 'invalid_old_password', caller_id: caller.userId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('invalid_old_password', 'Vecchia password sbagliata.'), 401);
  }

  const updResp = await serviceClient.auth.admin.updateUserById(caller.userId, { password: newPassword });
  if (updResp.error) {
    const msg = (updResp.error.message || '').toLowerCase();
    if (msg.includes('password') && (msg.includes('weak') || msg.includes('short') || msg.includes('characters'))) {
      console.log(JSON.stringify({ event: 'change-own-password', status: 422, error: 'weak_password', caller_id: caller.userId, latency_ms: Date.now() - startedAt }));
      return jsonResponse(errorBody('weak_password', 'Nuova password troppo debole.'), 422);
    }
    console.error(JSON.stringify({ event: 'change-own-password', status: 500, error: 'update_failed', message: updResp.error.message, caller_id: caller.userId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('unknown_error', updResp.error.message), 500);
  }

  console.log(JSON.stringify({ event: 'change-own-password', status: 200, caller_id: caller.userId, latency_ms: Date.now() - startedAt }));
  return jsonResponse({ ok: true }, 200);
});
