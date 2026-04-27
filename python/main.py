from pathlib import Path
from typing import Optional
from datetime import date
import json

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

# =========================================================
# CRIAÇÃO DA API
# =========================================================
# Aqui iniciamos o FastAPI, que será o backend do sistema.
app = FastAPI()

# =========================================================
# CORS
# =========================================================
# Permite que o frontend Electron converse com a API.
# Como não estamos usando login por token/cookie no backend ainda,
# deixamos allow_credentials=False para evitar conflito com "*".
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================================================
# CAMINHOS DOS ARQUIVOS
# =========================================================
# Define a pasta "data" e garante que ela exista.
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
FRONTEND_DIR = Path(__file__).parent.parent / "renderer"

# Arquivos JSON usados como armazenamento local.
ARQUIVO_LANCAMENTOS = DATA_DIR / "lancamentos.json"
ARQUIVO_VEICULOS = DATA_DIR / "veiculos.json"
ARQUIVO_MOTORISTAS = DATA_DIR / "motoristas.json"
ARQUIVO_PLANO_CONTAS = DATA_DIR / "plano_contas.json"

# =========================================================
# CLASSIFICAÇÕES
# =========================================================
# Lista base vinda da planilha para usar nos lançamentos.
CLASSIFICACOES = [
    "1.1 COMBUSTÍVEL",
    "1.2 IMPOSTO S/ NF",
    "1.3 MANUTENÇÃO MECANICA",
    "1.4 MANUTENÇÃO PNEUS",
    "1.5 SALARIO + ENCAGOS FOLHA PGTO",

    "2.1 DESPESA COM DOC - CRLV",
    "2.2 DESPESA SEGURANÇA DO TRABALHO",
    "2.3 DESPESAS BANCÁRIAS",
    "2.4 DESPESAS TAXA / ANUIDADE",
    "2.5 EMPRÉTIMOS",
    "2.6 MULTAS / JUROS - ATRASO",
    "2.7 MULTAS DE TRANSITO",
    "2.8 OUTRAS DESPESAS",

    "3.1 RECEBIMENTO SERVIÇOS PRESTADOS",
    "3.2 OUTRAS RECEITAS",

    "4.1 COMPRA DE BEM",
    "4.2 MELHORIA DE BEM",
]

PLANO_CONTAS_BASE = [
    {
        "codigo": "1",
        "nome": "CUSTO DOS SERVICOS",
        "itens": [
            "1.1 COMBUSTIVEL",
            "1.2 IMPOSTO S/ NF",
            "1.3 MANUTENCAO MECANICA",
            "1.4 MANUTENCAO PNEUS",
            "1.5 SALARIO + ENCAGOS FOLHA PGTO",
            "1.6 PEDAGIO",
            "1.7 RASTREADOR",
            "1.8 SEGURO FRETE",
        ],
    },
    {
        "codigo": "2",
        "nome": "DESPESAS",
        "itens": [
            "2.1 DESPESA COM DOC - CRLV",
            "2.2 DESPESA SEGURANCA DO TRABALHO",
            "2.3 DESPESAS BANCARIAS",
            "2.4 DESPESAS TAXA / ANUIDADE",
            "2.5 EMPRESTIMOS",
            "2.6 MULTAS / JUROS - ATRASO",
            "2.7 MULTAS DE TRANSITO",
            "2.8 SEGURO VEICULO",
            "2.9 LAVACAO",
            "2.10 OUTRAS DESPESAS",
        ],
    },
    {
        "codigo": "3",
        "nome": "RECEITAS",
        "itens": [
            "3.1 RECEBIMENTO SERVICOS PRESTADOS",
            "3.2 OUTRAS RECEITAS",
        ],
    },
    {
        "codigo": "4",
        "nome": "INVESTIMENTOS",
        "itens": [
            "4.1 COMPRA DE BEM",
            "4.2 MELHORIA DE BEM",
            "4.3 ESTOQUE",
        ],
    },
]

CLASSIFICACOES = [
    item
    for grupo in PLANO_CONTAS_BASE
    for item in grupo["itens"]
]

STATUS_VEICULO_VALIDOS = {"Ativo", "Manutenção", "Inativo"}


# =========================================================
# MODELOS DE ENTRADA
# =========================================================
# Esses modelos validam o que chega do frontend.

