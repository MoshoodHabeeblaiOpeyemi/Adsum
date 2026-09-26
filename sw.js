// Bump this version string on EVERY deploy so the SW refreshes automatically
const CACHE_NAME = "veripresenx-static-v35";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/app.js",
  "/style.css",
  "/role-picker.css",
  "/adviser.css",
  "/manifest.json",
  "/brand/mark-64-cutout.png",
  "/brand/mark-256-cutout.png",
  "/brand/veripresenx-wordmark.png",
  "/brand/favicon-32.png",
  "/brand/apple-touch-icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      // skipWaiting immediately so the new SW activates without waiting for
      // all tabs to close — users never see stale JS after a deploy
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle GET requests from this origin
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Never cache Firebase, API, authentication, or Firestore traffic
  if (
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("firebase") ||
    url.hostname.includes("googleapis") ||
    url.hostname.includes("gstatic")
  ) {
    return;
  }

  // App shell: ALWAYS network-first with no-store so deploys propagate instantly.
  // Fall back to cache only when offline.
  if (
    url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname === "/app.js" ||
    url.pathname === "/style.css"
  ) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Other same-origin static assets (icons, manifest): cache-first
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});

// Listen for SKIP_WAITING message from clients (sent on SW update detection)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
