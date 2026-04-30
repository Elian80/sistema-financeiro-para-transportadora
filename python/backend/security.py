from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt

from .settings import settings


def gerar_hash_senha(senha: str) -> str:
    senha_bytes = senha.encode("utf-8")[:72]
    return bcrypt.hashpw(senha_bytes, bcrypt.gensalt()).decode("utf-8")


def verificar_senha(senha: str, senha_hash: str) -> bool:
    return bcrypt.checkpw(senha.encode("utf-8")[:72], senha_hash.encode("utf-8"))


def criar_access_token(subject: str, empresa_id: int, perfil: str, expires_delta: timedelta | None = None) -> str:
    expira = datetime.now(UTC) + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    payload = {
        "sub": subject,
        "empresa_id": empresa_id,
        "perfil": perfil,
        "exp": expira,
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decodificar_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError("Token invalido.") from exc
    if payload.get("type") != "access":
        raise ValueError("Tipo de token invalido.")
    return payload


def validar_senha_forte(senha: str) -> None:
    if len(senha or "") < 8:
        raise ValueError("A senha deve ter pelo menos 8 caracteres.")
