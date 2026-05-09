// repo/supabase/functions/update-profile/index.ts
// UPDATE profiles first_name/last_name/notes. Chiamante admin+ su operator,
// OR proprietario su se stesso (in M6 nessuna UI per il branch self, ma
// l'edge function lo accetta gia' per evitare di rifarla in M7).
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
    event: 'update-profile',
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

interface CallerInfo { userId: string; role: string; }

async function checkAuthenticatedCaller(req: Request): Promise<
  { ok: true; caller: CallerInfo } | { ok: false; resp: Response }
> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    console.log(JSON.stringify({ event: 'update-profile', status: 401, error: 'missing_auth' }));
    return { ok: false, resp: jsonResponse(errorBody('missing_auth', 'Authorization Bearer mancante.'), 401) };
  }
  const jwt = authHeader.slice(7).trim();
  const userResp = await serviceClient.auth.getUser(jwt);
  if (userResp.error || !userResp.data?.user) {
    console.log(JSON.stringify({ event: 'update-profile', status: 401, error: 'invalid_token' }));
    return { ok: false, resp: jsonResponse(errorBody('invalid_token', 'JWT non valido o scaduto.'), 401) };
  }
  const userId = userResp.data.user.id;
  const profileResp = await serviceClient
    .from('profiles').select('role, deleted_at').eq('id', userId).maybeSingle();
  if (profileResp.error) {
    console.error(JSON.stringify({ event: 'update-profile', status: 500, error: 'unknown_error', message: profileResp.error.message }));
    return { ok: false, resp: jsonResponse(errorBody('unknown_error', profileResp.error.message), 500) };
  }
  if (!profileResp.data) {
    console.log(JSON.stringify({ event: 'update-profile', status: 403, error: 'profile_not_found' }));
    return { ok: false, resp: jsonResponse(errorBody('profile_not_found', 'Profilo non trovato.'), 403) };
  }
  if (profileResp.data.deleted_at !== null) {
    console.log(JSON.stringify({ event: 'update-profile', status: 403, error: 'profile_deleted' }));
    return { ok: false, resp: jsonResponse(errorBody('profile_deleted', 'Profilo cancellato.'), 403) };
  }
  return { ok: true, caller: { userId, role: profileResp.data.role as string } };
}

interface UpdateProfileBody {
  target_id?: string;
  first_name?: string;
  last_name?: string;
  notes?: string | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse(errorBody('bad_request', 'Metodo non supportato.'), 405);

  const auth = await checkAuthenticatedCaller(req);
  if (!auth.ok) return auth.resp;
  const { caller } = auth;

  let body: UpdateProfileBody;
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse(errorBody('bad_request', 'Body JSON malformato.'), 400);
  }
  const targetId = (body.target_id || '').trim();
  const firstName = (body.first_name || '').trim();
  const lastName = (body.last_name || '').trim();
  const notes = body.notes === undefined || body.notes === null
    ? null
    : String(body.notes).trim();

  if (!UUID_RE.test(targetId)) {
    return jsonResponse(errorBody('bad_request', 'target_id deve essere UUID.'), 400);
  }
  if (!firstName || firstName.length > 120) {
    return jsonResponse(errorBody('bad_request', 'Nome obbligatorio (max 120).'), 400);
  }
  if (!lastName || lastName.length > 120) {
    return jsonResponse(errorBody('bad_request', 'Cognome obbligatorio (max 120).'), 400);
  }
  if (notes !== null && notes.length > 1000) {
    return jsonResponse(errorBody('bad_request', 'Note troppo lunghe (max 1000).'), 400);
  }

  // Authorization branches:
  // (a) caller modifica se stesso (proprietario): consentito qualsiasi ruolo
  // (b) caller admin+ modifica un operator
  const isSelf = caller.userId === targetId;
  const isAdminPlus = caller.role === 'admin' || caller.role === 'super_admin';

  if (!isSelf && !isAdminPlus) {
    console.log(JSON.stringify({ event: 'update-profile', status: 403, error: 'forbidden_role', caller_id: caller.userId, target_id: targetId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('forbidden_role', 'Ruolo insufficiente.'), 403);
  }

  // Lookup target
  const targetResp = await serviceClient
    .from('profiles').select('role, deleted_at').eq('id', targetId).maybeSingle();
  if (targetResp.error) {
    console.error(JSON.stringify({ event: 'update-profile', status: 500, error: 'unknown_error', message: targetResp.error.message, caller_id: caller.userId, target_id: targetId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('unknown_error', targetResp.error.message), 500);
  }
  if (!targetResp.data || targetResp.data.deleted_at !== null) {
    console.log(JSON.stringify({ event: 'update-profile', status: 404, error: 'target_not_found', caller_id: caller.userId, target_id: targetId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('target_not_found', 'Target non trovato.'), 404);
  }
  // Branch (b) richiede che il target sia operator
  if (!isSelf && targetResp.data.role !== 'operator') {
    console.log(JSON.stringify({ event: 'update-profile', status: 409, error: 'target_not_operator', caller_id: caller.userId, target_id: targetId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('target_not_operator', 'Target non e\' un operator (M6).'), 409);
  }

  const updResp = await serviceClient
    .from('profiles')
    .update({
      first_name: firstName,
      last_name: lastName,
      notes,
      last_modified_by_id: caller.userId
    })
    .eq('id', targetId);
  if (updResp.error) {
    console.error(JSON.stringify({ event: 'update-profile', status: 500, error: 'update_failed', message: updResp.error.message, caller_id: caller.userId, target_id: targetId, latency_ms: Date.now() - startedAt }));
    return jsonResponse(errorBody('unknown_error', updResp.error.message), 500);
  }

  console.log(JSON.stringify({ event: 'update-profile', status: 200, caller_id: caller.userId, target_id: targetId, is_self: isSelf, latency_ms: Date.now() - startedAt }));
  return jsonResponse({ ok: true }, 200);
});
