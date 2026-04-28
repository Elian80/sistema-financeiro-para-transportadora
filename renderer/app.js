// =========================================================
// CONFIGURAÇÃO BASE DA API
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
// CONTROLES DE EDIÇÃO
// =========================================================
let editandoVeiculoId = null;
let editandoMotoristaId = null;
let editandoLancamentoId = null;
let editandoPlanoContaId = null;
let editandoContaReceberId = null;
let cacheVeiculos = [];

// =========================================================
// DEFINIÇÃO DAS PÁGINAS DO SISTEMA
// =========================================================
const pages = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Visão geral da operação e do financeiro",
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
    title: "Veículos",
    subtitle: "Gestão visual da frota",
    render: () => `
      <div class="panel-box">
        <button class="primary-btn" id="btn-novo-veiculo">+ Cadastrar veículos</button>
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
              <option value="Caminhão">Caminhão</option>
              <option value="Carro">Carro</option>
              <option value="Máquina">Máquina</option>
            </select>
          </div>

          <div class="field">
            <label>Status</label>
            <select id="filtro-veiculo-status">
              <option value="">Todos</option>
              <option value="Ativo">Ativo</option>
              <option value="Manutenção">Manutenção</option>
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
          <div class="kpi-label">Total de veículos</div>
          <div class="kpi-value" id="veiculos-total">0</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Ativos</div>
          <div class="kpi-value" id="veiculos-ativos">0</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Em manutenção</div>
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
    title: "Lançamentos",
    subtitle: "Cadastro, conferência e filtros",
    render: () => `
      <div class="content-grid">
        <div class="panel-box">
          <h3 id="titulo-form-lancamento">Novo lançamento</h3>

          <form id="form-lancamento" class="form-grid">
            <div class="field full">
              <label for="classificacao">Classificação</label>
              <select id="classificacao" required>
                <option value="">Selecione...</option>
              </select>
            </div>

            <div class="field full">
              <label for="descricao">Descrição</label>
              <input type="text" id="descricao" placeholder="Digite a descrição" required />
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
              <label for="obra-servico">Obra/serviço (opcional)</label>
              <input type="text" id="obra-servico" placeholder="Obra ou serviço" />
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
              <button type="submit" class="primary-btn" id="btn-salvar-lancamento">Salvar lançamento</button>
              <button type="button" class="ghost-btn" id="btn-cancelar-edicao-lancamento" style="display:none;">Cancelar edição</button>
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
              <label for="filtro-classificacao">Classificação</label>
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
              <label for="filtro-descricao">Descrição</label>
              <input type="text" id="filtro-descricao" placeholder="Buscar descrição" />
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
          <div class="kpi-label">Maior lançamento</div>
          <div class="kpi-value" id="maior-valor">R$ 0,00</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Menor lançamento</div>
          <div class="kpi-value" id="menor-valor">R$ 0,00</div>
        </div>
      </div>

      <div class="panel-box">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">Conferência de lançamentos</h3>
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
                <th>Classificação</th>
                <th>Veiculo</th>
                <th>Descrição</th>
                <th>Valor</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody id="tabela-lancamentos">
              <tr>
                <td colspan="7" class="empty-row">Nenhum lançamento encontrado.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div id="modal-lancamentos" class="modal-overlay" style="display:none;">
        <div class="modal-content modal-xl">
          <div class="table-toolbar">
            <div>
              <h3 style="margin:0;">Conferência completa de lançamentos</h3>
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
                  <th>Classificação</th>
                <th>Veiculo</th>
                  <th>Descrição</th>
                  <th>Valor</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody id="tabela-lancamentos-modal">
                <tr>
                  <td colspan="7" class="empty-row">Nenhum lançamento encontrado.</td>
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

        <div class="panel-box">
          <div class="table-toolbar">
            <div>
              <h3 style="margin:0;">Filtros</h3>
              <span>Localize contas por periodo, contrato, tomador ou veiculo</span>
            </div>
          </div>

          <button type="button" class="ghost-btn filter-toggle" id="btn-toggle-filtros-contas-receber">Mostrar filtros</button>

          <div id="painel-filtros-contas-receber" class="filters-panel" style="display:none;">
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
          </div>
        </div>
      </section>

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

          <button type="button" class="primary-btn" id="btn-imprimir-contas-receber">Imprimir</button>
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

  relatorios: {
    title: "Relatórios",
    subtitle: "Indicadores financeiros, gráficos e exportações",
    render: () => `
      <section class="panel-box">
        <div class="table-toolbar">
          <div>
            <h3 style="margin:0;">Filtros do relatório</h3>
            <span>Use os mesmos filtros para tela, PDF e Excel</span>
          </div>
        </div>

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
            <label for="rel-veiculo-id">Veículo</label>
            <select id="rel-veiculo-id">
              <option value="">Todos</option>
            </select>
          </div>

          <div class="field">
            <label for="rel-classificacao">Classificação</label>
            <select id="rel-classificacao">
              <option value="">Todas</option>
            </select>
          </div>

          <div class="field">
            <label for="rel-empresa-id">Empresa ID</label>
            <input type="number" id="rel-empresa-id" placeholder="Opcional" />
          </div>

          <div class="field">
            <label for="rel-obra-servico">Obra/serviço</label>
            <input id="rel-obra-servico" placeholder="Opcional" />
          </div>

          <div class="field full btn-row">
            <button type="button" class="primary-btn" id="btn-gerar-relatorio">Gerar relatório</button>
            <button type="button" class="ghost-btn" id="btn-exportar-pdf">Exportar PDF</button>
            <button type="button" class="ghost-btn" id="btn-exportar-excel">Exportar Excel</button>
          </div>
        </div>
      </section>

      <section id="relatorio-feedback"></section>

      <div class="kpi-grid report-kpis">
        <div class="kpi-card"><div class="kpi-label">Faturamento</div><div class="kpi-value positive" id="rel-fat">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Custos</div><div class="kpi-value negative" id="rel-custos">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Despesas</div><div class="kpi-value negative" id="rel-despesas">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Investimentos</div><div class="kpi-value" id="rel-invest">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Lucro bruto</div><div class="kpi-value" id="rel-lucro-bruto">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Lucro líquido</div><div class="kpi-value" id="rel-lucro-liquido">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Saldo do período</div><div class="kpi-value" id="rel-saldo">R$ 0,00</div></div>
        <div class="kpi-card"><div class="kpi-label">Contas pendentes</div><div class="kpi-value" id="rel-pendente">R$ 0,00</div></div>
      </div>

      <section class="report-charts">
        <div class="panel-box"><h3>Receitas x custos x despesas</h3><canvas id="chart-periodo" height="150"></canvas></div>
        <div class="panel-box"><h3>Distribuição por classificação</h3><canvas id="chart-classificacao" height="150"></canvas></div>
        <div class="panel-box"><h3>Resultado por veículo</h3><canvas id="chart-veiculo" height="150"></canvas></div>
        <div class="panel-box"><h3>Contas a receber</h3><canvas id="chart-contas" height="150"></canvas></div>
      </section>

      <section class="panel-box">
        <h3>Por classificação</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Classificação</th><th>Grupo</th><th>Quantidade</th><th>Total</th></tr></thead><tbody id="rel-tabela-classificacao"></tbody></table></div>
      </section>

      <section class="panel-box">
        <h3>Por veículo</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Veículo</th><th>Placa</th><th>Receitas</th><th>Custos</th><th>Despesas</th><th>Investimentos</th><th>Resultado</th><th>Custo/KM</th><th>Consumo médio</th></tr></thead><tbody id="rel-tabela-veiculo"></tbody></table></div>
      </section>

      <section class="panel-box">
        <h3>Por período</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Período</th><th>Receitas</th><th>Custos</th><th>Despesas</th><th>Investimentos</th><th>Resultado</th></tr></thead><tbody id="rel-tabela-periodo"></tbody></table></div>
      </section>

      <section class="panel-box">
        <h3>Contas a receber</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Contrato</th><th>Tomador</th><th>Total</th><th>Status</th></tr></thead><tbody id="rel-tabela-contas-receber"></tbody></table></div>
      </section>

      <section class="panel-box">
        <h3>Contas a pagar</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Descrição</th><th>Valor</th><th>Status</th></tr></thead><tbody id="rel-tabela-contas-pagar"></tbody></table></div>
      </section>
    `
  },

  mapa: {
    title: "Mapa",
    subtitle: "Localização operacional em tempo real",
    render: () => `
      <div class="panel-box">
        <h3>Mapa em tempo real</h3>
        <p>Aqui ficará a visualização dos caminhões em tempo real.</p>
      </div>
    `
  }
};

