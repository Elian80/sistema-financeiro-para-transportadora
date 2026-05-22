# Mapeamento Extremamente Detalhado da Interface e Código

Este documento foi criado para manutenção profunda: cada janela/tela, botão principal, formulário, evento e integração com backend.

## 1) Estrutura Geral da Aplicação (Frontend)

### Arquivos principais
- `renderer/index.html`: shell principal do painel (sidebar, topbar, container dinâmico).
- `renderer/app.js`: SPA inteira (roteamento interno, render de telas, eventos, CRUD, gráficos, mapa).
- `renderer/style.css`: estilo do painel administrativo.
- `renderer/login.html` + `renderer/login.js`: autenticação do usuário administrativo.
- `renderer/motorista.html` + `renderer/motorista.js`: app mobile/PWA do motorista.
- `renderer/pwa.js` e `renderer/sw.js`: instalação/cache PWA.

### Como a navegação funciona
1. `index.html` carrega apenas o layout fixo.
2. `app.js` define `const pages = { ... }`.
3. Ao clicar no menu (`.nav-btn` com `data-page`), `loadPage(pageKey)`:
   - atualiza título/subtítulo;
   - injeta `pages[pageKey].render()` em `#page-content`;
   - chama o inicializador da tela (`iniciarDashboard`, `iniciarEstoque`, etc.);
   - liga eventos dos botões recém-renderizados.

## 2) Janela de Login Administrativo (`login.html` + `login.js`)

### Componentes
- Formulário: `#login-form`
- Campo e-mail: `#usuario`
- Campo senha: `#senha`
- Botão submit: `#login-submit`
- Mensagem erro: `#erro-login`
- Mensagem status: `#login-status`
- Botão ajuda de acesso: `#solicitar-acesso`
- Botão instalar PWA: `#install-pwa-btn` (controlado por `pwa.js`)

### Fluxo de clique/submit
1. Submit em `#login-form`.
2. `login.js` chama `POST /auth/login`.
3. Se sucesso:
   - salva `financeiro_access_token` no `sessionStorage`;
   - salva `financeiro_usuario` no `sessionStorage`;
   - redireciona para `index.html`.
4. Se erro: exibe texto em `#erro-login`.

## 3) Shell Principal (`index.html`)

### Sidebar (menu esquerdo)
Botões `.nav-btn`:
- `data-page="dashboard"`
- `data-page="veiculos"`
- `data-page="motoristas"`
- `data-page="planoContas"`
- `data-page="lancamentos"`
- `data-page="contasReceber"`
- `data-page="relatorios"`
- `data-page="ativosPassivos"`
- `data-page="estoque"`
- `data-page="admin"`
- `data-page="mapa"`

Cada botão aciona `loadPage(...)`.

### Topbar
- `#mobile-menu-btn`: abre sidebar mobile.
- `#page-title` e `#page-subtitle`: atualizados por `loadPage`.
- `#global-search`: Enter tenta localizar página pelo texto do menu.
- `#install-pwa-btn`: instalação do app.
- `#notification-btn`: toast de “sem notificações”.
- `#settings-btn`: abre tela de configurações.
- `#logout-btn`: limpa sessão e volta ao login.

### Área dinâmica de telas
- `#page-content`: container onde cada “janela” da aplicação é injetada.

## 4) Dashboard (`pages.dashboard` + `iniciarDashboard`)

### Painel/Filtro
- Botão filtros: abre `#painel-filtros-dashboard`.
- `#btn-dashboard-filtrar`: aplica período/veículo/empresa.
- `#btn-dashboard-limpar`: limpa filtros.

### Ações
- `#btn-dashboard-horas`: recalcula horas-máquinas.

### Renderizações principais
- KPIs em elementos `#dashboard-*`.
- Tabela de últimos lançamentos.
- Ranking de classificações.
- Gráficos via Chart.js:
  - receitas x despesas
  - custos por veículo
  - despesas por classificação
  - faturamento mensal
  - saldo acumulado
  - contas a receber

### Endpoints usados
- `GET /relatorios/resumo`
- `GET /lancamentos`
- `GET /veiculos`
- `GET /motoristas`
- `GET /contas-receber`

## 5) Veículos (`pages.veiculos`)

### Botões principais
- `#btn-novo-veiculo`: abre formulário de criação.
- `#btn-filtrar-veiculos`: aplica filtros.
- `#btn-limpar-filtro-veiculos`: limpa filtros.
- Em cada linha:
  - `Editar` -> `window.editarVeiculoPorId(id)`
  - `Excluir` -> `window.excluirVeiculo(id)`

### Formulário/modal inline
- Salvar: `#salvar-veiculo`
- Cancelar: `#cancelar-veiculo`
- Upload foto: `#veiculo-foto-arquivo`

### Endpoints
- `GET /veiculos`
- `POST /veiculos`
- `PUT /veiculos/{id}`
- `DELETE /veiculos/{id}`

## 6) Motoristas + Folha (`pages.motoristas`)

