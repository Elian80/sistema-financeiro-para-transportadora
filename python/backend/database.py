"""
database.py — Configuração da conexão com o banco de dados via SQLAlchemy.

Suporta dois bancos:
  - SQLite: usado em desenvolvimento local (arquivo .db no disco)
  - PostgreSQL: usado em produção (configurado via DATABASE_URL no .env)

A URL do banco é lida de settings.py, que por sua vez lê variáveis de ambiente.
"""

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .settings import settings


def preparar_sqlite_local(database_url: str) -> None:
    """Garante que o diretório do arquivo SQLite exista antes de criar o banco.

    Só executa se a URL for do tipo sqlite com caminho de arquivo.
    Para PostgreSQL ou SQLite em memória (:memory:), não faz nada.
    """
    url = make_url(database_url)
    if url.drivername != "sqlite" or not url.database or url.database == ":memory:":
        return
    Path(url.database).expanduser().parent.mkdir(parents=True, exist_ok=True)


preparar_sqlite_local(settings.database_url)

# Parâmetros de criação do engine — pool_pre_ping testa a conexão antes de usar
engine_kwargs = {"pool_pre_ping": True}
if settings.database_url.startswith("sqlite"):
    # SQLite não suporta múltiplas threads sem esse parâmetro
    engine_kwargs["connect_args"] = {"check_same_thread": False}

# Engine: objeto de baixo nível que gerencia o pool de conexões com o banco
engine = create_engine(settings.database_url, **engine_kwargs)

# SessionLocal: fábrica de sessões. Cada requisição HTTP recebe uma sessão própria.
# autoflush=False e autocommit=False dão controle explícito das transações.
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Classe base para todos os modelos ORM do sistema.

    Todos os modelos em models.py herdam desta classe.
    O SQLAlchemy usa ela para descobrir todas as tabelas ao criar o schema.
    """
    pass


def get_db() -> Generator[Session, None, None]:
    """Dependency do FastAPI que fornece uma sessão de banco por requisição.

    Uso nos endpoints:
        def meu_endpoint(db: Session = Depends(get_db)): ...

    A sessão é fechada automaticamente ao final da requisição, mesmo em caso de erro.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def garantir_colunas_runtime() -> None:
    """Adiciona colunas novas em bancos já existentes sem apagar dados.

    Executado na inicialização do servidor. Permite adicionar campos
    novos ao schema sem precisar rodar migrations do Alembic para
    bancos SQLite de desenvolvimento que já possuem dados.

    Para PostgreSQL em produção, use as migrations Alembic em vez disso.
    """
    # Mapa: tabela → {nome_coluna: DDL_SQL}
    colunas = {
        "empresas": {
            "nome_fantasia": "VARCHAR(160) DEFAULT '' NOT NULL",
            "inscricao_estadual": "VARCHAR(40) DEFAULT '' NOT NULL",
            "cidade": "VARCHAR(120) DEFAULT '' NOT NULL",
            "estado": "VARCHAR(2) DEFAULT '' NOT NULL",
            "cep": "VARCHAR(12) DEFAULT '' NOT NULL",
            "logo": "TEXT DEFAULT '' NOT NULL",
            "observacoes": "TEXT DEFAULT '' NOT NULL",
        },
        "usuarios": {
            "telefone": "VARCHAR(30) DEFAULT '' NOT NULL",
            "cargo": "VARCHAR(100) DEFAULT '' NOT NULL",
        },
    }
    inspector = inspect(engine)
    with engine.begin() as conn:
        for tabela, mapa in colunas.items():
            if not inspector.has_table(tabela):
                continue
            existentes = {col["name"] for col in inspector.get_columns(tabela)}
            for coluna, ddl in mapa.items():
                if coluna not in existentes:
                    conn.execute(text(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {ddl}"))
