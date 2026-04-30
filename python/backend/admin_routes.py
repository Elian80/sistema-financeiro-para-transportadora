from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .database import get_db
from .dependencies import get_current_user
from .models import AuditLog, Empresa, Usuario
from .schemas import (
    AlterarSenhaIn,
    EmpresaCreate,
    EmpresaOut,
    EmpresaUpdate,
    UsuarioCreate,
    UsuarioOut,
    UsuarioUpdate,
)
from .security import gerar_hash_senha, validar_senha_forte


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
    if usuario.perfil not in {"admin", "gestor"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")


@router.get("/empresas", response_model=list[EmpresaOut])
def listar_empresas(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    if usuario.perfil == "admin":
        return db.query(Empresa).order_by(Empresa.nome).all()
    if usuario.perfil == "gestor":
        return [db.get(Empresa, usuario.empresa_id)]
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")


@router.post("/empresas", response_model=EmpresaOut)
def criar_empresa(dados: EmpresaCreate, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    if usuario.perfil != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente admin cria empresas.")
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
    if usuario.perfil != "admin" and usuario.empresa_id != empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada.")
    return empresa


@router.put("/empresas/{empresa_id}", response_model=EmpresaOut)
def atualizar_empresa(empresa_id: int, dados: EmpresaUpdate, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    if usuario.perfil != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente admin altera empresas.")
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
    if usuario.perfil != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Somente admin exclui empresas.")
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa nao encontrada.")
    empresa.status = "inativo"
    registrar_auditoria(db, request, usuario, "desativar", "empresa", str(empresa.id))
    db.commit()
    return {"mensagem": "Empresa desativada com sucesso."}


@router.get("/usuarios", response_model=list[UsuarioOut])
def listar_usuarios(db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    if usuario.perfil == "admin":
        return db.query(Usuario).order_by(Usuario.nome).all()
    if usuario.perfil == "gestor":
        return db.query(Usuario).filter(Usuario.empresa_id == usuario.empresa_id).order_by(Usuario.nome).all()
    return [usuario]


@router.post("/usuarios", response_model=UsuarioOut)
def criar_usuario(dados: UsuarioCreate, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    exigir_admin_ou_gestor(usuario)
    empresa_id = dados.empresa_id if usuario.perfil == "admin" and dados.empresa_id else usuario.empresa_id
    if usuario.perfil == "gestor" and empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Gestor gerencia apenas a propria empresa.")
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
    if usuario.perfil == "admin" or alvo.id == usuario.id or (usuario.perfil == "gestor" and alvo.empresa_id == usuario.empresa_id):
        return alvo
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")


@router.put("/usuarios/{usuario_id}", response_model=UsuarioOut)
def atualizar_usuario(usuario_id: int, dados: UsuarioUpdate, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    exigir_admin_ou_gestor(usuario)
    alvo = db.get(Usuario, usuario_id)
    if not alvo:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    if usuario.perfil == "gestor" and alvo.empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Gestor gerencia apenas a propria empresa.")
    alvo.nome = dados.nome
    alvo.perfil = dados.perfil
    alvo.status = dados.status
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
    if usuario.perfil == "gestor" and alvo.empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Gestor gerencia apenas a propria empresa.")
    alvo.status = "inativo"
    registrar_auditoria(db, request, usuario, "desativar", "usuario", str(alvo.id))
    db.commit()
    return {"mensagem": "Usuario desativado com sucesso."}


@router.post("/usuarios/{usuario_id}/alterar-senha")
def alterar_senha(usuario_id: int, dados: AlterarSenhaIn, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    alvo = db.get(Usuario, usuario_id)
    if not alvo:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado.")
    if usuario.perfil not in {"admin", "gestor"} and usuario.id != usuario_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")
    if usuario.perfil == "gestor" and alvo.empresa_id != usuario.empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Gestor gerencia apenas a propria empresa.")
    validar_senha_forte(dados.senha)
    alvo.senha_hash = gerar_hash_senha(dados.senha)
    alvo.deve_trocar_senha = False
    registrar_auditoria(db, request, usuario, "alterar_senha", "usuario", str(alvo.id))
    db.commit()
    return {"mensagem": "Senha alterada com sucesso."}


@router.post("/usuarios/{usuario_id}/desativar")
def desativar_usuario(usuario_id: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(get_current_user)):
    return excluir_usuario(usuario_id, request, db, usuario)
