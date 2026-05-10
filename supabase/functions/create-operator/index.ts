// repo/supabase/functions/create-operator/index.ts
// Edge function Deno. Chiamante admin+ via JWT. Crea utente in auth.users
// (email + password, email_confirm=true) + INSERT profiles role='operator'.
// Rollback compensativo (auth.admin.deleteUser) se l'INSERT profiles fallisce.

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
    event: 'create-operator',
    error: 'missing_env',
    message: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set'
  }));
}

const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

interface CreateOperatorBody {
  email?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  notes?: string | null;
  role?: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function errorBody(code: string, message: string): { error: string; message: string } {
  return { error: code, message };
}

async function checkCallerAdminOrAbove(req: Request): Promise<
  { ok: true; userId: string; role: string } | { ok: false; resp: Response }
> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    console.log(JSON.stringify({ event: 'create-operator', status: 401, error: 'missing_auth' }));
    return { ok: false, resp: jsonResponse(errorBody('missing_auth', 'Authorization Bearer mancante.'), 401) };
  }
  const jwt = authHeader.slice(7).trim();
  const userResp = await serviceClient.auth.getUser(jwt);
  if (userResp.error || !userResp.data?.user) {
    console.log(JSON.stringify({ event: 'create-operator', status: 401, error: 'invalid_token' }));
    return { ok: false, resp: jsonResponse(errorBody('invalid_token', 'JWT non valido o scaduto.'), 401) };
  }
  const userId = userResp.data.user.id;
  const profileResp = await serviceClient
    .from('profiles')
    .select('role, deleted_at')
    .eq('id', userId)
    .maybeSingle();
  if (profileResp.error) {
    console.error(JSON.stringify({ event: 'create-operator', status: 500, error: 'unknown_error', message: profileResp.error.message }));
    return { ok: false, resp: jsonResponse(errorBody('unknown_error', profileResp.error.message), 500) };
  }
  if (!profileResp.data) {
    console.log(JSON.stringify({ event: 'create-operator', status: 403, error: 'profile_not_found' }));
    return { ok: false, resp: jsonResponse(errorBody('profile_not_found', 'Profilo non trovato.'), 403) };
  }
  if (profileResp.data.deleted_at !== null) {
    console.log(JSON.stringify({ event: 'create-operator', status: 403, error: 'profile_deleted' }));
    return { ok: false, resp: jsonResponse(errorBody('profile_deleted', 'Profilo cancellato.'), 403) };
  }
  const role = profileResp.data.role as string;
  if (role !== 'admin' && role !== 'super_admin') {
    console.log(JSON.stringify({ event: 'create-operator', status: 403, error: 'forbidden_role' }));
    return { ok: false, resp: jsonResponse(errorBody('forbidden_role', 'Ruolo insufficiente.'), 403) };
  }
  return { ok: true, userId, role };
}