// =========================================================
// FUNÇÕES AUXILIARES GERAIS
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
// FUNÇÕES DE API
// =========================================================
async function apiGet(url) {
  const response = await fetch(`${API_URL}${url}`);
  const resultado = await response.json();

  if (!response.ok) {
    throw new Error(resultado.detail || "Falha ao carregar dados.");
  }

  return resultado;
}

async function apiDelete(url) {
  const response = await fetch(`${API_URL}${url}`, {
    method: "DELETE"
  });

  const resultado = await response.json();

  if (!response.ok) {
    throw new Error(resultado.detail || "Falha ao excluir registro.");
  }

  return resultado;
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

function mostrarErroAmigavel(containerId, erro) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `<p class="empty-row">Não foi possível carregar os dados. ${erro.message || ""}</p>`;
}

function abrirExportacao(url) {
  window.open(`${API_URL}${url}`, "_blank");
}

// =========================================================
// MÓDULO DE VEÍCULOS
// =========================================================
async function carregarVeiculos() {
  return apiGet("/veiculos");
}

function iconePorTipo(tipo) {
  if (tipo === "Caminhão") return "🚚";
  if (tipo === "Carro") return "🚗";
  if (tipo === "Máquina") return "🚜";
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
  manutencao.textContent = veiculos.filter(v => v.status === "Manutenção").length;
  inativos.textContent = veiculos.filter(v => v.status === "Inativo").length;
}

