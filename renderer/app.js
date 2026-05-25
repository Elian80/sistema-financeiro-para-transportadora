// =========================================================
// app.js — Frontend principal do Sistema Financeiro para Transportadoras
//
// Arquitetura:
//   SPA (Single Page Application) em JavaScript puro, sem framework.
//   Toda navegação ocorre via loadPage(), que injeta HTML no elemento
//   #page-content e chama a função iniciar*() correspondente.
//
// Autenticação:
//   JWT armazenado em sessionStorage ("financeiro_access_token" e
//   "financeiro_usuario"). Usuário não autenticado é redirecionado
//   para login.html. Token expirado gera 401 e também redireciona.
//
// Comunicação com backend:
//   FastAPI rodando em http://127.0.0.1:8001 (Electron/local) ou
//   mesma origem (web). Funções apiGet, apiSend, apiPut, apiDelete
//   centralizam todas as chamadas fetch com header Authorization.
//
// Multi-tenant:
//   Usuário com perfil "master" acessa o painel admin (todas as
//   empresas). Outros perfis visualizam apenas dados da própria empresa.
//
// Páginas disponíveis (objeto pages):
//   dashboard, veiculos, motoristas, planoContas, lancamentos,
//   contasReceber, relatorios, ativosPassivos, estoque,
//   configuracoes, admin, mapa
//
// Mapa:
//   Leaflet.js + OpenStreetMap. Atualização automática a cada 5s via
//   setInterval. Marcadores por motorista, com popup e lista lateral.
//
// Estoque:
//   Edição inline diretamente na linha da tabela (editarProduto).
//   Painéis "Novo produto" e "Movimentar" abrem dentro da página,
//   sem modal flutuante.
//
// App mobile dos motoristas:
//   Arquivo separado (motorista.html). Acessos gerenciados pelo admin.
//
// Estrutura de seções neste arquivo:
//   1. Configuração base da API e constantes
//   2. Elementos DOM fixos (sidebar, topbar, botões globais)
//   3. Tabela de INSS 2026 e função de cálculo progressivo
//   4. Variáveis de estado global (edição, cache, mapa, filtros)
//   5. Objeto pages — HTML de cada página (render)
//   6. Funções auxiliares (formatação, normalização, escape)
//   7. Funções de API (apiGet, apiSend, apiPut, apiDelete, authHeaders)
//   8. Módulos de cada página (veículos, motoristas, lançamentos, etc.)
//   9. Estoque — painéis inline e edição em linha de tabela
//  10. Admin master (empresas, usuários, auditoria, acessos motorista)
//  11. Relatórios e Dashboard (gráficos, KPIs, DRE)
//  12. Mapa em tempo real (Leaflet, marcadores, lista lateral)
//  13. Sidebar, topbar, navegação, popups de filtros
//  14. Inicialização geral (DOMContentLoaded substituto inline)
// =========================================================

// =========================================================
// CONFIGURACAO BASE DA API
//
// Em ambiente Electron (protocol === "file:"), aponta para o
// backend local. Em produção web, usa a mesma origem (string vazia),
// já que o front é servido pelo próprio FastAPI via StaticFiles.
// =========================================================
const API_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8001" : "";

// =========================================================
// ELEMENTOS FIXOS DA TELA PRINCIPAL
//
// Referências aos nós DOM que existem em index.html durante toda
// a sessão. São reutilizados a cada troca de página sem precisar
// ser re-consultados, pois o shell (sidebar + topbar) nunca é
// desmontado — apenas o conteúdo interno (#page-content) muda.
// =========================================================
const pageContent = document.getElementById("page-content");       // Área de conteúdo trocada a cada página
const pageTitle = document.getElementById("page-title");           // Título exibido na topbar
const pageSubtitle = document.getElementById("page-subtitle");     // Subtítulo exibido na topbar
const navButtons = document.querySelectorAll(".nav-btn");          // Botões de navegação do menu lateral
const logoutBtn = document.getElementById("logout-btn");           // Botão de encerrar sessão
const themeToggleBtn = document.getElementById("theme-toggle-btn"); // Alternar tema claro/escuro
const settingsBtn = document.getElementById("settings-btn");       // Atalho para a página de configurações
const notificationBtn = document.getElementById("notification-btn"); // Botão de notificações (futuro)
const globalSearch = document.getElementById("global-search");     // Campo de busca global de páginas
const sidebar = document.getElementById("sidebar");                // Container do menu lateral
const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn"); // Recolher/expandir sidebar (desktop)
const mobileMenuBtn = document.getElementById("mobile-menu-btn");  // Abrir sidebar em tela mobile
const sidebarBackdrop = document.getElementById("sidebar-backdrop"); // Backdrop escuro (mobile) para fechar sidebar

// Tabela progressiva de INSS vigente para 2026.
// Cada faixa define o teto salarial e a alíquota aplicada sobre
// a parcela do salário dentro daquela faixa (modelo cascata).
const TABELA_INSS_2026 = [
  { limite: 1621.00, aliquota: 0.075 },
  { limite: 2902.84, aliquota: 0.09 },
  { limite: 4354.27, aliquota: 0.12 },
  { limite: 8475.55, aliquota: 0.14 },
];

// Extrai a mensagem de erro de um objeto de resposta da API FastAPI.
// O campo "detail" pode ser string (erro simples) ou array de objetos
// de validação (erro 422 do Pydantic). Garante que o usuário receba
// uma mensagem legível em vez de "[object Object]".
function extrairMensagemErroApi(resultado, padrao = "Erro na operacao.") {
  const detalhe = resultado?.detail;
  if (Array.isArray(detalhe)) {
    return detalhe
      .map((item) => item?.msg || item?.message || JSON.stringify(item))
      .join(" ");
  }
  if (typeof detalhe === "string") return detalhe;
  if (resultado?.message) return resultado.message;
  return padrao;
}

// =========================================================
// ESTADO GLOBAL DA APLICACAO
//
// Variáveis let compartilhadas entre módulos. Cada "editando*Id"
// controla se o formulário daquela entidade está em modo de edição
// (PUT) ou criação (POST). Quando null, o form cria um novo registro.
//
// cacheVeiculos: lista de veículos carregada uma vez e reutilizada
//   em múltiplas páginas (lançamentos, contas a receber, relatórios).
//
// filtroPeriodoFolha: período (YYYY-MM) selecionado no histórico de
//   folhas de pagamento. Preservado entre re-renders da seção.
//
// adminEmpresaFiltro: ID da empresa selecionada no painel admin para
//   filtrar usuários e logs. String vazia = todas as empresas.
//
// mapaInstancia: instância Leaflet ativa. Destruída ao sair da página
//   mapa para liberar memória e evitar vazamentos de evento.
//
// mapaMarkers: Map<motorista_acesso_id, L.Marker>. Mantém referências
//   aos marcadores para atualizá-los sem recriar (performance).
//
// mapaAtualizacaoTimer: ID do setInterval de atualização do mapa.
//   Armazenado para poder ser cancelado (clearInterval) ao trocar de página.
// =========================================================
let editandoVeiculoId = null;        // ID do veículo em edição, ou null para novo cadastro
let editandoMotoristaId = null;      // ID do motorista em edição
let editandoLancamentoId = null;     // ID do lançamento em edição
let editandoPlanoContaId = null;     // ID da classificação do plano de contas em edição
let editandoContaReceberId = null;   // ID da conta a receber em edição
let editandoAtivoId = null;          // ID do ativo em edição
let editandoPassivoId = null;        // ID do passivo em edição
let editandoProdutoId = null;        // ID do produto de estoque em edição inline
let cacheVeiculos = [];              // Cache da lista de veículos (evita múltiplas requisições)
let filtroPeriodoFolha = "";         // Filtro de período (YYYY-MM) do histórico de folhas
let adminEmpresaFiltro = "";         // Empresa selecionada no painel admin para filtrar dados
let mapaInstancia = null;            // Instância Leaflet do mapa operacional
let mapaMarkers = new Map();         // Marcadores dos motoristas no mapa (Map por ID)
let mapaAtualizacaoTimer = null;     // Timer do setInterval de atualização automática do mapa

// Injeta o ícone Lucide e o label textual em cada botão de navegação.
// Executada uma única vez na inicialização. Lê o atributo data-icon
// para escolher o ícone; usa data-short ou as 2 primeiras letras como
// fallback quando o Lucide não estiver disponível (modo offline).
function aplicarIconesNavegacao() {
  navButtons.forEach((button) => {
    if (button.querySelector(".nav-icon")) return; // Já foi processado
    if (button.classList.contains("mbn-btn")) return; // Bottom nav — tem estrutura própria, não sobrescrever
    const iconName = button.dataset.icon || "circle";
    const label = button.textContent.trim();
    const fallback = button.dataset.short || label.slice(0, 2).toUpperCase();
    button.innerHTML = `<span class="nav-icon" data-lucide="${iconName}">${fallback}</span><span class="nav-label">${label}</span>`;
  });
}

// =========================================================
// HELPERS DE UI — Componentes reutilizaveis de HTML
//
// Estas funções retornam fragmentos HTML (strings) que são embutidos
// no render() de cada página. Não fazem requisições, apenas geram markup.
// =========================================================

// Gera o botão que abre o painel de filtros correspondente.
// O atributo data-filter-target é lido por iniciarBotoesPopupFiltros()
// para conectar o clique ao painel correto.
function botaoFiltros(painelId, texto = "Filtros") {
  return `<button type="button" class="ghost-btn filter-open-btn" data-filter-target="${painelId}">${texto}</button>`;
}

// Gera o HTML completo do popup de filtros: overlay + card com cabeçalho e conteúdo.
// O painel começa oculto (aria-hidden="true") e é aberto por abrirPopupFiltros().
// Parâmetros:
//   painelId  — ID único do elemento (usado para abrir/fechar)
//   titulo    — Título exibido no cabeçalho do popup
//   subtitulo — Texto descritivo abaixo do título
//   conteudo  — HTML interno (campos de filtro) gerado pelo chamador
function popupFiltros(painelId, titulo, subtitulo, conteudo) {
  return `
    <div id="${painelId}" class="filters-panel filter-popup" aria-hidden="true">
      <div class="filter-popup-card" role="dialog" aria-modal="true" aria-label="${titulo}">
        <div class="filter-popup-header">
          <div>
            <h3>${titulo}</h3>
            <p>${subtitulo}</p>
          </div>
          <button type="button" class="filter-close-btn" data-filter-close="${painelId}" aria-label="Fechar filtros">Fechar</button>
        </div>
        ${conteudo}
      </div>
    </div>
  `;
}

// Gera um SVG minimalista de sparkline (mini gráfico de linha) para os cards KPI.
// Os pontos são coordenadas SVG no formato "x,y x,y..." preestabelecidas por card,
// representando uma tendência visual decorativa (não reflete dados reais em tempo real).
function sparklineSvg(pontos = "4,32 18,22 32,28 46,14 60,18 74,8 88,12") {
  return `
    <svg class="sparkline" viewBox="0 0 92 38" aria-hidden="true">
      <polyline points="${pontos}" />
    </svg>
  `;
}

// Gera o badge de tendência (ex.: "+12,3%") exibido nos cards KPI do dashboard.
// tipo: "positive" | "negative" | "warning" — controla a cor via CSS.
function kpiTrend(valor, tipo = "positive") {
  const texto = valor || "+0.0%";
  return `<span class="kpi-trend ${tipo}">${texto}</span>`;
}

// Calcula o desconto de INSS pelo modelo progressivo (cascata) de 2026.
// Aplica alíquota de cada faixa apenas sobre a parcela do salário
// que cai dentro daquela faixa, até o teto de R$ 8.475,55.
// Retorna o valor total de desconto em reais, arredondado em 2 casas.
function calcularInssAutomatico(baseCalculo) {
  const teto = TABELA_INSS_2026[TABELA_INSS_2026.length - 1].limite;
  const base = Math.min(Math.max(normalizarNumero(baseCalculo), 0), teto);
  let contribuicao = 0;
  let limiteAnterior = 0;

  TABELA_INSS_2026.forEach((faixa) => {
    if (base <= limiteAnterior) return;
    const valorFaixa = Math.min(base, faixa.limite) - limiteAnterior;
    contribuicao += valorFaixa * faixa.aliquota;
    limiteAnterior = faixa.limite;
  });

  return Math.round(contribuicao * 100) / 100;
}

