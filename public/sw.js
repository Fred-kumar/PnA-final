const CACHE_NAME = "pna-v1";
const PRECACHE   = ["/", "/app.html", "/logo.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = e.request.url;
  if (url.includes("/api/") || url.includes("/socket.io/") || url.includes("/auth/")) return;
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        if (res.ok && e.request.method === "GET") {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached)
    )
  );
});

self.addEventListener("push", e => {
  let data = { title: "P&A Connect", body: "You have a notification" };
  try { data = e.data.json(); } catch (_) {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body:    data.body,
    icon:    "/logo.png",
    badge:   "/logo.png",
    tag:     data.tag   || "pna",
    vibrate: [300, 100, 300],
    data:    { url: data.url || "/app.html" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
      const url = e.notification.data?.url || "/app.html";
      const existing = ws.find(w => w.url.includes("app.html"));
      if (existing) { existing.focus(); return; }
      clients.openWindow(url);
    })
  );
});
