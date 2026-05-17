// ============================================================
// MOTORISTA.JS — App mobile dos motoristas
// Arquivo JavaScript principal do app de motoristas.
//
// Este app roda em: https://gm7sistemas.com.br/motorista.html
// É instalável como PWA no celular do motorista.
//
// FUNCIONALIDADES:
//   - Login com credenciais criadas pelo painel master
//   - Iniciar e finalizar viagens (km inicial/final, origem, destino, carga)
//   - Compartilhar localização GPS em tempo real (aparece na aba Mapa do sistema)
//   - Histórico das últimas 50 viagens
//
// COMUNICAÇÃO COM O BACKEND:
//   Todas as chamadas usam o prefixo /motorista-app/
//   O token JWT é armazenado no localStorage com chave "mot_token"
//   e tem validade de 30 dias (sem necessidade de relogin frequente).
// ============================================================

// URL base da API — detecta se está rodando localmente (Electron/teste)
// ou no servidor de produção (gm7sistemas.com.br)
const API_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8001" : "";

// Chaves de armazenamento local
const TOKEN_KEY = "mot_token";  // token JWT do motorista
const NOME_KEY  = "mot_nome";   // nome do motorista (para exibição rápida)

// Estado global do GPS e da viagem ativa
let gpsWatchId = null;      // ID do watchPosition do browser (para parar o GPS)
let gpsEnvioTimer = null;   // Intervalo de envio de localização (10s)
let posicaoAtual = null;    // Último objeto GeolocationPosition recebido
let viagemAtivaId = null;   // ID da viagem em andamento (null = sem viagem)

// ============================================================
// UTILITÁRIOS DE API
// ============================================================

// Retorna o token JWT salvo no localStorage
function token() { return localStorage.getItem(TOKEN_KEY) || ""; }

// Função genérica de chamada à API REST do backend
// Automaticamente inclui o token JWT no header Authorization
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

// ============================================================
// TOAST — Notificações temporárias na tela
// Exibidas na parte inferior por 3,2 segundos
// Tipos: "ok" (verde), "erro" (vermelho)
// ============================================================
function toast(msg, tipo = "ok") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast " + tipo;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 3200);
}

// ============================================================
// AUTENTICAÇÃO — Login e Logout
// ============================================================

// Submissão do formulário de login
// Chama POST /motorista-app/login e salva o token no localStorage
document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("login-erro");
  errEl.textContent = "";
  try {
    const res = await api("POST", "/motorista-app/login", {
      email: document.getElementById("login-email").value.trim(),
      senha: document.getElementById("login-senha").value,
    });
    // Salva token e nome para uso imediato e persistência entre sessões
    localStorage.setItem(TOKEN_KEY, res.access_token);
    localStorage.setItem(NOME_KEY, res.nome);
    await entrarNoApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// Botão de logout — para o GPS antes de limpar o token
document.getElementById("btn-sair").addEventListener("click", () => {
  if (!confirm("Deseja sair do app?")) return;
  pararGps();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NOME_KEY);
  document.getElementById("tela-app").hidden = true;
  document.getElementById("tela-login").hidden = false;
});

// ============================================================
// INICIALIZAÇÃO DO APP após login bem-sucedido
// ============================================================

async function entrarNoApp() {
  // Alterna visibilidade das telas
  document.getElementById("tela-login").hidden = true;
  document.getElementById("tela-app").hidden = false;

  // Exibe nome e inicial do motorista no cabeçalho
  const nome = localStorage.getItem(NOME_KEY) || "Motorista";
  document.getElementById("header-nome").textContent = nome;
  document.getElementById("header-avatar").textContent = nome[0].toUpperCase();

  // Carrega estado atual (viagem ativa?) e lista de veículos
  await carregarEstado();
  // Carrega histórico de viagens
  await carregarHistorico();
}

// Consulta GET /motorista-app/me para verificar se há viagem em andamento
async function carregarEstado() {
  try {
    const me = await api("GET", "/motorista-app/me");
    renderizarViagemAtiva(me.viagem_ativa);
    await carregarVeiculos();
  } catch (err) {
    toast(err.message, "erro");
  }
}

// Preenche o select de veículos no formulário de nova viagem
// Usa a mesma rota /veiculos do painel financeiro (requer token de motorista)
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

// Busca e exibe as últimas 50 viagens do motorista (GET /motorista-app/viagens)
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

