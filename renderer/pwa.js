// =========================================================
// pwa.js — Registro do Service Worker + fluxo de instalação
//
// Controla:
// - exibição do botão de instalar app;
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
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone;

  function mostrarBotaoInstalar() {
    if (!installBtn) return;
    installBtn.hidden = false;
    if (isIos && !installPromptEvent) {
      installBtn.textContent = "Adicionar a tela inicial";
    }
  }

  function ocultarBotaoInstalar() {
    if (!installBtn) return;
    installBtn.hidden = true;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPromptEvent = event;
    mostrarBotaoInstalar();
  });

  window.addEventListener("appinstalled", () => {
    installPromptEvent = null;
    ocultarBotaoInstalar();
  });

  installBtn?.addEventListener("click", async () => {
    if (!installPromptEvent) {
      alert("No Android/Chrome, use o menu do navegador e escolha 'Instalar app' ou 'Adicionar a tela inicial'. No iPhone/Safari, toque em Compartilhar e depois em 'Adicionar a Tela de Inicio'. Acesse sempre pelo link HTTPS.");
      return;
    }

    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    installPromptEvent = null;
    ocultarBotaoInstalar();
  });

  window.addEventListener("load", () => {
    if (isIos && !isStandalone) {
      mostrarBotaoInstalar();
    }
    // Registra o SW para cache/offline e força verificação de atualização.
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      registration.update();
    }).catch(() => {
      // O app continua funcionando mesmo se o navegador bloquear o PWA.
    });
  });
})();
