const form = document.getElementById("login-form");
const usuarioInput = document.getElementById("usuario");
const senhaInput = document.getElementById("senha");
const erroLogin = document.getElementById("erro-login");

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const usuario = usuarioInput.value.trim();
  const senha = senhaInput.value.trim();

  if (usuario === "teste" && senha === "teste") {
    window.location.href = "index.html";
    return;
  }

  erroLogin.textContent = "Login ou senha inválidos.";
});