const pages = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Visao geral da operacao e do financeiro",
    render: () => `
      ${popupFiltros("painel-filtros-dashboard", "Filtros do dashboard", "Refine os indicadores por periodo, veiculo ou empresa.", `
        <div class="form-grid">
          <div class="field"><label>Data inicial</label><input type="date" id="dash-data-inicial" /></div>
          <div class="field"><label>Data final</label><input type="date" id="dash-data-final" /></div>
          <div class="field"><label>Veiculo</label><select id="dash-veiculo-id"><option value="">Todos</option></select></div>
          <div class="field"><label>Empresa ID</label><input type="number" id="dash-empresa-id" placeholder="Opcional" /></div>
          <div class="field full btn-row">
            <button type="button" class="primary-btn" id="btn-dashboard-filtrar">Aplicar filtros</button>
            <button type="button" class="ghost-btn" id="btn-dashboard-limpar">Limpar</button>
          </div>
        </div>
      `)}

      <section class="dash-premium-shell">
      <div class="panel-box filter-launcher dash-premium-head" style="margin-bottom:18px;">
        <div>
          <h3 style="margin:0;font-size:15px;">Periodo analisado</h3>
          <p id="dashboard-periodo" style="margin:4px 0 0;font-size:13px;">Carregando...</p>
        </div>
        <div class="estoque-actions">
          ${botaoFiltros("painel-filtros-dashboard")}
        </div>
      </div>

      <div class="dash-top-cards" style="margin-bottom:18px;">
        <section class="dash-stat-card dash-stat-blue">
          <div>
            <span class="dash-stat-label">Veiculos</span>
            <strong class="dash-stat-value" id="dashboard-veiculos-total">0</strong>
            <small>Frota cadastrada</small>
          </div>
          <span class="dash-stat-icon"><i data-lucide="truck"></i></span>
        </section>
        <section class="dash-stat-card dash-stat-green">
          <div>
            <span class="dash-stat-label">Em movimento</span>
            <strong class="dash-stat-value" id="dashboard-veiculos-ativos-card">0</strong>
            <small>Veiculos ativos</small>
          </div>
          <span class="dash-stat-icon"><i data-lucide="route"></i></span>
        </section>
        <section class="dash-stat-card dash-stat-indigo">
          <div>
            <span class="dash-stat-label">Parados</span>
            <strong class="dash-stat-value" id="dashboard-veiculos-inativos-card">0</strong>
            <small>Sem operacao</small>
          </div>
          <span class="dash-stat-icon"><i data-lucide="parking-circle"></i></span>
        </section>
        <section class="dash-stat-card dash-stat-orange">
          <div>
            <span class="dash-stat-label">Manutencoes</span>
            <strong class="dash-stat-value" id="dashboard-veiculos-manutencao-card">0</strong>
            <small>Em manutencao</small>
          </div>
          <span class="dash-stat-icon"><i data-lucide="wrench"></i></span>
        </section>
      </div>

      <div class="dashboard-grid dash-finance-strip" style="margin-bottom:18px;">
        <section class="kpi-card dashboard-hero">
          <div class="kpi-label">Saldo do periodo</div>
          <div class="kpi-value" id="dashboard-saldo">R$ 0,00</div>
          ${kpiTrend("", "positive")}
          ${sparklineSvg("4,30 18,24 32,27 46,16 60,19 74,10 88,14")}
          <div class="dashboard-note" id="dashboard-receitas-qtd">0 lancamentos</div>
        </section>
        <section class="kpi-card">
          <div class="kpi-label">Receitas</div>
          <div class="kpi-value positive" id="dashboard-receitas">R$ 0,00</div>
          ${sparklineSvg("4,31 18,25 32,20 46,22 60,12 74,10 88,6")}
          <div class="dashboard-note" id="dashboard-despesas-qtd">0 despesas</div>
        </section>
        <section class="kpi-card">
          <div class="kpi-label">Despesas</div>
          <div class="kpi-value negative" id="dashboard-despesas">R$ 0,00</div>
          ${sparklineSvg("4,12 18,16 32,13 46,22 60,20 74,28 88,25")}
          <div class="dashboard-note">Custos + despesas</div>
        </section>
        <section class="kpi-card">
          <div class="kpi-label">Lucro liquido</div>
          <div class="kpi-value" id="dashboard-lucro-liquido">R$ 0,00</div>
          ${sparklineSvg("4,30 18,28 32,20 46,22 60,16 74,10 88,12")}
          <div class="dashboard-note">Receitas menos despesas totais</div>
        </section>
      </div>
      <span id="dashboard-frota-total" hidden></span>

      <div class="dash-metrics-strip">
        <div class="dash-metric-card">
          <div>
            <div class="dash-metric-label">Margem liquida</div>
            <div class="dash-metric-value" id="dashboard-margem-liquida">0,0%</div>
          </div>
          <span class="kpi-trend positive" id="dash-trend-margem">—</span>
        </div>
        <div class="dash-metric-card">
          <div>
            <div class="dash-metric-label">Ticket medio</div>
            <div class="dash-metric-value positive" id="dashboard-ticket-medio">R$ 0,00</div>
          </div>
          <span class="kpi-trend positive" id="dash-trend-ticket">—</span>
        </div>
        <div class="dash-metric-card">
          <div>
            <div class="dash-metric-label">Frota operante</div>
            <div class="dash-metric-value" id="dashboard-frota-operante">0%</div>
          </div>
          <span class="kpi-trend positive" id="dash-trend-frota">—</span>
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom:18px;">
        <section class="kpi-card"><div class="kpi-label">Custos operacionais</div><div class="kpi-value negative" id="dashboard-custos">R$ 0,00</div>${sparklineSvg("4,12 18,18 32,16 46,22 60,19 74,28 88,26")}</section>
        <section class="kpi-card"><div class="kpi-label">Investimentos</div><div class="kpi-value" id="dashboard-investimentos">R$ 0,00</div>${sparklineSvg("4,30 18,30 32,24 46,18 60,20 74,14 88,9")}</section>
        <section class="kpi-card"><div class="kpi-label">Lucro bruto</div><div class="kpi-value" id="dashboard-lucro-bruto">R$ 0,00</div>${sparklineSvg("4,32 18,24 32,26 46,18 60,12 74,14 88,8")}</section>
        <section class="kpi-card"><div class="kpi-label">Contas pendentes</div><div class="kpi-value warning" id="dashboard-contas-pendentes">R$ 0,00</div>${sparklineSvg("4,18 18,14 32,22 46,18 60,26 74,22 88,30")}</section>
        <section class="kpi-card"><div class="kpi-label">Patrimonio liquido</div><div class="kpi-value" id="dashboard-patrimonio">R$ 0,00</div>${sparklineSvg("4,32 18,24 32,27 46,18 60,20 74,12 88,10")}</section>
        <section class="kpi-card"><div class="kpi-label">Frota ativa</div><div class="kpi-value" id="dashboard-frota-ativa">0</div>${sparklineSvg("4,26 18,26 32,22 46,22 60,18 74,18 88,14")}</section>
      </div>

      <section class="report-charts dash-analytics-grid" style="margin-bottom:18px;">
        <div class="panel-box chart-card chart-card-wide dash-panel-wide"><h3>Resumo de Custos</h3><canvas id="dash-chart-receitas-despesas" height="150"></canvas></div>
        <div class="panel-box chart-card dash-category-panel"><h3>Custos por Categoria</h3><canvas id="dash-chart-despesas-classificacao" height="150"></canvas></div>
        <div class="panel-box chart-card dash-extra-chart"><h3>Custos por veiculo</h3><canvas id="dash-chart-custos-veiculo" height="150"></canvas></div>
        <div class="panel-box chart-card dash-extra-chart"><h3>Faturamento mensal</h3><canvas id="dash-chart-faturamento-mensal" height="150"></canvas></div>
        <div class="panel-box chart-card dash-extra-chart"><h3>Saldo acumulado</h3><canvas id="dash-chart-saldo-acumulado" height="150"></canvas></div>
        <div class="panel-box chart-card dash-extra-chart"><h3>Contas a receber</h3><canvas id="dash-chart-contas-receber" height="150"></canvas></div>
      </section>

      <div class="dashboard-layout" style="margin-bottom:18px;">
        <section class="panel-box">
          <div class="table-toolbar">
            <div><h3 style="margin:0;">Resumo da frota</h3><span>Status operacional dos veiculos</span></div>
          </div>
          <div class="status-summary">
            <div class="status-line"><span>Ativos</span><strong id="dashboard-veiculos-ativos">0</strong></div>
            <div class="status-line"><span>Manutencao</span><strong id="dashboard-veiculos-manutencao">0</strong></div>
            <div class="status-line"><span>Inativos</span><strong id="dashboard-veiculos-inativos">0</strong></div>
            <div class="status-line"><span>Motoristas</span><strong id="dashboard-motoristas">0</strong></div>
          </div>
        </section>
        <section class="panel-box">
          <div class="table-toolbar">
            <div><h3 style="margin:0;">Financeiro por classificacao</h3><span>Maiores valores no periodo</span></div>
          </div>
          <div id="dashboard-classificacoes" class="ranking-list"><p class="empty-row">Carregando...</p></div>
        </section>
      </div>
      </section>

      <section class="panel-box" style="margin-bottom:18px;">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">Horas por maquina</h3>
            <span>Horas e valor gerado por veiculo no periodo</span>
          </div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Veiculo</label><select id="dash-horas-veiculo"><option value="">Todas as maquinas</option></select></div>
          <div class="field"><label>Data inicial</label><input type="date" id="dash-horas-data-inicial" /></div>
          <div class="field"><label>Data final</label><input type="date" id="dash-horas-data-final" /></div>
          <div class="field dash-hours-action"><label>&nbsp;</label><button type="button" class="icon-btn subtle-icon-btn" id="btn-dashboard-horas" aria-label="Atualizar horas" title="Atualizar"><span data-lucide="refresh-cw" aria-hidden="true"></span></button></div>
        </div>
        <div class="kpi-grid" style="margin-top:14px;">
          <div class="kpi-card"><div class="kpi-label">Total de horas</div><div class="kpi-value" id="dash-horas-total">0h</div></div>
          <div class="kpi-card"><div class="kpi-label">Dias trabalhados</div><div class="kpi-value" id="dash-dias-total">0</div></div>
          <div class="kpi-card"><div class="kpi-label">Valor gerado</div><div class="kpi-value positive" id="dash-horas-valor">R$ 0,00</div></div>
        </div>
      </section>

      <section class="panel-box">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">Ultimos lancamentos</h3>
            <span id="dashboard-total-lancamentos">0 registros</span>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Data</th><th>Classificacao</th><th>Veiculo</th><th>Descricao</th><th>Valor</th></tr></thead>
            <tbody id="dashboard-ultimos-lancamentos"><tr><td colspan="5" class="empty-row">Carregando...</td></tr></tbody>
          </table>
        </div>
      </section>
    `
  },

  veiculos: {
    title: "Veiculos",
    subtitle: "Gestao visual da frota",
    render: () => `
      <div class="panel-box filter-launcher">
        <button class="primary-btn" id="btn-novo-veiculo">+ Cadastrar veiculos</button>
        ${botaoFiltros("painel-filtros-veiculos")}
      </div>

      ${popupFiltros("painel-filtros-veiculos", "Filtros de veiculos", "Localize rapidamente veiculos por nome, placa, tipo ou status.", `
        <div class="form-grid">
          <div class="field">
            <label>Nome</label>
            <input id="filtro-veiculo-nome" placeholder="Buscar por nome" />
          </div>

          <div class="field">
            <label>Placa</label>
            <input id="filtro-veiculo-placa" placeholder="Buscar por placa" />
          </div>

          <div class="field">
            <label>Tipo</label>
            <select id="filtro-veiculo-tipo">
              <option value="">Todos</option>
              <option value="Caminhao">Caminhao</option>
              <option value="Carro">Carro</option>
              <option value="Maquina">Maquina</option>
              <option value="Motocicleta">Motocicleta</option>
            </select>
          </div>

          <div class="field">
            <label>Status</label>
            <select id="filtro-veiculo-status">
              <option value="">Todos</option>
              <option value="Ativo">Ativo</option>
              <option value="Manutencao">Manutencao</option>
              <option value="Inativo">Inativo</option>
            </select>
          </div>

          <div class="field full btn-row">
            <button class="ghost-btn" id="btn-filtrar-veiculos" type="button">Filtrar</button>
            <button class="ghost-btn" id="btn-limpar-filtro-veiculos" type="button">Limpar filtros</button>
          </div>
        </div>
      `)}

      <div class="kpi-grid" style="margin-bottom:18px;">
        <div class="kpi-card">
          <div class="kpi-label">Total de veiculos</div>
          <div class="kpi-value" id="veiculos-total">0</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Ativos</div>
          <div class="kpi-value" id="veiculos-ativos">0</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Em manutencao</div>
          <div class="kpi-value" id="veiculos-manutencao">0</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Inativos</div>
          <div class="kpi-value" id="veiculos-inativos">0</div>
        </div>
      </div>

      <div id="form-veiculo-container"></div>
      <div id="lista-veiculos" class="vehicle-grid"></div>
    `
  },

  motoristas: {
    title: "Motoristas",
    subtitle: "Controle da equipe operacional",
    render: () => `
      <div class="panel-box filter-launcher">
        <button class="primary-btn" id="btn-novo-motorista">+ Cadastrar motorista</button>
      </div>

      <div id="form-motorista-container"></div>
      <div id="folha-pagamento-container"></div>
      <div id="lista-motoristas" class="table-wrap"></div>
      <div id="historico-folha-container"></div>
    `
  },

  planoContas: {
    title: "Plano de contas",
    subtitle: "Cadastro das classificacoes usadas nos lancamentos",
    render: () => `
      <section class="panel-box">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">Plano base</h3>
            <span>Grupos organizam o plano; apenas subclasses entram nos lancamentos</span>
          </div>
        </div>

        <div id="estrutura-plano-contas" class="account-plan-grid">
          <p class="empty-row">Carregando...</p>
        </div>
      </section>

      <div class="content-grid">
        <div class="panel-box">
          <h3 id="titulo-form-plano-conta">Nova classificacao</h3>

          <form id="form-plano-conta" class="form-grid">
            <div class="field full">
              <label for="plano-conta-nome">Classificacao</label>
              <input id="plano-conta-nome" placeholder="Ex.: 1.6 PEDAGIO" required />
            </div>

            <div class="field full btn-row">
              <button type="submit" class="primary-btn" id="btn-salvar-plano-conta">Salvar classificacao</button>
              <button type="button" class="ghost-btn" id="btn-cancelar-plano-conta" style="display:none;">Cancelar edicao</button>
            </div>
          </form>

          <p id="mensagem-plano-conta" class="mensagem"></p>
        </div>

        <div class="panel-box">
          <div class="table-toolbar">
            <div>
              <h3 style="margin:0;">Classificacoes personalizadas</h3>
              <span>Itens criados alem da lista base</span>
            </div>
          </div>

          <div id="lista-plano-contas" class="table-wrap"></div>
        </div>
      </div>
    `
  },

  lancamentos: {
    title: "Lancamentos",
    subtitle: "Cadastro, conferencia e filtros",
    render: () => `
      <div class="page-tabs" style="display:flex;gap:8px;margin-bottom:18px;">
        <button class="tab-btn active" data-tab="tab-lancamentos" type="button">Lancamentos</button>
        <button class="tab-btn" data-tab="tab-plano-contas" type="button">Plano de Contas</button>
        <button class="tab-btn" data-tab="tab-ativos-passivos" type="button">Ativos e Passivos</button>
      </div>

      <div id="tab-lancamentos">
      <div class="content-grid">
        <div class="panel-box">
          <h3 id="titulo-form-lancamento">Novo lancamento</h3>

          <form id="form-lancamento" class="form-grid">
            <div class="field full">
              <label for="classificacao">Classificacao</label>
              <select id="classificacao" required>
                <option value="">Selecione...</option>
              </select>
            </div>

            <div class="field full">
              <label for="descricao">Descricao</label>
              <input type="text" id="descricao" placeholder="Digite a descricao" required />
            </div>

            <div class="field">
              <label for="valor">Valor</label>
              <input type="number" id="valor" step="0.01" placeholder="0.00" required />
            </div>

            <div class="field">
              <label for="data">Data</label>
              <input type="date" id="data" required />
            </div>

            <div class="field full">
              <label for="veiculo-id">Veiculo vinculado (opcional)</label>
              <select id="veiculo-id">
                <option value="">Sem vinculo</option>
              </select>
            </div>

            <div class="field">
              <label for="empresa-id">Empresa ID (opcional)</label>
              <input type="number" id="empresa-id" step="1" placeholder="ID da empresa" />
            </div>

            <div class="field">
              <label for="obra-servico">Obra/servico (opcional)</label>
              <input type="text" id="obra-servico" placeholder="Obra ou servico" />
            </div>

            <div id="campos-combustivel" class="fuel-fields field full" style="display:none;">
              <div class="form-grid compact-grid">
                <div class="field">
                  <label for="kilometragem">Kilometragem</label>
                  <input type="number" id="kilometragem" step="0.1" placeholder="0" />
                </div>

                <div class="field">
                  <label for="litros">Litros</label>
                  <input type="number" id="litros" step="0.001" placeholder="0,000" />
                </div>

                <div class="field">
                  <label for="numero-nf">Numero da NF</label>
                  <input type="text" id="numero-nf" placeholder="NF" />
                </div>

                <div class="field">
                  <label for="data-nf">Data da NF</label>
                  <input type="date" id="data-nf" />
                </div>
              </div>
            </div>

            <div class="field full" id="bloco-estoque-vinculo">
              <label>Vincular item do estoque como saida (opcional)</label>
              <div style="display:flex; gap:12px; align-items:flex-end;">
                <div style="flex:1;">
                  <select id="estoque-item-id" style="width:100%;">
                    <option value="">Nenhum</option>
                  </select>
                </div>
                <div id="campo-estoque-quantidade" style="display:none; flex:0 0 180px;">
                  <label for="estoque-quantidade" style="font-size:0.82rem;">Quantidade</label>
                  <input type="number" id="estoque-quantidade" step="0.001" min="0.001" placeholder="0" style="width:100%;" />
                  <span id="estoque-quantidade-aviso" class="estoque-aviso" style="display:none;"></span>
                </div>
              </div>
            </div>

            <div class="field full btn-row">
              <button type="submit" class="primary-btn" id="btn-salvar-lancamento">Salvar lancamento</button>
              <button type="button" class="ghost-btn" id="btn-cancelar-edicao-lancamento" style="display:none;">Cancelar edicao</button>
            </div>
          </form>

          <p id="mensagem" class="mensagem"></p>
        </div>
      </div>

      ${popupFiltros("painel-filtros-lancamentos", "Filtros de lancamentos", "Filtre por classificacao, periodo, descricao ou veiculo.", `
        <div class="form-grid">
          <div class="field full">
            <label for="filtro-classificacao">Classificacao</label>
            <select id="filtro-classificacao">
              <option value="">Todas</option>
            </select>
          </div>

          <div class="field">
            <label for="filtro-data-inicial">Data inicial</label>
            <input type="date" id="filtro-data-inicial" />
          </div>

          <div class="field">
            <label for="filtro-data-final">Data final</label>
            <input type="date" id="filtro-data-final" />
          </div>

          <div class="field full">
            <label for="filtro-descricao">Descricao</label>
            <input type="text" id="filtro-descricao" placeholder="Buscar descricao" />
          </div>

          <div class="field full">
            <label for="filtro-veiculo-id">Veiculo</label>
            <select id="filtro-veiculo-id">
              <option value="">Todos</option>
            </select>
          </div>
          <div class="field full btn-row">
            <button id="btn-filtrar" class="ghost-btn" type="button">Filtrar</button>
            <button id="btn-limpar" class="ghost-btn" type="button">Limpar filtros</button>
          </div>
        </div>
      `)}

      <div class="kpi-grid" style="margin-bottom:18px;">
        <div class="kpi-card">
          <div class="kpi-label">Quantidade</div>
          <div class="kpi-value" id="total-quantidade">0</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Valor total</div>
          <div class="kpi-value" id="total-valor">R$ 0,00</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Maior lancamento</div>
          <div class="kpi-value" id="maior-valor">R$ 0,00</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Menor lancamento</div>
          <div class="kpi-value" id="menor-valor">R$ 0,00</div>
        </div>
      </div>

      <div class="panel-box">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">Conferencia de lancamentos</h3>
            <span id="total-registros">0 registros</span>
          </div>

          <div class="btn-row">
            ${botaoFiltros("painel-filtros-lancamentos")}
            <button type="button" class="ghost-btn" id="btn-tela-cheia-lancamentos">Tela completa</button>
            <button type="button" class="primary-btn" id="btn-imprimir-lancamentos">Imprimir</button>
          </div>
        </div>

        <div class="table-wrap table-wrap-scroll" id="conferencia-scroll">
          <table class="data-table" id="tabela-impressao-lancamentos">
            <thead>
              <tr>
                <th>ID</th>
                <th>Data</th>
                <th>Classificacao</th>
                <th>Veiculo</th>
                <th>Descricao</th>
                <th>Estoque</th>
                <th>Valor</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody id="tabela-lancamentos">
              <tr>
                <td colspan="8" class="empty-row">Nenhum lancamento encontrado.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div id="modal-lancamentos" class="modal-overlay" style="display:none;">
        <div class="modal-content modal-xl">
          <div class="table-toolbar">
            <div>
              <h3 style="margin:0;">Conferencia completa de lancamentos</h3>
              <span id="total-registros-modal">0 registros</span>
            </div>

            <div class="btn-row">
              <button type="button" class="ghost-btn" id="btn-fechar-modal-lancamentos">Fechar</button>
              <button type="button" class="primary-btn" id="btn-imprimir-modal-lancamentos">Imprimir</button>
            </div>
          </div>

          <div class="table-wrap table-wrap-modal">
            <table class="data-table" id="tabela-modal-impressao-lancamentos">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Data</th>
                  <th>Classificacao</th>
                  <th>Veiculo</th>
                  <th>Descricao</th>
                  <th>Estoque</th>
                  <th>Valor</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody id="tabela-lancamentos-modal">
                <tr>
                  <td colspan="8" class="empty-row">Nenhum lancamento encontrado.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      </div>

      <div id="tab-plano-contas" style="display:none;">

        <div class="panel-box pc-form-card" style="margin-bottom:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <div>
              <h3 id="titulo-form-plano-conta" style="margin:0;">Nova classificacao</h3>
              <p style="margin:4px 0 0;color:var(--muted);font-size:13px;">Use o codigo do grupo como prefixo. Ex.: 1.6 PEDAGIO, 2.8 LIMPEZA</p>
            </div>
          </div>
          <form id="form-plano-conta">
            <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
              <div style="flex:1;min-width:220px;">
                <label for="plano-conta-nome" style="font-size:12px;color:var(--muted);display:block;margin-bottom:5px;">Nome da classificacao</label>
                <input id="plano-conta-nome" placeholder="Ex.: 1.6 PEDAGIO" required style="width:100%;" />
              </div>
              <div style="display:flex;gap:8px;">
                <button type="submit" class="primary-btn" id="btn-salvar-plano-conta">+ Adicionar</button>
                <button type="button" class="ghost-btn" id="btn-cancelar-plano-conta" style="display:none;">Cancelar</button>
              </div>
            </div>
            <p id="mensagem-plano-conta" class="mensagem" style="margin-top:10px;"></p>
          </form>
        </div>

        <div id="estrutura-plano-contas" class="account-plan-grid">
          <p class="empty-row">Carregando...</p>
        </div>
      </div>

      <div id="tab-ativos-passivos" style="display:none;">
        <div class="kpi-grid" style="margin-bottom:18px;">
          <div class="kpi-card"><div class="kpi-label">Total de ativos</div><div class="kpi-value positive" id="ap-total-ativos">R$ 0,00</div></div>
          <div class="kpi-card"><div class="kpi-label">Total de passivos</div><div class="kpi-value negative" id="ap-total-passivos">R$ 0,00</div></div>
          <div class="kpi-card"><div class="kpi-label">Patrimonio liquido</div><div class="kpi-value" id="ap-patrimonio">R$ 0,00</div></div>
        </div>

        <div class="content-grid">
          <section class="panel-box">
            <h3 id="titulo-form-ativo">Novo ativo</h3>
            <form id="form-ativo" class="form-grid">
              <div class="field"><label>Nome</label><input id="ativo-nome" required /></div>
              <div class="field"><label>Tipo</label><select id="ativo-tipo"><option>Veiculo</option><option>Maquina</option><option>Equipamento</option><option>Imovel</option><option>Outro</option></select></div>
              <div class="field"><label>Valor</label><input type="number" step="0.01" id="ativo-valor" /></div>
              <div class="field"><label>Data aquisicao</label><input type="date" id="ativo-data" /></div>
              <div class="field"><label>Veiculo vinculado</label><select id="ativo-veiculo-id"><option value="">Sem vinculo</option></select></div>
              <div class="field"><label>Status</label><input id="ativo-status" value="Ativo" /></div>
              <div class="field full"><label>Observacao</label><input id="ativo-observacao" /></div>
              <div class="field full btn-row"><button class="primary-btn" type="submit">Salvar ativo</button><button class="ghost-btn" type="button" id="btn-cancelar-ativo" style="display:none;">Cancelar</button></div>
            </form>
            <p id="mensagem-ativo" class="mensagem"></p>
          </section>

          <section class="panel-box">
            <h3 id="titulo-form-passivo">Novo passivo</h3>
            <form id="form-passivo" class="form-grid">
              <div class="field"><label>Nome</label><input id="passivo-nome" required /></div>
              <div class="field"><label>Tipo</label><select id="passivo-tipo"><option>Financiamento</option><option>Emprestimo</option><option>Divida</option><option>Imposto a pagar</option><option>Outro</option></select></div>
              <div class="field"><label>Valor total</label><input type="number" step="0.01" id="passivo-valor-total" /></div>
              <div class="field"><label>Valor pago</label><input type="number" step="0.01" id="passivo-valor-pago" /></div>
              <div class="field"><label>Data inicio</label><input type="date" id="passivo-data-inicio" /></div>
              <div class="field"><label>Vencimento</label><input type="date" id="passivo-data-vencimento" /></div>
              <div class="field"><label>Status</label><input id="passivo-status" value="Pendente" /></div>
              <div class="field full"><label>Observacao</label><input id="passivo-observacao" /></div>
              <div class="field full btn-row"><button class="primary-btn" type="submit">Salvar passivo</button><button class="ghost-btn" type="button" id="btn-cancelar-passivo" style="display:none;">Cancelar</button></div>
            </form>
            <p id="mensagem-passivo" class="mensagem"></p>
          </section>
        </div>

        <section class="panel-box" style="margin-top:18px;"><h3>Ativos</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Nome</th><th>Tipo</th><th>Valor</th><th>Data</th><th>Status</th><th>Acoes</th></tr></thead><tbody id="tabela-ativos"></tbody></table></div></section>
        <section class="panel-box" style="margin-top:18px;"><h3>Passivos</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Nome</th><th>Tipo</th><th>Total</th><th>Pago</th><th>Saldo</th><th>Vencimento</th><th>Acoes</th></tr></thead><tbody id="tabela-passivos"></tbody></table></div></section>
      </div>
    `
  },

  contasReceber: {
    title: "Contas a receber",
    subtitle: "Controle de contratos, tickets, descontos e valores a receber",
    render: () => `
      <section class="receivable-layout">
        <div class="panel-box">
          <div class="table-toolbar">
            <div>
              <h3 style="margin:0;" id="titulo-form-conta-receber">Nova conta a receber</h3>
              <span>Preencha os dados conforme a planilha operacional</span>
            </div>
          </div>

          <form id="form-conta-receber" class="form-grid">
            <div class="field">
              <label for="cr-data-inicio">Data inicio</label>
              <input type="date" id="cr-data-inicio" required />
            </div>

            <div class="field">
              <label for="cr-contrato">Contrato</label>
              <input id="cr-contrato" placeholder="Contrato" />
            </div>

            <div class="field">
              <label for="cr-cte-ticket">No CTE / Ticket</label>
              <input id="cr-cte-ticket" placeholder="CTE ou ticket" />
            </div>

            <div class="field">
              <label for="cr-veiculo-id">Veiculo</label>
              <select id="cr-veiculo-id">
                <option value="">Sem vinculo</option>
              </select>
            </div>

            <div class="field cr-maquina-field" style="display:none;">
              <label for="cr-valor-hora-unitario">Valor unitario da hora</label>
              <input type="text" inputmode="decimal" id="cr-valor-hora-unitario" placeholder="0,00" />
            </div>

            <div class="field cr-maquina-field" style="display:none;">
              <label for="cr-quantidade-horas">Quantidade total de horas</label>
              <input type="text" inputmode="decimal" id="cr-quantidade-horas" placeholder="Ex: 8,9" />
            </div>

            <div class="field">
              <label for="cr-valor">Valor</label>
              <input type="text" inputmode="decimal" id="cr-valor" placeholder="0,00" />
            </div>

            <div class="field">
              <label for="cr-carga">Carga</label>
              <input id="cr-carga" placeholder="Carga" />
            </div>

            <div class="field">
              <label for="cr-ton-qnt">Ton/Qnt</label>
              <input id="cr-ton-qnt" placeholder="Tonelada ou quantidade" />
            </div>

            <div class="field">
              <label for="cr-tomador">Tomador</label>
              <input id="cr-tomador" placeholder="Tomador" />
            </div>

            <div class="field">
              <label for="cr-origem-destino">Origem x destino</label>
              <input id="cr-origem-destino" placeholder="Origem x destino" />
            </div>

            <div class="field">
              <label for="cr-bonificacao">Bonificacao</label>
              <input type="text" inputmode="decimal" id="cr-bonificacao" placeholder="0,00" />
            </div>

            <div class="field">
              <label for="cr-descontos">Descontos</label>
              <input type="text" inputmode="decimal" id="cr-descontos" placeholder="0,00" />
            </div>

            <div class="field">
              <label for="cr-desconto-classificacao">Classificacao do desconto</label>
              <select id="cr-desconto-classificacao">
                <option value="">Sem classificacao</option>
              </select>
            </div>

            <div class="field">
              <label for="cr-status-pagamento">Status pagamento</label>
              <select id="cr-status-pagamento">
                <option value="pendente">Pendente</option>
                <option value="recebido">Recebido</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>

            <div class="field">
              <label for="cr-data-recebimento">Data recebimento</label>
              <input type="date" id="cr-data-recebimento" />
            </div>

            <div class="field full">
              <div class="receivable-total-box">
                <span>Valor total a receber</span>
                <strong id="cr-total-preview">R$ 0,00</strong>
              </div>
            </div>

            <div class="field full btn-row">
              <button type="submit" class="primary-btn" id="btn-salvar-conta-receber">Salvar conta</button>
              <button type="button" class="ghost-btn" id="btn-cancelar-conta-receber" style="display:none;">Cancelar edicao</button>
            </div>
          </form>

          <p id="mensagem-conta-receber" class="mensagem"></p>
        </div>
      </section>

      ${popupFiltros("painel-filtros-contas-receber", "Filtros de contas a receber", "Localize contas por periodo, contrato, tomador ou veiculo.", `
        <div class="form-grid">
          <div class="field">
            <label for="cr-filtro-data-inicial">Data inicial</label>
            <input type="date" id="cr-filtro-data-inicial" />
          </div>

          <div class="field">
            <label for="cr-filtro-data-final">Data final</label>
            <input type="date" id="cr-filtro-data-final" />
          </div>

          <div class="field">
            <label for="cr-filtro-contrato">Contrato</label>
            <input id="cr-filtro-contrato" placeholder="Buscar contrato" />
          </div>

          <div class="field">
            <label for="cr-filtro-tomador">Tomador</label>
            <input id="cr-filtro-tomador" placeholder="Buscar tomador" />
          </div>

          <div class="field full">
            <label for="cr-filtro-veiculo-id">Veiculo</label>
            <select id="cr-filtro-veiculo-id">
              <option value="">Todos</option>
            </select>
          </div>

          <div class="field full btn-row">
            <button type="button" class="ghost-btn" id="btn-filtrar-contas-receber">Filtrar</button>
            <button type="button" class="ghost-btn" id="btn-limpar-contas-receber">Limpar filtros</button>
          </div>
        </div>
      `)}

      <div class="kpi-grid" style="margin-bottom:18px;">
        <div class="kpi-card">
          <div class="kpi-label">Registros</div>
          <div class="kpi-value" id="cr-total-registros-kpi">0</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Valor bruto</div>
          <div class="kpi-value" id="cr-total-bruto-kpi">R$ 0,00</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Descontos</div>
          <div class="kpi-value negative" id="cr-total-descontos-kpi">R$ 0,00</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Total a receber</div>
          <div class="kpi-value positive" id="cr-total-receber-kpi">R$ 0,00</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Recebido</div>
          <div class="kpi-value positive" id="cr-total-recebido-kpi">R$ 0,00</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Pendente</div>
          <div class="kpi-value warning" id="cr-total-pendente-kpi">R$ 0,00</div>
        </div>
      </div>

      <section class="panel-box">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">Conferencia de contas a receber</h3>
            <span id="cr-total-registros">0 registros</span>
          </div>

          <div class="btn-row">
            ${botaoFiltros("painel-filtros-contas-receber")}
            <button type="button" class="primary-btn" id="btn-imprimir-contas-receber">Imprimir</button>
          </div>
        </div>

        <div class="table-wrap receivable-table-wrap">
          <table class="data-table receivable-table" id="tabela-impressao-contas-receber">
            <thead>
              <tr>
                <th>Data inicio</th>
                <th>Contrato</th>
                <th>No CTE / Ticket</th>
                <th>Valor</th>
                <th>Horas</th>
                <th>Carga</th>
                <th>Ton/Qnt</th>
                <th>Tomador</th>
                <th>Origem x destino</th>
                <th>Bonificacao</th>
                <th>Veiculo</th>
                <th>Descontos</th>
                <th>Valor total a receber</th>
                <th>Status</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody id="tabela-contas-receber">
              <tr>
                <td colspan="15" class="empty-row">Nenhuma conta a receber encontrada.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    `
  },

  ativosPassivos: {
    title: "Ativos e Passivos",
    subtitle: "Patrimonio, financiamentos, emprestimos e saldo devedor",
    render: () => `
      <div class="kpi-grid" style="margin-bottom:18px;">
        <div class="kpi-card"><div class="kpi-label">Total de ativos</div><div class="kpi-value positive" id="ap-total-ativos">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Total de passivos</div><div class="kpi-value negative" id="ap-total-passivos">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Patrimonio liquido</div><div class="kpi-value" id="ap-patrimonio">R$ 0,00</div></div>
      </div>

      <div class="content-grid">
        <section class="panel-box">
          <h3 id="titulo-form-ativo">Novo ativo</h3>
          <form id="form-ativo" class="form-grid">
            <div class="field"><label>Nome</label><input id="ativo-nome" required /></div>
            <div class="field"><label>Tipo</label><select id="ativo-tipo"><option>Veiculo</option><option>Maquina</option><option>Equipamento</option><option>Imovel</option><option>Outro</option></select></div>
            <div class="field"><label>Valor</label><input type="number" step="0.01" id="ativo-valor" /></div>
            <div class="field"><label>Data aquisicao</label><input type="date" id="ativo-data" /></div>
            <div class="field"><label>Veiculo vinculado</label><select id="ativo-veiculo-id"><option value="">Sem vinculo</option></select></div>
            <div class="field"><label>Status</label><input id="ativo-status" value="Ativo" /></div>
            <div class="field full"><label>Observacao</label><input id="ativo-observacao" /></div>
            <div class="field full btn-row"><button class="primary-btn" type="submit">Salvar ativo</button><button class="ghost-btn" type="button" id="btn-cancelar-ativo" style="display:none;">Cancelar</button></div>
          </form>
          <p id="mensagem-ativo" class="mensagem"></p>
        </section>

        <section class="panel-box">
          <h3 id="titulo-form-passivo">Novo passivo</h3>
          <form id="form-passivo" class="form-grid">
            <div class="field"><label>Nome</label><input id="passivo-nome" required /></div>
            <div class="field"><label>Tipo</label><select id="passivo-tipo"><option>Financiamento</option><option>Emprestimo</option><option>Divida</option><option>Imposto a pagar</option><option>Outro</option></select></div>
            <div class="field"><label>Valor total</label><input type="number" step="0.01" id="passivo-valor-total" /></div>
            <div class="field"><label>Valor pago</label><input type="number" step="0.01" id="passivo-valor-pago" /></div>
            <div class="field"><label>Data inicio</label><input type="date" id="passivo-data-inicio" /></div>
            <div class="field"><label>Vencimento</label><input type="date" id="passivo-data-vencimento" /></div>
            <div class="field"><label>Status</label><input id="passivo-status" value="Pendente" /></div>
            <div class="field full"><label>Observacao</label><input id="passivo-observacao" /></div>
            <div class="field full btn-row"><button class="primary-btn" type="submit">Salvar passivo</button><button class="ghost-btn" type="button" id="btn-cancelar-passivo" style="display:none;">Cancelar</button></div>
          </form>
          <p id="mensagem-passivo" class="mensagem"></p>
        </section>
      </div>

      <section class="panel-box"><h3>Ativos</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Nome</th><th>Tipo</th><th>Valor</th><th>Data</th><th>Status</th><th>Acoes</th></tr></thead><tbody id="tabela-ativos"></tbody></table></div></section>
      <section class="panel-box"><h3>Passivos</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Nome</th><th>Tipo</th><th>Total</th><th>Pago</th><th>Saldo</th><th>Vencimento</th><th>Acoes</th></tr></thead><tbody id="tabela-passivos"></tbody></table></div></section>
    `
  },

  estoque: {
    title: "Estoque",
    subtitle: "Produtos, movimentacoes e alertas de estoque baixo",
    render: () => `
      <div class="kpi-grid" style="margin-bottom:18px;">
        <div class="kpi-card"><div class="kpi-label">Produtos</div><div class="kpi-value" id="est-total-produtos">0</div></div>
        <div class="kpi-card"><div class="kpi-label">Valor em estoque</div><div class="kpi-value positive" id="est-valor-total">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Estoque baixo</div><div class="kpi-value warning" id="est-baixo">0</div></div>
        <div class="kpi-card"><div class="kpi-label">Ultimas movimentacoes</div><div class="kpi-value" id="est-ultimas">0</div></div>
      </div>

      <section class="panel-box" style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px;">
        <div>
          <h3 style="margin:0;">Produtos em estoque</h3>
          <p style="margin:4px 0 0;">Cadastre produtos, registre entradas e saidas.</p>
        </div>
        <div class="estoque-actions">
          <button class="primary-btn" id="btn-novo-produto" type="button">+ Novo produto</button>
          <button class="ghost-btn" id="btn-movimentar-estoque" type="button">Movimentar</button>
          ${botaoFiltros("painel-filtros-estoque")}
        </div>
      </section>

      <div id="estoque-inline-container"></div>

      ${popupFiltros("painel-filtros-estoque", "Filtros de estoque", "Busque produtos por nome, categoria ou alerta de estoque baixo.", `
        <div class="form-grid">
          <div class="field"><label>Nome</label><input id="filtro-produto-nome" /></div>
          <div class="field"><label>Categoria</label><input id="filtro-produto-categoria" /></div>
          <div class="field"><label>Somente baixo</label><select id="filtro-produto-baixo"><option value="">Todos</option><option value="true">Sim</option></select></div>
          <div class="field btn-row">
            <button class="primary-btn" id="btn-filtrar-estoque" type="button">Filtrar</button>
            <button class="ghost-btn" id="btn-limpar-estoque" type="button">Limpar</button>
          </div>
        </div>
      `)}

      <section class="panel-box" style="margin-bottom:18px;">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Nome</th><th>Categoria</th><th>Qtd.</th><th>Custo unit.</th><th>Total</th><th>Minimo</th><th>Acoes</th></tr></thead>
            <tbody id="tabela-produtos"></tbody>
          </table>
        </div>
      </section>

      <section class="panel-box">
        <div class="table-toolbar" style="margin-bottom:14px;">
          <div><h3 style="margin:0;">Historico de movimentacoes</h3><span>Entradas, saidas e ajustes registrados</span></div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Quantidade</th><th>Valor unit.</th><th>Observacao</th></tr></thead>
            <tbody id="tabela-movimentacoes"></tbody>
          </table>
        </div>
      </section>

    `
  },

  configuracoes: {
    title: "Configuracoes",
    subtitle: "Preferencias locais da empresa e aparencia",
    render: () => `
      <section class="panel-box">
        <form id="form-configuracoes" class="form-grid">
          <div class="field"><label>Nome da empresa</label><input id="config-empresa" /></div>
          <div class="field full">
            <label>Logo da empresa</label>
            <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-top:6px;">
              <div id="logo-preview-box" style="width:72px;height:72px;border:2px dashed var(--border);border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--surface2);flex-shrink:0;">
                <span id="logo-preview-placeholder" style="font-size:28px;font-weight:700;color:var(--muted);">F</span>
              </div>
              <div style="flex:1;min-width:180px;">
                <input type="file" id="config-logo-file" accept="image/*" style="display:none;" />
                <button type="button" class="ghost-btn" id="btn-escolher-logo">Escolher imagem</button>
                <button type="button" class="ghost-btn" id="btn-remover-logo" style="display:none;margin-left:8px;color:var(--danger);">Remover logo</button>
                <p style="margin:6px 0 0;font-size:12px;color:var(--muted);">PNG, JPG ou SVG. Redimensionado para 256×256px automaticamente.</p>
              </div>
            </div>
            <input type="hidden" id="config-logo" />
          </div>
          <div class="field"><label>Tema</label><select id="config-tema"><option value="dark">Escuro</option><option value="light">Claro</option></select></div>
          <div class="field"><label>Cor principal</label><input type="color" id="config-cor" value="#4f8cff" /></div>
          <div class="field"><label>Moeda</label><input id="config-moeda" value="BRL" /></div>
          <div class="field full"><label>Dados do relatorio</label><input id="config-relatorio" placeholder="Rodape ou observacoes dos relatorios" /></div>
          <div class="field full"><button class="primary-btn" type="submit">Salvar configuracoes</button></div>
        </form>
        <p id="mensagem-configuracoes" class="mensagem"></p>
      </section>
      <section class="panel-box">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">Usuarios</h3>
            <span>Cadastro de acessos e perfis</span>
          </div>
        </div>
        <form id="form-usuario" class="form-grid">
          <div class="field"><label>Nome</label><input id="usuario-nome" /></div>
          <div class="field"><label>Email</label><input id="usuario-email" type="email" /></div>
          <div class="field"><label>Senha inicial</label><div class="input-eye-wrap"><input id="usuario-senha" type="password" /><button type="button" class="btn-eye-inline" onclick="toggleSenhaInput('usuario-senha',this)" title="Mostrar senha"><span data-lucide="eye"></span></button></div></div>
          <div class="field"><label>Perfil</label><select id="usuario-perfil"><option value="visualizador">Visualizador</option><option value="operador">Operador</option><option value="financeiro">Financeiro</option><option value="gestor">Gestor</option><option value="admin">Admin</option></select></div>
          <div class="field"><label>Status</label><select id="usuario-status"><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></div>
          <div class="field full"><button class="primary-btn" type="submit">Criar usuario</button></div>
        </form>
        <p id="mensagem-usuarios" class="mensagem"></p>
        <div class="table-wrap" style="margin-top:16px;">
          <table class="data-table">
            <thead><tr><th>Nome</th><th>Email</th><th>Perfil</th><th>Status</th><th>Acoes</th></tr></thead>
            <tbody id="tabela-usuarios"></tbody>
          </table>
        </div>
      </section>
    `
  },

  admin: {
    title: "Painel Master",
    subtitle: "Empresas, usuarios, permissoes e auditoria",
    render: () => `
      <section class="kpi-grid" style="margin-bottom:18px;">
        <div class="kpi-card"><div class="kpi-label">Empresas</div><div class="kpi-value" id="admin-total-empresas">0</div></div>
        <div class="kpi-card"><div class="kpi-label">Usuarios ativos</div><div class="kpi-value positive" id="admin-usuarios-ativos">0</div></div>
        <div class="kpi-card"><div class="kpi-label">Pendentes</div><div class="kpi-value" id="admin-usuarios-pendentes">0</div></div>
        <div class="kpi-card"><div class="kpi-label">Bloqueadas/Inativas</div><div class="kpi-value negative" id="admin-empresas-bloqueadas">0</div></div>
      </section>

      <section class="panel-box">
        <div class="table-toolbar">
          <div><h3 style="margin:0;">Empresa em gerenciamento</h3><span>Filtre usuarios e logs por empresa</span></div>
        </div>
        <div class="form-grid">
          <div class="field full"><label>Empresa</label><select id="admin-empresa-gerenciada"></select></div>
        </div>
      </section>

      <section class="panel-box admin-quick-actions">
        <div class="table-toolbar">
          <div><h3 style="margin:0;">Cadastros administrativos</h3><span>Abra uma tela separada para criar empresas e usuarios</span></div>
        </div>
        <div class="admin-action-buttons">
          <button class="primary-btn" id="btn-abrir-admin-empresa" type="button">Cadastrar empresa</button>
          <button class="ghost-btn" id="btn-abrir-admin-usuario" type="button">Cadastrar usuario</button>
        </div>
      </section>

      <div class="modal-overlay admin-modal-overlay" id="modal-admin-empresa" style="display:none;">
        <section class="modal-content modal-xl admin-modal-content">
          <div class="table-toolbar">
            <div><h3 style="margin:0;">Cadastro de empresa</h3><span>Somente master gerencia todas as empresas</span></div>
            <button class="ghost-btn" id="btn-fechar-admin-empresa" type="button">Fechar</button>
          </div>
          <form id="form-admin-empresa" class="form-grid">
            <div class="field"><label>Nome da empresa</label><input id="empresa-nome" required /></div>
            <div class="field"><label>Nome fantasia</label><input id="empresa-nome-fantasia" /></div>
            <div class="field"><label>CNPJ</label><input id="empresa-cnpj" /></div>
            <div class="field"><label>Inscricao estadual</label><input id="empresa-ie" /></div>
            <div class="field"><label>Telefone</label><input id="empresa-telefone" /></div>
            <div class="field"><label>Email</label><input id="empresa-email" type="email" /></div>
            <div class="field full"><label>Endereco completo</label><input id="empresa-endereco" /></div>
            <div class="field"><label>Cidade</label><input id="empresa-cidade" /></div>
            <div class="field"><label>Estado</label><input id="empresa-estado" maxlength="2" /></div>
            <div class="field"><label>CEP</label><input id="empresa-cep" /></div>
            <div class="field"><label>Status</label><select id="empresa-status"><option value="ativo">Ativa</option><option value="pendente">Pendente</option><option value="bloqueado">Bloqueada</option><option value="inativo">Inativa</option></select></div>
            <div class="field full"><label>Logo</label><input id="empresa-logo-arquivo" type="file" accept="image/*" /><input id="empresa-logo" type="hidden" /></div>
            <div class="field full"><label>Observacoes</label><input id="empresa-observacoes" /></div>
            <div class="field full"><button class="primary-btn" type="submit">Salvar empresa</button></div>
          </form>
          <p id="mensagem-admin-empresa" class="mensagem"></p>
        </section>
      </div>

      <section class="panel-box">
        <div class="table-toolbar"><div><h3 style="margin:0;">Empresas cadastradas</h3><span>Bloqueie, aprove ou desative empresas</span></div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Empresa</th><th>CNPJ</th><th>Email</th><th>Status</th><th>Acoes</th></tr></thead><tbody id="tabela-admin-empresas"></tbody></table></div>
      </section>

      <section class="panel-box">
        <div class="table-toolbar"><div><h3 style="margin:0;">Usuarios cadastrados</h3><span>Gerencie acessos, bloqueios e senhas</span></div></div>
        <div class="table-wrap" style="margin-top:16px;"><table class="data-table"><thead><tr><th>Nome</th><th>Email</th><th>Empresa</th><th>Perfil</th><th>Status</th><th>Senha</th><th>Ultimo login</th><th>Acoes</th></tr></thead><tbody id="tabela-admin-usuarios"></tbody></table></div>
      </section>

      <div class="modal-overlay admin-modal-overlay" id="modal-admin-usuario" style="display:none;">
        <section class="modal-content modal-xl admin-modal-content">
          <div class="table-toolbar">
            <div><h3 style="margin:0;">Cadastro de usuario</h3><span>Vincule usuarios a empresas e perfis</span></div>
            <button class="ghost-btn" id="btn-fechar-admin-usuario" type="button">Fechar</button>
          </div>
          <form id="form-admin-usuario" class="form-grid">
            <div class="field"><label>Nome</label><input id="admin-usuario-nome" required /></div>
            <div class="field"><label>Email</label><input id="admin-usuario-email" type="email" required /></div>
            <div class="field"><label>Senha inicial</label><div class="input-eye-wrap"><input id="admin-usuario-senha" type="password" required /><button type="button" class="btn-eye-inline" onclick="toggleSenhaInput('admin-usuario-senha',this)" title="Mostrar senha"><span data-lucide="eye"></span></button></div></div>
            <div class="field"><label>Empresa</label><select id="admin-usuario-empresa"></select></div>
            <div class="field"><label>Perfil</label><select id="admin-usuario-perfil"><option value="visualizador">Visualizador</option><option value="operador">Operador</option><option value="financeiro">Financeiro</option><option value="gestor">Gestor</option><option value="admin">Admin</option><option value="master">Master</option></select></div>
            <div class="field"><label>Status</label><select id="admin-usuario-status"><option value="ativo">Ativo</option><option value="pendente">Pendente</option><option value="bloqueado">Bloqueado</option><option value="inativo">Inativo</option></select></div>
            <div class="field"><label>Telefone</label><input id="admin-usuario-telefone" /></div>
            <div class="field"><label>Cargo/Função</label><input id="admin-usuario-cargo" /></div>
            <div class="field full"><button class="primary-btn" type="submit">Salvar usuario</button></div>
          </form>
          <p id="mensagem-admin-usuario" class="mensagem"></p>
        </section>
      </div>

      <section class="panel-box">
        <div class="table-toolbar">
          <div><h3 style="margin:0;">Acessos do App Motorista</h3><span>Credenciais separadas para o app mobile dos motoristas</span></div>
          <button class="primary-btn" id="btn-novo-acesso-motorista" type="button">+ Novo acesso</button>
        </div>
        <div id="form-acesso-motorista-container"></div>
        <div class="table-wrap" style="margin-top:12px;">
          <table class="data-table">
            <thead><tr><th>Nome</th><th>Email</th><th>Motorista vinculado</th><th>Status</th><th>Link app</th><th>Acoes</th></tr></thead>
            <tbody id="tabela-motorista-acessos"></tbody>
          </table>
        </div>
      </section>

      <section class="panel-box">
        <div class="table-toolbar">
          <div><h3 style="margin:0;">Solicitacoes de cadastro</h3><span>Pedidos de acesso enviados pelo formulario de login</span></div>
          <div style="display:flex;gap:8px;align-items:center;">
            <select id="filtro-solicitacao-status" style="font-size:13px;padding:6px 10px;">
              <option value="">Todas</option>
              <option value="pendente">Pendentes</option>
              <option value="aprovado">Aprovadas</option>
              <option value="rejeitado">Rejeitadas</option>
            </select>
          </div>
        </div>
        <div class="table-wrap" style="margin-top:12px;">
          <table class="data-table">
            <thead><tr><th>Data</th><th>Empresa</th><th>Nome</th><th>Cargo</th><th>Email</th><th>WhatsApp</th><th>Status</th><th>Acoes</th></tr></thead>
            <tbody id="tabela-solicitacoes"></tbody>
          </table>
        </div>
      </section>

      <section class="panel-box">
        <div class="table-toolbar"><div><h3 style="margin:0;">Auditoria</h3><span>Ultimas acoes administrativas</span></div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Acao</th><th>Entidade</th><th>ID</th><th>IP</th><th>Acoes</th></tr></thead><tbody id="tabela-admin-auditoria"></tbody></table></div>
      </section>
    `
  },

  relatorios: {
    title: "Relatorios",
    subtitle: "Analise executiva, DRE, graficos e demonstrativos",
    render: () => `
      <section class="panel-box report-hero no-print">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">Central de relatorios</h3>
            <span id="rel-filtros-resumo">Visao consolidada da operacao.</span>
          </div>
          <div class="report-actions">
            ${botaoFiltros("painel-filtros-relatorios")}
            <button type="button" class="ghost-btn" id="btn-imprimir-relatorio">Imprimir</button>
            <button type="button" class="ghost-btn" id="btn-exportar-pdf">PDF</button>
            <button type="button" class="ghost-btn" id="btn-exportar-excel">Excel</button>
          </div>
        </div>
      </section>

      ${popupFiltros("painel-filtros-relatorios", "Filtros do relatorio", "Use os mesmos filtros para tela, impressao, PDF e Excel.", `
        <div class="form-grid">
          <div class="field">
            <label for="rel-data-inicial">Data inicial</label>
            <input type="date" id="rel-data-inicial" />
          </div>

          <div class="field">
            <label for="rel-data-final">Data final</label>
            <input type="date" id="rel-data-final" />
          </div>

          <div class="field">
            <label for="rel-veiculo-id">Veiculo</label>
            <select id="rel-veiculo-id">
              <option value="">Todos</option>
            </select>
          </div>

          <div class="field">
            <label for="rel-classificacao">Classificacao</label>
            <select id="rel-classificacao">
              <option value="">Todas</option>
            </select>
          </div>

          <div class="field">
            <label for="rel-empresa-id">Empresa ID</label>
            <input type="number" id="rel-empresa-id" placeholder="Opcional" />
          </div>

          <div class="field">
            <label for="rel-obra-servico">Obra/servico</label>
            <input id="rel-obra-servico" placeholder="Opcional" />
          </div>

          <div class="field full btn-row">
            <button type="button" class="primary-btn" id="btn-gerar-relatorio">Gerar relatorio</button>
            <button type="button" class="ghost-btn" id="btn-limpar-relatorio">Limpar filtros</button>
          </div>
        </div>
      `)}

      <section id="relatorio-feedback"></section>

      <section id="relatorio-print-area" class="print-area report-print-area">
        <div class="report-print-header">
          <div>
            <span class="report-eyebrow">Relatorio gerencial</span>
            <h2>Demonstrativo financeiro e operacional</h2>
            <p id="rel-periodo-print">Todos os registros disponiveis</p>
          </div>
          <div class="report-generated">
            <span>Emitido em</span>
            <strong id="rel-data-emissao">-</strong>
          </div>
        </div>

        <div class="kpi-grid report-kpis">
          <div class="kpi-card report-kpi-card"><div class="kpi-label">Faturamento</div><div class="kpi-value positive" id="rel-fat">R$ 0,00</div><small id="rel-fat-sub">Receitas do periodo</small></div>
          <div class="kpi-card report-kpi-card"><div class="kpi-label">Custos operacionais</div><div class="kpi-value negative" id="rel-custos">R$ 0,00</div><small id="rel-custos-sub">Custos ligados a operacao</small></div>
          <div class="kpi-card report-kpi-card"><div class="kpi-label">Lucro bruto</div><div class="kpi-value" id="rel-lucro-bruto">R$ 0,00</div><small id="rel-margem-bruta">Margem bruta 0%</small></div>
          <div class="kpi-card report-kpi-card"><div class="kpi-label">Lucro liquido</div><div class="kpi-value" id="rel-lucro-liquido">R$ 0,00</div><small id="rel-margem-liquida">Margem liquida 0%</small></div>
          <div class="kpi-card report-kpi-card"><div class="kpi-label">Saldo final</div><div class="kpi-value" id="rel-saldo">R$ 0,00</div><small>Depois de investimentos</small></div>
          <div class="kpi-card report-kpi-card"><div class="kpi-label">A receber pendente</div><div class="kpi-value warning" id="rel-pendente">R$ 0,00</div><small id="rel-pendente-sub">Carteira em aberto</small></div>
        </div>

        <section class="report-executive-grid">
          <div class="panel-box report-dre-card">
            <div class="report-section-head">
              <div>
                <h3>Demonstrativo de resultado</h3>
                <span>Modelo gerencial do periodo selecionado</span>
              </div>
            </div>
            <div class="dre-list">
              <div class="dre-row positive"><span>Receita operacional bruta</span><strong id="dre-receita">R$ 0,00</strong></div>
              <div class="dre-row negative"><span>(-) Custos operacionais</span><strong id="dre-custos">R$ 0,00</strong></div>
              <div class="dre-row subtotal"><span>Lucro bruto</span><strong id="dre-lucro-bruto">R$ 0,00</strong></div>
              <div class="dre-row negative"><span>(-) Despesas administrativas</span><strong id="dre-despesas">R$ 0,00</strong></div>
              <div class="dre-row subtotal"><span>Resultado operacional</span><strong id="dre-lucro-liquido">R$ 0,00</strong></div>
              <div class="dre-row negative"><span>(-) Investimentos</span><strong id="dre-investimentos">R$ 0,00</strong></div>
              <div class="dre-row total"><span>Saldo do periodo</span><strong id="dre-saldo">R$ 0,00</strong></div>
            </div>
          </div>

          <div class="panel-box report-insights-card">
            <div class="report-section-head">
              <div>
                <h3>Leitura rapida</h3>
                <span>Indicadores para decisao</span>
              </div>
            </div>
            <div id="rel-insights" class="report-insights"></div>
          </div>
        </section>

        <section class="report-charts premium-report-charts">
          <div class="panel-box chart-card chart-card-wide"><h3>Evolucao mensal</h3><canvas id="chart-periodo"></canvas></div>
          <div class="panel-box chart-card"><h3>Distribuicao por classificacao</h3><canvas id="chart-classificacao"></canvas></div>
          <div class="panel-box chart-card"><h3>Resultado por veiculo</h3><canvas id="chart-veiculo"></canvas></div>
          <div class="panel-box chart-card"><h3>Contas a receber</h3><canvas id="chart-contas"></canvas></div>
        </section>

        <section class="report-detail-grid">
          <div class="panel-box">
            <div class="report-section-head"><h3>Por classificacao</h3><span>Maiores grupos de movimentacao</span></div>
            <div class="table-wrap"><table class="data-table premium-table"><thead><tr><th>Classificacao</th><th>Grupo</th><th>Qtd.</th><th>Total</th><th>Participacao</th></tr></thead><tbody id="rel-tabela-classificacao"></tbody></table></div>
          </div>

          <div class="panel-box">
            <div class="report-section-head"><h3>Por periodo</h3><span>Evolucao mensal do resultado</span></div>
            <div class="table-wrap"><table class="data-table premium-table"><thead><tr><th>Periodo</th><th>Receitas</th><th>Custos</th><th>Despesas</th><th>Investimentos</th><th>Resultado</th><th>Margem</th></tr></thead><tbody id="rel-tabela-periodo"></tbody></table></div>
          </div>
        </section>

        <section class="panel-box">
          <div class="report-section-head"><h3>Resultado por veiculo</h3><span>Receitas, custos, despesas e eficiencia operacional</span></div>
          <div class="table-wrap"><table class="data-table premium-table"><thead><tr><th>Veiculo</th><th>Placa</th><th>Receitas</th><th>Custos</th><th>Despesas</th><th>Investimentos</th><th>Resultado</th><th>Custo/KM</th><th>Consumo medio</th></tr></thead><tbody id="rel-tabela-veiculo"></tbody></table></div>
        </section>

        <section class="report-detail-grid">
          <div class="panel-box">
            <div class="report-section-head"><h3>Contas a receber</h3><span>Contratos e recebimentos do periodo</span></div>
            <div class="table-wrap"><table class="data-table premium-table"><thead><tr><th>Data</th><th>Contrato</th><th>Tomador</th><th>Total</th><th>Status</th></tr></thead><tbody id="rel-tabela-contas-receber"></tbody></table></div>
          </div>

          <div class="panel-box">
            <div class="report-section-head"><h3>Contas a pagar</h3><span>Compromissos financeiros registrados</span></div>
            <div class="table-wrap"><table class="data-table premium-table"><thead><tr><th>Descricao</th><th>Valor</th><th>Status</th></tr></thead><tbody id="rel-tabela-contas-pagar"></tbody></table></div>
          </div>
        </section>
      </section>
    `
  },

  mapa: {
    title: "Mapa",
    subtitle: "Localizacao operacional em tempo real",
    render: () => `
      <section class="mapa-shell">
        <div class="mapa-topbar">
          <div>
            <h3>Motoristas em rota</h3>
            <span id="mapa-status-atualizacao">Aguardando sinal...</span>
          </div>
          <div class="btn-row">
            <button type="button" class="ghost-btn" id="btn-mapa-centralizar">Centralizar</button>
            <button type="button" class="primary-btn" id="btn-mapa-simular">Simular GPS</button>
          </div>
        </div>

        <div class="mapa-layout">
          <aside class="mapa-driver-panel">
            <div class="mapa-summary-grid">
              <div>
                <span>Online</span>
                <strong id="mapa-online-total">0</strong>
              </div>
              <div>
                <span>Total</span>
                <strong id="mapa-motoristas-total">0</strong>
              </div>
            </div>
            <div id="mapa-lista-motoristas" class="mapa-driver-list">
              <p class="empty-row">Carregando motoristas...</p>
            </div>
          </aside>

          <div class="mapa-canvas-wrap">
            <div id="mapa-operacional" class="mapa-canvas"></div>
          </div>
        </div>
      </section>
    `
  }
};

// =========================================================
// FUNCOES AUXILIARES GERAIS
//
// Funções de formatação, normalização e utilitários usados
// em múltiplos módulos da aplicação.
// =========================================================

