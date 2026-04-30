// =========================================================
// CONFIGURACAO BASE DA API
// =========================================================
const API_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8001" : "";

// =========================================================
// ELEMENTOS FIXOS DA TELA PRINCIPAL
// =========================================================
const pageContent = document.getElementById("page-content");
const pageTitle = document.getElementById("page-title");
const pageSubtitle = document.getElementById("page-subtitle");
const navButtons = document.querySelectorAll(".nav-btn");
const logoutBtn = document.getElementById("logout-btn");
const themeToggleBtn = document.getElementById("theme-toggle-btn");
const settingsBtn = document.getElementById("settings-btn");
const notificationBtn = document.getElementById("notification-btn");
const globalSearch = document.getElementById("global-search");
const sidebar = document.getElementById("sidebar");
const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
const mobileMenuBtn = document.getElementById("mobile-menu-btn");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");

const TABELA_INSS_2026 = [
  { limite: 1621.00, aliquota: 0.075 },
  { limite: 2902.84, aliquota: 0.09 },
  { limite: 4354.27, aliquota: 0.12 },
  { limite: 8475.55, aliquota: 0.14 },
];

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
// CONTROLES DE EDICAO
// =========================================================
let editandoVeiculoId = null;
let editandoMotoristaId = null;
let editandoLancamentoId = null;
let editandoPlanoContaId = null;
let editandoContaReceberId = null;
let editandoAtivoId = null;
let editandoPassivoId = null;
let editandoProdutoId = null;
let cacheVeiculos = [];
let filtroPeriodoFolha = "";

function aplicarIconesNavegacao() {
  navButtons.forEach((button) => {
    if (button.querySelector(".nav-icon")) return;
    const iconName = button.dataset.icon || "circle";
    const label = button.textContent.trim();
    const fallback = button.dataset.short || label.slice(0, 2).toUpperCase();
    button.innerHTML = `<span class="nav-icon" data-lucide="${iconName}">${fallback}</span><span class="nav-label">${label}</span>`;
  });
}

// =========================================================
// DEFINICAO DAS PAGINAS DO SISTEMA
// =========================================================
function botaoFiltros(painelId, texto = "Filtros") {
  return `<button type="button" class="ghost-btn filter-open-btn" data-filter-target="${painelId}">${texto}</button>`;
}

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

function sparklineSvg(pontos = "4,32 18,22 32,28 46,14 60,18 74,8 88,12") {
  return `
    <svg class="sparkline" viewBox="0 0 92 38" aria-hidden="true">
      <polyline points="${pontos}" />
    </svg>
  `;
}

