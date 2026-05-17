from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from .database import get_db
from .dependencies import get_current_user
from .models import AuditLog, Empresa, Motorista, MotoristaAcesso, Usuario
from .schemas import (
    AlterarSenhaIn,
    EmpresaCreate,
    EmpresaOut,
    EmpresaUpdate,
    UsuarioCreate,
    UsuarioOut,
    UsuarioUpdate,
)
from .security import criar_motorista_token, gerar_hash_senha, validar_senha_forte


router = APIRouter(tags=["admin"])


def registrar_auditoria(db: Session, request: Request, usuario: Usuario, acao: str, entidade: str, entidade_id: str, detalhes: str = "") -> None:
    db.add(AuditLog(
        empresa_id=usuario.empresa_id,
        usuario_id=usuario.id,
        acao=acao,
        entidade=entidade,
        entidade_id=entidade_id,
        detalhes=detalhes,
        ip=request.client.host if request.client else "",
    ))


def exigir_admin_ou_gestor(usuario: Usuario) -> None:
    if usuario.perfil not in {"master", "admin", "gestor"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")


def pode_gerenciar_todas_empresas(usuario: Usuario) -> bool:
    return usuario.perfil == "master"


@router.get("/empresas", response_model=list[EmpresaOut])
def listar_empresas(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    if pode_gerenciar_todas_empresas(usuario):
        return db.query(Empresa).order_by(Empresa.nome).all()
    if usuario.perfil in {"admin", "gestor"}:
        return [db.get(Empresa, usuario.empresa_id)]
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")


@router.post("/empresas", response_model=EmpresaOut)
def criar_empresa(dados: EmpresaCreate, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    if not pode_gerenciar_todas_empresas(usuario):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente master cria empresas.")
    if dados.cnpj and db.query(Empresa).filter(Empresa.cnpj == dados.cnpj).first():
        raise HTTPException(status_code=400, detail="CNPJ ja cadastrado.")
    empresa = Empresa(**dados.model_dump())
    db.add(empresa)
    db.flush()
    registrar_auditoria(db, request, usuario, "criar", "empresa", str(empresa.id))
    db.commit()
    db.refresh(empresa)
    return empresa


@router.get("/empresas/{empresa_id}", response_model=EmpresaOut)
def obter_empresa(empresa_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    if not pode_gerenciar_todas_empresas(usuario) and usuario.empresa_id != empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada.")
    return empresa


@router.put("/empresas/{empresa_id}", response_model=EmpresaOut)
def atualizar_empresa(empresa_id: int, dados: EmpresaUpdate, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    if not pode_gerenciar_todas_empresas(usuario) and usuario.empresa_id != empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada.")
    existente = db.query(Empresa).filter(Empresa.cnpj == dados.cnpj, Empresa.id != empresa_id).first() if dados.cnpj else None
    if existente:
        raise HTTPException(status_code=400, detail="CNPJ ja cadastrado.")
    for chave, valor in dados.model_dump().items():
        setattr(empresa, chave, valor)
    registrar_auditoria(db, request, usuario, "editar", "empresa", str(empresa.id))
    db.commit()
    db.refresh(empresa)
    return empresa


@router.delete("/empresas/{empresa_id}")
def excluir_empresa(empresa_id: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    if not pode_gerenciar_todas_empresas(usuario):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente master desativa empresas.")
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada.")
    empresa.status = "inativo"
    registrar_auditoria(db, request, usuario, "desativar", "empresa", str(empresa.id))
    db.commit()
    return {"mensagem": "Empresa desativada com sucesso."}


@router.post("/empresas/{empresa_id}/bloquear")
def bloquear_empresa(empresa_id: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    if not pode_gerenciar_todas_empresas(usuario):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente master bloqueia empresas.")
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada.")
    empresa.status = "bloqueado"
    registrar_auditoria(db, request, usuario, "bloquear", "empresa", str(empresa.id))
    db.commit()
    return {"mensagem": "Empresa bloqueada com sucesso."}


@router.post("/empresas/{empresa_id}/aprovar")
def aprovar_empresa(empresa_id: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    if not pode_gerenciar_todas_empresas(usuario):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente master aprova empresas.")
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada.")
    empresa.status = "ativo"
    registrar_auditoria(db, request, usuario, "aprovar", "empresa", str(empresa.id))
    db.commit()
    return {"mensagem": "Empresa aprovada com sucesso."}


@router.get("/usuarios", response_model=list[UsuarioOut])
def listar_usuarios(
    empresa_id: int | None = Query(None),
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(get_current_user),
):
    if usuario.perfil == "master":
        consulta = db.query(Usuario)
        if empresa_id:
            consulta = consulta.filter(Usuario.empresa_id == empresa_id)
        return consulta.order_by(Usuario.nome).all()
    if usuario.perfil in {"admin", "gestor"}:
        return db.query(Usuario).filter(Usuario.empresa_id == usuario.empresa_id).order_by(Usuario.nome).all()
    return [usuario]


@router.post("/usuarios", response_model=UsuarioOut)
def criar_usuario(dados: UsuarioCreate, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    exigir_admin_ou_gestor(usuario)
    empresa_id = dados.empresa_id if usuario.perfil == "master" and dados.empresa_id else usuario.empresa_id
    if usuario.perfil in {"admin", "gestor"} and empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario gerencia apenas a propria empresa.")
    if db.query(Usuario).filter(Usuario.email == dados.email.lower()).first():
        raise HTTPException(status_code=400, detail="Email ja cadastrado.")
    validar_senha_forte(dados.senha)
    novo = Usuario(
        empresa_id=empresa_id,
        nome=dados.nome,
        email=dados.email.lower(),
        senha_hash=gerar_hash_senha(dados.senha),
        perfil=dados.perfil,
        status=dados.status,
        telefone=dados.telefone,
        cargo=dados.cargo,
        deve_trocar_senha=True,
    )
    db.add(novo)
    db.flush()
    registrar_auditoria(db, request, usuario, "criar", "usuario", str(novo.id))
    db.commit()
    db.refresh(novo)
    return novo


@router.get("/usuarios/{usuario_id}", response_model=UsuarioOut)
def obter_usuario(usuario_id: int, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    alvo = db.get(Usuario, usuario_id)
    if not alvo:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    if usuario.perfil == "master" or alvo.id == usuario.id or (usuario.perfil in {"admin", "gestor"} and alvo.empresa_id == usuario.empresa_id):
        return alvo
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")


@router.put("/usuarios/{usuario_id}", response_model=UsuarioOut)
def atualizar_usuario(usuario_id: int, dados: UsuarioUpdate, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    exigir_admin_ou_gestor(usuario)
    alvo = db.get(Usuario, usuario_id)
    if not alvo:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    if usuario.perfil in {"admin", "gestor"} and alvo.empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario gerencia apenas a propria empresa.")
    alvo.nome = dados.nome
    alvo.perfil = dados.perfil
    alvo.status = dados.status
    alvo.telefone = dados.telefone
    alvo.cargo = dados.cargo
    if dados.senha:
        validar_senha_forte(dados.senha)
        alvo.senha_hash = gerar_hash_senha(dados.senha)
        alvo.deve_trocar_senha = True
    registrar_auditoria(db, request, usuario, "editar", "usuario", str(alvo.id))
    db.commit()
    db.refresh(alvo)
    return alvo


@router.delete("/usuarios/{usuario_id}")
def excluir_usuario(usuario_id: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    exigir_admin_ou_gestor(usuario)
    alvo = db.get(Usuario, usuario_id)
    if not alvo:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    if alvo.id == usuario.id:
        raise HTTPException(status_code=400, detail="Nao e possivel excluir o proprio usuario logado.")
    if alvo.perfil == "master" and usuario.perfil != "master":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente master altera outro master.")
    if usuario.perfil in {"admin", "gestor"} and alvo.empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario gerencia apenas a propria empresa.")
    alvo_id = str(alvo.id)
    alvo_email = alvo.email
    registrar_auditoria(db, request, usuario, "excluir", "usuario", alvo_id, f"Usuario excluido: {alvo_email}")
    db.delete(alvo)
    db.commit()
    return {"mensagem": "Usuario excluido com sucesso."}


@router.post("/usuarios/{usuario_id}/alterar-senha")
def alterar_senha(usuario_id: int, dados: AlterarSenhaIn, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    alvo = db.get(Usuario, usuario_id)
    if not alvo:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    if usuario.perfil not in {"master", "admin", "gestor"} and usuario.id != usuario_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")
    if usuario.perfil in {"admin", "gestor"} and alvo.empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario gerencia apenas a propria empresa.")
    validar_senha_forte(dados.senha)
    alvo.senha_hash = gerar_hash_senha(dados.senha)
    alvo.deve_trocar_senha = False
    registrar_auditoria(db, request, usuario, "alterar_senha", "usuario", str(alvo.id))
    db.commit()
    return {"mensagem": "Senha alterada com sucesso."}


@router.post("/usuarios/{usuario_id}/desativar")
def desativar_usuario(usuario_id: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    exigir_admin_ou_gestor(usuario)
    alvo = db.get(Usuario, usuario_id)
    if not alvo:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    if alvo.id == usuario.id:
        raise HTTPException(status_code=400, detail="Nao e possivel desativar o proprio usuario logado.")
    if usuario.perfil in {"admin", "gestor"} and alvo.empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario gerencia apenas a propria empresa.")
    alvo.status = "inativo"
    registrar_auditoria(db, request, usuario, "desativar", "usuario", str(alvo.id))
    db.commit()
    return {"mensagem": "Usuario desativado com sucesso."}


@router.post("/usuarios/{usuario_id}/bloquear")
def bloquear_usuario(usuario_id: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    exigir_admin_ou_gestor(usuario)
    alvo = db.get(Usuario, usuario_id)
    if not alvo:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    if usuario.perfil in {"admin", "gestor"} and alvo.empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario gerencia apenas a propria empresa.")
    alvo.status = "bloqueado"
    registrar_auditoria(db, request, usuario, "bloquear", "usuario", str(alvo.id))
    db.commit()
    return {"mensagem": "Usuario bloqueado com sucesso."}


@router.post("/usuarios/{usuario_id}/aprovar")
def aprovar_usuario(usuario_id: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    exigir_admin_ou_gestor(usuario)
    alvo = db.get(Usuario, usuario_id)
    if not alvo:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    if usuario.perfil in {"admin", "gestor"} and alvo.empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario gerencia apenas a propria empresa.")
    alvo.status = "ativo"
    registrar_auditoria(db, request, usuario, "aprovar", "usuario", str(alvo.id))
    db.commit()
    return {"mensagem": "Usuario aprovado com sucesso."}


@router.post("/usuarios/{usuario_id}/forcar-troca-senha")
def forcar_troca_senha(usuario_id: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    exigir_admin_ou_gestor(usuario)
    alvo = db.get(Usuario, usuario_id)
    if not alvo:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    alvo.deve_trocar_senha = True
    registrar_auditoria(db, request, usuario, "forcar_troca_senha", "usuario", str(alvo.id))
    db.commit()
    return {"mensagem": "Troca de senha obrigatoria ativada."}


@router.get("/admin/resumo")
def resumo_admin(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    if usuario.perfil != "master":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente master acessa o painel global.")
    return {
        "empresas": db.query(Empresa).count(),
        "empresas_bloqueadas": db.query(Empresa).filter(Empresa.status.in_(["bloqueado", "inativo"])).count(),
        "usuarios": db.query(Usuario).count(),
        "usuarios_ativos": db.query(Usuario).filter(Usuario.status == "ativo").count(),
        "usuarios_pendentes": db.query(Usuario).filter(Usuario.status == "pendente").count(),
        "ultimos_logs": [
            {
                "acao": log.acao,
                "entidade": log.entidade,
                "entidade_id": log.entidade_id,
                "created_at": log.created_at,
            }
            for log in db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(10).all()
        ],
    }


@router.get("/audit-logs")
def listar_audit_logs(
    empresa_id: int | None = Query(None),
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(get_current_user),
):
    if usuario.perfil == "master":
        consulta = db.query(AuditLog)
        if empresa_id:
            consulta = consulta.filter(AuditLog.empresa_id == empresa_id)
        logs = consulta.order_by(AuditLog.created_at.desc()).limit(100).all()
    elif usuario.perfil in {"admin", "gestor"}:
        logs = db.query(AuditLog).filter(AuditLog.empresa_id == usuario.empresa_id).order_by(AuditLog.created_at.desc()).limit(100).all()
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")
    return [
        {
            "id": log.id,
            "empresa_id": log.empresa_id,
            "usuario_id": log.usuario_id,
            "acao": log.acao,
            "entidade": log.entidade,
            "entidade_id": log.entidade_id,
            "detalhes": log.detalhes,
            "ip": log.ip,
            "created_at": log.created_at,
        }
        for log in logs
    ]


@router.delete("/audit-logs/{log_id}")
def excluir_audit_log(log_id: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    if usuario.perfil not in {"master", "admin", "gestor"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")
    log = db.get(AuditLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log nao encontrado.")
    if usuario.perfil in {"admin", "gestor"} and log.empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario gerencia apenas a propria empresa.")
    registrar_auditoria(db, request, usuario, "excluir", "audit_log", str(log.id), f"Log removido: {log.acao}/{log.entidade}")
    db.delete(log)
    db.commit()
    return {"mensagem": "Log excluido com sucesso."}


# =========================================================
# MOTORISTA ACESSOS — Gerenciamento pelo Painel Master
#
# Estas rotas permitem que usuários master/admin/gestor criem,
# atualizem e excluam credenciais de acesso para o app mobile
# dos motoristas (motorista.html).
#
# Fluxo de uso:
#   1. Admin cria um MotoristaAcesso com email + senha
#   2. Opcionalmente vincula a um Motorista já cadastrado (motorista_id)
#   3. Envia o link do app e as credenciais para o motorista
#   4. Motorista faz login em /motorista-app/login e recebe token JWT
#
# Diferença de segurança:
#   - Usuário master vê acessos de TODAS as empresas
#   - Admin/gestor vê apenas os da própria empresa
# =========================================================

@router.get("/motorista-acessos")
def listar_motorista_acessos(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    """Lista todos os acessos do app motorista visíveis para o usuário logado."""
    if usuario.perfil not in {"master", "admin", "gestor"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")
    q = db.query(MotoristaAcesso)
    # Master vê todas as empresas; admin/gestor vê só a própria
    if usuario.perfil != "master":
        q = q.filter(MotoristaAcesso.empresa_id == usuario.empresa_id)
    acessos = q.order_by(MotoristaAcesso.nome).all()
    result = []
    for a in acessos:
        # Busca nome do motorista vinculado (se existir) para exibição na tabela
        mot = db.get(Motorista, a.motorista_id) if a.motorista_id else None
        result.append({
            "id": a.id,
            "empresa_id": a.empresa_id,
            "motorista_id": a.motorista_id,
            "motorista_nome": mot.nome if mot else "",
            "nome": a.nome,
            "email": a.email,
            "ativo": a.ativo,
            "created_at": a.created_at,
        })
    return result


@router.post("/motorista-acessos")
def criar_motorista_acesso(dados: dict, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    """Cria credencial de acesso ao app mobile para um motorista."""
    if usuario.perfil not in {"master", "admin", "gestor"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")
    email = (dados.get("email") or "").strip().lower()
    senha = dados.get("senha") or ""
    nome = (dados.get("nome") or "").strip()
    motorista_id = dados.get("motorista_id") or None
    # Master pode especificar empresa; outros herdam a própria empresa
    empresa_id = usuario.empresa_id if usuario.perfil != "master" else int(dados.get("empresa_id", usuario.empresa_id))
    if not email or not senha or not nome:
        raise HTTPException(status_code=400, detail="Nome, email e senha sao obrigatorios.")
    validar_senha_forte(senha)
    if db.query(MotoristaAcesso).filter(MotoristaAcesso.email == email).first():
        raise HTTPException(status_code=400, detail="Email ja cadastrado.")
    acesso = MotoristaAcesso(
        empresa_id=empresa_id,
        motorista_id=int(motorista_id) if motorista_id else None,
        nome=nome,
        email=email,
        senha_hash=gerar_hash_senha(senha),
        ativo=True,
    )
    db.add(acesso)
    db.flush()
    registrar_auditoria(db, request, usuario, "criar", "motorista_acesso", str(acesso.id), f"Acesso criado: {email}")
    db.commit()
    db.refresh(acesso)
    return {"id": acesso.id, "nome": acesso.nome, "email": acesso.email, "ativo": acesso.ativo}


@router.put("/motorista-acessos/{acesso_id}")
def atualizar_motorista_acesso(acesso_id: int, dados: dict, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    """Atualiza nome, vínculo com motorista, status ativo/inativo ou senha."""
    if usuario.perfil not in {"master", "admin", "gestor"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")
    acesso = db.get(MotoristaAcesso, acesso_id)
    if not acesso:
        raise HTTPException(status_code=404, detail="Acesso nao encontrado.")
    if usuario.perfil != "master" and acesso.empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")
    if "nome" in dados:
        acesso.nome = (dados["nome"] or "").strip()
    if "motorista_id" in dados:
        acesso.motorista_id = int(dados["motorista_id"]) if dados["motorista_id"] else None
    if "ativo" in dados:
        # Desativar impede login imediato no app mobile sem excluir o cadastro
        acesso.ativo = bool(dados["ativo"])
    if dados.get("senha"):
        validar_senha_forte(dados["senha"])
        acesso.senha_hash = gerar_hash_senha(dados["senha"])
    registrar_auditoria(db, request, usuario, "editar", "motorista_acesso", str(acesso.id))
    db.commit()
    return {"id": acesso.id, "nome": acesso.nome, "email": acesso.email, "ativo": acesso.ativo}


@router.delete("/motorista-acessos/{acesso_id}")
def excluir_motorista_acesso(acesso_id: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    """Remove definitivamente o acesso. Use desativação se quiser manter histórico."""
    if usuario.perfil not in {"master", "admin", "gestor"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")
    acesso = db.get(MotoristaAcesso, acesso_id)
    if not acesso:
        raise HTTPException(status_code=404, detail="Acesso nao encontrado.")
    if usuario.perfil != "master" and acesso.empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")
    registrar_auditoria(db, request, usuario, "excluir", "motorista_acesso", str(acesso.id), f"Email: {acesso.email}")
    db.delete(acesso)
    db.commit()
    return {"mensagem": "Acesso excluido."}
