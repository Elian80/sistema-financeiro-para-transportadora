// =========================================================
// CONFIGURAÃ‡ÃƒO BASE DA API
// =========================================================
const API_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "";

// =========================================================
// ELEMENTOS FIXOS DA TELA PRINCIPAL
// =========================================================
const pageContent = document.getElementById("page-content");
const pageTitle = document.getElementById("page-title");
const pageSubtitle = document.getElementById("page-subtitle");
const navButtons = document.querySelectorAll(".nav-btn");
const logoutBtn = document.getElementById("logout-btn");

// =========================================================
// CONTROLES DE EDIÃ‡ÃƒO
// =========================================================
let editandoVeiculoId = null;
let editandoMotoristaId = null;
let editandoLancamentoId = null;
let editandoPlanoContaId = null;
let cacheVeiculos = [];

// =========================================================
// DEFINIÃ‡ÃƒO DAS PÃGINAS DO SISTEMA
// =========================================================
const pages = {
  dashboard: {
    title: "Dashboard",
    subtitle: "VisÃ£o geral da operaÃ§Ã£o e do financeiro",
    render: () => `
      <div class="dashboard-grid">
        <section class="kpi-card dashboard-hero">
          <div class="kpi-label">Saldo do periodo</div>
          <div class="kpi-value" id="dashboard-saldo">R$ 0,00</div>
          <div class="dashboard-note" id="dashboard-periodo">Carregando dados...</div>
        </section>

        <section class="kpi-card">
          <div class="kpi-label">Receitas</div>
          <div class="kpi-value positive" id="dashboard-receitas">R$ 0,00</div>
          <div class="dashboard-note" id="dashboard-receitas-qtd">0 lancamentos</div>
        </section>

        <section class="kpi-card">
          <div class="kpi-label">Despesas</div>
          <div class="kpi-value negative" id="dashboard-despesas">R$ 0,00</div>
          <div class="dashboard-note" id="dashboard-despesas-qtd">0 lancamentos</div>
        </section>

        <section class="kpi-card">
          <div class="kpi-label">Frota ativa</div>
          <div class="kpi-value" id="dashboard-frota-ativa">0</div>
          <div class="dashboard-note" id="dashboard-frota-total">0 veiculos cadastrados</div>
        </section>
      </div>

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
    title: "VeÃ­culos",
    subtitle: "GestÃ£o visual da frota",
    render: () => `
      <div class="panel-box">
        <button class="primary-btn" id="btn-novo-veiculo">+ Cadastrar veÃ­culo</button>
      </div>

      <div class="panel-box">
        <h3>Filtros</h3>
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
              <option value="CaminhÃ£o">CaminhÃ£o</option>
              <option value="Carro">Carro</option>
              <option value="MÃ¡quina">MÃ¡quina</option>
            </select>
          </div>

          <div class="field">
            <label>Status</label>
            <select id="filtro-veiculo-status">
              <option value="">Todos</option>
              <option value="Ativo">Ativo</option>
              <option value="ManutenÃ§Ã£o">ManutenÃ§Ã£o</option>
              <option value="Inativo">Inativo</option>
            </select>
          </div>

          <div class="field full btn-row">
            <button class="ghost-btn" id="btn-filtrar-veiculos" type="button">Filtrar</button>
            <button class="ghost-btn" id="btn-limpar-filtro-veiculos" type="button">Limpar filtros</button>
          </div>
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom:18px;">
        <div class="kpi-card">
          <div class="kpi-label">Total de veÃ­culos</div>
          <div class="kpi-value" id="veiculos-total">0</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Ativos</div>
          <div class="kpi-value" id="veiculos-ativos">0</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Em manutenÃ§Ã£o</div>
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
      <div class="panel-box">
        <button class="primary-btn" id="btn-novo-motorista">+ Cadastrar motorista</button>
      </div>

      <div id="form-motorista-container"></div>
      <div id="lista-motoristas" class="table-wrap"></div>
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
    title: "LanÃ§amentos",
    subtitle: "Cadastro, conferÃªncia e filtros",
    render: () => `
      <div class="content-grid">
        <div class="panel-box">
          <h3 id="titulo-form-lancamento">Novo lanÃ§amento</h3>

          <form id="form-lancamento" class="form-grid">
            <div class="field full">
              <label for="classificacao">ClassificaÃ§Ã£o</label>
              <select id="classificacao" required>
                <option value="">Selecione...</option>
              </select>
            </div>

            <div class="field full">
              <label for="descricao">DescriÃ§Ã£o</label>
              <input type="text" id="descricao" placeholder="Digite a descriÃ§Ã£o" required />
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
              <button type="submit" class="primary-btn" id="btn-salvar-lancamento">Salvar lanÃ§amento</button>
              <button type="button" class="ghost-btn" id="btn-cancelar-edicao-lancamento" style="display:none;">Cancelar ediÃ§Ã£o</button>
            </div>
          </form>

          <p id="mensagem" class="mensagem"></p>
        </div>

        <div class="panel-box">
          <h3>Filtros</h3>
          <button type="button" class="ghost-btn filter-toggle" id="btn-toggle-filtros">Mostrar filtros</button>

          <div id="painel-filtros-lancamentos" class="filters-panel" style="display:none;">
          <div class="form-grid">
            <div class="field full">
              <label for="filtro-classificacao">ClassificaÃ§Ã£o</label>
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
              <label for="filtro-descricao">DescriÃ§Ã£o</label>
              <input type="text" id="filtro-descricao" placeholder="Buscar descriÃ§Ã£o" />
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
          </div>
        </div>
      </div>

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
          <div class="kpi-label">Maior lanÃ§amento</div>
          <div class="kpi-value" id="maior-valor">R$ 0,00</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Menor lanÃ§amento</div>
          <div class="kpi-value" id="menor-valor">R$ 0,00</div>
        </div>
      </div>

      <div class="panel-box">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">ConferÃªncia de lanÃ§amentos</h3>
            <span id="total-registros">0 registros</span>
          </div>

          <div class="btn-row">
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
                <th>ClassificaÃ§Ã£o</th>
                <th>Veiculo</th>
                <th>DescriÃ§Ã£o</th>
                <th>Valor</th>
                <th>AÃ§Ãµes</th>
              </tr>
            </thead>
            <tbody id="tabela-lancamentos">
              <tr>
                <td colspan="7" class="empty-row">Nenhum lanÃ§amento encontrado.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div id="modal-lancamentos" class="modal-overlay" style="display:none;">
        <div class="modal-content modal-xl">
          <div class="table-toolbar">
            <div>
              <h3 style="margin:0;">ConferÃªncia completa de lanÃ§amentos</h3>
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
                  <th>ClassificaÃ§Ã£o</th>
                <th>Veiculo</th>
                  <th>DescriÃ§Ã£o</th>
                  <th>Valor</th>
                  <th>AÃ§Ãµes</th>
                </tr>
              </thead>
              <tbody id="tabela-lancamentos-modal">
                <tr>
                  <td colspan="7" class="empty-row">Nenhum lanÃ§amento encontrado.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `
  },

  mapa: {
    title: "Mapa",
    subtitle: "LocalizaÃ§Ã£o operacional em tempo real",
    render: () => `
      <div class="panel-box">
        <h3>Mapa em tempo real</h3>
        <p>Aqui ficarÃ¡ a visualizaÃ§Ã£o dos caminhÃµes em tempo real.</p>
      </div>
    `
  }
};

