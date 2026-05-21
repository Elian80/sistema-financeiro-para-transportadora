"""
# =============================================================================
# database.py — Configuração da Conexão com o Banco de Dados (SQLAlchemy)
# =============================================================================
#
# Este módulo é o ponto central de configuração do banco de dados do sistema.
# Ele é importado por praticamente todos os outros módulos do backend.
#
# BANCOS SUPORTADOS:
#   - SQLite:     usado em desenvolvimento local (arquivo .db no disco)
#   - PostgreSQL: usado em produção (configurado via DATABASE_URL no .env)
#
# COMO A URL É DEFINIDA:
#   A URL do banco vem de settings.py, que lê a variável de ambiente
#   DATABASE_URL do arquivo .env na raiz do projeto. Exemplos:
#     SQLite:     sqlite:///./financeiro.db
#     PostgreSQL: postgresql+psycopg://user:pass@localhost:5432/financeiro
#
# OBJETOS EXPORTADOS (usados pelo resto do sistema):
#   - engine:       conexão de baixo nível com o banco (pool de conexões)
#   - SessionLocal: fábrica de sessões de banco de dados
#   - Base:         classe base para todos os modelos ORM (models.py)
#   - get_db():     dependency FastAPI que fornece sessão por requisição
#
# INICIALIZAÇÃO AUTOMÁTICA:
#   garantir_colunas_runtime() é chamado em main.py durante o startup
#   para adicionar colunas novas sem apagar dados existentes.
# =============================================================================
"""

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .settings import settings


# =============================================================================
# Preparação do ambiente SQLite (somente em desenvolvimento)
# =============================================================================

def preparar_sqlite_local(database_url: str) -> None:
    """Garante que o diretório do arquivo SQLite exista antes de criar o banco.

    O SQLAlchemy não cria diretórios automaticamente para o arquivo .db.
    Esta função verifica se o caminho do arquivo existe e o cria se necessário.
    É executada uma única vez durante a importação do módulo.

    Comportamento por tipo de banco:
        - SQLite com arquivo (ex: sqlite:///./data/financeiro.db):
          Cria o diretório 'data/' se não existir.
        - SQLite em memória (sqlite:///:memory:):
          Ignora, não há arquivo a criar.
        - PostgreSQL ou qualquer outro banco:
          Ignora, o servidor de banco cuida da existência do banco.

    Args:
        database_url: String de conexão completa, ex: "sqlite:///./financeiro.db"
    """
    url = make_url(database_url)

    # Ignora bancos que não são SQLite ou que usam memória
    if url.drivername != "sqlite" or not url.database or url.database == ":memory:":
        return

    # Resolve o caminho absoluto e cria os diretórios pai se necessário
    Path(url.database).expanduser().parent.mkdir(parents=True, exist_ok=True)


# Executa a preparação imediatamente ao importar o módulo,
# antes de tentar criar o engine (que precisaria do diretório já existente)
preparar_sqlite_local(settings.database_url)


# =============================================================================
# Criação do Engine (pool de conexões com o banco)
# =============================================================================

# Argumentos base para criação do engine.
# pool_pre_ping=True: antes de usar uma conexão do pool, testa se ela ainda
# está ativa. Evita erros "connection closed" após períodos de inatividade
# (muito comum em PostgreSQL com timeout de idle connections).
engine_kwargs = {"pool_pre_ping": True}

if settings.database_url.startswith("sqlite"):
    # SQLite não suporta acesso concurrent de múltiplas threads por padrão.
    # check_same_thread=False permite que o FastAPI (que é assíncrono e usa
    # múltiplas threads) compartilhe a mesma conexão SQLite com segurança.
    # Em PostgreSQL isso não é necessário pois o driver já é thread-safe.
    engine_kwargs["connect_args"] = {"check_same_thread": False}

# Engine: objeto de baixo nível que gerencia o pool de conexões com o banco.
# É compartilhado por toda a aplicação (singleton). Não execute queries
# diretamente no engine — use sessões (SessionLocal) para isso.
engine = create_engine(settings.database_url, **engine_kwargs)


# =============================================================================
# Fábrica de Sessões (SessionLocal)
# =============================================================================

# SessionLocal é a "classe" usada para criar novas sessões de banco.
# Cada requisição HTTP recebe uma instância separada via get_db().
#
# Configurações importantes:
#   autoflush=False:   não envia queries ao banco automaticamente antes de
#                      cada query de leitura. Dá mais controle ao desenvolvedor
#                      sobre quando os dados são escritos.
#   autocommit=False:  exige commit() explícito para persistir transações.
#                      Evita commits acidentais em caso de erros.
#   expire_on_commit=False: após db.commit(), os objetos ORM NÃO são
#                      marcados como "expirados", evitando queries extras
#                      para recarregar atributos já lidos.
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


# =============================================================================
# Classe Base dos Modelos ORM
# =============================================================================

