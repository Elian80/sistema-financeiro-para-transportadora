// =========================================================
// pwa.js — Registro do Service Worker + fluxo de instalação
//
// Controla:
// - exibição do botão de instalar app (topbar);
// - toast de instalação persistente no canto da tela;
// - prompt nativo (beforeinstallprompt) no Android/Chrome;
// - orientação para instalação manual no iOS/Safari.
// =========================================================

(function () {
  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") {
    return;
  }

  let installPromptEvent = null;
  const installBtn = document.getElementById("install-pwa-btn");
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone;

  // Cria/mostra um toast fixo no canto da tela para instalar o app.
  // Mais visível que um botão na topbar em mobile.
  function mostrarToastInstalar() {
    if (isStandalone) return; // já está instalado, não mostra

    let toast = document.getElementById("pwa-install-toast");
    if (toast) {
      toast.style.display = "flex";
      return;
    }

    toast = document.createElement("div");
    toast.id = "pwa-install-toast";
    toast.innerHTML = `
      <div class="pwa-toast-icon">📲</div>
      <div class="pwa-toast-text">
        <strong>Instalar aplicativo</strong>
        <span>Acesse mais rápido como app nativo</span>
      </div>
      <button class="pwa-toast-btn" id="pwa-toast-install-btn">Instalar</button>
      <button class="pwa-toast-close" id="pwa-toast-close-btn" title="Fechar">✕</button>
    `;
    document.body.appendChild(toast);

    // Estilos embutidos para não depender do CSS carregado
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "80px", // acima da bottom nav mobile
      left: "50%",
      transform: "translateX(-50%)",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      background: "#1E2535",
      border: "1px solid rgba(99,102,241,0.4)",
      borderRadius: "14px",
      padding: "12px 14px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      zIndex: "9999",
      maxWidth: "340px",
      width: "calc(100% - 32px)",
      color: "#E2E8F0",
      fontFamily: "inherit",
      fontSize: "13px",
      animation: "pwaToastIn 0.3s ease",
    });

    const icon = toast.querySelector(".pwa-toast-icon");
    Object.assign(icon.style, { fontSize: "22px", flexShrink: "0" });

    const text = toast.querySelector(".pwa-toast-text");
    Object.assign(text.style, {
      flex: "1",
      display: "flex",
      flexDirection: "column",
      gap: "2px",
    });
    text.querySelector("strong").style.fontSize = "13px";
    text.querySelector("span").style.cssText = "font-size:11px;opacity:0.7;";

    const btnInstall = toast.querySelector("#pwa-toast-install-btn");
    Object.assign(btnInstall.style, {
      background: "linear-gradient(135deg,#6366F1,#4F46E5)",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      padding: "6px 14px",
      fontSize: "12px",
      fontWeight: "600",
      cursor: "pointer",
      flexShrink: "0",
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

    // Injeta keyframe de animação uma única vez
    if (!document.getElementById("pwa-toast-style")) {
      const s = document.createElement("style");
      s.id = "pwa-toast-style";
      s.textContent = `@keyframes pwaToastIn{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`;
      document.head.appendChild(s);
    }

    btnInstall.addEventListener("click", () => acionar_instalacao());
    btnClose.addEventListener("click", () => ocultarToast(true));
  }

  function ocultarToast(permanente) {
    const toast = document.getElementById("pwa-install-toast");
    if (toast) toast.style.display = "none";
    if (permanente) {
      // Marca que o usuário fechou — não mostra novamente nesta sessão
      sessionStorage.setItem("pwa_toast_dispensado", "1");
    }
  }

  function mostrarBotaoInstalar() {
    if (isStandalone) return;
    if (!installBtn) return;
    installBtn.hidden = false;
    if (isIos && !installPromptEvent) {
      installBtn.textContent = "📲 Instalar";
    }
    // Mostra o toast apenas se o usuário não o dispensou
    if (!sessionStorage.getItem("pwa_toast_dispensado")) {
      // Aguarda 2s para não aparecer imediatamente ao abrir
      setTimeout(mostrarToastInstalar, 2000);
    }
  }

  function ocultarBotaoInstalar() {
    if (installBtn) installBtn.hidden = true;
    ocultarToast(false);
  }

  async function acionar_instalacao() {
    if (!installPromptEvent) {
      // iOS ou navegadores sem suporte ao prompt nativo
      if (isIos) {
        alert(
          "No iPhone/iPad:\n1. Toque no ícone Compartilhar (quadrado com seta ↑)\n2. Role para baixo e toque em 'Adicionar a Tela de Início'\n3. Toque em 'Adicionar'"
        );
      } else {
        alert(
          "Para instalar:\n• No Android/Chrome: toque nos 3 pontos do menu → 'Instalar app'\n• No computador: clique no ícone de instalação na barra de endereços"
        );
      }
      return;
    }
    installPromptEvent.prompt();
    const { outcome } = await installPromptEvent.userChoice;
    installPromptEvent = null;
    if (outcome === "accepted") {
      ocultarBotaoInstalar();
    }
  }

  // Captura o evento ANTES de suprimir para ter o prompt disponível.
  // NÃO chama event.preventDefault() para que o Chrome também mostre
  // o mini-infobar nativo — dando duas chances ao usuário de instalar.
  window.addEventListener("beforeinstallprompt", (event) => {
    installPromptEvent = event;
    mostrarBotaoInstalar();
  });

  window.addEventListener("appinstalled", () => {
    installPromptEvent = null;
    ocultarBotaoInstalar();
  });

  // Clique no botão da topbar
  installBtn?.addEventListener("click", acionar_instalacao);

  window.addEventListener("load", () => {
    // iOS: mostra orientação manual pois não tem beforeinstallprompt
    if (isIos && !isStandalone) {
      mostrarBotaoInstalar();
    }

    // Registra o SW para cache/offline e força verificação de atualização.
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        registration.update();
      })
      .catch(() => {
        // O app continua funcionando mesmo se o navegador bloquear o PWA.
      });
  });
})();