function kpiTrend(valor, tipo = "positive") {
  const texto = valor || "+0.0%";
  return `<span class="kpi-trend ${tipo}">${texto}</span>`;
}

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
      <section class="panel-box filter-launcher">
        <div>
          <h3>Dashboard financeiro</h3>
          <p>Use filtros para recalcular os indicadores por periodo, veiculo ou empresa.</p>
        </div>
        ${botaoFiltros("painel-filtros-dashboard")}
      </section>

      ${popupFiltros("painel-filtros-dashboard", "Filtros do dashboard", "Refine os indicadores principais desta tela.", `
        <div class="form-grid">
          <div class="field"><label>Data inicial</label><input type="date" id="dash-data-inicial" /></div>
          <div class="field"><label>Data final</label><input type="date" id="dash-data-final" /></div>
          <div class="field"><label>Veiculo</label><select id="dash-veiculo-id"><option value="">Todos</option></select></div>
          <div class="field"><label>Empresa ID</label><input type="number" id="dash-empresa-id" placeholder="Opcional" /></div>
          <div class="field full btn-row"><button type="button" class="primary-btn" id="btn-dashboard-filtrar">Atualizar dashboard</button></div>
        </div>
      `)}

      <div class="dashboard-grid">
        <section class="kpi-card dashboard-hero">
          <div class="kpi-label">Saldo do periodo</div>
          <div class="kpi-value" id="dashboard-saldo">R$ 0,00</div>
          ${kpiTrend("+12.4%", "positive")}
          ${sparklineSvg("4,30 18,24 32,27 46,16 60,19 74,10 88,14")}
          <div class="dashboard-note" id="dashboard-periodo">Carregando dados...</div>
        </section>

        <section class="kpi-card">
          <div class="kpi-label">Receitas</div>
          <div class="kpi-value positive" id="dashboard-receitas">R$ 0,00</div>
          ${kpiTrend("+8.5%", "positive")}
          ${sparklineSvg("4,31 18,25 32,20 46,22 60,12 74,10 88,6")}
          <div class="dashboard-note" id="dashboard-receitas-qtd">0 lancamentos</div>
        </section>

        <section class="kpi-card">
          <div class="kpi-label">Despesas</div>
          <div class="kpi-value negative" id="dashboard-despesas">R$ 0,00</div>
          ${kpiTrend("-3.2%", "negative")}
          ${sparklineSvg("4,12 18,16 32,13 46,22 60,20 74,28 88,25")}
          <div class="dashboard-note" id="dashboard-despesas-qtd">0 lancamentos</div>
        </section>

        <section class="kpi-card">
          <div class="kpi-label">Frota ativa</div>
          <div class="kpi-value" id="dashboard-frota-ativa">0</div>
          ${kpiTrend("+2.0%", "positive")}
          ${sparklineSvg("4,26 18,26 32,22 46,22 60,18 74,18 88,14")}
          <div class="dashboard-note" id="dashboard-frota-total">0 veiculos cadastrados</div>
        </section>
      </div>

      <div class="kpi-grid" style="margin-bottom:18px;">
        <section class="kpi-card"><div class="kpi-label">Custos operacionais</div><div class="kpi-value negative" id="dashboard-custos">R$ 0,00</div>${kpiTrend("-1.8%", "negative")}${sparklineSvg("4,12 18,18 32,16 46,22 60,19 74,28 88,26")}</section>
        <section class="kpi-card"><div class="kpi-label">Investimentos</div><div class="kpi-value" id="dashboard-investimentos">R$ 0,00</div>${kpiTrend("+4.1%", "positive")}${sparklineSvg("4,30 18,30 32,24 46,18 60,20 74,14 88,9")}</section>
        <section class="kpi-card"><div class="kpi-label">Lucro bruto</div><div class="kpi-value" id="dashboard-lucro-bruto">R$ 0,00</div>${kpiTrend("+6.7%", "positive")}${sparklineSvg("4,32 18,24 32,26 46,18 60,12 74,14 88,8")}</section>
        <section class="kpi-card"><div class="kpi-label">Lucro liquido</div><div class="kpi-value" id="dashboard-lucro-liquido">R$ 0,00</div>${kpiTrend("+5.3%", "positive")}${sparklineSvg("4,30 18,28 32,20 46,22 60,16 74,10 88,12")}</section>
        <section class="kpi-card"><div class="kpi-label">Contas pendentes</div><div class="kpi-value warning" id="dashboard-contas-pendentes">R$ 0,00</div>${kpiTrend("alerta", "warning")}${sparklineSvg("4,18 18,14 32,22 46,18 60,26 74,22 88,30")}</section>
        <section class="kpi-card"><div class="kpi-label">Total de ativos</div><div class="kpi-value positive" id="dashboard-total-ativos">R$ 0,00</div>${kpiTrend("+9.0%", "positive")}${sparklineSvg("4,32 18,26 32,24 46,18 60,16 74,12 88,8")}</section>
        <section class="kpi-card"><div class="kpi-label">Total de passivos</div><div class="kpi-value negative" id="dashboard-total-passivos">R$ 0,00</div>${kpiTrend("-2.4%", "negative")}${sparklineSvg("4,14 18,18 32,22 46,20 60,25 74,28 88,30")}</section>
        <section class="kpi-card"><div class="kpi-label">Patrimonio liquido</div><div class="kpi-value" id="dashboard-patrimonio">R$ 0,00</div>${kpiTrend("+7.2%", "positive")}${sparklineSvg("4,32 18,24 32,27 46,18 60,20 74,12 88,10")}</section>
      </div>

      <section class="report-charts">
        <div class="panel-box chart-card chart-card-wide"><h3>Evolucao financeira</h3><canvas id="dash-chart-receitas-despesas" height="150"></canvas></div>
        <div class="panel-box"><h3>Custos por veiculo</h3><canvas id="dash-chart-custos-veiculo" height="150"></canvas></div>
        <div class="panel-box"><h3>Despesas por classificacao</h3><canvas id="dash-chart-despesas-classificacao" height="150"></canvas></div>
        <div class="panel-box"><h3>Faturamento mensal</h3><canvas id="dash-chart-faturamento-mensal" height="150"></canvas></div>
        <div class="panel-box"><h3>Saldo acumulado</h3><canvas id="dash-chart-saldo-acumulado" height="150"></canvas></div>
        <div class="panel-box"><h3>Contas a receber</h3><canvas id="dash-chart-contas-receber" height="150"></canvas></div>
      </section>

      <div class="dashboard-layout">
        <section class="panel-box">
          <div class="table-toolbar">
            <div>
              <h3 style="margin:0;">Resumo da frota</h3>
              <span>Status operacional dos veiculos</span>
            </div>
          </div>

          <div class="status-summary">
            <div class="status-line">
              <span>Ativos</span>
              <strong id="dashboard-veiculos-ativos">0</strong>
            </div>
            <div class="status-line">
              <span>Manutencao</span>
              <strong id="dashboard-veiculos-manutencao">0</strong>
            </div>
            <div class="status-line">
              <span>Inativos</span>
              <strong id="dashboard-veiculos-inativos">0</strong>
            </div>
            <div class="status-line">
              <span>Motoristas</span>
              <strong id="dashboard-motoristas">0</strong>
            </div>
          </div>
        </section>

        <section class="panel-box">
          <div class="table-toolbar">
            <div>
              <h3 style="margin:0;">Financeiro por classificacao</h3>
              <span>Maiores valores cadastrados</span>
            </div>
          </div>

          <div id="dashboard-classificacoes" class="ranking-list">
            <p class="empty-row">Carregando...</p>
          </div>
        </section>
      </div>

      <section class="panel-box">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">Ultimos lancamentos</h3>
            <span id="dashboard-total-lancamentos">0 registros</span>
          </div>
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Classificacao</th>
                <th>Veiculo</th>
                <th>Descricao</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody id="dashboard-ultimos-lancamentos">
              <tr>
                <td colspan="5" class="empty-row">Carregando...</td>
              </tr>
            </tbody>
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
                <th>Valor</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody id="tabela-lancamentos">
              <tr>
                <td colspan="7" class="empty-row">Nenhum lancamento encontrado.</td>
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
                  <th>Valor</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody id="tabela-lancamentos-modal">
                <tr>
                  <td colspan="7" class="empty-row">Nenhum lancamento encontrado.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
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
              <label for="cr-valor">Valor</label>
              <input type="number" id="cr-valor" step="0.01" placeholder="0.00" />
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
              <input type="number" id="cr-bonificacao" step="0.01" placeholder="0.00" />
            </div>

            <div class="field">
              <label for="cr-veiculo-id">Veiculo</label>
              <select id="cr-veiculo-id">
                <option value="">Sem vinculo</option>
              </select>
            </div>

            <div class="field">
              <label for="cr-descontos">Descontos</label>
              <input type="number" id="cr-descontos" step="0.01" placeholder="0.00" />
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
                <th>Carga</th>
                <th>Ton/Qnt</th>
                <th>Tomador</th>
                <th>Origem x destino</th>
                <th>Bonificacao</th>
                <th>Veiculo</th>
                <th>Descontos</th>
                <th>Valor total a receber</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody id="tabela-contas-receber">
              <tr>
                <td colspan="13" class="empty-row">Nenhuma conta a receber encontrada.</td>
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

      <section class="panel-box">
        <h3 id="titulo-form-produto">Novo produto</h3>
        <form id="form-produto" class="form-grid">
          <div class="field"><label>Nome</label><input id="produto-nome" required /></div>
          <div class="field"><label>Categoria</label><input id="produto-categoria" /></div>
          <div class="field"><label>Unidade</label><input id="produto-unidade" value="un" /></div>
          <div class="field"><label>Quantidade atual</label><input type="number" step="0.001" id="produto-quantidade" /></div>
          <div class="field"><label>Valor custo</label><input type="number" step="0.01" id="produto-valor" /></div>
          <div class="field"><label>Estoque minimo</label><input type="number" step="0.001" id="produto-minimo" /></div>
          <div class="field full"><label>Observacao</label><input id="produto-observacao" /></div>
          <div class="field full btn-row"><button class="primary-btn" type="submit">Salvar produto</button><button class="ghost-btn" type="button" id="btn-cancelar-produto" style="display:none;">Cancelar</button></div>
        </form>
        <p id="mensagem-produto" class="mensagem"></p>
      </section>

      <section class="panel-box filter-launcher">
        <div>
          <h3>Produtos</h3>
          <p>Filtre os produtos sem ocupar a area de trabalho.</p>
        </div>
        ${botaoFiltros("painel-filtros-estoque")}
      </section>

      ${popupFiltros("painel-filtros-estoque", "Filtros de estoque", "Busque produtos por nome, categoria ou alerta de estoque baixo.", `
        <div class="form-grid">
          <div class="field"><label>Nome</label><input id="filtro-produto-nome" /></div>
          <div class="field"><label>Categoria</label><input id="filtro-produto-categoria" /></div>
          <div class="field"><label>Somente baixo</label><select id="filtro-produto-baixo"><option value="">Todos</option><option value="true">Sim</option></select></div>
          <div class="field btn-row"><button class="ghost-btn" id="btn-filtrar-estoque" type="button">Filtrar</button><button class="ghost-btn" id="btn-limpar-estoque" type="button">Limpar</button></div>
        </div>
      `)}

      <section class="panel-box"><h3>Produtos</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Nome</th><th>Categoria</th><th>Qtd.</th><th>Custo</th><th>Total</th><th>Minimo</th><th>Acoes</th></tr></thead><tbody id="tabela-produtos"></tbody></table></div></section>

      <section class="panel-box">
        <h3>Movimentar estoque</h3>
        <form id="form-movimentacao" class="form-grid">
          <div class="field"><label>Produto</label><select id="mov-produto-id"></select></div>
          <div class="field"><label>Tipo</label><select id="mov-tipo"><option>Entrada</option><option>Saida</option><option>Ajuste</option></select></div>
          <div class="field"><label>Quantidade</label><input type="number" step="0.001" id="mov-quantidade" required /></div>
          <div class="field"><label>Valor unitario</label><input type="number" step="0.01" id="mov-valor" /></div>
          <div class="field"><label>Data</label><input type="date" id="mov-data" required /></div>
          <div class="field"><label>Observacao</label><input id="mov-observacao" /></div>
          <div class="field full"><button class="primary-btn" type="submit">Registrar movimentacao</button></div>
        </form>
        <p id="mensagem-movimentacao" class="mensagem"></p>
      </section>

      <section class="panel-box"><h3>Historico de movimentacoes</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Quantidade</th><th>Valor unitario</th><th>Observacao</th></tr></thead><tbody id="tabela-movimentacoes"></tbody></table></div></section>
    `
  },

  configuracoes: {
    title: "Configuracoes",
    subtitle: "Preferencias locais da empresa e aparencia",
    render: () => `
      <section class="panel-box">
        <form id="form-configuracoes" class="form-grid">
          <div class="field"><label>Nome da empresa</label><input id="config-empresa" /></div>
          <div class="field"><label>Logo da empresa</label><input id="config-logo" placeholder="URL ou base64" /></div>
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
          <div class="field"><label>Senha inicial</label><input id="usuario-senha" type="password" /></div>
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
        <div class="table-toolbar"><div><h3 style="margin:0;">Cadastro de empresa</h3><span>Somente master gerencia todas as empresas</span></div></div>
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

      <section class="panel-box">
        <div class="table-toolbar"><div><h3 style="margin:0;">Empresas cadastradas</h3><span>Bloqueie, aprove ou desative empresas</span></div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Empresa</th><th>CNPJ</th><th>Email</th><th>Status</th><th>Acoes</th></tr></thead><tbody id="tabela-admin-empresas"></tbody></table></div>
      </section>

      <section class="panel-box">
        <div class="table-toolbar"><div><h3 style="margin:0;">Cadastro de usuario</h3><span>Vincule usuarios a empresas e perfis</span></div></div>
        <form id="form-admin-usuario" class="form-grid">
          <div class="field"><label>Nome</label><input id="admin-usuario-nome" required /></div>
          <div class="field"><label>Email</label><input id="admin-usuario-email" type="email" required /></div>
          <div class="field"><label>Senha inicial</label><input id="admin-usuario-senha" type="password" required /></div>
          <div class="field"><label>Empresa</label><select id="admin-usuario-empresa"></select></div>
          <div class="field"><label>Perfil</label><select id="admin-usuario-perfil"><option value="visualizador">Visualizador</option><option value="operador">Operador</option><option value="financeiro">Financeiro</option><option value="gestor">Gestor</option><option value="admin">Admin</option><option value="master">Master</option></select></div>
          <div class="field"><label>Status</label><select id="admin-usuario-status"><option value="ativo">Ativo</option><option value="pendente">Pendente</option><option value="bloqueado">Bloqueado</option><option value="inativo">Inativo</option></select></div>
          <div class="field"><label>Telefone</label><input id="admin-usuario-telefone" /></div>
          <div class="field"><label>Cargo/Função</label><input id="admin-usuario-cargo" /></div>
          <div class="field full"><button class="primary-btn" type="submit">Salvar usuario</button></div>
        </form>
        <p id="mensagem-admin-usuario" class="mensagem"></p>
        <div class="table-wrap" style="margin-top:16px;"><table class="data-table"><thead><tr><th>Nome</th><th>Email</th><th>Empresa</th><th>Perfil</th><th>Status</th><th>Ultimo login</th><th>Acoes</th></tr></thead><tbody id="tabela-admin-usuarios"></tbody></table></div>
      </section>

      <section class="panel-box">
        <div class="table-toolbar"><div><h3 style="margin:0;">Auditoria</h3><span>Ultimas acoes administrativas</span></div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Acao</th><th>Entidade</th><th>ID</th><th>IP</th></tr></thead><tbody id="tabela-admin-auditoria"></tbody></table></div>
      </section>
    `
  },

  relatorios: {
    title: "Relatorios",
    subtitle: "Indicadores financeiros, graficos e exportacoes",
    render: () => `
      <section class="panel-box filter-launcher">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">Relatorios financeiros</h3>
            <span>Use os filtros para tela, PDF e Excel.</span>
          </div>
        </div>
        ${botaoFiltros("painel-filtros-relatorios")}
      </section>

      ${popupFiltros("painel-filtros-relatorios", "Filtros do relatorio", "Use os mesmos filtros para tela, PDF e Excel.", `
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
            <button type="button" class="ghost-btn" id="btn-exportar-pdf">Exportar PDF</button>
            <button type="button" class="ghost-btn" id="btn-exportar-excel">Exportar Excel</button>
          </div>
        </div>
      `)}

      <section id="relatorio-feedback"></section>

      <div class="kpi-grid report-kpis">
        <div class="kpi-card"><div class="kpi-label">Faturamento</div><div class="kpi-value positive" id="rel-fat">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Custos</div><div class="kpi-value negative" id="rel-custos">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Despesas</div><div class="kpi-value negative" id="rel-despesas">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Investimentos</div><div class="kpi-value" id="rel-invest">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Lucro bruto</div><div class="kpi-value" id="rel-lucro-bruto">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Lucro liquido</div><div class="kpi-value" id="rel-lucro-liquido">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Saldo do periodo</div><div class="kpi-value" id="rel-saldo">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Contas pendentes</div><div class="kpi-value" id="rel-pendente">R$ 0,00</div></div>
      </div>

      <section class="report-charts">
        <div class="panel-box"><h3>Receitas x custos x despesas</h3><canvas id="chart-periodo" height="150"></canvas></div>
        <div class="panel-box"><h3>Distribuicao por classificacao</h3><canvas id="chart-classificacao" height="150"></canvas></div>
        <div class="panel-box"><h3>Resultado por veiculo</h3><canvas id="chart-veiculo" height="150"></canvas></div>
        <div class="panel-box"><h3>Contas a receber</h3><canvas id="chart-contas" height="150"></canvas></div>
      </section>

      <section class="panel-box">
        <h3>Por classificacao</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Classificacao</th><th>Grupo</th><th>Quantidade</th><th>Total</th></tr></thead><tbody id="rel-tabela-classificacao"></tbody></table></div>
      </section>

      <section class="panel-box">
        <h3>Por veiculo</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Veiculo</th><th>Placa</th><th>Receitas</th><th>Custos</th><th>Despesas</th><th>Investimentos</th><th>Resultado</th><th>Custo/KM</th><th>Consumo medio</th></tr></thead><tbody id="rel-tabela-veiculo"></tbody></table></div>
      </section>

      <section class="panel-box">
        <h3>Por periodo</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Periodo</th><th>Receitas</th><th>Custos</th><th>Despesas</th><th>Investimentos</th><th>Resultado</th></tr></thead><tbody id="rel-tabela-periodo"></tbody></table></div>
      </section>

      <section class="panel-box">
        <h3>Contas a receber</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Contrato</th><th>Tomador</th><th>Total</th><th>Status</th></tr></thead><tbody id="rel-tabela-contas-receber"></tbody></table></div>
      </section>

      <section class="panel-box">
        <h3>Contas a pagar</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Descricao</th><th>Valor</th><th>Status</th></tr></thead><tbody id="rel-tabela-contas-pagar"></tbody></table></div>
      </section>
    `
  },

  mapa: {
    title: "Mapa",
    subtitle: "Localizacao operacional em tempo real",
    render: () => `
      <div class="panel-box">
        <h3>Mapa em tempo real</h3>
        <p>Aqui ficara a visualizacao dos caminhoes em tempo real.</p>
      </div>
    `
  }
};

// =========================================================
// FUNCOES AUXILIARES GERAIS
// =========================================================
function normalizarNumero(valor) {
  if (valor === null || valor === undefined || valor === "") return 0;

  if (typeof valor === "number") {
    return isNaN(valor) ? 0 : valor;
  }

  const texto = String(valor)
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();

  const numero = parseFloat(texto);
  return isNaN(numero) ? 0 : numero;
}

function formatarValor(valor) {
  const numero = normalizarNumero(valor);

  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function normalizarTexto(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function lancamentoEhReceita(item) {
  const texto = normalizarTexto(`${item.classificacao || ""} ${item.descricao || ""}`);
  return texto.includes("receita") || texto.includes("recebimento") || texto.includes("servicos prestados");
}

function formatarDataCurta(dataIso) {
  if (!dataIso) return "-";
  const partes = String(dataIso).split("-");
  if (partes.length !== 3) return dataIso;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function classificacaoEhCombustivel(valor) {
  return normalizarTexto(valor).includes("combustivel");
}

function nomeVeiculoPorId(veiculoId) {
  if (!veiculoId) return "-";
  const veiculo = cacheVeiculos.find(item => item.id === Number(veiculoId));
  if (!veiculo) return "-";
  return `${veiculo.nome || veiculo.modelo || "Veiculo"}${veiculo.placa ? ` (${veiculo.placa})` : ""}`;
}

// =========================================================
// FUNCOES DE API
// =========================================================
async function apiGet(url) {
  const response = await fetch(`${API_URL}${url}`, { headers: authHeaders() });
  const resultado = await response.json();

  tratarNaoAutorizado(response);
  if (!response.ok) {
    throw new Error(extrairMensagemErroApi(resultado, "Falha ao carregar dados."));
  }

  return resultado;
}

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

function getAccessToken() {
  return sessionStorage.getItem("financeiro_access_token") || "";
}

function authHeaders(headers = {}) {
  const token = getAccessToken();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

function tratarNaoAutorizado(response) {
  if (response.status !== 401) return;
  sessionStorage.removeItem("financeiro_access_token");
  sessionStorage.removeItem("financeiro_usuario");
  window.location.href = "login.html";
}

function exigirLogin() {
  if (!getAccessToken()) {
    window.location.href = "login.html";
  }
}

function mostrarErroAmigavel(containerId, erro) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `<p class="empty-row">Nao foi possivel carregar os dados. ${erro.message || ""}</p>`;
}

function abrirExportacao(url) {
  window.open(`${API_URL}${url}`, "_blank");
}

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
// =========================================================
async function carregarVeiculos() {
  return apiGet("/veiculos");
}

function iconePorTipo(tipo) {
  if (tipo === "Caminhao") return "🚚";
  if (tipo === "Carro") return "🚗";
  if (tipo === "Maquina") return "🚜";
  if (tipo === "Motocicleta") return "🏍️";
  return "🚘";
}

function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    if (!arquivo) {
      resolve("");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(arquivo);
  });
}

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

window.excluirVeiculo = async (id) => {
  if (!confirm("Deseja excluir este veiculo?")) return;

  await apiDelete(`/veiculos/${id}`);
  await renderizarVeiculos();
};

// =========================================================
// MODULO DE MOTORISTAS
// =========================================================
async function carregarMotoristas() {
  return apiGet("/motoristas");
}

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

async function carregarFolhasPagamento() {
  return apiGet("/folha-pagamento");
}

function escapeHtml(texto) {
  return String(texto ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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
  const salarioBase = horasNormais > 0 ? salarioContratual : 0;
  const valorExtras = horasExtras * valorHoraExtra;
  const totalAdicionais = adicionalNoturno + bonus;
  const salarioBruto = salarioBase + valorExtras + totalAdicionais;
  const descontoInss = calcularInssAutomatico(salarioBruto);
  const fgts = Math.round(salarioBruto * 0.08 * 100) / 100;
  const totalDescontos = descontoInss + descontoIrrf + descontoVale + descontoAdiantamento + outrosDescontos;
  const salarioLiquido = Math.max(salarioBruto - totalDescontos, 0);
  const campoInss = row.querySelector(".folha-desconto-inss");
  const campoDescricaoOutros = row.querySelector(".folha-outros-descricao");

  if (campoInss) {
    campoInss.value = descontoInss.toFixed(2);
  }
  if (campoDescricaoOutros) {
    campoDescricaoOutros.style.display = outrosDescontos > 0 ? "block" : "none";
  }

  row.querySelector(".folha-salario-base").textContent = formatarValor(salarioBase);
  row.querySelector(".folha-salario-bruto").textContent = formatarValor(salarioBruto);
  row.querySelector(".folha-total-descontos").textContent = formatarValor(totalDescontos);
  row.querySelector(".folha-salario-liquido").textContent = formatarValor(salarioLiquido);

  return { salarioBase, valorExtras, totalAdicionais, salarioBruto, descontoInss, fgts, totalDescontos, salarioLiquido };
}

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

function gerarDadosItemFolha(row) {
  const calculo = calcularLinhaFolha(row);
  return {
    motorista_id: Number(row.dataset.folhaMotoristaId),
    horas_normais: normalizarNumero(row.querySelector(".folha-horas-normais").value),
    valor_hora: 0,
    horas_extras: normalizarNumero(row.querySelector(".folha-horas-extras").value),
    valor_hora_extra: normalizarNumero(row.querySelector(".folha-valor-hora-extra").value),
    adicional_noturno: normalizarNumero(row.querySelector(".folha-adicional-noturno").value),
    bonus: normalizarNumero(row.querySelector(".folha-bonus").value),
    desconto_inss: calculo.descontoInss,
    desconto_irrf: normalizarNumero(row.querySelector(".folha-desconto-irrf")?.value),
    desconto_vale: normalizarNumero(row.querySelector(".folha-desconto-vale").value),
    desconto_adiantamento: normalizarNumero(row.querySelector(".folha-desconto-adiantamento").value),
    outros_descontos: normalizarNumero(row.querySelector(".folha-outros-descontos").value),
    salario_contratual: normalizarNumero(row.dataset.salarioContratual),
    base_inss: calculo.salarioBruto,
    base_fgts: calculo.salarioBruto,
    fgts: calculo.fgts,
    base_irrf: Math.max(calculo.salarioBruto - calculo.descontoInss, 0),
    observacao: row.querySelector(".folha-outros-descricao")?.value.trim() || ""
  };
}

function renderizarReciboPagamento(folha, item, motorista) {
  const percentualEfetivoInss = item.base_inss > 0 ? ((item.desconto_inss || 0) / item.base_inss) * 100 : 0;
  const competencia = folha.periodo ? folha.periodo.split("-").reverse().join("/") : "";
  const codigoFuncionario = String(item.motorista_id || motorista.id || "").padStart(5, "0");
  const formatarValorRecibo = (valor) => normalizarNumero(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const proventos = [
    { codigo: "011", descricao: "Salario-Base", referencia: `${item.horas_normais || 0} h`, valor: item.salario_base || 0 },
    { codigo: "012", descricao: "Horas extras", referencia: `${item.horas_extras || 0} h`, valor: item.valor_extras || 0 },
    { codigo: "013", descricao: "Adicionais/Bonus", referencia: "", valor: item.total_adicionais || 0 },
  ].filter((linha) => linha.valor > 0);

  const descontos = [
    { codigo: "310", descricao: "INSS", referencia: percentualEfetivoInss ? `${percentualEfetivoInss.toFixed(2)}% efetivo` : "Automatico", valor: item.desconto_inss || 0 },
    { codigo: "311", descricao: "IRRF", referencia: `${motorista.irrf_percentual || 0}%`, valor: item.desconto_irrf || 0 },
    { codigo: "914", descricao: "Vale Refeicao", referencia: "", valor: item.desconto_vale || 0 },
    { codigo: "915", descricao: "Adiantamento", referencia: "", valor: item.desconto_adiantamento || 0 },
    { codigo: "924", descricao: item.observacao || "Convenio medico / outros", referencia: "", valor: item.outros_descontos || 0 },
  ].filter((linha) => linha.valor > 0);

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
          <tr class="slip-bases-head">
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
          </tr>
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
                <label>Bonus<input class="folha-bonus" type="number" min="0" step="0.01" value="0" /></label>
                <label>INSS<input class="folha-desconto-inss" type="number" min="0" step="0.01" value="${descontoInss.toFixed(2)}" readonly /></label>
                <label>IRRF<input class="folha-desconto-irrf" type="number" min="0" step="0.01" value="${descontoIrrf.toFixed(2)}" /></label>
                <label>Vale<input class="folha-desconto-vale" type="number" min="0" step="0.01" value="${vale.toFixed(2)}" /></label>
                <label>Adiantamento<input class="folha-desconto-adiantamento" type="number" min="0" step="0.01" value="0" /></label>
                <label>Outros descontos<input class="folha-outros-descontos" type="number" min="0" step="0.01" value="${outros.toFixed(2)}" /></label>
                <label class="payroll-description-field">Descricao outros<input class="folha-outros-descricao" value="" placeholder="Descricao" style="${outros > 0 ? "" : "display:none;"}" /></label>
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
// =========================================================
async function carregarPlanoContas() {
  return apiGet("/plano-contas");
}

async function carregarEstruturaPlanoContas() {
  return apiGet("/plano-contas/estrutura");
}

async function renderizarEstruturaPlanoContas() {
  const container = document.getElementById("estrutura-plano-contas");
  if (!container) return;

  const estrutura = await carregarEstruturaPlanoContas();
  const grupos = estrutura.grupos || [];

  if (!grupos.length) {
    container.innerHTML = `<p class="empty-row">Nenhum grupo do plano base encontrado.</p>`;
    return;
  }

  container.innerHTML = grupos.map((grupo) => `
    <article class="account-group">
      <div class="account-group-title">
        <strong>${grupo.codigo}. ${grupo.nome}</strong>
        <span>${(grupo.itens || []).length} classificacao(oes)</span>
      </div>
      <div class="account-items">
        ${(grupo.itens || []).map((item) => `<span>${item}</span>`).join("")}
      </div>
    </article>
  `).join("");
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

async function iniciarPlanoContas() {
  const form = document.getElementById("form-plano-conta");
  const inputNome = document.getElementById("plano-conta-nome");
  const mensagem = document.getElementById("mensagem-plano-conta");
  const titulo = document.getElementById("titulo-form-plano-conta");
  const botaoSalvar = document.getElementById("btn-salvar-plano-conta");
  const botaoCancelar = document.getElementById("btn-cancelar-plano-conta");

  await renderizarEstruturaPlanoContas();
  await renderizarPlanoContas();

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
      botaoSalvar.textContent = "Salvar classificacao";
      botaoCancelar.style.display = "none";
      mensagem.textContent = "Classificacao salva com sucesso.";
      await renderizarPlanoContas();
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
};

window.excluirPlanoConta = async (id) => {
  if (!confirm("Deseja excluir esta classificacao?")) return;

  await apiDelete(`/plano-contas/${id}`);
  await renderizarPlanoContas();
};

// =========================================================
// MODULO DE LANCAMENTOS
// =========================================================
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

function alternarCamposCombustivel() {
  const classificacao = document.getElementById("classificacao")?.value || "";
  const campos = document.getElementById("campos-combustivel");
  if (!campos) return;

  campos.style.display = classificacaoEhCombustivel(classificacao) ? "block" : "none";
}

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

  document.getElementById("titulo-form-lancamento").textContent = "Alterar lancamento";
  document.getElementById("btn-salvar-lancamento").textContent = "Salvar alteracao";
  document.getElementById("btn-cancelar-edicao-lancamento").style.display = "inline-block";
}

function resetFormLancamento() {
  editandoLancamentoId = null;
  document.getElementById("form-lancamento").reset();
  document.getElementById("titulo-form-lancamento").textContent = "Novo lancamento";
  document.getElementById("btn-salvar-lancamento").textContent = "Salvar lancamento";
  document.getElementById("btn-cancelar-edicao-lancamento").style.display = "none";
  alternarCamposCombustivel();
}

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

function imprimirElementoPorId(elementId) {
  const elemento = document.getElementById(elementId);
  if (!elemento) return;

  elemento.classList.add("print-area");
  window.print();
  elemento.classList.remove("print-area");
}

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

function renderizarTabela(lancamentos) {
  const tabelaLancamentos = document.getElementById("tabela-lancamentos");
  const totalRegistros = document.getElementById("total-registros");

  atualizarTotalizadores(lancamentos);

  if (!lancamentos.length) {
    tabelaLancamentos.innerHTML = `
      <tr>
        <td colspan="7" class="empty-row">Nenhum lancamento encontrado.</td>
      </tr>
    `;
    totalRegistros.textContent = "0 registros";
    copiarTabelaLancamentosParaModal();
    return;
  }

  tabelaLancamentos.innerHTML = lancamentos.map((item) => `
    <tr>
      <td>${item.id}</td>
      <td>${item.data}</td>
      <td>${item.classificacao}</td>
      <td>${nomeVeiculoPorId(item.veiculo_id)}</td>
      <td>${item.descricao}</td>
      <td>${formatarValor(item.valor)}</td>
      <td>
        <div class="action-row">
          <button class="small-btn edit-btn" onclick="editarLancamentoPorId(${item.id})">Editar</button>
          <button class="small-btn delete-btn" onclick="excluirLancamento(${item.id})">Excluir</button>
        </div>
      </td>
    </tr>
  `).join("");

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

async function iniciarModuloLancamentos() {
  await carregarClassificacoes();
  await carregarVeiculosLancamento();
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
      data_nf: document.getElementById("data-nf").value || null
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
}

// =========================================================
// MODULO DE CONTAS A RECEBER
// =========================================================
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

function calcularTotalReceberFormulario() {
  const valor = normalizarNumero(document.getElementById("cr-valor")?.value);
  const bonificacao = normalizarNumero(document.getElementById("cr-bonificacao")?.value);
  const descontos = normalizarNumero(document.getElementById("cr-descontos")?.value);
  return valor + bonificacao - descontos;
}

function atualizarTotalReceberPreview() {
  const preview = document.getElementById("cr-total-preview");
  if (!preview) return;
  preview.textContent = formatarValor(calcularTotalReceberFormulario());
}

function montarPayloadContaReceber() {
  return {
    data_inicio: document.getElementById("cr-data-inicio").value,
    contrato: document.getElementById("cr-contrato").value.trim(),
    cte_ticket: document.getElementById("cr-cte-ticket").value.trim(),
    valor: normalizarNumero(document.getElementById("cr-valor").value),
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
  atualizarTotalReceberPreview();
}

function resetFormContaReceber() {
  editandoContaReceberId = null;
  document.getElementById("form-conta-receber").reset();
  document.getElementById("titulo-form-conta-receber").textContent = "Nova conta a receber";
  document.getElementById("btn-salvar-conta-receber").textContent = "Salvar conta";
  document.getElementById("btn-cancelar-conta-receber").style.display = "none";
  atualizarTotalReceberPreview();
}

function atualizarKpisContasReceber(contas) {
  const totalRegistros = document.getElementById("cr-total-registros-kpi");
  const totalBruto = document.getElementById("cr-total-bruto-kpi");
  const totalDescontos = document.getElementById("cr-total-descontos-kpi");
  const totalReceber = document.getElementById("cr-total-receber-kpi");

  if (!totalRegistros || !totalBruto || !totalDescontos || !totalReceber) return;

  const bruto = contas.reduce((total, item) => total + normalizarNumero(item.valor), 0);
  const descontos = contas.reduce((total, item) => total + normalizarNumero(item.descontos), 0);
  const receber = contas.reduce((total, item) => total + normalizarNumero(item.valor_total_receber), 0);

  totalRegistros.textContent = String(contas.length);
  totalBruto.textContent = formatarValor(bruto);
  totalDescontos.textContent = formatarValor(descontos);
  totalReceber.textContent = formatarValor(receber);
}

function renderizarTabelaContasReceber(contas) {
  const tabela = document.getElementById("tabela-contas-receber");
  const total = document.getElementById("cr-total-registros");
  if (!tabela || !total) return;

  atualizarKpisContasReceber(contas);

  if (!contas.length) {
    tabela.innerHTML = `<tr><td colspan="13" class="empty-row">Nenhuma conta a receber encontrada.</td></tr>`;
    total.textContent = "0 registros";
    return;
  }

  tabela.innerHTML = contas.map((item) => {
    const descontoDetalhe = item.desconto_classificacao
      ? `<small>${item.desconto_classificacao}</small>`
      : "";

    return `
      <tr>
        <td>${formatarDataCurta(item.data_inicio)}</td>
        <td>${item.contrato || ""}</td>
        <td>${item.cte_ticket || ""}</td>
        <td>${formatarValor(item.valor)}</td>
        <td>${item.carga || ""}</td>
        <td>${item.ton_qnt || ""}</td>
        <td>${item.tomador || ""}</td>
        <td>${item.origem_destino || ""}</td>
        <td>${formatarValor(item.bonificacao)}</td>
        <td>${nomeVeiculoPorId(item.veiculo_id)}</td>
        <td>${formatarValor(item.descontos)}${descontoDetalhe}</td>
        <td class="positive"><strong>${formatarValor(item.valor_total_receber)}</strong></td>
        <td>
          <div class="action-row">
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