// Converte qualquer valor para número float, lidando com formatos BR e EN.
// Aceita strings como "1.234,56" (BR), "1234.56" (EN), objetos Number e null/undefined.
// Retorna 0 em vez de NaN para evitar erros em cálculos downstream.
function normalizarNumero(valor) {
  if (valor === null || valor === undefined || valor === "") return 0;

  if (typeof valor === "number") {
    return isNaN(valor) ? 0 : valor;
  }

  const texto = String(valor)
    .replace("R$", "")
    .replace(/\s/g, "")
    .trim();
  const temVirgula = texto.includes(",");
  const temPonto = texto.includes(".");
  const decimal = temVirgula
    ? texto.replace(/\./g, "").replace(",", ".")
    : (temPonto && (texto.match(/\./g) || []).length > 1 ? texto.replace(/\./g, "") : texto);

  const numero = parseFloat(decimal);
  return isNaN(numero) ? 0 : numero;
}

// Formata um n\u00famero como moeda BRL (ex.: R$ 1.234,56).
// Usa normalizarNumero internamente, ent\u00e3o aceita strings formatadas.
function formatarValor(valor) {
  const numero = normalizarNumero(valor);

  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

// Formata um n\u00famero como percentual com 1 casa decimal no padr\u00e3o PT-BR (ex.: "12,3%").
// Retorna "0,0%" para valores n\u00e3o finitos (Infinity, NaN).
function formatarPercentual(valor) {
  if (!Number.isFinite(valor)) return "0,0%";
  return `${valor.toFixed(1).replace(".", ",")}%`;
}

// Remove acentos e converte para min\u00fasculas para compara\u00e7\u00f5es case-insensitive
// e accent-insensitive. Usada em filtros e verifica\u00e7\u00f5es de classifica\u00e7\u00e3o.
function normalizarTexto(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Heur\u00edstica simples para determinar se um lan\u00e7amento \u00e9 uma receita.
// Verifica se a classifica\u00e7\u00e3o ou descri\u00e7\u00e3o cont\u00e9m palavras-chave de receita.
// Usado no dashboard para separar receitas de despesas sem campo "tipo" expl\u00edcito.
function lancamentoEhReceita(item) {
  const texto = normalizarTexto(`${item.classificacao || ""} ${item.descricao || ""}`);
  return texto.includes("receita") || texto.includes("recebimento") || texto.includes("servicos prestados");
}

// Converte data ISO (YYYY-MM-DD) para o formato visual brasileiro (DD/MM/YYYY).
// Faz o split manual para evitar problemas de fuso hor\u00e1rio do construtor Date().
function formatarDataCurta(dataIso) {
  if (!dataIso) return "-";
  const partes = String(dataIso).split("-");
  if (partes.length !== 3) return dataIso;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

// Verifica se uma classifica\u00e7\u00e3o se refere a combust\u00edvel (case-insensitive, sem acento).
// Usado para exibir/ocultar os campos extras de KM, litros e NF no formul\u00e1rio de lan\u00e7amento.
function classificacaoEhCombustivel(valor) {
  return normalizarTexto(valor).includes("combustivel");
}

// Resolve o nome de exibi\u00e7\u00e3o de um ve\u00edculo a partir do cache local.
// Retorna "Nome (Placa)" ou "-" se n\u00e3o encontrado.
// Evita novas requisi\u00e7\u00f5es \u00e0 API para cada linha de tabela exibida.
function nomeVeiculoPorId(veiculoId) {
  if (!veiculoId) return "-";
  const veiculo = cacheVeiculos.find(item => item.id === Number(veiculoId));
  if (!veiculo) return "-";
  return `${veiculo.nome || veiculo.modelo || "Veiculo"}${veiculo.placa ? ` (${veiculo.placa})` : ""}`;
}

// =========================================================
// FUNCOES DE API
//
// Camada de abstração sobre fetch(). Todas as chamadas ao backend
// passam por aqui, garantindo que o token JWT seja sempre enviado
// e que erros HTTP sejam convertidos em exceções com mensagem amigável.
//
// Fluxo padrão de cada função:
//   1. Monta URL completa prefixando API_URL
//   2. Inclui header Authorization: Bearer <token> via authHeaders()
//   3. Lança Error se response.ok === false (qualquer status >= 400)
//   4. Redireciona para login.html em caso de 401 (token expirado)
// =========================================================

// GET genérico: busca dados do backend. Usado em todos os carregamentos
// de listas e dados de relatório. Lança exceção em caso de erro HTTP.
async function apiGet(url) {
  const response = await fetch(`${API_URL}${url}`, { headers: authHeaders() });
  const resultado = await response.json();

  tratarNaoAutorizado(response);
  if (!response.ok) {
    throw new Error(extrairMensagemErroApi(resultado, "Falha ao carregar dados."));
  }

  return resultado;
}

// DELETE genérico: remove um registro pelo ID na URL (ex.: /veiculos/5).
// Confirmação com confirm() deve ser feita pelo chamador antes de invocar.
async function apiDelete(url) {
  const response = await fetch(`${API_URL}${url}`, {
    method: "DELETE",
    headers: authHeaders()
  });

  const resultado = await response.json();

  tratarNaoAutorizado(response);
  if (!response.ok) {
    throw new Error(extrairMensagemErroApi(resultado, "Falha ao excluir registro."));
  }

  return resultado;
}

// Envio genérico com corpo JSON: usado para POST, PUT e PATCH.
// O parâmetro method permite reutilizar a mesma função para criar e editar.
// Serializa payload como JSON e define Content-Type automaticamente.
async function apiSend(url, method, payload) {
  const response = await fetch(`${API_URL}${url}`, {
    method,
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });

  const resultado = await response.json();

  tratarNaoAutorizado(response);
  if (!response.ok) {
    throw new Error(extrairMensagemErroApi(resultado, "Erro ao salvar dados."));
  }

  return resultado;
}

// Alias semântico para PUT: garante legibilidade nas chamadas de edição inline de estoque.
async function apiPut(url, payload) {
  return apiSend(url, "PUT", payload);
}

// Lê o token JWT do sessionStorage. Retorna string vazia se não autenticado.
// sessionStorage é limpo ao fechar a aba, forçando novo login por sessão.
function getAccessToken() {
  return sessionStorage.getItem("financeiro_access_token") || "";
}

// Monta o objeto de headers com o token JWT no formato Bearer.
// Aceita headers adicionais via parâmetro (ex.: Content-Type para requisições com body).
// Se não há token, retorna apenas os headers extras sem Authorization.
function authHeaders(headers = {}) {
  const token = getAccessToken();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

// Intercepta resposta 401 (não autorizado / token expirado).
// Remove dados de sessão e redireciona para login.html imediatamente.
// Chamada por apiGet, apiSend e apiDelete após cada fetch.
function tratarNaoAutorizado(response) {
  if (response.status !== 401) return;
  sessionStorage.removeItem("financeiro_access_token");
  sessionStorage.removeItem("financeiro_usuario");
  window.location.href = "/login";
}

// Proteção de rota: chamada na inicialização para garantir que o usuário
// esteja autenticado antes de qualquer renderização. Redireciona se não há token.
function exigirLogin() {
  if (!getAccessToken()) {
    window.location.href = "/login";
  }
}

// Exibe mensagem de erro amigável dentro de um container DOM.
// Usada como fallback quando uma seção específica falha ao carregar,
// sem bloquear o restante da página.
function mostrarErroAmigavel(containerId, erro) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `<p class="empty-row">Nao foi possivel carregar os dados. ${erro.message || ""}</p>`;
}

// Abre a URL de exportação (PDF ou Excel) em nova aba do navegador.
// A rota do backend retorna o arquivo diretamente como resposta HTTP,
// por isso é suficiente abrir via window.open.
function abrirExportacao(url) {
  window.open(`${API_URL}${url}`, "_blank");
}

// Exibe uma notificação tipo "toast" flutuante na tela por 3,5 segundos.
// Cria o container #toast-container se ainda não existir no DOM.
// tipo: "success" (verde) | "error" (vermelho) — controlado via CSS.
function mostrarToast(mensagem, tipo = "success") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast ${tipo}`;
  toast.textContent = mensagem;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// =========================================================
// MODULO DE VEICULOS
//
// Gerencia o CRUD completo da frota: listagem em cards visuais,
// formulário inline de criação/edição, filtros e totalizadores.
//
// Fluxo de renderização:
//   1. renderizarVeiculos() carrega a lista, aplica filtros locais e
//      gera um card HTML por veículo com foto ou ícone de fallback.
//   2. abrirFormVeiculo() injeta o formulário em #form-veiculo-container.
//   3. O botão salvar chama apiSend (POST ou PUT) e re-renderiza.
//   4. Editar e excluir são funções globais (window.*) chamadas via onclick nos cards.
//
// Cache: após cada carregamento, cacheVeiculos é atualizado para
// ser reutilizado por lançamentos, contas a receber e relatórios.
// =========================================================

// Busca a lista completa de veículos da empresa no backend.
async function carregarVeiculos() {
  return apiGet("/veiculos");
}

// Retorna o emoji correspondente ao tipo de veículo para o fallback visual
// quando o veículo não possui foto cadastrada.
function iconePorTipo(tipo) {
  if (tipo === "Caminhao") return "🚚";
  if (tipo === "Carro") return "🚗";
  if (tipo === "Maquina") return "🚜";
  if (tipo === "Motocicleta") return "🏍️";
  return "🚘";
}

// Redimensiona e comprime uma imagem antes de converter para base64.
// maxW/maxH: dimensão máxima em px (mantém proporção). qualidade: 0-1 para JPEG.
// SVGs passam direto sem redimensionamento (canvas não suporta SVG bem).
// Retorna string vazia se nenhum arquivo foi fornecido.
function redimensionarImagem(arquivo, maxW, maxH, qualidade = 0.82) {
  return new Promise((resolve, reject) => {
    if (!arquivo) { resolve(""); return; }
    if (arquivo.type === "image/svg+xml") {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(arquivo);
      return;
    }
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", qualidade));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(arquivo);
  });
}

function arquivoParaBase64(arquivo) {
  return redimensionarImagem(arquivo, 800, 600);
}

// Filtra a lista de veículos localmente com base nos valores atuais dos campos de filtro.
// Executada antes de renderizar os cards, sem nova requisição ao backend.
function aplicarFiltrosVeiculos(lista) {
  const nome = document.getElementById("filtro-veiculo-nome")?.value.trim().toLowerCase() || "";
  const placa = document.getElementById("filtro-veiculo-placa")?.value.trim().toLowerCase() || "";
  const tipo = document.getElementById("filtro-veiculo-tipo")?.value || "";
  const status = document.getElementById("filtro-veiculo-status")?.value || "";

  return lista.filter((v) => {
    const nomeOk = !nome || (v.nome || "").toLowerCase().includes(nome);
    const placaOk = !placa || (v.placa || "").toLowerCase().includes(placa);
    const tipoOk = !tipo || v.tipo === tipo;
    const statusOk = !status || v.status === status;

    return nomeOk && placaOk && tipoOk && statusOk;
  });
}

// Conecta os botões "Filtrar" e "Limpar filtros" do popup de veículos.
// Chamada por loadPage("veiculos") após o HTML ser renderizado.
// Ao filtrar, fecha o popup e re-renderiza os cards com os filtros ativos.
function iniciarFiltrosVeiculos() {
  const btnFiltrar = document.getElementById("btn-filtrar-veiculos");
  const btnLimpar = document.getElementById("btn-limpar-filtro-veiculos");

  if (btnFiltrar) {
    btnFiltrar.onclick = async () => {
      await renderizarVeiculos();
      fecharPopupFiltros("painel-filtros-veiculos");
    };
  }

  if (btnLimpar) {
    btnLimpar.onclick = async () => {
      document.getElementById("filtro-veiculo-nome").value = "";
      document.getElementById("filtro-veiculo-placa").value = "";
      document.getElementById("filtro-veiculo-tipo").value = "";
      document.getElementById("filtro-veiculo-status").value = "";
      await renderizarVeiculos();
      fecharPopupFiltros("painel-filtros-veiculos");
    };
  }
}

// Atualiza os 4 cards KPI da página de veículos (total, ativos, manutenção, inativos)
// com base na lista já filtrada. Chamada sempre após renderizarVeiculos().
function atualizarTotalizadoresVeiculos(veiculos) {
  const total = document.getElementById("veiculos-total");
  const ativos = document.getElementById("veiculos-ativos");
  const manutencao = document.getElementById("veiculos-manutencao");
  const inativos = document.getElementById("veiculos-inativos");

  if (!total || !ativos || !manutencao || !inativos) return;

  total.textContent = veiculos.length;
  ativos.textContent = veiculos.filter(v => v.status === "Ativo").length;
  manutencao.textContent = veiculos.filter(v => v.status === "Manutencao").length;
  inativos.textContent = veiculos.filter(v => v.status === "Inativo").length;
}

// Carrega veículos do backend, aplica filtros locais e gera os cards HTML.
// Cada card exibe foto (ou ícone emoji como fallback), dados do veículo,
// badge de status e botões de editar/excluir.
async function renderizarVeiculos() {
  const container = document.getElementById("lista-veiculos");
  if (!container) return;

  let veiculos = await carregarVeiculos();
  veiculos = aplicarFiltrosVeiculos(veiculos);

  atualizarTotalizadoresVeiculos(veiculos);

  if (!veiculos.length) {
    container.innerHTML = `<div class="panel-box"><p>Nenhum veiculo encontrado.</p></div>`;
    return;
  }

  container.innerHTML = veiculos.map(v => {
    const statusClass = (v.status || "").toLowerCase() === "ativo"
      ? "ativo"
      : (v.status || "").toLowerCase() === "manutencao"
      ? "manutencao"
      : "inativo";

    const topoCard = v.foto
      ? `<img src="${v.foto}" alt="Foto do veiculo" class="vehicle-photo">`
      : `<div class="vehicle-thumb-fallback">${iconePorTipo(v.tipo)}</div>`;

    return `
      <article class="vehicle-card">
        ${topoCard}

        <div class="vehicle-body">
          <h3>${v.nome || ""}</h3>
          <p>${v.marca || ""} ${v.modelo || ""}</p>

          <div class="vehicle-meta">
            <div class="vehicle-meta-row">
              <span>Placa</span>
              <strong>${v.placa || ""}</strong>
            </div>

            <div class="vehicle-meta-row">
              <span>Ano</span>
              <strong>${v.ano || ""}</strong>
            </div>

            <div class="vehicle-meta-row">
              <span>Tipo</span>
              <strong>${v.tipo || ""}</strong>
            </div>
          </div>

          <span class="status-badge ${statusClass}">${v.status || ""}</span>

          <div class="vehicle-observacao">
            ${v.observacao ? v.observacao : "Sem observacoes."}
          </div>

          <div class="action-row">
            <button class="small-btn edit-btn" onclick="editarVeiculoPorId(${v.id})">
              Editar
            </button>

            <button class="small-btn delete-btn" onclick="excluirVeiculo(${v.id})">
              Excluir
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

// Injeta o formulário de veículo em #form-veiculo-container.
// Funciona tanto para criar (editandoVeiculoId = null) quanto para editar.
// O preview da foto é atualizado em tempo real ao selecionar arquivo.
// O botão salvar monta o payload e chama apiSend (POST ou PUT).
// Botão cancelar limpa o container e reseta o estado de edição.
function abrirFormVeiculo(
  nome = "",
  marca = "",
  modelo = "",
  ano = "",
  placa = "",
  tipo = "Caminhao",
  status = "Ativo",
  observacao = "",
  foto = ""
) {
  const container = document.getElementById("form-veiculo-container");
  if (!container) return;

  const titulo = editandoVeiculoId ? "Alterar veiculo" : "Novo veiculo";
  const textoBotao = editandoVeiculoId ? "Salvar alteracao" : "Salvar";

  const previewInicial = foto
    ? `<img src="${foto}" alt="Previa da foto">`
    : `<span>Sem foto selecionada</span>`;

  container.innerHTML = `
    <div class="panel-box">
      <h3>${titulo}</h3>

      <div class="form-grid">
        <div class="field">
          <label>Nome</label>
          <input id="v-nome" value="${nome}" />
        </div>

        <div class="field">
          <label>Marca</label>
          <input id="v-marca" value="${marca}" />
        </div>

        <div class="field">
          <label>Modelo</label>
          <input id="v-modelo" value="${modelo}" />
        </div>

        <div class="field">
          <label>Ano</label>
          <input id="v-ano" value="${ano}" />
        </div>

        <div class="field">
          <label>Placa</label>
          <input id="v-placa" value="${placa}" />
        </div>

        <div class="field">
          <label>Tipo</label>
          <select id="v-tipo">
            <option value="Caminhao" ${tipo === "Caminhao" ? "selected" : ""}>Caminhao</option>
            <option value="Carro" ${tipo === "Carro" ? "selected" : ""}>Carro</option>
            <option value="Maquina" ${tipo === "Maquina" ? "selected" : ""}>Maquina</option>
            <option value="Motocicleta" ${tipo === "Motocicleta" ? "selected" : ""}>Motocicleta</option>
          </select>
        </div>

        <div class="field full">
          <label>Status</label>
          <select id="v-status">
            <option value="Ativo" ${status === "Ativo" ? "selected" : ""}>Ativo</option>
            <option value="Manutencao" ${status === "Manutencao" ? "selected" : ""}>Manutencao</option>
            <option value="Inativo" ${status === "Inativo" ? "selected" : ""}>Inativo</option>
          </select>
        </div>

        <div class="field full">
          <label>Observacao</label>
          <input id="v-observacao" value="${observacao}" />
        </div>

        <div class="field full">
          <label>Foto do veiculo</label>
          <input type="file" id="v-foto-arquivo" accept="image/*" />
          <input type="hidden" id="v-foto-base64" value="${foto}" />
        </div>

        <div class="field full">
          <label>Previa</label>
          <div class="photo-preview-box" id="v-foto-preview">
            ${previewInicial}
          </div>
        </div>

        <div class="field full btn-row">
          <button class="primary-btn" id="salvar-veiculo">${textoBotao}</button>
          <button class="ghost-btn" id="cancelar-veiculo">Cancelar</button>
        </div>
      </div>

      <p id="mensagem-veiculo" class="mensagem"></p>
    </div>
  `;

  const inputArquivo = document.getElementById("v-foto-arquivo");
  const inputBase64 = document.getElementById("v-foto-base64");
  const preview = document.getElementById("v-foto-preview");

  inputArquivo.addEventListener("change", async () => {
    const arquivo = inputArquivo.files[0];
    if (!arquivo) return;

    const base64 = await arquivoParaBase64(arquivo);
    inputBase64.value = base64;
    preview.innerHTML = `<img src="${base64}" alt="Previa da foto">`;
  });

  document.getElementById("salvar-veiculo").onclick = async () => {
    const mensagem = document.getElementById("mensagem-veiculo");
    const payload = {
      nome: document.getElementById("v-nome").value,
      marca: document.getElementById("v-marca").value,
      modelo: document.getElementById("v-modelo").value,
      ano: document.getElementById("v-ano").value,
      placa: document.getElementById("v-placa").value,
      tipo: document.getElementById("v-tipo").value,
      status: document.getElementById("v-status").value,
      observacao: document.getElementById("v-observacao").value,
      foto: document.getElementById("v-foto-base64").value
    };

    const url = editandoVeiculoId ? `/veiculos/${editandoVeiculoId}` : "/veiculos";
    const method = editandoVeiculoId ? "PUT" : "POST";

    try {
      await apiSend(url, method, payload);
      editandoVeiculoId = null;
      container.innerHTML = "";
      mostrarToast("Veiculo salvo com sucesso.", "success");
      await renderizarVeiculos();
    } catch (erro) {
      mensagem.textContent = erro.message;
      mostrarToast(erro.message, "error");
    }
  };

  document.getElementById("cancelar-veiculo").onclick = () => {
    editandoVeiculoId = null;
    container.innerHTML = "";
  };
}

// Exposta globalmente (window.*) para ser chamada via onclick no card do veículo.
// Carrega os dados atuais do veículo, define o modo de edição e pré-preenche o formulário.
window.editarVeiculoPorId = async (id) => {
  const veiculos = await carregarVeiculos();
  const veiculo = veiculos.find(item => item.id === id);
  if (!veiculo) return;

  editandoVeiculoId = id;

  abrirFormVeiculo(
    veiculo.nome || "",
    veiculo.marca || "",
    veiculo.modelo || "",
    veiculo.ano || "",
    veiculo.placa || "",
    veiculo.tipo || "Caminhao",
    veiculo.status || "Ativo",
    veiculo.observacao || "",
    veiculo.foto || ""
  );
};

// Exposta globalmente para o onclick do card. Exige confirmação antes de excluir.
// Após exclusão bem-sucedida, re-renderiza a grade de veículos.
window.excluirVeiculo = async (id) => {
  if (!confirm("Deseja excluir este veiculo?")) return;

  await apiDelete(`/veiculos/${id}`);
  await renderizarVeiculos();
};

// =========================================================
// MODULO DE MOTORISTAS
//
// Gerencia o cadastro de motoristas e o processamento da folha
// de pagamento mensal com cálculo automático de INSS (progressivo),
// IRRF, vale refeição, adiantamento e outros descontos.
//
// Subseções deste módulo:
//   - CRUD de motoristas (renderizarMotoristas, abrirFormMotorista)
//   - Cálculo de folha (calcularLinhaFolha, atualizarTotaisFolha)
//   - Geração e impressão de recibo (renderizarReciboPagamento)
//   - Histórico de folhas salvas (renderizarHistoricoFolha)
//   - Modal de lançamento de folha (abrirTelaFolhaPagamento)
// =========================================================

// Busca a lista completa de motoristas da empresa no backend.
async function carregarMotoristas() {
  return apiGet("/motoristas");
}

// Carrega motoristas e renderiza a tabela com colunas de nome, cargo,
// salário base, telefone, CNH e botões de ação (Folha / Editar / Excluir).
async function renderizarMotoristas() {
  const container = document.getElementById("lista-motoristas");
  if (!container) return;

  const motoristas = await carregarMotoristas();

  if (!motoristas.length) {
    container.innerHTML = `<div class="panel-box"><p>Nenhum motorista cadastrado.</p></div>`;
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Nome</th>
          <th>Cargo</th>
          <th>Salario base</th>
          <th>Telefone</th>
          <th>CNH</th>
          <th>Acoes</th>
        </tr>
      </thead>

      <tbody>
        ${motoristas.map(m => `
          <tr>
            <td>${m.nome}</td>
            <td>${m.cargo || "-"}</td>
            <td>${formatarValor(m.salario_base || 0)}</td>
            <td>${m.telefone}</td>
            <td>${m.cnh}</td>
            <td>
              <div class="action-row">
                <button class="small-btn" onclick="abrirFolhaMotorista(${m.id})">Folha</button>
                <button class="small-btn edit-btn" onclick="editarMotoristaPorId(${m.id})">Editar</button>
                <button class="small-btn delete-btn" onclick="excluirMotorista(${m.id})">Excluir</button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// Injeta o formulário completo de motorista em #form-motorista-container.
// Cobre dados pessoais, CNH, salário base, carga horária, descontos padrão
// (INSS, IRRF, vale, convênio, outros) e dados bancários para holerite.
// Funciona para criação (editandoMotoristaId = null) e edição.
function abrirFormMotorista(dadosMotorista = {}) {
  const container = document.getElementById("form-motorista-container");
  if (!container) return;

  const titulo = editandoMotoristaId ? "Alterar motorista" : "Novo motorista";
  const textoBotao = editandoMotoristaId ? "Salvar alteracao" : "Salvar";
  const dados = dadosMotorista || {};

  container.innerHTML = `
    <div class="panel-box">
      <h3>${titulo}</h3>

      <div class="form-grid">
        <div class="field">
          <label>Nome</label>
          <input id="m-nome" value="${dados.nome || ""}" />
        </div>

        <div class="field">
          <label>Telefone</label>
          <input id="m-telefone" value="${dados.telefone || ""}" />
        </div>

        <div class="field">
          <label>CNH</label>
          <input id="m-cnh" value="${dados.cnh || ""}" />
        </div>

        <div class="field">
          <label>Cargo</label>
          <input id="m-cargo" value="${dados.cargo || ""}" />
        </div>

        <div class="field">
          <label>Admissao</label>
          <input id="m-admissao" type="date" value="${dados.admissao || ""}" />
        </div>

        <div class="field">
          <label>Lotacao</label>
          <input id="m-lotacao" value="${dados.lotacao || ""}" />
        </div>

        <div class="field">
          <label>Salario base</label>
          <input id="m-salario-base" type="number" min="0" step="0.01" value="${dados.salario_base || 0}" />
        </div>

        <div class="field">
          <label>Carga horaria mensal</label>
          <input id="m-carga-horaria" type="number" min="0" step="0.01" value="${dados.carga_horaria_mensal || 220}" />
        </div>

        <div class="field">
          <label>Valor hora extra</label>
          <input id="m-valor-hora-extra" type="number" min="0" step="0.01" value="${dados.valor_hora_extra || 0}" />
        </div>

        <div class="field">
          <label>IRRF %</label>
          <input id="m-irrf-percentual" type="number" min="0" step="0.01" value="${dados.irrf_percentual || 0}" />
        </div>

        <div class="field">
          <label>Vale refeicao</label>
          <input id="m-vale-refeicao" type="number" min="0" step="0.01" value="${dados.vale_refeicao || 0}" />
        </div>

        <div class="field">
          <label>Convenio medico</label>
          <input id="m-convenio-medico" type="number" min="0" step="0.01" value="${dados.convenio_medico || 0}" />
        </div>

        <div class="field">
          <label>Outros descontos padrao</label>
          <input id="m-outros-descontos-padrao" type="number" min="0" step="0.01" value="${dados.outros_descontos_padrao || 0}" />
        </div>

        <div class="field">
          <label>PIS</label>
          <input id="m-pis" value="${dados.pis || ""}" />
        </div>

        <div class="field">
          <label>Banco</label>
          <input id="m-banco" value="${dados.banco || ""}" />
        </div>

        <div class="field">
          <label>Agencia</label>
          <input id="m-agencia" value="${dados.agencia || ""}" />
        </div>

        <div class="field">
          <label>Conta</label>
          <input id="m-conta" value="${dados.conta || ""}" />
        </div>

        <div class="field">
          <label>Tipo de conta</label>
          <input id="m-tipo-conta" value="${dados.tipo_conta || ""}" />
        </div>

        <div class="field">
          <label>Empregador</label>
          <input id="m-empregador" value="${dados.empregador || "ADELIA TRANSPORTES"}" />
        </div>

        <div class="field">
          <label>CNPJ do empregador</label>
          <input id="m-empregador-cnpj" value="${dados.empregador_cnpj || ""}" />
        </div>

        <div class="field full btn-row">
          <button class="primary-btn" id="salvar-motorista">${textoBotao}</button>
          <button class="ghost-btn" id="cancelar-motorista">Cancelar</button>
        </div>
      </div>

      <p id="mensagem-motorista" class="mensagem"></p>
    </div>
  `;

  document.getElementById("salvar-motorista").onclick = async () => {
    const mensagem = document.getElementById("mensagem-motorista");
    const payload = {
      nome: document.getElementById("m-nome").value,
      telefone: document.getElementById("m-telefone").value,
      cnh: document.getElementById("m-cnh").value,
      cargo: document.getElementById("m-cargo").value,
      admissao: document.getElementById("m-admissao").value || null,
      lotacao: document.getElementById("m-lotacao").value,
      salario_base: normalizarNumero(document.getElementById("m-salario-base").value),
      carga_horaria_mensal: normalizarNumero(document.getElementById("m-carga-horaria").value) || 220,
      valor_hora_extra: normalizarNumero(document.getElementById("m-valor-hora-extra").value),
      inss_percentual: 0,
      irrf_percentual: normalizarNumero(document.getElementById("m-irrf-percentual").value),
      vale_refeicao: normalizarNumero(document.getElementById("m-vale-refeicao").value),
      convenio_medico: normalizarNumero(document.getElementById("m-convenio-medico").value),
      outros_descontos_padrao: normalizarNumero(document.getElementById("m-outros-descontos-padrao").value),
      pis: document.getElementById("m-pis").value,
      banco: document.getElementById("m-banco").value,
      agencia: document.getElementById("m-agencia").value,
      conta: document.getElementById("m-conta").value,
      tipo_conta: document.getElementById("m-tipo-conta").value,
      empregador: document.getElementById("m-empregador").value,
      empregador_cnpj: document.getElementById("m-empregador-cnpj").value
    };

    const url = editandoMotoristaId ? `/motoristas/${editandoMotoristaId}` : "/motoristas";
    const method = editandoMotoristaId ? "PUT" : "POST";

    try {
      await apiSend(url, method, payload);
      editandoMotoristaId = null;
      container.innerHTML = "";
      mostrarToast("Motorista salvo com sucesso.", "success");
      await renderizarMotoristas();
    } catch (erro) {
      mensagem.textContent = erro.message;
      mostrarToast(erro.message, "error");
    }
  };

  document.getElementById("cancelar-motorista").onclick = () => {
    editandoMotoristaId = null;
    container.innerHTML = "";
  };
}

window.editarMotoristaPorId = async (id) => {
  const motoristas = await carregarMotoristas();
  const motorista = motoristas.find(item => item.id === id);
  if (!motorista) return;

  editandoMotoristaId = id;

  abrirFormMotorista(motorista);
};

window.excluirMotorista = async (id) => {
  if (!confirm("Deseja excluir este motorista?")) return;

  await apiDelete(`/motoristas/${id}`);
  await renderizarMotoristas();
};

// Busca o histórico completo de folhas de pagamento salvas no backend.
async function carregarFolhasPagamento() {
  return apiGet("/folha-pagamento");
}

// Escapa caracteres HTML especiais para evitar XSS ao inserir dados
// do usuário/backend diretamente em innerHTML.
// Deve ser usada em TODOS os dados de texto não controlados exibidos via innerHTML.
function escapeHtml(texto) {
  return String(texto ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Calcula todos os valores da linha de um motorista na folha de pagamento.
// Lê os inputs do card do motorista (seletor via closest/querySelector),
// aplica a lógica de INSS progressivo (calcularInssAutomatico), e
// atualiza os campos de exibição (salário base, bruto, descontos, líquido).
// Retorna um objeto com todos os valores calculados para uso posterior.
// Chamada por atualizarTotaisFolha() e gerarDadosItemFolha().
function calcularLinhaFolha(row) {
  const horasNormais = normalizarNumero(row.querySelector(".folha-horas-normais")?.value);
  const horasExtras = normalizarNumero(row.querySelector(".folha-horas-extras")?.value);
  const valorHoraExtra = normalizarNumero(row.querySelector(".folha-valor-hora-extra")?.value);
  const adicionalNoturno = normalizarNumero(row.querySelector(".folha-adicional-noturno")?.value);
  const bonus = normalizarNumero(row.querySelector(".folha-bonus")?.value);
  const descontoIrrf = normalizarNumero(row.querySelector(".folha-desconto-irrf")?.value);
  const descontoVale = normalizarNumero(row.querySelector(".folha-desconto-vale")?.value);
  const descontoAdiantamento = normalizarNumero(row.querySelector(".folha-desconto-adiantamento")?.value);
  const outrosDescontos = normalizarNumero(row.querySelector(".folha-outros-descontos")?.value);
  const salarioContratual = normalizarNumero(row.dataset.salarioContratual);
  const aplicarInss = row.querySelector(".folha-aplicar-inss")?.value !== "nao";
  const salarioBase = horasNormais > 0 ? salarioContratual : 0;
  const valorExtras = horasExtras * valorHoraExtra;
  const totalAdicionais = Math.max(adicionalNoturno, 0) + Math.max(bonus, 0);
  const salarioBruto = Math.max(salarioBase + valorExtras + totalAdicionais, 0);
  const campoInss = row.querySelector(".folha-desconto-inss");
  const inssAutomatico = calcularInssAutomatico(salarioBruto);
  const descontoInss = !aplicarInss
    ? 0
    : campoInss?.dataset.manual === "true"
    ? normalizarNumero(campoInss.value)
    : inssAutomatico;
  const fgts = Math.round(salarioBruto * 0.08 * 100) / 100;
  const totalDescontos = descontoInss + descontoIrrf + descontoVale + descontoAdiantamento + outrosDescontos;
  const salarioLiquido = Math.max(salarioBruto - totalDescontos, 0);

  if (campoInss && campoInss.dataset.manual !== "true") {
    campoInss.value = descontoInss.toFixed(2);
  }
  if (campoInss) {
    campoInss.disabled = !aplicarInss;
  }

  row.querySelector(".folha-salario-base").textContent = formatarValor(salarioBase);
  row.querySelector(".folha-salario-bruto").textContent = formatarValor(salarioBruto);
  row.querySelector(".folha-total-descontos").textContent = formatarValor(totalDescontos);
  row.querySelector(".folha-salario-liquido").textContent = formatarValor(salarioLiquido);

  return { salarioBase, valorExtras, adicionalNoturno, bonus, totalAdicionais, salarioBruto, descontoInss, fgts, totalDescontos, salarioLiquido, aplicarInss };
}

// Soma os valores calculados de todas as linhas da folha e exibe os totais
// nos cards KPI do modal (total base, extras, bruto, descontos, líquido).
// Chamada a cada input do usuário nos campos da folha (listener em todos os inputs).
function atualizarTotaisFolha() {
  const totais = Array.from(document.querySelectorAll("[data-folha-motorista-id]"))
    .map(calcularLinhaFolha)
    .reduce((acc, item) => ({
      salarioBase: acc.salarioBase + item.salarioBase,
      valorExtras: acc.valorExtras + item.valorExtras,
      totalAdicionais: acc.totalAdicionais + item.totalAdicionais,
      salarioBruto: acc.salarioBruto + item.salarioBruto,
      totalDescontos: acc.totalDescontos + item.totalDescontos,
      salarioLiquido: acc.salarioLiquido + item.salarioLiquido
    }), {
      salarioBase: 0,
      valorExtras: 0,
      totalAdicionais: 0,
      salarioBruto: 0,
      totalDescontos: 0,
      salarioLiquido: 0
    });

  document.getElementById("folha-total-base").textContent = formatarValor(totais.salarioBase);
  document.getElementById("folha-total-extras").textContent = formatarValor(totais.valorExtras);
  document.getElementById("folha-total-bruto").textContent = formatarValor(totais.salarioBruto);
  document.getElementById("folha-total-descontos-geral").textContent = formatarValor(totais.totalDescontos);
  document.getElementById("folha-total-liquido").textContent = formatarValor(totais.salarioLiquido);
}

// Carrega e exibe o histórico de folhas salvas em tabela.
// Suporta filtro por período (filtroPeriodoFolha, campo type="month").
// Botões: Imprimir (abre o recibo para o primeiro motorista) e Excluir.
async function renderizarHistoricoFolha() {
  const container = document.getElementById("historico-folha-container");
  if (!container) return;

  const folhas = await carregarFolhasPagamento();
  const folhasFiltradas = filtroPeriodoFolha
    ? folhas.filter((folha) => folha.periodo === filtroPeriodoFolha)
    : folhas;

  if (!folhas.length) {
    container.innerHTML = `
      <section class="panel-box">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">Historico de folhas</h3>
            <span>Nenhuma folha gerada.</span>
          </div>
        </div>
      </section>
    `;
    return;
  }

  container.innerHTML = `
    <section class="panel-box">
      <div class="table-toolbar">
        <div>
          <h3 style="margin:0;">Historico de folhas</h3>
          <span>${folhasFiltradas.length} de ${folhas.length} folha(s)</span>
        </div>
        <div class="action-row">
          <input id="filtro-periodo-folha" type="month" value="${filtroPeriodoFolha}" />
          <button class="ghost-btn" id="btn-limpar-filtro-folha" type="button">Limpar</button>
        </div>
      </div>
      ${folhasFiltradas.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Pagamento</th>
                <th>Motoristas</th>
                <th>Bruto</th>
                <th>Descontos</th>
                <th>Liquido</th>
                <th>Lancamento</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              ${folhasFiltradas.map((folha) => `
                <tr>
                  <td>${folha.periodo}</td>
                  <td>${formatarDataCurta(folha.data_pagamento)}</td>
                  <td>${(folha.itens || []).length}</td>
                  <td>${formatarValor(folha.totais?.salario_bruto || 0)}</td>
                  <td>${formatarValor(folha.totais?.total_descontos || 0)}</td>
                  <td class="positive">${formatarValor(folha.totais?.salario_liquido || 0)}</td>
                  <td>${folha.lancamento_id ? `#${folha.lancamento_id}` : "-"}</td>
                  <td>
                    <div class="action-row">
                      <button class="small-btn" onclick="imprimirFolhaSalva(${folha.id})">Imprimir</button>
                      <button class="small-btn delete-btn" onclick="excluirFolhaPagamento(${folha.id})">Excluir</button>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : `<p class="empty-row">Nenhuma folha encontrada para este periodo.</p>`}
    </section>
  `;

  document.getElementById("filtro-periodo-folha").onchange = async (event) => {
    filtroPeriodoFolha = event.target.value;
    await renderizarHistoricoFolha();
  };

  document.getElementById("btn-limpar-filtro-folha").onclick = async () => {
    filtroPeriodoFolha = "";
    await renderizarHistoricoFolha();
  };
}

// Coleta todos os campos de entrada de uma linha da folha e monta o objeto
// que será enviado ao backend (POST /folha-pagamento, campo "itens").
// Reutiliza calcularLinhaFolha() para obter os valores calculados (INSS, FGTS, etc.).
function gerarDadosItemFolha(row) {
  const calculo = calcularLinhaFolha(row);
  return {
    motorista_id: Number(row.dataset.folhaMotoristaId),
    horas_normais: normalizarNumero(row.querySelector(".folha-horas-normais").value),
    valor_hora: 0,
    horas_extras: normalizarNumero(row.querySelector(".folha-horas-extras").value),
    valor_hora_extra: normalizarNumero(row.querySelector(".folha-valor-hora-extra").value),
    adicional_noturno: normalizarNumero(row.querySelector(".folha-adicional-noturno").value),
    adicional_descricao: row.querySelector(".folha-adicional-descricao")?.value.trim() || "",
    bonus: normalizarNumero(row.querySelector(".folha-bonus").value),
    bonus_descricao: row.querySelector(".folha-bonus-descricao")?.value.trim() || "",
    aplicar_inss: row.querySelector(".folha-aplicar-inss")?.value !== "nao",
    desconto_inss_manual: row.querySelector(".folha-desconto-inss")?.dataset.manual === "true",
    desconto_inss: calculo.descontoInss,
    desconto_irrf: normalizarNumero(row.querySelector(".folha-desconto-irrf")?.value),
    desconto_vale: normalizarNumero(row.querySelector(".folha-desconto-vale").value),
    desconto_adiantamento: normalizarNumero(row.querySelector(".folha-desconto-adiantamento").value),
    outros_descontos: normalizarNumero(row.querySelector(".folha-outros-descontos").value),
    outros_descontos_descricao: row.querySelector(".folha-outros-descricao")?.value.trim() || "",
    salario_contratual: normalizarNumero(row.dataset.salarioContratual),
    base_inss: calculo.salarioBruto,
    base_fgts: calculo.salarioBruto,
    fgts: calculo.fgts,
    base_irrf: Math.max(calculo.salarioBruto - calculo.descontoInss, 0),
    observacao: row.querySelector(".folha-observacao")?.value.trim() || ""
  };
}

// Lê os checkboxes de "Dados exibidos no recibo" e retorna um objeto
// com flags booleanas para cada seção do holerite (salário base, extras,
// INSS, IRRF, vale, etc.). Enviado ao backend junto com a folha para
// ser salvo e reutilizado na impressão futura.
function obterOpcoesReciboFolha() {
  return {
    salario_base: document.getElementById("folha-mostrar-salario-base")?.checked !== false,
    horas_extras: document.getElementById("folha-mostrar-horas-extras")?.checked !== false,
    adicionais: document.getElementById("folha-mostrar-adicionais")?.checked !== false,
    bonus: document.getElementById("folha-mostrar-bonus")?.checked !== false,
    inss: document.getElementById("folha-mostrar-inss")?.checked !== false,
    irrf: document.getElementById("folha-mostrar-irrf")?.checked !== false,
    vale: document.getElementById("folha-mostrar-vale")?.checked !== false,
    adiantamento: document.getElementById("folha-mostrar-adiantamento")?.checked !== false,
    outros: document.getElementById("folha-mostrar-outros")?.checked !== false,
    bases: document.getElementById("folha-mostrar-bases")?.checked !== false
  };
}

// Gera o HTML completo do recibo de pagamento de salário (holerite) para impressão.
// Produz DUAS vias (empregador e empregado) em uma única página A4 horizontal.
// A estrutura usa table para garantir alinhamento fiel ao modelo físico do holerite.
// As seções (proventos, descontos, bases) são filtradas pelas opcoes_recibo da folha.
// Chamada por imprimirReciboFolha() após recuperar os dados do motorista.
function renderizarReciboPagamento(folha, item, motorista) {
  const opcoes = {
    salario_base: true,
    horas_extras: true,
    adicionais: true,
    bonus: true,
    inss: true,
    irrf: true,
    vale: true,
    adiantamento: true,
    outros: true,
    bases: true,
    ...(folha.opcoes_recibo || {})
  };
  const percentualEfetivoInss = item.base_inss > 0 ? ((item.desconto_inss || 0) / item.base_inss) * 100 : 0;
  const competencia = folha.periodo ? folha.periodo.split("-").reverse().join("/") : "";
  const codigoFuncionario = String(item.motorista_id || motorista.id || "").padStart(5, "0");
  const formatarValorRecibo = (valor) => normalizarNumero(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const proventos = [
    opcoes.salario_base ? { codigo: "011", descricao: "Salario-Base", referencia: `${item.horas_normais || 0} h`, valor: item.salario_base || 0 } : null,
    opcoes.horas_extras ? { codigo: "012", descricao: "Horas extras", referencia: `${item.horas_extras || 0} h`, valor: item.valor_extras || 0 } : null,
    opcoes.adicionais ? { codigo: "013", descricao: item.adicional_descricao || "Adicionais", referencia: "", valor: item.adicional_noturno || 0 } : null,
    opcoes.bonus ? { codigo: "014", descricao: item.bonus_descricao || "Bonus", referencia: "", valor: item.bonus || 0 } : null,
  ].filter((linha) => linha && linha.valor > 0);

  const descontos = [
    opcoes.inss ? { codigo: "310", descricao: "INSS", referencia: percentualEfetivoInss ? `${percentualEfetivoInss.toFixed(2)}% efetivo` : "Automatico", valor: item.desconto_inss || 0 } : null,
    opcoes.irrf ? { codigo: "311", descricao: "IRRF", referencia: `${motorista.irrf_percentual || 0}%`, valor: item.desconto_irrf || 0 } : null,
    opcoes.vale ? { codigo: "914", descricao: "Vale Refeicao", referencia: "", valor: item.desconto_vale || 0 } : null,
    opcoes.adiantamento ? { codigo: "915", descricao: "Adiantamento", referencia: "", valor: item.desconto_adiantamento || 0 } : null,
    opcoes.outros ? { codigo: "924", descricao: item.outros_descontos_descricao || "Convenio medico / outros", referencia: "", valor: item.outros_descontos || 0 } : null,
  ].filter((linha) => linha && linha.valor > 0);

  const linhas = [...proventos.map((linha) => ({ ...linha, tipo: "provento" })), ...descontos.map((linha) => ({ ...linha, tipo: "desconto" }))];
  const linhasRecibo = [...linhas, ...Array.from({ length: Math.max(0, 8 - linhas.length) }).map(() => null)];
  const renderizarVia = (via, titulo) => `
    <section class="salary-slip-copy">
      <table class="salary-slip-table">
        <colgroup>${Array.from({ length: 14 }).map(() => "<col>").join("")}</colgroup>
        <tbody>
          <tr class="slip-declaration">
            <td class="slip-gap" colspan="11"></td>
            <td colspan="3">DECLARO TER RECEBIDO A IMPORTÂNCIA LÍQUIDA DISCRIMINADA NESTE RECIBO.</td>
          </tr>
          <tr>
            <td class="slip-gap"></td>
            <td colspan="6" class="slip-label">EMPREGADOR</td>
            <td colspan="3" class="slip-title">${titulo}</td>
            <td class="slip-gap"></td>
            <td></td>
            <td></td>
            <td rowspan="3" class="slip-signature">ASSINATURA DO FUNCIONÁRIO</td>
          </tr>
          <tr>
            <td class="slip-gap"></td>
            <td class="slip-label">Nome</td>
            <td colspan="6">${motorista.empregador || "ADELIA TRANSPORTES"}</td>
            <td class="slip-gap"></td>
            <td colspan="2" class="slip-label">Referente ao Mês / Ano</td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td class="slip-gap"></td>
            <td class="slip-label">Endereço</td>
            <td colspan="6">${motorista.empregador_endereco || ""}</td>
            <td class="slip-gap"></td>
            <td colspan="2">${competencia}</td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td class="slip-gap"></td>
            <td class="slip-label">CNPJ</td>
            <td colspan="6">${motorista.empregador_cnpj || ""}</td>
            <td colspan="2"></td>
            <td class="slip-gap"></td>
            <td colspan="3"></td>
          </tr>
          <tr class="slip-spacer"><td class="slip-gap" colspan="11"></td><td colspan="3"></td></tr>
          <tr class="slip-employee-head">
            <td class="slip-gap"></td>
            <td>CODIGO</td>
            <td colspan="5">NOME DO FUNCIONÁRIO</td>
            <td>CBO</td>
            <td colspan="2">FUNÇÃO</td>
            <td class="slip-gap"></td>
            <td colspan="3"></td>
          </tr>
          <tr>
            <td class="slip-gap"></td>
            <td>${codigoFuncionario}</td>
            <td colspan="5">${item.motorista_nome || motorista.nome || ""}</td>
            <td>${motorista.cbo || ""}</td>
            <td colspan="2">${motorista.cargo || ""}</td>
            <td class="slip-gap"></td>
            <td colspan="3"></td>
          </tr>
          <tr class="slip-spacer"><td class="slip-gap" colspan="11"></td><td colspan="3"></td></tr>
          <tr class="slip-items-head">
            <td class="slip-gap"></td>
            <td>Cod.</td>
            <td colspan="5">Descrição</td>
            <td>Referência</td>
            <td>Proventos</td>
            <td>Descontos</td>
            <td class="slip-gap"></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          ${linhasRecibo.map((linha) => `
            <tr class="slip-item-row">
              <td class="slip-gap"></td>
              <td>${linha?.codigo || ""}</td>
              <td colspan="5">${linha?.descricao || ""}</td>
              <td class="slip-right">${linha?.referencia || ""}</td>
              <td class="slip-money">${linha?.tipo === "provento" ? formatarValorRecibo(linha.valor) : ""}</td>
              <td class="slip-money">${linha?.tipo === "desconto" ? formatarValorRecibo(linha.valor) : ""}</td>
              <td class="slip-gap"></td>
              <td></td>
              <td></td>
              <td></td>
            </tr>
          `).join("")}
          <tr class="slip-date-row">
            <td class="slip-gap" colspan="13"></td>
            <td>DATA</td>
          </tr>
          <tr>
            <td class="slip-gap" colspan="12"></td>
            <td>/</td>
            <td></td>
          </tr>
          <tr class="slip-total-labels">
            <td class="slip-gap"></td>
            <td colspan="7">MENSAGENS</td>
            <td>Total dos Vencimentos</td>
            <td>Total dos Descontos</td>
            <td class="slip-gap"></td>
            <td colspan="3"></td>
          </tr>
          <tr>
            <td class="slip-gap"></td>
            <td colspan="7">${item.observacao || ""}</td>
            <td class="slip-money">${formatarValorRecibo(item.salario_bruto || 0)}</td>
            <td class="slip-money">${formatarValorRecibo(item.total_descontos || 0)}</td>
            <td class="slip-gap"></td>
            <td colspan="3"></td>
          </tr>
          <tr class="slip-net-row">
            <td class="slip-gap"></td>
            <td colspan="7"></td>
            <td>Líquido a Receber-&gt;</td>
            <td class="slip-money">${formatarValorRecibo(item.salario_liquido || 0)}</td>
            <td class="slip-gap" colspan="2"></td>
            <td>/</td>
            <td></td>
          </tr>
          <tr class="slip-spacer"><td class="slip-gap" colspan="11"></td><td colspan="3"></td></tr>
          ${opcoes.bases ? `<tr class="slip-bases-head">
            <td class="slip-gap"></td>
            <td colspan="2">Salário Base</td>
            <td>Base Cálc. INSS</td>
            <td colspan="2">Base Cálc.FGTS</td>
            <td colspan="2">FGTS do Mês</td>
            <td>Base Cálc. IRRF</td>
            <td>Faixa IRRF</td>
            <td class="slip-gap"></td>
            <td colspan="3"></td>
          </tr>
          <tr>
            <td class="slip-gap"></td>
            <td colspan="2" class="slip-money">${formatarValorRecibo(item.salario_contratual || motorista.salario_base || 0)}</td>
            <td class="slip-money">${formatarValorRecibo(item.base_inss || 0)}</td>
            <td colspan="2" class="slip-money">${formatarValorRecibo(item.base_fgts || 0)}</td>
            <td colspan="2" class="slip-money">${formatarValorRecibo(item.fgts || 0)}</td>
            <td class="slip-money">${formatarValorRecibo(item.base_irrf || 0)}</td>
            <td>${motorista.irrf_percentual || 0}%</td>
            <td class="slip-gap"></td>
            <td colspan="3"></td>
          </tr>` : ""}
          <tr class="slip-copy-label">
            <td class="slip-gap"></td>
            <td colspan="13">${via}</td>
          </tr>
        </tbody>
      </table>
    </section>
  `;

  return `
    <section id="recibo-folha-print" class="payroll-receipt print-area">
      ${renderizarVia("1ª VIA - EMPREGADOR", "Recibo de Pagamento de Salário")}
      ${renderizarVia("2ª VIA - EMPREGADO", "Demonstrativo de Pagamento de Salário")}
    </section>
  `;
}

// Busca os dados do motorista, gera o HTML do recibo e dispara window.print().
// O recibo é injetado em #recibo-folha-container (criado dinamicamente se necessário).
// A impressão inclui apenas o elemento com classe .print-area via CSS de mídia.
async function imprimirReciboFolha(folha, item) {
  const motoristas = await carregarMotoristas();
  const motorista = motoristas.find((registro) => registro.id === item.motorista_id) || {};
  const container = document.getElementById("recibo-folha-container") || document.body.appendChild(document.createElement("div"));
  container.id = "recibo-folha-container";
  container.innerHTML = renderizarReciboPagamento(folha, item, motorista);
  window.print();
}

window.imprimirFolhaSalva = async (folhaId) => {
  const folhas = await carregarFolhasPagamento();
  const folha = folhas.find((item) => item.id === folhaId);
  if (!folha || !(folha.itens || []).length) return;
  await imprimirReciboFolha(folha, folha.itens[0]);
};

window.excluirFolhaPagamento = async (folhaId) => {
  if (!confirm("Deseja excluir esta folha de pagamento? O lancamento financeiro vinculado tambem sera removido.")) return;

  try {
    await apiDelete(`/folha-pagamento/${folhaId}`);
    mostrarToast("Folha excluida com sucesso.", "success");
    await renderizarHistoricoFolha();
  } catch (erro) {
    mostrarToast(erro.message, "error");
  }
};

window.abrirFolhaMotorista = async (motoristaId) => {
  await abrirTelaFolhaPagamento(motoristaId);
};

// Abre o modal de lançamento de folha de pagamento.
// Se motoristaId for fornecido, exibe apenas aquele motorista (modo individual).
// Se null, exibe todos os motoristas cadastrados (modo geral).
// Pré-preenche os campos com os valores padrão de cada motorista (salário,
// carga horária, hora extra, descontos padrão) calculados dinamicamente.
// O botão "Gerar folha" valida os dados, chama POST /folha-pagamento e
// imprime o recibo automaticamente se houver apenas 1 motorista na folha.
async function abrirTelaFolhaPagamento(motoristaId = null) {
  const container = document.getElementById("folha-pagamento-container");
  if (!container) return;

  const todosMotoristas = await carregarMotoristas();
  const motoristas = motoristaId
    ? todosMotoristas.filter((motorista) => motorista.id === motoristaId)
    : todosMotoristas;

  if (!motoristas.length) {
    container.innerHTML = `<div class="panel-box"><p>Nenhum motorista cadastrado para gerar folha.</p></div>`;
    return;
  }

  const hoje = new Date();
  const periodo = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const dataPagamento = hoje.toISOString().slice(0, 10);

  container.innerHTML = `
    <div class="modal-overlay payroll-modal-overlay" id="modal-folha-pagamento">
      <section class="modal-content modal-xl payroll-modal-content">
      <div class="table-toolbar">
        <div>
          <h3 style="margin:0;">Lancamento de folha de pagamento</h3>
          <span>Informe horas, adicionais e descontos para calcular o salario de cada motorista.</span>
        </div>
        <button class="ghost-btn" id="btn-fechar-folha" type="button">Fechar</button>
      </div>

      <div class="form-grid" style="margin-bottom:18px;">
        <div class="field">
          <label>Periodo</label>
          <input id="folha-periodo" type="month" value="${periodo}" />
        </div>
        <div class="field">
          <label>Data de pagamento</label>
          <input id="folha-data-pagamento" type="date" value="${dataPagamento}" />
        </div>
        <div class="field full">
          <label>Descricao</label>
          <input id="folha-descricao" value="Folha de pagamento" />
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom:18px;">
        <div class="kpi-card"><div class="kpi-label">Salario base</div><div class="kpi-value" id="folha-total-base">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Horas extras</div><div class="kpi-value" id="folha-total-extras">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Bruto</div><div class="kpi-value" id="folha-total-bruto">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Descontos</div><div class="kpi-value negative" id="folha-total-descontos-geral">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Liquido</div><div class="kpi-value positive" id="folha-total-liquido">R$ 0,00</div></div>
      </div>

      <div class="payroll-driver-list">
        ${motoristas.map((motorista) => {
          const salarioBase = normalizarNumero(motorista.salario_base);
          const cargaHoraria = normalizarNumero(motorista.carga_horaria_mensal) || 220;
          const valorHoraExtra = normalizarNumero(motorista.valor_hora_extra);
          const descontoInss = calcularInssAutomatico(salarioBase);
          const baseIrrf = Math.max(salarioBase - descontoInss, 0);
          const descontoIrrf = baseIrrf * (normalizarNumero(motorista.irrf_percentual) / 100);
          const vale = normalizarNumero(motorista.vale_refeicao);
          const convenio = normalizarNumero(motorista.convenio_medico);
          const outros = normalizarNumero(motorista.outros_descontos_padrao) + convenio;
          return `
            <article class="payroll-driver-card" data-folha-motorista-id="${motorista.id}" data-salario-contratual="${salarioBase}">
              <div class="payroll-driver-head">
                <div>
                  <h4>${motorista.nome}</h4>
                  <span>${motorista.cargo || "Motorista"}</span>
                </div>
                <strong>${formatarValor(salarioBase)}</strong>
              </div>

              <div class="payroll-field-grid">
                <label>Horas normais<input class="folha-horas-normais" type="number" min="0" step="0.01" value="${cargaHoraria}" /></label>
                <label>Horas extras<input class="folha-horas-extras" type="number" min="0" step="0.01" value="0" /></label>
                <label>Valor hora extra<input class="folha-valor-hora-extra" type="number" min="0" step="0.01" value="${valorHoraExtra.toFixed(2)}" /></label>
                <label>Adicional<input class="folha-adicional-noturno" type="number" min="0" step="0.01" value="0" /></label>
                <label class="payroll-description-field">Descricao adicional<input class="folha-adicional-descricao" value="" placeholder="Descricao do adicional" /></label>
                <label>Bonus<input class="folha-bonus" type="number" min="0" step="0.01" value="0" /></label>
                <label class="payroll-description-field">Descricao bonus<input class="folha-bonus-descricao" value="" placeholder="Descricao do bonus" /></label>
                <label>Descontar INSS<select class="folha-aplicar-inss"><option value="sim" selected>Sim</option><option value="nao">Nao</option></select></label>
                <label>INSS<input class="folha-desconto-inss" type="number" min="0" step="0.01" value="${descontoInss.toFixed(2)}" data-manual="false" /></label>
                <label>IRRF<input class="folha-desconto-irrf" type="number" min="0" step="0.01" value="${descontoIrrf.toFixed(2)}" /></label>
                <label>Vale<input class="folha-desconto-vale" type="number" min="0" step="0.01" value="${vale.toFixed(2)}" /></label>
                <label>Adiantamento<input class="folha-desconto-adiantamento" type="number" min="0" step="0.01" value="0" /></label>
                <label>Outros descontos<input class="folha-outros-descontos" type="number" min="0" step="0.01" value="${outros.toFixed(2)}" /></label>
                <label class="payroll-description-field">Descricao outros descontos<input class="folha-outros-descricao" value="" placeholder="Descricao dos outros descontos" /></label>
                <label class="payroll-description-field">Observacoes<input class="folha-observacao" value="" placeholder="Observacoes da folha" /></label>
              </div>

              <div class="payroll-result-grid">
                <div><span>Base</span><strong class="folha-salario-base">R$ 0,00</strong></div>
                <div><span>Bruto</span><strong class="folha-salario-bruto">R$ 0,00</strong></div>
                <div><span>Descontos</span><strong class="folha-total-descontos">R$ 0,00</strong></div>
                <div><span>Liquido</span><strong class="folha-salario-liquido positive">R$ 0,00</strong></div>
              </div>
            </article>
          `;
        }).join("")}
      </div>

      <section class="panel-box payroll-receipt-options">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">Dados exibidos no recibo</h3>
            <span>Marque o que deve aparecer na impressao da folha</span>
          </div>
        </div>
        <div class="payroll-options-grid">
          <label><input id="folha-mostrar-salario-base" type="checkbox" checked /><span>Salario base</span></label>
          <label><input id="folha-mostrar-horas-extras" type="checkbox" checked /><span>Horas extras</span></label>
          <label><input id="folha-mostrar-adicionais" type="checkbox" checked /><span>Adicionais</span></label>
          <label><input id="folha-mostrar-bonus" type="checkbox" checked /><span>Bonus</span></label>
          <label><input id="folha-mostrar-inss" type="checkbox" checked /><span>INSS</span></label>
          <label><input id="folha-mostrar-irrf" type="checkbox" checked /><span>IRRF</span></label>
          <label><input id="folha-mostrar-vale" type="checkbox" checked /><span>Vale</span></label>
          <label><input id="folha-mostrar-adiantamento" type="checkbox" checked /><span>Adiantamento</span></label>
          <label><input id="folha-mostrar-outros" type="checkbox" checked /><span>Outros descontos</span></label>
          <label><input id="folha-mostrar-bases" type="checkbox" checked /><span>Bases INSS/FGTS/IRRF</span></label>
        </div>
      </section>

      <div class="btn-row" style="margin-top:18px;">
        <button class="primary-btn" id="btn-salvar-folha" type="button">Gerar folha e lancamento</button>
        <button class="ghost-btn" id="btn-recalcular-folha" type="button">Recalcular</button>
      </div>
      <p id="mensagem-folha" class="mensagem"></p>
      </section>
    </div>
  `;

  container.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", atualizarTotaisFolha);
  });
  container.querySelectorAll(".folha-desconto-inss").forEach((input) => {
    input.addEventListener("input", () => {
      input.dataset.manual = "true";
      atualizarTotaisFolha();
    });
  });
  container.querySelectorAll(".folha-aplicar-inss").forEach((select) => {
    select.addEventListener("change", () => {
      const input = select.closest("[data-folha-motorista-id]")?.querySelector(".folha-desconto-inss");
      if (input && select.value === "sim") {
        input.dataset.manual = "false";
      }
      atualizarTotaisFolha();
    });
  });

  document.getElementById("btn-fechar-folha").onclick = () => {
    container.innerHTML = "";
  };

  document.getElementById("modal-folha-pagamento").addEventListener("click", (event) => {
    if (event.target.id === "modal-folha-pagamento") {
      container.innerHTML = "";
    }
  });

  document.getElementById("btn-recalcular-folha").onclick = atualizarTotaisFolha;

  document.getElementById("btn-salvar-folha").onclick = async () => {
    const mensagem = document.getElementById("mensagem-folha");
    const itens = Array.from(document.querySelectorAll("[data-folha-motorista-id]")).map(gerarDadosItemFolha).filter((item) => (
      item.horas_normais > 0 ||
      item.horas_extras > 0 ||
      item.bonus > 0 ||
      item.adicional_noturno > 0 ||
      item.desconto_inss > 0 ||
      item.desconto_irrf > 0 ||
      item.desconto_vale > 0 ||
      item.desconto_adiantamento > 0 ||
      item.outros_descontos > 0
    ));

    if (!itens.length) {
      mensagem.textContent = "Preencha ao menos uma linha da folha.";
      return;
    }

    try {
      const folha = await apiSend("/folha-pagamento", "POST", {
        periodo: document.getElementById("folha-periodo").value,
        data_pagamento: document.getElementById("folha-data-pagamento").value,
        descricao: document.getElementById("folha-descricao").value,
        gerar_lancamento: true,
        opcoes_recibo: obterOpcoesReciboFolha(),
        itens
      });
      mensagem.textContent = `Folha gerada com liquido de ${formatarValor(folha.totais.salario_liquido)}.`;
      mostrarToast("Folha de pagamento gerada.", "success");
      await renderizarHistoricoFolha();
      container.innerHTML = "";
      if (folha.itens?.length === 1) {
        await imprimirReciboFolha(folha, folha.itens[0]);
      }
    } catch (erro) {
      mensagem.textContent = erro.message;
      mostrarToast(erro.message, "error");
    }
  };

  atualizarTotaisFolha();
}

// =========================================================
// MODULO DE PLANO DE CONTAS
//
// Gerencia as classificações financeiras usadas nos lançamentos.
// Duas listas coexistem na tela:
//   1. Plano base (somente leitura): grupos e subclasses pré-definidos
//      pelo sistema (/plano-contas/estrutura). Exibido em cards.
//   2. Classificações personalizadas: criadas pela empresa via formulário.
//      Aparecem na tabela editável e nos selects de classificação.
//
// Apenas subclasses (não grupos) entram nos selects de lançamentos.
// =========================================================

// Busca as classificações personalizadas (criadas pela empresa) no backend.
async function carregarPlanoContas() {
  return apiGet("/plano-contas");
}

// Busca a estrutura hierárquica do plano base (grupos + itens pré-definidos).
async function carregarEstruturaPlanoContas() {
  return apiGet("/plano-contas/estrutura");
}

// Renderiza grupos do plano de contas mesclando itens base e personalizados.
// Itens base aparecem como chips somente-leitura.
// Itens personalizados aparecem com botões Editar/Excluir dentro do mesmo grupo.
async function renderizarEstruturaPlanoContas() {
  const container = document.getElementById("estrutura-plano-contas");
  if (!container) return;

  const [estrutura, personalizados] = await Promise.all([
    carregarEstruturaPlanoContas(),
    carregarPlanoContas(),
  ]);
  const grupos = estrutura.grupos || [];

  if (!grupos.length) {
    container.innerHTML = `<p class="empty-row">Nenhum grupo do plano base encontrado.</p>`;
    return;
  }

  container.innerHTML = grupos.map((grupo) => {
    const itensBase = grupo.itens || [];
    // Personalizados cujo nome começa com o código do grupo (ex: "1." → grupo 1)
    const itensCustom = personalizados.filter(p =>
      p.nome.startsWith(grupo.codigo + ".")
    );
    const total = itensBase.length + itensCustom.length;

    return `
    <article class="account-group">
      <div class="account-group-title">
        <div>
          <strong>${grupo.codigo}. ${grupo.nome}</strong>
          <span class="pc-count">${total} classificacao(oes)</span>
        </div>
      </div>
      <div class="account-items">
        ${itensBase.map(item => `<span class="pc-chip pc-chip-base" title="Item base">${item}</span>`).join("")}
        ${itensCustom.map(item => `
          <span class="pc-chip pc-chip-custom">
            ${escapeHtml(item.nome)}
            <button class="pc-chip-btn edit" onclick="editarPlanoConta(${item.id})" title="Editar">&#9998;</button>
            <button class="pc-chip-btn del" onclick="excluirPlanoConta(${item.id})" title="Excluir">&#10005;</button>
          </span>
        `).join("")}
      </div>
    </article>
  `}).join("");

  // Personalizados que não pertencem a nenhum grupo listado
  const codigosGrupos = grupos.map(g => g.codigo + ".");
  const avulsos = personalizados.filter(p =>
    !codigosGrupos.some(cod => p.nome.startsWith(cod))
  );
  if (avulsos.length) {
    container.innerHTML += `
    <article class="account-group">
      <div class="account-group-title">
        <div><strong>Outros</strong><span class="pc-count">${avulsos.length} classificacao(oes)</span></div>
      </div>
      <div class="account-items">
        ${avulsos.map(item => `
          <span class="pc-chip pc-chip-custom">
            ${escapeHtml(item.nome)}
            <button class="pc-chip-btn edit" onclick="editarPlanoConta(${item.id})" title="Editar">&#9998;</button>
            <button class="pc-chip-btn del" onclick="excluirPlanoConta(${item.id})" title="Excluir">&#10005;</button>
          </span>
        `).join("")}
      </div>
    </article>`;
  }
}

async function renderizarPlanoContas() {
  const container = document.getElementById("lista-plano-contas");
  if (!container) return;

  const itens = await carregarPlanoContas();

  if (!itens.length) {
    container.innerHTML = `<div class="panel-box"><p>Nenhuma classificacao personalizada cadastrada.</p></div>`;
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Classificacao</th>
          <th>Acoes</th>
        </tr>
      </thead>
      <tbody>
        ${itens.map(item => `
          <tr>
            <td>${item.id}</td>
            <td>${item.nome}</td>
            <td>
              <div class="action-row">
                <button class="small-btn edit-btn" onclick="editarPlanoConta(${item.id})">Editar</button>
                <button class="small-btn delete-btn" onclick="excluirPlanoConta(${item.id})">Excluir</button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// Inicializa a página de plano de contas: carrega estrutura e lista,
// conecta o submit do formulário (POST ou PUT) e o botão cancelar.
// Chamada por loadPage("planoContas") após renderização do HTML.
async function iniciarPlanoContas() {
  const form = document.getElementById("form-plano-conta");
  const inputNome = document.getElementById("plano-conta-nome");
  const mensagem = document.getElementById("mensagem-plano-conta");
  const titulo = document.getElementById("titulo-form-plano-conta");
  const botaoSalvar = document.getElementById("btn-salvar-plano-conta");
  const botaoCancelar = document.getElementById("btn-cancelar-plano-conta");

  await renderizarEstruturaPlanoContas();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const payload = { nome: inputNome.value.trim() };
      const url = editandoPlanoContaId ? `/plano-contas/${editandoPlanoContaId}` : "/plano-contas";
      const method = editandoPlanoContaId ? "PUT" : "POST";

      await apiSend(url, method, payload);

      editandoPlanoContaId = null;
      form.reset();
      titulo.textContent = "Nova classificacao";
      botaoSalvar.textContent = "+ Adicionar";
      botaoCancelar.style.display = "none";
      mensagem.textContent = "Classificacao salva com sucesso.";
      await renderizarEstruturaPlanoContas();
    } catch (erro) {
      mensagem.textContent = erro.message;
    }
  });

  botaoCancelar.addEventListener("click", () => {
    editandoPlanoContaId = null;
    form.reset();
    titulo.textContent = "Nova classificacao";
    botaoSalvar.textContent = "Salvar classificacao";
    botaoCancelar.style.display = "none";
    mensagem.textContent = "";
  });
}

window.editarPlanoConta = async (id) => {
  const itens = await carregarPlanoContas();
  const item = itens.find(registro => registro.id === id);
  if (!item) return;

  editandoPlanoContaId = id;
  document.getElementById("plano-conta-nome").value = item.nome;
  document.getElementById("titulo-form-plano-conta").textContent = "Alterar classificacao";
  document.getElementById("btn-salvar-plano-conta").textContent = "Salvar alteracao";
  document.getElementById("btn-cancelar-plano-conta").style.display = "inline-block";
  document.getElementById("btn-cancelar-plano-conta").style.display = "inline-block";
};

window.excluirPlanoConta = async (id) => {
  if (!confirm("Deseja excluir esta classificacao?")) return;

  await apiDelete(`/plano-contas/${id}`);
  await renderizarEstruturaPlanoContas();
};

// =========================================================
// MODULO DE LANCAMENTOS
//
// Gerencia o registro de todas as movimentações financeiras da empresa.
// Um lançamento possui: classificação (plano de contas), descrição,
// valor, data, veículo vinculado (opcional), obra/serviço e campos
// extras de combustível (KM, litros, NF) quando aplicável.
//
// Vínculo com estoque: ao salvar um lançamento de saída de produto,
// o backend decrementa automaticamente o estoque do item vinculado.
// O autocomplete (iniciarBuscaEstoque) filtra produtos em cache local.
//
// Fluxo de dados:
//   1. iniciarModuloLancamentos() carrega selects e vincula eventos
//   2. carregarLancamentos() aplica filtros e chama renderizarTabela()
//   3. renderizarTabela() exibe linhas com botões Editar/Excluir
//   4. editarLancamentoPorId() pré-preenche o form para PUT
//   5. Reset via resetFormLancamento() volta ao modo POST
// =========================================================

// Carrega a lista de classificações da API e preenche os dois selects:
// o do formulário de novo lançamento e o do filtro de pesquisa.
async function carregarClassificacoes() {
  const classificacaoSelect = document.getElementById("classificacao");
  const filtroClassificacao = document.getElementById("filtro-classificacao");

  const classificacoes = await apiGet("/classificacoes");

  classificacaoSelect.innerHTML = `<option value="">Selecione...</option>`;
  filtroClassificacao.innerHTML = `<option value="">Todas</option>`;

  classificacoes.forEach((item) => {
    const option1 = document.createElement("option");
    option1.value = item;
    option1.textContent = item;
    classificacaoSelect.appendChild(option1);

    const option2 = document.createElement("option");
    option2.value = item;
    option2.textContent = item;
    filtroClassificacao.appendChild(option2);
  });
}

// Carrega veículos e preenche os selects de vínculo e filtro na página de lançamentos.
// Atualiza cacheVeiculos para que nomeVeiculoPorId() funcione sem novas requisições.
async function carregarVeiculosLancamento() {
  const selectVeiculo = document.getElementById("veiculo-id");
  const filtroVeiculo = document.getElementById("filtro-veiculo-id");

  cacheVeiculos = await carregarVeiculos();

  if (selectVeiculo) {
    selectVeiculo.innerHTML = `<option value="">Sem vinculo</option>`;
  }

  if (filtroVeiculo) {
    filtroVeiculo.innerHTML = `<option value="">Todos</option>`;
  }

  cacheVeiculos.forEach((veiculo) => {
    const texto = `${veiculo.nome || veiculo.modelo || "Veiculo"}${veiculo.placa ? ` - ${veiculo.placa}` : ""}`;

    if (selectVeiculo) {
      const option = document.createElement("option");
      option.value = veiculo.id;
      option.textContent = texto;
      selectVeiculo.appendChild(option);
    }

    if (filtroVeiculo) {
      const option = document.createElement("option");
      option.value = veiculo.id;
      option.textContent = texto;
      filtroVeiculo.appendChild(option);
    }
  });
}

// Mostra ou oculta os campos extras de combustível (kilometragem, litros, NF, data NF)
// com base na classificação selecionada. Chamada no evento "change" do select e
// também no carregamento inicial e ao pré-preencher o formulário de edição.
function alternarCamposCombustivel() {
  const classificacao = document.getElementById("classificacao")?.value || "";
  const campos = document.getElementById("campos-combustivel");
  if (!campos) return;

  campos.style.display = classificacaoEhCombustivel(classificacao) ? "block" : "none";
}

// =============================================================
// MÓDULO DE VÍNCULO DE ESTOQUE EM LANÇAMENTOS
// =============================================================

// Cache de produtos do estoque carregados para o autocomplete
let cacheProdutosEstoqueLancamento = [];

/**
 * Carrega produtos do estoque e popula o select de vínculo no formulário
 * de lançamentos, igual ao padrão usado nas classificações.
 */
async function carregarProdutosEstoqueLancamento() {
  try {
    cacheProdutosEstoqueLancamento = await apiGet("/estoque/produtos/busca");
  } catch {
    cacheProdutosEstoqueLancamento = [];
  }

  const sel = document.getElementById("estoque-item-id");
  if (!sel) return;

  const valorAtual = sel.value;
  sel.innerHTML = `<option value="">Nenhum</option>`;
  cacheProdutosEstoqueLancamento.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.nome} (${p.quantidade_atual} ${p.unidade_medida})`;
    opt.dataset.disponivel = p.quantidade_atual;
    sel.appendChild(opt);
  });

  if (valorAtual) sel.value = valorAtual;
}

/**
 * Preenche o select de estoque ao editar um lançamento já vinculado.
 */
function preencherEstoqueLancamento(item) {
  if (!item.estoque_item_id) return;

  const sel = document.getElementById("estoque-item-id");
  const campoQtd = document.getElementById("campo-estoque-quantidade");
  const inputQtd = document.getElementById("estoque-quantidade");

  if (sel) sel.value = item.estoque_item_id;
  if (campoQtd) { campoQtd.style.display = "flex"; campoQtd.style.flexDirection = "column"; }
  if (inputQtd) {
    inputQtd.value = item.estoque_quantidade || "";
    const opt = sel?.querySelector(`option[value="${item.estoque_item_id}"]`);
    if (opt) inputQtd.dataset.disponivel = opt.dataset.disponivel;
  }
}

/**
 * Limpa a seleção de estoque no formulário.
 */
function limparSelecaoEstoque() {
  const sel = document.getElementById("estoque-item-id");
  const campoQtd = document.getElementById("campo-estoque-quantidade");
  const inputQtd = document.getElementById("estoque-quantidade");
  const aviso = document.getElementById("estoque-quantidade-aviso");

  if (sel) sel.value = "";
  if (campoQtd) campoQtd.style.display = "none";
  if (inputQtd) inputQtd.value = "";
  if (aviso) aviso.style.display = "none";
}

/**
 * Valida se a quantidade solicitada não excede o estoque disponível.
 * Retorna true se válido, false se deve bloquear o submit.
 */
function validarQuantidadeEstoque() {
  const sel = document.getElementById("estoque-item-id");
  const inputQtd = document.getElementById("estoque-quantidade");
  const aviso = document.getElementById("estoque-quantidade-aviso");

  if (!sel?.value || !inputQtd?.value) return true;

  const solicitado = normalizarNumero(inputQtd.value);
  const opt = sel.querySelector(`option[value="${sel.value}"]`);
  const disponivel = parseFloat(opt?.dataset.disponivel || 999999);

  if (solicitado <= 0) {
    aviso.textContent = "A quantidade deve ser maior que zero.";
    aviso.style.display = "block";
    return false;
  }

  if (solicitado > disponivel) {
    aviso.textContent = `Quantidade insuficiente. Disponivel: ${disponivel}`;
    aviso.style.display = "block";
    return false;
  }

  if (aviso) aviso.style.display = "none";
  return true;
}

/**
 * Inicializa o evento change no select de estoque para mostrar/ocultar
 * o campo de quantidade quando um item é selecionado.
 */
function iniciarBuscaEstoque() {
  const sel = document.getElementById("estoque-item-id");
  if (!sel) return;

  sel.addEventListener("change", () => {
    const campoQtd = document.getElementById("campo-estoque-quantidade");
    const inputQtd = document.getElementById("estoque-quantidade");
    const aviso = document.getElementById("estoque-quantidade-aviso");

    if (sel.value) {
      campoQtd.style.display = "flex";
      campoQtd.style.flexDirection = "column";
      const opt = sel.querySelector(`option[value="${sel.value}"]`);
      if (opt && inputQtd) inputQtd.dataset.disponivel = opt.dataset.disponivel;
    } else {
      campoQtd.style.display = "none";
      if (inputQtd) inputQtd.value = "";
      if (aviso) aviso.style.display = "none";
    }
  });

  const inputQtd = document.getElementById("estoque-quantidade");
  if (inputQtd) inputQtd.addEventListener("input", validarQuantidadeEstoque);
}

// Pré-preenche o formulário de lançamento com os dados de um registro existente.
// Chamada por editarLancamentoPorId() para entrar no modo de edição (PUT).
// Restaura o vínculo de estoque (se houver) via preencherEstoqueLancamento().
// Atualiza o título, texto do botão e exibe o botão "Cancelar edição".
function preencherFormLancamento(item) {
  document.getElementById("classificacao").value = item.classificacao;
  document.getElementById("descricao").value = item.descricao;
  document.getElementById("valor").value = normalizarNumero(item.valor);
  document.getElementById("data").value = item.data;
  document.getElementById("veiculo-id").value = item.veiculo_id || "";
  document.getElementById("empresa-id").value = item.empresa_id || "";
  document.getElementById("obra-servico").value = item.obra_servico || "";
  document.getElementById("kilometragem").value = item.kilometragem || "";
  document.getElementById("litros").value = item.litros || "";
  document.getElementById("numero-nf").value = item.numero_nf || "";
  document.getElementById("data-nf").value = item.data_nf || "";
  alternarCamposCombustivel();

  // Preencher vínculo de estoque se houver item vinculado ao lançamento
  limparSelecaoEstoque();
  if (item.estoque_item_id) {
    preencherEstoqueLancamento(item);
  }

  document.getElementById("titulo-form-lancamento").textContent = "Alterar lancamento";
  document.getElementById("btn-salvar-lancamento").textContent = "Salvar alteracao";
  document.getElementById("btn-cancelar-edicao-lancamento").style.display = "inline-block";
}

// Reseta o formulário de lançamento para o modo de criação (POST).
// Limpa todos os campos, o vínculo de estoque e restaura títulos/botões.
// Chamada após salvar com sucesso ou ao clicar em "Cancelar edição".
function resetFormLancamento() {
  editandoLancamentoId = null;
  document.getElementById("form-lancamento").reset();
  document.getElementById("titulo-form-lancamento").textContent = "Novo lancamento";
  document.getElementById("btn-salvar-lancamento").textContent = "Salvar lancamento";
  document.getElementById("btn-cancelar-edicao-lancamento").style.display = "none";
  alternarCamposCombustivel();
  // Limpar campos de vínculo de estoque ao resetar formulário
  limparSelecaoEstoque();
}

// Atualiza os 4 cards KPI da página de lançamentos:
// quantidade, valor total, maior e menor lançamento da seleção atual.
// Chamada por renderizarTabela() sempre que a lista é atualizada.
function atualizarTotalizadores(lancamentos) {
  const totalQuantidade = document.getElementById("total-quantidade");
  const totalValor = document.getElementById("total-valor");
  const maiorValor = document.getElementById("maior-valor");
  const menorValor = document.getElementById("menor-valor");

  if (!totalQuantidade || !totalValor || !maiorValor || !menorValor) return;

  if (!Array.isArray(lancamentos) || lancamentos.length === 0) {
    totalQuantidade.textContent = "0";
    totalValor.textContent = formatarValor(0);
    maiorValor.textContent = formatarValor(0);
    menorValor.textContent = formatarValor(0);
    return;
  }

  const valores = lancamentos.map(item => normalizarNumero(item.valor));
  const soma = valores.reduce((acc, valor) => acc + valor, 0);
  const maior = Math.max(...valores);
  const menor = Math.min(...valores);

  totalQuantidade.textContent = String(lancamentos.length);
  totalValor.textContent = formatarValor(soma);
  maiorValor.textContent = formatarValor(maior);
  menorValor.textContent = formatarValor(menor);
}

// Copia o innerHTML da tabela principal para o modal de "tela cheia",
// mantendo a contagem de registros sincronizada entre os dois contextos.
// Chamada sempre que a tabela é atualizada e ao abrir o modal.
function copiarTabelaLancamentosParaModal() {
  const origem = document.getElementById("tabela-lancamentos");
  const destino = document.getElementById("tabela-lancamentos-modal");
  const total = document.getElementById("total-registros");
  const totalModal = document.getElementById("total-registros-modal");

  if (!origem || !destino) return;

  destino.innerHTML = origem.innerHTML;

  if (total && totalModal) {
    totalModal.textContent = total.textContent;
  }
}

// Adiciona temporariamente a classe .print-area ao elemento e dispara window.print().
// O CSS de impressão (@media print) exibe apenas elementos com essa classe.
// A classe é removida logo após para não afetar a renderização normal.
function imprimirElementoPorId(elementId) {
  const elemento = document.getElementById(elementId);
  if (!elemento) return;

  elemento.classList.add("print-area");
  window.print();
  elemento.classList.remove("print-area");
}

// Conecta os botões de conferência: "Tela completa" (abre modal),
// "Fechar" (fecha modal), "Imprimir" (imprime tabela da tela)
// e "Imprimir" do modal (imprime tabela do modal expandido).
function iniciarAcoesConferenciaLancamentos() {
  const btnTelaCheia = document.getElementById("btn-tela-cheia-lancamentos");
  const btnImprimir = document.getElementById("btn-imprimir-lancamentos");
  const modal = document.getElementById("modal-lancamentos");
  const btnFecharModal = document.getElementById("btn-fechar-modal-lancamentos");
  const btnImprimirModal = document.getElementById("btn-imprimir-modal-lancamentos");

  if (btnTelaCheia) {
    btnTelaCheia.addEventListener("click", () => {
      copiarTabelaLancamentosParaModal();
      modal.style.display = "flex";
    });
  }

  if (btnFecharModal) {
    btnFecharModal.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  if (btnImprimir) {
    btnImprimir.addEventListener("click", () => {
      imprimirElementoPorId("tabela-impressao-lancamentos");
    });
  }

  if (btnImprimirModal) {
    btnImprimirModal.addEventListener("click", () => {
      imprimirElementoPorId("tabela-modal-impressao-lancamentos");
    });
  }
}

// Renderiza as linhas da tabela de lançamentos com todos os dados e ações.
// Exibe badge de estoque vinculado (nome + quantidade) ou "—" se não houver.
// Também atualiza KPIs (atualizarTotalizadores) e sincroniza o modal.
function renderizarTabela(lancamentos) {
  const tabelaLancamentos = document.getElementById("tabela-lancamentos");
  const totalRegistros = document.getElementById("total-registros");

  atualizarTotalizadores(lancamentos);

  if (!lancamentos.length) {
    tabelaLancamentos.innerHTML = `
      <tr>
        <td colspan="8" class="empty-row">Nenhum lancamento encontrado.</td>
      </tr>
    `;
    totalRegistros.textContent = "0 registros";
    copiarTabelaLancamentosParaModal();
    return;
  }

  tabelaLancamentos.innerHTML = lancamentos.map((item) => {
    // Exibir badge de estoque vinculado quando houver item de estoque no lançamento
    const estoqueInfo = item.estoque_item_nome
      ? `<span class="estoque-tag" title="Saida: ${item.estoque_quantidade} ${item.estoque_item_nome}">${item.estoque_item_nome} (${item.estoque_quantidade})</span>`
      : `<span class="sem-estoque">—</span>`;
    return `
    <tr>
      <td>${item.id}</td>
      <td>${item.data}</td>
      <td>${item.classificacao}</td>
      <td>${nomeVeiculoPorId(item.veiculo_id)}</td>
      <td>${item.descricao}</td>
      <td>${estoqueInfo}</td>
      <td>${formatarValor(item.valor)}</td>
      <td>
        <div class="action-row">
          <button class="small-btn edit-btn" onclick="editarLancamentoPorId(${item.id})">Editar</button>
          <button class="small-btn delete-btn" onclick="excluirLancamento(${item.id})">Excluir</button>
        </div>
      </td>
    </tr>
  `;
  }).join("");

  totalRegistros.textContent = `${lancamentos.length} registro(s)`;
  copiarTabelaLancamentosParaModal();
}

window.editarLancamentoPorId = async (id) => {
  const lancamentos = await apiGet("/lancamentos");
  const item = lancamentos.find(registro => registro.id === id);
  if (!item) return;

  editandoLancamentoId = item.id;
  preencherFormLancamento(item);
};

window.excluirLancamento = async (id) => {
  if (!confirm("Deseja excluir este lancamento?")) return;

  await apiDelete(`/lancamentos/${id}`);
  await carregarLancamentos();
};

// Lê os filtros ativos da página (classificação, datas, descrição, veículo),
// monta a query string e busca os lançamentos filtrados no backend.
// Chamada na inicialização, ao aplicar filtros e após salvar/excluir.
async function carregarLancamentos() {
  const filtroClassificacao = document.getElementById("filtro-classificacao");
  const filtroDataInicial = document.getElementById("filtro-data-inicial");
  const filtroDataFinal = document.getElementById("filtro-data-final");
  const filtroDescricao = document.getElementById("filtro-descricao");
  const filtroVeiculo = document.getElementById("filtro-veiculo-id");

  const params = new URLSearchParams();

  if (filtroClassificacao.value) params.append("classificacao", filtroClassificacao.value);
  if (filtroDataInicial.value) params.append("data_inicial", filtroDataInicial.value);
  if (filtroDataFinal.value) params.append("data_final", filtroDataFinal.value);
  if (filtroDescricao.value.trim()) params.append("descricao", filtroDescricao.value.trim());
  if (filtroVeiculo?.value) params.append("veiculo_id", filtroVeiculo.value);

  const url = params.toString() ? `/lancamentos?${params.toString()}` : "/lancamentos";
  const lancamentos = await apiGet(url);

  renderizarTabela(lancamentos);
}

// Ponto de entrada do módulo de lançamentos. Carrega todos os dados iniciais
// (classificações, veículos, produtos de estoque, lançamentos) e vincula
// todos os eventos: submit do form, filtrar, limpar, cancelar edição,
// ações de conferência e autocomplete de estoque.
// Chamada por loadPage("lancamentos") após renderizar o HTML.
async function iniciarModuloLancamentos() {
  // Lógica das abas: Lançamentos / Plano de Contas / Ativos e Passivos
  let ativosJaCarregados = false;
  let planoJaCarregado   = false;
  const tabIds = ["tab-lancamentos", "tab-plano-contas", "tab-ativos-passivos"];
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const alvo = btn.dataset.tab;
      tabIds.forEach(id => {
        document.getElementById(id).style.display = id === alvo ? "" : "none";
      });
      if (alvo === "tab-plano-contas" && !planoJaCarregado) {
        planoJaCarregado = true;
        await iniciarPlanoContas();
      }
      if (alvo === "tab-ativos-passivos" && !ativosJaCarregados) {
        ativosJaCarregados = true;
        await iniciarAtivosPassivos();
      }
    });
  });

  await carregarClassificacoes();
  await carregarVeiculosLancamento();
  // Carregar produtos para o autocomplete de vínculo de estoque
  await carregarProdutosEstoqueLancamento();
  await carregarLancamentos();

  const form = document.getElementById("form-lancamento");
  const mensagem = document.getElementById("mensagem");
  const btnFiltrar = document.getElementById("btn-filtrar");
  const btnLimpar = document.getElementById("btn-limpar");
  const btnCancelarEdicao = document.getElementById("btn-cancelar-edicao-lancamento");
  const classificacaoSelect = document.getElementById("classificacao");

  classificacaoSelect.addEventListener("change", alternarCamposCombustivel);
  alternarCamposCombustivel();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    // Validar estoque antes de enviar (validação client-side)
    if (!validarQuantidadeEstoque()) {
      mostrarToast("Verifique a quantidade de estoque informada.", "error");
      return;
    }

    const estoqueItemId = document.getElementById("estoque-item-id")?.value
      ? Number(document.getElementById("estoque-item-id").value)
      : null;
    const estoqueQuantidade = document.getElementById("estoque-quantidade")?.value
      ? normalizarNumero(document.getElementById("estoque-quantidade").value)
      : null;

    const payload = {
      classificacao: document.getElementById("classificacao").value,
      descricao: document.getElementById("descricao").value.trim(),
      valor: normalizarNumero(document.getElementById("valor").value),
      data: document.getElementById("data").value,
      veiculo_id: document.getElementById("veiculo-id").value
        ? Number(document.getElementById("veiculo-id").value)
        : null,
      empresa_id: document.getElementById("empresa-id").value
        ? Number(document.getElementById("empresa-id").value)
        : null,
      obra_servico: document.getElementById("obra-servico").value.trim(),
      kilometragem: document.getElementById("kilometragem").value
        ? normalizarNumero(document.getElementById("kilometragem").value)
        : null,
      litros: document.getElementById("litros").value
        ? normalizarNumero(document.getElementById("litros").value)
        : null,
      numero_nf: document.getElementById("numero-nf").value.trim(),
      data_nf: document.getElementById("data-nf").value || null,
      // Campos de vínculo com estoque (null quando não vinculado)
      estoque_item_id: estoqueItemId,
      estoque_quantidade: estoqueQuantidade,
    };

    const url = editandoLancamentoId ? `/lancamentos/${editandoLancamentoId}` : "/lancamentos";
    const method = editandoLancamentoId ? "PUT" : "POST";

    try {
      await apiSend(url, method, payload);
      mensagem.textContent = editandoLancamentoId
        ? "Lancamento alterado com sucesso."
        : "Lancamento salvo com sucesso.";
      mostrarToast(mensagem.textContent, "success");
      resetFormLancamento();
      // Recarregar cache de estoque após movimentação
      await carregarProdutosEstoqueLancamento();
      await carregarLancamentos();
    } catch (erro) {
      mensagem.textContent = erro.message;
      mostrarToast(erro.message, "error");
    }
  });

  btnFiltrar.addEventListener("click", async () => {
    await carregarLancamentos();
    fecharPopupFiltros("painel-filtros-lancamentos");
  });

  btnLimpar.addEventListener("click", async () => {
    document.getElementById("filtro-classificacao").value = "";
    document.getElementById("filtro-data-inicial").value = "";
    document.getElementById("filtro-data-final").value = "";
    document.getElementById("filtro-descricao").value = "";
    document.getElementById("filtro-veiculo-id").value = "";
    await carregarLancamentos();
    fecharPopupFiltros("painel-filtros-lancamentos");
  });

  btnCancelarEdicao.addEventListener("click", resetFormLancamento);

  iniciarAcoesConferenciaLancamentos();
  // Ativar autocomplete do campo de vínculo com estoque
  iniciarBuscaEstoque();
}

// =========================================================
// MODULO DE CONTAS A RECEBER
//
// Controla contratos, tickets, fretes e horas de máquina a receber.
// Campos especiais para veículos do tipo "Máquina": valor/hora unitário
// e quantidade de horas — o valor total é calculado automaticamente.
//
// Status de pagamento: pendente → recebido → cancelado.
// O botão de status na tabela alterna entre pendente e recebido via PATCH.
//
// KPIs exibidos: registros, valor bruto, descontos, total a receber,
// recebido e pendente — todos calculados localmente sobre a lista retornada.
// =========================================================

// Carrega veículos e classificações e preenche os selects do formulário e filtro.
// Também filtra apenas classificações do grupo "2." (despesas/descontos) para
// o campo de classificação de desconto.
async function carregarOpcoesContasReceber() {
  const selectVeiculo = document.getElementById("cr-veiculo-id");
  const filtroVeiculo = document.getElementById("cr-filtro-veiculo-id");
  const selectDesconto = document.getElementById("cr-desconto-classificacao");

  const [veiculos, classificacoes] = await Promise.all([
    carregarVeiculos(),
    apiGet("/classificacoes")
  ]);

  cacheVeiculos = veiculos;

  if (selectVeiculo) selectVeiculo.innerHTML = `<option value="">Sem vinculo</option>`;
  if (filtroVeiculo) filtroVeiculo.innerHTML = `<option value="">Todos</option>`;
  if (selectDesconto) selectDesconto.innerHTML = `<option value="">Sem classificacao</option>`;

  veiculos.forEach((veiculo) => {
    const texto = `${veiculo.nome || veiculo.modelo || "Veiculo"}${veiculo.placa ? ` - ${veiculo.placa}` : ""}`;

    if (selectVeiculo) {
      const option = document.createElement("option");
      option.value = veiculo.id;
      option.textContent = texto;
      selectVeiculo.appendChild(option);
    }

    if (filtroVeiculo) {
      const option = document.createElement("option");
      option.value = veiculo.id;
      option.textContent = texto;
      filtroVeiculo.appendChild(option);
    }
  });

  classificacoes
    .filter((classificacao) => String(classificacao).trim().startsWith("2."))
    .forEach((classificacao) => {
    if (!selectDesconto) return;
    const option = document.createElement("option");
    option.value = classificacao;
    option.textContent = classificacao;
    selectDesconto.appendChild(option);
  });
}

// Calcula o valor total a receber do formulário: valor (ou horas × valor/hora)
// + bonificação − descontos. Exibido em tempo real no preview do formulário.
function calcularTotalReceberFormulario() {
  const valorHoraUnitario = normalizarNumero(document.getElementById("cr-valor-hora-unitario")?.value);
  const quantidadeHoras = normalizarNumero(document.getElementById("cr-quantidade-horas")?.value);
  const valorCalculadoHoras = valorHoraUnitario > 0 && quantidadeHoras > 0 ? valorHoraUnitario * quantidadeHoras : 0;
  const valor = valorCalculadoHoras || normalizarNumero(document.getElementById("cr-valor")?.value);
  const bonificacao = normalizarNumero(document.getElementById("cr-bonificacao")?.value);
  const descontos = normalizarNumero(document.getElementById("cr-descontos")?.value);
  return valor + bonificacao - descontos;
}

// Atualiza o preview "Valor total a receber" em tempo real enquanto o usuário edita
// os campos do formulário. Para máquinas, também preenche o campo "Valor" com
// o resultado de horas × valor/hora quando este modo está ativo.
function atualizarTotalReceberPreview() {
  const preview = document.getElementById("cr-total-preview");
  if (!preview) return;
  const valor = normalizarNumero(document.getElementById("cr-valor-hora-unitario")?.value) * normalizarNumero(document.getElementById("cr-quantidade-horas")?.value);
  const campoValor = document.getElementById("cr-valor");
  if (campoValor && valor > 0 && veiculoContaReceberEhMaquina()) {
    campoValor.value = valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  preview.textContent = formatarValor(calcularTotalReceberFormulario());
}

// Verifica se o veículo selecionado no formulário de conta a receber é do tipo "Máquina".
// Usado para mostrar/ocultar os campos de valor/hora e quantidade de horas.
function veiculoContaReceberEhMaquina() {
  const veiculoId = Number(document.getElementById("cr-veiculo-id")?.value || 0);
  const veiculo = cacheVeiculos.find((item) => item.id === veiculoId);
  return Boolean(veiculo && normalizarTexto(veiculo.tipo).includes("maquina"));
}

// Exibe ou oculta os campos de hora/máquina com base no veículo selecionado.
// Limpa os campos quando o veículo deixa de ser máquina para evitar dados inconsistentes.
// Também atualiza o preview do total após a alteração.
function atualizarCamposMaquinaContaReceber() {
  const ehMaquina = veiculoContaReceberEhMaquina();
  document.querySelectorAll(".cr-maquina-field").forEach((campo) => {
    campo.style.display = ehMaquina ? "" : "none";
  });
  if (!ehMaquina) {
    const valorHora = document.getElementById("cr-valor-hora-unitario");
    const horas = document.getElementById("cr-quantidade-horas");
    if (valorHora) valorHora.value = "";
    if (horas) horas.value = "";
  }
  atualizarTotalReceberPreview();
}

// Coleta e normaliza todos os campos do formulário de conta a receber,
// incluindo o valor calculado por horas (quando for máquina) ou valor direto.
// Retorna o objeto pronto para ser enviado via apiSend (POST ou PUT).
function montarPayloadContaReceber() {
  const valorHoraUnitario = normalizarNumero(document.getElementById("cr-valor-hora-unitario")?.value);
  const quantidadeHoras = normalizarNumero(document.getElementById("cr-quantidade-horas")?.value);
  const valorCalculadoHoras = valorHoraUnitario > 0 && quantidadeHoras > 0 ? valorHoraUnitario * quantidadeHoras : 0;
  return {
    data_inicio: document.getElementById("cr-data-inicio").value,
    contrato: document.getElementById("cr-contrato").value.trim(),
    cte_ticket: document.getElementById("cr-cte-ticket").value.trim(),
    valor: valorCalculadoHoras || normalizarNumero(document.getElementById("cr-valor").value),
    valor_hora_unitario: valorHoraUnitario,
    quantidade_horas: quantidadeHoras,
    carga: document.getElementById("cr-carga").value.trim(),
    ton_qnt: document.getElementById("cr-ton-qnt").value.trim(),
    tomador: document.getElementById("cr-tomador").value.trim(),
    origem_destino: document.getElementById("cr-origem-destino").value.trim(),
    bonificacao: normalizarNumero(document.getElementById("cr-bonificacao").value),
    veiculo_id: document.getElementById("cr-veiculo-id").value
      ? Number(document.getElementById("cr-veiculo-id").value)
      : null,
    descontos: normalizarNumero(document.getElementById("cr-descontos").value),
    desconto_classificacao: document.getElementById("cr-desconto-classificacao").value,
    status_pagamento: document.getElementById("cr-status-pagamento").value,
    data_recebimento: document.getElementById("cr-data-recebimento").value || null
  };
}

function preencherFormContaReceber(item) {
  document.getElementById("cr-data-inicio").value = item.data_inicio || "";
  document.getElementById("cr-contrato").value = item.contrato || "";
  document.getElementById("cr-cte-ticket").value = item.cte_ticket || "";
  document.getElementById("cr-valor").value = normalizarNumero(item.valor);
  document.getElementById("cr-valor-hora-unitario").value = normalizarNumero(item.valor_hora_unitario);
  document.getElementById("cr-quantidade-horas").value = normalizarNumero(item.quantidade_horas);
  document.getElementById("cr-carga").value = item.carga || "";
  document.getElementById("cr-ton-qnt").value = item.ton_qnt || "";
  document.getElementById("cr-tomador").value = item.tomador || "";
  document.getElementById("cr-origem-destino").value = item.origem_destino || "";
  document.getElementById("cr-bonificacao").value = normalizarNumero(item.bonificacao);
  document.getElementById("cr-veiculo-id").value = item.veiculo_id || "";
  document.getElementById("cr-descontos").value = normalizarNumero(item.descontos);
  document.getElementById("cr-desconto-classificacao").value = item.desconto_classificacao || "";
  document.getElementById("cr-status-pagamento").value = item.status_pagamento || "pendente";
  document.getElementById("cr-data-recebimento").value = item.data_recebimento || "";

  document.getElementById("titulo-form-conta-receber").textContent = "Alterar conta a receber";
  document.getElementById("btn-salvar-conta-receber").textContent = "Salvar alteracao";
  document.getElementById("btn-cancelar-conta-receber").style.display = "inline-block";
  atualizarCamposMaquinaContaReceber();
  atualizarTotalReceberPreview();
}

function resetFormContaReceber() {
  editandoContaReceberId = null;
  document.getElementById("form-conta-receber").reset();
  document.getElementById("titulo-form-conta-receber").textContent = "Nova conta a receber";
  document.getElementById("btn-salvar-conta-receber").textContent = "Salvar conta";
  document.getElementById("btn-cancelar-conta-receber").style.display = "none";
  atualizarCamposMaquinaContaReceber();
  atualizarTotalReceberPreview();
}

// Calcula e exibe os 6 KPIs da página de contas a receber:
// total de registros, valor bruto, total de descontos, total a receber,
// valor recebido e valor pendente — todos calculados localmente sobre a lista.
function atualizarKpisContasReceber(contas) {
  const totalRegistros = document.getElementById("cr-total-registros-kpi");
  const totalBruto = document.getElementById("cr-total-bruto-kpi");
  const totalDescontos = document.getElementById("cr-total-descontos-kpi");
  const totalReceber = document.getElementById("cr-total-receber-kpi");
  const totalRecebido = document.getElementById("cr-total-recebido-kpi");
  const totalPendente = document.getElementById("cr-total-pendente-kpi");

  if (!totalRegistros || !totalBruto || !totalDescontos || !totalReceber || !totalRecebido || !totalPendente) return;

  const bruto = contas.reduce((total, item) => total + normalizarNumero(item.valor), 0);
  const descontos = contas.reduce((total, item) => total + normalizarNumero(item.descontos), 0);
  const receber = contas.reduce((total, item) => total + normalizarNumero(item.valor_total_receber), 0);
  const recebido = contas
    .filter((item) => item.status_pagamento === "recebido")
    .reduce((total, item) => total + normalizarNumero(item.valor_total_receber), 0);
  const pendente = contas
    .filter((item) => item.status_pagamento !== "recebido" && item.status_pagamento !== "cancelado")
    .reduce((total, item) => total + normalizarNumero(item.valor_total_receber), 0);

  totalRegistros.textContent = String(contas.length);
  totalBruto.textContent = formatarValor(bruto);
  totalDescontos.textContent = formatarValor(descontos);
  totalReceber.textContent = formatarValor(receber);
  totalRecebido.textContent = formatarValor(recebido);
  totalPendente.textContent = formatarValor(pendente);
}

// Renderiza a tabela de contas a receber com todas as colunas do modelo operacional.
// O botão de status alterna entre "Marcar recebido" e "Marcar pendente" dinamicamente.
// Usa escapeHtml em todos os campos de texto para evitar XSS.
function renderizarTabelaContasReceber(contas) {
  const tabela = document.getElementById("tabela-contas-receber");
  const total = document.getElementById("cr-total-registros");
  if (!tabela || !total) return;

  atualizarKpisContasReceber(contas);

  if (!contas.length) {
    tabela.innerHTML = `<tr><td colspan="15" class="empty-row">Nenhuma conta a receber encontrada.</td></tr>`;
    total.textContent = "0 registros";
    return;
  }

  tabela.innerHTML = contas.map((item) => {
    const descontoDetalhe = item.desconto_classificacao
      ? `<small>${escapeHtml(item.desconto_classificacao)}</small>`
      : "";
    const status = item.status_pagamento || "pendente";
    const proximoStatus = status === "recebido" ? "pendente" : "recebido";
    const textoBotaoStatus = status === "recebido" ? "Marcar pendente" : "Marcar recebido";
    const classeBotaoStatus = status === "recebido" ? "delete-btn" : "edit-btn";

    return `
      <tr>
        <td>${formatarDataCurta(item.data_inicio)}</td>
        <td>${escapeHtml(item.contrato || "")}</td>
        <td>${escapeHtml(item.cte_ticket || "")}</td>
        <td>${formatarValor(item.valor)}</td>
        <td>${normalizarNumero(item.quantidade_horas) > 0 ? `${normalizarNumero(item.quantidade_horas).toLocaleString("pt-BR")}h x ${formatarValor(item.valor_hora_unitario)}` : "-"}</td>
        <td>${escapeHtml(item.carga || "")}</td>
        <td>${escapeHtml(item.ton_qnt || "")}</td>
        <td>${escapeHtml(item.tomador || "")}</td>
        <td>${escapeHtml(item.origem_destino || "")}</td>
        <td>${formatarValor(item.bonificacao)}</td>
        <td>${escapeHtml(nomeVeiculoPorId(item.veiculo_id))}</td>
        <td>${formatarValor(item.descontos)}${descontoDetalhe}</td>
        <td class="positive"><strong>${formatarValor(item.valor_total_receber)}</strong></td>
        <td><span class="status-pill ${escapeHtml(status)}">${escapeHtml(status)}</span></td>
        <td>
          <div class="action-row">
            <button class="small-btn ${classeBotaoStatus}" onclick="alterarStatusContaReceber(${item.id}, '${proximoStatus}')">${textoBotaoStatus}</button>
            <button class="small-btn edit-btn" onclick="editarContaReceberPorId(${item.id})">Editar</button>
            <button class="small-btn delete-btn" onclick="excluirContaReceber(${item.id})">Excluir</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  total.textContent = `${contas.length} registro(s)`;
}

async function carregarContasReceber() {
  const params = new URLSearchParams();
  const dataInicial = document.getElementById("cr-filtro-data-inicial")?.value || "";
  const dataFinal = document.getElementById("cr-filtro-data-final")?.value || "";
  const contrato = document.getElementById("cr-filtro-contrato")?.value.trim() || "";
  const tomador = document.getElementById("cr-filtro-tomador")?.value.trim() || "";
  const veiculoId = document.getElementById("cr-filtro-veiculo-id")?.value || "";

  if (dataInicial) params.append("data_inicial", dataInicial);
  if (dataFinal) params.append("data_final", dataFinal);
  if (contrato) params.append("contrato", contrato);
  if (tomador) params.append("tomador", tomador);
  if (veiculoId) params.append("veiculo_id", veiculoId);

  const url = params.toString() ? `/contas-receber?${params.toString()}` : "/contas-receber";
  const contas = await apiGet(url);
  renderizarTabelaContasReceber(contas);
}

window.editarContaReceberPorId = async (id) => {
  const contas = await apiGet("/contas-receber");
  const item = contas.find(registro => registro.id === id);
  if (!item) return;

  editandoContaReceberId = item.id;
  preencherFormContaReceber(item);
};

window.excluirContaReceber = async (id) => {
  if (!confirm("Deseja excluir esta conta a receber?")) return;

  await apiDelete(`/contas-receber/${id}`);
  await carregarContasReceber();
};

// Altera o status de pagamento de uma conta (pendente ↔ recebido) via PATCH.
// Exposta globalmente para ser chamada pelo onclick da tabela.
// Recarrega a tabela após a alteração para refletir o novo status e KPIs.
window.alterarStatusContaReceber = async (id, statusPagamento) => {
  await apiSend(`/contas-receber/${id}/status`, "PATCH", {
    status_pagamento: statusPagamento
  });
  await carregarContasReceber();
};

async function iniciarContasReceber() {
  await carregarOpcoesContasReceber();
  await carregarContasReceber();

  const form = document.getElementById("form-conta-receber");
  const mensagem = document.getElementById("mensagem-conta-receber");
  const btnCancelar = document.getElementById("btn-cancelar-conta-receber");
  const btnFiltrar = document.getElementById("btn-filtrar-contas-receber");
  const btnLimpar = document.getElementById("btn-limpar-contas-receber");
  const btnImprimir = document.getElementById("btn-imprimir-contas-receber");

  ["cr-valor", "cr-valor-hora-unitario", "cr-quantidade-horas", "cr-bonificacao", "cr-descontos"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", atualizarTotalReceberPreview);
  });
  document.getElementById("cr-veiculo-id")?.addEventListener("change", atualizarCamposMaquinaContaReceber);
  atualizarCamposMaquinaContaReceber();
  atualizarTotalReceberPreview();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const url = editandoContaReceberId ? `/contas-receber/${editandoContaReceberId}` : "/contas-receber";
    const method = editandoContaReceberId ? "PUT" : "POST";

    try {
      await apiSend(url, method, montarPayloadContaReceber());
      mensagem.textContent = editandoContaReceberId
        ? "Conta a receber alterada com sucesso."
        : "Conta a receber salva com sucesso.";
      resetFormContaReceber();
      await carregarContasReceber();
    } catch (error) {
      mensagem.textContent = error.message;
    }
  });

  btnCancelar.addEventListener("click", resetFormContaReceber);
  btnFiltrar.addEventListener("click", async () => {
    await carregarContasReceber();
    fecharPopupFiltros("painel-filtros-contas-receber");
  });
  btnImprimir.addEventListener("click", () => imprimirElementoPorId("tabela-impressao-contas-receber"));

  btnLimpar.addEventListener("click", async () => {
    document.getElementById("cr-filtro-data-inicial").value = "";
    document.getElementById("cr-filtro-data-final").value = "";
    document.getElementById("cr-filtro-contrato").value = "";
    document.getElementById("cr-filtro-tomador").value = "";
    document.getElementById("cr-filtro-veiculo-id").value = "";
    await carregarContasReceber();
    fecharPopupFiltros("painel-filtros-contas-receber");
  });
}

// =========================================================
// MODULO DE ATIVOS E PASSIVOS
//
// Controla o patrimônio da empresa: ativos (bens: veículos, máquinas,
// imóveis, equipamentos) e passivos (financiamentos, empréstimos, dívidas).
//
// Os KPIs de topo (total ativos, total passivos, patrimônio líquido) são
// calculados pelo backend em /relatorios/patrimonio-liquido.
//
// Edição: ao clicar em "Editar", os campos do formulário são preenchidos
// e o modo muda para PUT. Cancelar reseta para POST.
// =========================================================

// Utilitário genérico para preencher qualquer select de veículos no sistema.
// Verifica se o select já tem opções (evita duplicação em re-renders).
// Usado em ativos, dashboard e outros módulos que precisam do select de veículos.
async function carregarSelectVeiculosGenerico(selectId, vazio = "Sem vinculo") {
  const select = document.getElementById(selectId);
  if (!select) return;
  if (select.options.length > 1) return;
  const veiculos = await carregarVeiculos();
  select.innerHTML = `<option value="">${vazio}</option>`;
  veiculos.forEach((veiculo) => {
    const option = document.createElement("option");
    option.value = veiculo.id;
    option.textContent = `${veiculo.nome || veiculo.modelo || "Veiculo"}${veiculo.placa ? ` - ${veiculo.placa}` : ""}`;
    select.appendChild(option);
  });
}

// Carrega ativos, passivos e patrimônio em paralelo (Promise.all).
// Atualiza os 3 KPIs de topo e preenche as duas tabelas usando preencherTabela().
async function carregarAtivosPassivos() {
  const [ativos, passivos, patrimonio] = await Promise.all([
    apiGet("/ativos"),
    apiGet("/passivos"),
    apiGet("/relatorios/patrimonio-liquido")
  ]);

  document.getElementById("ap-total-ativos").textContent = formatarValor(patrimonio.total_ativos);
  document.getElementById("ap-total-passivos").textContent = formatarValor(patrimonio.total_passivos);
  document.getElementById("ap-patrimonio").textContent = formatarValor(patrimonio.patrimonio_liquido);

  preencherTabela("tabela-ativos", ativos, [
    i => i.nome,
    i => i.tipo,
    i => formatarValor(i.valor),
    i => formatarDataCurta(i.data_aquisicao),
    i => `<span class="status-pill neutral">${i.status}</span>`,
    i => `<div class="action-row"><button class="small-btn edit-btn" onclick="editarAtivo(${i.id})">Editar</button><button class="small-btn delete-btn" onclick="excluirAtivo(${i.id})">Excluir</button></div>`
  ]);

  preencherTabela("tabela-passivos", passivos, [
    i => i.nome,
    i => i.tipo,
    i => formatarValor(i.valor_total),
    i => formatarValor(i.valor_pago),
    i => formatarValor(i.saldo_devedor),
    i => formatarDataCurta(i.data_vencimento),
    i => `<div class="action-row"><button class="small-btn edit-btn" onclick="editarPassivo(${i.id})">Editar</button><button class="small-btn delete-btn" onclick="excluirPassivo(${i.id})">Excluir</button></div>`
  ]);
}

function payloadAtivo() {
  return {
    nome: document.getElementById("ativo-nome").value.trim(),
    tipo: document.getElementById("ativo-tipo").value,
    valor: normalizarNumero(document.getElementById("ativo-valor").value),
    data_aquisicao: document.getElementById("ativo-data").value || null,
    veiculo_id: document.getElementById("ativo-veiculo-id").value ? Number(document.getElementById("ativo-veiculo-id").value) : null,
    observacao: document.getElementById("ativo-observacao").value.trim(),
    status: document.getElementById("ativo-status").value.trim() || "Ativo"
  };
}

function payloadPassivo() {
  return {
    nome: document.getElementById("passivo-nome").value.trim(),
    tipo: document.getElementById("passivo-tipo").value,
    valor_total: normalizarNumero(document.getElementById("passivo-valor-total").value),
    valor_pago: normalizarNumero(document.getElementById("passivo-valor-pago").value),
    data_inicio: document.getElementById("passivo-data-inicio").value || null,
    data_vencimento: document.getElementById("passivo-data-vencimento").value || null,
    observacao: document.getElementById("passivo-observacao").value.trim(),
    status: document.getElementById("passivo-status").value.trim() || "Pendente"
  };
}

function resetAtivo() {
  editandoAtivoId = null;
  document.getElementById("form-ativo").reset();
  document.getElementById("btn-cancelar-ativo").style.display = "none";
  document.getElementById("titulo-form-ativo").textContent = "Novo ativo";
}

function resetPassivo() {
  editandoPassivoId = null;
  document.getElementById("form-passivo").reset();
  document.getElementById("btn-cancelar-passivo").style.display = "none";
  document.getElementById("titulo-form-passivo").textContent = "Novo passivo";
}

window.editarAtivo = async (id) => {
  const item = (await apiGet("/ativos")).find(registro => registro.id === id);
  if (!item) return;
  editandoAtivoId = id;
  document.getElementById("ativo-nome").value = item.nome || "";
  document.getElementById("ativo-tipo").value = item.tipo || "Outro";
  document.getElementById("ativo-valor").value = item.valor || "";
  document.getElementById("ativo-data").value = item.data_aquisicao || "";
  document.getElementById("ativo-veiculo-id").value = item.veiculo_id || "";
  document.getElementById("ativo-observacao").value = item.observacao || "";
  document.getElementById("ativo-status").value = item.status || "Ativo";
  document.getElementById("btn-cancelar-ativo").style.display = "inline-block";
  document.getElementById("titulo-form-ativo").textContent = "Alterar ativo";
};

window.editarPassivo = async (id) => {
  const item = (await apiGet("/passivos")).find(registro => registro.id === id);
  if (!item) return;
  editandoPassivoId = id;
  document.getElementById("passivo-nome").value = item.nome || "";
  document.getElementById("passivo-tipo").value = item.tipo || "Outro";
  document.getElementById("passivo-valor-total").value = item.valor_total || "";
  document.getElementById("passivo-valor-pago").value = item.valor_pago || "";
  document.getElementById("passivo-data-inicio").value = item.data_inicio || "";
  document.getElementById("passivo-data-vencimento").value = item.data_vencimento || "";
  document.getElementById("passivo-observacao").value = item.observacao || "";
  document.getElementById("passivo-status").value = item.status || "Pendente";
  document.getElementById("btn-cancelar-passivo").style.display = "inline-block";
  document.getElementById("titulo-form-passivo").textContent = "Alterar passivo";
};

window.excluirAtivo = async (id) => {
  if (!confirm("Deseja excluir este ativo?")) return;
  await apiDelete(`/ativos/${id}`);
  mostrarToast("Ativo excluido.", "success");
  await carregarAtivosPassivos();
};

window.excluirPassivo = async (id) => {
  if (!confirm("Deseja excluir este passivo?")) return;
  await apiDelete(`/passivos/${id}`);
  mostrarToast("Passivo excluido.", "success");
  await carregarAtivosPassivos();
};

async function iniciarAtivosPassivos() {
  await carregarSelectVeiculosGenerico("ativo-veiculo-id");
  await carregarAtivosPassivos();
  document.getElementById("form-ativo").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await apiSend(editandoAtivoId ? `/ativos/${editandoAtivoId}` : "/ativos", editandoAtivoId ? "PUT" : "POST", payloadAtivo());
      resetAtivo();
      mostrarToast("Ativo salvo.", "success");
      await carregarAtivosPassivos();
    } catch (erro) {
      document.getElementById("mensagem-ativo").textContent = erro.message;
      mostrarToast(erro.message, "error");
    }
  });
  document.getElementById("form-passivo").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await apiSend(editandoPassivoId ? `/passivos/${editandoPassivoId}` : "/passivos", editandoPassivoId ? "PUT" : "POST", payloadPassivo());
      resetPassivo();
      mostrarToast("Passivo salvo.", "success");
      await carregarAtivosPassivos();
    } catch (erro) {
      document.getElementById("mensagem-passivo").textContent = erro.message;
      mostrarToast(erro.message, "error");
    }
  });
  document.getElementById("btn-cancelar-ativo").addEventListener("click", resetAtivo);
  document.getElementById("btn-cancelar-passivo").addEventListener("click", resetPassivo);
}

