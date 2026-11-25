/* Atlas service worker - just enough to make the installed app open
   cleanly. The page itself is fetched fresh every time (network first);
   the last good copy is kept only so a launch with no connection shows
   Atlas instead of the browser's error page. Nothing under /api/ is ever
   cached or even touched: your data and logins always go straight to the
   server. */
const CACHE = "atlas-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate"){
    e.respondWith(fetch(req).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put("/", res.clone()));
      return res;
    }).catch(() => caches.match("/")));
    return;
  }
  if (SHELL.includes(url.pathname))
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
