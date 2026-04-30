from collections.abc import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import Usuario
from .security import decodificar_token


bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Usuario:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autenticacao obrigatoria.")
    try:
        payload = decodificar_token(credentials.credentials)
        usuario_id = int(payload.get("sub"))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalido.") from exc

    usuario = db.get(Usuario, usuario_id)
    if not usuario or usuario.status != "ativo":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario inativo ou inexistente.")
    return usuario


def request_user(request: Request) -> Usuario:
    usuario = getattr(request.state, "usuario", None)
    if not usuario:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autenticacao obrigatoria.")
    return usuario


def require_roles(perfis: list[str]) -> Callable[[Usuario], Usuario]:
    def dependency(usuario: Usuario = Depends(get_current_user)) -> Usuario:
        if usuario.perfil in {"master", "admin"} or usuario.perfil in perfis:
            return usuario
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissao insuficiente.")

    return dependency


def usuario_pode_escrever(usuario: Usuario, dominio: str) -> bool:
    if usuario.perfil in {"master", "admin", "gestor"}:
        return True
    if usuario.perfil == "visualizador":
        return False
    if usuario.perfil == "financeiro":
        return dominio in {"lancamentos", "contas", "relatorios", "ativos", "passivos", "folha"}
    if usuario.perfil == "operador":
        return dominio in {"veiculos", "motoristas", "estoque", "lancamentos"}
    return False
