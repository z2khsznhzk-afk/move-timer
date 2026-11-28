'use strict';
// Version must change when files change so GitHub Pages users receive new releases.
const CACHE_NAME = 'move-freeform-v4-20261128';
const ASSETS = [
  './', './index.html', './style.css', './app.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        // Bypass the HTTP cache, including on an app update.
        await cache.addAll(ASSETS.map(path => new Request(path, {cache:'reload'})));
      })
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(name => name.startsWith('move-') && name !== CACHE_NAME)
        .map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith(
    fetch(request).then(response => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {}));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const offlinePage = await caches.match('./index.html');
        if (offlinePage) return offlinePage;
      }
      return Response.error();
    })
  );
});
