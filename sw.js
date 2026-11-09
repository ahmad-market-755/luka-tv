// Service worker: يخلي التطبيق أسرع، ويفتح حتى لو النت قاطع (المحتوى المحفوظ فقط، مش الفيديوهات)
const CACHE = "luka-v3";
const SHELL = ["./", "index.html", "style.css", "app.js", "firebase-config.js", "manifest.json", "icon.svg", "icon-192.png", "icon-512.png", "offline.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // مكتبات Firebase: من الكاش أولاً (بتتغير نادراً)
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // ملفات التطبيق: من النت أولاً، ولو مفيش نت من الكاش
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html").then((r) => r || caches.match("offline.html")) : undefined)))
  );
});
