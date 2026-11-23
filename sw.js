// Leonida Vault – Service Worker
// CACHE_VERSION bei jeder Änderung an den App-Dateien erhöhen, damit Nutzer das Update bekommen.
const CACHE_VERSION = "lv-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Externe Links (YouTube, Artikel) nicht abfangen.
  if (url.origin !== self.location.origin) return;

  // Seite selbst: zuerst Netz (frische Inhalte), offline aus dem Cache.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Update-Datei immer frisch aus dem Netz (Cache nur als Notfall).
  if (url.pathname.endsWith("/data/updates.json")) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Übrige Dateien: Cache zuerst, im Hintergrund aktualisieren.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
