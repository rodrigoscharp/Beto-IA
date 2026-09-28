/* Beto service worker: installability, offline fallback e Web Push.
   Never caches /api/* or authenticated pages. */
const CACHE = "beto-shell-v4";
const SHELL = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
  }
});

/* Push: o servidor (cron) avisa mesmo com o app fechado.
   Sempre mostra a notificação: o iOS revoga a permissão de quem recebe push sem exibir nada. */
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { /* payload não-JSON */ }
  e.waitUntil(
    self.registration.showNotification(data.title || "Beto", {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => "focus" in w);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
