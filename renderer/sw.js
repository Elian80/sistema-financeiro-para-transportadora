const CACHE_NAME = "financeiro-pwa-v46";

const APP_SHELL = [
  "/",
  "/app",
  "/login.html",
  "/index.html",
  "/login.css",
  "/style.css",
  "/login.js?v=12",
  "/app.js?v=25",
  "/pwa.js?v=11",
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

  if (["/lancamentos", "/veiculos", "/motoristas", "/folha-pagamento", "/classificacoes", "/plano-contas", "/contas-receber", "/relatorios", "/ativos", "/passivos", "/estoque"].some((path) => url.pathname.startsWith(path))) {
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
