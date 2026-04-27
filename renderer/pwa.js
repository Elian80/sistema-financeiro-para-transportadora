(function () {
  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      registration.update();
    }).catch(() => {
      // O app continua funcionando mesmo se o navegador bloquear o PWA.
    });
  });
})();