// =========================================================
// FUNÃ‡Ã•ES AUXILIARES GERAIS
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
// FUNÃ‡Ã•ES DE API
// =========================================================
async function apiGet(url) {
  const response = await fetch(`${API_URL}${url}`);
  return response.json();
}

async function apiDelete(url) {
  const response = await fetch(`${API_URL}${url}`, {
    method: "DELETE"
  });

  return response.json();
}

async function apiSend(url, method, payload) {
  const response = await fetch(`${API_URL}${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const resultado = await response.json();

  if (!response.ok) {
    throw new Error(resultado.detail || "Erro ao salvar dados.");
  }

  return resultado;
}

// =========================================================
// MÃ“DULO DE VEÃCULOS
// =========================================================
async function carregarVeiculos() {
  return apiGet("/veiculos");
}

function iconePorTipo(tipo) {
  if (tipo === "CaminhÃ£o") return "ðŸš›";
  if (tipo === "Carro") return "ðŸš—";
  if (tipo === "MÃ¡quina") return "ðŸšœ";
  return "ðŸš˜";
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
    };
  }

  if (btnLimpar) {
    btnLimpar.onclick = async () => {
      document.getElementById("filtro-veiculo-nome").value = "";
      document.getElementById("filtro-veiculo-placa").value = "";
      document.getElementById("filtro-veiculo-tipo").value = "";
      document.getElementById("filtro-veiculo-status").value = "";
      await renderizarVeiculos();
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
  manutencao.textContent = veiculos.filter(v => v.status === "ManutenÃ§Ã£o").length;
  inativos.textContent = veiculos.filter(v => v.status === "Inativo").length;
}

async function renderizarVeiculos() {
  const container = document.getElementById("lista-veiculos");
  if (!container) return;

  let veiculos = await carregarVeiculos();
  veiculos = aplicarFiltrosVeiculos(veiculos);

  atualizarTotalizadoresVeiculos(veiculos);

  if (!veiculos.length) {
    container.innerHTML = `<div class="panel-box"><p>Nenhum veÃ­culo encontrado.</p></div>`;
    return;
  }

  container.innerHTML = veiculos.map(v => {
    const statusClass = (v.status || "").toLowerCase() === "ativo"
      ? "ativo"
      : (v.status || "").toLowerCase() === "manutenÃ§Ã£o"
      ? "manutencao"
      : "inativo";

    const topoCard = v.foto
      ? `<img src="${v.foto}" alt="Foto do veÃ­culo" class="vehicle-photo">`
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
            ${v.observacao ? v.observacao : "Sem observaÃ§Ãµes."}
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
  tipo = "CaminhÃ£o",
  status = "Ativo",
  observacao = "",
  foto = ""
) {
  const container = document.getElementById("form-veiculo-container");
  if (!container) return;

  const titulo = editandoVeiculoId ? "Alterar veÃ­culo" : "Novo veÃ­culo";
  const textoBotao = editandoVeiculoId ? "Salvar alteraÃ§Ã£o" : "Salvar";

  const previewInicial = foto
    ? `<img src="${foto}" alt="PrÃ©via da foto">`
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
            <option value="CaminhÃ£o" ${tipo === "CaminhÃ£o" ? "selected" : ""}>CaminhÃ£o</option>
            <option value="Carro" ${tipo === "Carro" ? "selected" : ""}>Carro</option>
            <option value="MÃ¡quina" ${tipo === "MÃ¡quina" ? "selected" : ""}>MÃ¡quina</option>
          </select>
        </div>

        <div class="field full">
          <label>Status</label>
          <select id="v-status">
            <option value="Ativo" ${status === "Ativo" ? "selected" : ""}>Ativo</option>
            <option value="ManutenÃ§Ã£o" ${status === "ManutenÃ§Ã£o" ? "selected" : ""}>ManutenÃ§Ã£o</option>
            <option value="Inativo" ${status === "Inativo" ? "selected" : ""}>Inativo</option>
          </select>
        </div>

        <div class="field full">
          <label>ObservaÃ§Ã£o</label>
          <input id="v-observacao" value="${observacao}" />
        </div>

        <div class="field full">
          <label>Foto do veÃ­culo</label>
          <input type="file" id="v-foto-arquivo" accept="image/*" />
          <input type="hidden" id="v-foto-base64" value="${foto}" />
        </div>

        <div class="field full">
          <label>PrÃ©via</label>
          <div class="photo-preview-box" id="v-foto-preview">
            ${previewInicial}
          </div>
        </div>

        <div class="field full btn-row">
          <button class="primary-btn" id="salvar-veiculo">${textoBotao}</button>
          <button class="ghost-btn" id="cancelar-veiculo">Cancelar</button>
        </div>
      </div>
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
    preview.innerHTML = `<img src="${base64}" alt="PrÃ©via da foto">`;
  });

  document.getElementById("salvar-veiculo").onclick = async () => {
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

    await fetch(`${API_URL}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    editandoVeiculoId = null;
    container.innerHTML = "";
    await renderizarVeiculos();
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
    veiculo.tipo || "CaminhÃ£o",
    veiculo.status || "Ativo",
    veiculo.observacao || "",
    veiculo.foto || ""
  );
};

