import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';
import { S3Client, ListObjectsV2Command } from 'https://esm.sh/@aws-sdk/client-s3@3';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Max-Age': '86400'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID') ?? '';
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '';
const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT') ?? '';
const R2_BUCKET = Deno.env.get('R2_BUCKET') ?? '';

// Workflow daily backup gira solo su PRD. DEV ritorna 'n/a' (configured:false)
// per evitare alert spuri: bucket abt-backups-dev esiste solo per E2E reset.
const PRD_SUPABASE_URL = 'https://xccpopnwqrxjjhrtyiwd.supabase.co';
const IS_PRODUCTION = SUPABASE_URL === PRD_SUPABASE_URL;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(JSON.stringify({
    event: 'probe-backup-status', error: 'missing_supabase_env',
    message: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set'
  }));
}
if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_BUCKET) {
  console.error(JSON.stringify({
    event: 'probe-backup-status', error: 'missing_r2_env',
    message: 'R2_* env vars not set; probe will report missing config'
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

// 3 tabelle x 2 formati (pg-native + ITA).
const EXPECTED_FILES_PER_DAY = 6;

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
    return { ok: false, resp: jsonResponse(errorBody('forbidden_role', 'Solo super_admin puo leggere lo stato backup.'), 403) };
  }
  return { ok: true, userId };
}

interface BackupStatus {
  last_backup_date: string | null;
  last_backup_at: string | null;
  age_hours: number | null;
  expected_files: number;
  found_files: number;
  configured: boolean;
}

async function fetchBackupStatus(): Promise<BackupStatus> {
  if (!IS_PRODUCTION || !R2_ENDPOINT || !R2_BUCKET) {
    return {
      last_backup_date: null,
      last_backup_at: null,
      age_hours: null,
      expected_files: EXPECTED_FILES_PER_DAY,
      found_files: 0,
      configured: false
    };
  }

  const resp = await r2Client.send(new ListObjectsV2Command({
    Bucket: R2_BUCKET,
    Prefix: 'daily/'
  }));

  const contents = resp.Contents ?? [];
  const filesByDate = new Map<string, { count: number; lastModified: Date }>();
  for (const obj of contents) {
    const key = obj.Key ?? '';
    const match = key.match(/^daily\/(\d{4}-\d{2}-\d{2})\/.+$/);
    if (!match) continue;
    const date = match[1];
    const lm = obj.LastModified ?? new Date(0);
    const entry = filesByDate.get(date);
    if (entry) {
      entry.count += 1;
      if (lm > entry.lastModified) entry.lastModified = lm;
    } else {
      filesByDate.set(date, { count: 1, lastModified: lm });
    }
  }

  if (filesByDate.size === 0) {
    return {
      last_backup_date: null,
      last_backup_at: null,
      age_hours: null,
      expected_files: EXPECTED_FILES_PER_DAY,
      found_files: 0,
      configured: true
    };
  }

  const dates = Array.from(filesByDate.keys()).sort().reverse();
  const lastDate = dates[0];
  const entry = filesByDate.get(lastDate)!;
  const ageMs = Date.now() - entry.lastModified.getTime();
  const ageHours = Math.floor(ageMs / (1000 * 60 * 60));

  return {
    last_backup_date: lastDate,
    last_backup_at: entry.lastModified.toISOString(),
    age_hours: ageHours,
    expected_files: EXPECTED_FILES_PER_DAY,
    found_files: entry.count,
    configured: true
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(errorBody('bad_request', 'Metodo non supportato.'), 405);
  }

  const caller = await checkCallerSuperAdmin(req);
  if (!caller.ok) return caller.resp;

  try {
    const status = await fetchBackupStatus();
    console.log(JSON.stringify({
      event: 'probe-backup-status', status: 200,
      caller_id: caller.userId,
      last_backup_date: status.last_backup_date,
      age_hours: status.age_hours,
      found_files: status.found_files,
      latency_ms: Date.now() - startedAt
    }));
    return jsonResponse(status, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({
      event: 'probe-backup-status', status: 500, error: 'r2_list_failed',
      message, caller_id: caller.userId,
      latency_ms: Date.now() - startedAt
    }));
    return jsonResponse(errorBody('r2_list_failed', `Lettura R2 fallita: ${message}`), 500);
  }
});
