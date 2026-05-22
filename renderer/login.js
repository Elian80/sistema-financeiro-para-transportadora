// =========================================================
// login.js — Tela de autenticação do painel administrativo
//
// Responsabilidades:
// 1) Capturar email/senha do formulário.
// 2) Chamar POST /auth/login no backend FastAPI.
// 3) Armazenar token + usuário em sessionStorage.
// 4) Redirecionar para index.html após sucesso.
// =========================================================

const form = document.getElementById("login-form");
const usuarioInput = document.getElementById("usuario");
const senhaInput = document.getElementById("senha");
const erroLogin = document.getElementById("erro-login");
const loginStatus = document.getElementById("login-status");
const loginSubmit = document.getElementById("login-submit");
const solicitarAcesso = document.getElementById("solicitar-acesso");
const API_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8001" : "";

// Intercepta o submit para realizar autenticação via API sem recarregar a página.
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = usuarioInput.value.trim();
  const senha = senhaInput.value.trim();
  erroLogin.textContent = "";
  loginStatus.textContent = "Validando acesso...";
  loginSubmit.disabled = true;
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
    // Sessão do navegador: permanece até fechar a aba/janela.
    sessionStorage.setItem("financeiro_access_token", resultado.access_token);
    sessionStorage.setItem("financeiro_usuario", JSON.stringify(resultado.usuario));
    window.location.href = "index.html";
  } catch (erro) {
    erroLogin.textContent = erro.message || "Login ou senha invalidos.";
    loginStatus.textContent = "";
    loginSubmit.disabled = false;
    loginSubmit.textContent = "Acessar sistema";
  }
});

// Alterna entre o painel de login e o painel de solicitação de cadastro.
const painelLogin = document.getElementById("painel-login");
const painelSolicitacao = document.getElementById("painel-solicitacao");

function mostrarPainel(painel) {
  painelLogin.style.display = painel === "login" ? "" : "none";
  painelSolicitacao.style.display = painel === "solicitacao" ? "" : "none";
}

solicitarAcesso?.addEventListener("click", () => {
  erroLogin.textContent = "";
  loginStatus.textContent = "";
  mostrarPainel("solicitacao");
});

document.getElementById("voltar-login")?.addEventListener("click", () => {
  document.getElementById("sol-erro").textContent = "";
  document.getElementById("sol-status").textContent = "";
  document.getElementById("form-solicitacao").reset();
  mostrarPainel("login");
});

document.getElementById("form-solicitacao")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const btnEnviar = document.getElementById("btn-enviar-solicitacao");
  const solErro = document.getElementById("sol-erro");
  const solStatus = document.getElementById("sol-status");

  solErro.textContent = "";
  solStatus.textContent = "Enviando...";
  btnEnviar.disabled = true;

  const corpo = {
    empresa: document.getElementById("sol-empresa").value.trim(),
    nome: document.getElementById("sol-nome").value.trim(),
    cargo: document.getElementById("sol-cargo").value.trim(),
    email: document.getElementById("sol-email").value.trim(),
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
    solErro.textContent = erro.message || "Erro ao enviar. Tente novamente.";
    solStatus.textContent = "";
    btnEnviar.disabled = false;
  }
});
