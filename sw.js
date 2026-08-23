/* Cache-first service worker. The app makes zero network calls at runtime
   (IndexedDB + file export only), so this only needs to guarantee the app
   shell itself loads with no connectivity after the first successful visit. */

const CACHE_NAME = "scene-capture-v5";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./fields.js",
  "./db.js",
  "./signature_pad.js",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