### Tabela de motoristas
Botões por linha:
- `Folha` -> `window.abrirFolhaMotorista(id)`
- `Editar` -> `window.editarMotoristaPorId(id)`
- `Excluir` -> `window.excluirMotorista(id)`

### Form motorista
- Salvar: `#salvar-motorista`
- Cancelar: `#cancelar-motorista`

### Folha de pagamento (janela/modal)
- Fechar: `#btn-fechar-folha`
- Recalcular: `#btn-recalcular-folha`
- Salvar folha: `#btn-salvar-folha`
- Histórico:
  - `Imprimir` -> `window.imprimirFolhaSalva(folhaId)`
  - `Excluir` -> `window.excluirFolhaPagamento(folhaId)`

### Endpoints
- `GET /motoristas`
- `POST /motoristas`
- `PUT /motoristas/{id}`
- `DELETE /motoristas/{id}`
- `GET /folha-pagamento`
- `POST /folha-pagamento`
- `DELETE /folha-pagamento/{id}`

## 7) Plano de Contas (`pages.planoContas`)

### Controles
- Submit `#form-plano-conta`: cria/atualiza classificação.
- Cancelar edição: botão de cancelar.
- Ações por linha:
  - `Editar` -> `window.editarPlanoConta(id)`
  - `Excluir` -> `window.excluirPlanoConta(id)`

### Endpoints
- `GET /plano-contas`
- `POST /plano-contas`
- `PUT /plano-contas/{id}`
- `DELETE /plano-contas/{id}`
- `GET /classificacoes/estrutura`

## 8) Lançamentos (`pages.lancamentos`)

### Controles principais
- Submit `#form-lancamento`: cria/atualiza.
- `#btn-filtrar-lancamentos`
- `#btn-limpar-lancamentos`
- `#btn-cancelar-edicao-lancamento`
- Ações por linha:
  - `Editar` -> `window.editarLancamentoPorId(id)`
  - `Excluir` -> `window.excluirLancamento(id)`

### Conferência e impressão
- `#btn-conferencia-tela-cheia`
- `#btn-conferencia-fechar-modal`
- `#btn-imprimir-conferencia`
- `#btn-imprimir-conferencia-modal`

### Endpoints
- `GET /lancamentos`
- `POST /lancamentos`
- `PUT /lancamentos/{id}`
- `DELETE /lancamentos/{id}`

## 9) Contas a Receber (`pages.contasReceber`)

### Botões e ações
- Submit `#form-conta-receber`
- `#btn-cancelar-conta-receber`
- `#btn-filtrar-contas-receber`
- `#btn-limpar-contas-receber`
- `#btn-imprimir-contas-receber`
- Em cada linha:
  - `Receber/Reabrir` -> `window.alterarStatusContaReceber(id, status)`
  - `Editar` -> `window.editarContaReceberPorId(id)`
  - `Excluir` -> `window.excluirContaReceber(id)`

### Endpoints
- `GET /contas-receber`
- `POST /contas-receber`
- `PUT /contas-receber/{id}`
- `DELETE /contas-receber/{id}`

## 10) Ativos e Passivos (`pages.ativosPassivos`)

### Ativos
- Submit `#form-ativo`
- `#btn-cancelar-ativo`
- Em tabela:
  - `Editar` -> `window.editarAtivo(id)`
  - `Excluir` -> `window.excluirAtivo(id)`

### Passivos
- Submit `#form-passivo`
- `#btn-cancelar-passivo`
- Em tabela:
  - `Editar` -> `window.editarPassivo(id)`
  - `Excluir` -> `window.excluirPassivo(id)`

### Endpoints
- `GET/POST/PUT/DELETE /ativos`
- `GET/POST/PUT/DELETE /passivos`

## 11) Estoque (`pages.estoque`)

### Barra principal
- `#btn-novo-produto`: abre painel de produto.
- `#btn-movimentar-estoque`: abre painel de movimentação.
- `#btn-filtrar-estoque`
- `#btn-limpar-estoque`

### Painel produto
- `#form-produto` (submit)
- `#btn-fechar-painel-produto`
- `#btn-cancelar-produto`

### Painel movimentação
- `#form-movimentacao` (submit)
- `#btn-fechar-painel-mov`
- `#btn-cancelar-movimentacao`

### Ações por item
- `Editar` -> `window.editarProduto(id, this)` (edição inline)
- `Excluir` -> `window.excluirProduto(id)`
- Edição inline:
  - `#btn-salvar-inline`
  - `#btn-cancelar-inline`

### Endpoints
- `GET/POST/PUT/DELETE /estoque/produtos`
- `GET/POST /estoque/movimentacoes`
- `GET /estoque/resumo`

## 12) Configurações + Usuários (não master)

### Configurações
- Submit `#form-configuracoes`: salva preferências locais (tema/visual).

### Usuários
- Submit `#form-usuario`: cria usuário.
- Botão por linha: `Desativar` -> `window.desativarUsuario(id)`.

### Endpoints
- `GET /usuarios`
- `POST /usuarios`
- `POST /usuarios/{id}/desativar`

## 13) Admin Master (`pages.admin`)

