// =========================================================
// sw.js — Service Worker do Financeiro PWA
//
// Estratégia:
// - App shell em cache para carregamento rápido/offline parcial.
// - APIs dinâmicas sempre em rede (sem cache) para evitar dados antigos.
// - Ícones da empresa armazenados em cache separado (financeiro-icons).
//   O app.js envia o logo via postMessage → SW cacheia em /icons/icon-192.png
//   e /icons/icon-512.png → Chrome usa o logo real da empresa no prompt de install.
// - Limpeza automática de caches antigos na ativação.
// =========================================================

const CACHE_NAME = "financeiro-pwa-v70";
const ICON_CACHE  = "financeiro-icons-v1"; // cache exclusivo para ícones da empresa

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
  "/login.js?v=14",
  "/app.js?v=53",
  "/motorista.js?v=2",
  "/pwa.js?v=14",
  "/vendor/leaflet/leaflet.css",
  "/vendor/leaflet/leaflet.js",
  "/vendor/lucide/lucide.min.js",
  "/vendor/leaflet/images/marker-icon.png",
  "/vendor/leaflet/images/marker-icon-2x.png",
  "/vendor/leaflet/images/marker-shadow.png",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/cookies.js?v=1",
  "/privacidade.html",
  "/bg.js?v=1"
];

// ─── INSTALL ─────────────────────────────────────────────
// Usa Promise.all + catch individual: se um arquivo falhar, o SW
// ainda instala com sucesso (não bloqueia o beforeinstallprompt).
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            // Avisa no console mas NÃO rejeita a Promise — SW instala mesmo assim
            console.warn("[SW] Falha ao cachear:", url, err.message);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

// ─── ACTIVATE ────────────────────────────────────────────
// Remove caches antigos exceto o atual e o de ícones da empresa.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_NAME && n !== ICON_CACHE)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

// ─── MESSAGE ─────────────────────────────────────────────
// Recebe o logo da empresa gerado pelo Canvas (data: URI base64)
// e o armazena no ICON_CACHE para ser servido como ícone do PWA.
// Isso garante que o manifesto use URLs estáticas válidas enquanto
// o ícone real exibido no install prompt é o logo da empresa.
self.addEventListener("message", (event) => {
  // Limpa o ICON_CACHE quando a empresa não tem logo cadastrada,
  // garantindo que os PNGs estáticos do servidor sejam usados.
  if (event.data?.type === "CLEAR_COMPANY_ICON") {
    event.waitUntil(caches.delete(ICON_CACHE));
    return;
  }

  if (event.data?.type !== "SET_COMPANY_ICON") return;

  const { base64_192, base64_512 } = event.data;

  // Converte data: URI base64 em Uint8Array de bytes PNG
  function base64ParaBytes(dataUri) {
    const base64 = dataUri.split(",")[1];
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) {
      bytes[i] = binario.charCodeAt(i);
    }
    return bytes;
  }

  event.waitUntil(
    caches.open(ICON_CACHE).then(async (cache) => {
      try {
        if (base64_192) {
          const bytes = base64ParaBytes(base64_192);
          const resp = new Response(bytes, {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Content-Length": String(bytes.length),
              "Cache-Control": "no-transform",
            },
          });
          await cache.put("/icons/icon-192.png", resp);
        }
        if (base64_512) {
          const bytes = base64ParaBytes(base64_512);
          const resp = new Response(bytes, {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Content-Length": String(bytes.length),
              "Cache-Control": "no-transform",
            },
          });
          await cache.put("/icons/icon-512.png", resp);
          // Também cobre o apple-touch-icon com a versão 192
          if (base64_192) {
            const bytes192 = base64ParaBytes(base64_192);
            const respApple = new Response(bytes192, {
              status: 200,
              headers: { "Content-Type": "image/png" },
            });
            await cache.put("/icons/apple-touch-icon.png", respApple);
          }
        }
      } catch (err) {
        console.warn("[SW] Erro ao cachear ícone da empresa:", err);
      }
    })
  );
});

// ─── FETCH ───────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // Ícones do PWA: prioridade para o cache da empresa (logo customizado)
  // antes de cair no cache do app shell ou na rede.
  const iconPaths = ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];
  if (iconPaths.includes(url.pathname)) {
    event.respondWith(
      caches.open(ICON_CACHE).then(async (iconCache) => {
        const customIcon = await iconCache.match(request);
        if (customIcon) return customIcon;
        // Sem ícone da empresa: fallback ao cache do app shell ou rede
        const cached = await caches.match(request);
        return cached || fetch(request);
      })
    );
    return;
  }

  // Endpoints de negócio: sempre network-first sem fallback de cache.
  if (
    [
      "/lancamentos", "/veiculos", "/motoristas", "/motorista-mobile",
      "/localizacoes-motoristas", "/folha-pagamento", "/classificacoes",
      "/plano-contas", "/contas-receber", "/relatorios", "/ativos",
      "/passivos", "/estoque", "/configuracoes-empresa", "/auth",
      "/gm7-api",
    ].some((path) => url.pathname.startsWith(path))
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // Navegação: tenta rede primeiro; offline cai para login.html cacheado.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/login.html"))
    );
    return;
  }

  // Assets estáticos: cache-first.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
