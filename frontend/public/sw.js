// MolTol service worker — minimal, just enough for PWA installability
// (Chrome's install criteria require a registered worker with a fetch
// handler). No offline caching strategy yet; every request still goes
// straight to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