// =========================================================
// MODULO DE ESTOQUE
//
// Gerencia o inventário de produtos da empresa (lubrificantes,
// peças, insumos etc.). Cada produto tem: nome, categoria, unidade,
// quantidade atual, custo unitário, estoque mínimo e observação.
//
// Movimentações: Entrada, Saída e Ajuste registradas com data,
// valor unitário e observação. Saídas via lançamento são automáticas.
//
// Alerta de estoque baixo: produto marcado quando quantidade_atual
// cai abaixo de estoque_minimo. Exibido com badge "baixo" na tabela.
//
// Edição: três modos coexistem na mesma tela:
//   1. Painel "Novo produto" (#estoque-inline-container, toggle)
//   2. Painel "Movimentar" (#estoque-inline-container, toggle)
//   3. Edição inline por linha da tabela (editarProduto — injeta <tr>)
//   Abrindo um painel fecha o outro automaticamente.
// =========================================================

// Carrega produtos, movimentações e relatório de estoque em paralelo.
// Aplica filtros (nome, categoria, estoque baixo) via query string.
// Atualiza KPIs, tabela de produtos, tabela de movimentações e select de produto no painel.
async function carregarEstoque() {
  const params = new URLSearchParams();
  const nome = document.getElementById("filtro-produto-nome")?.value.trim() || "";
  const categoria = document.getElementById("filtro-produto-categoria")?.value.trim() || "";
  const baixo = document.getElementById("filtro-produto-baixo")?.value || "";
  if (nome) params.append("nome", nome);
  if (categoria) params.append("categoria", categoria);
  if (baixo) params.append("estoque_baixo", baixo);
  const query = params.toString() ? `?${params.toString()}` : "";
  const [produtos, movimentacoes, relatorio] = await Promise.all([
    apiGet(`/estoque/produtos${query}`),
    apiGet("/estoque/movimentacoes"),
    apiGet("/relatorios/estoque")
  ]);
  document.getElementById("est-total-produtos").textContent = relatorio.total_produtos;
  document.getElementById("est-valor-total").textContent = formatarValor(relatorio.valor_total_estoque);
  document.getElementById("est-baixo").textContent = relatorio.produtos_estoque_baixo;
  document.getElementById("est-ultimas").textContent = relatorio.ultimas_movimentacoes.length;
  preencherTabela("tabela-produtos", produtos, [
    i => `${i.nome}${i.estoque_baixo ? ' <span class="status-pill warning">baixo</span>' : ""}`,
    i => i.categoria || "-",
    i => `${i.quantidade_atual} ${i.unidade_medida}`,
    i => formatarValor(i.valor_custo),
    i => formatarValor(i.valor_total_estoque),
    i => i.estoque_minimo,
    i => `<div class="action-row"><button class="small-btn edit-btn" onclick="editarProduto(${i.id}, this)">Editar</button><button class="small-btn delete-btn" onclick="excluirProduto(${i.id})">Excluir</button></div>`
  ]);
  const select = document.getElementById("mov-produto-id");
  if (select) select.innerHTML = produtos.map(item => `<option value="${item.id}">${item.nome}</option>`).join("");
  preencherTabela("tabela-movimentacoes", movimentacoes, [
    i => formatarDataCurta(i.data),
    i => (relatorio.produtos.find(p => p.id === i.produto_id)?.nome || i.produto_id),
    i => i.tipo_movimentacao,
    i => i.quantidade,
    i => formatarValor(i.valor_unitario),
    i => i.observacao || ""
  ]);
}

