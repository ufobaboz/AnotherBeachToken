// Service worker minimo: soddisfa il criterio di installabilita' (manifest
// valido + fetch handler) senza introdurre cache aggressiva. Strategia
// network-first totale: ogni richiesta passa alla rete, nessuna risposta
// viene servita da cache. Voluto: la web app cambia frequentemente durante
// la stagione e una cache stale = bug operatore difficile da diagnosticare.

self.addEventListener('install', function (event) {
  // Attiva subito il nuovo SW al posto del precedente.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  // Prendi controllo dei client gia' aperti (es. tab gia' su /customers).
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  // Passthrough esplicito: fetch handler richiesto da Chrome per il prompt
  // di installazione. Nessuna cache lookup, nessun caching.
  event.respondWith(fetch(event.request));
});
