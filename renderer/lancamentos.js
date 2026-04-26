const API_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "";

const form = document.getElementById("form-lancamento");
const classificacaoSelect = document.getElementById("classificacao");
const filtroClassificacao = document.getElementById("filtro-classificacao");
const descricaoInput = document.getElementById("descricao");
const valorInput = document.getElementById("valor");
const dataInput = document.getElementById("data");
const mensagem = document.getElementById("mensagem");

const filtroDataInicial = document.getElementById("filtro-data-inicial");
const filtroDataFinal = document.getElementById("filtro-data-final");
const filtroDescricao = document.getElementById("filtro-descricao");
const btnFiltrar = document.getElementById("btn-filtrar");
const btnLimpar = document.getElementById("btn-limpar");

const tabelaLancamentos = document.getElementById("tabela-lancamentos");
const totalRegistros = document.getElementById("total-registros");

async function carregarClassificacoes() {
  const response = await fetch(`${API_URL}/classificacoes`);
  const classificacoes = await response.json();

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

function formatarValor(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function renderizarTabela(lancamentos) {
  if (!lancamentos.length) {
    tabelaLancamentos.innerHTML = `
      <tr>
        <td colspan="5" class="empty-row">Nenhum lançamento encontrado.</td>
      </tr>
    `;
    totalRegistros.textContent = "0 registros";
    return;
  }

  tabelaLancamentos.innerHTML = lancamentos
    .map((item) => {
      return `
        <tr>
          <td>${item.id}</td>
          <td>${item.data}</td>
          <td>${item.classificacao}</td>
          <td>${item.descricao}</td>
          <td>${formatarValor(item.valor)}</td>
        </tr>
      `;
    })
    .join("");

  totalRegistros.textContent = `${lancamentos.length} registro(s)`;
}

async function carregarLancamentos() {
  const params = new URLSearchParams();

  if (filtroClassificacao.value) {
    params.append("classificacao", filtroClassificacao.value);
  }

  if (filtroDataInicial.value) {
    params.append("data_inicial", filtroDataInicial.value);
  }

  if (filtroDataFinal.value) {
    params.append("data_final", filtroDataFinal.value);
  }

  if (filtroDescricao.value.trim()) {
    params.append("descricao", filtroDescricao.value.trim());
  }

  const url = params.toString()
    ? `${API_URL}/lancamentos?${params.toString()}`
    : `${API_URL}/lancamentos`;

  const response = await fetch(url);
  const lancamentos = await response.json();

  renderizarTabela(lancamentos);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    classificacao: classificacaoSelect.value,
    descricao: descricaoInput.value.trim(),
    valor: Number(valorInput.value),
    data: dataInput.value
  };

  const response = await fetch(`${API_URL}/lancamentos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const resultado = await response.json();

  if (!response.ok) {
    mensagem.textContent = resultado.detail || "Erro ao salvar lançamento.";
    return;
  }

  mensagem.textContent = "Lançamento salvo com sucesso.";

  form.reset();
  await carregarLancamentos();
});

btnFiltrar.addEventListener("click", carregarLancamentos);

btnLimpar.addEventListener("click", async () => {
  filtroClassificacao.value = "";
  filtroDataInicial.value = "";
  filtroDataFinal.value = "";
  filtroDescricao.value = "";
  await carregarLancamentos();
});

(async function iniciar() {
  await carregarClassificacoes();
  await carregarLancamentos();
})();
