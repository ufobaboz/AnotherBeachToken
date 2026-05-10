// repo/supabase/functions/reset-operator-password/index.ts
// TOMBSTONE M7: rinominato in 'reset-password'. Questa function ritorna 410.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Max-Age': '86400'
};

Deno.serve((req: Request): Response => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  console.log(JSON.stringify({
    event: 'reset-operator-password-tombstone',
    status: 410,
    message: 'Renamed to reset-password (M7).'
  }));
  return new Response(JSON.stringify({
    error: 'gone',
    message: 'reset-operator-password e\' stata rinominata in reset-password.'
  }), {
    status: 410,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
});
