/* Offline cache so the PWA works with no network (typical on site). Bump VERSION when files change. */
var VERSION = 'cpf-sim-v1';
var FILES = ['./', 'index.html', 'css/style.css', 'js/engine.js', 'js/config.js', 'js/app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) { e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request); })); });
