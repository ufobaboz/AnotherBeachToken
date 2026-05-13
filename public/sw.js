// Minimo per soddisfare il criterio di installabilita' (manifest + fetch
// handler). NESSUNA cache: la web app cambia spesso e una cache stale
// produrrebbe bug operatore difficili da diagnosticare.

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  event.respondWith(fetch(event.request));
});
