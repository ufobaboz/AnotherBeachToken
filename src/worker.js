const TOKEN_RE    = /^\/qr\/[A-Z2-7]{32}$/;
const UUID_RE     = /^\/customers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHECKOUT_RE = /^\/checkout\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PROBE_TIMEOUT_MS = 3000;
const DEFAULT_TTL_HEALTHY = 1800;
const DEFAULT_TTL_PAUSED  = 30;

function shouldBypassPausedCheck(pathname) {
  if (pathname === '/__paused_status') return true;
  if (pathname === '/paused' || pathname === '/paused.html') return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname === '/manifest.json') return true;
  if (pathname === '/manifest.webmanifest') return true;
  if (pathname === '/site.webmanifest') return true;
  if (pathname === '/sw.js') return true;
  if (pathname === '/robots.txt') return true;
  if (pathname.startsWith('/assets/')) return true;
  if (pathname.startsWith('/vendor/')) return true;
  if (pathname.startsWith('/icons/')) return true;
  return false;
}

async function probeSupabase(env) {
  if (!env.SUPABASE_URL) {
    console.error('[paused-check] SUPABASE_URL missing');
    return { paused: false, reason: 'no_url' };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const resp = await fetch(env.SUPABASE_URL + '/auth/v1/health', {
      method: 'GET',
      headers: {
        'User-Agent': 'anotherbeachproject-paused-check/1',
        'Accept': 'application/json'
      },
      signal: ac.signal
    });
    clearTimeout(timer);
    const status = resp.status;
    const ct = resp.headers.get('content-type') || '';
    const text = await resp.text();

    if (ct.includes('application/json')) {
      return { paused: false, reason: 'healthy', status: status };
    }
    if (ct.includes('text/html') && /paused/i.test(text)) {
      return { paused: true, reason: 'paused', status: status };
    }
    return { paused: false, reason: 'unknown_response', status: status };
  } catch (e) {
    clearTimeout(timer);
    return { paused: false, reason: 'fetch_error', error: String(e && e.message || e) };
  }
}

async function getPausedState(env, ctx, force) {
  const cache = caches.default;
  const cacheKey = new Request('https://internal/paused-check/' + encodeURIComponent(env.SUPABASE_URL || 'none'));

  if (!force) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      try { return await hit.json(); } catch (e) { /* fall through */ }
    }
  }

  const fresh = await probeSupabase(env);
  const ttlHealthy = parseInt(env.PAUSED_CACHE_TTL_HEALTHY || String(DEFAULT_TTL_HEALTHY), 10);
  const ttlPaused  = parseInt(env.PAUSED_CACHE_TTL_PAUSED  || String(DEFAULT_TTL_PAUSED),  10);
  const ttl = fresh.paused ? ttlPaused : ttlHealthy;

  const enriched = Object.assign({}, fresh, { cached_at: Date.now(), ttl_seconds: ttl });
  const cacheResp = new Response(JSON.stringify(enriched), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'max-age=' + ttl
    }
  });
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(cache.put(cacheKey, cacheResp.clone()));
  } else {
    await cache.put(cacheKey, cacheResp.clone());
  }
  return enriched;
}

async function isSupabasePaused(env, ctx, force) {
  if (env.FORCE_PAUSED_STATE === 'paused')  return { paused: true,  forced: true, reason: 'forced_paused' };
  if (env.FORCE_PAUSED_STATE === 'healthy') return { paused: false, forced: true, reason: 'forced_healthy' };
  return await getPausedState(env, ctx, !!force);
}

async function handlePausedStatus(request, env, ctx) {
  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';
  let state;
  try {
    state = await isSupabasePaused(env, ctx, force);
  } catch (e) {
    console.error('[paused-status] error:', e);
    state = { paused: false, reason: 'exception' };
  }
  if (state.cached_at) {
    state.age_seconds = Math.max(0, Math.floor((Date.now() - state.cached_at) / 1000));
  }
  return new Response(JSON.stringify(state), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': force ? 'no-store' : 'public, max-age=10'
    }
  });
}

async function servePausedPage(request, env) {
  const pausedUrl = new URL('/paused', request.url);
  const assetResp = await env.ASSETS.fetch(new Request(pausedUrl, { method: 'GET' }));
  const body = await assetResp.text();
  return new Response(body, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const rawPath = url.pathname;

    if (rawPath === '/__paused_status') {
      return await handlePausedStatus(request, env, ctx);
    }

    if (!shouldBypassPausedCheck(rawPath)) {
      let state = { paused: false };
      try {
        state = await isSupabasePaused(env, ctx, false);
      } catch (e) {
        console.error('[paused-check] error:', e);
      }
      if (state.paused) {
        return await servePausedPage(request, env);
      }
    }

    const path = rawPath.replace(/\/$/, '') || '/';

    // ASSETS fa extension stripping: /foo -> foo.html, /foo.html -> 307 a /foo.
    // Quindi target senza .html.
    let target = null;
    if (TOKEN_RE.test(path)) {
      target = '/qr';
    } else if (path === '/customers/new') {
      target = '/customer-new';
    } else if (UUID_RE.test(path)) {
      target = '/customer-detail';
    } else if (CHECKOUT_RE.test(path)) {
      target = '/checkout';
    }

    if (target) {
      const targetUrl = new URL(target, request.url);
      return env.ASSETS.fetch(new Request(targetUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