### Modais e botões de abertura
- `#btn-abrir-admin-empresa` / `#btn-fechar-admin-empresa`
- `#btn-abrir-admin-usuario` / `#btn-fechar-admin-usuario`

### Empresa
- Submit `#form-admin-empresa`
- Upload logo: `#admin-empresa-logo-arquivo`
- Na tabela:
  - `Gerenciar` -> `window.gerenciarEmpresaAdmin(id)`
  - `Aprovar` -> `window.acaoEmpresa(id, 'aprovar')`
  - `Bloquear` -> `window.acaoEmpresa(id, 'bloquear')`
  - `Desativar` -> `window.excluirEmpresaAdmin(id)`

### Usuário
- Submit `#form-admin-usuario`
- Na tabela:
  - `Aprovar` -> `window.acaoUsuario(id, 'aprovar')`
  - `Bloquear` -> `window.acaoUsuario(id, 'bloquear')`
  - `Desativar` -> `window.acaoUsuario(id, 'desativar')`
  - `Definir senha` -> `window.resetarSenhaUsuario(id)`
  - `Excluir` -> `window.excluirUsuarioAdmin(id)`

### Auditoria
- `Excluir` -> `window.excluirLogAdmin(logId)`

### Acessos motorista
- `Copiar link` -> `window.copiarLinkApp(url)`
- `Excluir` -> `window.excluirAcessoMotorista(id)`
- `Ativar/Desativar` -> `window.toggleAtivoMotorista(id, ativo)`
- Form acesso:
  - `#btn-salvar-acesso-motorista`
  - `#btn-cancelar-acesso-motorista`

### Endpoints
- `/empresas*`, `/usuarios*`, `/audit-logs*`, `/motorista-acessos*`, `/admin/resumo`

## 14) Relatórios (`pages.relatorios`)

### Botões
- `#btn-gerar-relatorio`
- `#btn-limpar-relatorio`
- `#btn-imprimir-relatorio`
- `#btn-exportar-pdf`
- `#btn-exportar-excel`

### Renderização
- Cards resumo e insights.
- Gráficos Chart.js.
- Tabelas por classificação e por veículo.

### Endpoints
- `GET /relatorios/resumo`
- `GET /relatorios/exportar/pdf`
- `GET /relatorios/exportar/excel`

## 15) Mapa em Tempo Real (`pages.mapa`)

### Componentes e botões
- Container mapa: `#mapa-operacional` (Leaflet).
- `#btn-mapa-centralizar`: recentraliza nos motoristas ativos.
- Lista lateral com cards de motorista:
  - clique chama `window.focarMotoristaMapa(motorista_acesso_id)`.

### Atualização
- `iniciarMapa()` cria mapa e inicia polling.
- `setInterval(..., 5000)` chama `atualizarMapaMotoristas()`.
- Marcadores em `mapaMarkers` (`Map` por motorista).

### Endpoint
- `GET /mapa/motoristas`

## 16) App Motorista (`motorista.html` + `motorista.js`)

### Tela login
- `#form-login`, `#login-email`, `#login-senha`, `#login-erro`

### Header
- `#header-avatar`, `#header-nome`, `#header-status-gps`
- `#btn-sair`

### Viagem
- Início:
  - `#btn-iniciar-viagem`
  - `#form-iniciar-viagem`
  - `#btn-cancelar-iniciar`
- Finalização:
  - `#btn-finalizar-viagem`
  - `#form-finalizar-viagem`
  - `#btn-cancelar-finalizar`

### GPS
- `#toggle-gps`: liga/desliga `watchPosition`.
- `#gps-coords`, `#gps-velocidade`.

### Histórico
- `#lista-viagens`.

### Endpoints usados
- `POST /motorista-app/login`
- `GET /motorista-app/me`
- `POST /motorista-app/viagem/iniciar`
- `PUT /motorista-app/viagem/{id}/finalizar`
- `POST /motorista-app/viagem/{id}/ponto`
- `POST /motorista-app/localizacao`
- `GET /motorista-app/viagens`
- `GET /veiculos` (popular select de veículo)

## 17) PWA (`pwa.js` e `sw.js`)

### `pwa.js`
- Captura `beforeinstallprompt`.
- Mostra/oculta `#install-pwa-btn`.
- Registra Service Worker (`/sw.js`).

### `sw.js`
- Cache app shell (`CACHE_NAME`).
- Rotas de dados financeiras forçam `fetch` de rede.
- Navegação usa fallback para `/login.html` em caso de offline.

## 18) Observações Técnicas para Manutenção

1. Muitas ações de tabela usam `onclick` inline com funções globais `window.*`.
2. Toda troca de tela reinjeta HTML: sempre religar eventos no inicializador da tela.
3. IDs duplicados entre telas são seguros porque só existe uma tela renderizada por vez em `#page-content`.
4. Evitar mover nomes de IDs/botões sem atualizar os listeners em `app.js`.
5. Para novas telas, seguir padrão:
   - inserir entrada em `pages`;
   - criar `iniciarNovaTela()`;
   - acionar no `loadPage`.

