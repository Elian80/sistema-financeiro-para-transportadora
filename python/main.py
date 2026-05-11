from pathlib import Path
from typing import Optional
from datetime import date, datetime
from contextvars import ContextVar
import io
import json
import math
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
from backend.models import (
    Ativo,
    ContaReceber,
    EstoqueMovimentacao,
    EstoqueProduto,
    Lancamento,
    Motorista,
    MotoristaAcesso,
    MotoristaLocalizacao,
    Passivo,
    PlanoConta,
    Usuario,
    Veiculo,
    Viagem,
)
from contextlib import contextmanager
from backend.security import criar_motorista_token, decodificar_motorista_token, decodificar_token, gerar_hash_senha, verificar_senha
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
    "/localizacoes-motoristas",
    "/folha-pagamento",
    "/mapa",
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
    response.headers["Permissions-Policy"] = "geolocation=(self), microphone=(), camera=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline' https://unpkg.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com"
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
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
FRONTEND_DIR = Path(__file__).parent.parent / "renderer"

# Apenas localizacoes e folha permanecem em JSON.
ARQUIVO_FOLHA_PAGAMENTO = DATA_DIR / "folha_pagamento.json"
ARQUIVO_LOCALIZACOES_MOTORISTAS = DATA_DIR / "localizacoes_motoristas.json"


# =========================================================
# HELPERS SQLALCHEMY
# =========================================================

@contextmanager
def sessao_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def obter_empresa() -> int:
    return EMPRESA_ATUAL_ID.get()


# =========================================================
# HELPERS JSON (apenas para localizacoes e folha)
# =========================================================

def _caminho_empresa(caminho: Path) -> Path:
    empresa_id = EMPRESA_ATUAL_ID.get()
    if not empresa_id or empresa_id == 1:
        return caminho
    pasta = DATA_DIR / "empresas" / str(empresa_id)
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta / caminho.name


def ler_json_loc(caminho: Path) -> list:
    caminho = _caminho_empresa(caminho)
    if not caminho.exists():
        return []
    try:
        dados = json.loads(caminho.read_text(encoding="utf-8"))
        return dados if isinstance(dados, list) else []
    except Exception:
        return []


