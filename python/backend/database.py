from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .settings import settings


def preparar_sqlite_local(database_url: str) -> None:
    url = make_url(database_url)
    if url.drivername != "sqlite" or not url.database or url.database == ":memory:":
        return
    Path(url.database).expanduser().parent.mkdir(parents=True, exist_ok=True)


preparar_sqlite_local(settings.database_url)

engine_kwargs = {"pool_pre_ping": True}
if settings.database_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(settings.database_url, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def garantir_colunas_runtime() -> None:
    """Adiciona colunas novas em bancos ja existentes sem apagar dados."""
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
