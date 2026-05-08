// repo/src/worker.js
// Worker handler per route con dynamic param. Tutte le altre
// pagine (login, customers, probe, /) sono servite via extension
// stripping nativo di Workers Static Assets (passthrough).
const TOKEN_RE = /^\/qr\/[A-Z2-7]{32}$/;
const UUID_RE  = /^\/customers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    // Il binding ASSETS applica extension stripping: richiedere /foo
    // serve foo.html senza redirect. Richiedere /foo.html causa un
    // 307 verso /foo. Quindi il target va passato senza .html.
    let target = null;
    if (TOKEN_RE.test(path)) {
      target = '/qr';
    } else if (path === '/customers/new') {
      target = '/customer-new';
    } else if (UUID_RE.test(path)) {
      target = '/customer-detail';
    }

    if (target) {
      const targetUrl = new URL(target, request.url);
      return env.ASSETS.fetch(new Request(targetUrl, request));
    }

    // tutto il resto: passthrough, riusa extension stripping nativo
    return env.ASSETS.fetch(request);
  }
};