def salvar_json_loc(caminho: Path, dados: list) -> None:
    caminho = _caminho_empresa(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")


def ler_json_folha() -> list:
    return ler_json_loc(ARQUIVO_FOLHA_PAGAMENTO)


def salvar_json_folha(dados: list) -> None:
    salvar_json_loc(ARQUIVO_FOLHA_PAGAMENTO, dados)


def proximo_id_lista(lista: list) -> int:
    if not lista:
        return 1
    return max(item.get("id", 0) for item in lista) + 1


def buscar_id_lista(lista: list, item_id: int):
    return next((x for x in lista if x.get("id") == item_id), None)

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


class ContaReceberStatusIn(BaseModel):
    status_pagamento: str

    @field_validator("status_pagamento")
    @classmethod
    def validar_status_pagamento(cls, value: str) -> str:
        status = value.strip().lower() or "pendente"
        if status not in {"pendente", "recebido"}:
            raise ValueError("Status de pagamento invalido.")
        return status


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


class LocalizacaoMotoristaIn(BaseModel):
    motorista_id: int
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    velocidade: float = 0
    direcao: float = 0
    precisao: float = 0
    bateria: Optional[float] = None

    @field_validator("velocidade", "direcao", "precisao", "bateria", mode="before")
    @classmethod
    def validar_numero_localizacao(cls, value: float) -> float:
        valor = normalizar_numero_decimal(value)
        return max(valor, 0)


class MotoristaMobileLoginIn(BaseModel):
    usuario: str
    senha: str
    empresa_id: Optional[int] = None
    motorista_id: Optional[int] = None


class LocalizacaoMotoristaMobileIn(LocalizacaoMotoristaIn):
    token: str
    empresa_id: Optional[int] = None


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
# CONVERSORES: modelo SQLAlchemy -> dict (formato frontend)
# =========================================================

def veiculo_para_dict(v: Veiculo) -> dict:
    return {
        "id": v.id,
        "nome": v.nome,
        "marca": v.marca,
        "modelo": v.modelo,
        "ano": v.ano,
        "placa": v.placa,
        "tipo": v.tipo,
        "status": v.status,
        "observacao": v.observacao,
        "foto": v.foto,
    }


def motorista_para_dict(m: Motorista) -> dict:
    ex = json.loads(m.dados or "{}")
    return {
        "id": m.id,
        "nome": m.nome,
        "telefone": m.telefone,
        "cnh": m.cnh,
        "cargo": m.cargo,
        "admissao": str(m.admissao) if m.admissao else "",
        "lotacao": ex.get("lotacao", ""),
        "pis": ex.get("pis", ""),
        "banco": ex.get("banco", ""),
        "agencia": ex.get("agencia", ""),
        "conta": ex.get("conta", ""),
        "tipo_conta": ex.get("tipo_conta", ""),
        "empregador": ex.get("empregador", ""),
        "empregador_cnpj": ex.get("empregador_cnpj", ""),
        "salario_base": float(ex.get("salario_base", 0)),
        "carga_horaria_mensal": float(ex.get("carga_horaria_mensal", 220)),
        "valor_hora_extra": float(ex.get("valor_hora_extra", 0)),
        "inss_percentual": float(ex.get("inss_percentual", 0)),
        "irrf_percentual": float(ex.get("irrf_percentual", 0)),
        "vale_refeicao": float(ex.get("vale_refeicao", 0)),
        "convenio_medico": float(ex.get("convenio_medico", 0)),
        "outros_descontos_padrao": float(ex.get("outros_descontos_padrao", 0)),
    }


def lancamento_para_dict(l: Lancamento) -> dict:
    ex = json.loads(l.dados or "{}")
    criado = str(l.created_at) if l.created_at else agora_iso()
    classificacao = l.classificacao or ""
    return {
        "id": l.id,
        "data": str(l.data) if l.data else "",
        "classificacao": classificacao,
        "descricao": l.descricao,
        "valor": float(l.valor or 0),
        "veiculo_id": ex.get("veiculo_id"),
        "empresa_id": ex.get("empresa_id"),
        "obra_servico": ex.get("obra_servico", ""),
        "tipo_financeiro": l.tipo_financeiro or inferir_tipo_financeiro(classificacao),
        "created_at": criado,
        "updated_at": str(l.updated_at) if l.updated_at else criado,
        "kilometragem": ex.get("kilometragem"),
        "litros": ex.get("litros"),
        "numero_nf": ex.get("numero_nf", ""),
        "data_nf": ex.get("data_nf", ""),
    }


def conta_receber_para_dict(c: ContaReceber) -> dict:
    ex = json.loads(c.dados or "{}")
    conta = {
        "id": c.id,
        "data_inicio": str(c.data_inicio) if c.data_inicio else "",
        "contrato": c.contrato,
        "cte_ticket": ex.get("cte_ticket", ""),
        "valor": float(c.valor or 0),
        "valor_hora_unitario": float(ex.get("valor_hora_unitario", 0)),
        "quantidade_horas": float(ex.get("quantidade_horas", 0)),
        "carga": ex.get("carga", ""),
        "ton_qnt": ex.get("ton_qnt", ""),
        "tomador": ex.get("tomador", ""),
        "origem_destino": ex.get("origem_destino", ""),
        "bonificacao": float(ex.get("bonificacao", 0)),
        "veiculo_id": ex.get("veiculo_id"),
        "descontos": float(ex.get("descontos", 0)),
        "desconto_classificacao": ex.get("desconto_classificacao", ""),
        "status_pagamento": (c.status_pagamento or "pendente").lower(),
        "data_recebimento": ex.get("data_recebimento", ""),
    }
    conta["valor_total_receber"] = calcular_total_conta_receber(conta)
    return conta


def ativo_para_dict(a: Ativo) -> dict:
    ex = json.loads(a.dados or "{}")
    criado = str(a.created_at) if a.created_at else agora_iso()
    return {
        "id": a.id,
        "nome": a.nome,
        "tipo": ex.get("tipo", "Outro"),
        "valor": float(a.valor or 0),
        "data_aquisicao": ex.get("data_aquisicao", ""),
        "veiculo_id": ex.get("veiculo_id"),
        "observacao": ex.get("observacao", ""),
        "status": ex.get("status", "Ativo"),
        "created_at": criado,
        "updated_at": str(a.updated_at) if a.updated_at else criado,
    }


def passivo_para_dict(p: Passivo) -> dict:
    ex = json.loads(p.dados or "{}")
    criado = str(p.created_at) if p.created_at else agora_iso()
    valor_total = float(ex.get("valor_total", p.valor or 0))
    valor_pago = float(ex.get("valor_pago", 0))
    return {
        "id": p.id,
        "nome": p.nome,
        "tipo": ex.get("tipo", "Outro"),
        "valor_total": valor_total,
        "valor_pago": valor_pago,
        "saldo_devedor": max(valor_total - valor_pago, 0),
        "data_inicio": ex.get("data_inicio", ""),
        "data_vencimento": ex.get("data_vencimento", ""),
        "observacao": ex.get("observacao", ""),
        "status": ex.get("status", "Pendente"),
        "created_at": criado,
        "updated_at": str(p.updated_at) if p.updated_at else criado,
    }


def produto_estoque_para_dict(ep: EstoqueProduto) -> dict:
    ex = json.loads(ep.dados or "{}")
    criado = str(ep.created_at) if ep.created_at else agora_iso()
    quantidade = float(ep.quantidade or 0)
    valor_custo = float(ex.get("valor_custo", 0))
    estoque_minimo = float(ex.get("estoque_minimo", 0))
    return {
        "id": ep.id,
        "nome": ep.nome,
        "categoria": ep.categoria,
        "unidade_medida": ex.get("unidade_medida", "un"),
        "quantidade_atual": quantidade,
        "valor_custo": valor_custo,
        "estoque_minimo": estoque_minimo,
        "observacao": ex.get("observacao", ""),
        "valor_total_estoque": quantidade * valor_custo,
        "estoque_baixo": quantidade <= estoque_minimo,
        "created_at": criado,
        "updated_at": str(ep.updated_at) if ep.updated_at else criado,
    }


def movimentacao_para_dict(em: EstoqueMovimentacao) -> dict:
    ex = json.loads(em.dados or "{}")
    return {
        "id": em.id,
        "produto_id": em.produto_id,
        "tipo_movimentacao": em.tipo,
        "quantidade": float(em.quantidade or 0),
        "valor_unitario": float(ex.get("valor_unitario", 0)),
        "data": ex.get("data", ""),
        "observacao": ex.get("observacao", ""),
        "created_at": str(em.created_at) if em.created_at else agora_iso(),
    }


def agora_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def minutos_desde_iso(valor: str) -> float:
    if not valor:
        return 999999
    try:
        data = datetime.fromisoformat(str(valor))
        return max((datetime.now() - data).total_seconds() / 60, 0)
    except ValueError:
        return 999999


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
    empresa_id = EMPRESA_ATUAL_ID.get()
    nomes = list(CLASSIFICACOES)
    with sessao_db() as db:
        registros = db.query(PlanoConta).filter(PlanoConta.empresa_id == empresa_id).all()
        for r in registros:
            if r.nome and r.nome not in nomes:
                nomes.append(r.nome)
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
    empresa_id = obter_empresa()
    with sessao_db() as db:
        registros = db.query(PlanoConta).filter(PlanoConta.empresa_id == empresa_id).order_by(PlanoConta.nome).all()
        return [{"id": r.id, "nome": r.nome} for r in registros]


@app.get("/plano-contas/estrutura")
def listar_estrutura_plano_contas():
    return {
        "grupos": PLANO_CONTAS_BASE,
        "personalizadas": listar_plano_contas(),
    }


@app.post("/plano-contas")
def criar_plano_conta(dados: PlanoContaIn):
    empresa_id = obter_empresa()
    if any(n.lower() == dados.nome.lower() for n in CLASSIFICACOES):
        raise HTTPException(status_code=400, detail="Esta classificacao ja existe na lista base.")
    with sessao_db() as db:
        existente = db.query(PlanoConta).filter(
            PlanoConta.empresa_id == empresa_id,
            PlanoConta.nome.ilike(dados.nome),
        ).first()
        if existente:
            raise HTTPException(status_code=400, detail="Classificacao ja cadastrada.")
        novo = PlanoConta(empresa_id=empresa_id, nome=dados.nome)
        db.add(novo)
        db.commit()
        db.refresh(novo)
        return {"id": novo.id, "nome": novo.nome}


@app.put("/plano-contas/{plano_conta_id}")
def atualizar_plano_conta(plano_conta_id: int, dados: PlanoContaIn):
    empresa_id = obter_empresa()
    if any(n.lower() == dados.nome.lower() for n in CLASSIFICACOES):
        raise HTTPException(status_code=400, detail="Esta classificacao ja existe na lista base.")
    with sessao_db() as db:
        registro = db.query(PlanoConta).filter(
            PlanoConta.empresa_id == empresa_id, PlanoConta.id == plano_conta_id
        ).first()
        if not registro:
            raise HTTPException(status_code=404, detail="Classificacao nao encontrada.")
        duplicado = db.query(PlanoConta).filter(
            PlanoConta.empresa_id == empresa_id,
            PlanoConta.id != plano_conta_id,
            PlanoConta.nome.ilike(dados.nome),
        ).first()
        if duplicado:
            raise HTTPException(status_code=400, detail="Classificacao ja cadastrada.")
        registro.nome = dados.nome
        db.commit()
        return {"id": registro.id, "nome": registro.nome}


@app.delete("/plano-contas/{plano_conta_id}")
def excluir_plano_conta(plano_conta_id: int):
    empresa_id = obter_empresa()
    with sessao_db() as db:
        registro = db.query(PlanoConta).filter(
            PlanoConta.empresa_id == empresa_id, PlanoConta.id == plano_conta_id
        ).first()
        if not registro:
            raise HTTPException(status_code=404, detail="Classificacao nao encontrada.")
        db.delete(registro)
        db.commit()
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
    eid = obter_empresa()
    with sessao_db() as db:
        q = db.query(Lancamento).filter(Lancamento.empresa_id == eid)
        if classificacao:
            q = q.filter(Lancamento.classificacao == classificacao)
        if data_inicial:
            q = q.filter(Lancamento.data >= data_inicial)
        if data_final:
            q = q.filter(Lancamento.data <= data_final)
        if descricao:
            q = q.filter(Lancamento.descricao.ilike(f"%{descricao.strip()}%"))
        result = [lancamento_para_dict(l) for l in q.order_by(Lancamento.data.desc()).all()]
    if veiculo_id:
        result = [r for r in result if r.get("veiculo_id") == veiculo_id]
    if empresa_id:
        result = [r for r in result if r.get("empresa_id") == empresa_id]
    if obra_servico:
        ob = obra_servico.strip().lower()
        result = [r for r in result if ob in r.get("obra_servico", "").lower()]
    return result


@app.post("/lancamentos")
def criar_lancamento(dados: LancamentoIn):
    if dados.classificacao not in listar_classificacoes_ativas():
        raise HTTPException(status_code=400, detail="Classificacao invalida.")
    eid = obter_empresa()
    extras = {
        "veiculo_id": dados.veiculo_id,
        "empresa_id": dados.empresa_id,
        "obra_servico": dados.obra_servico,
        "kilometragem": dados.kilometragem,
        "litros": dados.litros,
        "numero_nf": dados.numero_nf,
        "data_nf": str(dados.data_nf) if dados.data_nf else "",
    }
    with sessao_db() as db:
        l = Lancamento(
            empresa_id=eid,
            data=dados.data,
            classificacao=dados.classificacao,
            descricao=dados.descricao,
            valor=float(dados.valor),
            tipo_financeiro=inferir_tipo_financeiro(dados.classificacao),
            dados=json.dumps(extras, ensure_ascii=False),
        )
        db.add(l)
        db.commit()
        db.refresh(l)
        return lancamento_para_dict(l)


@app.put("/lancamentos/{lancamento_id}")
def atualizar_lancamento(lancamento_id: int, dados: LancamentoIn):
    if dados.classificacao not in listar_classificacoes_ativas():
        raise HTTPException(status_code=400, detail="Classificacao invalida.")
    eid = obter_empresa()
    with sessao_db() as db:
        l = db.query(Lancamento).filter(Lancamento.empresa_id == eid, Lancamento.id == lancamento_id).first()
        if not l:
            raise HTTPException(status_code=404, detail="Lancamento nao encontrado.")
        extras = {
            "veiculo_id": dados.veiculo_id,
            "empresa_id": dados.empresa_id,
            "obra_servico": dados.obra_servico,
            "kilometragem": dados.kilometragem,
            "litros": dados.litros,
            "numero_nf": dados.numero_nf,
            "data_nf": str(dados.data_nf) if dados.data_nf else "",
        }
        l.data = dados.data
        l.classificacao = dados.classificacao
        l.descricao = dados.descricao
        l.valor = float(dados.valor)
        l.tipo_financeiro = inferir_tipo_financeiro(dados.classificacao)
        l.dados = json.dumps(extras, ensure_ascii=False)
        db.commit()
        db.refresh(l)
        return lancamento_para_dict(l)


@app.delete("/lancamentos/{lancamento_id}")
def excluir_lancamento(lancamento_id: int):
    eid = obter_empresa()
    with sessao_db() as db:
        l = db.query(Lancamento).filter(Lancamento.empresa_id == eid, Lancamento.id == lancamento_id).first()
        if not l:
            raise HTTPException(status_code=404, detail="Lancamento nao encontrado.")
        db.delete(l)
        db.commit()
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
    eid = obter_empresa()
    with sessao_db() as db:
        q = db.query(ContaReceber).filter(ContaReceber.empresa_id == eid)
        if data_inicial:
            q = q.filter(ContaReceber.data_inicio >= data_inicial)
        if data_final:
            q = q.filter(ContaReceber.data_inicio <= data_final)
        if contrato:
            q = q.filter(ContaReceber.contrato.ilike(f"%{contrato.strip()}%"))
        contas = [conta_receber_para_dict(c) for c in q.order_by(ContaReceber.data_inicio.desc()).all()]
    if tomador:
        tm = tomador.strip().lower()
        contas = [c for c in contas if tm in c.get("tomador", "").lower()]
    if veiculo_id:
        contas = [c for c in contas if c.get("veiculo_id") == veiculo_id]
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
    if dados.desconto_classificacao:
        if dados.desconto_classificacao not in listar_classificacoes_ativas():
            raise HTTPException(status_code=400, detail="Classificacao do desconto invalida.")
        if not classificacao_eh_despesa(dados.desconto_classificacao):
            raise HTTPException(status_code=400, detail="Use uma classificacao de despesa para o desconto.")
    eid = obter_empresa()
    extras = {
        "cte_ticket": dados.cte_ticket,
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
    with sessao_db() as db:
        c = ContaReceber(
            empresa_id=eid,
            data_inicio=dados.data_inicio,
            contrato=dados.contrato,
            valor=calcular_valor_base_conta_receber(dados),
            status_pagamento=dados.status_pagamento,
            dados=json.dumps(extras, ensure_ascii=False),
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        return conta_receber_para_dict(c)


@app.put("/contas-receber/{conta_id}")
def atualizar_conta_receber(conta_id: int, dados: ContaReceberIn):
    if dados.desconto_classificacao:
        if dados.desconto_classificacao not in listar_classificacoes_ativas():
            raise HTTPException(status_code=400, detail="Classificacao do desconto invalida.")
        if not classificacao_eh_despesa(dados.desconto_classificacao):
            raise HTTPException(status_code=400, detail="Use uma classificacao de despesa para o desconto.")
    eid = obter_empresa()
    with sessao_db() as db:
        c = db.query(ContaReceber).filter(ContaReceber.empresa_id == eid, ContaReceber.id == conta_id).first()
        if not c:
            raise HTTPException(status_code=404, detail="Conta a receber nao encontrada.")
        extras = {
            "cte_ticket": dados.cte_ticket,
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
            "data_recebimento": str(dados.data_recebimento) if dados.data_recebimento else "",
        }
        c.data_inicio = dados.data_inicio
        c.contrato = dados.contrato
        c.valor = calcular_valor_base_conta_receber(dados)
        c.status_pagamento = dados.status_pagamento
        c.dados = json.dumps(extras, ensure_ascii=False)
        db.commit()
        db.refresh(c)
        return conta_receber_para_dict(c)


@app.patch("/contas-receber/{conta_id}/status")
def alterar_status_conta_receber(conta_id: int, dados: ContaReceberStatusIn):
    eid = obter_empresa()
    with sessao_db() as db:
        c = db.query(ContaReceber).filter(ContaReceber.empresa_id == eid, ContaReceber.id == conta_id).first()
        if not c:
            raise HTTPException(status_code=404, detail="Conta a receber nao encontrada.")
        c.status_pagamento = dados.status_pagamento
        ex = json.loads(c.dados or "{}")
        ex["data_recebimento"] = str(date.today()) if dados.status_pagamento == "recebido" else ""
        c.dados = json.dumps(ex, ensure_ascii=False)
        db.commit()
        db.refresh(c)
        return conta_receber_para_dict(c)


@app.delete("/contas-receber/{conta_id}")
def excluir_conta_receber(conta_id: int):
    eid = obter_empresa()
    with sessao_db() as db:
        c = db.query(ContaReceber).filter(ContaReceber.empresa_id == eid, ContaReceber.id == conta_id).first()
        if not c:
            raise HTTPException(status_code=404, detail="Conta a receber nao encontrada.")
        db.delete(c)
        db.commit()
    return {"mensagem": "Conta a receber excluida com sucesso."}


# =========================================================
# ATIVOS, PASSIVOS E ESTOQUE
# =========================================================

@app.get("/ativos")
def listar_ativos():
    eid = obter_empresa()
    with sessao_db() as db:
        registros = db.query(Ativo).filter(Ativo.empresa_id == eid).order_by(Ativo.nome).all()
        return [ativo_para_dict(a) for a in registros]


@app.post("/ativos")
def criar_ativo(dados: AtivoIn):
    eid = obter_empresa()
    extras = {
        "tipo": dados.tipo,
        "data_aquisicao": str(dados.data_aquisicao) if dados.data_aquisicao else "",
        "veiculo_id": dados.veiculo_id,
        "observacao": dados.observacao,
        "status": dados.status,
    }
    with sessao_db() as db:
        a = Ativo(empresa_id=eid, nome=dados.nome, valor=float(dados.valor or 0),
                  dados=json.dumps(extras, ensure_ascii=False))
        db.add(a)
        db.commit()
        db.refresh(a)
        return ativo_para_dict(a)


@app.put("/ativos/{ativo_id}")
def atualizar_ativo(ativo_id: int, dados: AtivoIn):
    eid = obter_empresa()
    with sessao_db() as db:
        a = db.query(Ativo).filter(Ativo.empresa_id == eid, Ativo.id == ativo_id).first()
        if not a:
            raise HTTPException(status_code=404, detail="Ativo nao encontrado.")
        extras = {
            "tipo": dados.tipo,
            "data_aquisicao": str(dados.data_aquisicao) if dados.data_aquisicao else "",
            "veiculo_id": dados.veiculo_id,
            "observacao": dados.observacao,
            "status": dados.status,
        }
        a.nome = dados.nome
        a.valor = float(dados.valor or 0)
        a.dados = json.dumps(extras, ensure_ascii=False)
        db.commit()
        db.refresh(a)
        return ativo_para_dict(a)


@app.delete("/ativos/{ativo_id}")
def excluir_ativo(ativo_id: int):
    eid = obter_empresa()
    with sessao_db() as db:
        a = db.query(Ativo).filter(Ativo.empresa_id == eid, Ativo.id == ativo_id).first()
        if not a:
            raise HTTPException(status_code=404, detail="Ativo nao encontrado.")
        db.delete(a)
        db.commit()
    return {"mensagem": "Ativo excluido com sucesso."}


@app.get("/passivos")
def listar_passivos():
    eid = obter_empresa()
    with sessao_db() as db:
        registros = db.query(Passivo).filter(Passivo.empresa_id == eid).all()
        result = [passivo_para_dict(p) for p in registros]
        result.sort(key=lambda x: x.get("data_vencimento", ""))
        return result


def _extras_passivo(dados: PassivoIn) -> dict:
    return {
        "tipo": dados.tipo,
        "valor_total": float(dados.valor_total or 0),
        "valor_pago": float(dados.valor_pago or 0),
        "data_inicio": str(dados.data_inicio) if dados.data_inicio else "",
        "data_vencimento": str(dados.data_vencimento) if dados.data_vencimento else "",
        "observacao": dados.observacao,
        "status": dados.status,
    }


@app.post("/passivos")
def criar_passivo(dados: PassivoIn):
    eid = obter_empresa()
    with sessao_db() as db:
        p = Passivo(empresa_id=eid, nome=dados.nome, valor=float(dados.valor_total or 0),
                    dados=json.dumps(_extras_passivo(dados), ensure_ascii=False))
        db.add(p)
        db.commit()
        db.refresh(p)
        return passivo_para_dict(p)


@app.put("/passivos/{passivo_id}")
def atualizar_passivo(passivo_id: int, dados: PassivoIn):
    eid = obter_empresa()
    with sessao_db() as db:
        p = db.query(Passivo).filter(Passivo.empresa_id == eid, Passivo.id == passivo_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="Passivo nao encontrado.")
        p.nome = dados.nome
        p.valor = float(dados.valor_total or 0)
        p.dados = json.dumps(_extras_passivo(dados), ensure_ascii=False)
        db.commit()
        db.refresh(p)
        return passivo_para_dict(p)


@app.delete("/passivos/{passivo_id}")
def excluir_passivo(passivo_id: int):
    eid = obter_empresa()
    with sessao_db() as db:
        p = db.query(Passivo).filter(Passivo.empresa_id == eid, Passivo.id == passivo_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="Passivo nao encontrado.")
        db.delete(p)
        db.commit()
    return {"mensagem": "Passivo excluido com sucesso."}


@app.get("/estoque/produtos")
def listar_produtos_estoque(nome: Optional[str] = None, categoria: Optional[str] = None, estoque_baixo: Optional[bool] = None):
    eid = obter_empresa()
    with sessao_db() as db:
        q = db.query(EstoqueProduto).filter(EstoqueProduto.empresa_id == eid)
        if nome:
            q = q.filter(EstoqueProduto.nome.ilike(f"%{nome}%"))
        if categoria:
            q = q.filter(EstoqueProduto.categoria.ilike(f"%{categoria}%"))
        produtos = [produto_estoque_para_dict(ep) for ep in q.order_by(EstoqueProduto.nome).all()]
    if estoque_baixo is not None:
        produtos = [p for p in produtos if p.get("estoque_baixo") is estoque_baixo]
    return produtos


@app.post("/estoque/produtos")
def criar_produto_estoque(dados: ProdutoEstoqueIn):
    eid = obter_empresa()
    extras = {
        "unidade_medida": dados.unidade_medida,
        "valor_custo": float(dados.valor_custo or 0),
        "estoque_minimo": float(dados.estoque_minimo or 0),
        "observacao": dados.observacao,
    }
    with sessao_db() as db:
        ep = EstoqueProduto(empresa_id=eid, nome=dados.nome, categoria=dados.categoria,
                            quantidade=float(dados.quantidade_atual or 0),
                            dados=json.dumps(extras, ensure_ascii=False))
        db.add(ep)
        db.commit()
        db.refresh(ep)
        return produto_estoque_para_dict(ep)


@app.put("/estoque/produtos/{produto_id}")
def atualizar_produto_estoque(produto_id: int, dados: ProdutoEstoqueIn):
    eid = obter_empresa()
    with sessao_db() as db:
        ep = db.query(EstoqueProduto).filter(EstoqueProduto.empresa_id == eid, EstoqueProduto.id == produto_id).first()
        if not ep:
            raise HTTPException(status_code=404, detail="Produto nao encontrado.")
        ep.nome = dados.nome
        ep.categoria = dados.categoria
        ep.quantidade = float(dados.quantidade_atual or 0)
        ep.dados = json.dumps({
            "unidade_medida": dados.unidade_medida,
            "valor_custo": float(dados.valor_custo or 0),
            "estoque_minimo": float(dados.estoque_minimo or 0),
            "observacao": dados.observacao,
        }, ensure_ascii=False)
        db.commit()
        db.refresh(ep)
        return produto_estoque_para_dict(ep)


@app.delete("/estoque/produtos/{produto_id}")
def excluir_produto_estoque(produto_id: int):
    eid = obter_empresa()
    with sessao_db() as db:
        ep = db.query(EstoqueProduto).filter(EstoqueProduto.empresa_id == eid, EstoqueProduto.id == produto_id).first()
        if not ep:
            raise HTTPException(status_code=404, detail="Produto nao encontrado.")
        db.delete(ep)
        db.commit()
    return {"mensagem": "Produto excluido com sucesso."}


@app.get("/estoque/movimentacoes")
def listar_movimentacoes_estoque(produto_id: Optional[int] = None):
    eid = obter_empresa()
    with sessao_db() as db:
        q = db.query(EstoqueMovimentacao).filter(EstoqueMovimentacao.empresa_id == eid)
        if produto_id:
            q = q.filter(EstoqueMovimentacao.produto_id == produto_id)
        movs = [movimentacao_para_dict(m) for m in q.all()]
    movs.sort(key=lambda x: x.get("data", ""), reverse=True)
    return movs


@app.post("/estoque/movimentacoes")
def criar_movimentacao_estoque(dados: MovimentacaoEstoqueIn):
    eid = obter_empresa()
    with sessao_db() as db:
        ep = db.query(EstoqueProduto).filter(EstoqueProduto.empresa_id == eid, EstoqueProduto.id == dados.produto_id).first()
        if not ep:
            raise HTTPException(status_code=404, detail="Produto nao encontrado.")
        quantidade = float(dados.quantidade or 0)
        atual = float(ep.quantidade or 0)
        if dados.tipo_movimentacao == "Entrada":
            ep.quantidade = atual + quantidade
        elif dados.tipo_movimentacao == "Saida":
            if quantidade > atual:
                raise HTTPException(status_code=400, detail="Saida maior que o estoque disponivel.")
            ep.quantidade = atual - quantidade
        else:
            ep.quantidade = quantidade
        ex_prod = json.loads(ep.dados or "{}")
        if dados.valor_unitario:
            ex_prod["valor_custo"] = float(dados.valor_unitario)
            ep.dados = json.dumps(ex_prod, ensure_ascii=False)
        extras = {"valor_unitario": float(dados.valor_unitario or 0), "data": str(dados.data), "observacao": dados.observacao}
        mov = EstoqueMovimentacao(empresa_id=eid, produto_id=dados.produto_id,
                                  tipo=dados.tipo_movimentacao, quantidade=quantidade,
                                  dados=json.dumps(extras, ensure_ascii=False))
        db.add(mov)
        db.commit()
        db.refresh(mov)
        return movimentacao_para_dict(mov)


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
    eid = obter_empresa()
    with sessao_db() as db:
        registros = db.query(Passivo).filter(Passivo.empresa_id == eid).all()
        contas = [passivo_para_dict(p) for p in registros]
    total = sum(float(item.get("valor") or 0) for item in contas)
    pendente = sum(float(item.get("valor") or 0) for item in contas if item.get("status", "Pendente") != "Pago")
    pago = sum(float(item.get("valor") or 0) for item in contas if item.get("status") == "Pago")
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
    eid = obter_empresa()
    with sessao_db() as db:
        registros = db.query(Veiculo).filter(Veiculo.empresa_id == eid).order_by(Veiculo.nome).all()
        return [veiculo_para_dict(v) for v in registros]


@app.post("/veiculos")
def criar_veiculo(dados: VeiculoIn):
    eid = obter_empresa()
    placa = dados.placa.strip().upper()
    with sessao_db() as db:
        if placa and db.query(Veiculo).filter(Veiculo.empresa_id == eid, Veiculo.placa == placa).first():
            raise HTTPException(status_code=400, detail="Ja existe um veiculo com esta placa.")
        v = Veiculo(empresa_id=eid, nome=dados.nome, marca=dados.marca, modelo=dados.modelo,
                    ano=dados.ano, placa=placa, tipo=dados.tipo, status=dados.status,
                    observacao=dados.observacao, foto=dados.foto)
        db.add(v)
        db.commit()
        db.refresh(v)
        return veiculo_para_dict(v)


@app.put("/veiculos/{veiculo_id}")
def atualizar_veiculo(veiculo_id: int, dados: VeiculoIn):
    eid = obter_empresa()
    placa = dados.placa.strip().upper()
    with sessao_db() as db:
        veiculo = db.query(Veiculo).filter(Veiculo.empresa_id == eid, Veiculo.id == veiculo_id).first()

        if not veiculo:
            raise HTTPException(status_code=404, detail="Veiculo nao encontrado.")
        if placa and db.query(Veiculo).filter(Veiculo.empresa_id == eid, Veiculo.id != veiculo_id, Veiculo.placa == placa).first():
            raise HTTPException(status_code=400, detail="Ja existe outro veiculo com esta placa.")
        veiculo.nome = dados.nome
        veiculo.marca = dados.marca
        veiculo.modelo = dados.modelo
        veiculo.ano = dados.ano
        veiculo.placa = placa
        veiculo.tipo = dados.tipo
        veiculo.status = dados.status
        veiculo.observacao = dados.observacao
        veiculo.foto = dados.foto
        db.commit()
        db.refresh(veiculo)
        return veiculo_para_dict(veiculo)


@app.delete("/veiculos/{veiculo_id}")
def excluir_veiculo(veiculo_id: int):
    eid = obter_empresa()
    with sessao_db() as db:
        v = db.query(Veiculo).filter(Veiculo.empresa_id == eid, Veiculo.id == veiculo_id).first()
        if not v:
            raise HTTPException(status_code=404, detail="Veiculo nao encontrado.")
        db.delete(v)
        db.commit()
    return {"mensagem": "Veiculo excluido com sucesso."}


def _extras_motorista(dados: MotoristaIn) -> dict:
    return {
        "lotacao": dados.lotacao, "pis": dados.pis, "banco": dados.banco,
        "agencia": dados.agencia, "conta": dados.conta, "tipo_conta": dados.tipo_conta,
        "empregador": dados.empregador, "empregador_cnpj": dados.empregador_cnpj,
        "salario_base": dados.salario_base, "carga_horaria_mensal": dados.carga_horaria_mensal,
        "valor_hora_extra": dados.valor_hora_extra, "inss_percentual": dados.inss_percentual,
        "irrf_percentual": dados.irrf_percentual, "vale_refeicao": dados.vale_refeicao,
        "convenio_medico": dados.convenio_medico, "outros_descontos_padrao": dados.outros_descontos_padrao,
    }


@app.get("/motoristas")
def listar_motoristas():
    eid = obter_empresa()
    with sessao_db() as db:
        registros = db.query(Motorista).filter(Motorista.empresa_id == eid).order_by(Motorista.nome).all()
        return [motorista_para_dict(m) for m in registros]


@app.post("/motoristas")
def criar_motorista(dados: MotoristaIn):
    eid = obter_empresa()
    with sessao_db() as db:
        m = Motorista(empresa_id=eid, nome=dados.nome, telefone=dados.telefone,
                      cnh=dados.cnh, cargo=dados.cargo,
                      admissao=dados.admissao or None,
                      dados=json.dumps(_extras_motorista(dados), ensure_ascii=False))
        db.add(m)
        db.commit()
        db.refresh(m)
        return motorista_para_dict(m)


@app.put("/motoristas/{motorista_id}")
def atualizar_motorista(motorista_id: int, dados: MotoristaIn):
    eid = obter_empresa()
    with sessao_db() as db:
        m = db.query(Motorista).filter(Motorista.empresa_id == eid, Motorista.id == motorista_id).first()
        if not m:
            raise HTTPException(status_code=404, detail="Motorista nao encontrado.")
        m.nome = dados.nome
        m.telefone = dados.telefone
        m.cnh = dados.cnh
        m.cargo = dados.cargo
        m.admissao = dados.admissao or None
        m.dados = json.dumps(_extras_motorista(dados), ensure_ascii=False)
        db.commit()
        db.refresh(m)
        return motorista_para_dict(m)


@app.delete("/motoristas/{motorista_id}")
def excluir_motorista(motorista_id: int):
    eid = obter_empresa()
    with sessao_db() as db:
        m = db.query(Motorista).filter(Motorista.empresa_id == eid, Motorista.id == motorista_id).first()
        if not m:
            raise HTTPException(status_code=404, detail="Motorista nao encontrado.")
        db.delete(m)
        db.commit()
    return {"mensagem": "Motorista excluido com sucesso."}


def posicao_inicial_motorista(motorista_id: int) -> tuple[float, float]:
    base_lat = -23.55052
    base_lng = -46.63331
    angulo = motorista_id * 1.37
    raio = 0.018 + (motorista_id % 5) * 0.006
    return (
        round(base_lat + math.sin(angulo) * raio, 6),
        round(base_lng + math.cos(angulo) * raio, 6),
    )


def normalizar_localizacao_motorista(motorista: dict, localizacao: dict | None) -> dict:
    if not localizacao:
        latitude, longitude = posicao_inicial_motorista(int(motorista.get("id") or 0))
        localizacao = {
            "motorista_id": motorista.get("id"),
            "latitude": latitude,
            "longitude": longitude,
            "velocidade": 0,
            "direcao": 0,
            "precisao": 0,
            "bateria": None,
            "updated_at": agora_iso(),
            "origem": "simulado",
        }
    minutos = minutos_desde_iso(localizacao.get("updated_at", ""))
    return {
        "motorista_id": motorista.get("id"),
        "motorista_nome": motorista.get("nome", "Motorista"),
        "telefone": motorista.get("telefone", ""),
        "cargo": motorista.get("cargo", ""),
        "latitude": float(localizacao.get("latitude") or 0),
        "longitude": float(localizacao.get("longitude") or 0),
        "velocidade": float(localizacao.get("velocidade") or 0),
        "direcao": float(localizacao.get("direcao") or 0),
        "precisao": float(localizacao.get("precisao") or 0),
        "bateria": localizacao.get("bateria"),
        "updated_at": localizacao.get("updated_at", ""),
        "origem": localizacao.get("origem", "gps"),
        "online": minutos <= 5,
        "minutos_sem_sinal": round(minutos, 1),
    }


@app.get("/localizacoes-motoristas")
def listar_localizacoes_motoristas():
    eid = obter_empresa()
    with sessao_db() as db:
        motoristas = [motorista_para_dict(m) for m in db.query(Motorista).filter(Motorista.empresa_id == eid).order_by(Motorista.nome).all()]
    localizacoes = ler_json_loc(ARQUIVO_LOCALIZACOES_MOTORISTAS)
    por_motorista = {item.get("motorista_id"): item for item in localizacoes}
    alterou = False

    itens = []
    for motorista in motoristas:
        localizacao = por_motorista.get(motorista.get("id"))
        item = normalizar_localizacao_motorista(motorista, localizacao)
        itens.append(item)
        if not localizacao:
            localizacoes.append({k: item[k] for k in ("motorista_id", "latitude", "longitude", "velocidade", "direcao", "precisao", "bateria", "updated_at", "origem")})
            alterou = True

    if alterou:
        salvar_json_loc(ARQUIVO_LOCALIZACOES_MOTORISTAS, localizacoes)

    return {
        "atualizado_em": agora_iso(),
        "total": len(itens),
        "online": len([item for item in itens if item["online"]]),
        "itens": itens,
    }


@app.post("/localizacoes-motoristas")
def registrar_localizacao_motorista(dados: LocalizacaoMotoristaIn):
    eid = obter_empresa()
    with sessao_db() as db:
        m = db.query(Motorista).filter(Motorista.empresa_id == eid, Motorista.id == dados.motorista_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Motorista nao encontrado.")
    motorista = motorista_para_dict(m)

    localizacoes = ler_json_loc(ARQUIVO_LOCALIZACOES_MOTORISTAS)
    localizacao = next((item for item in localizacoes if item.get("motorista_id") == dados.motorista_id), None)
    if not localizacao:
        localizacao = {"motorista_id": dados.motorista_id}
        localizacoes.append(localizacao)

    localizacao.update({
        "motorista_id": dados.motorista_id,
        "latitude": round(float(dados.latitude), 6),
        "longitude": round(float(dados.longitude), 6),
        "velocidade": round(float(dados.velocidade or 0), 1),
        "direcao": round(float(dados.direcao or 0), 1) % 360,
        "precisao": round(float(dados.precisao or 0), 1),
        "bateria": dados.bateria,
        "updated_at": agora_iso(),
        "origem": "gps",
    })
    salvar_json_loc(ARQUIVO_LOCALIZACOES_MOTORISTAS, localizacoes)
    return normalizar_localizacao_motorista(motorista, localizacao)


@app.post("/localizacoes-motoristas/simular")
def simular_localizacoes_motoristas():
    eid = obter_empresa()
    with sessao_db() as db:
        motoristas = [motorista_para_dict(m) for m in db.query(Motorista).filter(Motorista.empresa_id == eid).all()]
    localizacoes = ler_json_loc(ARQUIVO_LOCALIZACOES_MOTORISTAS)
    por_motorista = {item.get("motorista_id"): item for item in localizacoes}
    agora = agora_iso()

    for motorista in motoristas:
        motorista_id = int(motorista.get("id") or 0)
        localizacao = por_motorista.get(motorista_id)
        if not localizacao:
            latitude, longitude = posicao_inicial_motorista(motorista_id)
            localizacao = {"motorista_id": motorista_id, "latitude": latitude, "longitude": longitude}
            localizacoes.append(localizacao)

        passo = 0.0014 + (motorista_id % 3) * 0.00035
        direcao = (float(localizacao.get("direcao") or motorista_id * 43) + 18 + motorista_id) % 360
        radianos = math.radians(direcao)
        localizacao.update({
            "latitude": round(float(localizacao.get("latitude") or 0) + math.cos(radianos) * passo, 6),
            "longitude": round(float(localizacao.get("longitude") or 0) + math.sin(radianos) * passo, 6),
            "velocidade": 28 + (motorista_id % 6) * 7,
            "direcao": round(direcao, 1),
            "precisao": 12,
            "bateria": max(20, 96 - motorista_id * 3),
            "updated_at": agora,
            "origem": "simulado",
        })

    salvar_json_loc(ARQUIVO_LOCALIZACOES_MOTORISTAS, localizacoes)
    return listar_localizacoes_motoristas()


def empresas_com_motoristas_mobile() -> list[int]:
    with sessao_db() as db:
        from sqlalchemy import distinct
        ids = [row[0] for row in db.query(distinct(Motorista.empresa_id)).order_by(Motorista.empresa_id).all()]
    return ids if ids else [1]


def ler_motoristas_da_empresa_mobile(empresa_id: int) -> list[dict]:
    with sessao_db() as db:
        registros = db.query(Motorista).filter(Motorista.empresa_id == empresa_id).order_by(Motorista.nome).all()
        return [motorista_para_dict(m) for m in registros]


def localizar_motorista_mobile(empresa_id: int | None = None, motorista_id: int | None = None) -> tuple[int, dict]:
    empresas_ids = [empresa_id] if empresa_id else empresas_com_motoristas_mobile()
    for empresa_atual in empresas_ids:
        if not empresa_atual:
            continue
        motoristas = ler_motoristas_da_empresa_mobile(int(empresa_atual))
        if not motoristas:
            continue
        if motorista_id:
            motorista = next((m for m in motoristas if m.get("id") == motorista_id), None)
            if motorista:
                return int(empresa_atual), motorista
            continue
        return int(empresa_atual), motoristas[0]
    raise HTTPException(status_code=404, detail="Nenhum motorista cadastrado para rastreamento.")


def dados_token_motorista_mobile(token: str) -> tuple[int, int]:
    partes = token.split(":")
    if len(partes) == 3 and partes[0] == "teste":
        return int(partes[1]), int(partes[2])
    if len(partes) == 2 and partes[0] == "teste":
        return 1, int(partes[1])
    raise HTTPException(status_code=401, detail="Sessao do motorista invalida.")


@app.post("/motorista-mobile/login")
def login_motorista_mobile(dados: MotoristaMobileLoginIn):
    if dados.usuario.strip() != "teste" or dados.senha.strip() != "teste":
        raise HTTPException(status_code=401, detail="Usuario ou senha invalidos.")

    empresa_id, motorista = localizar_motorista_mobile(dados.empresa_id, dados.motorista_id)
    motorista_id = int(motorista.get("id") or 0)
    return {
        "token": f"teste:{empresa_id}:{motorista_id}",
        "empresa_id": empresa_id,
        "motorista_id": motorista_id,
        "motorista_nome": motorista.get("nome", "Motorista"),
    }


@app.post("/motorista-mobile/localizacao")
def registrar_localizacao_motorista_mobile(dados: LocalizacaoMotoristaMobileIn):
    empresa_id_token, motorista_id_token = dados_token_motorista_mobile(dados.token)
    empresa_id = int(dados.empresa_id or empresa_id_token)
    if empresa_id != empresa_id_token or int(dados.motorista_id) != motorista_id_token:
        raise HTTPException(status_code=401, detail="Sessao do motorista invalida.")

    token_empresa = None
    if empresa_id != 1:
        token_empresa = EMPRESA_ATUAL_ID.set(empresa_id)
    try:
        with sessao_db() as db:
            m = db.query(Motorista).filter(Motorista.empresa_id == empresa_id, Motorista.id == dados.motorista_id).first()
        if not m:
            raise HTTPException(status_code=404, detail="Motorista nao encontrado.")
        motorista = motorista_para_dict(m)

        localizacoes = ler_json_loc(ARQUIVO_LOCALIZACOES_MOTORISTAS)
        localizacao = next((item for item in localizacoes if item.get("motorista_id") == dados.motorista_id), None)
        if not localizacao:
            localizacao = {"motorista_id": dados.motorista_id}
            localizacoes.append(localizacao)

        localizacao.update({
            "motorista_id": dados.motorista_id,
            "latitude": round(float(dados.latitude), 6),
            "longitude": round(float(dados.longitude), 6),
            "velocidade": round(float(dados.velocidade or 0), 1),
            "direcao": round(float(dados.direcao or 0), 1) % 360,
            "precisao": round(float(dados.precisao or 0), 1),
            "bateria": dados.bateria,
            "updated_at": agora_iso(),
            "origem": "mobile",
        })
        salvar_json_loc(ARQUIVO_LOCALIZACOES_MOTORISTAS, localizacoes)
        return normalizar_localizacao_motorista(motorista, localizacao)
    finally:
        if token_empresa is not None:
            EMPRESA_ATUAL_ID.reset(token_empresa)


# =========================================================
# FOLHA DE PAGAMENTO
# =========================================================

@app.get("/folha-pagamento")
def listar_folhas_pagamento():
    folhas = ler_json_folha()
    folhas.sort(key=lambda x: x.get("data_pagamento", ""), reverse=True)
    return folhas


@app.post("/folha-pagamento")
def criar_folha_pagamento(dados: FolhaPagamentoIn):
    if not dados.itens:
        raise HTTPException(status_code=400, detail="Inclua ao menos um motorista na folha.")

    eid = obter_empresa()
    with sessao_db() as db:
        motoristas_db = {m.id: motorista_para_dict(m) for m in db.query(Motorista).filter(Motorista.empresa_id == eid).all()}

    folhas = ler_json_folha()
    timestamp = agora_iso()
    itens_calculados = []

    for item in dados.itens:
        motorista = motoristas_db.get(item.motorista_id)
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
        "id": proximo_id_lista(folhas),
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
        extras = json.dumps({
            "veiculo_id": None,
            "empresa_id": None,
            "obra_servico": "",
            "kilometragem": None,
            "litros": None,
            "numero_nf": "",
            "data_nf": "",
            "origem": "folha_pagamento",
            "folha_pagamento_id": nova_folha["id"],
        }, ensure_ascii=False)
        with sessao_db() as db:
            lan = Lancamento(
                empresa_id=eid,
                data=str(dados.data_pagamento),
                classificacao="1.5 SALARIO + ENCAGOS FOLHA PGTO",
                descricao=f"{nova_folha['descricao']} - {dados.periodo}",
                valor=totais["salario_liquido"],
                tipo_financeiro="custo",
                dados=extras,
            )
            db.add(lan)
            db.commit()
            db.refresh(lan)
            nova_folha["lancamento_id"] = lan.id

    folhas.append(nova_folha)
    salvar_json_folha(folhas)
    return nova_folha


@app.delete("/folha-pagamento/{folha_id}")
def excluir_folha_pagamento(folha_id: int):
    folhas = ler_json_folha()
    folha = buscar_id_lista(folhas, folha_id)

    if not folha:
        raise HTTPException(status_code=404, detail="Folha de pagamento nao encontrada.")

    folhas = [item for item in folhas if item.get("id") != folha_id]
    salvar_json_folha(folhas)

    lancamento_id = folha.get("lancamento_id")
    if lancamento_id:
        eid = obter_empresa()
        with sessao_db() as db:
            lan = db.query(Lancamento).filter(Lancamento.empresa_id == eid, Lancamento.id == lancamento_id).first()
            if lan:
                db.delete(lan)
                db.commit()

    return {"mensagem": "Folha de pagamento excluida com sucesso."}


# =========================================================
# MOTORISTA APP
# =========================================================

def _obter_motorista_acesso(request: Request, db) -> MotoristaAcesso:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Autenticacao obrigatoria.")
    token = auth.removeprefix("Bearer ").strip()
    try:
        payload = decodificar_motorista_token(token)
        acesso = db.get(MotoristaAcesso, int(payload.get("sub")))
        if not acesso or not acesso.ativo:
            raise HTTPException(status_code=401, detail="Acesso inativo ou inexistente.")
        return acesso
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token invalido.")


@app.post("/motorista-app/login")
def motorista_login(dados: dict, request: Request):
    email = (dados.get("email") or "").strip().lower()
    senha = dados.get("senha") or ""
    if not email or not senha:
        raise HTTPException(status_code=400, detail="Email e senha obrigatorios.")
    with sessao_db() as db:
        acesso = db.query(MotoristaAcesso).filter(MotoristaAcesso.email == email).first()
        if not acesso or not acesso.ativo:
            raise HTTPException(status_code=401, detail="Credenciais invalidas.")
        from backend.security import verificar_senha as _ver
        if not _ver(senha, acesso.senha_hash):
            raise HTTPException(status_code=401, detail="Credenciais invalidas.")
        token = criar_motorista_token(acesso.id, acesso.empresa_id)
        motorista = db.get(Motorista, acesso.motorista_id) if acesso.motorista_id else None
        return {
            "access_token": token,
            "nome": acesso.nome,
            "motorista_id": acesso.motorista_id,
            "cnh": motorista.cnh if motorista else "",
            "telefone": motorista.telefone if motorista else "",
        }


@app.get("/motorista-app/me")
def motorista_me(request: Request):
    with sessao_db() as db:
        acesso = _obter_motorista_acesso(request, db)
        motorista = db.get(Motorista, acesso.motorista_id) if acesso.motorista_id else None
        viagem_ativa = db.query(Viagem).filter(
            Viagem.motorista_acesso_id == acesso.id,
            Viagem.status == "em_andamento"
        ).first()
        return {
            "id": acesso.id,
            "nome": acesso.nome,
            "email": acesso.email,
            "motorista_id": acesso.motorista_id,
            "cnh": motorista.cnh if motorista else "",
            "telefone": motorista.telefone if motorista else "",
            "cargo": motorista.cargo if motorista else "",
            "viagem_ativa": {
                "id": viagem_ativa.id,
                "origem": viagem_ativa.origem,
                "destino": viagem_ativa.destino,
                "carga": viagem_ativa.carga,
                "km_inicial": viagem_ativa.km_inicial,
                "data_inicio": viagem_ativa.data_inicio.isoformat(),
                "status": viagem_ativa.status,
            } if viagem_ativa else None,
        }


@app.post("/motorista-app/viagem/iniciar")
def iniciar_viagem(dados: dict, request: Request):
    with sessao_db() as db:
        acesso = _obter_motorista_acesso(request, db)
        existente = db.query(Viagem).filter(
            Viagem.motorista_acesso_id == acesso.id,
            Viagem.status == "em_andamento"
        ).first()
        if existente:
            raise HTTPException(status_code=400, detail="Ja existe uma viagem em andamento.")
        viagem = Viagem(
            empresa_id=acesso.empresa_id,
            motorista_acesso_id=acesso.id,
            veiculo_id=int(dados["veiculo_id"]) if dados.get("veiculo_id") else None,
            origem=(dados.get("origem") or "").strip(),
            destino=(dados.get("destino") or "").strip(),
            carga=(dados.get("carga") or "").strip(),
            km_inicial=float(dados["km_inicial"]) if dados.get("km_inicial") else None,
            observacao=(dados.get("observacao") or "").strip(),
            status="em_andamento",
            rota="[]",
        )
        db.add(viagem)
        db.commit()
        db.refresh(viagem)
        return {"id": viagem.id, "status": viagem.status, "data_inicio": viagem.data_inicio.isoformat()}


@app.put("/motorista-app/viagem/{viagem_id}/finalizar")
def finalizar_viagem(viagem_id: int, dados: dict, request: Request):
    with sessao_db() as db:
        acesso = _obter_motorista_acesso(request, db)
        viagem = db.query(Viagem).filter(
            Viagem.id == viagem_id,
            Viagem.motorista_acesso_id == acesso.id
        ).first()
        if not viagem:
            raise HTTPException(status_code=404, detail="Viagem nao encontrada.")
        if viagem.status != "em_andamento":
            raise HTTPException(status_code=400, detail="Viagem nao esta em andamento.")
        from datetime import datetime, timezone
        viagem.km_final = float(dados["km_final"]) if dados.get("km_final") else None
        viagem.observacao = (dados.get("observacao") or viagem.observacao)
        viagem.status = "finalizada"
        viagem.data_fim = datetime.now(timezone.utc)
        db.commit()
        km_total = (viagem.km_final or 0) - (viagem.km_inicial or 0)
        return {"id": viagem.id, "status": viagem.status, "km_total": round(km_total, 1)}


@app.post("/motorista-app/viagem/{viagem_id}/ponto")
def adicionar_ponto_rota(viagem_id: int, dados: dict, request: Request):
    with sessao_db() as db:
        acesso = _obter_motorista_acesso(request, db)
        viagem = db.query(Viagem).filter(
            Viagem.id == viagem_id,
            Viagem.motorista_acesso_id == acesso.id,
            Viagem.status == "em_andamento"
        ).first()
        if not viagem:
            raise HTTPException(status_code=404, detail="Viagem ativa nao encontrada.")
        try:
            rota = json.loads(viagem.rota or "[]")
        except Exception:
            rota = []
        rota.append({
            "lat": float(dados.get("lat", 0)),
            "lng": float(dados.get("lng", 0)),
            "velocidade": float(dados.get("velocidade") or 0),
            "ts": dados.get("ts", ""),
        })
        viagem.rota = json.dumps(rota)
        db.commit()
        return {"pontos": len(rota)}


@app.post("/motorista-app/localizacao")
def atualizar_localizacao_motorista(dados: dict, request: Request):
    with sessao_db() as db:
        acesso = _obter_motorista_acesso(request, db)
        from datetime import datetime, timezone
        loc = db.query(MotoristaLocalizacao).filter(
            MotoristaLocalizacao.motorista_acesso_id == acesso.id
        ).first()
        viagem_ativa = db.query(Viagem).filter(
            Viagem.motorista_acesso_id == acesso.id,
            Viagem.status == "em_andamento"
        ).first()
        if loc:
            loc.lat = float(dados.get("lat", 0))
            loc.lng = float(dados.get("lng", 0))
            loc.velocidade = float(dados.get("velocidade") or 0)
            loc.heading = float(dados.get("heading") or 0)
            loc.viagem_id = viagem_ativa.id if viagem_ativa else None
            loc.nome = acesso.nome
            loc.timestamp = datetime.now(timezone.utc)
        else:
            loc = MotoristaLocalizacao(
                empresa_id=acesso.empresa_id,
                motorista_acesso_id=acesso.id,
                nome=acesso.nome,
                lat=float(dados.get("lat", 0)),
                lng=float(dados.get("lng", 0)),
                velocidade=float(dados.get("velocidade") or 0),
                heading=float(dados.get("heading") or 0),
                viagem_id=viagem_ativa.id if viagem_ativa else None,
            )
            db.add(loc)
        db.commit()
        return {"ok": True}


@app.get("/motorista-app/viagens")
def listar_viagens_motorista(request: Request):
    with sessao_db() as db:
        acesso = _obter_motorista_acesso(request, db)
        viagens = db.query(Viagem).filter(
            Viagem.motorista_acesso_id == acesso.id
        ).order_by(Viagem.data_inicio.desc()).limit(50).all()
        return [
            {
                "id": v.id,
                "origem": v.origem,
                "destino": v.destino,
                "carga": v.carga,
                "km_inicial": v.km_inicial,
                "km_final": v.km_final,
                "km_total": round((v.km_final or 0) - (v.km_inicial or 0), 1) if v.km_final and v.km_inicial else None,
                "data_inicio": v.data_inicio.isoformat(),
                "data_fim": v.data_fim.isoformat() if v.data_fim else None,
                "status": v.status,
                "observacao": v.observacao,
            }
            for v in viagens
        ]


# =========================================================
# MAPA — localizacoes em tempo real (app financeiro)
# =========================================================

@app.get("/mapa/motoristas")
def mapa_motoristas():
    eid = obter_empresa()
    with sessao_db() as db:
        locs = db.query(MotoristaLocalizacao).filter(
            MotoristaLocalizacao.empresa_id == eid
        ).all()
        from datetime import datetime, timezone
        agora = datetime.now(timezone.utc)
        result = []
        for loc in locs:
            acesso = db.get(MotoristaAcesso, loc.motorista_acesso_id)
            delta = (agora - loc.timestamp.replace(tzinfo=timezone.utc) if loc.timestamp.tzinfo is None else agora - loc.timestamp)
            minutos = delta.total_seconds() / 60
            viagem = db.get(Viagem, loc.viagem_id) if loc.viagem_id else None
            result.append({
                "motorista_acesso_id": loc.motorista_acesso_id,
                "nome": loc.nome or (acesso.nome if acesso else ""),
                "lat": loc.lat,
                "lng": loc.lng,
                "velocidade": loc.velocidade or 0,
                "heading": loc.heading or 0,
                "online": minutos <= 5,
                "minutos_sem_sinal": round(minutos, 1),
                "viagem": {
                    "id": viagem.id,
                    "origem": viagem.origem,
                    "destino": viagem.destino,
                    "status": viagem.status,
                } if viagem else None,
            })
        return result
