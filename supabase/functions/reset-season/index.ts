// Filosofia: meglio non resettare che resettare senza backup. Se un upload R2
// fallisce, l'eventuale orphan rimane su R2 ma TRUNCATE NON viene eseguito.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';
import { S3Client, PutObjectCommand } from 'https://esm.sh/@aws-sdk/client-s3@3';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Max-Age': '86400'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID') ?? '';
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '';
const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT') ?? '';
const R2_BUCKET = Deno.env.get('R2_BUCKET') ?? '';

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(JSON.stringify({
    event: 'reset-season', error: 'missing_supabase_env',
    message: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set'
  }));
}
if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_BUCKET) {
  console.error(JSON.stringify({
    event: 'reset-season', error: 'missing_r2_env',
    message: 'R2_* env vars not set; upload step will fail and TRUNCATE will be skipped'
  }));
}

const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  },
  forcePathStyle: true
});

// Sync con schema.sql E scripts/daily-backup-ita.mjs quando si aggiungono colonne.
const COLUMNS: Record<string, string[]> = {
  customers: [
    'id', 'qr_token', 'first_name', 'last_name', 'email', 'phone', 'notes',
    'created_by_id', 'last_modified_by_id', 'last_modified_at',
    'created_at', 'deleted_at'
  ],
  transactions: [
    'id', 'customer_id', 'user_id', 'type', 'amount', 'reversal_of_id',
    'paid', 'paid_at', 'payment_method', 'paid_by_id', 'notes',
    'created_at', 'deleted_at'
  ],
  profiles: [
    'id', 'first_name', 'last_name', 'role', 'last_login_at', 'notes',
    'created_at', 'last_modified_by_id', 'last_modified_at', 'deleted_at'
  ]
};

const TABLES = Object.keys(COLUMNS);

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function errorBody(code: string, message: string): { error: string; message: string } {
  return { error: code, message };
}

// RFC 4180 compatibile con 'COPY ... FROM CSV' di Postgres: boolean ->
// 'true'/'false', timestamptz come ISO, NULL -> empty field.
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v);
  if (typeof v === 'number') return s;
  if (/[,"\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function dumpTableCsv(table: string): Promise<{ csv: string; rowCount: number }> {
  const cols = COLUMNS[table];
  // .range(0, 49999): bypass del default supabase-js (1000) per coprire ~50k
  // transactions fine-stagione di ABT a regime.
  const resp = await serviceClient.from(table).select('*').range(0, 49999);
  if (resp.error) {
    throw new Error(`dump_${table}_failed: ${resp.error.message}`);
  }
  const rows = resp.data ?? [];
  const lines: string[] = [cols.join(',')];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    lines.push(cols.map((c) => csvEscape(r[c])).join(','));
  }
  return { csv: lines.join('\n'), rowCount: rows.length };
}

async function uploadToR2(key: string, body: string): Promise<void> {
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: 'text/csv; charset=utf-8'
  });
  await r2Client.send(cmd);
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

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse(errorBody('bad_request', 'Metodo non supportato.'), 405);

  const caller = await checkCallerSuperAdmin(req);
  if (!caller.ok) return caller.resp;

  const date = todayUtcIso();
  const prefix = `season-end/${date}/`;
  const counts: Record<string, number> = {};
  try {
    for (const table of TABLES) {
      const { csv, rowCount } = await dumpTableCsv(table);
      await uploadToR2(`${prefix}${table}.csv`, csv);
      counts[table] = rowCount;
      console.log(JSON.stringify({
        event: 'reset-season', step: 'backup_uploaded', table, rowCount,
        key: `${prefix}${table}.csv`
      }));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({
      event: 'reset-season', status: 500, error: 'backup_failed',
      message, caller_id: caller.userId,
      counts, latency_ms: Date.now() - startedAt
    }));
    return jsonResponse(
      errorBody('backup_failed', `Backup R2 fallito: ${message}. Nessun TRUNCATE eseguito.`),
      500
    );
  }

  const rpcResp = await serviceClient.rpc('reset_season');
  if (rpcResp.error) {
    console.error(JSON.stringify({
      event: 'reset-season', status: 500, error: 'rpc_failed',
      message: rpcResp.error.message, caller_id: caller.userId,
      latency_ms: Date.now() - startedAt
    }));
    return jsonResponse(errorBody('unknown_error', rpcResp.error.message), 500);
  }

  console.log(JSON.stringify({
    event: 'reset-season', status: 200,
    caller_id: caller.userId, counts, backup_prefix: prefix,
    latency_ms: Date.now() - startedAt
  }));
  return jsonResponse({
    ok: true,
    backup_prefix: prefix,
    counts,
    tables_truncated: ['customers', 'transactions']
  }, 200);
});
