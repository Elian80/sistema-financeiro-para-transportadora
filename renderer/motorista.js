const API_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8001" : "";

const form = document.getElementById("driver-login-form");
const trackingPanel = document.getElementById("driver-tracking");
const message = document.getElementById("driver-message");
const driverName = document.getElementById("driver-name");
const startBtn = document.getElementById("driver-start-btn");
const stopBtn = document.getElementById("driver-stop-btn");
const latEl = document.getElementById("driver-lat");
const lngEl = document.getElementById("driver-lng");
const speedEl = document.getElementById("driver-speed");
const accuracyEl = document.getElementById("driver-accuracy");
const urlParams = new URLSearchParams(window.location.search);
const empresaIdParam = Number(urlParams.get("empresa_id") || 0) || null;
const motoristaIdParam = Number(urlParams.get("motorista_id") || 0) || null;

let sessao = JSON.parse(localStorage.getItem("financeiro_motorista_sessao") || "null");
let watchId = null;
let ultimaPosicao = null;

function paginaSeguraParaGps() {
  return window.isSecureContext || ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function mensagemErroGps(error) {
  if (!paginaSeguraParaGps()) {
    return "A localizacao do celular so funciona em link HTTPS. Abra pelo link publico https do tunel.";
  }
  if (!error) return "Nao consegui obter a localizacao.";
  if (error.code === 1) return "Permissao de localizacao negada. Autorize a localizacao para este site nas configuracoes do navegador.";
  if (error.code === 2) return "Localizacao indisponivel agora. Ative o GPS do celular e tente novamente.";
  if (error.code === 3) return "Tempo esgotado ao buscar localizacao. Fique em local aberto e tente novamente.";
  return error.message || "Nao consegui obter a localizacao.";
}

function setMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}

function mostrarSessao() {
  if (!sessao) return;
  form.hidden = true;
  trackingPanel.hidden = false;
  driverName.textContent = sessao.motorista_nome || "Motorista";
}

async function postJson(url, payload) {
  const response = await fetch(`${API_URL}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.detail || "Falha na comunicacao.");
  }
  return result;
}

function calcularVelocidade(position) {
  if (typeof position.coords.speed === "number" && position.coords.speed >= 0) {
    return position.coords.speed * 3.6;
  }
  if (!ultimaPosicao) return 0;
  const tempo = (position.timestamp - ultimaPosicao.timestamp) / 1000;
  if (tempo <= 0) return 0;
  return 0;
}

async function enviarLocalizacao(position) {
  if (!sessao) return;
  const payload = {
    token: sessao.token,
    empresa_id: sessao.empresa_id,
    motorista_id: sessao.motorista_id,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    velocidade: calcularVelocidade(position),
    direcao: position.coords.heading || 0,
    precisao: position.coords.accuracy || 0,
    bateria: null
  };

  await postJson("/motorista-mobile/localizacao", payload);
  ultimaPosicao = position;

  latEl.textContent = payload.latitude.toFixed(6);
  lngEl.textContent = payload.longitude.toFixed(6);
  speedEl.textContent = `${Math.round(payload.velocidade)} km/h`;
  accuracyEl.textContent = `${Math.round(payload.precisao)} m`;
  setMessage(`Localizacao enviada: ${new Date().toLocaleTimeString("pt-BR")}`);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const usuario = document.getElementById("driver-user").value.trim();
    const senha = document.getElementById("driver-password").value.trim();
    sessao = await postJson("/motorista-mobile/login", {
      usuario,
      senha,
      empresa_id: empresaIdParam,
      motorista_id: motoristaIdParam
    });
    localStorage.setItem("financeiro_motorista_sessao", JSON.stringify(sessao));
    mostrarSessao();
    setMessage("Login realizado. Inicie o compartilhamento.");
  } catch (error) {
    setMessage(error.message, true);
  }
});

startBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setMessage("Este aparelho/navegador nao suporta localizacao.", true);
    return;
  }
  if (!paginaSeguraParaGps()) {
    setMessage("A localizacao do celular so funciona em link HTTPS. Abra pelo link publico gerado no BAT.", true);
    return;
  }

  startBtn.disabled = true;
  stopBtn.hidden = false;
  setMessage("Solicitando permissao de localizacao...");

  navigator.geolocation.getCurrentPosition(
    (position) => enviarLocalizacao(position).catch((error) => setMessage(error.message, true)),
    (error) => {
      startBtn.disabled = false;
      stopBtn.hidden = true;
      setMessage(mensagemErroGps(error), true);
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  );

  watchId = navigator.geolocation.watchPosition(
    (position) => enviarLocalizacao(position).catch((error) => setMessage(error.message, true)),
    (error) => {
      startBtn.disabled = false;
      stopBtn.hidden = true;
      setMessage(mensagemErroGps(error), true);
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
  );
});

stopBtn.addEventListener("click", () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  startBtn.disabled = false;
  stopBtn.hidden = true;
  setMessage("Compartilhamento pausado.");
});

mostrarSessao();