async function iniciarContasReceber() {
  await carregarOpcoesContasReceber();
  await carregarContasReceber();

  const form = document.getElementById("form-conta-receber");
  const mensagem = document.getElementById("mensagem-conta-receber");
  const btnCancelar = document.getElementById("btn-cancelar-conta-receber");
  const btnFiltrar = document.getElementById("btn-filtrar-contas-receber");
  const btnLimpar = document.getElementById("btn-limpar-contas-receber");
  const btnImprimir = document.getElementById("btn-imprimir-contas-receber");

  ["cr-valor", "cr-bonificacao", "cr-descontos"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", atualizarTotalReceberPreview);
  });
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
// MODULO DE ATIVOS, PASSIVOS, ESTOQUE E CONFIGURACOES
// =========================================================
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
    i => `<div class="action-row"><button class="small-btn edit-btn" onclick="editarProduto(${i.id})">Editar</button><button class="small-btn delete-btn" onclick="excluirProduto(${i.id})">Excluir</button></div>`
  ]);
  const select = document.getElementById("mov-produto-id");
  select.innerHTML = produtos.map(item => `<option value="${item.id}">${item.nome}</option>`).join("");
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

function resetProduto() {
  editandoProdutoId = null;
  document.getElementById("form-produto").reset();
  document.getElementById("produto-unidade").value = "un";
  document.getElementById("btn-cancelar-produto").style.display = "none";
  document.getElementById("titulo-form-produto").textContent = "Novo produto";
}