// ============================================================
// VIAGEM ATIVA — Renderização do card de estado da viagem
// Controla quais botões e informações são exibidos
// ============================================================
function renderizarViagemAtiva(viagem) {
  viagemAtivaId = viagem ? viagem.id : null;
  const titulo = document.getElementById("viagem-titulo");
  const info   = document.getElementById("viagem-info");
  const btnIni = document.getElementById("btn-iniciar-viagem");
  const btnFin = document.getElementById("btn-finalizar-viagem");

  if (viagem) {
    // Há viagem ativa: mostra detalhes e botão de finalizar
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
    // Sem viagem: mostra botão de iniciar
    titulo.textContent = "Nenhuma viagem ativa";
    info.hidden = true;
    btnIni.hidden = false;
    btnFin.hidden = true;
  }
}

// ============================================================
// FORMULÁRIO: INICIAR VIAGEM
// ============================================================

// Botão "+ Iniciar viagem" → abre o formulário inline
document.getElementById("btn-iniciar-viagem").addEventListener("click", () => {
  document.getElementById("form-iniciar-container").hidden = false;
  document.getElementById("nv-origem").focus();
});

// Botão Cancelar do formulário de nova viagem
document.getElementById("btn-cancelar-iniciar").addEventListener("click", () => {
  document.getElementById("form-iniciar-container").hidden = true;
});

// Submissão do formulário → POST /motorista-app/viagem/iniciar
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
    // Recarrega estado e histórico para refletir a nova viagem
    await carregarEstado();
    await carregarHistorico();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ============================================================
// FORMULÁRIO: FINALIZAR VIAGEM
// ============================================================

// Botão "Finalizar viagem" → abre o formulário de km final
document.getElementById("btn-finalizar-viagem").addEventListener("click", () => {
  document.getElementById("form-finalizar-container").hidden = false;
  document.getElementById("fv-km").focus();
});

// Botão Cancelar do formulário de finalização
document.getElementById("btn-cancelar-finalizar").addEventListener("click", () => {
  document.getElementById("form-finalizar-container").hidden = true;
});

// Submissão → PUT /motorista-app/viagem/{id}/finalizar
// Ao finalizar, o GPS é parado automaticamente
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
    pararGps(); // encerra o compartilhamento de localização
    toast(`Viagem finalizada! Total: ${res.km_total} km`, "ok");
    await carregarEstado();
    await carregarHistorico();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ============================================================
// GPS — Compartilhamento de localização em tempo real
//
// Quando ativo:
//   - navigator.geolocation.watchPosition monitora o dispositivo
//   - A cada 10 segundos, envia lat/lng/velocidade para o backend:
//       POST /motorista-app/localizacao  (aparece na aba Mapa)
//       POST /motorista-app/viagem/{id}/ponto (salva na rota da viagem)
//
// O motorista aparece como "online" no mapa do painel financeiro
// enquanto o timestamp da última posição for menor que 5 minutos.
// ============================================================

const toggleGps = document.getElementById("toggle-gps");
const badgeGps  = document.getElementById("header-status-gps");

// Toggle GPS ligado/desligado
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

  // watchPosition: recebe atualizações contínuas de posição do dispositivo
  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      posicaoAtual = pos;
      // Atualiza exibição na tela
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

  // Envia imediatamente e depois a cada 10 segundos
  enviarLocalizacao();
  gpsEnvioTimer = setInterval(enviarLocalizacao, 10000);
}

function pararGps() {
  // Cancela o watchPosition do browser
  if (gpsWatchId != null) navigator.geolocation.clearWatch(gpsWatchId);
  // Cancela o timer de envio periódico
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

// Envia a posição atual para o backend
// Chamado a cada 10 segundos pelo setInterval em iniciarGps()
async function enviarLocalizacao() {
  if (!posicaoAtual) return; // ainda não recebeu sinal do GPS
  const c = posicaoAtual.coords;
  const payload = {
    lat: c.latitude,
    lng: c.longitude,
    velocidade: c.speed != null ? c.speed * 3.6 : null, // converte m/s → km/h
    heading: c.heading,  // direção em graus (0=Norte, 90=Leste, etc.)
  };
  try {
    // Atualiza posição na tabela motorista_localizacoes (aparece na aba Mapa)
    await api("POST", "/motorista-app/localizacao", payload);
    // Se houver viagem ativa, adiciona ponto ao trajeto da viagem
    if (viagemAtivaId) {
      await api("POST", `/motorista-app/viagem/${viagemAtivaId}/ponto`, {
        lat: c.latitude,
        lng: c.longitude,
        velocidade: payload.velocidade,
        ts: new Date().toISOString(),
      });
    }
  } catch (_) {
    // Falhas de envio são silenciosas para não interromper a experiência
  }
}

// ============================================================
// BOOT — Inicialização ao carregar a página
// Se já existe um token salvo, entra direto no app sem pedir login
// ============================================================
if (token()) {
  entrarNoApp();
}