async function renderizarVeiculos() {
  const container = document.getElementById("lista-veiculos");
  if (!container) return;

  let veiculos = await carregarVeiculos();
  veiculos = aplicarFiltrosVeiculos(veiculos);

  atualizarTotalizadoresVeiculos(veiculos);

  if (!veiculos.length) {
    container.innerHTML = `<div class="panel-box"><p>Nenhum veículo encontrado.</p></div>`;
    return;
  }

  container.innerHTML = veiculos.map(v => {
    const statusClass = (v.status || "").toLowerCase() === "ativo"
      ? "ativo"
      : (v.status || "").toLowerCase() === "manutenção"
      ? "manutencao"
      : "inativo";

    const topoCard = v.foto
      ? `<img src="${v.foto}" alt="Foto do veículo" class="vehicle-photo">`
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
            ${v.observacao ? v.observacao : "Sem observações."}
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
  tipo = "Caminhão",
  status = "Ativo",
  observacao = "",
  foto = ""
) {
  const container = document.getElementById("form-veiculo-container");
  if (!container) return;

  const titulo = editandoVeiculoId ? "Alterar veículo" : "Novo veículo";
  const textoBotao = editandoVeiculoId ? "Salvar alteração" : "Salvar";

  const previewInicial = foto
    ? `<img src="${foto}" alt="Prévia da foto">`
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
            <option value="Caminhão" ${tipo === "Caminhão" ? "selected" : ""}>Caminhão</option>
            <option value="Carro" ${tipo === "Carro" ? "selected" : ""}>Carro</option>
            <option value="Máquina" ${tipo === "Máquina" ? "selected" : ""}>Máquina</option>
          </select>
        </div>

        <div class="field full">
          <label>Status</label>
          <select id="v-status">
            <option value="Ativo" ${status === "Ativo" ? "selected" : ""}>Ativo</option>
            <option value="Manutenção" ${status === "Manutenção" ? "selected" : ""}>Manutenção</option>
            <option value="Inativo" ${status === "Inativo" ? "selected" : ""}>Inativo</option>
          </select>
        </div>

        <div class="field full">
          <label>Observação</label>
          <input id="v-observacao" value="${observacao}" />
        </div>

        <div class="field full">
          <label>Foto do veículo</label>
          <input type="file" id="v-foto-arquivo" accept="image/*" />
          <input type="hidden" id="v-foto-base64" value="${foto}" />
        </div>

        <div class="field full">
          <label>Prévia</label>
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
    preview.innerHTML = `<img src="${base64}" alt="Prévia da foto">`;
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
    veiculo.tipo || "Caminhão",
    veiculo.status || "Ativo",
    veiculo.observacao || "",
    veiculo.foto || ""
  );
};

window.excluirVeiculo = async (id) => {
  if (!confirm("Deseja excluir este veículo?")) return;

  await apiDelete(`/veiculos/${id}`);
  await renderizarVeiculos();
};

// =========================================================
// MÓDULO DE MOTORISTAS
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
          <th>Ações</th>
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
  const textoBotao = editandoMotoristaId ? "Salvar alteração" : "Salvar";

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
// MÓDULO DE LANÇAMENTOS
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

  document.getElementById("titulo-form-lancamento").textContent = "Alterar lançamento";
  document.getElementById("btn-salvar-lancamento").textContent = "Salvar alteração";
  document.getElementById("btn-cancelar-edicao-lancamento").style.display = "inline-block";
}