window.editarProduto = async (id) => {
  const item = (await apiGet("/estoque/produtos")).find(registro => registro.id === id);
  if (!item) return;
  editandoProdutoId = id;
  document.getElementById("produto-nome").value = item.nome || "";
  document.getElementById("produto-categoria").value = item.categoria || "";
  document.getElementById("produto-unidade").value = item.unidade_medida || "un";
  document.getElementById("produto-quantidade").value = item.quantidade_atual || "";
  document.getElementById("produto-valor").value = item.valor_custo || "";
  document.getElementById("produto-minimo").value = item.estoque_minimo || "";
  document.getElementById("produto-observacao").value = item.observacao || "";
  document.getElementById("btn-cancelar-produto").style.display = "inline-block";
  document.getElementById("titulo-form-produto").textContent = "Alterar produto";
};

window.excluirProduto = async (id) => {
  if (!confirm("Deseja excluir este produto?")) return;
  await apiDelete(`/estoque/produtos/${id}`);
  mostrarToast("Produto excluido.", "success");
  await carregarEstoque();
};

async function iniciarEstoque() {
  await carregarEstoque();
  document.getElementById("form-produto").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await apiSend(editandoProdutoId ? `/estoque/produtos/${editandoProdutoId}` : "/estoque/produtos", editandoProdutoId ? "PUT" : "POST", payloadProduto());
      resetProduto();
      mostrarToast("Produto salvo.", "success");
      await carregarEstoque();
    } catch (erro) {
      document.getElementById("mensagem-produto").textContent = erro.message;
      mostrarToast(erro.message, "error");
    }
  });
  document.getElementById("form-movimentacao").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await apiSend("/estoque/movimentacoes", "POST", {
        produto_id: Number(document.getElementById("mov-produto-id").value),
        tipo_movimentacao: document.getElementById("mov-tipo").value,
        quantidade: normalizarNumero(document.getElementById("mov-quantidade").value),
        valor_unitario: normalizarNumero(document.getElementById("mov-valor").value),
        data: document.getElementById("mov-data").value,
        observacao: document.getElementById("mov-observacao").value.trim()
      });
      document.getElementById("form-movimentacao").reset();
      mostrarToast("Movimentacao registrada.", "success");
      await carregarEstoque();
    } catch (erro) {
      document.getElementById("mensagem-movimentacao").textContent = erro.message;
      mostrarToast(erro.message, "error");
    }
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
  document.getElementById("btn-cancelar-produto").addEventListener("click", resetProduto);
}

