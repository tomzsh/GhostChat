/**
 * GhostChat service worker — installable shell only.
 * Never caches API responses, WebSocket, or message ciphertext.
 */
/* eslint-disable no-restricted-globals */
const CACHE = "ghostchat-shell-v1";
const PRECACHE = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

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

function isApiOrNonGet(request, url) {
  if (request.method !== "GET") return true;
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname.startsWith("/ws")) return true;
  // Never cache Next data / RSC flight as durable chat state
  if (url.pathname.includes("/_next/data/")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only same-origin
  if (url.origin !== self.location.origin) return;
  if (isApiOrNonGet(request, url)) return;

  // Navigations: network-first, fall back to cached shell
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) {
            caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() =>
          caches.match("/").then(
            (cached) =>
              cached ||
              new Response(
                "<!doctype html><meta charset=utf-8><title>GhostChat offline</title>" +
                  "<body style='background:#0a0a0a;color:#33ff66;font-family:monospace;padding:2rem'>" +
                  "<p>GhostChat is offline.</p><p>Reconnect to open or create a room.</p></body>",
                { headers: { "Content-Type": "text/html; charset=utf-8" } }
              )
          )
        )
    );
    return;
  }

  // Static assets: stale-while-revalidate for /_next/static and icons
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone()).catch(() => undefined);
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
