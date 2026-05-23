"""
===============================================================================
main.py — API PRINCIPAL DO SISTEMA FINANCEIRO PARA TRANSPORTADORAS
===============================================================================

VISÃO GERAL
-----------
Este é o arquivo central do backend. Ele define todos os endpoints HTTP,
middlewares, helpers e lógica de negócio do sistema financeiro.

TECNOLOGIAS
-----------
  - Framework web : FastAPI (assíncrono, documentação OpenAPI automática)
  - ORM           : SQLAlchemy (PostgreSQL em produção, SQLite em dev)
  - Autenticação  : JWT via middleware HTTP (vide backend/auth.py e backend/security.py)
  - Multitenancy  : todos os dados são filtrados por empresa_id em cada query
  - Validação     : Pydantic v2 (schemas de entrada com validação automática)

ARQUITETURA MULTITENANCY
------------------------
  Cada empresa (transportadora) possui seus próprios dados isolados.
  O campo empresa_id presente em todos os modelos garante isso.
  O middleware `aplicar_seguranca` extrai o empresa_id do token JWT
  e o armazena em uma ContextVar (EMPRESA_ATUAL_ID) disponível para
  todos os helpers durante o processamento do request.

CAMPO "dados" (Text/JSON)
-------------------------
  Vários modelos (Lancamento, ContaReceber, Ativo, Passivo, Motorista, etc.)
  possuem um campo `dados` do tipo Text que armazena JSON arbitrário.
  Isso permite adicionar novos campos ao modelo sem alterar o schema do banco.
  O padrão de leitura é: ex = json.loads(model.dados or "{}").

FLUXO DE AUTENTICAÇÃO
---------------------
  Usuários administrativos:
    - Login via POST /auth/login → token JWT "access"
    - Middleware aplica_seguranca valida o token em ROTAS_PROTEGIDAS
    - Perfis disponíveis: master, admin, gestor, financeiro, operador, visualizador
    - Perfil "master" acessa apenas o painel de gerenciamento de empresas

  Motoristas (app mobile):
    - Login via POST /motorista-app/login → token JWT "motorista_access"
    - Validação manual em cada endpoint via _obter_motorista_acesso()
    - Endpoints em /motorista-app/* NÃO estão em ROTAS_PROTEGIDAS

MÓDULOS/DOMÍNIOS COBERTOS
--------------------------
  1.  Classificações e Plano de Contas personalizável por empresa
  2.  Lançamentos financeiros (com vínculo opcional ao estoque)
  3.  Contas a Receber (fretes, horas de máquina, bonificações)
  4.  Ativos e Passivos (patrimônio líquido)
  5.  Estoque (produtos, movimentações, saídas vinculadas a lançamentos)
  6.  Veículos da frota
  7.  Motoristas (cadastro + dados trabalhistas)
  8.  Folha de Pagamento com cálculo automático de INSS (tabela 2026)
  9.  Localizações de motoristas via JSON (legacy) e via banco (app mobile)
  10. Relatórios financeiros (resumo, por período, veículo, classificação)
  11. Exportação de relatórios em PDF (geração manual) e Excel (OOXML)
  12. App mobile PWA para motoristas (viagens, pontos GPS, histórico)
  13. Mapa ao vivo das posições dos motoristas (consumido pelo painel)

INICIALIZAÇÃO
-------------
  uvicorn main:app --host 0.0.0.0 --port 8001 --reload

VARIÁVEIS DE AMBIENTE NECESSÁRIAS
----------------------------------
  DATABASE_URL   — ex: postgresql+psycopg://user:pass@host/db
  JWT_SECRET_KEY — chave secreta para assinar e validar tokens JWT
  CORS_ORIGINS   — origens permitidas no CORS (separadas por vírgula)
===============================================================================
"""

# =========================================================
# IMPORTS E CONFIGURAÇÃO INICIAL
# =========================================================
# Bibliotecas da stdlib Python usadas ao longo do arquivo.
from pathlib import Path
from typing import Optional
from datetime import date, datetime
from contextvars import ContextVar   # usada para armazenar empresa_id por request
from contextlib import contextmanager
import io
import json
import math
import unicodedata
import zipfile
from xml.sax.saxutils import escape  # escapa strings para XML (relatório Excel)

# FastAPI: framework web assíncrono e seus utilitários de resposta/exceção.
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

# Pydantic v2: validação e serialização dos dados recebidos do frontend.
from pydantic import BaseModel, Field, field_validator

# Routers externos — auth e admin são definidos em módulos separados
# e montados nesta aplicação para manter o código organizado.
from backend.admin_routes import router as admin_router       # gerenciamento de empresas (perfil master)
from backend.auth import router as auth_router                # login/logout de usuários administrativos
from backend.landing_routes import router as landing_router   # landing page institucional GM7

# Camada de banco de dados: engine SQLAlchemy, sessão, modelos ORM e migração runtime.
from backend.database import Base, SessionLocal, engine, garantir_colunas_runtime
from backend.dependencies import usuario_pode_escrever    # helper de permissão por domínio

# Modelos ORM — mapeados para tabelas do PostgreSQL via SQLAlchemy declarativo.
from backend.models import (
    Ativo,
    ContaReceber,
    EstoqueMovimentacao,
    EstoqueProduto,
    Lancamento,
    Motorista,
    MotoristaAcesso,      # credenciais de acesso ao app mobile
    MotoristaLocalizacao, # posição GPS em tempo real (tabela com um registro por motorista)
    Passivo,
    PlanoConta,
    Usuario,
    Veiculo,
    Viagem,               # viagens registradas pelo app mobile do motorista
)

# Funções de segurança: criação/decodificação de tokens JWT e hash de senha.
# Existem dois tipos de token:
#   - "access"          → usuários administrativos (decodificar_token)
#   - "motorista_access"→ motoristas no app mobile (decodificar_motorista_token)
from backend.security import criar_motorista_token, decodificar_motorista_token, decodificar_token, gerar_hash_senha, verificar_senha

# Configurações centralizadas (DATABASE_URL, JWT_SECRET_KEY, CORS_ORIGINS, etc.)
from backend.settings import settings

# =========================================================
# CRIAÇÃO DA INSTÂNCIA DO FASTAPI
# =========================================================
# Em produção a documentação interativa (/docs e /redoc) é desabilitada
# para não expor a estrutura da API publicamente.
app = FastAPI(
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
)

# =========================================================
# CORS — Cross-Origin Resource Sharing
# =========================================================
# Permite que o frontend (SPA Electron/browser) se comunique com a API
# mesmo estando em origens diferentes (ex: file:// ou localhost:3000).
# allow_credentials=False é necessário quando allow_origins usa "*";
# credenciais (cookies/Authorization) são passadas via header explícito.
# As origens permitidas são configuradas em CORS_ORIGINS (settings.py).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# MIDDLEWARE DE SEGURANÇA — ROTAS E DOMÍNIOS PROTEGIDOS
# =========================================================

# Prefixos de rotas que exigem token JWT de usuário administrativo.
# Qualquer path que comece com um desses prefixos será interceptado
# pelo middleware `aplicar_seguranca` abaixo.
# Rotas públicas (login, app mobile, arquivos estáticos) ficam FORA desta lista.
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

# Mapeamento de prefixo de rota para nome de "domínio" de permissão.
# Usado pelo middleware para verificar se o perfil do usuário pode
# escrever (POST/PUT/DELETE) naquele domínio específico.
# A função usuario_pode_escrever() em backend/dependencies.py consulta
# este nome para checar as permissões configuradas para o perfil.
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


