const pageContainer = document.getElementById('page-container');
const pageTitle = document.getElementById('page-title');
const menuButtons = document.querySelectorAll('.menu-btn');
const configButton = document.getElementById('config-btn');

const pages = {
  dashboard: `
    <h2 class="page-section-title">Resumo Geral</h2>
    <div class="cards-grid">
      <div class="info-card">
        <h3>Total de Veículos</h3>
        <p class="value">18</p>
      </div>
      <div class="info-card">
        <h3>Motoristas Ativos</h3>
        <p class="value">24</p>
      </div>
      <div class="info-card">
        <h3>Lançamentos do Mês</h3>
        <p class="value">152</p>
      </div>
      <div class="info-card">
        <h3>Veículos em Rota</h3>
        <p class="value">9</p>
      </div>
    </div>
  `,
  veiculos: `
    <h2 class="page-section-title">Gestão de Veículos</h2>
    <div class="vehicle-grid">
      <div class="vehicle-card">
        <div class="vehicle-image">CAMINHÃO 01</div>
        <div class="vehicle-body">
          <h3>Volvo FH 540</h3>
          <p><strong>Placa:</strong> ABC-1234</p>
          <p><strong>Motorista:</strong> João Silva</p>
          <p><strong>Ano:</strong> 2022</p>
          <span class="status rota">Em rota</span>
          <br>
          <button class="detail-btn">Detalhes</button>
        </div>
      </div>

      <div class="vehicle-card">
        <div class="vehicle-image">CAMINHÃO 02</div>
        <div class="vehicle-body">
          <h3>Scania R450</h3>
          <p><strong>Placa:</strong> DEF-5678</p>
          <p><strong>Motorista:</strong> Carlos Souza</p>
          <p><strong>Ano:</strong> 2021</p>
          <span class="status ativo">Disponível</span>
          <br>
          <button class="detail-btn">Detalhes</button>
        </div>
      </div>

      <div class="vehicle-card">
        <div class="vehicle-image">CAMINHÃO 03</div>
        <div class="vehicle-body">
          <h3>Mercedes Actros</h3>
          <p><strong>Placa:</strong> GHI-9012</p>
          <p><strong>Motorista:</strong> Não vinculado</p>
          <p><strong>Ano:</strong> 2020</p>
          <span class="status manutencao">Manutenção</span>
          <br>
          <button class="detail-btn">Detalhes</button>
        </div>
      </div>
    </div>
  `,
  motoristas: `
    <h2 class="page-section-title">Gestão de Motoristas</h2>
    <table class="simple-table">
      <thead>
        <tr>
          <th>Nome</th>
          <th>Status</th>
          <th>Veículo</th>
          <th>Última Atualização</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>João Silva</td>
          <td>Em rota</td>
          <td>Volvo FH 540</td>
          <td>14:32</td>
        </tr>
        <tr>
          <td>Carlos Souza</td>
          <td>Disponível</td>
          <td>Scania R450</td>
          <td>13:48</td>
        </tr>
        <tr>
          <td>Marcos Lima</td>
          <td>Folga</td>
          <td>-</td>
          <td>Ontem</td>
        </tr>
      </tbody>
    </table>
  `,
  lancamentos: `
    <h2 class="page-section-title">Lançamentos</h2>
    <table class="simple-table">
      <thead>
        <tr>
          <th>Data</th>
          <th>Descrição</th>
          <th>Tipo</th>
          <th>Valor</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>20/04/2026</td>
          <td>Abastecimento</td>
          <td>Despesa</td>
          <td>R$ 1.250,00</td>
        </tr>
        <tr>
          <td>20/04/2026</td>
          <td>Frete recebido</td>
          <td>Receita</td>
          <td>R$ 4.800,00</td>
        </tr>
        <tr>
          <td>19/04/2026</td>
          <td>Manutenção preventiva</td>
          <td>Despesa</td>
          <td>R$ 900,00</td>
        </tr>
      </tbody>
    </table>
  `,
  mapa: `
    <h2 class="page-section-title">Mapa em Tempo Real</h2>
    <div class="placeholder-box">
      <p>Aqui ficará o mapa em tempo real dos caminhões.</p>
      <p>Na próxima fase podemos integrar com mapa estilo Uber.</p>
    </div>
  `
};

function loadPage(pageName) {
  const titles = {
    dashboard: 'Dashboard',
    veiculos: 'Veículos',
    motoristas: 'Motoristas',
    lancamentos: 'Lançamentos',
    mapa: 'Mapa'
  };

  pageTitle.textContent = titles[pageName] || 'Sistema';
  pageContainer.innerHTML = pages[pageName] || '<p>Página não encontrada.</p>';
}

menuButtons.forEach((button) => {
  button.addEventListener('click', () => {
    menuButtons.forEach((btn) => btn.classList.remove('active'));
    button.classList.add('active');

    const page = button.getAttribute('data-page');
    loadPage(page);
  });
});

configButton.addEventListener('click', () => {
  alert('Tela de configurações será criada na próxima etapa.');
});

loadPage('dashboard');