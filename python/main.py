from pathlib import Path
from typing import Optional
from datetime import date, datetime
from contextvars import ContextVar
import io
import json
import unicodedata
import zipfile
from xml.sax.saxutils import escape

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator

from backend.admin_routes import router as admin_router
from backend.auth import router as auth_router
from backend.database import Base, SessionLocal, engine, garantir_colunas_runtime
from backend.dependencies import usuario_pode_escrever
from backend.models import Usuario
from backend.security import decodificar_token
from backend.settings import settings

# =========================================================
# CRIACAO DA API
# =========================================================
# Aqui iniciamos o FastAPI, que sera o backend do sistema.
app = FastAPI(
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
)

# =========================================================
# CORS
# =========================================================
# Permite que o frontend Electron converse com a API.
# Como nao estamos usando login por token/cookie no backend ainda,
# deixamos allow_credentials=False para evitar conflito com "*".
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


ROTAS_PROTEGIDAS = (
    "/classificacoes",
    "/plano-contas",
    "/lancamentos",
    "/contas-receber",
    "/ativos",
    "/passivos",
    "/estoque",
    "/relatorios",
    "/veiculos",
    "/motoristas",
    "/folha-pagamento",
)

DOMINIOS_LEGADOS = {
    "/veiculos": "veiculos",
    "/motoristas": "motoristas",
    "/lancamentos": "lancamentos",
    "/contas-receber": "contas",
    "/ativos": "ativos",
    "/passivos": "passivos",
    "/estoque": "estoque",
    "/plano-contas": "lancamentos",
    "/folha-pagamento": "folha",
}


@app.middleware("http")
async def aplicar_seguranca(request: Request, call_next):
    caminho = request.url.path
    if caminho.startswith(ROTAS_PROTEGIDAS):
        authorization = request.headers.get("Authorization", "")
        if not authorization.startswith("Bearer "):
            return JSONResponse(status_code=status.HTTP_401_UNAUTHORIZED, content={"detail": "Autenticacao obrigatoria."})
        token = authorization.removeprefix("Bearer ").strip()
        db = SessionLocal()
        token_empresa = None
        try:
            payload = decodificar_token(token)
            usuario = db.get(Usuario, int(payload.get("sub")))
            if not usuario or usuario.status != "ativo":
                return JSONResponse(status_code=status.HTTP_401_UNAUTHORIZED, content={"detail": "Usuario inativo ou inexistente."})
            if usuario.perfil == "master":
                return JSONResponse(status_code=status.HTTP_403_FORBIDDEN, content={"detail": "Usuario master acessa apenas o painel de gerenciamento."})
            if request.method not in {"GET", "HEAD", "OPTIONS"}:
                dominio = next((valor for prefixo, valor in DOMINIOS_LEGADOS.items() if caminho.startswith(prefixo)), "")
                if dominio and not usuario_pode_escrever(usuario, dominio):
                    return JSONResponse(status_code=status.HTTP_403_FORBIDDEN, content={"detail": "Permissao insuficiente."})
            request.state.usuario = usuario
            token_empresa = EMPRESA_ATUAL_ID.set(usuario.empresa_id)
        except Exception:
            return JSONResponse(status_code=status.HTTP_401_UNAUTHORIZED, content={"detail": "Token invalido."})
        finally:
            db.close()
    else:
        token_empresa = None

    try:
        response = await call_next(request)
    finally:
        if token_empresa is not None:
            EMPRESA_ATUAL_ID.reset(token_empresa)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer-when-downgrade"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com"
    return response


@app.on_event("startup")
def inicializar_banco():
    Base.metadata.create_all(bind=engine)
    garantir_colunas_runtime()


app.include_router(auth_router)
app.include_router(admin_router)

EMPRESA_ATUAL_ID: ContextVar[int | None] = ContextVar("empresa_atual_id", default=None)

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
ARQUIVO_CONTAS_RECEBER = DATA_DIR / "contas_receber.json"
ARQUIVO_CONTAS_PAGAR = DATA_DIR / "contas_pagar.json"
ARQUIVO_ATIVOS = DATA_DIR / "ativos.json"
ARQUIVO_PASSIVOS = DATA_DIR / "passivos.json"
ARQUIVO_ESTOQUE_PRODUTOS = DATA_DIR / "estoque_produtos.json"
ARQUIVO_ESTOQUE_MOVIMENTACOES = DATA_DIR / "estoque_movimentacoes.json"
ARQUIVO_FOLHA_PAGAMENTO = DATA_DIR / "folha_pagamento.json"
ARQUIVOS_MULTIEMPRESA = {
    ARQUIVO_LANCAMENTOS.name,
    ARQUIVO_VEICULOS.name,
    ARQUIVO_MOTORISTAS.name,
    ARQUIVO_PLANO_CONTAS.name,
    ARQUIVO_CONTAS_RECEBER.name,
    ARQUIVO_CONTAS_PAGAR.name,
    ARQUIVO_ATIVOS.name,
    ARQUIVO_PASSIVOS.name,
    ARQUIVO_ESTOQUE_PRODUTOS.name,
    ARQUIVO_ESTOQUE_MOVIMENTACOES.name,
    ARQUIVO_FOLHA_PAGAMENTO.name,
}