# =========================================================
# MIDDLEWARE GLOBAL DE SEGURANÇA
# =========================================================
@app.middleware("http")
async def aplicar_seguranca(request: Request, call_next):
    """Middleware HTTP que protege as rotas administrativas com JWT.

    Fluxo de execução para rotas protegidas (ROTAS_PROTEGIDAS):
      1. Extrai o token do header Authorization: Bearer <token>
      2. Decodifica e valida o token JWT de usuário administrativo
      3. Carrega o Usuario do banco e verifica se está ativo
      4. Bloqueia o perfil "master" (acessa apenas /admin)
      5. Para métodos de escrita (POST/PUT/DELETE), verifica se o perfil
         do usuário tem permissão no domínio da rota (DOMINIOS_LEGADOS)
      6. Armazena o usuario em request.state.usuario (disponível nos endpoints)
      7. Define EMPRESA_ATUAL_ID via ContextVar para isolar dados da empresa

    Após o processamento (todas as rotas):
      - Adiciona headers de segurança HTTP (CSP, X-Frame-Options, etc.)
      - Reseta a ContextVar de empresa para evitar vazamento entre requests

    Casos de erro:
      - 401: token ausente, inválido ou usuário inativo
      - 403: perfil master tentando acessar rota operacional,
             ou perfil sem permissão de escrita no domínio
    """
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
            # Carrega o usuário pelo ID contido no campo "sub" do payload JWT
            usuario = db.get(Usuario, int(payload.get("sub")))
            if not usuario or usuario.status != "ativo":
                return JSONResponse(status_code=status.HTTP_401_UNAUTHORIZED, content={"detail": "Usuario inativo ou inexistente."})
            # Perfil master é restrito ao painel de administração de empresas
            if usuario.perfil == "master":
                return JSONResponse(status_code=status.HTTP_403_FORBIDDEN, content={"detail": "Usuario master acessa apenas o painel de gerenciamento."})
            # Verifica permissão de escrita apenas para métodos que modificam dados
            if request.method not in {"GET", "HEAD", "OPTIONS"}:
                dominio = next((valor for prefixo, valor in DOMINIOS_LEGADOS.items() if caminho.startswith(prefixo)), "")
                if dominio and not usuario_pode_escrever(usuario, dominio):
                    return JSONResponse(status_code=status.HTTP_403_FORBIDDEN, content={"detail": "Permissao insuficiente."})
            # Disponibiliza o usuário para os endpoints via request.state
            request.state.usuario = usuario
            # Define a empresa ativa na ContextVar — isolamento multitenancy por request
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
        # Reseta a ContextVar independente de sucesso ou exceção
        if token_empresa is not None:
            EMPRESA_ATUAL_ID.reset(token_empresa)

    # Headers de segurança HTTP aplicados a TODAS as respostas
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer-when-downgrade"
    response.headers["Permissions-Policy"] = "geolocation=(self), microphone=(), camera=()"
    # CSP: permite tiles do OpenStreetMap (mapa), estilos inline e scripts de CDN conhecidos.
    # manifest-src blob: necessário para o manifesto dinâmico gerado com logo da empresa via Canvas.
    # worker-src 'self' necessário para registrar o Service Worker do PWA.
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' data: blob: https://*.tile.openstreetmap.org; "
        "style-src 'self' 'unsafe-inline' https://unpkg.com; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; "
        "manifest-src 'self' blob:; "
        "worker-src 'self'; "
        "connect-src 'self'"
    )
    return response


# =========================================================
# STARTUP — INICIALIZAÇÃO DO BANCO DE DADOS
# =========================================================
@app.on_event("startup")
def inicializar_banco():
    """Executado automaticamente quando a API sobe (uvicorn start).

    Cria todas as tabelas que ainda não existem no banco (CREATE TABLE IF NOT EXISTS).
    A função garantir_colunas_runtime() adiciona colunas novas em tabelas existentes
    sem precisar de migrations formais (Alembic), mantendo compatibilidade com
    bancos antigos que não possuem as colunas mais recentes.
    """
    Base.metadata.create_all(bind=engine)
    garantir_colunas_runtime()


# Registra os routers externos na aplicação principal.
# auth_router: endpoints de autenticação (/auth/login, /auth/logout, etc.)
# admin_router: painel de gerenciamento de empresas (perfil master)
# landing_router: API do site institucional GM7 (/gm7-api/*)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(landing_router)

# ContextVar que armazena o empresa_id do usuário logado durante cada request.
# Definida aqui (após os routers) para estar disponível em todo o arquivo.
# O middleware aplicar_seguranca define o valor; obter_empresa() o lê.
EMPRESA_ATUAL_ID: ContextVar[int | None] = ContextVar("empresa_atual_id", default=None)

# =========================================================
# CAMINHOS DOS ARQUIVOS DE DADOS
# =========================================================
# DATA_DIR: pasta onde ficam os arquivos JSON persistidos no servidor.
# A maioria dos dados está no PostgreSQL, mas localizações e folha de
# pagamento ainda usam arquivos JSON por razões de compatibilidade.
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)  # cria a pasta se não existir

# FRONTEND_DIR: raiz dos arquivos estáticos servidos pelo FastAPI
# (app.js, motorista.html, index.html, etc.) no diretório renderer/
FRONTEND_DIR = Path(__file__).parent.parent / "renderer"

# Arquivos JSON legados — usados apenas para estas duas funcionalidades.
# Para empresas diferentes da empresa 1, os arquivos ficam em subpastas
# separadas por empresa_id (ver _caminho_empresa() abaixo).
ARQUIVO_FOLHA_PAGAMENTO = DATA_DIR / "folha_pagamento.json"
ARQUIVO_LOCALIZACOES_MOTORISTAS = DATA_DIR / "localizacoes_motoristas.json"


# =========================================================
# HELPERS DE BANCO DE DADOS (SQLAlchemy)
# =========================================================