function resetFormLancamento() {
  editandoLancamentoId = null;
  document.getElementById("form-lancamento").reset();
  document.getElementById("titulo-form-lancamento").textContent = "Novo lançamento";
  document.getElementById("btn-salvar-lancamento").textContent = "Salvar lançamento";
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
        <td colspan="7" class="empty-row">Nenhum lançamento encontrado.</td>
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
  if (!confirm("Deseja excluir este lançamento?")) return;

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

    const response = await fetch(`${API_URL}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const resultado = await response.json();

    if (!response.ok) {
      mensagem.textContent = resultado.detail || "Erro ao salvar lançamento.";
      return;
    }

    mensagem.textContent = editandoLancamentoId
      ? "Lançamento alterado com sucesso."
      : "Lançamento salvo com sucesso.";

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
  const btnToggleFiltros = document.getElementById("btn-toggle-filtros-contas-receber");
  const painelFiltros = document.getElementById("painel-filtros-contas-receber");

  ["cr-valor", "cr-bonificacao", "cr-descontos"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", atualizarTotalReceberPreview);
  });
  atualizarTotalReceberPreview();

  btnToggleFiltros.addEventListener("click", () => {
    const mostrar = painelFiltros.style.display === "none";
    painelFiltros.style.display = mostrar ? "block" : "none";
    btnToggleFiltros.textContent = mostrar ? "Ocultar filtros" : "Mostrar filtros";
  });

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
  btnFiltrar.addEventListener("click", carregarContasReceber);
  btnImprimir.addEventListener("click", () => imprimirElementoPorId("tabela-impressao-contas-receber"));

  btnLimpar.addEventListener("click", async () => {
    document.getElementById("cr-filtro-data-inicial").value = "";
    document.getElementById("cr-filtro-data-final").value = "";
    document.getElementById("cr-filtro-contrato").value = "";
    document.getElementById("cr-filtro-tomador").value = "";
    document.getElementById("cr-filtro-veiculo-id").value = "";
    await carregarContasReceber();
  });
}

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
      feedback.innerHTML = `<div class="panel-box"><p class="empty-row">Não foi possível gerar o relatório. ${erro.message || ""}</p></div>`;
    }
  }
}

async function iniciarRelatorios() {
  await carregarOpcoesRelatorios();
  await gerarRelatorio();

  document.getElementById("btn-gerar-relatorio").addEventListener("click", gerarRelatorio);
  document.getElementById("btn-exportar-pdf").addEventListener("click", () => {
    const params = parametrosRelatorio();
    abrirExportacao(`/relatorios/exportar/pdf${params.toString() ? `?${params.toString()}` : ""}`);
  });
  document.getElementById("btn-exportar-excel").addEventListener("click", () => {
    const params = parametrosRelatorio();
    abrirExportacao(`/relatorios/exportar/excel${params.toString() ? `?${params.toString()}` : ""}`);
  });
}

// =========================================================
// MODULO DE DASHBOARD
// =========================================================
async function iniciarDashboard() {
  const [lancamentos, veiculos, motoristas, resumoRelatorio] = await Promise.all([
    apiGet("/lancamentos"),
    apiGet("/veiculos"),
    apiGet("/motoristas"),
    apiGet("/relatorios/resumo")
  ]);
  cacheVeiculos = veiculos;

  const receitas = lancamentos.filter(lancamentoEhReceita);
  const despesas = lancamentos.filter(item => !lancamentoEhReceita(item));
  const totalReceitas = resumoRelatorio.total_faturamento;
  const totalDespesas = resumoRelatorio.total_custos + resumoRelatorio.total_despesas + resumoRelatorio.total_investimentos;
  const saldo = resumoRelatorio.saldo_periodo;

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
// NAVEGAÇÃO ENTRE ABAS
// =========================================================
async function loadPage(pageKey) {
  const page = pages[pageKey];
  if (!page) return;

  pageTitle.textContent = page.title;
  pageSubtitle.textContent = page.subtitle;
  pageContent.innerHTML = page.render();

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
  } catch (erro) {
    pageContent.innerHTML = `
      <div class="panel-box">
        <p class="empty-row">Não foi possível carregar esta tela. Verifique se o backend está rodando e tente novamente.</p>
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
    await loadPage(button.dataset.page);
  });
});

logoutBtn.addEventListener("click", () => {
  window.location.href = "login.html";
});

// =========================================================
// INICIALIZAÇÃO DO SISTEMA
// =========================================================
loadPage("dashboard");