function payloadProduto() {
  return {
    nome: document.getElementById("produto-nome").value.trim(),
    categoria: document.getElementById("produto-categoria").value.trim(),
    unidade_medida: document.getElementById("produto-unidade").value.trim() || "un",
    quantidade_atual: normalizarNumero(document.getElementById("produto-quantidade").value),
    valor_custo: normalizarNumero(document.getElementById("produto-valor").value),
    estoque_minimo: normalizarNumero(document.getElementById("produto-minimo").value),
    observacao: document.getElementById("produto-observacao").value.trim()
  };
}

// =========================================================
// ESTOQUE — Painéis inline (sem popup ou janela flutuante)
//
// Os botões "Novo produto" e "Movimentar" abrem painéis
// diretamente na página, logo abaixo da barra de ações,
// dentro do div#estoque-inline-container.
//
// Comportamento:
//   - Clicar no mesmo botão novamente fecha o painel (toggle)
//   - Abrir um painel fecha o outro automaticamente
//   - ESC também fecha o painel aberto
//   - dataset.aberto rastreia qual painel está visível ("produto" | "movimentacao")
//
// O painel de edição de linha (editarProduto) usa mecanismo diferente:
//   injeta uma <tr> diretamente abaixo da linha editada na tabela.
// =========================================================

