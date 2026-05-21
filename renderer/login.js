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

// Texto de apoio para novos usuários sem cadastro no sistema.
solicitarAcesso?.addEventListener("click", () => {
  erroLogin.textContent = "";
  loginStatus.textContent = "Solicite ao usuario master ou administrador da sua empresa a criacao do cadastro.";
});
