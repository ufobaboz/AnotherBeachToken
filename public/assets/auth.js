// repo/public/assets/auth.js
// Modulo IIFE che monta window.Auth. Dipende da window.supabase (libreria
// self-hosted in /vendor/supabase/.../supabase.js) e window.APP_CONFIG
// (generato da build.sh con SUPABASE_URL e SUPABASE_ANON_KEY).
//
// Espone:
// - Auth.client: client Supabase singleton
// - Auth.signIn(email, password) -> { ok, error? }
// - Auth.signOut(): redirect /login
// - Auth.requireAuth(): redirect /login se anon, ritorna sessione altrimenti
// - Auth.redirectIfAuthenticated(): redirect /customers se gia' loggato
// - Auth.requireSuperAdmin(): redirect /customers se role != super_admin
// - Auth.callAuthPing({stamp}): chiama edge function auth-ping
// - Auth.getRole(): ritorna il role corrente (cached), null se anon o errore
(function () {
  if (!window.APP_CONFIG || !window.APP_CONFIG.SUPABASE_URL || !window.APP_CONFIG.SUPABASE_ANON_KEY) {
    console.error('[auth] APP_CONFIG mancante: build.sh non ha iniettato le env vars.');
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    console.error('[auth] window.supabase non disponibile: vendor non caricato.');
    return;
  }

  var url = window.APP_CONFIG.SUPABASE_URL;
  var anon = window.APP_CONFIG.SUPABASE_ANON_KEY;
  var client = window.supabase.createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  var cachedRole = null;

  function mapSignInError(err) {
    if (!err) return 'unknown';
    var msg = (err.message || '').toLowerCase();
    if (msg.indexOf('invalid login credentials') !== -1) return 'invalid_credentials';
    if (msg.indexOf('failed to fetch') !== -1 || msg.indexOf('network') !== -1) return 'network';
    return 'unknown';
  }

  async function getSession() {
    var resp = await client.auth.getSession();
    return resp.data ? resp.data.session : null;
  }

  async function requireAuth() {
    var session = await getSession();
    if (!session) {
      window.location.replace('/login');
      return null;
    }
    return session;
  }

  async function redirectIfAuthenticated() {
    var session = await getSession();
    if (session) {
      window.location.replace('/customers');
    }
  }

  async function requireSuperAdmin() {
    var session = await requireAuth();
    if (!session) return null;
    var resp = await client.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
    if (resp.error) {
      console.error('[auth] requireSuperAdmin: error reading profile', resp.error);
      window.location.replace('/login');
      return null;
    }
    if (!resp.data || resp.data.role !== 'super_admin') {
      window.location.replace('/customers');
      return null;
    }
    cachedRole = resp.data.role;
    return session;
  }

  async function getRole() {
    if (cachedRole !== null) return cachedRole;
    var session = await getSession();
    if (!session) return null;
    var resp = await client.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
    if (resp.error || !resp.data) {
      console.warn('[auth] getRole: profile lookup failed', resp.error);
      return null;
    }
    cachedRole = resp.data.role;
    return cachedRole;
  }

  async function callAuthPing(opts) {
    var stamp = opts && opts.stamp ? 'true' : 'false';
    var session = await getSession();
    if (!session) throw new Error('no session');
    var endpoint = url + '/functions/v1/auth-ping?stamp=' + stamp;
    var startedAt = Date.now();
    var resp = await fetch(endpoint, {
      method: 'GET',
      keepalive: true,
      headers: {
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': anon
      }
    });
    var latency = Date.now() - startedAt;
    var body = null;
    try { body = await resp.json(); } catch (e) { body = null; }
    return { status: resp.status, latency_ms: latency, body: body };
  }

  async function signIn(email, password) {
    try {
      var resp = await client.auth.signInWithPassword({ email: email, password: password });
      if (resp.error) {
        return { ok: false, error: mapSignInError(resp.error) };
      }
      // fire-and-forget: lo stamping di last_login_at non blocca il login
      callAuthPing({ stamp: true }).catch(function (e) {
        console.warn('[auth] auth-ping stamp failed (non-fatal):', e);
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: mapSignInError(e) };
    }
  }

  async function signOut() {
    cachedRole = null;
    try {
      await client.auth.signOut();
    } catch (e) {
      console.warn('[auth] signOut error (proceeding):', e);
    }
    window.location.replace('/login');
  }

  window.Auth = {
    client: client,
    signIn: signIn,
    signOut: signOut,
    requireAuth: requireAuth,
    redirectIfAuthenticated: redirectIfAuthenticated,
    requireSuperAdmin: requireSuperAdmin,
    getRole: getRole,
    callAuthPing: callAuthPing
  };
})();
