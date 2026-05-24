// =========================================================
// cookies.js v1 — Banner de consentimento de cookies (LGPD)
//
// Exibe o banner na primeira visita; armazena consentimento
// em localStorage com data e tipo (all | essential).
// Funciona em login.html e index.html.
// =========================================================

(function () {
  const CHAVE = "gm7_cookie_consent";

  // Já consentiu anteriormente — não exibe nada
  if (localStorage.getItem(CHAVE)) return;

  // ── Estilos ───────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    #gm7-cookie-banner {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 99999;
      background: rgba(13, 18, 30, 0.97);
      border-top: 1px solid rgba(34, 211, 238, 0.25);
      backdrop-filter: blur(16px);
      padding: 18px 24px;
      display: flex;
      align-items: center;
      gap: 20px;
      flex-wrap: wrap;
      font-family: Inter, Segoe UI, Arial, sans-serif;
      font-size: 13px;
      color: #CBD5E1;
      animation: cookieSlideUp 0.35s ease;
      box-shadow: 0 -8px 32px rgba(0,0,0,0.45);
    }
    @keyframes cookieSlideUp {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    #gm7-cookie-banner .ck-icon { font-size: 22px; flex-shrink: 0; }
    #gm7-cookie-banner .ck-text { flex: 1; min-width: 220px; line-height: 1.6; }
    #gm7-cookie-banner .ck-text strong { color: #E2E8F0; }
    #gm7-cookie-banner .ck-text a {
      color: #22D3EE; text-decoration: underline; cursor: pointer;
    }
    #gm7-cookie-banner .ck-btns {
      display: flex; gap: 10px; flex-wrap: wrap; flex-shrink: 0;
    }
    #gm7-cookie-banner .ck-btn {
      border: none; border-radius: 10px; padding: 9px 18px;
      font-size: 13px; font-weight: 600; cursor: pointer;
      transition: filter 0.15s, transform 0.15s;
      white-space: nowrap;
    }
    #gm7-cookie-banner .ck-btn:hover {
      filter: brightness(1.1); transform: translateY(-1px);
    }
    #gm7-cookie-banner .ck-btn-accept {
      background: linear-gradient(135deg, #22D3EE, #3B82F6);
      color: #fff;
    }
    #gm7-cookie-banner .ck-btn-essential {
      background: transparent;
      border: 1px solid rgba(148,163,184,0.35) !important;
      color: #94A3B8;
    }
    @media (max-width: 600px) {
      #gm7-cookie-banner { padding: 14px 16px; bottom: 64px; }
      #gm7-cookie-banner .ck-btns { width: 100%; }
      #gm7-cookie-banner .ck-btn { flex: 1; text-align: center; }
    }
  `;
  document.head.appendChild(style);

  // ── Banner ────────────────────────────────────────────
  const banner = document.createElement("div");
  banner.id = "gm7-cookie-banner";
  banner.innerHTML = `
    <span class="ck-icon">🍪</span>
    <div class="ck-text">
      <strong>Utilizamos cookies</strong> para garantir o funcionamento do sistema,
      manter sua sessão segura e melhorar a experiência de uso.
      Ao continuar, você concorda com nossa
      <a id="ck-link-privacidade" href="/privacidade.html" target="_blank">
        Política de Privacidade e Cookies
      </a>.
    </div>
    <div class="ck-btns">
      <button class="ck-btn ck-btn-essential" id="ck-btn-essential">
        Apenas essenciais
      </button>
      <button class="ck-btn ck-btn-accept" id="ck-btn-accept">
        Aceitar todos
      </button>
    </div>
  `;
  document.body.appendChild(banner);

  // ── Ações ─────────────────────────────────────────────
  function salvarConsentimento(tipo) {
    localStorage.setItem(
      CHAVE,
      JSON.stringify({ tipo, data: new Date().toISOString() })
    );
    banner.style.animation = "cookieSlideUp 0.3s ease reverse";
    setTimeout(() => banner.remove(), 280);
  }

  document.getElementById("ck-btn-accept").addEventListener("click", () =>
    salvarConsentimento("todos")
  );
  document.getElementById("ck-btn-essential").addEventListener("click", () =>
    salvarConsentimento("essencial")
  );
})();