// Remove o conteúdo do container de painéis inline e reseta o estado "aberto".
// Chamada antes de abrir qualquer painel para garantir que apenas um fique visível.
function fecharPainelEstoque() {
  const container = document.getElementById("estoque-inline-container");
  if (container) { container.innerHTML = ""; delete container.dataset.aberto; }
}

// Abre o painel inline de cadastro de novo produto ou fecha se já estiver aberto (toggle).
// Injeta o formulário em #estoque-inline-container e foca o campo "Nome".
// O submit chama POST (novo) ou PUT (edição via editandoProdutoId) conforme o estado.
function abrirPainelProduto() {
  const container = document.getElementById("estoque-inline-container");
  if (container.dataset.aberto === "produto") { fecharPainelEstoque(); return; }
  fecharPainelEstoque();
  fecharEdicaoInline();
  container.dataset.aberto = "produto";
  container.innerHTML = `
    <div class="edit-inline-form" style="margin-bottom:18px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h4 style="margin:0;" id="titulo-form-produto">Novo produto</h4>
        <button class="ghost-btn" type="button" id="btn-fechar-painel-produto">Fechar</button>
      </div>
      <form id="form-produto">
        <div class="edit-inline-fields">
          <div class="field"><label>Nome *</label><input id="produto-nome" required placeholder="Ex: Oleo lubrificante 15W-40" /></div>
          <div class="field"><label>Categoria</label><input id="produto-categoria" placeholder="Ex: Lubrificantes" /></div>
          <div class="field"><label>Unidade</label><input id="produto-unidade" value="un" placeholder="un, L, kg..." /></div>
          <div class="field"><label>Quantidade atual</label><input type="number" step="0.001" id="produto-quantidade" placeholder="0" /></div>
          <div class="field"><label>Valor de custo (unit.)</label><input type="number" step="0.01" id="produto-valor" placeholder="0,00" /></div>
          <div class="field"><label>Estoque minimo</label><input type="number" step="0.001" id="produto-minimo" placeholder="0" /></div>
          <div class="field field-obs"><label>Observacao</label><input id="produto-observacao" placeholder="Informacoes adicionais..." /></div>
        </div>
        <div class="edit-inline-actions">
          <button class="primary-btn" type="submit">Salvar produto</button>
          <button class="ghost-btn" type="button" id="btn-cancelar-produto">Cancelar</button>
          <span id="mensagem-produto" class="mensagem"></span>
        </div>
      </form>
    </div>
  `;
  document.getElementById("produto-nome").focus();
  document.getElementById("btn-fechar-painel-produto").addEventListener("click", resetProduto);
  document.getElementById("btn-cancelar-produto").addEventListener("click", resetProduto);
  document.getElementById("form-produto").addEventListener("submit", async (event) => {
    event.preventDefault();
    const msgEl = document.getElementById("mensagem-produto");
    msgEl.textContent = "";
    try {
      await apiSend(editandoProdutoId ? `/estoque/produtos/${editandoProdutoId}` : "/estoque/produtos", editandoProdutoId ? "PUT" : "POST", payloadProduto());
      resetProduto();
      mostrarToast("Produto salvo.", "success");
      await carregarEstoque();
    } catch (erro) {
      msgEl.textContent = erro.message;
      mostrarToast(erro.message, "error");
    }
  });
}

// Abre o painel inline de movimentação de estoque (toggle).
// Carrega a lista de produtos para o select antes de renderizar o formulário.
// Tipos disponíveis: Entrada, Saída, Ajuste. Registra em /estoque/movimentacoes.
async function abrirPainelMovimentacao() {
  const container = document.getElementById("estoque-inline-container");
  if (container.dataset.aberto === "movimentacao") { fecharPainelEstoque(); return; }
  fecharPainelEstoque();
  fecharEdicaoInline();
  container.dataset.aberto = "movimentacao";
  const produtos = await apiGet("/estoque/produtos");
  const hoje = new Date().toISOString().slice(0, 10);
  container.innerHTML = `
    <div class="edit-inline-form" style="margin-bottom:18px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h4 style="margin:0;">Movimentar estoque</h4>
        <button class="ghost-btn" type="button" id="btn-fechar-painel-mov">Fechar</button>
      </div>
      <form id="form-movimentacao">
        <div class="edit-inline-fields">
          <div class="field"><label>Produto *</label><select id="mov-produto-id">${produtos.map(p => `<option value="${p.id}">${p.nome}</option>`).join("")}</select></div>
          <div class="field"><label>Tipo</label><select id="mov-tipo"><option>Entrada</option><option>Saida</option><option>Ajuste</option></select></div>
          <div class="field"><label>Quantidade *</label><input type="number" step="0.001" id="mov-quantidade" required placeholder="0" /></div>
          <div class="field"><label>Valor unitario</label><input type="number" step="0.01" id="mov-valor" placeholder="0,00" /></div>
          <div class="field"><label>Data *</label><input type="date" id="mov-data" required value="${hoje}" /></div>
          <div class="field"><label>Observacao</label><input id="mov-observacao" placeholder="Motivo, NF, fornecedor..." /></div>
        </div>
        <div class="edit-inline-actions">
          <button class="primary-btn" type="submit">Registrar movimentacao</button>
          <button class="ghost-btn" type="button" id="btn-cancelar-movimentacao">Cancelar</button>
          <span id="mensagem-movimentacao" class="mensagem"></span>
        </div>
      </form>
    </div>
  `;
  document.getElementById("btn-fechar-painel-mov").addEventListener("click", fecharPainelEstoque);
  document.getElementById("btn-cancelar-movimentacao").addEventListener("click", fecharPainelEstoque);
  document.getElementById("form-movimentacao").addEventListener("submit", async (event) => {
    event.preventDefault();
    const msgEl = document.getElementById("mensagem-movimentacao");
    msgEl.textContent = "";
    try {
      await apiSend("/estoque/movimentacoes", "POST", {
        produto_id: Number(document.getElementById("mov-produto-id").value),
        tipo_movimentacao: document.getElementById("mov-tipo").value,
        quantidade: normalizarNumero(document.getElementById("mov-quantidade").value),
        valor_unitario: normalizarNumero(document.getElementById("mov-valor").value),
        data: document.getElementById("mov-data").value,
        observacao: document.getElementById("mov-observacao").value.trim()
      });
      fecharPainelEstoque();
      mostrarToast("Movimentacao registrada.", "success");
      await carregarEstoque();
    } catch (erro) {
      msgEl.textContent = erro.message;
      mostrarToast(erro.message, "error");
    }
  });
}

function resetProduto() {
  editandoProdutoId = null;
  fecharPainelEstoque();
  fecharEdicaoInline();
}

// Edição inline de produto diretamente na linha da tabela (modo toggle).
// Ao clicar em "Editar", injeta uma <tr class="edit-inline-row"> logo abaixo da linha.
// Clicar novamente no mesmo produto fecha o editor (remove a <tr>).
// Clicar em outro produto remove o editor anterior e abre o novo.
// Os dados atuais do produto são carregados e pré-preenchidos nos campos inline.
// Salvar chama apiPut (PUT) via salvarEdicaoInline(). Cancelar remove a <tr>.
window.editarProduto = async (id, btn) => {
  const existente = document.getElementById(`edit-row-${id}`);
  document.querySelectorAll(".edit-inline-row").forEach(r => r.remove());
  if (existente) { editandoProdutoId = null; return; }

  const item = (await apiGet("/estoque/produtos")).find(r => r.id === id);
  if (!item) return;
  editandoProdutoId = id;

  const tr = btn.closest("tr");
  tr.insertAdjacentHTML("afterend", `
    <tr class="edit-inline-row" id="edit-row-${id}">
      <td colspan="${tr.cells.length}">
        <div class="edit-inline-form">
          <div class="edit-inline-fields">
            <div class="field"><label>Nome *</label><input id="edit-nome" required /></div>
            <div class="field"><label>Categoria</label><input id="edit-categoria" /></div>
            <div class="field"><label>Unidade</label><input id="edit-unidade" /></div>
            <div class="field"><label>Quantidade</label><input type="number" step="0.001" id="edit-quantidade" /></div>
            <div class="field"><label>Valor custo</label><input type="number" step="0.01" id="edit-valor" /></div>
            <div class="field"><label>Estoque min.</label><input type="number" step="0.001" id="edit-minimo" /></div>
            <div class="field field-obs"><label>Observacao</label><input id="edit-obs" /></div>
          </div>
          <div class="edit-inline-actions">
            <button class="primary-btn" type="button" id="btn-salvar-inline">Salvar</button>
            <button class="ghost-btn" type="button" id="btn-cancelar-inline">Cancelar</button>
            <span id="edit-mensagem" class="mensagem"></span>
          </div>
        </div>
      </td>
    </tr>
  `);

  document.getElementById("edit-nome").value = item.nome || "";
  document.getElementById("edit-categoria").value = item.categoria || "";
  document.getElementById("edit-unidade").value = item.unidade_medida || "un";
  document.getElementById("edit-quantidade").value = item.quantidade_atual || "";
  document.getElementById("edit-valor").value = item.valor_custo || "";
  document.getElementById("edit-minimo").value = item.estoque_minimo || "";
  document.getElementById("edit-obs").value = item.observacao || "";
  document.getElementById("edit-nome").focus();

  document.getElementById("btn-salvar-inline").addEventListener("click", () => salvarEdicaoInline(id));
  document.getElementById("btn-cancelar-inline").addEventListener("click", fecharEdicaoInline);
};

// Remove todas as linhas de edição inline da tabela de estoque e reseta o estado.
function fecharEdicaoInline() {
  document.querySelectorAll(".edit-inline-row").forEach(r => r.remove());
  editandoProdutoId = null;
}

// Coleta os campos do editor inline, valida o nome e chama PUT /estoque/produtos/{id}.
// Em caso de sucesso: fecha o editor e recarrega a tabela de estoque.
// Em caso de erro: exibe mensagem dentro do próprio editor inline.
async function salvarEdicaoInline(id) {
  const payload = {
    nome: document.getElementById("edit-nome").value.trim(),
    categoria: document.getElementById("edit-categoria").value.trim(),
    unidade_medida: document.getElementById("edit-unidade").value.trim() || "un",
    quantidade_atual: normalizarNumero(document.getElementById("edit-quantidade").value),
    valor_custo: normalizarNumero(document.getElementById("edit-valor").value),
    estoque_minimo: normalizarNumero(document.getElementById("edit-minimo").value),
    observacao: document.getElementById("edit-obs").value.trim(),
  };
  if (!payload.nome) {
    document.getElementById("edit-mensagem").textContent = "Nome obrigatorio.";
    return;
  }
  try {
    await apiPut(`/estoque/produtos/${id}`, payload);
    fecharEdicaoInline();
    mostrarToast("Produto salvo.", "success");
    await carregarEstoque();
  } catch (erro) {
    document.getElementById("edit-mensagem").textContent = erro.message;
  }
}

window.excluirProduto = async (id) => {
  if (!confirm("Deseja excluir este produto?")) return;
  await apiDelete(`/estoque/produtos/${id}`);
  mostrarToast("Produto excluido.", "success");
  await carregarEstoque();
};

// Ponto de entrada do módulo de estoque. Carrega os dados iniciais e conecta:
//   - Botões "Novo produto" e "Movimentar"
//   - Tecla ESC para fechar painéis/editores ativos
//   - Botões de filtrar e limpar filtros do popup
async function iniciarEstoque() {
  await carregarEstoque();

  document.getElementById("btn-novo-produto").addEventListener("click", abrirPainelProduto);
  document.getElementById("btn-movimentar-estoque").addEventListener("click", abrirPainelMovimentacao);

  document.addEventListener("keydown", function estoqueEsc(e) {
    if (e.key !== "Escape") return;
    const container = document.getElementById("estoque-inline-container");
    if (container?.dataset.aberto) fecharPainelEstoque();
    if (document.querySelector(".edit-inline-row")) fecharEdicaoInline();
  });

  document.getElementById("btn-filtrar-estoque").addEventListener("click", async () => {
    await carregarEstoque();
    fecharPopupFiltros("painel-filtros-estoque");
  });
  document.getElementById("btn-limpar-estoque").addEventListener("click", async () => {
    document.getElementById("filtro-produto-nome").value = "";
    document.getElementById("filtro-produto-categoria").value = "";
    document.getElementById("filtro-produto-baixo").value = "";
    await carregarEstoque();
    fecharPopupFiltros("painel-filtros-estoque");
  });
}

// =========================================================
// MODULO DE CONFIGURACOES E USUARIOS
//
// Configurações são armazenadas localmente no localStorage
// (não no backend), pois são preferências visuais da máquina:
// nome da empresa, logo, tema, cor principal, moeda e rodapé.
//
// Usuários da empresa são gerenciados via API (/usuarios).
// O painel admin (master) tem gestão mais completa em renderizarAdminUsuarios().
// =========================================================

// Retorna a chave localStorage de configurações isolada por empresa.
// Cada empresa tem seus próprios dados (logo, nome, tema, etc.) no mesmo browser.
function _chaveConfiguracao() {
  const u = obterUsuarioSessao();
  return u.empresa_id ? `financeiro_configuracoes_${u.empresa_id}` : "financeiro_configuracoes";
}

// Lê o objeto de configurações do localStorage. Retorna {} se não existir
// ou se o JSON estiver corrompido (ex: escrita interrompida por crash do tab).
// Em caso de erro, limpa a chave corrompida para evitar falhas futuras.
function carregarConfiguracoesLocais() {
  try {
    return JSON.parse(localStorage.getItem(_chaveConfiguracao()) || "{}");
  } catch {
    try { localStorage.removeItem(_chaveConfiguracao()); } catch { /* ignore */ }
    return {};
  }
}

// Busca logo e nome da empresa no servidor e sincroniza com o localStorage.
// Chamada uma vez após o login para garantir que todos os usuários da mesma
// empresa vejam a mesma logo, independente do dispositivo.
async function sincronizarConfiguracaoEmpresa() {
  try {
    const dados = await apiGet("/configuracoes-empresa");
    const config = carregarConfiguracoesLocais();
    // Servidor tem prioridade para logo e nome (campos compartilhados)
    config.logoEmpresa = dados.logoEmpresa ?? config.logoEmpresa ?? "";
    if (dados.nomeEmpresa) config.nomeEmpresa = dados.nomeEmpresa;
    localStorage.setItem(_chaveConfiguracao(), JSON.stringify(config));
    aplicarMarca();
  } catch (_) {
    // Falha silenciosa — usa cache local (ex: offline, sem permissão)
  }
}

// Aplica o tema (dark/light) e a cor principal ao DOM imediatamente.
// Chamada na inicialização e sempre que o tema for alterado (toggle ou configurações).
// data-theme no <body> controla as variáveis CSS globais do tema.
function aplicarTema() {
  const config = carregarConfiguracoesLocais();
  const tema = config.tema || localStorage.getItem("financeiro_tema") || "dark";
  document.body.dataset.theme = tema;
  document.documentElement.style.setProperty("--blue", config.corPrincipal || "#22D3EE");
}

// Inicializa a página de configurações: pré-preenche com dados salvos e
// conecta o submit para salvar no localStorage e aplicar o tema.
function iniciarConfiguracoes() {
  const config = carregarConfiguracoesLocais();
  document.getElementById("config-empresa").value = config.nomeEmpresa || "";
  document.getElementById("config-logo").value = config.logoEmpresa || "";
  document.getElementById("config-tema").value = config.tema || localStorage.getItem("financeiro_tema") || "dark";
  document.getElementById("config-cor").value = config.corPrincipal || "#22D3EE";
  document.getElementById("config-moeda").value = config.moeda || "BRL";
  document.getElementById("config-relatorio").value = config.dadosRelatorio || "";

  // Pré-exibe logo salva no preview
  if (config.logoEmpresa) {
    _atualizarPreviewLogo(config.logoEmpresa);
  }

  // Botão "Escolher imagem" abre o file input oculto
  document.getElementById("btn-escolher-logo").addEventListener("click", () => {
    document.getElementById("config-logo-file").click();
  });

  // Ao selecionar arquivo: valida, converte para base64, atualiza preview
  document.getElementById("config-logo-file").addEventListener("change", async () => {
    const arquivo = document.getElementById("config-logo-file").files[0];
    if (!arquivo) return;
    if (arquivo.size > 10 * 1024 * 1024) {
      mostrarToast("Imagem muito grande. Use ate 10MB.", "error");
      document.getElementById("config-logo-file").value = "";
      return;
    }
    const base64 = await redimensionarImagem(arquivo, 256, 256, 0.85);
    document.getElementById("config-logo").value = base64;
    _atualizarPreviewLogo(base64);
  });

  // Botão "Remover logo"
  document.getElementById("btn-remover-logo").addEventListener("click", () => {
    document.getElementById("config-logo").value = "";
    document.getElementById("config-logo-file").value = "";
    _atualizarPreviewLogo("");
  });

  document.getElementById("form-configuracoes").addEventListener("submit", async (event) => {
    event.preventDefault();
    const btnSalvar = event.target.querySelector("button[type=submit]");
    if (btnSalvar) btnSalvar.disabled = true;

    const novo = {
      nomeEmpresa: document.getElementById("config-empresa").value.trim(),
      logoEmpresa: document.getElementById("config-logo").value,
      tema: document.getElementById("config-tema").value,
      corPrincipal: document.getElementById("config-cor").value,
      moeda: document.getElementById("config-moeda").value.trim() || "BRL",
      dadosRelatorio: document.getElementById("config-relatorio").value.trim()
    };

    // 1. Salva localmente (instantâneo)
    localStorage.setItem(_chaveConfiguracao(), JSON.stringify(novo));
    localStorage.setItem("financeiro_tema", novo.tema);
    aplicarTema();
    aplicarMarca();

    // 2. Persiste logo e nome no servidor (compartilhado entre todos os usuários da empresa)
    try {
      await apiSend("/configuracoes-empresa", "PUT", {
        nomeEmpresa: novo.nomeEmpresa,
        logoEmpresa: novo.logoEmpresa,
      });
      mostrarToast("Configuracoes salvas e sincronizadas com a empresa.", "success");
    } catch (erro) {
      // Salvo localmente, mas falhou no servidor (ex: sem permissão)
      mostrarToast(`Salvo localmente. Sincronizacao: ${erro.message}`, "warn");
    } finally {
      if (btnSalvar) btnSalvar.disabled = false;
    }
  });
}

// Atualiza o preview da logo na tela de configuracoes
function _atualizarPreviewLogo(src) {
  const box = document.getElementById("logo-preview-box");
  const placeholder = document.getElementById("logo-preview-placeholder");
  const btnRemover = document.getElementById("btn-remover-logo");
  if (!box) return;
  if (src) {
    placeholder.style.display = "none";
    let img = box.querySelector("img");
    if (!img) {
      img = document.createElement("img");
      img.style.cssText = "width:100%;height:100%;object-fit:contain;";
      box.appendChild(img);
    }
    img.src = src;
    btnRemover.style.display = "inline-block";
  } else {
    const img = box.querySelector("img");
    if (img) img.remove();
    placeholder.style.display = "";
    btnRemover.style.display = "none";
  }
}

// Aplica logo e nome da empresa na sidebar e na topbar mobile.
// Chamada na inicialização e sempre que as configurações mudarem.
function aplicarMarca() {
  const config = carregarConfiguracoesLocais();
  const iconEl        = document.getElementById("brand-icon");          // sidebar
  const nomeEl        = document.getElementById("brand-nome");          // sidebar
  const topbarIconEl  = document.getElementById("topbar-brand-icon");   // topbar mobile (ícone)
  const topbarNomeEl  = document.getElementById("topbar-brand-name");   // topbar mobile (nome)
  if (!iconEl || !nomeEl) return;

  const logo   = config.logoEmpresa || "";
  const nome   = config.nomeEmpresa || "Financeiro";
  const inicial = nome.charAt(0).toUpperCase();

  // Aplica logo ou inicial em qualquer elemento de brand icon
  function _setBrandIcon(el) {
    if (!el) return;
    if (logo) {
      el.style.background = "none";
      el.style.boxShadow  = "none";
      el.innerHTML = `<img src="${logo}" alt="Logo" style="width:100%;height:100%;object-fit:cover;display:block;">`;
    } else {
      el.style.background = "";
      el.style.boxShadow  = "";
      el.textContent = inicial;
    }
  }

  _setBrandIcon(iconEl);       // ícone na sidebar
  _setBrandIcon(topbarIconEl); // ícone na topbar mobile

  nomeEl.textContent = nome;               // nome na sidebar
  if (topbarNomeEl) topbarNomeEl.textContent = nome; // nome abaixo do ícone na topbar mobile

  _atualizarManifestoPWA(logo, nome);
}

// Preenche o rodapé da sidebar com nome, perfil e avatar do usuário logado.
// Chamada uma vez na inicialização, após obterUsuarioSessao().
function aplicarInfoUsuarioSidebar() {
  const u = obterUsuarioSessao();
  const nameEl = document.getElementById("sidebar-user-name");
  const roleEl = document.getElementById("sidebar-user-role");
  const avatarEl = document.getElementById("sidebar-user-avatar");
  if (!nameEl || !roleEl || !avatarEl) return;

  const nome = u.nome || u.email || "Usuário";
  const perfil = u.perfil || "";
  nameEl.textContent = nome;
  roleEl.textContent = perfil;
  // Avatar: inicial do nome (não usa foto para economizar espaço)
  avatarEl.textContent = nome.charAt(0).toUpperCase();
}

// Redimensiona a logo para um ícone PWA quadrado via Canvas.
// Retorna uma Promise<string> com data: URI PNG no tamanho exato.
// Adiciona fundo escuro (#0B0F1A) para icons "maskable" ficarem bem em qualquer forma.
function _redimensionarIconePWA(logoBase64, tamanho) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width  = tamanho;
      canvas.height = tamanho;
      const ctx = canvas.getContext("2d");

      // Fundo sólido — obrigatório para ícones maskable (Android adapta a forma)
      ctx.fillStyle = "#0B0F1A";
      ctx.fillRect(0, 0, tamanho, tamanho);

      // Logo centralizada com 15% de padding para não colar nas bordas
      const pad  = tamanho * 0.15;
      const size = tamanho - pad * 2;
      ctx.drawImage(img, pad, pad, size, size);

      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = logoBase64;
  });
}

// Substitui o manifesto PWA por um blob com a logo e nome da empresa.
// Gera ícones nos tamanhos 192×192 e 512×512 via Canvas para atender
// exatamente os requisitos do Chrome (tamanhos separados + tipo correto).
// O Chrome re-avalia a elegibilidade de instalação quando o href muda.
async function _atualizarManifestoPWA(logo, nome) {
  // IMPORTANTE: o manifesto SEMPRE usa URLs estáticas para os ícones.
  // data: URIs como src de ícone são rejeitados pelo Chrome e invalidam o PWA,
  // fazendo o navegador criar um atalho em vez de instalar o app corretamente.
  // O logo real da empresa é injetado no Service Worker via postMessage: o SW
  // intercepta as requisições /icons/icon-192.png e /icons/icon-512.png e
  // serve o logo customizado, mantendo as URLs estáticas no manifesto.
  const icones = [
    { src: "/icons/icon-192.png",       sizes: "192x192", type: "image/png",     purpose: "any" },
    { src: "/icons/icon-512.png",       sizes: "512x512", type: "image/png",     purpose: "any maskable" },
    { src: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png",   purpose: "any" },
    { src: "/icons/icon.svg",           sizes: "any",     type: "image/svg+xml", purpose: "any maskable" },
  ];

  // Envia o logo da empresa ao SW apenas quando há logo cadastrada.
  // Sem logo → limpa ICON_CACHE → SW cai para fetch() → serve os PNGs
  // estáticos do servidor (icon-192.png / icon-512.png com design GM7 Log).
  // NÃO usa icon.svg como fallback via Canvas: sem Arial Black instalada
  // o Canvas produziria um ícone com visual incorreto.
  if ("serviceWorker" in navigator) {
    try {
      const swReg = await navigator.serviceWorker.ready;
      if (swReg?.active) {
        if (logo) {
          const [ico192, ico512] = await Promise.all([
            _redimensionarIconePWA(logo, 192),
            _redimensionarIconePWA(logo, 512),
          ]);
          swReg.active.postMessage({
            type: "SET_COMPANY_ICON",
            base64_192: ico192,
            base64_512: ico512,
          });
        } else {
          // Sem logo cadastrada: apaga cache antigo para usar os PNGs estáticos
          swReg.active.postMessage({ type: "CLEAR_COMPANY_ICON" });
        }
      }
    } catch {
      // SW não disponível — PNGs estáticos do servidor serão usados diretamente
    }
  }

  // Atualiza apenas o nome da empresa no manifesto via blob: URL.
  // O Chrome re-avalia a elegibilidade de instalação ao detectar a mudança,
  // mas como os ícones são URLs estáticas válidas, o critério é mantido.
  const nomeApp = nome && nome !== "Financeiro" ? `${nome} Financeiro` : "Financeiro";
  const manifesto = {
    name: nomeApp,
    short_name: nome || "Financeiro",
    description: "Sistema financeiro, operacional e de frota.",
    id: "/app", start_url: "/app", scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#0B0F1A", theme_color: "#0B0F1A",
    orientation: "any",
    categories: ["business", "finance", "productivity"],
    icons: icones,
  };

  try {
    const blob = new Blob([JSON.stringify(manifesto)], { type: "application/manifest+json" });
    const url  = URL.createObjectURL(blob);
    const link = document.querySelector("link[rel='manifest']");
    if (!link) return;
    if (link._pwaBlobUrl) URL.revokeObjectURL(link._pwaBlobUrl);
    link._pwaBlobUrl = url;
    link.href = url;
  } catch {
    // Blob URL não suportado — manifesto estático permanece ativo.
  }
}

// Lê o objeto do usuário logado do sessionStorage.
// Retorna {} se não autenticado ou se o JSON estiver corrompido.
// Campos esperados: perfil ("master" | "admin" | "gestor" | etc.), nome, email.
function obterUsuarioSessao() {
  try {
    return JSON.parse(sessionStorage.getItem("financeiro_usuario") || "{}");
  } catch {
    return {};
  }
}

// Aplica restrições de visibilidade no menu lateral baseado no perfil do usuário:
//   - "master": mostra APENAS o botão do painel admin (oculta todo o resto)
//   - outros: oculta o botão admin (que só o master pode acessar)
// Chamada na inicialização e não precisa ser repetida durante a sessão.
function aplicarPermissoesVisuais() {
  const usuario = obterUsuarioSessao();
  navButtons.forEach((button) => {
    const isAdmin = button.dataset.page === "admin";
    if (usuario.perfil === "master") {
      button.hidden = !isAdmin;
      button.style.display = isAdmin ? "" : "none";
      button.classList.toggle("active", isAdmin);
      return;
    }

    button.hidden = isAdmin;
    button.style.display = isAdmin ? "none" : "";
    if (isAdmin) {
      button.classList.remove("active");
    }
  });
}

async function renderizarUsuarios() {
  const tabela = document.getElementById("tabela-usuarios");
  if (!tabela) return;
  try {
    const usuarios = await apiGet("/usuarios");
    tabela.innerHTML = usuarios.map((usuario) => `
      <tr>
        <td>${escapeHtml(usuario.nome)}</td>
        <td>${escapeHtml(usuario.email)}</td>
        <td>${escapeHtml(usuario.perfil)}</td>
        <td>${escapeHtml(usuario.status)}</td>
        <td><button class="small-btn delete-btn" onclick="desativarUsuario(${usuario.id})">Desativar</button></td>
      </tr>
    `).join("") || `<tr><td colspan="5" class="empty-row">Nenhum usuario encontrado.</td></tr>`;
  } catch (erro) {
    tabela.innerHTML = `<tr><td colspan="5" class="empty-row">${escapeHtml(erro.message)}</td></tr>`;
  }
}

function iniciarUsuarios() {
  const form = document.getElementById("form-usuario");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mensagem = document.getElementById("mensagem-usuarios");
    try {
      await apiSend("/usuarios", "POST", {
        nome: document.getElementById("usuario-nome").value.trim(),
        email: document.getElementById("usuario-email").value.trim(),
        senha: document.getElementById("usuario-senha").value,
        perfil: document.getElementById("usuario-perfil").value,
        status: document.getElementById("usuario-status").value
      });
      form.reset();
      mensagem.textContent = "Usuario criado com sucesso.";
      await renderizarUsuarios();
    } catch (erro) {
      mensagem.textContent = erro.message;
    }
  });
  renderizarUsuarios();
}

