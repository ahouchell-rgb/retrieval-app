const CACHE = "feynman-shell-v1";
const SHELL = ["/", "/app", "/app-icon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Only the public shell and the static workspace shell are safe to cache.
    // Parent reports, reset links and any future private routes must always use
    // the network and must never be written to a shared-device browser cache.
    if (url.pathname !== "/" && url.pathname !== "/app") return;
    const shellKey = url.pathname === "/" ? "/" : "/app";
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(shellKey, copy));
      return response;
    }).catch(() => caches.match(shellKey)));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/app-icon.svg") {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
      return response;
    })));
  }
});
