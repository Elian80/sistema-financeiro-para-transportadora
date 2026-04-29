(function () {
  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") {
    return;
  }

  let installPromptEvent = null;
  const installBtn = document.getElementById("install-pwa-btn");

  function mostrarBotaoInstalar() {
    if (!installBtn) return;
    installBtn.hidden = false;
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
      alert("Se o botao de instalacao do navegador nao aparecer, use o menu do navegador e escolha 'Adicionar a tela inicial'. Para instalacao completa, acesse o sistema por HTTPS.");
      return;
    }

    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    installPromptEvent = null;
    ocultarBotaoInstalar();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      registration.update();
    }).catch(() => {
      // O app continua funcionando mesmo se o navegador bloquear o PWA.
    });
  });
})();