window.desativarUsuario = async (usuarioId) => {
  if (!confirm("Deseja desativar este usuario?")) return;
  await apiSend(`/usuarios/${usuarioId}/desativar`, "POST", {});
  await renderizarUsuarios();
};

// =========================================================
// MODULO ADMIN MASTER
//
// Acessível apenas ao usuário com perfil "master". Gerencia:
//   - Todas as empresas cadastradas (criar, aprovar, bloquear, desativar)
//   - Todos os usuários do sistema (todas as empresas)
//   - Logs de auditoria de ações administrativas
//   - Acessos do app mobile dos motoristas (motorista.html)
//
// O seletor "Empresa em gerenciamento" filtra usuários e logs
// por empresa, sem recarregar a página.
//
// Modais de cadastro (empresa e usuário) são overlays CSS com
// display:flex/none controlados por abrirModalAdmin/fecharModalAdmin.
// =========================================================

async function renderizarAdminSolicitacoes() {
  const tbody = document.getElementById("tabela-solicitacoes");
  if (!tbody) return;
  const status = document.getElementById("filtro-solicitacao-status")?.value || "";
  try {
    const url = status ? `/solicitacoes-cadastro?status=${encodeURIComponent(status)}` : "/solicitacoes-cadastro";
    const lista = await apiGet(url);
    atualizarBadgeNotificacao(lista.filter(s => s.status === "pendente").length);
    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Nenhuma solicitacao encontrada.</td></tr>`;
      return;
    }
    const badgeClasse = { pendente: "badge-warn", aprovado: "badge-ok", rejeitado: "badge-err" };
    tbody.innerHTML = lista.map(s => `
      <tr>
        <td>${new Date(s.created_at).toLocaleDateString("pt-BR")}</td>
        <td>${s.empresa}</td>
        <td>${s.nome}</td>
        <td>${s.cargo || "-"}</td>
        <td>${s.email}</td>
        <td>${s.whatsapp || "-"}</td>
        <td><span class="badge ${badgeClasse[s.status] || ""}">${s.status}</span></td>
        <td style="display:flex;gap:6px;flex-wrap:wrap;">
          ${s.status === "pendente" ? `
            <button class="primary-btn" style="padding:4px 10px;font-size:12px;" onclick="aprovarSolicitacao(${s.id})">Aprovar</button>
            <button class="ghost-btn" style="padding:4px 10px;font-size:12px;color:var(--danger);" onclick="rejeitarSolicitacao(${s.id})">Rejeitar</button>
          ` : ""}
          <button class="ghost-btn" style="padding:4px 10px;font-size:12px;" onclick="excluirSolicitacao(${s.id})">Excluir</button>
        </td>
      </tr>`).join("");
  } catch {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Erro ao carregar solicitacoes.</td></tr>`;
  }
}

async function aprovarSolicitacao(id) {
  if (!confirm("Aprovar esta solicitacao?")) return;
  await apiSend(`/solicitacoes-cadastro/${id}`, "PATCH", { status: "aprovado", observacao: "" });
  mostrarToast("Solicitacao aprovada.", "success");
  await renderizarAdminSolicitacoes();
}

async function rejeitarSolicitacao(id) {
  if (!confirm("Rejeitar esta solicitacao?")) return;
  await apiSend(`/solicitacoes-cadastro/${id}`, "PATCH", { status: "rejeitado", observacao: "" });
  mostrarToast("Solicitacao rejeitada.", "success");
  await renderizarAdminSolicitacoes();
}

async function excluirSolicitacao(id) {
  if (!confirm("Excluir esta solicitacao permanentemente?")) return;
  await apiDelete(`/solicitacoes-cadastro/${id}`);
  mostrarToast("Solicitacao excluida.", "success");
  await renderizarAdminSolicitacoes();
}

function atualizarBadgeNotificacao(pendentes) {
  const btn = document.getElementById("notification-btn");
  if (!btn) return;
  btn.dataset.badge = pendentes > 0 ? String(pendentes) : "";
}

// Ponto de entrada do painel admin. Carrega todos os dados em paralelo
// e configura todos os eventos: modais, seletor de empresa, logo, forms.
async function iniciarAdminMaster() {
  await Promise.all([renderizarAdminResumo(), renderizarAdminEmpresas(), renderizarAdminUsuarios(), renderizarAdminAuditoria(), renderizarMotoristaAcessos(), renderizarAdminSolicitacoes()]);

  document.getElementById("filtro-solicitacao-status")?.addEventListener("change", () => renderizarAdminSolicitacoes());

  const modalEmpresa = document.getElementById("modal-admin-empresa");
  const modalUsuario = document.getElementById("modal-admin-usuario");
  const abrirModalAdmin = (modal) => {
    if (modal) modal.style.display = "flex";
  };
  const fecharModalAdmin = (modal) => {
    if (modal) modal.style.display = "none";
  };

  document.getElementById("btn-abrir-admin-empresa")?.addEventListener("click", () => abrirModalAdmin(modalEmpresa));
  document.getElementById("btn-fechar-admin-empresa")?.addEventListener("click", () => fecharModalAdmin(modalEmpresa));
  document.getElementById("btn-abrir-admin-usuario")?.addEventListener("click", () => abrirModalAdmin(modalUsuario));
  document.getElementById("btn-fechar-admin-usuario")?.addEventListener("click", () => fecharModalAdmin(modalUsuario));
  [modalEmpresa, modalUsuario].forEach((modal) => {
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) fecharModalAdmin(modal);
    });
  });

  document.getElementById("admin-empresa-gerenciada")?.addEventListener("change", async (event) => {
    adminEmpresaFiltro = event.target.value;
    await Promise.all([renderizarAdminUsuarios(), renderizarAdminAuditoria()]);
  });

  const logoArquivo = document.getElementById("empresa-logo-arquivo");
  logoArquivo?.addEventListener("change", async () => {
    const arquivo = logoArquivo.files?.[0];
    if (!arquivo) return;
    if (arquivo.size > 10 * 1024 * 1024) {
      mostrarToast("Imagem muito grande. Use ate 10MB.", "error");
      logoArquivo.value = "";
      return;
    }
    document.getElementById("empresa-logo").value = await redimensionarImagem(arquivo, 256, 256, 0.85);
  });

  document.getElementById("form-admin-empresa")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mensagem = document.getElementById("mensagem-admin-empresa");
    try {
      await apiSend("/empresas", "POST", {
        nome: document.getElementById("empresa-nome").value.trim(),
        nome_fantasia: document.getElementById("empresa-nome-fantasia").value.trim(),
        cnpj: document.getElementById("empresa-cnpj").value.trim(),
        inscricao_estadual: document.getElementById("empresa-ie").value.trim(),
        telefone: document.getElementById("empresa-telefone").value.trim(),
        email: document.getElementById("empresa-email").value.trim(),
        endereco: document.getElementById("empresa-endereco").value.trim(),
        cidade: document.getElementById("empresa-cidade").value.trim(),
        estado: document.getElementById("empresa-estado").value.trim().toUpperCase(),
        cep: document.getElementById("empresa-cep").value.trim(),
        logo: document.getElementById("empresa-logo").value,
        observacoes: document.getElementById("empresa-observacoes").value.trim(),
        status: document.getElementById("empresa-status").value
      });
      event.target.reset();
      document.getElementById("empresa-logo").value = "";
      mensagem.textContent = "Empresa salva com sucesso.";
      fecharModalAdmin(modalEmpresa);
      await Promise.all([renderizarAdminResumo(), renderizarAdminEmpresas(), preencherSelectEmpresasAdmin()]);
    } catch (erro) {
      mensagem.textContent = erro.message;
    }
  });

  document.getElementById("form-admin-usuario")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mensagem = document.getElementById("mensagem-admin-usuario");
    try {
      await apiSend("/usuarios", "POST", {
        nome: document.getElementById("admin-usuario-nome").value.trim(),
        email: document.getElementById("admin-usuario-email").value.trim(),
        senha: document.getElementById("admin-usuario-senha").value,
        empresa_id: Number(document.getElementById("admin-usuario-empresa").value),
        perfil: document.getElementById("admin-usuario-perfil").value,
        status: document.getElementById("admin-usuario-status").value,
        telefone: document.getElementById("admin-usuario-telefone").value.trim(),
        cargo: document.getElementById("admin-usuario-cargo").value.trim()
      });
      event.target.reset();
      mensagem.textContent = "Usuario salvo com sucesso.";
      fecharModalAdmin(modalUsuario);
      await Promise.all([renderizarAdminResumo(), renderizarAdminUsuarios()]);
    } catch (erro) {
      mensagem.textContent = erro.message;
    }
  });
}

// Busca e exibe os 4 KPIs do painel admin: total de empresas, usuários ativos,
// usuários pendentes de aprovação e empresas bloqueadas/inativas.
async function renderizarAdminResumo() {
  const resumo = await apiGet("/admin/resumo");
  document.getElementById("admin-total-empresas").textContent = resumo.empresas || 0;
  document.getElementById("admin-usuarios-ativos").textContent = resumo.usuarios_ativos || 0;
  document.getElementById("admin-usuarios-pendentes").textContent = resumo.usuarios_pendentes || 0;
  document.getElementById("admin-empresas-bloqueadas").textContent = resumo.empresas_bloqueadas || 0;
}

// Preenche o select de empresa no formulário de usuário admin e o select de filtro.
// Retorna a lista de empresas para reuso em renderizarAdminEmpresas().
// Mantém o valor selecionado (adminEmpresaFiltro) após re-render.
async function preencherSelectEmpresasAdmin() {
  const empresas = await apiGet("/empresas");
  const selectUsuario = document.getElementById("admin-usuario-empresa");
  if (selectUsuario) {
    selectUsuario.innerHTML = empresas.map((empresa) => `<option value="${empresa.id}">${escapeHtml(empresa.nome)}</option>`).join("");
  }
  const selectFiltro = document.getElementById("admin-empresa-gerenciada");
  if (selectFiltro) {
    selectFiltro.innerHTML = `<option value="">Todas as empresas</option>` + empresas.map((empresa) => `<option value="${empresa.id}">${escapeHtml(empresa.nome)}</option>`).join("");
    selectFiltro.value = adminEmpresaFiltro;
  }
  return empresas;
}

// Renderiza a tabela de empresas no painel admin com botões:
// Gerenciar (filtra dados por empresa), Aprovar, Bloquear e Desativar.
async function renderizarAdminEmpresas() {
  const tabela = document.getElementById("tabela-admin-empresas");
  const empresas = await preencherSelectEmpresasAdmin();
  if (!tabela) return;
  tabela.innerHTML = empresas.map((empresa) => `
    <tr>
      <td>${escapeHtml(empresa.nome)}</td>
      <td>${escapeHtml(empresa.cnpj || "-")}</td>
      <td>${escapeHtml(empresa.email || "-")}</td>
      <td>${escapeHtml(empresa.status)}</td>
      <td><div class="action-row">
        <button class="small-btn" onclick="gerenciarEmpresaAdmin(${empresa.id})">Gerenciar</button>
        <button class="small-btn" onclick="acaoEmpresa(${empresa.id}, 'aprovar')">Aprovar</button>
        <button class="small-btn delete-btn" onclick="acaoEmpresa(${empresa.id}, 'bloquear')">Bloquear</button>
        <button class="small-btn delete-btn" onclick="excluirEmpresaAdmin(${empresa.id})">Desativar</button>
      </div></td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="empty-row">Nenhuma empresa cadastrada.</td></tr>`;
}

// Renderiza a tabela de todos os usuários do sistema, com filtro opcional por empresa.
// Carrega empresas em paralelo para exibir o nome da empresa (não o ID).
// Botões: Aprovar, Bloquear, Desativar, Definir senha e Excluir.
async function renderizarAdminUsuarios() {
  const tabela = document.getElementById("tabela-admin-usuarios");
  if (!tabela) return;
  const filtro = adminEmpresaFiltro ? `?empresa_id=${encodeURIComponent(adminEmpresaFiltro)}` : "";
  const [usuarios, empresas] = await Promise.all([apiGet(`/usuarios${filtro}`), apiGet("/empresas")]);
  const nomesEmpresas = new Map(empresas.map((empresa) => [empresa.id, empresa.nome]));
  tabela.innerHTML = usuarios.map((usuario) => `
    <tr>
      <td>${escapeHtml(usuario.nome)}</td>
      <td>${escapeHtml(usuario.email)}</td>
      <td>${escapeHtml(nomesEmpresas.get(usuario.empresa_id) || usuario.empresa_id)}</td>
      <td>${escapeHtml(usuario.perfil)}</td>
      <td>${escapeHtml(usuario.status)}</td>
      <td><span class="status-badge">Protegida</span></td>
      <td>${usuario.ultimo_login ? formatarDataCurta(usuario.ultimo_login) : "-"}</td>
      <td><div class="action-row">
        <button class="small-btn" onclick="acaoUsuario(${usuario.id}, 'aprovar')">Aprovar</button>
        <button class="small-btn delete-btn" onclick="acaoUsuario(${usuario.id}, 'bloquear')">Bloquear</button>
        <button class="small-btn delete-btn" onclick="acaoUsuario(${usuario.id}, 'desativar')">Desativar</button>
        <button class="small-btn" onclick="resetarSenhaUsuario(${usuario.id})">Definir senha</button>
        <button class="small-btn delete-btn" onclick="excluirUsuarioAdmin(${usuario.id})">Excluir</button>
      </div></td>
    </tr>
  `).join("") || `<tr><td colspan="8" class="empty-row">Nenhum usuario cadastrado.</td></tr>`;
}

// Renderiza a tabela de logs de auditoria, filtrável por empresa.
// Cada log registra: data, ação, entidade afetada, ID e IP do solicitante.
async function renderizarAdminAuditoria() {
  const tabela = document.getElementById("tabela-admin-auditoria");
  if (!tabela) return;
  const filtro = adminEmpresaFiltro ? `?empresa_id=${encodeURIComponent(adminEmpresaFiltro)}` : "";
  const logs = await apiGet(`/audit-logs${filtro}`);
  tabela.innerHTML = logs.map((log) => `
    <tr>
      <td>${log.created_at ? formatarDataCurta(log.created_at) : "-"}</td>
      <td>${escapeHtml(log.acao)}</td>
      <td>${escapeHtml(log.entidade)}</td>
      <td>${escapeHtml(log.entidade_id)}</td>
      <td>${escapeHtml(log.ip || "-")}</td>
      <td><button class="small-btn delete-btn" onclick="excluirLogAdmin(${log.id})">Excluir</button></td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="empty-row">Nenhum log encontrado.</td></tr>`;
}

// =========================================================
// ADMIN — Acessos do App Motorista
//
// Permite ao usuário master criar e gerenciar credenciais
// de login para o app mobile dos motoristas (motorista.html).
//
// Fluxo:
//   1. Clicar "+ Novo acesso" → abre formulário inline
//   2. Preencher nome, email, senha e vincular a um Motorista cadastrado
//   3. Copiar o link do app e enviar para o motorista via WhatsApp/email
//   4. Desativar/excluir o acesso quando necessário
//
// API usada:
//   GET/POST/PUT/DELETE /motorista-acessos  (admin_routes.py)
// =========================================================

// Renderiza a tabela de acessos do app mobile dos motoristas.
// Exibe nome, email, motorista vinculado, status e link do app.
// O botão "Copiar link" copia a URL do app (motorista.html) para a área de transferência.
// Os botões Excluir e Ativar/Desativar controlam o acesso do motorista ao app.
async function renderizarMotoristaAcessos() {
  const tabela = document.getElementById("tabela-motorista-acessos");
  if (!tabela) return;
  const acessos = await apiGet("/motorista-acessos");
  const appUrl = `${window.location.origin}/motorista.html`;
  tabela.innerHTML = acessos.map(a => `
    <tr>
      <td>${escapeHtml(a.nome)}</td>
      <td>${escapeHtml(a.email)}</td>
      <td>${escapeHtml(a.motorista_nome || "-")}</td>
      <td><span class="status-pill ${a.ativo ? "active" : "inactive"}">${a.ativo ? "Ativo" : "Inativo"}</span></td>
      <td><button class="small-btn" onclick="copiarLinkApp('${appUrl}')">Copiar link</button></td>
      <td>
        <button class="small-btn delete-btn" onclick="excluirAcessoMotorista(${a.id})">Excluir</button>
        <button class="small-btn" onclick="toggleAtivoMotorista(${a.id}, ${!a.ativo})">${a.ativo ? "Desativar" : "Ativar"}</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="empty-row">Nenhum acesso cadastrado.</td></tr>`;

  const btn = document.getElementById("btn-novo-acesso-motorista");
  if (btn) {
    btn.onclick = () => abrirFormAcessoMotorista();
  }
}

// Abre o formulário inline de criação de acesso ao app motorista (toggle).
// Preenche o select de motoristas via GET /motoristas para vincular ao acesso.
// O botão Salvar chama POST /motorista-acessos e re-renderiza a tabela.
function abrirFormAcessoMotorista() {
  const container = document.getElementById("form-acesso-motorista-container");
  if (!container) return;
  if (container.innerHTML) { container.innerHTML = ""; return; }
  container.innerHTML = `
    <div class="edit-inline-form" style="margin-bottom:14px;">
      <h4 style="margin:0 0 12px;">Novo acesso motorista</h4>
      <div class="edit-inline-fields">
        <div class="field"><label>Nome *</label><input id="am-nome" placeholder="Nome do motorista" /></div>
        <div class="field"><label>Email *</label><input id="am-email" type="email" placeholder="login@email.com" /></div>
        <div class="field"><label>Senha *</label><input id="am-senha" type="password" placeholder="Min. 8 caracteres" /></div>
        <div class="field"><label>Motorista vinculado</label><select id="am-motorista"></select></div>
      </div>
      <div class="edit-inline-actions">
        <button class="primary-btn" type="button" id="btn-salvar-acesso-motorista">Salvar</button>
        <button class="ghost-btn" type="button" id="btn-cancelar-acesso-motorista">Cancelar</button>
        <span id="am-msg" class="mensagem"></span>
      </div>
    </div>
  `;
  apiGet("/motoristas").then(mots => {
    const sel = document.getElementById("am-motorista");
    if (sel) sel.innerHTML = `<option value="">Nenhum</option>` + mots.map(m => `<option value="${m.id}">${escapeHtml(m.nome)}</option>`).join("");
  });
  document.getElementById("btn-cancelar-acesso-motorista").onclick = () => { container.innerHTML = ""; };
  document.getElementById("btn-salvar-acesso-motorista").onclick = async () => {
    const msg = document.getElementById("am-msg");
    msg.textContent = "";
    try {
      await apiSend("/motorista-acessos", "POST", {
        nome: document.getElementById("am-nome").value.trim(),
        email: document.getElementById("am-email").value.trim(),
        senha: document.getElementById("am-senha").value,
        motorista_id: document.getElementById("am-motorista").value || null,
      });
      container.innerHTML = "";
      mostrarToast("Acesso criado.", "success");
      await renderizarMotoristaAcessos();
    } catch (err) {
      msg.textContent = err.message;
    }
  };
}

window.copiarLinkApp = (url) => {
  navigator.clipboard.writeText(url).then(() => mostrarToast("Link copiado!", "success")).catch(() => mostrarToast(url));
};

window.excluirAcessoMotorista = async (id) => {
  if (!confirm("Excluir este acesso?")) return;
  await apiDelete(`/motorista-acessos/${id}`);
  mostrarToast("Acesso excluido.", "success");
  await renderizarMotoristaAcessos();
};

window.toggleAtivoMotorista = async (id, ativo) => {
  await apiSend(`/motorista-acessos/${id}`, "PUT", { ativo });
  mostrarToast(ativo ? "Acesso ativado." : "Acesso desativado.", "success");
  await renderizarMotoristaAcessos();
};

// Executa uma ação administrativa em uma empresa (aprovar, bloquear).
// Após a ação, atualiza resumo, lista de empresas e auditoria em paralelo.
window.acaoEmpresa = async (empresaId, acao) => {
  await apiSend(`/empresas/${empresaId}/${acao}`, "POST", {});
  await Promise.all([renderizarAdminResumo(), renderizarAdminEmpresas(), renderizarAdminAuditoria()]);
};

window.excluirEmpresaAdmin = async (empresaId) => {
  if (!confirm("Deseja desativar esta empresa?")) return;
  await apiDelete(`/empresas/${empresaId}`);
  await Promise.all([renderizarAdminResumo(), renderizarAdminEmpresas(), renderizarAdminAuditoria()]);
};

// Define a empresa como ativa no filtro do painel admin e atualiza
// o select de empresa, a tabela de usuários e os logs de auditoria.
window.gerenciarEmpresaAdmin = async (empresaId) => {
  adminEmpresaFiltro = String(empresaId);
  const select = document.getElementById("admin-empresa-gerenciada");
  if (select) select.value = adminEmpresaFiltro;
  await Promise.all([renderizarAdminUsuarios(), renderizarAdminAuditoria()]);
};

window.acaoUsuario = async (usuarioId, acao) => {
  await apiSend(`/usuarios/${usuarioId}/${acao}`, "POST", {});
  await Promise.all([renderizarAdminResumo(), renderizarAdminUsuarios(), renderizarAdminAuditoria()]);
};

// Solicita a nova senha via prompt nativo e chama dois endpoints:
// 1. POST /alterar-senha (define a nova senha)
// 2. POST /forcar-troca-senha (exige troca no próximo login)
window.resetarSenhaUsuario = async (usuarioId) => {
  const novaSenha = prompt("Digite a nova senha do usuario. Ela deve ter no minimo 8 caracteres.");
  if (!novaSenha) return;
  await apiSend(`/usuarios/${usuarioId}/alterar-senha`, "POST", { senha: novaSenha });
  await apiSend(`/usuarios/${usuarioId}/forcar-troca-senha`, "POST", {});
  mostrarToast("Senha redefinida. O usuario devera trocar no proximo acesso.", "success");
  await Promise.all([renderizarAdminUsuarios(), renderizarAdminAuditoria()]);
};

window.excluirUsuarioAdmin = async (usuarioId) => {
  if (!confirm("Deseja excluir definitivamente este usuario?")) return;
  await apiDelete(`/usuarios/${usuarioId}`);
  await Promise.all([renderizarAdminResumo(), renderizarAdminUsuarios(), renderizarAdminAuditoria()]);
};

window.excluirLogAdmin = async (logId) => {
  if (!confirm("Deseja excluir este log de auditoria?")) return;
  await apiDelete(`/audit-logs/${logId}`);
  await renderizarAdminAuditoria();
};

// =========================================================
// MODULO DE RELATORIOS
//
// Gera o demonstrativo financeiro executivo com: KPIs, DRE gerencial,
// insights automáticos, gráficos Chart.js e tabelas detalhadas.
//
// Dados carregados em paralelo (Promise.all):
//   - Resumo financeiro (faturamento, custos, lucros, saldo)
//   - Por classificação (participação de cada conta)
//   - Por veículo (resultado e custo/KM por veículo)
//   - Por período (evolução mensal)
//   - Contas a receber (contratos do período)
//   - Contas a pagar (passivos)
//
// Exportação: PDF e Excel são gerados pelo backend e abertos via
// abrirExportacao() em nova aba com os mesmos filtros ativos.
//
// Gráficos: instâncias Chart.js são armazenadas em relatorioCharts[]
// e destruídas antes de recriar (destruirGraficosRelatorio) para
// evitar vazamentos de memória e conflito de canvas.
// =========================================================

// Array de instâncias Chart.js ativas na página de relatórios.
// Destruídas a cada nova geração de relatório para evitar sobreposição.
let relatorioCharts = [];

// Coleta os filtros ativos da página de relatórios e retorna um URLSearchParams.
// Compartilhado entre gerarRelatorio(), exportar PDF e exportar Excel.
function parametrosRelatorio() {
  const params = new URLSearchParams();
  const dataInicial = document.getElementById("rel-data-inicial")?.value || "";
  const dataFinal = document.getElementById("rel-data-final")?.value || "";
  const veiculoId = document.getElementById("rel-veiculo-id")?.value || "";
  const classificacao = document.getElementById("rel-classificacao")?.value || "";
  const empresaId = document.getElementById("rel-empresa-id")?.value || "";
  const obraServico = document.getElementById("rel-obra-servico")?.value.trim() || "";

  if (dataInicial) params.append("data_inicial", dataInicial);
  if (dataFinal) params.append("data_final", dataFinal);
  if (veiculoId) params.append("veiculo_id", veiculoId);
  if (classificacao) params.append("classificacao", classificacao);
  if (empresaId) params.append("empresa_id", empresaId);
  if (obraServico) params.append("obra_servico", obraServico);

  return params;
}

async function carregarOpcoesRelatorios() {
  const [veiculos, classificacoes] = await Promise.all([
    carregarVeiculos(),
    apiGet("/classificacoes")
  ]);

  const selectVeiculo = document.getElementById("rel-veiculo-id");
  const selectClassificacao = document.getElementById("rel-classificacao");
  if (selectVeiculo) selectVeiculo.innerHTML = `<option value="">Todos</option>`;
  if (selectClassificacao) selectClassificacao.innerHTML = `<option value="">Todas</option>`;

  veiculos.forEach((veiculo) => {
    const option = document.createElement("option");
    option.value = veiculo.id;
    option.textContent = `${veiculo.nome || veiculo.modelo || "Veiculo"}${veiculo.placa ? ` - ${veiculo.placa}` : ""}`;
    selectVeiculo.appendChild(option);
  });

  classificacoes.forEach((classificacao) => {
    const option = document.createElement("option");
    option.value = classificacao;
    option.textContent = classificacao;
    selectClassificacao.appendChild(option);
  });
}

function atualizarCardRelatorio(id, valor) {
  const el = document.getElementById(id);
  if (el) el.textContent = formatarValor(valor);
}

function formatarPercentual(valor) {
  const numero = Number.isFinite(valor) ? valor : 0;
  return `${numero.toFixed(1).replace(".", ",")}%`;
}

function atualizarTextoRelatorio(id, texto) {
  const el = document.getElementById(id);
  if (el) el.textContent = texto;
}

function atualizarResumoFiltrosRelatorio() {
  const dataInicial = document.getElementById("rel-data-inicial")?.value || "";
  const dataFinal = document.getElementById("rel-data-final")?.value || "";
  const veiculo = document.getElementById("rel-veiculo-id");
  const classificacao = document.getElementById("rel-classificacao")?.value || "";
  const obra = document.getElementById("rel-obra-servico")?.value.trim() || "";
  const partes = [];

  if (dataInicial || dataFinal) {
    partes.push(`${dataInicial ? formatarDataCurta(dataInicial) : "inicio"} a ${dataFinal ? formatarDataCurta(dataFinal) : "hoje"}`);
  }
  if (veiculo?.value) partes.push(veiculo.options[veiculo.selectedIndex]?.text || "veiculo selecionado");
  if (classificacao) partes.push(classificacao);
  if (obra) partes.push(`Obra: ${obra}`);

  const texto = partes.length ? partes.join(" | ") : "Todos os registros disponiveis";
  atualizarTextoRelatorio("rel-filtros-resumo", texto);
  atualizarTextoRelatorio("rel-periodo-print", texto);
  atualizarTextoRelatorio("rel-data-emissao", new Date().toLocaleString("pt-BR"));
}

function atualizarDreRelatorio(resumo) {
  atualizarCardRelatorio("dre-receita", resumo.total_faturamento);
  atualizarCardRelatorio("dre-custos", resumo.total_custos);
  atualizarCardRelatorio("dre-lucro-bruto", resumo.lucro_bruto);
  atualizarCardRelatorio("dre-despesas", resumo.total_despesas);
  atualizarCardRelatorio("dre-lucro-liquido", resumo.lucro_liquido);
  atualizarCardRelatorio("dre-investimentos", resumo.total_investimentos);
  atualizarCardRelatorio("dre-saldo", resumo.saldo_periodo);
}

function renderizarInsightsRelatorio(resumo, porVeiculo, contasReceber) {
  const faturamento = normalizarNumero(resumo.total_faturamento);
  const margemBruta = faturamento ? (normalizarNumero(resumo.lucro_bruto) / faturamento) * 100 : 0;
  const margemLiquida = faturamento ? (normalizarNumero(resumo.lucro_liquido) / faturamento) * 100 : 0;
  const pendente = normalizarNumero(resumo.contas_a_receber_pendente);
  const melhorVeiculo = porVeiculo.find((item) => normalizarNumero(item.resultado) > 0);
  const totalContas = normalizarNumero(resumo.contas_a_receber_total);
  const percentualPendente = totalContas ? (pendente / totalContas) * 100 : 0;
  const container = document.getElementById("rel-insights");
  if (!container) return;

  const itens = [
    ["Margem bruta", formatarPercentual(margemBruta), margemBruta >= 25 ? "positive" : margemBruta >= 10 ? "warning" : "negative"],
    ["Margem liquida", formatarPercentual(margemLiquida), margemLiquida >= 15 ? "positive" : margemLiquida >= 5 ? "warning" : "negative"],
    ["Recebiveis em aberto", `${formatarPercentual(percentualPendente)} da carteira`, percentualPendente <= 20 ? "positive" : percentualPendente <= 45 ? "warning" : "negative"],
    ["Melhor resultado", melhorVeiculo ? `${melhorVeiculo.nome_veiculo} (${formatarValor(melhorVeiculo.resultado)})` : "Sem veiculo positivo", melhorVeiculo ? "positive" : "warning"],
    ["Lancamentos analisados", `${resumo.quantidade_lancamentos || 0} registro(s)`, "neutral"],
    ["Contratos a receber", `${contasReceber.length || 0} contrato(s)`, "neutral"]
  ];

  container.innerHTML = itens.map(([label, value, status]) => `
    <div class="insight-item ${status}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
}

function preencherTabela(id, linhas, colunas, vazio = "Nenhum dado encontrado.") {
  const tbody = document.getElementById(id);
  if (!tbody) return;

  if (!linhas.length) {
    tbody.innerHTML = `<tr><td colspan="${colunas.length}" class="empty-row">${vazio}</td></tr>`;
    return;
  }

  tbody.innerHTML = linhas.map((linha) => `
    <tr>
      ${colunas.map((coluna) => `<td>${coluna(linha)}</td>`).join("")}
    </tr>
  `).join("");
}

function destruirGraficosRelatorio() {
  relatorioCharts.forEach((chart) => chart.destroy());
  relatorioCharts = [];
}

function criarGrafico(canvasId, tipo, labels, datasets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (!window.Chart) {
    const ctx = canvas.getContext("2d");
    const valores = datasets[0]?.data || [];
    const maior = Math.max(...valores.map(v => Math.abs(normalizarNumero(v))), 1);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#98a3bd";
    ctx.font = "12px Segoe UI";
    valores.slice(0, 8).forEach((valor, index) => {
      const largura = (Math.abs(normalizarNumero(valor)) / maior) * (canvas.width - 130);
      const y = 22 + index * 24;
      ctx.fillText(String(labels[index] || "").slice(0, 16), 8, y + 11);
      ctx.fillStyle = Array.isArray(datasets[0].backgroundColor) ? datasets[0].backgroundColor[index] : datasets[0].backgroundColor || "#4f8cff";
      ctx.fillRect(120, y, largura, 14);
      ctx.fillStyle = "#98a3bd";
    });
    return;
  }

  const chart = new Chart(canvas, {
    type: tipo,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: 12 },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#d9e2f3",
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            padding: 16,
            font: { size: 11, family: "Inter, Segoe UI, Arial" }
          }
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.96)",
          borderColor: "rgba(148, 163, 184, 0.22)",
          borderWidth: 1,
          titleColor: "#f8fafc",
          bodyColor: "#dbeafe",
          padding: 12,
          callbacks: {
            label: (context) => `${context.dataset.label || "Total"}: ${formatarValor(context.parsed?.y ?? context.parsed ?? 0)}`
          }
        }
      },
      scales: tipo === "pie" || tipo === "doughnut" ? {} : {
        x: {
          ticks: { color: "#94a3b8", maxRotation: 0, autoSkip: true, font: { size: 11 } },
          grid: { color: "rgba(148,163,184,0.08)" }
        },
        y: {
          ticks: { color: "#94a3b8", font: { size: 11 }, callback: (value) => formatarValor(value).replace("R$", "R$ ") },
          grid: { color: "rgba(148,163,184,0.08)" }
        }
      }
    }
  });

  relatorioCharts.push(chart);
}

function renderizarGraficosRelatorio(dados) {
  destruirGraficosRelatorio();

  criarGrafico("chart-periodo", "bar", dados.por_periodo.map(i => i.periodo), [
    { label: "Receitas", data: dados.por_periodo.map(i => i.total_receitas), backgroundColor: "#22C55E", borderRadius: 8 },
    { label: "Custos", data: dados.por_periodo.map(i => i.total_custos), backgroundColor: "#EF4444", borderRadius: 8 },
    { label: "Despesas", data: dados.por_periodo.map(i => i.total_despesas), backgroundColor: "#F59E0B", borderRadius: 8 },
    { label: "Resultado", data: dados.por_periodo.map(i => i.resultado), type: "line", borderColor: "#22D3EE", backgroundColor: "rgba(34, 211, 238, 0.12)", tension: 0.35, fill: false, pointRadius: 3 }
  ]);

  criarGrafico("chart-classificacao", "doughnut", dados.por_classificacao.slice(0, 8).map(i => i.classificacao), [
    { label: "Total", data: dados.por_classificacao.slice(0, 8).map(i => Math.abs(i.total)), backgroundColor: ["#22D3EE", "#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#06B6D4", "#64748B", "#A78BFA"], borderWidth: 0 }
  ]);

  criarGrafico("chart-veiculo", "bar", dados.por_veiculo.slice(0, 8).map(i => i.nome_veiculo), [
    { label: "Resultado", data: dados.por_veiculo.slice(0, 8).map(i => i.resultado), backgroundColor: "#3B82F6", borderRadius: 8 }
  ]);

  criarGrafico("chart-contas", "pie", ["Pendente", "Recebido"], [
    { label: "Contas a receber", data: [dados.resumo.contas_a_receber_pendente, dados.resumo.contas_a_receber_recebido], backgroundColor: ["#F59E0B", "#22C55E"], borderWidth: 0 }
  ]);
}

async function gerarRelatorio() {
  const feedback = document.getElementById("relatorio-feedback");
  if (feedback) feedback.innerHTML = "";

  try {
    const params = parametrosRelatorio();
    const query = params.toString() ? `?${params.toString()}` : "";
    const [resumo, porClassificacao, porVeiculo, porPeriodo, contasReceber, contasPagar] = await Promise.all([
      apiGet(`/relatorios/resumo${query}`),
      apiGet(`/relatorios/por-classificacao${query}`),
      apiGet(`/relatorios/por-veiculo${query}`),
      apiGet(`/relatorios/por-periodo${query}`),
      apiGet(`/relatorios/contas-receber${query}`),
      apiGet(`/relatorios/contas-pagar`)
    ]);

    const dados = {
      resumo,
      por_classificacao: porClassificacao,
      por_veiculo: porVeiculo,
      por_periodo: porPeriodo,
      contas_receber: contasReceber.itens || [],
      contas_pagar: contasPagar.itens || []
    };

    atualizarCardRelatorio("rel-fat", resumo.total_faturamento);
    atualizarCardRelatorio("rel-custos", resumo.total_custos);
    atualizarCardRelatorio("rel-despesas", resumo.total_despesas);
    atualizarCardRelatorio("rel-invest", resumo.total_investimentos);
    atualizarCardRelatorio("rel-lucro-bruto", resumo.lucro_bruto);
    atualizarCardRelatorio("rel-lucro-liquido", resumo.lucro_liquido);
    atualizarCardRelatorio("rel-saldo", resumo.saldo_periodo);
    atualizarCardRelatorio("rel-pendente", resumo.contas_a_receber_pendente);
    const faturamento = normalizarNumero(resumo.total_faturamento);
    const margemBruta = faturamento ? (normalizarNumero(resumo.lucro_bruto) / faturamento) * 100 : 0;
    const margemLiquida = faturamento ? (normalizarNumero(resumo.lucro_liquido) / faturamento) * 100 : 0;
    atualizarTextoRelatorio("rel-margem-bruta", `Margem bruta ${formatarPercentual(margemBruta)}`);
    atualizarTextoRelatorio("rel-margem-liquida", `Margem liquida ${formatarPercentual(margemLiquida)}`);
    atualizarTextoRelatorio("rel-pendente-sub", `${contasReceber.itens?.length || 0} conta(s) no periodo`);
    atualizarDreRelatorio(resumo);
    renderizarInsightsRelatorio(resumo, porVeiculo, contasReceber.itens || []);
    atualizarResumoFiltrosRelatorio();

    const totalClassificacoes = porClassificacao.reduce((acc, item) => acc + Math.abs(normalizarNumero(item.total)), 0);
    preencherTabela("rel-tabela-classificacao", porClassificacao, [
      i => escapeHtml(i.classificacao),
      i => escapeHtml(i.grupo_financeiro),
      i => i.quantidade,
      i => formatarValor(i.total),
      i => formatarPercentual(totalClassificacoes ? (Math.abs(normalizarNumero(i.total)) / totalClassificacoes) * 100 : 0)
    ]);

    preencherTabela("rel-tabela-veiculo", porVeiculo, [
      i => escapeHtml(i.nome_veiculo),
      i => escapeHtml(i.placa),
      i => formatarValor(i.total_receitas),
      i => formatarValor(i.total_custos),
      i => formatarValor(i.total_despesas),
      i => formatarValor(i.total_investimentos),
      i => formatarValor(i.resultado),
      i => normalizarNumero(i.custo_por_km).toFixed(2),
      i => normalizarNumero(i.consumo_medio_combustivel).toFixed(2)
    ]);

    preencherTabela("rel-tabela-periodo", porPeriodo, [
      i => i.periodo,
      i => formatarValor(i.total_receitas),
      i => formatarValor(i.total_custos),
      i => formatarValor(i.total_despesas),
      i => formatarValor(i.total_investimentos),
      i => formatarValor(i.resultado),
      i => formatarPercentual(normalizarNumero(i.total_receitas) ? (normalizarNumero(i.resultado) / normalizarNumero(i.total_receitas)) * 100 : 0)
    ]);

    preencherTabela("rel-tabela-contas-receber", contasReceber.itens || [], [
      i => formatarDataCurta(i.data_inicio),
      i => escapeHtml(i.contrato || ""),
      i => escapeHtml(i.tomador || ""),
      i => formatarValor(i.valor_total_receber),
      i => `<span class="status-pill ${escapeHtml(i.status_pagamento || "pendente")}">${escapeHtml(i.status_pagamento || "pendente")}</span>`
    ]);

    preencherTabela("rel-tabela-contas-pagar", contasPagar.itens || [], [
      i => escapeHtml(i.descricao || ""),
      i => formatarValor(i.valor || 0),
      i => `<span class="status-pill ${escapeHtml(i.status_pagamento || "pendente")}">${escapeHtml(i.status_pagamento || "pendente")}</span>`
    ]);

    renderizarGraficosRelatorio(dados);
  } catch (erro) {
    if (feedback) {
      feedback.innerHTML = `<div class="panel-box"><p class="empty-row">Nao foi possivel gerar o relatorio. ${erro.message || ""}</p></div>`;
    }
  }
}

async function iniciarRelatorios() {
  await carregarOpcoesRelatorios();
  await gerarRelatorio();

  document.getElementById("btn-gerar-relatorio").addEventListener("click", async () => {
    await gerarRelatorio();
    fecharPopupFiltros("painel-filtros-relatorios");
  });
  document.getElementById("btn-limpar-relatorio")?.addEventListener("click", async () => {
    ["rel-data-inicial", "rel-data-final", "rel-veiculo-id", "rel-classificacao", "rel-empresa-id", "rel-obra-servico"].forEach((id) => {
      const campo = document.getElementById(id);
      if (campo) campo.value = "";
    });
    await gerarRelatorio();
    fecharPopupFiltros("painel-filtros-relatorios");
  });
  document.getElementById("btn-imprimir-relatorio")?.addEventListener("click", async () => {
    await gerarRelatorio();
    window.print();
  });
  document.getElementById("btn-exportar-pdf").addEventListener("click", () => {
    const params = parametrosRelatorio();
    abrirExportacao(`/relatorios/exportar/pdf${params.toString() ? `?${params.toString()}` : ""}`);
    fecharPopupFiltros("painel-filtros-relatorios");
  });
  document.getElementById("btn-exportar-excel").addEventListener("click", () => {
    const params = parametrosRelatorio();
    abrirExportacao(`/relatorios/exportar/excel${params.toString() ? `?${params.toString()}` : ""}`);
    fecharPopupFiltros("painel-filtros-relatorios");
  });
}

// =========================================================
// MODULO DE DASHBOARD
// =========================================================
let dashboardCharts = [];

function parametrosDashboard() {
  const params = new URLSearchParams();
  const dataInicial = document.getElementById("dash-data-inicial")?.value || "";
  const dataFinal = document.getElementById("dash-data-final")?.value || "";
  const veiculoId = document.getElementById("dash-veiculo-id")?.value || "";
  const empresaId = document.getElementById("dash-empresa-id")?.value || "";
  if (dataInicial) params.append("data_inicial", dataInicial);
  if (dataFinal) params.append("data_final", dataFinal);
  if (veiculoId) params.append("veiculo_id", veiculoId);
  if (empresaId) params.append("empresa_id", empresaId);
  return params;
}

async function carregarResumoDashboard() {
  const params = parametrosDashboard();
  const query = params.toString() ? `?${params.toString()}` : "";
  const [resumo, periodo, veiculos, classificacoes, contas, patrimonio] = await Promise.all([
    apiGet(`/relatorios/resumo-financeiro${query}`),
    apiGet(`/relatorios/por-periodo${query}`),
    apiGet(`/relatorios/custo-por-veiculo${query}`),
    apiGet(`/relatorios/por-classificacao${query}`),
    apiGet(`/relatorios/contas-receber${query}`),
    apiGet("/relatorios/patrimonio-liquido")
  ]);
  return { resumo, periodo, veiculos, classificacoes, contas, patrimonio };
}

function limparGraficosDashboard() {
  dashboardCharts.forEach(chart => chart.destroy?.());
  dashboardCharts = [];
}

function criarGraficoDashboard(canvasId, tipo, labels, datasets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (!window.Chart) {
    criarGrafico(canvasId, tipo, labels, datasets);
    return;
  }
  const chart = new Chart(canvas, {
    type: tipo,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#e8edf8" } } },
      scales: tipo === "pie" || tipo === "doughnut" ? {} : {
        x: { ticks: { color: "#98a3bd" }, grid: { color: "rgba(255,255,255,0.06)" } },
        y: { ticks: { color: "#98a3bd" }, grid: { color: "rgba(255,255,255,0.06)" } }
      }
    }
  });
  dashboardCharts.push(chart);
}

function renderizarGraficoReceitasDespesas(dados) {
  const labels = dados.periodo.length ? dados.periodo.map(i => i.periodo) : ["Periodo"];
  criarGraficoDashboard("dash-chart-receitas-despesas", "line", labels, [
    { label: "Receita", data: dados.periodo.length ? dados.periodo.map(i => i.total_receitas) : [dados.resumo.faturamento], borderColor: "#22C55E", backgroundColor: "rgba(34,197,94,0.14)", tension: 0.38, fill: true },
    { label: "Custo", data: dados.periodo.length ? dados.periodo.map(i => i.total_custos) : [dados.resumo.custos_operacionais], borderColor: "#EF4444", backgroundColor: "rgba(239,68,68,0.1)", tension: 0.38, fill: true },
    { label: "Lucro", data: dados.periodo.length ? dados.periodo.map(i => i.resultado) : [dados.resumo.lucro_liquido], borderColor: "#22D3EE", backgroundColor: "rgba(34,211,238,0.12)", tension: 0.38, fill: true }
  ]);
}

function renderizarGraficoCustosPorVeiculo(dados) {
  criarGraficoDashboard("dash-chart-custos-veiculo", "bar", dados.veiculos.slice(0, 8).map(i => i.nome_veiculo), [
    { label: "Custo total", data: dados.veiculos.slice(0, 8).map(i => i.custo_total_veiculo), backgroundColor: "#3B82F6", borderRadius: 10 }
  ]);
}

function renderizarGraficoDespesasPorClassificacao(dados) {
  const despesas = dados.classificacoes.filter(i => String(i.classificacao).startsWith("2.")).slice(0, 8);
  criarGraficoDashboard("dash-chart-despesas-classificacao", "doughnut", despesas.map(i => i.classificacao), [
    { label: "Despesas", data: despesas.map(i => Math.abs(i.total)), backgroundColor: ["#EF4444", "#F59E0B", "#22D3EE", "#22C55E", "#3B82F6", "#06B6D4", "#64748B", "#F97316"] }
  ]);
}

function renderizarGraficoFaturamentoMensal(dados) {
  criarGraficoDashboard("dash-chart-faturamento-mensal", "line", dados.periodo.map(i => i.periodo), [
    { label: "Faturamento", data: dados.periodo.map(i => i.total_receitas), borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.18)" }
  ]);
}

function renderizarGraficoSaldoAcumulado(dados) {
  let acumulado = 0;
  const valores = dados.periodo.map(i => {
    acumulado += i.resultado;
    return acumulado;
  });
  criarGraficoDashboard("dash-chart-saldo-acumulado", "line", dados.periodo.map(i => i.periodo), [
    { label: "Saldo acumulado", data: valores, borderColor: "#4f8cff", backgroundColor: "rgba(79,140,255,0.18)" }
  ]);
}

function renderizarGraficoContasReceber(dados) {
  criarGraficoDashboard("dash-chart-contas-receber", "pie", ["Pendente", "Recebido"], [
    { label: "Contas a receber", data: [dados.resumo.valores_pendentes_a_receber, dados.contas.resumo?.contas_a_receber_recebido || 0], backgroundColor: ["#f59e0b", "#22c55e"] }
  ]);
}

async function carregarFiltroHorasMaquinas(veiculos) {
  const select = document.getElementById("dash-horas-veiculo");
  if (!select) return;
  const maquinas = veiculos.filter((veiculo) => normalizarTexto(veiculo.tipo).includes("maquina"));
  select.innerHTML = `<option value="">Todas as maquinas</option>` + maquinas.map((veiculo) => {
    const texto = `${veiculo.nome || veiculo.modelo || "Maquina"}${veiculo.placa ? ` - ${veiculo.placa}` : ""}`;
    return `<option value="${veiculo.id}">${escapeHtml(texto)}</option>`;
  }).join("");
}

async function atualizarHorasMaquinasDashboard() {
  const params = new URLSearchParams();
  const veiculoId = document.getElementById("dash-horas-veiculo")?.value || "";
  const dataInicial = document.getElementById("dash-horas-data-inicial")?.value || "";
  const dataFinal = document.getElementById("dash-horas-data-final")?.value || "";
  if (veiculoId) params.append("veiculo_id", veiculoId);
  if (dataInicial) params.append("data_inicial", dataInicial);
  if (dataFinal) params.append("data_final", dataFinal);
  const query = params.toString() ? `?${params.toString()}` : "";
  const dados = await apiGet(`/contas-receber/horas-maquinas${query}`);
  document.getElementById("dash-horas-total").textContent = `${normalizarNumero(dados.total_horas).toLocaleString("pt-BR")}h`;
  document.getElementById("dash-dias-total").textContent = dados.dias_trabalhados || 0;
  document.getElementById("dash-horas-valor").textContent = formatarValor(dados.valor_total || 0);
}

async function iniciarDashboard() {
  await carregarSelectVeiculosGenerico("dash-veiculo-id", "Todos");
  const [lancamentos, veiculos, motoristas, dadosDashboard] = await Promise.all([
    apiGet("/lancamentos"),
    apiGet("/veiculos"),
    apiGet("/motoristas"),
    carregarResumoDashboard()
  ]);
  cacheVeiculos = veiculos;
  await carregarFiltroHorasMaquinas(veiculos);

  const receitas = lancamentos.filter(lancamentoEhReceita);
  const despesas = lancamentos.filter(item => !lancamentoEhReceita(item));
  const totalReceitas = dadosDashboard.resumo.faturamento;
  const totalDespesas = dadosDashboard.resumo.despesas_administrativas;
  const saldo = dadosDashboard.resumo.saldo_periodo;

  const ativos = veiculos.filter(v => v.status === "Ativo").length;
  const manutencao = veiculos.filter(v => normalizarTexto(v.status) === "manutencao").length;
  const inativos = veiculos.filter(v => v.status === "Inativo").length;

  const saldoEl = document.getElementById("dashboard-saldo");
  saldoEl.textContent = formatarValor(saldo);
  saldoEl.classList.toggle("negative", saldo < 0);
  saldoEl.classList.toggle("positive", saldo >= 0);

  const dataInicial = document.getElementById("dash-data-inicial")?.value;
  const dataFinal = document.getElementById("dash-data-final")?.value;
  const periodoLabel = dataInicial || dataFinal
    ? `Periodo: ${dataInicial ? formatarDataCurta(dataInicial) : "inicio"} - ${dataFinal ? formatarDataCurta(dataFinal) : "hoje"}`
    : "Todos os dados";

  const margemLiquida = totalReceitas ? (dadosDashboard.resumo.lucro_liquido / totalReceitas) * 100 : 0;
  const ticketMedio = receitas.length ? totalReceitas / receitas.length : 0;
  const frotaOperante = veiculos.length ? (ativos / veiculos.length) * 100 : 0;

  document.getElementById("dashboard-periodo").textContent = `${lancamentos.length} lancamento(s) · ${periodoLabel}`;
  const periodoChip = document.getElementById("dash-periodo-chip");
  if (periodoChip) periodoChip.textContent = periodoLabel.replace("Periodo: ", "");
  document.getElementById("dashboard-margem-liquida").textContent = formatarPercentual(margemLiquida);
  document.getElementById("dashboard-ticket-medio").textContent = formatarValor(ticketMedio);
  document.getElementById("dashboard-frota-operante").textContent = formatarPercentual(frotaOperante);
  document.getElementById("dashboard-receitas").textContent = formatarValor(totalReceitas);
  document.getElementById("dashboard-receitas-qtd").textContent = `${receitas.length} lancamento(s)`;
  document.getElementById("dashboard-despesas").textContent = formatarValor(totalDespesas);
  document.getElementById("dashboard-despesas-qtd").textContent = `${despesas.length} lancamento(s)`;
  document.getElementById("dashboard-custos").textContent = formatarValor(dadosDashboard.resumo.custos_operacionais);
  document.getElementById("dashboard-investimentos").textContent = formatarValor(dadosDashboard.resumo.investimentos);
  document.getElementById("dashboard-lucro-bruto").textContent = formatarValor(dadosDashboard.resumo.lucro_bruto);
  document.getElementById("dashboard-lucro-liquido").textContent = formatarValor(dadosDashboard.resumo.lucro_liquido);
  document.getElementById("dashboard-contas-pendentes").textContent = formatarValor(dadosDashboard.resumo.valores_pendentes_a_receber);
  document.getElementById("dashboard-patrimonio").textContent = formatarValor(dadosDashboard.patrimonio.patrimonio_liquido);
  document.getElementById("dashboard-frota-ativa").textContent = ativos;
  const totalVeiculosEl = document.getElementById("dashboard-veiculos-total");
  if (totalVeiculosEl) totalVeiculosEl.textContent = veiculos.length;
  const ativosCardEl = document.getElementById("dashboard-veiculos-ativos-card");
  if (ativosCardEl) ativosCardEl.textContent = ativos;
  const inativosCardEl = document.getElementById("dashboard-veiculos-inativos-card");
  if (inativosCardEl) inativosCardEl.textContent = inativos;
  const manutencaoCardEl = document.getElementById("dashboard-veiculos-manutencao-card");
  if (manutencaoCardEl) manutencaoCardEl.textContent = manutencao;
  document.getElementById("dashboard-frota-total").textContent = `${veiculos.length} veiculo(s) cadastrados`;
  document.getElementById("dashboard-veiculos-ativos").textContent = ativos;
  document.getElementById("dashboard-veiculos-manutencao").textContent = manutencao;
  document.getElementById("dashboard-veiculos-inativos").textContent = inativos;
  document.getElementById("dashboard-motoristas").textContent = motoristas.length;

  renderizarRankingClassificacoes(lancamentos);
  renderizarUltimosLancamentosDashboard(lancamentos);
  limparGraficosDashboard();
  renderizarGraficoReceitasDespesas(dadosDashboard);
  renderizarGraficoCustosPorVeiculo(dadosDashboard);
  renderizarGraficoDespesasPorClassificacao(dadosDashboard);
  renderizarGraficoFaturamentoMensal(dadosDashboard);
  renderizarGraficoSaldoAcumulado(dadosDashboard);
  renderizarGraficoContasReceber(dadosDashboard);
  await atualizarHorasMaquinasDashboard();
  document.getElementById("btn-dashboard-horas")?.addEventListener("click", atualizarHorasMaquinasDashboard);
  document.getElementById("btn-dashboard-filtrar")?.addEventListener("click", async () => {
    await iniciarDashboard();
    fecharPopupFiltros("painel-filtros-dashboard");
  });
  document.getElementById("btn-dashboard-limpar")?.addEventListener("click", async () => {
    const limpar = (id) => { const el = document.getElementById(id); if (el) el.value = ""; };
    limpar("dash-data-inicial");
    limpar("dash-data-final");
    limpar("dash-empresa-id");
    const sel = document.getElementById("dash-veiculo-id");
    if (sel) sel.value = "";
    await iniciarDashboard();
    fecharPopupFiltros("painel-filtros-dashboard");
  });
}

function renderizarRankingClassificacoes(lancamentos) {
  const container = document.getElementById("dashboard-classificacoes");
  if (!container) return;

  if (!lancamentos.length) {
    container.innerHTML = `<p class="empty-row">Nenhum lancamento cadastrado.</p>`;
    return;
  }

  const totais = new Map();
  lancamentos.forEach((item) => {
    const classificacao = item.classificacao || "Sem classificacao";
    const atual = totais.get(classificacao) || 0;
    totais.set(classificacao, atual + normalizarNumero(item.valor));
  });

  const ranking = Array.from(totais.entries())
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 5);

  const maiorValor = Math.max(...ranking.map(([, valor]) => Math.abs(valor)), 1);

  container.innerHTML = ranking.map(([classificacao, valor]) => {
    const largura = Math.max((Math.abs(valor) / maiorValor) * 100, 6);

    return `
      <div class="ranking-item">
        <div class="ranking-row">
          <span>${classificacao}</span>
          <strong>${formatarValor(valor)}</strong>
        </div>
        <div class="ranking-bar">
          <span style="width:${largura}%"></span>
        </div>
      </div>
    `;
  }).join("");
}

function renderizarUltimosLancamentosDashboard(lancamentos) {
  const tabela = document.getElementById("dashboard-ultimos-lancamentos");
  const total = document.getElementById("dashboard-total-lancamentos");
  if (!tabela || !total) return;

  total.textContent = `${lancamentos.length} registro(s)`;

  const ultimos = [...lancamentos]
    .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")))
    .slice(0, 8);

  if (!ultimos.length) {
    tabela.innerHTML = `
      <tr>
        <td colspan="5" class="empty-row">Nenhum lancamento encontrado.</td>
      </tr>
    `;
    return;
  }

  tabela.innerHTML = ultimos.map((item) => `
    <tr>
      <td>${formatarDataCurta(item.data)}</td>
      <td>${item.classificacao || ""}</td>
      <td>${nomeVeiculoPorId(item.veiculo_id)}</td>
      <td>${item.descricao || ""}</td>
      <td class="${lancamentoEhReceita(item) ? "positive" : "negative"}">${formatarValor(item.valor)}</td>
    </tr>
  `).join("");
}

// =========================================================
// MAPA EM TEMPO REAL — Rastreamento de motoristas
//
// Exibe no mapa Leaflet (OpenStreetMap) a posição atual de
// cada motorista que está com o GPS ativo no app mobile.
//
// Atualização automática:
//   - A função atualizarMapaMotoristas() é chamada a cada 10s via setInterval
//   - Consome GET /mapa/motoristas (rota protegida, token de usuário admin)
//   - Motorista é considerado "online" se enviou GPS há menos de 5 minutos
//
// Marcadores no mapa:
//   - mapaMarkers: Map<motorista_acesso_id, L.Marker>
//   - Marcadores existentes são atualizados em vez de recriados (performance)
//   - Marcadores de motoristas que saíram do resultado são removidos
//
// Lista lateral:
//   - Exibe nome, velocidade e destino da viagem ativa de cada motorista
//   - Clicar foca o mapa no marcador do motorista e abre popup
// =========================================================
function pararAtualizacaoMapa() {
  if (mapaAtualizacaoTimer) {
    clearInterval(mapaAtualizacaoTimer);
    mapaAtualizacaoTimer = null;
  }
}

function criarIconeMotorista(item) {
  const online = item.online ? "online" : "offline";
  const inicial = String(item.nome || "M").trim().slice(0, 1).toUpperCase();
  return L.divIcon({
    className: `driver-map-marker ${online}`,
    html: `<span>${escapeHtml(inicial)}</span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -20]
  });
}

function textoTempoSinal(item) {
  if (item.online) return "agora";
  const minutos = normalizarNumero(item.minutos_sem_sinal);
  if (minutos < 60) return `${Math.round(minutos)} min sem sinal`;
  return `${Math.round(minutos / 60)} h sem sinal`;
}

function centralizarMapaMotoristas(itens = []) {
  if (!mapaInstancia || !itens.length) return;
  const pontos = itens
    .filter((item) => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)))
    .map((item) => [item.lat, item.lng]);
  if (!pontos.length) return;
  mapaInstancia.fitBounds(pontos, { padding: [48, 48], maxZoom: 15 });
}

