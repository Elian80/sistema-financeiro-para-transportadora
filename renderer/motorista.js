const API_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8001" : "";
const TOKEN_KEY = "mot_token";
const NOME_KEY  = "mot_nome";

let gpsWatchId = null;
let gpsEnvioTimer = null;
let posicaoAtual = null;
let viagemAtivaId = null;

// ---- API helpers ----
function token() { return localStorage.getItem(TOKEN_KEY) || ""; }

async function api(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token()}` },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(API_URL + path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || "Erro na requisicao.");
  return data;
}

// ---- Toast ----
function toast(msg, tipo = "ok") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast " + tipo;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 3200);
}

// ---- Login ----
document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("login-erro");
  errEl.textContent = "";
  try {
    const res = await api("POST", "/motorista-app/login", {
      email: document.getElementById("login-email").value.trim(),
      senha: document.getElementById("login-senha").value,
    });
    localStorage.setItem(TOKEN_KEY, res.access_token);
    localStorage.setItem(NOME_KEY, res.nome);
    await entrarNoApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById("btn-sair").addEventListener("click", () => {
  if (!confirm("Deseja sair do app?")) return;
  pararGps();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NOME_KEY);
  document.getElementById("tela-app").hidden = true;
  document.getElementById("tela-login").hidden = false;
});

// ---- Inicializacao ----
async function entrarNoApp() {
  document.getElementById("tela-login").hidden = true;
  document.getElementById("tela-app").hidden = false;
  const nome = localStorage.getItem(NOME_KEY) || "Motorista";
  document.getElementById("header-nome").textContent = nome;
  document.getElementById("header-avatar").textContent = nome[0].toUpperCase();
  await carregarEstado();
  await carregarHistorico();
}

async function carregarEstado() {
  try {
    const me = await api("GET", "/motorista-app/me");
    renderizarViagemAtiva(me.viagem_ativa);
    await carregarVeiculos();
  } catch (err) {
    toast(err.message, "erro");
  }
}

async function carregarVeiculos() {
  try {
    const res = await fetch(API_URL + "/veiculos", {
      headers: { "Authorization": `Bearer ${token()}` }
    });
    if (!res.ok) return;
    const veiculos = await res.json();
    const sel = document.getElementById("nv-veiculo");
    sel.innerHTML = `<option value="">Nenhum</option>` +
      veiculos.map(v => `<option value="${v.id}">${v.nome || v.placa}</option>`).join("");
  } catch (_) {}
}

async function carregarHistorico() {
  const lista = document.getElementById("lista-viagens");
  try {
    const viagens = await api("GET", "/motorista-app/viagens");
    if (!viagens.length) { lista.innerHTML = "<p class='vazio'>Nenhuma viagem registrada.</p>"; return; }
    lista.innerHTML = viagens.map(v => `
      <div class="viagem-item">
        <div class="viagem-item-header">
          <strong>${v.origem || "-"} → ${v.destino || "-"}</strong>
          <span class="status-pill ${v.status === "em_andamento" ? "ativa" : "finalizada"}">${v.status === "em_andamento" ? "Em andamento" : "Finalizada"}</span>
        </div>
        <div class="viagem-item-meta">
          ${v.data_inicio ? new Date(v.data_inicio).toLocaleDateString("pt-BR") : ""} &bull;
          ${v.carga ? v.carga + " &bull; " : ""}
          KM: ${v.km_inicial || 0} → ${v.km_final || "?"} ${v.km_total != null ? "(+" + v.km_total + " km)" : ""}
        </div>
      </div>
    `).join("");
  } catch (err) {
    lista.innerHTML = "<p class='vazio'>Erro ao carregar historico.</p>";
  }
}

// ---- Viagem Ativa ----
function renderizarViagemAtiva(viagem) {
  viagemAtivaId = viagem ? viagem.id : null;
  const titulo = document.getElementById("viagem-titulo");
  const info   = document.getElementById("viagem-info");
  const btnIni = document.getElementById("btn-iniciar-viagem");
  const btnFin = document.getElementById("btn-finalizar-viagem");

  if (viagem) {
    titulo.textContent = "Viagem em andamento";
    document.getElementById("vi-origem").textContent  = viagem.origem || "-";
    document.getElementById("vi-destino").textContent = viagem.destino || "-";
    document.getElementById("vi-carga").textContent   = viagem.carga || "-";
    document.getElementById("vi-km").textContent      = viagem.km_inicial ?? "-";
    document.getElementById("vi-inicio").textContent  = viagem.data_inicio
      ? new Date(viagem.data_inicio).toLocaleString("pt-BR") : "-";
    info.hidden = false;
    btnIni.hidden = true;
    btnFin.hidden = false;
  } else {
    titulo.textContent = "Nenhuma viagem ativa";
    info.hidden = true;
    btnIni.hidden = false;
    btnFin.hidden = true;
  }
}

// ---- Iniciar Viagem ----
document.getElementById("btn-iniciar-viagem").addEventListener("click", () => {
  document.getElementById("form-iniciar-container").hidden = false;
  document.getElementById("nv-origem").focus();
});
document.getElementById("btn-cancelar-iniciar").addEventListener("click", () => {
  document.getElementById("form-iniciar-container").hidden = true;
});
document.getElementById("form-iniciar-viagem").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("nv-erro");
  errEl.textContent = "";
  try {
    const res = await api("POST", "/motorista-app/viagem/iniciar", {
      origem: document.getElementById("nv-origem").value.trim(),
      destino: document.getElementById("nv-destino").value.trim(),
      carga: document.getElementById("nv-carga").value.trim(),
      km_inicial: parseFloat(document.getElementById("nv-km").value) || null,
      veiculo_id: document.getElementById("nv-veiculo").value || null,
      observacao: document.getElementById("nv-obs").value.trim(),
    });
    viagemAtivaId = res.id;
    document.getElementById("form-iniciar-container").hidden = true;
    document.getElementById("form-iniciar-viagem").reset();
    toast("Viagem iniciada!", "ok");
    await carregarEstado();
    await carregarHistorico();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---- Finalizar Viagem ----
document.getElementById("btn-finalizar-viagem").addEventListener("click", () => {
  document.getElementById("form-finalizar-container").hidden = false;
  document.getElementById("fv-km").focus();
});
document.getElementById("btn-cancelar-finalizar").addEventListener("click", () => {
  document.getElementById("form-finalizar-container").hidden = true;
});
document.getElementById("form-finalizar-viagem").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!viagemAtivaId) return;
  const errEl = document.getElementById("fv-erro");
  errEl.textContent = "";
  try {
    const res = await api("PUT", `/motorista-app/viagem/${viagemAtivaId}/finalizar`, {
      km_final: parseFloat(document.getElementById("fv-km").value) || null,
      observacao: document.getElementById("fv-obs").value.trim(),
    });
    document.getElementById("form-finalizar-container").hidden = true;
    document.getElementById("form-finalizar-viagem").reset();
    pararGps();
    toast(`Viagem finalizada! Total: ${res.km_total} km`, "ok");
    await carregarEstado();
    await carregarHistorico();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---- GPS ----
const toggleGps = document.getElementById("toggle-gps");
const badgeGps  = document.getElementById("header-status-gps");

toggleGps.addEventListener("change", () => {
  if (toggleGps.checked) iniciarGps();
  else pararGps();
});

function iniciarGps() {
  if (!navigator.geolocation) {
    toast("Geolocalizacao nao suportada neste dispositivo.", "erro");
    toggleGps.checked = false;
    return;
  }
  badgeGps.textContent = "GPS on";
  badgeGps.className = "gps-badge on";
  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      posicaoAtual = pos;
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      const vel = pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) + " km/h" : "";
      document.getElementById("gps-coords").textContent = `${lat}, ${lng}`;
      document.getElementById("gps-velocidade").textContent = vel;
    },
    (err) => {
      toast("Erro GPS: " + err.message, "erro");
      pararGps();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
  enviarLocalizacao();
  gpsEnvioTimer = setInterval(enviarLocalizacao, 10000);
}

function pararGps() {
  if (gpsWatchId != null) navigator.geolocation.clearWatch(gpsWatchId);
  clearInterval(gpsEnvioTimer);
  gpsWatchId = null;
  gpsEnvioTimer = null;
  posicaoAtual = null;
  badgeGps.textContent = "GPS off";
  badgeGps.className = "gps-badge off";
  document.getElementById("gps-coords").textContent = "Aguardando sinal...";
  document.getElementById("gps-velocidade").textContent = "";
  toggleGps.checked = false;
}

async function enviarLocalizacao() {
  if (!posicaoAtual) return;
  const c = posicaoAtual.coords;
  const payload = {
    lat: c.latitude,
    lng: c.longitude,
    velocidade: c.speed != null ? c.speed * 3.6 : null,
    heading: c.heading,
  };
  try {
    await api("POST", "/motorista-app/localizacao", payload);
    if (viagemAtivaId) {
      await api("POST", `/motorista-app/viagem/${viagemAtivaId}/ponto`, {
        lat: c.latitude,
        lng: c.longitude,
        velocidade: payload.velocidade,
        ts: new Date().toISOString(),
      });
    }
  } catch (_) {}
}

// ---- Boot ----
if (token()) {
  entrarNoApp();
}