window.excluirVeiculo = async (id) => {
  if (!confirm("Deseja excluir este veÃ­culo?")) return;

  await apiDelete(`/veiculos/${id}`);
  await renderizarVeiculos();
};

// =========================================================
// MÃ“DULO DE MOTORISTAS
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
          <th>Telefone</th>
          <th>CNH</th>
          <th>AÃ§Ãµes</th>
        </tr>
      </thead>

      <tbody>
        ${motoristas.map(m => `
          <tr>
            <td>${m.nome}</td>
            <td>${m.telefone}</td>
            <td>${m.cnh}</td>
            <td>
              <div class="action-row">
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

function abrirFormMotorista(nome = "", telefone = "", cnh = "") {
  const container = document.getElementById("form-motorista-container");
  if (!container) return;

  const titulo = editandoMotoristaId ? "Alterar motorista" : "Novo motorista";
  const textoBotao = editandoMotoristaId ? "Salvar alteraÃ§Ã£o" : "Salvar";

  container.innerHTML = `
    <div class="panel-box">
      <h3>${titulo}</h3>

      <div class="form-grid">
        <div class="field">
          <label>Nome</label>
          <input id="m-nome" value="${nome}" />
        </div>

        <div class="field">
          <label>Telefone</label>
          <input id="m-telefone" value="${telefone}" />
        </div>

        <div class="field full">
          <label>CNH</label>
          <input id="m-cnh" value="${cnh}" />
        </div>

        <div class="field full btn-row">
          <button class="primary-btn" id="salvar-motorista">${textoBotao}</button>
          <button class="ghost-btn" id="cancelar-motorista">Cancelar</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("salvar-motorista").onclick = async () => {
    const payload = {
      nome: document.getElementById("m-nome").value,
      telefone: document.getElementById("m-telefone").value,
      cnh: document.getElementById("m-cnh").value
    };

    const url = editandoMotoristaId ? `/motoristas/${editandoMotoristaId}` : "/motoristas";
    const method = editandoMotoristaId ? "PUT" : "POST";

    await fetch(`${API_URL}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    editandoMotoristaId = null;
    container.innerHTML = "";
    await renderizarMotoristas();
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

  abrirFormMotorista(
    motorista.nome || "",
    motorista.telefone || "",
    motorista.cnh || ""
  );
};

window.excluirMotorista = async (id) => {
  if (!confirm("Deseja excluir este motorista?")) return;

  await apiDelete(`/motoristas/${id}`);
  await renderizarMotoristas();
};

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
// MÃ“DULO DE LANÃ‡AMENTOS
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
  document.getElementById("kilometragem").value = item.kilometragem || "";
  document.getElementById("litros").value = item.litros || "";
  document.getElementById("numero-nf").value = item.numero_nf || "";
  document.getElementById("data-nf").value = item.data_nf || "";
  alternarCamposCombustivel();

  document.getElementById("titulo-form-lancamento").textContent = "Alterar lanÃ§amento";
  document.getElementById("btn-salvar-lancamento").textContent = "Salvar alteraÃ§Ã£o";
  document.getElementById("btn-cancelar-edicao-lancamento").style.display = "inline-block";
}

function resetFormLancamento() {
  editandoLancamentoId = null;
  document.getElementById("form-lancamento").reset();
  document.getElementById("titulo-form-lancamento").textContent = "Novo lanÃ§amento";
  document.getElementById("btn-salvar-lancamento").textContent = "Salvar lanÃ§amento";
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
        <td colspan="7" class="empty-row">Nenhum lanÃ§amento encontrado.</td>
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
  if (!confirm("Deseja excluir este lanÃ§amento?")) return;

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
  const btnToggleFiltros = document.getElementById("btn-toggle-filtros");
  const painelFiltros = document.getElementById("painel-filtros-lancamentos");
  const classificacaoSelect = document.getElementById("classificacao");

  classificacaoSelect.addEventListener("change", alternarCamposCombustivel);
  alternarCamposCombustivel();

  btnToggleFiltros.addEventListener("click", () => {
    const mostrar = painelFiltros.style.display === "none";
    painelFiltros.style.display = mostrar ? "block" : "none";
    btnToggleFiltros.textContent = mostrar ? "Ocultar filtros" : "Mostrar filtros";
  });

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

    const response = await fetch(`${API_URL}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const resultado = await response.json();

    if (!response.ok) {
      mensagem.textContent = resultado.detail || "Erro ao salvar lanÃ§amento.";
      return;
    }

    mensagem.textContent = editandoLancamentoId
      ? "LanÃ§amento alterado com sucesso."
      : "LanÃ§amento salvo com sucesso.";

    resetFormLancamento();
    await carregarLancamentos();
  });

  btnFiltrar.addEventListener("click", carregarLancamentos);

  btnLimpar.addEventListener("click", async () => {
    document.getElementById("filtro-classificacao").value = "";
    document.getElementById("filtro-data-inicial").value = "";
    document.getElementById("filtro-data-final").value = "";
    document.getElementById("filtro-descricao").value = "";
    document.getElementById("filtro-veiculo-id").value = "";
    await carregarLancamentos();
  });

  btnCancelarEdicao.addEventListener("click", resetFormLancamento);

  iniciarAcoesConferenciaLancamentos();
}

// =========================================================
// MODULO DE DASHBOARD
// =========================================================
async function iniciarDashboard() {
  const [lancamentos, veiculos, motoristas] = await Promise.all([
    apiGet("/lancamentos"),
    apiGet("/veiculos"),
    apiGet("/motoristas")
  ]);
  cacheVeiculos = veiculos;

  const receitas = lancamentos.filter(lancamentoEhReceita);
  const despesas = lancamentos.filter(item => !lancamentoEhReceita(item));
  const totalReceitas = receitas.reduce((total, item) => total + normalizarNumero(item.valor), 0);
  const totalDespesas = despesas.reduce((total, item) => total + normalizarNumero(item.valor), 0);
  const saldo = totalReceitas - totalDespesas;

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
  document.getElementById("dashboard-frota-ativa").textContent = ativos;
  document.getElementById("dashboard-frota-total").textContent = `${veiculos.length} veiculo(s) cadastrados`;
  document.getElementById("dashboard-veiculos-ativos").textContent = ativos;
  document.getElementById("dashboard-veiculos-manutencao").textContent = manutencao;
  document.getElementById("dashboard-veiculos-inativos").textContent = inativos;
  document.getElementById("dashboard-motoristas").textContent = motoristas.length;

  renderizarRankingClassificacoes(lancamentos);
  renderizarUltimosLancamentosDashboard(lancamentos);
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
// NAVEGAÃ‡ÃƒO ENTRE ABAS
// =========================================================
async function loadPage(pageKey) {
  const page = pages[pageKey];
  if (!page) return;

  pageTitle.textContent = page.title;
  pageSubtitle.textContent = page.subtitle;
  pageContent.innerHTML = page.render();

  if (pageKey === "dashboard") {
    await iniciarDashboard();
  }

  if (pageKey === "lancamentos") {
    await iniciarModuloLancamentos();
  }

  if (pageKey === "planoContas") {
    await iniciarPlanoContas();
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
  }
}

// =========================================================
// EVENTOS GERAIS
// =========================================================
navButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    navButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    await loadPage(button.dataset.page);
  });
});

logoutBtn.addEventListener("click", () => {
  window.location.href = "login.html";
});

// =========================================================
// INICIALIZAÃ‡ÃƒO DO SISTEMA
// =========================================================
loadPage("dashboard");