function carregarConfiguracoesLocais() {
  return JSON.parse(localStorage.getItem("financeiro_configuracoes") || "{}");
}

function aplicarTema() {
  const config = carregarConfiguracoesLocais();
  const tema = config.tema || localStorage.getItem("financeiro_tema") || "dark";
  document.body.dataset.theme = tema;
  document.documentElement.style.setProperty("--blue", config.corPrincipal || "#22D3EE");
}

function iniciarConfiguracoes() {
  const config = carregarConfiguracoesLocais();
  document.getElementById("config-empresa").value = config.nomeEmpresa || "";
  document.getElementById("config-logo").value = config.logoEmpresa || "";
  document.getElementById("config-tema").value = config.tema || localStorage.getItem("financeiro_tema") || "dark";
  document.getElementById("config-cor").value = config.corPrincipal || "#22D3EE";
  document.getElementById("config-moeda").value = config.moeda || "BRL";
  document.getElementById("config-relatorio").value = config.dadosRelatorio || "";
  document.getElementById("form-configuracoes").addEventListener("submit", (event) => {
    event.preventDefault();
    const novo = {
      nomeEmpresa: document.getElementById("config-empresa").value.trim(),
      logoEmpresa: document.getElementById("config-logo").value.trim(),
      tema: document.getElementById("config-tema").value,
      corPrincipal: document.getElementById("config-cor").value,
      moeda: document.getElementById("config-moeda").value.trim() || "BRL",
      dadosRelatorio: document.getElementById("config-relatorio").value.trim()
    };
    localStorage.setItem("financeiro_configuracoes", JSON.stringify(novo));
    localStorage.setItem("financeiro_tema", novo.tema);
    aplicarTema();
    mostrarToast("Configuracoes salvas.", "success");
  });
}

