/**
 * ONLYOFFICE Service Worker Disabler / Cleaner
 * In pure frontend / Pages deployment, service workers interfering with mock sockets
 * and in-memory streams cause fetch errors. This script automatically unregisters itself.
 */

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }).then(function () {
      return self.registration.unregister();
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Do not intercept any fetch events
self.addEventListener('fetch', function (event) {
  return;
});