function atualizarListaMotoristasMapa(itens) {
  const lista = document.getElementById("mapa-lista-motoristas");
  if (!lista) return;
  if (!itens.length) {
    lista.innerHTML = `<p class="empty-row">Nenhum motorista com GPS ativo.</p>`;
    return;
  }
  lista.innerHTML = itens.map((item) => `
    <button type="button" class="mapa-driver-card" onclick="focarMotoristaMapa(${item.motorista_acesso_id})">
      <span class="mapa-driver-dot ${item.online ? "online" : "offline"}"></span>
      <span>
        <strong>${escapeHtml(item.nome)}</strong>
        <small>${Math.round(normalizarNumero(item.velocidade))} km/h${item.viagem ? " — " + escapeHtml(item.viagem.destino || "") : ""}</small>
      </span>
      <em>${escapeHtml(textoTempoSinal(item))}</em>
    </button>
  `).join("");
}

function atualizarMarcadoresMapa(itens) {
  if (!mapaInstancia) return;
  itens.forEach((item) => {
    if (!item.lat || !item.lng) return;
    const ponto = [item.lat, item.lng];
    const popup = `
      <div class="mapa-popup">
        <strong>${escapeHtml(item.nome)}</strong>
        <span>${Math.round(normalizarNumero(item.velocidade))} km/h</span>
        ${item.viagem ? `<span>${escapeHtml(item.viagem.origem || "")} → ${escapeHtml(item.viagem.destino || "")}</span>` : ""}
        <span>${escapeHtml(textoTempoSinal(item))}</span>
      </div>
    `;
    const marker = mapaMarkers.get(item.motorista_acesso_id);
    if (marker) {
      marker.setLatLng(ponto);
      marker.setIcon(criarIconeMotorista(item));
      marker.setPopupContent(popup);
    } else {
      const novoMarker = L.marker(ponto, { icon: criarIconeMotorista(item) })
        .addTo(mapaInstancia)
        .bindPopup(popup);
      mapaMarkers.set(item.motorista_acesso_id, novoMarker);
    }
  });
  const idsAtuais = new Set(itens.map((item) => item.motorista_acesso_id));
  mapaMarkers.forEach((marker, id) => {
    if (!idsAtuais.has(id)) { marker.remove(); mapaMarkers.delete(id); }
  });
}

async function atualizarMapaMotoristas({ centralizar = false } = {}) {
  const statusEl = document.getElementById("mapa-status-atualizacao");
  let itens;
  try {
    itens = await apiGet("/mapa/motoristas");
  } catch (error) {
    if (statusEl) statusEl.textContent = error.message || "Erro ao carregar localizacoes.";
    return;
  }
  atualizarMarcadoresMapa(itens);
  atualizarListaMotoristasMapa(itens);
  const online = itens.filter(i => i.online).length;
  document.getElementById("mapa-online-total").textContent = online;
  document.getElementById("mapa-motoristas-total").textContent = itens.length;
  if (statusEl) {
    statusEl.textContent = `Atualizado em ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  }
  if (centralizar || !mapaInstancia.__financeiroCentralizado) {
    centralizarMapaMotoristas(itens);
    mapaInstancia.__financeiroCentralizado = true;
  }
}

window.focarMotoristaMapa = (id) => {
  const marker = mapaMarkers.get(id);
  if (!marker || !mapaInstancia) return;
  mapaInstancia.setView(marker.getLatLng(), 16, { animate: true });
  marker.openPopup();
};

async function iniciarMapa() {
  pararAtualizacaoMapa();
  mapaMarkers = new Map();

  const container = document.getElementById("mapa-operacional");
  if (!container) return;
  if (!window.L) {
    container.innerHTML = `<div class="mapa-fallback">Nao foi possivel carregar o mapa. Recarregue a pagina ou verifique a conexao.</div>`;
    return;
  }

  mapaInstancia = L.map(container, {
    zoomControl: false,
    attributionControl: true
  }).setView([-23.55052, -46.63331], 12);

  L.control.zoom({ position: "bottomright" }).addTo(mapaInstancia);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(mapaInstancia);

  document.getElementById("btn-mapa-centralizar")?.addEventListener("click", () => atualizarMapaMotoristas({ centralizar: true }));

  [80, 350, 900].forEach((tempo) => {
    setTimeout(() => mapaInstancia?.invalidateSize(), tempo);
  });
  await atualizarMapaMotoristas({ centralizar: true });
  mapaAtualizacaoTimer = setInterval(() => atualizarMapaMotoristas().catch(() => {}), 5000);
}

// =========================================================
// MENU LATERAL
// =========================================================
function telaMobile() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function aplicarEstadoSidebar() {
  const recolhido = localStorage.getItem("financeiro_sidebar_recolhida") === "true";
  document.body.classList.toggle("sidebar-collapsed", recolhido && !telaMobile());
  document.body.classList.remove("sidebar-open");
}

function alternarSidebar() {
  if (telaMobile()) {
    document.body.classList.toggle("sidebar-open");
    return;
  }

  const proximoEstado = !document.body.classList.contains("sidebar-collapsed");
  document.body.classList.toggle("sidebar-collapsed", proximoEstado);
  localStorage.setItem("financeiro_sidebar_recolhida", String(proximoEstado));
}

function fecharSidebarMobile() {
  if (telaMobile()) {
    document.body.classList.remove("sidebar-open");
  }
}

// =========================================================
// POPUPS DE FILTROS
// =========================================================
function abrirPopupFiltros(painelId) {
  const painel = document.getElementById(painelId);
  if (!painel) return;
  painel.classList.add("is-open");
  painel.setAttribute("aria-hidden", "false");
  document.body.classList.add("filter-popup-open");
  painel.querySelector("input, select, button")?.focus();
}

function fecharPopupFiltros(painelId) {
  const painel = document.getElementById(painelId);
  if (!painel) return;
  painel.classList.remove("is-open");
  painel.setAttribute("aria-hidden", "true");
  document.body.classList.toggle("filter-popup-open", Boolean(document.querySelector(".filter-popup.is-open")));
}

function fecharTodosPopupsFiltros() {
  document.querySelectorAll(".filter-popup.is-open").forEach((painel) => {
    painel.classList.remove("is-open");
    painel.setAttribute("aria-hidden", "true");
  });
  document.body.classList.remove("filter-popup-open");
}

function iniciarBotoesPopupFiltros() {
  document.querySelectorAll("[data-filter-target]").forEach((botao) => {
    botao.addEventListener("click", () => abrirPopupFiltros(botao.dataset.filterTarget));
  });

  document.querySelectorAll("[data-filter-close]").forEach((botao) => {
    botao.addEventListener("click", () => fecharPopupFiltros(botao.dataset.filterClose));
  });

  document.querySelectorAll(".filter-popup").forEach((painel) => {
    painel.addEventListener("click", (event) => {
      if (event.target === painel) {
        fecharPopupFiltros(painel.id);
      }
    });
  });
}

// =========================================================
// NAVEGACAO ENTRE ABAS
// =========================================================
async function loadPage(pageKey) {
  const usuarioSessao = obterUsuarioSessao();
  if (usuarioSessao.perfil === "master" && pageKey !== "admin") {
    pageKey = "admin";
  }

  if (pageKey === "admin" && usuarioSessao.perfil !== "master") {
    pageKey = "dashboard";
    mostrarToast("Acesso administrativo disponivel apenas para usuario master.", "error");
  }

  const page = pages[pageKey];
  if (!page) return;

  // Sincroniza o estado "active" em todos os nav-btns (sidebar + bottom nav)
  // Garante que a navegação programática (busca, configurações, etc.) também seja refletida
  navButtons.forEach((btn) => {
    if (btn.dataset.page === pageKey) btn.classList.add("active");
    else btn.classList.remove("active");
  });

  pararAtualizacaoMapa();
  if (mapaInstancia) {
    mapaInstancia.remove();
    mapaInstancia = null;
    mapaMarkers = new Map();
  }

  pageTitle.textContent = page.title;
  pageSubtitle.textContent = page.subtitle;
  pageContent.innerHTML = page.render();
  // Volta ao topo do conteúdo a cada troca de página (UX mobile)
  pageContent.scrollTop = 0;
  window.lucide?.createIcons();
  iniciarBotoesPopupFiltros();

  try {
    if (pageKey === "dashboard") {
      await iniciarDashboard();
    }

    if (pageKey === "lancamentos") {
      await iniciarModuloLancamentos();
    }

    if (pageKey === "planoContas") {
      await iniciarPlanoContas();
    }

    if (pageKey === "contasReceber") {
      await iniciarContasReceber();
    }

    if (pageKey === "relatorios") {
      await iniciarRelatorios();
    }

    if (pageKey === "ativosPassivos") {
      await iniciarAtivosPassivos();
    }

    if (pageKey === "estoque") {
      await iniciarEstoque();
    }

    if (pageKey === "mapa") {
      await iniciarMapa();
    }

    if (pageKey === "configuracoes") {
      iniciarConfiguracoes();
      iniciarUsuarios();
    }

    if (pageKey === "admin") {
      await iniciarAdminMaster();
    }

    if (pageKey === "veiculos") {
      document.getElementById("btn-novo-veiculo").onclick = () => {
        editandoVeiculoId = null;
        abrirFormVeiculo();
      };

      iniciarFiltrosVeiculos();
      await renderizarVeiculos();
    }

    if (pageKey === "motoristas") {
      document.getElementById("btn-novo-motorista").onclick = () => {
        editandoMotoristaId = null;
        abrirFormMotorista();
      };

      await renderizarMotoristas();
      await renderizarHistoricoFolha();
    }
  } catch (erro) {
    pageContent.innerHTML = `
      <div class="panel-box">
        <p class="empty-row">Nao foi possivel carregar esta tela. Verifique se o backend esta rodando e tente novamente.</p>
        <p class="empty-row">${erro.message || ""}</p>
      </div>
    `;
  }
}

// =========================================================
// EVENTOS GERAIS
// =========================================================
navButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    navButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    fecharSidebarMobile();
    await loadPage(button.dataset.page);
  });
});

[sidebarToggleBtn, mobileMenuBtn].forEach((botao) => {
  botao?.addEventListener("click", alternarSidebar);
});

sidebarBackdrop?.addEventListener("click", fecharSidebarMobile);

// Botão "Mais" do bottom nav mobile — abre o drawer da sidebar
document.getElementById("mbn-more-btn")?.addEventListener("click", alternarSidebar);

// Intercepta o botão Voltar / gesto de voltar no mobile.
// Estratégia:
//   1. pushState adiciona uma entrada EXTRA no topo do history:
//      [..., /login, /app, /app(spa)] → back vai de /app(spa) para /app
//      dentro do mesmo contexto da página, então popstate DISPARA aqui.
//   2. No handler: empurra outra entrada (re-trava) e navega para dashboard.
//   Resultado: o usuário nunca sai do app ao pressionar Voltar.
history.pushState({ spa: true }, "");
window.addEventListener("popstate", () => {
  history.pushState({ spa: true }, "");  // re-trava para o próximo Voltar
  const usuario = obterUsuarioSessao();
  if (!usuario) return;
  fecharSidebarMobile();
  fecharTodosPopupsFiltros();
  const destino = usuario.perfil === "master" ? "admin" : "dashboard";
  navButtons.forEach((btn) => {
    if (btn.dataset.page === destino) btn.classList.add("active");
    else btn.classList.remove("active");
  });
  loadPage(destino);
});

window.addEventListener("resize", aplicarEstadoSidebar);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    fecharTodosPopupsFiltros();
  }
});

logoutBtn.addEventListener("click", () => {
  sessionStorage.removeItem("financeiro_access_token");
  sessionStorage.removeItem("financeiro_usuario");
  window.location.href = "/login";
});

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const atual = document.body.dataset.theme || "dark";
    const proximo = atual === "dark" ? "light" : "dark";
    localStorage.setItem("financeiro_tema", proximo);
    const config = carregarConfiguracoesLocais();
    localStorage.setItem("financeiro_configuracoes", JSON.stringify({ ...config, tema: proximo }));
    aplicarTema();
    mostrarToast(`Tema ${proximo === "dark" ? "escuro" : "claro"} aplicado.`, "success");
  });
}

settingsBtn?.addEventListener("click", async () => {
  navButtons.forEach((btn) => btn.classList.remove("active"));
  fecharSidebarMobile();
  await loadPage("configuracoes");
});

notificationBtn?.addEventListener("click", () => {
  mostrarToast("Nenhuma nova notificacao no momento.", "success");
});

globalSearch?.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  const termo = globalSearch.value.trim().toLowerCase();
  if (!termo) return;
  const destino = Array.from(navButtons).find((btn) => btn.textContent.toLowerCase().includes(termo));
  if (destino) {
    navButtons.forEach((btn) => btn.classList.remove("active"));
    destino.classList.add("active");
    await loadPage(destino.dataset.page);
  } else {
    mostrarToast("Nenhuma tela encontrada para esta busca.", "error");
  }
});

// =========================================================
// TOGGLE MOSTRAR / OCULTAR SENHA — usada nos formularios de
// criacao de usuario (admin e gestor). Funcao global chamada
// via onclick inline nos botoes gerados no HTML dos modulos.
// =========================================================
window.toggleSenhaInput = function(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const visivel = input.type === "text";
  input.type = visivel ? "password" : "text";
  // Troca o icone Lucide: eye <-> eye-off
  const span = btn.querySelector("span[data-lucide]");
  if (span) {
    span.setAttribute("data-lucide", visivel ? "eye" : "eye-off");
    if (window.lucide) window.lucide.createIcons({ nodes: [span] });
  }
  btn.title = visivel ? "Mostrar senha" : "Ocultar senha";
};

// Injeta CSS do botao olho inline uma unica vez (evita duplicar via <style> multiplos)
if (!document.getElementById("eye-btn-style")) {
  const s = document.createElement("style");
  s.id = "eye-btn-style";
  s.textContent = `
    .input-eye-wrap{position:relative;display:flex;align-items:center;}
    .input-eye-wrap input{padding-right:42px;width:100%;}
    .btn-eye-inline{position:absolute;right:8px;top:50%;transform:translateY(-50%);
      background:transparent;border:none;box-shadow:none;padding:4px 6px;margin:0;
      color:var(--muted,#9CA3AF);cursor:pointer;display:flex;align-items:center;
      border-radius:6px;transition:color .15s,background .15s;line-height:1;}
    .btn-eye-inline:hover{color:var(--blue,#22D3EE);background:rgba(34,211,238,.08);}
    .btn-eye-inline svg{width:18px;height:18px;display:block;}
  `;
  document.head.appendChild(s);
}

// =========================================================
// INICIALIZACAO DO SISTEMA
// Cada etapa é isolada em try/catch para garantir que uma falha
// pontual (ex: localStorage corrompido, elemento DOM ausente)
// não impeça as etapas seguintes de executar.
// =========================================================
function _init_safe(fn, nome) {
  try { fn(); }
  catch (e) { console.warn("[init]", nome, "falhou:", e.message); }
}

_init_safe(aplicarTema,            "aplicarTema");
_init_safe(aplicarMarca,           "aplicarMarca");
_init_safe(aplicarInfoUsuarioSidebar, "aplicarInfoUsuarioSidebar");
_init_safe(aplicarEstadoSidebar,   "aplicarEstadoSidebar");
_init_safe(aplicarIconesNavegacao, "aplicarIconesNavegacao");
_init_safe(exigirLogin,            "exigirLogin");
_init_safe(aplicarPermissoesVisuais, "aplicarPermissoesVisuais");

// Carrega a primeira página e ativa os ícones Lucide após a renderização
loadPage(obterUsuarioSessao().perfil === "master" ? "admin" : "dashboard");

// Tenta ativar ícones Lucide imediatamente. Caso o script ainda não tenha
// carregado (CDN lento), agenda nova tentativa a cada 200ms por até 3s.
(function _ativarLucide(tentativas) {
  if (window.lucide) {
    window.lucide.createIcons();
  } else if (tentativas > 0) {
    setTimeout(() => _ativarLucide(tentativas - 1), 200);
  }
})(15);

// Sincroniza logo/nome com o servidor em background (não bloqueia a UI).
// Garante que todos os usuários da mesma empresa vejam a mesma marca.
sincronizarConfiguracaoEmpresa();
