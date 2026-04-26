// Minimal service worker — exists primarily so Chrome on Android treats Liv
// as an installable PWA. We do not aggressively cache anything: live audio /
// video / WebSocket requests must always go to the network. The fetch handler
// is intentionally a passthrough.

self.addEventListener('install', (event) => {
  // Take over as soon as we're installed.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Passthrough — let the browser do its thing. Having any fetch handler at
  // all is enough for the PWA install criteria.
});