class Base(DeclarativeBase):
    """Classe base para todos os modelos ORM do sistema financeiro.

    Todos os modelos definidos em models.py herdam desta classe.
    O SQLAlchemy usa o registro interno do DeclarativeBase para:
      - Descobrir todas as tabelas ao executar Base.metadata.create_all()
      - Mapear classes Python para tabelas do banco automaticamente

    Não adicione lógica aqui — esta classe é puramente estrutural.
    Campos comuns a todos os modelos (ex: created_at) devem ser
    definidos como Mixin separado em models.py para manter clareza.
    """
    pass


# =============================================================================
# Dependency FastAPI: Sessão de Banco por Requisição
# =============================================================================

def get_db() -> Generator[Session, None, None]:
    """Fornece uma sessão de banco de dados para cada requisição HTTP.

    Esta é uma "dependency" do FastAPI, usada com Depends() nos endpoints:

        @router.get("/exemplo")
        def endpoint(db: Session = Depends(get_db)):
            resultado = db.query(Modelo).all()
            ...

    Comportamento:
        - Abre uma nova sessão no início da requisição
        - Entrega a sessão ao endpoint via yield (padrão generator)
        - Fecha a sessão automaticamente ao final da requisição,
          independentemente de sucesso ou exceção (bloco finally)

    A sessão NÃO faz commit automaticamente — o endpoint é responsável
    por chamar db.commit() após operações de escrita.

    Yields:
        Session: Sessão SQLAlchemy pronta para uso.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        # Garante que a conexão seja devolvida ao pool mesmo em caso de erro.
        # Não chamar db.close() aqui vazaria conexões do pool ao longo do tempo.
        db.close()


# =============================================================================
# Migração Automática de Schema (desenvolvimento / rollout sem downtime)
# =============================================================================

def garantir_colunas_runtime() -> None:
    """Adiciona colunas novas em bancos existentes sem apagar dados.

    Executada durante o startup do servidor (em main.py via lifespan ou
    evento on_startup). Resolve o problema de adicionar campos novos aos
    modelos sem precisar rodar migrations manuais em desenvolvimento.

    POR QUE EXISTE ESTA FUNÇÃO:
        Em desenvolvimento com SQLite, já existem bancos de dados com dados
        reais de teste. Usar Base.metadata.create_all() apenas cria tabelas
        novas, mas não adiciona colunas em tabelas já existentes.
        Esta função preenche essa lacuna para bancos de desenvolvimento.

    PRODUCAO (PostgreSQL):
        Em produção, prefira usar migrations formais do Alembic (alembic upgrade head).
        Esta função serve como fallback seguro, pois o ALTER TABLE com coluna
        já existente é ignorado (a verificação `if coluna not in existentes` evita erro).

    COMO ADICIONAR NOVAS COLUNAS:
        1. Adicione a coluna ao modelo em models.py
        2. Adicione a entrada correspondente no dicionário `colunas` abaixo
        3. No próximo restart do servidor, a coluna será criada automaticamente
    """
    # Mapa de colunas a garantir: { nome_tabela: { nome_coluna: tipo_DDL_SQL } }
    # O DDL deve incluir DEFAULT para não quebrar linhas já existentes na tabela.
    colunas = {
        "empresas": {
            # Campos adicionados após a criação inicial do schema de empresas
            "nome_fantasia":     "VARCHAR(160) DEFAULT '' NOT NULL",
            "inscricao_estadual":"VARCHAR(40)  DEFAULT '' NOT NULL",
            "cidade":            "VARCHAR(120) DEFAULT '' NOT NULL",
            "estado":            "VARCHAR(2)   DEFAULT '' NOT NULL",
            "cep":               "VARCHAR(12)  DEFAULT '' NOT NULL",
            "logo":              "TEXT         DEFAULT '' NOT NULL",  # base64 da imagem
            "observacoes":       "TEXT         DEFAULT '' NOT NULL",
        },
        "usuarios": {
            # Campos de contato adicionados após o schema inicial de usuários
            "telefone": "VARCHAR(30)  DEFAULT '' NOT NULL",
            "cargo":    "VARCHAR(100) DEFAULT '' NOT NULL",
        },
    }

    # Inspector lê o schema real do banco (tabelas e colunas existentes)
    inspector = inspect(engine)

    # Usa engine.begin() para executar todos os ALTER TABLE em uma transação.
    # Se qualquer comando falhar, nenhuma alteração é persistida (rollback automático).
    with engine.begin() as conn:
        for tabela, mapa in colunas.items():
            # Pula tabelas que ainda não foram criadas (ex: primeiro boot sem create_all)
            if not inspector.has_table(tabela):
                continue

            # Lê os nomes das colunas já existentes na tabela
            existentes = {col["name"] for col in inspector.get_columns(tabela)}

            for coluna, ddl in mapa.items():
                # Só adiciona a coluna se ela ainda não existe, evitando erro de SQL
                if coluna not in existentes:
                    conn.execute(text(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {ddl}"))
