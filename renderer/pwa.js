// =========================================================
// pwa.js — Registro do Service Worker + fluxo de instalação
//
// Controla:
// - exibição do botão de instalar app (topbar);
// - toast de instalação persistente no canto da tela;
// - prompt nativo (beforeinstallprompt) no Android/Chrome;
// - orientação para instalação manual no iOS/Safari.
// =========================================================

// =========================================================
// pwa.js v14 — Registro do Service Worker + fluxo de instalação
//
// Controla:
// - exibição do botão de instalar app (topbar);
// - toast adaptativo: canto inferior direito em desktop,
//   centralizado acima da bottom nav em mobile;
// - prompt nativo (beforeinstallprompt) no Android/Chrome/Edge PC;
// - orientação para instalação manual no iOS/Safari.
// =========================================================

(function () {
  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") {
    return;
  }

  let installPromptEvent = null;
  const installBtn = document.getElementById("install-pwa-btn");
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isMobile = /android|mobile|tablet/i.test(navigator.userAgent) || isIos;
  const isDesktop = !isMobile;
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone;

  // ── Toast de instalação ──────────────────────────────────
  // Desktop: canto inferior direito, aparece na hora.
  // Mobile : centralizado, acima da bottom nav, após 2s.
  function mostrarToastInstalar() {
    if (isStandalone) return;

    let toast = document.getElementById("pwa-install-toast");
    if (toast) { toast.style.display = "flex"; return; }

    const emoji = isDesktop ? "🖥️" : "📲";
    const titulo = isDesktop ? "Instalar no computador" : "Instalar aplicativo";
    const sub    = isDesktop
      ? "Abra como app sem precisar do navegador"
      : "Acesse mais rápido como app nativo";

    toast = document.createElement("div");
    toast.id = "pwa-install-toast";
    toast.innerHTML = `
      <div class="pwa-toast-icon">${emoji}</div>
      <div class="pwa-toast-text">
        <strong>${titulo}</strong>
        <span>${sub}</span>
      </div>
      <button class="pwa-toast-btn" id="pwa-toast-install-btn">Instalar</button>
      <button class="pwa-toast-close" id="pwa-toast-close-btn" title="Fechar">✕</button>
    `;
    document.body.appendChild(toast);

    // Injeta keyframes (uma única vez)
    if (!document.getElementById("pwa-toast-style")) {
      const s = document.createElement("style");
      s.id = "pwa-toast-style";
      s.textContent = isDesktop
        ? `@keyframes pwaToastIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`
        : `@keyframes pwaToastIn{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`;
      document.head.appendChild(s);
    }

    // Posição base
    Object.assign(toast.style, {
      position: "fixed",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      background: "#1E2535",
      border: "1px solid rgba(34,211,238,0.35)",
      borderRadius: "14px",
      padding: "14px 16px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
      zIndex: "9999",
      color: "#E2E8F0",
      fontFamily: "inherit",
      fontSize: "13px",
      animation: "pwaToastIn 0.3s ease",
    });

    if (isDesktop) {
      // Canto inferior direito — longe da bottom nav (inexistente no desktop)
      Object.assign(toast.style, {
        bottom: "28px",
        right: "28px",
        left: "auto",
        transform: "none",
        maxWidth: "320px",
        width: "auto",
      });
    } else {
      // Centralizado, acima da bottom nav mobile (altura ~64px)
      Object.assign(toast.style, {
        bottom: "80px",
        left: "50%",
        right: "auto",
        transform: "translateX(-50%)",
        maxWidth: "340px",
        width: "calc(100% - 32px)",
      });
    }

    const icon = toast.querySelector(".pwa-toast-icon");
    Object.assign(icon.style, { fontSize: "22px", flexShrink: "0" });

    const text = toast.querySelector(".pwa-toast-text");
    Object.assign(text.style, { flex: "1", display: "flex", flexDirection: "column", gap: "2px" });
    text.querySelector("strong").style.fontSize = "13px";
    text.querySelector("span").style.cssText = "font-size:11px;opacity:0.7;";

    const btnInstall = toast.querySelector("#pwa-toast-install-btn");
    Object.assign(btnInstall.style, {
      background: "linear-gradient(135deg,#22D3EE,#3B82F6)",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      padding: "7px 16px",
      fontSize: "12px",
      fontWeight: "700",
      cursor: "pointer",
      flexShrink: "0",
      whiteSpace: "nowrap",
    });

    const btnClose = toast.querySelector("#pwa-toast-close-btn");
    Object.assign(btnClose.style, {
      background: "transparent",
      border: "none",
      color: "#94A3B8",
      cursor: "pointer",
      fontSize: "14px",
      padding: "4px",
      flexShrink: "0",
    });

    btnInstall.addEventListener("click", () => acionar_instalacao());
    btnClose.addEventListener("click", () => ocultarToast(true));
  }

  function ocultarToast(permanente) {
    const toast = document.getElementById("pwa-install-toast");
    if (toast) toast.style.display = "none";
    if (permanente) sessionStorage.setItem("pwa_toast_dispensado", "1");
  }

  function mostrarBotaoInstalar() {
    if (isStandalone) return;
    if (installBtn) {
      installBtn.hidden = false;
      installBtn.textContent = isDesktop ? "🖥️ Instalar app" : "📲 Instalar app";
    }
    if (!sessionStorage.getItem("pwa_toast_dispensado")) {
      // Desktop: aparece logo; mobile: aguarda 2s para não interromper o carregamento
      setTimeout(mostrarToastInstalar, isDesktop ? 800 : 2000);
    }
  }

  function ocultarBotaoInstalar() {
    if (installBtn) installBtn.hidden = true;
    ocultarToast(false);
  }

  async function acionar_instalacao() {
    if (!installPromptEvent) {
      if (isIos) {
        alert(
          "No iPhone/iPad:\n1. Toque no ícone Compartilhar (quadrado com seta ↑)\n2. Role para baixo e toque em 'Adicionar a Tela de Início'\n3. Toque em 'Adicionar'"
        );
      } else if (isDesktop) {
        alert(
          "Para instalar no computador:\n• Chrome/Edge: clique no ícone ⊕ na barra de endereços (lado direito)\n• Ou acesse o menu (⋮) → 'Instalar GM7 Log'"
        );
      } else {
        alert(
          "Para instalar:\n• Android/Chrome: toque nos 3 pontos → 'Instalar app'\n• Samsung Internet: toque em Adicionar → 'Instalar'"
        );
      }
      return;
    }
    installPromptEvent.prompt();
    const { outcome } = await installPromptEvent.userChoice;
    installPromptEvent = null;
    if (outcome === "accepted") ocultarBotaoInstalar();
  }

  // NÃO chama preventDefault — o Chrome mostra o mini-infobar nativo
  // E o toast customizado em paralelo (duas chances de instalar).
  window.addEventListener("beforeinstallprompt", (event) => {
    installPromptEvent = event;
    mostrarBotaoInstalar();
  });

  window.addEventListener("appinstalled", () => {
    installPromptEvent = null;
    ocultarBotaoInstalar();
  });

  installBtn?.addEventListener("click", acionar_instalacao);

  window.addEventListener("load", () => {
    // iOS: orientação manual pois não tem beforeinstallprompt
    if (isIos && !isStandalone) mostrarBotaoInstalar();

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.update())
      .catch(() => {});
  });
})();
