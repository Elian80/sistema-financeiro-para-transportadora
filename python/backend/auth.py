from datetime import datetime
from time import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .database import get_db
from .models import AuditLog, Usuario
from .schemas import LoginIn, TokenOut, UsuarioOut
from .security import criar_access_token, verificar_senha
from .dependencies import get_current_user


router = APIRouter(prefix="/auth", tags=["auth"])
LOGIN_ATTEMPTS: dict[str, list[float]] = {}


def verificar_rate_limit_login(chave: str) -> None:
    agora = time()
    janela = 60
    max_tentativas = 5
    tentativas = [item for item in LOGIN_ATTEMPTS.get(chave, []) if agora - item < janela]
    if len(tentativas) >= max_tentativas:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Muitas tentativas de login. Aguarde um minuto.")
    tentativas.append(agora)
    LOGIN_ATTEMPTS[chave] = tentativas


@router.post("/login", response_model=TokenOut)
def login(dados: LoginIn, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "desconhecido"
    verificar_rate_limit_login(f"{ip}:{dados.email.lower()}")
    usuario = db.query(Usuario).filter(Usuario.email == dados.email.lower()).first()
    if not usuario or not verificar_senha(dados.senha, usuario.senha_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login ou senha invalidos.")
    if usuario.status != "ativo":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario inativo.")

    usuario.ultimo_login = datetime.now()
    token = criar_access_token(str(usuario.id), usuario.empresa_id, usuario.perfil)
    db.add(AuditLog(
        empresa_id=usuario.empresa_id,
        usuario_id=usuario.id,
        acao="login",
        entidade="usuario",
        entidade_id=str(usuario.id),
        detalhes="Login realizado",
        ip=request.client.host if request.client else "",
    ))
    db.commit()
    db.refresh(usuario)
    return TokenOut(access_token=token, usuario=UsuarioOut.model_validate(usuario))


@router.get("/me", response_model=UsuarioOut)
def me(usuario: Usuario = Depends(get_current_user)):
    return usuario


@router.post("/logout")
def logout():
    return {"mensagem": "Logout realizado no cliente."}
