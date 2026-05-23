// =========================================================
// login.js — Tela de autenticacao do painel administrativo
// v14: toggle mostrar/ocultar senha + logo GM7
// =========================================================

const form        = document.getElementById("login-form");
const usuarioInput = document.getElementById("usuario");
const senhaInput  = document.getElementById("senha");
const erroLogin   = document.getElementById("erro-login");
const loginStatus = document.getElementById("login-status");
const loginSubmit = document.getElementById("login-submit");
const solicitarAcesso = document.getElementById("solicitar-acesso");
const API_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8001" : "";

// ── SVGs dos icones de olho ──────────────────────────────
const SVG_EYE = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
  viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`;

const SVG_EYE_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
  viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8
           a18.45 18.45 0 0 1 5.06-5.94"/>
  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8
           a18.5 18.5 0 0 1-2.16 3.19"/>
  <line x1="1" y1="1" x2="23" y2="23"/>
</svg>`;

// ── Toggle mostrar/ocultar senha ─────────────────────────
const toggleBtn = document.getElementById("toggle-senha");
if (toggleBtn && senhaInput) {
  toggleBtn.innerHTML = SVG_EYE;
  let visivel = false;

  toggleBtn.addEventListener("click", () => {
    visivel = !visivel;
    senhaInput.type = visivel ? "text" : "password";
    toggleBtn.innerHTML = visivel ? SVG_EYE_OFF : SVG_EYE;
    toggleBtn.title = visivel ? "Ocultar senha" : "Mostrar senha";
    toggleBtn.setAttribute("aria-pressed", String(visivel));
  });
}

// ── Login ────────────────────────────────────────────────
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = usuarioInput.value.trim();
  const senha = senhaInput.value.trim();
  erroLogin.textContent  = "";
  loginStatus.textContent = "Validando acesso...";
  loginSubmit.disabled   = true;
  loginSubmit.textContent = "Entrando...";

  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha })
    });
    const resultado = await response.json();
    if (!response.ok) {
      throw new Error(resultado?.detail || "Login ou senha invalidos.");
    }
    sessionStorage.setItem("financeiro_access_token", resultado.access_token);
    sessionStorage.setItem("financeiro_usuario", JSON.stringify(resultado.usuario));
    window.location.href = "index.html";
  } catch (erro) {
    erroLogin.textContent  = erro.message || "Login ou senha invalidos.";
    loginStatus.textContent = "";
    loginSubmit.disabled   = false;
    loginSubmit.textContent = "Acessar sistema";
  }
});

// ── Alternar paineis (login / solicitar cadastro) ────────
const painelLogin      = document.getElementById("painel-login");
const painelSolicitacao = document.getElementById("painel-solicitacao");

function mostrarPainel(painel) {
  painelLogin.style.display      = painel === "login"      ? "" : "none";
  painelSolicitacao.style.display = painel === "solicitacao" ? "" : "none";
}

solicitarAcesso?.addEventListener("click", () => {
  erroLogin.textContent  = "";
  loginStatus.textContent = "";
  mostrarPainel("solicitacao");
});

document.getElementById("voltar-login")?.addEventListener("click", () => {
  document.getElementById("sol-erro").textContent   = "";
  document.getElementById("sol-status").textContent = "";
  document.getElementById("form-solicitacao").reset();
  mostrarPainel("login");
});

// ── Solicitacao de cadastro ──────────────────────────────
document.getElementById("form-solicitacao")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const btnEnviar = document.getElementById("btn-enviar-solicitacao");
  const solErro   = document.getElementById("sol-erro");
  const solStatus = document.getElementById("sol-status");

  solErro.textContent  = "";
  solStatus.textContent = "Enviando...";
  btnEnviar.disabled   = true;

  const corpo = {
    empresa:  document.getElementById("sol-empresa").value.trim(),
    nome:     document.getElementById("sol-nome").value.trim(),
    cargo:    document.getElementById("sol-cargo").value.trim(),
    email:    document.getElementById("sol-email").value.trim(),
    whatsapp: document.getElementById("sol-whats").value.trim(),
  };

  try {
    const resp = await fetch(`${API_URL}/solicitacoes-cadastro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const resultado = await resp.json();
    if (!resp.ok) throw new Error(resultado?.detail || "Erro ao enviar solicitacao.");
    solStatus.textContent = "Solicitacao enviada! O administrador entrara em contato em breve.";
    document.getElementById("form-solicitacao").reset();
    btnEnviar.disabled = false;
  } catch (erro) {
    solErro.textContent  = erro.message || "Erro ao enviar. Tente novamente.";
    solStatus.textContent = "";
    btnEnviar.disabled   = false;
  }
});