function isValidEmail(s: string): boolean {
  return /^.+@.+\..+$/.test(s) && s.length <= 200;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return jsonResponse(errorBody('bad_request', 'Metodo non supportato.'), 405);
  }

  const caller = await checkCallerAdminOrAbove(req);
  if (!caller.ok) return caller.resp;

  let body: CreateOperatorBody;
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse(errorBody('bad_request', 'Body JSON malformato.'), 400);
  }

  const email = (body.email || '').trim();
  const password = body.password || '';
  const firstName = (body.first_name || '').trim();
  const lastName = (body.last_name || '').trim();
  const notes = body.notes ? String(body.notes).trim() : null;

  if (!isValidEmail(email)) {
    return jsonResponse(errorBody('bad_request', 'Email invalida.'), 400);
  }
  if (!password || password.length < 8 || password.length > 200) {
    return jsonResponse(errorBody('bad_request', 'Password deve avere fra 8 e 200 caratteri.'), 400);
  }
  if (!firstName || firstName.length > 120) {
    return jsonResponse(errorBody('bad_request', 'Nome obbligatorio (max 120).'), 400);
  }
  if (!lastName || lastName.length > 120) {
    return jsonResponse(errorBody('bad_request', 'Cognome obbligatorio (max 120).'), 400);
  }
  if (notes && notes.length > 1000) {
    return jsonResponse(errorBody('bad_request', 'Note troppo lunghe (max 1000).'), 400);
  }

  const role = (body.role || 'operator').trim();
  if (role !== 'operator' && role !== 'admin') {
    console.log(JSON.stringify({ event: 'create-operator', status: 400, error: 'bad_request', message: 'invalid_role', caller_id: caller.userId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('bad_request', 'role deve essere operator o admin.'), 400);
  }
  if (role === 'admin' && caller.role !== 'super_admin') {
    console.log(JSON.stringify({ event: 'create-operator', status: 403, error: 'forbidden_role', caller_id: caller.userId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('forbidden_role', 'Solo super_admin puo\' creare admin.'), 403);
  }

  // 1. createUser
  const createResp = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (createResp.error) {
    const msg = (createResp.error.message || '').toLowerCase();
    // Supabase Auth Admin API non espone un error code strutturato per email duplicata:
    // rileviamo via string match sul messaggio. Aggiornare se l'SDK introduce un campo dedicato.
    if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
      console.log(JSON.stringify({ event: 'create-operator', status: 409, error: 'email_already_exists', caller_id: caller.userId, latency_ms: Date.now() - startedAt }));
      return jsonResponse(errorBody('email_already_exists', 'Email gia\' registrata.'), 409);
    }
    if (msg.includes('password') || msg.includes('weak')) {
      console.log(JSON.stringify({ event: 'create-operator', status: 422, error: 'weak_password', caller_id: caller.userId, latency_ms: Date.now() - startedAt }));
      return jsonResponse(errorBody('weak_password', 'Password troppo debole.'), 422);
    }
    console.error(JSON.stringify({ event: 'create-operator', status: 500, error: 'unknown_error', message: createResp.error.message, caller_id: caller.userId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('unknown_error', createResp.error.message), 500);
  }
  const newUserId = createResp.data.user?.id;
  if (!newUserId) {
    console.error(JSON.stringify({ event: 'create-operator', status: 500, error: 'no_user_id', caller_id: caller.userId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('unknown_error', 'createUser non ha restituito un id.'), 500);
  }

  // 2. INSERT profiles
  const insertResp = await serviceClient.from('profiles').insert({
    id: newUserId,
    first_name: firstName,
    last_name: lastName,
    role: role,
    notes,
    last_modified_by_id: caller.userId
  });

  if (insertResp.error) {
    // Rollback compensativo
    const delResp = await serviceClient.auth.admin.deleteUser(newUserId);
    if (delResp.error) {
      console.error(JSON.stringify({
        event: 'create-operator-orphan',
        status: 500,
        error: 'orphan_after_failed_insert',
        message: insertResp.error.message,
        delete_error: delResp.error.message,
        caller_id: caller.userId,
        new_user_id: newUserId,
        latency_ms: Date.now() - startedAt
      }));
      return jsonResponse(errorBody('unknown_error', 'INSERT profiles failed AND rollback deleteUser failed. Manual cleanup required.'), 500);
    }
    console.error(JSON.stringify({
      event: 'create-operator',
      status: 500,
      error: 'insert_failed_rolled_back',
      message: insertResp.error.message,
      caller_id: caller.userId,
      latency_ms: Date.now() - startedAt
    }));
    return jsonResponse(errorBody('unknown_error', 'INSERT profiles fallito, utente Auth rimosso.'), 500);
  }

  console.log(JSON.stringify({
    event: 'create-operator',
    status: 200,
    caller_id: caller.userId,
    new_user_id: newUserId,
    role: role,
    latency_ms: Date.now() - startedAt
  }));

  return jsonResponse({ ok: true, profile_id: newUserId }, 200);
});
