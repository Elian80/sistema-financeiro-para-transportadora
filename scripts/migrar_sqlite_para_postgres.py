from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))

from sqlalchemy import text

from backend.database import Base, SessionLocal, engine, garantir_colunas_runtime
from backend.models import Empresa, Usuario


SQLITE_PATH = ROOT / "python" / "data" / "financeiro_dev.db"


def row_to_dict(cursor: sqlite3.Cursor, row: tuple) -> dict:
    return {column[0]: value for column, value in zip(cursor.description, row)}


def copiar_empresa(db, item: dict) -> bool:
    existente = db.query(Empresa).filter(Empresa.nome == item["nome"]).first()
    if not existente:
        por_id = db.get(Empresa, item["id"])
        if por_id and por_id.nome == item["nome"]:
            existente = por_id
    if existente:
        for campo in ["nome", "nome_fantasia", "cnpj", "inscricao_estadual", "telefone", "email", "endereco", "cidade", "estado", "cep", "logo", "observacoes", "status"]:
            if campo in item:
                valor = item.get(campo) or ""
                setattr(existente, campo, None if campo == "cnpj" and not valor else valor)
        return False

    db.add(Empresa(
        id=item["id"],
        nome=item.get("nome") or "Empresa",
        nome_fantasia=item.get("nome_fantasia") or "",
        cnpj=item.get("cnpj") or None,
        inscricao_estadual=item.get("inscricao_estadual") or "",
        telefone=item.get("telefone") or "",
        email=item.get("email") or "",
        endereco=item.get("endereco") or "",
        cidade=item.get("cidade") or "",
        estado=item.get("estado") or "",
        cep=item.get("cep") or "",
        logo=item.get("logo") or "",
        observacoes=item.get("observacoes") or "",
        status=item.get("status") or "ativo",
    ))
    return True


def copiar_usuario(db, item: dict) -> bool:
    existente = db.query(Usuario).filter(Usuario.email == item["email"]).first()
    if not existente:
        por_id = db.get(Usuario, item["id"])
        if por_id and por_id.email == item["email"]:
            existente = por_id
    if existente:
        for campo in ["empresa_id", "nome", "email", "senha_hash", "perfil", "status", "telefone", "cargo", "deve_trocar_senha"]:
            if campo in item:
                setattr(existente, campo, item.get(campo))
        return False

    db.add(Usuario(
        empresa_id=item.get("empresa_id") or 1,
        nome=item.get("nome") or item.get("email") or "Usuario",
        email=item.get("email") or "",
        senha_hash=item.get("senha_hash") or "",
        perfil=item.get("perfil") or "operador",
        status=item.get("status") or "ativo",
        telefone=item.get("telefone") or "",
        cargo=item.get("cargo") or "",
        ultimo_login=item.get("ultimo_login"),
        deve_trocar_senha=bool(item.get("deve_trocar_senha")),
    ))
    return True


def main() -> None:
    if not SQLITE_PATH.exists():
        raise SystemExit(f"SQLite antigo nao encontrado: {SQLITE_PATH}")

    Base.metadata.create_all(bind=engine)
    garantir_colunas_runtime()

    sqlite = sqlite3.connect(SQLITE_PATH)
    db = SessionLocal()
    try:
        cursor = sqlite.cursor()

        cursor.execute("select * from empresas order by id")
        empresas = [row_to_dict(cursor, row) for row in cursor.fetchall()]
        novas_empresas = sum(1 for item in empresas if copiar_empresa(db, item))
        db.flush()

        cursor.execute("select * from usuarios order by id")
        usuarios = [row_to_dict(cursor, row) for row in cursor.fetchall()]
        novos_usuarios = sum(1 for item in usuarios if copiar_usuario(db, item))

        db.flush()
        db.execute(text("select setval(pg_get_serial_sequence('empresas','id'), coalesce((select max(id) from empresas), 1), true)"))
        db.execute(text("select setval(pg_get_serial_sequence('usuarios','id'), coalesce((select max(id) from usuarios), 1), true)"))
        db.commit()
        print(f"Empresas no SQLite: {len(empresas)} | novas no PostgreSQL: {novas_empresas}")
        print(f"Usuarios no SQLite: {len(usuarios)} | novos no PostgreSQL: {novos_usuarios}")
    finally:
        db.close()
        sqlite.close()


if __name__ == "__main__":
    main()