class LancamentoIn(BaseModel):
    classificacao: str = Field(..., min_length=1)
    descricao: str = Field(..., min_length=1)
    valor: float
    data: date
    veiculo_id: Optional[int] = None
    kilometragem: Optional[float] = None
    litros: Optional[float] = None
    numero_nf: str = ""
    data_nf: Optional[date] = None

    @field_validator("classificacao", "descricao", "numero_nf")
    @classmethod
    def limpar_texto(cls, value: str) -> str:
        return value.strip()

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, value: float) -> float:
        # Impede valor inválido.
        if value is None:
            raise ValueError("Valor obrigatório.")
        return float(value)


class PlanoContaIn(BaseModel):
    nome: str = Field(..., min_length=1)

    @field_validator("nome")
    @classmethod
    def limpar_nome(cls, value: str) -> str:
        return value.strip()


class VeiculoIn(BaseModel):
    nome: str = Field(..., min_length=1)
    marca: str = Field(..., min_length=1)
    modelo: str = Field(..., min_length=1)
    ano: str = Field(..., min_length=1)
    placa: str = Field(..., min_length=1)
    tipo: str = Field(..., min_length=1)
    status: str = Field(..., min_length=1)
    observacao: str = ""
    foto: str = ""

    @field_validator("nome", "marca", "modelo", "ano", "tipo", "status", "observacao", "foto")
    @classmethod
    def limpar_campos_veiculo(cls, value: str) -> str:
        return value.strip()

    @field_validator("placa")
    @classmethod
    def normalizar_placa(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("tipo")
    @classmethod
    def validar_tipo(cls, value: str) -> str:
        tipos_validos = {"Caminhão", "Carro", "Máquina"}
        if value not in tipos_validos:
            raise ValueError("Tipo de veículo inválido.")
        return value

    @field_validator("status")
    @classmethod
    def validar_status(cls, value: str) -> str:
        if value not in STATUS_VEICULO_VALIDOS:
            raise ValueError("Status de veículo inválido.")
        return value


class MotoristaIn(BaseModel):
    nome: str = Field(..., min_length=1)
    telefone: str = Field(..., min_length=1)
    cnh: str = Field(..., min_length=1)

    @field_validator("nome", "telefone", "cnh")
    @classmethod
    def limpar_campos_motorista(cls, value: str) -> str:
        return value.strip()


# =========================================================
# FUNÇÕES AUXILIARES DE ARQUIVO
# =========================================================

def garantir_arquivo_json(caminho: Path) -> None:
    """
    Garante que o arquivo exista.
    Se não existir, cria com lista vazia.
    """
    if not caminho.exists():
        with open(caminho, "w", encoding="utf-8") as arquivo:
            json.dump([], arquivo, ensure_ascii=False, indent=2)


def ler_json(caminho: Path):
    """
    Lê um JSON com segurança.
    Se o arquivo estiver vazio, corrompido ou inválido, retorna lista vazia.
    """
    garantir_arquivo_json(caminho)

    try:
        with open(caminho, "r", encoding="utf-8") as arquivo:
            dados = json.load(arquivo)

        # Garante que sempre seja uma lista.
        if not isinstance(dados, list):
            return []

        return dados

    except (json.JSONDecodeError, OSError):
        return []


def salvar_json(caminho: Path, dados) -> None:
    """
    Salva lista no arquivo JSON.
    """
    with open(caminho, "w", encoding="utf-8") as arquivo:
        json.dump(dados, arquivo, ensure_ascii=False, indent=2)


def proximo_id(lista) -> int:
    """
    Gera o próximo ID baseado no maior ID atual.
    """
    if not lista:
        return 1
    return max(item.get("id", 0) for item in lista) + 1


def buscar_por_id(lista, item_id: int):
    """
    Procura um item pelo ID.
    """
    for item in lista:
        if item.get("id") == item_id:
            return item
    return None


def listar_classificacoes_ativas():
    plano_contas = ler_json(ARQUIVO_PLANO_CONTAS)
    nomes = list(CLASSIFICACOES)

    for item in plano_contas:
        nome = item.get("nome", "").strip()
        if nome and nome not in nomes:
            nomes.append(nome)

    return nomes


def normalizar_veiculo_antigo(item: dict) -> dict:
    """
    Garante compatibilidade com veículos antigos salvos antes da nova estrutura.
    """
    return {
        "id": item.get("id"),
        "nome": item.get("nome", ""),
        "marca": item.get("marca", ""),
        "modelo": item.get("modelo", ""),
        "ano": item.get("ano", ""),
        "placa": item.get("placa", ""),
        "tipo": item.get("tipo", "Caminhão"),
        "status": item.get("status", "Ativo"),
        "observacao": item.get("observacao", ""),
        "foto": item.get("foto", ""),
    }


# =========================================================
# ROTAS GERAIS
# =========================================================

@app.get("/classificacoes")
def listar_classificacoes():
    """
    Retorna a lista de classificações usadas nos lançamentos.
    """
    return listar_classificacoes_ativas()


@app.get("/plano-contas")
def listar_plano_contas():
    """
    Lista classificacoes cadastradas no plano de contas.
    """
    plano_contas = ler_json(ARQUIVO_PLANO_CONTAS)
    plano_contas.sort(key=lambda x: x.get("nome", "").lower())
    return plano_contas


@app.get("/plano-contas/estrutura")
def listar_estrutura_plano_contas():
    """
    Retorna o plano base agrupado e as classificacoes personalizadas.
    """
    plano_contas = ler_json(ARQUIVO_PLANO_CONTAS)
    plano_contas.sort(key=lambda x: x.get("nome", "").lower())
    return {
        "grupos": PLANO_CONTAS_BASE,
        "personalizadas": plano_contas,
    }


@app.post("/plano-contas")
def criar_plano_conta(dados: PlanoContaIn):
    """
    Cria uma nova classificacao no plano de contas.
    """
    plano_contas = ler_json(ARQUIVO_PLANO_CONTAS)

    if any(item.get("nome", "").lower() == dados.nome.lower() for item in plano_contas):
        raise HTTPException(status_code=400, detail="Classificacao ja cadastrada.")

    if any(item.lower() == dados.nome.lower() for item in CLASSIFICACOES):
        raise HTTPException(status_code=400, detail="Esta classificacao ja existe na lista base.")

    novo_item = {"id": proximo_id(plano_contas), "nome": dados.nome}
    plano_contas.append(novo_item)
    salvar_json(ARQUIVO_PLANO_CONTAS, plano_contas)
    return novo_item


@app.put("/plano-contas/{plano_conta_id}")
def atualizar_plano_conta(plano_conta_id: int, dados: PlanoContaIn):
    """
    Atualiza uma classificacao do plano de contas.
    """
    plano_contas = ler_json(ARQUIVO_PLANO_CONTAS)
    item = buscar_por_id(plano_contas, plano_conta_id)

    if not item:
        raise HTTPException(status_code=404, detail="Classificacao nao encontrada.")

    if any(registro.get("id") != plano_conta_id and registro.get("nome", "").lower() == dados.nome.lower() for registro in plano_contas):
        raise HTTPException(status_code=400, detail="Classificacao ja cadastrada.")

    if any(nome.lower() == dados.nome.lower() for nome in CLASSIFICACOES):
        raise HTTPException(status_code=400, detail="Esta classificacao ja existe na lista base.")

    item["nome"] = dados.nome
    salvar_json(ARQUIVO_PLANO_CONTAS, plano_contas)
    return item


@app.delete("/plano-contas/{plano_conta_id}")
def excluir_plano_conta(plano_conta_id: int):
    """
    Exclui uma classificacao cadastrada no plano de contas.
    """
    plano_contas = ler_json(ARQUIVO_PLANO_CONTAS)
    item = buscar_por_id(plano_contas, plano_conta_id)

    if not item:
        raise HTTPException(status_code=404, detail="Classificacao nao encontrada.")

    plano_contas = [registro for registro in plano_contas if registro.get("id") != plano_conta_id]
    salvar_json(ARQUIVO_PLANO_CONTAS, plano_contas)
    return {"mensagem": "Classificacao excluida com sucesso."}


# =========================================================
# LANÇAMENTOS
# =========================================================

@app.get("/lancamentos")
def listar_lancamentos(
    classificacao: Optional[str] = None,
    data_inicial: Optional[date] = None,
    data_final: Optional[date] = None,
    descricao: Optional[str] = None,
    veiculo_id: Optional[int] = None
):
    """
    Lista lançamentos com filtros opcionais.
    """
    lancamentos = ler_json(ARQUIVO_LANCAMENTOS)

    # Padroniza datas para string ISO, para compatibilidade com registros antigos.
    for item in lancamentos:
        item["data"] = str(item.get("data", ""))

    if classificacao:
        lancamentos = [
            item for item in lancamentos
            if item.get("classificacao") == classificacao
        ]

    if data_inicial:
        data_inicial_str = str(data_inicial)
        lancamentos = [
            item for item in lancamentos
            if item.get("data", "") >= data_inicial_str
        ]

    if data_final:
        data_final_str = str(data_final)
        lancamentos = [
            item for item in lancamentos
            if item.get("data", "") <= data_final_str
        ]

    if descricao:
        descricao_lower = descricao.strip().lower()
        lancamentos = [
            item for item in lancamentos
            if descricao_lower in item.get("descricao", "").lower()
        ]

    if veiculo_id:
        lancamentos = [
            item for item in lancamentos
            if item.get("veiculo_id") == veiculo_id
        ]

    # Ordena do mais novo para o mais antigo.
    lancamentos.sort(key=lambda x: x.get("data", ""), reverse=True)

    return lancamentos


@app.post("/lancamentos")
def criar_lancamento(dados: LancamentoIn):
    """
    Cria um novo lançamento.
    """
    if dados.classificacao not in listar_classificacoes_ativas():
        raise HTTPException(status_code=400, detail="Classificação inválida.")

    lancamentos = ler_json(ARQUIVO_LANCAMENTOS)

    novo_lancamento = {
        "id": proximo_id(lancamentos),
        "classificacao": dados.classificacao,
        "descricao": dados.descricao,
        "valor": float(dados.valor),
        "data": str(dados.data),
        "veiculo_id": dados.veiculo_id,
        "kilometragem": dados.kilometragem,
        "litros": dados.litros,
        "numero_nf": dados.numero_nf,
        "data_nf": str(dados.data_nf) if dados.data_nf else "",
    }

    lancamentos.append(novo_lancamento)
    salvar_json(ARQUIVO_LANCAMENTOS, lancamentos)

    return novo_lancamento


@app.put("/lancamentos/{lancamento_id}")
def atualizar_lancamento(lancamento_id: int, dados: LancamentoIn):
    """
    Atualiza um lançamento existente.
    """
    if dados.classificacao not in listar_classificacoes_ativas():
        raise HTTPException(status_code=400, detail="Classificação inválida.")

    lancamentos = ler_json(ARQUIVO_LANCAMENTOS)
    lancamento = buscar_por_id(lancamentos, lancamento_id)

    if not lancamento:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")

    lancamento["classificacao"] = dados.classificacao
    lancamento["descricao"] = dados.descricao
    lancamento["valor"] = float(dados.valor)
    lancamento["data"] = str(dados.data)
    lancamento["veiculo_id"] = dados.veiculo_id
    lancamento["kilometragem"] = dados.kilometragem
    lancamento["litros"] = dados.litros
    lancamento["numero_nf"] = dados.numero_nf
    lancamento["data_nf"] = str(dados.data_nf) if dados.data_nf else ""

    salvar_json(ARQUIVO_LANCAMENTOS, lancamentos)
    return lancamento


@app.delete("/lancamentos/{lancamento_id}")
def excluir_lancamento(lancamento_id: int):
    """
    Exclui um lançamento.
    """
    lancamentos = ler_json(ARQUIVO_LANCAMENTOS)
    lancamento = buscar_por_id(lancamentos, lancamento_id)

    if not lancamento:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")

    lancamentos = [item for item in lancamentos if item.get("id") != lancamento_id]
    salvar_json(ARQUIVO_LANCAMENTOS, lancamentos)

    return {"mensagem": "Lançamento excluído com sucesso."}


# =========================================================
# VEÍCULOS
# =========================================================

@app.get("/veiculos")
def listar_veiculos():
    """
    Lista veículos.
    Também normaliza registros antigos para não quebrar o frontend.
    """
    veiculos = ler_json(ARQUIVO_VEICULOS)
    veiculos_normalizados = [normalizar_veiculo_antigo(item) for item in veiculos]

    # Ordena por nome
    veiculos_normalizados.sort(key=lambda x: x.get("nome", "").lower())

    return veiculos_normalizados


@app.post("/veiculos")
def criar_veiculo(dados: VeiculoIn):
    """
    Cria um novo veículo.
    Valida se a placa já existe.
    """
    veiculos = ler_json(ARQUIVO_VEICULOS)

    placa_normalizada = dados.placa.strip().upper()

    if any(item.get("placa", "").upper() == placa_normalizada for item in veiculos):
        raise HTTPException(status_code=400, detail="Já existe um veículo com esta placa.")

    novo_veiculo = {
    "id": proximo_id(veiculos),
    "nome": dados.nome,
    "marca": dados.marca,
    "modelo": dados.modelo,
    "ano": dados.ano,
    "placa": placa_normalizada,
    "tipo": dados.tipo,
    "status": dados.status,
    "observacao": dados.observacao,
    "foto": dados.foto,
}

    veiculos.append(novo_veiculo)
    salvar_json(ARQUIVO_VEICULOS, veiculos)

    return novo_veiculo


@app.put("/veiculos/{veiculo_id}")
def atualizar_veiculo(veiculo_id: int, dados: VeiculoIn):
    """
    Atualiza veículo.
    Também valida duplicidade de placa.
    """
    veiculos = ler_json(ARQUIVO_VEICULOS)
    veiculo = buscar_por_id(veiculos, veiculo_id)

    if not veiculo:
        raise HTTPException(status_code=404, detail="Veículo não encontrado.")

    placa_normalizada = dados.placa.strip().upper()

    for item in veiculos:
        if item.get("id") != veiculo_id and item.get("placa", "").upper() == placa_normalizada:
            raise HTTPException(status_code=400, detail="Já existe outro veículo com esta placa.")

    veiculo["nome"] = dados.nome
    veiculo["marca"] = dados.marca
    veiculo["modelo"] = dados.modelo
    veiculo["ano"] = dados.ano
    veiculo["placa"] = placa_normalizada
    veiculo["tipo"] = dados.tipo
    veiculo["status"] = dados.status
    veiculo["observacao"] = dados.observacao
    veiculo["foto"] = dados.foto

    salvar_json(ARQUIVO_VEICULOS, veiculos)
    return veiculo


@app.delete("/veiculos/{veiculo_id}")
def excluir_veiculo(veiculo_id: int):
    """
    Exclui um veículo.
    """
    veiculos = ler_json(ARQUIVO_VEICULOS)
    veiculo = buscar_por_id(veiculos, veiculo_id)

    if not veiculo:
        raise HTTPException(status_code=404, detail="Veículo não encontrado.")

    veiculos = [item for item in veiculos if item.get("id") != veiculo_id]
    salvar_json(ARQUIVO_VEICULOS, veiculos)

    return {"mensagem": "Veículo excluído com sucesso."}


# =========================================================
# MOTORISTAS
# =========================================================

@app.get("/motoristas")
def listar_motoristas():
    """
    Lista motoristas ordenados por nome.
    """
    motoristas = ler_json(ARQUIVO_MOTORISTAS)
    motoristas.sort(key=lambda x: x.get("nome", "").lower())
    return motoristas


@app.post("/motoristas")
def criar_motorista(dados: MotoristaIn):
    """
    Cria novo motorista.
    """
    motoristas = ler_json(ARQUIVO_MOTORISTAS)

    novo_motorista = {
        "id": proximo_id(motoristas),
        "nome": dados.nome,
        "telefone": dados.telefone,
        "cnh": dados.cnh,
    }

    motoristas.append(novo_motorista)
    salvar_json(ARQUIVO_MOTORISTAS, motoristas)

    return novo_motorista


@app.put("/motoristas/{motorista_id}")
def atualizar_motorista(motorista_id: int, dados: MotoristaIn):
    """
    Atualiza motorista.
    """
    motoristas = ler_json(ARQUIVO_MOTORISTAS)
    motorista = buscar_por_id(motoristas, motorista_id)

    if not motorista:
        raise HTTPException(status_code=404, detail="Motorista não encontrado.")

    motorista["nome"] = dados.nome
    motorista["telefone"] = dados.telefone
    motorista["cnh"] = dados.cnh

    salvar_json(ARQUIVO_MOTORISTAS, motoristas)
    return motorista


@app.delete("/motoristas/{motorista_id}")
def excluir_motorista(motorista_id: int):
    """
    Exclui motorista.
    """
    motoristas = ler_json(ARQUIVO_MOTORISTAS)
    motorista = buscar_por_id(motoristas, motorista_id)

    if not motorista:
        raise HTTPException(status_code=404, detail="Motorista não encontrado.")

    motoristas = [item for item in motoristas if item.get("id") != motorista_id]
    salvar_json(ARQUIVO_MOTORISTAS, motoristas)

    return {"mensagem": "Motorista excluído com sucesso."}
