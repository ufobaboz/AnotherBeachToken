const TOKEN_RE    = /^\/qr\/[A-Z2-7]{32}$/;
const UUID_RE     = /^\/customers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHECKOUT_RE = /^\/checkout\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

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
