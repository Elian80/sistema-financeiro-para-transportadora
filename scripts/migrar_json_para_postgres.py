import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))

from backend.database import Base, SessionLocal, engine
from backend.models import (
    Ativo,
    ContaReceber,
    Empresa,
    EstoqueMovimentacao,
    EstoqueProduto,
    Lancamento,
    Motorista,
    Passivo,
    PlanoConta,
    Usuario,
    Veiculo,
)
from backend.security import gerar_hash_senha


DATA_DIR = ROOT / "python" / "data"
LOG_PATH = ROOT / "backups" / "migracao_json_postgres.log"


MAPA = {
    "veiculos.json": Veiculo,
    "motoristas.json": Motorista,
    "lancamentos.json": Lancamento,
    "contas_receber.json": ContaReceber,
    "ativos.json": Ativo,
    "passivos.json": Passivo,
    "estoque_produtos.json": EstoqueProduto,
    "estoque_movimentacoes.json": EstoqueMovimentacao,
    "plano_contas.json": PlanoConta,
}


def ler_json(nome: str) -> list[dict]:
    caminho = DATA_DIR / nome
    if not caminho.exists():
        return []
    with caminho.open("r", encoding="utf-8") as arquivo:
        dados = json.load(arquivo)
    return dados if isinstance(dados, list) else []


def preencher_campos_basicos(objeto, item: dict) -> None:
    if hasattr(objeto, "nome"):
        objeto.nome = str(item.get("nome") or item.get("descricao") or "")
    if hasattr(objeto, "valor"):
        objeto.valor = float(item.get("valor") or item.get("valor_total_receber") or 0)
    if hasattr(objeto, "dados"):
        objeto.dados = json.dumps(item, ensure_ascii=False)


def main() -> None:
    Base.metadata.create_all(bind=engine)
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

    db = SessionLocal()
    try:
        empresa = db.query(Empresa).filter(Empresa.nome == "GM7 Solucoes").first()
        if not empresa:
            empresa = Empresa(nome="GM7 Solucoes", status="ativo")
            db.add(empresa)
            db.flush()

        admin = db.query(Usuario).filter(Usuario.email == "admin@sistema.local").first()
        if not admin:
            admin = Usuario(
                empresa_id=empresa.id,
                nome="Administrador",
                email="admin@sistema.local",
                senha_hash=gerar_hash_senha("trocar123"),
                perfil="admin",
                status="ativo",
                deve_trocar_senha=True,
            )
            db.add(admin)

        linhas_log = [f"Empresa padrao: {empresa.id} - {empresa.nome}", "Admin inicial: admin@sistema.local / trocar123"]

        for arquivo, modelo in MAPA.items():
            dados = ler_json(arquivo)
            migrados = 0
            for item in dados:
                objeto = modelo(empresa_id=empresa.id)
                preencher_campos_basicos(objeto, item)
                db.add(objeto)
                migrados += 1
            linhas_log.append(f"{arquivo}: {migrados} registro(s)")

        db.commit()
        LOG_PATH.write_text("\n".join(linhas_log), encoding="utf-8")
        print("\n".join(linhas_log))
    finally:
        db.close()


if __name__ == "__main__":
    main()
