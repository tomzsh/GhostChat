/**
 * GhostChat service worker — installable shell only.
 * Never caches API, WebSocket, room HTML, or message ciphertext.
 */
/* eslint-disable no-restricted-globals */
const CACHE = "ghostchat-shell-v2";
const PRECACHE = [
  "/",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function offlineHtml() {
  return new Response(
    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
      "<title>GhostChat offline</title>" +
      "<body style='margin:0;background:#0a0a0a;color:#33ff66;font-family:ui-monospace,monospace;padding:2rem'>" +
      "<p>$ ghostchat</p>" +
      "<p>Offline — reconnect to open or create a room.</p>" +
      "<p style='color:#6b7280'><a href='/' style='color:#33ff66'>← home</a></p>" +
      "</body>",
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function shouldBypass(request, url) {
  if (request.method !== "GET") return true;
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname.startsWith("/ws")) return true;
  if (url.pathname.includes("/_next/data/")) return true;
  // Next flight / RSC — always network
  if (request.headers.get("RSC") === "1") return true;
  if (request.headers.get("Next-Router-State-Tree")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (shouldBypass(request, url)) return;

  // Navigations: network-first. Only cache the landing document as shell.
  // Never put /r/* HTML under the "/" key (that broke offline + stale shell).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && url.pathname === "/") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(async () => {
          // Room routes: prefer soft offline page (no fake room UI without keys)
          if (url.pathname.startsWith("/r/")) {
            return offlineHtml();
          }
          const cached = await caches.match("/");
          return cached || offlineHtml();
        })
    );
    return;
  }

  // Static assets: stale-while-revalidate
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/sw.js" ||
    url.pathname.endsWith("manifest.webmanifest")
  ) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            // Don't cache service worker itself forever
            if (res.ok && url.pathname !== "/sw.js") {
              cache.put(request, res.clone()).catch(() => undefined);
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