function obterUsuarioSessao() {
  try {
    return JSON.parse(sessionStorage.getItem("financeiro_usuario") || "{}");
  } catch {
    return {};
  }
}

function aplicarPermissoesVisuais() {
  const usuario = obterUsuarioSessao();
  const adminButton = document.querySelector('[data-page="admin"]');
  if (adminButton && usuario.perfil !== "master") {
    adminButton.hidden = true;
  }
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

async function iniciarAdminMaster() {
  await Promise.all([renderizarAdminResumo(), renderizarAdminEmpresas(), renderizarAdminUsuarios(), renderizarAdminAuditoria()]);

  const logoArquivo = document.getElementById("empresa-logo-arquivo");
  logoArquivo?.addEventListener("change", async () => {
    const arquivo = logoArquivo.files?.[0];
    if (!arquivo) return;
    if (arquivo.size > 1024 * 1024) {
      mostrarToast("Logo deve ter no maximo 1MB.", "error");
      logoArquivo.value = "";
      return;
    }
    document.getElementById("empresa-logo").value = await arquivoParaBase64(arquivo);
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
      await Promise.all([renderizarAdminResumo(), renderizarAdminUsuarios()]);
    } catch (erro) {
      mensagem.textContent = erro.message;
    }
  });
}

async function renderizarAdminResumo() {
  const resumo = await apiGet("/admin/resumo");
  document.getElementById("admin-total-empresas").textContent = resumo.empresas || 0;
  document.getElementById("admin-usuarios-ativos").textContent = resumo.usuarios_ativos || 0;
  document.getElementById("admin-usuarios-pendentes").textContent = resumo.usuarios_pendentes || 0;
  document.getElementById("admin-empresas-bloqueadas").textContent = resumo.empresas_bloqueadas || 0;
}

