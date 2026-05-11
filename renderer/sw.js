const CACHE_NAME = "financeiro-pwa-v56";

const APP_SHELL = [
  "/",
  "/app",
  "/motorista",
  "/login.html",
  "/index.html",
  "/motorista.html",
  "/login.css",
  "/style.css",
  "/motorista.css",
  "/login.js?v=12",
  "/app.js?v=30",
  "/motorista.js?v=2",
  "/pwa.js?v=12",
  "/vendor/leaflet/leaflet.css",
  "/vendor/leaflet/leaflet.js",
  "/vendor/leaflet/images/marker-icon.png",
  "/vendor/leaflet/images/marker-icon-2x.png",
  "/vendor/leaflet/images/marker-shadow.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/manifest.webmanifest",
  "/icons/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (["/lancamentos", "/veiculos", "/motoristas", "/motorista-mobile", "/localizacoes-motoristas", "/folha-pagamento", "/classificacoes", "/plano-contas", "/contas-receber", "/relatorios", "/ativos", "/passivos", "/estoque"].some((path) => url.pathname.startsWith(path))) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/login.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