# =========================================================
# CLASSIFICACOES
# =========================================================
# Lista base vinda da planilha para usar nos lancamentos.
CLASSIFICACOES = [
    "1.1 COMBUSTIVEL",
    "1.2 IMPOSTO S/ NF",
    "1.3 MANUTENCAO MECANICA",
    "1.4 MANUTENCAO PNEUS",
    "1.5 SALARIO + ENCAGOS FOLHA PGTO",

    "2.1 DESPESA COM DOC - CRLV",
    "2.2 DESPESA SEGURANCA DO TRABALHO",
    "2.3 DESPESAS BANCARIAS",
    "2.4 DESPESAS TAXA / ANUIDADE",
    "2.5 EMPRETIMOS",
    "2.6 MULTAS / JUROS - ATRASO",
    "2.7 MULTAS DE TRANSITO",
    "2.8 OUTRAS DESPESAS",

    "3.1 RECEBIMENTO SERVICOS PRESTADOS",
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

STATUS_VEICULO_VALIDOS = {"Ativo", "Manutencao", "Inativo"}


def normalizar_texto(valor: str) -> str:
    texto = str(valor or "").strip().lower()
    texto = unicodedata.normalize("NFD", texto)
    return "".join(caractere for caractere in texto if unicodedata.category(caractere) != "Mn")


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
    empresa_id: Optional[int] = None
    obra_servico: str = ""
    kilometragem: Optional[float] = None
    litros: Optional[float] = None
    numero_nf: str = ""
    data_nf: Optional[date] = None

    @field_validator("classificacao", "descricao", "obra_servico", "numero_nf")
    @classmethod
    def limpar_texto(cls, value: str) -> str:
        return value.strip()

    @field_validator("valor", "kilometragem", "litros", mode="before")
    @classmethod
    def validar_valor(cls, value: float) -> float:
        return normalizar_numero_decimal(value)


class PlanoContaIn(BaseModel):
    nome: str = Field(..., min_length=1)

    @field_validator("nome")
    @classmethod
    def limpar_nome(cls, value: str) -> str:
        return value.strip()


class ContaReceberIn(BaseModel):
    data_inicio: date
    contrato: str = ""
    cte_ticket: str = ""
    valor: float = 0
    valor_hora_unitario: float = 0
    quantidade_horas: float = 0
    carga: str = ""
    ton_qnt: str = ""
    tomador: str = ""
    origem_destino: str = ""
    bonificacao: float = 0
    veiculo_id: Optional[int] = None
    descontos: float = 0
    desconto_classificacao: str = ""
    status_pagamento: str = "pendente"
    data_recebimento: Optional[date] = None

    @field_validator(
        "contrato",
        "cte_ticket",
        "carga",
        "ton_qnt",
        "tomador",
        "origem_destino",
        "desconto_classificacao",
        "status_pagamento",
    )
    @classmethod
    def limpar_textos_conta_receber(cls, value: str) -> str:
        return value.strip()

    @field_validator("status_pagamento")
    @classmethod
    def validar_status_pagamento(cls, value: str) -> str:
        status = value.strip().lower() or "pendente"
        if status not in {"pendente", "recebido", "cancelado"}:
            raise ValueError("Status de pagamento invalido.")
        return status

    @field_validator("valor", "valor_hora_unitario", "quantidade_horas", "bonificacao", "descontos", mode="before")
    @classmethod
    def validar_valores_conta_receber(cls, value: float) -> float:
        valor = normalizar_numero_decimal(value)
        if valor < 0:
            raise ValueError("Valores nao podem ser negativos.")
        return valor


class VeiculoIn(BaseModel):
    nome: str = Field(..., min_length=1)
    marca: str = ""
    modelo: str = ""
    ano: str = ""
    placa: str = ""
    tipo: str = "Caminhao"
    status: str = "Ativo"
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
        tipo_normalizado = normalizar_texto(value)
        tipos_validos = {
            "caminhao": "Caminhao",
            "caminho": "Caminhao",
            "carro": "Carro",
            "maquina": "Maquina",
            "moto": "Motocicleta",
            "motocicleta": "Motocicleta",
        }
        if tipo_normalizado not in tipos_validos:
            raise ValueError("Tipo de veiculo invalido.")
        return tipos_validos[tipo_normalizado]

    @field_validator("status")
    @classmethod
    def validar_status(cls, value: str) -> str:
        if value not in STATUS_VEICULO_VALIDOS:
            raise ValueError("Status de veiculo invalido.")
        return value


class MotoristaIn(BaseModel):
    nome: str = Field(..., min_length=1)
    telefone: str = ""
    cnh: str = ""
    cargo: str = ""
    admissao: Optional[date] = None
    lotacao: str = ""
    pis: str = ""
    banco: str = ""
    agencia: str = ""
    conta: str = ""
    tipo_conta: str = ""
    empregador: str = ""
    empregador_cnpj: str = ""
    salario_base: float = 0
    carga_horaria_mensal: float = 220
    valor_hora_extra: float = 0
    inss_percentual: float = 0
    irrf_percentual: float = 0
    vale_refeicao: float = 0
    convenio_medico: float = 0
    outros_descontos_padrao: float = 0

    @field_validator("nome", "telefone", "cnh", "cargo", "lotacao", "pis", "banco", "agencia", "conta", "tipo_conta", "empregador", "empregador_cnpj")
    @classmethod
    def limpar_campos_motorista(cls, value: str) -> str:
        return value.strip()

    @field_validator(
        "salario_base",
        "carga_horaria_mensal",
        "valor_hora_extra",
        "inss_percentual",
        "irrf_percentual",
        "vale_refeicao",
        "convenio_medico",
        "outros_descontos_padrao",
        mode="before",
    )
    @classmethod
    def validar_numero_motorista(cls, value: float) -> float:
        valor = normalizar_numero_decimal(value)
        if valor < 0:
            raise ValueError("Valores do motorista nao podem ser negativos.")
        return valor


class FolhaPagamentoItemIn(BaseModel):
    motorista_id: int
    horas_normais: float = 0
    valor_hora: float = 0
    horas_extras: float = 0
    valor_hora_extra: float = 0
    adicional_noturno: float = 0
    adicional_descricao: str = ""
    bonus: float = 0
    bonus_descricao: str = ""
    aplicar_inss: bool = True
    desconto_inss_manual: bool = False
    desconto_inss: float = 0
    desconto_irrf: float = 0
    desconto_vale: float = 0
    desconto_adiantamento: float = 0
    outros_descontos: float = 0
    outros_descontos_descricao: str = ""
    salario_contratual: float = 0
    base_inss: float = 0
    base_fgts: float = 0
    fgts: float = 0
    base_irrf: float = 0
    observacao: str = ""

    @field_validator(
        "horas_normais",
        "valor_hora",
        "horas_extras",
        "valor_hora_extra",
        "adicional_noturno",
        "bonus",
        "desconto_inss",
        "desconto_irrf",
        "desconto_vale",
        "desconto_adiantamento",
        "outros_descontos",
        "salario_contratual",
        "base_inss",
        "base_fgts",
        "fgts",
        "base_irrf",
        mode="before",
    )
    @classmethod
    def validar_numero_nao_negativo(cls, value: float) -> float:
        valor = normalizar_numero_decimal(value)
        if valor < 0:
            raise ValueError("Valores da folha nao podem ser negativos.")
        return valor

    @field_validator("adicional_descricao", "bonus_descricao", "outros_descontos_descricao", "observacao")
    @classmethod
    def limpar_observacao(cls, value: str) -> str:
        return value.strip()


class FolhaPagamentoIn(BaseModel):
    periodo: str = Field(..., min_length=1)
    data_pagamento: date
    descricao: str = "Folha de pagamento"
    gerar_lancamento: bool = True
    opcoes_recibo: dict = Field(default_factory=dict)
    itens: list[FolhaPagamentoItemIn]

    @field_validator("periodo", "descricao")
    @classmethod
    def limpar_textos_folha(cls, value: str) -> str:
        return value.strip()


class AtivoIn(BaseModel):
    nome: str = Field(..., min_length=1)
    tipo: str = Field(..., min_length=1)
    valor: float = 0
    data_aquisicao: Optional[date] = None
    veiculo_id: Optional[int] = None
    observacao: str = ""
    status: str = "Ativo"

    @field_validator("nome", "tipo", "observacao", "status")
    @classmethod
    def limpar_campos_ativo(cls, value: str) -> str:
        return value.strip()

    @field_validator("tipo")
    @classmethod
    def validar_tipo_ativo(cls, value: str) -> str:
        tipos = {"Veiculo", "Veiculo", "Maquina", "Maquina", "Equipamento", "Imovel", "Imovel", "Outro"}
        if value not in tipos:
            raise ValueError("Tipo de ativo invalido.")
        return value

    @field_validator("valor", mode="before")
    @classmethod
    def validar_valor_ativo(cls, value: float) -> float:
        valor = normalizar_numero_decimal(value)
        if valor < 0:
            raise ValueError("Valor do ativo nao pode ser negativo.")
        return valor


class PassivoIn(BaseModel):
    nome: str = Field(..., min_length=1)
    tipo: str = Field(..., min_length=1)
    valor_total: float = 0
    valor_pago: float = 0
    data_inicio: Optional[date] = None
    data_vencimento: Optional[date] = None
    observacao: str = ""
    status: str = "Pendente"

    @field_validator("nome", "tipo", "observacao", "status")
    @classmethod
    def limpar_campos_passivo(cls, value: str) -> str:
        return value.strip()

    @field_validator("tipo")
    @classmethod
    def validar_tipo_passivo(cls, value: str) -> str:
        tipos = {"Financiamento", "Emprestimo", "Emprestimo", "Divida", "Divida", "Imposto a pagar", "Outro"}
        if value not in tipos:
            raise ValueError("Tipo de passivo invalido.")
        return value

    @field_validator("valor_total", "valor_pago", mode="before")
    @classmethod
    def validar_valor_passivo(cls, value: float) -> float:
        valor = normalizar_numero_decimal(value)
        if valor < 0:
            raise ValueError("Valores do passivo nao podem ser negativos.")
        return valor


class ProdutoEstoqueIn(BaseModel):
    nome: str = Field(..., min_length=1)
    categoria: str = ""
    unidade_medida: str = "un"
    quantidade_atual: float = 0
    valor_custo: float = 0
    estoque_minimo: float = 0
    observacao: str = ""

    @field_validator("nome", "categoria", "unidade_medida", "observacao")
    @classmethod
    def limpar_campos_produto(cls, value: str) -> str:
        return value.strip()

    @field_validator("quantidade_atual", "valor_custo", "estoque_minimo", mode="before")
    @classmethod
    def validar_numero_produto(cls, value: float) -> float:
        valor = normalizar_numero_decimal(value)
        if valor < 0:
            raise ValueError("Valores do produto nao podem ser negativos.")
        return valor


class MovimentacaoEstoqueIn(BaseModel):
    produto_id: int
    tipo_movimentacao: str = Field(..., min_length=1)
    quantidade: float
    valor_unitario: float = 0
    data: date
    observacao: str = ""

    @field_validator("tipo_movimentacao", "observacao")
    @classmethod
    def limpar_campos_movimentacao(cls, value: str) -> str:
        return value.strip()

    @field_validator("tipo_movimentacao")
    @classmethod
    def validar_tipo_movimentacao(cls, value: str) -> str:
        if value not in {"Entrada", "Saida", "Saida", "Ajuste"}:
            raise ValueError("Tipo de movimentacao invalido.")
        return "Saida" if value == "Saida" else value

    @field_validator("quantidade", "valor_unitario", mode="before")
    @classmethod
    def validar_numero_movimentacao(cls, value: float) -> float:
        valor = normalizar_numero_decimal(value)
        if valor < 0:
            raise ValueError("Valores da movimentacao nao podem ser negativos.")
        return valor


# =========================================================
# FUNCOES AUXILIARES DE ARQUIVO
# =========================================================

def garantir_arquivo_json(caminho: Path) -> None:
    """
    Garante que o arquivo exista.
    Se nao existir, cria com lista vazia.
    """
    if not caminho.exists():
        with open(caminho, "w", encoding="utf-8") as arquivo:
            json.dump([], arquivo, ensure_ascii=False, indent=2)


def caminho_json_empresa(caminho: Path) -> Path:
    empresa_id = EMPRESA_ATUAL_ID.get()
    if not empresa_id or empresa_id == 1 or caminho.name not in ARQUIVOS_MULTIEMPRESA:
        return caminho
    pasta_empresa = DATA_DIR / "empresas" / str(empresa_id)
    pasta_empresa.mkdir(parents=True, exist_ok=True)
    return pasta_empresa / caminho.name


def ler_json(caminho: Path):
    """
    Le um JSON com seguranca.
    Se o arquivo estiver corrompido, mostra erro claro em vez de ocultar os dados.
    """
    caminho = caminho_json_empresa(caminho)
    garantir_arquivo_json(caminho)

    try:
        with open(caminho, "r", encoding="utf-8") as arquivo:
            dados = json.load(arquivo)

        # Garante que sempre seja uma lista.
        if not isinstance(dados, list):
            raise HTTPException(status_code=500, detail=f"Arquivo de dados invalido: {caminho.name}")

        return dados

    except json.JSONDecodeError as erro:
        raise HTTPException(
            status_code=500,
            detail=f"Arquivo de dados corrompido: {caminho.name}. Corrija o JSON antes de continuar."
        ) from erro
    except OSError as erro:
        raise HTTPException(status_code=500, detail=f"Nao foi possivel ler {caminho.name}.") from erro


def salvar_json(caminho: Path, dados) -> None:
    """
    Salva lista no arquivo JSON.
    """
    caminho = caminho_json_empresa(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with open(caminho, "w", encoding="utf-8") as arquivo:
        json.dump(dados, arquivo, ensure_ascii=False, indent=2)


def proximo_id(lista) -> int:
    """
    Gera o proximo ID baseado no maior ID atual.
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


def agora_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def normalizar_numero_decimal(valor) -> float:
    if valor is None or valor == "":
        return 0.0
    if isinstance(valor, (int, float)):
        return float(valor)
    texto = str(valor).strip().replace("R$", "").replace(" ", "")
    if "," in texto:
        texto = texto.replace(".", "").replace(",", ".")
    elif texto.count(".") > 1:
        texto = texto.replace(".", "")
    try:
        return float(texto)
    except ValueError as erro:
        raise ValueError("Numero invalido. Use formato 8,9 ou 8.9.") from erro


def obter_grupo_financeiro(classificacao: str) -> str:
    codigo = str(classificacao or "").strip()
    if codigo.startswith("1."):
        return "CUSTOS OPERACIONAIS"
    if codigo.startswith("2."):
        return "DESPESAS ADMINISTRATIVAS"
    if codigo.startswith("3."):
        return "FATURAMENTO"
    if codigo.startswith("4."):
        return "INVESTIMENTOS"
    return "OUTROS"


def eh_receita(classificacao: str) -> bool:
    return obter_grupo_financeiro(classificacao) == "FATURAMENTO"


def eh_faturamento(classificacao: str) -> bool:
    return eh_receita(classificacao)


def eh_custo(classificacao: str) -> bool:
    return obter_grupo_financeiro(classificacao) == "CUSTOS OPERACIONAIS"


def eh_custo_operacional(classificacao: str) -> bool:
    return eh_custo(classificacao)


def eh_despesa(classificacao: str) -> bool:
    return obter_grupo_financeiro(classificacao) == "DESPESAS ADMINISTRATIVAS"


def eh_despesa_administrativa(classificacao: str) -> bool:
    return eh_despesa(classificacao)


def eh_investimento(classificacao: str) -> bool:
    return obter_grupo_financeiro(classificacao) == "INVESTIMENTOS"


def inferir_tipo_financeiro(classificacao: str) -> str:
    if eh_receita(classificacao):
        return "receita"
    if eh_custo(classificacao):
        return "custo"
    if eh_despesa(classificacao):
        return "despesa"
    if eh_investimento(classificacao):
        return "investimento"
    return "outro"


def arredondar_moeda(valor: float) -> float:
    return round(float(valor or 0), 2)


TABELA_INSS_2026 = [
    (1621.00, 0.075),
    (2902.84, 0.09),
    (4354.27, 0.12),
    (8475.55, 0.14),
]


def calcular_inss(base_calculo: float) -> float:
    base = min(float(base_calculo or 0), TABELA_INSS_2026[-1][0])
    contribuicao = 0
    limite_anterior = 0

    for limite, aliquota in TABELA_INSS_2026:
        if base <= limite_anterior:
            break
        faixa = min(base, limite) - limite_anterior
        contribuicao += faixa * aliquota
        limite_anterior = limite

    return arredondar_moeda(contribuicao)


def calcular_item_folha(item: FolhaPagamentoItemIn, motorista: dict) -> dict:
    salario_contratual = float(item.salario_contratual or motorista.get("salario_base", 0) or 0)
    salario_base = salario_contratual if item.horas_normais > 0 else 0
    valor_extras = item.horas_extras * item.valor_hora_extra
    total_adicionais = item.adicional_noturno + item.bonus
    salario_bruto = salario_base + valor_extras + total_adicionais
    base_inss = salario_bruto
    if not item.aplicar_inss:
        desconto_inss = 0
    elif item.desconto_inss_manual:
        desconto_inss = item.desconto_inss
    else:
        desconto_inss = calcular_inss(base_inss)
    base_fgts = salario_bruto
    fgts = base_fgts * 0.08
    base_irrf = max(salario_bruto - desconto_inss, 0)
    total_descontos = (
        desconto_inss
        + item.desconto_irrf
        + item.desconto_vale
        + item.desconto_adiantamento
        + item.outros_descontos
    )
    salario_liquido = max(salario_bruto - total_descontos, 0)

    return {
        "motorista_id": item.motorista_id,
        "motorista_nome": motorista.get("nome", ""),
        "horas_normais": item.horas_normais,
        "valor_hora": item.valor_hora,
        "horas_extras": item.horas_extras,
        "valor_hora_extra": item.valor_hora_extra,
        "adicional_noturno": item.adicional_noturno,
        "adicional_descricao": item.adicional_descricao,
        "bonus": item.bonus,
        "bonus_descricao": item.bonus_descricao,
        "aplicar_inss": item.aplicar_inss,
        "desconto_inss_manual": item.desconto_inss_manual,
        "desconto_inss": desconto_inss,
        "desconto_irrf": item.desconto_irrf,
        "desconto_vale": item.desconto_vale,
        "desconto_adiantamento": item.desconto_adiantamento,
        "outros_descontos": item.outros_descontos,
        "outros_descontos_descricao": item.outros_descontos_descricao,
        "observacao": item.observacao,
        "salario_base": arredondar_moeda(salario_base),
        "valor_extras": arredondar_moeda(valor_extras),
        "total_adicionais": arredondar_moeda(total_adicionais),
        "salario_bruto": arredondar_moeda(salario_bruto),
        "total_descontos": arredondar_moeda(total_descontos),
        "salario_liquido": arredondar_moeda(salario_liquido),
        "salario_contratual": arredondar_moeda(salario_contratual),
        "base_inss": arredondar_moeda(base_inss),
        "base_fgts": arredondar_moeda(base_fgts),
        "fgts": arredondar_moeda(fgts),
        "base_irrf": arredondar_moeda(base_irrf),
    }


def listar_classificacoes_ativas():
    plano_contas = ler_json(ARQUIVO_PLANO_CONTAS)
    nomes = list(CLASSIFICACOES)

    for item in plano_contas:
        nome = item.get("nome", "").strip()
        if nome and nome not in nomes:
            nomes.append(nome)

    return nomes


def classificacao_eh_despesa(nome: str) -> bool:
    return eh_despesa(nome)


def normalizar_lancamento_antigo(item: dict) -> dict:
    criado = item.get("created_at") or agora_iso()
    classificacao = item.get("classificacao", "")
    return {
        "id": item.get("id"),
        "data": str(item.get("data", "")),
        "classificacao": classificacao,
        "descricao": item.get("descricao", ""),
        "valor": float(item.get("valor") or 0),
        "veiculo_id": item.get("veiculo_id"),
        "empresa_id": item.get("empresa_id"),
        "obra_servico": item.get("obra_servico", ""),
        "tipo_financeiro": item.get("tipo_financeiro") or inferir_tipo_financeiro(classificacao),
        "created_at": criado,
        "updated_at": item.get("updated_at") or criado,
        "kilometragem": item.get("kilometragem"),
        "litros": item.get("litros"),
        "numero_nf": item.get("numero_nf", ""),
        "data_nf": str(item.get("data_nf", "")) if item.get("data_nf") else "",
    }


def normalizar_conta_receber_antiga(item: dict) -> dict:
    conta = {
        "id": item.get("id"),
        "data_inicio": str(item.get("data_inicio", "")),
        "contrato": item.get("contrato", ""),
        "cte_ticket": item.get("cte_ticket", ""),
        "valor": normalizar_numero_decimal(item.get("valor")),
        "valor_hora_unitario": normalizar_numero_decimal(item.get("valor_hora_unitario")),
        "quantidade_horas": normalizar_numero_decimal(item.get("quantidade_horas")),
        "carga": item.get("carga", ""),
        "ton_qnt": item.get("ton_qnt", ""),
        "tomador": item.get("tomador", ""),
        "origem_destino": item.get("origem_destino", ""),
        "bonificacao": normalizar_numero_decimal(item.get("bonificacao")),
        "veiculo_id": item.get("veiculo_id"),
        "descontos": normalizar_numero_decimal(item.get("descontos")),
        "desconto_classificacao": item.get("desconto_classificacao", ""),
        "status_pagamento": (item.get("status_pagamento") or "pendente").lower(),
        "data_recebimento": str(item.get("data_recebimento", "")) if item.get("data_recebimento") else "",
    }
    conta["valor_total_receber"] = calcular_total_conta_receber(conta)
    return conta


def normalizar_ativo_antigo(item: dict) -> dict:
    criado = item.get("created_at") or agora_iso()
    return {
        "id": item.get("id"),
        "nome": item.get("nome", ""),
        "tipo": item.get("tipo", "Outro"),
        "valor": float(item.get("valor") or 0),
        "data_aquisicao": str(item.get("data_aquisicao", "")) if item.get("data_aquisicao") else "",
        "veiculo_id": item.get("veiculo_id"),
        "observacao": item.get("observacao", ""),
        "status": item.get("status", "Ativo"),
        "created_at": criado,
        "updated_at": item.get("updated_at") or criado,
    }


def normalizar_passivo_antigo(item: dict) -> dict:
    criado = item.get("created_at") or agora_iso()
    valor_total = float(item.get("valor_total") or 0)
    valor_pago = float(item.get("valor_pago") or 0)
    return {
        "id": item.get("id"),
        "nome": item.get("nome", ""),
        "tipo": item.get("tipo", "Outro"),
        "valor_total": valor_total,
        "valor_pago": valor_pago,
        "saldo_devedor": max(valor_total - valor_pago, 0),
        "data_inicio": str(item.get("data_inicio", "")) if item.get("data_inicio") else "",
        "data_vencimento": str(item.get("data_vencimento", "")) if item.get("data_vencimento") else "",
        "observacao": item.get("observacao", ""),
        "status": item.get("status", "Pendente"),
        "created_at": criado,
        "updated_at": item.get("updated_at") or criado,
    }


def normalizar_produto_estoque_antigo(item: dict) -> dict:
    criado = item.get("created_at") or agora_iso()
    quantidade = float(item.get("quantidade_atual") or 0)
    valor_custo = float(item.get("valor_custo") or 0)
    estoque_minimo = float(item.get("estoque_minimo") or 0)
    return {
        "id": item.get("id"),
        "nome": item.get("nome", ""),
        "categoria": item.get("categoria", ""),
        "unidade_medida": item.get("unidade_medida", "un"),
        "quantidade_atual": quantidade,
        "valor_custo": valor_custo,
        "estoque_minimo": estoque_minimo,
        "observacao": item.get("observacao", ""),
        "valor_total_estoque": quantidade * valor_custo,
        "estoque_baixo": quantidade <= estoque_minimo,
        "created_at": criado,
        "updated_at": item.get("updated_at") or criado,
    }


def normalizar_veiculo_antigo(item: dict) -> dict:
    """
    Garante compatibilidade com veiculos antigos salvos antes da nova estrutura.
    """
    return {
        "id": item.get("id"),
        "nome": item.get("nome", ""),
        "marca": item.get("marca", ""),
        "modelo": item.get("modelo", ""),
        "ano": item.get("ano", ""),
        "placa": item.get("placa", ""),
        "tipo": item.get("tipo", "Caminhao"),
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
    Retorna a lista de classificacoes usadas nos lancamentos.
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
# LANCAMENTOS
# =========================================================

@app.get("/lancamentos")
def listar_lancamentos(
    classificacao: Optional[str] = None,
    data_inicial: Optional[date] = None,
    data_final: Optional[date] = None,
    descricao: Optional[str] = None,
    veiculo_id: Optional[int] = None,
    empresa_id: Optional[int] = None,
    obra_servico: Optional[str] = None,
):
    """
    Lista lancamentos com filtros opcionais.
    """
    lancamentos = [normalizar_lancamento_antigo(item) for item in ler_json(ARQUIVO_LANCAMENTOS)]

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

    if empresa_id:
        lancamentos = [
            item for item in lancamentos
            if item.get("empresa_id") == empresa_id
        ]

    if obra_servico:
        obra_lower = obra_servico.strip().lower()
        lancamentos = [
            item for item in lancamentos
            if obra_lower in item.get("obra_servico", "").lower()
        ]

    # Ordena do mais novo para o mais antigo.
    lancamentos.sort(key=lambda x: x.get("data", ""), reverse=True)

    return lancamentos


@app.post("/lancamentos")
def criar_lancamento(dados: LancamentoIn):
    """
    Cria um novo lancamento.
    """
    if dados.classificacao not in listar_classificacoes_ativas():
        raise HTTPException(status_code=400, detail="Classificacao invalida.")

    lancamentos = ler_json(ARQUIVO_LANCAMENTOS)
    timestamp = agora_iso()

    novo_lancamento = {
        "id": proximo_id(lancamentos),
        "data": str(dados.data),
        "classificacao": dados.classificacao,
        "descricao": dados.descricao,
        "valor": float(dados.valor),
        "veiculo_id": dados.veiculo_id,
        "empresa_id": dados.empresa_id,
        "obra_servico": dados.obra_servico,
        "tipo_financeiro": inferir_tipo_financeiro(dados.classificacao),
        "created_at": timestamp,
        "updated_at": timestamp,
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
    Atualiza um lancamento existente.
    """
    if dados.classificacao not in listar_classificacoes_ativas():
        raise HTTPException(status_code=400, detail="Classificacao invalida.")

    lancamentos = ler_json(ARQUIVO_LANCAMENTOS)
    lancamento = buscar_por_id(lancamentos, lancamento_id)

    if not lancamento:
        raise HTTPException(status_code=404, detail="Lancamento nao encontrado.")

    lancamento["data"] = str(dados.data)
    lancamento["classificacao"] = dados.classificacao
    lancamento["descricao"] = dados.descricao
    lancamento["valor"] = float(dados.valor)
    lancamento["veiculo_id"] = dados.veiculo_id
    lancamento["empresa_id"] = dados.empresa_id
    lancamento["obra_servico"] = dados.obra_servico
    lancamento["tipo_financeiro"] = inferir_tipo_financeiro(dados.classificacao)
    lancamento["created_at"] = lancamento.get("created_at") or agora_iso()
    lancamento["updated_at"] = agora_iso()
    lancamento["kilometragem"] = dados.kilometragem
    lancamento["litros"] = dados.litros
    lancamento["numero_nf"] = dados.numero_nf
    lancamento["data_nf"] = str(dados.data_nf) if dados.data_nf else ""

    salvar_json(ARQUIVO_LANCAMENTOS, lancamentos)
    return lancamento


@app.delete("/lancamentos/{lancamento_id}")
def excluir_lancamento(lancamento_id: int):
    """
    Exclui um lancamento.
    """
    lancamentos = ler_json(ARQUIVO_LANCAMENTOS)
    lancamento = buscar_por_id(lancamentos, lancamento_id)

    if not lancamento:
        raise HTTPException(status_code=404, detail="Lancamento nao encontrado.")

    lancamentos = [item for item in lancamentos if item.get("id") != lancamento_id]
    salvar_json(ARQUIVO_LANCAMENTOS, lancamentos)

    return {"mensagem": "Lancamento excluido com sucesso."}


# =========================================================
# VEICULOS
# =========================================================

# =========================================================
# CONTAS A RECEBER
# =========================================================

def calcular_total_conta_receber(item: dict) -> float:
    valor_hora_unitario = normalizar_numero_decimal(item.get("valor_hora_unitario"))
    quantidade_horas = normalizar_numero_decimal(item.get("quantidade_horas"))
    valor = valor_hora_unitario * quantidade_horas if valor_hora_unitario > 0 and quantidade_horas > 0 else normalizar_numero_decimal(item.get("valor"))
    bonificacao = normalizar_numero_decimal(item.get("bonificacao"))
    descontos = normalizar_numero_decimal(item.get("descontos"))
    return arredondar_moeda(valor + bonificacao - descontos)


def calcular_valor_base_conta_receber(dados: ContaReceberIn) -> float:
    if dados.valor_hora_unitario > 0 and dados.quantidade_horas > 0:
        return arredondar_moeda(dados.valor_hora_unitario * dados.quantidade_horas)
    return float(dados.valor or 0)


@app.get("/contas-receber")
def listar_contas_receber(
    data_inicial: Optional[date] = None,
    data_final: Optional[date] = None,
    contrato: Optional[str] = None,
    tomador: Optional[str] = None,
    veiculo_id: Optional[int] = None,
):
    """
    Lista contas a receber com filtros opcionais.
    """
    contas = [normalizar_conta_receber_antiga(item) for item in ler_json(ARQUIVO_CONTAS_RECEBER)]

    if data_inicial:
        data_inicial_str = str(data_inicial)
        contas = [item for item in contas if item.get("data_inicio", "") >= data_inicial_str]

    if data_final:
        data_final_str = str(data_final)
        contas = [item for item in contas if item.get("data_inicio", "") <= data_final_str]

    if contrato:
        contrato_lower = contrato.strip().lower()
        contas = [item for item in contas if contrato_lower in item.get("contrato", "").lower()]

    if tomador:
        tomador_lower = tomador.strip().lower()
        contas = [item for item in contas if tomador_lower in item.get("tomador", "").lower()]

    if veiculo_id:
        contas = [item for item in contas if item.get("veiculo_id") == veiculo_id]

    contas.sort(key=lambda x: x.get("data_inicio", ""), reverse=True)
    return contas


@app.get("/contas-receber/horas-maquinas")
def listar_horas_maquinas(
    data_inicial: Optional[date] = None,
    data_final: Optional[date] = None,
    veiculo_id: Optional[int] = None,
):
    contas = listar_contas_receber(data_inicial=data_inicial, data_final=data_final, veiculo_id=veiculo_id)
    contas_com_horas = [item for item in contas if float(item.get("quantidade_horas") or 0) > 0]
    dias = {item.get("data_inicio") for item in contas_com_horas if item.get("data_inicio")}
    total_horas = sum(float(item.get("quantidade_horas") or 0) for item in contas_com_horas)
    valor_total = sum(float(item.get("valor_total_receber") or 0) for item in contas_com_horas)
    return {
        "total_horas": arredondar_moeda(total_horas),
        "dias_trabalhados": len(dias),
        "valor_total": arredondar_moeda(valor_total),
        "registros": len(contas_com_horas),
        "itens": contas_com_horas,
    }


@app.post("/contas-receber")
def criar_conta_receber(dados: ContaReceberIn):
    """
    Cria um novo registro de conta a receber.
    """
    if dados.desconto_classificacao:
        if dados.desconto_classificacao not in listar_classificacoes_ativas():
            raise HTTPException(status_code=400, detail="Classificacao do desconto invalida.")
        if not classificacao_eh_despesa(dados.desconto_classificacao):
            raise HTTPException(status_code=400, detail="Use uma classificacao de despesa para o desconto.")

    contas = ler_json(ARQUIVO_CONTAS_RECEBER)

    nova_conta = {
        "id": proximo_id(contas),
        "data_inicio": str(dados.data_inicio),
        "contrato": dados.contrato,
        "cte_ticket": dados.cte_ticket,
        "valor": calcular_valor_base_conta_receber(dados),
        "valor_hora_unitario": float(dados.valor_hora_unitario or 0),
        "quantidade_horas": float(dados.quantidade_horas or 0),
        "carga": dados.carga,
        "ton_qnt": dados.ton_qnt,
        "tomador": dados.tomador,
        "origem_destino": dados.origem_destino,
        "bonificacao": float(dados.bonificacao or 0),
        "veiculo_id": dados.veiculo_id,
        "descontos": float(dados.descontos or 0),
        "desconto_classificacao": dados.desconto_classificacao,
        "status_pagamento": dados.status_pagamento,
        "data_recebimento": str(dados.data_recebimento) if dados.data_recebimento else "",
    }
    nova_conta["valor_total_receber"] = calcular_total_conta_receber(nova_conta)

    contas.append(nova_conta)
    salvar_json(ARQUIVO_CONTAS_RECEBER, contas)
    return nova_conta


@app.put("/contas-receber/{conta_id}")
def atualizar_conta_receber(conta_id: int, dados: ContaReceberIn):
    """
    Atualiza um registro de conta a receber.
    """
    if dados.desconto_classificacao:
        if dados.desconto_classificacao not in listar_classificacoes_ativas():
            raise HTTPException(status_code=400, detail="Classificacao do desconto invalida.")
        if not classificacao_eh_despesa(dados.desconto_classificacao):
            raise HTTPException(status_code=400, detail="Use uma classificacao de despesa para o desconto.")

    contas = ler_json(ARQUIVO_CONTAS_RECEBER)
    conta = buscar_por_id(contas, conta_id)

    if not conta:
        raise HTTPException(status_code=404, detail="Conta a receber nao encontrada.")

    conta["data_inicio"] = str(dados.data_inicio)
    conta["contrato"] = dados.contrato
    conta["cte_ticket"] = dados.cte_ticket
    conta["valor"] = calcular_valor_base_conta_receber(dados)
    conta["valor_hora_unitario"] = float(dados.valor_hora_unitario or 0)
    conta["quantidade_horas"] = float(dados.quantidade_horas or 0)
    conta["carga"] = dados.carga
    conta["ton_qnt"] = dados.ton_qnt
    conta["tomador"] = dados.tomador
    conta["origem_destino"] = dados.origem_destino
    conta["bonificacao"] = float(dados.bonificacao or 0)
    conta["veiculo_id"] = dados.veiculo_id
    conta["descontos"] = float(dados.descontos or 0)
    conta["desconto_classificacao"] = dados.desconto_classificacao
    conta["status_pagamento"] = dados.status_pagamento
    conta["data_recebimento"] = str(dados.data_recebimento) if dados.data_recebimento else ""
    conta["valor_total_receber"] = calcular_total_conta_receber(conta)

    salvar_json(ARQUIVO_CONTAS_RECEBER, contas)
    return conta


@app.delete("/contas-receber/{conta_id}")
def excluir_conta_receber(conta_id: int):
    """
    Exclui uma conta a receber.
    """
    contas = ler_json(ARQUIVO_CONTAS_RECEBER)
    conta = buscar_por_id(contas, conta_id)

    if not conta:
        raise HTTPException(status_code=404, detail="Conta a receber nao encontrada.")

    contas = [item for item in contas if item.get("id") != conta_id]
    salvar_json(ARQUIVO_CONTAS_RECEBER, contas)
    return {"mensagem": "Conta a receber excluida com sucesso."}


# =========================================================
# ATIVOS, PASSIVOS E ESTOQUE
# =========================================================

@app.get("/ativos")
def listar_ativos():
    ativos = [normalizar_ativo_antigo(item) for item in ler_json(ARQUIVO_ATIVOS)]
    ativos.sort(key=lambda x: x.get("nome", "").lower())
    return ativos


@app.post("/ativos")
def criar_ativo(dados: AtivoIn):
    ativos = ler_json(ARQUIVO_ATIVOS)
    timestamp = agora_iso()
    ativo = {
        "id": proximo_id(ativos),
        "nome": dados.nome,
        "tipo": dados.tipo,
        "valor": float(dados.valor or 0),
        "data_aquisicao": str(dados.data_aquisicao) if dados.data_aquisicao else "",
        "veiculo_id": dados.veiculo_id,
        "observacao": dados.observacao,
        "status": dados.status,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    ativos.append(ativo)
    salvar_json(ARQUIVO_ATIVOS, ativos)
    return normalizar_ativo_antigo(ativo)


@app.put("/ativos/{ativo_id}")
def atualizar_ativo(ativo_id: int, dados: AtivoIn):
    ativos = ler_json(ARQUIVO_ATIVOS)
    ativo = buscar_por_id(ativos, ativo_id)
    if not ativo:
        raise HTTPException(status_code=404, detail="Ativo nao encontrado.")
    ativo["nome"] = dados.nome
    ativo["tipo"] = dados.tipo
    ativo["valor"] = float(dados.valor or 0)
    ativo["data_aquisicao"] = str(dados.data_aquisicao) if dados.data_aquisicao else ""
    ativo["veiculo_id"] = dados.veiculo_id
    ativo["observacao"] = dados.observacao
    ativo["status"] = dados.status
    ativo["created_at"] = ativo.get("created_at") or agora_iso()
    ativo["updated_at"] = agora_iso()
    salvar_json(ARQUIVO_ATIVOS, ativos)
    return normalizar_ativo_antigo(ativo)


@app.delete("/ativos/{ativo_id}")
def excluir_ativo(ativo_id: int):
    ativos = ler_json(ARQUIVO_ATIVOS)
    if not buscar_por_id(ativos, ativo_id):
        raise HTTPException(status_code=404, detail="Ativo nao encontrado.")
    salvar_json(ARQUIVO_ATIVOS, [item for item in ativos if item.get("id") != ativo_id])
    return {"mensagem": "Ativo excluido com sucesso."}


@app.get("/passivos")
def listar_passivos():
    passivos = [normalizar_passivo_antigo(item) for item in ler_json(ARQUIVO_PASSIVOS)]
    passivos.sort(key=lambda x: x.get("data_vencimento", ""))
    return passivos


@app.post("/passivos")
def criar_passivo(dados: PassivoIn):
    passivos = ler_json(ARQUIVO_PASSIVOS)
    timestamp = agora_iso()
    passivo = {
        "id": proximo_id(passivos),
        "nome": dados.nome,
        "tipo": dados.tipo,
        "valor_total": float(dados.valor_total or 0),
        "valor_pago": float(dados.valor_pago or 0),
        "data_inicio": str(dados.data_inicio) if dados.data_inicio else "",
        "data_vencimento": str(dados.data_vencimento) if dados.data_vencimento else "",
        "observacao": dados.observacao,
        "status": dados.status,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    passivo["saldo_devedor"] = max(passivo["valor_total"] - passivo["valor_pago"], 0)
    passivos.append(passivo)
    salvar_json(ARQUIVO_PASSIVOS, passivos)
    return normalizar_passivo_antigo(passivo)


@app.put("/passivos/{passivo_id}")
def atualizar_passivo(passivo_id: int, dados: PassivoIn):
    passivos = ler_json(ARQUIVO_PASSIVOS)
    passivo = buscar_por_id(passivos, passivo_id)
    if not passivo:
        raise HTTPException(status_code=404, detail="Passivo nao encontrado.")
    passivo["nome"] = dados.nome
    passivo["tipo"] = dados.tipo
    passivo["valor_total"] = float(dados.valor_total or 0)
    passivo["valor_pago"] = float(dados.valor_pago or 0)
    passivo["saldo_devedor"] = max(passivo["valor_total"] - passivo["valor_pago"], 0)
    passivo["data_inicio"] = str(dados.data_inicio) if dados.data_inicio else ""
    passivo["data_vencimento"] = str(dados.data_vencimento) if dados.data_vencimento else ""
    passivo["observacao"] = dados.observacao
    passivo["status"] = dados.status
    passivo["created_at"] = passivo.get("created_at") or agora_iso()
    passivo["updated_at"] = agora_iso()
    salvar_json(ARQUIVO_PASSIVOS, passivos)
    return normalizar_passivo_antigo(passivo)


@app.delete("/passivos/{passivo_id}")
def excluir_passivo(passivo_id: int):
    passivos = ler_json(ARQUIVO_PASSIVOS)
    if not buscar_por_id(passivos, passivo_id):
        raise HTTPException(status_code=404, detail="Passivo nao encontrado.")
    salvar_json(ARQUIVO_PASSIVOS, [item for item in passivos if item.get("id") != passivo_id])
    return {"mensagem": "Passivo excluido com sucesso."}


@app.get("/estoque/produtos")
def listar_produtos_estoque(nome: Optional[str] = None, categoria: Optional[str] = None, estoque_baixo: Optional[bool] = None):
    produtos = [normalizar_produto_estoque_antigo(item) for item in ler_json(ARQUIVO_ESTOQUE_PRODUTOS)]
    if nome:
        produtos = [item for item in produtos if nome.lower() in item.get("nome", "").lower()]
    if categoria:
        produtos = [item for item in produtos if categoria.lower() in item.get("categoria", "").lower()]
    if estoque_baixo is not None:
        produtos = [item for item in produtos if item.get("estoque_baixo") is estoque_baixo]
    produtos.sort(key=lambda x: x.get("nome", "").lower())
    return produtos


@app.post("/estoque/produtos")
def criar_produto_estoque(dados: ProdutoEstoqueIn):
    produtos = ler_json(ARQUIVO_ESTOQUE_PRODUTOS)
    timestamp = agora_iso()
    produto = {
        "id": proximo_id(produtos),
        "nome": dados.nome,
        "categoria": dados.categoria,
        "unidade_medida": dados.unidade_medida,
        "quantidade_atual": float(dados.quantidade_atual or 0),
        "valor_custo": float(dados.valor_custo or 0),
        "estoque_minimo": float(dados.estoque_minimo or 0),
        "observacao": dados.observacao,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    produtos.append(produto)
    salvar_json(ARQUIVO_ESTOQUE_PRODUTOS, produtos)
    return normalizar_produto_estoque_antigo(produto)


@app.put("/estoque/produtos/{produto_id}")
def atualizar_produto_estoque(produto_id: int, dados: ProdutoEstoqueIn):
    produtos = ler_json(ARQUIVO_ESTOQUE_PRODUTOS)
    produto = buscar_por_id(produtos, produto_id)
    if not produto:
        raise HTTPException(status_code=404, detail="Produto nao encontrado.")
    produto["nome"] = dados.nome
    produto["categoria"] = dados.categoria
    produto["unidade_medida"] = dados.unidade_medida
    produto["quantidade_atual"] = float(dados.quantidade_atual or 0)
    produto["valor_custo"] = float(dados.valor_custo or 0)
    produto["estoque_minimo"] = float(dados.estoque_minimo or 0)
    produto["observacao"] = dados.observacao
    produto["created_at"] = produto.get("created_at") or agora_iso()
    produto["updated_at"] = agora_iso()
    salvar_json(ARQUIVO_ESTOQUE_PRODUTOS, produtos)
    return normalizar_produto_estoque_antigo(produto)


@app.delete("/estoque/produtos/{produto_id}")
def excluir_produto_estoque(produto_id: int):
    produtos = ler_json(ARQUIVO_ESTOQUE_PRODUTOS)
    if not buscar_por_id(produtos, produto_id):
        raise HTTPException(status_code=404, detail="Produto nao encontrado.")
    salvar_json(ARQUIVO_ESTOQUE_PRODUTOS, [item for item in produtos if item.get("id") != produto_id])
    return {"mensagem": "Produto excluido com sucesso."}


@app.get("/estoque/movimentacoes")
def listar_movimentacoes_estoque(produto_id: Optional[int] = None):
    movimentacoes = ler_json(ARQUIVO_ESTOQUE_MOVIMENTACOES)
    if produto_id:
        movimentacoes = [item for item in movimentacoes if item.get("produto_id") == produto_id]
    movimentacoes.sort(key=lambda x: x.get("data", ""), reverse=True)
    return movimentacoes


@app.post("/estoque/movimentacoes")
def criar_movimentacao_estoque(dados: MovimentacaoEstoqueIn):
    produtos = ler_json(ARQUIVO_ESTOQUE_PRODUTOS)
    produto = buscar_por_id(produtos, dados.produto_id)
    if not produto:
        raise HTTPException(status_code=404, detail="Produto nao encontrado.")
    quantidade = float(dados.quantidade or 0)
    atual = float(produto.get("quantidade_atual") or 0)
    if dados.tipo_movimentacao == "Entrada":
        produto["quantidade_atual"] = atual + quantidade
    elif dados.tipo_movimentacao == "Saida":
        if quantidade > atual:
            raise HTTPException(status_code=400, detail="Saida maior que o estoque disponivel.")
        produto["quantidade_atual"] = atual - quantidade
    else:
        produto["quantidade_atual"] = quantidade
    if dados.valor_unitario:
        produto["valor_custo"] = float(dados.valor_unitario)
    produto["updated_at"] = agora_iso()
    salvar_json(ARQUIVO_ESTOQUE_PRODUTOS, produtos)

    movimentacoes = ler_json(ARQUIVO_ESTOQUE_MOVIMENTACOES)
    movimentacao = {
        "id": proximo_id(movimentacoes),
        "produto_id": dados.produto_id,
        "tipo_movimentacao": dados.tipo_movimentacao,
        "quantidade": quantidade,
        "valor_unitario": float(dados.valor_unitario or 0),
        "data": str(dados.data),
        "observacao": dados.observacao,
        "created_at": agora_iso(),
    }
    movimentacoes.append(movimentacao)
    salvar_json(ARQUIVO_ESTOQUE_MOVIMENTACOES, movimentacoes)
    return movimentacao


# =========================================================
# RELATORIOS FINANCEIROS
# =========================================================

def filtrar_lancamentos_relatorio(
    data_inicial: Optional[date] = None,
    data_final: Optional[date] = None,
    veiculo_id: Optional[int] = None,
    empresa_id: Optional[int] = None,
    classificacao: Optional[str] = None,
    obra_servico: Optional[str] = None,
):
    return listar_lancamentos(
        classificacao=classificacao,
        data_inicial=data_inicial,
        data_final=data_final,
        veiculo_id=veiculo_id,
        empresa_id=empresa_id,
        obra_servico=obra_servico,
    )


def filtrar_contas_receber_relatorio(
    data_inicial: Optional[date] = None,
    data_final: Optional[date] = None,
    veiculo_id: Optional[int] = None,
):
    return listar_contas_receber(
        data_inicial=data_inicial,
        data_final=data_final,
        veiculo_id=veiculo_id,
    )


def somar_lancamentos(lancamentos, predicado) -> float:
    return sum(float(item.get("valor") or 0) for item in lancamentos if predicado(item.get("classificacao", "")))


def montar_resumo_financeiro(lancamentos, contas_receber) -> dict:
    total_faturamento = somar_lancamentos(lancamentos, eh_receita)
    total_custos = somar_lancamentos(lancamentos, eh_custo)
    total_despesas = somar_lancamentos(lancamentos, eh_despesa)
    total_investimentos = somar_lancamentos(lancamentos, eh_investimento)
    contas_total = sum(float(item.get("valor_total_receber") or 0) for item in contas_receber)
    contas_recebido = sum(float(item.get("valor_total_receber") or 0) for item in contas_receber if item.get("status_pagamento") == "recebido")
    contas_pendente = sum(float(item.get("valor_total_receber") or 0) for item in contas_receber if item.get("status_pagamento") == "pendente")

    return {
        "total_faturamento": total_faturamento,
        "total_custos": total_custos,
        "total_despesas": total_despesas,
        "total_investimentos": total_investimentos,
        "lucro_bruto": total_faturamento - total_custos,
        "lucro_liquido": total_faturamento - total_custos - total_despesas,
        "saldo_periodo": total_faturamento - total_custos - total_despesas - total_investimentos,
        "quantidade_lancamentos": len(lancamentos),
        "contas_a_receber_total": contas_total,
        "contas_a_receber_pendente": contas_pendente,
        "contas_a_receber_recebido": contas_recebido,
    }


def adicionar_totais_grupo(registro: dict, classificacao: str, valor: float) -> None:
    if eh_receita(classificacao):
        registro["total_receitas"] += valor
    elif eh_custo(classificacao):
        registro["total_custos"] += valor
    elif eh_despesa(classificacao):
        registro["total_despesas"] += valor
    elif eh_investimento(classificacao):
        registro["total_investimentos"] += valor


def finalizar_resultado_grupo(registro: dict) -> dict:
    registro["resultado"] = registro["total_receitas"] - registro["total_custos"] - registro["total_despesas"] - registro["total_investimentos"]
    return registro


def agrupar_por_periodo(lancamentos) -> list:
    grupos = {}
    for item in lancamentos:
        periodo = str(item.get("data", ""))[:7] or "sem_periodo"
        grupo = grupos.setdefault(periodo, {"periodo": periodo, "total_receitas": 0, "total_custos": 0, "total_despesas": 0, "total_investimentos": 0, "resultado": 0})
        adicionar_totais_grupo(grupo, item.get("classificacao", ""), float(item.get("valor") or 0))
    return [finalizar_resultado_grupo(item) for item in sorted(grupos.values(), key=lambda x: x["periodo"])]


def agrupar_por_classificacao(lancamentos) -> list:
    grupos = {}
    for item in lancamentos:
        classificacao = item.get("classificacao", "Sem classificacao")
        grupo = grupos.setdefault(classificacao, {"classificacao": classificacao, "grupo_financeiro": obter_grupo_financeiro(classificacao), "quantidade": 0, "total": 0})
        grupo["quantidade"] += 1
        grupo["total"] += float(item.get("valor") or 0)
    return sorted(grupos.values(), key=lambda x: abs(x["total"]), reverse=True)


def agrupar_por_veiculo(lancamentos) -> list:
    veiculos = {item.get("id"): item for item in listar_veiculos()}
    grupos = {}
    for item in lancamentos:
        veiculo_id = item.get("veiculo_id")
        veiculo = veiculos.get(veiculo_id, {})
        grupo = grupos.setdefault(veiculo_id or 0, {
            "veiculo_id": veiculo_id,
            "nome_veiculo": veiculo.get("nome", "Sem veiculo"),
            "placa": veiculo.get("placa", ""),
            "total_receitas": 0,
            "total_custos": 0,
            "total_despesas": 0,
            "total_investimentos": 0,
            "resultado": 0,
            "custo_por_km": 0,
            "consumo_medio_combustivel": 0,
            "km_rodado": 0,
            "litros": 0,
        })
        adicionar_totais_grupo(grupo, item.get("classificacao", ""), float(item.get("valor") or 0))
        if item.get("kilometragem"):
            grupo["km_rodado"] += float(item.get("kilometragem") or 0)
        if item.get("litros"):
            grupo["litros"] += float(item.get("litros") or 0)

    resultado = []
    for grupo in grupos.values():
        finalizar_resultado_grupo(grupo)
        custo_total = grupo["total_custos"] + grupo["total_despesas"]
        grupo["custo_por_km"] = custo_total / grupo["km_rodado"] if grupo["km_rodado"] else 0
        grupo["consumo_medio_combustivel"] = grupo["km_rodado"] / grupo["litros"] if grupo["litros"] else 0
        resultado.append(grupo)
    return sorted(resultado, key=lambda x: abs(x["resultado"]), reverse=True)


def agrupar_por_empresa(lancamentos) -> list:
    grupos = {}
    for item in lancamentos:
        empresa_id = item.get("empresa_id") or 0
        grupo = grupos.setdefault(empresa_id, {"empresa_id": item.get("empresa_id"), "nome_empresa": f"Empresa {empresa_id}" if empresa_id else "Sem empresa", "total_receitas": 0, "total_custos": 0, "total_despesas": 0, "total_investimentos": 0, "resultado": 0})
        adicionar_totais_grupo(grupo, item.get("classificacao", ""), float(item.get("valor") or 0))
    return [finalizar_resultado_grupo(item) for item in grupos.values()]


def listar_contas_pagar_resumo() -> dict:
    contas = ler_json(ARQUIVO_CONTAS_PAGAR)
    total = sum(float(item.get("valor") or 0) for item in contas)
    pendente = sum(float(item.get("valor") or 0) for item in contas if item.get("status_pagamento", "pendente") == "pendente")
    pago = sum(float(item.get("valor") or 0) for item in contas if item.get("status_pagamento") == "pago")
    return {"total": total, "pendente": pendente, "pago": pago, "itens": contas}


def montar_relatorio_completo(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, classificacao: Optional[str] = None, obra_servico: Optional[str] = None):
    lancamentos = filtrar_lancamentos_relatorio(data_inicial, data_final, veiculo_id, empresa_id, classificacao, obra_servico)
    contas_receber = filtrar_contas_receber_relatorio(data_inicial, data_final, veiculo_id)
    return {
        "resumo": montar_resumo_financeiro(lancamentos, contas_receber),
        "por_periodo": agrupar_por_periodo(lancamentos),
        "por_veiculo": agrupar_por_veiculo(lancamentos),
        "por_classificacao": agrupar_por_classificacao(lancamentos),
        "por_empresa": agrupar_por_empresa(lancamentos),
        "contas_receber": contas_receber,
        "contas_pagar": listar_contas_pagar_resumo(),
    }


@app.get("/relatorios/resumo")
def relatorio_resumo(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, classificacao: Optional[str] = None, obra_servico: Optional[str] = None):
    return montar_relatorio_completo(data_inicial, data_final, veiculo_id, empresa_id, classificacao, obra_servico)["resumo"]


@app.get("/relatorios/resumo-financeiro")
def relatorio_resumo_financeiro(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, obra_servico: Optional[str] = None):
    resumo = montar_relatorio_completo(data_inicial, data_final, veiculo_id, empresa_id, None, obra_servico)["resumo"]
    return {
        "faturamento": resumo["total_faturamento"],
        "custos_operacionais": resumo["total_custos"],
        "despesas_administrativas": resumo["total_despesas"],
        "investimentos": resumo["total_investimentos"],
        "lucro_bruto": resumo["lucro_bruto"],
        "lucro_liquido": resumo["lucro_liquido"],
        "saldo_periodo": resumo["saldo_periodo"],
        "valores_pendentes_a_receber": resumo["contas_a_receber_pendente"],
    }


@app.get("/relatorios/custo-por-veiculo")
def relatorio_custo_por_veiculo(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, obra_servico: Optional[str] = None):
    dados = agrupar_por_veiculo(filtrar_lancamentos_relatorio(data_inicial, data_final, veiculo_id, empresa_id, None, obra_servico))
    return [
        {
            **item,
            "custo_total_veiculo": item["total_custos"] + item["total_despesas"],
        }
        for item in dados
    ]


@app.get("/relatorios/resultado-por-obra-servico")
def relatorio_resultado_por_obra_servico(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, obra_servico: Optional[str] = None):
    lancamentos = filtrar_lancamentos_relatorio(data_inicial, data_final, veiculo_id, empresa_id, None, obra_servico)
    grupos = {}
    for item in lancamentos:
        nome = item.get("obra_servico") or "Sem obra/servico"
        grupo = grupos.setdefault(nome, {"obra_servico": nome, "receitas": 0, "custos": 0, "despesas": 0, "resultado": 0})
        valor = float(item.get("valor") or 0)
        if eh_receita(item.get("classificacao", "")):
            grupo["receitas"] += valor
        elif eh_custo(item.get("classificacao", "")):
            grupo["custos"] += valor
        elif eh_despesa(item.get("classificacao", "")):
            grupo["despesas"] += valor
    for grupo in grupos.values():
        grupo["resultado"] = grupo["receitas"] - grupo["custos"] - grupo["despesas"]
    return sorted(grupos.values(), key=lambda x: abs(x["resultado"]), reverse=True)


@app.get("/relatorios/consumo-combustivel")
def relatorio_consumo_combustivel(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, obra_servico: Optional[str] = None):
    return [
        {
            "veiculo_id": item["veiculo_id"],
            "nome_veiculo": item["nome_veiculo"],
            "placa": item["placa"],
            "km_rodado": item["km_rodado"],
            "litros": item["litros"],
            "consumo_medio_combustivel": item["consumo_medio_combustivel"],
            "custo_por_km": item["custo_por_km"],
        }
        for item in agrupar_por_veiculo(filtrar_lancamentos_relatorio(data_inicial, data_final, veiculo_id, empresa_id, None, obra_servico))
    ]


@app.get("/relatorios/por-periodo")
def relatorio_por_periodo(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, classificacao: Optional[str] = None, obra_servico: Optional[str] = None):
    return montar_relatorio_completo(data_inicial, data_final, veiculo_id, empresa_id, classificacao, obra_servico)["por_periodo"]


@app.get("/relatorios/por-veiculo")
def relatorio_por_veiculo(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, classificacao: Optional[str] = None, obra_servico: Optional[str] = None):
    return montar_relatorio_completo(data_inicial, data_final, veiculo_id, empresa_id, classificacao, obra_servico)["por_veiculo"]


@app.get("/relatorios/por-classificacao")
def relatorio_por_classificacao(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, classificacao: Optional[str] = None, obra_servico: Optional[str] = None):
    return montar_relatorio_completo(data_inicial, data_final, veiculo_id, empresa_id, classificacao, obra_servico)["por_classificacao"]


@app.get("/relatorios/por-empresa")
def relatorio_por_empresa(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, classificacao: Optional[str] = None, obra_servico: Optional[str] = None):
    return montar_relatorio_completo(data_inicial, data_final, veiculo_id, empresa_id, classificacao, obra_servico)["por_empresa"]


@app.get("/relatorios/receitas")
def relatorio_receitas(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, classificacao: Optional[str] = None, obra_servico: Optional[str] = None):
    return [item for item in filtrar_lancamentos_relatorio(data_inicial, data_final, veiculo_id, empresa_id, classificacao, obra_servico) if eh_receita(item.get("classificacao", ""))]


@app.get("/relatorios/custos")
def relatorio_custos(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, classificacao: Optional[str] = None, obra_servico: Optional[str] = None):
    return [item for item in filtrar_lancamentos_relatorio(data_inicial, data_final, veiculo_id, empresa_id, classificacao, obra_servico) if eh_custo(item.get("classificacao", ""))]


@app.get("/relatorios/despesas")
def relatorio_despesas(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, classificacao: Optional[str] = None, obra_servico: Optional[str] = None):
    return [item for item in filtrar_lancamentos_relatorio(data_inicial, data_final, veiculo_id, empresa_id, classificacao, obra_servico) if eh_despesa(item.get("classificacao", ""))]


@app.get("/relatorios/investimentos")
def relatorio_investimentos(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, classificacao: Optional[str] = None, obra_servico: Optional[str] = None):
    return [item for item in filtrar_lancamentos_relatorio(data_inicial, data_final, veiculo_id, empresa_id, classificacao, obra_servico) if eh_investimento(item.get("classificacao", ""))]


@app.get("/relatorios/contas-receber")
def relatorio_contas_receber(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None):
    contas = filtrar_contas_receber_relatorio(data_inicial, data_final, veiculo_id)
    return {"resumo": montar_resumo_financeiro([], contas), "itens": contas}


@app.get("/relatorios/contas-pagar")
def relatorio_contas_pagar():
    return listar_contas_pagar_resumo()


@app.get("/relatorios/ativos")
def relatorio_ativos():
    ativos = listar_ativos()
    return {
        "total": sum(float(item.get("valor") or 0) for item in ativos),
        "quantidade": len(ativos),
        "itens": ativos,
    }


@app.get("/relatorios/passivos")
def relatorio_passivos():
    passivos = listar_passivos()
    return {
        "total": sum(float(item.get("saldo_devedor") or 0) for item in passivos),
        "quantidade": len(passivos),
        "itens": passivos,
    }


@app.get("/relatorios/patrimonio-liquido")
def relatorio_patrimonio_liquido():
    ativos = relatorio_ativos()
    passivos = relatorio_passivos()
    return {
        "total_ativos": ativos["total"],
        "total_passivos": passivos["total"],
        "patrimonio_liquido": ativos["total"] - passivos["total"],
    }


@app.get("/relatorios/estoque")
def relatorio_estoque():
    produtos = listar_produtos_estoque()
    movimentacoes = listar_movimentacoes_estoque()
    return {
        "total_produtos": len(produtos),
        "valor_total_estoque": sum(float(item.get("valor_total_estoque") or 0) for item in produtos),
        "produtos_estoque_baixo": sum(1 for item in produtos if item.get("estoque_baixo")),
        "ultimas_movimentacoes": movimentacoes[:10],
        "produtos": produtos,
    }


def linhas_tabela_relatorio(dados: dict) -> list[str]:
    resumo = dados["resumo"]
    return [
        "Resumo financeiro",
        f"Emitido em: {datetime.now().strftime('%d/%m/%Y %H:%M')}",
        f"Faturamento: {resumo['total_faturamento']:.2f}",
        f"Custos: {resumo['total_custos']:.2f}",
        f"Despesas: {resumo['total_despesas']:.2f}",
        f"Investimentos: {resumo['total_investimentos']:.2f}",
        f"Lucro bruto: {resumo['lucro_bruto']:.2f}",
        f"Lucro liquido: {resumo['lucro_liquido']:.2f}",
        f"Saldo do periodo: {resumo['saldo_periodo']:.2f}",
        f"Contas a receber pendente: {resumo['contas_a_receber_pendente']:.2f}",
    ]


def gerar_pdf_simples(linhas: list[str]) -> bytes:
    conteudo_linhas = ["BT", "/F1 12 Tf", "50 790 Td"]
    for linha in linhas[:45]:
        texto = linha.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        conteudo_linhas.append(f"({texto}) Tj")
        conteudo_linhas.append("0 -18 Td")
    conteudo_linhas.append("ET")
    stream = "\n".join(conteudo_linhas).encode("utf-8")
    objetos = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    pdf = io.BytesIO()
    pdf.write(b"%PDF-1.4\n")
    offsets = []
    for indice, objeto in enumerate(objetos, start=1):
        offsets.append(pdf.tell())
        pdf.write(f"{indice} 0 obj\n".encode("ascii"))
        pdf.write(objeto)
        pdf.write(b"\nendobj\n")
    xref = pdf.tell()
    pdf.write(f"xref\n0 {len(objetos) + 1}\n".encode("ascii"))
    pdf.write(b"0000000000 65535 f \n")
    for offset in offsets:
        pdf.write(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.write(f"trailer << /Size {len(objetos) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode("ascii"))
    return pdf.getvalue()


def planilha_xml(linhas: list[list]) -> str:
    rows = []
    for row_idx, linha in enumerate(linhas, start=1):
        cells = []
        for col_idx, valor in enumerate(linha, start=1):
            col = chr(64 + col_idx)
            cells.append(f'<c r="{col}{row_idx}" t="inlineStr"><is><t>{escape(str(valor))}</t></is></c>')
        rows.append(f'<row r="{row_idx}">{"".join(cells)}</row>')
    return f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{"".join(rows)}</sheetData></worksheet>'


def gerar_excel_simples(dados: dict) -> bytes:
    abas = {
        "Resumo": [["Indicador", "Valor"]] + [[k, v] for k, v in dados["resumo"].items()],
        "Por Classificacao": [["Classificacao", "Grupo", "Quantidade", "Total"]] + [[i["classificacao"], i["grupo_financeiro"], i["quantidade"], i["total"]] for i in dados["por_classificacao"]],
        "Por Veiculo": [["Veiculo", "Placa", "Receitas", "Custos", "Despesas", "Investimentos", "Resultado", "Custo/KM", "Consumo Medio"]] + [[i["nome_veiculo"], i["placa"], i["total_receitas"], i["total_custos"], i["total_despesas"], i["total_investimentos"], i["resultado"], i["custo_por_km"], i["consumo_medio_combustivel"]] for i in dados["por_veiculo"]],
        "Por Periodo": [["Periodo", "Receitas", "Custos", "Despesas", "Investimentos", "Resultado"]] + [[i["periodo"], i["total_receitas"], i["total_custos"], i["total_despesas"], i["total_investimentos"], i["resultado"]] for i in dados["por_periodo"]],
        "Contas a Receber": [["Data", "Contrato", "Tomador", "Total", "Status"]] + [[i["data_inicio"], i["contrato"], i["tomador"], i["valor_total_receber"], i["status_pagamento"]] for i in dados["contas_receber"]],
        "Contas a Pagar": [["Descricao", "Valor", "Status"]] + [[i.get("descricao", ""), i.get("valor", 0), i.get("status_pagamento", "pendente")] for i in dados["contas_pagar"]["itens"]],
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as arquivo:
        arquivo.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>')
        arquivo.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        sheets = []
        rels = []
        for idx, (nome, linhas) in enumerate(abas.items(), start=1):
            sheets.append(f'<sheet name="{escape(nome)}" sheetId="{idx}" r:id="rId{idx}"/>')
            rels.append(f'<Relationship Id="rId{idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{idx}.xml"/>')
            arquivo.writestr(f"xl/worksheets/sheet{idx}.xml", planilha_xml(linhas))
        arquivo.writestr("xl/workbook.xml", f'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{"".join(sheets)}</sheets></workbook>')
        arquivo.writestr("xl/_rels/workbook.xml.rels", f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{"".join(rels)}</Relationships>')
    return buffer.getvalue()


@app.get("/relatorios/exportar/pdf")
def exportar_relatorio_pdf(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, classificacao: Optional[str] = None, obra_servico: Optional[str] = None):
    dados = montar_relatorio_completo(data_inicial, data_final, veiculo_id, empresa_id, classificacao, obra_servico)
    conteudo = gerar_pdf_simples(linhas_tabela_relatorio(dados))
    return Response(content=conteudo, media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=relatorio_financeiro.pdf"})


@app.get("/relatorios/exportar/excel")
def exportar_relatorio_excel(data_inicial: Optional[date] = None, data_final: Optional[date] = None, veiculo_id: Optional[int] = None, empresa_id: Optional[int] = None, classificacao: Optional[str] = None, obra_servico: Optional[str] = None):
    dados = montar_relatorio_completo(data_inicial, data_final, veiculo_id, empresa_id, classificacao, obra_servico)
    conteudo = gerar_excel_simples(dados)
    return Response(content=conteudo, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=relatorio_financeiro.xlsx"})


@app.get("/veiculos")
def listar_veiculos():
    """
    Lista veiculos.
    Tambem normaliza registros antigos para nao quebrar o frontend.
    """
    veiculos = ler_json(ARQUIVO_VEICULOS)
    veiculos_normalizados = [normalizar_veiculo_antigo(item) for item in veiculos]

    # Ordena por nome
    veiculos_normalizados.sort(key=lambda x: x.get("nome", "").lower())

    return veiculos_normalizados


@app.post("/veiculos")
def criar_veiculo(dados: VeiculoIn):
    """
    Cria um novo veiculo.
    Valida se a placa ja existe.
    """
    veiculos = ler_json(ARQUIVO_VEICULOS)

    placa_normalizada = dados.placa.strip().upper()

    if placa_normalizada and any(item.get("placa", "").upper() == placa_normalizada for item in veiculos):
        raise HTTPException(status_code=400, detail="Ja existe um veiculo com esta placa.")

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
    Atualiza veiculo.
    Tambem valida duplicidade de placa.
    """
    veiculos = ler_json(ARQUIVO_VEICULOS)
    veiculo = buscar_por_id(veiculos, veiculo_id)

    if not veiculo:
        raise HTTPException(status_code=404, detail="Veiculo nao encontrado.")

    placa_normalizada = dados.placa.strip().upper()

    for item in veiculos:
        if placa_normalizada and item.get("id") != veiculo_id and item.get("placa", "").upper() == placa_normalizada:
            raise HTTPException(status_code=400, detail="Ja existe outro veiculo com esta placa.")

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
    Exclui um veiculo.
    """
    veiculos = ler_json(ARQUIVO_VEICULOS)
    veiculo = buscar_por_id(veiculos, veiculo_id)

    if not veiculo:
        raise HTTPException(status_code=404, detail="Veiculo nao encontrado.")

    veiculos = [item for item in veiculos if item.get("id") != veiculo_id]
    salvar_json(ARQUIVO_VEICULOS, veiculos)

    return {"mensagem": "Veiculo excluido com sucesso."}


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
        "cargo": dados.cargo,
        "admissao": str(dados.admissao) if dados.admissao else "",
        "lotacao": dados.lotacao,
        "pis": dados.pis,
        "banco": dados.banco,
        "agencia": dados.agencia,
        "conta": dados.conta,
        "tipo_conta": dados.tipo_conta,
        "empregador": dados.empregador,
        "empregador_cnpj": dados.empregador_cnpj,
        "salario_base": dados.salario_base,
        "carga_horaria_mensal": dados.carga_horaria_mensal,
        "valor_hora_extra": dados.valor_hora_extra,
        "inss_percentual": dados.inss_percentual,
        "irrf_percentual": dados.irrf_percentual,
        "vale_refeicao": dados.vale_refeicao,
        "convenio_medico": dados.convenio_medico,
        "outros_descontos_padrao": dados.outros_descontos_padrao,
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
        raise HTTPException(status_code=404, detail="Motorista nao encontrado.")

    motorista["nome"] = dados.nome
    motorista["telefone"] = dados.telefone
    motorista["cnh"] = dados.cnh
    motorista["cargo"] = dados.cargo
    motorista["admissao"] = str(dados.admissao) if dados.admissao else ""
    motorista["lotacao"] = dados.lotacao
    motorista["pis"] = dados.pis
    motorista["banco"] = dados.banco
    motorista["agencia"] = dados.agencia
    motorista["conta"] = dados.conta
    motorista["tipo_conta"] = dados.tipo_conta
    motorista["empregador"] = dados.empregador
    motorista["empregador_cnpj"] = dados.empregador_cnpj
    motorista["salario_base"] = dados.salario_base
    motorista["carga_horaria_mensal"] = dados.carga_horaria_mensal
    motorista["valor_hora_extra"] = dados.valor_hora_extra
    motorista["inss_percentual"] = dados.inss_percentual
    motorista["irrf_percentual"] = dados.irrf_percentual
    motorista["vale_refeicao"] = dados.vale_refeicao
    motorista["convenio_medico"] = dados.convenio_medico
    motorista["outros_descontos_padrao"] = dados.outros_descontos_padrao

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
        raise HTTPException(status_code=404, detail="Motorista nao encontrado.")

    motoristas = [item for item in motoristas if item.get("id") != motorista_id]
    salvar_json(ARQUIVO_MOTORISTAS, motoristas)

    return {"mensagem": "Motorista excluido com sucesso."}


# =========================================================
# FOLHA DE PAGAMENTO
# =========================================================

@app.get("/folha-pagamento")
def listar_folhas_pagamento():
    folhas = ler_json(ARQUIVO_FOLHA_PAGAMENTO)
    folhas.sort(key=lambda x: x.get("data_pagamento", ""), reverse=True)
    return folhas


@app.post("/folha-pagamento")
def criar_folha_pagamento(dados: FolhaPagamentoIn):
    if not dados.itens:
        raise HTTPException(status_code=400, detail="Inclua ao menos um motorista na folha.")

    motoristas = ler_json(ARQUIVO_MOTORISTAS)
    folhas = ler_json(ARQUIVO_FOLHA_PAGAMENTO)
    timestamp = agora_iso()
    itens_calculados = []

    for item in dados.itens:
        motorista = buscar_por_id(motoristas, item.motorista_id)
        if not motorista:
            raise HTTPException(status_code=404, detail=f"Motorista {item.motorista_id} nao encontrado.")
        itens_calculados.append(calcular_item_folha(item, motorista))

    totais = {
        "salario_base": arredondar_moeda(sum(item["salario_base"] for item in itens_calculados)),
        "valor_extras": arredondar_moeda(sum(item["valor_extras"] for item in itens_calculados)),
        "total_adicionais": arredondar_moeda(sum(item["total_adicionais"] for item in itens_calculados)),
        "salario_bruto": arredondar_moeda(sum(item["salario_bruto"] for item in itens_calculados)),
        "total_descontos": arredondar_moeda(sum(item["total_descontos"] for item in itens_calculados)),
        "salario_liquido": arredondar_moeda(sum(item["salario_liquido"] for item in itens_calculados)),
    }

    nova_folha = {
        "id": proximo_id(folhas),
        "periodo": dados.periodo,
        "data_pagamento": str(dados.data_pagamento),
        "descricao": dados.descricao or "Folha de pagamento",
        "opcoes_recibo": dados.opcoes_recibo or {},
        "itens": itens_calculados,
        "totais": totais,
        "lancamento_id": None,
        "created_at": timestamp,
    }

    if dados.gerar_lancamento and totais["salario_liquido"] > 0:
        lancamentos = ler_json(ARQUIVO_LANCAMENTOS)
        lancamento = {
            "id": proximo_id(lancamentos),
            "data": str(dados.data_pagamento),
            "classificacao": "1.5 SALARIO + ENCAGOS FOLHA PGTO",
            "descricao": f"{nova_folha['descricao']} - {dados.periodo}",
            "valor": totais["salario_liquido"],
            "veiculo_id": None,
            "empresa_id": None,
            "obra_servico": "",
            "tipo_financeiro": "custo",
            "created_at": timestamp,
            "updated_at": timestamp,
            "kilometragem": None,
            "litros": None,
            "numero_nf": "",
            "data_nf": "",
            "origem": "folha_pagamento",
            "folha_pagamento_id": nova_folha["id"],
        }
        lancamentos.append(lancamento)
        salvar_json(ARQUIVO_LANCAMENTOS, lancamentos)
        nova_folha["lancamento_id"] = lancamento["id"]

    folhas.append(nova_folha)
    salvar_json(ARQUIVO_FOLHA_PAGAMENTO, folhas)
    return nova_folha


@app.delete("/folha-pagamento/{folha_id}")
def excluir_folha_pagamento(folha_id: int):
    folhas = ler_json(ARQUIVO_FOLHA_PAGAMENTO)
    folha = buscar_por_id(folhas, folha_id)

    if not folha:
        raise HTTPException(status_code=404, detail="Folha de pagamento nao encontrada.")

    folhas = [item for item in folhas if item.get("id") != folha_id]
    salvar_json(ARQUIVO_FOLHA_PAGAMENTO, folhas)

    lancamento_id = folha.get("lancamento_id")
    if lancamento_id:
        lancamentos = ler_json(ARQUIVO_LANCAMENTOS)
        lancamentos = [
            item for item in lancamentos
            if item.get("id") != lancamento_id and item.get("folha_pagamento_id") != folha_id
        ]
        salvar_json(ARQUIVO_LANCAMENTOS, lancamentos)

    return {"mensagem": "Folha de pagamento excluida com sucesso."}