async function preencherSelectEmpresasAdmin() {
  const select = document.getElementById("admin-usuario-empresa");
  if (!select) return [];
  const empresas = await apiGet("/empresas");
  select.innerHTML = empresas.map((empresa) => `<option value="${empresa.id}">${escapeHtml(empresa.nome)}</option>`).join("");
  return empresas;
}

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
        <button class="small-btn" onclick="acaoEmpresa(${empresa.id}, 'aprovar')">Aprovar</button>
        <button class="small-btn delete-btn" onclick="acaoEmpresa(${empresa.id}, 'bloquear')">Bloquear</button>
        <button class="small-btn delete-btn" onclick="excluirEmpresaAdmin(${empresa.id})">Desativar</button>
      </div></td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="empty-row">Nenhuma empresa cadastrada.</td></tr>`;
}

async function renderizarAdminUsuarios() {
  const tabela = document.getElementById("tabela-admin-usuarios");
  if (!tabela) return;
  const [usuarios, empresas] = await Promise.all([apiGet("/usuarios"), apiGet("/empresas")]);
  const nomesEmpresas = new Map(empresas.map((empresa) => [empresa.id, empresa.nome]));
  tabela.innerHTML = usuarios.map((usuario) => `
    <tr>
      <td>${escapeHtml(usuario.nome)}</td>
      <td>${escapeHtml(usuario.email)}</td>
      <td>${escapeHtml(nomesEmpresas.get(usuario.empresa_id) || usuario.empresa_id)}</td>
      <td>${escapeHtml(usuario.perfil)}</td>
      <td>${escapeHtml(usuario.status)}</td>
      <td>${usuario.ultimo_login ? formatarDataCurta(usuario.ultimo_login) : "-"}</td>
      <td><div class="action-row">
        <button class="small-btn" onclick="acaoUsuario(${usuario.id}, 'aprovar')">Aprovar</button>
        <button class="small-btn delete-btn" onclick="acaoUsuario(${usuario.id}, 'bloquear')">Bloquear</button>
        <button class="small-btn delete-btn" onclick="acaoUsuario(${usuario.id}, 'desativar')">Desativar</button>
        <button class="small-btn" onclick="acaoUsuario(${usuario.id}, 'forcar-troca-senha')">Trocar senha</button>
      </div></td>
    </tr>
  `).join("") || `<tr><td colspan="7" class="empty-row">Nenhum usuario cadastrado.</td></tr>`;
}

async function renderizarAdminAuditoria() {
  const tabela = document.getElementById("tabela-admin-auditoria");
  if (!tabela) return;
  const logs = await apiGet("/audit-logs");
  tabela.innerHTML = logs.map((log) => `
    <tr>
      <td>${log.created_at ? formatarDataCurta(log.created_at) : "-"}</td>
      <td>${escapeHtml(log.acao)}</td>
      <td>${escapeHtml(log.entidade)}</td>
      <td>${escapeHtml(log.entidade_id)}</td>
      <td>${escapeHtml(log.ip || "-")}</td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="empty-row">Nenhum log encontrado.</td></tr>`;
}

window.acaoEmpresa = async (empresaId, acao) => {
  await apiSend(`/empresas/${empresaId}/${acao}`, "POST", {});
  await Promise.all([renderizarAdminResumo(), renderizarAdminEmpresas(), renderizarAdminAuditoria()]);
};

window.excluirEmpresaAdmin = async (empresaId) => {
  if (!confirm("Deseja desativar esta empresa?")) return;
  await apiDelete(`/empresas/${empresaId}`);
  await Promise.all([renderizarAdminResumo(), renderizarAdminEmpresas(), renderizarAdminAuditoria()]);
};

window.acaoUsuario = async (usuarioId, acao) => {
  await apiSend(`/usuarios/${usuarioId}/${acao}`, "POST", {});
  await Promise.all([renderizarAdminResumo(), renderizarAdminUsuarios(), renderizarAdminAuditoria()]);
};

// =========================================================
// MODULO DE RELATORIOS
// =========================================================
let relatorioCharts = [];

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
      plugins: { legend: { labels: { color: "#e8edf8" } } },
      scales: tipo === "pie" || tipo === "doughnut" ? {} : {
        x: { ticks: { color: "#98a3bd" }, grid: { color: "rgba(255,255,255,0.06)" } },
        y: { ticks: { color: "#98a3bd" }, grid: { color: "rgba(255,255,255,0.06)" } }
      }
    }
  });

  relatorioCharts.push(chart);
}

function renderizarGraficosRelatorio(dados) {
  destruirGraficosRelatorio();

  criarGrafico("chart-periodo", "bar", dados.por_periodo.map(i => i.periodo), [
    { label: "Receitas", data: dados.por_periodo.map(i => i.total_receitas), backgroundColor: "#7ef0a8" },
    { label: "Custos", data: dados.por_periodo.map(i => i.total_custos), backgroundColor: "#ff9e9e" },
    { label: "Despesas", data: dados.por_periodo.map(i => i.total_despesas), backgroundColor: "#fbbf24" }
  ]);

  criarGrafico("chart-classificacao", "doughnut", dados.por_classificacao.slice(0, 8).map(i => i.classificacao), [
    { label: "Total", data: dados.por_classificacao.slice(0, 8).map(i => Math.abs(i.total)), backgroundColor: ["#4f8cff", "#7ef0a8", "#fbbf24", "#ff9e9e", "#a78bfa", "#22d3ee", "#fb7185", "#c0cae0"] }
  ]);

  criarGrafico("chart-veiculo", "bar", dados.por_veiculo.slice(0, 8).map(i => i.nome_veiculo), [
    { label: "Resultado", data: dados.por_veiculo.slice(0, 8).map(i => i.resultado), backgroundColor: "#4f8cff" }
  ]);

  criarGrafico("chart-contas", "pie", ["Pendente", "Recebido"], [
    { label: "Contas a receber", data: [dados.resumo.contas_a_receber_pendente, dados.resumo.contas_a_receber_recebido], backgroundColor: ["#fbbf24", "#7ef0a8"] }
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

    preencherTabela("rel-tabela-classificacao", porClassificacao, [
      i => i.classificacao,
      i => i.grupo_financeiro,
      i => i.quantidade,
      i => formatarValor(i.total)
    ]);

    preencherTabela("rel-tabela-veiculo", porVeiculo, [
      i => i.nome_veiculo,
      i => i.placa,
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
      i => formatarValor(i.resultado)
    ]);

    preencherTabela("rel-tabela-contas-receber", contasReceber.itens || [], [
      i => formatarDataCurta(i.data_inicio),
      i => i.contrato || "",
      i => i.tomador || "",
      i => formatarValor(i.valor_total_receber),
      i => i.status_pagamento || "pendente"
    ]);

    preencherTabela("rel-tabela-contas-pagar", contasPagar.itens || [], [
      i => i.descricao || "",
      i => formatarValor(i.valor || 0),
      i => i.status_pagamento || "pendente"
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

async function iniciarDashboard() {
  await carregarSelectVeiculosGenerico("dash-veiculo-id", "Todos");
  const [lancamentos, veiculos, motoristas, dadosDashboard] = await Promise.all([
    apiGet("/lancamentos"),
    apiGet("/veiculos"),
    apiGet("/motoristas"),
    carregarResumoDashboard()
  ]);
  cacheVeiculos = veiculos;

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

  document.getElementById("dashboard-periodo").textContent = `${lancamentos.length} lancamento(s) cadastrados`;
  document.getElementById("dashboard-receitas").textContent = formatarValor(totalReceitas);
  document.getElementById("dashboard-receitas-qtd").textContent = `${receitas.length} lancamento(s)`;
  document.getElementById("dashboard-despesas").textContent = formatarValor(totalDespesas);
  document.getElementById("dashboard-despesas-qtd").textContent = `${despesas.length} lancamento(s)`;
  document.getElementById("dashboard-custos").textContent = formatarValor(dadosDashboard.resumo.custos_operacionais);
  document.getElementById("dashboard-investimentos").textContent = formatarValor(dadosDashboard.resumo.investimentos);
  document.getElementById("dashboard-lucro-bruto").textContent = formatarValor(dadosDashboard.resumo.lucro_bruto);
  document.getElementById("dashboard-lucro-liquido").textContent = formatarValor(dadosDashboard.resumo.lucro_liquido);
  document.getElementById("dashboard-contas-pendentes").textContent = formatarValor(dadosDashboard.resumo.valores_pendentes_a_receber);
  document.getElementById("dashboard-total-ativos").textContent = formatarValor(dadosDashboard.patrimonio.total_ativos);
  document.getElementById("dashboard-total-passivos").textContent = formatarValor(dadosDashboard.patrimonio.total_passivos);
  document.getElementById("dashboard-patrimonio").textContent = formatarValor(dadosDashboard.patrimonio.patrimonio_liquido);
  document.getElementById("dashboard-frota-ativa").textContent = ativos;
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
  document.getElementById("btn-dashboard-filtrar")?.addEventListener("click", async () => {
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
  if (pageKey === "admin" && obterUsuarioSessao().perfil !== "master") {
    pageKey = "dashboard";
    mostrarToast("Acesso administrativo disponivel apenas para usuario master.", "error");
  }

  const page = pages[pageKey];
  if (!page) return;

  pageTitle.textContent = page.title;
  pageSubtitle.textContent = page.subtitle;
  pageContent.innerHTML = page.render();
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

window.addEventListener("resize", aplicarEstadoSidebar);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    fecharTodosPopupsFiltros();
  }
});

logoutBtn.addEventListener("click", () => {
  sessionStorage.removeItem("financeiro_access_token");
  sessionStorage.removeItem("financeiro_usuario");
  window.location.href = "login.html";
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
// INICIALIZACAO DO SISTEMA
// =========================================================
aplicarTema();
aplicarEstadoSidebar();
aplicarIconesNavegacao();
exigirLogin();
aplicarPermissoesVisuais();
loadPage("dashboard");
window.lucide?.createIcons();
