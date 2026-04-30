const form = document.getElementById("login-form");
const usuarioInput = document.getElementById("usuario");
const senhaInput = document.getElementById("senha");
const erroLogin = document.getElementById("erro-login");
const API_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "";

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = usuarioInput.value.trim();
  const senha = senhaInput.value.trim();
  erroLogin.textContent = "";

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
    erroLogin.textContent = erro.message || "Login ou senha invalidos.";
  }
});