@contextmanager
def sessao_db():
    """Gerenciador de contexto para sessões do SQLAlchemy.

    Uso padrão em todos os endpoints:
        with sessao_db() as db:
            registros = db.query(Modelo).filter(...).all()

    Garante que a sessão seja fechada mesmo em caso de exceção,
    evitando vazamento de conexões no pool do banco de dados.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def obter_empresa() -> int:
    """Retorna o empresa_id do usuário logado no request atual.

    Lê o valor da ContextVar EMPRESA_ATUAL_ID que foi definida
    pelo middleware aplicar_seguranca ao validar o token JWT.
    Deve ser chamada apenas dentro de endpoints protegidos.
    """
    return EMPRESA_ATUAL_ID.get()


# =========================================================
# HELPERS JSON (localizações de motoristas e folha de pagamento)
# =========================================================
# Estas funções gerenciam os dois módulos que ainda persistem dados
# em arquivos JSON em vez do banco de dados PostgreSQL.
# O isolamento multitenancy é feito por subpasta: data/empresas/<id>/

def _caminho_empresa(caminho: Path) -> Path:
    """Retorna o caminho do arquivo JSON isolado para a empresa atual.

    Empresa 1 (padrão): usa o caminho original em DATA_DIR.
    Outras empresas: usa DATA_DIR/empresas/<empresa_id>/<nome_do_arquivo>.
    Cria a subpasta automaticamente se não existir.
    """
    empresa_id = EMPRESA_ATUAL_ID.get()
    if not empresa_id or empresa_id == 1:
        return caminho
    pasta = DATA_DIR / "empresas" / str(empresa_id)
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta / caminho.name


def ler_json_loc(caminho: Path) -> list:
    """Lê um arquivo JSON de localizações, retornando lista vazia em caso de erro.

    Trata silenciosamente arquivos inexistentes ou corrompidos para não
    interromper o fluxo do endpoint que chama esta função.
    """
    caminho = _caminho_empresa(caminho)
    if not caminho.exists():
        return []
    try:
        dados = json.loads(caminho.read_text(encoding="utf-8"))
        return dados if isinstance(dados, list) else []
    except Exception:
        return []


def salvar_json_loc(caminho: Path, dados: list) -> None:
    """Persiste uma lista de dicionários em arquivo JSON com indentação legível."""
    caminho = _caminho_empresa(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")


def ler_json_folha() -> list:
    """Atalho para ler o arquivo JSON da folha de pagamento da empresa atual."""
    return ler_json_loc(ARQUIVO_FOLHA_PAGAMENTO)


def salvar_json_folha(dados: list) -> None:
    """Atalho para gravar o arquivo JSON da folha de pagamento da empresa atual."""
    salvar_json_loc(ARQUIVO_FOLHA_PAGAMENTO, dados)


def proximo_id_lista(lista: list) -> int:
    """Gera o próximo ID sequencial para registros em listas JSON.

    Equivalente a um AUTO_INCREMENT simples: retorna o maior id
    existente + 1, ou 1 se a lista estiver vazia.
    Usado exclusivamente para folha de pagamento (dados em JSON).
    """
    if not lista:
        return 1
    return max(item.get("id", 0) for item in lista) + 1


def buscar_id_lista(lista: list, item_id: int):
    """Localiza um item pelo campo 'id' em uma lista de dicionários JSON.

    Retorna None se não encontrado — padrão next() com default.
    Usado para buscar registros de folha de pagamento no arquivo JSON.
    """
    return next((x for x in lista if x.get("id") == item_id), None)


# =========================================================
# CLASSIFICAÇÕES E PLANO DE CONTAS BASE
# =========================================================
# CLASSIFICACOES é a lista global de categorias financeiras disponíveis
# para todos os lançamentos. Divide-se em 4 grupos principais:
#   1.x → Custos dos serviços (combustível, manutenção, pneus, etc.)
#   2.x → Despesas administrativas (bancárias, multas, outras)
#   3.x → Receitas (serviços prestados, outras receitas)
#   4.x → Investimentos (compra/melhoria de bens, estoque)
#
# Empresas podem adicionar classificações personalizadas via Plano de Contas
# (tabela plano_contas do banco), que são mescladas com esta lista base
# na função listar_classificacoes_ativas().
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

# Reconstrói CLASSIFICACOES a partir do PLANO_CONTAS_BASE para garantir
# que ambas as estruturas estejam sempre sincronizadas.
# A primeira definição literal acima é sobrescrita por esta list comprehension.
CLASSIFICACOES = [
    item
    for grupo in PLANO_CONTAS_BASE
    for item in grupo["itens"]
]

# Conjunto de status válidos para veículos — usado na validação do VeiculoIn.
STATUS_VEICULO_VALIDOS = {"Ativo", "Manutencao", "Inativo"}


def normalizar_texto(valor: str) -> str:
    """Remove acentos e converte para minúsculas para comparações case-insensitive.

    Usado principalmente para validar tipos de veículo sem distinção de acento
    (ex: "Caminhão" e "Caminhao" são tratados como iguais).
    Algoritmo: normalização Unicode NFD + remoção de marcas de acento (categoria Mn).
    """
    texto = str(valor or "").strip().lower()
    texto = unicodedata.normalize("NFD", texto)
    return "".join(caractere for caractere in texto if unicodedata.category(caractere) != "Mn")


# =========================================================
# MODELOS PYDANTIC DE ENTRADA (schemas de validação)
# =========================================================
# Cada classe BaseModel abaixo corresponde ao corpo JSON esperado
# pelo frontend nos endpoints POST/PUT. O Pydantic v2 valida e
# converte os dados automaticamente antes de chegar à função do endpoint.
#
# Padrão geral:
#   - Campos obrigatórios: Field(...) sem default
#   - Campos opcionais: com default (None, "", 0, etc.)
#   - @field_validator: limpeza de espaços, normalização e regras de negócio
#   - Os validators "limpar_*" removem espaços extras de strings (strip)

class LancamentoIn(BaseModel):
    """Schema de entrada para criação e edição de lançamentos financeiros.

    Chamado pelo frontend (app.js) ao salvar um lançamento no módulo financeiro.

    Campos obrigatórios: classificacao, descricao, valor, data
    Campos opcionais padrão: veiculo_id, empresa_id, obra_servico
    Campos de combustível: kilometragem, litros, numero_nf, data_nf
    Campos de estoque: estoque_item_id, estoque_quantidade
      - Quando estoque_item_id é informado, o sistema registra automaticamente
        uma saída no estoque e vincula ao lançamento para rastreabilidade.
      - O vínculo é transacional: ou ambos são criados ou nenhum.
    """
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
    # Vínculo com estoque: ao informar, registra saída automática
    estoque_item_id: Optional[int] = None
    estoque_quantidade: Optional[float] = None

    @field_validator("classificacao", "descricao", "obra_servico", "numero_nf")
    @classmethod
    def limpar_texto(cls, value: str) -> str:
        return value.strip()

    @field_validator("valor", "kilometragem", "litros", mode="before")
    @classmethod
    def validar_valor(cls, value: float) -> float:
        return normalizar_numero_decimal(value)

    @field_validator("estoque_quantidade", mode="before")
    @classmethod
    def validar_estoque_quantidade(cls, value: float) -> float:
        if value is None:
            return value
        valor = normalizar_numero_decimal(value)
        if valor < 0:
            raise ValueError("Quantidade de estoque nao pode ser negativa.")
        return valor


class PlanoContaIn(BaseModel):
    """Schema para criar/editar uma classificação personalizada no Plano de Contas.

    Complementa o PLANO_CONTAS_BASE com categorias específicas da empresa.
    Chamado pelo frontend ao cadastrar novas classificações contábeis.
    """
    nome: str = Field(..., min_length=1)

    @field_validator("nome")
    @classmethod
    def limpar_nome(cls, value: str) -> str:
        return value.strip()


class ContaReceberIn(BaseModel):
    """Schema de entrada para contas a receber (fretes, serviços, horas de máquina).

    Suporta dois modos de cálculo de valor:
      - Modo valor fixo: usa o campo `valor` diretamente
      - Modo horas: valor = valor_hora_unitario × quantidade_horas (se ambos > 0)
    O campo `bonificacao` soma ao valor calculado; `descontos` subtrai.
    O campo `desconto_classificacao` deve ser uma classificação de despesa (grupo 2.x).
    """
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
    """Schema mínimo para alterar apenas o status de pagamento de uma conta a receber.

    Usado pelo endpoint PATCH /contas-receber/{id}/status, chamado pelo frontend
    quando o usuário marca um frete como recebido sem editar os outros campos.
    Ao marcar como "recebido", o backend registra automaticamente a data de hoje.
    """
    status_pagamento: str

    @field_validator("status_pagamento")
    @classmethod
    def validar_status_pagamento(cls, value: str) -> str:
        status = value.strip().lower() or "pendente"
        if status not in {"pendente", "recebido"}:
            raise ValueError("Status de pagamento invalido.")
        return status


class VeiculoIn(BaseModel):
    """Schema de entrada para cadastro e edição de veículos da frota.

    O campo `placa` é normalizado para maiúsculas automaticamente.
    O campo `tipo` aceita variações com/sem acento (ex: "Caminhão" = "Caminhao").
    O campo `foto` armazena a imagem como string base64 ou URL.
    """
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
    """Schema de entrada para cadastro e edição de motoristas.

    Os campos de dados trabalhistas (salario_base, inss_percentual, etc.) são
    armazenados no campo JSON 'dados' do modelo Motorista no banco, pois foram
    adicionados após a criação inicial da tabela e não possuem colunas próprias.

    Os percentuais de INSS e IRRF aqui são informativos (exibição no recibo).
    O cálculo real do INSS usa a tabela progressiva em calcular_inss().
    """
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
    carga_horaria_mensal: float = 220  # padrão CLT: 220 horas/mês
    valor_hora_extra: float = 0
    inss_percentual: float = 0        # percentual informativo para exibição
    irrf_percentual: float = 0        # percentual informativo para exibição
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
    """Schema para atualização da posição GPS de um motorista (sistema legacy JSON).

    Usado pelo endpoint POST /localizacoes-motoristas, chamado pelo painel
    administrativo quando um usuário registra manualmente a posição de um motorista.
    Para o app mobile, usar LocalizacaoMotoristaMobileIn (com token).
    As coordenadas são validadas pelos ranges geográficos padrão.
    """
    motorista_id: int
    latitude: float = Field(..., ge=-90, le=90)    # validado pelo Pydantic
    longitude: float = Field(..., ge=-180, le=180)  # validado pelo Pydantic
    velocidade: float = 0
    direcao: float = 0    # em graus (0-360, 0=Norte)
    precisao: float = 0   # precisão do GPS em metros
    bateria: Optional[float] = None  # nível da bateria do dispositivo (0-100)

    @field_validator("velocidade", "direcao", "precisao", "bateria", mode="before")
    @classmethod
    def validar_numero_localizacao(cls, value: float) -> float:
        valor = normalizar_numero_decimal(value)
        return max(valor, 0)


class MotoristaMobileLoginIn(BaseModel):
    """Schema de login para o app mobile legado (token simples "teste:empresa:id").

    Este endpoint (/motorista-mobile/login) é o login legado sem hash de senha.
    O app mobile moderno usa POST /motorista-app/login com senha hasheada.
    O campo empresa_id é opcional para suportar motoristas sem empresa definida.
    """
    usuario: str
    senha: str
    empresa_id: Optional[int] = None
    motorista_id: Optional[int] = None


class LocalizacaoMotoristaMobileIn(LocalizacaoMotoristaIn):
    """Schema para atualização de posição GPS via app mobile legado.

    Estende LocalizacaoMotoristaIn adicionando o token de autenticação mobile
    e o empresa_id (necessários pois o endpoint é público no middleware).
    """
    token: str
    empresa_id: Optional[int] = None


class FolhaPagamentoItemIn(BaseModel):
    """Schema para um item (motorista) dentro de uma folha de pagamento.

    Cada item representa o cálculo salarial de um motorista no período.
    Os campos de base (base_inss, base_fgts, etc.) são calculados pelo backend
    em calcular_item_folha() e podem ser enviados pelo frontend para auditoria.
    O campo desconto_inss_manual permite sobrescrever o cálculo automático da
    tabela progressiva TABELA_INSS_2026 quando o contador fez ajuste manual.
    """
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
    """Schema para criar uma folha de pagamento completa com múltiplos motoristas.

    Quando gerar_lancamento=True (padrão), o backend cria automaticamente um
    lançamento financeiro na classificação "1.5 SALARIO + ENCAGOS FOLHA PGTO"
    com o valor do salário líquido total, vinculando à folha pelo folha_pagamento_id
    armazenado no campo 'dados' do lançamento.

    O campo opcoes_recibo é um dict livre com preferências de impressão do recibo
    (ex: exibir FGTS, mostrar banco, etc.) definidas pelo frontend.
    """
    periodo: str = Field(..., min_length=1)  # ex: "2026-05" ou "Janeiro/2026"
    data_pagamento: date
    descricao: str = "Folha de pagamento"
    gerar_lancamento: bool = True  # se True, gera lançamento automático na aba financeira
    opcoes_recibo: dict = Field(default_factory=dict)
    itens: list[FolhaPagamentoItemIn]

    @field_validator("periodo", "descricao")
    @classmethod
    def limpar_textos_folha(cls, value: str) -> str:
        return value.strip()


class AtivoIn(BaseModel):
    """Schema para cadastro de ativos patrimoniais (veículos, máquinas, imóveis, etc.).

    Ativos são bens de propriedade da empresa que compõem o patrimônio líquido.
    O campo veiculo_id vincula o ativo a um veículo cadastrado na frota,
    permitindo rastrear o valor patrimonial de cada caminhão/máquina.
    Campos extras (tipo, data_aquisicao, veiculo_id, observacao, status) são
    serializados no campo JSON 'dados' do modelo Ativo no banco.
    """
    nome: str = Field(..., min_length=1)
    tipo: str = Field(..., min_length=1)  # Veiculo, Maquina, Equipamento, Imovel, Outro
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
    """Schema para cadastro de passivos (dívidas, financiamentos, empréstimos).

    Passivos representam obrigações financeiras da empresa.
    O saldo_devedor é calculado automaticamente como valor_total - valor_pago
    e retornado no passivo_para_dict() — não é armazenado diretamente.
    Todos os campos extras são serializados no campo JSON 'dados' do modelo.
    """
    nome: str = Field(..., min_length=1)
    tipo: str = Field(..., min_length=1)  # Financiamento, Emprestimo, Divida, etc.
    valor_total: float = 0
    valor_pago: float = 0
    data_inicio: Optional[date] = None
    data_vencimento: Optional[date] = None
    observacao: str = ""
    status: str = "Pendente"  # Pendente ou Pago

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
    """Schema para cadastro de produtos no módulo de estoque.

    O campo estoque_baixo é calculado dinamicamente em produto_estoque_para_dict()
    comparando quantidade_atual com estoque_minimo — não é enviado pelo frontend.
    O campo valor_total_estoque = quantidade_atual * valor_custo também é calculado.
    Campos extras (unidade_medida, valor_custo, estoque_minimo, observacao) são
    serializados no campo JSON 'dados' do modelo EstoqueProduto no banco.
    """
    nome: str = Field(..., min_length=1)
    categoria: str = ""
    unidade_medida: str = "un"  # ex: "un", "L", "kg", "cx"
    quantidade_atual: float = 0
    valor_custo: float = 0      # custo unitário atual (atualizado nas entradas)
    estoque_minimo: float = 0   # alerta quando quantidade <= estoque_minimo
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
    """Schema para registrar entradas, saídas ou ajustes de estoque.

    Tipos válidos: "Entrada", "Saida", "Ajuste"
    - Entrada: soma a quantidade ao estoque e atualiza valor_custo se informado
    - Saida: subtrai a quantidade (valida se há saldo suficiente)
    - Ajuste: substitui a quantidade atual pelo valor informado (inventário)

    Nota: saídas vinculadas a lançamentos financeiros são criadas automaticamente
    em criar_lancamento() / atualizar_lancamento() e não passam por este schema.
    """
    produto_id: int
    tipo_movimentacao: str = Field(..., min_length=1)
    quantidade: float
    valor_unitario: float = 0  # atualiza o custo médio do produto nas entradas
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
# CONVERSORES: modelo ORM SQLAlchemy -> dict JSON (formato do frontend)
# =========================================================
# Cada função *_para_dict() converte um objeto ORM para o dicionário
# que será serializado como JSON e retornado para o frontend (app.js).
#
# Padrão de leitura do campo 'dados' (JSON flexível):
#   ex = json.loads(model.dados or "{}")
#   campo = ex.get("campo", valor_padrao)
#
# Este padrão garante compatibilidade com registros antigos que não
# possuem o campo no JSON (retorna o valor_padrao ao invés de KeyError).

def veiculo_para_dict(v: Veiculo) -> dict:
    """Converte um Veiculo ORM para dict JSON enviado ao frontend."""
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
    """Converte um Motorista ORM para dict JSON.

    Os campos trabalhistas (salario_base, inss_percentual, banco, etc.) ficam
    no campo JSON 'dados' e são extraídos aqui com valores padrão seguros.
    O campo admissao é convertido de date para string ISO (ou "" se None).
    """
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
    """Converte um registro Lancamento do ORM para dicionário JSON.

    Extrai os campos extras do JSON armazenado em 'dados', incluindo
    os campos de estoque vinculado (estoque_item_id, estoque_quantidade,
    estoque_item_nome) para exibição no frontend.
    """
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
        # Campos de vínculo com estoque (None quando não vinculado)
        "estoque_item_id": ex.get("estoque_item_id"),
        "estoque_quantidade": ex.get("estoque_quantidade"),
        "estoque_item_nome": ex.get("estoque_item_nome", ""),
    }


def conta_receber_para_dict(c: ContaReceber) -> dict:
    """Converte uma ContaReceber ORM para dict JSON.

    Calcula e adiciona o campo valor_total_receber (valor + bonificacao - descontos)
    via calcular_total_conta_receber() — este campo não é armazenado no banco.
    """
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
    """Converte um Ativo ORM para dict JSON com campos extras do JSON 'dados'."""
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
    """Converte um Passivo ORM para dict JSON calculando o saldo_devedor.

    saldo_devedor = max(valor_total - valor_pago, 0) — nunca retorna negativo.
    """
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
    """Converte um EstoqueProduto ORM para dict JSON.

    Calcula valor_total_estoque (quantidade * custo) e o flag estoque_baixo
    (True quando quantidade <= estoque_minimo) — ambos são campos calculados,
    não armazenados no banco.
    """
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
    """Converte uma EstoqueMovimentacao ORM para dict JSON do frontend."""
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


# =========================================================
# HELPERS UTILITÁRIOS DE DATA, NÚMERO E CLASSIFICAÇÃO
# =========================================================

def agora_iso() -> str:
    """Retorna o timestamp atual como string ISO 8601 sem microsegundos.
    Usado como valor padrão para created_at/updated_at quando o banco retorna None.
    """
    return datetime.now().replace(microsecond=0).isoformat()


def minutos_desde_iso(valor: str) -> float:
    """Calcula quantos minutos se passaram desde um timestamp ISO 8601.

    Retorna 999999 (valor sentinela) quando o timestamp é inválido ou ausente,
    garantindo que motoristas sem sinal apareçam como "offline" no mapa.
    Usado em normalizar_localizacao_motorista() para determinar status "online".
    """
    if not valor:
        return 999999
    try:
        data = datetime.fromisoformat(str(valor))
        return max((datetime.now() - data).total_seconds() / 60, 0)
    except ValueError:
        return 999999


def normalizar_numero_decimal(valor) -> float:
    """Converte entrada do usuário para float, aceitando formatos BR e EN.

    Aceita: 1234.56, 1.234,56, R$ 1.234,56, etc.
    Lógica:
      - Se contém vírgula: remove pontos de milhar e substitui vírgula por ponto
      - Se múltiplos pontos: remove todos (formato "1.234.567")
      - None ou "" retornam 0.0
    Chamado pelos @field_validator dos schemas Pydantic.
    """
    if valor is None or valor == "":
        return 0.0
    if isinstance(valor, (int, float)):
        return float(valor)
    texto = str(valor).strip().replace("R$", "").replace(" ", "")
    if "," in texto:
        # Formato brasileiro: 1.234,56 -> 1234.56
        texto = texto.replace(".", "").replace(",", ".")
    elif texto.count(".") > 1:
        # Formato com separador de milhar apenas: 1.234.567 -> 1234567
        texto = texto.replace(".", "")
    try:
        return float(texto)
    except ValueError as erro:
        raise ValueError("Numero invalido. Use formato 8,9 ou 8.9.") from erro


def obter_grupo_financeiro(classificacao: str) -> str:
    """Determina o grupo financeiro de uma classificação pelo prefixo numérico.

    Regra de negócio baseada na estrutura do PLANO_CONTAS_BASE:
      1.x → CUSTOS OPERACIONAIS  (combustível, manutenção, salários)
      2.x → DESPESAS ADMINISTRATIVAS (bancárias, multas, taxas)
      3.x → FATURAMENTO           (receitas de serviços)
      4.x → INVESTIMENTOS         (compra de bens, estoque)
    """
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


# Predicados de classificação — usados em filtros de relatório e na geração
# do campo tipo_financeiro armazenado no banco junto ao lançamento.
def eh_receita(classificacao: str) -> bool:
    """Retorna True se a classificação pertence ao grupo 3.x (Receitas/Faturamento)."""
    return obter_grupo_financeiro(classificacao) == "FATURAMENTO"


def eh_faturamento(classificacao: str) -> bool:
    """Alias de eh_receita() para compatibilidade com código legado."""
    return eh_receita(classificacao)


def eh_custo(classificacao: str) -> bool:
    """Retorna True se a classificação pertence ao grupo 1.x (Custos Operacionais)."""
    return obter_grupo_financeiro(classificacao) == "CUSTOS OPERACIONAIS"


def eh_custo_operacional(classificacao: str) -> bool:
    """Alias de eh_custo() para compatibilidade com código legado."""
    return eh_custo(classificacao)


def eh_despesa(classificacao: str) -> bool:
    """Retorna True se a classificação pertence ao grupo 2.x (Despesas Administrativas)."""
    return obter_grupo_financeiro(classificacao) == "DESPESAS ADMINISTRATIVAS"


def eh_despesa_administrativa(classificacao: str) -> bool:
    """Alias de eh_despesa() para compatibilidade com código legado."""
    return eh_despesa(classificacao)


def eh_investimento(classificacao: str) -> bool:
    """Retorna True se a classificação pertence ao grupo 4.x (Investimentos)."""
    return obter_grupo_financeiro(classificacao) == "INVESTIMENTOS"


def inferir_tipo_financeiro(classificacao: str) -> str:
    """Retorna o tipo financeiro como string para armazenar no campo tipo_financeiro do banco.

    Valores possíveis: "receita", "custo", "despesa", "investimento", "outro".
    Este campo é redundante com a classificação, mas facilita filtros rápidos
    no banco sem precisar analisar o prefixo numérico da classificação toda vez.
    """
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
    """Arredonda um valor para 2 casas decimais (padrão monetário BRL).
    Converte None/falsy para 0.0 antes de arredondar.
    """
    return round(float(valor or 0), 2)


# =========================================================
# CÁLCULO DE FOLHA DE PAGAMENTO — INSS PROGRESSIVO 2026
# =========================================================

# Tabela de faixas do INSS 2026 (cálculo progressivo por faixa de salário).
# Formato: (limite_superior_da_faixa, aliquota_da_faixa)
# Cada faixa incide apenas sobre o valor que cai dentro dela, não sobre o total.
TABELA_INSS_2026 = [
    (1621.00, 0.075),   # até R$ 1.621,00: 7,5%
    (2902.84, 0.09),    # de R$ 1.621,01 até R$ 2.902,84: 9%
    (4354.27, 0.12),    # de R$ 2.902,85 até R$ 4.354,27: 12%
    (8475.55, 0.14),    # de R$ 4.354,28 até R$ 8.475,55 (teto): 14%
]


def calcular_inss(base_calculo: float) -> float:
    """Calcula a contribuição ao INSS pela tabela progressiva de 2026.

    O cálculo é progressivo (similar ao IR): cada faixa incide apenas sobre
    a parcela do salário que se enquadra nela, não sobre o salário total.
    Exemplo: salário de R$ 3.000,00
      Faixa 1: R$ 1.621,00 × 7,5% = R$ 121,58
      Faixa 2: (R$ 2.902,84 - R$ 1.621,00) × 9% = R$ 115,36
      Faixa 3: (R$ 3.000,00 - R$ 2.902,84) × 12% = R$ 11,66
      Total INSS: R$ 248,59

    O salário é limitado ao teto do INSS (última faixa da tabela).
    """
    base = min(float(base_calculo or 0), TABELA_INSS_2026[-1][0])
    contribuicao = 0
    limite_anterior = 0

    for limite, aliquota in TABELA_INSS_2026:
        if base <= limite_anterior:
            break
        # Calcula apenas o valor que cai dentro desta faixa
        faixa = min(base, limite) - limite_anterior
        contribuicao += faixa * aliquota
        limite_anterior = limite

    return arredondar_moeda(contribuicao)


def calcular_item_folha(item: FolhaPagamentoItemIn, motorista: dict) -> dict:
    """Calcula todos os valores do holerite de um motorista para o período.

    Fórmula:
      salario_base     = salario_contratual (se horas_normais > 0, caso contrário 0)
      valor_extras     = horas_extras × valor_hora_extra
      total_adicionais = adicional_noturno + bonus
      salario_bruto    = salario_base + valor_extras + total_adicionais
      desconto_inss    = calcular_inss(salario_bruto) ou manual ou zero
      fgts             = salario_bruto × 8%  (encargo da empresa, informativo)
      base_irrf        = salario_bruto - desconto_inss
      total_descontos  = inss + irrf + vale + adiantamento + outros
      salario_liquido  = max(salario_bruto - total_descontos, 0)

    O salario_contratual pode ser sobrescrito pelo item; caso não informado,
    usa o salario_base cadastrado no perfil do motorista.

    Args:
        item: dados do item da folha enviados pelo frontend
        motorista: dict com dados do motorista (resultado de motorista_para_dict)

    Returns:
        dict completo com todos os valores calculados, pronto para salvar no JSON.
    """
    salario_contratual = float(item.salario_contratual or motorista.get("salario_base", 0) or 0)
    # Salário base só é computado se houver horas normais trabalhadas
    salario_base = salario_contratual if item.horas_normais > 0 else 0
    valor_extras = item.horas_extras * item.valor_hora_extra
    total_adicionais = item.adicional_noturno + item.bonus
    salario_bruto = salario_base + valor_extras + total_adicionais
    base_inss = salario_bruto
    # Três modos de cálculo do INSS:
    if not item.aplicar_inss:
        desconto_inss = 0                        # isento (MEI, autônomo, etc.)
    elif item.desconto_inss_manual:
        desconto_inss = item.desconto_inss       # valor inserido manualmente pelo usuário
    else:
        desconto_inss = calcular_inss(base_inss) # tabela progressiva 2026
    base_fgts = salario_bruto
    fgts = base_fgts * 0.08  # 8% de FGTS (encargo do empregador, informativo no recibo)
    # Base IRRF é o salário bruto deduzido o INSS (antes de aplicar alíquota do IR)
    base_irrf = max(salario_bruto - desconto_inss, 0)
    total_descontos = (
        desconto_inss
        + item.desconto_irrf
        + item.desconto_vale
        + item.desconto_adiantamento
        + item.outros_descontos
    )
    # Garantia: salário líquido nunca negativo (caso descontos superem o bruto)
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
    """Retorna a lista completa de classificações disponíveis para a empresa atual.

    Mescla as classificações globais do PLANO_CONTAS_BASE com as classificações
    personalizadas da empresa (tabela plano_contas do banco).
    Evita duplicatas ao adicionar apenas nomes que ainda não existem na lista base.
    Usado para validar o campo 'classificacao' nos lançamentos e contas a receber.
    """
    empresa_id = EMPRESA_ATUAL_ID.get()
    nomes = list(CLASSIFICACOES)  # copia da lista global
    with sessao_db() as db:
        registros = db.query(PlanoConta).filter(PlanoConta.empresa_id == empresa_id).all()
        for r in registros:
            if r.nome and r.nome not in nomes:
                nomes.append(r.nome)
    return nomes


def classificacao_eh_despesa(nome: str) -> bool:
    """Alias de eh_despesa() para leitura semântica nas validações de conta a receber."""
    return eh_despesa(nome)


# =========================================================
# NORMALIZADORES DE COMPATIBILIDADE (registros legados)
# =========================================================
# Estas funções garantem que registros antigos (salvos antes de campos serem
# adicionados) sejam retornados com o mesmo formato que registros novos.
# Aplicadas ao ler dados do banco quando o campo 'dados' JSON pode estar
# incompleto ou no formato antigo.

def normalizar_lancamento_antigo(item: dict) -> dict:
    """Normaliza um lançamento lido do banco para o formato atual da API.

    Preenche campos ausentes com valores padrão e infere tipo_financeiro
    a partir da classificação quando não está armazenado explicitamente.
    """
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
    """Normaliza uma conta a receber antiga, calculando valor_total_receber."""
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
    """Normaliza um ativo antigo preenchendo campos ausentes com padrões."""
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
    """Normaliza um passivo antigo calculando saldo_devedor com proteção de negativos."""
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
    """Normaliza um produto de estoque antigo calculando campos derivados."""
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
# ENDPOINTS DE CLASSIFICAÇÕES
# =========================================================
# Chamados pelo frontend ao carregar os selects de classificação
# nos formulários de lançamento e conta a receber.
# Protegidos pelo middleware (prefixo /classificacoes em ROTAS_PROTEGIDAS).

@app.get("/classificacoes")
def listar_classificacoes():
    """Retorna a lista completa de classificações ativas para a empresa logada.

    Inclui as classificações globais (PLANO_CONTAS_BASE) mais as personalizadas
    cadastradas pela empresa na tabela plano_contas.
    Chamado pelo frontend ao abrir qualquer formulário de lançamento.
    """
    return listar_classificacoes_ativas()


# =========================================================
# ENDPOINTS DE PLANO DE CONTAS
# =========================================================
# Gerenciam as classificações personalizadas por empresa (tabela plano_contas).
# As classificações da lista base (CLASSIFICACOES) não podem ser editadas aqui.

@app.get("/plano-contas")
def listar_plano_contas():
    """Lista apenas as classificações personalizadas da empresa (não inclui a lista base).

    Retorna id e nome de cada item cadastrado na tabela plano_contas.
    Usado pelo frontend na tela de gerenciamento de plano de contas.
    """
    empresa_id = obter_empresa()
    with sessao_db() as db:
        registros = db.query(PlanoConta).filter(PlanoConta.empresa_id == empresa_id).order_by(PlanoConta.nome).all()
        return [{"id": r.id, "nome": r.nome} for r in registros]


@app.get("/plano-contas/estrutura")
def listar_estrutura_plano_contas():
    """Retorna a estrutura completa do plano de contas.

    Combina os grupos fixos do PLANO_CONTAS_BASE com as classificações
    personalizadas da empresa. Usado pelo frontend para montar a árvore
    hierárquica de contas na tela de configuração.
    """
    return {
        "grupos": PLANO_CONTAS_BASE,
        "personalizadas": listar_plano_contas(),
    }


@app.post("/plano-contas")
def criar_plano_conta(dados: PlanoContaIn):
    """Cria uma nova classificação personalizada para a empresa.

    Valida:
      - Nome não pode duplicar classificações da lista base (case-insensitive)
      - Nome não pode duplicar classificações já cadastradas pela empresa
    Chamado pelo frontend na tela de plano de contas ao adicionar nova categoria.
    """
    empresa_id = obter_empresa()
    # Impede duplicar nomes que já existem na lista global imutável
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
    """Renomeia uma classificação personalizada da empresa.

    Valida duplicatas tanto na lista base quanto entre as personalizadas,
    excluindo o próprio registro da comparação de duplicatas.
    """
    empresa_id = obter_empresa()
    if any(n.lower() == dados.nome.lower() for n in CLASSIFICACOES):
        raise HTTPException(status_code=400, detail="Esta classificacao ja existe na lista base.")
    with sessao_db() as db:
        registro = db.query(PlanoConta).filter(
            PlanoConta.empresa_id == empresa_id, PlanoConta.id == plano_conta_id
        ).first()
        if not registro:
            raise HTTPException(status_code=404, detail="Classificacao nao encontrada.")
        # Verifica duplicata excluindo o próprio registro (id != plano_conta_id)
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
    """Remove uma classificação personalizada da empresa.

    Nota: não valida se há lançamentos usando esta classificação.
    Os lançamentos existentes manterão a classificação como texto livre.
    """
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
# ENDPOINTS DE LANÇAMENTOS FINANCEIROS
# =========================================================
# CRUD completo de lançamentos. Protegido pelo middleware.
# Lançamentos são o núcleo do sistema: registram todas as
# receitas, custos, despesas e investimentos da empresa.
# Podem ser vinculados a veículos, obras/serviços e itens de estoque.

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
    """Lista lançamentos da empresa com filtros opcionais.

    Filtros aplicados no banco (eficientes): classificacao, data_inicial,
    data_final, descricao.
    Filtros aplicados em Python (pós-query, campos no JSON 'dados'):
    veiculo_id, empresa_id, obra_servico — necessário pois estes campos
    ficam no campo JSON 'dados', que não é indexado para filtro direto no SQL.
    Retorna em ordem decrescente de data.
    Chamado pelo frontend ao carregar a aba de lançamentos e relatórios.
    """
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
    # Filtros em Python para campos dentro do JSON 'dados'
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
    """Cria um novo lançamento financeiro.

    Se estoque_item_id e estoque_quantidade forem informados:
      1. Valida se o produto existe e pertence à empresa
      2. Valida se há quantidade suficiente no estoque
      3. Registra saída automática no módulo de estoque
      4. Vincula o ID do lançamento na observação da movimentação

    Tudo é feito em uma única transação — se qualquer passo falhar,
    nada é gravado no banco.
    """
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
        "estoque_item_id": dados.estoque_item_id,
        "estoque_quantidade": dados.estoque_quantidade,
        "estoque_item_nome": "",
    }

    with sessao_db() as db:
        # Processar saída de estoque dentro da mesma transação
        if dados.estoque_item_id and dados.estoque_quantidade:
            qtd_saida = float(dados.estoque_quantidade)
            ep = db.query(EstoqueProduto).filter(
                EstoqueProduto.empresa_id == eid,
                EstoqueProduto.id == dados.estoque_item_id,
            ).first()
            if not ep:
                raise HTTPException(status_code=404, detail="Produto de estoque nao encontrado.")
            disponivel = float(ep.quantidade or 0)
            if qtd_saida > disponivel:
                raise HTTPException(
                    status_code=400,
                    detail=f"Estoque insuficiente. Disponivel: {disponivel:.3f}, solicitado: {qtd_saida:.3f}.",
                )
            extras["estoque_item_nome"] = ep.nome
            ep.quantidade = disponivel - qtd_saida

            # Registrar movimentação de saída (lancamento_id será atualizado após commit)
            extras_mov = {
                "valor_unitario": 0.0,
                "data": str(dados.data),
                "observacao": f"Saida vinculada ao lancamento financeiro.",
            }
            mov = EstoqueMovimentacao(
                empresa_id=eid,
                produto_id=dados.estoque_item_id,
                tipo="Saida",
                quantidade=qtd_saida,
                dados=json.dumps(extras_mov, ensure_ascii=False),
            )
            db.add(mov)

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

        # Após commit, atualizar a observação da movimentação com o ID do lançamento
        if dados.estoque_item_id and dados.estoque_quantidade and mov:
            ex_mov = json.loads(mov.dados)
            ex_mov["observacao"] = f"Saida vinculada ao lancamento #{l.id}."
            mov.dados = json.dumps(ex_mov, ensure_ascii=False)
            db.commit()

        db.refresh(l)
        return lancamento_para_dict(l)


@app.put("/lancamentos/{lancamento_id}")
def atualizar_lancamento(lancamento_id: int, dados: LancamentoIn):
    """Atualiza um lançamento existente.

    Tratamento do vínculo com estoque:
      - Se o lançamento anterior tinha estoque vinculado: a quantidade é
        devolvida ao estoque (estorno automático) antes de aplicar o novo vínculo.
      - Se o novo envio tem estoque_item_id: aplica nova saída após estorno.
      - Se o novo envio não tem estoque: apenas estorna o anterior (se houver).

    Tudo ocorre em uma única transação.
    """
    if dados.classificacao not in listar_classificacoes_ativas():
        raise HTTPException(status_code=400, detail="Classificacao invalida.")
    eid = obter_empresa()
    with sessao_db() as db:
        l = db.query(Lancamento).filter(Lancamento.empresa_id == eid, Lancamento.id == lancamento_id).first()
        if not l:
            raise HTTPException(status_code=404, detail="Lancamento nao encontrado.")

        ex_anterior = json.loads(l.dados or "{}")
        estoque_anterior_id = ex_anterior.get("estoque_item_id")
        estoque_anterior_qtd = ex_anterior.get("estoque_quantidade")

        # Estornar saída anterior se havia vínculo com estoque
        if estoque_anterior_id and estoque_anterior_qtd:
            ep_anterior = db.query(EstoqueProduto).filter(
                EstoqueProduto.empresa_id == eid,
                EstoqueProduto.id == estoque_anterior_id,
            ).first()
            if ep_anterior:
                ep_anterior.quantidade = float(ep_anterior.quantidade or 0) + float(estoque_anterior_qtd)
                ex_estorno = {
                    "valor_unitario": 0.0,
                    "data": str(dados.data),
                    "observacao": f"Estorno de saida do lancamento #{lancamento_id} (edicao).",
                }
                mov_estorno = EstoqueMovimentacao(
                    empresa_id=eid,
                    produto_id=estoque_anterior_id,
                    tipo="Entrada",
                    quantidade=float(estoque_anterior_qtd),
                    dados=json.dumps(ex_estorno, ensure_ascii=False),
                )
                db.add(mov_estorno)

        extras = {
            "veiculo_id": dados.veiculo_id,
            "empresa_id": dados.empresa_id,
            "obra_servico": dados.obra_servico,
            "kilometragem": dados.kilometragem,
            "litros": dados.litros,
            "numero_nf": dados.numero_nf,
            "data_nf": str(dados.data_nf) if dados.data_nf else "",
            "estoque_item_id": dados.estoque_item_id,
            "estoque_quantidade": dados.estoque_quantidade,
            "estoque_item_nome": "",
        }

        # Aplicar novo vínculo com estoque (se informado)
        if dados.estoque_item_id and dados.estoque_quantidade:
            qtd_saida = float(dados.estoque_quantidade)
            ep_novo = db.query(EstoqueProduto).filter(
                EstoqueProduto.empresa_id == eid,
                EstoqueProduto.id == dados.estoque_item_id,
            ).first()
            if not ep_novo:
                raise HTTPException(status_code=404, detail="Produto de estoque nao encontrado.")
            disponivel = float(ep_novo.quantidade or 0)
            if qtd_saida > disponivel:
                raise HTTPException(
                    status_code=400,
                    detail=f"Estoque insuficiente. Disponivel: {disponivel:.3f}, solicitado: {qtd_saida:.3f}.",
                )
            extras["estoque_item_nome"] = ep_novo.nome
            ep_novo.quantidade = disponivel - qtd_saida
            ex_saida = {
                "valor_unitario": 0.0,
                "data": str(dados.data),
                "observacao": f"Saida vinculada ao lancamento #{lancamento_id} (edicao).",
            }
            mov_saida = EstoqueMovimentacao(
                empresa_id=eid,
                produto_id=dados.estoque_item_id,
                tipo="Saida",
                quantidade=qtd_saida,
                dados=json.dumps(ex_saida, ensure_ascii=False),
            )
            db.add(mov_saida)

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
    """Remove um lançamento financeiro.

    Nota: NÃO estorna automaticamente saídas de estoque vinculadas ao lançamento.
    Para estorno de estoque em exclusão, usar o endpoint PUT antes de excluir,
    ou implementar estorno direto aqui caso necessário no futuro.
    """
    eid = obter_empresa()
    with sessao_db() as db:
        l = db.query(Lancamento).filter(Lancamento.empresa_id == eid, Lancamento.id == lancamento_id).first()
        if not l:
            raise HTTPException(status_code=404, detail="Lancamento nao encontrado.")
        db.delete(l)
        db.commit()
    return {"mensagem": "Lancamento excluido com sucesso."}


# =========================================================
# ENDPOINTS DE CONTAS A RECEBER
# =========================================================
# Registra fretes, serviços e horas de máquina a receber.
# Separado dos lançamentos pois possui status de pagamento,
# tomador, origem/destino e cálculo por hora (valor_hora × horas).
# Protegido pelo middleware (prefixo /contas-receber em ROTAS_PROTEGIDAS).

def calcular_total_conta_receber(item: dict) -> float:
    """Calcula o valor total líquido de uma conta a receber.

    Lógica:
      - Se valor_hora_unitario > 0 E quantidade_horas > 0: usa cálculo por hora
      - Caso contrário: usa o campo `valor` diretamente
      - Soma bonificacao e subtrai descontos ao final
    Resultado arredondado para 2 casas decimais.
    """
    valor_hora_unitario = normalizar_numero_decimal(item.get("valor_hora_unitario"))
    quantidade_horas = normalizar_numero_decimal(item.get("quantidade_horas"))
    valor = valor_hora_unitario * quantidade_horas if valor_hora_unitario > 0 and quantidade_horas > 0 else normalizar_numero_decimal(item.get("valor"))
    bonificacao = normalizar_numero_decimal(item.get("bonificacao"))
    descontos = normalizar_numero_decimal(item.get("descontos"))
    return arredondar_moeda(valor + bonificacao - descontos)


def calcular_valor_base_conta_receber(dados: ContaReceberIn) -> float:
    """Calcula o valor base a armazenar na coluna 'valor' do banco.

    Prioriza o cálculo por hora quando ambos os campos estão preenchidos.
    Este é o valor armazenado na coluna valor — bonificacao e descontos
    ficam no JSON 'dados' e são aplicados em calcular_total_conta_receber().
    """
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
    """Lista contas a receber com filtros opcionais.

    Filtros no banco: data_inicial, data_final, contrato.
    Filtros em Python (campos no JSON 'dados'): tomador, veiculo_id.
    Retorna em ordem decrescente de data_inicio.
    Cada item inclui valor_total_receber calculado dinamicamente.
    """
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
    """Relatório especializado para serviços faturados por hora de máquina.

    Filtra apenas contas com quantidade_horas > 0 e agrega:
    total de horas, dias trabalhados (datas únicas) e valor total.
    Chamado pelo frontend na aba de relatório de horas de máquina.
    """
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
    """Cria uma nova conta a receber (frete, serviço ou hora de máquina).

    Validações de negócio:
      - desconto_classificacao, se informado, deve existir na lista ativa
      - desconto_classificacao deve ser uma despesa (grupo 2.x), não receita
    O campo valor no banco armazena apenas o valor base (sem bonificacao/descontos).
    Os campos extras ficam serializados no JSON 'dados'.
    """
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
    """Atualiza apenas o status de pagamento de uma conta a receber.

    Chamado pelo frontend quando o usuário clica em "Marcar como recebido"
    sem precisar editar os outros campos do registro.
    Ao marcar como "recebido", registra automaticamente a data de hoje
    no campo data_recebimento dentro do JSON 'dados'.
    Ao reverter para "pendente", limpa a data_recebimento.
    """
    eid = obter_empresa()
    with sessao_db() as db:
        c = db.query(ContaReceber).filter(ContaReceber.empresa_id == eid, ContaReceber.id == conta_id).first()
        if not c:
            raise HTTPException(status_code=404, detail="Conta a receber nao encontrada.")
        c.status_pagamento = dados.status_pagamento
        ex = json.loads(c.dados or "{}")
        # Define data_recebimento automaticamente ao marcar como recebido
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
# ENDPOINTS DE ATIVOS (Patrimônio Ativo)
# =========================================================
# Ativos são bens de propriedade da empresa (veículos, máquinas, imóveis).
# Junto com os passivos, compõem o patrimônio líquido da empresa.
# Protegido pelo middleware (prefixo /ativos em ROTAS_PROTEGIDAS).

@app.get("/ativos")
def listar_ativos():
    """Lista todos os ativos da empresa ordenados por nome."""
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


# =========================================================
# ENDPOINTS DE PASSIVOS (Patrimônio Passivo / Dívidas)
# =========================================================
# Passivos são obrigações financeiras (financiamentos, empréstimos, dívidas).
# Protegido pelo middleware (prefixo /passivos em ROTAS_PROTEGIDAS).

@app.get("/passivos")
def listar_passivos():
    """Lista todos os passivos da empresa ordenados por data de vencimento."""
    eid = obter_empresa()
    with sessao_db() as db:
        registros = db.query(Passivo).filter(Passivo.empresa_id == eid).all()
        result = [passivo_para_dict(p) for p in registros]
        result.sort(key=lambda x: x.get("data_vencimento", ""))
        return result


def _extras_passivo(dados: PassivoIn) -> dict:
    """Monta o dict de campos extras para serializar no JSON 'dados' do Passivo."""
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


# =========================================================
# ENDPOINTS DE ESTOQUE (Produtos e Movimentações)
# =========================================================
# Controle de estoque de insumos (peças, combustível, materiais, etc.).
# Integrado com lançamentos: saídas de estoque podem ser vinculadas
# a lançamentos financeiros automaticamente.
# Protegido pelo middleware (prefixo /estoque em ROTAS_PROTEGIDAS).

@app.get("/estoque/produtos/busca")
def buscar_produtos_estoque_autocomplete(q: str = ""):
    """Busca rápida de produtos para o autocomplete do campo de vínculo em lançamentos.

    Retorna lista compacta: id, nome, quantidade_atual, unidade_medida, estoque_minimo.
    Filtra por nome (case-insensitive) se 'q' for informado.
    Usado pelo frontend para preencher o campo de vínculo com estoque.
    """
    eid = obter_empresa()
    with sessao_db() as db:
        query = db.query(EstoqueProduto).filter(EstoqueProduto.empresa_id == eid)
        if q.strip():
            query = query.filter(EstoqueProduto.nome.ilike(f"%{q.strip()}%"))
        produtos = query.order_by(EstoqueProduto.nome).limit(20).all()
        return [
            {
                "id": ep.id,
                "nome": ep.nome,
                "quantidade_atual": float(ep.quantidade or 0),
                "unidade_medida": json.loads(ep.dados or "{}").get("unidade_medida", "un"),
                "estoque_minimo": float(json.loads(ep.dados or "{}").get("estoque_minimo", 0)),
            }
            for ep in produtos
        ]


@app.get("/estoque/produtos")
def listar_produtos_estoque(nome: Optional[str] = None, categoria: Optional[str] = None, estoque_baixo: Optional[bool] = None):
    """Lista produtos do estoque com filtros opcionais.

    O filtro estoque_baixo=true retorna apenas produtos com quantidade <= mínimo.
    Filtros nome e categoria são aplicados no banco (ILIKE).
    estoque_baixo é aplicado em Python (campo calculado, não armazenado).
    """
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
    """Registra uma movimentação manual de estoque (entrada, saída ou ajuste).

    Efeitos na quantidade do produto:
      - Entrada: quantidade += dados.quantidade
      - Saida:   quantidade -= dados.quantidade (valida saldo suficiente)
      - Ajuste:  quantidade  = dados.quantidade (substitui, para inventário)

    Nas entradas, se valor_unitario for informado, atualiza o custo do produto.
    Todas as movimentações ficam registradas no histórico (tabela estoque_movimentacoes).
    """
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
            # Ajuste: substitui a quantidade atual pelo valor do inventário
            ep.quantidade = quantidade
        ex_prod = json.loads(ep.dados or "{}")
        # Nas entradas, atualiza o custo unitário do produto se informado
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
# RELATÓRIOS FINANCEIROS
# =========================================================
# Endpoints que consolidam dados de lançamentos e contas a receber
# em diferentes visões: por período, veículo, classificação, empresa.
# Todos usam a função central montar_relatorio_completo() que carrega
# e agrega os dados uma única vez.
# Protegido pelo middleware (prefixo /relatorios em ROTAS_PROTEGIDAS).

def filtrar_lancamentos_relatorio(
    data_inicial: Optional[date] = None,
    data_final: Optional[date] = None,
    veiculo_id: Optional[int] = None,
    empresa_id: Optional[int] = None,
    classificacao: Optional[str] = None,
    obra_servico: Optional[str] = None,
):
    """Wrapper de listar_lancamentos() para uso interno nos relatórios.

    Permite que as funções de relatório passem filtros sem replicar a assinatura.
    """
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
    """Wrapper de listar_contas_receber() para uso interno nos relatórios."""
    return listar_contas_receber(
        data_inicial=data_inicial,
        data_final=data_final,
        veiculo_id=veiculo_id,
    )


def somar_lancamentos(lancamentos, predicado) -> float:
    """Soma os valores dos lançamentos que satisfazem o predicado de classificação.

    O predicado é uma das funções: eh_receita, eh_custo, eh_despesa, eh_investimento.
    Usado em montar_resumo_financeiro() para calcular os totais por categoria.
    """
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
# MOTORISTA APP — API exclusiva para o app mobile dos motoristas
#
# Todas as rotas /motorista-app/* são públicas no middleware
# global (não estão em ROTAS_PROTEGIDAS), pois usam um token
# JWT diferente ("motorista_access"). A validação é feita
# manualmente via _obter_motorista_acesso() em cada endpoint.
#
# Fluxo completo de uso pelo motorista:
#   1. POST /motorista-app/login         → obtém token (validade 30 dias)
#   2. GET  /motorista-app/me            → carrega estado inicial (viagem ativa?)
#   3. POST /motorista-app/viagem/iniciar → cria viagem com km inicial
#   4. POST /motorista-app/localizacao   → envia GPS a cada 10s (aba mapa)
#   5. POST /motorista-app/viagem/{id}/ponto → salva ponto na rota da viagem
#   6. PUT  /motorista-app/viagem/{id}/finalizar → fecha viagem com km final
#   7. GET  /motorista-app/viagens       → histórico de todas as viagens
# =========================================================

def _obter_motorista_acesso(request: Request, db) -> MotoristaAcesso:
    """
    Valida o token JWT de motorista e retorna o MotoristaAcesso correspondente.
    Usado como guard em todos os endpoints /motorista-app/* que exigem login.
    Lança HTTP 401 se o token for inválido ou o acesso estiver desativado.
    """
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
    """
    Autenticação do motorista no app mobile.
    Retorna um token JWT com validade de 30 dias e dados básicos do perfil.
    Usa a mesma chave secreta do sistema, mas com type='motorista_access'.
    """
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
        # Busca dados do cadastro do motorista vinculado (CNH, telefone, cargo)
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
    """
    Retorna perfil do motorista logado e a viagem ativa (se houver).
    Chamado ao abrir o app para restaurar estado sem novo login.
    A viagem_ativa == null indica que nenhuma viagem está em andamento.
    """
    with sessao_db() as db:
        acesso = _obter_motorista_acesso(request, db)
        motorista = db.get(Motorista, acesso.motorista_id) if acesso.motorista_id else None
        # Um motorista só pode ter UMA viagem "em_andamento" por vez
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
    """
    Registra o início de uma viagem.
    Bloqueia se já houver uma viagem em andamento para o mesmo motorista.
    A rota começa como array JSON vazio e é preenchida via /ponto.
    """
    with sessao_db() as db:
        acesso = _obter_motorista_acesso(request, db)
        # Garante que só existe uma viagem ativa por vez
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
            rota="[]",  # será preenchido via POST /ponto a cada 10 segundos
        )
        db.add(viagem)
        db.commit()
        db.refresh(viagem)
        return {"id": viagem.id, "status": viagem.status, "data_inicio": viagem.data_inicio.isoformat()}


@app.put("/motorista-app/viagem/{viagem_id}/finalizar")
def finalizar_viagem(viagem_id: int, dados: dict, request: Request):
    """
    Finaliza a viagem, registrando km final e calculando km total percorrido.
    Após finalizar, o motorista pode iniciar uma nova viagem.
    """
    with sessao_db() as db:
        acesso = _obter_motorista_acesso(request, db)
        viagem = db.query(Viagem).filter(
            Viagem.id == viagem_id,
            Viagem.motorista_acesso_id == acesso.id  # garante que o motorista só finaliza a própria viagem
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
    """
    Adiciona um ponto GPS à rota da viagem ativa.
    Chamado a cada ~10 segundos pelo app mobile enquanto o GPS estiver ativo.
    O campo Viagem.rota é um JSON array que cresce durante a viagem
    e fica disponível para exibir o trajeto completo no mapa.
    """
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
            "ts": dados.get("ts", ""),  # timestamp ISO 8601 do dispositivo
        })
        viagem.rota = json.dumps(rota)
        db.commit()
        return {"pontos": len(rota)}


@app.post("/motorista-app/localizacao")
def atualizar_localizacao_motorista(dados: dict, request: Request):
    """
    Atualiza a posição atual do motorista na tabela motorista_localizacoes.
    Faz UPSERT: se já existe registro para o motorista, atualiza; senão, cria.
    Isso garante que a tabela tenha sempre apenas UM registro por motorista
    (a posição mais recente), sem crescimento ilimitado.

    O app mobile chama este endpoint a cada 10 segundos enquanto o GPS está ativo.
    A aba Mapa do painel financeiro consome este endpoint via GET /mapa/motoristas.

    Regra de "online": motorista é considerado online se o timestamp
    desta tabela for de menos de 5 minutos atrás (ver /mapa/motoristas).
    """
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
            # Atualiza registro existente (upsert manual)
            loc.lat = float(dados.get("lat", 0))
            loc.lng = float(dados.get("lng", 0))
            loc.velocidade = float(dados.get("velocidade") or 0)
            loc.heading = float(dados.get("heading") or 0)  # direção em graus (0=Norte)
            loc.viagem_id = viagem_ativa.id if viagem_ativa else None
            loc.nome = acesso.nome
            loc.timestamp = datetime.now(timezone.utc)
        else:
            # Primeira vez que o motorista envia GPS — cria registro
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
    """
    Retorna o histórico das últimas 50 viagens do motorista logado.
    Inclui km_total calculado (km_final - km_inicial) para exibição no app.
    Ordenado da mais recente para a mais antiga.
    """
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
# MAPA — Posições em tempo real consumidas pelo painel financeiro
#
# Esta rota é acessada pela aba "Mapa" do app financeiro.
# Requer token de usuário administrativo (está em ROTAS_PROTEGIDAS).
# Retorna apenas motoristas da empresa do usuário logado.
#
# Regra de status "online":
#   - timestamp < 5 minutos atrás  → online = True  (GPS ativo)
#   - timestamp >= 5 minutos atrás → online = False (GPS pausado ou app fechado)
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
