#!/usr/bin/env python3
"""
Migra dados dos arquivos JSON para o PostgreSQL.
Execute uma vez: python migrate_to_postgres.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import text

from backend.database import SessionLocal
from backend.models import (
    Ativo,
    ContaReceber,
    EstoqueMovimentacao,
    EstoqueProduto,
    Lancamento,
    Motorista,
    Passivo,
    PlanoConta,
    Veiculo,
)

DATA_DIR = Path(__file__).parent / "data"


def ler(caminho: Path) -> list:
    if not caminho.exists():
        return []
    try:
        dados = json.loads(caminho.read_text(encoding="utf-8"))
        return dados if isinstance(dados, list) else []
    except Exception as e:
        print(f"  AVISO: nao foi possivel ler {caminho.name}: {e}")
        return []


def migrar_veiculos(empresa_id: int, data_dir: Path, db, id_offset: int = 0) -> dict:
    """Retorna mapeamento old_id -> new_id."""
    mapa = {}
    total = 0
    for item in ler(data_dir / "veiculos.json"):
        old_id = item.get("id")
        if not old_id:
            continue
        new_id = old_id + id_offset

        if db.get(Veiculo, new_id):
            mapa[old_id] = new_id
            continue

        v = Veiculo(
            id=new_id,
            empresa_id=empresa_id,
            nome=item.get("nome", ""),
            marca=item.get("marca", ""),
            modelo=item.get("modelo", ""),
            ano=str(item.get("ano", "")),
            placa=item.get("placa", ""),
            tipo=item.get("tipo", "Caminhao"),
            status=item.get("status", "Ativo"),
            observacao=item.get("observacao", ""),
            foto=item.get("foto", ""),
        )
        db.add(v)
        mapa[old_id] = new_id
        total += 1
    db.flush()
    print(f"  Veiculos: {total} inseridos ({len(mapa)} total no mapa)")
    return mapa


def migrar_motoristas(empresa_id: int, data_dir: Path, db, id_offset: int = 0) -> dict:
    mapa = {}
    total = 0
    for item in ler(data_dir / "motoristas.json"):
        old_id = item.get("id")
        if not old_id:
            continue
        new_id = old_id + id_offset

        if db.get(Motorista, new_id):
            mapa[old_id] = new_id
            continue

        extras = {k: item.get(k, v) for k, v in {
            "lotacao": "", "pis": "", "banco": "", "agencia": "", "conta": "",
            "tipo_conta": "", "empregador": "", "empregador_cnpj": "",
            "salario_base": 0.0, "carga_horaria_mensal": 220.0,
            "valor_hora_extra": 0.0, "inss_percentual": 0.0,
            "irrf_percentual": 0.0, "vale_refeicao": 0.0,
            "convenio_medico": 0.0, "outros_descontos_padrao": 0.0,
        }.items()}

        m = Motorista(
            id=new_id,
            empresa_id=empresa_id,
            nome=item.get("nome", ""),
            telefone=item.get("telefone", ""),
            cnh=item.get("cnh", ""),
            cargo=item.get("cargo", ""),
            admissao=item.get("admissao") or None,
            dados=json.dumps(extras, ensure_ascii=False),
        )
        db.add(m)
        mapa[old_id] = new_id
        total += 1
    db.flush()
    print(f"  Motoristas: {total} inseridos")
    return mapa


def migrar_lancamentos(empresa_id: int, data_dir: Path, db, veiculo_mapa: dict, id_offset: int = 0):
    total = 0
    for item in ler(data_dir / "lancamentos.json"):
        old_id = item.get("id")
        if not old_id:
            continue
        new_id = old_id + id_offset

        if db.get(Lancamento, new_id):
            continue

        old_veiculo_id = item.get("veiculo_id")
        new_veiculo_id = veiculo_mapa.get(old_veiculo_id, old_veiculo_id) if old_veiculo_id else None

        extras = {
            "veiculo_id": new_veiculo_id,
            "empresa_id": item.get("empresa_id"),
            "obra_servico": item.get("obra_servico", ""),
            "kilometragem": item.get("kilometragem"),
            "litros": item.get("litros"),
            "numero_nf": item.get("numero_nf", ""),
            "data_nf": str(item.get("data_nf", "")) if item.get("data_nf") else "",
        }

        l = Lancamento(
            id=new_id,
            empresa_id=empresa_id,
            data=item.get("data") or None,
            classificacao=item.get("classificacao", ""),
            descricao=item.get("descricao", ""),
            valor=float(item.get("valor") or 0),
            tipo_financeiro=item.get("tipo_financeiro", ""),
            dados=json.dumps(extras, ensure_ascii=False),
        )
        db.add(l)
        total += 1
    db.flush()
    print(f"  Lancamentos: {total} inseridos")


def migrar_contas_receber(empresa_id: int, data_dir: Path, db, veiculo_mapa: dict, id_offset: int = 0):
    total = 0
    for item in ler(data_dir / "contas_receber.json"):
        old_id = item.get("id")
        if not old_id:
            continue
        new_id = old_id + id_offset

        if db.get(ContaReceber, new_id):
            continue

        old_veiculo_id = item.get("veiculo_id")
        new_veiculo_id = veiculo_mapa.get(old_veiculo_id, old_veiculo_id) if old_veiculo_id else None

        extras = {
            "cte_ticket": item.get("cte_ticket", ""),
            "valor_hora_unitario": float(item.get("valor_hora_unitario") or 0),
            "quantidade_horas": float(item.get("quantidade_horas") or 0),
            "carga": item.get("carga", ""),
            "ton_qnt": item.get("ton_qnt", ""),
            "tomador": item.get("tomador", ""),
            "origem_destino": item.get("origem_destino", ""),
            "bonificacao": float(item.get("bonificacao") or 0),
            "veiculo_id": new_veiculo_id,
            "descontos": float(item.get("descontos") or 0),
            "desconto_classificacao": item.get("desconto_classificacao", ""),
            "data_recebimento": str(item.get("data_recebimento", "")) if item.get("data_recebimento") else "",
        }

        c = ContaReceber(
            id=new_id,
            empresa_id=empresa_id,
            data_inicio=item.get("data_inicio") or None,
            contrato=item.get("contrato", ""),
            valor=float(item.get("valor") or 0),
            status_pagamento=(item.get("status_pagamento") or "pendente").lower(),
            dados=json.dumps(extras, ensure_ascii=False),
        )
        db.add(c)
        total += 1
    db.flush()
    print(f"  Contas a receber: {total} inseridas")


def migrar_ativos(empresa_id: int, data_dir: Path, db, veiculo_mapa: dict, id_offset: int = 0):
    total = 0
    for item in ler(data_dir / "ativos.json"):
        old_id = item.get("id")
        if not old_id:
            continue
        new_id = old_id + id_offset

        if db.get(Ativo, new_id):
            continue

        old_veiculo_id = item.get("veiculo_id")
        new_veiculo_id = veiculo_mapa.get(old_veiculo_id, old_veiculo_id) if old_veiculo_id else None

        extras = {
            "tipo": item.get("tipo", "Outro"),
            "data_aquisicao": str(item.get("data_aquisicao", "")) if item.get("data_aquisicao") else "",
            "veiculo_id": new_veiculo_id,
            "observacao": item.get("observacao", ""),
            "status": item.get("status", "Ativo"),
        }

        a = Ativo(
            id=new_id,
            empresa_id=empresa_id,
            nome=item.get("nome", ""),
            valor=float(item.get("valor") or 0),
            dados=json.dumps(extras, ensure_ascii=False),
        )
        db.add(a)
        total += 1
    db.flush()
    print(f"  Ativos: {total} inseridos")


def migrar_passivos(empresa_id: int, data_dir: Path, db, id_offset: int = 0):
    total = 0
    for item in ler(data_dir / "passivos.json"):
        old_id = item.get("id")
        if not old_id:
            continue
        new_id = old_id + id_offset

        if db.get(Passivo, new_id):
            continue

        valor_total = float(item.get("valor_total") or 0)
        extras = {
            "tipo": item.get("tipo", "Outro"),
            "valor_total": valor_total,
            "valor_pago": float(item.get("valor_pago") or 0),
            "data_inicio": str(item.get("data_inicio", "")) if item.get("data_inicio") else "",
            "data_vencimento": str(item.get("data_vencimento", "")) if item.get("data_vencimento") else "",
            "observacao": item.get("observacao", ""),
            "status": item.get("status", "Pendente"),
        }

        p = Passivo(
            id=new_id,
            empresa_id=empresa_id,
            nome=item.get("nome", ""),
            valor=valor_total,
            dados=json.dumps(extras, ensure_ascii=False),
        )
        db.add(p)
        total += 1
    db.flush()
    print(f"  Passivos: {total} inseridos")


def migrar_estoque_produtos(empresa_id: int, data_dir: Path, db, id_offset: int = 0) -> dict:
    mapa = {}
    total = 0
    for item in ler(data_dir / "estoque_produtos.json"):
        old_id = item.get("id")
        if not old_id:
            continue
        new_id = old_id + id_offset

        if db.get(EstoqueProduto, new_id):
            mapa[old_id] = new_id
            continue

        extras = {
            "unidade_medida": item.get("unidade_medida", "un"),
            "valor_custo": float(item.get("valor_custo") or 0),
            "estoque_minimo": float(item.get("estoque_minimo") or 0),
            "observacao": item.get("observacao", ""),
        }

        ep = EstoqueProduto(
            id=new_id,
            empresa_id=empresa_id,
            nome=item.get("nome", ""),
            categoria=item.get("categoria", ""),
            quantidade=float(item.get("quantidade_atual") or 0),
            dados=json.dumps(extras, ensure_ascii=False),
        )
        db.add(ep)
        mapa[old_id] = new_id
        total += 1
    db.flush()
    print(f"  Estoque produtos: {total} inseridos")
    return mapa


def migrar_estoque_movimentacoes(empresa_id: int, data_dir: Path, db, produto_mapa: dict, id_offset: int = 0):
    total = 0
    for item in ler(data_dir / "estoque_movimentacoes.json"):
        old_id = item.get("id")
        if not old_id:
            continue
        new_id = old_id + id_offset

        if db.get(EstoqueMovimentacao, new_id):
            continue

        old_produto_id = item.get("produto_id")
        new_produto_id = produto_mapa.get(old_produto_id, old_produto_id) if old_produto_id else None

        extras = {
            "valor_unitario": float(item.get("valor_unitario") or 0),
            "data": str(item.get("data", "")) if item.get("data") else "",
            "observacao": item.get("observacao", ""),
        }

        em = EstoqueMovimentacao(
            id=new_id,
            empresa_id=empresa_id,
            produto_id=new_produto_id,
            tipo=item.get("tipo_movimentacao", ""),
            quantidade=float(item.get("quantidade") or 0),
            dados=json.dumps(extras, ensure_ascii=False),
        )
        db.add(em)
        total += 1
    db.flush()
    print(f"  Estoque movimentacoes: {total} inseridas")


def migrar_plano_contas(empresa_id: int, data_dir: Path, db, id_offset: int = 0):
    total = 0
    for item in ler(data_dir / "plano_contas.json"):
        old_id = item.get("id")
        if not old_id:
            continue
        new_id = old_id + id_offset

        if db.get(PlanoConta, new_id):
            continue

        pc = PlanoConta(
            id=new_id,
            empresa_id=empresa_id,
            nome=item.get("nome", ""),
        )
        db.add(pc)
        total += 1
    db.flush()
    print(f"  Plano de contas: {total} inseridos")


def atualizar_sequences(db):
    tabelas = [
        "veiculos", "motoristas", "lancamentos", "contas_receber",
        "ativos", "passivos", "estoque_produtos", "estoque_movimentacoes", "plano_contas",
    ]
    for tabela in tabelas:
        db.execute(text(
            f"SELECT setval(pg_get_serial_sequence('{tabela}', 'id'), "
            f"COALESCE((SELECT MAX(id) FROM {tabela}), 1))"
        ))
    db.commit()
    print("\nSequences PostgreSQL atualizados.")


def migrar_empresa(empresa_id: int, data_dir: Path, db, id_offset: int = 0):
    print(f"\n=== Empresa {empresa_id} ({data_dir.name}) ===")
    veiculo_mapa = migrar_veiculos(empresa_id, data_dir, db, id_offset)
    motorista_mapa = migrar_motoristas(empresa_id, data_dir, db, id_offset)  # noqa: F841
    migrar_lancamentos(empresa_id, data_dir, db, veiculo_mapa, id_offset)
    migrar_contas_receber(empresa_id, data_dir, db, veiculo_mapa, id_offset)
    migrar_ativos(empresa_id, data_dir, db, veiculo_mapa, id_offset)
    migrar_passivos(empresa_id, data_dir, db, id_offset)
    produto_mapa = migrar_estoque_produtos(empresa_id, data_dir, db, id_offset)
    migrar_estoque_movimentacoes(empresa_id, data_dir, db, produto_mapa, id_offset)
    migrar_plano_contas(empresa_id, data_dir, db, id_offset)
    db.commit()
    print(f"  Commit OK.")


if __name__ == "__main__":
    print("Iniciando migracao JSON -> PostgreSQL...")
    db = SessionLocal()
    try:
        migrar_empresa(1, DATA_DIR, db, id_offset=0)

        empresa3_dir = DATA_DIR / "empresas" / "3"
        if empresa3_dir.exists():
            migrar_empresa(3, empresa3_dir, db, id_offset=10000)

        atualizar_sequences(db)
        print("\nMigracao concluida com sucesso!")
    except Exception as e:
        db.rollback()
        print(f"\nERRO: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()
